#!/usr/bin/env python3
"""
train_game_model.py — Train an ML model to predict NHL game outcomes.

Features are computed as EWMA rolling averages AS OF GAME DATE (no future leakage).
The model learns which factors actually predict wins from data.

v3 Changes:
  - Feature pruning: 62 → 22 features (remove noise, keep signal)
  - Prior-season carryover: EWMA carries across seasons naturally (no reset)
  - Goalie GSAx bug fix: per-row home_away lookup instead of group-level
  - Calibration: sigmoid (Platt scaling) instead of isotonic (less overfit)

Usage:
    python3 pipeline/train_game_model.py

Output:
    pipeline/game_model.pkl      — trained model (calibrated)
    pipeline/game_model_meta.json — feature names, training stats, validation metrics
"""

from season import season_file
import os
import sys
import json
import pickle
import warnings
import numpy as np
import pandas as pd
from datetime import datetime

warnings.filterwarnings('ignore')

try:
    from xgboost import XGBClassifier
    USE_XGB = True
    print("[MODEL] Using XGBoost")
except ImportError:
    from sklearn.ensemble import GradientBoostingClassifier
    USE_XGB = False
    print("[MODEL] XGBoost not available, using sklearn GradientBoosting")

from sklearn.metrics import log_loss, brier_score_loss, accuracy_score
from sklearn.calibration import CalibratedClassifierCV
from scipy.stats import poisson

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# ─── Configuration ───────────────────────────────────────────────────────────
EWMA_HALFLIFE = 12     # Games — heavier recency weighting
MIN_GAMES = 5          # Minimum games before making reliable predictions (reduced from 10 — carryover helps early season)
GOALIE_PRIOR_STRENGTH = 20  # Bayesian prior for goalie GSAx regression

# ─── Data Loading ────────────────────────────────────────────────────────────

def load_all_games():
    """Load and combine historical + current season game data, deduplicated."""
    hist_path = os.path.join(SCRIPT_DIR, 'nhl_historical_gamestats.csv')
    curr_path = os.path.join(SCRIPT_DIR, season_file("gamestats"))

    dfs = []
    if os.path.exists(hist_path):
        dfs.append(pd.read_csv(hist_path, low_memory=False))
        print(f"[DATA] Historical: {len(dfs[-1])} rows")
    if os.path.exists(curr_path):
        dfs.append(pd.read_csv(curr_path, low_memory=False))
        print(f"[DATA] Current season: {len(dfs[-1])} rows")

    if not dfs:
        raise FileNotFoundError("No game data found")

    df = pd.concat(dfs, ignore_index=True)

    # Deduplicate — keep latest version of each (game_id, team) pair
    df = df.drop_duplicates(subset=['game_id', 'team'], keep='last')

    df['game_date'] = pd.to_datetime(df['game_date'])
    df['is_win'] = df['result'].isin(['RW', 'OTW', 'SOW']).astype(int)

    # Derive season from game_date (season starts in October)
    df['season'] = df['game_date'].apply(
        lambda d: d.year if d.month >= 9 else d.year - 1
    )

    print(f"[DATA] Total: {len(df)} rows, {df['game_id'].nunique()} unique games")
    print(f"[DATA] Seasons: {sorted(df['season'].unique())}")
    return df


# ─── Feature Engineering ─────────────────────────────────────────────────────

def ewma_col(series, halflife):
    """EWMA with exponential weighting — recent games matter more."""
    return series.ewm(halflife=halflife, min_periods=1).mean()


def compute_goalie_rolling_gsax(df):
    """
    Compute rolling GSAx per goalie across all their starts.
    Returns a dict: game_id → home_away → {gsax_pg, goalie_gp, goalie_name}
    Uses Bayesian regression: GSAx is shrunk toward 0 based on games played.
    """
    df = df.sort_values('game_date').copy()
    for col in ['xG_against', 'goals_ag']:
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)

    goalie_game_gsax = {}
    goalie_cum = {}  # goalie → {'gsax': float, 'gp': int}

    for _, row in df.iterrows():
        goalie = row.get('starting_goalie')
        if pd.isna(goalie):
            continue
        game_id = row['game_id']

        if goalie not in goalie_cum:
            goalie_cum[goalie] = {'gsax': 0.0, 'gp': 0}

        # PRE-GAME feature: use cumulative stats BEFORE this game
        cum = goalie_cum[goalie]
        if cum['gp'] > 0:
            raw_gsax_pg = cum['gsax'] / cum['gp']
            regressed = (raw_gsax_pg * cum['gp']) / (cum['gp'] + GOALIE_PRIOR_STRENGTH)
        else:
            regressed = 0.0

        if game_id not in goalie_game_gsax:
            goalie_game_gsax[game_id] = {}
        ha = row.get('home_away', '')
        goalie_game_gsax[game_id][ha] = {
            'gsax_pg': regressed,
            'goalie_gp': cum['gp'],
            'goalie_name': goalie,
        }

        # UPDATE cumulative AFTER recording the pre-game feature
        game_gsax = row['xG_against'] - row['goals_ag']
        cum['gsax'] += game_gsax
        cum['gp'] += 1

    return goalie_game_gsax


