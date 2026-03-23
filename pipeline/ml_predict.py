#!/usr/bin/env python3
"""
ml_predict.py — Runtime wrapper for the ML game outcome model.

At prediction time, this module:
1. Loads the trained game_model.pkl
2. Computes EWMA features from game_stats for each team
3. Returns calibrated home win probabilities

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

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

class MLPredictor:
    """Runtime predictor using the trained game outcome model."""
    
    def __init__(self, game_stats_df, goalie_ratings=None):
        """
        Args:
            game_stats_df: The season gamestats DataFrame (same as used in pipeline)
            goalie_ratings: Optional goalie ratings dict (from goalie_ratings.json)
        """
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
            has_goalie = any('goalie' in c for c in self.feature_cols)
            print(f"[ML] Model loaded: {len(self.feature_cols)} features "
                  f"(goalie={'yes' if has_goalie else 'no'}), "
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
        """Pre-compute rolling features for all teams from game stats."""
        if df is None or df.empty:
            return
            
        df = df.copy()
        df['game_date'] = pd.to_datetime(df['game_date'])
        
        # Derive season
        df['season'] = df['game_date'].apply(
            lambda d: d.year if d.month >= 9 else d.year - 1
        )
        
        # Result flag
        df['is_win'] = df['result'].isin(['RW', 'OTW', 'SOW']).astype(int)
        
        # Ensure numeric
        for col in ['xG_for_5v5', 'xG_against_5v5', 'xG_for', 'xG_against',
                     'goals_for', 'goals_ag', 'sog_for', 'sog_ag',
                     'pp_goals', 'pp_opportunities', 'pp_goals_against', 'pk_opportunities',
                     'save_percentage', 'attempts_for', 'attempts_ag']:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')
        
        # Current season only for predictions
        current_season = df['season'].max()
        
        for team in df['team'].unique():
            team_df = df[(df['team'] == team) & (df['season'] == current_season)].sort_values('game_date')
            
            if len(team_df) < 3:
                continue
            
            # Compute features on ALL data (the LAST value is the "as of now" feature set)
            feats = {}
            
            feats['f_xgf_5v5'] = self._ewma(team_df['xG_for_5v5']).iloc[-1]
            feats['f_xga_5v5'] = self._ewma(team_df['xG_against_5v5']).iloc[-1] 
            feats['f_xgf'] = self._ewma(team_df['xG_for']).iloc[-1]
            feats['f_xga'] = self._ewma(team_df['xG_against']).iloc[-1]
            feats['f_gf'] = self._ewma(team_df['goals_for']).iloc[-1]
            feats['f_ga'] = self._ewma(team_df['goals_ag']).iloc[-1]
            feats['f_sf'] = self._ewma(team_df['sog_for']).iloc[-1]
            feats['f_sa'] = self._ewma(team_df['sog_ag']).iloc[-1]
            feats['f_win_rate'] = self._ewma(team_df['is_win'].astype(float)).iloc[-1]
            feats['f_season_win_rate'] = team_df['is_win'].mean()
            
            if 'save_percentage' in team_df.columns:
                sv = team_df['save_percentage'].astype(float)
                sv = sv[sv > 0]  # filter out 0s
                feats['f_sv_pct'] = self._ewma(sv).iloc[-1] if len(sv) > 0 else 0.910
            else:
                feats['f_sv_pct'] = 0.910
            
            # PP/PK from season cumulative
            pp_goals_tot = team_df['pp_goals'].sum()
            pp_opps_tot = team_df['pp_opportunities'].sum()
            feats['f_pp_pct'] = pp_goals_tot / pp_opps_tot if pp_opps_tot > 0 else 0.20
            
            pk_ga_tot = team_df['pp_goals_against'].sum()
            pk_opps_tot = team_df['pk_opportunities'].sum()
            feats['f_pk_pct'] = 1.0 - (pk_ga_tot / pk_opps_tot) if pk_opps_tot > 0 else 0.80
            
            # Corsi%
            af = team_df['attempts_for'].astype(float)
            aa = team_df['attempts_ag'].astype(float)
            cf_series = af / (af + aa)
            feats['f_cf_pct'] = self._ewma(cf_series.fillna(0.5)).iloc[-1]
            
            # Shooting talent: goals / xG 
            gf_total = team_df['goals_for'].sum()
            xgf_total = team_df['xG_for'].sum()
            feats['f_shooting_talent'] = min(2.0, max(0.5, gf_total / xgf_total)) if xgf_total > 0 else 1.0
            
            # Save talent: goals against / xG against
            ga_total = team_df['goals_ag'].sum()
            xga_total = team_df['xG_against'].sum()
            feats['f_save_talent'] = min(2.0, max(0.5, ga_total / xga_total)) if xga_total > 0 else 1.0
            
            # Games played
            feats['f_games_played'] = len(team_df)
            
            # Last game date for rest calculation
            feats['_last_game_date'] = team_df['game_date'].max()
            
            # Fatigue: check last game's flags (most recent)
            feats['f_is_b2b'] = int(team_df['is_b2b'].iloc[-1]) if 'is_b2b' in team_df.columns else 0
            feats['f_is_3in4'] = int(team_df['is_3in4'].iloc[-1]) if 'is_3in4' in team_df.columns else 0
            
            self.team_features[team] = feats
        
        print(f"[ML] Pre-computed features for {len(self.team_features)} teams")
    
    def _get_goalie_gsax(self, goalie_name):
        """Look up regressed GSAx/game for a goalie from goalie_ratings.json."""
        if not goalie_name or not self.goalie_ratings:
            return 0.0, 0
        data = self.goalie_ratings.get(goalie_name, {})
        return data.get('gsax_per_game', 0.0), data.get('games_played', 0)

    def predict(self, home_team, away_team, game_date,
                h_rest_days=None, a_rest_days=None,
                h_is_b2b=False, a_is_b2b=False,
                h_goalie=None, a_goalie=None):
        """
        Predict home win probability using the ML model.

        Args:
            h_goalie/a_goalie: Starting goalie names (for GSAx lookup)

        Returns: (home_win_prob, away_win_prob) or None if model unavailable
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

        # Override b2b if provided
        h_b2b = int(h_is_b2b) if h_is_b2b else h_feats.get('f_is_b2b', 0)
        a_b2b = int(a_is_b2b) if a_is_b2b else a_feats.get('f_is_b2b', 0)

        # Goalie GSAx features
        h_gsax, h_goalie_gp = self._get_goalie_gsax(h_goalie)
        a_gsax, a_goalie_gp = self._get_goalie_gsax(a_goalie)

        # Build feature vector matching training feature order
        feat_dict = {}

        # Home team raw features
        for key in ['f_xgf_5v5', 'f_xga_5v5', 'f_xgf', 'f_xga', 'f_gf', 'f_ga',
                     'f_sf', 'f_sa', 'f_win_rate', 'f_season_win_rate', 'f_sv_pct',
                     'f_pp_pct', 'f_pk_pct', 'f_cf_pct', 'f_shooting_talent',
                     'f_save_talent', 'f_games_played']:
            feat_dict[f'h_{key}'] = float(h_feats.get(key, 0))

        # Away team raw features
        for key in ['f_xgf_5v5', 'f_xga_5v5', 'f_xgf', 'f_xga', 'f_gf', 'f_ga',
                     'f_sf', 'f_sa', 'f_win_rate', 'f_season_win_rate', 'f_sv_pct',
                     'f_pp_pct', 'f_pk_pct', 'f_cf_pct', 'f_shooting_talent',
                     'f_save_talent', 'f_games_played']:
            feat_dict[f'a_{key}'] = float(a_feats.get(key, 0))

        # Goalie features
        feat_dict['h_f_goalie_gsax'] = float(h_gsax)
        feat_dict['a_f_goalie_gsax'] = float(a_gsax)
        feat_dict['h_f_goalie_gp'] = float(h_goalie_gp)
        feat_dict['a_f_goalie_gp'] = float(a_goalie_gp)

        # Schedule features
        feat_dict['h_f_rest_days'] = float(h_rest_days)
        feat_dict['a_f_rest_days'] = float(a_rest_days)
        feat_dict['h_f_is_b2b'] = float(h_b2b)
        feat_dict['a_f_is_b2b'] = float(a_b2b)
        feat_dict['h_f_is_3in4'] = float(h_feats.get('f_is_3in4', 0))
        feat_dict['a_f_is_3in4'] = float(a_feats.get('f_is_3in4', 0))

        # Differential features
        feat_dict['d_xgf_5v5'] = feat_dict['h_f_xgf_5v5'] - feat_dict['a_f_xgf_5v5']
        feat_dict['d_xga_5v5'] = feat_dict['h_f_xga_5v5'] - feat_dict['a_f_xga_5v5']
        feat_dict['d_xg_net'] = ((feat_dict['h_f_xgf_5v5'] - feat_dict['h_f_xga_5v5']) -
                                  (feat_dict['a_f_xgf_5v5'] - feat_dict['a_f_xga_5v5']))
        feat_dict['d_win_rate'] = feat_dict['h_f_win_rate'] - feat_dict['a_f_win_rate']
        feat_dict['d_sv_pct'] = feat_dict['h_f_sv_pct'] - feat_dict['a_f_sv_pct']
        feat_dict['d_pp_pct'] = feat_dict['h_f_pp_pct'] - feat_dict['a_f_pp_pct']
        feat_dict['d_pk_pct'] = feat_dict['h_f_pk_pct'] - feat_dict['a_f_pk_pct']
        feat_dict['d_cf_pct'] = feat_dict['h_f_cf_pct'] - feat_dict['a_f_cf_pct']
        feat_dict['d_rest'] = feat_dict['h_f_rest_days'] - feat_dict['a_f_rest_days']
        feat_dict['d_shooting_talent'] = feat_dict['h_f_shooting_talent'] - feat_dict['a_f_shooting_talent']
        feat_dict['d_save_talent'] = feat_dict['h_f_save_talent'] - feat_dict['a_f_save_talent']
        feat_dict['d_season_wr'] = feat_dict['h_f_season_win_rate'] - feat_dict['a_f_season_win_rate']
        feat_dict['d_goalie_gsax'] = feat_dict['h_f_goalie_gsax'] - feat_dict['a_f_goalie_gsax']

        # Matchup interactions
        matchup_h = feat_dict['h_f_xgf_5v5'] * feat_dict['a_f_xga_5v5']
        matchup_a = feat_dict['a_f_xgf_5v5'] * feat_dict['h_f_xga_5v5']
        feat_dict['matchup_h_off_vs_a_def'] = matchup_h
        feat_dict['matchup_a_off_vs_h_def'] = matchup_a
        feat_dict['matchup_ratio'] = matchup_h / matchup_a if matchup_a > 0 else 1.0

        # Build feature vector in the EXACT order the model expects
        try:
            X = np.array([[feat_dict.get(col, 0.0) for col in self.feature_cols]])

            # Handle any NaN/inf
            X = np.nan_to_num(X, nan=0.0, posinf=1.0, neginf=-1.0)

            h_prob = self.model.predict_proba(X)[0][1]

            # Clamp to reasonable range
            h_prob = max(0.15, min(0.85, h_prob))
            a_prob = 1.0 - h_prob

            return h_prob, a_prob

        except Exception as e:
            print(f"[ML] Prediction error for {home_team} vs {away_team}: {e}")
            return None
