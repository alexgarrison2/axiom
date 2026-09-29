import json
import csv
import random
import math
import copy
import urllib.request
import ssl
import os
import sys
import datetime

# Configuration
SIMULATIONS = 5000
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# --- Data Loading Helpers ---

def load_json(path):
    with open(path, 'r') as f:
        return json.load(f)

def load_csv(path):
    rows = []
    with open(path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows

def fetch_current_standings():
    """Fetches live standings from NHL API."""
    print("Fetching current standings...")
    url = "https://api-web.nhle.com/v1/standings/now"
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, context=ctx) as response:
        data = json.load(response)
        
    standings = {}
    for team_data in data['standings']:
        abbrev = team_data['teamAbbrev']['default']
        # Extract tie-breaker info
        # needed: Points, Regulation Wins, ROW, Wins (Total)
        standings[abbrev] = {
            'pts': team_data['points'],
            'rw': team_data['regulationWins'],
            'row': team_data['regulationPlusOtWins'],
            'w': team_data['wins'],
            'l': team_data['losses'],
            'otl': team_data['otLosses'],
            'gp': team_data['gamesPlayed'],
            'conference': team_data['conferenceAbbrev'],
            'division': team_data['divisionAbbrev']
        }
    return standings

def build_team_map(teams_csv):
    """Maps Abbrev -> Common Name (for rating lookup)."""
    mapping = {}
    for row in teams_csv:
        mapping[row['Team Tricode']] = row['Common Name']
    return mapping

# --- Sim Logic ---

def get_game_prob(home_rating, away_rating):
    """
    Returns probability of Home Win, Tie (OT), Away Win.
    Using simple Poisson approximation or direct probability.
    
    Model:
    Home xG = (Home Off + Away Def) / 2 * HomeAdv
    Away xG = (Away Off + Home Def) / 2
    """
    # Simple Home Ice Advantage factor (approx +5% boost in goals)
    HOME_ADV = 1.05 
    
    # We use xG/60 ratings from team_ratings.json
    # Format: "xgf_rating", "xga_rating"
    
    h_xg = (home_rating['xgf_rating'] + away_rating['xga_rating']) / 2 * HOME_ADV
    a_xg = (away_rating['xgf_rating'] + home_rating['xga_rating']) / 2
    
    # Simulate scores? Or just return win prob?
    # For standings, we need to know if it went to OT (1 point each).
    # Approximately 23% of NHL games go to OT.
    # Win Prob formula (Bill James pythagorean or similar):
    # P(Home) = h_xg^2 / (h_xg^2 + a_xg^2)
    
    p_home_win_reg = 0.0
    p_away_win_reg = 0.0
    p_ot = 0.23 # Flat rate approximation is safer than complex poisson for now
    
    # Base probability of home being better
    total_xg = h_xg + a_xg
    if total_xg == 0:
        raw_prob_home = 0.5
    else:
        # A simple ratio model
        raw_prob_home = h_xg / (h_xg + a_xg)
        
    # Distribute the non-OT probability
    # If 23% go to OT, 77% end in Regulation
    # P(Home Reg Win) = 0.77 * raw_prob_home
    # P(Away Reg Win) = 0.77 * (1 - raw_prob_home)
    
    p_home_win_reg = 0.77 * raw_prob_home
    p_away_win_reg = 0.77 * (1.0 - raw_prob_home)
    
    # OT Winner Probs (assume 50/50 split of OT games for simplicity, or slightly favored to home)
    # P(Home OT Win) = 0.23 * raw_prob_home
    
    return p_home_win_reg, p_away_win_reg, p_ot, raw_prob_home

