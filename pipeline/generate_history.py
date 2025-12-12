import pandas as pd
import numpy as np
from scipy.stats import poisson
import json
import datetime
import os
from team_ratings import calculate_ratings
from predict_games import simulate_game

def generate_history():
    print("Generating Prediction History (V3 Model)...")
    
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
        IN3_4_PENALTY = -0.10
        HOME_ICE_VAL = coeffs.get('home_ice_advantage', 0.16)
        STAR_PENALTY = 0.07
    except:
        ST_VAL_PP = 0.18
        B2B_PENALTY = 0.26
        IN3_4_PENALTY = -0.10
        HOME_ICE_VAL = 0.16
        STAR_PENALTY = 0.07

    # Start date (allow 3 weeks for data to accrue)
    start_date = df['game_date'].min() + datetime.timedelta(days=21)
    end_date = df['game_date'].max()
    
    history_records = []
    current_date = start_date
    
    while current_date <= end_date:
        date_str = current_date.strftime('%Y-%m-%d')
        
        # 1. History (Games BEFORE today)
        history_df = df[df['game_date'] < current_date]
        
        # 2. Calculate Ratings
        # Suppress prints by not suppressing them? No, calculate_ratings prints a lot.
        # We can live with it or suppress stdout.
        # team_ratings, goalie_ratings, league_xg, league_xg_5v5
        try:
             team_ratings, goalie_ratings, league_xg, league_xg_5v5 = calculate_ratings(history_df, save_files=False)
        except Exception as e:
             # Fallback for V1 legacy if signature mismatch happens again (unlikely since we deployed V3)
             print(f"Error calling calculate_ratings: {e}")
             current_date += datetime.timedelta(days=1)
             continue
        
        # 3. Today's Games
        todays_games = df[df['game_date'] == current_date]
        
        for _, game in todays_games.iterrows():
            if game['home_away'] != 'Home': continue
            
            home_team = game['team']
            away_team = game['opponent']
            
            if home_team not in team_ratings or away_team not in team_ratings: continue
            
            # --- V3 LOGIC PREDICTION ---
            
            # A. 5v5 BASE
            h_r = team_ratings[home_team]
            a_r = team_ratings[away_team]
            
            h_5v5 = (h_r['xgf_5v5_rating'] * a_r['xga_5v5_rating']) / league_xg_5v5
            a_5v5 = (a_r['xgf_5v5_rating'] * h_r['xga_5v5_rating']) / league_xg_5v5
            
            # B. SPECIAL TEAMS (Additive)
            h_opps = (h_r['penalties_drawn_per_60'] + a_r['penalties_taken_per_60']) / 2
            a_opps = (a_r['penalties_drawn_per_60'] + h_r['penalties_taken_per_60']) / 2
            
            h_eff = (h_r['pp_rating'] / 100.0) / 0.20
            a_eff = (a_r['pp_rating'] / 100.0) / 0.20
            
            h_st_xg = h_opps * ST_VAL_PP * h_eff
            a_st_xg = a_opps * ST_VAL_PP * a_eff
            
            # C. REST & SCHEDULE
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
                date_n_2 = t_games.iloc[-2]['game_date']
                span = (curr_date - date_n_2).days + 1
                return span <= 4

            h_3in4 = is_3in4(home_team, current_date)
            a_3in4 = is_3in4(away_team, current_date)
            
            h_rest_pen = 0.0
            if h_rest <= 0: h_rest_pen += B2B_PENALTY
            elif h_3in4: h_rest_pen += abs(IN3_4_PENALTY)
            
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
            
            # Result
            is_win = game['result'] in ['RW', 'OTW', 'SOW']
            home_won = 1 if is_win else 0
            
            # Scores
            try:
                h_score = int(game['goals_for'])
                a_score = int(game['goals_ag'])
            except:
                h_score = 0
                a_score = 0
            
            # Metrics
            brier = (h_win_prob - home_won) ** 2
            
            # Correct? (Favorite Won)
            predicted_winner = home_team if h_win_prob > 0.5 else away_team
            actual_winner = home_team if is_win else away_team
            is_correct = (predicted_winner == actual_winner)
            
            history_records.append({
                'date': date_str,
                'homeTeam': home_team,
                'awayTeam': away_team,
                'homeScore': h_score,
                'awayScore': a_score,
                'homeWinProb': round(h_win_prob * 100, 1),
                'predictedWinner': predicted_winner,
                'actualWinner': actual_winner,
                'isCorrect': is_correct,
                'brierScore': round(brier, 4)
            })
            
        current_date += datetime.timedelta(days=1)
        
    # Save to JSON
    # Go up one level to data directory? No, pipeline is sibling of data?
    # Repo structure: nhl-predictions-app/pipeline/generate_history.py
    # Output: nhl-predictions-app/data/prediction_history.json
    output_path = os.path.join('..', 'data', 'prediction_history.json')
    
    with open(output_path, 'w') as f:
        json.dump(history_records, f, indent=2)
        
    print(f"Saved {len(history_records)} historical predictions to {output_path}")

if __name__ == "__main__":
    generate_history()
