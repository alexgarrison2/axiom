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
            # Group by game_id, team_id
            agg = df.groupby(['game_id', 'team_id'])['xG'].sum().reset_index()
            agg.columns = ['game_id', 'team_id', 'xG_sum']
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
            
            # We have (game_id, team_id) -> xG_sum
            # GameStats has rows for (game_id, team, opponent, home_away...)
            # We need to map team_id to team name?
            # Or does gamestats have team_id? Not explicitly in the inspect output earlier?
            # Let's check columns.
            # If gamestats uses names (e.g. "Rangers"), we need a mapper.
            # Shots uses team_id (int).
            
            # We need a TeamID -> Name mapper.
            # nhl_teams.csv has Name, ID
            teams_df = pd.read_csv("nhl_teams.csv")
            # Map ID to Common Name to match 'team' column in gamestats logic?
            # Step 17 view_file showed 'team' column has names like "Avalanche", "Stars".
            # nhl_teams.csv has "Common Name" and "NHL Team ID".
            
            id_to_name = dict(zip(teams_df['NHL Team ID'], teams_df['Common Name']))
            
            # Add 'team' name column to df_new_xg
            df_new_xg['team'] = df_new_xg['team_id'].map(id_to_name)
            
            # Now we can join on ['game_id', 'team']
            # xG_for = xG of the team
            # xG_against = xG of the opponent
            
            # Create a lookup: (game_id, team_name) -> xG
            xg_lookup = dict(zip(zip(df_new_xg['game_id'], df_new_xg['team']), df_new_xg['xG_sum']))
            
            # Apply to df_stats
            def update_xg_for(row):
                key = (row['game_id'], row['team'])
                return xg_lookup.get(key, row['xG_for']) # Fallback to old if not found
                
            def update_xg_against(row):
                # Opponent xG
                key = (row['game_id'], row['opponent'])
                return xg_lookup.get(key, row['xG_against'])
                
            df_stats['xG_for'] = df_stats.apply(update_xg_for, axis=1)
            df_stats['xG_against'] = df_stats.apply(update_xg_against, axis=1)
            
            df_stats.to_csv(gamestats_file, index=False)
            print(f"Updated {gamestats_file} with aggregated xG.")
            
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
    
    print("--- Pipeline Refresh Complete ---")

if __name__ == "__main__":
    refresh_pipeline()
