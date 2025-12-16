
import pandas as pd
import sys

SHOTS_FILE = "nhl_season_2025_2026_shots.csv"
GAME_ID = 2025020478 # Panthers vs Mammoth (Utah) - 0.0 5v5 xG in gamestats

def debug_xg():
    try:
        df = pd.read_csv(SHOTS_FILE)
    except FileNotFoundError:
        print("Shots file not found.")
        return

    # Filter for game
    game_df = df[df['game_id'] == GAME_ID].copy()
    
    if game_df.empty:
        print(f"No shots found for Game {GAME_ID}")
        return

    print(f"Total Shots: {len(game_df)}")
    
    # Check Strength States
    print("\nUnique Strength States:", game_df['strength_state'].unique())
    print("Unique Team IDs:", game_df['team_id'].unique())
    
    # Simulate Logic
    # We need home_id and away_id.
    # From gamestats: Panthers (13) vs Mammoth (59 Utah?)
    # Let's check team IDs in the df
    team_ids = game_df['team_id'].unique()
    print("Team IDs in data:", team_ids)
    
    # Assume:
    # 13 = Panthers
    # 68 = Utah (Mammoth) - Confirmed via Schedule API and Shots CSV
    
    home_id = 68 
    # Wait, gamestats said: Panthers, Mammoth, Away. (Panthers were Away team relative to Mammoth? No "Panthers, Mammoth, Away" means Team=Panthers, Opp=Mammoth, Home/Away=Away. So Panthers are Away, Mammoth are Home).
    
    # Calculating 5v5 xG
    # Note: 'xG' column in CSV might be populated? Or we assume we calculate it?
    # The CSV has 'xG' column from the scraper's OUTPUT.
    
    if 'xG' not in game_df.columns:
        print("xG column missing in CSV (expected if scraper didn't save it yet, but file should have it)")
        # Make dummy
        game_df['xG'] = 0.1
        
    xg_home_5v5 = game_df[(game_df['team_id'] == home_id) & (game_df['strength_state'] == '5v5')]['xG'].sum()
    print(f"\nCalculated 5v5 xG for Team {home_id} (Home): {xg_home_5v5}")
    
    xg_away_5v5 = game_df[(game_df['team_id'] != home_id) & (game_df['strength_state'] == '5v5')]['xG'].sum()
    print(f"Calculated 5v5 xG for Away: {xg_away_5v5}")
    
    # Detailed check
    print("\nChecking exact matches:")
    matches = game_df[(game_df['team_id'] == home_id) & (game_df['strength_state'] == '5v5')]
    print(f"Rows matching Home 5v5: {len(matches)}")
    if len(matches) > 0:
        print(matches[['team_id', 'strength_state', 'xG']].head())
    else:
        # Check types
        print("Data Types:")
        print(game_df.dtypes)
        print("Home ID type:", type(home_id))
        print("First row values:")
        print(game_df.iloc[0])

if __name__ == "__main__":
    debug_xg()
