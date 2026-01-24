
import pandas as pd

try:
    df = pd.read_csv("pipeline/nhl_season_2025_2026_shots.csv")
    print(f"Total rows: {len(df)}")
    
    # Check for duplicates
    # A duplicate shot would have same game_id, event_id? 
    # Or maybe event_id is unique?
    # Let's check duplicates on [game_id, event_id]
    
    if 'event_id' in df.columns:
        dupes = df[df.duplicated(subset=['game_id', 'event_id'], keep=False)]
        print(f"Duplicate [game_id, event_id] rows: {len(dupes)}")
        if len(dupes) > 0:
            print(dupes.head())
    else:
        print("No event_id column.")

    # Check aggregation per game
    xg_sum = df.groupby('game_id')['xG'].sum()
    print("\nxG Sum Stats per Game:")
    print(xg_sum.describe())
    
    print("\nTop 5 Games by xG:")
    print(xg_sum.sort_values(ascending=False).head())
    
    # Check xG vs Distance
    print("\nMean xG by Distance Bin:")
    df['dist_bin'] = pd.cut(df['distance'], bins=[0, 10, 20, 30, 40, 50, 60, 100])
    print(df.groupby('dist_bin')['xG'].mean())
    

except Exception as e:
    print(e)
