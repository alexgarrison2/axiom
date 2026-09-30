"""
scrape_games.py  (formerly nhl_scraper_poc.py; that name remains as a shim)

Scrapes completed NHL games (play-by-play + boxscore) into this season's
gamestats / shots / pbp / player_stats CSVs.

Reliability rules
  * Which games to fetch is a set difference: completed regular-season and
    playoff games on the schedule (season start .. today) minus game_ids
    already in the CSV.  A game whose fetch fails is recorded in
    pending_failed.json and is naturally retried on the next run.
  * team_game_number / opponent_game_number and the rest flags (is_b2b,
    is_3in4, is_4in6, is_6in9 and their _opp twins) are recomputed for the
    whole season file from game dates after every merge, seeded with the last
    9 days of historical games.  Playoff games are numbered separately.
  * PP/PK opportunities, PP goals and PP/PK time come from the official NHL
    per-game team reports (api.nhle.com/stats/rest team/powerplay and
    team/penaltykill, isGame=true) and are re-patched for the whole season on
    every full run (patch_special_teams).
  * After a run, every team's regular-season row count is checked against
    completed games in /v1/standings/now (verify_against_standings).
"""
from season import (season_file, SEASON_ID, START_YEAR, SEASON_START_DATE as _SEASON_START_DATE,
                    game_type_of, today_local, filter_game_types, REGULAR_SEASON, PLAYOFFS,
                    COUNTED_GAME_TYPES)
import os
import json
import sys
import time
import math
import pickle
import pandas as pd
import numpy as np
from datetime import datetime, timedelta, date
from collections import defaultdict

from http_utils import try_get_json, get_json, HttpError
from io_utils import atomic_write_csv, atomic_write_json, read_json, mark_stale, clear_stale, utc_now_iso


def assign_bin(x, y):
    """Calculate the 5x5 folded spatial bin for a given x,y coordinate."""
    if x is None or y is None: return "Unknown"
    depth_val = 89 - abs(x)
    if depth_val < 0: d = "D0"
    elif depth_val < 10: d = "D1"
    elif depth_val < 20: d = "D2"
    elif depth_val < 35: d = "D3"
    elif depth_val < 55: d = "D4"
    else: d = "D5"
    
    y_abs = abs(y)
    if y_abs < 5: w = "W1"
    elif y_abs < 15: w = "W2"
    elif y_abs < 25: w = "W3"
    elif y_abs < 35: w = "W4"
    else: w = "W5"
    
    bin_name = f"{d}_{w}"
    if bin_name == "D1_W2" or bin_name == "D2_W3":
        if y_abs < depth_val + 5:
            bin_name += "_In"
        else:
            bin_name += "_Out"
            
    return bin_name


# Constants
BASE_URL = "https://api-web.nhle.com/v1"
STATS_URL = "https://api.nhle.com/stats/rest/en"
SEASON_START_DATE = _SEASON_START_DATE
OUTPUT_FILENAME = season_file("gamestats")
PENDING_FAILED_FILE = "pending_failed.json"
HISTORICAL_GAMESTATS = "nhl_historical_gamestats.csv"
COMPLETED_STATES = ("OFF", "FINAL")
REQUEST_PAUSE = 0.3


def get_url(url):
    """Fetch JSON (TLS-verified, retried). Returns None on failure."""
    return try_get_json(url, ua="plain")


def get_schedule(date_str):
    """Fetch the schedule week containing ``date_str`` (YYYY-MM-DD)."""
    return get_url(f"{BASE_URL}/schedule/{date_str}")


def get_pbp(game_id):
    """Fetch play-by-play data for a specific game ID."""
    return get_url(f"{BASE_URL}/gamecenter/{game_id}/play-by-play")


def get_boxscore(game_id):
    """Fetch boxscore for a specific game ID."""
    return get_url(f"{BASE_URL}/gamecenter/{game_id}/boxscore")

def parse_boxscore(game_id, boxscore):
    """Parse boxscore JSON into flat list of player stats."""
    rows = []
    if not boxscore or "playerByGameStats" not in boxscore:
        return rows

    game_date = boxscore.get("gameDate")
    
    # Process both teams (Home and Away)
    for team_type in ["homeTeam", "awayTeam"]:
        team_data = boxscore.get(team_type, {})
        team_abbr = team_data.get("abbrev")
        team_id = team_data.get("id")
        
        # Process Skaters (Forwards + Defense)
        for category in ["forwards", "defense"]:
            for player in boxscore.get("playerByGameStats", {}).get(team_type, {}).get(category, []):
                # Basic info
                p_id = player.get("playerId")
                name = player.get("name", {}).get("default")
                number = player.get("sweaterNumber")
                position = player.get("position") 
                
                # Stats
                goals = player.get("goals", 0)
                assists = player.get("assists", 0)
                points = player.get("points", 0)
                plus_minus = player.get("plusMinus", 0)
                toi = player.get("toi", "00:00")
                shots = player.get("sog", 0)
                hits = player.get("hits", 0)
                blocked_shots = player.get("blockedShots", 0)
                pim = player.get("pim", 0)
                
                row = {
                    "game_id": game_id,
                    "date": game_date,
                    "team": team_abbr,
                    "team_id": team_id,
                    "player_id": p_id,
                    "name": name,
                    "number": number,
                    "position": position,
                    "goals": goals,
                    "assists": assists,
                    "points": points,
                    "plus_minus": plus_minus,
                    "toi": toi,
                    "shots": shots,
                    "hits": hits,
                    "blocked_shots": blocked_shots,
                    "pim": pim,
                    "is_goalie": 0
                }
                rows.append(row)

        # Process Goalies
        for goalie in boxscore.get("playerByGameStats", {}).get(team_type, {}).get("goalies", []):
             p_id = goalie.get("playerId")
             name = goalie.get("name", {}).get("default")
             number = goalie.get("sweaterNumber")
             position = "G"
             
             # Goalie Stats
             toi = goalie.get("toi", "00:00")
             shots_against = goalie.get("shotsAgainst", 0)
             saves = goalie.get("saves", 0)
             goals_against = goalie.get("goalsAgainst", 0)
             save_pct = goalie.get("savePctg", 0.0)
             decision = goalie.get("decision", "ND") # W, L, OT, or undefined
             
             row = {
                "game_id": game_id,
                "date": game_date,
                "team": team_abbr,
                "team_id": team_id,
                "player_id": p_id,
                "name": name,
                "number": number,
                "position": position,
                "goals": 0, # Usually 0 for goalies
                "assists": goalie.get("assists", 0), # Goalies can get assists
                "points": goalie.get("points", 0),
                "plus_minus": 0,
                "toi": toi,
                "shots": 0, 
                "hits": 0,
                "blocked_shots": 0,
                "pim": goalie.get("pim", 0),
                "is_goalie": 1,
                "shots_against": shots_against,
                "saves": saves,
                "goals_against": goals_against,
                "save_pct": save_pct,
                "decision": decision
             }
             rows.append(row)
             
    return rows

