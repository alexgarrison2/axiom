#!/usr/bin/env python3
"""
train_game_model.py — Train an ML model to predict NHL game outcomes.

Instead of Poisson simulation + hand-tuned adjustments, this trains an
XGBoost classifier on historical game-level features.

Features are computed as EWMA rolling averages AS OF GAME DATE (no future leakage).
The model learns which factors actually predict wins from data.

Usage:
    python3 pipeline/train_game_model.py

Output:
    pipeline/game_model.pkl      — trained model (calibrated)
    pipeline/game_model_meta.json — feature names, training stats, validation metrics
"""

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

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# ─── Configuration ───────────────────────────────────────────────────────────
EWMA_HALFLIFE = 12     # Games — heavier recency weighting
MIN_GAMES = 10         # Minimum games before making reliable predictions
SEASON_REGRESS = 0.30  # Regress season start toward league avg this much

# ─── Data Loading ────────────────────────────────────────────────────────────

def load_all_games():
    """Load and combine historical + current season game data, deduplicated."""
    hist_path = os.path.join(SCRIPT_DIR, 'nhl_historical_gamestats.csv')
    curr_path = os.path.join(SCRIPT_DIR, 'nhl_season_2025_2026_gamestats.csv')
    
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
    df['is_ot_game'] = df['result'].isin(['OTW', 'OTL', 'SOW', 'SOL']).astype(int)
    
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


def compute_team_features(df):
    """
    Compute pre-game features per team using EWMA on prior games.
    Season boundaries reset the rolling stats.
    """
    df = df.sort_values(['team', 'season', 'game_date']).copy()
    
    # Ensure numeric columns
    numeric_cols = ['xG_for_5v5', 'xG_against_5v5', 'xG_for', 'xG_against',
                    'goals_for', 'goals_ag', 'sog_for', 'sog_ag',
                    'pp_goals', 'pp_opportunities', 'pp_goals_against', 'pk_opportunities',
                    'save_percentage', 'attempts_for', 'attempts_ag', 'is_win']
    
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    
    result_dfs = []
    
    for (team, season), grp in df.groupby(['team', 'season']):
        grp = grp.sort_values('game_date').copy()
        
        if len(grp) < 3:
            continue
        
        # EWMA features — shift(1) ensures NO FUTURE LEAKAGE
        # (each row uses only data from games BEFORE this one)
        
        # Core xG rates
        grp['f_xgf_5v5'] = ewma_col(grp['xG_for_5v5'].shift(1), EWMA_HALFLIFE)
        grp['f_xga_5v5'] = ewma_col(grp['xG_against_5v5'].shift(1), EWMA_HALFLIFE)
        grp['f_xgf'] = ewma_col(grp['xG_for'].shift(1), EWMA_HALFLIFE)
        grp['f_xga'] = ewma_col(grp['xG_against'].shift(1), EWMA_HALFLIFE)
        
        # Goals
        grp['f_gf'] = ewma_col(grp['goals_for'].shift(1), EWMA_HALFLIFE)
        grp['f_ga'] = ewma_col(grp['goals_ag'].shift(1), EWMA_HALFLIFE)
        
        # Shots
        grp['f_sf'] = ewma_col(grp['sog_for'].shift(1), EWMA_HALFLIFE)
        grp['f_sa'] = ewma_col(grp['sog_ag'].shift(1), EWMA_HALFLIFE)
        
        # Win rate
        grp['f_win_rate'] = ewma_col(grp['is_win'].astype(float).shift(1), EWMA_HALFLIFE)
        
        # Expanding season win rate
        grp['f_season_win_rate'] = grp['is_win'].shift(1).expanding().mean()
        
        # Save percentage
        if 'save_percentage' in grp.columns:
            grp['f_sv_pct'] = ewma_col(grp['save_percentage'].shift(1), EWMA_HALFLIFE)
        
        # PP/PK efficiency — compute from cumulative counts
        pp_goals_cum = grp['pp_goals'].shift(1).cumsum()
        pp_opps_cum = grp['pp_opportunities'].shift(1).cumsum()
        grp['f_pp_pct'] = np.where(pp_opps_cum > 0, pp_goals_cum / pp_opps_cum, 0.20)
        
        pk_ga_cum = grp['pp_goals_against'].shift(1).cumsum()
        pk_opps_cum = grp['pk_opportunities'].shift(1).cumsum()
        grp['f_pk_pct'] = np.where(pk_opps_cum > 0, 1.0 - (pk_ga_cum / pk_opps_cum), 0.80)
        
        # Corsi% proxy
        af = grp['attempts_for'].shift(1)
        aa = grp['attempts_ag'].shift(1)
        grp['f_cf_pct'] = ewma_col(af / (af + aa), EWMA_HALFLIFE).fillna(0.50)
        
        # xG goal conversion (actual goals / xG — shooting talent proxy)
        gf_shifted = grp['goals_for'].shift(1)
        xgf_shifted = grp['xG_for'].shift(1).replace(0, np.nan)
        grp['f_shooting_talent'] = ewma_col(gf_shifted / xgf_shifted, EWMA_HALFLIFE).clip(0.5, 2.0).fillna(1.0)
        
        # Save talent (goals against vs xG against)
        ga_shifted = grp['goals_ag'].shift(1)
        xga_shifted = grp['xG_against'].shift(1).replace(0, np.nan)
        grp['f_save_talent'] = ewma_col(ga_shifted / xga_shifted, EWMA_HALFLIFE).clip(0.5, 2.0).fillna(1.0)
        
        # Rest days
        grp['f_rest_days'] = grp['game_date'].diff().dt.days.fillna(3).clip(0, 7)
        
        # Fatigue flags
        for flag in ['is_b2b', 'is_3in4']:
            if flag in grp.columns:
                grp[f'f_{flag}'] = grp[flag].astype(int)
            else:
                grp[f'f_{flag}'] = 0
        
        # Games played
        grp['f_games_played'] = range(1, len(grp) + 1)
        
        result_dfs.append(grp)
    
    return pd.concat(result_dfs, ignore_index=True)


