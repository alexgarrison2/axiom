
import requests
import json
import sys

GAME_ID = "2025020001"
URL = f"https://api-web.nhle.com/v1/gamecenter/{GAME_ID}/play-by-play"

def inspect_game():
    print(f"Fetching {URL}...")
    try:
        resp = requests.get(URL)
        resp.raise_for_status()
        data = resp.json()
        
        plays = data.get('plays', [])
        print(f"Total Plays: {len(plays)}")
        
        coord_plays = 0
        events_with_coords = set()
        
        sample_play = None
        
        for play in plays:
            details = play.get('details', {})
            if 'xCoord' in details and 'yCoord' in details:
                coord_plays += 1
                events_with_coords.add(play.get('typeDescKey', 'UNKNOWN'))
                if not sample_play:
                    sample_play = play
        
        print(f"Plays with Coordinates: {coord_plays} / {len(plays)}")
        print(f"Event Types with Coordinates: {events_with_coords}")
        
        if sample_play:
            print("\nSample Play with Coordinates:")
            print(json.dumps(sample_play, indent=2))
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    inspect_game()