def extract_pbp_rows(pbp_json, game_info, game_date):
    """
    Extract raw play-by-play event rows from the NHL API PBP JSON.
    Returns a list of dicts matching the season PBP CSV schema.
    Each physical event generates TWO rows: one home-perspective, one away-perspective.

    Columns required by enrich_pbp.py:
        game_id, period, time_in_period, is_home_team, team_perspective
    Columns required by calc_pbp_impact.py:
        game_id, event_id, type_code, situation_code, is_home_team, team_perspective
    On-ice columns (home_on1-6, away_on1-6) are left NULL — filled by enrich_pbp.py.
    """
    game_id   = game_info.get("id")
    season    = pbp_json.get("season", int(SEASON_ID))
    game_type = game_info.get("gameType", 2)

    home_team = game_info.get("homeTeam", {})
    away_team = game_info.get("awayTeam", {})
    home_name = home_team.get("commonName", {}).get("default", "")
    away_name = away_team.get("commonName", {}).get("default", "")
    home_id   = home_team.get("id")

    roster_map = build_roster_map(pbp_json)

    plays        = pbp_json.get("plays", [])
    sorted_plays = sorted(plays, key=lambda x: x.get("sortOrder", 0))

    # Running game-state trackers
    home_score = 0
    away_score = 0
    home_sog   = 0
    away_sog   = 0

    rows = []
    for play in sorted_plays:
        period_desc = play.get("periodDescriptor", {})
        period_num  = period_desc.get("number", 1)
        period_type = period_desc.get("periodType", "REG")
        if period_type == "SO":
            continue

        time_in_period = play.get("timeInPeriod", "00:00")
        time_remaining = play.get("timeRemaining", "")
        event_id       = play.get("eventId")
        type_code      = play.get("typeCode")
        type_desc      = play.get("typeDescKey", "")
        sort_order     = play.get("sortOrder", 0)
        sit_str        = play.get("situationCode", "")
        details        = play.get("details", {})

        try:
            situation_code = int(sit_str) if sit_str else None
        except (ValueError, TypeError):
            situation_code = None

        # Parse skater/goalie counts from 4-digit situation code
        h_sk, a_sk, h_g, a_g = 5, 5, 1, 1
        if sit_str and len(sit_str) == 4:
            try:
                a_g  = int(sit_str[0])
                a_sk = int(sit_str[1])
                h_sk = int(sit_str[2])
                h_g  = int(sit_str[3])
            except ValueError:
                pass

        x_coord  = details.get("xCoord")
        y_coord  = details.get("yCoord")
        zone_code  = details.get("zoneCode", "")
        shot_type  = details.get("shotType", "")
        reason     = details.get("reason", "")
        sec_reason = details.get("secondaryReason", "")
        video_url  = play.get("videoClip", "")

        def _name(pid):
            return roster_map.get(pid, "") if pid else ""

        shooter_name      = _name(details.get("shootingPlayerId") or details.get("scoringPlayerId"))
        goalie_name       = _name(details.get("goalieInNetId"))
        blocker_name      = _name(details.get("blockingPlayerId"))
        hitter_name       = _name(details.get("hittingPlayerId"))
        hittee_name       = _name(details.get("hitteePlayerId"))
        assist1_name      = _name(details.get("assist1PlayerId"))
        assist2_name      = _name(details.get("assist2PlayerId"))
        penalty_on_name   = _name(details.get("committedByPlayerId"))
        penalty_drawn_name = _name(details.get("drawnByPlayerId"))

        # Update running score / SOG state AFTER capturing the pre-event state
        event_owner = details.get("eventOwnerTeamId")
        if type_code == 505:   # Goal
            if event_owner == home_id:
                home_score += 1
            else:
                away_score += 1
        if type_code in (505, 506):  # Goal or Shot on goal
            if event_owner == home_id:
                home_sog += 1
            else:
                away_sog += 1

        is_pp_home = int(h_sk > a_sk)
        is_pp_away = int(a_sk > h_sk)
        is_en      = int(h_g == 0 or a_g == 0)

        base = dict(
            game_id=game_id, season=season, game_date=game_date, game_type=game_type,
            period=period_num, period_type=period_type,
            time_in_period=time_in_period, time_remaining=time_remaining,
            event_id=event_id, type_code=type_code, type_desc=type_desc,
            sort_order=sort_order, situation_code=situation_code,
            x_coord=x_coord, y_coord=y_coord, zone_code=zone_code,
            shot_type=shot_type, reason=reason, secondary_reason=sec_reason,
            video_url=video_url,
            home_sog=home_sog, away_sog=away_sog,
            home_score_running=home_score, away_score_running=away_score,
            shooter_name=shooter_name, goalie_name=goalie_name,
            blocker_name=blocker_name, hitter_name=hitter_name,
            hittee_name=hittee_name, assist1_name=assist1_name,
            assist2_name=assist2_name, penalty_on_name=penalty_on_name,
            penalty_drawn_by_name=penalty_drawn_name,
            event_type=type_code, is_empty_net=is_en,
            pp_number=None, pk_number=None,
            home_on1=None, home_on2=None, home_on3=None,
            home_on4=None, home_on5=None, home_on6=None,
            away_on1=None, away_on2=None, away_on3=None,
            away_on4=None, away_on5=None, away_on6=None,
        )

        home_row = {**base,
            "team_perspective": home_name, "opponent_perspective": away_name,
            "is_home_team": True,
            "team_score": home_score, "opponent_score": away_score,
            "team_sog_running": home_sog, "opponent_sog_running": away_sog,
            "goals_for": home_score, "goals_against": away_score,
            "goal_diff": home_score - away_score,
            "team_skaters": h_sk, "opponent_skaters": a_sk,
            "team_goalie": h_g, "opponent_goalie": a_g,
            "is_pp": is_pp_home, "is_pk": is_pp_away,
        }
        away_row = {**base,
            "team_perspective": away_name, "opponent_perspective": home_name,
            "is_home_team": False,
            "team_score": away_score, "opponent_score": home_score,
            "team_sog_running": away_sog, "opponent_sog_running": home_sog,
            "goals_for": away_score, "goals_against": home_score,
            "goal_diff": away_score - home_score,
            "team_skaters": a_sk, "opponent_skaters": h_sk,
            "team_goalie": a_g, "opponent_goalie": h_g,
            "is_pp": is_pp_away, "is_pk": is_pp_home,
        }
        rows.append(home_row)
        rows.append(away_row)

    return rows


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
            "team_game_number": 0,
            "goals": {"1": 0, "2": 0, "3": 0, "4": 0, "total": 0, "5v5": 0, "ev": 0, "pp": 0, "sh": 0},
            "sog": {"1": 0, "2": 0, "3": 0, "4": 0, "total": 0, "5v5": 0, "ev": 0, "pp": 0, "sh": 0},
            "attempts": {"1": 0, "2": 0, "3": 0, "4": 0, "total": 0, "5v5": 0, "ev": 0, "pp": 0, "sh": 0},
            "xg": {"total": 0.0, "5v5": 0.0, "ev": 0.0, "pp": 0.0, "sh": 0.0},
            "hits": {"1": 0, "2": 0, "3": 0, "4": 0, "total": 0},
            "pp": {"goals": 0, "opportunities": 0, "time": 0},
            "pk": {'opportunities': 0, 'time': 0},
            "saves": 0,
            "empty_net_goals": 0,
            "en_pp_goals": 0,
            "posts": 0,
            "toi": {}, # 5v5, 5v4, etc.
            "time_leading": 0,
            "time_trailing": 0,
            "time_tied": 0,
            "control_score_sum": 0.0,
            "score_periods": {"1": {"leading": 0, "trailing": 0, "tied": 0, "control_sum": 0.0},
                              "2": {"leading": 0, "trailing": 0, "tied": 0, "control_sum": 0.0},
                              "3": {"leading": 0, "trailing": 0, "tied": 0, "control_sum": 0.0},
                              "4": {"leading": 0, "trailing": 0, "tied": 0, "control_sum": 0.0}},
            "goalies": set(),
            "starting_goalie": None,
            "rest": home_rest,
            "scored_first": 0,
            "max_lead": 0,
            "en_attempts": 0,
            "attempts_5v5": 0, # Legacy field
            "hdf": 0,
            "hda": 0,
            "hd_periods": {"1": {"f": 0, "a": 0}, "2": {"f": 0, "a": 0}, "3": {"f": 0, "a": 0}, "4": {"f": 0, "a": 0}}
        },
        away_id: {
            "name": away_team.get("commonName", {}).get("default", "Away"),
            "abbrev": away_team.get("abbrev", "AWY"),
            "opponent": home_team.get("commonName", {}).get("default", "Home"),
            "team_game_number": 0,
            "goals": {"1": 0, "2": 0, "3": 0, "4": 0, "total": 0, "5v5": 0, "ev": 0, "pp": 0, "sh": 0},
            "sog": {"1": 0, "2": 0, "3": 0, "4": 0, "total": 0, "5v5": 0, "ev": 0, "pp": 0, "sh": 0},
            "attempts": {"1": 0, "2": 0, "3": 0, "4": 0, "total": 0, "5v5": 0, "ev": 0, "pp": 0, "sh": 0},
            "xg": {"total": 0.0, "5v5": 0.0, "ev": 0.0, "pp": 0.0, "sh": 0.0},
            "hits": {"1": 0, "2": 0, "3": 0, "4": 0, "total": 0},
            "pp": {"goals": 0, "opportunities": 0, "time": 0},
            "pk": {'opportunities': 0, 'time': 0},
            "saves": 0,
            "empty_net_goals": 0,
            "en_pp_goals": 0,
            "posts": 0,
            "toi": {},
            "time_leading": 0,
            "time_trailing": 0,
            "time_tied": 0,
            "control_score_sum": 0.0,
            "score_periods": {"1": {"leading": 0, "trailing": 0, "tied": 0, "control_sum": 0.0},
                              "2": {"leading": 0, "trailing": 0, "tied": 0, "control_sum": 0.0},
                              "3": {"leading": 0, "trailing": 0, "tied": 0, "control_sum": 0.0},
                              "4": {"leading": 0, "trailing": 0, "tied": 0, "control_sum": 0.0}},
            "goalies": set(),
            "starting_goalie": None,
            "rest": away_rest,
            "scored_first": 0,
            "max_lead": 0,
            "en_attempts": 0,
            "attempts_5v5": 0,
            "hdf": 0,
            "hda": 0,
            "hd_periods": {"1": {"f": 0, "a": 0}, "2": {"f": 0, "a": 0}, "3": {"f": 0, "a": 0}, "4": {"f": 0, "a": 0}}
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
    ot_forcing_team = None
    
    home_pp_active = False
    away_pp_active = False
    active_penalties = []
    shot_rows = []
    
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
    penalty_map = defaultdict(list)
    for p in plays:
        if p.get("typeCode") == 509:
            details = p.get("details", {})
            p_time = time_to_seconds(p.get("timeInPeriod", "00:00"))
            p_period = p.get("periodDescriptor", {}).get("number", 1)
            key = (p_period, p_time)
            penalty_map[key].append({
                'team_id': details.get("eventOwnerTeamId"),
                'duration': details.get("duration", 2)
            })

    def get_control_weight(score_diff):
        """Returns the control weight per second for a team with the given score differential."""
        if score_diff == 0:   return 1.0
        elif score_diff == 1: return 1.2
        elif score_diff == 2: return 1.5
        elif score_diff >= 3: return 2.0
        elif score_diff == -1: return 0.8
        elif score_diff == -2: return 0.5
        else:                 return 0.0  # trailing by 3+

    def get_strength_type(hs, as_num, hg, ag, owner_team_id):
        """
        Returns '5v5', 'ev', 'pp', 'sh' for the OWNER team.
        """
        # Exclude Goalies for numeric calc check, but strictly 5v5 required for 5v5.
        
        # 5v5 Strict
        if hs == 5 and as_num == 5 and hg == 1 and ag == 1:
            return '5v5', 'ev' # It is BOTH 5v5 and EV
            
        # Strength Difference
        # Owner Skaters vs Opp Skaters
        my_skaters = hs if owner_team_id == home_id else as_num
        opp_skaters = as_num if owner_team_id == home_id else hs
        
        # EV Check (Equal Skaters, Goalies present)
        # Note: 4v4, 3v3 are EV.
        # Empty Net situations (6v5) are usually NOT EV in loose sense, but strictly yes numeric advantage.
        # Standard AdvancedStats:
        # 5v5: 5s, 5s, 1g, 1g.
        # EV: 5v5, 4v4, 3v3. (Goalies present).
        # PP: My Skaters > Opp Skaters.
        # SH: My Skaters < Opp Skaters.
        # Other: Empty Net, etc.
        
        is_empty_net = (hg == 0 or ag == 0)
        
        if not is_empty_net and my_skaters == opp_skaters:
            return None, 'ev' # Not 5v5 (unless handled above), but is EV
        
        if my_skaters > opp_skaters:
            return None, 'pp'
            
        if my_skaters < opp_skaters:
            return None, 'sh'
            
        return None, None # Fallback (e.g. Empty Net 6v5 -> PP? Or just Other?)

    for i, play in enumerate(sorted_plays):
        event_id = play.get("eventId")
        type_code = play.get("typeCode")
        details = play.get("details", {})
        period_desc = play.get("periodDescriptor", {})
        period_num = period_desc.get("number", 1)
        period_type = period_desc.get("periodType", "REG")
        
        if period_type == 'SO':
            continue
        
        time_in_period = play.get("timeInPeriod", "00:00")
        current_seconds = time_to_seconds(time_in_period)
        
        if period_num != prev_period:
            prev_time_seconds = 0
            prev_period = period_num
            active_penalties = []
            
        # ... (Virtual Expiration Logic - Same as before) ...
        # (Shortening for diff context, assuming existing logic remains or needs slight re-paste if I cut it off)
        # Wait, I am replacing a big block. I need to keep the Virtual Expiration logic or re-write it.
        # The surrounding context of my replacement was lines 298-349.
        # I need to be careful not to delete the Expiration Logic loop that follows.
        # The replacement block ends at line 645, which is inside `shot_row` construction in my viewed file?
        # NO. The viewed file `nhl_scraper_poc.py` had `aggregate_game_stats` starting at line 282.
        # My target replacement lines 298-349 cover the `teams` dict initialization.
        # My replacement content covers `teams` dict replacement.
        # BUT I also added `get_strength_type` helper and some variable inits.
        # I should just replace the `teams` initialization block first.

            
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
            p_key = str(min(period_num, 4))
            if score_diff > 0:
                teams[home_id]['time_leading'] += segment_duration
                teams[away_id]['time_trailing'] += segment_duration
                teams[home_id]['score_periods'][p_key]['leading'] += segment_duration
                teams[away_id]['score_periods'][p_key]['trailing'] += segment_duration
            elif score_diff < 0:
                teams[home_id]['time_trailing'] += segment_duration
                teams[away_id]['time_leading'] += segment_duration
                teams[home_id]['score_periods'][p_key]['trailing'] += segment_duration
                teams[away_id]['score_periods'][p_key]['leading'] += segment_duration
            else:
                teams[home_id]['time_tied'] += segment_duration
                teams[away_id]['time_tied'] += segment_duration
                teams[home_id]['score_periods'][p_key]['tied'] += segment_duration
                teams[away_id]['score_periods'][p_key]['tied'] += segment_duration
            teams[home_id]['control_score_sum'] += get_control_weight(score_diff) * segment_duration
            teams[away_id]['control_score_sum'] += get_control_weight(-score_diff) * segment_duration
            teams[home_id]['score_periods'][p_key]['control_sum'] += get_control_weight(score_diff) * segment_duration
            teams[away_id]['score_periods'][p_key]['control_sum'] += get_control_weight(-score_diff) * segment_duration
                
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
            p_key = str(min(period_num, 4))
            if score_diff > 0:
                teams[home_id]['time_leading'] += duration
                teams[away_id]['time_trailing'] += duration
                teams[home_id]['score_periods'][p_key]['leading'] += duration
                teams[away_id]['score_periods'][p_key]['trailing'] += duration
            elif score_diff < 0:
                teams[home_id]['time_trailing'] += duration
                teams[away_id]['time_leading'] += duration
                teams[home_id]['score_periods'][p_key]['trailing'] += duration
                teams[away_id]['score_periods'][p_key]['leading'] += duration
            else:
                teams[home_id]['time_tied'] += duration
                teams[away_id]['time_tied'] += duration
                teams[home_id]['score_periods'][p_key]['tied'] += duration
                teams[away_id]['score_periods'][p_key]['tied'] += duration
            teams[home_id]['control_score_sum'] += get_control_weight(score_diff) * duration
            teams[away_id]['control_score_sum'] += get_control_weight(-score_diff) * duration
            teams[home_id]['score_periods'][p_key]['control_sum'] += get_control_weight(score_diff) * duration
            teams[away_id]['score_periods'][p_key]['control_sum'] += get_control_weight(-score_diff) * duration

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
                
            # --- High Danger Tracking ---
            s_bin = assign_bin(x, y)
            high_danger_bins = ['D2_W3_In', 'D2_W2', 'D1_W2_In', 'D3_W1', 'D2_W1', 'D1_W1']

            if s_bin in high_danger_bins:
                opp_team_id = away_id if owner_id == home_id else home_id
                if owner_id in teams:
                    teams[owner_id]['hdf'] += 1
                    teams[owner_id]['hd_periods'][period_key]['f'] += 1
                if opp_team_id in teams:
                    teams[opp_team_id]['hda'] += 1
                    teams[opp_team_id]['hd_periods'][period_key]['a'] += 1


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
                # Goals (505)
        if type_code == 505:
            if owner_id in teams:
                teams[owner_id]['goals'][period_key] += 1
                teams[owner_id]['goals']['total'] += 1
                teams[owner_id]['sog'][period_key] += 1 
                teams[owner_id]['sog']['total'] += 1
                teams[owner_id]['attempts'][period_key] += 1 
                teams[owner_id]['attempts']['total'] += 1
                
                # 5v5 Check
                if current_strength == (5, 5, 1, 1):
                    teams[owner_id]['attempts_5v5'] += 1
                
                # PP Goal Check using Situation Code (Reliable)
                # Parse situationCode directly from event if available
                situation_code = play.get('situationCode')
                is_pp_goal = False
                
                if situation_code and len(situation_code) == 4:
                    try:
                        ag_g = int(situation_code[0]) # Away Goalie
                        ag_s = int(situation_code[1]) # Away Skaters
                        hg_s = int(situation_code[2]) # Home Skaters
                        hg_g = int(situation_code[3]) # Home Goalie
                        
                        # Effective Skaters (Attackers + Defenders - Goalie)
                        # Actually we just want "Skaters on Ice". The situation code gives Skaters (excluding goalie).
                        # e.g. 1551 -> 5 skaters each.
                        # 1450 -> Away 1G+4S, Home 0G+5S.
                        
                        # Empty Net "Advantage" (6v5, 5v4EN) should NOT count as PPG unless there is also a numeric advantage due to penalty?
                        # Standard rule: PPG is when you have more skaters than opponent, AND opponent is short (<=4).
                        # If 6v5 (EN), it's 6 vs 5. 5 is not short. -> EV.
                        # If 5v4 (EN), it's 5 vs 4. 4 is short. -> PPG.
                        # If 4v4 (EN -> 5v4), it's 5 vs 4. 4 is short. -> PPG?
                        # Wait, my analysis of 2-03:36 game 2025020734:
                        # DAL (4) vs ANA (5, EN). 4v4 base.
                        # It was NOT a PPG in H-Ref.
                        # So "Skater Advantage due to EN" does not create PPG.
                        # We must compare BASE skaters.
                        
                        # Base Skaters = Skaters - (1 if No Goalie else 0)? 
                        # No, Skaters count in SitCode includes the extra attacker.
                        # So if Home has 5S and 0G, they have 5 skaters on ice. 1 is extra.
                        # Base strength (penalty-wise) is 4.
                        # Formula: BaseSkaters = Skaters - (1 if Goalie == 0 else 0)
                        
                        home_base = hg_s - (1 if hg_g == 0 else 0)
                        away_base = ag_s - (1 if ag_g == 0 else 0)
                        
                        if owner_id == home_id:
                            # Home Goal
                            # PPG if Home > Away (Numeric) AND Away < 5 (Short)
                            # Use BASE skaters to determine if "Power Play" condition exists
                            if home_base > away_base and away_base < 5:
                                is_pp_goal = True
                        else:
                            # Away Goal
                            if away_base > home_base and home_base < 5:
                                is_pp_goal = True
                                
                    except:
                        pass
                
                # Fallback if no sit code (Old logic, but corrected)
                # But V1 API has sit code usually.
                
                sec_type = details.get("secondaryType", "").lower()
                is_penalty_shot = "penalty" in sec_type

                if is_pp_goal and not is_penalty_shot:
                    teams[owner_id]['pp']['goals'] += 1
                    
                    # End Penalty Logic (Same as before)
                    # If Home scored PPG, remove oldest Away Minor
                    scoring_team = owner_id
                    penalized_team = away_id if scoring_team == home_id else home_id
                    
                    team_penalties = [p for p in active_penalties if p['team_id'] == penalized_team]
                    team_penalties.sort(key=lambda x: x['end_time'])
                    
                    for i, p in enumerate(team_penalties):
                        if p['duration'] < 5:
                            active_penalties.remove(p)
                            # Update current_strength for valid interval tracking
                            h_skaters, a_skaters, hg, ag = current_strength
                            if penalized_team == home_id:
                                current_strength = (min(5, h_skaters + 1), a_skaters, hg, ag)
                            else:
                                current_strength = (h_skaters, min(5, a_skaters + 1), hg, ag)
                            break 
                    
                # Empty Net Goal
                if (owner_id == home_id and (situation_code and situation_code[0] == '0')) or \
                   (owner_id == away_id and (situation_code and situation_code[3] == '0')):
                    teams[owner_id]['empty_net_goals'] += 1
                    teams[owner_id]['en_attempts'] += 1
                    if is_pp_goal:
                        teams[owner_id]['en_pp_goals'] += 1

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

                # Blocks count as shot attempts, so track High Danger on blocks too
                s_bin = assign_bin(x, y)
                high_danger_bins = ['D2_W3_In', 'D2_W2', 'D1_W2_In', 'D3_W1', 'D2_W1', 'D1_W1']
                
                if s_bin in high_danger_bins:
                    opp_team_id = away_id if shooter_id == home_id else home_id
                    if shooter_id in teams:
                        teams[shooter_id]['hdf'] += 1
                        teams[shooter_id]['hd_periods'][period_key]['f'] += 1
                    if opp_team_id in teams:
                        teams[opp_team_id]['hda'] += 1
                        teams[opp_team_id]['hd_periods'][period_key]['a'] += 1

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
                opp_id = away_id if owner_id == home_id else home_id
                
                # Check current time in penalty_map (Concurrent start)
                key = (period_num, current_seconds)
                concurrent_penalties = penalty_map.get(key, [])
                
                max_opp_end = 0
                
                # Check ALREADY ACTIVE penalties for opponent
                for p in active_penalties:
                    if p['team_id'] == opp_id:
                        if p['end_time'] > max_opp_end:
                            max_opp_end = p['end_time']

                # Check CONCURRENT STARTING penalties for opponent
                for p in concurrent_penalties:
                    if p['team_id'] == opp_id:
                         # Calculate absolute end time for concurrent
                         # duration in event is minutes
                         conc_end = current_seconds + (p['duration'] * 60)
                         if conc_end > max_opp_end:
                             max_opp_end = conc_end
                
                # Calculate My End Time
                my_end_time = penalty_end
                
                # Opportunity Logic:
                # If my penalty extends BEYOND the coverage of opponent penalties, 
                # I am giving them a Power Play (Net Advantage timeframe).
                # Also, if Opponent has NO penalties (max_opp_end == 0), it is a PPO.
                
                if my_end_time > max_opp_end and duration_min < 10:
                     if owner_id == home_id:
                        teams[away_id]['pp']['opportunities'] += 1
                        teams[home_id]['pk']['opportunities'] += 1
                     elif owner_id == away_id:
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
                
                # OTML Logic: Track who forced the tie in Regulation
                if current_score[0] == current_score[1] and period_num <= 3:
                    ot_forcing_team = owner_id
                elif current_score[0] != current_score[1]:
                    ot_forcing_team = None
            
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
            
            # Helper to map strength string from my logic to row features
            # The shot_rows already have 'strength_state' which is '5v5', '5v4', 'EmptyNet'.
            # We need to map these to EV/PP/SH.
            
            def map_strength(row):
                s = row['strength_state']
                code = row['strength_state'] # e.g. "5v5" or "5v4" or "EmptyNet"
                ev, pp, sh = 0, 0, 0
                
                # Parse
                if code == 'EmptyNet':
                    # Empty Net is technically a form of unequal strength but often bucketed separately or as Other.
                    # For filtering, usually excluded from strictly 5v5.
                    pass
                else:
                    try:
                        p = code.split('v')
                        my_s = int(p[0])
                        op_s = int(p[1])
                        
                        if my_s == op_s: ev = 1
                        if my_s > op_s: pp = 1
                        if my_s < op_s: sh = 1
                    except:
                        pass
                
                return pd.Series([ev, pp, sh])

            df_shots[['is_ev', 'is_pp', 'is_sh']] = df_shots.apply(map_strength, axis=1)

            # Sum by team & strength
            for tid in [home_id, away_id]:
                t_mask = df_shots['team_id'] == tid
                teams[tid]['xg']['total'] = df_shots[t_mask]['xG'].sum()
                teams[tid]['xg']['5v5'] = df_shots[t_mask & (df_shots['strength_state'] == '5v5')]['xG'].sum()
                teams[tid]['xg']['ev'] = df_shots[t_mask & (df_shots['is_ev'] == 1)]['xG'].sum()
                teams[tid]['xg']['pp'] = df_shots[t_mask & (df_shots['is_pp'] == 1)]['xG'].sum()
                teams[tid]['xg']['sh'] = df_shots[t_mask & (df_shots['is_sh'] == 1)]['xG'].sum()

            
            xg_home = teams[home_id]['xg']['total']
            xg_away = teams[away_id]['xg']['total']
            xg_home_5v5 = teams[home_id]['xg']['5v5']
            xg_away_5v5 = teams[away_id]['xg']['5v5']
            
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
            "save_percentage": round(stats['saves'] / opp_stats['sog']['total'], 3) if opp_stats['sog']['total'] > 0 else 0,
            "save_percentage_against": round(opp_stats['saves'] / stats['sog']['total'], 3) if stats['sog']['total'] > 0 else 0,
            
            # Other
            "emptynet_goalsfor": stats['empty_net_goals'],
            "emptynet_goalsagainst": opp_stats['empty_net_goals'],
            "en_pp_goalsfor": stats['en_pp_goals'],
            "en_pp_goalsagainst": opp_stats['en_pp_goals'],
            "en_attempts_for": stats['en_attempts'],
            "en_attempts_against": opp_stats['en_attempts'],
            "hitpost_for": stats['posts'],
            "hitpost_against": opp_stats['posts'],
            
            # Time Stats (full game)
            "time_leading": stats['time_leading'],
            "time_trailing": stats['time_trailing'],
            "time_tied": stats['time_tied'],
            # Time Stats (per period) — score_periods[p] = {leading, trailing, tied, control_sum}
            "time_leading_1P": stats['score_periods']['1']['leading'],
            "time_trailing_1P": stats['score_periods']['1']['trailing'],
            "time_tied_1P": stats['score_periods']['1']['tied'],
            "time_leading_2P": stats['score_periods']['2']['leading'],
            "time_trailing_2P": stats['score_periods']['2']['trailing'],
            "time_tied_2P": stats['score_periods']['2']['tied'],
            "time_leading_3P": stats['score_periods']['3']['leading'],
            "time_trailing_3P": stats['score_periods']['3']['trailing'],
            "time_tied_3P": stats['score_periods']['3']['tied'],
            "time_leading_OT": stats['score_periods']['4']['leading'],
            "time_trailing_OT": stats['score_periods']['4']['trailing'],
            "time_tied_OT": stats['score_periods']['4']['tied'],
            "control_score": round(stats['control_score_sum'] / (stats['time_leading'] + stats['time_trailing'] + stats['time_tied']), 4) if (stats['time_leading'] + stats['time_trailing'] + stats['time_tied']) > 0 else 1.0,
            "control_score_1P": round(stats['score_periods']['1']['control_sum'] / (stats['score_periods']['1']['leading'] + stats['score_periods']['1']['trailing'] + stats['score_periods']['1']['tied']), 4) if (stats['score_periods']['1']['leading'] + stats['score_periods']['1']['trailing'] + stats['score_periods']['1']['tied']) > 0 else 1.0,
            "control_score_2P": round(stats['score_periods']['2']['control_sum'] / (stats['score_periods']['2']['leading'] + stats['score_periods']['2']['trailing'] + stats['score_periods']['2']['tied']), 4) if (stats['score_periods']['2']['leading'] + stats['score_periods']['2']['trailing'] + stats['score_periods']['2']['tied']) > 0 else 1.0,
            "control_score_3P": round(stats['score_periods']['3']['control_sum'] / (stats['score_periods']['3']['leading'] + stats['score_periods']['3']['trailing'] + stats['score_periods']['3']['tied']), 4) if (stats['score_periods']['3']['leading'] + stats['score_periods']['3']['trailing'] + stats['score_periods']['3']['tied']) > 0 else 1.0,
            "control_score_OT": round(stats['score_periods']['4']['control_sum'] / (stats['score_periods']['4']['leading'] + stats['score_periods']['4']['trailing'] + stats['score_periods']['4']['tied']), 4) if (stats['score_periods']['4']['leading'] + stats['score_periods']['4']['trailing'] + stats['score_periods']['4']['tied']) > 0 else 1.0,
            "time_evenstrength": stats['toi'].get('5v5', 0) + stats['toi'].get('4v4', 0) + stats['toi'].get('3v3', 0), # Approx
            
            # OTML (Off The Mat Loss)
            # Team lost in OT/SO (Result Code OTL/SOL) AND was the team that forced the tie in Regulation
            "ot_loss": 1 if (result in ['OTL', 'SOL'] and ot_forcing_team == team_id) else 0,
            "otml": "Yes" if (result in ['OTL', 'SOL'] and ot_forcing_team == team_id) else "-",
            
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
            
            # --- STRENGTH SPLITS ---
            # Goals
            "goals_5v5": stats['goals']['5v5'],
            "goals_ev": stats['goals']['ev'],
            "goals_pp": stats['goals']['pp'],
            "goals_sh": stats['goals']['sh'],
            "goals_ag_5v5": opp_stats['goals']['5v5'],
            "goals_ag_ev": opp_stats['goals']['ev'],
            "goals_ag_pp": opp_stats['goals']['pp'],
            "goals_ag_sh": opp_stats['goals']['sh'],
            
            # SOG
            "sog_5v5": stats['sog']['5v5'],
            "sog_ev": stats['sog']['ev'],
            "sog_pp": stats['sog']['pp'],
            "sog_sh": stats['sog']['sh'],
            "sog_ag_5v5": opp_stats['sog']['5v5'],
            "sog_ag_ev": opp_stats['sog']['ev'],
            "sog_ag_pp": opp_stats['sog']['pp'],
            "sog_ag_sh": opp_stats['sog']['sh'],
            
            # Attempts
            "attempts_5v5": stats['attempts']['5v5'], # Overwrite old logic if needed, but this is cleaner
            "attempts_ev": stats['attempts']['ev'],
            "attempts_pp": stats['attempts']['pp'],
            "attempts_sh": stats['attempts']['sh'],
            "attempts_ag_5v5": opp_stats['attempts']['5v5'],
            "attempts_ag_ev": opp_stats['attempts']['ev'],
            "attempts_ag_pp": opp_stats['attempts']['pp'],
            "attempts_ag_sh": opp_stats['attempts']['sh'],
            
            # xG Splits
            "xg_for_5v5": round(stats['xg']['5v5'], 2),
            "xg_for_ev": round(stats['xg']['ev'], 2),
            "xg_for_pp": round(stats['xg']['pp'], 2),
            "xg_for_sh": round(stats['xg']['sh'], 2),
            "xg_ag_5v5": round(opp_stats['xg']['5v5'], 2),
            "xg_ag_ev": round(opp_stats['xg']['ev'], 2),
            "xg_ag_pp": round(opp_stats['xg']['pp'], 2),
            "xg_ag_sh": round(opp_stats['xg']['sh'], 2),

            # High Danger Totals & Per-Period
            "hdf": stats['hdf'],
            "hda": stats['hda'],
            "hdf_1P": stats['hd_periods']['1']['f'], "hdf_2P": stats['hd_periods']['2']['f'],
            "hdf_3P": stats['hd_periods']['3']['f'], "hdf_OT": stats['hd_periods']['4']['f'],
            "hda_1P": stats['hd_periods']['1']['a'], "hda_2P": stats['hd_periods']['2']['a'],
            "hda_3P": stats['hd_periods']['3']['a'], "hda_OT": stats['hd_periods']['4']['a'],
        }
        rows.append(row)
        
    return rows, shot_rows

