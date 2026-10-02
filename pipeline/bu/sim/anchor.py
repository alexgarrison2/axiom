"""Anchor a simulated game to a target home win probability and expected total.

The anchored game multiplies every goal hazard by ``pace * exp(+tilt / 2)`` (home) and
``pace * exp(-tilt / 2)`` (away): a tilt of the 5v5 (and every other) rate ratio plus a pace
scale.  P(home win) is increasing in the tilt and the expected total in the pace, so the pair is
found by nested bisection, as ``goal_model.goal_rates`` does for the Poisson model.  Every
evaluation reweights the same simulations (``engine.tilt_weights``, exact likelihood ratios), so
the solve is smooth and cheap; when the weights degenerate (effective sample size below
``MIN_ESS``) the game is re-simulated at the solution and solved again around it.
"""
from __future__ import annotations

import numpy as np

from . import engine as EN
from .markets import final_scores

MIN_ESS = 0.25
TOL_P = 2e-4
TOL_T = 2e-3


def _stats(o):
    fh, fa = final_scores(o)
    return (fh > fa).astype(float), (fh + fa).astype(float)


def solve_weights(o, p_target: float, t_target: float, iters: int = 40):
    """(tilt, pace, weights) so that the weighted P(home) and E[total] hit the targets."""
    win, tot = _stats(o)
    p_target = float(np.clip(p_target, 0.02, 0.98))

    def p_of(tilt, pace):
        w = EN.tilt_weights(o, tilt, pace)
        return float(w @ win), float(w @ tot), w

    def tilt_for(pace):
        lo, hi = -3.0, 3.0
        for _ in range(iters):
            mid = 0.5 * (lo + hi)
            p, _, _ = p_of(mid, pace)
            if p < p_target:
                lo = mid
            else:
                hi = mid
            if hi - lo < 1e-5:
                break
        return 0.5 * (lo + hi)

    lo, hi = 0.5, 2.0
    tilt = 0.0
    for _ in range(iters):
        mid = np.sqrt(lo * hi)
        tilt = tilt_for(mid)
        _, t, _ = p_of(tilt, mid)
        if t < t_target:
            lo = mid
        else:
            hi = mid
        if hi / lo < 1 + 1e-5:
            break
    pace = float(np.sqrt(lo * hi))
    tilt = tilt_for(pace)
    p, t, w = p_of(tilt, pace)
    return tilt, pace, w, p, t


def anchor_game(rates, i, S, n, seed, p_target, t_target, o=None):
    """Simulate (or reuse ``o``) and anchor game ``i``.  Returns (outcomes, weights, info)."""
    if o is None:
        o = EN.simulate_game(rates, i, S, n, seed)
    tilt, pace, w, p, t = solve_weights(o, p_target, t_target)
    info = {"tilt": tilt, "pace": pace, "ess": EN.ess(w) / o.n, "resim": False}
    if info["ess"] < MIN_ESS:
        base_t, base_k = float(rates.tilt[i]), float(rates.pace[i])
        r2 = rates.with_anchor(tilt=np.where(np.arange(len(rates)) == i, base_t + tilt, rates.tilt),
                               pace=np.where(np.arange(len(rates)) == i, base_k * pace, rates.pace))
        o = EN.simulate_game(r2, i, S, n, seed)
        t2, k2, w, p, t = solve_weights(o, p_target, t_target)
        info = {"tilt": tilt + t2, "pace": pace * k2, "ess": EN.ess(w) / o.n, "resim": True}
    info.update({"p": p, "total": t, "p_err": p - p_target, "t_err": t - t_target})
    return o, w, info
