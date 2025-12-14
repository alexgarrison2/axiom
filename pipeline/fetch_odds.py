import subprocess
import re
import json
import datetime

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
            
            # Check mapping
            away_team = TEAM_MAPPING.get(away_raw)
            home_team = TEAM_MAPPING.get(home_raw)
            
            if not away_team or not home_team:
                print(f"  Mapping failed for {desc} (Away: {away_team}, Home: {home_team})")
                # Debug which one failed
                if not away_team: print(f"    Unknown Away: '{away_raw}'")
                if not home_team: print(f"    Unknown Home: '{home_raw}'")
                continue
            
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
                                    odds_data[target_team] = odds_int
                                    
                            except ValueError:
                                pass

            parsed_count += 1

    print(f"Parsed {parsed_count} games from Bovada.")
    
    print(f"Found odds for {len(odds_data)} teams.")
    
    # Merge Manual Odds (Override)
    for team, odds in MANUAL_ODDS.items():
        if team not in odds_data:
            print(f"Using manual odds for {team}: {odds}")
            odds_data[team] = odds
        else:
            print(f"Bovada odds found for {team}: {odds_data[team]} (Manual ignored)")
    
    with open('odds.json', 'w') as f:
        json.dump(odds_data, f, indent=4)
        
    return odds_data

if __name__ == "__main__":
    fetch_odds()
