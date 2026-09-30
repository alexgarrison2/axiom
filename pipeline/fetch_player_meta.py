from season import season_file
import pandas as pd
import urllib.request
import json
import time

def fetch_player_handedness():
    print("Loading unique players from shots data...")
    player_ids = set()
    
    files = [
        "nhl_historical_shots.csv",
        season_file("shots")
    ]
    
    for f in files:
        try:
            df = pd.read_csv(f)
            player_ids.update(df['player_id'].unique())
        except FileNotFoundError:
            print(f"Warning: {f} not found.")

    print(f"Found {len(player_ids)} unique players.")
    
    try:
        with open('player_hand.json', 'r') as f:
            player_hand = json.load(f)
            print(f"Loaded {len(player_hand)} players from cache.")
    except FileNotFoundError:
        player_hand = {}
        
    missing_ids = [pid for pid in player_ids if str(pid) not in player_hand]
    print(f"Fetching metadata for {len(missing_ids)} missing players...")
    
    from http_utils import get_json, HttpError
    
    count = 0
    for pid in missing_ids:
        # API endpoint: https://api-web.nhle.com/v1/player/{id}/landing
        url = f"https://api-web.nhle.com/v1/player/{pid}/landing"
        try:
            data = get_json(url, ua="plain")
            player_hand[str(pid)] = data.get('shootsCat', 'U')
            count += 1
            if count % 50 == 0:
                print(f"Fetching... {count}/{len(missing_ids)}")
        except (HttpError, AttributeError) as e:
            # print(f"Error fetching {pid}: {e}")
            player_hand[str(pid)] = 'U'
            
    with open('player_hand.json', 'w') as f:
        json.dump(player_hand, f)
    print("Saved player_hand.json")

if __name__ == "__main__":
    fetch_player_handedness()