# ── Sequence fields: game numbers and rest flags ─────────────────────────────

REST_WINDOWS = {"is_3in4": (4, 3), "is_4in6": (6, 4), "is_6in9": (9, 6)}
REST_COLS = ["is_b2b", "is_3in4", "is_4in6", "is_6in9"]


def _prior_dates(hist_path, before, days=9):
    """{team: [dates]} from the historical gamestats in the ``days`` before ``before``."""
    if not hist_path or not os.path.exists(hist_path) or before is None:
        return {}
    try:
        h = pd.read_csv(hist_path, usecols=["game_id", "game_date", "team"])
    except Exception:
        return {}
    h = filter_game_types(h)
    h["game_date"] = pd.to_datetime(h["game_date"]).dt.normalize()
    lo = pd.Timestamp(before) - pd.Timedelta(days=days)
    h = h[(h["game_date"] >= lo) & (h["game_date"] < pd.Timestamp(before))]
    return {t: list(g["game_date"]) for t, g in h.groupby("team")}


def recompute_sequence_fields(df, prior_dates=None):
    """Recompute team/opponent game numbers and rest flags from game dates.

    team_game_number counts a team's games of the same type (regular season
    and playoffs are numbered separately) ordered by (date, game_id).  Rest
    flags use every counted game the team played (plus ``prior_dates``).
    Deterministic, so re-running over any subset of the season gives the same
    numbers regardless of the order games were scraped in.
    """
    if df is None or df.empty:
        return df
    df = df.reset_index(drop=True).copy()
    prior_dates = prior_dates or {}
    d = pd.to_datetime(df["game_date"]).dt.normalize()
    gids = df["game_id"].astype("int64")
    gtype = gids.astype(str).str[4:6]

    tmp = pd.DataFrame({"team": df["team"], "gid": gids, "d": d, "t": gtype})
    tmp = tmp.sort_values(["team", "t", "d", "gid"])
    df["team_game_number"] = (tmp.groupby(["team", "t"]).cumcount() + 1).reindex(df.index).astype(int)

    flags = {c: np.zeros(len(df), dtype=int) for c in REST_COLS}
    one_day = np.timedelta64(1, "D")
    for team, idx in df.groupby("team").groups.items():
        dates = np.array(sorted(set(d.loc[idx]) | set(pd.to_datetime(prior_dates.get(team, [])))),
                         dtype="datetime64[ns]")
        dset = set(dates.tolist())
        for i in idx:
            x = np.datetime64(d.loc[i].to_datetime64(), "ns")
            flags["is_b2b"][i] = int((x - one_day).astype("datetime64[ns]").tolist() in dset)
            for col, (window, need) in REST_WINDOWS.items():
                lo = x - np.timedelta64(window - 1, "D")
                n = int(np.searchsorted(dates, x, side="right") - np.searchsorted(dates, lo, side="left"))
                flags[col][i] = int(n >= need)
    for c in REST_COLS:
        df[c] = flags[c]

    key = dict(zip(zip(gids, df["team"]), df.index))
    opp_idx = [key.get((g, o)) for g, o in zip(gids, df["opponent"])]
    have = [i for i, j in enumerate(opp_idx) if j is not None]
    src = [opp_idx[i] for i in have]
    if "opponent_game_number" not in df.columns:
        df["opponent_game_number"] = 0
    df.loc[have, "opponent_game_number"] = df.loc[src, "team_game_number"].values
    for c in REST_COLS:
        if f"{c}_opp" not in df.columns:
            df[f"{c}_opp"] = 0
        df.loc[have, f"{c}_opp"] = df.loc[src, c].values
    return df


