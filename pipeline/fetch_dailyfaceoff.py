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
        
        # Load existing accumulated news
        pipeline_dir = os.path.dirname(os.path.abspath(__file__))
        local_path = os.path.join(pipeline_dir, 'player_news.json')
        public_path = os.path.join(pipeline_dir, '..', 'public', 'data', 'player_news.json')
        accumulated = {}
        try:
            if os.path.exists(local_path):
                with open(local_path, 'r') as f:
                    accumulated = json.load(f)
        except Exception:
            accumulated = {}

        today_str = datetime.date.today().strftime("%Y-%m-%d")
        print(f"Accumulating news (today: {today_str})")

        for item in news_items:
            # 1. Category Check
            category = item.get('newsCategoryName', 'Unknown')

            # 2. Helpers
            player_name = item.get('playerName', 'Unknown')
            details = item.get('details', '')
            if not details:
                continue

            tri_code = item.get('teamAbbreviation')
            if not tri_code:
                continue

            news_date = item.get('date', today_str)
            timestamp = item.get('createdAt')

            # Dedup key
            dedup_key = f"{player_name}-{timestamp or news_date}"

            if tri_code not in accumulated:
                accumulated[tri_code] = []

            # Check for duplicate
            existing_keys = {f"{n['player']}-{n.get('timestamp') or n.get('date', '')}" for n in accumulated[tri_code]}
            if dedup_key not in existing_keys:
                accumulated[tri_code].append({
                    'player': player_name,
                    'news': details,
                    'category': category,
                    'date': news_date,
                    'timestamp': timestamp,
                })

        # Sort each team's news by timestamp desc
        for tri in accumulated:
            accumulated[tri].sort(key=lambda x: x.get('timestamp') or x.get('date', ''), reverse=True)

        # Prune: keep only last 30 days of news per team
        cutoff = (datetime.date.today() - datetime.timedelta(days=30)).strftime("%Y-%m-%d")
        for tri in accumulated:
            accumulated[tri] = [n for n in accumulated[tri] if (n.get('date') or '') >= cutoff]

        print(f"Accumulated news for {len(accumulated)} teams.")

        with open(local_path, 'w') as f:
            json.dump(accumulated, f, indent=4)
        with open(public_path, 'w') as f:
            json.dump(accumulated, f, indent=4)

        return accumulated
        
    except Exception as e:
        print(f"Error fetching player news: {e}")
        return {}


def fetch_playoff_player_news():
    print("Fetching Daily Faceoff Playoff Player News (accumulating)...")

    pipeline_dir = os.path.dirname(os.path.abspath(__file__))
    local_path = os.path.join(pipeline_dir, 'playoff_player_news.json')
    public_path = os.path.join(pipeline_dir, '..', 'public', 'data', 'playoff_player_news.json')

    # Load existing accumulated data
    accumulated = {}
    if os.path.exists(local_path):
        try:
            with open(local_path, 'r') as f:
                accumulated = json.load(f)
        except Exception:
            accumulated = {}

    # Build dedup set from existing items
    existing_sigs = set()
    for items in accumulated.values():
        for item in items:
            sig = f"{item.get('player','')}-{item.get('timestamp', item.get('date',''))}"
            existing_sigs.add(sig)

    # Use curl to mimic a browser
    cmd = [
        'curl',
        '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
        'https://www.dailyfaceoff.com/hockey-player-news'
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        html = result.stdout

        match = re.search(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
        if not match:
            print("Could not find __NEXT_DATA__ in HTML.")
            return accumulated

        data = json.loads(match.group(1))
        news_items = data.get('props', {}).get('pageProps', {}).get('data', {}).get('data', [])
        print(f"Found {len(news_items)} news items.")

        new_count = 0
        for item in news_items:
            # No date filter — keep all items
            category = item.get('newsCategoryName', 'Unknown')
            player_name = item.get('playerName', 'Unknown')
            details = item.get('details', '')
            if not details:
                continue
            tri_code = item.get('teamAbbreviation')
            if not tri_code:
                continue

            news_date = item.get('date', '')
            timestamp = item.get('createdAt')

            sig = f"{player_name}-{timestamp or news_date}"
            if sig in existing_sigs:
                continue

            existing_sigs.add(sig)
            if tri_code not in accumulated:
                accumulated[tri_code] = []
            accumulated[tri_code].append({
                'player': player_name,
                'news': details,
                'category': category,
                'date': news_date,
                'timestamp': timestamp,
            })
            new_count += 1

        # Sort each team's list by timestamp desc
        for tri_code in accumulated:
            accumulated[tri_code].sort(
                key=lambda x: x.get('timestamp') or x.get('date') or '',
                reverse=True
            )

        print(f"Added {new_count} new items. Total teams with news: {len(accumulated)}.")

        with open(local_path, 'w') as f:
            json.dump(accumulated, f, indent=4)

        # Copy to public/data/
        public_dir = os.path.dirname(public_path)
        if os.path.exists(public_dir):
            with open(public_path, 'w') as f:
                json.dump(accumulated, f, indent=4)
            print(f"Copied playoff_player_news.json to public/data/")

        return accumulated

    except Exception as e:
        print(f"Error fetching playoff player news: {e}")
        return accumulated


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