def compute_team_features(df):
    """
    Compute pre-game features per team using EWMA on prior games.

    v3: NO season boundary reset — EWMA carries across seasons naturally.
    This provides prior-season carryover for early-season predictions.
    With halflife=12, after 12 new-season games the prior has 50% weight,
    after 24 games only 25% — a smooth transition.
    """
    df = df.sort_values(['team', 'game_date']).copy()

    # Ensure numeric columns
    numeric_cols = ['xG_for_5v5', 'xG_against_5v5', 'xG_for', 'xG_against',
                    'goals_for', 'goals_ag',
                    'pp_goals', 'pp_opportunities', 'pp_goals_against', 'pk_opportunities',
                    'is_win']

    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    # Pre-compute rolling goalie GSAx for all games
    print("[FEATURES] Computing rolling goalie GSAx...")
    goalie_game_gsax = compute_goalie_rolling_gsax(df)

    # Derive season for per-season PP/PK and season_win_rate
    df['season'] = df['game_date'].apply(
        lambda d: d.year if d.month >= 9 else d.year - 1
    )

    result_dfs = []

    # Group by TEAM ONLY (no season reset) — enables prior-season carryover
    for team, grp in df.groupby('team'):
        grp = grp.sort_values('game_date').copy()

        if len(grp) < 3:
            continue

        # ── EWMA features with shift(1) to prevent future leakage ──

        # Core 5v5 xG rates (the gold standard of team quality)
        grp['f_xgf_5v5'] = ewma_col(grp['xG_for_5v5'].shift(1), EWMA_HALFLIFE)
        grp['f_xga_5v5'] = ewma_col(grp['xG_against_5v5'].shift(1), EWMA_HALFLIFE)

        # Season win rate (expanding mean WITHIN each season — resets each year)
        grp['f_season_win_rate'] = grp.groupby('season')['is_win'].apply(
            lambda s: s.shift(1).expanding().mean()
        ).reset_index(level=0, drop=True)

        # PP/PK efficiency — cumulative within season (resets each year)
        for season_val, sgrp_idx in grp.groupby('season').groups.items():
            sgrp = grp.loc[sgrp_idx]
            pp_goals_cum = sgrp['pp_goals'].shift(1).cumsum()
            pp_opps_cum = sgrp['pp_opportunities'].shift(1).cumsum()
            grp.loc[sgrp_idx, 'f_pp_pct'] = np.where(pp_opps_cum > 0, pp_goals_cum / pp_opps_cum, 0.20)

            pk_ga_cum = sgrp['pp_goals_against'].shift(1).cumsum()
            pk_opps_cum = sgrp['pk_opportunities'].shift(1).cumsum()
            grp.loc[sgrp_idx, 'f_pk_pct'] = np.where(pk_opps_cum > 0, 1.0 - (pk_ga_cum / pk_opps_cum), 0.80)

        # Rest days
        grp['f_rest_days'] = grp['game_date'].diff().dt.days.fillna(3).clip(0, 7)

        # Games played within season (resets each year — proxy for sample size)
        grp['f_games_played'] = grp.groupby('season').cumcount() + 1

        # ── Goalie GSAx — per-row home_away lookup (BUG FIX from v2) ──
        gsax_vals = []
        goalie_gp_vals = []
        for _, row in grp.iterrows():
            ha = row.get('home_away', '')
            game_data = goalie_game_gsax.get(row['game_id'], {}).get(ha, {})
            gsax_vals.append(game_data.get('gsax_pg', 0.0))
            goalie_gp_vals.append(game_data.get('goalie_gp', 0))
        grp['f_goalie_gsax'] = gsax_vals
        grp['f_goalie_gp'] = goalie_gp_vals

        result_dfs.append(grp)

    return pd.concat(result_dfs, ignore_index=True)


