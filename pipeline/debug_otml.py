
import urllib.request
import json
import ssl
from datetime import datetime

ssl._create_default_https_context = ssl._create_unverified_context

DATE = "2025-12-27"
TEAM_ABBR = "DAL"

def get_schedule(date_str):
    url = f"https://api-web.nhle.com/v1/schedule/{date_str}"
    req = urllib.request.Request(url, headers={'User-Agent': "Mozilla/5.0"})
    with urllib.request.urlopen(req) as response:
        return json.load(response)

def get_pbp(game_id):
    url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play"
    req = urllib.request.Request(url, headers={'User-Agent': "Mozilla/5.0"})
    with urllib.request.urlopen(req) as response:
        return json.load(response)

def main():
    print(f"Checking OTML for {TEAM_ABBR} on {DATE}...")
    schedule = get_schedule(DATE)
    
    game_id = None
    home_id = None
    away_id = None
    home_abbr = ""
    away_abbr = ""
    
    for day in schedule.get('gameWeek', []):
        if day['date'] == DATE:
            for game in day['games']:
                h = game['homeTeam']['abbrev']
                a = game['awayTeam']['abbrev']
                if h == TEAM_ABBR or a == TEAM_ABBR:
                    game_id = game['id']
                    home_id = game['homeTeam']['id']
                    away_id = game['awayTeam']['id']
                    home_abbr = h
                    away_abbr = a
                    break
    
    if not game_id:
        print("Game not found.")
        return

    print(f"Found Game ID: {game_id} ({away_abbr} @ {home_abbr})")
    
    pbp = get_pbp(game_id)
    if not pbp:
        print("No PBP data.")
        return
        
    plays = pbp.get('plays', [])
    
    current_score = (0, 0) # Home, Away
    ot_forcing_team = None
    
    print("\n--- SCORING LOG ---")
    for play in plays:
        if play['typeCode'] == 505: # Goal
            details = play['details']
            owner_id = details['eventOwnerTeamId']
            period = play['periodDescriptor']['number']
            
            # Update Score
            if owner_id == home_id:
                current_score = (current_score[0] + 1, current_score[1])
                team_name = home_abbr
            else:
                current_score = (current_score[0], current_score[1] + 1)
                team_name = away_abbr
                
            print(f"GOAL! {team_name} scores. Score: {home_abbr} {current_score[0]} - {away_abbr} {current_score[1]} (Period {period})")
            
            if current_score[0] == current_score[1] and period <= 3:
                ot_forcing_team = owner_id
                print(f"  -> GAME TIED! Potential OT Force by {team_name} ({owner_id})")
            elif current_score[0] != current_score[1]:
                ot_forcing_team = None
                print(f"  -> Lead taken. Reset OT Force.")

    print("\n--- RESULT ---")
    final_pd = plays[-1]['periodDescriptor']['number']
    print(f"Final Period: {final_pd}")
    
    if ot_forcing_team == home_id:
        print(f"OT Forcing Team: {home_abbr}")
    elif ot_forcing_team == away_id:
        print(f"OT Forcing Team: {away_abbr}")
    else:
        print("OT Forcing Team: None")
        
    # Check if DAL got OTML
    # Did DAL lose?
    # Logic in standard scraper: depends on result code.
    # But fundamentally: OTML = (Lost in OT/SO) AND (Forced OT).
    
    team_id_map = {home_abbr: home_id, away_abbr: away_id}
    dal_id = team_id_map[TEAM_ABBR]
    
    is_ot_forcing = (ot_forcing_team == dal_id)
    print(f"Is {TEAM_ABBR} the OT Forcing Team? {is_ot_forcing}")
    print(f"Expected OTML Value for {TEAM_ABBR}: {'Yes' if is_ot_forcing else '-'}")

if __name__ == "__main__":
    main()