def simulate_season(base_standings, schedule, ratings, team_map):
    # Deep copy standings to mutate
    # Optimized: Dict copy
    current = {k: v.copy() for k, v in base_standings.items()}
    
    for game in schedule:
        h_abbr = game['home']
        a_abbr = game['away']
        
        h_name = team_map.get(h_abbr)
        a_name = team_map.get(a_abbr)
        
        # If ratings missing, assume 50/50 (average)
        # Using "Panthers" rating as dummy if missing is bad, better to have a default avg
        def_rating = {'xgf_rating': 3.0, 'xga_rating': 3.0}
        
        h_r = ratings.get(h_name, def_rating)
        a_r = ratings.get(a_name, def_rating)
        
        p_h_reg, p_a_reg, p_ot, raw_h = get_game_prob(h_r, a_r)
        
        r = random.random()
        
        if r < p_h_reg:
            # Home Regulation Win
            current[h_abbr]['pts'] += 2
            current[h_abbr]['w'] += 1
            current[h_abbr]['rw'] += 1
            current[h_abbr]['row'] += 1
            current[a_abbr]['l'] += 1
        elif r < (p_h_reg + p_a_reg):
            # Away Regulation Win
            current[a_abbr]['pts'] += 2
            current[a_abbr]['w'] += 1
            current[a_abbr]['rw'] += 1
            current[a_abbr]['row'] += 1
            current[h_abbr]['l'] += 1
        else:
            # OT Match
            # Both get 1 point guaranteed
            current[h_abbr]['pts'] += 1
            current[a_abbr]['pts'] += 1
            current[h_abbr]['otl'] += 1 # Only loser gets OTL, need to decide winner
            current[a_abbr]['otl'] += 1 # Temp, will fix winner below
            
            # Decide OT Winner
            # Re-roll or use raw prob
            r2 = random.random()
            if r2 < raw_h:
                # Home wins OT
                current[h_abbr]['pts'] += 1 # 2nd point
                current[h_abbr]['w'] += 1
                current[h_abbr]['row'] += 1
                current[h_abbr]['otl'] -= 1 # Correct logic: Winner doesn't get OTL
                # Away keeps OTL, gets 1 pt (already added)
            else:
                # Away wins OT
                current[a_abbr]['pts'] += 1
                current[a_abbr]['w'] += 1
                current[a_abbr]['row'] += 1
                current[a_abbr]['otl'] -= 1
                # Home keeps OTL
                
    return current

def determine_standings(standings):
    # Sort by PTS, RW, ROW, W
    # We need to sort list of (abbr, data)
    
    def sort_key(item):
        d = item[1]
        return (d['pts'], d['rw'], d['row'], d['w'])
        
    # Group by Div/Conf
    eastern = []
    western = []
    
    divs = {'A': [], 'M': [], 'C': [], 'P': []} # Atlantic, Metro, Central, Pacific
    
    for abbr, stats in standings.items():
        div = stats['division']
        # Map div char to full if needed, but API usually gives 'A', 'M', 'C', 'P' or 'ATL', 'MET'
        # Let's handle generic
        first_char = div[0]
        if first_char not in divs:
            divs[first_char] = [] # Safety
        divs[first_char].append((abbr, stats))
        
        if stats['conference'] == 'E':
            eastern.append((abbr, stats))
        else:
            western.append((abbr, stats))

    # Sort Divisions
    for k in divs:
        divs[k].sort(key=sort_key, reverse=True)
        
    # Sort Conferences (for Wild Card)
    eastern.sort(key=sort_key, reverse=True)
    western.sort(key=sort_key, reverse=True)
    
    return divs, eastern, western

