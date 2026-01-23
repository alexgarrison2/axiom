
from nhlpy import NHLClient
import json
import sys

# DEEP INSPECTION of Play-by-Play
# We want to see if "tracking" data (Coordinates, Speed, etc) exists in the raw event dictionary.

def inspect_full_pbp():
    client = NHLClient()
    game_id = "2023021214" # EDM vs COL (Recent enough for Edge)
    
    print(f"--- Fetching Full PBP for Game {game_id} ---")
    try:
        pbp = client.game_center.play_by_play(game_id=game_id)
        
        # 1. Inspect a Goal Event
        goals = [p for p in pbp.get('plays', []) if p.get('typeDescKey') == 'GOAL']
        if goals:
            print("\n[GOAL EVENT DUMP]")
            print(json.dumps(goals[0], indent=2))
        else:
            print("No goals found.")

        # 2. Inspect a Shot Event
        shots = [p for p in pbp.get('plays', []) if p.get('typeDescKey') == 'SHOT']
        if shots:
            print("\n[SHOT EVENT DUMP]")
            print(json.dumps(shots[0], indent=2))
            
        # 3. Check for any keys in 'details' that look like tracking
        print("\n[SCANNING ALL EVENTS FOR NEW KEYS]")
        found_keys = set()
        for p in pbp.get('plays', []):
            details = p.get('details', {})
            for k in details.keys():
                found_keys.add(k)
        
        print("All 'details' keys found:", sorted(list(found_keys)))

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    inspect_full_pbp()
