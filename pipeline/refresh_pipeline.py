import pandas as pd
import pickle
import json
import time
import xgboost as xgb
from xg_model import preprocess_data
from team_ratings import calculate_ratings
from predict_games import predict
from dotenv import load_dotenv
import os

# Load environment variables (for local runs)
load_dotenv()

# Force the working directory to be the directory of this script (pipeline/)
# This ensures that all relative paths (like ../public/data) work correctly
# regardless of where the command is executed from.
if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

def refresh_pipeline():
    print("--- Starting Full Pipeline Refresh ---")

    # -1. Prune Recent Data (Force Re-scrape for Special Teams fix)
    # We remove games >= 2026-01-13 so they get re-processed with H-Ref data
    print("Pruning recent gamestats to force re-scrape...")
    gamestats_file = "nhl_season_2025_2026_gamestats.csv"
    try:
        df = pd.read_csv(gamestats_file)
        # Convert date
    #     if 'game_date' in df.columns:
    #         df['game_date'] = pd.to_datetime(df['game_date'])
    #         original_len = len(df)
    #         # Prune
    #         df = df[df['game_date'] < "2026-01-13"]
    #         pruned_len = len(df)
    #         if pruned_len < original_len:
    #             df.to_csv(gamestats_file, index=False)
    #             print(f"Pruned {original_len - pruned_len} rows from {gamestats_file}.")
    except FileNotFoundError:
        pass
        
    # 0a. Fetch H-Ref Stats (Special Teams Source of Truth)
    print("Fetching H-Ref Stats...")
    import fetch_href_stats
    fetch_href_stats.main()
    
    # 0b. Sanitize History (Backfill H-Ref data into gamestats)
    print("Sanitizing Historical Special Teams data...")
    import backfill_special_teams
    backfill_special_teams.backfill_special_teams()

    # 0c. Backfill/Verify with Official NHL Boxscores (Fix "Ghost Goals")
    print("Verifying Special Teams Goals via NHL API...")
    import backfill_nhl_ppg
    backfill_nhl_ppg.backfill_nhl_ppg()

    # 0c. Fetch Latest Game Data (and Shots)
    print("Fetching missing game data...")
    import nhl_scraper_poc
    nhl_scraper_poc.main()

    # 0d. Backfill per-player boxscore stats (goals/assists/TOI per game)
    # Used by SkaterGrid availability strip and standard stat rows.
    # Incremental: skips game_ids already present in the CSV.
    print("Backfilling player boxscore stats...")
    try:
        import backfill_player_stats
        backfill_player_stats.main()
    except Exception as e:
        print(f"[WARN] Player stats backfill failed: {e}")

    # 0e. Refresh player bio data (age, height, weight, shoots) from NHL roster API
    # Runs once per day to keep ages current; very fast (~32 requests, one per team).
    print("Refreshing player bio data...")
    try:
        import fetch_player_bio
        fetch_player_bio.main()
    except Exception as e:
        print(f"[WARN] Player bio fetch failed: {e}")

    # 0f. Fetch contract data (cap hit, UFA/RFA status) from PuckPedia
    # Only re-fetches if contracts.json is older than 7 days — contract data
    # rarely changes and PuckPedia blocks frequent scrapers.
    _contracts_file = os.path.join('..', 'public', 'data', 'contracts.json')
    _contracts_age_days = 999
    if os.path.exists(_contracts_file):
        _contracts_age_days = (time.time() - os.path.getmtime(_contracts_file)) / 86400
    if _contracts_age_days >= 7:
        print(f"Fetching contract data from PuckPedia (last updated {_contracts_age_days:.1f} days ago)...")
        try:
            import fetch_contracts
            fetch_contracts.main()
        except Exception as e:
            print(f"[WARN] Contract data fetch failed: {e}")
    else:
        print(f"Skipping contract fetch — data is {_contracts_age_days:.1f} days old (threshold: 7 days).")

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

            # Validation guard: catch silently wrong predictions (e.g. from sklearn version mismatch)
            mean_xg = df['xG'].mean()
            print(f"  Mean xG per shot: {mean_xg:.4f} (expected ~0.07)")
            if mean_xg > 0.15:
                raise ValueError(
                    f"ABORT: Mean xG per shot is {mean_xg:.4f} (expected ~0.07). "
                    f"Model may be producing invalid predictions due to library version mismatch. "
                    f"Check that scikit-learn and xgboost versions match the model pickle."
                )

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
                # 5v4 (Power Play) xG — used for xG-based PP/PK rates in team_ratings
                agg_pp = df[df['strength_state'] == '5v4'].groupby(['game_id', 'team_id'])['xG'].sum().reset_index()
                agg_pp.columns = ['game_id', 'team_id', 'xG_pp_sum']
                agg = pd.merge(agg, agg_pp, on=['game_id', 'team_id'], how='left').fillna(0)
            else:
                agg = agg_total
                agg['xG_5v5_sum'] = agg['xG_sum'] * 0.8 # Fallback if strength missing
                agg['xG_pp_sum'] = 0.0

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
            xg_pp_lookup = dict(zip(zip(df_new_xg['game_id'], df_new_xg['team']), df_new_xg['xG_pp_sum']))
            
            # Apply to df_stats
            def update_xg_for(row):
                key = (row['game_id'], row['team'])
                val = xg_lookup.get(key, -1.0) # Use -1 to detect failure
                if val == -1.0:
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
                
            def update_xg_pp_for(row):
                key = (row['game_id'], row['team'])
                return xg_pp_lookup.get(key, row.get('xG_pp_for', 0))

            def update_xg_pp_against(row):
                key = (row['game_id'], row['opponent'])
                return xg_pp_lookup.get(key, row.get('xG_pp_against', 0))

            df_stats['xG_for'] = df_stats.apply(update_xg_for, axis=1)
            df_stats['xG_against'] = df_stats.apply(update_xg_against, axis=1)
            df_stats['xG_for_5v5'] = df_stats.apply(update_xg_5v5_for, axis=1)
            df_stats['xG_against_5v5'] = df_stats.apply(update_xg_5v5_against, axis=1)
            df_stats['xG_pp_for'] = df_stats.apply(update_xg_pp_for, axis=1)
            df_stats['xG_pp_against'] = df_stats.apply(update_xg_pp_against, axis=1)
            
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

    # 4b. Fetch MoneyPuck player-level data & compute impact scores
    # This runs after team ratings so the pipeline has fresh season context.
    # MoneyPuck updates nightly; we fetch once per full pipeline run (~12-14 UTC).
    print("Fetching MoneyPuck player-level data...")
    try:
        import fetch_moneypuck
        fetch_moneypuck.fetch_moneypuck()
    except Exception as e:
        print(f"[WARN] MoneyPuck fetch failed (predictions will use team ratings only): {e}")

    # 4c. Compute PBP-derived HD metrics (must run BEFORE player_impact so that
    #     pbp_metrics.json is available for the impact score computation).
    #     Requires: enriched PBP (run enrich_pbp.py) + shots CSV.
    print("Computing PBP-derived HD metrics (calc_pbp_impact)...")
    try:
        import calc_pbp_impact
        calc_pbp_impact.run_pbp_impact()
    except Exception as e:
        print(f"[WARN] PBP HD metrics failed (impact scores will use MoneyPuck only): {e}")

    print("Computing player impact scores...")
    try:
        import player_impact
        pi, la = player_impact.calculate_player_impact()
        print(f"  Player impact profiles built: {len(pi)} players")
    except Exception as e:
        print(f"[WARN] Player impact calculation failed: {e}")

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
        # Last Updated - Source from public/data (where predict_games.py wrote it)
        src_last_updated = '../public/data/last_updated.json'
        if os.path.exists(src_last_updated):
            shutil.copy(src_last_updated, '../data/last_updated.json')
            print(f"Synced {src_last_updated} to ../data/")
        elif os.path.exists('last_updated.json'):
             # Fallback if public/data one missing but local one exists
            shutil.copy('last_updated.json', '../data/last_updated.json')
            shutil.copy('last_updated.json', '../public/data/last_updated.json')
            print("Synced local last_updated.json to data dirs")
        
        # Additional syncs from pipeline to public/data
        if os.path.exists("upcoming_games.json"):
            shutil.copy("upcoming_games.json", "../public/data/upcoming_games.json")
            print("Synced upcoming_games.json to public/data")

        if os.path.exists("team_lineups.json"):
            shutil.copy("team_lineups.json", "../public/data/team_lineups.json")
            print("Synced team_lineups.json to public/data")

        # Note: nhl_season_2025_2026_player_stats.csv is written directly to
        # public/data/ by backfill_player_stats.py (step 0d above). No copy needed.
        
        # Sync Odds
        if os.path.exists('odds.json'):
            shutil.copy('odds.json', '../public/data/odds.json')
            shutil.copy('odds.json', '../data/odds.json')
            print("Synced odds.json to public/data/ and data/")
            
        print("Data synced to public/data/")
            
    except Exception as e:
        print(f"Warning: Final sync failed: {e}")

    # 9. Upload to Supabase (Snapshot)
    print("Uploading to Supabase...")
    import subprocess
    import sys
    try:
        # We need to run from root dir because the script expects "public/data/..." paths
        # Current file is in pipeline/, so root is one level up.
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        snap_script = os.path.join(root_dir, "scripts", "snapshot_predictions.py")
        
        if os.path.exists(snap_script):
            # Pass current env vars (important for DB_PASSWORD)
            result = subprocess.run([sys.executable, snap_script], cwd=root_dir, env=os.environ.copy())
            if result.returncode != 0:
                print(f"Warning: Supabase script exited with code {result.returncode}")
        else:
            print(f"Warning: Could not find {snap_script}")
            
    except Exception as e:
        print(f"Warning: Supabase upload failed to start: {e}")

    # 10. Upload Full History to Supabase (Predictions Table)
    print("Syncing History to Supabase 'predictions' table...")
    try:
        sync_script = os.path.join(root_dir, "scripts", "sync_history_to_supabase.py")
        if os.path.exists(sync_script):
            result = subprocess.run([sys.executable, sync_script], cwd=root_dir, env=os.environ.copy())
            if result.returncode != 0:
                print(f"Warning: History sync script exited with code {result.returncode}")
        else:
            print(f"Warning: Could not find {sync_script}")
    except Exception as e:
         print(f"Warning: History sync failed to start: {e}")

    print("--- Pipeline Refresh Complete ---")

if __name__ == "__main__":
    refresh_pipeline()
