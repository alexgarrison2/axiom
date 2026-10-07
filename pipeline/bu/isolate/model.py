"""Isolated impact: spatial multi-output ridge RAPM plus finishing and penalties (README.md).

**Window.**  A season's file is fitted on that season and the two before it, every game weighted
``0.5 ** (age_days / HALF_LIFE_DAYS)`` from the as-of date (the window's last game).

**5v5 maps.**  Every 5v5 stint (both goalies in; ``bu.rapm.stints``) gives two rows, one per
attacking side.  The target of a row is a map: the attacking side's unblocked shots binned on the
half-rink grid (``grid``), per hour.  Row weight = stint seconds x recency weight.  Columns: an
offence indicator for each attacking skater, a defence indicator for each defending skater, and
covariates from the attacking side's view - intercept, home, score state (-3..+3, tied reference),
third-period lead / trail shell, and the faceoff zone that opened the stint (O / N / D, on-the-fly
reference).  One Cholesky factorisation, one right-hand side per cell: a player's offence map is how
many more (or fewer) shots per hour his team takes from each part of the ice when he replaces an
average skater, teammates, opponents, score and zone starts held fixed.  Ridge pulls every skater to
the league average with ``LAMBDA_EV`` seconds of pseudo-time; covariates are barely penalised.  The
scalar xG/60 impact is the same regression on flurry-adjusted xG v2 (``Fit.o`` / ``Fit.d``).

**Special teams.**  5v4 stints (either side on the power play), one row per stint: the power-play
side's shots, a PP-offence column per skater, a PK-defence column per penalty killer, covariates
intercept, home, score (-2..+2) and faceoff zone, ``LAMBDA_ST``.

**Smoothing.**  Coefficient maps are smoothed afterwards (ridge is linear in the target, so this
equals smoothing every stint's shots first) with a 10 ft Gaussian and summed into 5 ft cells; a map
sums to the player's scalar shots/60 impact.

**Components** (``export.components``; goals over a standard season, ``STD_MIN``): the four xG
impacts x minutes / 60, finishing (``finishing``) and penalties drawn / taken (``penalties``).
``setting`` (teammate finishing lift) is kept for validation only: CV finds no signal.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import scipy.linalg as la
import scipy.sparse as sp

from . import grid

HALF_LIFE_DAYS = 365.0
WINDOW = 3
LAMBDA_EV = 20000.0       # seconds of league-average pseudo time; 5-fold CV by game, best for both the
LAMBDA_ST = 10000.0       # xG and the shot-rate target (README "Tuning")
LAMBDA_COV = 1.0
LAMBDA_SET = 400.0        # pseudo shots for the setting ridge
FIN_PRIOR_XG = 60.0       # bu.rapm.finishing.PRIOR_XG
VOL_PSEUDO_MIN = 300.0    # own-xG volume shrinkage (minutes at the position mean)
PEN_PSEUDO_MIN = 600.0    # penalty-rate shrinkage (minutes at the position mean)
STD_MIN = {"ev": 1000.0, "pp": 125.0, "pk": 125.0}
STD_ALL = sum(STD_MIN.values())

EV_COV = ["intercept", "home", "score_m3", "score_m2", "score_m1", "score_p1", "score_p2", "score_p3",
          "p3_lead", "p3_trail", "zone_O", "zone_N", "zone_D"]
ST_COV = ["intercept", "home", "score_m2", "score_m1", "score_p1", "score_p2", "zone_O", "zone_N", "zone_D"]
FLIP = {"O": "D", "D": "O", "N": "N"}


# ── window ─────────────────────────────────────────────────────────────────

@dataclass
class Window:
    """Stacked inputs of several seasons with per-game recency weights."""
    stints: pd.DataFrame
    shots: pd.DataFrame
    pens: pd.DataFrame
    toi: pd.DataFrame
    pos: pd.DataFrame
    rec: dict = field(default_factory=dict)     # game_id -> weight
    asof: pd.Timestamp | None = None
    seasons: tuple = ()


def recency(dates: pd.Series, asof: pd.Timestamp, half_life: float = HALF_LIFE_DAYS) -> np.ndarray:
    age = (asof - pd.to_datetime(dates)).dt.days.clip(lower=0).to_numpy(float)
    if not np.isfinite(half_life):
        return np.ones(len(age))
    return 0.5 ** (age / half_life)


def stack(parts: list[dict], seasons, asof=None, half_life: float = HALF_LIFE_DAYS) -> Window:
    """Concatenate per-season ``inputs.build`` dicts (stint indices re-based)."""
    sts, shs, off = [], [], 0
    for d in parts:
        st = d["stints"]
        sh = d["shots"].copy()
        sh["stint"] = sh["stint"] + off
        off += len(st)
        sts.append(st)
        shs.append(sh)
    st = pd.concat(sts, ignore_index=True)
    sh = pd.concat(shs, ignore_index=True)
    games = pd.concat([d["games"] for d in parts], ignore_index=True)
    asof = pd.Timestamp(asof) if asof is not None else pd.to_datetime(games["game_date"]).max()
    rec = dict(zip(games["game_id"].astype(np.int64), recency(games["game_date"], asof, half_life)))
    keep = st["game_id"].isin(rec.keys())
    if not keep.all():  # preseason / all-star rows: drop and re-index shots
        new = np.full(len(st), -1, dtype=np.int64)
        new[keep.to_numpy()] = np.arange(int(keep.sum()))
        st = st[keep].reset_index(drop=True)
        sh["stint"] = new[sh["stint"].to_numpy()]
        sh = sh[sh["stint"] >= 0].reset_index(drop=True)
    pos = pd.concat([d["pos"] for d in reversed(parts)], ignore_index=True).drop_duplicates("player_id")
    toi = pd.concat([d["toi"] for d in parts], ignore_index=True)
    pens = pd.concat([d["pens"] for d in parts], ignore_index=True)
    return Window(st, sh, pens[pens["game_id"].isin(rec.keys())], toi[toi["game_id"].isin(rec.keys())], pos, rec,
                  asof, tuple(seasons))


def _rec(win: Window, game_id) -> np.ndarray:
    return pd.Series(np.asarray(game_id, dtype=np.int64)).map(win.rec).fillna(0.0).to_numpy(float)


# ── design ─────────────────────────────────────────────────────────────────

def _flatten(lists) -> tuple[np.ndarray, np.ndarray]:
    """Object array of id arrays -> (row index, id) pairs."""
    lens = np.fromiter((len(x) for x in lists), dtype=np.int64, count=len(lists))
    ids = np.concatenate([np.asarray(x, dtype=np.int64) for x in lists]) if lens.sum() else np.zeros(0, np.int64)
    return np.repeat(np.arange(len(lists)), lens), ids


@dataclass
class Design:
    X: sp.csr_matrix
    w: np.ndarray            # row weights (seconds x recency)
    dur: np.ndarray          # row seconds
    y: np.ndarray            # scalar target: attacking xG per hour
    game_id: np.ndarray
    players: np.ndarray      # player ids (column k = offence, n + k = defence)
    cov: list
    stint_row: dict          # (stint index, attacking-is-home) -> row, as two arrays (see shot_rows)

    @property
    def n(self):
        return len(self.players)

    @property
    def p(self):
        return 2 * self.n + len(self.cov)


def _cov_block(names, diff, per, zone, is_home):
    c = np.zeros((len(diff), len(names)))
    col = {k: i for i, k in enumerate(names)}
    c[:, col["intercept"]] = 1.0
    c[:, col["home"]] = is_home
    lim = 3 if "score_m3" in col else 2
    d = np.clip(diff, -lim, lim)
    for v in range(-lim, lim + 1):
        if v:
            c[:, col[f"score_{'m' if v < 0 else 'p'}{abs(v)}"]] = d == v
    if "p3_lead" in col:
        c[:, col["p3_lead"]] = (per == 3) & (d > 0)
        c[:, col["p3_trail"]] = (per == 3) & (d < 0)
    for z in "OND":
        c[:, col[f"zone_{z}"]] = zone == z
    return c


def ev_mask5(st: pd.DataFrame) -> np.ndarray:
    return ((st["n_home_g"] == 1) & (st["n_away_g"] == 1) & (st["n_home_sk"] == 5) & (st["n_away_sk"] == 5)
            & (st["dur"] > 0)).to_numpy()


def pp_mask(st: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """(home on a 5v4 PP, away on a 5v4 PP)."""
    g = ((st["n_home_g"] == 1) & (st["n_away_g"] == 1) & (st["dur"] > 0)).to_numpy()
    h, a = st["n_home_sk"].to_numpy(), st["n_away_sk"].to_numpy()
    return g & (h == 5) & (a == 4), g & (h == 4) & (a == 5)


def build_design(win: Window, kind: str = "ev", players=None, target: str = "xgf") -> Design:
    """``kind`` 'ev' (two rows per 5v5 stint) or 'st' (one row per 5v4 stint, PP side attacking);
    ``target`` 'xgf' (flurry xG per hour) or 'sh' (unblocked shots per hour) for the scalar ``y``."""
    st = win.stints
    zone = st["zone_home"].fillna("").to_numpy()
    zone_away = np.array([FLIP.get(z, "") for z in zone], dtype=object)
    diff = st["home_diff"].to_numpy(int)
    per = st["period"].to_numpy(int)
    if kind == "ev":
        idx = np.flatnonzero(ev_mask5(st))
        sides = [(idx, True), (idx, False)]
        names = EV_COV
    else:
        hm, am = pp_mask(st)
        sides = [(np.flatnonzero(hm), True), (np.flatnonzero(am), False)]
        names = ST_COV
    # rows: all home-attacking rows, then all away-attacking rows (for 'st' the two masks are disjoint)
    blocks = []
    for ix, home_att in sides:
        att = st["home_sk"].to_numpy()[ix] if home_att else st["away_sk"].to_numpy()[ix]
        dfn = st["away_sk"].to_numpy()[ix] if home_att else st["home_sk"].to_numpy()[ix]
        sign = 1 if home_att else -1
        cov = _cov_block(names, sign * diff[ix], per[ix], zone[ix] if home_att else zone_away[ix], float(home_att))
        num = st[f"{target}_home" if home_att else f"{target}_away"].to_numpy(float)[ix]
        blocks.append((ix, home_att, att, dfn, cov, num))
    if players is None:
        ids = set()
        for b in blocks:
            for arr in (b[2], b[3]):
                ids.update(np.concatenate([np.asarray(a, np.int64) for a in arr]).tolist() if len(arr) else [])
        players = np.array(sorted(ids), dtype=np.int64)
    pos = pd.Series(np.arange(len(players)), index=players)
    n = len(players)
    rows_i, cols_i, cov_all, ys, ws, durs, gids, keys_st, keys_home = [], [], [], [], [], [], [], [], []
    base = 0
    for ix, home_att, att, dfn, cov, num in blocks:
        r_a, p_a = _flatten(att)
        r_d, p_d = _flatten(dfn)
        ka = pos.reindex(p_a).to_numpy()
        kd = pos.reindex(p_d).to_numpy()
        ma, md = ~np.isnan(ka), ~np.isnan(kd)
        rows_i += [base + r_a[ma], base + r_d[md]]
        cols_i += [ka[ma].astype(np.int64), n + kd[md].astype(np.int64)]
        cov_all.append(cov)
        dur = st["dur"].to_numpy(float)[ix]
        ys.append(num * 3600.0 / dur)
        gid = st["game_id"].to_numpy(np.int64)[ix]
        ws.append(dur * _rec(win, gid))
        durs.append(dur)
        gids.append(gid)
        keys_st.append(ix)
        keys_home.append(np.full(len(ix), home_att))
        base += len(ix)
    cov = np.vstack(cov_all)
    cr, cc = np.nonzero(cov)
    rows = np.concatenate(rows_i + [cr])
    cols = np.concatenate(cols_i + [2 * n + cc])
    data = np.concatenate([np.ones(sum(len(r) for r in rows_i)), cov[cr, cc]])
    X = sp.csr_matrix((data, (rows, cols)), shape=(base, 2 * n + len(names)))
    lookup = {"stint": np.concatenate(keys_st), "home": np.concatenate(keys_home)}
    return Design(X, np.concatenate(ws), np.concatenate(durs), np.concatenate(ys), np.concatenate(gids), players, list(names), lookup)


def shot_rows(des: Design, shots: pd.DataFrame) -> np.ndarray:
    """Design row of each shot (-1 if its stint/side is not a row of this design)."""
    key = pd.Series(np.arange(len(des.stint_row["stint"])),
                    index=pd.MultiIndex.from_arrays([des.stint_row["stint"], des.stint_row["home"]]))
    k = pd.MultiIndex.from_arrays([shots["stint"].to_numpy(np.int64), shots["acting_is_home"].to_numpy(bool)])
    return key.reindex(k).fillna(-1).to_numpy(np.int64)


# ── solver ─────────────────────────────────────────────────────────────────

def gram(X: sp.csr_matrix, w: np.ndarray) -> np.ndarray:
    Xw = sp.csr_matrix(X.multiply(w[:, None]))
    return (Xw.T @ X).toarray()


def penalty(des: Design, lam_player: float, lam_cov: float = LAMBDA_COV) -> np.ndarray:
    return np.concatenate([np.full(2 * des.n, lam_player), np.full(len(des.cov), lam_cov)])


def solve(G: np.ndarray, lam: np.ndarray, R: np.ndarray) -> np.ndarray:
    A = G.copy()
    A[np.diag_indices_from(A)] += lam
    c = la.cho_factor(A, lower=False, check_finite=False)
    return la.cho_solve(c, R, check_finite=False)


def map_rhs(des: Design, win: Window, rows: np.ndarray, shots: pd.DataFrame, weight: str = "rate") -> np.ndarray:
    """X'W Y for the raw-cell targets: sum over shots of 3600 x recency x (1 or flurry xG) in its cell."""
    ok = (rows >= 0)
    cell = grid.raw_cell(shots["x_norm"].to_numpy(float), shots["y_norm"].to_numpy(float))
    ok &= cell >= 0
    per = np.ones(len(shots)) if weight == "rate" else shots["xg_flurry"].fillna(0).to_numpy(float)
    val = 3600.0 * _rec(win, shots["game_id"].to_numpy()) * per
    H = sp.csr_matrix((val[ok], (np.arange(int(ok.sum())), cell[ok])), shape=(int(ok.sum()), grid.K_RAW))
    Xs = des.X[rows[ok]]
    return np.asarray((Xs.T @ H).todense())


