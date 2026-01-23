
from nhlpy import NHLClient
import json
import sys

def inspect_edge():
    client = NHLClient()
    
    print("--- Fetching McDavid (8478402) Skating Speed ---")
    try:
        # Note: Using 20232024 as 20252026 might not have data yet in this simulated environment or if the season hasn't started in the library's context
        # But user context says "2026-01-22", so 20252026 SHOULD be valid. Let's try current season implicit first.
        speed_data = client.edge.skater_skating_speed_detail(player_id='8478402') 
        print(json.dumps(speed_data, indent=2))
    except Exception as e:
        print(f"Error fetching speed: {e}")

    print("\n\n--- Fetching Oilers (22) Zone Time ---")
    try:
        zone_data = client.edge.team_zone_time_details(team_id='22')
        print(json.dumps(zone_data, indent=2))
    except Exception as e:
        print(f"Error fetching zone data: {e}")

if __name__ == "__main__":
    inspect_edge()
