"""Rink-side normalisation (DESIGN §2.1, §2.6).

``homeTeamDefendingSide`` is missing for 2010-11..2016-17 and for some later
games (e.g. 2018020500), so the side is inferred per (game, period) wherever
the field is absent, from a vote over every event with coordinates and a zone:

    an event by team T at x with zoneCode 'O' means T attacks the net on x's side;
    zoneCode 'D' means the opposite.  (zoneCode is always from the owner's view.)

The raw field, where present, is kept and also cross-checked against the vote
(the DQ gate reports the agreement rate).
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def _tri(v):
    """True / False / None (anything else, incl. NaN and pd.NA)."""
    if v is True or v is False:
        return v
    try:
        if v is None or v != v:  # noqa: PLR0124 - NaN check
            return None
        if isinstance(v, (bool, np.bool_)):
            return bool(v)
        if v in (0, 1):
            return bool(v)
    except TypeError:
        return None
    return None


def vote_home_attacks_right(x, zone, owner_is_home) -> tuple[int, int]:
    """(signed vote sum, n votes) that the home team attacks the +x net."""
    x = np.asarray(x, dtype="float64")
    zone = np.asarray(zone, dtype=object)
    home = np.array([_tri(h) for h in owner_is_home], dtype=object)
    known = np.array([h is not None for h in home], dtype=bool)
    ok = (~np.isnan(x)) & (x != 0) & np.isin(zone, ["O", "D"]) & known
    if not ok.any():
        return 0, 0
    sgn = np.sign(x[ok]) * np.where(zone[ok] == "O", 1, -1)
    sgn = sgn * np.where(np.array([bool(h) for h in home[ok]]), 1, -1)
    return int(sgn.sum()), int(ok.sum())


def infer_period_sides(ev: pd.DataFrame) -> pd.DataFrame:
    """Per-period side table for one game's events.

    Expects columns period, period_type, x, zone_code, event_team_is_home,
    home_def_side_raw.  Returns columns period, home_def_side_raw (mode),
    home_def_side_vote, vote_margin, n_votes, home_def_side, side_source.
    """
    rows = []
    for period, g in ev.groupby("period", sort=True):
        if (g["period_type"] == "SO").all():
            rows.append({"period": period, "home_def_side_raw": None, "home_def_side_vote": None,
                         "vote_margin": 0.0, "n_votes": 0, "home_def_side": None, "side_source": "none"})
            continue
        raw = g["home_def_side_raw"].dropna()
        raw_mode = raw.mode().iloc[0] if len(raw) else None
        s, n = vote_home_attacks_right(g["x"], g["zone_code"], g["event_team_is_home"])
        vote = None
        if n and s != 0:
            vote = "left" if s > 0 else "right"   # home attacks right => defends left
        if raw_mode in ("left", "right"):
            side, src = raw_mode, "raw"
        elif vote is not None:
            side, src = vote, "inferred"
        else:
            side, src = None, "none"
        rows.append({"period": period, "home_def_side_raw": raw_mode, "home_def_side_vote": vote,
                     "vote_margin": abs(s) / n if n else 0.0, "n_votes": n,
                     "home_def_side": side, "side_source": src})
    return pd.DataFrame(rows)


def attacks_right(team_is_home, home_def_side):
    """Vectorised: does the team attack the +x net? (None when unknown)."""
    out = []
    for h, side in zip(team_is_home, home_def_side):
        h = _tri(h)
        if side not in ("left", "right") or h is None:
            out.append(None)
            continue
        home_right = side == "left"
        out.append(home_right if h else not home_right)
    return out
