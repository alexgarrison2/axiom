"""Ratings v5 validation (``v5_prereg.json``): the impact-only terms of the v4 impact.

Nothing here refits a rating.  Three families of tests, all walk-forward with the as-of points of
``v3_validate`` (0, 10, ..., 50 games per team, next 30 games; plus the whole next season from the
season-start state):

* **penalties** (``pen_rows``): the D90-weighted drawn / taken rates per 60 all-situation minutes
  (``v4.penalty_rates``) at every pseudo-minute value, scored per player and window on his next
  games' penalty units (rate x his all-situation minutes): Poisson deviance per kind, and the net
  differential (drawn - taken) squared error.  The rows keep the prediction, so any (t0_d, t0_t)
  pair and the v4 reference (v4 units, rescaled to the PP-unit level per position group) are
  compared on the same player-windows; SEs are clustered by player.
* **finishing / on-ice goals** (``goal_scores``): ``v3_validate.score`` on designs with the same
  rows, weights and covariates as the RAPM's but a goals target (``goal_designs``): EV rows with
  the attacking side's goals per 60, PP rows with the PP side's goals per 60.  A candidate is a
  coefficient vector built from the as-of v4 ratings plus an impact term (FIN, PP FIN, the
  residual on-ice goals RAPM), players fixed, covariates refit on the test rows; candidates pair
  one-to-one on rows and are compared with ``v3_validate.paired`` (date-clustered).
* **repeatability** (``repeatability``): split-half and season-to-season reliability of the
  PP-unit rates (descriptive).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import v3 as V
from . import v3_validate as VV
from . import v4 as V4
from .box import SEC_COLS
from .design import stint_rows
from .recency import Recency

PEN_T0_GRID = (50, 100, 200, 400, 800, 1600, 3200)
FIN_PP_GRID = {"variant": ("own", "shared"), "P_xg": (15, 30, 60, 120)}
RES_GRID = {"v_r": (1e-4, 3e-4, 1e-3, 3e-3), "base": ("E0", "E1")}


# ----------------------------------------------------------------------- penalties

def pen_windows(engine, S: str, horizon: float = VV.HORIZON, next_season: bool = True) -> list:
    """[(label, in-season g, as-of date, end date or None)] of season S."""
    out = []
    for g in VV.ASOF_G:
        d0 = engine.clock.date_at(S, g)
        if d0 is None:
            continue
        out.append((f"g{int(g)}", d0, engine.clock.date_at(S, g + horizon)))
    if next_season:
        out.append(("season", engine.clock.date_at(S, 0.0), None))
    return out


def pen_rows(engine, seasons, rec: Recency, t0s=PEN_T0_GRID, v4_t0: float = 400.0) -> pd.DataFrame:
    """Per (season, window, model, player): actual PP units drawn / taken in the window, predicted
    units (rate x his window minutes) and his window seconds.  ``model``: ``t<t0>`` (PP-unit rates)
    and ``v4`` (v4-unit rates at ``v4_t0``, scaled per position group by the pre-window ratio of PP
    units to v4 units, so both predict the PP-unit target at the same level)."""
    out = []
    for S in seasons:
        b = engine.box[str(S)]
        reg = b["game_id"].astype(str).str[4:6].eq("02").to_numpy()
        d = b["d"].to_numpy(dtype="datetime64[D]")
        for wl, d0, d1 in pen_windows(engine, S):
            gg = engine.clock.in_season(S, d0)
            sums = V4.add_box(engine.box_pre(S, gg, rec), engine.box_in(S, d0, rec))
            m = (d >= np.datetime64(d0, "D")) & reg
            if d1 is not None:
                m &= d < np.datetime64(d1, "D")
            test = b[m]
            if not len(test) or not len(sums):
                continue
            t = test.groupby("player_id")[["pdu_all", "ptu_all", "pd_all", "pt_all"] + SEC_COLS].sum()
            tsec = t[SEC_COLS].to_numpy(float).sum(axis=1)
            ids = t.index.to_numpy()
            grp_t = V4._groups(t.index, engine.bio.group)
            gs = V4._groups(sums.index, engine.bio.group)
            sec_all = sums[SEC_COLS].to_numpy(float).sum(axis=1)
            fb, ratio = {}, {}
            for g_ in ("F", "D"):
                mm = gs == g_
                s_ = sec_all[mm].sum()
                fb[g_] = {c: float(sums[c].to_numpy()[mm].sum()) / s_ * 3600 if s_ > 0 else 0.0
                          for c in ("pdu_all", "ptu_all", "pd_all", "pt_all")}
                ratio[g_] = (fb[g_]["pdu_all"] / fb[g_]["pd_all"] if fb[g_]["pd_all"] > 0 else 1.0,
                             fb[g_]["ptu_all"] / fb[g_]["pt_all"] if fb[g_]["pt_all"] > 0 else 1.0)

            def pred(r, cols, scale=None):
                rr = r.reindex(ids)
                res = []
                for j, (c60, col) in enumerate((("pd60", cols[0]), ("pt60", cols[1]))):
                    lam = rr[c60].to_numpy(float)
                    miss = ~np.isfinite(lam)
                    lam[miss] = [fb[g_][col] for g_ in grp_t[miss]]
                    if scale is not None:
                        lam = lam * np.array([scale[g_][j] for g_ in grp_t])
                    res.append(lam * tsec / 3600.0)
                return res

            base = {"season": S, "window": wl, "player_id": ids, "grp": grp_t, "sec": tsec,
                    "y_d": t["pdu_all"].to_numpy(float), "y_t": t["ptu_all"].to_numpy(float)}
            for t0 in t0s:
                pdx, ptx = pred(V4.penalty_rates(sums, engine.bio.group, t0, cols=V4.PEN_COLS_V5), V4.PEN_COLS_V5)
                out.append(pd.DataFrame({**base, "model": f"t{int(t0)}", "mu_d": pdx, "mu_t": ptx}))
            pdx, ptx = pred(V4.penalty_rates(sums, engine.bio.group, v4_t0, cols=V4.PEN_COLS_V4), V4.PEN_COLS_V4, ratio)
            out.append(pd.DataFrame({**base, "model": "v4", "mu_d": pdx, "mu_t": ptx}))
    return pd.concat(out, ignore_index=True)


def poisson_dev(y, mu) -> np.ndarray:
    y, mu = np.asarray(y, float), np.maximum(np.asarray(mu, float), 1e-9)
    return 2 * (np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / mu), 0.0) - (y - mu))


def pen_table(rows: pd.DataFrame, seasons, windows: str = "next30") -> pd.DataFrame:
    """Per model: deviance drawn / taken (sum), net squared error (sum), player-windows."""
    x = rows[rows["season"].isin(seasons)]
    x = x[x["window"] != "season"] if windows == "next30" else x[x["window"] == "season"]
    x = x.assign(dev_d=poisson_dev(x["y_d"], x["mu_d"]), dev_t=poisson_dev(x["y_t"], x["mu_t"]),
                 se_net=((x["y_d"] - x["y_t"]) - (x["mu_d"] - x["mu_t"])) ** 2)
    g = x.groupby("model")
    return pd.DataFrame({"dev_d": g["dev_d"].sum(), "dev_t": g["dev_t"].sum(), "net_sse": g["se_net"].sum(),
                         "n": g.size()})


def pen_combo(rows: pd.DataFrame, t0_d: float, t0_t: float, label: str | None = None) -> pd.DataFrame:
    """Rows of the (t0_d, t0_t) model (drawn from ``t<t0_d>``, taken from ``t<t0_t>``)."""
    a = rows[rows["model"] == f"t{int(t0_d)}"].reset_index(drop=True)
    b = rows[rows["model"] == f"t{int(t0_t)}"].reset_index(drop=True)
    assert len(a) == len(b) and (a["player_id"].to_numpy() == b["player_id"].to_numpy()).all()
    a = a.copy()
    a["mu_t"] = b["mu_t"].to_numpy()
    a["model"] = label or f"t{int(t0_d)}/{int(t0_t)}"
    return a


def pen_paired(rows: pd.DataFrame, a: str, b: str, seasons, windows: str = "next30", what: str = "dev") -> dict:
    """b minus a on the same player-windows (negative = b better), SE clustered by player.
    ``what``: 'dev' (drawn + taken deviance), 'dev_d', 'dev_t' or 'net' (net squared error)."""
    x = rows[rows["season"].isin(seasons)]
    x = x[x["window"] != "season"] if windows == "next30" else x[x["window"] == "season"]

    def val(z):
        if what == "net":
            return (((z["y_d"] - z["y_t"]) - (z["mu_d"] - z["mu_t"])) ** 2).to_numpy()
        dd, dt = poisson_dev(z["y_d"], z["mu_d"]), poisson_dev(z["y_t"], z["mu_t"])
        return {"dev": dd + dt, "dev_d": dd, "dev_t": dt}[what]
    xa, xb = x[x["model"] == a].reset_index(drop=True), x[x["model"] == b].reset_index(drop=True)
    assert len(xa) == len(xb) and (xa["player_id"].to_numpy() == xb["player_id"].to_numpy()).all()
    diff = pd.Series(val(xb) - val(xa)).groupby(xa["player_id"].to_numpy()).sum().to_numpy()
    tot = float(diff.sum())
    se = float(np.sqrt(len(diff)) * diff.std(ddof=1)) if len(diff) > 1 else float("nan")
    return {"delta": tot, "se": se, "z": tot / se if se > 0 else None, "n_players": int(len(diff)),
            "n_rows": int(len(xa)), "delta_per_row": tot / max(len(xa), 1)}


def repeatability(box: dict, groups: dict, min_minutes: float = 500.0) -> dict:
    """Split-half (odd / even games of a season) and season-to-season reliability of the PP-unit
    drawn / taken rates per 60 all-situation minutes, minutes-weighted; the implied empirical-Bayes
    pseudo minutes ``t0 = mean minutes x (1 - r) / r`` (r of one half, i.e. half the minutes)."""
    out = {"split_half": {}, "next_season": {}}
    per = {}
    for s, b in sorted(box.items()):
        b = b[b["game_id"].astype(str).str[4:6].eq("02")]
        sec = b[SEC_COLS].to_numpy(float).sum(axis=1)
        x = pd.DataFrame({"player_id": b["player_id"].to_numpy(), "half": (b["game_id"].to_numpy() % 2),
                          "sec": sec, "d": b["pdu_all"].to_numpy(float), "t": b["ptu_all"].to_numpy(float)})
        tot = x.groupby("player_id")[["sec", "d", "t"]].sum()
        per[s] = tot
        h = x.groupby(["player_id", "half"])[["sec", "d", "t"]].sum().unstack("half")
        h = h[(h[("sec", 0)] >= min_minutes * 30) & (h[("sec", 1)] >= min_minutes * 30)]
        r = {}
        for k in ("d", "t"):
            a = h[(k, 0)] / h[("sec", 0)] * 3600
            c = h[(k, 1)] / h[("sec", 1)] * 3600
            r[k] = float(np.corrcoef(a, c)[0, 1]) if len(h) > 10 else float("nan")
            mins = float((h[("sec", 0)] + h[("sec", 1)]).mean() / 2 / 60)
            r[f"{k}_t0_implied"] = mins * (1 - r[k]) / r[k] if r[k] > 0 else float("inf")
        r["n"] = int(len(h))
        out["split_half"][s] = r
    ss = sorted(per)
    for a, b_ in zip(ss[:-1], ss[1:]):
        A, B = per[a], per[b_]
        j = A.join(B, lsuffix="_a", rsuffix="_b", how="inner")
        j = j[(j["sec_a"] >= min_minutes * 60) & (j["sec_b"] >= min_minutes * 60)]
        r = {}
        for k in ("d", "t"):
            r[k] = float(np.corrcoef(j[f"{k}_a"] / j["sec_a"], j[f"{k}_b"] / j["sec_b"])[0, 1]) if len(j) > 10 else None
        r["n"] = int(len(j))
        out["next_season"][f"{a}->{b_}"] = r
    return out


# ----------------------------------------------------------------------- goal-target designs and scoring

def st_rows_goals(st: pd.DataFrame):
    """``v3.st_rows`` with the PP side's goals per 60 as the target (same rows, weights, covariates)."""
    from .stints import MIN_GAME_ONICE_MATCH
    att, dfn, cov, _, w, dates = V.st_rows(st)
    m = ((st["n_home_g"] == 1) & (st["n_away_g"] == 1) & (st["n_home_sk"] != st["n_away_sk"])
         & st["n_home_sk"].between(3, 5) & st["n_away_sk"].between(3, 5)
         & st["game_type"].isin([2, 3]) & (st["game_onice_match"] >= MIN_GAME_ONICE_MATCH))
    s = st[m]
    home_pp = (s["n_home_sk"] > s["n_away_sk"]).to_numpy()
    g = np.where(home_pp, s["g_home"], s["g_away"]).astype(float)
    return att, dfn, cov, g * 3600.0 / np.maximum(s["dur"].to_numpy(dtype=float), 1.0), w, dates


