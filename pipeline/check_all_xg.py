import pandas as pd
df = pd.read_csv('/Users/alexgarrison/Downloads/HockeyData/nhl-predictions-app/data/predictions_detailed.csv')
for i, row in df.iterrows():
    print(f"{row['home_team']} vs {row['away_team']}: H_xG={row['home_xg']}, A_xG={row['away_xg']}")
