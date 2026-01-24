
import pandas as pd
import os

files = ["pipeline/nhl_historical_shots.csv", "nhl_historical_shots.csv"]
found = False
for f in files:
    if os.path.exists(f):
        print(f"Analyzing {f}...")
        df = pd.read_csv(f)
        print(f"Rows: {len(df)}")
        
        # Check Goal Rate
        if 'is_goal' in df.columns:
            goals = df['is_goal'].sum()
            rate = goals / len(df)
            print(f"Total Goals: {goals}")
            print(f"Goal Rate: {rate:.4f} (Expected ~0.05-0.10)")
        elif 'event_type' in df.columns:
            goals = df[df['event_type'] == 505].shape[0]
            rate = goals / len(df)
            print(f"Total Goals (505): {goals}")
            print(f"Goal Rate: {rate:.4f}")
            
        print(df.head())
        found = True
        break

if not found:
    print("Historical shots file not found.")
