
import pandas as pd

try:
    df = pd.read_csv('nhl_season_2025_2026_gamestats.csv')
    print(f"Loaded {len(df)} rows.")
    
    # Filter for high xG
    high_xg = df[df['xG_for'] > 10]
    print(f"Rows with xG_for > 10: {len(high_xg)}")
    if not high_xg.empty:
        print(high_xg[['game_date', 'team', 'xG_for']].head())
        print("Max xG_for:", df['xG_for'].max())

    # Count 0.0s
    zeros = df[df['xG_for'] == 0.0]
    print(f"Rows with xG_for == 0.0: {len(zeros)}")
    
except Exception as e:
    print(e)
