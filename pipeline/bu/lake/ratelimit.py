"""Thread-safe per-host rate limiter (polite backfill, DECISIONS D5: <= 2 rps per host)."""
from __future__ import annotations

import threading
import time


class RateLimiter:
    """Spaces request *starts* at least ``1/rps`` seconds apart, across threads."""

    def __init__(self, rps: float, clock=time.monotonic, sleep=time.sleep):
        if rps <= 0:
            raise ValueError("rps must be > 0")
        self.interval = 1.0 / float(rps)
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> float:
        """Block until this caller may start a request. Returns seconds waited."""
        with self._lock:
            now = self._clock()
            start = max(now, self._next)
            self._next = start + self.interval
        delay = start - now
        if delay > 0:
            self._sleep(delay)
        return max(0.0, delay)


class HostLimiters:
    def __init__(self, rps: float, **kw):
        self.rps = rps
        self._kw = kw
        self._by_host: dict[str, RateLimiter] = {}
        self._lock = threading.Lock()

    def for_host(self, host: str) -> RateLimiter:
        with self._lock:
            if host not in self._by_host:
                self._by_host[host] = RateLimiter(self.rps, **self._kw)
            return self._by_host[host]
