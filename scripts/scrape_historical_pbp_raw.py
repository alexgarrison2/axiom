import os
import sys
import time
import json
import urllib.request
import pandas as pd

# Target seasons to scrape
SEASONS = [20222023, 20232024, 20242025, 20252026]
RATE_LIMIT_SEC = 0.4
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "historical_pbp")

import argparse
import ssl

ssl._create_default_https_context = ssl._create_unverified_context

def get_pbp(game_id):
    """Fetch play-by-play data for a specific game ID."""
    url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        return None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true", help="Run in test mode (scrapes 2 reg season games and 1 playoff game per season)")
    parser.add_argument("--season", type=int, help="Optional: specific season to scrape (e.g. 20222023)")
    args = parser.parse_args()
    
    print("=== Historical NHL API Scraper ===")
    os.makedirs(DATA_DIR, exist_ok=True)
    
    seasons_to_scrape = [args.season] if args.season else SEASONS
    
    for season in seasons_to_scrape:
        print(f"\n--- Starting Season {season} ---")
        
        # Determine regular season games target count.
        reg_season_games = 2 if args.test else 1312
        
        season_plays = []
        
        # 1. Regular Season (Game IDs YYYY020001 -> YYYY021312)
        print("Scraping Regular Season...")
        for game_num in range(1, reg_season_games + 1):
            game_id = f"{str(season)[:4]}02{game_num:04d}"
            
            pbp_json = get_pbp(game_id)
            if not pbp_json or "plays" not in pbp_json:
                continue
                
            plays = pbp_json["plays"]
            
            # We want EVERYTHING. So we just inject game_id and season into each play dict 
            # and let json_normalize handle flattening the details.
            for play in plays:
                play["game_id"] = game_id
                play["season"] = season
                
            season_plays.extend(plays)
            
            if game_num % 100 == 0:
                print(f"  [Reg] Fetched {game_num}/{reg_season_games} games...")
                
            time.sleep(RATE_LIMIT_SEC)
            
        
        # 2. Playoffs (Game IDs YYYY030111 -> YYYY030417)
        print("Scraping Playoffs...")
        # Format: YYYY 03 0 [round:1-4] [matchup:1-8 depending on round] [game:1-7]
        rounds = {
            1: 8, # Round 1 has 8 matchups
            2: 4, # Round 2 has 4 matchups
            3: 2, # Round 3 has 2 matchups
            4: 1  # Round 4 has 1 matchup
        }
        
        for r, num_matchups in rounds.items():
            for m in range(1, num_matchups + 1):
                for g in range(1, 8):
                    game_id = f"{str(season)[:4]}030{r}{m}{g}"
                    pbp_json = get_pbp(game_id)
                    
                    if not pbp_json or "plays" not in pbp_json:
                        # If a series ends in 4 games, game 5/6/7 will return 404/no data, which is fine!
                        time.sleep(RATE_LIMIT_SEC)
                        continue
                        
                    plays = pbp_json["plays"]
                    for play in plays:
                        play["game_id"] = game_id
                        play["season"] = season
                        play["is_playoff"] = 1
                        
                    season_plays.extend(plays)
                    time.sleep(RATE_LIMIT_SEC)
                    
                    if args.test:
                        break # Only do 1 playoff game per round/matchup in test mode
                if args.test:
                    break
            if args.test:
                break
                    
        # Save Season Data to CSV losslessly!
        if season_plays:
            print(f"  Flattening and saving {len(season_plays)} plays for {season}...")
            # json_normalize expands nested dictionaries (like 'details': {'xCoord': 10, 'shotType': 'wrist'}) 
            # into columns like 'details.xCoord', 'details.shotType', preventing column suppression.
            df = pd.json_normalize(season_plays)
            out_path = os.path.join(DATA_DIR, f"raw_pbp_{season}.csv")
            df.to_csv(out_path, index=False)
            print(f"  Saved to {out_path}")
        else:
            print(f"  No data found for {season}.")

if __name__ == "__main__":
    main()
