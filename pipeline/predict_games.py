import os
import fetch_dailyfaceoff
import fetch_goalie_history # New Module
import shutil
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

# ── Player-impact / lineup-aware module ──────────────────────────────────────
try:
    from player_impact import load_player_impact, load_team_baselines, estimate_lineup_xg, lookup_player
    _LINEUP_ENGINE_AVAILABLE = True
except ImportError:
    _LINEUP_ENGINE_AVAILABLE = False
    print("[WARN] player_impact module not found — lineup adjustment disabled")

# Blend weight for lineup estimate vs team rating (0 = all team rating, 1 = all lineup)
# At 0.30 the lineup signal contributes ~30% of the 5v5 xG estimate.
# This is conservative initially; can be tuned as model accuracy is validated.
LINEUP_BLEND_WEIGHT = 0.50

# ── (imports end) ─────────────────────────────────────────────────────────────

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
    if pd.isna(prob) or prob <= 0 or prob >= 1:
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
        script_dir = os.path.dirname(os.path.abspath(__file__))
        data_path = os.path.join(script_dir, '../data/nhl_teams.csv')
        df = pd.read_csv(data_path)
        # Map Common Name to Tricode
        for _, row in df.iterrows():
            tricodes[row['Common Name']] = row['Team Tricode']
    except Exception as e:
        print(f"Error loading tricodes: {e}")
    return tricodes

def load_full_names():
    names = {}
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        data_path = os.path.join(script_dir, '../data/nhl_teams.csv')
        df = pd.read_csv(data_path)
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
        script_dir = os.path.dirname(os.path.abspath(__file__))
        data_path = os.path.join(script_dir, '../data/nhl_teams.csv')
        df = pd.read_csv(data_path)
        # Map Tricode to Common Name
        for _, row in df.iterrows():
            if pd.notna(row['Team Tricode']):
                names[row['Team Tricode']] = row['Common Name']
    except Exception as e:
        print(f"Error loading common names: {e}")
    except Exception as e:
        print(f"Error loading common names: {e}")
    return names

def load_team_ids():
    ids = {}
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        data_path = os.path.join(script_dir, '../data/nhl_teams.csv')
        df = pd.read_csv(data_path)
        # Map Common Name to ID
        for _, row in df.iterrows():
            ids[row['Common Name']] = int(row['NHL Team ID'])
    except Exception as e:
        print(f"Error loading team IDs: {e}")
    return ids

