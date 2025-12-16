
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
    game_date = pbp.get("gameDate")
    print(f"Game Date: {game_date}")
    
    # Load H-Ref Stats
    nhl_scraper_poc.load_href_stats()
    
    # Analyze Goals
    print("\n--- Goal Analysis ---")
    plays = pbp.get('plays', [])
    for p in plays:
        if p.get('typeCode') == 505:
            print(f"Goal ID {p.get('eventId')} Time {p.get('timeInPeriod')} P {p.get('periodDescriptor', {}).get('number')} Team {p.get('details', {}).get('eventOwnerTeamId')}")

    rows, shots = nhl_scraper_poc.aggregate_game_stats(pbp, game_info, game_date, None)
    
    for row in rows:
        print(f"Team {row['team']}: Goals {row['goals_for']}, PP Opps {row['pp_opportunities']}")
        print(f"  EN Goals For: {row['emptynet_goalsfor']}, EN Attempts For: {row['en_attempts_for']}")
        print(f"  EN Goals Ag: {row['emptynet_goalsagainst']}, EN Attempts Ag: {row['en_attempts_against']}")

    # Simulate Merge Logic
    print("\n--- Testing H-Ref Merge ---")
    for row in rows:
        team_id = pbp['homeTeam']['id'] if row['home_away'] == 'Home' else pbp['awayTeam']['id']
        team_obj = pbp['homeTeam'] if row['home_away'] == 'Home' else pbp['awayTeam']
        
        # Need Abbrev from PBP (usually in team object)
        # PBP structure: {homeTeam: {id: 1, abbrev: COL, ...}}
        abbrev = team_obj.get("abbrev") 
        print(f"Team {abbrev} ({row['team']}) Calculated Opps: {row['pp_opportunities']}")
        
        href_data = nhl_scraper_poc.get_href_stats(game_date, abbrev)
        if href_data:
            print(f"  > Found H-Ref Data: {href_data}")
            row['pp_opportunities'] = href_data['pp_opportunities']
            print(f"  > Updated Opps: {row['pp_opportunities']}")
        else:
            print(f"  > No H-Ref Data found for {game_date} {abbrev}")

if __name__ == "__main__":
    test_aggregate()