def goal_designs(stints: pd.DataFrame, b2b: dict, season: str) -> dict:
    """{'ev_g': EV rows on goals, 'ev_r': EV rows on goals - xG (the residual target), 'st_g': PP rows
    on goals} for one season's stints (already restricted to regular season + playoff games)."""
    from .stints import MIN_GAME_ONICE_MATCH, ev_mask
    evs = stints[ev_mask(stints) & stints["game_type"].isin([2, 3])
                 & (stints["game_onice_match"] >= MIN_GAME_ONICE_MATCH)].reset_index(drop=True)
    rx = stint_rows(evs, b2b)
    rg = stint_rows(evs, b2b, target="g")
    att, dfn, cov, yg, w, dates = st_rows_goals(stints)
    return {"ev_g": V.Design.from_rows("ev", season, rg.att, rg.dfn, rg.cov, rg.y, rg.w, rg.date),
            "ev_r": V.Design.from_rows("ev", season, rg.att, rg.dfn, rg.cov, rg.y - rx.y, rg.w, rg.date),
            "st_g": V.Design.from_rows("st", season, att, dfn, cov, yg, w, dates)}


def add_player_terms(beta: np.ndarray, des: V.Design, o_add: dict | None = None, d_add: dict | None = None):
    """``beta`` + per-player additions to the first (OFF / PP) and second (DEF / PK) blocks."""
    b = np.array(beta, dtype=float).copy()
    n = des.n
    if o_add:
        b[:n] += np.array([o_add.get(int(p), 0.0) for p in des.ids])
    if d_add:
        b[n:2 * n] += np.array([d_add.get(int(p), 0.0) for p in des.ids])
    return b


