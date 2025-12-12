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
        "Vancouver Canucks": "Canucks",
        "Vegas Golden Knights": "Golden Knights",
        "Washington Capitals": "Capitals",
        "Winnipeg Jets": "Jets"
    }

    # Manual Fallback / Override for known games if API fails
    MANUAL_ODDS = {
        # Keep empty unless needed for manual overrides
    }
    
    url = "https://www.bovada.lv/services/sports/event/coupon/events/A/description/hockey/nhl"
    
    try:
        # Use simple requests or urllib, but since we used curl before, let's use requests if available or urllib
        # Using curl via subprocess to match previous style and avoid dependency issues if requests is missing
        cmd = [
            'curl', 
            '-s',
            '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
            url
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        raw_json = result.stdout
        data = json.loads(raw_json)
        
        # Parse Bovada JSON
        # Structure: List -> Path Items -> 'events' -> 'displayGroups' -> 'Game Lines' -> 'markets'
        
        parsed_count = 0
        
        for item in data:
            events = item.get('events', [])
            for event in events:
                # Get Teams
                # Description usually "Away Team @ Home Team"
                desc = event.get('description', '') # e.g. "Chicago Blackhawks @ St. Louis Blues"
                if '@' not in desc:
                    continue
                    
                parts = desc.split(' @ ')
                if len(parts) != 2:
                    continue
                    
                away_raw = parts[0].strip()
                home_raw = parts[1].strip()
                
                away_team = TEAM_MAPPING.get(away_raw)
                home_team = TEAM_MAPPING.get(home_raw)
                
                if not away_team or not home_team:
                    # Try fuzzy match or warn?
                    # print(f"Warning: Could not map teams: {away_raw}, {home_raw}")
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
                            
                            out_desc = outcome.get('description', '')
                            price = outcome.get('price', {}).get('american', 'N/A')
                            
                            if price == 'N/A' or price == 'EVEN':
                                if price == 'EVEN': price = "100"
                                else: continue
                                
                            try:
                                odds_int = int(price)
                            except:
                                continue
                                
                            # Map outcome description to team
                            target_team = None
                            if out_desc == away_raw: target_team = away_team
                            elif out_desc == home_raw: target_team = home_team
                            
                            if target_team:
                                odds_data[target_team] = odds_int

                parsed_count += 1

        print(f"Parsed {parsed_count} games from Bovada.")
        
    except Exception as e:
        print(f"Error fetching Bovada odds: {e}")
        # Could fallback to scraping here if we kept the code, but we are replacing it.
        pass
    
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
