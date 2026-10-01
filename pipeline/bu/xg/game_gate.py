"""M1 gate (c): the incumbent game model with xG v2 features (DESIGN §1.7 A2/A-comp/A5, §8 M1).

The incumbent (``train_game_model``: logit + Elo on ``features.FeatureState``)
is re-run season walk-forward three times, changing only where the per-game
raw xG comes from (``features.attach_raw_xg``):

  v1_prod  the committed ``xg_model_xgb.pkl`` (what the live site uses today)
  v1_pit   the v1 recipe re-fit on seasons < S (honest xG v1)
  v2       xG v2 trained on seasons < S (``bu.xg.walkforward`` OOS scores)

All three are scored on the same lake shots, so every game has the same shot
coverage (the 2024-25 shot CSV misses 192 games; the lake does not).  Nothing
in ``features.py`` / ``train_game_model.py`` changes: the per-shot xG is
aggregated here into the frame ``features.raw_team_game_xg`` returns.

Gate rules (DESIGN §1.7):
  A2      dev folds (2023-24, 2024-25): pooled Δ <= -0.0005 and no fold worse than +0.0005
  A-comp  soft holdout 2025-26, ONE look: one-sided 98.75% upper bound of Δ < +0.0005
  A5      beats the home-rate baseline by >= 0.01 on every fold
Δ = LL(incumbent with v2) - LL(incumbent with v1 prod), per game, paired.
The holdout look is appended to ``bu/xg/out/xgv2_gate_log.jsonl`` (look ledger).

Usage (from pipeline/):  python -m bu.xg.game_gate --state-dir <dir with oos_xg2_*.parquet>
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE_DIR = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(HERE, "out", "xgv2_game_gate.json")
LOOK_LOG = os.path.join(HERE, "out", "xgv2_gate_log.jsonl")
DEV = (2023, 2024)
HOLDOUT = 2025
Z_ONE_SIDED_98_75 = 2.2414


def _ll(y, p):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    y = np.asarray(y, float)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def raw_frame(shots: pd.DataFrame, col: str, team_ids: dict) -> pd.DataFrame:
    """Per (game_id, team) frame in the schema of ``features.raw_team_game_xg``."""
    s = shots[["game_id", "shooting_team_id", "strength", "strength_class", "is_goal", col]].copy()
    s = s[s[col].notna()]
    s["team"] = pd.to_numeric(s["shooting_team_id"], errors="coerce").map(team_ids)
    s = s.dropna(subset=["team"])
    ne = s[s["strength_class"] != "EN"]
    g = ne.groupby(["game_id", "team"]).agg(xgf_all=(col, "sum"), gf_noen=("is_goal", "sum"))
    g5 = ne[ne["strength"] == "5v5"].groupby(["game_id", "team"])[col].sum().rename("xgf_5v5")
    g = g.join(g5).fillna({"xgf_5v5": 0.0}).reset_index()
    opp = g.rename(columns={"team": "opp", "xgf_all": "xga_all", "gf_noen": "ga_noen", "xgf_5v5": "xga_5v5"})
    m = g.merge(opp, on="game_id")
    return m[m["team"] != m["opp"]].drop(columns=["opp"]).reset_index(drop=True)


def paired(oa: pd.DataFrame, ob: pd.DataFrame, seasons) -> dict:
    a = oa[oa["season"].isin(seasons)][["game_id", "home_win", "p_model"]]
    b = ob[ob["season"].isin(seasons)][["game_id", "p_model"]].rename(columns={"p_model": "p_b"})
    m = a.merge(b, on="game_id")
    d = _ll(m["home_win"], m["p_b"]) - _ll(m["home_win"], m["p_model"])
    se = float(d.std(ddof=1) / math.sqrt(len(d))) if len(d) > 1 else float("nan")
    return {"n": int(len(d)), "delta": round(float(d.mean()), 6), "se": round(se, 6),
            "upper_95_one_sided": round(float(d.mean() + 1.6449 * se), 6),
            "upper_98_75_one_sided": round(float(d.mean() + Z_ONE_SIDED_98_75 * se), 6)}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--state-dir", required=True)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--no-holdout", action="store_true", help="dev folds only (no holdout look)")
    a = ap.parse_args(argv)
    if PIPELINE_DIR not in sys.path:
        sys.path.insert(0, PIPELINE_DIR)
    import features as F
    import train_game_model as T

    files = sorted(f for f in os.listdir(a.state_dir) if f.startswith("oos_xg2_") and f.endswith(".parquet"))
    shots = pd.concat([pd.read_parquet(os.path.join(a.state_dir, f)) for f in files], ignore_index=True)
    team_ids = F.load_team_ids(PIPELINE_DIR)
    games = F.load_gamestats(PIPELINE_DIR)
    meta = json.load(open(os.path.join(PIPELINE_DIR, "game_model_meta.json")))
    cols = meta["feature_columns"]
    tests = (*DEV,) + (() if a.no_holdout else (HOLDOUT,))

    runs, oos = {}, {}
    for name, col in (("v1_prod", "xg1_prod"), ("v1_pit", "xg1_pit"), ("v2", "xg2")):
        raw = raw_frame(shots, col, team_ids)
        g, _ = F.attach_raw_xg(games, raw)
        M = F.build_training_matrix(g)
        M["early"] = (M["team_game_number_h"] <= T.EARLY_GP) | (M["team_game_number_a"] <= T.EARLY_GP)
        first = M["season"].min()
        M["burn_in"] = (M["season"] == first) & ((M["h_gp"] < T.BURN_IN_GP) | (M["a_gp"] < T.BURN_IN_GP))
        folds, o = T.walk_forward(M, cols, test_seasons=tests)
        runs[name] = {f["test_season"]: {k: f[k] for k in ("n", "log_loss", "brier", "calibration_slope", "C",
                                                           "mean_pred_home", "actual_home")}
                      | {"home_rate_ll": f["home_rate_baseline"]["log_loss"],
                         "early_log_loss": f["early"].get("log_loss")} for f in folds}
        oos[name] = o
        print(name, {s: round(v["log_loss"], 5) for s, v in runs[name].items()}, flush=True)

    res = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "incumbent_features": cols, "seasons_with_lake_xg": sorted({int(str(g)[:4]) for g in shots["game_id"]}),
           "runs": runs, "comparisons": {}}
    for ref in ("v1_prod", "v1_pit"):
        comp = {}
        for s in DEV:
            comp[str(s)] = paired(oos[ref], oos["v2"], [s])
        comp["dev_pooled"] = paired(oos[ref], oos["v2"], list(DEV))
        if not a.no_holdout:
            comp[str(HOLDOUT)] = paired(oos[ref], oos["v2"], [HOLDOUT])
        res["comparisons"][f"v2_minus_{ref}"] = comp
    c = res["comparisons"]["v2_minus_v1_prod"]
    a2 = c["dev_pooled"]["delta"] <= -0.0005 and all(c[str(s)]["delta"] <= 0.0005 for s in DEV)
    a5 = all(runs["v2"][s]["home_rate_ll"] - runs["v2"][s]["log_loss"] >= 0.01 for s in runs["v2"])
    gate = {"A2": {"rule": "dev pooled Δ <= -0.0005 and no dev fold Δ > +0.0005 (vs v1_prod incumbent)",
                   "pass": bool(a2)},
            "A5": {"rule": "beats the home-rate baseline by >= 0.01 on every fold", "pass": bool(a5)}}
    if not a.no_holdout:
        h = c[str(HOLDOUT)]
        gate["A_comp"] = {"rule": "2025-26 one-sided 98.75% upper bound of Δ < +0.0005 (one look)",
                          "upper": h["upper_98_75_one_sided"], "pass": bool(h["upper_98_75_one_sided"] < 0.0005)}
    gate["pass"] = all(v["pass"] for v in gate.values() if isinstance(v, dict))
    res["gate"] = gate
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(res, f, indent=1)
        f.write("\n")
    if not a.no_holdout:
        with open(LOOK_LOG, "a") as f:
            f.write(json.dumps({"at": res["generated_at"], "look": "M1 A-comp (xG v2 as incumbent feature)",
                                "holdout": "2025-26", "result": gate.get("A_comp"),
                                "comparison": c[str(HOLDOUT)]}) + "\n")
    print(json.dumps(res["comparisons"], indent=1))
    print(json.dumps(gate, indent=1))
    return res


if __name__ == "__main__":
    main()
