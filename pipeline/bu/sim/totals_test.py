"""Totals-anchor forward test (``prereg_totals_forward.json``): each arm's over / push / under on the
posted line, logged every run in the frozen column ``totals_test`` (predictions_detailed.csv and
SiteHistory).  Nothing here changes a published value.

Arms (all anchored to the PUBLISHED win %; only the expected-total target differs):

  gm         goal_model.expected_total (the published markets)
  sim        the raw simulator's own expected total
  blend_gm   0.80 x T_gm  + 0.20 x T_mkt
  blend_sim  0.80 x T_sim + 0.20 x T_mkt

T_mkt is the market's expected total read through the simulator's own total distribution: the
GM-anchored total histogram, exponentially tilted (h_t k^t) until P(over | no push) on the posted
line equals the de-vigged market q (``market_total``).

The pure helpers (histogram tilt, over / push / under, the market total, the record) are shared by
the live path (``live_record``: exact re-anchoring of the same simulation for every arm) and the
scoring script (``totals_forward.py``: the descriptive dry run approximates the arms by tilting).
"""
from __future__ import annotations

import json
import math

import numpy as np

VERSION = 1
ARMS = ("gm", "sim", "blend_gm", "blend_sim")
W_MODEL = 0.80              # market.OWNER_MODEL_WEIGHT, applied to the total in goals
LOGK_BOUNDS = (-2.0, 2.0)   # tilt search range (k = e^-2 .. e^2)
_T = np.arange(16, dtype=float)


# ------------------------------------------------------------------------------ histograms

def _hist(h) -> np.ndarray:
    h = np.asarray(h, float)
    if h.shape != (16,) or not np.all(np.isfinite(h)) or h.sum() <= 0:
        raise ValueError("total histogram must be 16 finite non-negative weights")
    return h / h.sum()


def ou(hist, line: float):
    """(over, push, under) of a total histogram (0..15, 15 = 15+) at ``line``."""
    h = _hist(hist)
    return float(h[_T > line].sum()), float(h[_T == line].sum()), float(h[_T < line].sum())


def over_np(hist, line: float) -> float:
    """P(over | no push)."""
    o, _, u = ou(hist, line)
    return o / (o + u) if o + u > 0 else float("nan")


def mean(hist) -> float:
    return float(_hist(hist) @ _T)


def tilt(hist, logk: float) -> np.ndarray:
    """Exponential tilt h_t k^t, renormalised (a pure pace change of a Poisson count)."""
    h = _hist(hist)
    w = h * np.exp(logk * _T)
    return w / w.sum()


def _solve_logk(f, target: float, iters: int = 80):
    """log k in LOGK_BOUNDS with f(log k) = target for an increasing f; (log k, hit a bound)."""
    lo, hi = LOGK_BOUNDS
    if f(lo) >= target:
        return lo, True
    if f(hi) <= target:
        return hi, True
    for _ in range(iters):
        mid = 0.5 * (lo + hi)
        if f(mid) < target:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1e-10:
            break
    return 0.5 * (lo + hi), False


def tilt_to_mean(hist, t: float) -> np.ndarray:
    """The tilted histogram whose mean is ``t`` (dry-run approximation of re-anchoring the total)."""
    lk, _ = _solve_logk(lambda x: mean(tilt(hist, x)), float(t))
    return tilt(hist, lk)


# ------------------------------------------------------------------------------ market

def market_q(over_price, under_price):
    """De-vigged P(over | no push) from the posted American prices (market.devig, power), else None."""
    import market
    try:
        o, u = float(over_price), float(under_price)
    except (TypeError, ValueError):
        return None
    if not (abs(o) >= 100 and abs(u) >= 100) or not (math.isfinite(o) and math.isfinite(u)):
        return None
    dv = market.devig([o, u])
    return float(dv[0]) if dv else None


def market_total(hist, line: float, q: float):
    """(T_mkt, hit a bound): the mean of the GM-anchored histogram tilted so that P(over | no push)
    at ``line`` equals the de-vigged q."""
    lk, bound = _solve_logk(lambda x: over_np(tilt(hist, x), line), float(q))
    return mean(tilt(hist, lk)), bound


def arm_totals(t_gm: float, t_sim, t_mkt, w: float = W_MODEL) -> dict:
    """Each arm's expected-total target (None when an input is missing)."""
    ok = lambda x: x is not None and math.isfinite(float(x))     # noqa: E731
    return {
        "gm": float(t_gm),
        "sim": float(t_sim) if ok(t_sim) else None,
        "blend_gm": w * float(t_gm) + (1 - w) * float(t_mkt) if ok(t_mkt) else None,
        "blend_sim": w * float(t_sim) + (1 - w) * float(t_mkt) if ok(t_sim) and ok(t_mkt) else None,
    }


# ------------------------------------------------------------------------------ record

def _r4(x):
    return None if x is None or not math.isfinite(float(x)) else round(float(x), 4)


def record(status: str, line=None, posted=None, q=None, t_mkt=None, bound=None, arms=None) -> str:
    """The ``totals_test`` JSON: {v, status, line (priced), posted (a book line), q, t_mkt, k_bound,
    w_model, arms: {arm: {t, o, p, u}}}; probabilities are fractions."""
    out = {"v": VERSION, "status": status, "line": line, "posted": posted, "q": _r4(q), "t_mkt": _r4(t_mkt),
           "k_bound": bound, "w_model": W_MODEL,
           "arms": {a: ({k: _r4(v) for k, v in arms[a].items()} if arms and arms.get(a) else None)
                    for a in ARMS} if arms else None}
    return json.dumps(out, separators=(",", ":"))


def parse(raw):
    """A ``totals_test`` cell as a dict (None when empty / not v1)."""
    if not isinstance(raw, str) or not raw.strip().startswith("{"):
        return None
    try:
        d = json.loads(raw)
    except ValueError:
        return None
    return d if isinstance(d, dict) and d.get("v") == VERSION else None


def posted_line(v):
    try:
        x = float(str(v).strip())
    except (TypeError, ValueError):
        return None
    return x if 3.0 <= x <= 12.0 else None


def live_record(run, S, n: int, p_pub: float, t_gm: float, gm_hist, odds: dict) -> str:
    """Live: every arm re-anchored exactly (same simulation, ``anchor.anchor_game``) to the published
    win % and the arm's total, priced at the posted line (6.0 when none is posted, as the published
    markets).  ``gm_hist``: the published (GM-anchored) total histogram.  Never raises."""
    from . import anchor as AN
    from . import markets as MK
    try:
        odds = odds or {}
        L = posted_line(odds.get("total_line"))
        line = 6.0 if L is None else L
        q = market_q(odds.get("total_over"), odds.get("total_under")) if L is not None else None
        t_mkt, bound = market_total(gm_hist, line, q) if q is not None else (None, None)
        targets = arm_totals(t_gm, run.total, t_mkt)
        arms = {}
        for a in ARMS:
            T = targets[a]
            if T is None:
                continue
            if a == "gm":
                h = gm_hist
            else:
                o2, w, _ = AN.anchor_game(run.R, 0, S, n, run.seed, float(p_pub), float(T), o=run.o)
                h = MK.summarize(o2, w=w)["total_hist"]
            o_, p_, u_ = ou(h, line)
            arms[a] = {"t": T, "o": o_, "p": p_, "u": u_}
        return record("sim", line, L is not None, q, t_mkt, bound, arms)
    except Exception as e:      # never break the prediction run
        return record(f"error: {type(e).__name__}")