# ── Schedule-driven game selection ───────────────────────────────────────────

def completed_schedule_games(start, end, game_types=(2, 3)):
    """({game_id: (date, game)}, ok) for completed games of ``game_types`` in
    [start, end], walking the weekly /schedule endpoint.  ``ok`` is False if
    any week could not be fetched (missing games are picked up next run)."""
    games, ok = {}, True
    d = start
    while d <= end:
        wk = get_schedule(d.isoformat())
        step = d + timedelta(days=7)
        if not wk:
            ok = False
            d = step
            continue
        for day in wk.get("gameWeek", []) or []:
            try:
                dd = date.fromisoformat(day["date"])
            except Exception:
                continue
            if not (start <= dd <= end):
                continue
            for g in day.get("games", []) or []:
                if g.get("gameType") in game_types and g.get("gameState") in COMPLETED_STATES:
                    games[int(g["id"])] = (dd, g)
        try:
            nxt = date.fromisoformat(wk["nextStartDate"]) if wk.get("nextStartDate") else step
        except ValueError:
            nxt = step
        d = max(step, nxt)
        time.sleep(0.05)
    return games, ok


# ── Official special-teams counts (replaces the Hockey-Reference scrape) ─────

REPORT_LAG_DAYS = 2    # games this recent may not be in the stats report yet