def cv_lambda(des: Design, grid_lam, folds: int = 5) -> dict:
    """K-fold (by game) weighted MSE of the scalar target for each player lambda."""
    fold = (pd.util.hash_array(des.game_id.astype(np.int64)) % folds).astype(int)
    Gs, rs, yys = [], [], []
    wy = des.w * des.y
    for f in range(folds):
        m = fold == f
        Xf = des.X[m]
        Gs.append(gram(Xf, des.w[m]))
        rs.append(Xf.T @ wy[m])
        yys.append(float(np.sum(des.w[m] * des.y[m] ** 2)))
    G, r = sum(Gs), sum(rs)
    out = {}
    for lam in grid_lam:
        L = penalty(des, lam)
        loss = 0.0
        for f in range(folds):
            b = solve(G - Gs[f], L, r - rs[f])
            loss += yys[f] - 2 * b @ rs[f] + b @ Gs[f] @ b
        out[float(lam)] = loss / float(des.w.sum())
    return out


@dataclass
class Fit:
    players: np.ndarray
    o: np.ndarray            # xG/60 impacts (offence: + = more for; defence: + = more against)
    d: np.ndarray
    o_sh: np.ndarray         # unblocked shots/60 impacts (= the sums of the maps)
    d_sh: np.ndarray
    o_map: np.ndarray        # [n, NX_OUT * NY_OUT] smoothed shot-rate impact maps (shots/60 per cell)
    d_map: np.ndarray
    cov: dict                # covariate name -> xG/60 coefficient
    league: float            # league xG/60 per attacking side in this state (recency-weighted)
    league_sh: float         # league unblocked shots/60 per attacking side
    toi_o: pd.Series         # unweighted seconds per player on the attacking side (5v5 / PP)
    toi_d: pd.Series         # ... on the defending side (5v5 / PK)
    xg_o_map: np.ndarray | None = None   # optional xG-weighted maps (validation)
    xg_d_map: np.ndarray | None = None