def determine_playoff_bracket(divs, eastern, western):
    # NHL Format:
    # Top 3 in each Div make it.
    # Next 2 highest in Conference (Wild Cards) make it.
    
    # East
    atl_top3 = divs.get('A', [])[:3]
    met_top3 = divs.get('M', [])[:3]
    
    # Exclude top 3 from WC pool
    top3_abbrs = set([x[0] for x in atl_top3] + [x[0] for x in met_top3])
    east_wc = [x for x in eastern if x[0] not in top3_abbrs][:2]
    
    # West
    cen_top3 = divs.get('C', [])[:3]
    pac_top3 = divs.get('P', [])[:3]
    
    top3_abbrs_w = set([x[0] for x in cen_top3] + [x[0] for x in pac_top3])
    west_wc = [x for x in western if x[0] not in top3_abbrs_w][:2]
    
    # Matchups
    # Division Winner with Best Record plays WC 2
    # Division Winner with 2nd Best Record plays WC 1
    # Div #2 plays Div #3
    
    # Helper to get standings sort val
    def get_sort_val(x):
        return (x[1]['pts'], x[1]['rw'], x[1]['row'], x[1]['w'])
        
    # Bracket structure: List of Series
    bracket = {'East': [], 'West': []}
    
    # --- EAST ---
    atl_1 = atl_top3[0] if atl_top3 else None
    met_1 = met_top3[0] if met_top3 else None
    
    # Compare Div Winners
    if not atl_1 or not met_1: return None # Safety
    
    d1, d2 = (atl_1, met_1) if get_sort_val(atl_1) > get_sort_val(met_1) else (met_1, atl_1)
    
    # D1 plays WC2, D2 plays WC1
    series1 = (d1, east_wc[1])
    series2 = (d2, east_wc[0])
    
    # 2 vs 3
    series3 = (atl_top3[1], atl_top3[2])
    series4 = (met_top3[1], met_top3[2])
    
    bracket['East'] = [series1, series2, series3, series4]
    
    # --- WEST ---
    cen_1 = cen_top3[0] if cen_top3 else None
    pac_1 = pac_top3[0] if pac_top3 else None
    
    wd1, wd2 = (cen_1, pac_1) if get_sort_val(cen_1) > get_sort_val(pac_1) else (pac_1, cen_1)
    
    w_series1 = (wd1, west_wc[1])
    w_series2 = (wd2, west_wc[0])
    w_series3 = (cen_top3[1], cen_top3[2])
    w_series4 = (pac_top3[1], pac_top3[2])
    
    bracket['West'] = [w_series1, w_series2, w_series3, w_series4]
    
    return bracket

def simulate_series(team1, team2, ratings, team_map):
    # Best of 7
    # Determine home field (Higher seed/points)
    # Passed tuple is (Abbr, Stats)
    
    t1_abbr, t1_stats = team1
    t2_abbr, t2_stats = team2
    
    # Higher points = Home Field
    # Simple check on PTS
    if t1_stats['pts'] >= t2_stats['pts']:
        home, away = t1_abbr, t2_abbr
    else:
        home, away = t2_abbr, t1_abbr
        
    home_name = team_map.get(home)
    away_name = team_map.get(away)
    
    def_rating = {'xgf_rating': 3.0, 'xga_rating': 3.0}
    h_r = ratings.get(home_name, def_rating)
    a_r = ratings.get(away_name, def_rating)
    
    p_h_reg, p_a_reg, p_ot, raw_h = get_game_prob(h_r, a_r)
    # Win prob including OT
    p_home_win = p_h_reg + (p_ot * raw_h)
    
    h_wins = 0
    a_wins = 0
    
    while h_wins < 4 and a_wins < 4:
        if random.random() < p_home_win:
            h_wins += 1
        else:
            a_wins += 1
            
    return home if h_wins == 4 else away

def run_playoffs(bracket, ratings, team_map):
    # East Round 1
    # Bracket structure is NOT perfect for standard flow, need to know WHO PLAYS WHO in R2.
    # NHL Bracket is Fixed.
    # Atl Bracket: (A1 vs WC) vs (A2 vs A3)
    # Met Bracket: (M1 vs WC) vs (M2 vs M3)
    # BUT wait... Wild Cards cross over.
    # If A1 plays WC2 (who is actually a Metro team), they constitute the "Atlantic" bracket side?
    # Correct Logic: 
    # The winner of (Div1 vs WC) plays winner of (Div2 vs Div3).
    # We need to identify which series corresponds to which division slot.
    
    # Re-logic Determine Bracket to be more structured
    pass
    # ... Refactor bracket structure inside simulation for simplicity
    # Let's simplify:
    # Just return the 8 series winners, then match them up.
    # Actually, A1/WC plays A2/A3. 
    # We need to know WHICH series is which.
    
    # Let's just assume standard bracket paths:
    # winners of [East 1, 2, 3, 4] -> Semi [1v3, 2v4]? No.
    # It's (D1 vs WC) vs (D2 vs D3).
    
    # We need to track the "Atlantic" and "Metro" brackets.
    # In 'determine_playoff_bracket', we found D1 and D2.
    # If D1 was Atlantic, then series1 is Atlantic Bracket side 1. 
    # series3 is A2 vs A3.
    # So Winner(Series1) plays Winner(Series3).
    
    # Let's do a quick hack: logic in 'determine' was:
    # series1 = D1 vs WC2
    # series2 = D2 vs WC1
    # series3 = A2 vs A3
    # series4 = M2 vs M3
    
    # If D1 is ATL, then ATL_Bracket = Winner(S1) vs Winner(S3).
    # If D1 is MET, then MET_Bracket = Winner(S1) vs Winner(S4).
    # ... this is getting complex due to crossover.
    
    # Correct Crossover Rule:
    # If WC1 comes from Atlantic, and plays M1... they are in Metro bracket.
    # The bracket is defined by the DIVISION LEADER.
    # So:
    # Bracket A: (Atl #1 vs WC) AND (Atl #2 vs Atl #3)
    # Bracket M: (Met #1 vs WC) AND (Met #2 vs Met #3)
    # The winners of these two sub-brackets meet in East Final.
    
    # Let's implement that flow.
    return None

