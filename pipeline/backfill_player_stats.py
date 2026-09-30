from season import season_file
import urllib.request
import json
import csv
import os
from datetime import datetime
import time
import pandas as pd

# Constants
BASE_URL = "https://api-web.nhle.com/v1"
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # axiom root
OUTPUT_FILENAME = os.path.join(_ROOT, "public", "data", season_file("player_stats"))
GAME_STATS_FILE = os.path.join(_ROOT, "pipeline", season_file("gamestats"))


def get_url(url):
    """Helper to fetch URL with proper headers and error handling."""
    from http_utils import try_get_json
    return try_get_json(url, ua="plain")


def get_boxscore(game_id):
    """Fetch boxscore for a specific game ID."""
    return get_url(f"{BASE_URL}/gamecenter/{game_id}/boxscore")

def parse_boxscore(game_id, boxscore):
    """Parse boxscore JSON into flat list of player stats."""
    rows = []
    if not boxscore or "playerByGameStats" not in boxscore:
        return rows

    game_date = boxscore.get("gameDate")
    
    # Process both teams (Home and Away)
    for team_type in ["homeTeam", "awayTeam"]:
        team_data = boxscore.get(team_type, {})
        team_abbr = team_data.get("abbrev")
        team_id = team_data.get("id")
        
        # Process Skaters (Forwards + Defense)
        for category in ["forwards", "defense"]:
            for player in boxscore.get("playerByGameStats", {}).get(team_type, {}).get(category, []):
                # Basic info
                p_id = player.get("playerId")
                name = player.get("name", {}).get("default")
                number = player.get("sweaterNumber")
                position = player.get("position") 
                
                # Stats
                goals = player.get("goals", 0)
                assists = player.get("assists", 0)
                points = player.get("points", 0)
                plus_minus = player.get("plusMinus", 0)
                toi = player.get("toi", "00:00")
                shots = player.get("sog", 0)
                hits = player.get("hits", 0)
                blocked_shots = player.get("blockedShots", 0)
                pim = player.get("pim", 0)
                pp_goals = player.get("powerPlayGoals", 0)
                sh_goals = player.get("shorthandedGoals", 0)
                
                row = {
                    "game_id": game_id,
                    "date": game_date,
                    "team": team_abbr,
                    "team_id": team_id,
                    "player_id": p_id,
                    "name": name,
                    "number": number,
                    "position": position,
                    "goals": goals,
                    "assists": assists,
                    "points": points,
                    "plus_minus": plus_minus,
                    "toi": toi,
                    "shots": shots,
                    "hits": hits,
                    "blocked_shots": blocked_shots,
                    "pim": pim,
                    "pp_goals": pp_goals,
                    "sh_goals": sh_goals,
                    "is_goalie": 0
                }
                rows.append(row)

        # Process Goalies
        for goalie in boxscore.get("playerByGameStats", {}).get(team_type, {}).get("goalies", []):
             p_id = goalie.get("playerId")
             name = goalie.get("name", {}).get("default")
             number = goalie.get("sweaterNumber")
             position = "G"
             
             # Goalie Stats
             toi = goalie.get("toi", "00:00")
             shots_against = goalie.get("shotsAgainst", 0)
             saves = goalie.get("saves", 0)
             goals_against = goalie.get("goalsAgainst", 0)
             save_pct = goalie.get("savePctg", 0.0)
             decision = goalie.get("decision", "ND") # W, L, OT, or undefined
             
             row = {
                "game_id": game_id,
                "date": game_date,
                "team": team_abbr,
                "team_id": team_id,
                "player_id": p_id,
                "name": name,
                "number": number,
                "position": position,
                "goals": 0, # Usually 0 for goalies
                "assists": goalie.get("assists", 0), # Goalies can get assists
                "points": goalie.get("points", 0),
                "plus_minus": 0,
                "toi": toi,
                "shots": 0, 
                "hits": 0,
                "blocked_shots": 0,
                "pim": goalie.get("pim", 0),
                "pp_goals": 0,
                "sh_goals": 0,
                "is_goalie": 1,
                "shots_against": shots_against,
                "saves": saves,
                "goals_against": goals_against,
                "save_pct": save_pct,
                "decision": decision
             }
             rows.append(row)
             
    return rows

def main():
    print("--- Backfilling Player Stats ---")
    
    # 1. Get List of Game IDs from processed gamestats
    if not os.path.exists(GAME_STATS_FILE):
        print(f"Error: {GAME_STATS_FILE} not found. Scrape games first.")
        return

    df_games = pd.read_csv(GAME_STATS_FILE)
    if 'game_id' not in df_games.columns:
        print("Error: game_id column missing in gamestats.csv")
        return
        
    game_ids = sorted(df_games['game_id'].unique())
    print(f"Found {len(game_ids)} games to process.")
    
    all_rows = []
    processed_files = set()
    existing_columns = None  # Track column order of existing CSV to prevent schema drift

    # Check if some already exist (resume capability)
    if os.path.exists(OUTPUT_FILENAME):
        try:
            df_existing = pd.read_csv(OUTPUT_FILENAME, nrows=0)  # header only
            existing_columns = list(df_existing.columns)
            df_existing_full = pd.read_csv(OUTPUT_FILENAME)
            processed_files = set(df_existing_full['game_id'].unique())
            print(f"  Already have stats for {len(processed_files)} games. Skipping them.")
            print(f"  Existing schema: {len(existing_columns)} columns.")
        except Exception as e:
            print(f"  Warning: could not read existing file: {e}")

    def save_batch(rows, is_first_write):
        """Save a batch of rows, ensuring column alignment with existing CSV."""
        if not rows:
            return
        df_new = pd.DataFrame(rows)
        if is_first_write:
            # Fresh file — write with header
            df_new.to_csv(OUTPUT_FILENAME, mode='w', header=True, index=False)
        else:
            # Append — reindex to match the existing column order exactly
            if existing_columns:
                # Add any missing columns (e.g. saves/shots_against for skater rows) as NaN
                for col in existing_columns:
                    if col not in df_new.columns:
                        df_new[col] = None
                # Select only columns present in existing file, in the right order
                df_new = df_new[existing_columns]
            df_new.to_csv(OUTPUT_FILENAME, mode='a', header=False, index=False)

    count = 0
    for game_id in game_ids:
        if game_id in processed_files:
            continue

        print(f"Fetching Boxscore for {game_id} ({count+1}/{len(game_ids) - len(processed_files)})...", end="", flush=True)
        boxscore = get_boxscore(game_id)

        if boxscore:
            rows = parse_boxscore(game_id, boxscore)
            all_rows.extend(rows)
            print(f" Found {len(rows)} player records.")
        else:
            print(" Failed.")

        count += 1
        # Rate limit
        time.sleep(0.3)

        # Batch Save every 50 games
        if count % 50 == 0:
            is_first_write = not os.path.exists(OUTPUT_FILENAME)
            save_batch(all_rows, is_first_write)
            print(f"  --> Saved batch of {len(all_rows)} rows.")
            all_rows = []  # Clear buffer

    # Final Save
    if all_rows:
        is_first_write = not os.path.exists(OUTPUT_FILENAME)
        save_batch(all_rows, is_first_write)
        print(f"  --> Saved final batch of {len(all_rows)} rows.")

    print("Backfill Complete.")

if __name__ == "__main__":
    main()