def fit_maps(win: Window, kind: str = "ev", lam: float | None = None, xg_maps: bool = False) -> Fit:
    des = build_design(win, kind)
    lam = lam if lam is not None else (LAMBDA_EV if kind == "ev" else LAMBDA_ST)
    G = gram(des.X, des.w)
    rows = shot_rows(des, win.shots)
    R = map_rhs(des, win, rows, win.shots, "rate")
    B = solve(G, penalty(des, lam), R)
    b = solve(G, penalty(des, lam), des.X.T @ (des.w * des.y))
    n = des.n
    sh = B.sum(axis=1)
    sm = grid.smooth(B[: 2 * n])
    ic = 2 * n + des.cov.index("intercept")
    league = float(np.sum(des.w * des.y) / np.sum(des.w))
    league_sh = float(R[ic].sum() / G[ic, ic])
    occ = sp.csr_matrix((np.ones(des.X.nnz), des.X.indices, des.X.indptr), shape=des.X.shape)
    secs = occ[:, : 2 * n].T @ des.dur
    xo = xd = None
    if xg_maps:
        Bx = grid.smooth(solve(G, penalty(des, lam), map_rhs(des, win, rows, win.shots, "xg"))[: 2 * n])
        xo, xd = Bx[:n], Bx[n:]
    return Fit(des.players, b[:n], b[n: 2 * n], sh[:n], sh[n: 2 * n], sm[:n], sm[n: 2 * n],
               dict(zip(des.cov, b[2 * n:])), league, league_sh, pd.Series(secs[:n], index=des.players),
               pd.Series(secs[n:], index=des.players), xo, xd)


