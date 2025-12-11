import fetch_dailyfaceoff
import fetch_goalie_history # New Module
import json
import math
import csv
import pandas as pd
import datetime
from scipy.stats import poisson
from datetime import datetime, timezone
import pytz
import urllib.request
import ssl
from calculate_gas import GasCalculator

# ... (imports)

def convert_to_central(utc_str):
    if not utc_str:
        return ""
    try:
        dt = datetime.strptime(utc_str, "%Y-%m-%dT%H:%M:%SZ")
        dt = dt.replace(tzinfo=timezone.utc)
        central = pytz.timezone('US/Central')
        dt_central = dt.astimezone(central)
        return dt_central.strftime("%I:%M %p")
    except Exception as e:
        return utc_str

def load_existing_predictions(filepath):
    """Loads existing CSV into a dict keyed by game_id."""
    existing = {}
    try:
        with open(filepath, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if 'game_id' in row:
                    existing[row['game_id']] = row
    except FileNotFoundError:
        pass
    return existing

# ... (inside predict function)

    # Load Existing Predictions (for freezing live/past games)
    existing_predictions = load_existing_predictions('predictions_detailed.csv')
    
    csv_rows = []
    
    print(f"Predicting {len(schedule)} games...")
    
    # ... (fetching lineups logic - keep as is) ...

    # OUTPUT HEADER
    print("\n--- Predictions & EV Analysis ---")
    print(f"{'Date':<11} {'Home':<15} {'Away':<15} {'H Win%':<8} {'A Win%':<8} {'H EV':<10} {'A EV':<10} {'Wager'}")
    print("-" * 100)

    for game in schedule:
        home_team = game['homeTeam']
        away_team = game['awayTeam']
        
        # Construct Game ID immediately to check existence
        # Check start time against UTC now
        game_date = game.get('gameDate')
        if not game_date:
            game_date = game.get('startTimeUTC', '')[:10]
        
        game_id = f"{game_date}-{away_team}-{home_team}"
        
        # Check Freeze Condition
        is_frozen = False
        start_time_utc = game.get('startTimeUTC') # 2025-12-06T17:30:00Z
        if start_time_utc:
            try:
                # Parse to aware UTC datetime
                st = datetime.strptime(start_time_utc, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                now = datetime.now(timezone.utc)
                
                # If current time is PAST start time, AND we have existing data
                if now > st and game_id in existing_predictions:
                    is_frozen = True
            except Exception as e:
                print(f"Error parsing date for freeze check: {e}")

        if is_frozen:
            # USE CACHED DATA
            row = existing_predictions[game_id]
            csv_rows.append(row)
            
            # Print Frozen Summary
            # We need to extract values from the row strings
            # Row keys: home_win_pct, home_ev, wager_recommendation, etc.
            h_wp = row.get('home_win_pct', '0') + '%'
            a_wp = row.get('away_win_pct', '0') + '%'
            h_ev = row.get('home_ev', '') 
            if h_ev: h_ev += '%'
            a_ev = row.get('away_ev', '')
            if a_ev: a_ev += '%'
            
            print(f"{row['game_date']:<11} {row['home_team']:<15} {row['away_team']:<15} {h_wp:<8}   {a_wp:<8}   {h_ev:<10} {a_ev:<10} {row['wager_recommendation']} [FROZEN]")
            continue
            
        # --- IF NOT FROZEN, PROCEED WITH CALCULATION ---

        if home_team not in team_ratings or away_team not in team_ratings:
            continue
            
        # ... (Rest of calculation logic) ...
        
        # ... (At end of loop, formatting the NEW row) ...
        # csv_rows.append({ ... }) <-- We need to move the row construction into the loop or append to predictions list and process later?
        # Actually, since I split the flow, I need to ensure the calculation logic builds the row and appends to `csv_rows`.
        
        # ... (I will need to refactor the loop body slightly to append to csv_rows immediately instead of intermediate predictions list) ...


    if not utc_str:
        return ""
    try:
        # Parse UTC string (2025-12-06T17:30:00Z)
        utc_dt = datetime.strptime(utc_str, "%Y-%m-%dT%H:%M:%SZ")
        utc_dt = utc_dt.replace(tzinfo=pytz.utc)
        
        # Convert to Central
        central_tz = pytz.timezone('US/Central')
        central_dt = utc_dt.astimezone(central_tz)
        
        # Format: 7:00 PM
        # Remove leading zero from hour if possible (platform specific), but %I is standardized 01-12
        time_str = central_dt.strftime("%I:%M %p")
        if time_str.startswith("0"):
            time_str = time_str[1:]
        return time_str
    except Exception as e:
        print(f"Error parsing time {utc_str}: {e}")
        return ""

def load_goalie_stats_json():
    """
    Loads official goalie stats from JSON.
    Returns: Dict { "Goalie Name": "(W-L-O) | .SV% | GAA" }
    Normalization: Keys are stored in lowercase for easier matching.
    """
    try:
        with open('nhl_goalie_stats.json', 'r') as f:
            data = json.load(f)
            # Normalize keys to lowercase
            return {k.lower().strip(): v for k, v in data.items()}
    except Exception as e:
        print(f"Error loading goalie stats JSON: {e}")
        return {}

def load_json(filepath):
    with open(filepath, 'r') as f:
        return json.load(f)

def get_best_goalie(team_name, goalie_ratings, confirmed_goalie=None):
    # If we have a confirmed goalie, ALWAYS use them
    if confirmed_goalie:
        return confirmed_goalie
            
    # Fallback to finding the starter with most games
    df = pd.read_csv('nhl_season_2025_2026_gamestats.csv')
    team_goalies = df[df['team'] == team_name]['starting_goalie'].unique()
    
    best_goalie = None
    max_games = -1
    
    for goalie in team_goalies:
        if pd.isna(goalie): continue
        if goalie in goalie_ratings:
            games = goalie_ratings[goalie]['games_played']
            if games > max_games:
                max_games = games
                best_goalie = goalie
                
    return best_goalie if best_goalie else "Unknown"

def prob_to_odds(prob):
    if prob <= 0 or prob >= 1:
        return "N/A"
    
    if prob == 0.5:
        return "+100"
        
    if prob > 0.5:
        # Favorite: - (P / (1-P)) * 100
        odds = - (prob / (1 - prob)) * 100
    else:
        # Underdog: + ((1-P) / P) * 100
        odds = ((1 - prob) / prob) * 100
        
    if odds > 0:
        return f"+{int(round(odds))}"
    else:
        return f"{int(round(odds))}"

def american_to_decimal(american):
    if american > 0:
        return (american / 100) + 1
    else:
        return (100 / abs(american)) + 1

def implied_prob(american_odds):
    if american_odds == "N/A" or american_odds is None:
        return 0.0
    decimal = american_to_decimal(american_odds)
    return 1 / decimal

def calculate_ev(prob, american_odds):
    if american_odds == "N/A" or american_odds is None:
        return -1 # No EV if no odds
    
    decimal = american_to_decimal(american_odds)
    # Prob is 0.0-1.0
    ev = (prob * decimal) - 1
    return ev

def load_tricodes():
    tricodes = {}
    try:
        df = pd.read_csv('nhl_teams.csv')
        # Map Common Name to Tricode
        for _, row in df.iterrows():
            tricodes[row['Common Name']] = row['Team Tricode']
    except Exception as e:
        print(f"Error loading tricodes: {e}")
    return tricodes

def load_full_names():
    names = {}
    try:
        df = pd.read_csv('nhl_teams.csv')
        # Map Tricode to Full Name
        for _, row in df.iterrows():
            if pd.notna(row['Team Tricode']):
                names[row['Team Tricode']] = row['Team Name']
    except Exception as e:
        print(f"Error loading full names: {e}")
    return names

def load_common_names():
    names = {}
    try:
        df = pd.read_csv('nhl_teams.csv')
        # Map Tricode to Common Name
        for _, row in df.iterrows():
            if pd.notna(row['Team Tricode']):
                names[row['Team Tricode']] = row['Common Name']
    except Exception as e:
        print(f"Error loading common names: {e}")
    return names

def get_goalie_percentiles(goalie_ratings):
    """Calculates percentile rank (0-100) for each goalie based on GSAx/Game."""
    valid_goalies = [(name, data.get('gsax_per_game', 0)) for name, data in goalie_ratings.items()]
    # Sort ascending (lowest GSAx to highest)
    valid_goalies.sort(key=lambda x: x[1])
    
    percentiles = {}
    n = len(valid_goalies)
    for i, (name, val) in enumerate(valid_goalies):
        # 0th index = 0 percentile (worst)
        # N-1 index = 100 percentile (best)
        pct = (i / (n - 1)) * 100 if n > 1 else 50
        percentiles[name] = pct
        
    return percentiles

def fetch_l7_record(tri_code, starter_lookup=None, common_names=None):
    if not tri_code:
        return "N/A", []
        
    url = f"https://api-web.nhle.com/v1/club-schedule-season/{tri_code}/20252026"
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, context=ctx) as response:
            data = json.loads(response.read().decode())
    except Exception as e:
        print(f"Error fetching L7 for {tri_code}: {e}")
        return "N/A", []
        
    games = data.get('games', [])
    today_str = datetime.now().strftime("%Y-%m-%d")
    
    # Filter for completed regular season games
    regular_season_games = [
        g for g in games 
        if g['gameType'] == 2 and g['gameDate'] < today_str and g.get('gameState') in ['OFF', 'FINAL']
    ]
    
    # Sort by date descending (Newest first)
    regular_season_games.sort(key=lambda x: x['gameDate'], reverse=True)
    
    # specific L7 slice
    l7 = regular_season_games[:7]
    
    wins = 0
    losses = 0
    otl = 0
    
    detailed_games = []
    
    my_common = common_names.get(tri_code) if common_names else None
    
    for g in l7:
        # Determine opponent
        if g.get('homeTeam', {}).get('abbrev') == tri_code:
            is_home = True
            my_score = g.get('homeTeam', {}).get('score', 0)
            opp_score = g.get('awayTeam', {}).get('score', 0)
            opp_abbrev = g.get('awayTeam', {}).get('abbrev')
        else:
            is_home = False
            my_score = g.get('awayTeam', {}).get('score', 0)
            opp_score = g.get('homeTeam', {}).get('score', 0)
            opp_abbrev = g.get('homeTeam', {}).get('abbrev')
        
        # Date Styling "12/6"
        d = datetime.strptime(g['gameDate'], "%Y-%m-%d")
        date_short = f"{d.month}/{d.day}"

        # Result Logic
        result_code = "L"
        period = g.get('gameOutcome', {}).get('lastPeriodType', 'REG')
        
        if my_score > opp_score:
            if period == 'OT':
                wins += 1 # Count as win
                result_code = "W-OT"
            elif period == 'SO':
                wins += 1 # Count as win
                result_code = "W-SO"
            else:
                wins += 1
                result_code = "W"
        else:
            # Loss
            if period in ['OT', 'SO']:
                otl += 1
                result_code = "O" # OT Loss
            else:
                losses += 1
                result_code = "L"
        
        # Game Number
        # Assuming 'regular_season_games' is chronological list of season games.
        # Match by ID to be safe
        game_id = g.get('id')
        game_number = "GP"
        for idx, season_game in enumerate(regular_season_games):
            if season_game.get('id') == game_id:
                game_number = f"G{idx + 1}"
                break
        
        # Fetch Starter if lookup available
        starter_name = ""
        if starter_lookup and my_common:
            # Key: (YYYY-MM-DD, TeamCommonName)
            starter_name = starter_lookup.get((g['gameDate'], my_common), "")

        detailed_games.append({
            'date': date_short,
            'gameNumber': game_number,
            'opponent': opp_abbrev,
            'isHome': is_home,
            'score': f"{my_score}-{opp_score}",
            'result': result_code,
            'starter': starter_name
        })
                
    record_str = f"{wins}-{losses}-{otl}"
    return record_str, detailed_games
    
def get_wager_recommendation(ev, win_prob, vegas_odds):
    """
    Calculates wager size using Quarter Kelly Criterion.
    1 Unit = 1% of Bankroll.
    Max Bet = 5 Units.
    """
    if ev <= 0:
        return "No Bet"
    
    # Calculate 'b' (Net Decimal Odds - 1)
    # American Odds to Decimal:
    # Positive: (Odds / 100)
    # Negative: (100 / abs(Odds))
    
    try:
        if vegas_odds > 0:
            b = vegas_odds / 100
        else:
            b = 100 / abs(vegas_odds)
    except:
        return "No Bet" # No odds available
        
    p = win_prob
    q = 1 - p
    
    # Kelly Fraction f* = (bp - q) / b
    kelly_fraction = ((b * p) - q) / b
    
    if kelly_fraction <= 0:
        return "No Bet"
        
    # Adjusted Kelly (1/16th approx) to match risk tolerance
    # Target: 13% EV -> ~1 Unit. 30% EV -> ~2 Units.
    adjusted_kelly = kelly_fraction * 0.06
    
    # Convert to Units (1 Unit = 1% Bankroll)
    # e.g. 0.01 (1%) -> 1 Unit
    units = adjusted_kelly * 100
    
    # Max Cap is 5 Units
    units = min(units, 5.0)
    
    # Round to nearest 0.1
    units = round(units, 1)
    
    if units < 0.1:
        return "No Bet"
        
    # Format string (e.g. "1.5 Units", "1.0 Unit")
    unit_str = "Unit" if units == 1.0 else "Units"
    return f"{units} {unit_str}"

def fetch_team_rankings():
    """
    Fetches team stats from NHL API to get PP and PK rankings.
    Returns a dictionary: { "TeamName": { "pp_rank": int, "pk_rank": int } }
    """
    print("Fetching special teams rankings...")
    try:
        url = "https://api.nhle.com/stats/rest/en/team/summary?isAggregate=false&isGame=false&sort=%5B%7B%22property%22:%22points%22,%22direction%22:%22DESC%22%7D,%7B%22property%22:%22wins%22,%22direction%22:%22DESC%22%7D,%7B%22property%22:%22teamId%22,%22direction%22:%22ASC%22%7D%5D&start=0&limit=50&factCayenneExp=gamesPlayed%3E=1&cayenneExp=gameTypeId=2%20and%20seasonId%3C=20252026%20and%20seasonId%3E=20252026"
        
        # Note: seasonId is hardcoded to 20252026 as per assumed context. 
        # Ideally we fetch dynamically, but this matches our other scripts.
        
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        import ssl
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        
        with urllib.request.urlopen(req, context=ctx) as response:
            data = json.load(response)
            
        teams_data = data.get('data', [])
        
        # We need to rank them. The API returns a list, but sorted by points.
        # We need to sort by ppPct and pkPct manually to determine rank.
        
        # 1. Extract needed stats
        # Team names in API might differ slightly (full names).
        stats = []
        for t in teams_data:
            stats.append({
                'name': t['teamFullName'],
                'pp': t['powerPlayPct'],
                'pk': t['penaltyKillPct']
            })
            
        # 2. Sort for PP (High is Better)
        stats.sort(key=lambda x: x['pp'], reverse=True)
        pp_ranks = {x['name']: i+1 for i, x in enumerate(stats)}
        
        # 3. Sort for PK (High is Better)
        stats.sort(key=lambda x: x['pk'], reverse=True)
        pk_ranks = {x['name']: i+1 for i, x in enumerate(stats)}
        
        # 4. Merge into result dict using COMMON names to match our app
        # We need a mapper because 'predict_games' uses 'Rangers', API uses 'New York Rangers'
        
        # Simple suffix matching usually works: "New York Rangers" -> "Rangers" matches?
        # A manual mapper is safer.
        common_map = {}
        # We can try to reverse map from our keys if we had them.
        # But wait, our 'teams' list in upcoming_games.json has 'commonName'.
        # Let's try heuristic matching.
        
        results = {}
        for fullname in pp_ranks.keys():
            # Heuristic: The last word is usually the common name. 
            # Exceptions: "Maple Leafs", "Blue Jackets", "Golden Knights", "Red Wings"
            common = fullname.split()[-1]
            if "Leafs" in fullname: common = "Maple Leafs"
            if "Jackets" in fullname: common = "Blue Jackets"
            if "Knights" in fullname: common = "Golden Knights"
            if "Wings" in fullname: common = "Red Wings"
            if "Kings" in fullname: common = "Kings" # Los Angeles Kings -> Kings
            
            # Utah is tricky. "Utah Hockey Club" -> "Mammoth"? Or "Utah"?
            # Our app uses "Mammoth" (Wait, really? Let's check upcoming_games.json). 
            # Step 1303 output said "Flames Mammoth". So our app uses "Mammoth".
            # NHL API likely uses "Utah Hockey Club".
            if "Utah" in fullname: common = "Mammoth"
            
            results[common] = {
                'pp_rank': pp_ranks[fullname],
                'pk_rank': pk_ranks[fullname],
                'pp_pct': next((x['pp'] for x in stats if x['name'] == fullname), 0),
                'pk_pct': next((x['pk'] for x in stats if x['name'] == fullname), 0)
            }
            
        return results

    except Exception as e:
        print(f"Error fetching detail stats: {e}")
        return {}

def simulate_game(home_final, away_final):
    prob_home_win = 0
    prob_away_win = 0
    prob_draw = 0
    
    for h in range(15):
        for a in range(15):
            p = poisson.pmf(h, home_final) * poisson.pmf(a, away_final)
            if h > a:
                prob_home_win += p
            elif a > h:
                prob_away_win += p
            else:
                prob_draw += p
    return prob_home_win, prob_away_win, prob_draw

def load_existing_predictions(filepath):
    """Loads existing CSV into a dict keyed by game_id."""
    existing = {}
    try:
        with open(filepath, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if 'game_id' in row:
                    existing[row['game_id']] = row
    except FileNotFoundError:
        pass
    return existing

def predict():
    print("Loading data...")
    team_ratings = load_json('team_ratings.json')
    goalie_ratings = load_json('goalie_ratings.json')
    goalie_percentiles = get_goalie_percentiles(goalie_ratings)
    schedule = load_json('upcoming_games.json')
    
    # Load Odds
    try:
        odds_data = load_json('odds.json')
    except:
        print("Warning: odds.json not found. No EV calculation.")
        odds_data = {}
        
    # Load Special Teams Rankings
    st_rankings = fetch_team_rankings()
    
    # Load Tricodes and Common Names
    tricodes = load_tricodes()
    full_names = load_full_names()
    common_names = load_common_names()
    l7_cache = {}
    l7_details_cache = {}

    # Load game stats for GasCalculator and Starter Lookup
    print("Loading game stats for GasCalculator and Starter Lookup...")
    game_stats_df = pd.read_csv('nhl_season_2025_2026_gamestats.csv')
    
    # Build Starter Lookup: (DateStr, TeamCommonName) -> StarterName
    starter_lookup = {}
    for _, row in game_stats_df.iterrows():
        try:
             # row['game_date'] is YYYY-MM-DD
             # row['team'] is Common Name (e.g. "Rangers")
             # row['starting_goalie'] is Name
             if pd.notna(row['starting_goalie']):
                 starter_lookup[(row['game_date'], row['team'])] = row['starting_goalie']
        except Exception as e:
            pass

    game_stats_df['game_date'] = pd.to_datetime(game_stats_df['game_date'])
    # Initialize Gas Calculator
    gas_calc = GasCalculator(game_stats_df)
    
    # League Average xG
    league_xg = 3.13 
    
    # Load Existing Predictions (for freezing live/past games)
    existing_predictions = load_existing_predictions('predictions_detailed.csv')
    
    # Load Goalie Stats
    print("Loading official goalie stats...")
    goalie_stats_map = load_goalie_stats_json()
    
    print(f"Predicting {len(schedule)} games...")

    # Fetch Lineups for all teams in schedule
    print("Fetching Lineups...")
    teams_to_fetch = []
    seen_teams = set()
    for game in schedule:
        home_tri = game.get('homeTeamAbbrev')
        away_tri = game.get('awayTeamAbbrev')
        home_name = game.get('homeTeam') 
        away_name = game.get('awayTeam')
        
        if home_tri and home_tri not in seen_teams:
            seen_teams.add(home_tri)
            # Use full name from CSV if available, else fallback to schedule name
            f_name = full_names.get(home_tri, home_name)
            teams_to_fetch.append({'triCode': home_tri, 'teamName': f_name})
            
        if away_tri and away_tri not in seen_teams:
            seen_teams.add(away_tri)
            f_name = full_names.get(away_tri, away_name)
            teams_to_fetch.append({'triCode': away_tri, 'teamName': f_name})

    try:
        team_lineups = fetch_dailyfaceoff.fetch_lineups(teams_to_fetch)
    except Exception as e:
        print(f"Error fetching lineups: {e}")
        team_lineups = {}

    # Fetch Player News
    try:
        player_news = fetch_dailyfaceoff.fetch_player_news()
    except Exception as e:
        print(f"Error fetching player news: {e}")
        player_news = {}

    csv_rows = []

    # OUTPUT HEADER
    print("\n--- Predictions & EV Analysis ---")
    print(f"{'Date':<11} {'Home':<15} {'Away':<15} {'H Win%':<8} {'A Win%':<8} {'H EV':<10} {'A EV':<10} {'Wager'}")
    print("-" * 100)

    for game in schedule:
        home_team = game['homeTeam']
        away_team = game['awayTeam']
        
        # Use the explicit gameDate we saved, or fallback to parsing if missing
        game_date = game.get('gameDate')
        if not game_date:
            game_date = game.get('startTimeUTC', '')[:10]
        
        game_id = f"{game_date}-{away_team}-{home_team}"
        
        # --- FREEZE CHECK ---
        is_frozen = False
        start_time_utc = game.get('startTimeUTC') # 2025-12-06T17:30:00Z
        
        if start_time_utc:
            try:
                # Parse to aware UTC datetime
                st = datetime.strptime(start_time_utc, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                now = datetime.now(timezone.utc)
                
                # If current time is PAST start time (with 5 min buffer maybe? No, immediate freeze is fine)
                # AND we have existing data
                if now > st and game_id in existing_predictions:
                    is_frozen = True
            except Exception as e:
                # print(f"Error parsing date for freeze check: {e}")
                pass

        if is_frozen:
            # USE CACHED DATA
            row = existing_predictions[game_id].copy()
            
            # Update Metadata (News/Lineups) SAFE UPDATE
            # Only update if we successfully fetched new data. 
            # If fetch returned empty (e.g. after game start), keep the old frozen news.
            h_tri = game.get('homeTeamAbbrev')
            a_tri = game.get('awayTeamAbbrev')
            
            if h_tri:
                new_h_news = player_news.get(h_tri, [])
                if new_h_news:
                     row['home_news'] = json.dumps(new_h_news)
                
                new_h_lines = team_lineups.get(h_tri, {})
                if new_h_lines:
                     row['home_lineup'] = json.dumps(new_h_lines)
                
            if a_tri:
                new_a_news = player_news.get(a_tri, [])
                if new_a_news:
                     row['away_news'] = json.dumps(new_a_news)

                new_a_lines = team_lineups.get(a_tri, {})
                if new_a_lines:
                     row['away_lineup'] = json.dumps(new_a_lines)

            csv_rows.append(row)
            
            # Print Frozen Summary
            h_wp = str(row.get('home_win_pct', '')) + '%'
            a_wp = str(row.get('away_win_pct', '')) + '%'
            h_ev = str(row.get('home_ev', '')) 
            if h_ev: h_ev += '%'
            a_ev = str(row.get('away_ev', ''))
            if a_ev: a_ev += '%'
            
            print(f"{row.get('game_date',''):<11} {row.get('home_team',''):<15} {row.get('away_team',''):<15} {h_wp:<8}   {a_wp:<8}   {h_ev:<10} {a_ev:<10} {row.get('wager_recommendation','')} [FROZEN] (Safe Update)")
            continue
            
        # --- FRESH CALCULATION ---
        
        if home_team not in team_ratings or away_team not in team_ratings:
            continue
            
        # Get Ratings
        h_xgf = team_ratings[home_team]['xgf_rating']
        h_xga = team_ratings[home_team]['xga_rating']
        a_xgf = team_ratings[away_team]['xgf_rating']
        a_xga = team_ratings[away_team]['xga_rating']
        
        # --- [V2] STAR POWER / INJURY PENALTY ---
        # Heuristic: Top Players list (Hardcoded for immediate impact, can be externalized)
        # We check if these players are in the "Injury" or "Out" news
        
        key_players = {
            "Avalanche": ["Nathan MacKinnon", "Cale Makar", "Mikko Rantanen"],
            "Oilers": ["Connor McDavid", "Leon Draisaitl", "Evan Bouchard"],
            "Lightning": ["Nikita Kucherov", "Victor Hedman", "Andrei Vasilevskiy"],
            "Maple Leafs": ["Auston Matthews", "Mitch Marner", "William Nylander"],
            "Panthers": ["Aleksander Barkov", "Matthew Tkachuk", "Sam Reinhart"],
            "Bruins": ["David Pastrnak", "Brad Marchand", "Charlie McAvoy"],
            "Rangers": ["Artemi Panarin", "Adam Fox", "Igor Shesterkin"],
            "Canucks": ["Quinn Hughes", "Elias Pettersson", "J.T. Miller"],
            "Stars": ["Jason Robertson", "Roope Hintz", "Miro Heiskanen"],
            "Golden Knights": ["Jack Eichel", "Mark Stone", "Shea Theodore"],
            "Devils": ["Jack Hughes", "Nico Hischier", "Dougie Hamilton"],
            "Hurricanes": ["Sebastian Aho", "Andrei Svechnikov"],
            "Jets": ["Connor Hellebuyck", "Kyle Connor", "Mark Scheifele"],
            "Wild": ["Kirill Kaprizov", "Matt Boldy"], 
            "Sabres": ["Tage Thompson", "Rasmus Dahlin"],
            "Senators": ["Tim Stützle", "Brady Tkachuk"],
            "Penguins": ["Sidney Crosby", "Evgeni Malkin", "Erik Karlsson"],
            "Capitals": ["Alex Ovechkin", "John Carlson"],
            "Red Wings": ["Dylan Larkin", "Lucas Raymond"], 
            "Predators": ["Roman Josi", "Filip Forsberg", "Juuse Saros"],
            "Kings": ["Anze Kopitar", "Adrian Kempe", "Drew Doughty"],
            "Blues": ["Robert Thomas", "Jordan Kyrou"],
            "Flyers": ["Travis Konecny", "Matvei Michkov"],
            "Islanders": ["Mathew Barzal", "Bo Horvat", "Ilya Sorokin"],
            "Flames": ["Nazem Kadri", "Rasmus Andersson"],
            "Kraken": ["Jared McCann", "Vince Dunn"],
            "Utah": ["Clayton Keller", "Mikhail Sergachev"],
            "Blue Jackets": ["Zach Werenski", "Johnny Gaudreau"], # RIP Johnny, need to update
            "Ducks": ["Mason McTavish", "Trevor Zegras"],
            "Sharks": ["Macklin Celebrini", "Will Smith"],
            "Canadiens": ["Nick Suzuki", "Cole Caufield"],
            "Blackhawks": ["Connor Bedard", "Seth Jones"]
        }
        
        # Check Home Stars
        h_star_penalty = 0.0
        h_news_list = player_news.get(home_tri, [])
        for news_item in h_news_list:
            p_name = news_item.get('player', '')
            # If key player AND status indicates absence
            if any(kp in p_name for kp in key_players.get(home_team, [])):
                 # Simple check for "Out", "Injured", "IR" in category or news
                 cat = news_item.get('category', '').lower()
                 desc = news_item.get('news', '').lower()
                 if "injury" in cat or "healthy scratch" in cat or "illness" in cat or "out" in desc:
                     # Check if it says "will play" or "expected to play" to avoid false positives
                     if "will play" not in desc and "expected to play" not in desc:
                         print(f"  [STAR MISSING] {home_team}: {p_name} (-7% xGF)")
                         h_star_penalty += 0.07

        # Check Away Stars
        a_star_penalty = 0.0
        a_news_list = player_news.get(away_tri, [])
        for news_item in a_news_list:
            p_name = news_item.get('player', '')
            if any(kp in p_name for kp in key_players.get(away_team, [])):
                 cat = news_item.get('category', '').lower()
                 desc = news_item.get('news', '').lower()
                 if "injury" in cat or "healthy scratch" in cat or "illness" in cat or "out" in desc:
                     if "will play" not in desc and "expected to play" not in desc:
                         print(f"  [STAR MISSING] {away_team}: {p_name} (-7% xGF)")
                         a_star_penalty += 0.07

        # Apply Star Penalties
        h_xgf = h_xgf * (1.0 - h_star_penalty)
        a_xgf = a_xgf * (1.0 - a_star_penalty)


        # Get Special Teams Ranks & PCT
        h_st = st_rankings.get(home_team, {'pp_rank': 16, 'pk_rank': 16, 'pp_pct': 0.2, 'pk_pct': 0.8})
        a_st = st_rankings.get(away_team, {'pp_rank': 16, 'pk_rank': 16, 'pp_pct': 0.2, 'pk_pct': 0.8})
        
        h_ranks = {'pp_rank': h_st['pp_rank'], 'pk_rank': h_st['pk_rank']}
        a_ranks = {'pp_rank': a_st['pp_rank'], 'pk_rank': a_st['pk_rank']}
        
        # --- [V2] SPECIAL TEAMS MATH ---
        # Calculate Efficiency: (My PP + Opp PK_Inv) / 2
        # Avg PP Opps approx 3.2 per game
        AVG_PP_OPPS = 3.2
        ST_WEIGHT = 0.06 # Tunable weight for impact
        
        h_pp_val = h_st.get('pp_pct', 0.2)
        h_pk_val = h_st.get('pk_pct', 0.8)
        a_pp_val = a_st.get('pp_pct', 0.2)
        a_pk_val = a_st.get('pk_pct', 0.8)
        
        # Home PP vs Away PK
        # If Away PK is 70% (0.7), Inv is 30% (0.3) success for offense.
        # Average the offensive success rate.
        h_pp_exp = (h_pp_val + (1 - a_pk_val)) / 2
        h_st_bonus = (h_pp_exp * AVG_PP_OPPS) * ST_WEIGHT 
        
        # Away PP vs Home PK
        a_pp_exp = (a_pp_val + (1 - h_pk_val)) / 2
        a_st_bonus = (a_pp_exp * AVG_PP_OPPS) * ST_WEIGHT
        
        # Log heavy mismatches
        if h_pp_exp > 0.30:
            print(f"  [SPECIAL TEAMS] {home_team} PP Advantage (Exp Success: {h_pp_exp*100:.1f}%)")
        if a_pp_exp > 0.30:
            print(f"  [SPECIAL TEAMS] {away_team} PP Advantage (Exp Success: {a_pp_exp*100:.1f}%)")
            
        
        # Fetch L7 Records
        if home_team not in l7_cache:
            l7_cache[home_team], l7_details_cache[home_team] = fetch_l7_record(
                tricodes.get(home_team), starter_lookup, common_names
            )
        h_l7 = l7_cache[home_team]
        h_l7_games = l7_details_cache[home_team]
        
        if away_team not in l7_cache:
            l7_cache[away_team], l7_details_cache[away_team] = fetch_l7_record(
                tricodes.get(away_team), starter_lookup, common_names
            )
        a_l7 = l7_cache[away_team]
        a_l7_games = l7_details_cache[away_team]
        
        # Get Goalies
        h_conf = game.get('homeGoalieConfirmed')
        a_conf = game.get('awayGoalieConfirmed')
        h_status = game.get('homeGoalieStatus')
        a_status = game.get('awayGoalieStatus')
        
        h_goalie_name = get_best_goalie(home_team, goalie_ratings, confirmed_goalie=h_conf)
        a_goalie_name = get_best_goalie(away_team, goalie_ratings, confirmed_goalie=a_conf)
        
        # Prepare display names (with status)
        h_goalie_display = h_goalie_name
        a_goalie_display = a_goalie_name
        
        if h_status and h_goalie_display and "Confirmed" not in h_goalie_display:
            h_goalie_display = f"{h_goalie_display} ({h_status})"

        if a_status and a_goalie_display and "Confirmed" not in a_goalie_display:
            a_goalie_display = f"{a_goalie_display} ({a_status})"
        
        # Lookups using CLEAN name
        h_gsax = goalie_ratings.get(h_goalie_name, {'gsax_per_game': 0})['gsax_per_game'] if h_goalie_name else 0
        a_gsax = goalie_ratings.get(a_goalie_name, {'gsax_per_game': 0})['gsax_per_game'] if a_goalie_name else 0
        
        # New: GSAx Total and Percentile
        h_gsax_total = goalie_ratings.get(h_goalie_name, {'gsax_total': 0})['gsax_total'] if h_goalie_name else 0
        a_gsax_total = goalie_ratings.get(a_goalie_name, {'gsax_total': 0})['gsax_total'] if a_goalie_name else 0
        
        h_gsax_pct = goalie_percentiles.get(h_goalie_name, 50) if h_goalie_name else 50
        a_gsax_pct = goalie_percentiles.get(a_goalie_name, 50) if a_goalie_name else 50

        # Home xG Base
        # Reduced Home Ice from 1.05 to 1.03
        h_xg = (h_xgf * a_xga) / league_xg * 1.03
        a_xg = (a_xgf * h_xga) / league_xg
        
        # Add Special Teams Bonus
        h_xg += h_st_bonus
        a_xg += a_st_bonus
        
        # --- [V3] SATURDAY NIGHT BOOST ---
        # Methodology: +5% Win Prob & +0.25 xG for High-Variance Home Teams on Saturdays
        # Targets: BOS, UTA, TBL, LAK, DAL, FLA
        is_sat_boost = False
        target_boost_teams = ["BOS", "UTA", "TBL", "LAK", "DAL", "FLA"]
        h_tri = game.get('homeTeamAbbrev')
        a_tri = game.get('awayTeamAbbrev')
        
        if h_tri in target_boost_teams:
            try:
                g_dt = datetime.strptime(game_date, "%Y-%m-%d")
                if g_dt.weekday() == 5: # Saturday
                    is_sat_boost = True
                    print(f"  [SATURDAY BOOST] {home_team} @ Home on Saturday -> +0.25 xG & +5% Win Prob")
                    h_xg += 0.25
            except Exception as e:
                pass
        
        # Dampen GSAx
        GOALIE_IMPACT_FACTOR = 0.5

        # --- GOALIE VS OPPONENT HISTORY ---
        # Fetch stats
        # Clean names: remove (Confirmed) etc.
        h_starter_clean = h_goalie_display.split('(')[0].strip() if h_goalie_display else ""
        a_starter_clean = a_goalie_display.split('(')[0].strip() if a_goalie_display else ""
        
        h_vs_opp_stats = None
        a_vs_opp_stats = None
        
        # Only fetch if we have a name
        if h_starter_clean:
            h_vs_opp_stats = fetch_goalie_history.fetch_goalie_vs_opponent(h_starter_clean, h_tri, game.get('awayTeamAbbrev'))
            
        if a_starter_clean:
            a_vs_opp_stats = fetch_goalie_history.fetch_goalie_vs_opponent(a_starter_clean, a_tri, h_tri)
            
        # Apply Adjustments
        # Dominance: GP>=5, Win%>=.700, Sv%>=.920 -> -0.2 xG for OPPONENT
        # Struggle: GP>=5, Win%<=.300, Sv%<=.825 -> +0.2 xG for OPPONENT
        
        h_hist_adj = 0.0
        a_hist_adj = 0.0
        
        if h_vs_opp_stats and h_vs_opp_stats['gp'] >= 5:
            if h_vs_opp_stats['win_pct'] >= 0.700 and h_vs_opp_stats['sv'] >= 0.910:
                print(f"  [GOALIE HIST] {h_starter_clean} dominates {away_team}: {h_vs_opp_stats['record']} . {h_vs_opp_stats['sv']} -> -0.2 xG for Opp")
                a_hist_adj -= 0.2
            elif h_vs_opp_stats['win_pct'] <= 0.300 and h_vs_opp_stats['sv'] <= 0.825:
                print(f"  [GOALIE HIST] {h_starter_clean} struggles vs {away_team}: {h_vs_opp_stats['record']} . {h_vs_opp_stats['sv']} -> +0.2 xG for Opp")
                a_hist_adj += 0.2
                
        if a_vs_opp_stats and a_vs_opp_stats['gp'] >= 5:
            if a_vs_opp_stats['win_pct'] >= 0.700 and a_vs_opp_stats['sv'] >= 0.910:
                print(f"  [GOALIE HIST] {a_starter_clean} dominates {home_team}: {a_vs_opp_stats['record']} . {a_vs_opp_stats['sv']} -> -0.2 xG for Opp")
                h_hist_adj -= 0.2
            elif a_vs_opp_stats['win_pct'] <= 0.300 and a_vs_opp_stats['sv'] <= 0.825:
                print(f"  [GOALIE HIST] {a_starter_clean} struggles vs {home_team}: {a_vs_opp_stats['record']} . {a_vs_opp_stats['sv']} -> +0.2 xG for Opp")
                h_hist_adj += 0.2
        
        
        # --- GAS CALCULATION ---
        home_gas, home_gas_bd = gas_calc.calculate_gas(home_team, game_date, away_team, is_home=True)
        away_gas, away_gas_bd = gas_calc.calculate_gas(away_team, game_date, home_team, is_home=False)
        
        home_gas_breakdown = "|".join(home_gas_bd)
        away_gas_breakdown = "|".join(away_gas_bd)

        # --- [V2] CONTINUOUS GAS LOGIC ---
        
        h_gas_gap = home_gas - away_gas
        a_gas_gap = away_gas - home_gas
        
        # Base multiplier 1.0
        h_boost = 1.0
        a_boost = 1.0
        
        if h_gas_gap > 0:
            boost_val = h_gas_gap * 0.004
            h_boost = 1.0 + min(0.25, boost_val)
            
        if a_gas_gap > 0:
            boost_val = a_gas_gap * 0.004
            a_boost = 1.0 + min(0.25, boost_val)
            
        # Log significant boosts (>5%)
        if h_boost > 1.05:
            print(f"  [GAS BOOST] {home_team} gets {int((h_boost-1)*100)}% boost (Gas: {home_gas}, Gap: {h_gas_gap})")
        if a_boost > 1.05:
            print(f"  [GAS BOOST] {away_team} gets {int((a_boost-1)*100)}% boost (Gas: {away_gas}, Gap: {a_gas_gap})")

        h_xg_adj = max(0.1, h_xg - (a_gsax * GOALIE_IMPACT_FACTOR)) * h_boost + h_hist_adj
        a_xg_adj = max(0.1, a_xg - (h_gsax * GOALIE_IMPACT_FACTOR)) * a_boost + a_hist_adj
        
        # --- [V3] THE ORACLE UPGRADES (Anti-Hits & PDO) ---
        
        # Calculate Rolling Stats (Last 10 games for stability)
        # We reuse the `season_df` loaded for GAS calc
        def get_trend_stats(team_name, df, current_date):
            # Sort chronologically, filter for team, filter BEFORE today
            # Note: We need to match 'team' column.
            # Using clean names from team_ratings keys might differ from CSV team names?
            # Assuming consistency for now as they come from same source mostly.
            
            # Filter history
            # Ensure current_date is a timestamp for comparison
            # game_date from schedule is "YYYY-MM-DD" string
            t_date = pd.to_datetime(current_date)
            history = df[(df['team'] == team_name) & (df['game_date'] < t_date)].sort_values('game_date')
            
            if len(history) < 5:
                return 1000, 20 # New season defaults (PDO 1000, Hits 20)
                
            recent = history.tail(7) # Last 7 Games
            
            # PDO Calc
            goals = recent['goals_for'].sum()
            sog = recent['sog_for'].sum()
            saves = recent['saves_for'].sum()
            sa = recent['sog_ag'].sum()
            
            sh_pct = goals / sog if sog > 0 else 0
            sv_pct = saves / sa if sa > 0 else 0
            pdo = (sh_pct + sv_pct) * 1000
            
            # Hits Calc
            hits = recent['hits_for'].mean()
            return pdo, hits

        # Fetch Pre-Game Trends
        h_pdo, h_hits = get_trend_stats(home_team, game_stats_df, game_date)
        a_pdo, a_hits = get_trend_stats(away_team, game_stats_df, game_date)
        
        # 1. PDO Momentum (Reward the "Lucky"/Good)
        # If I have high PDO and you have low, I am playing better.
        pdo_diff = h_pdo - a_pdo
        
        if pdo_diff > 40: # e.g. 1020 vs 980
            print(f"  [PDO MOMENTUM] {home_team} (PDO {h_pdo:.0f}) vs {away_team} (PDO {a_pdo:.0f}) -> +5% Boost")
            h_xg_adj *= 1.05
        elif pdo_diff < -40:
            print(f"  [PDO MOMENTUM] {away_team} (PDO {a_pdo:.0f}) vs {home_team} (PDO {h_pdo:.0f}) -> +5% Boost")
            a_xg_adj *= 1.05
            
        # 2. Possession Proxy (Anti-Hits)
        # If I hit a lot more than you, I am chasing the puck.
        hits_diff = h_hits - a_hits
        
        if hits_diff > 8: # Home hits way more
            print(f"  [CHASING PLAY] {home_team} Avg Hits +{hits_diff:.1f} vs {away_team} -> -3% Penalty")
            h_xg_adj *= 0.97
        elif hits_diff < -8: # Away hits way more
            print(f"  [CHASING PLAY] {away_team} Avg Hits +{abs(hits_diff):.1f} vs {home_team} -> -3% Penalty")
            a_xg_adj *= 0.97

        # Simulate
        h_prob, a_prob, tie_prob = simulate_game(h_xg_adj, a_xg_adj)
        h_win_prob = h_prob + (tie_prob * 0.5)
        a_win_prob = a_prob + (tie_prob * 0.5)
        
        # Apply Saturday Win Prob Boost
        if is_sat_boost:
            h_win_prob += 0.05
            a_win_prob -= 0.05
            # Clamp
            h_win_prob = min(0.99, max(0.01, h_win_prob))
            a_win_prob = min(0.99, max(0.01, a_win_prob))
        
        # Odds & EV
        h_odds = odds_data.get(home_team)
        a_odds = odds_data.get(away_team)
        
        today_str = datetime.now().strftime("%Y-%m-%d")
        
        # Safe heuristic: Only apply odds to Today's games.
        if game_date != today_str:
             h_odds = None
             a_odds = None
             
        # Override: Manual odds might be for tomorrow.
        # But for now, safety first to prevent the false EV alerts described by user.
        # User complained about dupes. Limiting to today solves duplicates for B2B.
        # Does it hurt tomorrow's valid predictions? Yes, but better than wrong data.
        
        h_ev = calculate_ev(h_win_prob, h_odds) if h_odds else -1
        a_ev = calculate_ev(a_win_prob, a_odds) if a_odds else -1
        
        # Wager Recommendations (Kelly)
        h_wager = get_wager_recommendation(h_ev, h_win_prob, h_odds)
        a_wager = get_wager_recommendation(a_ev, a_win_prob, a_odds)
        
        wager_rec = "No Bet"
        if "Unit" in h_wager:
            wager_rec = f"Home {h_wager}"
        elif "Unit" in a_wager:
            wager_rec = f"Away {a_wager}"
            
        # Print Console Output
        h_ev_str = f"{h_ev*100:.1f}%" if h_ev > 0 else ""
        a_ev_str = f"{a_ev*100:.1f}%" if a_ev > 0 else ""
        
        print(f"{game_date:<11} {home_team:<15} {away_team:<15} {h_win_prob*100:.1f}%   {a_win_prob*100:.1f}%   {h_ev_str:<10} {a_ev_str:<10} {wager_rec}")

        # Construct Row for CSV
        # Get Goalie Names (Cleaned)
        # h_goalie_display and a_goalie_display already contain the name, potentially with status.
        # We need the clean name to lookup in goalie_stats_map.
        home_goalie_clean_name = h_goalie_display.split(' (')[0].strip().lower() if h_goalie_display else ""
        away_goalie_clean_name = a_goalie_display.split(' (')[0].strip().lower() if a_goalie_display else ""
        
        # Debug Print for Lookup
        # if home_goalie_clean_name: print(f"Looking up home goalie: '{home_goalie_clean_name}'")
        
        home_g_stat = goalie_stats_map.get(home_goalie_clean_name, "")
        away_g_stat = goalie_stats_map.get(away_goalie_clean_name, "")

        csv_rows.append({
            'game_date': game_date,
            'game_id': game_id,
            
            'home_team': home_team,
            'home_starter': h_goalie_display,
            'home_xg': round(h_xg_adj, 2),
            'home_win_pct': round(h_win_prob * 100, 1),
            'home_model_odds': prob_to_odds(h_win_prob),
            'home_vegas_odds': h_odds if h_odds else "N/A",
            'home_vegas_win_pct': round(implied_prob(h_odds) * 100, 1),
            'home_ev': round(h_ev * 100, 2) if h_ev > -1 else "",
            
            'away_team': away_team,
            'away_starter': a_goalie_display,
            'away_xg': round(a_xg_adj, 2),
            'away_win_pct': round(a_win_prob * 100, 1),
            'away_model_odds': prob_to_odds(a_win_prob),
            'away_vegas_odds': a_odds if a_odds else "N/A",
            'away_vegas_win_pct': round(implied_prob(a_odds) * 100, 1),
            'away_ev': round(a_ev * 100, 2) if a_ev > -1 else "",
            
            'wager_recommendation': wager_rec,
            'game_start_time': convert_to_central(game.get('startTimeUTC')),
            
            'home_pp_rank': h_ranks['pp_rank'],
            'home_pk_rank': h_ranks['pk_rank'],
            'away_pp_rank': a_ranks['pp_rank'],
            'away_pk_rank': a_ranks['pk_rank'],
            
            'home_l7': h_l7,
            'away_l7': a_l7,
            
            # Add News (Serialize as JSON string)
            'home_news': json.dumps(player_news.get(game.get('homeTeamAbbrev'), [])),
            'away_news': json.dumps(player_news.get(game.get('awayTeamAbbrev'), [])),
            
            # Add Lineups (Serialize as JSON string)
            'home_lineup': json.dumps(team_lineups.get(game.get('homeTeamAbbrev'), {})),
            'away_lineup': json.dumps(team_lineups.get(game.get('awayTeamAbbrev'), {})),
            
            # Serialize lists to JSON string for CSV
            'home_l7_games': json.dumps(h_l7_games),
            'away_l7_games': json.dumps(a_l7_games),
            
            'home_gas': home_gas,
            'away_gas': away_gas,
            
            'home_gas_breakdown': home_gas_breakdown,
            'away_gas_breakdown': away_gas_breakdown,
            'home_gsax_total': h_gsax_total,
            'home_gsax_pct': h_gsax_pct,
            'away_gsax_total': a_gsax_total,
            'away_gsax_pct': a_gsax_pct,
            
            'home_goalie_stats': home_g_stat, # (W-L-O) | SV% | GAA
            'away_goalie_stats': away_g_stat,
            
            # Goalie vs Opp History
            'home_starter_vs_opp': json.dumps(h_vs_opp_stats) if h_vs_opp_stats else "",
            'away_starter_vs_opp': json.dumps(a_vs_opp_stats) if a_vs_opp_stats else ""
        })        

    # Create DataFrame from csv_rows
    df_pred = pd.DataFrame(csv_rows)
    
    # Save to current directory
    output_file = 'predictions_detailed.csv'
    # Save predictions
    df_pred.to_csv('predictions_detailed.csv', index=False)
    print("Saved predictions_detailed.csv")
    
    # Save Last Update Timestamp for Frontend
    timestamp = datetime.now().strftime("%B %d, %I:%M %p %Z")
    with open('last_updated.json', 'w') as f:
        json.dump({"last_refresh": timestamp}, f)
        
    # Sync if needed (handled by auto_pipeline.sh usually)
    # Sync to app data folder (Relative path when running from pipeline/ dir)
    try:
        df_pred.to_csv('../data/predictions_detailed.csv', index=False)
        
        with open('../data/last_updated.json', 'w') as f:
            json.dump({"last_refresh": timestamp}, f)
            
        print("Synced to ../data/")
    except FileNotFoundError:
        print("Could not sync to app folder (path not found?)")
        # Try absolute or check if running from root?
        # Fallback if running from root
        try:
            df_pred.to_csv('data/predictions_detailed.csv', index=False)
            with open('data/last_updated.json', 'w') as f:
                json.dump({"last_refresh": timestamp}, f)
            print("Synced to data/ (Fallback)")
        except:
            print("Failed to sync data.")

if __name__ == "__main__":
    predict()
