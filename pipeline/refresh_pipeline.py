import pandas as pd
import pickle
import json
import xgboost as xgb
from xg_model import preprocess_data
from team_ratings import calculate_ratings
from predict_games import predict

def refresh_pipeline():
    print("--- Starting Full Pipeline Refresh ---")

    # 0. Fetch Latest Game Data (and Shots)
    print("Fetching missing game data...")
    import nhl_scraper_poc
    nhl_scraper_poc.main()
    
    # 1. Load the new Model
    print("Loading XGBoost model...")
    with open('xg_model_xgb.pkl', 'rb') as f:
        model = pickle.load(f)
        
    # 2. Re-Score Shots (Historical & Current)
    shot_files = [
        "nhl_historical_shots.csv",
        "nhl_season_2025_2026_shots.csv"
    ]
    
    all_game_xg = []
    
    for filename in shot_files:
        print(f"Processing {filename}...")
        try:
            df = pd.read_csv(filename)
            
            # Preprocess to get features (Bins, Off-Wing, Handedness)
            # This uses the logic we updated in xg_model.py
            # Note: preprocess_data returns X, y. We just need to ensure it applies to the whole df.
            # We assume df has 'player_id', 'x', 'y' etc.
            
            # We need to temporarily suppress print in preprocess_data or just ignore it
            X, _ = preprocess_data(df)
            
            # Predict
            probs = model.predict_proba(X)[:, 1]
            
            # Update data
            df['xG'] = probs
            
            # Save back to CSV
            df.to_csv(filename, index=False)
            print(f"Updated {filename} with new xG values.")
            
            # Aggregate for GameStats
            # We need game_id, team_id, xG
            # Group by game_id, team_id, strength_state
            # We want both Total xG and 5v5 xG
            print(f"Aggregating xG from {filename}...")
            
            # Total xG
            agg_total = df.groupby(['game_id', 'team_id'])['xG'].sum().reset_index()
            agg_total.columns = ['game_id', 'team_id', 'xG_sum']
            
            # 5v5 xG
            if 'strength_state' in df.columns:
                agg_5v5 = df[df['strength_state'] == '5v5'].groupby(['game_id', 'team_id'])['xG'].sum().reset_index()
                agg_5v5.columns = ['game_id', 'team_id', 'xG_5v5_sum']
                agg = pd.merge(agg_total, agg_5v5, on=['game_id', 'team_id'], how='left').fillna(0)
            else:
                agg = agg_total
                agg['xG_5v5_sum'] = agg['xG_sum'] * 0.8 # Fallback if strength missing

            all_game_xg.append(agg)
            
        except FileNotFoundError:
            print(f"Skipping {filename} (not found)")
            
    # 3. Update GameStats CSV
    # We load the existing gamestats, and UPDATE the xG_for / xG_against columns
    # We do NOT want to lose other stats (goals, hits, etc)
    print("Updating GameStats...")
    gamestats_file = "nhl_season_2025_2026_gamestats.csv"
    try:
        df_stats = pd.read_csv(gamestats_file)
        
        # Concatenate our recalculated xG sums
        if all_game_xg:
            df_new_xg = pd.concat(all_game_xg)
            
            # We have (game_id, team_id) -> xG_sum, xG_5v5_sum
            teams_df = pd.read_csv("nhl_teams.csv")
            id_to_name = dict(zip(teams_df['NHL Team ID'], teams_df['Common Name']))
            
            df_new_xg['team'] = df_new_xg['team_id'].map(id_to_name)
            
            # Ensure types match
            df_new_xg['game_id'] = df_new_xg['game_id'].astype(int)
            df_stats['game_id'] = df_stats['game_id'].astype(int)
            
            # Create lookups
            xg_lookup = dict(zip(zip(df_new_xg['game_id'], df_new_xg['team']), df_new_xg['xG_sum']))
            xg_5v5_lookup = dict(zip(zip(df_new_xg['game_id'], df_new_xg['team']), df_new_xg['xG_5v5_sum']))
            
            print(f"DEBUG: Lookup size: {len(xg_lookup)}")
            sample_key = (2025020001, 'Panthers')
            if sample_key in xg_lookup:
                 print(f"DEBUG: Found sample key {sample_key}: {xg_lookup[sample_key]}")
            else:
                 print(f"DEBUG: MISSING sample key {sample_key}. Keys sample: {list(xg_lookup.keys())[:5]}")

            # Apply to df_stats
            def update_xg_for(row):
                key = (row['game_id'], row['team'])
                val = xg_lookup.get(key, -1.0) # Use -1 to detect failure
                if val == -1.0:
                    # Only print once per game/team to avoid spam
                    if row['game_id'] == 2025020001:
                        print(f"DEBUG WARN: Could not find update for {key}. Keeping {row['xG_for']}")
                    return row['xG_for']
                return val
            
            # Reset other updators to likely use the new value logic or just same pattern
            def update_xg_against(row):
                 key = (row['game_id'], row['opponent'])
                 return xg_lookup.get(key, row['xG_against'])

            def update_xg_5v5_for(row):
                 key = (row['game_id'], row['team'])
                 return xg_5v5_lookup.get(key, row['xG_for_5v5'])

            def update_xg_5v5_against(row):
                 key = (row['game_id'], row['opponent'])
                 return xg_5v5_lookup.get(key, row['xG_against_5v5'])
                
            df_stats['xG_for'] = df_stats.apply(update_xg_for, axis=1)
            df_stats['xG_against'] = df_stats.apply(update_xg_against, axis=1)
            df_stats['xG_for_5v5'] = df_stats.apply(update_xg_5v5_for, axis=1)
            df_stats['xG_against_5v5'] = df_stats.apply(update_xg_5v5_against, axis=1)
            
            df_stats.to_csv(gamestats_file, index=False)
            print(f"Updated {gamestats_file} with aggregated total and 5v5 xG.")
            
            # Sync to app data folders
            try:
                # Sync to public/data (for Frontend) - MUST be named gamestats.csv
                df_stats.to_csv('../public/data/gamestats.csv', index=False)
                print(f"Synced {gamestats_file} to ../public/data/gamestats.csv")
                
                # Sync to data/ (as backup/legacy)
                df_stats.to_csv('../data/gamestats.csv', index=False) 
                print(f"Synced {gamestats_file} to ../data/gamestats.csv")
                
                # Remove the incorrectly named file if it exists (cleanup)
                import os
                wrong_file = f'../public/data/{gamestats_file}'
                if os.path.exists(wrong_file):
                    os.remove(wrong_file)
                    print(f"Removed incorrectly named file: {wrong_file}")
                    
            except Exception as e:
                print(f"Warning: Could not sync gamestats file to app folders: {e}")
            
    except FileNotFoundError:
        print("GameStats file not found.")

    # 4. Regenerate Ratings
    print("Regenerating Team & Goalie Ratings...")
    calculate_ratings(gamestats_file=gamestats_file)
    
    # 5. Fetch Latest Schedule, Goalies, and Odds
    print("Fetching latest Schedule & Goalies...")
    import fetch_upcoming
    fetch_upcoming.fetch_schedule()
    
    print("Fetching official goalie stats...")
    import fetch_nhl_goalie_stats
    fetch_nhl_goalie_stats.fetch_nhl_goalie_stats() # Added call
    
    print("Fetching latest Odds...")
    import fetch_odds
    fetch_odds.fetch_odds()
    
    # 6. Predict Games
    print("Running Predictions...")
    predict()

    # 7. Generate History
    print("Generating Prediction History...")
    import generate_history
    generate_history.generate_history()
    
    # 8. Final Sync of History and others
    print("Final Sync...")
    import shutil
    try:
        # History (already generated into ../data/ by generate_history.py)
        src_history = '../data/prediction_history.json'
        if os.path.exists(src_history):
            shutil.copy(src_history, '../public/data/prediction_history.json')
            print("Synced prediction_history.json to public/data/")
        
        # Last Updated
        if os.path.exists('last_updated.json'):
            shutil.copy('last_updated.json', '../data/last_updated.json')
            shutil.copy('last_updated.json', '../public/data/last_updated.json')
            print("Synced last_updated.json")
            
    except Exception as e:
        print(f"Warning: Final sync failed: {e}")
    
    print("--- Pipeline Refresh Complete ---")

if __name__ == "__main__":
    refresh_pipeline()
