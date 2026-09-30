import urllib.request
import json
import time
from datetime import datetime


# Cache for rosters to avoid repeated API calls per run
ROSTER_CACHE = {}

def make_request(url):
    from http_utils import try_get_json
    return try_get_json(url)

# Mapping for robustness
TRICODE_MAP = {
    'NJ': 'NJD', 'TB': 'TBL', 'LA': 'LAK', 'SJ': 'SJS',
    'MON': 'MTL', 'WSH': 'WSH', 'UTA': 'UTA'
}

def normalize_tricode(tri):
    if not tri: return tri
    tri = tri.upper()
    return TRICODE_MAP.get(tri, tri)

def fetch_roster(team_tri):
    """Fetches current roster for a team to map names to IDs."""
    team_tri = normalize_tricode(team_tri)
    
    if team_tri in ROSTER_CACHE:
        return ROSTER_CACHE[team_tri]
        
    url = f"https://api-web.nhle.com/v1/roster/{team_tri}/current"
    data = make_request(url)
    if data:
        # Flatten roster into a simple list of players
        players = []
        for position_group in ['forwards', 'defensemen', 'goalies']:
            if position_group in data:
                players.extend(data[position_group])
        ROSTER_CACHE[team_tri] = players
        return players
    return []

def find_player_id(name, team_tri):
    """Finds player ID by loosely matching name in the team's roster."""
    team_tri = normalize_tricode(team_tri)
    roster = fetch_roster(team_tri)
    if not roster:
        return None
        
    # Clean input name
    target_name = name.lower().replace('.', '')
    # Usually "First Last" or "F. Last"
    
    # Strategy: Match Last Name primarily, then disambiguate if needed
    # Roster names usually: { "firstName": "Igor", "lastName": "Shesterkin", ... }
    
    # 1. Try Exact match of full name construction
    for p in roster:
        p_name = f"{p['firstName']['default']} {p['lastName']['default']}".lower().replace('.', '')
        if p_name == target_name:
            return p['id']
            
    # 2. Try Last Name match
    target_last = target_name.split(' ')[-1]
    candidates = [p for p in roster if p['lastName']['default'].lower() == target_last]
    
    if len(candidates) == 1:
        return candidates[0]['id']
        
    # 3. If multiple last names, try matching first initial
    if len(candidates) > 1:
        target_first = target_name.split(' ')[0]
        for p in candidates:
             if p['firstName']['default'].lower().startswith(target_first[0]):
                 return p['id']
                 
    return None

def fetch_goalie_vs_opponent(player_name, team_tri, opponent_tri):
    """
    Fetches stats for a specific goalie against a specific opponent.
    Returns dict with simplified historical stats.
    """
    opponent_tri = normalize_tricode(opponent_tri)
    
    # Handle Franchise History (UTA = ARI)
    target_opponents = {opponent_tri}
    if opponent_tri == 'UTA':
        target_opponents.add('ARI')
    if opponent_tri == 'ARI':
        target_opponents.add('UTA')
    
    # 1. Get Player ID
    player_id = find_player_id(player_name, team_tri)
    
    if not player_id:
        print(f"  Warning: Could not find ID for {player_name} ({team_tri})")
        return None
        
    # 2. Fetch Game Log (Last 10 Seasons to capture full career)
    # 2024-25 back to 2015-16
    seasons = [
        "20252026", "20242025", "20232024", "20222023", "20212022",
        "20202021", "20192020", "20182019", "20172018", "20162017", "20152016"
    ]
    
    total_games = 0
    wins = 0
    losses = 0
    ot_losses = 0
    total_shots = 0
    total_goals_against = 0
    total_saves = 0
    
    # Include current-season playoff games (game type 3) in addition to regular season
    season_game_types = [(s, 2) for s in seasons] + [("20252026", 3)]

    for season, game_type in season_game_types:
        url = f"https://api-web.nhle.com/v1/player/{player_id}/game-log/{season}/{game_type}"
        data = make_request(url)
        if not data or 'gameLog' not in data:
            continue

        for g in data['gameLog']:
            # Check opponent match
            if g.get('opponentAbbrev') in target_opponents:
                
                # Check for decision
                decision = g.get('decision', 'ND') # W, L, O, or ND
                
                # Stats
                sa = g.get('shotsAgainst', 0)
                ga = g.get('goalsAgainst', 0)
                saves = sa - ga
                
                total_shots += sa
                total_goals_against += ga
                total_saves += saves
                total_games += 1
                
                if decision == 'W':
                    wins += 1
                elif decision == 'L':
                    losses += 1
                elif decision == 'O' or decision == 'OT':
                    ot_losses += 1
                    
    if total_games == 0:
        return None
        
    # Calculate Aggregates
    sv_pct = total_saves / total_shots if total_shots > 0 else 0.0
    gaa = (total_goals_against * 60) / (total_games * 60) if total_games > 0 else 0.0 # simplified GAA
    win_pct = wins / total_games if total_games > 0 else 0.0
    
    return {
        "record": f"{wins}-{losses}-{ot_losses}",
        "sv": round(sv_pct, 3),
        "gaa": round(gaa, 2),
        "gp": total_games,
        "win_pct": round(win_pct, 3)
    }

if __name__ == "__main__":
    # Test Logic
    print("Testing Fetch Goalie History...")
    # Example: Igor Shesterkin (NYR) vs ... pick one ... typically good/bad match
    stats = fetch_goalie_vs_opponent("Igor Shesterkin", "NYR", "NJ") # NJ might need to be N.J or NJD? API usually uses NJD
    # TriCode in Roster is usually standard. 'NJ' -> 'NJD'. My app uses NJ.
    # Need to verify TriCode mapping if it fails.
    if stats:
        print("Stats found:", stats)
    else:
        print("No stats found (try 'NJD'?)")
        stats_njd = fetch_goalie_vs_opponent("Igor Shesterkin", "NYR", "NJD")
        print("Stats found (NJD):", stats_njd)
