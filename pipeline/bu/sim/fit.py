"""Fit the simulator's structural parameters and team-rate models (fit seasons only).

    cd pipeline
    PONYXG_RAPM_DIR=<RAPM state with the xG v2 stints> python -m bu.sim.fit all --work <scratch dir>

Steps (each reads only the FIT seasons, 2017-18 .. 2022-23, except where a point-in-time state
needs earlier seasons as its prior; nothing reads 2023-24 or later):

  structural  goal-rate ratios of every skater / goalie state to 5v5 (regulation and 3v3 OT),
              5v5 score effects (period x score, team-season adjusted, xG v2), pulled-goalie
              curves (deficit x time remaining), penalty rates (score, period, home, state,
              kind split, coincidental 4v4), shootout home rate
  teamgames   per (game, team) counts and exposures for every lake season (data.team_games)
  hyper       decay / carry / shrinkage of the point-in-time state (next-game Poisson
              log-likelihood on the fit seasons)
  glm         Poisson regressions of per-game 5v5 xG, conversion (goals / xG), power-play xG and
              penalties on the point-in-time inputs (RAPM lineup term, FIN, team state, goalie,
              rest)
"""
from __future__ import annotations

import argparse
import json
import os
import time

import numpy as np
import pandas as pd

from . import data as D
from .params import PARAMS_PATH, save_params, load_params

FIT_SEASONS = ["20172018", "20182019", "20192020", "20202021", "20212022", "20222023"]
DEV_SEASONS = ["20232024", "20242025"]
HOLDOUT_SEASON = "20252026"
ALL_SEASONS = [f"{y}{y + 1}" for y in range(2010, 2027)]
PSEUDO_H = 2.0                     # hours of 5v5-scaled prior for rare states
PULL_BIN = 10                      # seconds
PULL_MAX = 600                     # seconds of P3 with a pull curve


def log(*a):
    print(*a, flush=True)


# ------------------------------------------------------------------------- structural

def _long(seasons):
    out = []
    for s in seasons:
        st = D.stints(s)
        lo = D.stints_long(st)
        out.append(lo[lo["game_onice_match"] >= D.MIN_ONICE_MATCH])
    return pd.concat(out, ignore_index=True)


def state_ratios(lo: pd.DataFrame) -> dict:
    """Goals per second of every attacking state relative to 5v5 (both goalies in), regulation of
    regular-season games, plus the 3v3 OT table.  Rare states are shrunk toward a fallback ratio
    with PSEUDO_H hours of 5v5-scaled exposure."""
    lo = lo[lo["game_type"] == 2]
    lo = lo.assign(key=D.state_key(lo["sk"].to_numpy(), lo["osk"].to_numpy(), lo["g"].to_numpy(),
                                   lo["og"].to_numpy()).to_numpy())
    reg, ot = lo[lo["period"] <= 3], lo[lo["period"] == 4]
    a = reg.groupby("key").agg(s=("dur", "sum"), g=("gf", "sum"), x=("xg", "sum"))
    base = a.loc["5v5_11", "g"] / a.loc["5v5_11", "s"]

    def fallback(key):
        sk, rest = key.split("v")
        osk, gg = rest.split("_")
        sk, osk, g, og = int(sk), int(osk), int(gg[0]), int(gg[1])
        if og == 0:
            return "5v6_10"
        if g == 0:
            return "6v5_01"
        if sk > osk:
            return "5v4_11"
        if sk < osk:
            return "4v5_11"
        return "5v5_11"

    ok = lambda key: all(int(x) in (3, 4, 5, 6) for x in key.split("_")[0].split("v")) and \
        all(c in "01" for c in key.split("_")[1])  # noqa: E731
    a = a[[ok(k) for k in a.index]]
    ratios = {}
    for key, r in a.iterrows():
        fb = fallback(key)
        prior = a.loc[fb, "g"] / a.loc[fb, "s"] / base if fb in a.index else 1.0
        ps = PSEUDO_H * 3600.0
        ratios[key] = float((r["g"] + prior * base * ps) / (r["s"] + ps) / base)
    ratios["5v5_11"] = 1.0
    b = ot.groupby("key").agg(s=("dur", "sum"), g=("gf", "sum"))
    b = b[[ok(k) for k in b.index]]
    ot_r = {}
    for key, r in b.iterrows():
        prior = ratios.get(key, 1.0)
        ps = PSEUDO_H * 3600.0
        ot_r[key] = float((r["g"] + prior * base * ps) / (r["s"] + ps) / base)
    hours = {k: round(float(v) / 3600, 1) for k, v in a["s"].items()}
    return {"reg": ratios, "ot": ot_r, "base_5v5_goals_per_s": float(base), "hours": hours,
            "ot_hours": {k: round(float(v) / 3600, 1) for k, v in b["s"].items()}}


