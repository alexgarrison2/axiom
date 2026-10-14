"""As-of pulled-goalie curves (and empty-net scoring) vs the fixed 2017-23 tables
(``prereg_pull_asof.json``, question ``sim_pull_asof``).

    cd pipeline
    python -m bu.sim.pull_asof diagnose --work <dir>       # descriptive, fit + dev seasons only
    python -m bu.sim.pull_asof dev --work <dir>            # dev seasons: BASE vs ASOF
    python -m bu.sim.pull_asof holdout --work <dir>        # the single logged 2025-26 look (owner only)
    python -m bu.sim.pull_asof params --season <S> --out <file>   # candidate live parameters for season S

Arms (both the live parameters ``out/sim_params_st.json``, ``PONYXG_SIM_INPUTS=st``):

  BASE       the structural tables as published (pull curves and pulled-goalie state ratios fitted on
             2017-18 .. 2022-23 over all pulled time)
  ASOF       for a game of season S: ``structural.pulls`` re-fitted on the regular seasons S-2 and S-1
             (``fit.pull_curves``: same bins, smoothing, unimodal shape) AND the four pulled-goalie
             state ratios (``LATE_KEYS``: empty net 5v6 / 4v6, extra attacker 6v5 / 6v4) measured on a
             trailing team's 3rd-period pulls of S-2 and S-1 (``late_pull_state_ratios``; the all-time
             ratio over all pulled time, delayed penalties included, dilutes the empty-net rate by ~15%)
  ASOF_PULL  the curves only (decomposition, reported, not a candidate)

Live: ``params --season S`` writes a parameter file with the tables fitted on S-2 and S-1 (a candidate
for ``PONYXG_SIM_PARAMS``; nothing changes in the published path unless the owner promotes it).
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import armscore as A
from . import fit as F
from . import validate as V
from .params import OUT_DIR, load_params, save_params

HERE = os.path.dirname(os.path.abspath(__file__))
PREREG = os.path.join(HERE, "prereg_pull_asof.json")
QUESTION = "sim_pull_asof"
DEV = ["20232024", "20242025"]
HOLDOUT = "20252026"
DIAG_SEASONS = F.FIT_SEASONS + DEV
LIVE_PARAMS = os.path.join(OUT_DIR, "sim_params_st.json")
EN_KEYS = ("5v6_10", "4v6_10", "3v6_10")          # shooting at an empty net (the opponent pulled)
ARMS = ("BASE", "ASOF_PULL", "ASOF")
PASS_ML = 0.0010


def log(*a):
    print(*a, flush=True)


def prior_seasons(season: str, k: int = 2) -> list[str]:
    y = int(str(season)[:4])
    return [f"{y - j}{y - j + 1}" for j in range(k, 0, -1)]


def _long(seasons):
    return F._long(seasons)


# ---------------------------------------------------------------------------- tables

LATE_KEYS = ("5v6_10", "4v6_10", "6v5_01", "6v4_01")


def late_pull_ratios(reg: pd.DataFrame, base: float) -> dict:
    """Goal rate relative to 5v5 of the pulled-goalie states restricted to a TRAILING team's pull in
    the 3rd period (the only pull the engine simulates): shooting at the empty net (the attacking team
    leads, the opponent's goalie out) and the extra attacker (the attacking team trails, own goalie
    out).  ``reg``: regulation stints of the attacking team's view."""
    p3 = reg[reg["period"] == 3]
    out = {}
    for k in LATE_KEYS:
        sk, osk, g, og = int(k[0]), int(k[2]), int(k[4]), int(k[5])
        m = (p3["sk"] == sk) & (p3["osk"] == osk) & (p3["g"] == g) & (p3["og"] == og)
        m &= (p3["diff"] > 0) if og == 0 else (p3["diff"] < 0)
        x = p3[m]
        rest = reg[(reg["sk"] == sk) & (reg["osk"] == osk) & (reg["g"] == g) & (reg["og"] == og)]
        out[k] = {"hours": round(float(x["dur"].sum()) / 3600, 1), "goals": int(x["gf"].sum()),
                  "ratio": round(float(x["gf"].sum() / max(x["dur"].sum(), 1) / base), 3),
                  "ratio_all_time": round(float(rest["gf"].sum() / max(rest["dur"].sum(), 1) / base), 3),
                  "share_of_state_time": round(float(x["dur"].sum() / max(rest["dur"].sum(), 1)), 3)}
    return out


