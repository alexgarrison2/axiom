import pandas as pd
import numpy as np
from scipy.stats import poisson
from team_ratings import calculate_ratings
from predict_games import simulate_game
import datetime
import json

def backtest():
    print("Starting Model V3 Backtest (Data-Driven)...")
    
    # Load all game data
    df = pd.read_csv('nhl_season_2025_2026_gamestats.csv')
    df['game_date'] = pd.to_datetime(df['game_date'])
    df = df.sort_values('game_date')
    
    # Load Coefficients
    try:
        with open('scoring_coefficients.json', 'r') as f:
            coeffs = json.load(f)
        ST_VAL_PP = coeffs.get('pp_opp_val', 0.18)
        B2B_PENALTY = coeffs.get('b2b_cost', 0.26)
        raw_3in4 = coeffs.get('3in4_cost_gf', 0.12)
        # Override for safety as per production logic
        IN3_4_PENALTY = -0.10
        HOME_ICE_VAL = coeffs.get('home_ice_advantage', 0.16)
        STAR_PENALTY = 0.07
    except:
        print("Using default coefficients")
        ST_VAL_PP = 0.18
        B2B_PENALTY = 0.26
        IN3_4_PENALTY = -0.10
        HOME_ICE_VAL = 0.16
        STAR_PENALTY = 0.07

    # Start date (allow 3 weeks for data to accrue)
    start_date = df['game_date'].min() + datetime.timedelta(days=21)
    end_date = df['game_date'].max()
    
    print(f"Backtesting from {start_date.date()} to {end_date.date()}")
    
    results = []
    current_date = start_date
    
    while current_date <= end_date:
        date_str = current_date.strftime('%Y-%m-%d')
        
        # 1. History
        history_df = df[df['game_date'] < current_date]
        
        # 2. Calculate Ratings (V3 logic inside team_ratings.py)
        # Returns 5v5 ratings and Weighted ST ratings
        # Suppress prints
        # Note: calculate_ratings returns (team_ratings, goalie_ratings, league_xg, league_xg_5v5)
        team_ratings, goalie_ratings, league_xg, league_xg_5v5 = calculate_ratings(history_df, save_files=False)
        
        # 3. Today's Games
        todays_games = df[df['game_date'] == current_date]
        
        for _, game in todays_games.iterrows():
            if game['home_away'] != 'Home': continue
            
            home_team = game['team']
            away_team = game['opponent']
            
            if home_team not in team_ratings or away_team not in team_ratings: continue
            
            # --- V3 LOGIC START ---
            
            # A. 5v5 BASE
            h_r = team_ratings[home_team]
            a_r = team_ratings[away_team]
            
            h_5v5 = (h_r['xgf_5v5_rating'] * a_r['xga_5v5_rating']) / league_xg_5v5
            a_5v5 = (a_r['xgf_5v5_rating'] * h_r['xga_5v5_rating']) / league_xg_5v5
            
            # B. SPECIAL TEAMS (Additive)
            # Volume
            h_opps = (h_r['penalties_drawn_per_60'] + a_r['penalties_taken_per_60']) / 2
            a_opps = (a_r['penalties_drawn_per_60'] + h_r['penalties_taken_per_60']) / 2
            
            # Efficiency (Relative to League Avg 20%)
            # pp_rating is 0-100
            h_eff = (h_r['pp_rating'] / 100.0) / 0.20
            a_eff = (a_r['pp_rating'] / 100.0) / 0.20
            
            # PK Strength (Relative to League Avg 80%)
            # Higher PK rating means better kill.
            # We want a multiplier for the OPPONENT'S PP.
            # If Home has great PK (90%), Away's PP should struggle.
            # Away Eff Factor should be multiplied by (HomePK / 80%)?
            # No, usually xG models scale offense.
            # Let's keep it simple as per predict_games logic:
            # predict_games ONLY uses Offensive PP Efficiency scaling currently.
            # Replicating EXACT predict_games logic:
            # h_st_xg = h_opps * ST_VAL_PP * h_eff
            
            h_st_xg = h_opps * ST_VAL_PP * h_eff
            a_st_xg = a_opps * ST_VAL_PP * a_eff
            
            # C. REST & SCHEDULE
            # Need to get rest days from history_df
            def get_rest_days(team_name, curr_date):
                t_games = history_df[history_df['team'] == team_name].sort_values('game_date')
                if t_games.empty: return 5
                last_date = t_games.iloc[-1]['game_date']
                return (curr_date - last_date).days - 1
                
            h_rest = get_rest_days(home_team, current_date)
            a_rest = get_rest_days(away_team, current_date)
            
            # 3-in-4 Check
            def is_3in4(team_name, curr_date):
                t_games = history_df[history_df['team'] == team_name].sort_values('game_date')
                if len(t_games) < 2: return False
                # If we play today, look at previous 2.
                # 3 games in 4 nights means: Game 1 (Day 1), Game 2 (Day 2 or 3), Game 3 (Day 4)
                # Span = Today - (Game N-2) <= 3 days? No.
                # Defined: Days span of 3 games <= 4.
                # Today is Game 3.
                date_n_2 = t_games.iloc[-2]['game_date']
                span = (curr_date - date_n_2).days + 1
                return span <= 4

            h_3in4 = is_3in4(home_team, current_date)
            a_3in4 = is_3in4(away_team, current_date)
            
            h_rest_pen = 0.0
            if h_rest <= 0: h_rest_pen += B2B_PENALTY
            elif h_3in4: h_rest_pen += abs(IN3_4_PENALTY) # Penalty is negative in constant, so add abs? 
            # Logic: penalty is SUBTRACTED. constant is positive 0.26 usually?
            # In predict_games: xg -= 0.21. So we subtract.
            
            a_rest_pen = 0.0
            if a_rest <= 0: a_rest_pen += B2B_PENALTY
            elif a_3in4: a_rest_pen += abs(IN3_4_PENALTY)
            
            # D. TOTAL xG
            h_final_xg = h_5v5 + h_st_xg + HOME_ICE_VAL - h_rest_pen
            a_final_xg = a_5v5 + a_st_xg - a_rest_pen # No home ice
            
            # E. GOALIES
            h_goalie = game['starting_goalie']
            a_goalie = game['starting_goalie_opp']
            
            h_gsax = goalie_ratings.get(h_goalie, {'gsax_per_game': 0})['gsax_per_game'] if h_goalie in goalie_ratings else 0
            a_gsax = goalie_ratings.get(a_goalie, {'gsax_per_game': 0})['gsax_per_game'] if a_goalie in goalie_ratings else 0
            
            h_final_xg = max(0.1, h_final_xg - (a_gsax * 0.5))
            a_final_xg = max(0.1, a_final_xg - (h_gsax * 0.5))
            
            # Simulate
            h_prob, a_prob, tie_prob = simulate_game(h_final_xg, a_final_xg)
            h_win_prob = h_prob + (tie_prob * 0.5)
            
            # Record
            is_win = game['result'] in ['RW', 'OTW', 'SOW']
            home_won = 1 if is_win else 0
            
            results.append({
                'date': date_str,
                'home_team': home_team,
                'h_win_prob': h_win_prob,
                'home_won': home_won
            })
            
        current_date += datetime.timedelta(days=1)
        
    # Stats
    df_res = pd.DataFrame(results)
    
    # Brier
    df_res['brier'] = (df_res['h_win_prob'] - df_res['home_won']) ** 2
    brier = df_res['brier'].mean()
    
    # Log Loss
    eps = 1e-15
    df_res['p_safe'] = np.clip(df_res['h_win_prob'], eps, 1-eps)
    df_res['log_loss'] = - (df_res['home_won'] * np.log(df_res['p_safe']) + (1 - df_res['home_won']) * np.log(1 - df_res['p_safe']))
    ll = df_res['log_loss'].mean()
    
    # Accuracy
    df_res['pred_correct'] = ((df_res['h_win_prob'] > 0.5) == (df_res['home_won'] == 1)).astype(int)
    acc = df_res['pred_correct'].mean()
    
    print("\n--- V3 Backtest Results ---")
    print(f"Games: {len(df_res)}")
    print(f"Accuracy: {acc:.2%}")
    print(f"Brier Score: {brier:.4f}")
    print(f"Log Loss: {ll:.4f}")
    
if __name__ == "__main__":
    backtest()