def _poisson_ot_prob(h_xgf, a_xgf):
    """
    Compute home OT win probability using data-driven OT/SO model.

    Based on 5 seasons of NHL data (2021-2026, 1,424 OT+SO games):
      - 70% of OT games end in 3v3 (team quality matters)
      - 30% go to shootout (coin flip — 50.1% home win rate)
      - 3v3: competing exponential blended with 53.6% historical base rate
    """
    OT_3V3_WEIGHT = 0.70
    SO_WEIGHT = 0.30
    HIST_HOME_OT_RATE = 0.536
    SO_HOME_RATE = 0.50
    EXPONENTIAL_WEIGHT = 0.60

    if (h_xgf + a_xgf) > 0:
        raw_exp = h_xgf / (h_xgf + a_xgf)
    else:
        raw_exp = 0.5

    home_3v3 = EXPONENTIAL_WEIGHT * raw_exp + (1 - EXPONENTIAL_WEIGHT) * HIST_HOME_OT_RATE
    return OT_3V3_WEIGHT * home_3v3 + SO_WEIGHT * SO_HOME_RATE


def _poisson_home_win_prob(h_xgf, a_xgf, n_max=10):
    """Full Poisson + OT model home win probability."""
    prob_home_reg = 0.0
    prob_away_reg = 0.0
    prob_tie = 0.0

    for h in range(n_max + 1):
        for a in range(n_max + 1):
            p = poisson.pmf(h, h_xgf) * poisson.pmf(a, a_xgf)
            if h > a:
                prob_home_reg += p
            elif a > h:
                prob_away_reg += p
            else:
                prob_tie += p

    ot_frac = _poisson_ot_prob(h_xgf, a_xgf)
    ot_frac = min(0.62, max(0.38, ot_frac))
    return prob_home_reg + prob_tie * ot_frac


def build_game_matrix(df_feat):
    """Build one row per game from home-team perspective with matchup features.

    v4: 24 features (was 22). Added Poisson-derived win probability and
    estimated tie probability as features so the ML model can learn OT dynamics.
    """

    home = df_feat[df_feat['home_away'] == 'Home'].copy()
    away = df_feat[df_feat['home_away'] == 'Away'].copy()

    # Merge on game_id
    merged = home.merge(away, on='game_id', suffixes=('_h', '_a'))
    print(f"[FEATURES] Merged: {len(merged)} games")

    features = pd.DataFrame()
    features['game_id'] = merged['game_id']
    features['game_date'] = merged['game_date_h']
    features['season'] = merged['season_h']

    # ── Per-team features (9 each × 2 sides = 18) ──
    team_feat_keys = [
        'f_xgf_5v5', 'f_xga_5v5',           # 5v5 xG (offensive + defensive quality)
        'f_pp_pct', 'f_pk_pct',               # Special teams (repeatable, high-impact)
        'f_goalie_gsax', 'f_goalie_gp',        # Goalie quality (Bayesian-regressed)
        'f_rest_days',                         # Rest advantage
        'f_season_win_rate',                   # Overall team quality
        'f_games_played',                      # Sample size / early-season proxy
    ]

    for col in team_feat_keys:
        features[f'h_{col}'] = merged[f'{col}_h'].astype(float)
        features[f'a_{col}'] = merged[f'{col}_a'].astype(float)

    # ── Differential features (3) ──
    # xG net differential: THE single best predictor of team quality gap
    features['d_xg_net'] = (features['h_f_xgf_5v5'] - features['h_f_xga_5v5']) - \
                            (features['a_f_xgf_5v5'] - features['a_f_xga_5v5'])
    # Rest differential
    features['d_rest'] = features['h_f_rest_days'] - features['a_f_rest_days']
    # Goalie quality differential
    features['d_goalie_gsax'] = features['h_f_goalie_gsax'] - features['a_f_goalie_gsax']

    # ── Matchup interaction (1) ──
    # (home offense × away defense) / (away offense × home defense)
    matchup_h = features['h_f_xgf_5v5'] * features['a_f_xga_5v5']
    matchup_a = features['a_f_xgf_5v5'] * features['h_f_xga_5v5']
    features['matchup_ratio'] = matchup_h / matchup_a.replace(0, 1)

    # ── Poisson-derived OT features (2) ──
    # Pre-computed Poisson win probability — gives the ML model a strong
    # analytical prior to learn from, especially for OT-likely close games
    features['poisson_home_wp'] = features.apply(
        lambda r: _poisson_home_win_prob(
            max(0.5, r['h_f_xgf_5v5']),
            max(0.5, r['a_f_xgf_5v5'])
        ), axis=1
    )
    # Estimated tie probability — tells the model how likely OT is for this matchup
    # (close xG matchups → high tie prob → OT dynamics matter more)
    features['poisson_tie_prob'] = features.apply(
        lambda r: sum(
            poisson.pmf(g, max(0.5, r['h_f_xgf_5v5'])) *
            poisson.pmf(g, max(0.5, r['a_f_xgf_5v5']))
            for g in range(11)
        ), axis=1
    )

    # ── Target ──
    features['home_win'] = merged['is_win_h'].astype(int)

    # Select feature columns (everything except metadata and target)
    meta_cols = ['game_id', 'game_date', 'season', 'home_win']
    feature_cols = [c for c in features.columns if c not in meta_cols]

    # Drop rows with NaN (early-season games)
    before = len(features)
    features = features.dropna(subset=feature_cols)
    print(f"[FEATURES] Dropped {before - len(features)} rows, kept {len(features)} games")
    print(f"[FEATURES] {len(feature_cols)} features: {feature_cols}")

    return features, feature_cols


