import subprocess
import re
import json
import os
import urllib.request
import ssl
from datetime import datetime

def fetch_odds():
    print("Fetching odds from Bovada API...")
    
    odds_data = {}
    
    # Bovada Team Name -> App Common Name Mapping
    TEAM_MAPPING = {
        "Anaheim Ducks": "Ducks",
        "Boston Bruins": "Bruins",
        "Buffalo Sabres": "Sabres",
        "Calgary Flames": "Flames",
        "Carolina Hurricanes": "Hurricanes",
        "Chicago Blackhawks": "Blackhawks",
        "Colorado Avalanche": "Avalanche",
        "Columbus Blue Jackets": "Blue Jackets",
        "Dallas Stars": "Stars",
        "Detroit Red Wings": "Red Wings",
        "Edmonton Oilers": "Oilers",
        "Florida Panthers": "Panthers",
        "Los Angeles Kings": "Kings",
        "Minnesota Wild": "Wild",
        "Montreal Canadiens": "Canadiens",
        "Nashville Predators": "Predators",
        "New Jersey Devils": "Devils",
        "New York Islanders": "Islanders",
        "New York Rangers": "Rangers",
        "Ottawa Senators": "Senators",
        "Philadelphia Flyers": "Flyers",
        "Pittsburgh Penguins": "Penguins",
        "San Jose Sharks": "Sharks",
        "Seattle Kraken": "Kraken",
        "St. Louis Blues": "Blues",
        "Tampa Bay Lightning": "Lightning",
        "Toronto Maple Leafs": "Maple Leafs",
        "Utah Hockey Club": "Mammoth", # App uses 'Mammoth' for Utah
        "Utah Mammoth": "Mammoth",
        "Vancouver Canucks": "Canucks",
        "Vegas Golden Knights": "Golden Knights",
        "Washington Capitals": "Capitals",
        "Winnipeg Jets": "Jets"
    }

    # Manual Fallback / Override for known games if API fails
    MANUAL_ODDS = {
        # Keep empty unless needed for manual overrides
    }
    
    # Fetch from Bovada (Multiple endpoints)
    urls = [
        "https://www.bovada.lv/services/sports/event/v2/events/A/description/hockey/nhl",
        "https://www.bovada.lv/services/sports/event/v2/events/A/description/hockey"
    ]
    
    data = []
    
    for url in urls:
        try:
            cmd = [
                'curl', 
                '-s',
                '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
                url
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            raw_json = result.stdout
            chunk = json.loads(raw_json)
            if isinstance(chunk, list):
                data.extend(chunk)
                print(f"Fetched {len(chunk)} items from {url}")
                
        except Exception as e:
            print(f"Error fetching {url}: {e}")
            
    print(f"Total aggregated items: {len(data)}")
    
    parsed_count = 0
    
    for item in data:
        events = item.get('events', [])
        print(f"Processing league/group: {item.get('description')} with {len(events)} events.")
        
        for event in events:
            # Get Teams
            # Description usually "Away Team @ Home Team"
            desc = event.get('description', 'Unknown') # e.g. "Chicago Blackhawks @ St. Louis Blues"
            
            # Check if it's a game (Matchup)
            if ' @ ' not in desc:
               # print(f"  Skipping non-game event: {desc}")
               print(f"  Skipping non-game event (no '@' separator): {desc}")
               continue
               
            # Parse Teams
            try:
                away_raw, home_raw = desc.split(' @ ')
            except ValueError:
                print(f"  Could not parse teams from: {desc}")
                continue
            
            # Extract Date
            start_time_ms = event.get('startTime', 0)
            if start_time_ms:
                # Convert milliseconds to datetime (Universal format, usually UTC)
                # Use US/Central to avoid UTC date shifts (e.g. 7pm game becoming next day)
                try:
                    import pytz
                    from datetime import timezone
                    
                    dt_utc = datetime.fromtimestamp(start_time_ms / 1000.0, tz=timezone.utc)
                    central = pytz.timezone('US/Central')
                    dt_central = dt_utc.astimezone(central)
                    date_str = dt_central.strftime('%Y-%m-%d')
                except ImportError:
                    # Fallback if pytz not available (though it should be)
                    # Simple offset: UTC-6
                    from datetime import timezone, timedelta
                    dt_utc = datetime.fromtimestamp(start_time_ms / 1000.0, tz=timezone.utc)
                    dt_central = dt_utc - timedelta(hours=6)
                    date_str = dt_central.strftime('%Y-%m-%d')
            else:
                date_str = datetime.now().strftime('%Y-%m-%d') # Fallback
            
            # Check mapping
            away_team = TEAM_MAPPING.get(away_raw)
            home_team = TEAM_MAPPING.get(home_raw)
            
            if not away_team or not home_team:
                print(f"  Mapping failed for {desc} (Away: {away_team}, Home: {home_team})")
                # Debug which one failed
                if not away_team: print(f"    Unknown Away: '{away_raw}'")
                if not home_team: print(f"    Unknown Home: '{home_raw}'")
                continue
            
            matchup_id = f"{date_str}:{away_team}@{home_team}"
            print(f"Found matchup: {matchup_id}")
            
            # Find Game Lines
            game_lines = None
            for group in event.get('displayGroups', []):
                if group.get('description') == 'Game Lines':
                    game_lines = group
                    break
            
            if not game_lines:
                continue
                
            # Extract Moneyline
            # Market description is "Moneyline"
            for market in game_lines.get('markets', []):
                if market.get('description') == 'Moneyline':
                    outcomes = market.get('outcomes', [])
                    for outcome in outcomes:
                        # outcome['description'] is usually the team name or 'Draw'
                        # outcome['price']['american'] is the odds string (e.g. "-115", "+105")
                        
                        out_desc = outcome.get('description')
                        price = outcome.get('price', {})
                        odds_american = price.get('american')
                        
                        if odds_american and out_desc:
                            try:
                                if odds_american == 'EVEN':
                                    odds_int = 100
                                else:
                                    odds_int = int(odds_american)
                                
                                # Map outcome description to team using the SAME mapping
                                # This handles cases where Title is "Utah Mammoth" but Outcome is "Utah Hockey Club"
                                mapped_outcome = TEAM_MAPPING.get(out_desc)
                                
                                target_team = None
                                
                                # 1. Direct match with raw names (Legacy)
                                if out_desc == away_raw: target_team = away_team
                                elif out_desc == home_raw: target_team = home_team
                                
                                # 2. Mapped match (Robust)
                                elif mapped_outcome == away_team: target_team = away_team
                                elif mapped_outcome == home_team: target_team = home_team
                                
                                if target_team:
                                    if matchup_id not in odds_data:
                                        odds_data[matchup_id] = {}
                                    odds_data[matchup_id][target_team] = odds_int
                                    print(f"  Added odds for {target_team}: {odds_int}")
                                    
                            except ValueError:
                                pass

            parsed_count += 1

    print(f"Parsed {parsed_count} games from Bovada.")
    print(f"Found odds for {len(odds_data)} teams.")

    if len(odds_data) == 0:
        print("Bovada returned 0 odds. Attempting fallback to ESPN API...")
        try:
            espn_url = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard"
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            req = urllib.request.Request(espn_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, context=ctx) as response:
                espn_data = json.loads(response.read().decode())
                
            for event in espn_data.get('events', []):
                try:
                    start_time_iso = event.get('date', '') 
                    if not start_time_iso: continue
                    
                    dt_str = start_time_iso.replace('Z', '')
                    if len(dt_str.split(':')) == 2:
                        dt_str += ':00'
                    
                    try:
                        import pytz
                        from datetime import timezone
                        dt_utc = datetime.fromisoformat(dt_str + '+00:00')
                        central = pytz.timezone('US/Central')
                        dt_central = dt_utc.astimezone(central)
                        date_str = dt_central.strftime('%Y-%m-%d')
                    except Exception:
                        from datetime import timezone, timedelta
                        dt_utc = datetime.fromisoformat(dt_str + '+00:00')
                        dt_central = dt_utc - timedelta(hours=6)
                        date_str = dt_central.strftime('%Y-%m-%d')
                    
                    competitions = event.get('competitions', [])
                    if not competitions: continue
                    comp = competitions[0]
                    
                    competitors = comp.get('competitors', [])
                    if len(competitors) < 2: continue
                        
                    home_raw = competitors[0].get('team', {}).get('name', '') if competitors[0].get('homeAway') == 'home' else competitors[1].get('team', {}).get('name', '')
                    away_raw = competitors[0].get('team', {}).get('name', '') if competitors[0].get('homeAway') == 'away' else competitors[1].get('team', {}).get('name', '')
                    
                    home_team = TEAM_MAPPING.get(home_raw, home_raw)
                    away_team = TEAM_MAPPING.get(away_raw, away_raw)
                    if "Hockey Club" in home_team: home_team = "Mammoth"
                    if "Hockey Club" in away_team: away_team = "Mammoth"

                    matchup_id = f"{date_str}:{away_team}@{home_team}"
                    
                    odds_list = comp.get('odds', [])
                    if odds_list:
                        ml = odds_list[0].get('moneyline', {})
                        h_odds_str = ml.get('home', {}).get('close', {}).get('odds', ml.get('home', {}).get('open', {}).get('odds'))
                        a_odds_str = ml.get('away', {}).get('close', {}).get('odds', ml.get('away', {}).get('open', {}).get('odds'))
                        
                        if h_odds_str and a_odds_str:
                            h_odds = 100 if h_odds_str == 'EVEN' else int(h_odds_str)
                            a_odds = 100 if a_odds_str == 'EVEN' else int(a_odds_str)
                            
                            if matchup_id not in odds_data:
                                odds_data[matchup_id] = {}
                            odds_data[matchup_id][home_team] = h_odds
                            odds_data[matchup_id][away_team] = a_odds
                            print(f"  [ESPN] Added odds for {home_team}: {h_odds}, {away_team}: {a_odds}")
                            
                except Exception as e:
                    print(f"Error parsing ESPN event: {e}")
                    
        except Exception as e:
            print(f"Error fetching ESPN data: {e}")
            
        print(f"Found odds for {len(odds_data)} matchups after ESPN fallback.")
    
    # Merge Manual Odds (Override)
    for team, odds in MANUAL_ODDS.items():
        # Manual odds remain team-based for legacy/simplicity, 
        # but in practice we should probably phase this out or update it.
        # For now, let's keep it as is or ignore it in the context of the new structure.
        pass
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(script_dir, 'odds.json')
    
    with open(output_path, 'w') as f:
        json.dump(odds_data, f, indent=4)
        
    return odds_data

if __name__ == "__main__":
    fetch_odds()
