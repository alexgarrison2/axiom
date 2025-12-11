
import csv
import os
import re
import glob
from datetime import datetime

WIN_PCT_CSV = "/Users/alexgarrison/Downloads/HockeyData/saturday_home_win_pct.csv"
HTML_DIR = "/Users/alexgarrison/Downloads/HockeyData/raw_html"
TEAMS_CSV = "/Users/alexgarrison/Downloads/HockeyData/nhl_teams.csv"

def load_capacities():
    caps = {}
    with open(TEAMS_CSV, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                cap = int(row['Arena Capacity'])
                caps[row['Team Tricode']] = cap
            except:
                pass
    return caps

def parse_html_attendance(filepath):
    # Quick regex parse
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    filename = os.path.basename(filepath)
    parts = filename.replace('.html', '').split('_')
    if len(parts) != 2: return []
    season = int(parts[0])
    team = parts[1]
    
    games = []
    # Regex for rows
    row_pattern = re.compile(r'<tr.*?>(.*?)</tr>', re.DOTALL)
    matches = row_pattern.findall(content)
    
    for row in matches:
        if 'data-stat="date_game"' not in row: continue
        
        # Date
        date_match = re.search(r'data-stat="date_game"[^>]*>(?:<a[^>]*>)?([^<]+)(?:</a>)?</td>', row)
        if not date_match: continue
        date_str = date_match.group(1)
        
        # Location
        loc_match = re.search(r'data-stat="game_location"[^>]*>(.*?)</td>', row)
        is_home = (loc_match and loc_match.group(1).strip() == "")
        
        # Attendance
        att_match = re.search(r'data-stat="attendance"[^>]*>(?:<a[^>]*>)?([^<]+)(?:</a>)?</td>', row)
        if att_match:
            try:
                att = int(att_match.group(1).replace(',', ''))
            except:
                att = 0
        else:
            att = 0
            
        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            day = dt.strftime("%A")
        except:
            continue
            
        if is_home and day == "Saturday":
            games.append(att)
            
    return team, season, games

def main():
    # 1. Load Win PCT
    final_stats = {}
    with open(WIN_PCT_CSV, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            final_stats[row['Team']] = {
                'win_pct': row['Saturday Home Win %'],
                'win_rec': row['Raw'],
                'att_pct': "N/A",
                'att_raw': "N/A"
            }
            
    # 2. Load Capacities
    caps = load_capacities()
    
    # 3. Process HTML for Attendance
    files = glob.glob(os.path.join(HTML_DIR, "*.html"))
    for f in files:
        team, season, atts = parse_html_attendance(f)
        
        # Only process for attendance if season >= 2025
        if season < 2025: continue
        
        if team == "ARI": team = "UTA" # Map back
        
        if team not in final_stats:
            # Maybe new team or API mismatch?
            # API has UTA, HTML has ANA, etc.
            continue
            
        # Init or Append?
        # If we have multiple files (2025 + 2026), we need to aggregate.
        # Store temporary list
        if 'att_values' not in final_stats[team]:
            final_stats[team]['att_values'] = []
        final_stats[team]['att_values'].extend(atts)
        
    # 4. Calculate Att Pct
    for team, stats in final_stats.items():
        if 'att_values' in stats and stats['att_values']:
            values = stats['att_values']
            avg_att = sum(values) / len(values)
            cap = caps.get(team, 0)
            
            if cap > 0:
                stats['att_pct'] = f"{(avg_att / cap):.1%}"
            else:
                stats['att_pct'] = "N/A (No Cap)"
                
            stats['att_raw'] = f"{int(avg_att)} avg ({len(values)} g)"
            
    # 5. Print
    print(f"{'Team':<5} | {'Win %':<10} | {'Att %':<10} | {'Win Rec':<10} | {'Att Data':<15}")
    print("-" * 60)
    
    teams = sorted(final_stats.keys())
    for t in teams:
        s = final_stats[t]
        print(f"{t:<5} | {s['win_pct']:<10} | {s['att_pct']:<10} | {s['win_rec']:<10} | {s['att_raw']:<15}")

if __name__ == "__main__":
    main()