def late_pull_state_ratios(lo: pd.DataFrame) -> dict:
    """``late_pull_ratios`` of regular-season regulation stints, shrunk like ``fit.state_ratios``
    (PSEUDO_H hours of the all-time ratio as prior)."""
    lo = lo[(lo["game_type"] == 2) & (lo["period"] <= 3)]
    five = lo[(lo["sk"] == 5) & (lo["osk"] == 5) & (lo["g"] == 1) & (lo["og"] == 1)]
    base = five["gf"].sum() / five["dur"].sum()
    raw = late_pull_ratios(lo, base)
    ps = F.PSEUDO_H * 3600.0
    out = {}
    for k, r in raw.items():
        s_ = r["hours"] * 3600.0
        out[k] = float((r["goals"] + r["ratio_all_time"] * base * ps) / (s_ + ps) / base)
    return out


def asof_structural(structural: dict, season: str, lo: pd.DataFrame | None = None, late_rates: bool = True) -> dict:
    """``structural`` with the pull curves re-fitted on the two regular seasons before ``season``
    and (``late_rates``) the four pulled-goalie state ratios replaced by their late-pull values
    (``late_pull_state_ratios``) on the same two seasons."""
    seasons = prior_seasons(season)
    lo = lo if lo is not None else _long(seasons)
    lo = lo[lo["season"].astype(str).isin(seasons)]
    out = copy.deepcopy(structural)
    out["pulls"] = {**F.pull_curves(lo), "fit_seasons": seasons}
    if late_rates:
        for k, v in late_pull_state_ratios(lo).items():
            out["states"]["reg"][k] = v
    out["asof"] = {"season": str(season), "fit_seasons": seasons, "late_rates": bool(late_rates),
                   "keys": list(LATE_KEYS) if late_rates else [], "question": QUESTION}
    return out


def asof_params(params: dict, season: str, lo=None, late_rates=True) -> dict:
    p = copy.deepcopy(params)
    p["structural"] = asof_structural(params["structural"], season, lo, late_rates)
    p["version"] = f"{params.get('version')}+pullasof{'' if late_rates else 'curves'}{season[:4]}"
    return p


# ---------------------------------------------------------------------------- diagnosis

