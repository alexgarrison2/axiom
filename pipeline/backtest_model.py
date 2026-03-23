#!/usr/bin/env python3
"""
backtest_model.py — Backtest the rebuilt NHL prediction model.

Evaluates on held-out seasons using walk-forward validation:
  - Train on prior season(s), predict each game in the test season
  - Compare ML model vs Poisson baseline vs naive home-win-rate baseline
  - Output log loss, Brier score, accuracy, and calibration analysis

Usage:
    python3 pipeline/backtest_model.py
"""

import os
import sys
import json
import warnings
import numpy as np
import pandas as pd
from collections import defaultdict

warnings.filterwarnings('ignore')

try:
    from xgboost import XGBClassifier
    USE_XGB = True
except ImportError:
    from sklearn.ensemble import GradientBoostingClassifier
    USE_XGB = False

from sklearn.metrics import log_loss, brier_score_loss, accuracy_score
from sklearn.calibration import CalibratedClassifierCV
from scipy.stats import poisson

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Import feature engineering from training pipeline
from train_game_model import (
    load_all_games, compute_team_features, build_game_matrix,
    EWMA_HALFLIFE, _make_model
)


# ─── Poisson Baseline ──────────────────────────────────────────────────────────

def poisson_home_win_prob(h_xgf, a_xgf, n_max=10):
    """
    Compute home win probability using Poisson model.
    Same logic as simulate_game() in predict_games.py.
    """
    HOME_OT_BONUS = 0.025

    prob_home_reg = 0.0
    prob_away_reg = 0.0
    prob_tie = 0.0

    for h_goals in range(n_max + 1):
        for a_goals in range(n_max + 1):
            p = poisson.pmf(h_goals, h_xgf) * poisson.pmf(a_goals, a_xgf)
            if h_goals > a_goals:
                prob_home_reg += p
            elif a_goals > h_goals:
                prob_away_reg += p
            else:
                prob_tie += p

    # OT model: competing exponential distributions
    if h_xgf + a_xgf > 0:
        home_ot_base = h_xgf / (h_xgf + a_xgf)
    else:
        home_ot_base = 0.5
    home_ot_frac = min(0.65, max(0.35, home_ot_base + HOME_OT_BONUS))

    h_win_prob = prob_home_reg + (prob_tie * home_ot_frac)
    return h_win_prob


def compute_poisson_predictions(features_df, team_features_df):
    """
    For each game in features_df, compute Poisson-based home win probability
    using the pre-game EWMA xGF/xGA features.
    """
    preds = []
    for _, row in features_df.iterrows():
        h_xgf = row.get('h_f_xgf', 2.8)
        a_xgf = row.get('a_f_xgf', 2.8)

        # Poisson uses team's offensive xGF vs opponent's defensive xGA
        # Simple approach: use each team's xGF as their expected goals
        h_expected = max(0.5, h_xgf)
        a_expected = max(0.5, a_xgf)

        p = poisson_home_win_prob(h_expected, a_expected)
        preds.append(max(0.15, min(0.85, p)))

    return np.array(preds)


# ─── Calibration Analysis ──────────────────────────────────────────────────────

def calibration_analysis(y_true, y_pred, n_bins=10, label="Model"):
    """Compute calibration bins and print reliability diagram."""
    bin_edges = np.linspace(0, 1, n_bins + 1)
    bin_centers = []
    bin_actuals = []
    bin_counts = []

    for i in range(n_bins):
        lo, hi = bin_edges[i], bin_edges[i + 1]
        mask = (y_pred >= lo) & (y_pred < hi)
        if mask.sum() == 0:
            continue
        bin_centers.append((lo + hi) / 2)
        bin_actuals.append(y_true[mask].mean())
        bin_counts.append(mask.sum())

    print(f"\n  Calibration — {label}:")
    print(f"  {'Predicted':>10s} {'Actual':>10s} {'Count':>8s}  {'Bar'}")
    print(f"  {'─'*10} {'─'*10} {'─'*8}  {'─'*30}")

    for center, actual, count in zip(bin_centers, bin_actuals, bin_counts):
        bar_pred = '█' * int(center * 30)
        bar_act = '▓' * int(actual * 30)
        diff = actual - center
        print(f"  {center:10.1%} {actual:10.1%} {count:8d}  {bar_act:<30s}  ({diff:+.1%})")

    # Calibration error (ECE)
    if bin_counts:
        total = sum(bin_counts)
        ece = sum(abs(a - c) * n / total
                  for c, a, n in zip(bin_centers, bin_actuals, bin_counts))
        print(f"  Expected Calibration Error (ECE): {ece:.4f}")

    return list(zip(bin_centers, bin_actuals, bin_counts))


