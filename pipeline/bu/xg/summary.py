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


def _slope(y: np.ndarray, p: np.ndarray) -> tuple[float, float]:
    """Calibration slope b of y ~ a + b*logit(p) (IRLS) and its SE."""
    p = np.clip(np.asarray(p, dtype="float64"), 1e-6, 1 - 1e-6)
    z = np.log(p / (1 - p))
    X = np.column_stack([np.ones_like(z), z])
    beta = np.array([0.0, 1.0])
    H = np.eye(2)
    for _ in range(50):
        mu = 1 / (1 + np.exp(-(X @ beta)))
        W = mu * (1 - mu)
        H = X.T @ (X * W[:, None]) + 1e-9 * np.eye(2)
        step = np.linalg.solve(H, X.T @ (y - mu))
        beta = beta + step
        if np.abs(step).max() < 1e-10:
            break
    return float(beta[1]), float(np.sqrt(np.linalg.inv(H)[1, 1]))


def _ll(y, p) -> np.ndarray:
    p = np.clip(np.asarray(p, dtype="float64"), 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def pooled(comp: dict, seasons=("2023", "2024", "2025"), margin: float = 0.0005) -> dict | None:
    """Pool per-season paired game-level comparisons (``game_gate.paired`` rows) into one Δ.

    The pooled mean weights seasons by games; its SE combines the per-season SEs
    (independent games), Var = Σ n_s² se_s² / N².  This is the owner's 2026-10-01 basis
    for shipping: dev folds plus the already-spent 2025-26 look, no new look."""
    rows = [comp.get(s) for s in seasons]
    if not comp or any(r is None for r in rows):
        return None
    n = np.array([r["n"] for r in rows], dtype="float64")
    dm = np.array([r["delta"] for r in rows], dtype="float64")
    se = np.array([r["se"] for r in rows], dtype="float64")
    N = n.sum()
    mean = float((n * dm).sum() / N)
    pse = float(np.sqrt(((n * se) ** 2).sum()) / N)
    up95, up9875 = mean + 1.6449 * pse, mean + 2.2414 * pse
    return {"seasons": list(seasons), "n": int(N), "delta": round(mean, 6), "se": round(pse, 6),
            "upper_95_one_sided": round(up95, 6), "upper_98_75_one_sided": round(up9875, 6),
            "a_comp_rule": f"one-sided 98.75% upper bound < +{margin}", "a_comp_pass": bool(up9875 < margin)}


def training_cutoff(model_dir: str | None = None) -> str | None:
    """Last current-season game date the active xG v2 artifact was trained on (None: none)."""
    from .live import MODEL_DIR, PREFIX
    p = os.path.join(model_dir or MODEL_DIR, f"{PREFIX}_calibrators.json")
    if not os.path.exists(p):
        return None
    with open(p) as f:
        meta = (json.load(f) or {}).get("meta") or {}
    return meta.get("current_season_last_game")


def shadow_status(shots_csv: str | None = None, gamestats_csv: str | None = None,
                  cutoff: str | None | bool = False) -> dict:
    """Gate (d): live shadow games with xg_raw_v2, and their calibration.

    Only games played *after* the active artifact's training cutoff count: the stage rescoring
    every shot whenever the artifacts change means every row holds the active model's value, and
    that model was fit on the current season's games up to ``current_season_last_game``, so those
    games are in sample.  ``cutoff=False`` reads it from the artifact."""
    from season import season_file
    root = os.path.dirname(os.path.dirname(HERE))
    p = shots_csv or os.path.join(root, season_file("shots"))
    if not os.path.exists(p):
        return {"games": 0, "pass": False, "reason": "no season shot file yet"}
    d = pd.read_csv(p, low_memory=False)
    if "xg_raw_v2" not in d.columns:
        return {"games": 0, "pass": False, "reason": "no xg_raw_v2 column yet (shadow not run)"}
    d = d[d["xg_raw_v2"].notna()]
    ref_col = "xg_raw_v1" if "xg_raw_v1" in d.columns else None   # v2 mode: the rollback shadow
    if ref_col is None and "xg_raw" in d.columns:
        from .live import mode
        ref_col = "xg_raw" if mode() != "v2" else None             # shadow/v1 mode: xg_raw is v1
    if cutoff is False:
        cutoff = training_cutoff()
    games_all = int(d["game_id"].nunique())
    if cutoff:
        gp = gamestats_csv or os.path.join(root, season_file("gamestats"))
        dates = (pd.read_csv(gp, usecols=["game_id", "game_date"]).drop_duplicates("game_id")
                 .set_index("game_id")["game_date"].astype(str)) if os.path.exists(gp) else pd.Series(dtype=str)
        gd = d["game_id"].map(dates)
        d = d[gd.notna() & (gd > str(cutoff))]   # unknown dates are not counted
    games = int(d["game_id"].nunique())
    base = {"rule": f">= {SHADOW_MIN_GAMES} live games after the artifact's training cutoff, the 95% CI of "
                    "goals/xG v2 contains 1 and the calibration-slope 95% CI contains 1 (DESIGN §1.7)",
            "training_cutoff": cutoff, "games_with_v2": games_all, "games_in_sample_excluded": games_all - games}
    if d.empty:
        return {**base, "games": 0, "pass": False}
    y = d["is_goal"].to_numpy(dtype="float64")
    goals, xg = float(y.sum()), float(d["xg_raw_v2"].sum())
    ratio = goals / xg if xg else float("nan")
    se = (goals ** 0.5) / xg if xg else float("nan")
    slope, slope_se = _slope(y, d["xg_raw_v2"].to_numpy()) if 0 < goals < len(d) else (float("nan"), float("nan"))
    ok = (games >= SHADOW_MIN_GAMES and (ratio - 1.96 * se) <= 1.0 <= (ratio + 1.96 * se)
          and (slope - 1.96 * slope_se) <= 1.0 <= (slope + 1.96 * slope_se))
    vs_v1 = None
    if ref_col:
        r = d[d[ref_col].notna()]
        if len(r):
            yr = r["is_goal"].to_numpy(dtype="float64")
            l2, l1 = _ll(yr, r["xg_raw_v2"]), _ll(yr, r[ref_col])
            vs_v1 = {"column": ref_col, "shots": int(len(r)), "ll_v2": round(float(l2.mean()), 5),
                     "ll_v1": round(float(l1.mean()), 5), "dll_v2_minus_v1": round(float((l2 - l1).mean()), 5),
                     "goals_per_xg_v1": round(float(yr.sum() / r[ref_col].sum()), 4) if r[ref_col].sum() else None}
    return {**base, "games": games, "shots": int(len(d)), "goals": int(goals), "xg_v2": round(xg, 2),
            "vs_v1_same_shots": vs_v1,
            "goals_per_xg": round(ratio, 4) if xg else None,
            "ci95": [round(ratio - 1.96 * se, 4), round(ratio + 1.96 * se, 4)] if xg else None,
            "cal_slope": round(slope, 4) if slope == slope else None,
            "cal_slope_ci95": [round(slope - 1.96 * slope_se, 4), round(slope + 1.96 * slope_se, 4)]
            if slope == slope else None,
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
    from . import live
    comps = (gg or {}).get("comparisons", {})
    ship = {
        "decision": "owner 2026-10-01: ship xG v2 (with the RAPM lineup term) on the pooled evidence, "
                    "keep v1 as a shadow for rollback; the game model is retrained on v2 by the integrator",
        "pooled_game_level": {f"{cand}_minus_{ref}": pooled(comps.get(f"{cand}_minus_{ref}", {}))
                              for ref in ("v1_pit", "v1_prod")},
        "shot_level": "every one of the walk-forward seasons, LL and AUC (a_shot_ll per_fold)",
        "live_flag": {"default": live.DEFAULT_MODE, "game_model_on_v2": live.game_model_on_v2(),
                      "active_mode": live.mode(),
                      "interlock": "an unset PONYXG_XG runs shadow until game_model_meta.json declares "
                                   "\"xg_version\": \"v2\""},
    }
    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "candidate": cand,
        "m1_gate": parts,
        "m1_pass": all(v.get("pass") for v in parts.values()),
        "ship": ship,
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
    print(json.dumps({k: out[k] for k in ("candidate", "m1_pass", "headline", "ship")}, indent=1))
    print(json.dumps({k: v.get("pass") for k, v in parts.items()}))
    return out


if __name__ == "__main__":
    main()
