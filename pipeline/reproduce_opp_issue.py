
# Mocking the relevant parts of nhl_scraper_poc.py logic
# To test Opportunity counting for 2 concurrent penalties (Same Player)

plays = [
    # 10:13 P3 - Penalty 1 (Walman)
    {
        "typeCode": 509,
        "periodDescriptor": {"number": 3},
        "timeInPeriod": "10:13",
        "details": {
            "eventOwnerTeamId": 22,
            "duration": 2,
            "descKey": "hooking",
            "committedByPlayerId": 8479376 # Walman
        },
        "situationCode": "1551" # 5v5 (Starts here)
    },
    # 10:13 P3 - Penalty 2 (Walman) - Same Time
    {
        "typeCode": 509,
        "periodDescriptor": {"number": 3},
        "timeInPeriod": "10:13",
        "details": {
            "eventOwnerTeamId": 22,
            "duration": 2,
            "descKey": "unsportsmanlike-conduct",
            "committedByPlayerId": 8479376 # Walman
        },
        "situationCode": "1551" # Still 1551 in API usually, or 1541? Logic relies on parsing.
        # Assuming 1551 for the first one, maybe 1541 for second? 
        # But debug output showed both had 1551? Let's check debug output.
        # "P3 10:13 ... Code: 1551" for BOTH.
    }
]

# Set up state
teams = {
    21: {'pp': {'opportunities': 0}}, # Avalanche (Opponent)
    22: {'pk': {'opportunities': 0}}  # Oilers (Penalty)
}
active_penalties = []
home_id = 22 # Oilers
away_id = 21 # Avalanche
home_pp_active = False # initially false (5v5)
away_pp_active = False
current_seconds = 613 # 10:13

def parse_situation(code):
    return (int(code[0]), int(code[1]), int(code[2]), int(code[3]))

print(f"Initial: Opps={teams[away_id]['pp']['opportunities']}")

for p in plays:
    # ... logic from scraper ...
    owner_id = p['details']['eventOwnerTeamId']
    duration_min = p['details'].get('duration', 2)
    committed_by = p['details'].get('committedByPlayerId')
    
    # Update state via situationCode (scraper does this at TOP of loop)
    # But for concurrent events, situationCode might be same for both?
    # Debug output said 1551 for BOTH.
    # So `is_away_pp` will be False for BOTH if we rely only on situationCode 1551.
    
    situation_code = p.get('situationCode', '1551')
    ag, as_num, hs_num, hg = parse_situation(situation_code)
    
    is_home_pp = (hs_num > as_num) and (as_num < 5)
    is_away_pp = (as_num > hs_num) and (hs_num < 5)
    
    # State Change Logic
    if is_away_pp and not away_pp_active:
        teams[away_id]['pp']['opportunities'] += 1
        away_pp_active = True
        print("  State Change -> +1 Opp")
    elif not is_away_pp:
        away_pp_active = False # 1551 -> False.
    
    # Penalty Logic
    is_coincidental = False # simplified
    
    # Stacked / Concurrent Logic
    # Check if there is ALREADY an active penalty for this team (Opponent of owner)
    # This covers "Simultaneous penalties" where state hasn't updated yet.
    has_existing_penalty = any(p['team_id'] == home_id and p['end_time'] > current_seconds for p in active_penalties)
    
    if duration_min < 10 and not is_coincidental:
        if owner_id == home_id:
             print(f"  Penalty (Home): ActivePP={away_pp_active}, Future={has_existing_penalty}")
             
             # TRIGGER if PP Active (Standard Stacked) OR Existing Penalty (Concurrent Start)
             if away_pp_active or has_existing_penalty:
                 teams[away_id]['pp']['opportunities'] += 1
                 print("  Stacked/Concurrent -> +1 Opp")
                 
    # Add to Active with Consecutive Logic
    start_t = current_seconds
    # Check for same player
    same_player_penalties = [p for p in active_penalties if p.get('player_id') == committed_by]
    if same_player_penalties:
        # Find latest end time
        max_end = max(p['end_time'] for p in same_player_penalties)
        if max_end > start_t:
            start_t = max_end
            print(f"  Consecutive Penalty for Player {committed_by}: Starts at {start_t}")
            
    active_penalties.append({
        'team_id': owner_id,
        'end_time': start_t + (duration_min * 60),
        'player_id': committed_by
    })

print(f"Final: Opps={teams[away_id]['pp']['opportunities']}")