def fetch_special_teams(season_id=SEASON_ID):
    """{(gameId, teamId): {pp_goals, pp_opportunities, pp_time, pp_goals_against,
    pk_opportunities, pk_time}} from the NHL per-game team reports (2 requests).
    Returns None if either report cannot be fetched."""
    q = (f"isAggregate=false&isGame=true&limit=-1"
         f"&cayenneExp=seasonId={season_id}%20and%20gameTypeId%3E=2")
    try:
        pp = get_json(f"{STATS_URL}/team/powerplay?{q}", ua="plain", timeout=30).get("data", [])
        pk = get_json(f"{STATS_URL}/team/penaltykill?{q}", ua="plain", timeout=30).get("data", [])
    except (HttpError, AttributeError) as e:
        print(f"  [WARN] special-teams report unavailable: {e}")
        return None
    out = {}
    for r in pp:
        k = (int(r["gameId"]), int(r["teamId"]))
        out.setdefault(k, {}).update({
            "pp_goals": int(r.get("powerPlayGoalsFor") or 0),
            "pp_opportunities": int(r.get("ppOpportunities") or 0),
            "pp_time": int(round(r.get("ppTimeOnIcePerGame") or 0)),
        })
    for r in pk:
        k = (int(r["gameId"]), int(r["teamId"]))
        out.setdefault(k, {}).update({
            "pp_goals_against": int(r.get("ppGoalsAgainst") or 0),
            "pk_opportunities": int(r.get("timesShorthanded") or 0),
            "pk_time": int(round(r.get("pkTimeOnIcePerGame") or 0)),
        })
    return out


