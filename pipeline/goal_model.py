#!/usr/bin/env python3
"""
goal_model.py - one goal model behind BOTH the displayed xG and the win %.

The card used to show a heuristic xG ((xgf*xga)/league + PP%*3.5 - GSAx) next
to a win % from a different model, and they disagreed on the favourite in 18%
of games.  Now the win % is the source of truth and the goal rates are backed
out of it:

    regulation goals  H ~ Poisson(lh), A ~ Poisson(la), independent
    lh + la + OT goal = expected total T (league pace x matchup pace)
    P(home) = P(H > A) + P(H == A) * p_ot(r),   r = lh / (lh + la)
    p_ot(r) = 0.5 + OT_DECIDED_SHARE * (r - 0.5)
              (OT_DECIDED_SHARE ~ 0.69 of tied games end in 3v3 OT, where the
               next goal is won in proportion to scoring rates; the rest go to
               a shootout, a coin flip)

For a given P(home) and T there is exactly one r, found by bisection, so the
xG favourite is always the win % favourite (P(home) > 0.5 <=> lh > la).
Displayed expected goals include the expected OT goal.

``wp_breakdown`` turns additive logit terms into win-probability and xG
deltas that sum exactly to the displayed numbers (A11 'why this pick').
"""

from __future__ import annotations

import json
import math
import os

import numpy as np
from scipy.stats import poisson

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
COEFF_PATH = os.path.join(SCRIPT_DIR, 'scoring_coefficients.json')

_DEFAULTS = {
    'ot_decided_share': 0.69,   # share of tied games decided in 3v3 OT (rest: shootout)
    'total_pace_weight': 0.5,   # shrink of matchup pace toward league pace
    'total_scale': 1.0,         # multiplicative correction of the league goals/game
}
N_MAX = 15


def _coeff(name):
    try:
        with open(COEFF_PATH) as f:
            c = json.load(f)
        v = c.get(name)
        if isinstance(v, dict):
            v = v.get('value')
        return float(v) if v is not None else _DEFAULTS[name]
    except Exception:
        return _DEFAULTS[name]


def _pmf(lam):
    return poisson.pmf(np.arange(N_MAX + 1), lam)


def outcome_probs(lh, la, ot_share=None):
    """(p_home_reg, p_tie, p_away_reg, p_home_ot_given_tie)."""
    ot_share = _coeff('ot_decided_share') if ot_share is None else ot_share
    ph, pa = _pmf(lh), _pmf(la)
    joint = np.outer(ph, pa)
    p_home = float(np.tril(joint, -1).sum())
    p_tie = float(np.trace(joint))
    p_away = float(np.triu(joint, 1).sum())
    r = lh / (lh + la) if (lh + la) > 0 else 0.5
    p_ot = 0.5 + ot_share * (r - 0.5)
    return p_home, p_tie, p_away, p_ot


def win_prob(lh, la, ot_share=None):
    ph, pt, _, pot = outcome_probs(lh, la, ot_share)
    return ph + pt * pot


def expected_goals(lh, la, ot_share=None):
    """Expected goals incl. the OT goal (shootouts add none)."""
    ot_share = _coeff('ot_decided_share') if ot_share is None else ot_share
    _, pt, _, _ = outcome_probs(lh, la, ot_share)
    r = lh / (lh + la) if (lh + la) > 0 else 0.5
    return lh + pt * ot_share * r, la + pt * ot_share * (1 - r)


def _regulation_total(total, ot_share):
    """Regulation total R with R + P(tie | R) * ot_share == total (fixed point)."""
    R = total - 0.15
    for _ in range(20):
        _, pt, _, _ = outcome_probs(R / 2, R / 2, ot_share)
        R_new = total - pt * ot_share
        if abs(R_new - R) < 1e-10:
            break
        R = R_new
    return R


def goal_rates(p_home, total, ot_share=None):
    """Regulation goal rates (lh, la) consistent with P(home win) and the
    expected total (incl. OT goals).  Monotone in p_home."""
    ot_share = _coeff('ot_decided_share') if ot_share is None else ot_share
    p_home = min(max(float(p_home), 0.02), 0.98)
    R = _regulation_total(float(total), ot_share)
    lo, hi = 0.02, 0.98
    for _ in range(60):
        mid = (lo + hi) / 2
        if win_prob(R * mid, R * (1 - mid), ot_share) < p_home:
            lo = mid
        else:
            hi = mid
    r = (lo + hi) / 2
    return R * r, R * (1 - r)


def expected_total(league_gpg, pace=1.0, pace_weight=None, scale=None):
    """Expected goals in a game: league pace to date x shrunk matchup pace."""
    w = _coeff('total_pace_weight') if pace_weight is None else pace_weight
    k = _coeff('total_scale') if scale is None else scale
    return float(league_gpg) * k * (1 + w * (float(pace) - 1))


def display_xg(p_home, total, ot_share=None):
    """(home_xg, away_xg) shown on the card: goal rates implied by p_home."""
    lh, la = goal_rates(p_home, total, ot_share)
    return expected_goals(lh, la, ot_share)


def _sigmoid(z):
    return 1 / (1 + math.exp(-z))


def wp_breakdown(terms, total, market_logit=None, blend_weight=None, ot_share=None):
    """Sequential attribution of the final home win %.

    terms: ordered [(factor, label, model_logit_delta), ...] whose sum is the
           model's logit (home ice first).
    market_logit / blend_weight: when given, the final logit is
           w * model_logit + (1 - w) * market_logit, so each model term is
           scaled by w and the market contributes (1 - w) * market_logit.
    Returns (rows, final_p) where rows = [{factor, label, logit_delta,
    wp_delta_pts, xg_home_delta, xg_away_delta}] and
    50 + sum(wp_delta_pts) == 100 * final_p exactly (up to float rounding).
    """
    w = 1.0 if (market_logit is None or blend_weight is None) else float(blend_weight)
    items = [(f, lab, w * d) for f, lab, d in terms]
    if market_logit is not None and blend_weight is not None and w < 1.0:
        items.append(('market', 'Betting market', (1 - w) * float(market_logit)))
    rows = []
    z = 0.0
    p_prev = 0.5
    xh_prev, xa_prev = display_xg(0.5, total, ot_share)
    for f, lab, d in items:
        z += d
        p = _sigmoid(z)
        xh, xa = display_xg(p, total, ot_share)
        rows.append({'factor': f, 'label': lab, 'logit_delta': d,
                     'wp_delta_pts': 100 * (p - p_prev),
                     'xg_home_delta': xh - xh_prev, 'xg_away_delta': xa - xa_prev})
        p_prev, xh_prev, xa_prev = p, xh, xa
    return rows, p_prev
