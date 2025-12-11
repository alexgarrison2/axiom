import pandas as pd
import json

def verify():
    df = pd.read_csv('nhl-predictions-app/data/predictions_detailed.csv')
    
    print(f"Loaded {len(df)} rows.")
    
    # Check if columns exist
    if 'home_starter_vs_opp' not in df.columns:
        print("ERROR: 'home_starter_vs_opp' column missing.")
        return
        
    # Check for non-empty values
    found = 0
    for idx, row in df.iterrows():
        h_stats = row.get('home_starter_vs_opp')
        a_stats = row.get('away_starter_vs_opp')
        
        if pd.notna(h_stats) and h_stats and h_stats != "":
            try:
                data = json.loads(h_stats)
                print(f"Row {idx} Home: {row['home_starter']} vs {row['away_team']} -> {data}")
                found += 1
            except:
                print(f"Row {idx} Home JSON Error: {h_stats}")

        if pd.notna(a_stats) and a_stats and a_stats != "":
            try:
                data = json.loads(a_stats)
                print(f"Row {idx} Away: {row['away_starter']} vs {row['home_team']} -> {data}")
                found += 1
            except:
                pass
                
    print(f"Found {found} populated stats entries.")

if __name__ == "__main__":
    verify()
