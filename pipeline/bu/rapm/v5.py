"""Ratings v5: impact-only terms on top of ratings v4 (``v5_prereg.json``, ``out/v5_validation.json``).

No rating changes (EV OFF / DEF, PP / PK, SPM, FIN, TOI and the lineup / simulator inputs are v4's).
The per-game impact changes in three places, each validated walk-forward before it shipped:

* **penalty units and value** (``box.pp_units``): the goal value is the league's net PP goals per
  power-play-creating unit (coincidental minors / offsetting majors cancel, misconducts and
  washed-out delayed minors 0) of the last completed season (``box.pp_goal_value`` ``value_pp``;
  2025-26: 0.183, v4 had 0.153 per unit with coincidental penalties counted).  The rates
  (``penalty_rates``, owner amendment after the holdout look, ``v5_prereg.json``): every penalty
  (v4's units: coincidental ones are informative about a player's future power-play penalties;
  tuning / dev / holdout net-differential z 2.3 / 0.3 / 2.8 against PP-unit-only rates) rescaled per
  position group to PP-creating units (``pdu_all`` / ``pd_all`` of the same weighted sums);
* **penalty shrinkage**: drawn and taken get their own pseudo minutes (``PEN_T0``: 800 / 400,
  picked on the tuning seasons by next-30-game Poisson deviance; dev and holdout better than v4's
  400 / 400);
* **PP finishing** (``fin_pp``): PP goals above xG per 60 PP minutes from his own shots, with a
  finishing multiplier shared between EV and PP shots (``FIN_PP_VARIANT``, prior ``FIN_PP_PRIOR_XG``
  xG), times his PP minutes, added to ``off_impact`` (better next-30-game PP stint goals on dev,
  not worse on the holdout).  EV FIN stays in ``off_impact`` (tested: better on tuning, dev and
  holdout).

The weighted PP-finishing sums use the same D90 game weights as everything else: the pre-season
part (``fin_pp_pre``) is stored on the season pack's grid, this season's (``fin_pp_in``) is rolled
in by the live path.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import v3 as V
from .recency import Recency

PEN_T0 = (800.0, 400.0)             # (drawn, taken) pseudo minutes of the impact's penalty rates
PEN_UNITS = "all_scaled"            # rates of all penalties (v4 units) x the group's share that creates a PP
                                    # ("pp": PP-creating units only; "v4": v4's units and value)
FIN_PP_VARIANT = "shared"           # PP multiplier from EV + PP goals / xG
FIN_PP_PRIOR_XG = 30.0
FIN_PP_COLS = ["G_ev", "X_ev", "G_pp", "X_pp", "S_pp"]
_BOX_COLS = ["g_ev", "ixg_ev", "g_pp", "ixg_pp", "pp_s"]


def penalty_rates(sums: pd.DataFrame, groups: dict, t0=PEN_T0, units: str = PEN_UNITS):
    """(rates, fallback) of the impact's penalty term: ``rates`` = DataFrame(pd60, pt60) on ``sums``'s
    index, ``fallback`` = {grp: (drawn, taken) per 60} for players without sums.

    ``units``: 'all_scaled' (shipped, owner amendment of 2026-10-03) = every penalty in v4's units
    (``pd_all`` / ``pt_all``, coincidental ones included: they predict future power-play penalties
    better) shrunk with ``t0``, then multiplied per position group by the share of those units that
    created a power play in the same weighted sums (``pdu_all`` / ``pd_all``), so the rate is in
    power-play-creating units, the unit of ``pen_value``; 'pp' = ``pdu_all`` / ``ptu_all`` directly;
    'v4' = v4's units unscaled."""
    from . import v4 as V4
    cols = V4.PEN_COLS_V5 if units == "pp" else V4.PEN_COLS_V4
    r = V4.penalty_rates(sums, groups, t0, cols=cols)
    grp = V4._groups(sums.index, groups)
    sec = sums[V4.SEC_COLS].to_numpy(float).sum(axis=1) if len(sums) else np.zeros(0)
    fb, scale = {}, {}
    for g in ("F", "D"):
        m = grp == g
        s = sec[m].sum() if len(sec) else 0.0
        tot = {c: float(sums[c].to_numpy()[m].sum()) if len(sums) and c in sums else 0.0
               for c in V4.PEN_COLS_V4 + V4.PEN_COLS_V5}
        fb[g] = (tot[cols[0]] / s * 3600, tot[cols[1]] / s * 3600) if s > 0 else (0.0, 0.0)
        scale[g] = ((tot["pdu_all"] / tot["pd_all"] if tot["pd_all"] > 0 else 1.0,
                     tot["ptu_all"] / tot["pt_all"] if tot["pt_all"] > 0 else 1.0) if units == "all_scaled" else (1.0, 1.0))
        fb[g] = (fb[g][0] * scale[g][0], fb[g][1] * scale[g][1])
    if len(r):
        r = r.copy()
        r["pd60"] = r["pd60"].to_numpy() * np.array([scale[g][0] for g in grp])
        r["pt60"] = r["pt60"].to_numpy() * np.array([scale[g][1] for g in grp])
    return r, fb


