"""Simulated outcomes -> market probabilities, fair prices and EV (pushes handled).

Settlement conventions (North American books, the ones in ``odds.json``):

* moneyline: the official result, OT and shootout included;
* regulation 3-way: the score after 60 minutes (home / tie / away);
* puck line +-1.5 and the game total: the official final score, where a shootout adds one goal
  to the winner (a 4-4 game won in the shootout is 5-4, total 9);
* total line L: over if goals > L, under if < L, a push (stake returned) if equal (whole lines);
* 1st period: 3-way (home / tie / away), and the 2-way period moneyline whose bets are refunded
  when the period is tied (Bovada's "Moneyline - 1st Period", key 2W-12: verified 2026-10-02 from
  the raw feed, -130 / EVEN is ~1.065 overround only as a 2-way market with the tie refunded).
"""
from __future__ import annotations

import math

import numpy as np

TOTAL_LINES = (5.5, 6.0, 6.5)


def final_scores(o):
    fh = o.hg.astype(int) + (o.so_home == 1)
    fa = o.ag.astype(int) + (o.so_home == -1)
    return fh, fa


def summarize(o, total_lines=TOTAL_LINES, extra_lines=(), w=None) -> dict:
    """Probabilities of every market outcome plus distribution summaries for one game.
    ``w``: optional normalised simulation weights (``engine.tilt_weights``)."""
    fh, fa = final_scores(o)
    n = float(o.n)
    if w is None:
        w = np.full(o.n, 1.0 / n)

    def m(x):
        return float(np.dot(w, x))
    tot = fh + fa
    marg = fh - fa
    out = {
        "p_home": m(marg > 0),
        "reg_home": m(o.hreg > o.areg), "reg_tie": m(o.hreg == o.areg), "reg_away": m(o.hreg < o.areg),
        "pl_home_m15": m(marg >= 2), "pl_away_m15": m(marg <= -2),
        "p1_home": m(o.h1 > o.a1), "p1_tie": m(o.h1 == o.a1), "p1_away": m(o.h1 < o.a1),
        "exp_total": m(tot), "exp_home": m(fh), "exp_away": m(fa),
        "exp_reg_total": m(o.hreg + o.areg), "exp_p1_total": m(o.h1 + o.a1),
        "p_ot": m(o.dec == 1), "p_so": m(o.dec == 2), "exp_en": m(o.en_h + o.en_a),
        "n": int(n), "ess": float(1.0 / np.sum(w * w)),
    }
    out["pl_home_p15"] = 1.0 - out["pl_away_m15"]
    out["pl_away_p15"] = 1.0 - out["pl_home_m15"]
    nt = out["p1_home"] + out["p1_away"]
    out["p1_home_2w"] = out["p1_home"] / nt if nt > 0 else 0.5
    for L in tuple(total_lines) + tuple(extra_lines):
        key = line_key(L)
        out[f"over_{key}"] = m(tot > L)
        out[f"under_{key}"] = m(tot < L)
        out[f"push_{key}"] = m(tot == L)
    out["total_hist"] = np.bincount(np.minimum(tot, 15), weights=w, minlength=16)
    out["margin_hist"] = np.bincount(np.clip(marg + 7, 0, 14), weights=w, minlength=15)
    return out


def line_key(L) -> str:
    return f"{float(L):.1f}".replace(".", "_")


# ----------------------------------------------------------------------- prices

def american_to_decimal(a) -> float | None:
    try:
        a = float(a)
    except (TypeError, ValueError):
        return None
    if abs(a) < 100:
        return None
    return 1.0 + (a / 100.0 if a > 0 else 100.0 / -a)


def fair_american(p_win: float, p_lose: float | None = None) -> str:
    """Fair American odds of a bet that wins with ``p_win`` and loses with ``p_lose`` (default
    1 - p_win; a push returns the stake, so only the win / lose odds matter)."""
    if p_lose is None:
        p_lose = 1.0 - p_win
    if p_win <= 0 or p_lose <= 0:
        return ""
    q = p_win / (p_win + p_lose)
    if abs(q - 0.5) < 1e-12:
        return "+100"
    odds = -(q / (1 - q)) * 100 if q > 0.5 else ((1 - q) / q) * 100
    o = int(round(odds))
    if -100 < o < 100:            # rounding at the coin flip
        o = 100 if q < 0.5 else -100
    return f"+{o}" if o > 0 else f"{o}"


def ev(p_win: float, price, p_lose: float | None = None) -> float | None:
    """Expected profit per unit staked at American ``price`` (push = stake back)."""
    d = american_to_decimal(price)
    if d is None or p_win is None:
        return None
    if p_lose is None:
        p_lose = 1.0 - p_win
    return p_win * (d - 1.0) - p_lose


def devig(prices) -> list | None:
    """Multiplicative de-vig of a set of mutually exclusive prices (None if any is missing)."""
    ds = [american_to_decimal(p) for p in prices]
    if any(d is None for d in ds):
        return None
    inv = [1.0 / d for d in ds]
    s = sum(inv)
    return [x / s for x in inv]


def log_loss_multi(probs, idx) -> float:
    p = max(float(probs[idx]), 1e-9)
    return -math.log(p)