# ─── Model Training ──────────────────────────────────────────────────────────

def train_model(features, feature_cols):
    """Train with time-series CV — train on older seasons, test on newer."""

    features = features.sort_values('game_date').reset_index(drop=True)
    X = features[feature_cols].values
    y = features['home_win'].values
    seasons = features['season'].values

    unique_seasons = sorted(features['season'].unique())
    print(f"[CV] Seasons available: {unique_seasons}")

    cv_results = []

    # Walk-forward validation: for each season, train on all prior seasons + test on that season
    for i, test_season in enumerate(unique_seasons):
        if i == 0:
            continue  # Need at least 1 season to train on

        train_mask = features['season'] < test_season
        test_mask = features['season'] == test_season

        X_train, y_train = X[train_mask], y[train_mask]
        X_test, y_test = X[test_mask], y[test_mask]

        if len(X_train) < 100 or len(X_test) < 100:
            continue

        # Train + calibrate on training data
        raw_model = _make_model()
        raw_model.fit(X_train, y_train)

        # Calibrate with Platt scaling (sigmoid) — less overfit than isotonic
        cal_model = CalibratedClassifierCV(raw_model, cv=5, method='sigmoid')
        cal_model.fit(X_train, y_train)

        y_proba = cal_model.predict_proba(X_test)[:, 1]
        y_pred = (y_proba >= 0.5).astype(int)

        ll = log_loss(y_test, y_proba)
        bs = brier_score_loss(y_test, y_proba)
        acc = accuracy_score(y_test, y_pred)
        home_rate = y_test.mean()

        # Also evaluate uncalibrated for comparison
        y_proba_raw = raw_model.predict_proba(X_test)[:, 1]
        ll_raw = log_loss(y_test, y_proba_raw)

        cv_results.append({
            'test_season': int(test_season),
            'train_size': int(len(X_train)),
            'test_size': int(len(X_test)),
            'log_loss': float(ll),
            'log_loss_raw': float(ll_raw),
            'brier_score': float(bs),
            'accuracy': float(acc),
            'home_win_rate': float(home_rate)
        })

        print(f"  Season {test_season}-{test_season+1}: "
              f"LL={ll:.4f} (raw={ll_raw:.4f}) BS={bs:.4f} Acc={acc:.1%} "
              f"(train={len(X_train)}, test={len(X_test)}, home_wr={home_rate:.1%})")

    # Chronological 75/25 holdout split
    n = len(X)
    split_idx = int(n * 0.75)

    X_train_final, y_train_final = X[:split_idx], y[:split_idx]
    X_val, y_val = X[split_idx:], y[split_idx:]

    model_check = _make_model()
    model_check.fit(X_train_final, y_train_final)

    cal_check = CalibratedClassifierCV(model_check, cv=5, method='sigmoid')
    cal_check.fit(X_train_final, y_train_final)

    y_proba_val = cal_check.predict_proba(X_val)[:, 1]

    holdout_ll = log_loss(y_val, y_proba_val)
    holdout_acc = accuracy_score(y_val, (y_proba_val >= 0.5).astype(int))
    holdout_bs = brier_score_loss(y_val, y_proba_val)

    # Also raw for comparison
    y_proba_val_raw = model_check.predict_proba(X_val)[:, 1]
    holdout_ll_raw = log_loss(y_val, y_proba_val_raw)

    print(f"\n  Holdout (75/25 split): LL={holdout_ll:.4f} (raw={holdout_ll_raw:.4f}) "
          f"BS={holdout_bs:.4f} Acc={holdout_acc:.1%}")

    # Train final model on ALL data
    print(f"\n[TRAIN] Training final model on all {len(X)} games...")
    final_model = _make_model()
    final_model.fit(X, y)

    # Calibrate with Platt scaling
    print("[TRAIN] Platt scaling calibration (sigmoid, 5-fold)...")
    cal_model = CalibratedClassifierCV(final_model, cv=5, method='sigmoid')
    cal_model.fit(X, y)

    # Feature importance
    importances = final_model.feature_importances_
    ranking = sorted(zip(feature_cols, importances.tolist()), key=lambda x: x[1], reverse=True)

    print("\n[IMPORTANCE] Feature ranking:")
    for feat, imp in ranking:
        bar = '█' * int(imp * 100)
        print(f"  {feat:30s} {imp:.4f} {bar}")

    # Summary
    if cv_results:
        avg_ll = np.mean([r['log_loss'] for r in cv_results])
        avg_bs = np.mean([r['brier_score'] for r in cv_results])
        avg_acc = np.mean([r['accuracy'] for r in cv_results])
    else:
        avg_ll, avg_bs, avg_acc = holdout_ll, holdout_bs, holdout_acc

    print(f"\n{'='*60}")
    print(f"[RESULTS] Cross-Validation Averages:")
    print(f"  Log Loss:    {avg_ll:.4f}")
    print(f"  Brier Score: {avg_bs:.4f}")
    print(f"  Accuracy:    {avg_acc:.1%}")
    print(f"  Holdout LL:  {holdout_ll:.4f}")
    print(f"{'='*60}")

    return cal_model, final_model, cv_results, ranking, {
        'holdout_log_loss': holdout_ll,
        'holdout_accuracy': holdout_acc,
        'holdout_brier': holdout_bs
    }


