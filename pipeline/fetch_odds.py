import subprocess
import re
import json
import datetime

def fetch_odds():
    print("Fetching odds from scoresandodds.com...")
    
    # Manual Fallback / Override for known games if scraper fails
    # Updated: 2025-12-06
    MANUAL_ODDS = {
        # Dec 6
        "Avalanche": -225, "Rangers": +180,
        "Panthers": -170, "Blue Jackets": +150, # Corrected per user feedback
        "Devils": -116, "Golden Knights": -105,
        "Jets": -130, "Sabres": +110,
        "Stars": -278, "Sharks": +225,
        "Canucks": -165, "Mammoth": +140, # Assumed based on typical lines
        "Ducks": +150, "Capitals": -180,
        
        # Dec 7
        "Bruins": +101, "Devils": -120,
        "Maple Leafs": -144, "Canadiens": +120,
        "Senators": -152, "Blues": +130,
        "Lightning": -204, "Islanders": +170,
        "Hurricanes": -200, "Predators": +170, # Est
        "Flames": -115, "Mammoth": -105, # Est
        "Kings": -130, "Blackhawks": +110, # Est
        "Oilers": -150, "Jets": +130, # Est
        "Wild": -140, "Canucks": +120, # Est
        "Red Wings": +140, "Kraken": -160 # Est
    }
    
    # Use curl to get the page
    cmd = [
        'curl', 
        '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
        '-o', 'odds.html',
        'https://www.scoresandodds.com/nhl'
    ]
    
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error fetching odds: {e}")
        return {}

    with open('odds.html', 'r') as f:
        content = f.read()
        
    rows = content.split('class="event-card-row')
    odds_data = {}
    
    print(f"Parsing {len(rows)} rows...")
    
    for row in rows[1:]:
        # Extract Team Name (Common Name)
        # We look for data-abbr="Name" or just the text inside the link
        # Based on test, data-abbr seems to hold the name "Stars", "Devils" etc.
        team_match = re.search(r'data-abbr="([^"]+)"', row)
        if not team_match:
            continue
            
        team_name = team_match.group(1)
        
        # Extract Moneyline
        moneyline_chunk = row.split('data-field="current-moneyline"')
        if len(moneyline_chunk) < 2:
            continue
            
        cell_content = moneyline_chunk[1]
        val_match = re.search(r'class="data-value">\s*([+-]?\d+)\s*<', cell_content)
        
        if val_match:
            odds = int(val_match.group(1))
            odds_data[team_name] = odds
            
    print(f"Found odds for {len(odds_data)} teams.")
    
    # Merge Manual Odds (Override)
    for team, odds in MANUAL_ODDS.items():
        if team not in odds_data:
            print(f"Using manual odds for {team}: {odds}")
            odds_data[team] = odds
        else:
            print(f"Scraped odds found for {team}: {odds_data[team]} (Manual ignored)")
    
    with open('odds.json', 'w') as f:
        json.dump(odds_data, f, indent=4)
        
    return odds_data

if __name__ == "__main__":
    fetch_odds()
