
import urllib.request
import json
import ssl

ssl._create_default_https_context = ssl._create_unverified_context

GAME_ID = 2025020734
URL = f"https://api-web.nhle.com/v1/gamecenter/{GAME_ID}/play-by-play"

req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req) as url:
        data = json.loads(url.read().decode())
        
    print(f"Game: {data.get('id')}")
    print(f"Home: {data.get('homeTeam', {}).get('abbrev')}  Away: {data.get('awayTeam', {}).get('abbrev')}")
    
    plays = data.get('plays', [])
    print(f"Total Plays: {len(plays)}")
    
    print("\n--- GOALS ---")
    for play in plays:
        if play.get('typeCode') == 505:
            details = play.get('details', {})
            situation = play.get('situationCode', '????')
            strength = details.get('strength', 'N/A') # NOTE: API usually doesn't have explicit 'strength' text in PBP, but maybe?
            print(f"Time: {play.get('periodDescriptor', {}).get('number')}-{play.get('timeInPeriod')} | Type: {play.get('typeDescKey')} | Sit: {situation} | ScoringTeam: {details.get('eventOwnerTeamId')}")
            # JSON dump details to find strength clues
            # print(json.dumps(details, indent=2))

    print("\n--- PENALTIES ---")
    for play in plays:
        if play.get('typeCode') == 509:
            details = play.get('details', {})
            print(f"Time: {play.get('periodDescriptor', {}).get('number')}-{play.get('timeInPeriod')} | Desc: {details.get('descKey')} | Duration: {details.get('duration')} | Team: {details.get('eventOwnerTeamId')}")

except Exception as e:
    print(f"Error: {e}")