def score_effects(lo: pd.DataFrame, n_iter: int = 60) -> dict:
    """5v5 xG rate multipliers by (game segment, score diff clipped +-3) from the attacking
    team's view; segments P1, P2, P3 0-10 min, P3 10-18 min, P3 last 2 min (tied teams protect
    the point late).  Poisson model xG ~ off[team-season] * def[opp-season] * home *
    s[segment, diff] * seconds (iterative proportional fitting), normalised to an
    exposure-weighted mean of 1."""
    lo = lo[(lo["game_type"] == 2) & (lo["period"] <= 3) & (lo["sk"] == 5) & (lo["osk"] == 5)
            & (lo["g"] == 1) & (lo["og"] == 1)].copy()
    lo["dc"] = lo["diff"].clip(-3, 3)
    lo["seg"] = D.segment(lo["period"].to_numpy(), lo["start_s"].to_numpy())
    c = lo.groupby(["season", "team_id", "opp_id", "is_home", "seg", "dc"]).agg(
        dur=("dur", "sum"), xg=("xg", "sum")).reset_index()
    off = pd.factorize(c["season"].astype(str) + "_" + c["team_id"].astype(str))[0]
    dfn = pd.factorize(c["season"].astype(str) + "_" + c["opp_id"].astype(str))[0]
    hm = c["is_home"].astype(int).to_numpy()
    cell = (c["seg"] * 7 + (c["dc"] + 3)).to_numpy()
    y, dur = c["xg"].to_numpy(), c["dur"].to_numpy(dtype=float)
    a, b, h, s = np.ones(off.max() + 1), np.ones(dfn.max() + 1), np.ones(2), np.ones(35)
    for _ in range(n_iter):
        a = np.bincount(off, y) / np.bincount(off, b[dfn] * h[hm] * s[cell] * dur)
        b = np.bincount(dfn, y) / np.bincount(dfn, a[off] * h[hm] * s[cell] * dur)
        h = np.bincount(hm, y) / np.bincount(hm, a[off] * b[dfn] * s[cell] * dur)
        h = h / h[0]
        s = np.bincount(cell, y, minlength=35) / np.bincount(cell, a[off] * b[dfn] * h[hm] * dur, minlength=35)
    w = np.bincount(cell, dur, minlength=35)
    s = s / ((s * w).sum() / w.sum())
    tab = {f"{g}|{d}": round(float(s[g * 7 + d + 3]), 5) for g in range(5) for d in range(-3, 4)}
    return {"table": tab, "home_xg_ratio": round(float(h[1]), 4),
            "segments": ["P1", "P2", "P3 0-10 min", "P3 10-18 min", "P3 18-20 min"],
            "note": "5v5 xG multiplier by segment|diff (attacking team's view), mean 1 over 5v5 time"}


def se_dict(se: dict) -> dict:
    return {(int(k.split("|")[0]), int(k.split("|")[1])): float(v) for k, v in se["table"].items()}


