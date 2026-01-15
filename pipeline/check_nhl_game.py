
import urllib.request
import json
import ssl

GAME_ID = 2025020635
URL = f"https://api-web.nhle.com/v1/gamecenter/{GAME_ID}/boxscore"

def check_game():
    print(f"Fetching {URL}...")
    headers = {
        'User-Agent': 'Mozilla/5.0'
    }
    req = urllib.request.Request(URL, headers=headers)
    context = ssl._create_unverified_context()
    
    with urllib.request.urlopen(req, context=context) as response:
        data = json.loads(response.read().decode('utf-8'))
        
    # Check Team Stats
    home = data.get('homeTeam')
    away = data.get('awayTeam')
    
    print(f"Home Keys: {home.keys()}")
    # print(f"Home: {home['name']['default']} ({home['abbrev']})")
    # print(f"Away: {away['name']['default']} ({away['abbrev']})")
    
    # Can we find team stats? Usually under 'teamGameStats' or aggregated from plays?
    # nhle.com/v1/gamecenter/boxscore payload structure varies. 
    # Usually has 'teamGameStats' list? No, v1 is new.
    # It might only have 'playerByGameStats' and boxscore top level info.
    
    # In v1, there is usually a section for totals? 
    # Let's check 'boxscore' -> 'teamGameStats' isn't there?
    # Let's look for 'summary'?
    
    # It seems v1 boxscore includes 'boxscore' object with team stats?
    # Actually, simpler: check the Scoring summary.
    
    print("\n--- Scoring Summary ---")
    goals = data.get('summary', {}).get('scoring', [])
    
    n_ppg_home = 0
    n_ppg_away = 0
    
    for period in goals:
        for goal in period.get('goals', []):
            strength = goal.get('strength', 'ev')
            team_abbrev = goal.get('teamAbbrev', {}).get('default')
            scorer = goal.get('name', {}).get('default', 'Unknown')
            
            print(f"Goal: {scorer} ({team_abbrev}) - {strength}")
            
            if strength == 'pp':
                if team_abbrev == home['abbrev']:
                    n_ppg_home += 1
                else:
                    n_ppg_away += 1
                    
    print(f"\nHome PPG: {n_ppg_home}")
    print(f"Away PPG: {n_ppg_away}")

if __name__ == "__main__":
    check_game()
