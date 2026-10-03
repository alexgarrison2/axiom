"""Simulator lineup inputs: ratings v4 vs RAPM v2 (``prereg_inputs_v4.json``).

    cd pipeline
    python -m bu.sim.inputs_v4 dev --work <dir> --v4-params <v4 params.json>
    python -m bu.sim.inputs_v4 holdout --work <dir> --v4-params <v4 params.json>   # the single look

Arms: ``V2`` = the live parameters (``out/sim_params.json`` at the time of the run, or
``--v2-params``), ``V4`` = the parameters re-fitted on the v4 inputs (``fit glm --lineup-name v4``
then ``validate dispersion``).  Each arm's point-in-time inputs are ``history_inputs*.parquet`` in
``--work`` (written by ``fit glm``).

Games: those of ``prereg_primary.json`` (regular season, finite v2 inputs, a walk-forward logit row:
``logit_oos_B_*.parquet`` of ``bu.sim.primary``, whose ``T_gm`` is goal_model's expected total), also
finite under the v4 inputs.  Per arm and game: the raw simulator (20,000 runs, the live seed) and
the same simulation anchored to (its own raw win %, T_gm) for the derivative markets.

Rule: V4 passes iff dev pooled ML log loss is lower, holdout ML diff <= +0.0010 and dev pooled
derivative score not worse.  Report: ``out/validation.json`` sections ``inputs_v4_dev`` /
``inputs_v4_holdout``; holdout look in ``out/look_log.jsonl`` (``question = sim_inputs_v4``).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import time
from datetime import datetime, timezone
from multiprocessing import get_context

import numpy as np
import pandas as pd

from . import anchor as AN
from . import engine as EN
from . import markets as MK
from . import primary as P
from . import rates as RT
from . import validate as V
from .params import PARAMS_PATH, load_params

HERE = os.path.dirname(os.path.abspath(__file__))
PREREG = os.path.join(HERE, "prereg_inputs_v4.json")
QUESTION = "sim_inputs_v4"
DEV = ["20232024", "20242025"]
HOLDOUT = "20252026"
N_SIMS = 20000
SEED = 20261002
PASS_MARGIN = 0.0010
ARMS = ("V2", "V4")


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------------------- simulation

_W = {}


def _init(params):
    _W["params"] = params
    _W["S"] = EN.Structure(params["structural"], params.get("dispersion"))


def _work(task):
    rows, n, seed, tgm = task
    params, S = _W["params"], _W["S"]
    g = pd.DataFrame(rows)
    R = RT.build_rates(g, params)
    out = []
    for i in range(len(g)):
        gid = int(g["game_id"].iloc[i])
        sd = EN.game_seed(seed, gid)
        o = EN.simulate_game(R, i, S, n, sd)
        raw = V._summ(MK.summarize(o))
        o2, w, info = AN.anchor_game(R, i, S, n, sd, raw["p_home"], tgm[i], o=o)
        anc = V._summ(MK.summarize(o2, w=w))
        anc["anchor_p_err"], anc["anchor_t_err"] = info["p_err"], info["t_err"]
        out.append({"game_id": gid, "raw": raw, "sim_gm": anc})
    return out


def simulate(G: pd.DataFrame, params: dict, T: dict, workers: int, n=N_SIMS, chunk=30) -> dict:
    cols = list(G.columns)
    tasks = []
    for s in range(0, len(G), chunk):
        sub = G.iloc[s:s + chunk]
        tasks.append((sub[cols].to_dict("records"), n, SEED, [T[int(x)] for x in sub["game_id"]]))
    with get_context("fork").Pool(workers, initializer=_init, initargs=(params,)) as pool:
        res = [r for part in pool.map(_work, tasks) for r in part]
    return {k: V.to_frame(res, k) for k in ("raw", "sim_gm")}


# ---------------------------------------------------------------------------- games

def game_set(work: str, seasons, inputs: dict) -> pd.DataFrame:
    """game_id, season, T_gm of the prereg_primary games of ``seasons`` that have finite inputs
    under every arm (``inputs``: arm -> point-in-time inputs)."""
    years = sorted({P.season_year(s) for s in seasons})
    oos = P.logit_oos(work, years)                    # cached logit_oos_B_<years>.parquet
    keep = set(oos["game_id"].astype("int64"))
    base = None
    for arm, G in inputs.items():
        f = G[G["season"].astype(str).isin(seasons) & (G["game_type"] == 2) & RT.finite_inputs(G)]
        ids = set(f["game_id"].astype("int64"))
        if arm == "V2":
            base = keep & ids                         # = prereg_primary's game set
        keep &= ids
    act = V.actual_table(seasons)
    keep &= set(act["game_id"].astype("int64"))
    base &= set(act["game_id"].astype("int64"))
    g = oos[oos["game_id"].isin(keep)][["game_id", "T_gm"]].copy()
    g = g.merge(act[["game_id", "season", "home_win"]], on="game_id")
    g["season"] = g["season"].astype(str)
    log(f"[inputs_v4] games {seasons}: {len(g)} (prereg_primary set {len(base)}, "
        f"dropped for non-finite v4 inputs {len(base) - len(g)})")
    return g.sort_values("game_id").reset_index(drop=True), len(base)


def arm_params(v4_params: str, v2_params: str | None) -> dict:
    p2 = load_params(v2_params or PARAMS_PATH)
    p4 = load_params(v4_params)
    if (p4.get("lineup") or {}).get("name") != "v4":
        raise SystemExit(f"{v4_params} is not a v4 lineup-source parameter set")
    if not (p4.get("dispersion") or {}).get("grid"):
        raise SystemExit(f"{v4_params}: run `validate dispersion` on it first (prereg procedure)")
    return {"V2": p2, "V4": p4}


# ---------------------------------------------------------------------------- scoring

def _deriv_game(L: pd.DataFrame) -> pd.Series:
    """Per-game derivative contribution whose mean is the derivative score (each market's ll
    scaled by n / n_market, so markets scored on a subset - p1_2w - keep their weight)."""
    n = len(L)
    tot = np.zeros(n)
    for m in V.DERIVATIVE:
        x = L[f"{m}_ll"].to_numpy(float)
        ok = np.isfinite(x)
        tot += np.where(ok, x, 0.0) * (n / max(int(ok.sum()), 1))
    return pd.Series(tot, index=L["game_id"].to_numpy())


def score(D: pd.DataFrame, frames: dict, act: pd.DataFrame, seasons) -> dict:
    out = {}
    for s in list(seasons) + (["pooled"] if len(seasons) > 1 else []):
        d = D if s == "pooled" else D[D["season"] == s]
        a = act[act["game_id"].isin(d["game_id"])]
        y = d["home_win"].to_numpy(float)
        rec = {"n": int(len(d))}
        p = {arm: frames[arm]["raw"].set_index("game_id").loc[d["game_id"], "p_home"].to_numpy(float) for arm in ARMS}
        for arm in ARMS:
            ml = P.ml_scores(y, p[arm])
            L = V.market_losses(frames[arm]["sim_gm"][frames[arm]["sim_gm"]["game_id"].isin(d["game_id"])], a)
            sm = V.summarize_losses(L)
            rec[arm] = {"ml": ml, "derivative_score": sm["derivative_ll_sum"],
                        "markets": {m: {k: sm[m][k] for k in ("log_loss", "brier", "cal_slope", "cal_int") if k in sm[m]}
                                    for m in V.DERIVATIVE + ["tot60_2w"]},
                        "distribution": V.distribution_checks(frames[arm]["sim_gm"][frames[arm]["sim_gm"]["game_id"]
                                                                                    .isin(d["game_id"])], a),
                        "raw_distribution": V.distribution_checks(frames[arm]["raw"][frames[arm]["raw"]["game_id"]
                                                                                    .isin(d["game_id"])], a)}
            rec[arm]["_L"] = L
        rec["ml_V4_minus_V2"] = P.paired(y, p["V4"], p["V2"])
        L4, L2 = rec["V4"].pop("_L"), rec["V2"].pop("_L")
        g4, g2 = _deriv_game(L4), _deriv_game(L2)
        dd = (g4 - g2.reindex(g4.index)).dropna()
        rec["derivative_V4_minus_V2"] = {"diff": round(float(dd.mean()), 5),
                                         "se": round(float(dd.std(ddof=1) / math.sqrt(len(dd))), 5), "n": int(len(dd))}
        rec["per_market_V4_minus_V2"] = V.paired(L4, L2)
        rec["corr_logit_p"] = round(float(np.corrcoef(P.lgt(p["V4"]), P.lgt(p["V2"]))[0, 1]), 4)
        out[s] = rec
    return out


def run_arms(work, seasons, v4_params, v2_params, workers):
    params = arm_params(v4_params, v2_params)
    inputs = {arm: V.history_inputs(work, params[arm]) for arm in ARMS}
    D, n_base = game_set(work, seasons, inputs)
    T = dict(zip(D["game_id"].astype("int64"), D["T_gm"].astype(float)))
    frames = {}
    for arm in ARMS:
        tag = "_".join(seasons)
        path = os.path.join(work, f"inputs_v4_{arm}_{tag}.pkl")
        if os.path.exists(path):
            frames[arm] = pd.read_pickle(path)
            continue
        G = inputs[arm]
        G = G[G["game_id"].astype("int64").isin(D["game_id"])].reset_index(drop=True)
        t0 = time.time()
        frames[arm] = simulate(G, params[arm], T, workers)
        pd.to_pickle(frames[arm], path)
        err = float(np.nanmax(np.abs(frames[arm]["sim_gm"]["anchor_p_err"])))
        log(f"[inputs_v4] {arm} {seasons}: {len(G)} games in {time.time() - t0:.0f}s (max |anchor p err| {err:.1e})")
    act = V.actual_table(seasons)
    return params, D, n_base, frames, act


def _versions(params):
    return {arm: {"version": params[arm].get("version"), "lineup": (params[arm].get("lineup") or {}).get("name", "rapm_v2"),
                  "dispersion": {k: params[arm]["dispersion"].get(k) for k in ("stretch", "sd_tilt", "k_game", "scale")}}
            for arm in ARMS}


def cmd_dev(work, v4_params, v2_params, workers):
    params, D, n_base, frames, act = run_arms(work, DEV, v4_params, v2_params, workers)
    sc = score(D, frames, act, DEV)
    pooled = sc["pooled"]
    dev_ml = bool(pooled["V4"]["ml"]["log_loss"] < pooled["V2"]["ml"]["log_loss"])
    dev_deriv = bool(pooled["derivative_V4_minus_V2"]["diff"] <= 0.0)
    payload = {"prereg": "bu/sim/prereg_inputs_v4.json", "seasons": DEV, "n_games": int(len(D)),
               "n_prereg_primary_games": n_base, "n_sims": N_SIMS, "arms": _versions(params), "scores": sc,
               "dev_ml_pass": dev_ml, "dev_derivative_pass": dev_deriv,
               "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    V._report("inputs_v4_dev", _strip(payload))
    for s, r in sc.items():
        log(f"[inputs_v4] dev {s}: n {r['n']} ML V2 {r['V2']['ml']['log_loss']} V4 {r['V4']['ml']['log_loss']} "
            f"diff {r['ml_V4_minus_V2']}; derivative V2 {r['V2']['derivative_score']} V4 {r['V4']['derivative_score']} "
            f"diff {r['derivative_V4_minus_V2']}")
    log(f"[inputs_v4] dev ML pass {dev_ml}, derivative pass {dev_deriv}")
    return payload


def _strip(x):
    """Drop the 10-bin reliability tables of the ML scores (kept for the derivative markets' file)."""
    if isinstance(x, dict):
        return {k: _strip(v) for k, v in x.items() if k != "reliability"}
    return x


def _looked() -> bool:
    if not os.path.exists(V.LOOK_LOG):
        return False
    with open(V.LOOK_LOG) as f:
        # a 'started' entry without its result (a crash before any number was printed) is not a look
        return any(json.loads(l).get("question") == QUESTION and json.loads(l).get("stage") != "started"
                   for l in f if l.strip())


def cmd_holdout(work, v4_params, v2_params, workers):
    rep = json.load(open(V.REPORT))
    if "inputs_v4_dev" not in rep:
        raise SystemExit("run `dev` first")
    if _looked():
        raise SystemExit(f"the {HOLDOUT} look for '{QUESTION}' has already been made ({V.LOOK_LOG}); one look only")
    dev = rep["inputs_v4_dev"]
    with open(V.LOOK_LOG, "a") as f:        # logged before the numbers exist: a crash still counts as the look
        f.write(json.dumps({"season": HOLDOUT, "question": QUESTION, "stage": "started",
                            "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}) + "\n")
    params, D, n_base, frames, act = run_arms(work, [HOLDOUT], v4_params, v2_params, workers)
    sc = score(D, frames, act, [HOLDOUT])[HOLDOUT]
    hold_ok = bool(sc["ml_V4_minus_V2"]["diff"] <= PASS_MARGIN)
    promote = bool(dev["dev_ml_pass"] and dev["dev_derivative_pass"] and hold_ok)
    with open(V.LOOK_LOG, "a") as f:
        f.write(json.dumps({"season": HOLDOUT, "question": QUESTION,
                            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                            "versions": {a: params[a].get("version") for a in ARMS}, "n_games": int(len(D)),
                            "ml_V4_minus_V2": sc["ml_V4_minus_V2"], "promote_v4": promote}) + "\n")
    payload = {"prereg": "bu/sim/prereg_inputs_v4.json", "season": HOLDOUT, "n_games": int(len(D)),
               "n_prereg_primary_games": n_base, "n_sims": N_SIMS, "arms": _versions(params), "scores": sc,
               "holdout_ml_ok": hold_ok, "dev_ml_pass": dev["dev_ml_pass"],
               "dev_derivative_pass": dev["dev_derivative_pass"], "promote_v4": promote,
               "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    V._report("inputs_v4_holdout", _strip(payload))
    log(f"[inputs_v4] holdout: n {sc['n']} ML V2 {sc['V2']['ml']['log_loss']} V4 {sc['V4']['ml']['log_loss']} "
        f"diff {sc['ml_V4_minus_V2']}; derivative V2 {sc['V2']['derivative_score']} V4 {sc['V4']['derivative_score']} "
        f"diff {sc['derivative_V4_minus_V2']}")
    log(f"[inputs_v4] holdout ML ok {hold_ok} -> promote V4: {promote}")
    return payload


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bu.sim.inputs_v4")
    ap.add_argument("cmd", choices=["dev", "holdout"])
    ap.add_argument("--work", required=True)
    ap.add_argument("--v4-params", required=True)
    ap.add_argument("--v2-params", default=None, help="default: out/sim_params.json")
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args(argv)
    t0 = time.time()
    (cmd_dev if a.cmd == "dev" else cmd_holdout)(a.work, a.v4_params, a.v2_params, a.workers)
    log(f"[inputs_v4] done in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