def rolling_window_analysis(y_true, y_pred, window=100, label="Model"):
    """Compute rolling log loss over sliding windows."""
    n = len(y_true)
    if n < window:
        print(f"  Not enough games for {window}-game rolling window")
        return

    lls = []
    accs = []
    for i in range(n - window + 1):
        sl = slice(i, i + window)
        ll = log_loss(y_true[sl], y_pred[sl])
        acc = accuracy_score(y_true[sl], (y_pred[sl] >= 0.5).astype(int))
        lls.append(ll)
        accs.append(acc)

    print(f"\n  Rolling {window}-game window — {label}:")
    print(f"    LL  range: {min(lls):.4f} — {max(lls):.4f}  (mean {np.mean(lls):.4f})")
    print(f"    Acc range: {min(accs):.1%} — {max(accs):.1%}  (mean {np.mean(accs):.1%})")


# ─── Main Backtest ──────────────────────────────────────────────────────────────

def run_backtest():
    print("=" * 70)
    print("NHL Prediction Model — Backtest & Validation")
    print("=" * 70)

    # Load and prepare data (same as training pipeline)
    df = load_all_games()
    print("\n[BACKTEST] Computing features...")
    df_feat = compute_team_features(df)

    print("[BACKTEST] Building game matrix...")
    features, feature_cols = build_game_matrix(df_feat)
    features = features.sort_values('game_date').reset_index(drop=True)

    X = features[feature_cols].values
    y = features['home_win'].values
    seasons = features['season'].values
    unique_seasons = sorted(features['season'].unique())

    print(f"[BACKTEST] {len(features)} games, seasons: {unique_seasons}")
    print(f"[BACKTEST] {len(feature_cols)} features")

    # ── Walk-forward backtest ──
    all_preds_ml = []
    all_preds_poisson = []
    all_actuals = []
    all_seasons_test = []

    for i, test_season in enumerate(unique_seasons):
        if i == 0:
            continue  # need at least 1 training season

        train_mask = features['season'] < test_season
        test_mask = features['season'] == test_season

        X_train, y_train = X[train_mask], y[train_mask]
        X_test, y_test = X[test_mask], y[test_mask]
        test_df = features[test_mask]

        if len(X_train) < 100 or len(X_test) < 50:
            continue

        print(f"\n{'─'*70}")
        print(f"  Season {test_season}-{test_season+1}: "
              f"Train={len(X_train)} games, Test={len(X_test)} games")
        print(f"{'─'*70}")

        # ── ML Model ──
        model = _make_model()
        model.fit(X_train, y_train)

        # Calibrate on training data
        cal_model = CalibratedClassifierCV(model, cv=5, method='isotonic')
        cal_model.fit(X_train, y_train)

        y_pred_ml = cal_model.predict_proba(X_test)[:, 1]
        y_pred_ml = np.clip(y_pred_ml, 0.15, 0.85)

        # ── Poisson Baseline ──
        y_pred_poisson = compute_poisson_predictions(test_df, df_feat)

        # ── Naive Baseline (always predict home win rate from training data) ──
        home_wr_train = y_train.mean()
        y_pred_naive = np.full(len(y_test), home_wr_train)

        # ── Metrics ──
        results = {}
        for name, preds in [("ML Model", y_pred_ml),
                            ("Poisson", y_pred_poisson),
                            ("Naive (home WR)", y_pred_naive)]:
            ll = log_loss(y_test, preds)
            bs = brier_score_loss(y_test, preds)
            acc = accuracy_score(y_test, (preds >= 0.5).astype(int))
            home_wr = y_test.mean()
            results[name] = {'ll': ll, 'bs': bs, 'acc': acc}

            print(f"\n  {name:20s}  LL={ll:.4f}  Brier={bs:.4f}  Acc={acc:.1%}  "
                  f"(home WR={home_wr:.1%})")

        # Improvement over baselines
        ml_ll = results["ML Model"]["ll"]
        poisson_ll = results["Poisson"]["ll"]
        naive_ll = results["Naive (home WR)"]["ll"]
        print(f"\n  ML vs Poisson:     LL improvement = {poisson_ll - ml_ll:+.4f}")
        print(f"  ML vs Naive:       LL improvement = {naive_ll - ml_ll:+.4f}")

        # Calibration
        calibration_analysis(y_test, y_pred_ml, n_bins=8, label=f"ML Model ({test_season}-{test_season+1})")
        calibration_analysis(y_test, y_pred_poisson, n_bins=8, label=f"Poisson ({test_season}-{test_season+1})")

        # Rolling window (only if enough games)
        if len(y_test) >= 150:
            rolling_window_analysis(y_test, y_pred_ml, window=100, label="ML Model")

        # Accumulate for overall analysis
        all_preds_ml.extend(y_pred_ml)
        all_preds_poisson.extend(y_pred_poisson)
        all_actuals.extend(y_test)
        all_seasons_test.extend([test_season] * len(y_test))

    # ── Overall Summary ──
    if all_actuals:
        all_actuals = np.array(all_actuals)
        all_preds_ml = np.array(all_preds_ml)
        all_preds_poisson = np.array(all_preds_poisson)
        all_naive = np.full(len(all_actuals), all_actuals.mean())

        print(f"\n{'='*70}")
        print(f"  OVERALL RESULTS (all test seasons combined)")
        print(f"{'='*70}")

        for name, preds in [("ML Model", all_preds_ml),
                            ("Poisson", all_preds_poisson),
                            ("Naive", all_naive)]:
            ll = log_loss(all_actuals, preds)
            bs = brier_score_loss(all_actuals, preds)
            acc = accuracy_score(all_actuals, (preds >= 0.5).astype(int))
            print(f"  {name:20s}  LL={ll:.4f}  Brier={bs:.4f}  Acc={acc:.1%}")

        print(f"\n  Total games evaluated: {len(all_actuals)}")
        print(f"  Actual home win rate:  {all_actuals.mean():.1%}")

        # Overall calibration
        calibration_analysis(all_actuals, all_preds_ml, n_bins=10, label="ML Model (Overall)")

        # ── Blended model (60% ML + 40% Poisson — matches production config) ──
        BLEND = 0.60
        blended = BLEND * all_preds_ml + (1 - BLEND) * all_preds_poisson
        ll_blend = log_loss(all_actuals, blended)
        bs_blend = brier_score_loss(all_actuals, blended)
        acc_blend = accuracy_score(all_actuals, (blended >= 0.5).astype(int))
        print(f"\n  {'Blended (60/40)':20s}  LL={ll_blend:.4f}  Brier={bs_blend:.4f}  Acc={acc_blend:.1%}")

        calibration_analysis(all_actuals, blended, n_bins=10, label="Blended 60/40 (Overall)")

        # ── Confidence breakdown ──
        print(f"\n  Confidence Breakdown (ML Model):")
        print(f"  {'Confidence':>12s} {'Games':>8s} {'Accuracy':>10s} {'Avg Pred':>10s}")
        print(f"  {'─'*12} {'─'*8} {'─'*10} {'─'*10}")

        # Use the stronger prediction (max of h_prob, 1-h_prob) as confidence
        confidence = np.maximum(all_preds_ml, 1 - all_preds_ml)
        for lo, hi, label in [(0.50, 0.55, "50-55%"),
                              (0.55, 0.60, "55-60%"),
                              (0.60, 0.65, "60-65%"),
                              (0.65, 0.70, "65-70%"),
                              (0.70, 0.85, "70-85%")]:
            mask = (confidence >= lo) & (confidence < hi)
            if mask.sum() == 0:
                continue
            # For this bucket, compute accuracy of the FAVORED team
            favored_correct = ((all_preds_ml >= 0.5) & (all_actuals == 1)) | \
                              ((all_preds_ml < 0.5) & (all_actuals == 0))
            bucket_acc = favored_correct[mask].mean()
            avg_conf = confidence[mask].mean()
            print(f"  {label:>12s} {mask.sum():8d} {bucket_acc:10.1%} {avg_conf:10.1%}")

        # ── Benchmarks ──
        ml_ll = log_loss(all_actuals, all_preds_ml)
        print(f"\n  Benchmarks:")
        print(f"    Your model LL:       {ml_ll:.4f}")
        print(f"    Blended LL:          {ll_blend:.4f}")
        print(f"    MoneyPuck target:    0.658")
        print(f"    Gap to MoneyPuck:    {ml_ll - 0.658:+.4f}")
        print(f"    Phase 2 target:      ≤ 0.670")
        print(f"    Phase 3 target:      ≤ 0.660")

    print(f"\n{'='*70}")
    print("Backtest complete.")
    print(f"{'='*70}")


if __name__ == '__main__':
    run_backtest()
