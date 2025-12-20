import pandas as pd
import json

df = pd.read_csv('../public/data/predictions_detailed.csv')
for i, row in df.iterrows():
    print(f"Game: {row['home_team']} vs {row['away_team']}")
    try:
        explained = json.loads(row['home_xg_explained'])
        print(f"  Home Explained: {explained}")
    except:
        print(f"  Home Explained: {row['home_xg_explained']}")
    try:
        explained = json.loads(row['away_xg_explained'])
        print(f"  Away Explained: {explained}")
    except:
        print(f"  Away Explained: {row['away_xg_explained']}")
    print("-" * 20)
