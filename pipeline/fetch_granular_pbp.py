
import os
import json
import time
import argparse
from nhlpy import NHLClient
from concurrent.futures import ThreadPoolExecutor, as_completed

# Initialize NHL Client
client = NHLClient()

DATA_DIR = "data/raw_pbp"
os.makedirs(DATA_DIR, exist_ok=True)

def fetch_game(game_id):
    """
    Fetches PBP data for a single game and saves it.
    Returns (game_id, status)
    """
    file_path = f"{DATA_DIR}/{game_id}.json"
    
    # Skip if already exists (Simple caching)
    if os.path.exists(file_path):
        return game_id, "SKIPPED (Exists)"

    try:
        # Fetch PBP
        pbp = client.game_center.play_by_play(game_id=game_id)
        
        # Validation: Ensure it has plays
        if 'plays' not in pbp:
            return game_id, "FAILED (No plays data)"

        with open(file_path, 'w') as f:
            json.dump(pbp, f)
        
        return game_id, "SUCCESS"
    except Exception as e:
        return game_id, f"ERROR: {e}"

def get_season_games(season_id):
    """
    Fetches list of all game IDs for a regular season.
    Using schedule endpoint.
    """
    print(f"Fetching schedule for season {season_id}...")
    # There isn't a direct "get whole season schedule" in a single flat list easily exposed 
    # generally we iterate or use a known endpoint.
    # nhlpy doesn't seem to have 'get_season_schedule(season_id)'.
    # We can use the client.schedule.get_season_schedule which might return a large structure.
    
    # Let's try to fetch by team to get coverage, or just iterate dates?
    # Actually, client.schedule.get_season_schedule seems to exist in some versions.
    # Let's try iterating team schedules for a clean list of unique games.
    
    game_ids = set()
    
    # Iterate all teams to ensure we get every game
    # Just need one team from each game, but fetching for all 32 ensures coverage
    # This might be slow.
    # Alternative: Use `client.season.get_season_information`? No.
    
    # Let's try a simpler approach: Just iterate GAME IDs for the season.
    # Regular season games are 2023020001 to 2023021312 (approx).
    # Format: [Season][02=Reg][GameNum 4 digits]
    # We can just generate them.
    # Max games is usually ~1312 per season (32 teams * 82 games / 2).
    
    year_part = season_id[:4]
    print(f"Generating Game IDs for {year_part} Regular Season...")
    
    # Approximate max games. 1312 is standard for 32 teams. 
    # 2023-2024 season.
    for i in range(1, 1313):
        game_num = f"{i:04d}"
        game_id = f"{year_part}02{game_num}"
        game_ids.add(game_id)
        
    return sorted(list(game_ids))

def main():
    parser = argparse.ArgumentParser(description="Fetch Granular PBP Data")
    parser.add_argument("--season", type=str, default="20232024", help="Season ID (e.g. 20232024)")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of games to fetch (0 for all)")
    parser.add_argument("--workers", type=int, default=4, help="Number of threads")
    
    args = parser.parse_args()
    
    games = get_season_games(args.season)
    if args.limit > 0:
        games = games[:args.limit]
        
    print(f"Queueing {len(games)} games for download with {args.workers} workers...")
    
    successful = 0
    skipped = 0
    errors = 0
    
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        future_to_game = {executor.submit(fetch_game, gid): gid for gid in games}
        
        for i, future in enumerate(as_completed(future_to_game)):
            game_id, status = future.result()
            print(f"[{i+1}/{len(games)}] Game {game_id}: {status}")
            
            if "SUCCESS" in status:
                successful += 1
            elif "SKIPPED" in status:
                skipped += 1
            else:
                errors += 1
                
    print(f"\nDone. Downloaded: {successful}, Skipped: {skipped}, Errors: {errors}")

if __name__ == "__main__":
    main()
