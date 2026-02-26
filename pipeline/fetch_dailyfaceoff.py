import json
import subprocess
import re
import datetime
import os

def fetch_dailyfaceoff_goalies():
    print("Fetching Daily Faceoff data (Today + Tomorrow)...")
    
    goalie_info = {}
    
    # Dates to fetch: Today and Tomorrow
    # Use Central Time to align with App logic, or just standard local date
    # DFO likely uses Eastern or Local. Let's send YYYY-MM-DD.
    dates_to_fetch = []
    today = datetime.date.today()
    dates_to_fetch.append(today.strftime("%Y-%m-%d"))
    dates_to_fetch.append((today + datetime.timedelta(days=1)).strftime("%Y-%m-%d"))
    
    for date_str in dates_to_fetch:
        # URL logic: /starting-goalies/YYYY-MM-DD
        url = f"https://www.dailyfaceoff.com/starting-goalies/{date_str}"
        
        cmd = [
            'curl', 
            '-s',
            '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
            url
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            html = result.stdout
            
            # Extract the __NEXT_DATA__ JSON blob
            match = re.search(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
            if not match:
                print(f"Could not find __NEXT_DATA__ in HTML for {date_str}.")
                continue
                
            data = json.loads(match.group(1))
            games = data.get('props', {}).get('pageProps', {}).get('data', [])
            
            print(f"Found {len(games)} games for {date_str} in DFO data.")
            
            for game in games:
                date = game.get('date') # YYYY-MM-DD from DFO
                if not date: date = date_str # Fallback
                
                home_team = game.get('homeTeamName')
                away_team = game.get('awayTeamName')
                
                # Extract Goalies
                home_goalie = game.get('homeGoalieName')
                if not home_goalie and 'homeGoalie' in game and game['homeGoalie']:
                    home_goalie = game['homeGoalie'].get('name')
                    
                away_goalie = game.get('awayGoalieName')
                if not away_goalie and 'awayGoalie' in game and game['awayGoalie']:
                    away_goalie = game['awayGoalie'].get('name')
                    
                # Status
                home_status = game.get('homeNewsStrengthName')
                if not home_status and home_goalie: home_status = "Unconfirmed"
                
                away_status = game.get('awayNewsStrengthName')
                if not away_status and away_goalie: away_status = "Unconfirmed"
                
                # Store keyed by "TeamName_Date" to allow easy JSON serialization AND uniqueness
                # We can't use tuple keys in JSON dump.
                # So we will use a string key: f"{TeamName}_{Date}"
                
                if home_team:
                    key = f"{home_team}_{date}"
                    goalie_info[key] = {
                        'goalie': home_goalie,
                        'status': home_status,
                        'date': date,
                        'team': home_team
                    }
                    
                if away_team:
                    key = f"{away_team}_{date}"
                    goalie_info[key] = {
                        'goalie': away_goalie,
                        'status': away_status,
                        'date': date,
                        'team': away_team
                    }
                    
        except Exception as e:
            print(f"Error fetching DFO for {date_str}: {e}")

    with open('dailyfaceoff_goalies.json', 'w') as f:
        json.dump(goalie_info, f, indent=4)
        
    return goalie_info


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
                
            # 2. Category Check (Exclude Goalie Start - REMOVED, now allowing)
            category = item.get('newsCategoryName', 'Unknown')
            # if 'goalie' in category.lower() and 'start' in category.lower():
            #     continue
                
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
                'date': news_date,
                'timestamp': item.get('createdAt')
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
    
    # Load OLD lineups to compare
    old_lineups = {}
    if os.path.exists('team_lineups.json'):
        try:
            with open('team_lineups.json', 'r') as f:
                old_lineups = json.load(f)
        except:
            pass

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
                
                # Filter: F lines (f1-f4), D lines (d1-d3), and IR/injured list
                if not (gid.startswith('f') or gid.startswith('d') or gid == 'ir'):
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
            
            # --- CALCULATE MOVEMENT ---
            # Compare 'team_lines' (New) vs 'old_lineups.get(triCode)' (Old)
            old_team_lines = old_lineups.get(tri_code, {})
            
            # Create a map of PlayerID -> LineRank for OLD data
            # Ranks: F1=1, F2=2, F3=3, F4=4, D1=1, D2=2, D3=3
            old_ranks = {}
            for gid_old, players_old in old_team_lines.items():
                # Extract rank from gid (f1->1, d1->1)
                rank = 99
                if len(gid_old) > 1 and gid_old[1].isdigit():
                    rank = int(gid_old[1])
                
                for p in players_old:
                    pid = p.get('id')
                    if pid:
                        old_ranks[pid] = rank
            
            # Assign movement to NEW players
            for gid_new, players_new in team_lines.items():
                new_rank = 99
                if len(gid_new) > 1 and gid_new[1].isdigit():
                    new_rank = int(gid_new[1])
                
                for p in players_new:
                    pid = p.get('id')
                    if pid:
                        # Default: null
                        p['movement'] = None
                        
                        if pid not in old_ranks:
                            p['movement'] = 'new'
                        else:
                            old_rank = old_ranks[pid]
                            if new_rank < old_rank:
                                # 1 < 2 -> Moved UP line
                                p['movement'] = 'up'
                            elif new_rank > old_rank:
                                # 2 > 1 -> Moved DOWN line
                                p['movement'] = 'down'
                            # else: same line
            
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
