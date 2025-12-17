import pandas as pd
import os

SHOTS_FILE = 'pipeline/nhl_season_2025_2026_shots.csv'

if os.path.exists(SHOTS_FILE):
    print(f"Reading {SHOTS_FILE}...")
    df = pd.read_csv(SHOTS_FILE)
    original_count = len(df)
    
    # Deduplicate
    df_dedup = df.drop_duplicates()
    
    new_count = len(df_dedup)
    
    if original_count != new_count:
        print(f"Found {original_count - new_count} duplicates.")
        print(f"Saving cleaned file with {new_count} rows...")
        df_dedup.to_csv(SHOTS_FILE, index=False)
        print("Done.")
    else:
        print("No duplicates found.")
else:
    print(f"File {SHOTS_FILE} not found.")
