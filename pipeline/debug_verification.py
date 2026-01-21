import pandas as pd
import json

try:
    df = pd.read_csv('public/data/predictions_detailed.csv')
    # Filter for Flames vs Penguins
    # Use loose matching
    game = df[((df['home_team'] == 'Flames') & (df['away_team'] == 'Penguins')) | 
              ((df['home_team'] == 'Penguins') & (df['away_team'] == 'Flames'))]
    
    if game.empty:
        print("Game not found in CSV yet.")
    else:
        row = game.iloc[0]
        print(f"Matchup: {row['away_team']} @ {row['home_team']}")
        print(f"Date: {row['game_date']}")
        
        h_expl = json.loads(row['home_xg_explained'])
        a_expl = json.loads(row['away_xg_explained'])
        
        def get_st_val(expl):
            for item in expl:
                if "Special Teams" in item:
                    return item
            return "N/A"
            
        print(f"Home ({row['home_team']}) ST: {get_st_val(h_expl)}")
        print(f"Away ({row['away_team']}) ST: {get_st_val(a_expl)}")
        
        # Also print Ranks/Ratings if evident
        print(f"Home PP Rank: {row.get('home_pp_rank')}, PK Rank: {row.get('home_pk_rank')}")
        print(f"Away PP Rank: {row.get('away_pp_rank')}, PK Rank: {row.get('away_pk_rank')}")

except Exception as e:
    print(f"Error: {e}")
