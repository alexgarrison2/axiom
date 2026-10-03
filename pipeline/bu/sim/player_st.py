"""Simulator special teams / penalties from the player model vs team level (``prereg_st.json``).

    cd pipeline
    python -m bu.sim.player_st dev --work <dir> --st-params <ST params.json>
    python -m bu.sim.player_st holdout --work <dir> --st-params <ST params.json>   # the single look

Arms: ``V4`` = the live parameters before the question (``out/sim_params.json`` until a promotion,
``out/sim_params_v4.json`` after it, or ``--v4-params``), ``ST`` = the parameters re-fitted with the
player special-teams table (``fit glm --st-table``, then ``validate dispersion``).  Each arm's
point-in-time inputs are ``history_inputs*.parquet`` in ``--work`` (written by ``fit glm``).

Games: those of ``prereg_inputs_v4.json`` (the ``prereg_primary`` set with finite v4 inputs) whose
ST row is complete (``st_ok``).  Per arm and game: the raw simulator (20,000 runs, the live seed)
and the same simulation anchored to (its own raw win %, goal_model's total) for the derivative
markets (``inputs_v4.simulate``).  Rule and report: ``prereg_st.json``; ``out/validation.json``
sections ``player_st_dev`` / ``player_st_holdout``; look ``question = sim_player_st``.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import inputs_v4 as I4
from . import primary as P
from . import rates as RT
from . import validate as V
from .lineup_source import has_st
from .params import OUT_DIR, PARAMS_PATH, load_params

QUESTION = "sim_player_st"
DEV = ["20232024", "20242025"]
HOLDOUT = "20252026"
PASS_MARGIN = 0.0010
ARMS = ("V4", "ST")


def log(*a):
    print(*a, flush=True)


def arm_params(st_params: str, v4_params: str | None) -> dict:
    v4_default = os.path.join(OUT_DIR, "sim_params_v4.json")
    p4 = load_params(v4_params or (v4_default if os.path.exists(v4_default) else PARAMS_PATH))
    ps = load_params(st_params)
    if has_st(p4) or (p4.get("lineup") or {}).get("name") != "v4":
        raise SystemExit("the V4 arm must be the ratings v4 simulator without player special teams")
    if not has_st(ps):
        raise SystemExit(f"{st_params} has no player special-teams table")
    if not (ps.get("dispersion") or {}).get("grid"):
        raise SystemExit(f"{st_params}: run `validate dispersion` on it first (prereg procedure)")
    return {"V4": p4, "ST": ps}


def game_set(work: str, seasons, inputs: dict):
    years = sorted({P.season_year(s) for s in seasons})
    oos = P.logit_oos(work, years)
    keep = set(oos["game_id"].astype("int64"))
    act = V.actual_table(seasons)
    keep &= set(act["game_id"].astype("int64"))
    base = set(keep)
    for arm, G in inputs.items():
        f = G[G["season"].astype(str).isin(seasons) & (G["game_type"] == 2) & RT.finite_inputs(G)]
        ids = set(f["game_id"].astype("int64"))
        base &= ids                     # the prereg_inputs_v4 set: finite under both arms
        if arm == "ST":
            ids &= set(f.loc[f["st_ok"].astype(bool), "game_id"].astype("int64"))
        keep &= ids
    g = oos[oos["game_id"].isin(keep)][["game_id", "T_gm"]].copy()
    g = g.merge(act[["game_id", "season", "home_win"]], on="game_id")
    g["season"] = g["season"].astype(str)
    log(f"[player_st] games {seasons}: {len(g)} (prereg_inputs_v4 set {len(base)}, dropped for an incomplete ST row "
        f"{len(base) - len(g)})")
    return g.sort_values("game_id").reset_index(drop=True), len(base)


def score(D: pd.DataFrame, frames: dict, act: pd.DataFrame, seasons) -> dict:
    out = {}
    for s in list(seasons) + (["pooled"] if len(seasons) > 1 else []):
        d = D if s == "pooled" else D[D["season"] == s]
        a = act[act["game_id"].isin(d["game_id"])]
        y = d["home_win"].to_numpy(float)
        rec = {"n": int(len(d))}
        p = {arm: frames[arm]["raw"].set_index("game_id").loc[d["game_id"], "p_home"].to_numpy(float) for arm in ARMS}
        Ls = {}
        for arm in ARMS:
            sg = frames[arm]["sim_gm"][frames[arm]["sim_gm"]["game_id"].isin(d["game_id"])]
            L = V.market_losses(sg, a)
            sm = V.summarize_losses(L)
            rec[arm] = {"ml": P.ml_scores(y, p[arm]), "derivative_score": sm["derivative_ll_sum"],
                        "markets": {m: {k: sm[m][k] for k in ("log_loss", "brier", "cal_slope", "cal_int") if k in sm[m]}
                                    for m in V.DERIVATIVE + ["tot60_2w"]},
                        "distribution": V.distribution_checks(sg, a),
                        "raw_distribution": V.distribution_checks(
                            frames[arm]["raw"][frames[arm]["raw"]["game_id"].isin(d["game_id"])], a)}
            Ls[arm] = L
        rec["ml_ST_minus_V4"] = P.paired(y, p["ST"], p["V4"])
        gs, g4 = I4._deriv_game(Ls["ST"]), I4._deriv_game(Ls["V4"])
        dd = (gs - g4.reindex(gs.index)).dropna()
        rec["derivative_ST_minus_V4"] = {"diff": round(float(dd.mean()), 5),
                                         "se": round(float(dd.std(ddof=1) / math.sqrt(len(dd))), 5), "n": int(len(dd))}
        rec["per_market_ST_minus_V4"] = V.paired(Ls["ST"], Ls["V4"])
        rec["corr_logit_p"] = round(float(np.corrcoef(P.lgt(p["ST"]), P.lgt(p["V4"]))[0, 1]), 4)
        rec["sd_logit_p"] = {arm: round(float(np.std(P.lgt(p[arm]))), 4) for arm in ARMS}
        out[s] = rec
    return out


def run_arms(work, seasons, st_params, v4_params, workers):
    params = arm_params(st_params, v4_params)
    inputs = {arm: V.history_inputs(work, params[arm]) for arm in ARMS}
    D, n_base = game_set(work, seasons, inputs)
    T = dict(zip(D["game_id"].astype("int64"), D["T_gm"].astype(float)))
    frames = {}
    for arm in ARMS:
        path = os.path.join(work, f"player_st_{arm}_{'_'.join(seasons)}.pkl")
        if os.path.exists(path):
            frames[arm] = pd.read_pickle(path)
            continue
        G = inputs[arm]
        G = G[G["game_id"].astype("int64").isin(D["game_id"])].reset_index(drop=True)
        t0 = time.time()
        frames[arm] = I4.simulate(G, params[arm], T, workers)
        pd.to_pickle(frames[arm], path)
        err = float(np.nanmax(np.abs(frames[arm]["sim_gm"]["anchor_p_err"])))
        log(f"[player_st] {arm} {seasons}: {len(G)} games in {time.time() - t0:.0f}s (max |anchor p err| {err:.1e})")
    return params, D, n_base, frames, V.actual_table(seasons)


def _versions(params):
    out = {}
    for arm in ARMS:
        b = params[arm]["glm"]["beta"]
        se = params[arm]["glm"].get("report", {})
        out[arm] = {"version": params[arm].get("version"), "lineup": (params[arm].get("lineup") or {}).get("name"),
                    "dispersion": {k: params[arm]["dispersion"].get(k) for k in ("stretch", "sd_tilt", "k_game", "scale")},
                    "pp": b["pp"], "pen": b["pen"],
                    "pp_se": (se.get("pp") or {}).get("se"), "pen_se": (se.get("pen") or {}).get("se")}
    return out


def cmd_dev(work, st_params, v4_params, workers):
    params, D, n_base, frames, act = run_arms(work, DEV, st_params, v4_params, workers)
    sc = score(D, frames, act, DEV)
    pooled = sc["pooled"]
    dev_ml = bool(pooled["ST"]["ml"]["log_loss"] < pooled["V4"]["ml"]["log_loss"])
    dev_deriv = bool(pooled["derivative_ST_minus_V4"]["diff"] <= 0.0)
    payload = {"prereg": "bu/sim/prereg_st.json", "seasons": DEV, "n_games": int(len(D)),
               "n_prereg_inputs_v4_games": n_base, "n_sims": I4.N_SIMS, "arms": _versions(params), "scores": sc,
               "dev_ml_pass": dev_ml, "dev_derivative_pass": dev_deriv,
               "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    V._report("player_st_dev", I4._strip(payload))
    for s, r in sc.items():
        log(f"[player_st] dev {s}: n {r['n']} ML V4 {r['V4']['ml']['log_loss']} ST {r['ST']['ml']['log_loss']} "
            f"diff {r['ml_ST_minus_V4']}; derivative V4 {r['V4']['derivative_score']} ST {r['ST']['derivative_score']} "
            f"diff {r['derivative_ST_minus_V4']}")
    log(f"[player_st] dev ML pass {dev_ml}, derivative pass {dev_deriv}")
    return payload


def _looked() -> bool:
    if not os.path.exists(V.LOOK_LOG):
        return False
    with open(V.LOOK_LOG) as f:
        return any(json.loads(l).get("question") == QUESTION and json.loads(l).get("stage") != "started"
                   for l in f if l.strip())


def cmd_holdout(work, st_params, v4_params, workers):
    rep = json.load(open(V.REPORT))
    if "player_st_dev" not in rep:
        raise SystemExit("run `dev` first")
    if _looked():
        raise SystemExit(f"the {HOLDOUT} look for '{QUESTION}' has already been made ({V.LOOK_LOG}); one look only")
    dev = rep["player_st_dev"]
    with open(V.LOOK_LOG, "a") as f:
        f.write(json.dumps({"season": HOLDOUT, "question": QUESTION, "stage": "started",
                            "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}) + "\n")
    params, D, n_base, frames, act = run_arms(work, [HOLDOUT], st_params, v4_params, workers)
    sc = score(D, frames, act, [HOLDOUT])[HOLDOUT]
    hold_ok = bool(sc["ml_ST_minus_V4"]["diff"] <= PASS_MARGIN)
    # Owner amendment A1 (prereg_st.json, before this look): the dev derivative condition is
    # replaced by "holdout derivative ST - V4 <= +1 SE".
    d_hold = sc["derivative_ST_minus_V4"]
    hold_deriv_ok = bool(d_hold["diff"] <= d_hold["se"])
    promote = bool(dev["dev_ml_pass"] and hold_ok and hold_deriv_ok)
    with open(V.LOOK_LOG, "a") as f:
        f.write(json.dumps({"season": HOLDOUT, "question": QUESTION,
                            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                            "versions": {a: params[a].get("version") for a in ARMS}, "n_games": int(len(D)),
                            "ml_ST_minus_V4": sc["ml_ST_minus_V4"], "promote_st": promote}) + "\n")
    payload = {"prereg": "bu/sim/prereg_st.json", "season": HOLDOUT, "n_games": int(len(D)),
               "n_prereg_inputs_v4_games": n_base, "n_sims": I4.N_SIMS, "arms": _versions(params), "scores": sc,
               "holdout_ml_ok": hold_ok, "holdout_derivative_ok": hold_deriv_ok, "amendment": "A1",
               "dev_ml_pass": dev["dev_ml_pass"],
               "dev_derivative_pass": dev["dev_derivative_pass"], "promote_st": promote,
               "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    V._report("player_st_holdout", I4._strip(payload))
    log(f"[player_st] holdout: n {sc['n']} ML V4 {sc['V4']['ml']['log_loss']} ST {sc['ST']['ml']['log_loss']} "
        f"diff {sc['ml_ST_minus_V4']}; derivative V4 {sc['V4']['derivative_score']} ST {sc['ST']['derivative_score']} "
        f"diff {sc['derivative_ST_minus_V4']}")
    log(f"[player_st] holdout ML ok {hold_ok} -> promote ST: {promote}")
    return payload


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bu.sim.player_st")
    ap.add_argument("cmd", choices=["dev", "holdout"])
    ap.add_argument("--work", required=True)
    ap.add_argument("--st-params", required=True)
    ap.add_argument("--v4-params", default=None,
                    help="default: out/sim_params_v4.json (the rollback file after a promotion), else out/sim_params.json")
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args(argv)
    t0 = time.time()
    (cmd_dev if a.cmd == "dev" else cmd_holdout)(a.work, a.st_params, a.v4_params, a.workers)
    log(f"[player_st] done in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