def pull_curves(lo: pd.DataFrame) -> dict:
    """P(trailing team's goalie is out | deficit d, seconds left in P3), d = 1, 2, 3+, in
    PULL_BIN-second bins over the last PULL_MAX seconds; smoothed and made unimodal (the
    simulator pulls a goalie for the interval where the curve exceeds the sim's own uniform)."""
    p3 = lo[(lo["game_type"] == 2) & (lo["period"] == 3) & (lo["end_s"] > 1200 - PULL_MAX)]
    st = np.maximum(p3["start_s"].to_numpy(), 1200 - PULL_MAX)
    en = p3["end_s"].to_numpy()
    n = np.maximum(en - st, 0)
    idx = np.repeat(np.arange(len(p3)), n)
    off = np.arange(n.sum()) - np.repeat(np.cumsum(n) - n, n)
    sec = np.repeat(st, n) + off
    d = -p3["diff"].to_numpy()[idx]
    pulled = p3["g"].to_numpy()[idx] == 0
    trem = 1200 - sec - 0.5
    b = (trem // PULL_BIN).astype(int)
    nb = PULL_MAX // PULL_BIN
    curves = {}
    for dd in (1, 2, 3):
        m = (d >= dd) if dd == 3 else (d == dd)
        tot = np.bincount(b[m], minlength=nb)[:nb].astype(float)
        on = np.bincount(b[m], weights=pulled[m].astype(float), minlength=nb)[:nb]
        f = np.where(tot > 0, on / np.maximum(tot, 1), 0.0)
        # 3-bin smoothing, then unimodal: non-decreasing from the far end to the peak, non-increasing after
        k = np.convolve(np.pad(f, 1, mode="edge"), np.ones(3) / 3, mode="valid")
        pk = int(np.argmax(k))
        left = np.minimum.accumulate(k[pk::-1])[::-1]       # bins 0..pk: non-decreasing up to the peak
        right = np.minimum.accumulate(k[pk:])               # bins pk..: non-increasing after it
        u = np.concatenate([left[:pk], right])
        u[u < 0.003] = 0.0
        curves[str(dd)] = [round(float(x), 4) for x in u]
    return {"bin_s": PULL_BIN, "max_s": PULL_MAX, "curves": curves,
            "note": "bin i covers seconds left in P3 in [i*bin_s, (i+1)*bin_s); deficits 1, 2, 3+"}


LULL_EDGES = (0, 10, 30)


def post_goal_lull(lo: pd.DataFrame) -> dict:
    """5v5 goal rate (both teams) in the seconds after a goal, relative to the rate 240+ s after
    one: the faceoff at centre ice and the line changes leave a lull the simulator reproduces as
    a hazard multiplier per phase (the main source of the per-period under-dispersion of goals)."""
    h = lo[(lo["is_home"]) & (lo["game_type"] == 2) & (lo["period"] <= 3)].sort_values(
        ["game_id", "period", "start_s"]).reset_index(drop=True)
    G = (h["gf"] + h["ga"]).to_numpy()
    t0 = ((h["period"] - 1) * 1200 + h["start_s"]).to_numpy(dtype=float)
    t1 = ((h["period"] - 1) * 1200 + h["end_s"]).to_numpy(dtype=float)
    goal_t = pd.Series(np.where(G > 0, t1, np.nan))
    last = goal_t.groupby(h["game_id"].to_numpy()).transform(lambda x: x.shift(1).ffill()).to_numpy()
    since0 = t0 - np.where(np.isnan(last), -1e7, last)
    dur = h["dur"].to_numpy(dtype=float)
    ev = ((h["sk"] == 5) & (h["osk"] == 5) & (h["g"] == 1) & (h["og"] == 1)).to_numpy()
    se_ = since0 + dur

    def rate(a, b):
        expo = np.clip(np.minimum(se_, b) - np.maximum(since0, a), 0, None)[ev].sum()
        return float((G * ((se_ > a) & (se_ <= b)))[ev].sum() / expo)
    base = rate(240, 1e9)
    phases = [[float(b), round(rate(a, b) / base, 4)] for a, b in zip(LULL_EDGES[:-1], LULL_EDGES[1:])]
    return {"phases": phases, "note": "[end second, multiplier]: goal hazards x multiplier until that many seconds after a goal"}


def penalty_params(lo: pd.DataFrame, pen: pd.DataFrame) -> dict:
    """League penalty rates: power-play-creating calls per team second of regulation, multipliers
    by the taking team's score state (clipped +-2), period, venue and current state (5v5 vs
    other), the kind split, coincidental 4v4 minors per 5v5 game second, the OT rate."""
    gt = lo.groupby("game_id")["game_type"].first()
    lo = lo[lo["game_type"] == 2]
    pen = pen[pen["game_id"].map(gt) == 2]
    reg = lo[lo["period"] <= 3].assign(dc=lambda x: x["diff"].clip(-2, 2))
    pr = pen[(pen["period"] <= 3) & (pen["kind"] != "c44")].assign(dc=lambda x: x["diff"].clip(-2, 2))
    base = len(pr) / reg["dur"].sum()
    by_d = (pr.groupby("dc").size() / reg.groupby("dc")["dur"].sum()) / base
    by_p = (pr.groupby("period").size() / reg.groupby("period")["dur"].sum()) / base
    by_h = (pr.groupby("is_home").size() / reg.groupby("is_home")["dur"].sum()) / base
    five = (reg["sk"] == 5) & (reg["osk"] == 5) & (reg["g"] == 1) & (reg["og"] == 1)
    s5, sn = reg.loc[five, "dur"].sum(), reg.loc[~five, "dur"].sum()
    r5, rn = pr["state5"].sum() / s5, (~pr["state5"]).sum() / sn
    kinds = pr["kind"].value_counts(normalize=True)
    c44 = pen[(pen["kind"] == "c44") & (pen["period"] <= 3)]
    ot = lo[lo["period"] == 4]
    po = pen[(pen["period"] == 4) & (pen["kind"] != "c44")]
    return {
        "per_team_s": float(base),
        "score": {str(int(k)): round(float(v), 4) for k, v in by_d.items()},
        "period": {str(int(k)): round(float(v), 4) for k, v in by_p.items()},
        "home": round(float(by_h.get(True, 1.0)), 4), "away": round(float(by_h.get(False, 1.0)), 4),
        "state5": round(float(r5 / base), 4), "state_other": round(float(rn / base), 4),
        "kinds": {k: round(float(kinds.get(k, 0.0)), 5) for k in ("minor", "double", "major")},
        "c44_per_5v5_game_s": float(len(c44) / (s5 / 2.0)),
        "ot_mult": round(float((len(po) / ot["dur"].sum()) / base), 4) if ot["dur"].sum() > 0 else 0.7,
    }


def ot_so_params(seasons) -> dict:
    o = pd.concat([D.outcomes(s) for s in seasons], ignore_index=True)
    o = o[o["game_type"] == 2]
    so = o[o["decision"] == "SO"]
    tied = (o["reg_h"] == o["reg_a"]).sum()
    return {"so_home": round(float(so["home_win"].mean()), 4), "so_n": int(len(so)),
            "ot_decided_share_obs": round(float((o["decision"] == "OT").sum() / max(tied, 1)), 4),
            "tie_rate_obs": round(float(tied / len(o)), 4)}


def structural(seasons=FIT_SEASONS) -> dict:
    t0 = time.time()
    lo = _long(seasons)
    log(f"[fit] {len(lo):,} stint rows from {len(seasons)} seasons ({time.time() - t0:.0f}s)")
    pen = pd.concat([D.penalties(s) for s in seasons], ignore_index=True)
    out = {"fit_seasons": list(seasons), "states": state_ratios(lo), "score_effects": score_effects(lo),
           "pulls": pull_curves(lo), "penalties": penalty_params(lo, pen), "ot_so": ot_so_params(seasons),
           "lull": post_goal_lull(lo)}
    log(f"[fit] structural done ({time.time() - t0:.0f}s)")
    return out


# ------------------------------------------------------------------------- team games

def build_team_games(seasons, se: dict, work: str) -> pd.DataFrame:
    os.makedirs(work, exist_ok=True)
    frames = []
    for s in seasons:
        p = os.path.join(work, f"team_games_{s}.parquet")
        if os.path.exists(p):
            frames.append(pd.read_parquet(p))
            continue
        t0 = time.time()
        st = D.stints(s)
        tg = D.team_games(st, D.penalties(s), se)
        tg.to_parquet(p, index=False)
        frames.append(tg)
        log(f"[fit] team games {s}: {len(tg)} rows ({time.time() - t0:.0f}s)")
    return pd.concat(frames, ignore_index=True).sort_values(["game_date", "game_id", "is_home"]).reset_index(drop=True)


# ------------------------------------------------------------------------- state hyper-parameters

K_GRID = {
    "ev": [2500, 5000, 10000, 20000, 40000, 80000, 160000],
    "pp": [500, 1000, 2000, 4000, 8000, 16000, 32000],
    "pen": [10000, 20000, 40000, 80000, 160000, 320000, 640000],
    "fin": [25, 50, 100, 200, 400, 800, 1600, 3200],
    "gsv": [25, 50, 100, 200, 400, 800, 1600],
}


def _pll(y, mu):
    mu = np.maximum(mu, 1e-12)
    return float(np.sum(y * np.log(mu) - mu))


def _score_quantities(tg: pd.DataFrame, S: pd.DataFrame, mask) -> dict:
    """Next-game Poisson log-likelihood of each quantity for every shrinkage on its grid."""
    from .history import rel
    t = tg.reset_index(drop=True)[mask]
    s = S.reset_index(drop=True)[mask]
    out = {}
    out["ev"] = {k: _pll(t["ev_xg"].to_numpy(), (rel(s["t_ev_xg"], s["t_ev_adj"], k, s["lg_ev_xg"])
                                                 * rel(s["o_ev_xga"], s["o_ev_adj_a"], k, s["lg_ev_xg"])
                                                 * s["lg_ev_xg"] * t["ev_adj"]).to_numpy())
                 for k in K_GRID["ev"]}
    out["pp"] = {k: _pll(t["pp_xg"].to_numpy(), (rel(s["t_pp_xg"], s["t_pp_s"], k, s["lg_pp_xg"])
                                                 * rel(s["o_pk_xga"], s["o_pk_s"], k, s["lg_pp_xg"])
                                                 * s["lg_pp_xg"] * t["pp_s"]).to_numpy())
                 for k in K_GRID["pp"]}
    out["pen"] = {k: _pll(t["pen_taken"].to_numpy(), (rel(s["t_pen_taken"], s["t_game_s"], k, s["lg_pen"])
                                                      * rel(s["o_pen_drawn"], s["o_game_s"], k, s["lg_pen"])
                                                      * s["lg_pen"] * t["game_s"]).to_numpy())
                  for k in K_GRID["pen"]}
    fin_best = {}
    for kf in K_GRID["fin"]:
        for kg in K_GRID["gsv"]:
            mu = (rel(s["t_gf_vg"], s["t_xg_vg"], kf, s["lg_fin"]) * rel(s["og_ga_og"], s["og_xga_og"], kg, s["lg_gsv"])
                  * s["lg_fin"] * t["xg_vg"]).to_numpy()
            fin_best[(kf, kg)] = _pll(t["gf_vg"].to_numpy(), mu)
    out["fin_gsv"] = fin_best
    return out


def tune_state(tg: pd.DataFrame, seasons=FIT_SEASONS) -> dict:
    """Grid search of the state's decay (half-life in team games) and season carry on the fit
    seasons' regular-season games; shrinkage k per quantity picked on the same likelihood."""
    from .history import asof_sums
    from .state import DEFAULT_HYPER
    mask = (tg["season"].astype(str).isin(seasons) & (tg["game_type"] == 2)).to_numpy()
    res, best = [], None
    for hl in (15.0, 30.0, 60.0, 120.0):
        for carry in (0.5, 0.7, 0.9):
            h = {"half_life": hl, "carry": carry}
            S = asof_sums(tg, h)
            sc = _score_quantities(tg, S, mask)
            row = {"half_life": hl, "carry": carry, "ev": max(sc["ev"].values()), "pp": max(sc["pp"].values()),
                   "pen": max(sc["pen"].values()), "k_ev": max(sc["ev"], key=sc["ev"].get),
                   "k_pp": max(sc["pp"], key=sc["pp"].get), "k_pen": max(sc["pen"], key=sc["pen"].get)}
            row["total"] = row["ev"] + row["pp"] + row["pen"]
            res.append(row)
            log(f"[tune] team hl {hl:.0f} carry {carry}: ev {row['ev']:.1f} (k {row['k_ev']}) pp {row['pp']:.1f} "
                f"(k {row['k_pp']}) pen {row['pen']:.1f} (k {row['k_pen']})")
            if best is None or row["total"] > best["total"]:
                best = row
    gres, gbest = [], None
    for hl in (15.0, 30.0, 60.0, 120.0):
        for carry in (0.7, 0.85, 1.0):
            h = {"half_life": best["half_life"], "carry": best["carry"], "goalie_half_life": hl, "goalie_carry": carry}
            S = asof_sums(tg, h)
            sc = _score_quantities(tg, S, mask)["fin_gsv"]
            kk = max(sc, key=sc.get)
            row = {"goalie_half_life": hl, "goalie_carry": carry, "ll": sc[kk], "k_fin": kk[0], "k_gsv": kk[1],
                   "ll_no_goalie": max(v for (a, b), v in sc.items() if b == max(K_GRID["gsv"]))}
            gres.append(row)
            log(f"[tune] goalie hl {hl:.0f} carry {carry}: ll {row['ll']:.1f} k_fin {kk[0]} k_gsv {kk[1]}")
            if gbest is None or row["ll"] > gbest["ll"]:
                gbest = row
    hyper = json.loads(json.dumps(DEFAULT_HYPER))
    hyper.update({"half_life": best["half_life"], "carry": best["carry"],
                  "goalie_half_life": gbest["goalie_half_life"], "goalie_carry": gbest["goalie_carry"]})
    hyper["k"].update({"ev_off": best["k_ev"], "ev_def": best["k_ev"], "pp": best["k_pp"], "pk": best["k_pp"],
                       "take": best["k_pen"], "draw": best["k_pen"], "fin": gbest["k_fin"], "gsv": gbest["k_gsv"]})
    return {"hyper": hyper, "grid_team": res, "grid_goalie": gres, "seasons": list(seasons),
            "criterion": "next-game Poisson log-likelihood, regular season of the fit seasons"}


# ------------------------------------------------------------------------- per-game regressions

def poisson_glm(X: np.ndarray, y: np.ndarray, offset: np.ndarray, l2: float = 1e-4, iters: int = 50):
    """Poisson (quasi-likelihood for xG) regression with an offset, IRLS; column 0 = constant
    (not penalised).  Returns (beta, se)."""
    n, k = X.shape
    b = np.zeros(k)
    b[0] = np.log(max(y.sum(), 1e-9) / np.exp(offset).sum())
    pen = np.full(k, l2 * n)
    pen[0] = 0.0
    for _ in range(iters):
        eta = offset + X @ b
        mu = np.exp(eta)
        W = mu
        z = (eta - offset) + (y - mu) / np.maximum(mu, 1e-12)
        A = X.T @ (X * W[:, None]) + np.diag(pen)
        nb = np.linalg.solve(A, X.T @ (W * z))
        if np.max(np.abs(nb - b)) < 1e-9:
            b = nb
            break
        b = nb
    mu = np.exp(offset + X @ b)
    phi = float(np.sum((y - mu) ** 2 / np.maximum(mu, 1e-12)) / max(n - k, 1))   # quasi-Poisson dispersion
    cov = np.linalg.inv(X.T @ (X * mu[:, None]) + np.diag(pen)) * phi
    return b, np.sqrt(np.diag(cov)), phi


def history_table(tg: pd.DataFrame, hyper: dict, lineup: pd.DataFrame | None = None) -> pd.DataFrame:
    """Per-game point-in-time inputs (history.game_inputs) for every lake game; ``lineup``: a
    lineup source's history table (``lineup_source.history_table``; default RAPM v2)."""
    from .history import asof_sums, game_inputs, team_rels
    S = asof_sums(tg, hyper)
    return game_inputs(tg, team_rels(S, hyper), lineup=lineup)


def glm_design(tg: pd.DataFrame, G: pd.DataFrame, seasons) -> dict:
    """Per attacking team-game: features + targets + offsets for every regression group."""
    from .rates import side_features
    G = G[G["season"].astype(str).isin(seasons) & (G["game_type"] == 2)].reset_index(drop=True)
    parts = []
    for side, is_home in (("h", True), ("a", False)):
        f = side_features(G, side)
        f["game_id"] = G["game_id"].to_numpy()
        f["lg_ev_xg"], f["lg_fin"] = G["lg_ev_xg"].to_numpy(), G["lg_fin"].to_numpy()
        f["lg_pp_xg"], f["lg_pen"] = G["lg_pp_xg"].to_numpy(), G["lg_pen"].to_numpy()
        f["is_home"] = is_home
        parts.append(f)
    F = pd.concat(parts, ignore_index=True)
    F = F.merge(tg[["game_id", "is_home", "ev_xg", "ev_adj", "xg_vg", "gf_vg", "pp_xg", "pp_s", "pen_taken",
                    "game_s"]], on=["game_id", "is_home"], how="inner")
    return F


def fit_glms(F: pd.DataFrame) -> dict:
    from .rates import GROUPS
    specs = {
        "ev": ("ev_xg", lambda d: np.log(d["ev_adj"] * d["lg_ev_xg"]), lambda d: d["ev_adj"] > 0),
        "conv": ("gf_vg", lambda d: np.log(d["xg_vg"] * d["lg_fin"]), lambda d: d["xg_vg"] > 0),
        "pp": ("pp_xg", lambda d: np.log(d["pp_s"] * d["lg_pp_xg"]), lambda d: d["pp_s"] > 0),
        "pen": ("pen_taken", lambda d: np.log(d["game_s"] * d["lg_pen"]), lambda d: d["game_s"] > 0),
    }
    beta, report = {}, {}
    for g, (ycol, off_fn, m_fn) in specs.items():
        d = F[m_fn(F)].reset_index(drop=True)
        cols = GROUPS[g]
        X = np.column_stack([np.ones(len(d))] + [d[c].to_numpy(dtype=float) for c in cols])
        y = d[ycol].to_numpy(dtype=float)
        b, se, phi = poisson_glm(X, y, off_fn(d).to_numpy(dtype=float))
        beta[g] = {"const": round(float(b[0]), 6), **{c: round(float(v), 6) for c, v in zip(cols, b[1:])}}
        report[g] = {"n": int(len(d)), "dispersion": round(phi, 3),
                     "se": {"const": round(float(se[0]), 5), **{c: round(float(v), 5) for c, v in zip(cols, se[1:])}}}
        log(f"[glm] {g}: n {len(d)} phi {phi:.2f} " + " ".join(f"{c}={beta[g][c]:+.3f}({report[g]['se'][c]:.3f})"
                                                                 for c in ["const"] + cols))
    return {"beta": beta, "report": report}


# ------------------------------------------------------------------------- season pack

def build_pack(tg: pd.DataFrame, hyper: dict, season: str) -> "SimState":
    """Season-start state for ``season``: every lake game of earlier seasons (regular season and
    playoffs) replayed through the tuned state, plus the goalie name map (lake rosters) the live
    path resolves DailyFaceoff / gamestats names with."""
    from bu.lake.build import read_table
    from .state import SimState, norm_name, replay
    prior = tg[tg["season"].astype(str) < str(season)]
    st = replay(prior, SimState(hyper))
    st.roll(str(season))
    pl = read_table(D.lake(), "players", None, columns=["season", "player_id", "full_name", "position"])
    pl = pl[pl["position"].astype(str) == "G"].sort_values("season")
    st.goalie_names = {norm_name(n): f"id:{int(p)}" for n, p in zip(pl["full_name"], pl["player_id"]) if n}
    return st


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bu.sim.fit")
    ap.add_argument("step", choices=["structural", "teamgames", "hyper", "glm", "pack", "all"])
    ap.add_argument("--season", default=None, help="pack: the season the pack starts (default: current)")
    ap.add_argument("--work", required=True, help="scratch dir for caches")
    ap.add_argument("--lineup-table", default=None,
                    help="glm: a new lineup source's history table (lineup_source.REQUIRED columns)")
    ap.add_argument("--lineup-bundle", default=None, help="glm: that source's serving bundle (LiveLineupTerm)")
    ap.add_argument("--lineup-name", default=None, help="glm: short name of the source (e.g. v4)")
    ap.add_argument("--lineup-ratings", default=None,
                    help="glm: the bundle's ratings table the live term reads (v2 / v3 / v4; default: the "
                         "name when it is v3 / v4, else v2)")
    ap.add_argument("--params-out", default=None, help="write the parameters here instead of out/sim_params.json")
    args = ap.parse_args(argv)
    if args.step in ("structural", "all"):
        p = load_params(missing_ok=True) or {}
        p["structural"] = structural()
        save_params(p)
        log(f"[fit] wrote {PARAMS_PATH}")
    if args.step in ("teamgames", "all"):
        p = load_params()
        build_team_games(ALL_SEASONS, se_dict(p["structural"]["score_effects"]), args.work)
    if args.step in ("hyper", "all"):
        p = load_params()
        tg = build_team_games(ALL_SEASONS, se_dict(p["structural"]["score_effects"]), args.work)
        p["state"] = tune_state(tg)
        save_params(p)
        log(f"[fit] state hyper: {p['state']['hyper']}")
    if args.step in ("glm", "all"):
        from . import lineup_source as LS
        p = load_params()
        src = LS.spec(p)
        if args.lineup_table:     # a new ratings source: refit the regressions on it
            name = args.lineup_name or "custom"
            src = {"name": name, "history_table": args.lineup_table,
                   "serving_bundle": args.lineup_bundle or LS.DEFAULT["serving_bundle"],
                   "ratings": args.lineup_ratings or (name if name in ("v3", "v4") else "v2")}
            p["lineup"] = src
            p["version"] = f"sim-m5-{src['name']}-{time.strftime('%Y%m%d')}"
        tg = build_team_games(ALL_SEASONS, se_dict(p["structural"]["score_effects"]), args.work)
        G = history_table(tg, p["state"]["hyper"], lineup=LS.history_table(src))
        G.to_parquet(os.path.join(args.work, LS.history_inputs_name(p)), index=False)
        F = glm_design(tg, G, FIT_SEASONS)
        p["glm"] = {**fit_glms(F), "seasons": FIT_SEASONS, "lineup_source": src["name"]}
        save_params(p, args.params_out)
        log(f"[fit] glm on lineup source {src['name']} -> {args.params_out or PARAMS_PATH}")
    if args.step in ("pack", "all"):
        from season import SEASON_ID
        from .params import state_pack_path
        p = load_params()
        season = args.season or SEASON_ID
        tg = build_team_games(ALL_SEASONS, se_dict(p["structural"]["score_effects"]), args.work)
        st = build_pack(tg, p["state"]["hyper"], season)
        path = st.save(state_pack_path(season))
        log(f"[fit] state pack {season}: {len(st.team)} teams, {len(st.goalie)} goalies, through "
            f"{st.max_date.date()} -> {path} ({os.path.getsize(path) // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
