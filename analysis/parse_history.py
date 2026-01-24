
import pandas as pd
from bs4 import BeautifulSoup
import os
import re

def parse_html_to_csv():
    data_dir = 'analysis/data'
    all_game_data = []
    
    files = [f for f in os.listdir(data_dir) if f.endswith('.html') and f.startswith('COL_')]
    files.sort()
    
    for filename in files:
        year = filename.split('_')[1].split('.')[0]
        filepath = os.path.join(data_dir, filename)
        
        print(f"Parsing {filename}...")
        
        with open(filepath, 'r', encoding='utf-8') as f:
            soup = BeautifulSoup(f, 'html.parser')
            
        # The table ID is usually "games"
        table = soup.find('table', {'id': 'games'})
        if not table:
            # Maybe it's "games_playoffs" or something else? Usually regular season is "games"
            print(f"  Warning: 'games' table not found in {filename}")
            continue
            
        # Iterate rows
        rows = table.find('tbody').find_all('tr')
        
        for row in rows:
            # Skip header rows repeated in table
            if row.get('class') and 'thead' in row.get('class'):
                continue
                
            date_cell = row.find('td', {'data-stat': 'date_game'})
            opp_cell = row.find('td', {'data-stat': 'opp_name'})
            gf_cell = row.find('td', {'data-stat': 'goals'})
            ga_cell = row.find('td', {'data-stat': 'opp_goals'})
            loc_cell = row.find('td', {'data-stat': 'game_location'}) # @ or empty
            result_cell = row.find('td', {'data-stat': 'game_outcome'}) # W, L, OL
            ot_cell = row.find('td', {'data-stat': 'overtimes'}) # OT, SO, or empty
            
            if not date_cell or not opp_cell:
                continue
                
            date_str = date_cell.get_text()
            opponent = opp_cell.get_text()
            gf = gf_cell.get_text() if gf_cell else 0
            ga = ga_cell.get_text() if ga_cell else 0
            location = loc_cell.get_text() if loc_cell else ''
            result = result_cell.get_text() if result_cell else ''
            ot_status = ot_cell.get_text() if ot_cell else ''
            
            # Normalize Location
            # @ = Away, Empty = Home
            venue = 'Away' if location == '@' else 'Home'
            
            # Normalize Opponent Name
            # H-ref uses full names usually "Dallas Stars". My script maps "Stars".
            # I'll extract just the team name part if possible, or mapping will handle it via 'in' check.
            # But wait, checking the altitude map: keys are 'Stars', 'Blues', etc.
            # H-ref gives "Dallas Stars".
            # My current script logic: `for k in ALTITUDES.keys(): if k in venue_team: ...`
            # So "Dallas Stars" containing "Stars" will match. This is fine.
            
            # Additional check: Utah/Arizona
            if "Arizona" in opponent: opponent = "Coyotes"
            if "Utah" in opponent: opponent = "Utah" # Will match 'Utah' in dict or 'Mammoth' map
            
            row_data = {
                'date': date_str,
                'team': 'Avalanche',
                'opponent': opponent,
                'home_away': venue,
                'goals_for': gf,
                'goals_against': ga,
                'result_code': result, # W, L
                'ot_status': ot_status # OT, SO
            }
            
            # Determine normalized result code for my bucket logic
            # My bucket logic looks for: RW, RL, OTW, OTL, SOW, SOL
            # H-ref has Result=W/L/OL and OT=OT/SO
            
            norm_result = ''
            if result == 'W':
                if ot_status == 'OT': norm_result = 'OTW'
                elif ot_status == 'SO': norm_result = 'SOW'
                else: norm_result = 'RW'
            elif result == 'L':
                if ot_status == 'OT': norm_result = 'OTL' # H-Ref usually marks OTL as "OL" in outcome column?
                # Actually H-ref 'game_outcome' is usually 'L' or 'W'. 'OL' is sometimes used.
                # Let's verify standard H-ref behavior.
                # If outcome is L and OT is 'OT', it's OTL.
                # If outcome is L and OT is 'SO', it's SOL.
                if ot_status == 'OT': norm_result = 'OTL'
                elif ot_status == 'SO': norm_result = 'SOL'
                else: norm_result = 'RL'
            elif result == 'OL': # Overtime Loss specific code
                 norm_result = 'OTL' # Could be SOW? No OL is loss.
                 if ot_status == 'SO': norm_result = 'SOL'
            
            row_data['result'] = norm_result
            all_game_data.append(row_data)
            
    df = pd.DataFrame(all_game_data)
    df.to_csv('analysis/data/historical_avs_games.csv', index=False)
    print(f"Saved {len(df)} games to analysis/data/historical_avs_games.csv")

if __name__ == "__main__":
    parse_html_to_csv()
