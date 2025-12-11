
import os
import re
import csv
import glob
from datetime import datetime

# Configuration
HTML_DIR = "/Users/alexgarrison/Downloads/HockeyData/raw_html"
TEAMS_CSV = "/Users/alexgarrison/Downloads/HockeyData/nhl_teams.csv"
OUTPUT_CSV = "/Users/alexgarrison/Downloads/HockeyData/saturday_home_analysis.csv"

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

def parse_html_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Identify Team and Season from filename
    filename = os.path.basename(filepath)
    # Format: SEASON_TEAM.html (e.g. 2023_ANA.html)
    parts = filename.replace('.html', '').split('_')
    if len(parts) != 2:
        return []
    season = int(parts[0])
    team = parts[1]
    
    games = []
    
    # Find rows
    # Look for table with id="games" or just all rows in tbody
    # Regex for finding data rows
    row_pattern = re.compile(r'<tr >(.*?)</tr>', re.DOTALL)
    
    matches = row_pattern.findall(content)
    
    for row_html in matches:
        if 'data-stat="date_game"' not in row_html:
            continue
            
        # Extract fields
        date_match = re.search(r'data-stat="date_game"[^>]*>(?:<a[^>]*>)?([^<]+)(?:</a>)?</td>', row_html)
        loc_match = re.search(r'data-stat="game_location"[^>]*>(.*?)</td>', row_html)
        outcome_match = re.search(r'data-stat="game_outcome"[^>]*>(?:<a[^>]*>)?([^<]+)(?:</a>)?</td>', row_html) # Wait, outcome might have link? usually no.
        # Actually outcome is usually text "W", "L"
        # Re-verify regex for simple text cell
        # <td class="left " data-stat="game_outcome" >L</td>
        
        att_match = re.search(r'data-stat="attendance"[^>]*>(?:<a[^>]*>)?([^<]+)(?:</a>)?</td>', row_html)
        
        if not date_match:
            continue
            
        date_str = date_match.group(1)
        location = loc_match.group(1) if loc_match else ""
        outcome = outcome_match.group(1) if outcome_match else "Unknown"
        attendance_str = att_match.group(1) if att_match else "0"
        
        # Parse Date
        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            day_of_week = dt.strftime("%A")
        except:
            continue
            
        # Parse Home/Away
        is_home = (location == "")
        
        # Parse Attendance
        try:
            att = int(attendance_str.replace(',', ''))
        except:
            att = 0
            
        games.append({
            'team': team,
            'season': season,
            'date': date_str,
            'day': day_of_week,
            'is_home': is_home,
            'outcome': outcome,
            'attendance': att
        })
        
    return games

def main():
    capacities = load_capacities()
    all_games = []
    
    files = glob.glob(os.path.join(HTML_DIR, "*.html"))
    print(f"Processing {len(files)} files...")
    
    for f in files:
        all_games.extend(parse_html_file(f))
        
    # Process Metrics
    # 1. Win % (Sat Home, Season >= 2023)
    # 2. Att % (Sat Home, Season >= 2025)
    
    team_stats = {} # {team: {wins: 0, games_win_calc: 0, att_sum: 0, att_games: 0}}
    
    # Initialize for all teams in capacities to ensure complete list
    for t in capacities:
        team_stats[t] = {'wins': 0, 'games_win_calc': 0, 'att_sum': 0, 'att_games': 0}
    
    for g in all_games:
        team = g['team']
        # Handle UTA/ARI mapping for aggregation ONLY if we want combined stats.
        # But prompt implies analyzing "each team".
        # If I have ARI data (pre 2025) and UTA data (2025), and I want ONE "UTA" row...
        # I should probably map ARI -> UTA here if I want to report "UTA history".
        # Let's verify what the User wants. "analyze NHL team performance".
        # Usually implies the franchises.
        # I will map ARI -> UTA for the purpose of the report, because UTA is the current team.
        # If I leave them split, I will have an ARI row (defunct) and UTA row (new).
        # Better to merge for "Win % since 2022".
        
        reporting_team = team
        if team == "ARI":
            reporting_team = "UTA"
            
        if reporting_team not in team_stats:
            # Maybe a team not in my CSV?
            if team in capacities: 
                 team_stats[team] = {'wins': 0, 'games_win_calc': 0, 'att_sum': 0, 'att_games': 0}
            elif reporting_team in capacities:
                 pass # it's there
            else:
                 # Add it
                 team_stats[reporting_team] = {'wins': 0, 'games_win_calc': 0, 'att_sum': 0, 'att_games': 0}
                 # Warn about missing capacity?
                 
        if not g['is_home']:
            continue
            
        if g['day'] != "Saturday":
            continue
            
        # Metric 1: Win % (Since 2022-23 aka Season >= 2023)
        if g['season'] >= 2023:
            team_stats[reporting_team]['games_win_calc'] += 1
            if g['outcome'] == 'W':
                team_stats[reporting_team]['wins'] += 1
                
        # Metric 2: Attendance (Since 2024-25 aka Season >= 2025)
        if g['season'] >= 2025:
             if g['attendance'] > 0:
                 team_stats[reporting_team]['att_sum'] += g['attendance']
                 team_stats[reporting_team]['att_games'] += 1
                 
    # Output
    
    results = []
    for team, stats in team_stats.items():
        # Win %
        win_pct = 0.0
        if stats['games_win_calc'] > 0:
            win_pct = stats['wins'] / stats['games_win_calc']
            
        # Attendance %
        att_pct = 0.0
        capacity = capacities.get(team, 0)
        
        if stats['att_games'] > 0 and capacity > 0:
            avg_att = stats['att_sum'] / stats['att_games']
            att_pct = avg_att / capacity
            
        results.append({
            'Team': team,
            'Saturday Home Win % (Since 22-23)': f"{win_pct:.1%}",
            'Saturday Home Att % (Since 24-25)': f"{att_pct:.1%}",
            'Raw Win Data': f"{stats['wins']}/{stats['games_win_calc']}",
            'Raw Att Data': f"{int(stats['att_sum']/stats['att_games']) if stats['att_games'] else 0} avg",
            'Capacity': capacity
        })
        
    # Sort by Team
    results.sort(key=lambda x: x['Team'])
    
    # Print and Save
    keys = ['Team', 'Saturday Home Win % (Since 22-23)', 'Saturday Home Att % (Since 24-25)', 'Raw Win Data', 'Raw Att Data', 'Capacity']
    
    print(f"{' | '.join(keys)}")
    print("-" * 100)
    for r in results:
        print(f"{r['Team']:<4} | {r['Saturday Home Win % (Since 22-23)']:<30} | {r['Saturday Home Att % (Since 24-25)']:<30} | {r['Raw Win Data']:<12} | {r['Raw Att Data']:<12} | {r['Capacity']}")
        
    with open(OUTPUT_CSV, 'w') as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        writer.writerows(results)
        
    print(f"\nSaved to {OUTPUT_CSV}")

if __name__ == "__main__":
    main()
