
from nhlpy import NHLClient
import json

client = NHLClient()

# Trying to find "Game-Level" Edge stats.
# The previous inspect_speed.py showed data linked to "gameCenterLink": "/gamecenter/col-vs-edm/2024/04/05/2023021214"
# This implies we can iterate games.

def inspect_game_edge():
    game_id = "2023021214"  # EDM vs COL, April 5 2024
    print(f"--- Fetching Edge Data for Game {game_id} ---")
    
    # 1. Check if 'game_center' has detailed Edge reports
    # The README mentioned client.game_center.shift_chart_data but not explicit Edge stats per game
    # However, the 'skater_skating_speed_detail' returned a list of games.
    
    # Let's try to see if there is a 'game' specific endpoint in EDGE module or GAME_CENTER module
    # We inspect the client structure
    
    try:
        # Hypothesis: Maybe we can query edge stats *filtered by game_id*?
        # The API method skater_skating_speed_detail takes (player_id, season).
        # Does it take game_id?
        print("Checking method signatures...")
        # Inspecting source if possible, or just trying keys
        
        # Try fetching game center "Advanced Game Data" mentioned in README
        # client.game_center.shift_chart_data(game_id="...")
        shift_data = client.game_center.shift_chart_data(game_id=game_id)
        print("Shift Data Keys:", shift_data.keys() if isinstance(shift_data, dict) else "Not a dict")
        
        # Try fetching 'match_up' to see if it has edge stats
        matchup = client.game_center.match_up(game_id=game_id)
        print("Matchup Keys:", matchup.keys() if isinstance(matchup, dict) else "Not a dict")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    inspect_game_edge()
