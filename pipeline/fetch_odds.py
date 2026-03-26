import subprocess
import re
import json
import os
import urllib.request
import ssl
from datetime import datetime

def fetch_odds():
    print("Fetching odds from Bovada API...")

    odds_data = {}

    # Load upcoming_games.json to get authoritative dates (Bovada timestamps are unreliable)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    upcoming_path = os.path.join(script_dir, 'upcoming_games.json')
    upcoming_date_lookup = {}  # (away_team, home_team) -> game_date
    try:
        with open(upcoming_path, 'r') as f:
            upcoming_games = json.load(f)
        for game in upcoming_games:
            away = game.get('awayTeam')
            home = game.get('homeTeam')
            date = game.get('gameDate')
            if away and home and date:
                upcoming_date_lookup[(away, home)] = date
        print(f"Loaded {len(upcoming_date_lookup)} upcoming games for date correction.")
    except Exception as e:
        print(f"Warning: Could not load upcoming_games.json for date correction: {e}")

    # Bovada Team Name -> App Common Name Mapping
    TEAM_MAPPING = {
        "Anaheim Ducks": "Ducks",
        "Boston Bruins": "Bruins",
        "Buffalo Sabres": "Sabres",
        "Calgary Flames": "Flames",
        "Carolina Hurricanes": "Hurricanes",
        "Chicago Blackhawks": "Blackhawks",
        "Colorado Avalanche": "Avalanche",
        "Columbus Blue Jackets": "Blue Jackets",
        "Dallas Stars": "Stars",
        "Detroit Red Wings": "Red Wings",
        "Edmonton Oilers": "Oilers",
        "Florida Panthers": "Panthers",
        "Los Angeles Kings": "Kings",
        "Minnesota Wild": "Wild",
        "Montreal Canadiens": "Canadiens",
        "Nashville Predators": "Predators",
        "New Jersey Devils": "Devils",
        "New York Islanders": "Islanders",
        "New York Rangers": "Rangers",
        "Ottawa Senators": "Senators",
        "Philadelphia Flyers": "Flyers",
        "Pittsburgh Penguins": "Penguins",
        "San Jose Sharks": "Sharks",
        "Seattle Kraken": "Kraken",
        "St. Louis Blues": "Blues",
        "Tampa Bay Lightning": "Lightning",
        "Toronto Maple Leafs": "Maple Leafs",
        "Utah Hockey Club": "Mammoth", # App uses 'Mammoth' for Utah
        "Utah Mammoth": "Mammoth",
        "Vancouver Canucks": "Canucks",
        "Vegas Golden Knights": "Golden Knights",
        "Washington Capitals": "Capitals",
        "Winnipeg Jets": "Jets"
    }

    # Manual Fallback / Override for known games if API fails
    MANUAL_ODDS = {
        # Keep empty unless needed for manual overrides
    }
    
    # Fetch from Bovada (Multiple endpoints)
    urls = [
        "https://www.bovada.lv/services/sports/event/v2/events/A/description/hockey/nhl",
        "https://www.bovada.lv/services/sports/event/v2/events/A/description/hockey"
    ]
    
    data = []
    
    for url in urls:
        try:
            cmd = [
                'curl', 
                '-s',
                '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
                url
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            raw_json = result.stdout
            chunk = json.loads(raw_json)
            if isinstance(chunk, list):
                data.extend(chunk)
                print(f"Fetched {len(chunk)} items from {url}")
                
        except Exception as e:
            print(f"Error fetching {url}: {e}")
            
    print(f"Total aggregated items: {len(data)}")
    
    parsed_count = 0
    bovada_matched_count = 0  # track how many Bovada games matched upcoming_games.json

    for item in data:
        events = item.get('events', [])
        print(f"Processing league/group: {item.get('description')} with {len(events)} events.")
        
        for event in events:
            # Get Teams
            # Description usually "Away Team @ Home Team"
            desc = event.get('description', 'Unknown') # e.g. "Chicago Blackhawks @ St. Louis Blues"
            
            # Check if it's a game (Matchup)
            if ' @ ' not in desc:
               # print(f"  Skipping non-game event: {desc}")
               print(f"  Skipping non-game event (no '@' separator): {desc}")
               continue
               
            # Parse Teams
            try:
                away_raw, home_raw = desc.split(' @ ')
            except ValueError:
                print(f"  Could not parse teams from: {desc}")
                continue
            
            # Extract Date
            start_time_ms = event.get('startTime', 0)
            if start_time_ms:
                # Convert milliseconds to datetime (Universal format, usually UTC)
                # Use US/Central to avoid UTC date shifts (e.g. 7pm game becoming next day)
                try:
                    import pytz
                    from datetime import timezone
                    
                    dt_utc = datetime.fromtimestamp(start_time_ms / 1000.0, tz=timezone.utc)
                    central = pytz.timezone('US/Central')
                    dt_central = dt_utc.astimezone(central)
                    date_str = dt_central.strftime('%Y-%m-%d')
                except ImportError:
                    # Fallback if pytz not available (though it should be)
                    # Simple offset: UTC-6
                    from datetime import timezone, timedelta
                    dt_utc = datetime.fromtimestamp(start_time_ms / 1000.0, tz=timezone.utc)
                    dt_central = dt_utc - timedelta(hours=6)
                    date_str = dt_central.strftime('%Y-%m-%d')
            else:
                date_str = datetime.now().strftime('%Y-%m-%d') # Fallback
            
            # Check mapping
            away_team = TEAM_MAPPING.get(away_raw)
            home_team = TEAM_MAPPING.get(home_raw)
            
            if not away_team or not home_team:
                print(f"  Mapping failed for {desc} (Away: {away_team}, Home: {home_team})")
                # Debug which one failed
                if not away_team: print(f"    Unknown Away: '{away_raw}'")
                if not home_team: print(f"    Unknown Home: '{home_raw}'")
                continue
            
            # Override Bovada's date with the authoritative date from upcoming_games.json
            # Bovada timestamps are frequently stale/wrong (e.g. returning old dates)
            correct_date = upcoming_date_lookup.get((away_team, home_team))
            if correct_date:
                date_str = correct_date
                bovada_matched_count += 1
            else:
                print(f"  Warning: {away_team}@{home_team} not found in upcoming_games.json, using Bovada date {date_str}")

            matchup_id = f"{date_str}:{away_team}@{home_team}"
            print(f"Found matchup: {matchup_id}")
            
            # Helper: parse american odds string to int
            def parse_american(s):
                if not s: return None
                if s == 'EVEN': return 100
                try: return int(s)
                except ValueError: return None

            # Helper: identify which team an outcome belongs to
            def identify_team(out_desc):
                if not out_desc: return None
                # Direct match with raw event names
                if out_desc == away_raw or out_desc.startswith(away_raw): return away_team
                if out_desc == home_raw or out_desc.startswith(home_raw): return home_team
                # Mapped match (handles Utah HC vs Utah Mammoth etc.)
                mapped = TEAM_MAPPING.get(out_desc)
                if mapped == away_team: return away_team
                if mapped == home_team: return home_team
                # Period-suffixed names like "Chicago Blackhawks - 1P"
                base = out_desc.split(' - ')[0].strip()
                if base == away_raw: return away_team
                if base == home_raw: return home_team
                mapped_base = TEAM_MAPPING.get(base)
                if mapped_base == away_team: return away_team
                if mapped_base == home_team: return home_team
                return None

            if matchup_id not in odds_data:
                odds_data[matchup_id] = {}

            # Collect all displayGroups we care about
            game_lines = None
            game_props = None
            for group in event.get('displayGroups', []):
                gdesc = group.get('description', '')
                if gdesc == 'Game Lines': game_lines = group
                elif gdesc == 'Game Props': game_props = group

            if not game_lines:
                continue

            # Parse markets from Game Lines
            for market in game_lines.get('markets', []):
                mdesc = market.get('description', '')
                outcomes = market.get('outcomes', [])

                # --- Moneyline (full game) ---
                if mdesc == 'Moneyline' and not any(o.get('description', '').endswith('P') for o in outcomes):
                    for o in outcomes:
                        team = identify_team(o.get('description'))
                        val = parse_american(o.get('price', {}).get('american'))
                        if team and val is not None:
                            odds_data[matchup_id][team] = val
                            print(f"  ML {team}: {val}")

                # --- Puck Line (full game, ±1.5) ---
                elif mdesc == 'Puck Line' and not any('P' in (o.get('description') or '')[-3:] for o in outcomes):
                    for o in outcomes:
                        team = identify_team(o.get('description'))
                        val = parse_american(o.get('price', {}).get('american'))
                        handicap = o.get('price', {}).get('handicap')
                        if team and val is not None:
                            odds_data[matchup_id][f'{team}_puckline'] = val
                            if handicap:
                                odds_data[matchup_id][f'{team}_puckline_spread'] = handicap

                # --- Total (full game O/U) ---
                elif mdesc == 'Total' and not any('P' in (o.get('description') or '')[-3:] for o in outcomes):
                    for o in outcomes:
                        desc = o.get('description', '')
                        val = parse_american(o.get('price', {}).get('american'))
                        handicap = o.get('price', {}).get('handicap')
                        if val is not None:
                            if desc.startswith('Over'):
                                odds_data[matchup_id]['total_over'] = val
                            elif desc.startswith('Under'):
                                odds_data[matchup_id]['total_under'] = val
                            if handicap:
                                odds_data[matchup_id]['total_line'] = handicap

                # --- 1st Period Moneyline ---
                elif mdesc == 'Moneyline' and any('1P' in (o.get('description') or '') for o in outcomes):
                    for o in outcomes:
                        team = identify_team(o.get('description'))
                        val = parse_american(o.get('price', {}).get('american'))
                        if team and val is not None:
                            odds_data[matchup_id][f'{team}_1p_ml'] = val

            # Parse 3-Way Moneyline from Game Props
            if game_props:
                for market in game_props.get('markets', []):
                    mdesc = market.get('description', '')
                    outcomes = market.get('outcomes', [])
                    # Full-game 3-way only (not period 3-ways)
                    if mdesc == '3-Way Moneyline' and not any('P' in (o.get('description') or '')[-3:] for o in outcomes):
                        for o in outcomes:
                            desc = o.get('description', '')
                            val = parse_american(o.get('price', {}).get('american'))
                            if val is None: continue
                            if 'Tie' in desc or 'Draw' in desc:
                                odds_data[matchup_id]['three_way_tie'] = val
                            else:
                                team = identify_team(desc)
                                if team:
                                    odds_data[matchup_id][f'{team}_three_way'] = val
                        break  # only need first 3-way market

            parsed_count += 1

    print(f"Parsed {parsed_count} games from Bovada.")
    print(f"Bovada matched {bovada_matched_count} of {len(upcoming_date_lookup)} upcoming games.")

    # Use ESPN/DraftKings as fallback when:
    # - Bovada returned nothing (0 odds), OR
    # - Bovada returned games but none matched upcoming_games.json (stale data from IP blocking)
    needs_espn = len(odds_data) == 0 or (bovada_matched_count == 0 and len(upcoming_date_lookup) > 0)
    if needs_espn:
        reason = "0 odds from Bovada" if len(odds_data) == 0 else "Bovada data is stale (no upcoming games matched)"
        print(f"ESPN fallback triggered: {reason}")
        try:
            # Fetch for every unique date in upcoming_games.json so we catch multi-day slates
            espn_dates = sorted(set(g.get('gameDate', '').replace('-', '') for g in upcoming_games if g.get('gameDate')))
            if not espn_dates:
                from datetime import date
                espn_dates = [date.today().strftime('%Y%m%d')]

            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

            for espn_date in espn_dates:
                espn_url = f"https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates={espn_date}"
                try:
                    req = urllib.request.Request(espn_url, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, context=ctx) as response:
                        espn_data = json.loads(response.read().decode())
                except Exception as e:
                    print(f"Error fetching ESPN for {espn_date}: {e}")
                    continue

                for event in espn_data.get('events', []):
                    try:
                        competitions = event.get('competitions', [])
                        if not competitions: continue
                        comp = competitions[0]

                        competitors = comp.get('competitors', [])
                        if len(competitors) < 2: continue

                        home_raw = next((c.get('team', {}).get('name', '') for c in competitors if c.get('homeAway') == 'home'), '')
                        away_raw = next((c.get('team', {}).get('name', '') for c in competitors if c.get('homeAway') == 'away'), '')

                        home_team = TEAM_MAPPING.get(home_raw, home_raw)
                        away_team = TEAM_MAPPING.get(away_raw, away_raw)
                        if "Hockey Club" in home_team: home_team = "Mammoth"
                        if "Hockey Club" in away_team: away_team = "Mammoth"

                        # Use authoritative date from upcoming_games.json
                        date_str = upcoming_date_lookup.get((away_team, home_team), espn_date[:4] + '-' + espn_date[4:6] + '-' + espn_date[6:])

                        matchup_id = f"{date_str}:{away_team}@{home_team}"

                        odds_list = comp.get('odds', [])
                        if odds_list:
                            ml = odds_list[0].get('moneyline', {})
                            h_odds_str = ml.get('home', {}).get('close', {}).get('odds', ml.get('home', {}).get('open', {}).get('odds'))
                            a_odds_str = ml.get('away', {}).get('close', {}).get('odds', ml.get('away', {}).get('open', {}).get('odds'))

                            if h_odds_str and a_odds_str:
                                h_odds = 100 if h_odds_str == 'EVEN' else int(h_odds_str)
                                a_odds = 100 if a_odds_str == 'EVEN' else int(a_odds_str)

                                if matchup_id not in odds_data:
                                    odds_data[matchup_id] = {}
                                odds_data[matchup_id][home_team] = h_odds
                                odds_data[matchup_id][away_team] = a_odds
                                print(f"  [ESPN] Added odds for {matchup_id}: {home_team} {h_odds}, {away_team} {a_odds}")

                    except Exception as e:
                        print(f"Error parsing ESPN event: {e}")

        except Exception as e:
            print(f"Error in ESPN fallback: {e}")

        print(f"Found odds for {len(odds_data)} matchups after ESPN fallback.")
    
    # Merge Manual Odds (Override)
    for team, odds in MANUAL_ODDS.items():
        # Manual odds remain team-based for legacy/simplicity, 
        # but in practice we should probably phase this out or update it.
        # For now, let's keep it as is or ignore it in the context of the new structure.
        pass
    
    output_path = os.path.join(script_dir, 'odds.json')
    
    with open(output_path, 'w') as f:
        json.dump(odds_data, f, indent=4)
        
    return odds_data

if __name__ == "__main__":
    fetch_odds()