ST_COLS = ["pp_goals", "pp_opportunities", "pp_time", "pp_goals_against", "pk_opportunities", "pk_time"]


def patch_special_teams(gamestats_path=None, season_id=SEASON_ID, report=None,
                        teams_csv=None, write=True):
    """Overwrite the PP/PK columns of every ``season_id`` row in
    ``gamestats_path`` with the official per-game report (joined on
    gameId + teamId).  Returns a status dict."""
    gamestats_path = gamestats_path or OUTPUT_FILENAME
    if not os.path.exists(gamestats_path):
        return {"status": "skip", "rows_written": 0, "reason": "no gamestats yet"}
    df = pd.read_csv(gamestats_path, low_memory=False, float_precision="round_trip")
    sid = str(season_id)
    in_season = df["game_id"].astype("int64").astype(str).str[:4] == sid[:4] if not df.empty else []
    if df.empty or not in_season.any():
        return {"status": "skip", "rows_written": 0, "reason": "no games for season"}
    report = report if report is not None else fetch_special_teams(season_id)
    if report is None:
        mark_stale("special_teams", "NHL team/powerplay report unavailable")
        return {"status": "fail", "rows_written": 0, "reason": "report unavailable"}

    teams = pd.read_csv(teams_csv or os.path.join(os.path.dirname(os.path.abspath(__file__)), "nhl_teams.csv"))
    name_to_id = dict(zip(teams["Common Name"], teams["NHL Team ID"].astype(int)))
    name_to_id.setdefault("Coyotes", 53)   # Arizona (through 2023-24)
    # Utah: franchise id 59 (Utah Hockey Club, 2024-25) and 68 (Mammoth).
    utah_ids = (68, 59)

    for c in ST_COLS:
        if c not in df.columns:
            df[c] = 0
    matched = missing = pending = changed = 0
    # The stats report trails the gamecenter feed by a few hours, so games
    # from the last REPORT_LAG_DAYS that aren't in it yet keep their
    # PBP-derived counts and are patched on a later run instead of failing.
    lag_cutoff = (today_local() - timedelta(days=REPORT_LAG_DAYS)).isoformat()
    for i in df.index[in_season]:
        gid = int(df.at[i, "game_id"])
        tid = name_to_id.get(df.at[i, "team"])
        rec = report.get((gid, tid)) if tid is not None else None
        if rec is None and (tid in utah_ids or df.at[i, "team"] in ("Mammoth", "Utah Hockey Club", "Hockey Club")):
            rec = report.get((gid, 68)) or report.get((gid, 59))
        if rec is None:
            if str(df.at[i, "game_date"]) >= lag_cutoff:
                pending += 1
            else:
                missing += 1
            continue
        matched += 1
        for c in ST_COLS:
            if c in rec and df.at[i, c] != rec[c]:
                df.at[i, c] = rec[c]
                changed += 1
    if write and changed:
        atomic_write_csv(gamestats_path, df, min_rows=len(df), label=os.path.basename(gamestats_path))
    if missing:
        mark_stale("special_teams", f"{missing} team-games missing from the NHL PP/PK report")
    else:
        clear_stale("special_teams")
    print(f"  Special teams patched from NHL report ({sid}): {matched} team-games matched, "
          f"{missing} unmatched, {pending} recent team-games not in the report yet, {changed} values changed")
    return {"status": "ok" if missing == 0 else "fail", "rows_written": matched if changed else 0,
            "matched": matched, "missing": missing, "pending": pending, "changed": changed,
            "reason": f"{pending} recent team-games pending in the NHL report" if pending and not missing else ""}


