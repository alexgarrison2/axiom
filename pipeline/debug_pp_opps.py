
import json
import urllib.request
import ssl

ssl._create_default_https_context = ssl._create_unverified_context

GAME_ID = 2025020240 # Oilers vs Avs

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

def parse_situation(code):
    # SituationCode: 4 digits (AwayGoalie, AwaySkaters, HomeSkaters, HomeGoalie)
    # Actually, API format is often: [AwayG][AwayS][HomeS][HomeG] e.g. "1551"
    # But sometimes the labels are swapped?
    # Documentation says: 1st digit = Away Goalie (1/0), 2nd = Away Skaters, 3rd = Home Skaters, 4th = Home Goalie.
    if not code: return 0, 5, 5, 0
    c = str(code)
    if len(c) != 4: return 0, 5, 5, 0
    ag = int(c[0])
    as_num = int(c[1])
    hs_num = int(c[2])
    hg = int(c[3])
    return ag, as_num, hs_num, hg

def debug_game():
    data = get_pbp(GAME_ID)
    if not data: return
    
    home_id = data['homeTeam']['id']
    away_id = data['awayTeam']['id']
    print(f"Home: {home_id}, Away: {away_id}")
    
    # Init stats
    home_opps = 0
    away_opps = 0
    
    # State
    home_pp_active = False
    away_pp_active = False
    active_penalties = []
    
    plays = data.get('plays', [])
    
    print("\n--- Starting Event Loop ---\n")
    
    for play in plays:
        event_id = play.get('eventId')
        period = play.get('periodDescriptor', {}).get('number', 1)
        time_in_period = play.get('timeInPeriod', '00:00')
        type_code = play.get('typeCode')
        desc = play.get('typeDescKey', '')
        
        # --- Situation Code Logic (State Based) ---
        if "situationCode" in play:
            code = play["situationCode"]
            ag, as_num, hs_num, hg = parse_situation(code)
            
            # Logic from scraper
            is_home_pp = (hs_num > as_num) and (as_num < 5)
            is_away_pp = (as_num > hs_num) and (hs_num < 5)
            
            if is_home_pp and not home_pp_active:
                home_opps += 1
                print(f"[STATE] {time_in_period} P{period} ID:{event_id} - HOME PP START ({hs_num}v{as_num}). Total: {home_opps}")
                home_pp_active = True
            elif not is_home_pp and home_pp_active:
                print(f"[STATE] {time_in_period} P{period} ID:{event_id} - HOME PP END ({hs_num}v{as_num}).")
                home_pp_active = False
                
            if is_away_pp and not away_pp_active:
                away_opps += 1
                print(f"[STATE] {time_in_period} P{period} ID:{event_id} - AWAY PP START ({as_num}v{hs_num}). Total: {away_opps}")
                away_pp_active = True
            elif not is_away_pp and away_pp_active:
                # print(f"[STATE] {time_in_period} P{period} ID:{event_id} - AWAY PP END.")
                away_pp_active = False
        
        # --- Penalty Logic (Event Based) ---
        if type_code == 509:
            details = play.get('details', {})
            duration_min = details.get("duration", 2)
            owner_id = details.get("eventOwnerTeamId")
            desc_key = details.get("descKey", "").lower()
            
            is_coincidental = False # Simplified for debug
            
            # 1. Double Minor
            if duration_min == 4:
                if owner_id == home_id:
                    away_opps += 1
                    print(f"[EVENT] {time_in_period} P{period} ID:{event_id} - AWAY DOUBLE MINOR. Total: {away_opps}")
                elif owner_id == away_id:
                    home_opps += 1
                    print(f"[EVENT] {time_in_period} P{period} ID:{event_id} - HOME DOUBLE MINOR. Total: {home_opps}")
            
            # 2. Stacked
            # Simplified check just to see if it triggers
            # Need to track current time in seconds to check overlap
            # Skipping complex 'has_existing_penalty' for now, just checking logic flow?
            # Actually, let's just log if logic *would* trigger
            pass

    print(f"\nFinal Opps - Home: {home_opps}, Away: {away_opps}")
    
if __name__ == "__main__":
    debug_game()