def load_edge_profiles():
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(script_dir, '../public/data/team_edge_profiles.json')
        # Check alternates
        if not os.path.exists(path):
            path = 'public/data/team_edge_profiles.json'
            
        with open(path, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading edge profiles: {e}")
        return {}

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
    
def get_h2h_record(team1, team2, curr_dt, df):
    t_date = pd.to_datetime(curr_dt)
    history1 = df[
        (df['team'] == team1) & 
        (df['opponent'] == team2) & 
        (df['game_date'] < t_date)
    ]
    
    if history1.empty:
        return "", ""
        
    w1, l1, otl1 = 0, 0, 0
    w2, l2, otl2 = 0, 0, 0
    
    for _, row in history1.iterrows():
        res = str(row.get('result', ''))
        if res in ['RW', 'OTW', 'SOW']:
            w1 += 1
            if res == 'RW':
                l2 += 1
            else:
                otl2 += 1
        elif res in ['RL', 'OTL', 'SOL']:
            w2 += 1
            if res == 'RL':
                l1 += 1
            else:
                otl1 += 1
                
    rec1 = f"{w1}-{l1}-{otl1}" if otl1 > 0 else f"{w1}-{l1}"
    rec2 = f"{w2}-{l2}-{otl2}" if otl2 > 0 else f"{w2}-{l2}"
    return rec1, rec2

def get_xg_sparkline(team_name, curr_dt, df):
    t_date = pd.to_datetime(curr_dt)
    history = df[(df['team'] == team_name) & (df['game_date'] < t_date)].sort_values('game_date')
    recent = history.tail(15)

    # Collect raw per-game xGD first
    raw = []
    for _, row in recent.iterrows():
        try:
            xg_for = float(row.get('xg_for_5v5', float('nan')))
            xg_ag = float(row.get('xg_ag_5v5', float('nan')))
            # Skip games where 5v5 xG data is missing — don't write NaN to JSON
            if math.isnan(xg_for) or math.isnan(xg_ag):
                continue
            raw.append(xg_for - xg_ag)
        except:
            pass

    if len(raw) < 2:
        return []

    # Apply 3-game rolling average so blowout games don't spike the line
    WINDOW = 3
    sparkline = []
    for i in range(len(raw)):
        start = max(0, i - WINDOW + 1)
        avg = sum(raw[start:i + 1]) / (i - start + 1)
        sparkline.append(round(avg, 2))

    return sparkline

def get_fatigue_flags(team_name, curr_dt, df):
    t_date = pd.to_datetime(curr_dt)
    history = df[(df['team'] == team_name) & (df['game_date'] < t_date)].sort_values('game_date')
    if history.empty:
        return False, False, False, False
        
    dates = pd.to_datetime(history['game_date']).tolist()
    is_b2b, is_3in4, is_4in6, is_6in9 = False, False, False, False
    
    if len(dates) >= 1 and (t_date - dates[-1]).days <= 1:
        is_b2b = True
    if len(dates) >= 2 and (t_date - dates[-2]).days <= 3:
        is_3in4 = True
    if len(dates) >= 3 and (t_date - dates[-3]).days <= 5:
        is_4in6 = True
    if len(dates) >= 5 and (t_date - dates[-5]).days <= 8:
        is_6in9 = True
            
    return is_b2b, is_3in4, is_4in6, is_6in9

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
    # Load Upcoming Games
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        schedule_path = os.path.join(script_dir, 'upcoming_games.json')
        schedule = load_json(schedule_path)
    except Exception as e:
        print(f"Error loading schedule from {schedule_path}: {e}")
        schedule = []
    
    # Load Odds
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        odds_path = os.path.join(script_dir, 'odds.json')
        # Check if exists there, if not try CWD?
        # Actually fetch_odds writes to CWD if run from root. 
        # But let's standardize on pipeline/odds.json if possible, or check both.
        if os.path.exists(odds_path):
            with open(odds_path, 'r') as f:
                odds_data = json.load(f)
        elif os.path.exists('odds.json'):
             with open('odds.json', 'r') as f:
                odds_data = json.load(f)
        else:
             print("Warning: odds.json not found.")
             odds_data = {}
    except Exception as e:
        print(f"Error loading odds: {e}")
        odds_data = {}
        
    # Load Special Teams Rankings
    st_rankings = fetch_team_rankings()
    
    # Load Tricodes and Common Names
    tricodes = load_tricodes()
    full_names = load_full_names()
    common_names = load_common_names()
    l7_cache = {}
    l7_cache = {}
    l7_details_cache = {}
    
    # Load Edge Data
    team_ids_map = load_team_ids()
    edge_profiles = load_edge_profiles()
    print(f"Loaded {len(edge_profiles)} Team Edge Profiles.")

    # Load game stats for GasCalculator and Starter Lookup
    print("Loading game stats for GasCalculator and Starter Lookup...")
    game_stats_df = pd.read_csv('nhl_season_2025_2026_gamestats.csv')
    
    # Load Scoring Coefficients
    try:
        with open('scoring_coefficients.json', 'r') as f:
            coeffs = json.load(f)
        ST_VAL_PP = coeffs.get('pp_opp_val', 0.18)
        B2B_PENALTY = coeffs.get('b2b_cost', 0.21)
        # 3in4 coefficient (Sanitize: If positive, set to 0.0 or small penalty)
        # Analysis showed +0.12. We will treat 3in4 as at least as bad as B2B if logic dictates, 
        # but for now let's just ensure we don't ADD goals.
        raw_3in4 = coeffs.get('3in4_cost_gf', 0.0)
        IN3_4_PENALTY = abs(raw_3in4) * -1.0 if raw_3in4 > 0 else raw_3in4
        # Force a small penalty if it was positive/zero, because 3in4 IS tiring.
        if raw_3in4 >= 0:
             IN3_4_PENALTY = -0.10 # Hardcoded heuristic override based on common sense if data is noisy
             
        HOME_ICE_VAL = coeffs.get('home_ice_advantage', 0.16)
        STAR_PENALTY = coeffs.get('star_impact_placeholder', 0.07)
    except FileNotFoundError:
         print("Warning: scoring_coefficients.json not found. Using defaults.")
         ST_VAL_PP = 0.18
         B2B_PENALTY = 0.21
         IN3_4_PENALTY = -0.10
         HOME_ICE_VAL = 0.16
         STAR_PENALTY = 0.07

    # Calculate League Averages for dynamic scaling
    # Calculate League Averages for dynamic scaling
    # V3 FIX: Use Team Ratings average, NOT Game Stats average.
    # Game Stats raw xG might be different scale (sum vs rate), causing "0.5" predictions.
    # We need Denominator (League Avg) to match Numerator (Team Ratings).
    if team_ratings:
        total_xg_rate = 0
        count = 0
        for t, r in team_ratings.items():
            val = r.get('xgf_5v5_rating', 0)
            if val > 0:
                total_xg_rate += val
                count += 1
        
        if count > 0:
            league_xg_5v5 = total_xg_rate / count
            print(f"League Avg 5v5 xG (from Ratings): {league_xg_5v5:.2f}")
        else:
            league_xg_5v5 = 2.35 # Fallback
            print(f"League Avg 5v5 xG (Fallback): {league_xg_5v5:.2f}")
    else:
        league_xg_5v5 = 2.35
    
    # SP Teams Avg
    avg_pp_pct = 0.20
    avg_pk_pct = 0.80
    if not game_stats_df.empty:
         tot_pp_opps = game_stats_df['pp_opportunities'].sum()
         tot_pp_goals = game_stats_df['pp_goals'].sum()
         if tot_pp_opps > 0:
             avg_pp_pct = tot_pp_goals / tot_pp_opps
        
         tot_pk_opps = game_stats_df['pk_opportunities'].sum()
         tot_pp_ga = game_stats_df['pp_goals_against'].sum()
         if tot_pk_opps > 0:
             avg_pk_pct = 1 - (tot_pp_ga / tot_pk_opps)
    
    # Build Starter Lookup: (DateStr, TeamCommonName) -> StarterName
    starter_lookup = {}
    for _, row in game_stats_df.iterrows():
        try:
             # Ensure date is YYYY-MM-DD string
             d_val = row['game_date']
             if isinstance(d_val, pd.Timestamp):
                 d_str = d_val.strftime('%Y-%m-%d')
             else:
                 d_str = str(d_val).split(' ')[0] # Handle strings or other formats

             # row['team'] is Common Name (e.g. "Rangers")
             # row['starting_goalie'] is Name
             if pd.notna(row['starting_goalie']):
                 starter_lookup[(d_str, row['team'])] = row['starting_goalie']
        except Exception as e:
            pass

    game_stats_df['game_date'] = pd.to_datetime(game_stats_df['game_date'])
    # Initialize Gas Calculator
    gas_calc = GasCalculator(game_stats_df)

    # ── Load player-impact data (MoneyPuck-derived) ──────────────────────────
    player_impact_data = {}
    league_avg_impact  = {}
    name_lookup_data   = {}
    team_baselines_data = {}
    if _LINEUP_ENGINE_AVAILABLE:
        script_dir_pi = os.path.dirname(os.path.abspath(__file__))
        player_impact_data, league_avg_impact, name_lookup_data = load_player_impact(script_dir_pi)
        team_baselines_data = load_team_baselines(script_dir_pi)
        if player_impact_data:
            print(f"Player-impact data loaded: {len(player_impact_data)} players")
        else:
            print("[WARN] No player-impact data — predictions will use team ratings only")
        if team_baselines_data:
            print(f"Team baselines loaded: {len(team_baselines_data)} teams")

    # ── Load player stats for absence-decay computation ──────────────────────
    # Builds: team_game_dates  = {tri_code → sorted [date_str, ...]}
    #         player_last_game = {str(player_id) → last_date_str}
    EWMA_HALFLIFE = 7  # must match team_ratings.py ewm(halflife=7)
    team_game_dates = {}
    player_last_game = {}
    try:
        from player_impact import normalize_name as _norm_name
        _ps_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                '..', 'public', 'data',
                                'nhl_season_2025_2026_player_stats.csv')
        if not os.path.exists(_ps_path):
            _ps_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    'nhl_season_2025_2026_player_stats.csv')
        if os.path.exists(_ps_path):
            _ps_df = pd.read_csv(_ps_path)
            # Exclude goalies (they have is_goalie=1 or position='G')
            if 'is_goalie' in _ps_df.columns:
                _ps_df = _ps_df[_ps_df['is_goalie'] != 1]
            elif 'position' in _ps_df.columns:
                _ps_df = _ps_df[_ps_df['position'] != 'G']
            # Team game dates: every unique date a team played
            for team_tri, grp in _ps_df.groupby('team'):
                team_game_dates[team_tri] = sorted(grp['date'].unique())
            # Player last game: keyed by player_id (matches MoneyPuck player IDs)
            if 'player_id' in _ps_df.columns:
                for pid_val, grp in _ps_df.groupby('player_id'):
                    player_last_game[str(int(pid_val))] = grp['date'].max()
            print(f"Absence-decay data loaded: {len(team_game_dates)} teams, "
                  f"{len(player_last_game)} player records")
        else:
            print("[WARN] player_stats.csv not found — absence decay disabled")
    except Exception as e:
        print(f"[WARN] Could not load player stats for absence decay: {e}")

    # League Average xG
    league_xg = 3.13
    
    # Load Existing Predictions (for freezing live/past games)
    existing_predictions = load_existing_predictions('../data/predictions_detailed.csv')
    
    # --- NEW: Fetch Fresh DFO Data ---
    print("Fetching fresh Daily Faceoff Goalie data...")
    try:
        fetch_dailyfaceoff.fetch_dailyfaceoff_goalies()
    except Exception as e:
        print(f"Warning: Failed to fetch DFO goalies: {e}")

    # Load Goalie Stats
    print("Loading official goalie stats...")
    goalie_stats_map = load_goalie_stats_json()
    
    print(f"Predicting {len(schedule)} games...")

    # Fetch Lineups for ALL 32 teams (not just today's games)
    # DailyFaceoff has line-combinations pages for every team regardless of game day.
    # This ensures team detail pages always show real lineup data.
    print("Fetching Lineups (all 32 teams)...")
    teams_to_fetch = []
    seen_teams = set()

    # Start with teams in today's schedule
    for game in schedule:
        home_tri = game.get('homeTeamAbbrev')
        away_tri = game.get('awayTeamAbbrev')
        home_name = game.get('homeTeam') 
        away_name = game.get('awayTeam')
        
        if home_tri and home_tri not in seen_teams:
            seen_teams.add(home_tri)
            f_name = full_names.get(home_tri, home_name)
            teams_to_fetch.append({'triCode': home_tri, 'teamName': f_name})
            
        if away_tri and away_tri not in seen_teams:
            seen_teams.add(away_tri)
            f_name = full_names.get(away_tri, away_name)
            teams_to_fetch.append({'triCode': away_tri, 'teamName': f_name})

    # Add remaining teams not in today's schedule so every team has real lineup data
    for tri, f_name in full_names.items():
        if tri not in seen_teams:
            seen_teams.add(tri)
            teams_to_fetch.append({'triCode': tri, 'teamName': f_name})

    try:
        team_lineups = fetch_dailyfaceoff.fetch_lineups(teams_to_fetch)
    except Exception as e:
        print(f"Error fetching lineups: {e}")
        team_lineups = {}

    # ── Enrich IR players with impact scores (done once, before the game loop) ─
    # Must happen here so frozen-game lineup updates (which run early in the loop)
    # also get the enriched data.  Modifies team_lineups dicts in place.
    if player_impact_data:
        for tri, lineup_dict in team_lineups.items():
            ir_players = lineup_dict.get('ir', [])
            if not ir_players:
                continue
            for p in ir_players:
                data = lookup_player(
                    p.get('id'), p.get('name', ''),
                    player_impact_data, name_lookup_data
                )
                p['impact'] = round(data['ev_xgf_per60'], 4) if data else None
            ir_players.sort(key=lambda x: x.get('impact') or 0, reverse=True)
        print(f"  IR enrichment done for {sum(1 for l in team_lineups.values() if l.get('ir'))} teams with IR players")

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

    for i, game in enumerate(schedule):
        home_team = game['homeTeam']
        away_team = game['awayTeam']
        home_tri  = game.get('homeTeamAbbrev')
        away_tri  = game.get('awayTeamAbbrev')

        # Use the explicit gameDate we saved, or fallback to parsing if missing
        game_date = game.get('gameDate')
        if not game_date:
            game_date = game.get('startTimeUTC', '')[:10]
        
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
        
        # ── [V3] LINEUP-AWARE xG ADJUSTMENT (replaces hardcoded star penalty) ──────
        # Uses MoneyPuck player-level impact data to estimate each team's 5v5
        # offensive and defensive strength from the actual projected lineup.
        #
        # Previously: hardcoded "key players" dict + blanket 7% penalty per absence.
        # Now: each player's real ev_xgf_per60 / ev_xga_per60 from 100+ game seasons
        # of NHL play-by-play, blended 30% lineup / 70% team rating.
        #
        # DailyFaceoff lineup player objects include `id` (NHL player ID) which
        # matches MoneyPuck's playerId — no name-matching needed for most players.

        h_news_list = player_news.get(home_tri, [])
        a_news_list = player_news.get(away_tri, [])

        h_lineup = team_lineups.get(home_tri, {})
        a_lineup = team_lineups.get(away_tri, {})

        h_lineup_result = {'xgf_rate': None, 'xga_rate': None,
                           'players_found': 0, 'total_players': 0, 'reliable': False}
        a_lineup_result = {'xgf_rate': None, 'xga_rate': None,
                           'players_found': 0, 'total_players': 0, 'reliable': False}

        if player_impact_data and league_avg_impact:
            h_lineup_result = estimate_lineup_xg(h_lineup, player_impact_data, league_avg_impact, name_lookup_data)
            a_lineup_result = estimate_lineup_xg(a_lineup, player_impact_data, league_avg_impact, name_lookup_data)

        # Legacy star-penalty: kept as a safety net for games where lineup data
        # is unavailable (pre-game, empty lineups). When lineup data IS reliable,
        # the lineup estimate already captures all missing players automatically.
        h_star_penalty = 0.0
        a_star_penalty = 0.0


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
        
        # New: Cross-reference with Player News for Goalie confirmation
        # If DFO news says "Goalie Start", we force it to Confirmed even if schedule isn't updated yet
        for news_item in h_news_list:
            if news_item.get('category') == 'Goalie Start':
                p_news_name = news_item.get('player', '')
                if h_goalie_name and (h_goalie_name in p_news_name or p_news_name in h_goalie_name):
                    h_status = "Confirmed"
                    break
        
        for news_item in a_news_list:
            if news_item.get('category') == 'Goalie Start':
                p_news_name = news_item.get('player', '')
                if a_goalie_name and (a_goalie_name in p_news_name or p_news_name in a_goalie_name):
                    a_status = "Confirmed"
                    break

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




        # Get Special Teams Ranks (For Output)
        h_st_ranks = st_rankings.get(home_team, {'pp_rank': 16, 'pk_rank': 16})
        a_st_ranks = st_rankings.get(away_team, {'pp_rank': 16, 'pk_rank': 16})
        
        h_ranks = {'pp_rank': h_st_ranks['pp_rank'], 'pk_rank': h_st_ranks['pk_rank']}
        a_ranks = {'pp_rank': a_st_ranks['pp_rank'], 'pk_rank': a_st_ranks['pk_rank']}

        h_ratings = team_ratings.get(home_team, {})
        a_ratings = team_ratings.get(away_team, {})
        
        # 1. Base 5v5 xG (Using 5v5 Ratings)
        h_xgf_5v5 = h_ratings.get('xgf_5v5_rating', h_ratings.get('xgf_rating', 2.0))
        a_xga_5v5 = a_ratings.get('xga_5v5_rating', a_ratings.get('xga_rating', 2.0))

        a_xgf_5v5 = a_ratings.get('xgf_5v5_rating', a_ratings.get('xgf_rating', 2.0))
        h_xga_5v5 = h_ratings.get('xga_5v5_rating', h_ratings.get('xga_rating', 2.0))

        # ── Lineup blending (ratio-based) ───────────────────────────────────
        # We use a RATIO approach rather than a direct additive blend.
        #
        # Why: ev_xgf_per60 (MoneyPuck) and xgf_5v5_rating (Pythagorean model)
        # are on different absolute scales and cannot be directly averaged.
        # Instead we compute:
        #
        #   quality_ratio = lineup_xgf_estimate / league_avg_lineup_xgf
        #
        # A ratio > 1.0 means the lineup is above-average; < 1.0 means depleted.
        # We apply that fractional deviation as a multiplier on the team rating:
        #
        #   adjusted = team_rating * ((1 - w) + w * quality_ratio)
        #
        # At 30% weight with a league-avg lineup (ratio = 1.0): no change.
        # At 30% weight with a 10% above-avg lineup (ratio = 1.10):
        #   adjusted = team_rating * (0.70 + 0.30 * 1.10) = team_rating * 1.03
        #
        # This is scale-invariant and degrades gracefully when lineup data is
        # unavailable (ratio → 1.0 when no reliable match).

        league_xgf_rate = league_avg_impact.get('league_xgf_rate', 2.38)
        league_xga_rate = league_avg_impact.get('league_xga_rate', 2.43)

        # ── Absence-decay helper ─────────────────────────────────────────────
        # For each MoneyPuck roster player NOT in tonight's lineup, compute how
        # many team games they've missed.  Return a decay factor per absent
        # player: 0.5^(games_missed / EWMA_HALFLIFE).
        #
        # decay ≈ 1.0 → freshly absent (EWMA hasn't absorbed → full penalty)
        # decay ≈ 0.0 → long-term absent (EWMA has absorbed → no penalty)

        def _compute_absence_decay(team_tri, lineup):
            """Return average decay factor for all absent high-impact players.

            1.0 = all absences are fresh (full lineup penalty should apply)
            < 1.0 = some/all absences are old (team rating has partially absorbed)
            """
            if not team_game_dates or not player_impact_data or not lineup:
                return 1.0  # no data → assume fresh (full penalty)

            my_dates = team_game_dates.get(team_tri, [])
            if not my_dates:
                return 1.0

            # Identify lineup player names (normalized) for exclusion
            lineup_names = set()
            for line_id, players in lineup.items():
                if not line_id.startswith('f') and not line_id.startswith('d'):
                    continue
                for p in players:
                    if isinstance(p, dict) and p.get('name'):
                        lineup_names.add(_norm_name(p['name']))

            # Find all MoneyPuck roster players for this team who are NOT in lineup
            absent_players = []
            for pid, data in player_impact_data.items():
                if data.get('team') != team_tri:
                    continue
                pname_norm = _norm_name(data.get('name', ''))
                if pname_norm in lineup_names:
                    continue  # they're playing tonight
                # Only consider players with meaningful TOI (not injured-all-season fringe)
                if data.get('ev_toi_per_game', 0) < 300:  # 5 min/game minimum
                    continue

                # How many team games since they last played?
                # Use MoneyPuck player ID (pid) to look up in player_stats data
                last_game = player_last_game.get(pid)
                if last_game is None:
                    continue  # can't determine — skip
                games_missed = len([d for d in my_dates if d > last_game])
                if games_missed == 0:
                    continue  # played in team's last game; just not in tonight's DFO lineup yet

                decay = 0.5 ** (games_missed / EWMA_HALFLIFE)
                absent_players.append({
                    'name': data.get('name'),
                    'ev_toi_per_game': data.get('ev_toi_per_game', 0),
                    'games_missed': games_missed,
                    'decay': decay
                })

            if not absent_players:
                return 1.0  # no known absences → full penalty weight applies

            # Weighted average decay by TOI (high-TOI players dominate)
            total_toi = sum(a['ev_toi_per_game'] for a in absent_players)
            if total_toi == 0:
                return 1.0
            weighted_decay = sum(a['decay'] * a['ev_toi_per_game']
                                 for a in absent_players) / total_toi

            return weighted_decay

        h_absence_decay = _compute_absence_decay(home_tri, h_lineup)
        a_absence_decay = _compute_absence_decay(away_tri, a_lineup)

        def _lineup_quality(lineup_result, key, league_baseline, absence_decay=1.0):
            """Return quality ratio for a team's lineup vs league average.

            lineup_result[key] is a TOI-weighted avg ev_xgf_per60 or ev_xga_per60
            across all 18 players in tonight's projected lineup.

            absence_decay (0-1) scales the deviation by how "novel" the absences
            are — long-term absences (decay≈0) have already been absorbed by the
            team's EWMA rating, so we don't double-count them.

            Tiered amplification: larger deviations (star absent/present) get a
            proportionally stronger blend weight, capped at 0.80.
            """
            if (lineup_result.get('reliable') and
                    lineup_result.get(key) is not None and
                    league_baseline > 0):
                match_ratio = (lineup_result['players_found'] /
                               max(lineup_result['total_players'], 1))
                raw_ratio   = lineup_result[key] / league_baseline
                deviation   = abs(raw_ratio - 1.0)

                # Tiered amplification: bigger deviations → stronger blend weight
                amplified_weight = min(0.80, LINEUP_BLEND_WEIGHT * (1.0 + deviation * 4.0))

                # Scale the deviation by absence_decay to prevent double-counting
                decayed_deviation = (raw_ratio - 1.0) * absence_decay

                return 1.0 + decayed_deviation * match_ratio * amplified_weight
            return 1.0   # no adjustment when lineup data unavailable

        h_xgf_quality = _lineup_quality(h_lineup_result, 'xgf_rate', league_xgf_rate, h_absence_decay)
        h_xga_quality = _lineup_quality(h_lineup_result, 'xga_rate', league_xga_rate, h_absence_decay)
        a_xgf_quality = _lineup_quality(a_lineup_result, 'xgf_rate', league_xgf_rate, a_absence_decay)
        a_xga_quality = _lineup_quality(a_lineup_result, 'xga_rate', league_xga_rate, a_absence_decay)

        # ── vs-team ratio (display only, not used in prediction math) ────────
        # Compare tonight's lineup rate to this team's historical TOI-weighted
        # average across all qualified roster players.  Shows whether tonight's
        # projected lines are stronger or weaker than their typical deployment.
        def _vs_team_ratio(lineup_result, key, team_tri):
            """Raw lineup_rate / team_baseline_rate — no blend weight."""
            if not (lineup_result.get('reliable') and
                    lineup_result.get(key) is not None):
                return None
            baseline = team_baselines_data.get(team_tri, {}).get(key)
            if not baseline or baseline <= 0:
                return None
            return round(lineup_result[key] / baseline, 4)

        h_lineup_vs_team = _vs_team_ratio(h_lineup_result, 'xgf_rate', home_tri)
        a_lineup_vs_team = _vs_team_ratio(a_lineup_result, 'xgf_rate', away_tri)

        h_xgf_blended = h_xgf_5v5 * h_xgf_quality
        h_xga_blended = h_xga_5v5 * h_xga_quality
        a_xgf_blended = a_xgf_5v5 * a_xgf_quality
        a_xga_blended = a_xga_5v5 * a_xga_quality

        if h_lineup_result.get('reliable'):
            print(f"  [LINEUP RATIO] {home_team}: xGF qual={h_xgf_quality:.3f}  xGA qual={h_xga_quality:.3f}")
        if a_lineup_result.get('reliable'):
            print(f"  [LINEUP RATIO] {away_team}: xGF qual={a_xgf_quality:.3f}  xGA qual={a_xga_quality:.3f}")

        # Predictive Formula: (Offense * Defense) / League_Avg
        h_xg_base = (h_xgf_blended * a_xga_blended) / league_xg_5v5
        a_xg_base = (a_xgf_blended * h_xga_blended) / league_xg_5v5
        

        
        # 2. Add Home Ice (Data Driven coeff)
        h_xg_base += HOME_ICE_VAL
        
        # 3. Special Teams (Volume * Efficiency * Value)
        # Volume: (My Drawn + Opp Taken) / 2
        h_drawn = h_ratings.get('penalties_drawn_per_60', 3.0)
        a_taken = a_ratings.get('penalties_taken_per_60', 3.0)
        h_proj_opps = (h_drawn + a_taken) / 2.0
        
        a_drawn = a_ratings.get('penalties_drawn_per_60', 3.0)
        h_taken = h_ratings.get('penalties_taken_per_60', 3.0)
        a_proj_opps = (a_drawn + h_taken) / 2.0
        
        # Efficiency Factor: My Rating / League Avg
        # team_ratings 'pp_rating' is scaled to 100 (e.g. 25.0)
        h_pp_eff = (h_ratings.get('pp_rating', 20.0) / 100.0) / avg_pp_pct
        a_pp_eff = (a_ratings.get('pp_rating', 20.0) / 100.0) / avg_pp_pct
        
        # Opponent PK Strength Factor
        # Higher PK rating = Stronger PK = Lower Factor
        # Factor = Avg_PK / Team_PK
        # e.g. Avg=0.80, Team=0.90 -> 0.88 (Lowers xG)
        h_pk_impact = avg_pk_pct / (h_ratings.get('pk_rating', 80.0) / 100.0) if h_ratings.get('pk_rating') else 1.0
        a_pk_impact = avg_pk_pct / (a_ratings.get('pk_rating', 80.0) / 100.0) if a_ratings.get('pk_rating') else 1.0

        # Home PP vs Away PK
        h_pp_xg = h_proj_opps * ST_VAL_PP * h_pp_eff * a_pk_impact
        # Away PP vs Home PK
        a_pp_xg = a_proj_opps * ST_VAL_PP * a_pp_eff * h_pk_impact
        

        
        # 4. Rest Penalty (Data Driven B2B)
        # Determine if teams are on B2B
        h_rest_pen = 0.0
        dates_h = sorted(game_stats_df[game_stats_df['team'] == home_team]['game_date'].tolist())
        if dates_h:
            last_dt_val = dates_h[-1]
            # Handle Timestamp or String
            if hasattr(last_dt_val, 'strftime'): # Is datetime/Timestamp
                 last_dt = last_dt_val
            else:
                 try:
                    last_dt = datetime.strptime(last_dt_val, "%Y-%m-%d")
                 except:
                    last_dt = datetime.now() # Fallback

            curr_dt = datetime.strptime(game_date, "%Y-%m-%d")
            if (curr_dt - last_dt).days <= 1:
                h_rest_pen = B2B_PENALTY
                print(f"  [B2B] {home_team} is tired (-{B2B_PENALTY:.2f})")
            
            # Check 3-in-4
            # Game 1 (2 games ago) -> Date gap <= 3?
            if len(dates_h) >= 2:
                 prev_2_dt_val = dates_h[-2]
                 # simplified parsing
                 try:
                    p2_dt = datetime.strptime(prev_2_dt_val, "%Y-%m-%d") if isinstance(prev_2_dt_val, str) else prev_2_dt_val
                    if (curr_dt - p2_dt).days <= 3:
                        h_rest_pen += abs(IN3_4_PENALTY) # Additive penalty
                        print(f"  [3-in-4] {home_team} grinding (-{abs(IN3_4_PENALTY):.2f})")
                 except:
                    pass

        a_rest_pen = 0.0
        dates_a = sorted(game_stats_df[game_stats_df['team'] == away_team]['game_date'].tolist())
        if dates_a:
            last_dt_val = dates_a[-1]
            if hasattr(last_dt_val, 'strftime'):
                 last_dt = last_dt_val
            else:
                 try:
                     last_dt = datetime.strptime(last_dt_val, "%Y-%m-%d")
                 except:
                     last_dt = datetime.now()

            curr_dt = datetime.strptime(game_date, "%Y-%m-%d")
            if (curr_dt - last_dt).days <= 1:
                a_rest_pen = B2B_PENALTY
                print(f"  [B2B] {away_team} is tired (-{B2B_PENALTY:.2f})")
            
            # Check 3-in-4
            if len(dates_a) >= 2:
                 prev_2_dt_val = dates_a[-2]
                 try:
                    p2_dt = datetime.strptime(prev_2_dt_val, "%Y-%m-%d") if isinstance(prev_2_dt_val, str) else prev_2_dt_val
                    if (curr_dt - p2_dt).days <= 3:
                        a_rest_pen += abs(IN3_4_PENALTY)
                        print(f"  [3-in-4] {away_team} grinding (-{abs(IN3_4_PENALTY):.2f})")
                 except:
                    pass
        
        # Combine Components
        h_xg = h_xg_base + h_pp_xg - h_rest_pen
        a_xg = a_xg_base + a_pp_xg - a_rest_pen
        
        # Debugging Output
        # print(f"  {home_team} xG Breakdown: Base={h_xg_base:.2f}, PP={h_pp_xg:.2f}, Rest=-{h_rest_pen}, Home={HOME_ICE_VAL}")

        # Star penalty is now handled implicitly by lineup blending.
        # h_star_penalty and a_star_penalty remain 0.0 (safety net; no-op).
        
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

        # --- GAS LOGIC REMOVED (Replaced by Data-Driven B2B/3in4 Penalties) ---
        # h_boost = 1.0
        # a_boost = 1.0


        # --- EXPLANATION TRACKING ---
        h_explained = []
        a_explained = []
        
        # 1. Base Components Breakdown
        # 5v5 Raw (using blended values)
        h_5v5_raw = (h_xgf_blended * a_xga_blended) / league_xg_5v5
        a_5v5_raw = (a_xgf_blended * h_xga_blended) / league_xg_5v5

        h_explained.append(f"5v5 Matchup: {h_5v5_raw:.2f}")
        a_explained.append(f"5v5 Matchup: {a_5v5_raw:.2f}")

        # Lineup quality note — show ratio and direction so it's readable
        if h_lineup_result['reliable']:
            found = h_lineup_result['players_found']
            total = h_lineup_result['total_players']
            pct   = (h_xgf_quality - 1.0) * 100
            sign  = '+' if pct >= 0 else ''
            h_explained.append(f"Lineup ({found}/{total}): {sign}{pct:.1f}% quality")
        # Away team's defensive lineup quality affects HOME team's xG
        if a_lineup_result['reliable']:
            opp_def_pct = (a_xga_quality - 1.0) * 100
            opp_sign    = '+' if opp_def_pct >= 0 else ''
            h_explained.append(f"Opp Lineup (def): {opp_sign}{opp_def_pct:.1f}% quality")

        if a_lineup_result['reliable']:
            found = a_lineup_result['players_found']
            total = a_lineup_result['total_players']
            pct   = (a_xgf_quality - 1.0) * 100
            sign  = '+' if pct >= 0 else ''
            a_explained.append(f"Lineup ({found}/{total}): {sign}{pct:.1f}% quality")
        # Home team's defensive lineup quality affects AWAY team's xG
        if h_lineup_result['reliable']:
            opp_def_pct = (h_xga_quality - 1.0) * 100
            opp_sign    = '+' if opp_def_pct >= 0 else ''
            a_explained.append(f"Opp Lineup (def): {opp_sign}{opp_def_pct:.1f}% quality")
        
        # Home Ice
        h_explained.append(f"Home Ice: +{HOME_ICE_VAL:.2f}")
        
        # Special Teams
        h_explained.append(f"Special Teams: +{h_pp_xg:.2f}")
        a_explained.append(f"Special Teams: +{a_pp_xg:.2f}")
        
        # Rest
        if h_rest_pen > 0: h_explained.append(f"Rest Penalty: -{h_rest_pen:.2f}")
        if a_rest_pen > 0: a_explained.append(f"Rest Penalty: -{a_rest_pen:.2f}")

        # (Star penalty note removed — lineup blending now handles player absences)

        # Saturday Boost
        if is_sat_boost:
             h_explained.append("Saturday Boost: +0.25")

        # 2. Goalie Impact
        # h_xg_adj = max(0.1, h_xg - (a_gsax * GOALIE_IMPACT_FACTOR))
        h_goalie_impact = -(a_gsax * GOALIE_IMPACT_FACTOR)
        a_goalie_impact = -(h_gsax * GOALIE_IMPACT_FACTOR)
        
        if abs(h_goalie_impact) > 0.01:
            h_explained.append(f"Opp Goalie ({a_starter_clean}): {h_goalie_impact:+.2f}")
        if abs(a_goalie_impact) > 0.01:
            a_explained.append(f"Opp Goalie ({h_starter_clean}): {a_goalie_impact:+.2f}")

        # 3. History Adjustment
        if abs(h_hist_adj) > 0.001:
            h_explained.append(f"vs Opp History: {h_hist_adj:+.2f}")
        if abs(a_hist_adj) > 0.001:
            a_explained.append(f"vs Opp History: {a_hist_adj:+.2f}")

        # 4. GAS / Fatigue (Pre-calculated in breakdown, but let's add summary if impactful)
        # Recalculating effectively used penalties.
        # Since GAS logic was removed/commented out effectively in lines 1070+, we check if we add anything back.
        # It seems only "data-driven" penalties might be added later? 
        # Looking at code: No direct GAS modification to xG currently active in lines 1074+.
        # Wait, lines 1074-1075 use h_hist_adj but NO GAS variable.
        # If GAS is re-enabled or used elsewhere, we capture it. For now, it seems unused in xG.
        
        h_xg_adj = max(0.1, h_xg + h_goalie_impact) + h_hist_adj
        a_xg_adj = max(0.1, a_xg + a_goalie_impact) + a_hist_adj
        
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
            
            if pd.isna(pdo): pdo = 1000
            
            # Hits Calc
            hits = recent['hits_for'].mean()
            if pd.isna(hits): hits = 20
            return pdo, hits

        # Fetch Pre-Game Trends
        h_pdo, h_hits = get_trend_stats(home_team, game_stats_df, game_date)
        a_pdo, a_hits = get_trend_stats(away_team, game_stats_df, game_date)
        
        # 1. PDO Momentum (Reward the "Lucky"/Good)
        # If I have high PDO and you have low, I am playing better.
        pdo_diff = h_pdo - a_pdo
        
        h_pre_pdo = h_xg_adj
        a_pre_pdo = a_xg_adj
        
        if pdo_diff > 40: # e.g. 1020 vs 980
            print(f"  [PDO MOMENTUM] {home_team} (PDO {h_pdo:.0f}) vs {away_team} (PDO {a_pdo:.0f}) -> +5% Boost")
            h_xg_adj *= 1.05
            h_explained.append(f"PDO Momentum ({h_pdo:.0f} vs {a_pdo:.0f}): +0.05%") # Actually 5%
        elif pdo_diff < -40:
            print(f"  [PDO MOMENTUM] {away_team} (PDO {a_pdo:.0f}) vs {home_team} (PDO {h_pdo:.0f}) -> +5% Boost")
            a_xg_adj *= 1.05
            a_explained.append(f"PDO Momentum ({a_pdo:.0f} vs {h_pdo:.0f}): +0.05%")

        # Capture PDO delta
        if h_xg_adj != h_pre_pdo: h_explained[-1] = f"PDO Momentum: {h_xg_adj - h_pre_pdo:+.2f}"
        if a_xg_adj != a_pre_pdo: a_explained[-1] = f"PDO Momentum: {a_xg_adj - a_pre_pdo:+.2f}"

        # 2. Possession Proxy (Anti-Hits)
        # If I hit a lot more than you, I am chasing the puck.
        hits_diff = h_hits - a_hits
        
        h_pre_hits = h_xg_adj
        a_pre_hits = a_xg_adj
        
        if hits_diff > 8: # Home hits way more
            print(f"  [CHASING PLAY] {home_team} Avg Hits +{hits_diff:.1f} vs {away_team} -> -3% Penalty")
            h_xg_adj *= 0.97
            h_explained.append(f"Chasing Play (Hits +{hits_diff:.0f}): -3%")
        elif hits_diff < -8: # Away hits way more
            print(f"  [CHASING PLAY] {away_team} Avg Hits +{abs(hits_diff):.1f} vs {home_team} -> -3% Penalty")
            a_xg_adj *= 0.97
            a_explained.append(f"Chasing Play (Hits +{abs(hits_diff):.0f}): -3%")
            
        # Capture Hits delta
        if h_xg_adj != h_pre_hits: h_explained[-1] = f"Heavy Hitting (Chasing): {h_xg_adj - h_pre_hits:+.2f}"
        if a_xg_adj != a_pre_hits: a_explained[-1] = f"Heavy Hitting (Chasing): {a_xg_adj - a_pre_hits:+.2f}"

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
        # Construct unique matchup ID for specific game lookup
        matchup_id = f"{game_date}:{away_team}@{home_team}"
        game_odds = odds_data.get(matchup_id, {})
        h_odds = game_odds.get(home_team)
        a_odds = game_odds.get(away_team)
        
        # Date check removed to allow odds for upcoming games (e.g. tomorrow)
        # Verify odds are relevant in fetch_odds logic, but trust odds.json here.

             
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

        # Get Features
        h_h2h, a_h2h = get_h2h_record(home_team, away_team, game_date, game_stats_df)
        h_spark = get_xg_sparkline(home_team, game_date, game_stats_df)
        a_spark = get_xg_sparkline(away_team, game_date, game_stats_df)
        h_is_b2b, h_is_3in4, h_is_4in6, h_is_6in9 = get_fatigue_flags(home_team, game_date, game_stats_df)
        a_is_b2b, a_is_3in4, a_is_4in6, a_is_6in9 = get_fatigue_flags(away_team, game_date, game_stats_df)

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
            
            # --- xG EXPLANATIONS ---
            'home_xg_explained': json.dumps(h_explained),
            'away_xg_explained': json.dumps(a_explained),
            
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

            # Lineup quality scores — dimensionless ratio vs league average.
            # 1.0 = exactly league average; 1.05 = 5% above; 0.95 = 5% below.
            # Only meaningful when lineup data is reliable (>= MIN_LINEUP_MATCHES).
            'home_lineup_score': round(h_xgf_quality, 4) if h_lineup_result.get('reliable') else '',
            'away_lineup_score': round(a_xgf_quality, 4) if a_lineup_result.get('reliable') else '',

            # Lineup quality vs this team's own historical average (display only).
            # 1.0 = same as team's typical lineup; 1.05 = tonight +5% stronger than usual.
            'home_lineup_vs_team': round(h_lineup_vs_team, 4) if h_lineup_vs_team is not None else '',
            'away_lineup_vs_team': round(a_lineup_vs_team, 4) if a_lineup_vs_team is not None else '',
            
            # Serialize lists to JSON string for CSV
            'home_l7_games': json.dumps(h_l7_games),
            'away_l7_games': json.dumps(a_l7_games),
            
            'home_gas': home_gas,
            'away_gas': away_gas,
            
            'home_gas_breakdown': home_gas_breakdown,
            'away_gas_breakdown': away_gas_breakdown,
            'home_gsax': round(h_gsax, 3) if h_goalie_name else '',
            'away_gsax': round(a_gsax, 3) if a_goalie_name else '',
            'home_gsax_total': h_gsax_total,
            'home_gsax_pct': h_gsax_pct,
            'away_gsax_total': a_gsax_total,
            'away_gsax_pct': a_gsax_pct,
            
            'home_goalie_stats': home_g_stat, # (W-L-O) | SV% | GAA
            'away_goalie_stats': away_g_stat,
            
            # Goalie Status
            'home_goalie_status': h_status if h_status else 'Unconfirmed',
            'home_goalie_confirmed': h_conf if h_conf else '',
            'away_goalie_status': a_status if a_status else 'Unconfirmed',
            'away_goalie_confirmed': a_conf if a_conf else '',

            # Goalie vs Opp History
            'home_starter_vs_opp': json.dumps(h_vs_opp_stats) if h_vs_opp_stats else "",
            'away_starter_vs_opp': json.dumps(a_vs_opp_stats) if a_vs_opp_stats else "",
            
            # --- EDGE FACTORS ---
            'home_avg_speed': edge_profiles.get(str(team_ids_map.get(home_team)), {}).get('avg_speed', ''),
            'away_avg_speed': edge_profiles.get(str(team_ids_map.get(away_team)), {}).get('avg_speed', ''),
            'home_rr_rate': edge_profiles.get(str(team_ids_map.get(home_team)), {}).get('rr_rate', ''),
            'away_rr_rate': edge_profiles.get(str(team_ids_map.get(away_team)), {}).get('rr_rate', ''),
            
            # NEW DATA POINTS
            'home_h2h_record': h_h2h,
            'away_h2h_record': a_h2h,
            'home_is_b2b': h_is_b2b,
            'away_is_b2b': a_is_b2b,
            'home_is_3in4': h_is_3in4,
            'away_is_3in4': a_is_3in4,
            'home_is_4in6': h_is_4in6,
            'away_is_4in6': a_is_4in6,
            'home_is_6in9': h_is_6in9,
            'away_is_6in9': a_is_6in9,
            'home_xg_sparkline': json.dumps(h_spark),
            'away_xg_sparkline': json.dumps(a_spark)
        })        

    # Save Last Update Timestamp for Frontend (US/Central)
    utc_now = datetime.now(timezone.utc)
    central = pytz.timezone('US/Central')
    timestamp = utc_now.astimezone(central).strftime("%B %d, %Y, %I:%M %p")
    
    # Define paths relative to the script location
    script_dir = os.path.dirname(os.path.abspath(__file__))
    pred_paths = [
        os.path.join(script_dir, '../data/predictions_detailed.csv'),
        os.path.join(script_dir, '../public/data/predictions_detailed.csv'),
        os.path.join(script_dir, 'data/predictions_detailed.csv') # Fallback if running from root
    ]
    
    # Always save last_updated.json
    for p in pred_paths:
        try:
            lu_dir = os.path.dirname(p)
            os.makedirs(lu_dir, exist_ok=True)
            lu_path = os.path.join(lu_dir, 'last_updated.json')
            with open(lu_path, 'w') as f:
                json.dump({"last_refresh": timestamp}, f)
        except Exception as e:
            pass

    # Create DataFrame from csv_rows
    if not csv_rows:
        print("Warning: No predictions generated. Skipping save.")
        print(f"Done. Refresh timestamp updated at {timestamp}")
        return
        
    df_pred = pd.DataFrame(csv_rows)
    
    # Save CSV to all valid paths
    for p in pred_paths:
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            df_pred.to_csv(p, index=False)
            print(f"Saved prediction data to {p}")
        except Exception as e:
            # Silently fail for paths that don't exist in the current environment
            pass

    print(f"Done. Predictions updated at {timestamp}")

if __name__ == "__main__":
    predict()