def _curve_value(curves: dict, d: np.ndarray, trem: np.ndarray, bin_s: float, nb: int) -> np.ndarray:
    b = np.clip((trem // bin_s).astype(int), 0, nb - 1)
    out = np.zeros(len(d))
    for dd in (1, 2, 3):
        m = (d >= 3) if dd == 3 else (d == dd)
        c = np.asarray(curves[str(dd)], float)
        out[m] = c[b[m]]
    return out


def season_diagnosis(season: str, structural: dict) -> dict:
    """One season, regular season: pulled time (actual vs what the fixed curves imply in the
    actual trailing states), empty-net goal hazard vs the fixed ratio, EN goals a game."""
    lo = _long([season])
    lo = lo[lo["game_type"] == 2]
    n_games = lo["game_id"].nunique()
    reg = lo[lo["period"] <= 3]
    five = reg[(reg["sk"] == 5) & (reg["osk"] == 5) & (reg["g"] == 1) & (reg["og"] == 1)]
    base = five["gf"].sum() / five["dur"].sum()
    # seconds of P3 within the curve window, trailing team's view
    pulls = structural["pulls"]
    bin_s, nb = float(pulls["bin_s"]), int(pulls["max_s"] // pulls["bin_s"])
    p3 = reg[(reg["period"] == 3) & (reg["end_s"] > 1200 - pulls["max_s"]) & (reg["diff"] < 0)]
    st = np.maximum(p3["start_s"].to_numpy(), 1200 - pulls["max_s"])
    en = p3["end_s"].to_numpy()
    n = np.maximum(en - st, 0)
    idx = np.repeat(np.arange(len(p3)), n)
    sec = np.repeat(st, n) + (np.arange(n.sum()) - np.repeat(np.cumsum(n) - n, n))
    d = -p3["diff"].to_numpy()[idx]
    pulled = (p3["g"].to_numpy()[idx] == 0)
    trem = 1200 - sec - 0.5
    implied = _curve_value(pulls["curves"], d, trem, bin_s, nb)
    by_def = {}
    for dd in (1, 2, 3):
        m = (d >= 3) if dd == 3 else (d == dd)
        by_def[str(dd) if dd < 3 else "3+"] = {
            "trailing_s_per_game": round(float(m.sum() / n_games), 1),
            "pulled_s_per_game": round(float(pulled[m].sum() / n_games), 2),
            "fixed_curve_implied_s_per_game": round(float(implied[m].sum() / n_games), 2)}
    # pulled time anywhere in regulation (attacking team's goalie out, opponent's in)
    ea = reg[(reg["g"] == 0) & (reg["og"] == 1)]
    p3ea = ea[(ea["period"] == 3) & (ea["diff"] < 0)]
    en_att = reg[reg["og"] == 0]                       # shooting at an empty net
    en_goals = int(en_att["gf"].sum())
    en_p3_trail = int(en_att[(en_att["period"] == 3) & (en_att["diff"] > 0)]["gf"].sum())
    r_fixed = {k: structural["states"]["reg"].get(k) for k in EN_KEYS}
    by_key = {}
    for k in ("5v6_10", "4v6_10"):
        sk, osk = int(k[0]), int(k[2])
        x = en_att[(en_att["sk"] == sk) & (en_att["osk"] == osk) & (en_att["g"] == 1)]
        by_key[k] = {"seconds_per_game": round(float(x["dur"].sum() / n_games), 2), "goals": int(x["gf"].sum()),
                     "ratio_to_5v5": round(float(x["gf"].sum() / max(x["dur"].sum(), 1) / base), 3),
                     "fixed_ratio": r_fixed.get(k)}
    # the state the engine simulates: a trailing team's 3rd-period pull (not delayed-penalty pulls,
    # during which the other team cannot score into the empty net)
    lp = late_pull_ratios(reg, base)
    xa = ea[(ea["sk"] == 6) & (ea["osk"] == 5)]
    en_sec = float(en_att["dur"].sum())
    fixed_mean = sum(by_key[k]["seconds_per_game"] * (r_fixed.get(k) or 0) for k in by_key) / \
        max(sum(by_key[k]["seconds_per_game"] for k in by_key), 1e-9)
    return {
        "games": int(n_games), "base_5v5_goals_per_hour": round(float(base * 3600), 3),
        "en_goals_per_game_stints": round(en_goals / n_games, 4),
        "en_goals_share_p3_leading_team": round(en_p3_trail / max(en_goals, 1), 3),
        "pulled_s_per_game_regulation": round(float(ea["dur"].sum() / n_games), 1),
        "pulled_s_per_game_p3_trailing": round(float(p3ea["dur"].sum() / n_games), 1),
        "p3_window_by_deficit": by_def,
        "pulled_s_actual_over_fixed_curve": round(float(pulled.sum() / max(implied.sum(), 1e-9)), 3),
        "empty_net_ratio_to_5v5": round(float(en_goals / max(en_sec, 1) / base), 3),
        "empty_net_ratio_fixed_time_weighted": round(float(fixed_mean), 3),
        "by_state": by_key,
        "extra_attacker_6v5_ratio_to_5v5": round(float(xa["gf"].sum() / max(xa["dur"].sum(), 1) / base), 3),
        "extra_attacker_6v5_fixed": structural["states"]["reg"].get("6v5_01"),
        "late_pull": lp,
    }


def cmd_diagnose(work: str) -> dict:
    params = load_params(LIVE_PARAMS)
    st = params["structural"]
    out = {}
    for s in DIAG_SEASONS:
        t0 = time.time()
        out[s] = season_diagnosis(s, st)
        r = out[s]
        log(f"[pull_asof] {s}: EN/g {r['en_goals_per_game_stints']} pulled P3-trailing s/g {r['pulled_s_per_game_p3_trailing']} "
            f"actual/fixed-curve {r['pulled_s_actual_over_fixed_curve']} EN ratio {r['empty_net_ratio_to_5v5']} "
            f"(fixed {r['empty_net_ratio_fixed_time_weighted']}) ({time.time() - t0:.0f}s)")
    with open(os.path.join(work, "pull_asof_diagnosis.json"), "w") as f:
        json.dump(out, f, indent=1)
    return out


# ---------------------------------------------------------------------------- comparison

def run(work: str, seasons, workers: int):
    params = load_params(LIVE_PARAMS)
    from .lineup_source import history_inputs_name
    G = pd.read_parquet(os.path.join(work, history_inputs_name(params)))
    D = A.game_set(work, seasons, G)
    frames = {arm: {} for arm in ARMS}
    tables = {}
    for s in seasons:
        Ds = D[D["season"] == s]
        Gs = G[G["game_id"].astype("int64").isin(Ds["game_id"])].reset_index(drop=True)
        lo = _long(prior_seasons(s))
        pa = asof_params(params, s, lo, late_rates=True)
        pc = asof_params(params, s, lo, late_rates=False)
        tables[s] = {"fit_seasons": pa["structural"]["asof"]["fit_seasons"],
                     "pulls": pa["structural"]["pulls"]["curves"],
                     "late_ratios": {k: pa["structural"]["states"]["reg"].get(k) for k in LATE_KEYS},
                     "base_ratios": {k: params["structural"]["states"]["reg"].get(k) for k in LATE_KEYS}}
        for arm, p in (("BASE", params), ("ASOF_PULL", pc), ("ASOF", pa)):
            t0 = time.time()
            fr = A.simulate(Gs, p, Ds, workers, cache=os.path.join(work, f"pull_asof_{arm}_{s}.pkl"))
            frames[arm][s] = fr
            log(f"[pull_asof] {arm} {s}: {len(Ds)} games ({time.time() - t0:.0f}s)")
    fr = {arm: {k: pd.concat([frames[arm][s][k] for s in seasons], ignore_index=True) for k in ("raw", "sim_gm")}
          for arm in ARMS}
    act = V.actual_table(seasons)
    sc = A.score(D, fr, act, seasons, ARMS, "BASE", "ASOF")
    return params, D, sc, tables


def cmd_dev(work, workers):
    params, D, sc, tables = run(work, DEV, workers)
    pooled = sc["pooled"]
    dv, ml = pooled["derivative_ASOF_minus_BASE"], pooled["ml_ASOF_minus_BASE"]
    diag_p = os.path.join(work, "pull_asof_diagnosis.json")
    payload = {"prereg": "bu/sim/prereg_pull_asof.json", "question": QUESTION, "seasons": DEV,
               "n_games": int(len(D)), "n_sims": 20000, "params": params.get("version"), "tables": tables,
               "scores": sc, "dev_derivative_pass": bool(dv["diff"] < 0), "dev_ml_guard_pass": bool(ml["diff"] <= PASS_ML),
               "diagnosis": json.load(open(diag_p)) if os.path.exists(diag_p) else None,
               "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    V._report("pull_asof_dev", A.strip(payload))
    for s, r in sc.items():
        log(f"[pull_asof] dev {s}: n {r['n']} deriv BASE {r['BASE']['derivative_score']} ASOF {r['ASOF']['derivative_score']} "
            f"diff {r['derivative_ASOF_minus_BASE']}; ML diff {r['ml_ASOF_minus_BASE']}; EN/g "
            f"{r['BASE']['distribution'].get('en_goals_per_game')} vs {r['ASOF']['distribution'].get('en_goals_per_game')}; "
            f"margin logp diff {r['margin_logp_ASOF_minus_BASE']}")
    log(f"[pull_asof] dev derivative pass {payload['dev_derivative_pass']}, ML guard {payload['dev_ml_guard_pass']}")
    return payload


def cmd_holdout(work, workers):
    """The single 2025-26 look for this question (prereg_pull_asof.json); the owner runs it."""
    rep = json.load(open(V.REPORT))
    if "pull_asof_dev" not in rep:
        raise SystemExit("run `dev` first")
    if A.looked(QUESTION):
        raise SystemExit(f"the {HOLDOUT} look for '{QUESTION}' has already been made ({V.LOOK_LOG}); one look only")
    dev = rep["pull_asof_dev"]
    A.log_look({"season": HOLDOUT, "question": QUESTION, "stage": "started",
                "at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    params, D, sc, tables = run(work, [HOLDOUT], workers)
    r = sc[HOLDOUT]
    dv, ml = r["derivative_ASOF_minus_BASE"], r["ml_ASOF_minus_BASE"]
    hold_dv, hold_ml = bool(dv["diff"] <= dv["se"]), bool(ml["diff"] <= PASS_ML)
    promote = bool(dev["dev_derivative_pass"] and dev["dev_ml_guard_pass"] and hold_dv and hold_ml)
    A.log_look({"season": HOLDOUT, "question": QUESTION, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "version": params.get("version"), "n_games": int(len(D)), "derivative_ASOF_minus_BASE": dv,
                "ml_ASOF_minus_BASE": ml, "promote_asof": promote})
    payload = {"prereg": "bu/sim/prereg_pull_asof.json", "question": QUESTION, "season": HOLDOUT,
               "n_games": int(len(D)), "tables": tables, "scores": sc, "holdout_derivative_ok": hold_dv,
               "holdout_ml_ok": hold_ml, "promote_asof": promote,
               "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    V._report("pull_asof_holdout", A.strip(payload))
    log(f"[pull_asof] holdout: {r['n']} games, derivative ASOF-BASE {dv}, ML {ml} -> promote {promote}")
    return payload


def cmd_params(season: str, out: str):
    """Candidate live parameters for ``season`` (tables from S-2, S-1); never the live file."""
    if os.path.abspath(out).startswith(os.path.abspath(OUT_DIR)) and os.path.basename(out).startswith("sim_params"):
        if os.path.exists(out):
            raise SystemExit(f"refusing to overwrite {out}")
    p = asof_params(load_params(LIVE_PARAMS), str(season))
    save_params(p, out)
    log(f"[pull_asof] {season}: tables from {p['structural']['asof']['fit_seasons']} -> {out}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bu.sim.pull_asof")
    ap.add_argument("cmd", choices=["diagnose", "dev", "holdout", "params"])
    ap.add_argument("--work", default=None)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--season", default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)
    t0 = time.time()
    if a.cmd == "diagnose":
        cmd_diagnose(a.work)
    elif a.cmd == "dev":
        cmd_dev(a.work, a.workers)
    elif a.cmd == "holdout":
        cmd_holdout(a.work, a.workers)
    else:
        cmd_params(a.season, a.out)
    log(f"[pull_asof] done in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
