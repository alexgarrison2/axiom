import re

def parse_odds():
    with open('odds.html', 'r') as f:
        content = f.read()
        
    # Regex to find rows. This is tricky with HTML.
    # Let's try to find the pattern: team-name...current-moneyline...data-value
    
    # Strategy: Split by "event-card-row" to get each team's section
    rows = content.split('class="event-card-row')
    
    print(f"Found {len(rows)} potential rows")
    
    for i, row in enumerate(rows[1:]): # Skip first split part
        # Extract Team Name/Abbr
        # <span class="team-name"><a ... data-abbr="DAL">Stars</a></span>
        team_match = re.search(r'data-abbr="([^"]+)"', row)
        if not team_match:
            continue
            
        team_abbr = team_match.group(1)
        
        # Extract Moneyline
        # <td data-field="current-moneyline"> ... <span class="data-value"> -115 </span>
        # We need to be careful to get the one in this row.
        
        # Find the current-moneyline cell
        moneyline_chunk = row.split('data-field="current-moneyline"')
        if len(moneyline_chunk) < 2:
            print(f"No moneyline for {team_abbr}")
            continue
            
        # Look inside the cell
        cell_content = moneyline_chunk[1]
        # <span class="data-value"> -115 </span>
        val_match = re.search(r'class="data-value">\s*([+-]?\d+)\s*<', cell_content)
        
        if val_match:
            odds = val_match.group(1)
            print(f"Team: {team_abbr}, Odds: {odds}")
        else:
            print(f"Team: {team_abbr}, Odds: N/A")

if __name__ == "__main__":
    parse_odds()
