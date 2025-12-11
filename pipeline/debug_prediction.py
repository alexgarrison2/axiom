import pandas as pd
from team_ratings import calculate_ratings
from predict_games import simulate_game
import datetime
from calculate_gas import GasCalculator

def debug_matchup():
    print("DEBUG: Tracing UTA vs FLA calculation...")
    
    # Load Data
    df = pd.read_csv('nhl_season_2025_2026_gamestats.csv')
    df['game_date'] = pd.to_datetime(df['game_date'])
    df = df.sort_values('game_date')
    
    # Calculate Ratings (State as of 2025-12-09)
    current_date = pd.to_datetime('2025-12-10') # The game date
    history_df = df[df['game_date'] < current_date]
    
    team_ratings, goalie_ratings, league_xg = calculate_ratings(history_df, save_files=False)
    
    home_team = 'Panthers'
    away_team = 'Mammoth' # Assuming 'Mammoth' is the name in the system for Utah? 
    # Wait, user code had 'UTA' tricode map to 'Mammoth'? Or 'Utah Hockey Club'?
    # Let's check team names in ratings.
    
    print("\n--- BASE RATINGS ---")
    if home_team in team_ratings:
        print(f"{home_team}: xGF={team_ratings[home_team]['xgf_rating']:.2f}, xGA={team_ratings[home_team]['xga_rating']:.2f}")
    else:
        print(f"{home_team} not found in ratings!")

    if away_team in team_ratings:
        print(f"{away_team}: xGF={team_ratings[away_team]['xgf_rating']:.2f}, xGA={team_ratings[away_team]['xga_rating']:.2f}")
    else:
        print(f"{away_team} not found in ratings! Checking keys...")
        # fuzzy match check
        for k in team_ratings.keys():
            if 'Utah' in k or 'Mammoth' in k:
                print(f"Found candidate: {k}")
                away_team = k
                print(f"{away_team}: xGF={team_ratings[away_team]['xgf_rating']:.2f}, xGA={team_ratings[away_team]['xga_rating']:.2f}")
                
    # Base Calculation
    h_xgf = team_ratings[home_team]['xgf_rating']
    h_xga = team_ratings[home_team]['xga_rating']
    a_xgf = team_ratings[away_team]['xgf_rating']
    a_xga = team_ratings[away_team]['xga_rating']
    
    h_xg = (h_xgf * a_xga) / league_xg * 1.03
    a_xg = (a_xgf * h_xga) / league_xg
    
    print(f"\n--- BASE xG ---")
    print(f"FLA Base xG: {h_xg:.3f}")
    print(f"UTA Base xG: {a_xg:.3f}")
    
    # GAS
    gas_calc = GasCalculator(df)
    game_date_str = '2025-12-10'
    home_gas, _ = gas_calc.calculate_gas(home_team, game_date_str, away_team, is_home=True)
    away_gas, _ = gas_calc.calculate_gas(away_team, game_date_str, home_team, is_home=False)
    
    print(f"\n--- GAS ---")
    print(f"FLA Gas: {home_gas}")
    print(f"UTA Gas: {away_gas}")
    h_gas_gap = home_gas - away_gas
    
    h_boost = 1.0
    if h_gas_gap > 0:
        boost_val = h_gas_gap * 0.004
        h_boost = 1.0 + min(0.25, boost_val)
    print(f"FLA Gas Boost: {h_boost:.3f}")
    
    # Oracle / Trends
    # Placeholder for trend fetching logic
    # Just need to see if ratings are fundamentally broken
    
if __name__ == "__main__":
    debug_matchup()
