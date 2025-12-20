import pandas as pd
import json

df = pd.read_csv('../public/data/predictions_detailed.csv')
for i, row in df.iterrows():
    if row['away_starter'] and 'David Rittich' in row['away_starter']:
        print(f"Game: {row['home_team']} vs {row['away_team']}")
        print(f"  Away Starter: {row['away_starter']}")
        print(f"  Home xG: {row['home_xg']}")
        print(f"  Home Explained: {row['home_xg_explained']}")
        print(f"  Away GSAx Total: {row['away_gsax_total']}")
        print(f"  Away GSAx Pct: {row['away_gsax_pct']}")
        print("-" * 20)