def _make_model():
    """Create a fresh model instance."""
    if USE_XGB:
        return XGBClassifier(
            n_estimators=300,
            max_depth=3,
            learning_rate=0.03,
            subsample=0.75,
            colsample_bytree=0.80,    # Slightly higher — fewer features now
            min_child_weight=10,
            reg_alpha=0.5,
            reg_lambda=2.0,
            gamma=0.1,
            random_state=42,
            eval_metric='logloss',
            verbosity=0
        )
    else:
        return GradientBoostingClassifier(
            n_estimators=300,
            max_depth=3,
            learning_rate=0.03,
            subsample=0.75,
            min_samples_leaf=15,
            random_state=42
        )


# ─── Save ────────────────────────────────────────────────────────────────────

def save_model(cal_model, raw_model, feature_cols, cv_results, ranking, holdout):
    model_path = os.path.join(SCRIPT_DIR, 'game_model.pkl')
    meta_path = os.path.join(SCRIPT_DIR, 'game_model_meta.json')
    raw_path = os.path.join(SCRIPT_DIR, 'game_model_raw.pkl')

    with open(model_path, 'wb') as f:
        pickle.dump(cal_model, f)
    with open(raw_path, 'wb') as f:
        pickle.dump(raw_model, f)

    meta = {
        'feature_columns': feature_cols,
        'training_date': datetime.now().isoformat(),
        'ewma_halflife': EWMA_HALFLIFE,
        'min_games': MIN_GAMES,
        'cv_results': cv_results,
        'holdout': holdout,
        'avg_log_loss': float(np.mean([r['log_loss'] for r in cv_results])) if cv_results else holdout['holdout_log_loss'],
        'avg_accuracy': float(np.mean([r['accuracy'] for r in cv_results])) if cv_results else holdout['holdout_accuracy'],
        'feature_importance': [{'feature': f, 'importance': float(i)} for f, i in ranking],
        'model_type': 'XGBoost' if USE_XGB else 'GradientBoosting',
        'calibration': 'sigmoid_5fold'
    }

    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2, default=str)

    print(f"\n[SAVE] Model → {model_path}")
    print(f"[SAVE] Meta  → {meta_path}")


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("NHL Game Outcome Model — Training Pipeline v3")
    print("  Feature pruning (62→22), prior-season carryover,")
    print("  goalie lookup fix, Platt calibration")
    print("=" * 60)

    df = load_all_games()

    print("\n[FEATURES] Computing EWMA pre-game features (cross-season carryover)...")
    df_feat = compute_team_features(df)

    print("\n[FEATURES] Building game-level matchup matrix...")
    features, feature_cols = build_game_matrix(df_feat)

    print(f"\n[TRAIN] Training model with {len(feature_cols)} features...")
    print(f"[TRAIN] Walk-forward cross-validation by season:\n")
    cal_model, raw_model, cv_results, ranking, holdout = train_model(features, feature_cols)

    save_model(cal_model, raw_model, feature_cols, cv_results, ranking, holdout)
    print("\n✅ Training complete!")


if __name__ == '__main__':
    main()
