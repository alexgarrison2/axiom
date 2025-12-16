
import urllib.request
import csv
import time
import random
import re
import ssl
from datetime import datetime

# Team Mappings (Tricode -> H-Ref Code)
# most are same, exceptions: VGK->VEG, UTA->UTA (Confirmed)
TEAM_MAPPING = {
    "ANA": "ANA", "BOS": "BOS", "BUF": "BUF", "CAR": "CAR", "CBJ": "CBJ",
    "CGY": "CGY", "CHI": "CHI", "COL": "COL", "DAL": "DAL", "DET": "DET",
    "EDM": "EDM", "FLA": "FLA", "LAK": "LAK", "MIN": "MIN", "MTL": "MTL",
    "NJD": "NJD", "NSH": "NSH", "NYI": "NYI", "NYR": "NYR", "OTT": "OTT",
    "PHI": "PHI", "PIT": "PIT", "SEA": "SEA", "SJS": "SJS", "STL": "STL",
    "TBL": "TBL", "TOR": "TOR", "UTA": "UTA", "VAN": "VAN", "VGK": "VEG",
    "WPG": "WPG", "WSH": "WSH"
}

OUTPUT_FILE = "href_stats.csv"

def fetch_team_gamelog(tricode, href_code):
    url = f"https://www.hockey-reference.com/teams/{href_code}/2026_gamelog.html"
    print(f"Fetching {tricode} ({href_code}) from {url}...")
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
    }
    
    req = urllib.request.Request(url, headers=headers)
    context = ssl._create_unverified_context()
    
    try:
        with urllib.request.urlopen(req, context=context) as response:
            html = response.read().decode('utf-8')
            return html
    except Exception as e:
        print(f"Error fetching {tricode}: {e}")
        return None

def parse_gamelog(html, tricode):
    stats = []
    
    # Locate the table - heavily guarded regex due to comments
    # We look for the TABLE ROWs inside the tbody
    # Structure in H-Ref 2026:
    # <tr id="gamelog.202510090COL" ... ><td ... data-stat="date_game" ... >2025-10-09</td>...
    
    # 1. Normalize HTML to remove comment markers around table if present
    # H-Ref often wraps tables in <!--  \n <div ... table ... </div> \n -->
    # We just want to treat the whole string as valid HTML for regex purposes
    
    # Regex to find rows. 
    # We need: Date, Opponent, Team PPG/PPO, Opp PPG/PPO
    # Indices based on previous inspection (approximate, better to parse by data-stat)
    
    # Regex for a row
    # Found id="team_games.1" format in raw HTML
    row_pattern = re.findall(r'<tr id="team_games\..*?>(.*?)</tr>', html, re.DOTALL)
    
    for row_html in row_pattern:
        try:
            # Helper to extract data-stat value
            def get_stat(stat_name):
                # match <td ... data-stat="stat_name" ... >VALUE</td>
                # VALUE might be inside <a..>VALUE</a>
                m = re.search(r'data-stat="' + stat_name + r'"[^>]*>(.*?)</td>', row_html, re.DOTALL)
                if not m: return None
                content = m.group(1)
                # Strip links if present
                content = re.sub(r'<[^>]+>', '', content).strip()
                return content

            date_str = get_stat("date") # 2025-10-09
            opp_code = get_stat("opp_name_abbr")  # PHI
            
            # Team PP
            pp_goals = get_stat("goals_pp")
            pp_opps = get_stat("chances_pp")
            
            # Opponent PP
            opp_pp_goals = get_stat("goals_against_pp")
            opp_pp_opps = get_stat("opp_chances_pp")
            
            if date_str and opp_code:
                stats.append({
                    "team": tricode,
                    "date": date_str,
                    "opponent": opp_code,
                    "pp_goals": pp_goals or "0",
                    "pp_opportunities": pp_opps or "0",
                    "opp_pp_goals": opp_pp_goals or "0",
                    "opp_pp_opportunities": opp_pp_opps or "0"
                })
        except Exception as e:
            print(f"Error parse row for {tricode}: {e}")
            continue
            
    return stats

def main():
    all_stats = []
    
    print(f"Starting Scraper for {len(TEAM_MAPPING)} teams...")
    
    for tricode, href_code in TEAM_MAPPING.items():
        html = fetch_team_gamelog(tricode, href_code)
        if html:
            team_stats = parse_gamelog(html, tricode)
            print(f" -> Found {len(team_stats)} games for {tricode}")
            all_stats.extend(team_stats)
        
        # Be nice to H-Ref
        time.sleep(random.uniform(2.0, 4.0))
        
    # Write to CSV
    print(f"Writing {len(all_stats)} rows to {OUTPUT_FILE}...")
    headers = ["team", "date", "opponent", "pp_goals", "pp_opportunities", "opp_pp_goals", "opp_pp_opportunities"]
    
    with open(OUTPUT_FILE, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(all_stats)
        
    print("Done.")

if __name__ == "__main__":
    main()