# ── finishing, setting, penalties ──────────────────────────────────────────

def _group(pos: pd.Series) -> pd.Series:
    return pos.map(lambda p: "D" if p == "D" else ("G" if p == "G" else "F"))


def player_toi(win: Window) -> pd.DataFrame:
    """Recency-weighted and raw seconds by state per player."""
    t = win.toi.copy()
    r = _rec(win, t["game_id"])
    out = pd.DataFrame(index=pd.Index(sorted(t["player_id"].unique()), name="player_id"))
    for c in ("all", "s5", "pp", "pk"):
        out[c] = t.groupby("player_id")[c].sum()
        out[f"{c}_w"] = (t[c] * r).groupby(t["player_id"]).sum()
    return out.fillna(0.0)


def finishing(win: Window, toi: pd.DataFrame, group: pd.Series) -> pd.DataFrame:
    """Per shooter: G, X (league-scaled, weighted), multiplier m, shrunk ixG/60 and FIN goals."""
    s = win.shots[~win.shots["empty_net_against"] & (win.shots["shooter_id"] > 0)]
    r = _rec(win, s["game_id"])
    g = (s["is_goal"].astype(float) * r).groupby(s["shooter_id"]).sum()
    x = (s["xg"].fillna(0) * r).groupby(s["shooter_id"]).sum()
    scale = float(g.sum() / x.sum()) if x.sum() > 0 else 1.0
    df = pd.DataFrame({"g": g, "x": x * scale}).reindex(toi.index).fillna(0.0)
    df["m"] = (df["g"] + FIN_PRIOR_XG) / (df["x"] + FIN_PRIOR_XG)
    mins = toi["all_w"] / 60.0
    grp = group.reindex(df.index).fillna("F")
    mu = {k: df["x"][grp == k].sum() / max(mins[grp == k].sum(), 1e-9) for k in ("F", "D")}
    mu_p = grp.map(mu).fillna(mu["F"])
    df["ixg60"] = (df["x"] + mu_p * VOL_PSEUDO_MIN) / (mins + VOL_PSEUDO_MIN) * 60.0
    df["fin60"] = (df["m"] - 1.0) * df["ixg60"]
    df["fin_goals"] = df["fin60"] * STD_ALL / 60.0
    df.attrs["scale"] = scale
    return df


