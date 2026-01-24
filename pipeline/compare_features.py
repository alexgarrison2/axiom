
import pandas as pd
import numpy as np

try:
    df_old = pd.read_csv("pipeline/nhl_historical_shots.csv")
    df_new = pd.read_csv("pipeline/nhl_season_2025_2026_shots.csv")
    
    features = ['time_since_last_event', 'distance', 'angle', 'x', 'y', 'score_differential']
    
    print("--- Historical Data Stats ---")
    print(df_old[features].describe())
    
    print("\n--- 2025 Data Stats ---")
    print(df_new[features].describe())
    
except Exception as e:
    print(e)
