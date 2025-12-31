import pandas as pd
import os

SHOTS_FILENAME = "nhl_season_2025_2026_shots.csv"

if os.path.exists(SHOTS_FILENAME):
    print(f"Loading {SHOTS_FILENAME}...")
    df = pd.read_csv(SHOTS_FILENAME)
    initial_len = len(df)
    
    print(f"Original Row Count: {initial_len}")
    
    # Deduplicate by game_id and event_id
    # We sort by event_id to keep order, but drop_duplicates keeps first/last.
    # We want to keep the LATEST xG calculation if they differ, but we are about to re-calculate anyway.
    # So just keeping one is fine.
    df.drop_duplicates(subset=['game_id', 'event_id'], keep='last', inplace=True)
    
    final_len = len(df)
    print(f"Final Row Count: {final_len}")
    print(f"Removed {initial_len - final_len} duplicate rows.")
    
    df.to_csv(SHOTS_FILENAME, index=False)
    print(f"Saved cleaned file to {SHOTS_FILENAME}")
else:
    print(f"{SHOTS_FILENAME} not found.")