def build_game_matrix(df_feat):
    """Build one row per game from home-team perspective with matchup features."""
    
    home = df_feat[df_feat['home_away'] == 'Home'].copy()
    away = df_feat[df_feat['home_away'] == 'Away'].copy()
    
    # Merge on game_id — should produce exactly 1 row per game
    merged = home.merge(away, on='game_id', suffixes=('_h', '_a'))
    print(f"[FEATURES] Merged: {len(merged)} games")
    
    # Feature columns prefix 'f_'
    feat_cols_h = [c for c in home.columns if c.startswith('f_')]
    feat_cols_a = [c for c in away.columns if c.startswith('f_')]
    
    features = pd.DataFrame()
    features['game_id'] = merged['game_id']
    features['game_date'] = merged['game_date_h']
    features['season'] = merged['season_h']
    
    # ── Raw team features ──
    for col in feat_cols_h:
        features[f'h_{col}'] = merged[f'{col}_h'].astype(float)
    for col in feat_cols_a:
        features[f'a_{col}'] = merged[f'{col}_a'].astype(float)
    
    # ── Differential / interaction features ──
    # These are the most important — they capture the MATCHUP
    features['d_xgf_5v5'] = features['h_f_xgf_5v5'] - features['a_f_xgf_5v5']
    features['d_xga_5v5'] = features['h_f_xga_5v5'] - features['a_f_xga_5v5']
    features['d_xg_net'] = (features['h_f_xgf_5v5'] - features['h_f_xga_5v5']) - \
                            (features['a_f_xgf_5v5'] - features['a_f_xga_5v5'])
    features['d_win_rate'] = features['h_f_win_rate'] - features['a_f_win_rate']
    features['d_sv_pct'] = features.get('h_f_sv_pct', 0.91) - features.get('a_f_sv_pct', 0.91)
    features['d_pp_pct'] = features['h_f_pp_pct'] - features['a_f_pp_pct']
    features['d_pk_pct'] = features['h_f_pk_pct'] - features['a_f_pk_pct']
    features['d_cf_pct'] = features['h_f_cf_pct'] - features['a_f_cf_pct']
    features['d_rest'] = features['h_f_rest_days'] - features['a_f_rest_days']
    features['d_shooting_talent'] = features['h_f_shooting_talent'] - features['a_f_shooting_talent']
    features['d_save_talent'] = features['h_f_save_talent'] - features['a_f_save_talent']
    features['d_season_wr'] = features['h_f_season_win_rate'] - features['a_f_season_win_rate']
    
    # ── Matchup interaction: home offense vs away defense ──
    features['matchup_h_off_vs_a_def'] = features['h_f_xgf_5v5'] * features['a_f_xga_5v5']
    features['matchup_a_off_vs_h_def'] = features['a_f_xgf_5v5'] * features['h_f_xga_5v5']
    features['matchup_ratio'] = features['matchup_h_off_vs_a_def'] / \
                                 features['matchup_a_off_vs_h_def'].replace(0, 1)
    
    # ── Target ──
    features['home_win'] = merged['is_win_h'].astype(int)
    
    # Select feature columns (everything except metadata and target)
    meta_cols = ['game_id', 'game_date', 'season', 'home_win']
    feature_cols = [c for c in features.columns if c not in meta_cols]
    
    # Drop rows with NaN (early-season games)
    before = len(features)
    features = features.dropna(subset=feature_cols)
    print(f"[FEATURES] Dropped {before - len(features)} rows, kept {len(features)} games")
    print(f"[FEATURES] {len(feature_cols)} features")
    
    return features, feature_cols


