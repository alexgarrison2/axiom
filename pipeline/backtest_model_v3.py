import pandas as pd
import numpy as np
from scipy.stats import poisson
from team_ratings import calculate_ratings
from predict_games import simulate_game, prob_to_odds
import datetime
from calculate_gas import GasCalculator

def backtest():
    print("Starting Model V3 (The Oracle) Backtest...")
    
    # Load all game data
    df = pd.read_csv('nhl_season_2025_2026_gamestats.csv')
    df['game_date'] = pd.to_datetime(df['game_date'])
    df = df.sort_values('game_date')
    
    # Initialize Gas Calculator
    gas_calc = GasCalculator(df)
    
    # We need a starting point where we have enough data to form ratings.
    start_date = df['game_date'].min() + datetime.timedelta(days=21) # 3 weeks in
    end_date = df['game_date'].max()
    
    print(f"Backtesting from {start_date.date()} to {end_date.date()}")
    
    results = []
    
    current_date = start_date
    while current_date <= end_date:
        date_str = current_date.strftime('%Y-%m-%d')
        
        # 1. Get History (Games BEFORE today)
        history_df = df[df['game_date'] < current_date]
        
        # 2. Calculate Ratings based on History
        team_ratings, goalie_ratings, league_xg = calculate_ratings(history_df, save_files=False)
        
        # 3. Get Games for TODAY
        todays_games = df[df['game_date'] == current_date]
        
        if len(todays_games) == 0:
            current_date += datetime.timedelta(days=1)
            continue
            
        for _, game in todays_games.iterrows():
            if game['home_away'] != 'Home':
                continue
                
            home_team = game['team']
            away_team = game['opponent']
            
            if home_team not in team_ratings or away_team not in team_ratings:
                continue
                
            # Get Ratings
            h_xgf = team_ratings[home_team]['xgf_rating']
            h_xga = team_ratings[home_team]['xga_rating']
            a_xgf = team_ratings[away_team]['xgf_rating']
            a_xga = team_ratings[away_team]['xga_rating']
            
            # Goalies
            h_goalie = game['starting_goalie']
            a_goalie = game['starting_goalie_opp']
            
            h_gsax = goalie_ratings.get(h_goalie, {'gsax_per_game': 0})['gsax_per_game'] if h_goalie in goalie_ratings else 0
            a_gsax = goalie_ratings.get(a_goalie, {'gsax_per_game': 0})['gsax_per_game'] if a_goalie in goalie_ratings else 0
            
            # Base xG
            h_xg = (h_xgf * a_xga) / league_xg * 1.03
            a_xg = (a_xgf * h_xga) / league_xg
            
            # --- V2 GAS CALCULATION ---
            home_gas, _ = gas_calc.calculate_gas(home_team, date_str, away_team, is_home=True)
            away_gas, _ = gas_calc.calculate_gas(away_team, date_str, home_team, is_home=False)
            
            h_gas_gap = home_gas - away_gas
            a_gas_gap = away_gas - home_gas
            
            h_boost = 1.0
            a_boost = 1.0
            
            if h_gas_gap > 0:
                boost_val = h_gas_gap * 0.004
                h_boost = 1.0 + min(0.25, boost_val)
                
            if a_gas_gap > 0:
                boost_val = a_gas_gap * 0.004
                a_boost = 1.0 + min(0.25, boost_val)
                
            # --- V3 ORACLE LOGIC ---
            # Helper for Trends
            def get_trends(team_name, hist_df):
                if len(hist_df) == 0: return 1000, 20
                tm_games = hist_df[hist_df['team'] == team_name].sort_values('game_date')
                if len(tm_games) < 5: return 1000, 20
                recent = tm_games.tail(7)
                
                goals = recent['goals_for'].sum()
                sog = recent['sog_for'].sum()
                saves = recent['saves_for'].sum()
                sa = recent['sog_ag'].sum()
                
                sh_pct = goals / sog if sog > 0 else 0
                sv_pct = saves / sa if sa > 0 else 0
                pdo = (sh_pct + sv_pct) * 1000
                hits = recent['hits_for'].mean()
                return pdo, hits

            h_pdo, h_hits = get_trends(home_team, history_df)
            a_pdo, a_hits = get_trends(away_team, history_df)
            
            h_oracle_mult = 1.0
            a_oracle_mult = 1.0
            
            # PDO Momentum
            pdo_diff = h_pdo - a_pdo
            if pdo_diff > 40: h_oracle_mult *= 1.05
            elif pdo_diff < -40: a_oracle_mult *= 1.05
            
            # Anti-Hits
            hits_diff = h_hits - a_hits
            if hits_diff > 8: h_oracle_mult *= 0.97
            elif hits_diff < -8: a_oracle_mult *= 0.97
                
            # Final Adjustment
            GOALIE_IMPACT_FACTOR = 0.5
            h_xg_adj = max(0.1, h_xg - (a_gsax * GOALIE_IMPACT_FACTOR)) * h_boost * h_oracle_mult
            a_xg_adj = max(0.1, a_xg - (h_gsax * GOALIE_IMPACT_FACTOR)) * a_boost * a_oracle_mult
            
            # Simulate
            h_prob, a_prob, tie_prob = simulate_game(h_xg_adj, a_xg_adj)
            h_win_prob = h_prob + (tie_prob * 0.5)
            
            is_win = game['result'] in ['RW', 'OTW', 'SOW']
            actual_winner = home_team if is_win else away_team
            home_won = 1 if is_win else 0
            
            brier_score = (h_win_prob - home_won) ** 2
            p_safe = max(min(h_win_prob, 0.9999), 0.0001)
            log_loss = - (home_won * np.log(p_safe) + (1 - home_won) * np.log(1 - p_safe))
            
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
    
    print("\n--- Model V3 (The Oracle) Results ---")
    print(f"Total Games Simulated: {len(results_df)}")
    print(f"Model Accuracy: {accuracy:.2%}")
    print(f"Average Brier Score: {avg_brier:.4f}")
    print(f"Average Log Loss: {avg_log_loss:.4f}")
    
    results_df.to_csv('backtest_results_v3.csv', index=False)

if __name__ == "__main__":
    backtest()
