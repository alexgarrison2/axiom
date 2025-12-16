
import nhl_scraper_poc
import json
import urllib.request
import ssl

ssl._create_default_https_context = ssl._create_unverified_context

GAME_ID = 2025020462

def get_pbp(game_id):
    url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play"
    print(f"Fetching {url}")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error: {e}")
        return None

def test_aggregate():
    pbp = get_pbp(GAME_ID)
    home_id = pbp['homeTeam']['id']
    away_id = pbp['awayTeam']['id']
    
    # Mock game info
    game_info = {
        "id": GAME_ID,
        "homeTeam": {"id": home_id, "commonName": {"default": "Home"}},
        "awayTeam": {"id": away_id, "commonName": {"default": "Away"}}
    }
    
    # Run agg
    print("\nRunning aggregate_game_stats...")
    
    # Analyze Goals
    print("\n--- Goal Analysis ---")
    plays = pbp.get('plays', [])
    for p in plays:
        if p.get('typeCode') == 505:
            print(f"Goal ID {p.get('eventId')} Time {p.get('timeInPeriod')} P {p.get('periodDescriptor', {}).get('number')} Team {p.get('details', {}).get('eventOwnerTeamId')}")

    rows, shots = nhl_scraper_poc.aggregate_game_stats(pbp, game_info, "2025-11-08", None)
    
    for row in rows:
        print(f"Team {row['team']}: Goals {row['goals_for']}, PP Opps {row['pp_opportunities']}")

if __name__ == "__main__":
    test_aggregate()
