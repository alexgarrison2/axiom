import pandas as pd
import json
import os
import argparse
import numpy as np

# Determine paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR) # Parent of pipeline
PUBLIC_DATA_DIR = os.path.join(PROJECT_ROOT, 'public', 'data')

def calculate_ratings(df=None, gamestats_file='nhl_season_2025_2026_gamestats.csv', save_files=True):
    if df is None:
        print(f"Loading data from {gamestats_file}...")
        df = pd.read_csv(gamestats_file)
    
    # --- Team Ratings ---
    # print("Calculating Team Ratings...") # Reduce noise during backtest
    teams = df['team'].unique()
    team_ratings = {}
    
    # League Averages for normalization
    league_xg_for = df['xG_for'].mean()
    league_xg_for = df['xG_for'].mean()
    # Check if 5v5 data is valid (sum > 0)
    has_5v5_data = 'xG_for_5v5' in df.columns and df['xG_for_5v5'].sum() > 0
    
    if has_5v5_data:
        league_xg_5v5 = df['xG_for_5v5'].mean()
    else:
        league_xg_5v5 = df['xG_for'].mean() * 0.8 # Fallback to 80%
        
    # print(f"League Average xG: {league_xg_for:.2f}, 5v5: {league_xg_5v5:.2f} (Has Data: {has_5v5_data})")
    
    # Regression Parameters
    REGRESSION_GAMES = 10
    
    for team in teams:
        team_games = df[df['team'] == team].sort_values('game_date')
        
        # Calculate EWMA (halflife=7 games: smooth exponential decay, no cliff effect)
        rolling_xgf = team_games['xG_for'].ewm(halflife=7, min_periods=1).mean().iloc[-1]
        season_xgf = team_games['xG_for'].mean()
        
        # 5v5 xGF
        col_5v5 = 'xG_for_5v5' if has_5v5_data else 'xG_for' # Fallback
        rolling_xgf_5v5 = team_games[col_5v5].ewm(halflife=7, min_periods=1).mean().iloc[-1]
        season_xgf_5v5 = team_games[col_5v5].mean()
        season_xgf_5v5 = team_games[col_5v5].mean()
        
        # Regress Season Average to League Mean
        # (Season Sum + (Reg_Games * League_Avg)) / (Games_Played + Reg_Games)
        games_played = len(team_games)
        regressed_season_xgf = ((season_xgf * games_played) + (league_xg_for * REGRESSION_GAMES)) / (games_played + REGRESSION_GAMES)
        
        # Weighted Rating (50% Recent, 50% Regressed Season)
        # Reduced recency bias from 70/30 to 50/50 to reduce volatility
        xgf_rating = (rolling_xgf * 0.5) + (regressed_season_xgf * 0.5)
        
        # SAFETY FLOOR: If data is missing (0.0), default to LEAGUE AVERAGE per user feedback (Utah is playoff tier)
        if xgf_rating < 0.5:
             print(f"DEBUG: Patching xGF for {team} (was {xgf_rating:.2f}) -> Setting to League Avg")
             xgf_rating = league_xg_for * 1.0
        
             xgf_rating = league_xg_for * 1.0
             
        # Regress 5v5
        if has_5v5_data:
             regressed_season_5v5 = ((season_xgf_5v5 * games_played) + (league_xg_5v5 * REGRESSION_GAMES)) / (games_played + REGRESSION_GAMES)
             xgf_5v5_rating = (rolling_xgf_5v5 * 0.5) + (regressed_season_5v5 * 0.5)
        else:
             xgf_5v5_rating = xgf_rating * 0.8 # Fallback heuristic
             # print(f"DEBUG: {team} 5v5 Fallback. xgf_rating={xgf_rating:.2f} -> 5v5={xgf_5v5_rating:.2f}")
        
        # xGA Strength (Defense)
        rolling_xga = team_games['xG_against'].ewm(halflife=7, min_periods=1).mean().iloc[-1]
        season_xga = team_games['xG_against'].mean()
        
        # 5v5 xGA
        col_ga_5v5 = 'xG_against_5v5' if has_5v5_data else 'xG_against'
        rolling_xga_5v5 = team_games[col_ga_5v5].ewm(halflife=7, min_periods=1).mean().iloc[-1]
        season_xga_5v5 = team_games[col_ga_5v5].mean()
        season_xga_5v5 = team_games[col_ga_5v5].mean()
        
        # Regress to League Mean (League Avg xG For is approx League Avg xG Against)
        regressed_season_xga = ((season_xga * games_played) + (league_xg_for * REGRESSION_GAMES)) / (games_played + REGRESSION_GAMES)
        
        xga_rating = (rolling_xga * 0.5) + (regressed_season_xga * 0.5)
        
        # SAFETY FLOOR: If data is missing (0.0), default to LEAGUE AVERAGE defense
        if xga_rating < 0.5:
            xga_rating = league_xg_for * 1.0
            
        # Regress 5v5 Def
        if has_5v5_data:
             reg_season_xga_5v5 = ((season_xga_5v5 * games_played) + (league_xg_5v5 * REGRESSION_GAMES)) / (games_played + REGRESSION_GAMES)
             xga_5v5_rating = (rolling_xga_5v5 * 0.5) + (reg_season_xga_5v5 * 0.5)
        else:
             xga_5v5_rating = xga_rating * 0.8
        
        # Special Teams Ratings
        # PP% = PP Goals / PP Opps
        # PK% = 1 - (PP Goals Against / PK Opps)
        
        # Season Totals
        pp_goals = team_games['pp_goals'].sum()
        pp_opps = team_games['pp_opportunities'].sum()
        pp_pct = pp_goals / pp_opps if pp_opps > 0 else 0.20 # League Avg approx 20%
        # New: Penalties Taken/Drawn per game (Volume)
        penalties_drawn_per_game = pp_opps / games_played if games_played > 0 else 3.0
        
        pk_goals_ag = team_games['pp_goals_against'].sum()
        pk_opps = team_games['pk_opportunities'].sum()
        pk_pct = 1 - (pk_goals_ag / pk_opps) if pk_opps > 0 else 0.80 # League Avg approx 80%
        penalties_taken_per_game = pk_opps / games_played if games_played > 0 else 3.0
        
        # Weighted Special Teams Ratings (User Request: 40% L10, 50% L20, 10% Season)
        
        # Helper to calc efficiency safely
        def calc_eff(goals, opps, default=0.0):
             return goals / opps if opps > 0 else default

        # 1. Season (10%)
        # already calculated: pp_goals, pp_opps, pk_goals_ag, pk_opps
        season_pp_pct = calc_eff(pp_goals, pp_opps, 0.20)
        season_pk_pct = 1 - calc_eff(pk_goals_ag, pk_opps, 0.20)
        
        # 2. Last 20 Games (50%)
        l20_games = team_games.tail(20)
        l20_pp_goals = l20_games['pp_goals'].sum()
        l20_pp_opps = l20_games['pp_opportunities'].sum()
        l20_pp_pct = calc_eff(l20_pp_goals, l20_pp_opps, season_pp_pct)
        
        l20_pk_ga = l20_games['pp_goals_against'].sum()
        l20_pk_opps = l20_games['pk_opportunities'].sum()
        l20_pk_pct = 1 - calc_eff(l20_pk_ga, l20_pk_opps, 1 - season_pk_pct)
        
        # 3. Last 10 Games (40%)
        l10_games = team_games.tail(10)
        l10_pp_goals = l10_games['pp_goals'].sum()
        l10_pp_opps = l10_games['pp_opportunities'].sum()
        l10_pp_pct = calc_eff(l10_pp_goals, l10_pp_opps, season_pp_pct)
        
        l10_pk_ga = l10_games['pp_goals_against'].sum()
        l10_pk_opps = l10_games['pk_opportunities'].sum()
        l10_pk_pct = 1 - calc_eff(l10_pk_ga, l10_pk_opps, 1 - season_pk_pct)
        
        # Weighted Average
        # pp_rating = (l10 * 0.4) + (l20 * 0.5) + (season * 0.1)
        # Note: If < 10 games, use season for all. If < 20 games, use season for L20.
        
        w_l10 = 0.4
        w_l20 = 0.5
        w_sea = 0.1
        
        # Use Season Totals for Public Display consistency
        # User expects these to match H-Ref / Official Stats
        pp_rating = season_pp_pct * 100
        pk_rating = season_pk_pct * 100
        
        # Store weighted for potentially internal use (optional)
        # pp_rating_weighted = (season_pp_pct * 0.1) + (l20_pp_pct * 0.5) + (l10_pp_pct * 0.4)
        # pk_rating_weighted = (season_pk_pct * 0.1) + (l20_pk_pct * 0.5) + (l10_pk_pct * 0.4)

        # xG-based PP/PK rates (per opportunity)
        # More stable than goal-based PP%/PK% — same xG philosophy used throughout the model.
        # Falls back to 0.18 (league-average baseline) if xG_pp columns not yet in gamestats.
        _LEAGUE_AVG_ST_XG = 0.18
        has_pp_xg_data = 'xG_pp_for' in team_games.columns and team_games['xG_pp_for'].sum() > 0
        if has_pp_xg_data:
            pp_xgf_per_opp = team_games['xG_pp_for'].sum() / pp_opps if pp_opps > 0 else _LEAGUE_AVG_ST_XG
            pk_xga_per_opp = team_games['xG_pp_against'].sum() / pk_opps if pk_opps > 0 else _LEAGUE_AVG_ST_XG
        else:
            pp_xgf_per_opp = _LEAGUE_AVG_ST_XG
            pk_xga_per_opp = _LEAGUE_AVG_ST_XG

        team_ratings[team] = {
            'xgf_rating': xgf_rating,
            'xga_rating': xga_rating,
            'xgf_rolling': rolling_xgf,
            'xga_rolling': rolling_xga,
            'xgf_5v5_rating': xgf_5v5_rating,
            'xga_5v5_rating': xga_5v5_rating,
            'pp_rating': pp_rating,
            'pk_rating': pk_rating,
            'pp_xgf_per_opp': round(pp_xgf_per_opp, 4),
            'pk_xga_per_opp': round(pk_xga_per_opp, 4),
            'penalties_drawn_per_60': penalties_drawn_per_game,
            'penalties_taken_per_60': penalties_taken_per_game,
            'games_played': games_played
        }
        
    # --- Goalie Ratings ---
    # print("Calculating Goalie Ratings...")
    
    goalie_stats = {}
    
    # Iterate through all rows to capture every start
    for index, row in df.iterrows():
        goalie = row['starting_goalie']
        if pd.isna(goalie):
            continue
            
        if goalie not in goalie_stats:
            goalie_stats[goalie] = {'xga': 0, 'ga': 0, 'games': 0}
            
        goalie_stats[goalie]['xga'] += row['xG_against']
        goalie_stats[goalie]['ga'] += row['goals_ag']
        goalie_stats[goalie]['games'] += 1
        
    goalie_ratings = {}
    GOALIE_REGRESSION_GAMES = 5
    
    for goalie, stats in goalie_stats.items():
        if stats['games'] < 1:
            continue
            
        gsax = stats['xga'] - stats['ga']
        
        # Regress GSAx per game to 0
        # (Total GSAx + (Reg_Games * 0)) / (Games + Reg_Games)
        # Effectively shrinks the GSAx/game towards 0
        gsax_per_game = gsax / (stats['games'] + GOALIE_REGRESSION_GAMES)
        
        goalie_ratings[goalie] = {
            'gsax_total': gsax,
            'gsax_per_game': gsax_per_game,
            'games_played': stats['games']
        }
        
    # Save to JSON
    if save_files:
        team_ratings_path = os.path.join(PUBLIC_DATA_DIR, 'team_ratings.json')
        goalie_ratings_path = os.path.join(PUBLIC_DATA_DIR, 'goalie_ratings.json')
        # Also save to pipeline dir so predict_games.py reads current data
        pipeline_tr_path = os.path.join(SCRIPT_DIR, 'team_ratings.json')
        pipeline_gr_path = os.path.join(SCRIPT_DIR, 'goalie_ratings.json')

        with open(team_ratings_path, 'w') as f:
            json.dump(team_ratings, f, indent=4)
        print(f"Saved team_ratings.json to {team_ratings_path}")
        with open(pipeline_tr_path, 'w') as f:
            json.dump(team_ratings, f, indent=4)
        print(f"Saved team_ratings.json to {pipeline_tr_path}")

        with open(goalie_ratings_path, 'w') as f:
            json.dump(goalie_ratings, f, indent=4)
        print(f"Saved goalie_ratings.json to {goalie_ratings_path}")
        with open(pipeline_gr_path, 'w') as f:
            json.dump(goalie_ratings, f, indent=4)
        print(f"Saved goalie_ratings.json to {pipeline_gr_path}")
    
    return team_ratings, goalie_ratings, league_xg_for, league_xg_5v5

if __name__ == "__main__":
    calculate_ratings()
