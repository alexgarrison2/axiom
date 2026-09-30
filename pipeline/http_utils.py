"""Shared HTTP helper for the pipeline.

Every network call in pipeline/ goes through this module so that timeouts,
retries, TLS verification and the User-Agent are consistent:

  * TLS verification is always on (certifi CA bundle when available).
  * Default timeout 15s, 3 attempts with exponential backoff.
  * Retries on connection errors, timeouts, 429 and 5xx (incl. Cloudflare
    520-524).  429 honours Retry-After (capped).  Other 4xx fail immediately.
  * A browser UA is used by default (DailyFaceoff, Bovada and the NHL CDN
    all serve it); pass ua="plain" for APIs that prefer a simple UA (ESPN).

Named ``http_utils`` rather than ``http`` because scripts run with pipeline/
as sys.path[0]; a local ``http.py`` would shadow the stdlib ``http`` package
and break urllib itself.

Testing hooks
-------------
PONYXG_HTTP_FAULTS="substr=status,substr2=timeout" makes any URL containing
``substr`` fail with that HTTP status (or a timeout) without touching the
network.  ``REQUEST_LOG`` records every attempted request (url, status) so
tests can assert request counts.
"""
from __future__ import annotations

import json
import os
import random
import socket
import ssl
import time
import urllib.error
import urllib.request

try:  # certifi ships with requests/pip; fall back to the system store.
    import certifi
    _CAFILE = certifi.where()
except Exception:  # pragma: no cover - depends on environment
    _CAFILE = None

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
# ESPN's edge rejects full Chrome UAs from datacenter IPs but accepts a bare
# "Mozilla/5.0"; it is also the UA the NHL APIs have always been called with.
PLAIN_UA = "Mozilla/5.0"

DEFAULT_TIMEOUT = 15
DEFAULT_RETRIES = 3
RETRY_STATUSES = {408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524}
MAX_RETRY_AFTER = 30

REQUEST_LOG: list[tuple[str, object]] = []

_SSL_CTX = ssl.create_default_context(cafile=_CAFILE) if _CAFILE else ssl.create_default_context()


class HttpError(Exception):
    """Raised when a request fails after all retries (or with a non-retryable status)."""

    def __init__(self, url: str, status=None, message: str = ""):
        self.url = url
        self.status = status
        super().__init__(f"{status or 'error'} for {url}{': ' + message if message else ''}")


def _faults() -> dict[str, str]:
    raw = os.environ.get("PONYXG_HTTP_FAULTS", "")
    out = {}
    for part in raw.split(","):
        if "=" in part:
            k, v = part.rsplit("=", 1)
            if k.strip():
                out[k.strip()] = v.strip()
    return out


def _injected_fault(url: str):
    for needle, status in _faults().items():
        if needle in url:
            return status
    return None


def _resolve_ua(ua) -> str:
    if ua in (None, "browser"):
        return BROWSER_UA
    if ua == "plain":
        return PLAIN_UA
    return str(ua)


def request_bytes(url: str, *, timeout: float = DEFAULT_TIMEOUT, retries: int = DEFAULT_RETRIES,
                  backoff: float = 1.0, headers: dict | None = None, ua=None,
                  quiet: bool = False) -> bytes:
    """GET ``url`` and return the body. Raises HttpError on failure."""
    hdrs = {"User-Agent": _resolve_ua(ua), "Accept-Encoding": "identity"}
    if headers:
        hdrs.update(headers)
    last_status, last_msg = None, ""
    for attempt in range(1, max(1, retries) + 1):
        fault = _injected_fault(url)
        try:
            if fault is not None:
                REQUEST_LOG.append((url, f"fault:{fault}"))
                if fault == "timeout":
                    raise socket.timeout("injected timeout")
                raise urllib.error.HTTPError(url, int(fault), "injected fault", {}, None)
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as resp:
                body = resp.read()
                REQUEST_LOG.append((url, resp.status))
                return body
        except urllib.error.HTTPError as e:
            if fault is None:
                REQUEST_LOG.append((url, e.code))
            last_status, last_msg = e.code, str(e.reason)
            if e.code not in RETRY_STATUSES or attempt == retries:
                break
            wait = backoff * (2 ** (attempt - 1))
            if e.code == 429:
                try:
                    wait = max(wait, min(float(e.headers.get("Retry-After", 0)), MAX_RETRY_AFTER))
                except Exception:
                    pass
            if not quiet:
                print(f"    [http] {e.code} for {url} — retry {attempt}/{retries - 1} in {wait:.1f}s")
            time.sleep(wait + random.uniform(0, 0.25))
        except (UnicodeError, ValueError) as e:  # malformed URL — retrying won't help
            raise HttpError(url, "badurl", str(e)[:120])
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, ssl.SSLError,
                OSError) as e:
            if fault is None:
                REQUEST_LOG.append((url, "neterr"))
            last_status, last_msg = None, str(getattr(e, "reason", e))
            if attempt == retries:
                break
            wait = backoff * (2 ** (attempt - 1))
            if not quiet:
                print(f"    [http] {last_msg} for {url} — retry {attempt}/{retries - 1} in {wait:.1f}s")
            time.sleep(wait + random.uniform(0, 0.25))
    raise HttpError(url, last_status, last_msg)


def get_text(url: str, *, encoding: str = "utf-8", **kw) -> str:
    return request_bytes(url, **kw).decode(encoding, errors="replace")


def get_json(url: str, **kw):
    body = request_bytes(url, **kw)
    try:
        return json.loads(body.decode("utf-8"))
    except ValueError as e:
        raise HttpError(url, "badjson", str(e)[:120])


def try_get_json(url: str, default=None, **kw):
    """get_json that logs and returns ``default`` instead of raising."""
    try:
        return get_json(url, **kw)
    except HttpError as e:
        print(f"  [WARN] {e}")
        return default


def try_get_text(url: str, default=None, **kw):
    try:
        return get_text(url, **kw)
    except HttpError as e:
        print(f"  [WARN] {e}")
        return default


def request_count(substr: str = "") -> int:
    """Number of HTTP attempts logged whose URL contains ``substr``."""
    return sum(1 for u, _ in REQUEST_LOG if substr in u)