# ─── Model Training ──────────────────────────────────────────────────────────

def train_model(features, feature_cols):
    """Train with time-series CV — train on older seasons, test on newer."""
    
    features = features.sort_values('game_date').reset_index(drop=True)
    X = features[feature_cols].values
    y = features['home_win'].values
    seasons = features['season'].values
    dates = features['game_date'].values
    
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
        
        model = _make_model()
        model.fit(X_train, y_train)
        
        y_proba = model.predict_proba(X_test)[:, 1]
        y_pred = (y_proba >= 0.5).astype(int)
        
        ll = log_loss(y_test, y_proba)
        bs = brier_score_loss(y_test, y_proba)
        acc = accuracy_score(y_test, y_pred)
        
        home_rate = y_test.mean()
        
        cv_results.append({
            'test_season': int(test_season),
            'train_size': int(len(X_train)),
            'test_size': int(len(X_test)),
            'log_loss': float(ll),
            'brier_score': float(bs),
            'accuracy': float(acc),
            'home_win_rate': float(home_rate)
        })
        
        print(f"  Season {test_season}-{test_season+1}: "
              f"LL={ll:.4f} BS={bs:.4f} Acc={acc:.1%} "
              f"(train={len(X_train)}, test={len(X_test)}, home_wr={home_rate:.1%})")
    
    # If walk-forward doesn't give enough folds (only 2-3 seasons), also do
    # a chronological 80/20 split within combined data
    n = len(X)
    split_idx = int(n * 0.75)
    
    X_train_final, y_train_final = X[:split_idx], y[:split_idx]
    X_val, y_val = X[split_idx:], y[split_idx:]
    
    model_check = _make_model()
    model_check.fit(X_train_final, y_train_final)
    y_proba_val = model_check.predict_proba(X_val)[:, 1]
    
    holdout_ll = log_loss(y_val, y_proba_val)
    holdout_acc = accuracy_score(y_val, (y_proba_val >= 0.5).astype(int))
    holdout_bs = brier_score_loss(y_val, y_proba_val)
    
    print(f"\n  Holdout (75/25 split): LL={holdout_ll:.4f} BS={holdout_bs:.4f} Acc={holdout_acc:.1%}")
    
    # Train final model on ALL data
    print(f"\n[TRAIN] Training final model on all {len(X)} games...")
    final_model = _make_model()
    final_model.fit(X, y)
    
    # Calibrate
    print("[TRAIN] Isotonic calibration (5-fold)...")
    cal_model = CalibratedClassifierCV(final_model, cv=5, method='isotonic')
    cal_model.fit(X, y)
    
    # Feature importance
    importances = final_model.feature_importances_
    ranking = sorted(zip(feature_cols, importances.tolist()), key=lambda x: x[1], reverse=True)
    
    print("\n[IMPORTANCE] Top 20 features:")
    for feat, imp in ranking[:20]:
        bar = '█' * int(imp * 200)
        print(f"  {feat:35s} {imp:.4f} {bar}")
    
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
            max_depth=3,         # Shallower trees = less overfit
            learning_rate=0.03,  # Slower learning = better generalization
            subsample=0.75,
            colsample_bytree=0.75,
            min_child_weight=10,  # More conservative splits
            reg_alpha=0.5,
            reg_lambda=2.0,       # Stronger regularization
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
        'calibration': 'isotonic_5fold'
    }
    
    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2, default=str)
    
    print(f"\n[SAVE] Model → {model_path}")
    print(f"[SAVE] Meta  → {meta_path}")


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("NHL Game Outcome Model — Training Pipeline v2")
    print("=" * 60)
    
    df = load_all_games()
    
    print("\n[FEATURES] Computing EWMA pre-game features (per team, per season)...")
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
