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
    
    output_path = os.path.join('..', 'data', 'prediction_history.json')
    
    # 0. Load Existing History (to preserve predictions)
    history_records = []
    if os.path.exists(output_path):
        try:
            with open(output_path, 'r') as f:
                history_records = json.load(f)
            print(f"Loaded {len(history_records)} existing records from history.")
        except Exception as e:
            print(f"Warning: Could not load existing history: {e}")
            history_records = []

    # Map for easy lookup: (date, home, away) -> record_index
    lookup = {(r['date'], r['homeTeam'], r['awayTeam']): i for i, r in enumerate(history_records)}
    
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
    
    current_date = start_date
    
    while current_date <= end_date:
        date_str = current_date.strftime('%Y-%m-%d')
        todays_games = df[df['game_date'] == current_date]
        if todays_games.empty:
            current_date += datetime.timedelta(days=1)
            continue

        # Check if we need to run ratings (any new games today?)
        need_ratings = False
        for _, game in todays_games.iterrows():
            if game['home_away'] != 'Home': continue
            key = (date_str, game['team'], game['opponent'])
            if key not in lookup:
                need_ratings = True
                break
        
        # 1. History (Games BEFORE today)
        history_df = df[df['game_date'] < current_date]
        
        # 2. Calculate Ratings (skip if no new games today)
        team_ratings, goalie_ratings, league_xg, league_xg_5v5 = {}, {}, 3.0, 2.5
        if need_ratings:
            try:
                 team_ratings, goalie_ratings, league_xg, league_xg_5v5 = calculate_ratings(history_df, save_files=False)
            except Exception as e:
                 print(f"Error calling calculate_ratings for {date_str}: {e}")
                 current_date += datetime.timedelta(days=1)
                 continue
        
        # 3. Today's Games
        for _, game in todays_games.iterrows():
            if game['home_away'] != 'Home': continue
            
            home_team = game['team']
            away_team = game['opponent']
            key = (date_str, home_team, away_team)
            
            # Result Data
            is_win = game['result'] in ['RW', 'OTW', 'SOW']
            home_won = 1 if is_win else 0
            try:
                h_score = int(game['goals_for'])
                a_score = int(game['goals_ag'])
                game_finished = not pd.isna(game['result']) and game['result'] != ''
            except:
                h_score = 0
                a_score = 0
                game_finished = False

            if key in lookup:
                # UPDATE EXISTING RECORD (Keep Prediction! Update Result!)
                idx = lookup[key]
                if game_finished:
                    actual_winner = home_team if is_win else away_team
                    history_records[idx].update({
                        'homeScore': h_score,
                        'awayScore': a_score,
                        'actualWinner': actual_winner,
                        'isCorrect': (history_records[idx]['predictedWinner'] == actual_winner),
                        'brierScore': round((history_records[idx]['homeWinProb']/100.0 - home_won) ** 2, 4)
                    })
                continue

            # NEW GAME - Perform Full Prediction
            if home_team not in team_ratings or away_team not in team_ratings: continue
            
            # --- V3 LOGIC PREDICTION ---
            h_r = team_ratings[home_team]
            a_r = team_ratings[away_team]
            h_5v5 = (h_r['xgf_5v5_rating'] * a_r['xga_5v5_rating']) / league_xg_5v5
            a_5v5 = (a_r['xgf_5v5_rating'] * h_r['xga_5v5_rating']) / league_xg_5v5
            
            h_opps = (h_r['penalties_drawn_per_60'] + a_r['penalties_taken_per_60']) / 2
            a_opps = (a_r['penalties_drawn_per_60'] + h_r['penalties_taken_per_60']) / 2
            h_eff, a_eff = (h_r['pp_rating'] / 100.0) / 0.20, (a_r['pp_rating'] / 100.0) / 0.20
            h_st_xg, a_st_xg = h_opps * ST_VAL_PP * h_eff, a_opps * ST_VAL_PP * a_eff
            
            def get_rest_days(team_name, curr_date):
                t_games = history_df[history_df['team'] == team_name].sort_values('game_date')
                return (curr_date - t_games.iloc[-1]['game_date']).days - 1 if not t_games.empty else 5
                
            h_rest, a_rest = get_rest_days(home_team, current_date), get_rest_days(away_team, current_date)
            
            def is_3in4(team_name, curr_date):
                t_games = history_df[history_df['team'] == team_name].sort_values('game_date')
                return ((curr_date - t_games.iloc[-2]['game_date']).days + 1 <= 4) if len(t_games) >= 2 else False

            h_rest_pen = B2B_PENALTY if h_rest <= 0 else (abs(IN3_4_PENALTY) if is_3in4(home_team, current_date) else 0.0)
            a_rest_pen = B2B_PENALTY if a_rest <= 0 else (abs(IN3_4_PENALTY) if is_3in4(away_team, current_date) else 0.0)
            
            h_final_xg, a_final_xg = h_5v5 + h_st_xg + HOME_ICE_VAL - h_rest_pen, a_5v5 + a_st_xg - a_rest_pen
            h_goalie, a_goalie = game['starting_goalie'], game['starting_goalie_opp']
            h_gsax = goalie_ratings.get(h_goalie, {'gsax_per_game': 0})['gsax_per_game'] if h_goalie in goalie_ratings else 0
            a_gsax = goalie_ratings.get(a_goalie, {'gsax_per_game': 0})['gsax_per_game'] if a_goalie in goalie_ratings else 0
            
            h_final_xg, a_final_xg = max(0.1, h_final_xg - (a_gsax * 0.5)), max(0.1, a_final_xg - (h_gsax * 0.5))
            h_prob, a_prob, tie_prob = simulate_game(h_final_xg, a_final_xg)
            h_win_prob = h_prob + (tie_prob * 0.5)
            
            predicted_winner = home_team if h_win_prob > 0.5 else away_team
            actual_winner = home_team if is_win else away_team
            
            history_records.append({
                'date': date_str, 'homeTeam': home_team, 'awayTeam': away_team,
                'homeScore': h_score if game_finished else 0, 'awayScore': a_score if game_finished else 0,
                'homeXg': round(h_final_xg, 2), 'awayXg': round(a_final_xg, 2),
                'homeWinProb': round(h_win_prob * 100, 1), 'predictedWinner': predicted_winner,
                'actualWinner': actual_winner if game_finished else "", 'isCorrect': (predicted_winner == actual_winner) if game_finished else False,
                'brierScore': round((h_win_prob - home_won) ** 2, 4) if game_finished else 0.0
            })
            
        current_date += datetime.timedelta(days=1)
        
    with open(output_path, 'w') as f:
        json.dump(history_records, f, indent=2)
    print(f"Saved {len(history_records)} historical predictions to {output_path}")

if __name__ == "__main__":
    generate_history()
