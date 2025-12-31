import pandas as pd
try:
    df = pd.read_csv('nhl_season_2025_2026_gamestats.csv')
    dupes = df[df.duplicated(subset=['game_id', 'team'], keep=False)]
    if not dupes.empty:
        print(f"FOUND {len(dupes)} DUPLICATES in gamestats.csv!")
        print(dupes.head())
    else:
        print("No duplicates found in gamestats.csv")
except Exception as e:
    print(f"Error checking gamestats: {e}")
