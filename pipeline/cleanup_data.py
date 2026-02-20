"""
One-time cleanup script:
1. Remove Olympic/IIHF game rows from gamestats and shots CSVs
2. Re-score all shots with the properly calibrated xG model
3. Reaggregate xG into gamestats
4. Sync to public/data/
"""
import pandas as pd
import pickle
import os
import sys

# Ensure we're running from the pipeline directory
os.chdir(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from xg_model import preprocess_data

GAMESTATS_FILE = "nhl_season_2025_2026_gamestats.csv"
SHOTS_FILE = "nhl_season_2025_2026_shots.csv"
MODEL_FILE = "xg_model_xgb.pkl"
TEAMS_FILE = "nhl_teams.csv"

PUBLIC_GAMESTATS = "../public/data/gamestats.csv"
DATA_GAMESTATS = "../data/gamestats.csv"


def cleanup():
    print("=" * 60)
    print("DATA CLEANUP: Remove Olympics + Fix xG")
    print("=" * 60)

    # --- STEP 1: Remove Olympic/IIHF rows ---
    print("\n--- Step 1: Removing Olympic/IIHF games ---")

    df_stats = pd.read_csv(GAMESTATS_FILE)
    df_stats['game_id'] = df_stats['game_id'].astype(str)
    original_stats_len = len(df_stats)

    # Only keep regular season (02) and playoff (03) games
    mask_valid = df_stats['game_id'].str[4:6].isin(["02", "03"])
    removed_teams = set(df_stats[~mask_valid]['team'].unique())
    df_stats = df_stats[mask_valid].copy()
    removed_stats = original_stats_len - len(df_stats)

    print(f"  Gamestats: {original_stats_len} -> {len(df_stats)} (removed {removed_stats} rows)")
    print(f"  Removed teams: {sorted(removed_teams)}")

    # Shots
    df_shots = pd.read_csv(SHOTS_FILE)
    df_shots['game_id'] = df_shots['game_id'].astype(str)
    original_shots_len = len(df_shots)

    mask_valid_shots = df_shots['game_id'].str[4:6].isin(["02", "03"])
    df_shots = df_shots[mask_valid_shots].copy()
    removed_shots = original_shots_len - len(df_shots)

    print(f"  Shots: {original_shots_len} -> {len(df_shots)} (removed {removed_shots} rows)")

    # --- STEP 2: Re-score all shots with xG model ---
    print("\n--- Step 2: Re-scoring all shots with xG model ---")

    with open(MODEL_FILE, 'rb') as f:
        model = pickle.load(f)

    X, _ = preprocess_data(df_shots)
    probs = model.predict_proba(X)[:, 1]

    print(f"  New xG mean per shot: {probs.mean():.4f} (should be ~0.07)")
    print(f"  New xG min: {probs.min():.4f}, max: {probs.max():.4f}")

    df_shots['xG'] = probs

    # Save updated shots
    df_shots.to_csv(SHOTS_FILE, index=False)
    print(f"  Saved updated shots to {SHOTS_FILE}")

    # --- STEP 3: Reaggregate xG into gamestats ---
    print("\n--- Step 3: Reaggregating xG into gamestats ---")

    # Load team ID -> name mapping
    teams_df = pd.read_csv(TEAMS_FILE)
    id_to_name = dict(zip(teams_df['NHL Team ID'], teams_df['Common Name']))

    # Total xG by game+team
    agg_total = df_shots.groupby(['game_id', 'team_id'])['xG'].sum().reset_index()
    agg_total.columns = ['game_id', 'team_id', 'xG_sum']

    # 5v5 xG
    agg_5v5 = df_shots[df_shots['strength_state'] == '5v5'].groupby(['game_id', 'team_id'])['xG'].sum().reset_index()
    agg_5v5.columns = ['game_id', 'team_id', 'xG_5v5_sum']

    agg = pd.merge(agg_total, agg_5v5, on=['game_id', 'team_id'], how='left').fillna(0)
    agg['team'] = agg['team_id'].map(id_to_name)

    # Build lookups
    xg_lookup = dict(zip(zip(agg['game_id'], agg['team']), agg['xG_sum']))
    xg_5v5_lookup = dict(zip(zip(agg['game_id'], agg['team']), agg['xG_5v5_sum']))

    # Update gamestats
    updates = 0
    for idx, row in df_stats.iterrows():
        gid = row['game_id']
        team = row['team']
        opp = row['opponent']

        # xG_for
        key = (gid, team)
        if key in xg_lookup:
            df_stats.at[idx, 'xG_for'] = round(xg_lookup[key], 2)
            updates += 1

        # xG_against (opponent's xG_for)
        opp_key = (gid, opp)
        if opp_key in xg_lookup:
            df_stats.at[idx, 'xG_against'] = round(xg_lookup[opp_key], 2)

        # 5v5 xG
        if key in xg_5v5_lookup:
            df_stats.at[idx, 'xG_for_5v5'] = round(xg_5v5_lookup[key], 2)
        if opp_key in xg_5v5_lookup:
            df_stats.at[idx, 'xG_against_5v5'] = round(xg_5v5_lookup[opp_key], 2)

    print(f"  Updated {updates} rows with new xG values")

    # Save
    df_stats.to_csv(GAMESTATS_FILE, index=False)
    print(f"  Saved {GAMESTATS_FILE}")

    # --- STEP 4: Sync to public/data ---
    print("\n--- Step 4: Syncing to app data folders ---")

    if os.path.exists(os.path.dirname(PUBLIC_GAMESTATS)):
        df_stats.to_csv(PUBLIC_GAMESTATS, index=False)
        print(f"  -> {PUBLIC_GAMESTATS}")

    if os.path.exists(os.path.dirname(DATA_GAMESTATS)):
        df_stats.to_csv(DATA_GAMESTATS, index=False)
        print(f"  -> {DATA_GAMESTATS}")

    # --- STEP 5: Validation ---
    print("\n--- Validation ---")
    unique_teams = df_stats['team'].nunique()
    mean_xg = df_stats['xG_for'].astype(float).mean()

    non_nhl = [t for t in df_stats['team'].unique() if t in [
        'Canada', 'Czechia', 'Denmark', 'Finland', 'France', 'Germany',
        'Italy', 'Latvia', 'Slovakia', 'Sweden', 'Switzerland', 'USA'
    ]]

    print(f"  Unique teams: {unique_teams} (should be 32)")
    print(f"  Mean xG_for/game: {mean_xg:.2f} (should be 2.0-4.0)")
    print(f"  Non-NHL teams remaining: {non_nhl if non_nhl else 'NONE ✅'}")

    if non_nhl:
        print("  ❌ FAIL: Non-NHL teams still present!")
    elif mean_xg > 5:
        print("  ❌ FAIL: xG still too high!")
    else:
        print("  ✅ ALL CHECKS PASSED")

    print("\n" + "=" * 60)
    print("CLEANUP COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    cleanup()