def setting(win: Window, fin: pd.DataFrame, lam: float = LAMBDA_SET, folds: int = 0):
    """Ridge of (goal - scaled xG x shooter multiplier) on the shooter's on-ice teammates.

    Returns (coef per player as a Series of goals per teammate shot, teammate shots per 60 by
    state, cv dict when ``folds``)."""
    st = win.stints
    s = win.shots[~win.shots["empty_net_against"] & (win.shots["shooter_id"] > 0)].reset_index(drop=True)
    sti = s["stint"].to_numpy(np.int64)
    home = s["acting_is_home"].to_numpy(bool)
    nh, na = st["n_home_sk"].to_numpy()[sti], st["n_away_sk"].to_numpy()[sti]
    own_n = np.where(home, nh, na)
    opp_n = np.where(home, na, nh)
    gin = (st["n_home_g"].to_numpy()[sti] == 1) & (st["n_away_g"].to_numpy()[sti] == 1)
    state = np.where(gin & (own_n == 5) & (opp_n == 5), "s5", np.where(gin & (own_n == 5) & (opp_n == 4), "pp",
                     np.where(gin & (own_n == 4) & (opp_n == 5), "pk", "")))
    keep = state != ""
    s, sti, home, state = s[keep].reset_index(drop=True), sti[keep], home[keep], state[keep]
    lists = np.where(home, st["home_sk"].to_numpy()[sti], st["away_sk"].to_numpy()[sti])
    r_i, p_i = _flatten(lists)
    shooter = s["shooter_id"].to_numpy(np.int64)
    tm = p_i != shooter[r_i]
    r_i, p_i = r_i[tm], p_i[tm]
    players = np.array(sorted(set(p_i.tolist())), dtype=np.int64)
    col = pd.Series(np.arange(len(players)), index=players).reindex(p_i).to_numpy(np.int64)
    n = len(players)
    X = sp.csr_matrix((np.ones(len(r_i) + len(s)), (np.concatenate([r_i, np.arange(len(s))]),
                                                     np.concatenate([col, np.full(len(s), n)]))),
                      shape=(len(s), n + 1))
    scale = fin.attrs.get("scale", 1.0)
    m = fin["m"].reindex(shooter).fillna(1.0).to_numpy(float)
    y = s["is_goal"].to_numpy(float) - scale * s["xg"].fillna(0).to_numpy(float) * m
    w = _rec(win, s["game_id"])
    L = np.concatenate([np.full(n, lam), [1e-6]])
    G = gram(X, w)
    b = solve(G, L, X.T @ (w * y))
    # teammate shots per 60 of a skater's time, by state (league, recency-weighted)
    toi = player_toi(win)
    rate = {}
    for k in ("s5", "pp", "pk"):
        mk = state[r_i] == k
        rate[k] = float(w[r_i[mk]].sum() / max(toi[f"{k}_w"].sum() / 3600.0, 1e-9))
    cv = None
    if folds:
        fold = (pd.util.hash_array(s["game_id"].to_numpy(np.int64)) % folds).astype(int)
        Gf = [gram(X[fold == f], w[fold == f]) for f in range(folds)]
        rf = [X[fold == f].T @ (w[fold == f] * y[fold == f]) for f in range(folds)]
        yy = [float(np.sum(w[fold == f] * y[fold == f] ** 2)) for f in range(folds)]
        cv = {}
        for lv in (25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 1e9):
            Lv = np.concatenate([np.full(n, lv), [1e-6]])
            loss = 0.0
            for f in range(folds):
                bb = solve(G - Gf[f], Lv, X.T @ (w * y) - rf[f])
                loss += yy[f] - 2 * bb @ rf[f] + bb @ Gf[f] @ bb
            cv[float(lv)] = loss / float(w.sum())
    return pd.Series(b[:n], index=players), rate, cv


