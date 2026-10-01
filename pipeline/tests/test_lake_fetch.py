"""sm-lake-1: polite, resumable raw fetcher."""
import gzip
import json
import os
import threading
import time

import pytest

from bu.lake.backfill import parse_seasons, priority_order
from bu.lake.build import sample_games
from bu.lake.fetch import Fetcher, Task, compact_manifest, load_manifest
from bu.lake.paths import Lake
from bu.lake.ratelimit import RateLimiter
from bu.lake.sources import ENDPOINTS
from http_utils import HttpError


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def sleep(self, d):
        self.t += d


def test_rate_limiter_spaces_request_starts():
    c = FakeClock()
    lim = RateLimiter(2.0, clock=c, sleep=c.sleep)
    starts = []
    for _ in range(5):
        lim.wait()
        starts.append(c())
    assert starts == [0.0, 0.5, 1.0, 1.5, 2.0]


def test_rate_limiter_is_thread_safe():
    # Deterministic: a frozen clock and a no-op sleep, so each wait() returns its slot's
    # offset.  Concurrent callers must get distinct, evenly spaced slots (no two
    # requests share a slot), whatever the thread interleaving.
    lim = RateLimiter(40.0, clock=lambda: 0.0, sleep=lambda d: None)
    slots, lock = [], threading.Lock()

    def go():
        for _ in range(25):
            d = lim.wait()
            with lock:
                slots.append(round(d * 40))
    ts = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(slots) == list(range(200))


def test_rate_limiter_holds_the_rate_in_real_time():
    # Real sleeps overshoot by a few ms, so individual gaps can shrink; the limiter
    # schedules starts on a fixed grid, so the span of n starts never does.
    lim = RateLimiter(40.0)
    starts, lock = [], threading.Lock()

    def go():
        for _ in range(5):
            lim.wait()
            with lock:
                starts.append(time.monotonic())
    ts = [threading.Thread(target=go) for _ in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    starts.sort()
    assert len(starts) == 20 and starts[-1] - starts[0] >= 19 / 40 - 0.03


def test_endpoints_use_explicit_seasons_and_two_hosts():
    assert ENDPOINTS["roster"].url("TOR", "20102011").endswith("/roster/TOR/20102011")
    assert "season=20262027" in ENDPOINTS["schedule"].url("20262027", "20262027")
    assert {ENDPOINTS[e].host() for e in ("pbp", "boxscore", "rightrail", "roster")} == {"api-web.nhle.com"}
    assert ENDPOINTS["shifts"].host() == "api.nhle.com"
    for e in ENDPOINTS.values():
        assert "/now" not in e.url("1", "20262027") and "current" not in e.url("1", "20262027")


def _payloads():
    return {
        "play-by-play": {"id": 1, "gameState": "OFF", "plays": [{"eventId": 1}]},
        "boxscore": {"gameState": "OFF", "playerByGameStats": {"homeTeam": {}}},
        "right-rail": {"gameInfo": {}},
    }


def test_fetcher_caches_resumes_and_classifies(tmp_path):
    lake = Lake(str(tmp_path))
    calls = []

    def req(url):
        calls.append(url)
        if "shiftcharts" in url and "2026020002" in url:
            return json.dumps({"data": []}).encode()            # REST lag: not cached
        if "shiftcharts" in url:
            return json.dumps({"data": [{"typeCode": 517}]}).encode()
        if "2025020404" in url:
            raise HttpError(url, 404)
        for k, v in _payloads().items():
            if k in url:
                return json.dumps(v).encode()
        raise AssertionError(url)

    f = Fetcher(lake, rps=200, request_fn=req, current_start_year=2026, log=lambda *a: None)
    tasks = [Task(ep, "20262027", g) for g in ("2026020001", "2026020002") for ep in ("pbp", "boxscore", "rightrail", "shifts")]
    tasks.append(Task("pbp", "20252026", "2025020404"))
    res = f.run(tasks)
    assert res["ok"] == 7 and res["empty"] == 1 and res["404"] == 1
    p = lake.raw_path("pbp", "20262027", "2026020001")
    with gzip.open(p, "rb") as fh:
        assert json.loads(fh.read())["plays"] == [{"eventId": 1}]
    m = load_manifest(lake)
    assert m[("pbp", "2026020001")]["sha256"] and m[("shifts", "2026020002")]["status"] == "empty"

    # Resume: only the empty shift chart is retried; the closed-season 404 is not.
    calls.clear()
    f2 = Fetcher(lake, rps=200, request_fn=req, current_start_year=2026, log=lambda *a: None)
    f2.run(tasks)
    assert calls == [ENDPOINTS["shifts"].url("2026020002", "20262027")]
    calls.clear()
    Fetcher(lake, rps=200, request_fn=req, current_start_year=2026, retry_failed=True,
            log=lambda *a: None).run(tasks)
    assert any("2025020404" in c for c in calls)
    assert compact_manifest(lake) >= 9 and os.path.exists(lake.manifest_parquet)


def test_fetcher_retries_transient_errors_and_respects_budget(tmp_path):
    lake = Lake(str(tmp_path))
    n = {"c": 0}

    def flaky(url):
        n["c"] += 1
        if n["c"] < 3:
            raise HttpError(url, 503)
        return json.dumps(_payloads()["play-by-play"]).encode()

    f = Fetcher(lake, rps=500, request_fn=flaky, backoff=0.0, log=lambda *a: None)
    assert f.fetch_one(Task("pbp", "20232024", "2023020001")) == "ok"
    assert n["c"] == 3

    f = Fetcher(lake, rps=500, request_fn=lambda u: json.dumps(_payloads()["play-by-play"]).encode(),
                max_requests=2, log=lambda *a: None)
    res = f.run([Task("pbp", "20232024", f"20230200{i:02d}") for i in range(10, 20)])
    assert res.get("ok", 0) == 2 and res.get("stopped", 0) >= 1


def test_fetcher_rate_holds_per_host_with_parallel_workers(tmp_path):
    lake = Lake(str(tmp_path))
    starts, lock = [], threading.Lock()

    def req(url):
        with lock:
            starts.append((url.split("/")[2], time.monotonic()))
        return json.dumps({"data": [{"typeCode": 517}]} if "shiftcharts" in url
                          else _payloads()["play-by-play"]).encode()
    f = Fetcher(lake, rps=20, workers_per_host=3, request_fn=req, log=lambda *a: None)
    tasks = [Task("pbp", "20232024", str(2023020100 + i)) for i in range(8)] + \
            [Task("shifts", "20232024", str(2023020100 + i)) for i in range(8)]
    f.run(tasks)
    for host in ("api-web.nhle.com", "api.nhle.com"):
        ts = sorted(t for h, t in starts if h == host)
        assert len(ts) == 8
        assert ts[-1] - ts[0] >= 7 / 20 - 0.03          # 8 starts span >= 7 slots
        assert f.stats[host].as_dict()["achieved_rps"] <= 20 * 1.15


def test_cli_helpers():
    assert parse_seasons("2010-2012,2015") == [2010, 2011, 2012, 2015]
    with pytest.raises(SystemExit):
        parse_seasons("2005-2010")
    assert priority_order([2010, 2017, 2018, 2025], 2018) == [2025, 2018, 2017, 2010]
    ids = list(range(2023020001, 2023021313))
    s = sample_games(ids, 4)
    assert len(s) == 4 and s == sorted(s) and s[0] > ids[0] and s[-1] < ids[-1]