def score_rows(des: V.Design, beta: np.ndarray, m: np.ndarray, label: str, S: str, wl: str):
    sc = VV.score(des, beta, m)
    return (pd.DataFrame({"model": label, "season": S, "window": wl, "date": sc["dates"], "sse0": sc["sse0"],
                          "sse1": sc["sse1"], "sw": sc["sw"]}),
            {"model": label, "season": S, "window": wl, "S": sc["S"].tolist(), "t": sc["t"].tolist()})


# ----------------------------------------------------------------------- PP finishing

def pp_fin_sums(engine, S: str, g: float, asof, rec: Recency, league_pseudo: float = V.FIN_LEAGUE_PSEUDO) -> pd.DataFrame:
    """Per player D90-weighted (G_ev, X_ev, G_pp, X_pp, S_pp) from the box score: pre-season seasons at
    w(g + games ago at the season start), each season's ixG scaled by its league goals / ixG of the
    state; this season's games up to asof - LAG_DAYS at the running ratio shrunk with ``league_pseudo``."""
    L0 = engine.clock.season_start(S)
    parts = []
    cols = ["g_ev", "ixg_ev", "g_pp", "ixg_pp", "pp_s"]
    for s, b in engine.box.items():
        if s > str(S):
            continue
        d = b["d"].to_numpy(dtype="datetime64[D]")
        if s < str(S):
            w = rec.weight(g + (L0 - engine._Lb[s]))
            ok = np.ones(len(b), bool)
            r_ev = float(b["g_ev"].sum()) / max(float(b["ixg_ev"].sum()), 1e-9)
            r_pp = float(b["g_pp"].sum()) / max(float(b["ixg_pp"].sum()), 1e-9)
        else:
            cutoff = np.datetime64(asof, "D") - np.timedelta64(V.LAG_DAYS, "D")
            ok = d <= cutoff
            w = np.where(ok, rec.weight(float(engine.clock.before([asof])[0]) - engine._Lb[s]), 0.0)
            r_ev = (float(b["g_ev"].to_numpy()[ok].sum()) + league_pseudo) / (float(b["ixg_ev"].to_numpy()[ok].sum()) + league_pseudo)
            r_pp = (float(b["g_pp"].to_numpy()[ok].sum()) + league_pseudo / 5) / (float(b["ixg_pp"].to_numpy()[ok].sum()) + league_pseudo / 5)
        m = (w > 0) & ok
        if not m.any():
            continue
        x = b.loc[m, cols].to_numpy(float) * w[m, None]
        df = pd.DataFrame(x, columns=["G_ev", "X_ev", "G_pp", "X_pp", "S_pp"])
        df["X_ev"] *= r_ev
        df["X_pp"] *= r_pp
        df["player_id"] = b["player_id"].to_numpy()[m]
        parts.append(df.groupby("player_id").sum())
    if not parts:
        return pd.DataFrame(columns=["G_ev", "X_ev", "G_pp", "X_pp", "S_pp"], dtype=float)
    return pd.concat(parts).groupby(level=0).sum()


def fin_pp_values(sums: pd.DataFrame, groups: dict, P: float, variant: str = "own") -> pd.Series:
    """PP finishing (goals above xG per 60 PP minutes): (mult - 1) x shrunk PP ixG / 60."""
    from .finishing import VOL_PSEUDO_S
    if not len(sums):
        return pd.Series(dtype=float)
    grp = V4._groups(sums.index, groups)
    G, X, Sp = sums["G_pp"].to_numpy(float), sums["X_pp"].to_numpy(float), sums["S_pp"].to_numpy(float)
    if variant == "own":
        mult = (G + P) / (X + P)
    elif variant == "shared":
        mult = (G + sums["G_ev"].to_numpy(float) + P) / (X + sums["X_ev"].to_numpy(float) + P)
    else:
        raise ValueError(variant)
    mu = {g_: (X[grp == g_].sum() / Sp[grp == g_].sum() if Sp[grp == g_].sum() > 0 else 0.0) for g_ in ("F", "D")}
    vol = (X + VOL_PSEUDO_S * np.array([mu[g_] for g_ in grp])) / (Sp + VOL_PSEUDO_S) * 3600.0
    return pd.Series((mult - 1.0) * vol, index=sums.index)
