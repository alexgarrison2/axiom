import subprocess
import re
import json

def test_fetch_lineups(team_slug):
    print(f"Fetching DFO Lineups for {team_slug}...")
    url = f"https://www.dailyfaceoff.com/teams/{team_slug}/line-combinations"
    
    cmd = [
        'curl', 
        '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
        url
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        html = result.stdout
        
        match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html)
        if not match:
            print("No __NEXT_DATA__ found.")
            return

        data = json.loads(match.group(1))
        
        # Path identified: props -> pageProps -> combinations -> data
        # "combinations" key found in keys list.
        page_props = data.get('props', {}).get('pageProps', {})
        
        # "combinations" key found in keys list.
        # Check 'players'
        combinations = page_props.get('combinations', {})
        players = combinations.get('players', [])
        print(f"Found {len(players)} players.")
        
        if len(players) > 0:
            print("First player object:")
            print(json.dumps(players[0], indent=2))
            
            # Check distinct positions/lines
            lines_set = set()
            for p in players:
                 # Check what ties them to a line
                 # Maybe 'line' or 'groupIdentifier' or 'position' (LW1, C1)
                 print(f"Sample Player Keys: {p.keys()}")
                 break
        
        return
            
        defense = combinations.get('defense', [])
        print("Defense length:", len(defense))
        
        return
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_fetch_lineups("chicago-blackhawks")
