import json
import subprocess
import re
import datetime

def fetch_dailyfaceoff_goalies():
    print("Fetching Daily Faceoff data...")
    
    # Use curl to mimic a browser and avoid 403
    cmd = [
        'curl', 
        '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
        'https://www.dailyfaceoff.com/starting-goalies'
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        html = result.stdout
        
        # Extract the __NEXT_DATA__ JSON blob
        match = re.search(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
        if not match:
            print("Could not find __NEXT_DATA__ in HTML.")
            return {}
            
        data = json.loads(match.group(1))
        
        # The structure seems to be props -> pageProps -> data (array of games)
        # Note: The URL is /starting-goalies, so it likely returns today's games or a range.
        games = data.get('props', {}).get('pageProps', {}).get('data', [])
        
        goalie_info = {}
        
        print(f"Found {len(games)} games in DFO data.")
        
        for game in games:
            date = game.get('date') # YYYY-MM-DD
            
            # Check if game is for today or tomorrow (we care about near future)
            # Actually, let's just store ALL of them keyed by team.
            # If duplicates exist (same team next day), the latest one might overwrite, 
            # or we should key by Date + Team.
            # Current consumer (fetch_upcoming) iterates by date and looks up team.
            # So if we store {Team: {Goalie, Status, Date}}, we might have a collision if back-to-back.
            # BETTER: Store {Team: [List of entries]} or just check date matching in consumer?
            # For now, let's just see what dates we have.
            # Users want TODAY's goalie. 
            # Let's verify if DFO returns multiple days.
            
            home_team = game.get('homeTeamName')
            away_team = game.get('awayTeamName')
            
            home_goalie = game.get('homeGoalieName')
            home_news_status = game.get('homeNewsStrengthName')
            
            # Use 'homeTeam' dict if available for more robustness? 
            # game['homeTeam']['name'] might be safer?
            # data structure: "homeTeam": { "name": "Toronto Maple Leafs", ... }
            if not home_team and 'homeTeam' in game:
                home_team = game['homeTeam'].get('name')
                
            if not away_team and 'awayTeam' in game:
                away_team = game['awayTeam'].get('name')

            # Goalie objects?
            # "homeGoalie": { "name": "...", "newsStrength": "..." }
            # PRIMARY SOURCE: game.get('homeGoalieName') should be the actual card name.
            # Only use nested object if top level is missing.
            if 'homeGoalie' in game and game['homeGoalie'] and not home_goalie:
                 home_goalie = game['homeGoalie'].get('name')
                 # newsStrength might be inside?
                 # Inspecting previous code: it used game.get('homeNewsStrengthName')
                 
            # Fallback status logic
            home_status = home_news_status
            if not home_status and home_goalie:
                home_status = "Unconfirmed"
            
            away_goalie = game.get('awayGoalieName')
            away_news_status = game.get('awayNewsStrengthName')
            
            if 'awayGoalie' in game and game['awayGoalie']:
                away_goalie = game['awayGoalie'].get('name')

            away_status = away_news_status
            if not away_status and away_goalie:
                away_status = "Unconfirmed"
            
            # Key by Team Name for easy lookup
            # We will append the date to the key OR store a list to handle back-to-backs
            # Consumer expects: goalie_info[team] -> dict
            # If we detect a collision, we might need a smarter key.
            # Let's try to match the EXACT name fetch_upcoming uses.
            
            if home_team:
                # Store with Date key to be safe?
                # Or just update if it's the 'next' game?
                # For now, just store.
                goalie_info[home_team] = {
                    'goalie': home_goalie,
                    'status': home_status,
                    'date': date
                }
                
            if away_team:
                goalie_info[away_team] = {
                    'goalie': away_goalie,
                    'status': away_status,
                    'date': date
                }
        
        with open('dailyfaceoff_goalies.json', 'w') as f:
            json.dump(goalie_info, f, indent=4)
            
        return goalie_info
        
    except subprocess.CalledProcessError as e:
        print(f"Error running curl: {e}")
        return {}
    except Exception as e:
        print(f"Error parsing Daily Faceoff data: {e}")
        return {}


def fetch_player_news():
    print("Fetching Daily Faceoff Player News...")
    
    # Use curl to mimic a browser
    cmd = [
        'curl', 
        '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
        'https://www.dailyfaceoff.com/hockey-player-news'
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        html = result.stdout
        
        # Extract the __NEXT_DATA__ JSON blob
        match = re.search(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
        if not match:
            print("Could not find __NEXT_DATA__ in HTML.")
            return {}
            
        data = json.loads(match.group(1))
        
        # Structure identified: props -> pageProps -> data -> data (list)
        news_items = data.get('props', {}).get('pageProps', {}).get('data', {}).get('data', [])
        
        print(f"Found {len(news_items)} news items.")
        
        # Structure to return: { TeamTriCode: [ { msg: "...", date: "..." }, ... ] }
        # Actually, let's store by Team Name first, then map to TriCode later if possible, 
        # or just match by name like we do for goalies.
        
        team_news = {} 
        
        # Get today's date in DFO format (likely ISO or similar)
        # The user said "date stamp = today"
        # Let's inspect the date format. Usually "2025-12-09T..."
        today_str = datetime.date.today().strftime("%Y-%m-%d")
        print(f"Filtering for news from: {today_str}")
        
        for item in news_items:
            # Verified Keys:
            # - date: "2025-12-09"
            # - details: "Name (injury) will return..."
            # - newsCategoryName: "Injury", "Goalie Start", "Line Change"
            # - teamAbbreviation: "NYI"
            # - playerName: "Jean-Gabriel Pageau"
            
            # 1. Date Check
            news_date = item.get('date', '') 
            if news_date != today_str:
                # Debug print for first few skipped
                # print(f"Skipping older news: {news_date}")
                continue
                
            # 2. Category Check (Exclude Goalie Start)
            category = item.get('newsCategoryName', 'Unknown')
            if 'goalie' in category.lower() and 'start' in category.lower():
                continue
                
            # 3. Helpers
            player_name = item.get('playerName', 'Unknown')
            details = item.get('details', '')
            # Clean details: sometimes might be HTML, but 'details' usually plain text?
            # 'fantasyDetails' is the long one. 'details' is short.
            # Example: "Pageau (upper-body) will return vs. Vegas on Tuesday"
            
            # If details is empty, try fantasyDetails but truncated?
            if not details:
                continue
            
            tri_code = item.get('teamAbbreviation')
            if not tri_code:
                # content usually has teamName
                continue
            
            # Normalize TriCode (e.g. MON -> MTL check?)
            # DFO usually standard, but let's trust it for now.
            
            # Formatted Message
            # The user requested format: "Dumba: healthy scratch vs. ANA"
            # Check if details starts with name.
            # "Pageau (upper-body)..." matches "Dumba..."
            # If so, just use details.
            
            # If details doesn't start with player name, prepend it?
            # "will be a healthy scratch" -> NO.
            # Let's verify.
            
            news_text = details
            
            # Store it keyed by TriCode
            if tri_code not in team_news:
                team_news[tri_code] = []
                
            team_news[tri_code].append({
                'player': player_name,
                'news': news_text,
                'category': category,
                'date': news_date
            })
            
        print(f"Extracted news for {len(team_news)} teams.")
        
        with open('player_news.json', 'w') as f:
            json.dump(team_news, f, indent=4)
            
        return team_news
        
    except Exception as e:
        print(f"Error fetching player news: {e}")
        return {}
            
        print(f"Extracted news for {len(team_news)} teams.")
        
        with open('player_news.json', 'w') as f:
            json.dump(team_news, f, indent=4)
            
        return team_news
        
    except Exception as e:
        print(f"Error fetching player news: {e}")
        return {}


def fetch_lineups(teams):
    """
    Fetches lineup data for a list of team info objects (need 'triCode' and 'name'/'slug').
    We need to construct the DFO URL from the team name/slug.
    """
    print("Fetching Daily Faceoff Lineups...")
    
    lineups = {}
    
    # Iterate over teams. 
    # NOTE: Fetching 32 teams sequentially is slow. 
    # Ideally, we only fetch for the teams playing today? 
    # The 'teams' argument should be a list of team slugs or similar.
    # For now, let's assume we get a list of active teams from predict_games or fetch_upcoming.
    
    for team_data in teams:
        # Construct slug: "Chicago Blackhawks" -> "chicago-blackhawks"
        # "St. Louis Blues" -> "st-louis-blues"? 
        # "Montréal Canadiens" -> "montreal-canadiens" (remove accent)
        
        team_name = team_data.get('teamName')
        tri_code = team_data.get('triCode')
        
        if not team_name:
            continue
            
        # Basic slugify attempt
        slug = team_name.lower().replace('.', '').replace(' ', '-')
        # Handle special cases? DFO slugs usually standard.
        # "montréal" -> "montreal"
        slug = slug.replace('é', 'e')
        
        url = f"https://www.dailyfaceoff.com/teams/{slug}/line-combinations"
        
        # print(f"Fetching {team_name} ({slug})...")
        
        cmd = [
            'curl', 
            '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
            url
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            html = result.stdout
            
            # Match script tag with id="__NEXT_DATA__" regardless of attribute order or newlines
            match = re.search(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
            if not match:
                print(f"No data for {team_name}")
                continue
                
            data = json.loads(match.group(1))
            players = data.get('props', {}).get('pageProps', {}).get('combinations', {}).get('players', [])
            
            # Organize by line
            # Structure: { 'f1': [p1, p2, p3], 'f2': ... }
            team_lines = {}
            pp_map = {} # playerId -> 1 or 2

            # First pass: Identify PP units
            for p in players:
                gid = p.get('groupIdentifier', '').lower()
                pid = p.get('playerId')
                if gid == 'pp1':
                    pp_map[pid] = 1
                elif gid == 'pp2':
                    pp_map[pid] = 2

            # Second pass: Build lines with PP info
            for p in players:
                # We care about Even Strength (categoryIdentifier='ev' or 'f1'/'d1')
                # Actually groupIdentifier 'f1', 'f2'... 'd1', 'd2'... are what we want.
                gid = p.get('groupIdentifier', '').lower()
                
                # Filter: Only F and D lines (f1-f4, d1-d3)
                if not (gid.startswith('f') or gid.startswith('d')):
                    continue
                
                # Add to line
                if gid not in team_lines:
                    team_lines[gid] = []
                
                pid = p.get('playerId')
                team_lines[gid].append({
                    'name': p.get('name'),
                    'number': p.get('jerseyNumber'),
                    'pos': p.get('positionIdentifier'),
                    'id': pid,
                    'ppUnit': pp_map.get(pid) # None, 1, or 2
                })
            
            # Sort lines? (f1, f2, f3, f4, d1, d2, d3)
            # DFO returns array, players usually in order LW-C-RW? 
            # Let's verify sort order. JSON array order is usually correct.
            # Position ident: 'lw', 'c', 'rw'.
            
            # Sort players in each line by pos logic?
            # Fwd: LW, C, RW. Def: LD, RD.
            pos_order = {'lw': 1, 'c': 2, 'rw': 3, 'ld': 1, 'rd': 2}
            
            for gid, line_players in team_lines.items():
                line_players.sort(key=lambda x: pos_order.get(x['pos'], 99))
            
            lineups[tri_code] = team_lines
            
        except Exception as e:
            print(f"Error fetching {team_name}: {e}")
            
    # Save
    with open('team_lineups.json', 'w') as f:
        json.dump(lineups, f, indent=4)
        
    return lineups

if __name__ == "__main__":
    # fetch_dailyfaceoff_goalies()
    # fetch_player_news()
    
    # Test Lineups
    test_teams = [{'teamName': 'Chicago Blackhawks', 'triCode': 'CHI'}]
    fetch_lineups(test_teams)
