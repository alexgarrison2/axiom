"""One-page M1 verdict from the walk-forward report and the game gate (DESIGN §8 M1).

    python -m bu.xg.summary            # reads out/xgv2_report.json + out/xgv2_game_gate.json
                                       # (+ the live shadow column, if any), writes out/xgv2_m1_summary.json
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
SHADOW_MIN_GAMES = 100


def shadow_status(shots_csv: str | None = None) -> dict:
    """Gate (d): live shadow games with xg_raw_v2, and their calibration (goals / xG v2)."""
    from season import season_file
    p = shots_csv or os.path.join(os.path.dirname(os.path.dirname(HERE)), season_file("shots"))
    if not os.path.exists(p):
        return {"games": 0, "pass": False, "reason": "no season shot file yet"}
    d = pd.read_csv(p, low_memory=False)
    if "xg_raw_v2" not in d.columns:
        return {"games": 0, "pass": False, "reason": "no xg_raw_v2 column yet (shadow not run)"}
    d = d[d["xg_raw_v2"].notna()]
    games = int(d["game_id"].nunique())
    goals, xg = float(d["is_goal"].sum()), float(d["xg_raw_v2"].sum())
    ratio = goals / xg if xg else float("nan")
    se = (goals ** 0.5) / xg if xg else float("nan")
    ok = games >= SHADOW_MIN_GAMES and (ratio - 1.96 * se) <= 1.0 <= (ratio + 1.96 * se)
    return {"games": games, "shots": int(len(d)), "goals": int(goals), "xg_v2": round(xg, 2),
            "goals_per_xg": round(ratio, 4) if xg else None,
            "ci95": [round(ratio - 1.96 * se, 4), round(ratio + 1.96 * se, 4)] if xg else None,
            "rule": f">= {SHADOW_MIN_GAMES} live games and the 95% CI of goals/xG v2 contains 1",
            "pass": bool(ok)}


def main(argv=None):
    rep = json.load(open(os.path.join(OUT, "xgv2_report.json")))
    gg_path = os.path.join(OUT, "xgv2_game_gate.json")
    gg = json.load(open(gg_path)) if os.path.exists(gg_path) else None
    folds = rep["folds"]
    per_season = {}
    for s, f in folds.items():
        m = f["main"]
        row = {"role": f["role"], "train": f["train_seasons"][-1:] if f["train_seasons"] else []}
        for k in ("xg2", "xg2_asof", "xg1_pit", "xg1_prod"):
            row[k] = {"ll": m[k]["log_loss"], "auc": m[k]["auc"], "cal_slope": m[k]["cal_slope"],
                      "goals_per_xg": m[k]["goals_per_xg"]}
        row["dLL_asof_vs_v1_pit"] = m["diff_xg2_asof_minus_xg1_pit"]["mean"]
        mp = f.get("moneypuck")
        if mp:
            row["moneypuck_ll_all"] = mp["all"]["moneypuck"]["log_loss"]
            row["xg2_asof_ll_all"] = mp["all"]["xg2_asof"]["log_loss"]
            row["dLL_asof_vs_mp"] = mp["all"]["diff_xg2_asof_minus_mp"]["mean"]
        per_season[s] = row
    g = rep["gate"]
    cand = (gg or {}).get("candidate", "v2_asof")
    key = "xg2_asof" if cand == "v2_asof" else "xg2"
    c_gate = (gg or {}).get("gate", {}).get(cand, {})
    d = shadow_status()
    parts = {
        "a_shot_ll": {"pass": g[key]["a_shot_ll"]["pass"], "rule": g[key]["a_shot_ll"]["rule"]},
        "b_goals_per_xg": {"pass": g[key]["b_goals_per_xg"]["pass"],
                           "consistent_within_sampling_error": g[key]["b_goals_per_xg"]["consistent_within_sampling_error"],
                           "rule": g[key]["b_goals_per_xg"]["rule"]},
        "c_incumbent_with_v2": {"pass": bool(c_gate.get("pass")), "A2": c_gate.get("A2"), "A_comp": c_gate.get("A_comp"),
                                "A5": c_gate.get("A5")} if gg else {"pass": False, "reason": "game gate not run"},
        "d_live_shadow": d,
    }
    dev = [s for s in folds if folds[s]["role"] == "dev"]
    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "candidate": cand,
        "m1_gate": parts,
        "m1_pass": all(v.get("pass") for v in parts.values()),
        "headline": {
            "seasons_tested": len(folds),
            "v2_beats_v1_pit_every_season": all(per_season[s]["dLL_asof_vs_v1_pit"] < 0 for s in per_season),
            "mean_dLL_asof_vs_v1_pit": round(float(np.mean([per_season[s]["dLL_asof_vs_v1_pit"] for s in per_season])), 5),
            "dev_dLL_asof_vs_v1_pit": {s: per_season[s]["dLL_asof_vs_v1_pit"] for s in dev},
        },
        "per_season": per_season,
    }
    with open(os.path.join(OUT, "xgv2_m1_summary.json"), "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(json.dumps({k: out[k] for k in ("candidate", "m1_pass", "headline")}, indent=1))
    print(json.dumps({k: v.get("pass") for k, v in parts.items()}))
    return out


if __name__ == "__main__":
    main()