def fetch_remaining_schedule():
    """
    Fetches all unplayed regular-season games (today onward) from the NHL API.
    Walks week-by-week until the season end date, collecting only FUT/PRE games.
    Falls back to the static remaining_schedule.json filtered to today+ if the
    live fetch fails.
    """
    season_end = None  # filled from the first response (regularSeasonEndDate)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    today = datetime.date.today().isoformat()
    all_games = []
    current_date = today
    loops = 0

    print(f"Fetching remaining schedule from {today}...")
    while (season_end is None or current_date <= season_end) and loops < 40:
        url = f"https://api-web.nhle.com/v1/schedule/{current_date}"
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
                data = json.load(resp)
            season_end = season_end or data.get('regularSeasonEndDate')

            for week in data.get('gameWeek', []):
                for game in week.get('games', []):
                    if game.get('gameType') != 2:
                        continue  # Regular season only
                    state = game.get('gameState', 'FUT')
                    if state in ('OFF', 'FINAL'):
                        continue  # Already played
                    all_games.append({
                        'id': game['id'],
                        'date': week['date'],
                        'home': game['homeTeam']['abbrev'],
                        'away': game['awayTeam']['abbrev'],
                        'gameState': state,
                    })

            next_date = data.get('nextStartDate')
            if not next_date or next_date <= current_date:
                break
            current_date = next_date
        except Exception as e:
            print(f"  [WARN] Schedule fetch failed for {current_date}: {e}")
            break
        loops += 1

    # Deduplicate by game id
    seen = set()
    unique = []
    for g in all_games:
        if g['id'] not in seen:
            seen.add(g['id'])
            unique.append(g)

    if unique:
        print(f"  Fetched {len(unique)} remaining games ({loops} API calls).")
        return unique

    # Fallback: filter the static file to today+
    print("  Live fetch returned 0 games — falling back to static remaining_schedule.json filtered to today+.")
    static_path = os.path.join(DATA_DIR, 'remaining_schedule.json')
    if os.path.exists(static_path):
        all_static = load_json(static_path)
        filtered = [g for g in all_static if g.get('date', '') >= today]
        print(f"  Static fallback: {len(filtered)} games on/after {today} (was {len(all_static)} total).")
        return filtered
    return []


