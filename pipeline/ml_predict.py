#!/usr/bin/env python3
"""
ml_predict.py — Runtime wrapper for the ML game outcome model.

At prediction time, this module:
1. Loads the trained game_model.pkl
2. Computes EWMA features from game_stats for each team
3. Returns calibrated home win probabilities

v3: Pruned feature set (22 features), cross-season EWMA carryover.

Usage in predict_games.py:
    from ml_predict import MLPredictor
    ml = MLPredictor(game_stats_df)
    h_prob, a_prob = ml.predict(home_team, away_team, game_date, extras)
"""

import os
import json
import pickle
import numpy as np
import pandas as pd
from scipy.stats import poisson

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

class MLPredictor:
    """Runtime predictor using the trained game outcome model."""

    def __init__(self, game_stats_df, goalie_ratings=None):
        self.model = None
        self.meta = None
        self.team_features = {}
        self.available = False
        self.goalie_ratings = goalie_ratings or {}

        # Load goalie ratings from file if not passed
        if not self.goalie_ratings:
            gr_path = os.path.join(SCRIPT_DIR, 'goalie_ratings.json')
            if os.path.exists(gr_path):
                with open(gr_path, 'r') as f:
                    self.goalie_ratings = json.load(f)

        # Load model
        model_path = os.path.join(SCRIPT_DIR, 'game_model.pkl')
        meta_path = os.path.join(SCRIPT_DIR, 'game_model_meta.json')

        if not os.path.exists(model_path) or not os.path.exists(meta_path):
            print("[ML] game_model.pkl not found — ML predictions disabled")
            return

        try:
            with open(model_path, 'rb') as f:
                self.model = pickle.load(f)
            with open(meta_path, 'r') as f:
                self.meta = json.load(f)

            self.feature_cols = self.meta['feature_columns']
            self.ewma_halflife = self.meta.get('ewma_halflife', 12)

            # Pre-compute team features from game stats
            self._precompute(game_stats_df)

            self.available = True
            print(f"[ML] Model loaded: {len(self.feature_cols)} features, "
                  f"trained {self.meta.get('training_date', 'unknown')}")
            print(f"[ML] CV Log Loss: {self.meta.get('avg_log_loss', 'N/A'):.4f}")
            if self.goalie_ratings:
                print(f"[ML] Goalie ratings loaded: {len(self.goalie_ratings)} goalies")
        except Exception as e:
            print(f"[ML] Error loading model: {e}")
            self.available = False

    def _ewma(self, series):
        """EWMA with configured halflife."""
        return series.ewm(halflife=self.ewma_halflife, min_periods=1).mean()

    def _precompute(self, df):
        """Pre-compute rolling features for all teams from game stats.

        v3: Uses ALL available data (not just current season) so EWMA
        carries prior-season signal into early current-season predictions.
        """
        if df is None or df.empty:
            return

        # Also load historical data for cross-season carryover
        hist_path = os.path.join(SCRIPT_DIR, 'nhl_historical_gamestats.csv')
        if os.path.exists(hist_path):
            try:
                hist_df = pd.read_csv(hist_path, low_memory=False)
                df = pd.concat([hist_df, df], ignore_index=True)
                df = df.drop_duplicates(subset=['game_id', 'team'], keep='last')
            except Exception as e:
                print(f"[ML] Warning: Could not load historical data for carryover: {e}")

        df = df.copy()
        df['game_date'] = pd.to_datetime(df['game_date'])

        # Derive season
        df['season'] = df['game_date'].apply(
            lambda d: d.year if d.month >= 9 else d.year - 1
        )
        current_season = df['season'].max()

        # Result flag
        df['is_win'] = df['result'].isin(['RW', 'OTW', 'SOW']).astype(int)

        # Ensure numeric
        for col in ['xG_for_5v5', 'xG_against_5v5',
                     'pp_goals', 'pp_opportunities', 'pp_goals_against', 'pk_opportunities']:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')

        for team in df['team'].unique():
            # Use ALL seasons for EWMA (cross-season carryover)
            team_df = df[df['team'] == team].sort_values('game_date')

            if len(team_df) < 3:
                continue

            # Compute EWMA on full history — the LAST value is "as of now"
            feats = {}

            feats['f_xgf_5v5'] = self._ewma(team_df['xG_for_5v5']).iloc[-1]
            feats['f_xga_5v5'] = self._ewma(team_df['xG_against_5v5']).iloc[-1]

            # Season win rate (current season only)
            curr_season_df = team_df[team_df['season'] == current_season]
            feats['f_season_win_rate'] = curr_season_df['is_win'].mean() if len(curr_season_df) > 0 else 0.5

            # PP/PK from current season cumulative
            if len(curr_season_df) > 0:
                pp_goals_tot = curr_season_df['pp_goals'].sum()
                pp_opps_tot = curr_season_df['pp_opportunities'].sum()
                feats['f_pp_pct'] = pp_goals_tot / pp_opps_tot if pp_opps_tot > 0 else 0.20

                pk_ga_tot = curr_season_df['pp_goals_against'].sum()
                pk_opps_tot = curr_season_df['pk_opportunities'].sum()
                feats['f_pk_pct'] = 1.0 - (pk_ga_tot / pk_opps_tot) if pk_opps_tot > 0 else 0.80
            else:
                feats['f_pp_pct'] = 0.20
                feats['f_pk_pct'] = 0.80

            # Games played (current season)
            feats['f_games_played'] = len(curr_season_df)

            # Last game date for rest calculation
            feats['_last_game_date'] = team_df['game_date'].max()

            # Rest days (will be overridden per-prediction if available)
            feats['f_rest_days'] = 2  # default

            self.team_features[team] = feats

        print(f"[ML] Pre-computed features for {len(self.team_features)} teams")

    def _get_goalie_gsax(self, goalie_name):
        """Look up regressed GSAx/game for a goalie from goalie_ratings.json."""
        if not goalie_name or not self.goalie_ratings:
            return 0.0, 0
        data = self.goalie_ratings.get(goalie_name, {})
        return data.get('gsax_per_game', 0.0), data.get('games_played', 0)

    @staticmethod
    def _poisson_home_win_prob(h_xgf, a_xgf, n_max=10):
        """Poisson + data-driven OT model for home win probability."""
        OT_3V3_WEIGHT = 0.70
        SO_WEIGHT = 0.30
        HIST_HOME_OT_RATE = 0.536
        SO_HOME_RATE = 0.50
        EXPONENTIAL_WEIGHT = 0.60

        prob_home_reg = 0.0
        prob_tie = 0.0

        for h in range(n_max + 1):
            for a in range(n_max + 1):
                p = poisson.pmf(h, h_xgf) * poisson.pmf(a, a_xgf)
                if h > a:
                    prob_home_reg += p
                elif h == a:
                    prob_tie += p

        if (h_xgf + a_xgf) > 0:
            raw_exp = h_xgf / (h_xgf + a_xgf)
        else:
            raw_exp = 0.5

        home_3v3 = EXPONENTIAL_WEIGHT * raw_exp + (1 - EXPONENTIAL_WEIGHT) * HIST_HOME_OT_RATE
        ot_frac = OT_3V3_WEIGHT * home_3v3 + SO_WEIGHT * SO_HOME_RATE
        ot_frac = min(0.62, max(0.38, ot_frac))

        return prob_home_reg + prob_tie * ot_frac

    def predict(self, home_team, away_team, game_date,
                h_rest_days=None, a_rest_days=None,
                h_is_b2b=False, a_is_b2b=False,
                h_goalie=None, a_goalie=None):
        """
        Predict home win probability using the ML model.

        Returns: (home_win_prob, away_win_prob, home_xg, away_xg) or None
        """
        if not self.available:
            return None

        h_feats = self.team_features.get(home_team)
        a_feats = self.team_features.get(away_team)

        if h_feats is None or a_feats is None:
            return None

        # Compute rest days if not provided
        if h_rest_days is None:
            h_last = h_feats.get('_last_game_date')
            if h_last and game_date:
                h_rest_days = max(0, min(7, (pd.to_datetime(game_date) - h_last).days))
            else:
                h_rest_days = 2

        if a_rest_days is None:
            a_last = a_feats.get('_last_game_date')
            if a_last and game_date:
                a_rest_days = max(0, min(7, (pd.to_datetime(game_date) - a_last).days))
            else:
                a_rest_days = 2

        # Goalie GSAx features
        h_gsax, h_goalie_gp = self._get_goalie_gsax(h_goalie)
        a_gsax, a_goalie_gp = self._get_goalie_gsax(a_goalie)

        # Build feature vector matching training feature order
        feat_dict = {}

        # Per-team features
        for key in ['f_xgf_5v5', 'f_xga_5v5', 'f_pp_pct', 'f_pk_pct',
                     'f_season_win_rate', 'f_games_played']:
            feat_dict[f'h_{key}'] = float(h_feats.get(key, 0))
            feat_dict[f'a_{key}'] = float(a_feats.get(key, 0))

        # Goalie features
        feat_dict['h_f_goalie_gsax'] = float(h_gsax)
        feat_dict['a_f_goalie_gsax'] = float(a_gsax)
        feat_dict['h_f_goalie_gp'] = float(h_goalie_gp)
        feat_dict['a_f_goalie_gp'] = float(a_goalie_gp)

        # Rest
        feat_dict['h_f_rest_days'] = float(h_rest_days)
        feat_dict['a_f_rest_days'] = float(a_rest_days)

        # Differentials
        feat_dict['d_xg_net'] = ((feat_dict['h_f_xgf_5v5'] - feat_dict['h_f_xga_5v5']) -
                                  (feat_dict['a_f_xgf_5v5'] - feat_dict['a_f_xga_5v5']))
        feat_dict['d_rest'] = feat_dict['h_f_rest_days'] - feat_dict['a_f_rest_days']
        feat_dict['d_goalie_gsax'] = feat_dict['h_f_goalie_gsax'] - feat_dict['a_f_goalie_gsax']

        # Matchup interaction
        matchup_h = feat_dict['h_f_xgf_5v5'] * feat_dict['a_f_xga_5v5']
        matchup_a = feat_dict['a_f_xgf_5v5'] * feat_dict['h_f_xga_5v5']
        feat_dict['matchup_ratio'] = matchup_h / matchup_a if matchup_a > 0 else 1.0

        # Poisson-derived OT features (v4)
        h_xgf_raw = max(0.5, feat_dict['h_f_xgf_5v5'])
        a_xgf_raw = max(0.5, feat_dict['a_f_xgf_5v5'])
        feat_dict['poisson_home_wp'] = self._poisson_home_win_prob(h_xgf_raw, a_xgf_raw)
        feat_dict['poisson_tie_prob'] = sum(
            poisson.pmf(g, h_xgf_raw) * poisson.pmf(g, a_xgf_raw)
            for g in range(11)
        )

        # ── ML-derived xG (consistent with what the model sees) ──
        # Pythagorean matchup: (team offense × opponent defense) / league avg
        # This accounts for BOTH sides — a good defense suppresses opponent xG
        h_xgf = float(h_feats.get('f_xgf_5v5', 2.8))
        a_xgf = float(a_feats.get('f_xgf_5v5', 2.8))
        h_xga = float(h_feats.get('f_xga_5v5', 2.8))
        a_xga = float(a_feats.get('f_xga_5v5', 2.8))

        # League average 5v5 xG (mean of all teams' offensive rates)
        all_xgf = [float(f.get('f_xgf_5v5', 2.5)) for f in self.team_features.values()]
        league_avg = np.mean(all_xgf) if all_xgf else 2.5

        # 5v5 base: Pythagorean (team offense vs opponent defense)
        h_5v5_xg = (h_xgf * a_xga) / league_avg if league_avg > 0 else h_xgf
        a_5v5_xg = (a_xgf * h_xga) / league_avg if league_avg > 0 else a_xgf

        # PP xG contribution
        h_pp_xg = float(h_feats.get('f_pp_pct', 0.20)) * 3.5
        a_pp_xg = float(a_feats.get('f_pp_pct', 0.20)) * 3.5

        # Goalie impact: opponent goalie's GSAx adjusts expected goals
        h_xg_ml = max(0.5, h_5v5_xg + h_pp_xg - a_gsax)
        a_xg_ml = max(0.5, a_5v5_xg + a_pp_xg - h_gsax)

        # Build feature vector in the EXACT order the model expects
        try:
            X = np.array([[feat_dict.get(col, 0.0) for col in self.feature_cols]])
            X = np.nan_to_num(X, nan=0.0, posinf=1.0, neginf=-1.0)

            h_prob = self.model.predict_proba(X)[0][1]

            # Clamp to reasonable range
            h_prob = max(0.15, min(0.85, h_prob))
            a_prob = 1.0 - h_prob

            return h_prob, a_prob, round(h_xg_ml, 2), round(a_xg_ml, 2)

        except Exception as e:
            print(f"[ML] Prediction error for {home_team} vs {away_team}: {e}")
            return None