def _sums(b: pd.DataFrame, w: np.ndarray, r_ev: float, r_pp: float) -> pd.DataFrame:
    m = np.asarray(w) > 0
    if not m.any():
        return pd.DataFrame(columns=FIN_PP_COLS, dtype=float)
    x = b.loc[m, _BOX_COLS].to_numpy(float) * np.asarray(w)[m, None]
    df = pd.DataFrame(x, columns=FIN_PP_COLS)
    df["X_ev"] *= r_ev
    df["X_pp"] *= r_pp
    df["player_id"] = b["player_id"].to_numpy()[m]
    return df.groupby("player_id")[FIN_PP_COLS].sum()


def add_fin_pp(*parts) -> pd.DataFrame:
    parts = [p for p in parts if p is not None and len(p)]
    if not parts:
        return pd.DataFrame(columns=FIN_PP_COLS, dtype=float)
    return pd.concat(parts).groupby(level=0).sum()


def fin_pp_pre(engine, S: str, g: float, rec: Recency) -> pd.DataFrame:
    """Weighted (G_ev, X_ev, G_pp, X_pp, S_pp) of every box-score game before season S at in-season
    count g; each season's ixG scaled by that season's league goals / ixG of the state."""
    L0 = engine.clock.season_start(S)
    parts = []
    for s, b in engine.box.items():
        if s >= str(S) or not len(b):
            continue
        r_ev = float(b["g_ev"].sum()) / max(float(b["ixg_ev"].sum()), 1e-9)
        r_pp = float(b["g_pp"].sum()) / max(float(b["ixg_pp"].sum()), 1e-9)
        parts.append(_sums(b, rec.weight(g + (L0 - engine._Lb[s])), r_ev, r_pp))
    return add_fin_pp(*parts)


def fin_pp_in(engine, S: str, asof, rec: Recency, league_pseudo: float = V.FIN_LEAGUE_PSEUDO) -> pd.DataFrame:
    """This season's sums as of ``asof`` (games up to d - LAG_DAYS), ixG at the running league ratio
    shrunk to 1 with ``league_pseudo`` goals (EV) and a fifth of it (PP)."""
    b = engine.box.get(str(S))
    if b is None or not len(b):
        return add_fin_pp()
    d = b["d"].to_numpy(dtype="datetime64[D]")
    cutoff = np.datetime64(asof, "D") - np.timedelta64(V.LAG_DAYS, "D")
    ok = d <= cutoff
    r_ev = (float(b["g_ev"].to_numpy()[ok].sum()) + league_pseudo) / (float(b["ixg_ev"].to_numpy()[ok].sum()) + league_pseudo)
    r_pp = (float(b["g_pp"].to_numpy()[ok].sum()) + league_pseudo / 5) / (float(b["ixg_pp"].to_numpy()[ok].sum())
                                                                          + league_pseudo / 5)
    w = np.where(ok, rec.weight(float(engine.clock.before([asof])[0]) - engine._Lb[str(S)]), 0.0)
    return _sums(b, w, r_ev, r_pp)


def interp_fin_pp(a: pd.DataFrame, b: pd.DataFrame, t: float) -> pd.DataFrame:
    if t <= 0:
        return a
    idx = a.index.union(b.index)
    return a.reindex(idx).fillna(0.0) * (1 - t) + b.reindex(idx).fillna(0.0) * t


def fin_pp_values(sums: pd.DataFrame, groups: dict, P: float = FIN_PP_PRIOR_XG,
                  variant: str = FIN_PP_VARIANT) -> pd.Series:
    """PP finishing, goals above xG per 60 PP minutes: (mult - 1) x shrunk PP ixG / 60, with
    ``mult`` = (G_pp + P) / (X_pp + P) ('own') or (G_ev + G_pp + P) / (X_ev + X_pp + P) ('shared') and
    the PP ixG rate shrunk to the position group's with ``finishing.VOL_PSEUDO_S`` seconds."""
    from .finishing import VOL_PSEUDO_S
    if not len(sums):
        return pd.Series(dtype=float)
    grp = np.array(["D" if groups.get(int(p)) == "D" else "F" for p in sums.index])
    G, X, Sp = sums["G_pp"].to_numpy(float), sums["X_pp"].to_numpy(float), sums["S_pp"].to_numpy(float)
    if variant == "own":
        mult = (G + P) / (X + P)
    elif variant == "shared":
        mult = (G + sums["G_ev"].to_numpy(float) + P) / (X + sums["X_ev"].to_numpy(float) + P)
    else:
        raise ValueError(f"unknown PP finishing variant {variant!r}")
    mu = {g_: (X[grp == g_].sum() / Sp[grp == g_].sum() if Sp[grp == g_].sum() > 0 else 0.0) for g_ in ("F", "D")}
    vol = (X + VOL_PSEUDO_S * np.array([mu[g_] for g_ in grp])) / (Sp + VOL_PSEUDO_S) * 3600.0
    return pd.Series((mult - 1.0) * vol, index=sums.index)