# ── Post-run check against official standings ────────────────────────────────

def verify_against_standings(df, end_date=None):
    """Every team's regular-season row count must equal its games played in
    the official standings (as of ``end_date``; /standings/now for today)."""
    end_date = end_date or today_local()
    url = (f"{BASE_URL}/standings/now" if end_date >= today_local()
           else f"{BASE_URL}/standings/{end_date.isoformat()}")
    st = get_url(url)
    if not st or not st.get("standings"):
        return {"status": "skip", "reason": "standings unavailable", "mismatches": {}}
    reg = filter_game_types(df, (REGULAR_SEASON,)) if df is not None and not df.empty else pd.DataFrame()
    counts = reg.groupby("team").size().to_dict() if not reg.empty else {}
    mism = {}
    for r in st["standings"]:
        name = (r.get("teamCommonName") or {}).get("default")
        gp = int(r.get("gamesPlayed") or 0)
        have = int(counts.get(name, 0))
        if have != gp:
            mism[name] = {"rows": have, "standings_gp": gp}
    teams = len(st["standings"])
    if mism:
        print(f"  [ERROR] Game-count check: {len(mism)}/{teams} teams differ from standings: "
              + ", ".join(f"{k} {v['rows']}!={v['standings_gp']}" for k, v in list(mism.items())[:8]))
        mark_stale("gamestats", f"{len(mism)} teams' row counts differ from standings")
    else:
        print(f"  ✓ Game-count check: all {teams} teams match standings")
        clear_stale("gamestats")
    return {"status": "fail" if mism else "ok", "teams": teams, "mismatches": mism}


# ── Main ─────────────────────────────────────────────────────────────────────

def _merge_write(path, new_rows, keys, label, sort_cols=None, **read_kw):
    """Append ``new_rows`` to CSV ``path`` (dedupe on ``keys``); never shrink."""
    if not new_rows:
        return 0
    new_df = pd.DataFrame(new_rows)
    old = pd.read_csv(path, float_precision="round_trip", **read_kw) if os.path.exists(path) else pd.DataFrame()
    comb = pd.concat([old, new_df], ignore_index=True) if not old.empty else new_df
    comb = comb.drop_duplicates(subset=keys, keep="last")
    if sort_cols:
        comb = comb.sort_values([c for c in sort_cols if c in comb.columns], kind="stable")
    atomic_write_csv(path, comb, min_rows=len(old), label=label)
    return len(new_df)


