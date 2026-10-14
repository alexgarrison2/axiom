"""Shared game set, simulation and paired scoring of two-arm simulator questions on the live
configuration (``prereg_pull_asof.json``, ``prereg_goalie_mix.json``).

Game set: the games of ``prereg_st.json`` (``prereg_primary`` set: regular season, finite inputs, a
walk-forward logit row (``logit_oos_B_*``, whose ``T_gm`` is goal_model's expected total), a complete
player special-teams row).  Per arm and game: the raw simulator (20,000 runs, base seed 20261002,
seed = SHA-256(base, game id)) and the same simulation anchored to (its own raw win %, T_gm), the
live derivative configuration (pairing ``sim_gm``; ``inputs_v4.simulate``).

Scores: moneyline log loss of the raw win %, the derivative score (``prereg.json``) of the anchored
simulation, paired per game (candidate - base, SE = sd / sqrt(n)), per season and pooled, plus the
distribution checks (empty-net goals a game, margins, totals) of both.
"""
from __future__ import annotations

import json
import math
import os

import numpy as np
import pandas as pd

from . import inputs_v4 as I4
from . import primary as P
from . import rates as RT
from . import validate as V


def log(*a):
    print(*a, flush=True)


def game_set(work: str, seasons, G: pd.DataFrame) -> pd.DataFrame:
    """game_id, season, home_win, T_gm of the prereg_st games of ``seasons`` (``G``: the live
    parameters' point-in-time inputs, ``history_inputs_v4_st.parquet``)."""
    years = sorted({P.season_year(s) for s in seasons})
    oos = P.logit_oos(work, years)
    act = V.actual_table(seasons)
    f = G[G["season"].astype(str).isin(seasons) & (G["game_type"] == 2) & RT.finite_inputs(G)]
    if "st_ok" in f:
        f = f[f["st_ok"].astype(bool)]
    keep = set(oos["game_id"].astype("int64")) & set(act["game_id"].astype("int64")) & set(f["game_id"].astype("int64"))
    g = oos[oos["game_id"].isin(keep)][["game_id", "T_gm"]].copy()
    g = g.merge(act[["game_id", "season", "home_win"]], on="game_id")
    g["season"] = g["season"].astype(str)
    return g.sort_values("game_id").reset_index(drop=True)


def simulate(G: pd.DataFrame, params: dict, D: pd.DataFrame, workers: int, cache: str | None = None) -> dict:
    if cache and os.path.exists(cache):
        return pd.read_pickle(cache)
    T = dict(zip(D["game_id"].astype("int64"), D["T_gm"].astype(float)))
    G = G[G["game_id"].astype("int64").isin(D["game_id"])].reset_index(drop=True)
    fr = I4.simulate(G, params, T, workers)
    if cache:
        pd.to_pickle(fr, cache)
    return fr


def _deriv_diff(La: pd.DataFrame, Lb: pd.DataFrame) -> dict:
    ga, gb = I4._deriv_game(La), I4._deriv_game(Lb)
    dd = (ga - gb.reindex(ga.index)).dropna()
    return {"diff": round(float(dd.mean()), 5), "se": round(float(dd.std(ddof=1) / math.sqrt(len(dd))), 5),
            "n": int(len(dd))}


def margin_ll(frame: pd.DataFrame, act: pd.DataFrame) -> pd.Series:
    """Per-game log P(actual final margin) under the simulated margin histogram (-7..+7 clipped)."""
    d = frame.merge(act[["game_id", "margin"]], on="game_id")
    mh = np.stack(d["margin_hist"].to_numpy())
    mi = np.clip(d["margin"].to_numpy() + 7, 0, 14)
    return pd.Series(np.log(np.clip(mh[np.arange(len(d)), mi], 1e-4, 1)), index=d["game_id"].to_numpy())


def score(D: pd.DataFrame, frames: dict, act: pd.DataFrame, seasons, arms, base: str, cand: str) -> dict:
    """Per season and pooled: each arm's ML / derivative / per-market scores and distribution checks
    (anchored and raw), and the paired cand - base differences."""
    out = {}
    for s in list(seasons) + (["pooled"] if len(seasons) > 1 else []):
        d = D if s == "pooled" else D[D["season"] == s]
        a = act[act["game_id"].isin(d["game_id"])]
        y = d["home_win"].to_numpy(float)
        rec = {"n": int(len(d))}
        p, Ls, ml_m = {}, {}, {}
        for arm in arms:
            raw = frames[arm]["raw"]
            p[arm] = raw.set_index("game_id").loc[d["game_id"], "p_home"].to_numpy(float)
            sg = frames[arm]["sim_gm"][frames[arm]["sim_gm"]["game_id"].isin(d["game_id"])]
            L = V.market_losses(sg, a)
            sm = V.summarize_losses(L)
            ml_m[arm] = margin_ll(sg, a)
            rec[arm] = {"ml": P.ml_scores(y, p[arm]), "derivative_score": sm["derivative_ll_sum"],
                        "markets": {m: {k: sm[m][k] for k in ("log_loss", "brier", "cal_slope", "cal_int") if k in sm[m]}
                                    for m in V.DERIVATIVE + ["tot60_2w"]},
                        "margin_logp": round(float(ml_m[arm].mean()), 5),
                        "distribution": V.distribution_checks(sg, a),
                        "raw_distribution": V.distribution_checks(raw[raw["game_id"].isin(d["game_id"])], a)}
            Ls[arm] = L
        for arm in arms:
            if arm == base:
                continue
            tag = f"{arm}_minus_{base}"
            rec[f"ml_{tag}"] = P.paired(y, p[arm], p[base])
            rec[f"derivative_{tag}"] = _deriv_diff(Ls[arm], Ls[base])
            rec[f"per_market_{tag}"] = V.paired(Ls[arm], Ls[base])
            dm = (ml_m[arm] - ml_m[base].reindex(ml_m[arm].index)).dropna()
            rec[f"margin_logp_{tag}"] = {"diff": round(float(dm.mean()), 5),
                                         "se": round(float(dm.std(ddof=1) / math.sqrt(len(dm))), 5), "n": int(len(dm))}
        rec["sd_logit_p"] = {arm: round(float(np.std(P.lgt(p[arm]))), 4) for arm in arms}
        out[s] = rec
    return out


def looked(question: str) -> bool:
    if not os.path.exists(V.LOOK_LOG):
        return False
    with open(V.LOOK_LOG) as f:
        return any(json.loads(l).get("question") == question and json.loads(l).get("stage") != "started"
                   for l in f if l.strip())


def log_look(entry: dict) -> None:
    with open(V.LOOK_LOG, "a") as f:
        f.write(json.dumps(entry) + "\n")


def strip(x):
    return I4._strip(x)
