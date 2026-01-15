
import pandas as pd
import urllib.request
import json
import ssl
import time
import os

# Paths
GAMESTATS_PATH = "public/data/gamestats.csv"
BACKUP_PATH = "public/data/gamestats_backup_before_nhl_fix.csv"

def fetch_nhl_boxscore_data(game_id):
    url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore"
    headers = {'User-Agent': 'Mozilla/5.0'}
    context = ssl._create_unverified_context()
    
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, context=context) as response:
            data = json.loads(response.read().decode('utf-8'))
            return data
    except Exception as e:
        print(f"Error fetching {game_id}: {e}")
        return None

def get_ppg_counts(boxscore_data):
    """
    Returns (home_ppg, away_ppg) from the valid NHL Scoring Summary.
    """
    if not boxscore_data:
        return 0, 0
        
    home_ppg = 0
    away_ppg = 0
    
    home_abbr = boxscore_data.get('homeTeam', {}).get('abbrev')
    
    # Iterate scoring summary
    summary = boxscore_data.get('summary', {})
    scoring = summary.get('scoring', [])
    
    for period in scoring:
        for goal in period.get('goals', []):
            strength = goal.get('strength', 'ev')
            team_abbr = goal.get('teamAbbrev', {}).get('default')
            
            if strength == 'pp':
                if team_abbr == home_abbr:
                    home_ppg += 1
                else:
                    away_ppg += 1
                    
    return home_ppg, away_ppg

def backfill_nhl_ppg():
    print("--- Starting Hybrid Backfill (NHL Official Goals) ---")
    
    if not os.path.exists(GAMESTATS_PATH):
        print(f"File not found: {GAMESTATS_PATH}")
        return

    # Backup
    print(f"Backing up to {BACKUP_PATH}...")
    df = pd.read_csv(GAMESTATS_PATH)
    df.to_csv(BACKUP_PATH, index=False)
    
    # Convert game_id to str
    df['game_id'] = df['game_id'].astype(str)
    
    # Track processed games to avoid double fetching (dataset has 2 rows per game)
    processed_games = {} # game_id -> (home_ppg, away_ppg)
    
    updated_count = 0
    
    # We need to process row by row or group by game_id
    # Grouping is better to fetch once
    unique_games = df['game_id'].unique()
    total_games = len(unique_games)
    
    print(f"Found {total_games} unique games to verify.")
    
    for i, game_id in enumerate(unique_games):
        if not game_id or game_id == 'nan':
            continue
            
        print(f"[{i+1}/{total_games}] Processing Game {game_id}...", end='\r')
        
        # Check if already processed (cache)
        if game_id in processed_games:
            home_ppg, away_ppg = processed_games[game_id]
        else:
            # Fetch
            data = fetch_nhl_boxscore_data(game_id)
            if not data:
                print(f"\nSkipping {game_id} due to fetch error.")
                continue
                
            home_ppg, away_ppg = get_ppg_counts(data)
            processed_games[game_id] = (home_ppg, away_ppg)
            # Sleep tiny bit
            # time.sleep(0.05) 

        # Update rows for this game
        # Identify Home and Away rows in DF
        # The 'home_or_away' column tells us who is who.
        
        # Update Home Team Row
        # condition: game_id match AND home_or_away == 'Home'
        mask_home = (df['game_id'] == game_id) & (df['home_away'] == 'Home')
        
        # Update Away Team Row
        mask_away = (df['game_id'] == game_id) & (df['home_away'] == 'Away')
        
        # Set PP Goals (For)
        df.loc[mask_home, 'pp_goals'] = home_ppg
        df.loc[mask_away, 'pp_goals'] = away_ppg
        
        # Set PP Goals Against (Opponent's PP Goals)
        df.loc[mask_home, 'pp_goals_against'] = away_ppg
        df.loc[mask_away, 'pp_goals_against'] = home_ppg
        
    print(f"\nCompleted verification of {len(processed_games)} games.")
    
    # Save
    print(f"Saving to {GAMESTATS_PATH}...")
    df.to_csv(GAMESTATS_PATH, index=False)
    print("Done.")

if __name__ == "__main__":
    backfill_nhl_ppg()