def main(argv=None, *, start_year=None, workdir=None, end_date=None, verify=True,
         pause=REQUEST_PAUSE):
    """Scrape every completed, not-yet-stored game of the season.

    Returns {'status', 'rows_written', 'games_added', 'failed', 'pending', 'verify', ...}."""
    import argparse
    parser = argparse.ArgumentParser(description="Scrape completed NHL games")
    parser.add_argument("--full", action="store_true", help="Re-scrape every game of the season")
    parser.add_argument("--season", type=int, help="Season start year (default: current)")
    parser.add_argument("--end", help="Last date to include (YYYY-MM-DD, default today ET)")
    parser.add_argument("--no-verify", action="store_true")
    args = parser.parse_args(argv or [])

    start_year = start_year or args.season or START_YEAR
    wd = workdir or "."
    p = lambda name: os.path.join(wd, name)  # noqa: E731
    gamestats_path = p(season_file("gamestats", start_year))
    season_start = date(start_year, 9, 1)
    end = end_date or (date.fromisoformat(args.end) if args.end else today_local())
    verify = verify and not args.no_verify

    existing = pd.DataFrame()
    if os.path.exists(gamestats_path) and not args.full:
        existing = pd.read_csv(gamestats_path, low_memory=False, float_precision="round_trip")
        n0 = len(existing)
        existing = filter_game_types(existing, COUNTED_GAME_TYPES, start_year=start_year)
        if len(existing) != n0:
            print(f"  Dropped {n0 - len(existing)} rows that are not {start_year} regular-season/playoff games")
    processed = set(existing["game_id"].astype("int64")) if not existing.empty else set()

    print(f"Collecting completed games {season_start} -> {end} from the NHL schedule...")
    sched, sched_ok = completed_schedule_games(season_start, end)
    todo = sorted(((d, gid, g) for gid, (d, g) in sched.items() if gid not in processed),
                  key=lambda x: (x[0], x[1]))
    pending = read_json(p(PENDING_FAILED_FILE), {}) or {}
    retrying = [str(g) for _, g, _ in todo if str(g) in pending]
    print(f"  Schedule: {len(sched)} completed games; stored: {len(processed)}; to fetch: {len(todo)}"
          + (f" (incl. {len(retrying)} previously failed)" if retrying else ""))
    if not sched_ok:
        print("  [WARN] Some schedule weeks could not be fetched; missing games will be retried next run.")

    xg_model = None
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "xg_model_xgb.pkl"), "rb") as f:
            xg_model = pickle.load(f)
    except FileNotFoundError:
        print("Warning: xG model not found. xG stats will be 0.")

    all_rows, all_shots, all_pbp_rows, all_player_stats = [], [], [], []
    failed = {}
    for gdate, game_id, game in todo:
        date_str = gdate.isoformat()
        print(f"    {date_str} game {game_id}: PBP...", end="", flush=True)
        pbp = get_pbp(game_id)
        if not pbp or not pbp.get("plays"):
            print(" Failed.")
            prev = pending.get(str(game_id), {})
            failed[str(game_id)] = {
                "date": date_str, "attempts": int(prev.get("attempts", 0)) + 1,
                "first_failed_at": prev.get("first_failed_at") or utc_now_iso(),
                "last_error": "play-by-play unavailable"}
            continue
        game_rows, shot_rows = aggregate_game_stats(pbp, game, date_str, xg_model, None, None)
        box = get_boxscore(game_id)
        if box:
            all_player_stats.extend(parse_boxscore(game_id, box))
        try:
            all_pbp_rows.extend(extract_pbp_rows(pbp, game, date_str))
        except Exception as e:
            print(f" [WARN] PBP row extraction failed: {e}", end="")
        all_rows.extend(game_rows)
        all_shots.extend(shot_rows)
        print(f" {len(game_rows)} rows, {len(shot_rows)} shots")
        time.sleep(pause)

    # ── Game stats: merge, recompute numbering/rest for the whole season, write ──
    games_added = len({r["game_id"] for r in all_rows})
    combined = existing
    if all_rows:
        new_df = pd.DataFrame(all_rows)
        combined = pd.concat([existing, new_df], ignore_index=True) if not existing.empty else new_df
        combined = combined.drop_duplicates(subset=["game_id", "team"], keep="last")
    if not combined.empty:
        first = pd.to_datetime(combined["game_date"]).min()
        hist = (os.path.join(os.path.dirname(os.path.abspath(__file__)), HISTORICAL_GAMESTATS)
                if workdir is None else p(HISTORICAL_GAMESTATS))
        before = combined.reset_index(drop=True).copy()
        combined = recompute_sequence_fields(combined, _prior_dates(hist, first))
        combined = combined.sort_values(["game_date", "game_id", "home_away"], ascending=[True, True, False],
                                        kind="stable")
        seq_cols = ["team_game_number", "opponent_game_number"] + REST_COLS + [f"{c}_opp" for c in REST_COLS]
        seq_cols = [c for c in seq_cols if c in before.columns]
        a = before.set_index(["game_id", "team"])[seq_cols].sort_index()
        b = combined.set_index(["game_id", "team"])[seq_cols].sort_index()
        seq_changed = not a.astype("int64").equals(b.astype("int64"))
        if all_rows or seq_changed or args.full:
            atomic_write_csv(gamestats_path, combined, min_rows=len(existing), label="gamestats")
            print(f"  ✓ {os.path.basename(gamestats_path)}: {len(combined)} rows ({games_added} new games"
                  f"{', sequence fields corrected' if seq_changed and not all_rows else ''})")

    shots_added = _merge_write(p(season_file("shots", start_year)), all_shots, ["game_id", "event_id"],
                               "season shots", sort_cols=["game_id", "event_id"], low_memory=False)
    _merge_write(p(season_file("pbp", start_year)), all_pbp_rows, ["game_id", "event_id", "is_home_team"],
                 "season pbp", low_memory=False)
    _merge_write(p(season_file("player_stats", start_year)), all_player_stats, ["game_id", "player_id"],
                 "season player stats")

    # ── Pending failures: kept for the next run's retry ──
    recovered = [g for g in retrying if g not in failed]
    atomic_write_json(p(PENDING_FAILED_FILE), failed, label="pending_failed.json")
    if recovered:
        print(f"  ✓ {len(recovered)} previously failed game(s) now stored: {', '.join(recovered[:10])}")
    if failed:
        print(f"  [WARN] {len(failed)} game(s) failed and will be retried next run: {', '.join(list(failed)[:10])}")

    ver = {"status": "skip"}
    if verify:
        ver = verify_against_standings(combined, end)

    return {"status": "ok" if not failed else "fail", "rows_written": len(all_rows),
            "games_added": games_added, "shots_added": shots_added, "failed": list(failed),
            "recovered": recovered, "pending": len(failed), "verify": ver, "schedule_complete": sched_ok}


if __name__ == "__main__":
    if "--patch-special-teams" in sys.argv:
        # python scrape_games.py --patch-special-teams 20252026 [--file nhl_historical_gamestats.csv]
        sid = sys.argv[sys.argv.index("--patch-special-teams") + 1]
        f = sys.argv[sys.argv.index("--file") + 1] if "--file" in sys.argv else season_file("gamestats", int(sid[:4]))
        print(patch_special_teams(f, season_id=sid))
        sys.exit(0)
    res = main(sys.argv[1:])
    print({k: v for k, v in res.items() if k != "verify"}, "verify:", res["verify"].get("status"))