def minor_value(win: Window) -> float:
    """Net flurry xG of the power-play side over all 5v4 time, per minor-equivalent called."""
    st = win.stints
    hm, am = pp_mask(st)
    net = (st["xgf_home"] - st["xgf_away"]).to_numpy(float)
    total = float(net[hm].sum() - net[am].sum())
    n = float(win.pens["n"].sum())
    return total / n if n else 0.0


def penalties(win: Window, toi: pd.DataFrame, group: pd.Series, value: float) -> pd.DataFrame:
    p = win.pens
    r = _rec(win, p["game_id"])
    out = pd.DataFrame(index=toi.index)
    mins = toi["all_w"] / 60.0
    grp = group.reindex(out.index).fillna("F")
    for k, col in (("drawn", "drawn_by"), ("taken", "taken_by")):
        ok = p[col].notna()
        cnt = (p.loc[ok, "n"] * r[ok.to_numpy()]).groupby(p.loc[ok, col].astype(np.int64)).sum()
        c = cnt.reindex(out.index).fillna(0.0)
        mu = {g: c[grp == g].sum() / max(mins[grp == g].sum(), 1e-9) for g in ("F", "D")}
        mu_p = grp.map(mu).fillna(mu["F"])
        rate = (c + mu_p * PEN_PSEUDO_MIN) / (mins + PEN_PSEUDO_MIN)
        out[f"{k}60"] = rate * 60.0
        out[f"{k}60_rel"] = (rate - mu_p) * 60.0
    out["draw_goals"] = out["drawn60_rel"] * STD_ALL / 60.0 * value
    out["take_goals"] = -out["taken60_rel"] * STD_ALL / 60.0 * value
    return out
