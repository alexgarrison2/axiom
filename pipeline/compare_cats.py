
import pandas as pd

try:
    df_old = pd.read_csv("pipeline/nhl_historical_shots.csv")
    df_new = pd.read_csv("pipeline/nhl_season_2025_2026_shots.csv")
    
    print("--- Historical Shot Types ---")
    print(df_old['shot_type'].value_counts(normalize=True))
    
    print("\n--- 2025 Shot Types ---")
    print(df_new['shot_type'].value_counts(normalize=True))
    
except Exception as e:
    print(e)
