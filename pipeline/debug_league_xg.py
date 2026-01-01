
import pandas as pd
import sys
import os

# Mock data load
try:
    df = pd.read_csv('nhl_season_2025_2026_gamestats.csv')
    print(f"Loaded {len(df)} rows.")
    
    # Calculate League Avg identical to predict_games.py
    if not df.empty:
         # Convert game_date to datetime if not already
         if not pd.api.types.is_datetime64_any_dtype(df['game_date']):
             df['game_date'] = pd.to_datetime(df['game_date'])
             
         val = df.get('xG_for_5v5', df['xG_for'] * 0.8).mean()
         print(f"Calculated Mean xG 5v5: {val}")
         
         league_xg_5v5 = val if pd.notna(val) and val > 0 else 2.0
         print(f"Final League xG 5v5: {league_xg_5v5}")
    else:
        print("Empty dataframe")

except Exception as e:
    print(e)
