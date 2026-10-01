"""Walk-forward value of the lineup term as a feature of the incumbent (mode i, DESIGN §3.2.2, §3.9).

The incumbent is ``train_game_model`` exactly as shipped: its training matrix
(``build_matrix``), feature list (``features.FEATURE_COLUMNS``), nested-C walk-forward
(``walk_forward``: train on seasons < S, C tuned on S-1 by the one-SE rule).  The candidate
adds lineup columns to that matrix; nothing else changes, so the paired per-game
log-loss difference isolates the lineup term.

Protocol (DESIGN §1.5):
* variants are compared on the dev folds (2023-24, 2024-25) only; the variant with the best
  pooled dev Δ is the candidate;
* the candidate gets ONE look at the soft holdout 2025-26, appended to
  ``pipeline/bu/lineup/out/look_log.jsonl`` with its config hash.  ``--holdout`` refuses a
  second look at the same config hash.

Per fold: n, log loss (incumbent / candidate), Δ with paired SE and a one-sided 95% upper
bound, 2,000-resample game bootstrap, Brier, calibration slope, early-season (GP <= 15) Δ.
Missing lineup features (no lineup / under the coverage gate) enter as 0 (neutral).
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
LOOK_LOG = os.path.join(OUT_DIR, "look_log.jsonl")
DEV_SEASONS = (2023, 2024)
HOLDOUT_SEASON = 2025
VARIANTS = {
    "net": ["bu_d_net"],
    "delta": ["bu_d_delta"],
    "net+delta": ["bu_d_net", "bu_d_delta"],
    "xgpct": ["bu_d_xgpct"],
}
N_BOOT = 2000


def _ll(y, p):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    y = np.asarray(y, float)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def attach(M: pd.DataFrame, feats: pd.DataFrame, cols) -> pd.DataFrame:
    f = feats[["game_id", "bu_ok", *cols]].copy()
    for c in cols:
        f.loc[~f["bu_ok"].astype(bool), c] = 0.0     # coverage gate: neutral when not covered
    M2 = M.merge(f, on="game_id", how="left")
    M2["bu_missing"] = M2[cols[0]].isna()
    for c in cols:
        M2[c] = M2[c].fillna(0.0)
    return M2


def cal_slope_ci(y, p) -> dict:
    """Logistic recalibration y ~ a + s*logit(p) by IRLS; slope with a two-sided 95% Wald CI."""
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    X = np.column_stack([np.ones(len(p)), np.log(p / (1 - p))])
    y = np.asarray(y, float)
    b = np.array([0.0, 1.0])
    H = np.eye(2)
    for _ in range(50):
        mu = 1 / (1 + np.exp(-X @ b))
        H = X.T @ (X * (mu * (1 - mu))[:, None])
        step = np.linalg.solve(H, X.T @ (y - mu))
        b = b + step
        if np.abs(step).max() < 1e-10:
            break
    se = float(np.sqrt(np.linalg.inv(H)[1, 1]))
    return {"slope": float(b[1]), "lo95": float(b[1] - 1.96 * se), "hi95": float(b[1] + 1.96 * se)}


def asof_frame(feats: pd.DataFrame, cols) -> pd.DataFrame:
    """Feature frame whose candidate columns hold the L-asof values (previous game's lineup)."""
    f = feats.copy()
    for c in cols:
        f[c] = f[c + "_asof"]
    return f


def compare_fold(base: pd.DataFrame, cand: pd.DataFrame, seed: int = 11) -> dict:
    import train_game_model as T
    m = base[["game_id", "home_win", "p_model", "early"]].merge(
        cand[["game_id", "p_model"]].rename(columns={"p_model": "p_c"}), on="game_id")
    y = m["home_win"].to_numpy()
    d = _ll(y, m["p_c"]) - _ll(y, m["p_model"])
    se = float(d.std(ddof=1) / math.sqrt(len(d)))
    rng = np.random.default_rng(seed)
    boots = np.array([d[rng.integers(0, len(d), len(d))].mean() for _ in range(N_BOOT)])
    e = m["early"].to_numpy(dtype=bool)
    de = d[e]
    mb, mc = T.metrics(y, m["p_model"].to_numpy()), T.metrics(y, m["p_c"].to_numpy())
    return {
        "n": int(len(d)), "ll_incumbent": mb["log_loss"], "ll_candidate": mc["log_loss"],
        "delta_ll": float(d.mean()), "se": se, "upper95_one_sided": float(d.mean() + 1.6449 * se),
        "boot_upper95": float(np.quantile(boots, 0.95)), "p_boot_not_better": float((boots >= 0).mean()),
        "brier_incumbent": mb["brier"], "brier_candidate": mc["brier"],
        "cal_slope_incumbent": mb["calibration_slope"], "cal_slope_candidate": mc["calibration_slope"],
        "cal_slope_ci_candidate": cal_slope_ci(y, m["p_c"].to_numpy()),
        "mean_p_minus_y_incumbent": mb["mean_pred_home"] - mb["actual_home"],
        "mean_p_minus_y_candidate": mc["mean_pred_home"] - mc["actual_home"],
        "early": {"n": int(e.sum()), "delta_ll": float(de.mean()) if len(de) else None,
                  "se": float(de.std(ddof=1) / math.sqrt(len(de))) if len(de) > 1 else None},
    }


def config_hash(feats_meta: dict, cols) -> str:
    blob = json.dumps({"meta": feats_meta, "cols": list(cols)}, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:12]


def run(M: pd.DataFrame, feats: pd.DataFrame, feats_meta: dict, holdout: bool = False,
        variants=VARIANTS, log=print) -> dict:
    import features as F
    import train_game_model as T
    base_cols = list(F.FEATURE_COLUMNS)
    report = {"generated_at": datetime.now(timezone.utc).isoformat(), "incumbent_features": base_cols,
              "feature_meta": feats_meta, "dev_seasons": list(DEV_SEASONS), "variants": {}}
    folds_b, oos_b = T.walk_forward(M, base_cols, test_seasons=DEV_SEASONS)
    report["incumbent_dev"] = {f["test_season"]: {k: f[k] for k in ("n", "log_loss", "brier", "calibration_slope", "C")}
                               for f in folds_b}
    cover = {}
    for name, cols in variants.items():
        M2 = attach(M, feats, cols)
        folds_c, oos_c = T.walk_forward(M2, base_cols + cols, test_seasons=DEV_SEASONS)
        per = {}
        for S in DEV_SEASONS:
            b, c = oos_b[oos_b["season"] == S], oos_c[oos_c["season"] == S]
            if len(b) and len(c):
                per[int(S)] = compare_fold(b, c)
        pooled = compare_fold(oos_b, oos_c)
        report["variants"][name] = {"cols": cols, "folds": per, "pooled_dev": pooled,
                                    "C": {f["test_season"]: f["C"] for f in folds_c}}
        for S in DEV_SEASONS:
            sub = M2[M2["season"] == S]
            cover[int(S)] = {"n_games": int(len(sub)), "missing_lineup": int(sub["bu_missing"].sum())}
        log(f"  [eval] {name:<10} pooled dev Δ {pooled['delta_ll']:+.5f} ± {pooled['se']:.5f}  "
            + "  ".join(f"{S}: {v['delta_ll']:+.5f}" for S, v in per.items()))
    report["coverage"] = cover
    best = min(report["variants"], key=lambda k: report["variants"][k]["pooled_dev"]["delta_ll"])
    cand = report["variants"][best]
    a2 = (cand["pooled_dev"]["delta_ll"] <= -0.0005
          and all(f["delta_ll"] <= 0.0005 for f in cand["folds"].values()))
    # L-asof (DESIGN §4.2, descriptive): the candidate with each team's previous dressed 18
    if all(c + "_asof" in feats.columns for c in cand["cols"]):
        M3 = attach(M, asof_frame(feats, cand["cols"]), cand["cols"])
        _, oos_a = T.walk_forward(M3, base_cols + cand["cols"], test_seasons=DEV_SEASONS)
        report["L_asof_dev"] = {
            "lineup": "previous game's dressed 18 (no injury feed)", "cols": cand["cols"],
            "pooled_dev": compare_fold(oos_b, oos_a),
            "folds": {int(S): compare_fold(oos_b[oos_b["season"] == S], oos_a[oos_a["season"] == S])
                      for S in DEV_SEASONS}}
        log(f"  [eval] L-asof {best}: pooled dev Δ {report['L_asof_dev']['pooled_dev']['delta_ll']:+.5f}")
    report["candidate"] = {"variant": best, "cols": cand["cols"], "config_hash": config_hash(feats_meta, cand["cols"]),
                           "A2_dev": {"rule": "pooled dev Δ <= -0.0005 and no fold worse than +0.0005",
                                      "pass": bool(a2)}}
    if holdout:
        report["holdout"] = holdout_look(M, feats, feats_meta, cand["cols"], base_cols)
    return report


def holdout_look(M, feats, feats_meta, cols, base_cols) -> dict:
    """The single soft-holdout look (DESIGN §1.5): refuses a repeat for the same config hash."""
    import train_game_model as T
    h = config_hash(feats_meta, cols)
    os.makedirs(OUT_DIR, exist_ok=True)
    if os.path.exists(LOOK_LOG):
        with open(LOOK_LOG) as f:
            for line in f:
                rec = json.loads(line)
                if rec.get("config_hash") == h:
                    return {"refused": f"config {h} already had its holdout look at {rec['at']}", "previous": rec}
    _, oos_b = T.walk_forward(M, base_cols, test_seasons=(HOLDOUT_SEASON,))
    M2 = attach(M, feats, cols)
    _, oos_c = T.walk_forward(M2, base_cols + cols, test_seasons=(HOLDOUT_SEASON,))
    res = compare_fold(oos_b, oos_c)
    res["A_comp"] = {"rule": "one-sided 98.75% upper bound of Δ < +0.0005 (Bonferroni over 4 component looks)",
                     "upper98_75": res["delta_ll"] + 2.2414 * res["se"]}
    res["A_comp"]["pass"] = bool(res["A_comp"]["upper98_75"] < 0.0005)
    rec = {"at": datetime.now(timezone.utc).isoformat(), "look": "M2 lineup term, soft holdout 2025-26",
           "config_hash": h, "cols": cols, "result": res}
    with open(LOOK_LOG, "a") as f:
        f.write(json.dumps(rec, default=float) + "\n")
    return res
