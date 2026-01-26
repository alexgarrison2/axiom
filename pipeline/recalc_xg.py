
import pandas as pd
import pickle
import os
from xg_model import preprocess_data

def recalculate():
    print("Loading model and data...")
    
    # Paths
    SHOTS_FILE = "nhl_season_2025_2026_shots.csv"
    GAME_STATS_FILE = "nhl_season_2025_2026_gamestats.csv"
    MODEL_FILE = "xg_model_xgb.pkl"
    
    # Check for files in pipeline/ or root
    if not os.path.exists(MODEL_FILE) and os.path.exists(f"pipeline/{MODEL_FILE}"):
        MODEL_FILE = f"pipeline/{MODEL_FILE}"
        
    if not os.path.exists(SHOTS_FILE) and os.path.exists(f"pipeline/{SHOTS_FILE}"):
        SHOTS_FILE = f"pipeline/{SHOTS_FILE}"
        
    if not os.path.exists(GAME_STATS_FILE) and os.path.exists(f"pipeline/{GAME_STATS_FILE}"):
        GAME_STATS_FILE = f"pipeline/{GAME_STATS_FILE}"

    # Load Model
    with open(MODEL_FILE, 'rb') as f:
        model = pickle.load(f)
        
    # Load Shots
    df_shots = pd.read_csv(SHOTS_FILE)
    print(f"Loaded {len(df_shots)} shots.")
    
    # Preprocess
    print("Preprocessing...")
    X, _ = preprocess_data(df_shots)
    
    # Predict
    print("Predicting xG...")
    probs = model.predict_proba(X)[:, 1]
    
    # Update Shots DataFrame
    df_shots['xG'] = probs
    print(f"New xG Mean: {df_shots['xG'].mean()}")
    
    # Save updated shots
    df_shots.to_csv(SHOTS_FILE, index=False)
    print(f"Saved updated shots to {SHOTS_FILE}")
    
    # Aggregation
    print("Aggregating by Game and Team...")
    xg_sums = df_shots.groupby(['game_id', 'team_id'])['xG'].sum().reset_index()
    xg_sums_5v5 = df_shots[df_shots['strength_state'] == '5v5'].groupby(['game_id', 'team_id'])['xG'].sum().reset_index()
    xg_sums_5v5.rename(columns={'xG': 'xG_5v5'}, inplace=True)
    
    # Load Game Stats
    df_stats = pd.read_csv(GAME_STATS_FILE)
    print(f"Loaded {len(df_stats)} game logs.")
    
    # We need to map team_id to team name used in gamestats? 
    # gamestats has 'game_id', 'team' (Common Name), 'opponent'
    # It does NOT have 'team_id' column visible in the head output I saw earlier.
    # Wait, `nhl_scraper_poc.py` logic:
    # row = { "game_id": ..., "team": stats['name'] ... }
    # It doesn't save team_id in gamestats.csv.
    # But we can join on 'game_id' and... we need to match team.
    # The shots file has 'team_id'. 'gamestats' has team Name.
    # We need a mapping ID -> Name from shots?
    # Or rely on 'home_away' column in gamestats?
    # Shots file has 'team_id'. We might need to assist mapping.
    # Wait, `gamestats.csv` row order is: Home Row, Away Row? Or random?
    # 
    # Let's use `nhl_teams.csv` to map team_id to Name if needed.
    # Or, we can use the fact that for each game there are 2 teams.
    # In `gamestats`, we have `game_id` and `home_away`.
    # In `shots`, we have `team_id`.
    # We can infer: `home_team_id` from schedule/shots?
    # Or just load `nhl_teams.csv`?
    
    # Attempt to load team mapping
    try:
        teams_df = pd.read_csv("data/nhl_teams.csv")
        # Map ID to Common Name
        id_to_name = dict(zip(teams_df['NHL Team ID'], teams_df['Common Name']))
    except:
        try:
            teams_df = pd.read_csv("../data/nhl_teams.csv")
            id_to_name = dict(zip(teams_df['NHL Team ID'], teams_df['Common Name']))
        except:
            print("Could not load nhl_teams.csv. Cannot map IDs.")
            return

    # Update Stats
    # Iterate through stats rows
    updates = 0
    for idx, row in df_stats.iterrows():
        g_id = row['game_id']
        team_name = row['team']
        
        # Find team ID for this name? 
        # Reverse map? Name -> ID
        name_to_id = {v: k for k, v in id_to_name.items()}
        t_id = name_to_id.get(team_name)
        
        # Special case: Utah?
        if team_name == "Mammoth" and "Utah" in name_to_id: # Assuming mapping mismatch risk
             pass # Hopefully name matches
             
        if not t_id:
            # Try fuzzy or manual
            # But let's assume standard names match
            continue
            
        # Get xG sum from aggregated
        # Filter xg_sums
        match = xg_sums[(xg_sums['game_id'] == g_id) & (xg_sums['team_id'] == t_id)]
        if not match.empty:
            new_xg = match.iloc[0]['xG']
            df_stats.at[idx, 'xG_for'] = round(new_xg, 2)
            
            # Opponent xG (xG_against)
            # Find opponent ID in this game
            opp_match = xg_sums[(xg_sums['game_id'] == g_id) & (xg_sums['team_id'] != t_id)]
            if not opp_match.empty:
               new_xg_ag = opp_match.iloc[0]['xG']
               df_stats.at[idx, 'xG_against'] = round(new_xg_ag, 2)
               
            updates += 1
            
        # 5v5
        match_5 = xg_sums_5v5[(xg_sums_5v5['game_id'] == g_id) & (xg_sums_5v5['team_id'] == t_id)]
        if not match_5.empty:
            new_xg_5 = match_5.iloc[0]['xG_5v5']
            df_stats.at[idx, 'xG_for_5v5'] = round(new_xg_5, 2)
            
            opp_match_5 = xg_sums_5v5[(xg_sums_5v5['game_id'] == g_id) & (xg_sums_5v5['team_id'] != t_id)]
            if not opp_match_5.empty:
                new_xg_ag_5 = opp_match_5.iloc[0]['xG_5v5']
                df_stats.at[idx, 'xG_against_5v5'] = round(new_xg_ag_5, 2)

    print(f"Updated {updates} rows.")
    df_stats.to_csv(GAME_STATS_FILE, index=False)
    print(f"Saved updated gamestats to {GAME_STATS_FILE}")
    
    # Also update public/data if valid
    PUBLIC_PATH = "public/data/gamestats.csv"
    if os.path.exists("public/data"):
        df_stats.to_csv(PUBLIC_PATH, index=False)
        print(f"Synced to {PUBLIC_PATH}")

    # Also update data/gamestats.csv if valid (Server-side fallback)
    DATA_PATH = "data/gamestats.csv"
    if os.path.exists("data"):
        df_stats.to_csv(DATA_PATH, index=False)
        print(f"Synced to {DATA_PATH}")

if __name__ == "__main__":
    recalculate()
