"""Resumable, per-host rate-limited raw fetcher (DESIGN §2.2).

* Every request goes through ``pipeline/http_utils.py`` (TLS verified, plain UA);
  retries are done here so that *every attempt* passes the host's rate limiter.
* A task is done when its raw file exists (``raw/{endpoint}/{season}/{key}.json.gz``,
  written atomically).  Interrupting a run (Ctrl-C, crash, sleep) loses at most the
  in-flight requests; re-running the same command resumes.
* ``raw/_manifest.jsonl`` logs every outcome (ok / empty / notfinal / 404 / error)
  with bytes, sha256 and timing; ``compact_manifest`` folds it into
  ``raw/_manifest.parquet``.  404s in closed seasons are not retried unless
  ``retry_failed``; ``empty``/``notfinal``/``error`` always are.
* Hosts run in parallel (api-web and api.nhle.com each get their own budget).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import queue
import random
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .paths import Lake
from .sources import ENDPOINTS, start_year_of

RETRYABLE = {None, 408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524}


@dataclass(frozen=True)
class Task:
    endpoint: str
    season: str
    key: str

    @property
    def url(self) -> str:
        return ENDPOINTS[self.endpoint].url(self.key, self.season)

    @property
    def host(self) -> str:
        return ENDPOINTS[self.endpoint].host(self.key, self.season)


@dataclass
class HostStats:
    requests: int = 0
    ok: int = 0
    empty: int = 0
    missing: int = 0
    errors: int = 0
    bytes_raw: int = 0
    bytes_gz: int = 0
    latency_s: float = 0.0
    waited_s: float = 0.0
    started: float = 0.0
    last_start: float = 0.0
    finished: float = 0.0
    by_endpoint: dict = field(default_factory=lambda: defaultdict(lambda: {"n": 0, "bytes_raw": 0, "bytes_gz": 0}))

    @property
    def elapsed(self) -> float:
        return max(1e-9, (self.finished or time.monotonic()) - self.started) if self.started else 0.0

    def as_dict(self) -> dict:
        el = self.elapsed
        span = self.last_start - self.started
        # Request starts are what the limiter spaces, so measure the rate between them.
        rate = (self.requests - 1) / span if self.requests > 1 and span > 0 else None
        return {
            "requests": self.requests, "ok": self.ok, "empty": self.empty, "missing": self.missing,
            "errors": self.errors, "bytes_raw": self.bytes_raw, "bytes_gz": self.bytes_gz,
            "elapsed_s": round(el, 2), "achieved_rps": None if rate is None else round(rate, 3),
            "mean_latency_s": round(self.latency_s / self.requests, 3) if self.requests else None,
            "by_endpoint": {k: dict(v) for k, v in self.by_endpoint.items()},
        }


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_raw(path: str):
    with gzip.open(path, "rb") as f:
        return json.loads(f.read().decode("utf-8"))


def load_manifest(lake: Lake) -> dict[tuple[str, str], dict]:
    """Last manifest record per (endpoint, key)."""
    out: dict[tuple[str, str], dict] = {}
    if not os.path.exists(lake.manifest_jsonl):
        return out
    with open(lake.manifest_jsonl, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except ValueError:
                continue   # torn last line after a crash
            out[(r.get("endpoint"), str(r.get("key")))] = r
    return out


def compact_manifest(lake: Lake) -> int:
    """Write raw/_manifest.parquet (last record per endpoint/key). Returns rows."""
    import pandas as pd
    recs = list(load_manifest(lake).values())
    if not recs:
        return 0
    df = pd.DataFrame(recs)
    os.makedirs(os.path.dirname(lake.manifest_parquet), exist_ok=True)
    tmp = lake.manifest_parquet + ".tmp"
    df.to_parquet(tmp, index=False, compression="zstd")
    os.replace(tmp, lake.manifest_parquet)
    return len(df)


class Fetcher:
    def __init__(self, lake: Lake, *, rps: float = 2.0, workers_per_host: int = 2, timeout: float = 20,
                 retries: int = 4, backoff: float = 2.0, retry_failed: bool = False,
                 current_start_year: int | None = None, max_requests: int | None = None,
                 log=print, progress_every: float = 30.0, request_fn=None):
        from .ratelimit import HostLimiters
        self.lake = lake
        self.rps = rps
        self.workers_per_host = max(1, workers_per_host)
        self.timeout = timeout
        self.retries = max(1, retries)
        self.backoff = backoff
        self.retry_failed = retry_failed
        self.current_start_year = current_start_year
        self.max_requests = max_requests
        self.log = log
        self.progress_every = progress_every
        self.limiters = HostLimiters(rps)
        self.stats: dict[str, HostStats] = defaultdict(HostStats)
        self._mlock = threading.Lock()
        self._slock = threading.Lock()
        self._stop = threading.Event()
        self._budget = max_requests
        self._manifest = load_manifest(lake)
        self._request_fn = request_fn

    # ------------------------------------------------------------------ state
    def is_done(self, t: Task) -> bool:
        return os.path.exists(self.lake.raw_path(t.endpoint, t.season, t.key))

    def is_permanent_miss(self, t: Task) -> bool:
        if self.retry_failed:
            return False
        rec = self._manifest.get((t.endpoint, str(t.key)))
        if not rec or str(rec.get("status")) != "404":
            return False
        # 404 in a closed season is final; in the current season it may still appear.
        return self.current_start_year is None or start_year_of(t.season) < self.current_start_year

    def pending(self, tasks) -> list[Task]:
        return [t for t in tasks if not self.is_done(t) and not self.is_permanent_miss(t)]

    def _record(self, rec: dict):
        line = json.dumps(rec, separators=(",", ":"))
        with self._mlock:
            os.makedirs(os.path.dirname(self.lake.manifest_jsonl), exist_ok=True)
            with open(self.lake.manifest_jsonl, "a", encoding="utf-8") as f:
                f.write(line + "\n")
            self._manifest[(rec["endpoint"], str(rec["key"]))] = rec

    def _take_budget(self) -> bool:
        with self._slock:
            if self._budget is None:
                return True
            if self._budget <= 0:
                self._stop.set()
                return False
            self._budget -= 1
            return True

    # ---------------------------------------------------------------- request
    def _get(self, url: str) -> bytes:
        if self._request_fn is not None:
            return self._request_fn(url)
        from http_utils import request_bytes
        return request_bytes(url, timeout=self.timeout, retries=1, ua="plain", quiet=True)

    def fetch_one(self, t: Task, *, force: bool = False) -> str:
        """Fetch one task (respecting the host limiter). Returns its status."""
        from http_utils import HttpError
        path = self.lake.raw_path(t.endpoint, t.season, t.key)
        if not force and os.path.exists(path):
            return "cached"
        host = t.host
        lim = self.limiters.for_host(host)
        st = self.stats[host]
        status, body, http_status, err = "error", b"", None, ""
        t0 = time.monotonic()
        for attempt in range(1, self.retries + 1):
            if self._stop.is_set() or not self._take_budget():
                return "stopped"
            waited = lim.wait()
            a0 = time.monotonic()
            with self._slock:
                st.requests += 1
                st.waited_s += waited
                if not st.started:
                    st.started = a0
                st.last_start = a0
            try:
                body = self._get(t.url)
                with self._slock:
                    st.latency_s += time.monotonic() - a0
                http_status = 200
                break
            except HttpError as e:
                with self._slock:
                    st.latency_s += time.monotonic() - a0
                http_status, err = e.status, str(e)[:200]
                if e.status == 404:
                    status = "404"
                    break
                if e.status not in RETRYABLE or attempt == self.retries:
                    status = "error"
                    break
                wait = self.backoff * (2 ** (attempt - 1)) + random.uniform(0, 0.5)
                if e.status == 429:
                    wait = max(wait, 30.0)
                    lim.wait()  # take a slot so the whole host slows down
                time.sleep(wait)
        if http_status == 200:
            try:
                payload = json.loads(body.decode("utf-8"))
                status = ENDPOINTS[t.endpoint].classify(payload)
            except ValueError as e:
                status, err = "error", f"badjson: {e}"[:200]
        rec = {"endpoint": t.endpoint, "season": t.season, "key": str(t.key), "status": status,
               "http": http_status, "bytes": len(body) if status == "ok" else 0, "sha256": None,
               "fetched_at": _now_iso(), "elapsed_ms": int((time.monotonic() - t0) * 1000)}
        if status == "ok":
            gz = gzip.compress(body, 6)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = f"{path}.{threading.get_ident()}.tmp"
            with open(tmp, "wb") as f:
                f.write(gz)
            os.replace(tmp, path)
            rec["sha256"] = hashlib.sha256(body).hexdigest()
            rec["bytes_gz"] = len(gz)
            with self._slock:
                st.ok += 1
                st.bytes_raw += len(body)
                st.bytes_gz += len(gz)
                be = st.by_endpoint[t.endpoint]
                be["n"] += 1
                be["bytes_raw"] += len(body)
                be["bytes_gz"] += len(gz)
        else:
            if err:
                rec["error"] = err
            with self._slock:
                if status == "404":
                    st.missing += 1
                elif status in ("empty", "notfinal"):
                    st.empty += 1
                else:
                    st.errors += 1
        with self._slock:
            st.finished = time.monotonic()
        self._record(rec)
        return status

    # ------------------------------------------------------------------- run
    def run(self, tasks, *, label: str = "fetch") -> dict:
        """Fetch every pending task; hosts in parallel. Returns {status: count}."""
        tasks = list(tasks)
        todo = self.pending(tasks)
        counts: dict[str, int] = defaultdict(int)
        counts["cached_or_skipped"] = len(tasks) - len(todo)
        if not todo:
            self.log(f"  [{label}] nothing to fetch ({counts['cached_or_skipped']} cached/skipped)")
            return dict(counts)
        by_host: dict[str, queue.Queue] = {}
        totals: dict[str, int] = defaultdict(int)
        for t in todo:
            by_host.setdefault(t.host, queue.Queue()).put(t)
            totals[t.host] += 1
        done: dict[str, int] = defaultdict(int)
        clock = {"last": time.monotonic()}
        lock = threading.Lock()

        def report(force=False):
            now = time.monotonic()
            if not force and now - clock["last"] < self.progress_every:
                return
            clock["last"] = now
            parts = []
            for h, n in totals.items():
                st = self.stats[h]
                rate = st.as_dict()["achieved_rps"] or 0.0
                left = n - done[h]
                eta = left / rate / 3600 if rate else float("nan")
                parts.append(f"{h}: {done[h]}/{n} @ {rate:.2f} rps, ETA {eta:.2f} h")
            self.log(f"  [{label}] " + " | ".join(parts))

        def worker(host: str, q: queue.Queue):
            while not self._stop.is_set():
                try:
                    t = q.get_nowait()
                except queue.Empty:
                    return
                try:
                    s = self.fetch_one(t)
                except Exception as e:  # never let one bad payload kill the run
                    s = "error"
                    self._record({"endpoint": t.endpoint, "season": t.season, "key": str(t.key),
                                  "status": "error", "error": repr(e)[:200], "fetched_at": _now_iso()})
                with lock:
                    counts[s] += 1
                    done[host] += 1
                    report()

        threads = [threading.Thread(target=worker, args=(h, q), daemon=True)
                   for h, q in by_host.items() for _ in range(self.workers_per_host)]
        for th in threads:
            th.start()
        try:
            while any(th.is_alive() for th in threads):
                for th in threads:
                    th.join(timeout=0.5)
        except KeyboardInterrupt:
            self.log("  interrupted — finishing in-flight requests; re-run the same command to resume")
            self._stop.set()
            for th in threads:
                th.join(timeout=60)
            raise
        report(force=True)
        return dict(counts)
