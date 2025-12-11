import pandas as pd
import numpy as np
from scipy.stats import poisson
from team_ratings import calculate_ratings
from predict_games import simulate_game, prob_to_odds
import datetime

def backtest():
    print("Starting Backtest...")
    
    # Load all game data
    df = pd.read_csv('nhl_season_2025_2026_gamestats.csv')
    df['game_date'] = pd.to_datetime(df['game_date'])
    df = df.sort_values('game_date')
    
    # We need a starting point where we have enough data to form ratings.
    # Let's start after ~2 weeks of the season.
    start_date = df['game_date'].min() + datetime.timedelta(days=14)
    end_date = df['game_date'].max()
    
    print(f"Backtesting from {start_date.date()} to {end_date.date()}")
    
    results = []
    
    current_date = start_date
    while current_date <= end_date:
        date_str = current_date.strftime('%Y-%m-%d')
        
        # 1. Get History (Games BEFORE today)
        history_df = df[df['game_date'] < current_date]
        
        # 2. Calculate Ratings based on History
        # We suppress file saving to avoid overwriting production data
        team_ratings, goalie_ratings, league_xg = calculate_ratings(history_df, save_files=False)
        
        # 3. Get Games for TODAY
        todays_games = df[df['game_date'] == current_date]
        
        if len(todays_games) == 0:
            current_date += datetime.timedelta(days=1)
            continue
            
        # print(f"Simulating {len(todays_games)} games for {date_str}...")
        
        for _, game in todays_games.iterrows():
            # We only process one row per game (Home team perspective)
            if game['home_away'] != 'Home':
                continue
                
            home_team = game['team']
            away_team = game['opponent']
            
            # Check if we have ratings
            if home_team not in team_ratings or away_team not in team_ratings:
                continue
                
            # Get Ratings
            h_xgf = team_ratings[home_team]['xgf_rating']
            h_xga = team_ratings[home_team]['xga_rating']
            a_xgf = team_ratings[away_team]['xgf_rating']
            a_xga = team_ratings[away_team]['xga_rating']
            
            # Get Goalies (Actual starters from the game record)
            h_goalie = game['starting_goalie']
            a_goalie = game['starting_goalie_opp']
            
            h_gsax = goalie_ratings.get(h_goalie, {'gsax_per_game': 0})['gsax_per_game'] if h_goalie in goalie_ratings else 0
            a_gsax = goalie_ratings.get(a_goalie, {'gsax_per_game': 0})['gsax_per_game'] if a_goalie in goalie_ratings else 0
            
            # Calculate xG
            # Home xG = (Home Off * Away Def) / League Avg * Home Ice
            # Reduced Home Ice from 1.05 to 1.03
            h_xg = (h_xgf * a_xga) / league_xg * 1.03
            a_xg = (a_xgf * h_xga) / league_xg
            
            # Adjust for Goalies
            # Dampen GSAx impact by 50% to reduce volatility
            GOALIE_IMPACT_FACTOR = 0.5
            
            h_xg_adj = max(0.1, h_xg - (a_gsax * GOALIE_IMPACT_FACTOR))
            a_xg_adj = max(0.1, a_xg - (h_gsax * GOALIE_IMPACT_FACTOR))
            
            # Simulate
            h_prob, a_prob, tie_prob = simulate_game(h_xg_adj, a_xg_adj)
            h_win_prob = h_prob + (tie_prob * 0.5)
            a_win_prob = a_prob + (tie_prob * 0.5)
            
            # Determine Winner
            # Result is RW, OTW, SOW for Win, or RL, OTL, SOL for Loss
            # Since we are looking at the Home team's row:
            is_win = game['result'] in ['RW', 'OTW', 'SOW']
            
            actual_winner = home_team if is_win else away_team
            home_won = 1 if is_win else 0
            
            # Metrics
            # Brier Score: (Prob - Outcome)^2
            brier_score = (h_win_prob - home_won) ** 2
            
            # Log Loss: - (y*log(p) + (1-y)*log(1-p))
            # Clip probabilities to avoid log(0)
            p_safe = max(min(h_win_prob, 0.9999), 0.0001)
            log_loss = - (home_won * np.log(p_safe) + (1 - home_won) * np.log(1 - p_safe))
            
            # Accuracy (Did the favorite win?)
            predicted_winner = home_team if h_win_prob > 0.5 else away_team
            correct_prediction = 1 if predicted_winner == actual_winner else 0
            
            results.append({
                'date': date_str,
                'home_team': home_team,
                'away_team': away_team,
                'h_win_prob': h_win_prob,
                'actual_winner': actual_winner,
                'correct': correct_prediction,
                'brier': brier_score,
                'log_loss': log_loss
            })
            
        current_date += datetime.timedelta(days=1)
        
    # Summary
    results_df = pd.DataFrame(results)
    accuracy = results_df['correct'].mean()
    avg_brier = results_df['brier'].mean()
    avg_log_loss = results_df['log_loss'].mean()
    total_games = len(results_df)
    
    print("\n--- Backtest Results ---")
    print(f"Total Games Simulated: {total_games}")
    print(f"Model Accuracy: {accuracy:.2%}")
    print(f"Average Brier Score: {avg_brier:.4f}")
    print(f"Average Log Loss: {avg_log_loss:.4f}")
    
    # Save detailed results
    results_df.to_csv('backtest_results.csv', index=False)
    print("Saved backtest_results.csv")

if __name__ == "__main__":
    backtest()
