#!/usr/bin/env python3
"""
legacy_xgb.py - the retired 24-feature XGBoost game model (v4, trained
2026-03-24), kept ONLY so retrain.py / train_game_model.py can re-run its
walk-forward backtest as the comparison baseline.  Nothing on the live path
imports this module.

Differences from the live pipeline are deliberate and documented in
game_model_meta.json -> baselines.legacy_xgb: career goalie GSAx, unshrunk
season win rate, raw (talent-adjusted) gamestats xG, no offseason regression.
The only change from the original code is the game-type filter (02/03).
"""

from season import season_file
import os
import numpy as np
import pandas as pd
from scipy.stats import poisson

try:
    from xgboost import XGBClassifier
    USE_XGB = True
except ImportError:  # pragma: no cover
    from sklearn.ensemble import GradientBoostingClassifier
    USE_XGB = False

from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import log_loss, brier_score_loss, accuracy_score

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

EWMA_HALFLIFE = 12
MIN_GAMES = 5
GOALIE_PRIOR_STRENGTH = 20

# ─── Data Loading ────────────────────────────────────────────────────────────

def load_all_games():
    """Load and combine historical + current season game data, deduplicated."""
    hist_path = os.path.join(SCRIPT_DIR, 'nhl_historical_gamestats.csv')
    curr_path = os.path.join(SCRIPT_DIR, season_file("gamestats"))

    dfs = []
    if os.path.exists(hist_path):
        dfs.append(pd.read_csv(hist_path, low_memory=False))
        pass  # print(f"[DATA] Historical: {len(dfs[-1])} rows")
    if os.path.exists(curr_path):
        dfs.append(pd.read_csv(curr_path, low_memory=False))
        pass  # print(f"[DATA] Current season: {len(dfs[-1])} rows")

    if not dfs:
        raise FileNotFoundError("No game data found")

    df = pd.concat(dfs, ignore_index=True)

    # Deduplicate — keep latest version of each (game_id, team) pair
    df = df.drop_duplicates(subset=['game_id', 'team'], keep='last')
    df = df[df['game_id'].astype(str).str[4:6].isin(['02', '03'])]

    df['game_date'] = pd.to_datetime(df['game_date'])
    df['is_win'] = df['result'].isin(['RW', 'OTW', 'SOW']).astype(int)

    # Derive season from game_date (season starts in October)
    df['season'] = df['game_date'].apply(
        lambda d: d.year if d.month >= 9 else d.year - 1
    )

    pass  # print(f"[DATA] Total: {len(df)} rows, {df['game_id'].nunique()} unique games")
    pass  # print(f"[DATA] Seasons: {sorted(df['season'].unique())}")
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
    pass  # print("[FEATURES] Computing rolling goalie GSAx...")
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
    pass  # print(f"[FEATURES] Merged: {len(merged)} games")

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
    pass  # print(f"[FEATURES] Dropped {before - len(features)} rows, kept {len(features)} games")
    pass  # print(f"[FEATURES] {len(feature_cols)} features: {feature_cols}")

    return features, feature_cols


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




def walk_forward(test_seasons=(2023, 2024, 2025), clamp=True):
    """Season-level walk-forward of the legacy XGB+Platt model.
    Returns (folds, oos) where oos has game_id, season, p_legacy."""
    df = load_all_games()
    feat = compute_team_features(df)
    X, cols = build_game_matrix(feat)
    X = X.sort_values('game_date').reset_index(drop=True)
    folds, oos = [], []
    for S in test_seasons:
        tr, te = X[X['season'] < S], X[X['season'] == S]
        if len(tr) < 100 or len(te) < 100:
            continue
        cal = CalibratedClassifierCV(_make_model(), cv=5, method='sigmoid')
        cal.fit(tr[cols].values, tr['home_win'].values)
        p = cal.predict_proba(te[cols].values)[:, 1]
        if clamp:
            p = np.clip(p, 0.25, 0.75)  # the live wrapper clamped to 25-75%
        y = te['home_win'].values
        folds.append({'test_season': int(S), 'n': int(len(te)), 'log_loss': float(log_loss(y, p)),
                      'brier': float(brier_score_loss(y, p)), 'accuracy': float(accuracy_score(y, p >= 0.5))})
        oos.append(pd.DataFrame({'game_id': te['game_id'].values, 'season': S, 'p_legacy': p}))
    return folds, (pd.concat(oos) if oos else pd.DataFrame())
