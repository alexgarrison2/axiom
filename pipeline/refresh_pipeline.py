import pandas as pd
import pickle
import json
import time
import xgboost as xgb
from xg_model import preprocess_data
from team_ratings import calculate_ratings
from predict_games import predict
from shooting_talent import compute_shooting_talent, load_shooting_talent, apply_shooting_talent
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

    # 0e2. Fetch official clinch/elimination status from NHL Standings API.
    # Very fast (1 request). Updates clinch_status.json with p/z/y/x/e indicators.
    print("Fetching clinch/elimination status...")
    try:
        import fetch_clinch_status
        fetch_clinch_status.main()
    except Exception as e:
        print(f"[WARN] Clinch status fetch failed: {e}")

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

    # 1b. Compute Shooting Talent Factors
    # Uses existing xG values on disk (from previous scoring) to compute
    # per-player goals/xG ratios with Bayesian shrinkage.
    # Talent factors are then applied AFTER re-scoring shots below.
    print("\n--- Computing Shooting Talent Factors ---")
    try:
        talent_map = compute_shooting_talent()
    except Exception as e:
        print(f"  [WARN] Shooting talent computation failed: {e}")
        talent_map = {}

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
            
            # ── Empty Net Override ─────────────────────────────────────────
            # The xG model has no concept of empty net — it assigns ~0.09 xG
            # to EN shots that actually convert at ~52%. Override with the
            # empirical EN goal rate so GSAx isn't distorted.
            EN_XG = 0.52
            if 'strength_state' in df.columns:
                en_mask = df['strength_state'] == 'EmptyNet'
                n_en = en_mask.sum()
                if n_en > 0:
                    df.loc[en_mask, 'xG'] = EN_XG
                    print(f"  Empty net override: {n_en} shots → xG={EN_XG}")
            # ──────────────────────────────────────────────────────────────

            # Validation guard: catch silently wrong predictions (e.g. from sklearn version mismatch)
            mean_xg = df['xG'].mean()
            print(f"  Mean xG per shot: {mean_xg:.4f} (expected ~0.07)")
            if mean_xg > 0.15:
                raise ValueError(
                    f"ABORT: Mean xG per shot is {mean_xg:.4f} (expected ~0.07). "
                    f"Model may be producing invalid predictions due to library version mismatch. "
                    f"Check that scikit-learn and xgboost versions match the model pickle."
                )

            # ── Shooting Talent Adjustment ─────────────────────────────────
            # Multiply each shot's xG by the shooter's talent factor.
            # Elite finishers (Panarin, Thompson) get boosted; poor finishers
            # get reduced. Unknown players default to 1.0 (no change).
            if talent_map and 'player_id' in df.columns:
                apply_shooting_talent(df, talent_map)

            # ── League-wide Normalization ─────────────────────────────────
            # Scale all xG so total xG = total goals for this file.
            # Seasonal conversion rates vary from the training mean (~7.1%),
            # so without normalization GSAx drifts positive or negative
            # league-wide. Standard practice (MoneyPuck, Evolving Hockey).
            if 'is_goal' in df.columns:
                total_xg = df['xG'].sum()
                total_goals = df['is_goal'].sum()
                if total_xg > 0 and total_goals > 0:
                    norm_factor = total_goals / total_xg
                    df['xG'] *= norm_factor
                    print(f"  League normalization: factor={norm_factor:.4f} "
                          f"(xG {total_xg:.0f} → {total_goals} goals)")

            # xG_flurry_adj kept as a column for downstream compatibility,
            # but set equal to xG (no flurry discount — see 3.1 investigation:
            # rebound/scramble shots score at or above model predictions,
            # so discounting them was destroying calibration).
            df['xG_flurry_adj'] = df['xG']
            # ──────────────────────────────────────────────────────────────

            # Save back to CSV (includes both xG and xG_flurry_adj)
            df.to_csv(filename, index=False)
            print(f"Updated {filename} with new xG values.")
            
            # Aggregate for GameStats — use flurry-adjusted xG for team totals
            # We need game_id, team_id, xG
            # Group by game_id, team_id, strength_state
            # We want both Total xG and 5v5 xG
            print(f"Aggregating xG from {filename}...")
            
            # Total xG (flurry-adjusted)
            agg_total = df.groupby(['game_id', 'team_id'])['xG_flurry_adj'].sum().reset_index()
            agg_total.columns = ['game_id', 'team_id', 'xG_sum']
            
            # 5v5 xG (flurry-adjusted)
            if 'strength_state' in df.columns:
                agg_5v5 = df[df['strength_state'] == '5v5'].groupby(['game_id', 'team_id'])['xG_flurry_adj'].sum().reset_index()
                agg_5v5.columns = ['game_id', 'team_id', 'xG_5v5_sum']
                agg = pd.merge(agg_total, agg_5v5, on=['game_id', 'team_id'], how='left').fillna(0)
                # 5v4 (Power Play) xG — used for xG-based PP/PK rates in team_ratings
                agg_pp = df[df['strength_state'] == '5v4'].groupby(['game_id', 'team_id'])['xG_flurry_adj'].sum().reset_index()
                agg_pp.columns = ['game_id', 'team_id', 'xG_pp_sum']
                agg = pd.merge(agg, agg_pp, on=['game_id', 'team_id'], how='left').fillna(0)
            else:
                agg = agg_total
                agg['xG_5v5_sum'] = agg['xG_sum'] * 0.8 # Fallback if strength missing
                agg['xG_pp_sum'] = 0.0

            all_game_xg.append(agg)
            
        except FileNotFoundError:
            print(f"Skipping {filename} (not found)")
            
    # 2b. Compute per-game and per-period HD + per-period xG from shots CSV.
    # Runs after xG scoring so per-period xG is always in sync with the model.
    # Covers both new games (where scraper may not have had API coords yet)
    # and all historical games.
    print("Computing HD and per-period xG/HD from shots CSV...")
    HIGH_DANGER_BINS = {'D2_W3_In', 'D2_W2', 'D1_W2_In', 'D3_W1', 'D2_W1', 'D1_W1'}  # D3_W2 removed
    try:
        from nhl_scraper_poc import assign_bin
        shots_hd_file = "nhl_season_2025_2026_shots.csv"
        shots_hd = pd.read_csv(shots_hd_file)

        teams_csv = pd.read_csv("nhl_teams.csv")
        tid_to_name = dict(zip(teams_csv['NHL Team ID'].astype(int), teams_csv['Common Name']))

        shots_hd['_bin'] = shots_hd.apply(
            lambda r: assign_bin(r['x'] if pd.notna(r['x']) else None,
                                 r['y'] if pd.notna(r['y']) else None), axis=1)
        shots_hd['_hd'] = shots_hd['_bin'].isin(HIGH_DANGER_BINS).astype(int)
        shots_hd['_period_key'] = shots_hd['period'].apply(lambda p: min(int(p), 4) if pd.notna(p) else 4)
        shots_hd['_xG'] = pd.to_numeric(shots_hd['xG'], errors='coerce').fillna(0.0)
        shots_hd['team_name'] = shots_hd['team_id'].astype(int).map(tid_to_name)

        # --- Compute per-game HD + per-period xG/HD aggregates ---
        hd_game = {}   # (game_id, team_name) -> {hdf, hda, hdf_1..4, hda_1..4, xg_1..4}
        for (gid, tname), grp in shots_hd.groupby(['game_id', 'team_name']):
            key = (int(gid), tname)
            entry = {'hdf': 0, 'hda': 0,
                     'hdf_1P': 0, 'hdf_2P': 0, 'hdf_3P': 0, 'hdf_OT': 0,
                     'hda_1P': 0, 'hda_2P': 0, 'hda_3P': 0, 'hda_OT': 0,
                     'xg_for_1P': 0.0, 'xg_for_2P': 0.0, 'xg_for_3P': 0.0, 'xg_for_OT': 0.0}
            hd_rows = grp[grp['_hd'] == 1]
            entry['hdf'] = int(len(hd_rows))
            for p in [1, 2, 3, 4]:
                suffix = {1: '1P', 2: '2P', 3: '3P', 4: 'OT'}[p]
                p_hd = hd_rows[hd_rows['_period_key'] == p]
                p_all = grp[grp['_period_key'] == p]
                entry[f'hdf_{suffix}'] = int(len(p_hd))
                entry[f'xg_for_{suffix}'] = float(p_all['_xG'].sum())
            hd_game[key] = entry

        # Fill hda from opponent's hdf for same game
        # Build game_id -> list of team names
        game_teams = {}
        for (gid, tname) in hd_game:
            game_teams.setdefault(gid, []).append(tname)
        for (gid, tname), entry in hd_game.items():
            opps = [t for t in game_teams.get(gid, []) if t != tname]
            if opps:
                opp_entry = hd_game.get((gid, opps[0]), {})
                entry['hda'] = opp_entry.get('hdf', 0)
                for p in ['1P', '2P', '3P', 'OT']:
                    entry[f'hda_{p}'] = opp_entry.get(f'hdf_{p}', 0)

        print(f"  Computed HD stats for {len(hd_game)} team-game pairs.")

        # Also compute xg_ag per period
        xg_ag_game = {}  # (game_id, team_name) -> {xg_ag_1P..OT}
        for (gid, tname), opps in game_teams.items():
            for t in opps:
                opp_xg = hd_game.get((gid, t), {})
                xg_ag_game[(gid, tname)] = {
                    'xg_ag_1P': opp_xg.get('xg_for_1P', 0.0),
                    'xg_ag_2P': opp_xg.get('xg_for_2P', 0.0),
                    'xg_ag_3P': opp_xg.get('xg_for_3P', 0.0),
                    'xg_ag_OT': opp_xg.get('xg_for_OT', 0.0),
                }

    except Exception as e:
        print(f"[WARN] HD/per-period xG computation failed: {e}")
        hd_game = {}
        xg_ag_game = {}

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

            # Patch HD, per-period HD, and per-period xG from shots CSV
            if hd_game:
                hd_cols = ['hdf', 'hda',
                           'hdf_1P', 'hdf_2P', 'hdf_3P', 'hdf_OT',
                           'hda_1P', 'hda_2P', 'hda_3P', 'hda_OT',
                           'xg_for_1P', 'xg_for_2P', 'xg_for_3P', 'xg_for_OT']
                xg_ag_cols = ['xg_ag_1P', 'xg_ag_2P', 'xg_ag_3P', 'xg_ag_OT']
                for col in hd_cols + xg_ag_cols:
                    if col not in df_stats.columns:
                        df_stats[col] = None

                def patch_hd(row):
                    key = (int(row['game_id']), row['team'])
                    entry = hd_game.get(key)
                    if entry:
                        for col in hd_cols:
                            row[col] = entry.get(col, row.get(col))
                    xg_ag_entry = xg_ag_game.get(key)
                    if xg_ag_entry:
                        for col in xg_ag_cols:
                            row[col] = xg_ag_entry.get(col, row.get(col))
                    return row

                df_stats = df_stats.apply(patch_hd, axis=1)
                print(f"  Patched HD + per-period xG/HD into gamestats.")

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
    # Verify the file was actually written fresh — catch silent failures.
    import time as _time
    _tr_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data', 'team_ratings.json')
    _age = (_time.time() - os.path.getmtime(_tr_path)) / 60  # minutes
    if _age > 5:
        raise RuntimeError(f"team_ratings.json was not updated (age={_age:.1f}m). Aborting pipeline.")
    print(f"team_ratings.json verified fresh ({_age:.1f}m old).")

    # 4b. Fetch MoneyPuck player-level data & compute impact scores
    # This runs after team ratings so the pipeline has fresh season context.
    # MoneyPuck updates nightly; we fetch once per full pipeline run (~12-14 UTC).
    print("Fetching MoneyPuck player-level data...")
    try:
        import fetch_moneypuck
        fetch_moneypuck.fetch_moneypuck()
    except Exception as e:
        print(f"[WARN] MoneyPuck fetch failed (predictions will use team ratings only): {e}")

    # 4c. Fetch shifts for any games not yet in the shifts CSV, then enrich the
    #     raw PBP with on-ice player IDs.  Both steps are incremental — they
    #     skip games already processed — so they're safe to run every cycle.
    #     Must run BEFORE calc_pbp_impact which reads the enriched PBP.
    print("Fetching missing shift data...")
    try:
        import fetch_shifts
        fetch_shifts.main()
    except Exception as e:
        print(f"[WARN] fetch_shifts failed: {e}")

    print("Enriching PBP with on-ice player IDs (enrich_pbp)...")
    try:
        import enrich_pbp
        enrich_pbp.main()
    except Exception as e:
        print(f"[WARN] enrich_pbp failed: {e}")

    # 4d. Compute PBP-derived HD metrics (must run AFTER enrich_pbp so that
    #     home_on1-6/away_on1-6 are populated, and BEFORE player_impact).
    print("Computing PBP-derived HD metrics (calc_pbp_impact)...")
    try:
        import calc_pbp_impact
        calc_pbp_impact.run_pbp_impact()
    except Exception as e:
        print(f"[WARN] PBP HD metrics failed (impact scores will use MoneyPuck only): {e}")

    # 4e. RAPM player isolation (must run AFTER shifts data is fresh,
    #     and BEFORE player_impact which merges RAPM as an additional signal).
    print("Computing RAPM player ratings (calc_rapm)...")
    try:
        import calc_rapm
        rapm_results = calc_rapm.run_rapm()
        print(f"  RAPM scores computed: {len(rapm_results)} players")
    except Exception as e:
        print(f"[WARN] RAPM computation failed (impact scores will use MoneyPuck + PBP only): {e}")

    print("Computing player impact scores...")
    try:
        import player_impact
        pi, la = player_impact.calculate_player_impact()
        print(f"  Player impact profiles built: {len(pi)} players")
    except Exception as e:
        print(f"[WARN] Player impact calculation failed: {e}")

    # 4f. Fetch today's player news (overwrites) and accumulate playoff news
    print("Fetching player news...")
    try:
        import fetch_dailyfaceoff
        fetch_dailyfaceoff.fetch_player_news()
        fetch_dailyfaceoff.fetch_playoff_player_news()
    except Exception as e:
        print(f"[WARN] Player news fetch failed: {e}")

    # 4g. Fetch @DFOFantasy tweets and merge into playoff news
    print("Fetching @DFOFantasy tweets...")
    try:
        import fetch_dfo_tweets
        fetch_dfo_tweets.fetch_dfo_tweets()
    except Exception as e:
        print(f"[WARN] DFO tweet fetch failed: {e}")

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

    # 7b. Run Season Simulator (Monte Carlo playoff projections)
    # Fetches remaining schedule live from NHL API so projections are never stale.
    print("Running Season Simulator (playoff projections)...")
    try:
        import season_simulator
        season_simulator.full_simulation_loop()
    except Exception as e:
        print(f"[WARN] Season simulator failed: {e}")

    # 7c. Compute per-game playoff implications (delta sims for today's matchups)
    # Must run AFTER season_simulator so season_projections.json exists as baseline.
    # Retries up to 3x with 60s backoff — NHL API calls can fail transiently.
    print("Computing game playoff implications...")
    _impl_success = False
    for _attempt in range(1, 4):
        try:
            import game_implications
            import importlib
            importlib.reload(game_implications)   # ensure fresh state on retry
            game_implications.compute_game_implications()
            _impl_success = True
            break
        except Exception as e:
            print(f"[WARN] Game implications attempt {_attempt}/3 failed: {e}")
            if _attempt < 3:
                print(f"  Retrying in 60s...")
                time.sleep(60)
    if not _impl_success:
        print("[ERROR] Game implications failed after 3 attempts — implications will be stale.")

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