def full_simulation_loop():
    print(f"Starting {SIMULATIONS} simulations...")

    # 1. Load Data
    schedule = fetch_remaining_schedule()
    team_ratings = load_json(os.path.join(SCRIPT_DIR, 'team_ratings.json'))
    nhl_teams = load_csv(os.path.join(SCRIPT_DIR, 'nhl_teams.csv'))
    
    team_map = build_team_map(nhl_teams)
    
    current_standings = fetch_current_standings()
    
    # Results trackers
    results = {
        abbr: {
            'made_playoffs': 0,
            'won_division': 0,
            'won_president': 0, # Not implementing yet
            'won_conference': 0,
            'won_cup': 0,
            'sim_points': [] # To calc average points
        }
        for abbr in current_standings.keys()
    }
    
    # Initialize rich data tracking
    for abbr in results:
        results[abbr].update({
            'point_dist': {}, # { points: count }
            'div_rank_dist': {}, # { rank: count }
            'round_exit_dist': {'MISS': 0, 'R1': 0, 'R2': 0, 'CF': 0, 'F': 0, 'CUP': 0},
            'r1_matchups': {} # { opponent: count }
        })
    
    for i in range(SIMULATIONS):
        if i % 100 == 0:
            print(f"  Sim {i}/{SIMULATIONS}...")
            
        # Sim Season
        final_standings = simulate_season(current_standings, schedule, team_ratings, team_map)
        
        # Determine Standings
        divs, east, west = determine_standings(final_standings)
        
        # Update Points Tracking
        for abbr, stats in final_standings.items():
            results[abbr]['sim_points'].append(stats['pts'])
            
        # Division Winners (Top of each div list)
        for d in divs:
            if divs[d]:
                results[divs[d][0][0]]['won_division'] += 1
                
            # Track Division Rank
            for rank_idx, team_tuple in enumerate(divs[d]):
                rank = rank_idx + 1
                t_abbr = team_tuple[0]
                if rank not in results[t_abbr]['div_rank_dist']:
                    results[t_abbr]['div_rank_dist'][rank] = 0
                results[t_abbr]['div_rank_dist'][rank] += 1
                
        # Update Points Histogram
        for abbr, stats in final_standings.items():
            pts = stats['pts']
            if pts not in results[abbr]['point_dist']:
                results[abbr]['point_dist'][pts] = 0
            results[abbr]['point_dist'][pts] += 1
                
        # Playoffs
        # Re-implement bracket logic inline here for clarity
        
        # --- EAST ---
        atl_top3 = divs.get('A', [])[:3]
        met_top3 = divs.get('M', [])[:3]
        
        # Wild Cards
        top3_east = set([x[0] for x in atl_top3] + [x[0] for x in met_top3])
        east_wc = [x for x in east if x[0] not in top3_east][:2] # WC1, WC2
        
        # Division winners
        a1 = atl_top3[0]
        m1 = met_top3[0]
        
        # Matchups
        # Better record plays WC2
        if (a1[1]['pts'], a1[1]['rw']) > (m1[1]['pts'], m1[1]['rw']):
            # Atl #1 is better
            match_a_semis_1 = (a1, east_wc[1]) # A1 vs WC2
            match_m_semis_1 = (m1, east_wc[0]) # M1 vs WC1
        else:
            match_a_semis_1 = (a1, east_wc[0]) # A1 vs WC1 (Technically incorrect crossover if WC1 is Metro? No, plays lower seed)
            # Rule: Best Div winner plays WC2. Other Div winner plays WC1.
            # Does WC1 stay in own division? No. 
            # "The division winner with the best record in each conference will be matched against the wild-card team with the lesser record."
            # So Best(D1, D2) vs WC2. Other vs WC1.
            # AND "The wild-card team with the lesser record will play in the division of the winner with the best record."
            # So if A1 > M1, A1 plays WC2. This pair is now in "Atlantic Bracket".
            match_a_semis_1 = (m1, east_wc[1]) # Typo in comment above, M1 is better? No logic below:
            
            # Logic: M1 is better.
            match_m_semis_1 = (m1, east_wc[1]) # M1 vs WC2
            match_a_semis_1 = (a1, east_wc[0]) # A1 vs WC1
            
        match_a_semis_2 = (atl_top3[1], atl_top3[2]) # A2 vs A3
        match_m_semis_2 = (met_top3[1], met_top3[2]) # M2 vs M3
        
        # Track 'Made Playoffs'
        all_playoff_teams = [x[0] for x in atl_top3 + met_top3 + east_wc]
        # Same for west...
        
        # --- WEST ---
        cen_top3 = divs.get('C', [])[:3]
        pac_top3 = divs.get('P', [])[:3]
        top3_west = set([x[0] for x in cen_top3] + [x[0] for x in pac_top3])
        west_wc = [x for x in west if x[0] not in top3_west][:2]
        
        all_playoff_teams += [x[0] for x in cen_top3 + pac_top3 + west_wc]
        
        for t in all_playoff_teams:
            results[t]['made_playoffs'] += 1
            
        # Track Missed Playoffs
        for abbr in results:
            if abbr not in all_playoff_teams:
                results[abbr]['round_exit_dist']['MISS'] += 1
            
        # Helper to record R1 Matchup
        def record_r1(t1, t2):
            if t2[0] not in results[t1[0]]['r1_matchups']: results[t1[0]]['r1_matchups'][t2[0]] = 0
            if t1[0] not in results[t2[0]]['r1_matchups']: results[t2[0]]['r1_matchups'][t1[0]] = 0
            results[t1[0]]['r1_matchups'][t2[0]] += 1
            results[t2[0]]['r1_matchups'][t1[0]] += 1
            
        # Record R1 Matchups
        # A Semis 1
        record_r1(match_a_semis_1[0], match_a_semis_1[1])
        record_r1(match_a_semis_2[0], match_a_semis_2[1])
        record_r1(match_m_semis_1[0], match_m_semis_1[1])
        record_r1(match_m_semis_2[0], match_m_semis_2[1])
        
        # Sim Series - ROUND 1 (EAST)
        winner_a_1 = simulate_series(match_a_semis_1[0], match_a_semis_1[1], team_ratings, team_map)
        winner_a_2 = simulate_series(match_a_semis_2[0], match_a_semis_2[1], team_ratings, team_map)
        
        winner_m_1 = simulate_series(match_m_semis_1[0], match_m_semis_1[1], team_ratings, team_map)
        winner_m_2 = simulate_series(match_m_semis_2[0], match_m_semis_2[1], team_ratings, team_map)
        
        # Need stats for next round sim, use valid lookup
        def get_team_tuple(abbr):
            return (abbr, final_standings[abbr])
            
        # ROUND 2 (Div Finals)
        winner_atl_div = simulate_series(get_team_tuple(winner_a_1), get_team_tuple(winner_a_2), team_ratings, team_map)
        winner_met_div = simulate_series(get_team_tuple(winner_m_1), get_team_tuple(winner_m_2), team_ratings, team_map)
        
        # WEST R1
        c1 = cen_top3[0]
        p1 = pac_top3[0]
        
        if (c1[1]['pts'], c1[1]['rw']) > (p1[1]['pts'], p1[1]['rw']):
            match_c_semis_1 = (c1, west_wc[1])
            match_p_semis_1 = (p1, west_wc[0])
        else:
            match_p_semis_1 = (p1, west_wc[1])
            match_c_semis_1 = (c1, west_wc[0])
            
        match_c_semis_2 = (cen_top3[1], cen_top3[2])
        match_p_semis_2 = (pac_top3[1], pac_top3[2])
        
        # Record West R1
        record_r1(match_c_semis_1[0], match_c_semis_1[1])
        record_r1(match_c_semis_2[0], match_c_semis_2[1])
        record_r1(match_p_semis_1[0], match_p_semis_1[1])
        record_r1(match_p_semis_2[0], match_p_semis_2[1])
        
        winner_c_1 = simulate_series(match_c_semis_1[0], match_c_semis_1[1], team_ratings, team_map)
        winner_c_2 = simulate_series(match_c_semis_2[0], match_c_semis_2[1], team_ratings, team_map)
        winner_p_1 = simulate_series(match_p_semis_1[0], match_p_semis_1[1], team_ratings, team_map)
        winner_p_2 = simulate_series(match_p_semis_2[0], match_p_semis_2[1], team_ratings, team_map)
        
        # WEST R2
        winner_cen_div = simulate_series(get_team_tuple(winner_c_1), get_team_tuple(winner_c_2), team_ratings, team_map)
        winner_pac_div = simulate_series(get_team_tuple(winner_p_1), get_team_tuple(winner_p_2), team_ratings, team_map)
        
        # CONFERENCE FINALS
        east_champ = simulate_series(get_team_tuple(winner_atl_div), get_team_tuple(winner_met_div), team_ratings, team_map)
        west_champ = simulate_series(get_team_tuple(winner_cen_div), get_team_tuple(winner_pac_div), team_ratings, team_map)
        
        results[east_champ]['won_conference'] += 1
        results[west_champ]['won_conference'] += 1
        
        # STANLEY CUP FINAL
        cup_winner = simulate_series(get_team_tuple(east_champ), get_team_tuple(west_champ), team_ratings, team_map)
        
        results[cup_winner]['won_cup'] += 1
        results[cup_winner]['round_exit_dist']['CUP'] += 1
        
        # Track Exits (Loser of each series gets exit logged)
        # We need to know WHO lost key series to log them as R1, R2, CF, F exit.
        
        # Generic helper: Given winner, find loser from pair
        def get_loser(pair, winner_abbr):
            return pair[0][0] if pair[1][0] == winner_abbr else pair[1][0]
            
        # R1 Losers
        results[get_loser(match_a_semis_1, winner_a_1)]['round_exit_dist']['R1'] += 1
        results[get_loser(match_a_semis_2, winner_a_2)]['round_exit_dist']['R1'] += 1
        results[get_loser(match_m_semis_1, winner_m_1)]['round_exit_dist']['R1'] += 1
        results[get_loser(match_m_semis_2, winner_m_2)]['round_exit_dist']['R1'] += 1
        
        results[get_loser(match_c_semis_1, winner_c_1)]['round_exit_dist']['R1'] += 1
        results[get_loser(match_c_semis_2, winner_c_2)]['round_exit_dist']['R1'] += 1
        results[get_loser(match_p_semis_1, winner_p_1)]['round_exit_dist']['R1'] += 1
        results[get_loser(match_p_semis_2, winner_p_2)]['round_exit_dist']['R1'] += 1
        
        # R2 Losers
        # Need to reconstruct pairs from winners
        # Atl Div Final: (winner_a_1) vs (winner_a_2) -> winner_atl_div
        # Loser of this tuple is...
        def get_loser_simple(t1, t2, winner):
            return t2 if t1 == winner else t1
            
        results[get_loser_simple(winner_a_1, winner_a_2, winner_atl_div)]['round_exit_dist']['R2'] += 1
        results[get_loser_simple(winner_m_1, winner_m_2, winner_met_div)]['round_exit_dist']['R2'] += 1
        results[get_loser_simple(winner_c_1, winner_c_2, winner_cen_div)]['round_exit_dist']['R2'] += 1
        results[get_loser_simple(winner_p_1, winner_p_2, winner_pac_div)]['round_exit_dist']['R2'] += 1
        
        # CF Losers
        results[get_loser_simple(winner_atl_div, winner_met_div, east_champ)]['round_exit_dist']['CF'] += 1
        results[get_loser_simple(winner_cen_div, winner_pac_div, west_champ)]['round_exit_dist']['CF'] += 1
        
        # Final Loser
        results[get_loser_simple(east_champ, west_champ, cup_winner)]['round_exit_dist']['F'] += 1
        
    # PROCESS RESULTS
    final_output = []
    for abbr, data in results.items():
        avg_pts = sum(data['sim_points']) / SIMULATIONS if data['sim_points'] else 0
        final_output.append({
            'team': abbr,
            'make_playoffs_pct': round(data['made_playoffs'] / SIMULATIONS * 100, 1),
            'won_division_pct': round(data['won_division'] / SIMULATIONS * 100, 1),
            'won_conference_pct': round(data['won_conference'] / SIMULATIONS * 100, 1),
            'won_cup_pct': round(data['won_cup'] / SIMULATIONS * 100, 1),
            'avg_points': round(avg_pts, 1),
            
            # Rich Data
            'point_dist': data['point_dist'],
            'div_rank_dist': data['div_rank_dist'],
            'round_exit_dist': data['round_exit_dist'],
            'r1_matchups': data['r1_matchups']
        })
        
    # Save
    output_wrapper = {
        'total_simulations': SIMULATIONS,
        'teams': final_output
    }
    out_path = os.path.join(DATA_DIR, 'season_projections.json')
    with open(out_path, 'w') as f:
        json.dump(output_wrapper, f, indent=4)

    # Also copy to public/data for the frontend
    import shutil
    public_path = os.path.join(SCRIPT_DIR, '..', 'public', 'data', 'season_projections.json')
    shutil.copy2(out_path, public_path)
        
    print(f"Simulation complete. Results saved to {out_path}")

if __name__ == "__main__":
    full_simulation_loop()
