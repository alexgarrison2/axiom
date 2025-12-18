import urllib.request
import os
import json
import csv
import sys
import ssl
import time
import math
import pickle
import pandas as pd
import xgboost as xgb
from datetime import datetime, timedelta
from collections import defaultdict

# Global H-Ref Stats Cache
# Key: (date_str, team_tricode) -> {pp_goals, pp_opps, opp_pp_goals, opp_pp_opps}
HREF_STATS = {}
HREF_STATS_FILE = "href_stats.csv"

def load_href_stats():
    """Load H-Ref stats into global dict."""
    global HREF_STATS
    if not os.path.exists(HREF_STATS_FILE):
        print(f"Warning: {HREF_STATS_FILE} not found. access to reliable PP/PK stats unavailable.")
        return

    print(f"Loading H-Ref stats from {HREF_STATS_FILE}...")
    try:
        with open(HREF_STATS_FILE, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            count = 0
            for row in reader:
                # Key: Date + Team (e.g. "2025-10-09", "ANA")
                # H-Ref uses "VEG" for VGK, "UTA" for UTA.
                # The pipeline will need to map API tricodes to H-Ref codes.
                key = (row['date'], row['team'])
                HREF_STATS[key] = {
                    'pp_goals': int(row['pp_goals']),
                    'pp_opportunities': int(row['pp_opportunities']),
                    'opp_pp_goals': int(row['opp_pp_goals']),
                    'opp_pp_opportunities': int(row['opp_pp_opportunities'])
                }
                count += 1
            print(f"  Loaded {count} H-Ref stats rows.")
    except Exception as e:
        print(f"Error loading H-Ref stats: {e}")

def get_href_stats(date_str, tricode):
    """
    Get official stats for a team/date.
    Handles tricode mapping (VGK->VEG).
    """
    # Map API Tricodes to H-Ref Codes
    mapping = {"VGK": "VEG", "UTA": "UTA"} # Add others if needed
    href_code = mapping.get(tricode, tricode)
    
    return HREF_STATS.get((date_str, href_code))


# Constants
BASE_URL = "https://api-web.nhle.com/v1"
SEASON_START_DATE = "2025-10-04" 
OUTPUT_FILENAME = "nhl_season_2025_2026_gamestats.csv"


# Create unverified context for SSL to avoid cert errors
ssl._create_default_https_context = ssl._create_unverified_context

def get_url(url):
    """Helper to fetch URL with proper headers and error handling."""
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as e:
        print(f"  HTTP Error {e.code} for {url}")
        return None
    except Exception as e:
        print(f"  Error fetching {url}: {e}")
        return None

def get_schedule(date_str):
    """Fetch schedule for a specific date (YYYY-MM-DD)."""
    return get_url(f"{BASE_URL}/schedule/{date_str}")

def get_pbp(game_id):
    """Fetch play-by-play data for a specific game ID."""
    return get_url(f"{BASE_URL}/gamecenter/{game_id}/play-by-play")

def build_roster_map(pbp_json):
    """
    Create a mapping of playerID -> Full Name from the 'rosterSpots' in the PBP JSON.
    Returns: dict {player_id: "FirstName LastName"}
    """
    roster_map = {}
    if "rosterSpots" in pbp_json:
        for player in pbp_json["rosterSpots"]:
            p_id = player.get("playerId")
            first = player.get("firstName", {}).get("default", "")
            last = player.get("lastName", {}).get("default", "")
            full_name = f"{first} {last}".strip()
            roster_map[p_id] = full_name
    return roster_map

def get_player_name(player_id, roster_map):
    """Safely get player name from map or return ID if not found."""
    if not player_id:
        return ""
    return roster_map.get(player_id, str(player_id))

def parse_situation(situation_code):
    """
    Parse the 4-digit situation code.
    Format: [AwayGoalie][AwaySkaters][HomeSkaters][HomeGoalie]
    Example: "1551" -> Away: 1G, 5S; Home: 5S, 1G.
    Returns: (away_goalie, away_skaters, home_skaters, home_goalie)
    """
    if not situation_code or len(situation_code) != 4:
        return (1, 5, 5, 1) # Default to 5v5 with goalies if missing
    
    try:
        return (int(situation_code[0]), int(situation_code[1]), 
                int(situation_code[2]), int(situation_code[3]))
    except:
        return (1, 5, 5, 1)

def time_to_seconds(time_str):
    """Convert MM:SS to seconds."""
    try:
        m, s = map(int, time_str.split(':'))
        return m * 60 + s
    except:
        return 0

def calculate_shot_metrics(x, y):
    """
    Calculate shot distance and angle from net.
    Assumes NHL rink coordinates where net is at x = 89 (or -89).
    Returns (distance, angle_degrees).
    """
    if x is None or y is None:
        return None, None
        
    # Distance to nearest goal line
    # Goals are at +/- 89
    # We assume the shot is towards the nearest net
    # Distance = sqrt((89 - |x|)^2 + y^2)
    
    dist_x = 89 - abs(x)
    dist_y = y
    
    distance = math.sqrt(dist_x**2 + dist_y**2)
    
    # Angle: 0 is straight on, 90 is from the goal line (impossible angle usually)
    # atan2(y, x) gives angle from x-axis.
    # We want angle from the "slot" line (center x-axis).
    # So abs(atan2(y, dist_x))
    
    angle_rad = math.atan2(abs(dist_y), dist_x)
    angle_deg = math.degrees(angle_rad)
    
    return round(distance, 1), round(angle_deg, 1)

def parse_zone(description):
    """
    Parse zone from event description.
    Returns: 'Off', 'Neu', 'Def', or 'Unknown'
    """
    desc = description.lower() if description else ""
    if "off. zone" in desc or "offensive zone" in desc:
        return "Off"
    elif "neu. zone" in desc or "neutral zone" in desc:
        return "Neu"
    elif "def. zone" in desc or "defensive zone" in desc:
        return "Def"
    return "Unknown"

def aggregate_game_stats(pbp_json, game_info, game_date, xg_model=None, home_rest=None, away_rest=None):
    """
    Aggregate stats for a single game.
    Returns a list of rows (one for home, one for away) and a list of shot rows.
    """
    game_id = game_info.get("id")
    home_team = game_info.get("homeTeam", {})
    away_team = game_info.get("awayTeam", {})
    
    home_id = home_team.get("id")
    away_id = away_team.get("id")
    
    roster_map = build_roster_map(pbp_json)
    
    # Initialize Stats Containers
    teams = {
        home_id: {
            "name": home_team.get("commonName", {}).get("default", "Home"),
            "abbrev": home_team.get("abbrev", "HOM"),
            "opponent": away_team.get("commonName", {}).get("default", "Away"),
            "team_game_number": 0, # Placeholder
            "goals": {"1": 0, "2": 0, "3": 0, "4": 0, "total": 0},
            "sog": {"1": 0, "2": 0, "3": 0, "4": 0, "total": 0},
            "attempts": {"1": 0, "2": 0, "3": 0, "4": 0, "total": 0},
            "hits": {"1": 0, "2": 0, "3": 0, "4": 0, "total": 0},
            "pp": {"goals": 0, "opportunities": 0, "time": 0},
            "pk": {'opportunities': 0, 'time': 0},
            "saves": 0,
            "empty_net_goals": 0,
            "posts": 0,
            "toi": {}, # 5v5, 5v4, etc.
            "time_leading": 0,
            "time_trailing": 0,
            "time_tied": 0,
            "goalies": set(),
            "starting_goalie": None,
            "rest": home_rest,
            "scored_first": 0,
            "max_lead": 0,
            "en_attempts": 0, # New: Empty Net Attempts
            "attempts_5v5": 0 # New: 5v5 Attempts
        },
        away_id: {
            "name": away_team.get("commonName", {}).get("default", "Away"),
            "abbrev": away_team.get("abbrev", "AWY"),
            "opponent": home_team.get("commonName", {}).get("default", "Home"),
            "team_game_number": 0, # Placeholder
            "goals": {"1": 0, "2": 0, "3": 0, "4": 0, "total": 0},
            "sog": {"1": 0, "2": 0, "3": 0, "4": 0, "total": 0},
            "attempts": {"1": 0, "2": 0, "3": 0, "4": 0, "total": 0},
            "hits": {"1": 0, "2": 0, "3": 0, "4": 0, "total": 0},
            "pp": {"goals": 0, "opportunities": 0, "time": 0},
            "pk": {'opportunities': 0, 'time': 0},
            "saves": 0,
            "empty_net_goals": 0,
            "posts": 0,
            "toi": {},
            "time_leading": 0,
            "time_trailing": 0,
            "time_tied": 0,
            "goalies": set(),
            "starting_goalie": None,
            "rest": away_rest,
            "scored_first": 0,
            "max_lead": 0,
            "en_attempts": 0, # New
            "attempts_5v5": 0 # New: 5v5 Attempts
        }
    }
    
    # State Tracking
    plays = pbp_json.get("plays", [])
    sorted_plays = sorted(plays, key=lambda x: x.get('sortOrder', 0))
    prev_period = 1
    prev_time_seconds = 0
    
    # Initial State
    # (Home Skaters, Away Skaters, Home Goalie, Away Goalie)
    current_strength = (5, 5, 1, 1) 
    # (Home Score, Away Score)
    current_score = (0, 0)
    
    # PP State Tracking for Opportunity Counts
    home_pp_active = False
    away_pp_active = False
    
    # Active Penalties List: [{'end_time': int, 'team_id': int}]
    active_penalties = []
    
    # Shot Data Collection
    shot_rows = []
    
    # Advanced xG Context Tracking
    last_event = {
        'time': -100.0,
        'type': 'None',
        'x': 0.0,
        'y': 0.0,
        'zone': 'Unknown',
        'angle': 0.0
    }
    
    first_goal_scored = False
    
    # Pre-process Penalties for Coincidental Checks
    # Map: time_seconds -> list of {team_id, duration, end_time}
    penalty_map = defaultdict(list)
    for p in plays:
        if p.get("typeCode") == 509:
            details = p.get("details", {})
            p_time = time_to_seconds(p.get("timeInPeriod", "00:00"))
            # Adjust for period
            p_period = p.get("periodDescriptor", {}).get("number", 1)
            # We only care about coincidental in same period, same time.
            # Let's use a unique key: (period, time_seconds)
            key = (p_period, p_time)
            penalty_map[key].append({
                'team_id': details.get("eventOwnerTeamId"),
                'duration': details.get("duration", 2)
            })

    for i, play in enumerate(sorted_plays):
        event_id = play.get("eventId")
        type_code = play.get("typeCode")
        details = play.get("details", {})
        period_desc = play.get("periodDescriptor", {})
        period_num = period_desc.get("number", 1)
        period_type = period_desc.get("periodType", "REG") # REG, OT, SO
        
        # Skip Shootout Events
        if period_type == 'SO':
            continue
        
        # Time Calculation
        time_in_period = play.get("timeInPeriod", "00:00")
        current_seconds = time_to_seconds(time_in_period)
        
        # Handle Period Changes (Reset timer and penalties)
        if period_num != prev_period:
            prev_time_seconds = 0
            prev_period = period_num
            active_penalties = [] # Penalties carry over in real life, but for TOI buckets per period, we reset or need complex carry-over. 
            # Simplification: The situationCode at start of period handles the state. 
            # We just need to clear the *expiration events* list because the time base reset to 0.
            # Ideally we'd re-calculate end times relative to new period, but API situationCode is the source of truth for state.
            # So clearing is safer to avoid negative durations.
            
        # --- Process Virtual Expirations (Events between prev_time and current_time) ---
        # Find penalties that expire in this interval
        expiring_penalties = [p for p in active_penalties if prev_time_seconds < p['end_time'] < current_seconds]
        expiring_penalties.sort(key=lambda x: x['end_time'])
        
        for p in expiring_penalties:
            # 1. Add TOI for the segment BEFORE expiration
            segment_duration = p['end_time'] - prev_time_seconds
            
            # Update Metrics for this segment
            # Score State
            score_diff = current_score[0] - current_score[1]
            if score_diff > 0:
                teams[home_id]['time_leading'] += segment_duration
                teams[away_id]['time_trailing'] += segment_duration
            elif score_diff < 0:
                teams[home_id]['time_trailing'] += segment_duration
                teams[away_id]['time_leading'] += segment_duration
            else:
                teams[home_id]['time_tied'] += segment_duration
                teams[away_id]['time_tied'] += segment_duration
                
            # Strength State
            # We need to know the strength BEFORE this penalty expired.
            # But we only track current_strength (which is from the PREVIOUS event).
            # So current_strength IS the strength before expiration.
            hs, as_num, hg, ag = current_strength
            
            # Check for PP Time
            # PP = (My Skaters > Opp Skaters) AND (Opp Skaters < 5)
            is_home_pp = (hs > as_num) and (as_num < 5)
            is_away_pp = (as_num > hs) and (hs < 5)
            
            if is_home_pp:
                teams[home_id]['pp']['time'] += segment_duration
                teams[away_id]['pk']['time'] += segment_duration
            if is_away_pp:
                teams[away_id]['pp']['time'] += segment_duration
                teams[home_id]['pk']['time'] += segment_duration
                
            # Update Strength for NEXT segment (virtual)
            # If a penalty expired, that team gains a skater.
            if p['team_id'] == home_id:
                current_strength = (hs + 1, as_num, hg, ag)
            elif p['team_id'] == away_id:
                current_strength = (hs, as_num + 1, hg, ag)
                
            prev_time_seconds = p['end_time']

        # Prune expired penalties
        # Keep penalties that expire >= current_seconds (so they are active for events at this second)
        active_penalties = [p for p in active_penalties if p['end_time'] >= current_seconds]

        # --- Process Actual Event Interval ---
        # Duration from last (real or virtual) event to current event
        duration = current_seconds - prev_time_seconds
        
        if duration > 0:
            # Score State
            score_diff = current_score[0] - current_score[1]
            if score_diff > 0:
                teams[home_id]['time_leading'] += duration
                teams[away_id]['time_trailing'] += duration
            elif score_diff < 0:
                teams[home_id]['time_trailing'] += duration
                teams[away_id]['time_leading'] += duration
            else:
                teams[home_id]['time_tied'] += duration
                teams[away_id]['time_tied'] += duration
                
            # Strength State (Current)
            hs, as_num, hg, ag = current_strength
            
            # Check for PP Time
            is_home_pp = (hs > as_num) and (as_num < 5)
            is_away_pp = (as_num > hs) and (hs < 5)
            
            if is_home_pp:
                teams[home_id]['pp']['time'] += duration
                teams[away_id]['pk']['time'] += duration
            if is_away_pp:
                teams[away_id]['pp']['time'] += duration
                teams[home_id]['pk']['time'] += duration
                
            # TOI (Approximate based on strength)
            strength_key = f"{hs}v{as_num}"
            teams[home_id]['toi'][strength_key] = teams[home_id]['toi'].get(strength_key, 0) + duration
            
            opp_strength_key = f"{as_num}v{hs}"
            teams[away_id]['toi'][opp_strength_key] = teams[away_id]['toi'].get(opp_strength_key, 0) + duration

        prev_time_seconds = current_seconds
        
        # --- Sync Strength found in API (Source of Truth) ---
        # situationCode: [AG][AS][HS][HG]
        sit_code = play.get("situationCode")
        if sit_code and len(sit_code) == 4:
            try:
                # Parse manually to ensure correct mapping
                # parse_situation returns (ag, as, hs, hg)
                ag_p = int(sit_code[0])
                as_p = int(sit_code[1])
                hs_p = int(sit_code[2])
                hg_p = int(sit_code[3])
                
                # current_strength is (HS, AS, HG, AG)
                current_strength = (hs_p, as_p, hg_p, ag_p)
            except:
                pass

        # --- Process Event Logic ---
        
        owner_id = details.get("eventOwnerTeamId")
        period_key = str(period_num) if period_num <= 3 else '4' # Map OT/SO to 4
        
        # Goalie Tracking
        # Note: 'goalieInNetId' is often present in shot/goal events
        if "details" in play:
            details = play["details"]
            if "goalieInNetId" in details:
                g_id = details["goalieInNetId"]
                # Determine which team this goalie belongs to (the defending team)
                # Usually eventOwnerTeamId is the attacking team for shots
                event_team = details.get("eventOwnerTeamId")
                
                # If event owner is Home, goalie is Away, and vice versa
                if event_team == home_id:
                    goalie_team_id = away_id
                elif event_team == away_id:
                    goalie_team_id = home_id
                else:
                    goalie_team_id = None # Should not happen
                
                if goalie_team_id and g_id:
                    if g_id not in teams[goalie_team_id]["goalies"]:
                        teams[goalie_team_id]["goalies"].add(g_id)
                        if teams[goalie_team_id]["starting_goalie"] is None:
                            teams[goalie_team_id]["starting_goalie"] = g_id

        # --- Event Location & Zone ---
        x = details.get("xCoord")
        y = details.get("yCoord")
        
        # Zone parsing
        desc = play.get("eventDescription", {}).get("default", "")
        if not isinstance(desc, str): desc = details.get("eventDescription", "")
        zone = details.get("zoneCode")
        if not zone:
             zone = parse_zone(desc if isinstance(desc, str) else "")

        # --- Shot Metrics & xG ---
        # 505: Goal, 506: Shot, 507: Missed Shot
        if type_code in [505, 506, 507]:
            distance, angle = calculate_shot_metrics(x, y)
             
            # Calculate Advanced Features
            time_since_last = current_seconds - last_event['time']
            if time_since_last < 0: time_since_last = 0 

            # Distance from last event
            dist_from_last = 0.0
            if x is not None and y is not None and last_event['x'] is not None:
                dist_from_last = math.sqrt((x - last_event['x'])**2 + (y - last_event['y'])**2)
            
            # Speed from last event (ft/s)
            speed_from_last = 0.0
            if time_since_last > 0:
                speed_from_last = dist_from_last / time_since_last
            
            # Rebound Angle
            rebound_angle = 0.0
            is_rebound = False
            if last_event['type'] in ['SHOT', 'MISS', 'GOAL', 'BLOCK'] and time_since_last <= 3.0:
                is_rebound = True
                if angle is not None:
                     rebound_angle = abs(angle - last_event['angle'])
            
            # Rush Shot
            # Fast transition (< 5s) from non-offensive zone check
            is_rush = 0
            if time_since_last <= 5.0 and last_event['zone'] in ['Neu', 'Def']:
                is_rush = 1
            
            # Determine Strength State
            owner_id = details.get("eventOwnerTeamId")
            hs_num, as_num, hg, ag = current_strength
            shooter_team_skaters = hs_num if owner_id == home_id else as_num
            opp_team_skaters = as_num if owner_id == home_id else hs_num
            
            # Empty Net Check
            shooter_opp_goalie = hg if owner_id == away_id else ag
            is_empty_net = 1 if (shooter_opp_goalie == 0) else 0

            strength_state = f"{shooter_team_skaters}v{opp_team_skaters}"
            if is_empty_net:
                strength_state = "EmptyNet"
                
            # Score Differential
            home_score_val, away_score_val = current_score
            score_diff = home_score_val - away_score_val if owner_id == home_id else away_score_val - home_score_val

            shot_row = {
                "game_id": game_info.get("id"),
                "event_id": event_id,
                "time_seconds": current_seconds,
                "period": period_num,
                "team_id": owner_id,
                "player_id": details.get("shootingPlayerId") or details.get("scoringPlayerId"),
                "shot_type": details.get("shotType", "Unknown"),
                "x": x,
                "y": y,
                "distance": distance,
                "angle": angle,
                "is_rebound": 1 if is_rebound else 0,
                "strength_state": strength_state,
                "score_differential": score_diff,
                "is_goal": 1 if type_code == 505 else 0,
                "event_type": type_code,
                # New Features
                "time_since_last_event": round(time_since_last, 2),
                "speed_from_last_event": round(speed_from_last, 2),
                "last_event_type": last_event['type'],
                "rebound_angle": round(rebound_angle, 2),
                "is_rush": is_rush
            }
            if distance is not None: 
                shot_rows.append(shot_row)

        # --- Update Last Event ---
        last_event['time'] = current_seconds
        last_event['type'] = play.get("typeDescKey", "Unknown") 
        last_event['x'] = x if x is not None else last_event['x'] 
        last_event['y'] = y if y is not None else last_event['y']
        
        if zone:
             last_event['zone'] = zone
        
        # Update angle if shot-like
        if type_code in [505, 506, 507]:
             dist_tmp, angle_tmp = calculate_shot_metrics(x, y)
             if angle_tmp is not None:
                 last_event['angle'] = angle_tmp

        # --- Game Stats Aggregation ---
        # Goals (505)
        if type_code == 505:
            if owner_id in teams:
                teams[owner_id]['goals'][period_key] += 1
                teams[owner_id]['goals']['total'] += 1
                teams[owner_id]['sog'][period_key] += 1 # Goal is a SOG
                teams[owner_id]['sog']['total'] += 1
                teams[owner_id]['attempts'][period_key] += 1 # Goal is an Attempt
                teams[owner_id]['attempts']['total'] += 1
                
                # 5v5 Check
                if current_strength == (5, 5, 1, 1):
                    teams[owner_id]['attempts_5v5'] += 1
                
                # PP Goal?
                # Exclude Penalty Shots
                sec_type = details.get("secondaryType", "").lower()
                is_penalty_shot = "penalty" in sec_type
                
                h_skaters, a_skaters, _, _ = current_strength
                # FIX: Require opponent to have < 5 skaters (Exclude Empty Net) AND Not Penalty Shot
                # We removed has_active_penalty check because it was causing undercounts (likely due to timing mismatches).
                # We rely on skater count (< 5) to exclude 6v5 Delayed Penalty goals.
                if not is_penalty_shot and (
                   (owner_id == home_id and h_skaters > a_skaters and a_skaters < 5) or \
                   (owner_id == away_id and a_skaters > h_skaters and h_skaters < 5)):
                    teams[owner_id]['pp']['goals'] += 1
                    
                    # End Penalty on PPG (if Minor)
                    # If Home scored PPG, remove oldest Away Minor
                    scoring_team = owner_id
                    penalized_team = away_id if scoring_team == home_id else home_id
                    
                    # Find penalties for the penalized team
                    team_penalties = [p for p in active_penalties if p['team_id'] == penalized_team]
                    team_penalties.sort(key=lambda x: x['end_time'])
                    
                    # Remove the first Minor (duration < 5)
                    for i, p in enumerate(team_penalties):
                        if p['duration'] < 5:
                            # Remove this specific penalty from active_penalties
                            # We need to reconstruct active_penalties without this one
                            # Be careful not to remove multiple if duplicates exist, remove by object identity or index
                            # Since we are iterating a filtered list, we can't just pop index i from active_penalties
                            
                            # Strategy: Rebuild active_penalties excluding this specific instance
                            # We can use a flag or ID. Let's assume exact match on end_time and team_id is unique enough for this POC,
                            # or just remove the first match.
                            
                            # Better: Remove from active_penalties list directly
                            active_penalties.remove(p)
                            
                            # Also update current_strength immediately?
                            # If penalty ends, that team gains a skater.
                            # But wait, the Goal event itself might be followed by a Faceoff with updated situationCode.
                            # If we update strength here manually, we might double-count the skater return if situationCode also updates.
                            # However, for "Virtual Expiration" logic, we rely on active_penalties.
                            # If we remove it here, the Virtual loop won't process it later.
                            # This is CORRECT. The penalty is done.
                            
                            # Do we need to update current_strength NOW?
                            # If we don't, the interval from Goal to Next Event will be calculated as 5v4.
                            # But the Goal IS the end of the PP.
                            # So from Goal to Faceoff, it should be 5v5 (or whatever).
                            # So yes, we should update current_strength.
                            
                            
                            h_skaters, a_skaters, hg, ag = current_strength
                            if penalized_team == home_id:
                                current_strength = (min(5, h_skaters + 1), a_skaters, hg, ag)
                            else:
                                current_strength = (h_skaters, min(5, a_skaters + 1), hg, ag)
                                
                            break # Only one penalty ends per goal
                    
                # Empty Net?
                if (owner_id == home_id and current_strength[3] == 0) or \
                   (owner_id == away_id and current_strength[2] == 0): # Opponent goalie
                     teams[owner_id]['empty_net_goals'] += 1
                     teams[owner_id]['en_attempts'] += 1 # Goal is an attempt

        # Shots (506)
        elif type_code == 506:
            if owner_id in teams:
                teams[owner_id]['sog'][period_key] += 1
                teams[owner_id]['sog']['total'] += 1
                teams[owner_id]['attempts'][period_key] += 1
                teams[owner_id]['attempts']['total'] += 1
                
                if current_strength == (5, 5, 1, 1):
                    teams[owner_id]['attempts_5v5'] += 1
                
                # Save for opponent
                opp_id = away_id if owner_id == home_id else home_id
                teams[opp_id]['saves'] += 1
                
        # Missed Shot (507)
        elif type_code == 507:
            if owner_id in teams:
                teams[owner_id]['attempts'][period_key] += 1
                teams[owner_id]['attempts']['total'] += 1
                
                if current_strength == (5, 5, 1, 1):
                    teams[owner_id]['attempts_5v5'] += 1
                
                # Post/Crossbar?
                reason = details.get("reason", "").lower()
                if "post" in reason or "crossbar" in reason:
                    teams[owner_id]['posts'] += 1

                # Empty Net Attempt (Miss)?
                # If Home shoots, check Away Goal
                h_skaters, a_skaters, hg, ag = current_strength
                is_opp_net_empty = False
                if owner_id == home_id and ag == 0: is_opp_net_empty = True
                elif owner_id == away_id and hg == 0: is_opp_net_empty = True

                if is_opp_net_empty:
                    teams[owner_id]['en_attempts'] += 1
                    
        # Blocked Shot (508)
        elif type_code == 508:
            # Block is owned by the BLOCKER. Attempt is for the OTHER team.
            blocker_id = owner_id
            shooter_id = away_id if blocker_id == home_id else home_id
            
            if shooter_id in teams:
                teams[shooter_id]['attempts'][period_key] += 1
                teams[shooter_id]['attempts']['total'] += 1

                if current_strength == (5, 5, 1, 1):
                    teams[shooter_id]['attempts_5v5'] += 1

                # Empty Net Attempt (Blocked)?
                # If Shooter is Home, check Away Goal.
                # In this event, we don't have direct shooter info usually, but we have inferred IDs.
                # current_strength has goalie info.
                h_skaters, a_skaters, hg, ag = current_strength
                is_opp_net_empty = False
                if shooter_id == home_id and ag == 0: is_opp_net_empty = True
                elif shooter_id == away_id and hg == 0: is_opp_net_empty = True
                
                if is_opp_net_empty:
                    teams[shooter_id]['en_attempts'] += 1
                
        # Hit (503)
        elif type_code == 503:
            if owner_id in teams:
                teams[owner_id]['hits'][period_key] += 1
                teams[owner_id]['hits']['total'] += 1
                
        # Penalty (509) - Add to Active List
        elif type_code == 509:
            duration_min = details.get("duration", 2)
            duration_sec = duration_min * 60
            penalty_end = current_seconds + duration_sec
            
            # Only track if it's a team penalty (has owner)
            # Exclude Penalty Shots and Misconducts from Active List (they don't create PP time/opps in standard way)
            desc_key = details.get("descKey", "").lower()
            is_penalty_shot = "penalty-shot" in desc_key
            is_misconduct = "misconduct" in desc_key
            
            if owner_id and not is_penalty_shot and not is_misconduct:
                active_penalties.append({
                    'end_time': penalty_end,
                    'team_id': owner_id,
                    'duration': duration_min
                })
                
                # --- Opportunity Counting for Stacked/Double Penalties ---
                
                # Check for coincidental using pre-built map
                # Look for opponent penalty at same time (period, current_seconds)
                opp_id = away_id if owner_id == home_id else home_id
                is_coincidental = False
                
                # Check current time in penalty_map
                # We need period num
                key = (period_num, current_seconds)
                concurrent_penalties = penalty_map.get(key, [])
                
                max_opp_duration = 0
                for p in concurrent_penalties:
                    if p['team_id'] == opp_id:
                        # Found opponent penalty starting at same time
                        if p['duration'] > max_opp_duration:
                            max_opp_duration = p['duration']
                
                # 1. Double Minor (4 min) -> Always +1 extra opportunity (first one caught by logic below)
                # BUT ONLY IF NO OPPONENT PENALTY (Clean 5v4 or 5v3)
                # If 4 vs 2, it's 1 Opp (handled below), not 2.
                if duration_min == 4 and max_opp_duration == 0:
                    if owner_id == home_id:
                        teams[away_id]['pp']['opportunities'] += 1
                        teams[home_id]['pk']['opportunities'] += 1
                    elif owner_id == away_id:
                        teams[home_id]['pp']['opportunities'] += 1
                        teams[away_id]['pk']['opportunities'] += 1
                        
                # 2. General Opportunity Logic
                # If this penalty creates a Net Advantage (Duration > Opponent Duration)
                # e.g. 2 vs 0 -> 2 > 0 -> Count (1)
                # e.g. 5 vs 2 -> 5 > 2 -> Count (1)
                # e.g. 2 vs 2 -> 2 > 2 False -> No Count.
                # e.g. 2 vs 5 -> 2 > 5 False -> No Count.
                
                if duration_min > max_opp_duration and duration_min < 10:
                    # Determine if this penalty creates/maintains an advantage (PP Opportunity)
                    # We check the strength state BEFORE this penalty is applied.
                    
                    hs, as_num, hg, ag = current_strength
                    
                    if owner_id == home_id:
                        # Home took penalty. Opponent is Away.
                        # Check: Away Skaters >= Home Skaters?
                        if as_num >= hs:
                            teams[away_id]['pp']['opportunities'] += 1
                            teams[home_id]['pk']['opportunities'] += 1
                            
                    elif owner_id == away_id:
                        # Away took penalty. Opponent is Home.
                        # Check: Home Skaters >= Away Skaters?
                        if hs >= as_num:
                            teams[home_id]['pp']['opportunities'] += 1
                            teams[away_id]['pk']['opportunities'] += 1

                # Add to Active Penalties
                # Handle Consecutive Penalties for Same Player (Rule 27.2)
                # If player already has an active penalty, this new one starts when the previous one ends.
                start_penalty_time = current_seconds
                committed_by = details.get("committedByPlayerId")
                
                if committed_by:
                    same_player_penalties = [p for p in active_penalties if p.get('player_id') == committed_by]
                    if same_player_penalties:
                        max_end = max(p['end_time'] for p in same_player_penalties)
                        if max_end > start_penalty_time:
                            start_penalty_time = max_end
                
                active_penalties.append({
                    "team_id": owner_id,
                    "end_time": start_penalty_time + (duration_min * 60),
                    "duration": duration_min,
                    "player_id": committed_by
                })

        # Icing (516) - Infers Empty Net Attempt?
        # Requires Lookahead to identify offender
        elif type_code == 516:
            details = play.get("details", {})
            reason = details.get("reason", "").lower()
            
            if "icing" in reason:
                # Need to look ahead to find Faceoff (502)
                # Faceoff will be in Def Zone of the icing team.
                # Assuming simple check: xCoord sign + homeDefendingSide
                
                # Default unknown
                icing_team_id = None
                
                # Peek ahead
                # We need to scan forward until we find a faceoff or game event that resets play, 
                # but Icing should be followed immediately by a faceoff unless a penalty/timeout occurs.
                # We'll just look at the very next play for now, or scan a few.
                for offset in range(1, 5): # Check next 4 events
                    if i + offset >= len(sorted_plays): break
                    
                    next_play = sorted_plays[i + offset]
                    if next_play.get("typeCode") == 502: # Faceoff
                        f_details = next_play.get("details", {})
                        f_x = f_details.get("xCoord")
                        f_zone = f_details.get("zoneCode")
                        
                        # Get Home Defending Side from CURRENT play context or somewhere stable
                        # The API usually provides `homeTeamDefendingSide` on plays or current period info.
                        # It is on the play object itself usually.
                        h_def_side = play.get("homeTeamDefendingSide", "left").lower()
                        
                        # Determine OFFENSIVE / DEFENSIVE zone for Home Team
                        # If Home Defends Left (Min X):
                        #   Def Zone < -25 (approx)
                        #   Off Zone > 25
                        
                        # Strict Icing Rule: Faceoff is in the offending team's Def Zone.
                        
                        is_home_def_zone = False
                        if h_def_side == 'left':
                             if f_x < 0: is_home_def_zone = True
                        else: # right
                             if f_x > 0: is_home_def_zone = True
                        
                        # If faceoff is in Home Def Zone -> Home Iced it.
                        if is_home_def_zone:
                            icing_team_id = home_id
                        else:
                            # It must be Away Def Zone (unless neutral zone? Icing faceoffs are rarely neutral)
                            icing_team_id = away_id
                            
                        break

                if icing_team_id:
                     # Check if OPPONENT net is empty
                     h_skaters, a_skaters, hg, ag = current_strength
                     is_opp_net_empty = False
                     
                     if icing_team_id == home_id and ag == 0: is_opp_net_empty = True
                     elif icing_team_id == away_id and hg == 0: is_opp_net_empty = True
                     
                     if is_opp_net_empty:
                         if icing_team_id in teams:
                             teams[icing_team_id]['en_attempts'] += 1

        # --- Update State for NEXT Interval ---
        
        # Update Score (if Goal)
        if type_code == 505:
            # API usually has score in details, but we can track manually too
            # Using details is safer
            if "homeScore" in details and "awayScore" in details:
                current_score = (details["homeScore"], details["awayScore"])
            else:
                # Fallback manual increment
                if owner_id == home_id:
                    current_score = (current_score[0] + 1, current_score[1])
                elif owner_id == away_id:
                    current_score = (current_score[0], current_score[1] + 1)
            
            # Scored First Logic
            if not first_goal_scored:
                teams[owner_id]['scored_first'] = 1
                first_goal_scored = True
                
            # Max Lead Logic
            h_score, a_score = current_score
            diff = h_score - a_score
            
            # Home Lead
            if diff > 0:
                if diff > teams[home_id]['max_lead']:
                    teams[home_id]['max_lead'] = diff
            # Away Lead
            elif diff < 0:
                if abs(diff) > teams[away_id]['max_lead']:
                    teams[away_id]['max_lead'] = abs(diff)
        # Only update if present, otherwise assume state persists
        if "situationCode" in play:
            situation_code = play["situationCode"]
            # (AwayG, AwayS, HomeS, HomeG) -> (HomeS, AwayS, HomeG, AwayG)
            ag, as_num, hs_num, hg = parse_situation(situation_code)
            current_strength = (hs_num, as_num, hg, ag)
            
            # Update PP/PK State based on NEW strength
            # Home PP: Home > Away skaters AND Away < 5 (Exclude Empty Net)
            is_home_pp = (hs_num > as_num) and (as_num < 5)
            is_away_pp = (as_num > hs_num) and (hs_num < 5)
            
            if is_home_pp and not home_pp_active:
                # teams[home_id]['pp']['opportunities'] += 1
                # teams[away_id]['pk']['opportunities'] += 1
                home_pp_active = True
            elif not is_home_pp:
                home_pp_active = False
                
            if is_away_pp and not away_pp_active:
                # teams[away_id]['pp']['opportunities'] += 1
                # teams[home_id]['pk']['opportunities'] += 1
                away_pp_active = True
            elif not is_away_pp:
                away_pp_active = False
        
        # Prune Penalties based on Actual Strength (e.g. PPG scored)
        # REMOVED: This causes bug where penalty is pruned immediately because situationCode is still 5v5
        # We rely on Virtual Expiration and PPG Pruning (in Goal block) instead.
        # if hs_num == 5:
        #     active_penalties = [p for p in active_penalties if p['team_id'] != home_id]
        # if as_num == 5:
        #     active_penalties = [p for p in active_penalties if p['team_id'] != away_id]
        
        # Track PP Opportunities (State Change Logic)
        # REMOVED: Redundant and incorrect (missing < 5 check).
        # Logic is handled inside 'if situationCode in play' block above.

    # --- xG Calculation ---
    xg_home = 0.0
    xg_away = 0.0
    xg_home_5v5 = 0.0
    xg_away_5v5 = 0.0
    
    if xg_model and shot_rows:
        try:
            import pandas as pd
            from xg_model import preprocess_data
            
            df_shots = pd.DataFrame(shot_rows)
            
            # Preprocess features (Spatial Bin, Off Wing, etc.)
            X, _ = preprocess_data(df_shots)
            
            # Predict
            probs = xg_model.predict_proba(X)[:, 1]
            
            # Add to DataFrame for summing
            df_shots['xG'] = probs
            
            # Sum by team
            xg_home = df_shots[df_shots['team_id'] == home_id]['xG'].sum()
            xg_away = df_shots[df_shots['team_id'] == away_id]['xG'].sum()
            
            # 5v5 xG
            xg_home_5v5 = df_shots[(df_shots['team_id'] == home_id) & (df_shots['strength_state'] == '5v5')]['xG'].sum()
            xg_away_5v5 = df_shots[(df_shots['team_id'] == away_id) & (df_shots['strength_state'] == '5v5')]['xG'].sum()
            
            # Update shot_rows with xG values (optional, for export)
            for i, row in enumerate(shot_rows):
                row['xG'] = round(probs[i], 4)
                
        except Exception as e:
            print(f"Error calculating xG: {e}")

    # --- Finalize Rows ---
    rows = []
    for team_id, opponent_id, side in [(home_id, away_id, "Home"), (away_id, home_id, "Away")]:
        stats = teams[team_id]
        opp_stats = teams[opponent_id]
        
        # xG
        xg_for = round(xg_home, 2) if team_id == home_id else round(xg_away, 2)
        xg_against = round(xg_away, 2) if team_id == home_id else round(xg_home, 2)
        
        xg_for_5v5 = round(xg_home_5v5, 2) if team_id == home_id else round(xg_away_5v5, 2)
        xg_against_5v5 = round(xg_away_5v5, 2) if team_id == home_id else round(xg_home_5v5, 2)
        
        # Goalie Logic
        starting_goalie_id = stats["starting_goalie"]
        starting_goalie_name = get_player_name(starting_goalie_id, roster_map) if starting_goalie_id else "Unknown"
        
        opp_starting_goalie_id = opp_stats["starting_goalie"]
        opp_starting_goalie_name = get_player_name(opp_starting_goalie_id, roster_map) if opp_starting_goalie_id else "Unknown"
        
        # Complete Game (CG) or Incomplete Game (IG)
        # If only 1 unique goalie played, it's a CG.
        cg_status = "CG" if len(stats["goalies"]) == 1 else "IG"
        cg_opp_status = "CG" if len(opp_stats["goalies"]) == 1 else "IG"
        
        # Rest Metrics
        rest = stats.get("rest", {})
        opp_rest = opp_stats.get("rest", {})
        
        # Result Logic
        goals_for = stats['goals']['total']
        goals_against = opp_stats['goals']['total']
        
        result = "Unknown"
        
        # Check for Shootout (Goals For == Goals Against in PBP, but game has a winner)
        # Note: PBP goals exclude shootout goals.
        if goals_for == goals_against:
            # It's a Shootout
            # Check final score in game_info
            final_home = game_info.get("homeTeam", {}).get("score", 0)
            final_away = game_info.get("awayTeam", {}).get("score", 0)
            
            winner_id = home_id if final_home > final_away else away_id
            
            if team_id == winner_id:
                result = "SOW"
            else:
                result = "SOL"
        else:
            # Not a Shootout (Regulation or OT)
            is_winner = goals_for > goals_against
            
            # Check if OT was played (Period 4 exists and has goals)
            # Actually, if goals_for != goals_against, we just need to know if the winning goal was in OT.
            # Or if the game went to OT at all.
            # If goals_for > goals_against:
            #   If goals['4'] > 0: OTW
            #   Else: RW
            # If goals_for < goals_against:
            #   If opp_stats['goals']['4'] > 0: OTL
            #   Else: RL
            
            if is_winner:
                if stats['goals']['4'] > 0:
                    result = "OTW"
                else:
                    result = "RW"
            else:
                if opp_stats['goals']['4'] > 0:
                    result = "OTL"
                else:
                    result = "RL"
                    
        # Blown Lead / Comeback Logic
        # Did this team win or lose?
        won_game = result in ["RW", "OTW", "SOW"]
        
        blownlead_1 = 0
        blownlead_2 = 0
        blownlead_3plus = 0
        
        comeback_1 = 0
        comeback_2 = 0
        comeback_3plus = 0
        
        my_max_lead = stats['max_lead']
        opp_max_lead = opp_stats['max_lead']
        
        if not won_game:
            # Check for Blown Lead
            if my_max_lead >= 1: blownlead_1 = 1
            if my_max_lead >= 2: blownlead_2 = 1
            if my_max_lead >= 3: blownlead_3plus = 1
        else:
            # Check for Comeback (Opponent had a lead)
            if opp_max_lead >= 1: comeback_1 = 1
            if opp_max_lead >= 2: comeback_2 = 1
            if opp_max_lead >= 3: comeback_3plus = 1
        row = {
            "game_id": game_info.get("id"),
            "game_date": game_date,
            "team": stats['name'],
            "opponent": stats['opponent'],
            "home_away": side,
            "result": result,
            "team_game_number": stats["team_game_number"],
            "opponent_game_number": opp_stats["team_game_number"],
            
            # xG
            "xG_for": xg_for,
            "xG_against": xg_against,
            "xG_for_5v5": xg_for_5v5,
            "xG_against_5v5": xg_against_5v5,
            
            # Goalie Stats
            "starting_goalie": starting_goalie_name,
            "starting_goalie_opp": opp_starting_goalie_name,
            "CG": cg_status,
            "CG_Opp": cg_opp_status,
            
            # Rest Metrics
            "is_b2b": rest.get("is_b2b", 0) if rest else 0,
            "is_3in4": rest.get("is_3in4", 0) if rest else 0,
            "is_4in6": rest.get("is_4in6", 0) if rest else 0,
            "is_6in9": rest.get("is_6in9", 0) if rest else 0,
            "is_b2b_opp": opp_rest.get("is_b2b", 0) if opp_rest else 0,
            "is_3in4_opp": opp_rest.get("is_3in4", 0) if opp_rest else 0,
            "is_4in6_opp": opp_rest.get("is_4in6", 0) if opp_rest else 0,
            "is_6in9_opp": opp_rest.get("is_6in9", 0) if opp_rest else 0,
            
            # Game Flow
            "scored_first": stats['scored_first'],
            "blownlead_1": blownlead_1,
            "blownlead_2": blownlead_2,
            "blownlead_3+": blownlead_3plus,
            "comeback_1": comeback_1,
            "comeback_2": comeback_2,
            "comeback_3+": comeback_3plus,
            
            # SOG
            "sog_for_1P": stats['sog']['1'], "sog_for_2P": stats['sog']['2'],
            "sog_for_3P": stats['sog']['3'], "sog_for_OT": stats['sog']['4'],
            "sog_for": stats['sog']['total'],
            "sog_ag_1P": opp_stats['sog']['1'], "sog_ag_2P": opp_stats['sog']['2'],
            "sog_ag_3P": opp_stats['sog']['3'], "sog_ag_OT": opp_stats['sog']['4'],
            "sog_ag": opp_stats['sog']['total'],
            
            # Attempts (Corsi)
            "attempts_for_1P": stats['attempts']['1'], "attempts_for_2P": stats['attempts']['2'],
            "attempts_for_3P": stats['attempts']['3'], "attempts_for_OT": stats['attempts']['4'],
            "attempts_for": stats['attempts']['total'],
            "attempts_ag_1P": opp_stats['attempts']['1'], "attempts_ag_2P": opp_stats['attempts']['2'],
            "attempts_ag_3P": opp_stats['attempts']['3'], "attempts_ag_OT": opp_stats['attempts']['4'],
            "attempts_ag": opp_stats['attempts']['total'],
            
            # 5v5 Attempts
            "attempts_for_5v5": stats['attempts_5v5'],
            "attempts_ag_5v5": opp_stats['attempts_5v5'],
            
            # Goals
            "goals_for_1P": stats['goals']['1'], "goals_for_2P": stats['goals']['2'],
            "goals_for_3P": stats['goals']['3'], "goals_for_OT": stats['goals']['4'],
            "goals_for": stats['goals']['total'],
            "goals_ag_1P": opp_stats['goals']['1'], "goals_ag_2P": opp_stats['goals']['2'],
            "goals_ag_3P": opp_stats['goals']['3'], "goals_ag_OT": opp_stats['goals']['4'],
            "goals_ag": opp_stats['goals']['total'],
            
            # Hits
            "hits_for_1P": stats['hits']['1'], "hits_for_2P": stats['hits']['2'],
            "hits_for_3P": stats['hits']['3'], "hits_for_OT": stats['hits']['4'],
            "hits_for": stats['hits']['total'],
            "hits_ag_1P": opp_stats['hits']['1'], "hits_ag_2P": opp_stats['hits']['2'],
            "hits_ag_3P": opp_stats['hits']['3'], "hits_ag_OT": opp_stats['hits']['4'],
            "hits_ag": opp_stats['hits']['total'],
            
            # Special Teams
            "pp_goals": stats['pp']['goals'],
            "pp_goals_against": opp_stats['pp']['goals'],
            "pp_opportunities": stats['pp']['opportunities'],
            "pk_opportunities": opp_stats['pp']['opportunities'], # Their PP opps = Our PK opps
            "pp_time": stats['pp']['time'],
            "pk_time": opp_stats['pp']['time'], # Their PP time = Our PK time
            
            # Goalie
            "saves_for": stats['saves'],
            "saves_against": opp_stats['saves'],
            "save_percentage": round(stats['saves'] / stats['sog']['total'], 3) if stats['sog']['total'] > 0 else 0,
            "save_percentage_against": round(opp_stats['saves'] / opp_stats['sog']['total'], 3) if opp_stats['sog']['total'] > 0 else 0,
            
            # Other
            "emptynet_goalsfor": stats['empty_net_goals'],
            "emptynet_goalsagainst": opp_stats['empty_net_goals'],
            "en_attempts_for": stats['en_attempts'],
            "en_attempts_against": opp_stats['en_attempts'],
            "hitpost_for": stats['posts'],
            "hitpost_against": opp_stats['posts'],
            
            # Time Stats
            "time_leading": stats['time_leading'],
            "time_trailing": stats['time_trailing'],
            "time_tied": stats['time_tied'],
            "time_evenstrength": stats['toi'].get('5v5', 0) + stats['toi'].get('4v4', 0) + stats['toi'].get('3v3', 0), # Approx
            
            # Detailed TOI
            "time_5v5": stats['toi'].get('5v5', 0),
            "time_6v5": stats['toi'].get('6v5', 0),
            "time_5v6": stats['toi'].get('5v6', 0),
            "time_4v3": stats['toi'].get('4v3', 0),
            "time_3v4": stats['toi'].get('3v4', 0),
            "time_5v3": stats['toi'].get('5v3', 0),
            "time_3v5": stats['toi'].get('3v5', 0),
            "time_6v3": stats['toi'].get('6v3', 0),
            "time_3v6": stats['toi'].get('3v6', 0),
            "time_6v4": stats['toi'].get('6v4', 0),
            "time_4v6": stats['toi'].get('4v6', 0),
            "time_4v4": stats['toi'].get('4v4', 0),
            "time_3v3": stats['toi'].get('3v3', 0),
        }
        rows.append(row)
        
    return rows, shot_rows

def main():
    # Calculate date range
    # Check for existing file to determine Start Date (Incremental Update)
    start_date = datetime.strptime(SEASON_START_DATE, "%Y-%m-%d")
    existing_dates = set()
    
    if os.path.exists(OUTPUT_FILENAME):
        print(f"Checking existing data in {OUTPUT_FILENAME}...")
        try:
            df_existing = pd.read_csv(OUTPUT_FILENAME)
            if 'game_date' in df_existing.columns and not df_existing.empty:
                df_existing['game_date'] = pd.to_datetime(df_existing['game_date'])
                max_date = df_existing['game_date'].max()
                print(f"  Last data found: {max_date.date()}")
                start_date = max_date + timedelta(days=1)
                existing_dates = set(df_existing['game_date'].dt.date)
        except Exception as e:
            print(f"Error reading existing file: {e}. Starting from scratch.")

    end_date = datetime.now() - timedelta(days=1) # Yesterday
    # end_date = datetime(2025, 12, 10) # FORCE DEBUG DATE
    # start_date = datetime(2025, 12, 10) # FORCE DEBUG DATE
    
    if start_date > end_date:
        print("Data is already up to date!")
        return

    print(f"Starting scrape from {start_date.date()} to {end_date.date()}...")
    
    all_rows = []
    all_shots = []
    all_rows = []
    all_shots = []
    current_date = start_date
    team_game_counts = {} # Track games played per team ID
    team_game_dates = defaultdict(list) # Track game dates for rest calc
    processed_game_ids = set()
    
    if os.path.exists(OUTPUT_FILENAME):
        try:
            df_existing = pd.read_csv(OUTPUT_FILENAME)
            if 'game_id' in df_existing.columns:
                processed_game_ids = set(df_existing['game_id'].unique())
                print(f"  Loaded {len(processed_game_ids)} existing Game IDs.")
        except:
            pass
            
    # Load H-Ref Stats
    load_href_stats()
    
    # Load xG Model
    xg_model = None
    try:
        with open('xg_model_xgb.pkl', 'rb') as f:
            xg_model = pickle.load(f)
        print("Loaded xG Model: xg_model_xgb.pkl")
    except FileNotFoundError:
        print("Warning: xG model not found. xG stats will be 0.")

    while current_date <= end_date:
        date_str = current_date.strftime("%Y-%m-%d")
        print(f"Processing {date_str}...")
        
        schedule = get_schedule(date_str)
        if schedule and "gameWeek" in schedule:
            # Find the specific day in the gameWeek
            days_games = []
            for day in schedule["gameWeek"]:
                if day["date"] == date_str:
                    days_games = day["games"]
                    break
            
            print(f"  Found {len(days_games)} games.")
            
            for game in days_games:
                game_id = game.get("id")
                
                # Exclude Preseason Games (01 in 5th/6th digit)
                # Example: 202501xxxx
                game_id_str = str(game_id)
                if len(game_id_str) >= 6 and game_id_str[4:6] == "01":
                    print(f"    Skipping Preseason Game {game_id}")
                    continue
                
                # Deduplication Check
                if game_id in processed_game_ids:
                    print(f"    Skipping Duplicate Game {game_id}")
                    continue
                processed_game_ids.add(game_id)
                
                # Get current game numbers for this game
                home_id = game.get("homeTeam", {}).get("id")
                away_id = game.get("awayTeam", {}).get("id")
                
                home_game_num = team_game_counts.get(home_id, 0) + 1
                away_game_num = team_game_counts.get(away_id, 0) + 1
                
                # Helper to calculate rest
                def calculate_rest(team_id, game_date_obj, history):
                    # history is a list of datetime objects
                    # Check B2B: Played yesterday?
                    yesterday = game_date_obj - timedelta(days=1)
                    is_b2b = 1 if yesterday in history else 0
                    
                    # Check 3in4: 3 games in last 4 days (including today)
                    # Count games in [date-3, date]
                    window_3in4 = [game_date_obj - timedelta(days=i) for i in range(4)]
                    count_3in4 = sum(1 for d in window_3in4 if d in history or d == game_date_obj)
                    is_3in4 = 1 if count_3in4 >= 3 else 0
                    
                    # Check 4in6: 4 games in last 6 days
                    window_4in6 = [game_date_obj - timedelta(days=i) for i in range(6)]
                    count_4in6 = sum(1 for d in window_4in6 if d in history or d == game_date_obj)
                    is_4in6 = 1 if count_4in6 >= 4 else 0
                    
                    # Check 6in9: 6 games in last 9 days
                    window_6in9 = [game_date_obj - timedelta(days=i) for i in range(9)]
                    count_6in9 = sum(1 for d in window_6in9 if d in history or d == game_date_obj)
                    is_6in9 = 1 if count_6in9 >= 6 else 0
                    
                    return {
                        "is_b2b": is_b2b,
                        "is_3in4": is_3in4,
                        "is_4in6": is_4in6,
                        "is_6in9": is_6in9
                    }

                # Calculate Rest Metrics
                home_rest = calculate_rest(home_id, current_date, set(team_game_dates[home_id]))
                away_rest = calculate_rest(away_id, current_date, set(team_game_dates[away_id]))
                
                # Fetch PBP
                print(f"    Fetching PBP for Game {game_id}...", end="", flush=True)
                pbp = get_pbp(game_id)
                
                if pbp:
                    print(f" {len(pbp.get('plays', []))} events.", end="")
                    
                    # Aggregate Stats
                    game_rows, shot_rows = aggregate_game_stats(pbp, game, date_str, xg_model, home_rest, away_rest)
                    
                    # Update game numbers in the rows
                    for row in game_rows:
                        if row['home_away'] == 'Home':
                            row['team_game_number'] = home_game_num
                            row['opponent_game_number'] = away_game_num
                        else:
                            row['team_game_number'] = away_game_num
                            row['opponent_game_number'] = home_game_num
                            
                        # --- MERGE H-REF STATS ---
                        # Use the 'abbrev' we stored (need to expose it in row or access via teams dict?)
                        # The row['team'] is currently the Common Name (e.g. "Ducks").
                        # We need the tricode.
                        # We can get it from the game object (home_id/away_id) since we serve it row by row.
                        
                        row_team_id = home_id if row['home_away'] == 'Home' else away_id
                        # Retrieve abbrev from 'game' object
                        # We already have 'game' available here in the loop
                        team_obj = game.get("homeTeam") if row['home_away'] == 'Home' else game.get("awayTeam")
                        team_abbrev = team_obj.get("abbrev")
                        
                        href_data = get_href_stats(date_str, team_abbrev)
                        
                        if href_data:
                            # Overwrite PP/PK Stats
                            row['pp_goals'] = href_data['pp_goals']
                            row['pp_opportunities'] = href_data['pp_opportunities']
                            row['pp_goals_against'] = href_data['opp_pp_goals']
                            row['pk_opportunities'] = href_data['opp_pp_opportunities'] # PK Opps = Opponent PP Opps
                            
                            # Note: pp_time and pk_time are not in H-Ref gamelog (only total mins, not seconds)
                            # We stick with our PBP time calculation as it's the best we have, or could zero it out.
                            # Users prefer accurate Opp counts over Time.
                        else:
                            # If missing (e.g. today's game not yet in gamelog?), keep calculated stats
                            # But warn?
                            # For backfill, it should exist.
                            pass

                    all_rows.extend(game_rows)
                    all_shots.extend(shot_rows)
                    print(f" -> Added {len(game_rows)} stats rows, {len(shot_rows)} shots.")

                    # Update Game Counts and History (AFTER processing the game)
                    if home_id:
                        team_game_counts[home_id] = home_game_num
                        team_game_dates[home_id].append(current_date)
                    if away_id:
                        team_game_counts[away_id] = away_game_num
                        team_game_dates[away_id].append(current_date)
                else:
                    print(" Failed.")
                
                # Rate limiting
                time.sleep(0.5)
        
        current_date += timedelta(days=1)

    # Export Game Stats to CSV
    if all_rows:
        print(f"Writing {len(all_rows)} rows to {OUTPUT_FILENAME}...")
        new_df = pd.DataFrame(all_rows)
        if os.path.exists(OUTPUT_FILENAME):
            try:
                existing_df = pd.read_csv(OUTPUT_FILENAME)
                combined_df = pd.concat([existing_df, new_df])
                combined_df.drop_duplicates(subset=['game_id', 'team'], keep='last', inplace=True)
                combined_df.to_csv(OUTPUT_FILENAME, index=False)
            except Exception as e:
                print(f"Error merging with existing gamestats: {e}. Overwriting/Appending safely.")
                # Fallback to append if read fails, but try to avoid simple append if possible
                mode = 'a'
                header = False
                new_df.to_csv(OUTPUT_FILENAME, mode=mode, header=header, index=False)
        else:
            new_df.to_csv(OUTPUT_FILENAME, index=False)
        print("Game Stats Done!")
    else:
        print("No new game data found.")
        
    # Export Shot Data to CSV
    SHOTS_FILENAME = "nhl_season_2025_2026_shots.csv"
    if all_shots:
        print(f"Writing {len(all_shots)} shots to {SHOTS_FILENAME}...")
        new_shots_df = pd.DataFrame(all_shots)
        if os.path.exists(SHOTS_FILENAME):
            try:
                existing_shots_df = pd.read_csv(SHOTS_FILENAME)
                combined_shots_df = pd.concat([existing_shots_df, new_shots_df])
                # Deduplicate: Shot ID is best, but if missing, use strict row drift
                combined_shots_df.drop_duplicates(keep='last', inplace=True) 
                combined_shots_df.to_csv(SHOTS_FILENAME, index=False)
            except Exception as e:
                print(f"Error merging with existing shots: {e}")
                mode = 'a'
                header = False
                new_shots_df.to_csv(SHOTS_FILENAME, mode=mode, header=header, index=False)
        else:
            new_shots_df.to_csv(SHOTS_FILENAME, index=False)
        print("Shot Data Done!")
    else:
        print("No new shot data found.")

if __name__ == "__main__":
    main()
