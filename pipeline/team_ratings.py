import pandas as pd
import json
import numpy as np

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
        
        # Calculate Rolling Averages (Last 10 Games)
        rolling_xgf = team_games['xG_for'].rolling(window=10, min_periods=1).mean().iloc[-1]
        season_xgf = team_games['xG_for'].mean()
        
        # 5v5 xGF
        col_5v5 = 'xG_for_5v5' if has_5v5_data else 'xG_for' # Fallback
        rolling_xgf_5v5 = team_games[col_5v5].rolling(window=10, min_periods=1).mean().iloc[-1]
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
        rolling_xga = team_games['xG_against'].rolling(window=10, min_periods=1).mean().iloc[-1]
        season_xga = team_games['xG_against'].mean()
        
        # 5v5 xGA
        col_ga_5v5 = 'xG_against_5v5' if has_5v5_data else 'xG_against'
        rolling_xga_5v5 = team_games[col_ga_5v5].rolling(window=10, min_periods=1).mean().iloc[-1]
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
        
        # Regress Special Teams to Mean (20% PP, 80% PK) using 20 games weight (ST is volatile)
        ST_REGRESSION = 20
        pp_rating = ((pp_goals + (0.20 * ST_REGRESSION)) / (pp_opps + ST_REGRESSION)) * 100
        pk_rating = ((1 - (pk_goals_ag + (0.20 * ST_REGRESSION)) / (pk_opps + ST_REGRESSION))) * 100
        
        team_ratings[team] = {
            'xgf_rating': xgf_rating,
            'xga_rating': xga_rating,
            'xgf_rolling': rolling_xgf,
            'xga_rolling': rolling_xga,
            'xgf_5v5_rating': xgf_5v5_rating,
            'xga_5v5_rating': xga_5v5_rating,
            'pp_rating': pp_rating,
            'pk_rating': pk_rating,
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
        with open('team_ratings.json', 'w') as f:
            json.dump(team_ratings, f, indent=4)
        print("Saved team_ratings.json")
            
        with open('goalie_ratings.json', 'w') as f:
            json.dump(goalie_ratings, f, indent=4)
        print("Saved goalie_ratings.json")
    
    return team_ratings, goalie_ratings, league_xg_for, league_xg_5v5

if __name__ == "__main__":
    calculate_ratings()
