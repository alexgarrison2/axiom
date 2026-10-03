"""One game's point-in-time inputs -> the engine's rate multipliers.

Per attacking side X against Y (features are built identically for history and live):

  ev    log E[5v5 xG]       = b0 + b . [bu_rel, bu_miss, st_off, st_def, home, b2b, b2b_opp]
  conv  log E[goals / xG]   = c0 + c . [fin_rel, st_fin, gsv, home]
  pp    log E[PP xG]        = p0 + p . [st_pp, st_pk, home]
  pen   log E[calls taken]  = q0 + q . [st_take, st_draw, home]

with, when the parameters' lineup source has a special-teams table (``lineup_source`` ``st_table``,
``prereg_st.json``), the lineup's player special teams added to the last two (``ST_GROUPS``):

  pp   + [lu_ppo, lu_pkd]     the dressed skaters' PP OFF / the opponent's PK DEF (ratings v4)
  pen  + [lu_take, lu_draw]   their penalties taken / the opponent's drawn per 60 (ratings v5)

  bu_rel   log((c0 + OFF_X + DEF_Y) / c0): the RAPM v2 lineup term's own 5v5 xGF/60 for X in
           this matchup (tonight's dressed skaters x expected EV TOI share), relative to the
           RAPM intercept; 0 when the term is unavailable (``bu_miss`` = 1)
  fin_rel  FIN_X / (c0 + OFF_X + DEF_Y): the dressed skaters' finishing (goals above xG / 60,
           share-weighted) as a fraction of their expected xGF / 60
  st_*     log of the point-in-time team state (``state.SimState``: decayed, shrunk ratios to
           the league): 5v5 offence / the opponent's 5v5 defence, PP / opponent PK, penalties
           taken / drawn by the opponent, team finishing
  gsv      log goals-per-xG multiplier of the opponent's starting goalie (shrunk)
  home     +0.5 home, -0.5 away;  b2b  the team played yesterday
  lu_*     ``bu.sim.st_lineup``: lu_ppo = ppo_X / (3600 lg_pp_xg), lu_pkd = pkd_Y / (3600 lg_pp_xg),
           lu_take = log(take_X / (3600 lg_pen)), lu_draw = log(draw_Y / (3600 lg_pen)); 0 when
           the side aggregates are unavailable

The coefficients are fitted by ``bu.sim.fit glm`` on the fit seasons.  The engine multiplies
the league's point-in-time goal rates by these multipliers (``GameRates``).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

GROUPS = {
    "ev": ["bu_rel", "bu_miss", "st_off", "st_def", "home", "b2b", "b2b_opp"],
    "conv": ["fin_rel", "st_fin", "gsv", "home"],
    "pp": ["st_pp", "st_pk", "home"],
    "pen": ["st_take", "st_draw", "home"],
}
ST_GROUPS = {"pp": ["lu_ppo", "lu_pkd"], "pen": ["lu_take", "lu_draw"]}
ALL_COLUMNS = {g: cols + ST_GROUPS.get(g, []) for g, cols in GROUPS.items()}


def groups_for(st: bool) -> dict:
    """The regression design: ``GROUPS``, plus ``ST_GROUPS`` when the lineup source has player
    special teams (``lineup_source`` ``st_table``)."""
    return {g: list(cols) + (ST_GROUPS.get(g, []) if st else []) for g, cols in GROUPS.items()}


def _log(x):
    return np.log(np.clip(np.asarray(x, dtype=float), 1e-6, None))


def side_features(g: pd.DataFrame, side: str) -> pd.DataFrame:
    """Features of the attacking side ``side`` ('h' or 'a') for every game row of ``g``.

    ``g`` columns: bu_ok, c_intercept, bu_{h,a}_{off,def,fin}, {h,a}_t_{ev_off, ev_def, pp, pk,
    take, draw, fin}, {h,a}_g_gsv (the side's OWN goalie), {h,a}_rest."""
    o = "a" if side == "h" else "h"
    ok = g["bu_ok"].astype(bool).to_numpy() if "bu_ok" in g else np.zeros(len(g), bool)
    c0 = pd.to_numeric(g.get("c_intercept"), errors="coerce").to_numpy(dtype=float) if "c_intercept" in g \
        else np.full(len(g), np.nan)
    off = pd.to_numeric(g.get(f"bu_{side}_off"), errors="coerce").to_numpy(dtype=float) if f"bu_{side}_off" in g \
        else np.full(len(g), np.nan)
    dfn = pd.to_numeric(g.get(f"bu_{o}_def"), errors="coerce").to_numpy(dtype=float) if f"bu_{o}_def" in g \
        else np.full(len(g), np.nan)
    fin = pd.to_numeric(g.get(f"bu_{side}_fin"), errors="coerce").to_numpy(dtype=float) if f"bu_{side}_fin" in g \
        else np.full(len(g), np.nan)
    ok = ok & np.isfinite(c0) & (c0 > 0) & np.isfinite(off) & np.isfinite(dfn)
    xgf = np.where(ok, c0 + np.nan_to_num(off) + np.nan_to_num(dfn), np.nan)
    ok = ok & (xgf > 0.5)
    f = pd.DataFrame(index=g.index)
    f["bu_rel"] = np.where(ok, np.log(np.where(ok, xgf, 1.0) / np.where(ok, c0, 1.0)), 0.0)
    f["bu_miss"] = (~ok).astype(float)
    f["fin_rel"] = np.where(ok & np.isfinite(fin), np.nan_to_num(fin) / np.where(ok, xgf, 1.0), 0.0)
    f["st_off"] = _log(g[f"{side}_t_ev_off"])
    f["st_def"] = _log(g[f"{o}_t_ev_def"])
    f["st_pp"] = _log(g[f"{side}_t_pp"])
    f["st_pk"] = _log(g[f"{o}_t_pk"])
    f["st_take"] = _log(g[f"{side}_t_take"])
    f["st_draw"] = _log(g[f"{o}_t_draw"])
    f["st_fin"] = _log(g[f"{side}_t_fin"])
    f["gsv"] = _log(g[f"{o}_g_gsv"])
    f["home"] = 0.5 if side == "h" else -0.5
    rest = pd.to_numeric(g.get(f"{side}_rest"), errors="coerce") if f"{side}_rest" in g else pd.Series(np.nan, index=g.index)
    orest = pd.to_numeric(g.get(f"{o}_rest"), errors="coerce") if f"{o}_rest" in g else pd.Series(np.nan, index=g.index)
    f["b2b"] = (rest == 1).astype(float).to_numpy()
    f["b2b_opp"] = (orest == 1).astype(float).to_numpy()
    from .st_lineup import side_frame
    st = side_frame(g, side)
    for c in st.columns:
        f[c] = st[c].to_numpy()
    return f


def linear(beta: dict, f: pd.DataFrame, group: str, stretch: float = 1.0) -> np.ndarray:
    """Linear predictor of a regression group.  ``stretch`` scales every team-strength term
    (all but the constant and home ice): the per-state regressions predict each state's rate
    well but miss how strongly a team's strengths in different states go together, which
    compresses simulated margins; the stretch is fitted on the fit seasons' outcomes
    (``bu.sim.validate dispersion``)."""
    b = beta[group]
    z = np.full(len(f), float(b.get("const", 0.0)))
    for c in ALL_COLUMNS[group]:
        if c not in b:          # a parameter set fitted without that term (e.g. no player ST)
            continue
        k = 1.0 if c == "home" else float(stretch)
        z = z + k * float(b.get(c, 0.0)) * f[c].to_numpy(dtype=float)
    return z


@dataclass
class GameRates:
    """Per-game engine inputs (arrays over games; index 0 = home, 1 = away on the 2-columns)."""
    L5: np.ndarray            # league 5v5 goals per score-adjusted second (point in time)
    Lpp: np.ndarray           # league power-play goals per PP second
    Lpen: np.ndarray          # league power-play-creating calls per team second
    E: np.ndarray             # (G, 2) 5v5 xG strength multiplier
    C: np.ndarray             # (G, 2) conversion multiplier (finishing x opposing goalie)
    P: np.ndarray             # (G, 2) power-play multiplier
    Q: np.ndarray             # (G, 2) penalties-taken multiplier
    playoff: np.ndarray       # bool (G,)
    so_home: np.ndarray       # P(home wins a shootout)
    tilt: np.ndarray = field(default=None)   # (G,) log tilt of home vs away goal rates (anchoring)
    pace: np.ndarray = field(default=None)   # (G,) multiplier on every goal rate (anchoring)

    def __post_init__(self):
        n = len(self.L5)
        if self.tilt is None:
            self.tilt = np.zeros(n)
        if self.pace is None:
            self.pace = np.ones(n)

    def __len__(self):
        return len(self.L5)

    def subset(self, idx) -> "GameRates":
        idx = np.atleast_1d(idx)
        return GameRates(**{k: getattr(self, k)[idx] for k in self.__dataclass_fields__})

    def with_anchor(self, tilt=None, pace=None) -> "GameRates":
        g = GameRates(**{k: np.array(getattr(self, k), copy=True) for k in self.__dataclass_fields__})
        if tilt is not None:
            g.tilt = np.broadcast_to(np.asarray(tilt, dtype=float), (len(g),)).copy()
        if pace is not None:
            g.pace = np.broadcast_to(np.asarray(pace, dtype=float), (len(g),)).copy()
        return g


def build_rates(g: pd.DataFrame, params: dict) -> GameRates:
    """GameRates for every row of ``g`` (league levels ``lg_ev_goals`` / ``lg_pp_goals`` /
    ``lg_pen`` + the side inputs ``side_features`` reads)."""
    beta = params["glm"]["beta"]
    k = float((params.get("dispersion") or {}).get("stretch", 1.0) or 1.0)
    fh, fa = side_features(g, "h"), side_features(g, "a")
    E = np.exp(np.stack([linear(beta, fh, "ev", k), linear(beta, fa, "ev", k)], axis=1))
    C = np.exp(np.stack([linear(beta, fh, "conv", k), linear(beta, fa, "conv", k)], axis=1))
    P = np.exp(np.stack([linear(beta, fh, "pp", k), linear(beta, fa, "pp", k)], axis=1))
    Q = np.exp(np.stack([linear(beta, fh, "pen", k), linear(beta, fa, "pen", k)], axis=1))
    so = float((params.get("structural") or {}).get("ot_so", {}).get("so_home", 0.5))
    gt = pd.to_numeric(g.get("game_type"), errors="coerce").fillna(2).to_numpy() if "game_type" in g \
        else np.full(len(g), 2)
    return GameRates(
        L5=pd.to_numeric(g["lg_ev_goals"], errors="coerce").to_numpy(dtype=float),
        Lpp=pd.to_numeric(g["lg_pp_goals"], errors="coerce").to_numpy(dtype=float),
        Lpen=pd.to_numeric(g["lg_pen"], errors="coerce").to_numpy(dtype=float),
        E=E, C=C, P=P, Q=Q, playoff=(gt == 3), so_home=np.full(len(g), so))


def finite_inputs(g: pd.DataFrame) -> np.ndarray:
    """Rows whose league levels and team states are all finite (else: Poisson fallback)."""
    cols = ["lg_ev_goals", "lg_pp_goals", "lg_pen"] + [f"{s}_t_{q}" for s in "ha" for q in
                                                       ("ev_off", "ev_def", "pp", "pk", "take", "draw", "fin")] \
        + ["h_g_gsv", "a_g_gsv"]
    ok = np.ones(len(g), bool)
    for c in cols:
        v = pd.to_numeric(g[c], errors="coerce").to_numpy(dtype=float) if c in g else np.full(len(g), np.nan)
        ok &= np.isfinite(v) & (v > 0)
    return ok


def logit(p):
    p = min(max(float(p), 1e-9), 1 - 1e-9)
    return math.log(p / (1 - p))
