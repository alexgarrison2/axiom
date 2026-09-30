"""
Scrape historical NHL playoff game data (2021-22 through 2024-25)
from the NHL API to derive empirical playoff coefficients.

Outputs: playoff_historical.csv — one row per team per game with
         all metrics needed to compare playoff vs regular season.

Usage (from pipeline/): python tools/scrape_playoff_history.py
"""

import urllib.request
import json
import csv
import ssl
import time
import os
import sys
from datetime import datetime, timedelta

BASE_URL = "https://api-web.nhle.com/v1"
# Verified TLS (certifi's CA bundle when available).
try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CTX = ssl.create_default_context()

# Playoff windows (conservative — covers full playoff period each season)
SEASONS = [
    {"season": "20212022", "start": "2022-05-02", "end": "2022-06-30"},
    {"season": "20222023", "start": "2023-04-17", "end": "2023-06-20"},
    {"season": "20232024", "start": "2024-04-20", "end": "2024-06-30"},
    {"season": "20242025", "start": "2025-04-19", "end": "2025-06-30"},
]

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "playoff_historical.csv")


def get_url(url, retries=3):
    """Fetch URL with retries."""
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=15, context=_SSL_CTX) as response:
                return json.loads(response.read().decode())
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(1.5)
            else:
                print(f"  FAILED: {url} — {e}")
                return None


def get_schedule(date_str):
    return get_url(f"{BASE_URL}/schedule/{date_str}")


def get_boxscore(game_id):
    return get_url(f"{BASE_URL}/gamecenter/{game_id}/boxscore")


def get_right_rail(game_id):
    return get_url(f"{BASE_URL}/gamecenter/{game_id}/right-rail")


def get_pbp(game_id):
    return get_url(f"{BASE_URL}/gamecenter/{game_id}/play-by-play")


def game_id_to_round(game_id):
    """Extract playoff round from game ID.
    Format: SSSSTTGGGG where TT=03 for playoffs, GGGG encodes round.
    Round 1: 0100-0199, Round 2: 0200-0299, Round 3: 0300-0399, Round 4 (SCF): 0400-0499
    """
    gid_str = str(game_id)
    if len(gid_str) >= 10:
        game_num = int(gid_str[6:])
        if game_num < 200:
            return 1
        elif game_num < 300:
            return 2
        elif game_num < 400:
            return 3
        else:
            return 4
    return 0


def parse_right_rail_stats(right_rail):
    """Extract team game stats from right-rail. Returns (home_stats, away_stats) dicts."""
    home = {}
    away = {}
    if not right_rail:
        return home, away
    for item in right_rail.get("teamGameStats", []):
        cat = item.get("category", "")
        home[cat] = item.get("homeValue", 0)
        away[cat] = item.get("awayValue", 0)
    return home, away


def parse_game(game_id, boxscore, pbp, right_rail=None):
    """Extract game-level stats for both teams. Returns list of 2 row dicts."""
    if not boxscore or not pbp:
        return []

    game_date = boxscore.get("gameDate", "")
    season = boxscore.get("season", 0)
    playoff_round = game_id_to_round(game_id)

    home_team_data = boxscore.get("homeTeam", {})
    away_team_data = boxscore.get("awayTeam", {})
    home_abbr = home_team_data.get("abbrev", "")
    away_abbr = away_team_data.get("abbrev", "")
    home_id = home_team_data.get("id")
    away_id = away_team_data.get("id")
    home_score = home_team_data.get("score", 0)
    away_score = away_team_data.get("score", 0)

    # Determine game outcome
    game_outcome = boxscore.get("gameOutcome", {})
    last_period_type = game_outcome.get("lastPeriodType", "REG")
    went_to_ot = last_period_type == "OT"

    # Count OT periods from PBP
    plays = pbp.get("plays", [])
    max_period = 3
    for play in plays:
        pd = play.get("periodDescriptor", {})
        pnum = pd.get("number", 1)
        ptype = pd.get("periodType", "REG")
        if ptype != "SO" and pnum > max_period:
            max_period = pnum
    ot_periods = max(0, max_period - 3)

    # --- Extract team stats from right-rail (has PP, hits, blocks, giveaways, takeaways) ---
    rr_home, rr_away = parse_right_rail_stats(right_rail)

    # --- Right-rail stats (authoritative for PP, hits, blocks, giveaways, takeaways) ---
    def parse_pp(pp_val):
        """Parse PP string like '2/4' into (goals, opps)."""
        if isinstance(pp_val, str) and '/' in pp_val:
            parts = pp_val.split('/')
            try:
                return int(parts[0]), int(parts[1])
            except (ValueError, IndexError):
                return 0, 0
        return 0, 0

    h_pp_g, h_pp_o = parse_pp(rr_home.get("powerPlay", "0/0"))
    a_pp_g, a_pp_o = parse_pp(rr_away.get("powerPlay", "0/0"))
    h_hits = int(rr_home.get("hits", 0))
    a_hits = int(rr_away.get("hits", 0))
    h_blocks = int(rr_home.get("blockedShots", 0))
    a_blocks = int(rr_away.get("blockedShots", 0))
    h_giveaways = int(rr_home.get("giveaways", 0))
    a_giveaways = int(rr_away.get("giveaways", 0))
    h_takeaways = int(rr_home.get("takeaways", 0))
    a_takeaways = int(rr_away.get("takeaways", 0))

    # --- PBP-derived metrics (period-by-period, attempts, HD chances) ---
    h_goals_by_period = {1: 0, 2: 0, 3: 0, "OT": 0}
    a_goals_by_period = {1: 0, 2: 0, 3: 0, "OT": 0}
    h_shots_by_period = {1: 0, 2: 0, 3: 0, "OT": 0}
    a_shots_by_period = {1: 0, 2: 0, 3: 0, "OT": 0}
    h_attempts = 0
    a_attempts = 0
    h_attempts_5v5 = 0
    a_attempts_5v5 = 0
    h_hd_chances = 0  # high-danger shot attempts
    a_hd_chances = 0
    h_pp_goals_pbp = 0  # keep for validation
    a_pp_goals_pbp = 0

    # Time tracking for 5v5 estimation
    # Situation code: 4 digits — away_goalie, away_skaters, home_skaters, home_goalie
    # 5v5 = situation where both have 5 skaters and both goalies in

    for play in plays:
        pd = play.get("periodDescriptor", {})
        pnum = pd.get("number", 1)
        ptype = pd.get("periodType", "REG")
        if ptype == "SO":
            continue

        period_key = pnum if pnum <= 3 else "OT"
        type_code = play.get("typeCode")
        details = play.get("details", {})
        event_owner = details.get("eventOwnerTeamId")
        sit_str = play.get("situationCode", "")

        # Parse situation
        h_sk, a_sk = 5, 5
        if sit_str and len(sit_str) == 4:
            try:
                a_sk = int(sit_str[1])
                h_sk = int(sit_str[2])
            except ValueError:
                pass
        is_5v5 = (h_sk == 5 and a_sk == 5)
        is_pp_home = h_sk > a_sk
        is_pp_away = a_sk > h_sk

        # High-danger zone check (x, y coords)
        x = details.get("xCoord")
        y = details.get("yCoord")
        is_hd = False
        if x is not None and y is not None:
            depth = 89 - abs(x)
            y_abs = abs(y)
            # HD bins from memory: D1_W1, D1_W2_In, D2_W1, D2_W2, D2_W3_In, D3_W1
            if depth < 10 and y_abs < 5:       # D1_W1
                is_hd = True
            elif depth < 10 and y_abs < 15 and y_abs < depth + 5:  # D1_W2_In
                is_hd = True
            elif depth >= 10 and depth < 20 and y_abs < 5:   # D2_W1
                is_hd = True
            elif depth >= 10 and depth < 20 and y_abs < 15:  # D2_W2
                is_hd = True
            elif depth >= 10 and depth < 20 and y_abs < 25 and y_abs < depth + 5:  # D2_W3_In
                is_hd = True
            elif depth >= 20 and depth < 35 and y_abs < 5:   # D3_W1
                is_hd = True

        # Goals
        if type_code == 505:
            if event_owner == home_id:
                h_goals_by_period[period_key] = h_goals_by_period.get(period_key, 0) + 1
                if is_pp_home:
                    h_pp_goals_pbp += 1
            elif event_owner == away_id:
                a_goals_by_period[period_key] = a_goals_by_period.get(period_key, 0) + 1
                if is_pp_away:
                    a_pp_goals_pbp += 1

        # Shots on goal
        if type_code in (505, 506):  # goal or shot
            if event_owner == home_id:
                h_shots_by_period[period_key] = h_shots_by_period.get(period_key, 0) + 1
                h_attempts += 1
                if is_5v5:
                    h_attempts_5v5 += 1
                if is_hd:
                    h_hd_chances += 1
            elif event_owner == away_id:
                a_shots_by_period[period_key] = a_shots_by_period.get(period_key, 0) + 1
                a_attempts += 1
                if is_5v5:
                    a_attempts_5v5 += 1
                if is_hd:
                    a_hd_chances += 1

        # Missed shots and blocked shots count as attempts
        if type_code == 507:  # missed shot
            if event_owner == home_id:
                h_attempts += 1
                if is_5v5:
                    h_attempts_5v5 += 1
                if is_hd:
                    h_hd_chances += 1
            elif event_owner == away_id:
                a_attempts += 1
                if is_5v5:
                    a_attempts_5v5 += 1
                if is_hd:
                    a_hd_chances += 1

        if type_code == 508:  # blocked shot (credited to shooter's team)
            if event_owner == home_id:
                h_attempts += 1
                if is_5v5:
                    h_attempts_5v5 += 1
                a_blocks += 1  # opponent blocked it
            elif event_owner == away_id:
                a_attempts += 1
                if is_5v5:
                    a_attempts_5v5 += 1
                h_blocks += 1

        # (hits, penalties, giveaways, takeaways sourced from right-rail)

    # SOG totals
    h_sog = sum(h_shots_by_period.values())
    a_sog = sum(a_shots_by_period.values())
    h_goals = sum(h_goals_by_period.values())
    a_goals = sum(a_goals_by_period.values())

    # Save percentages
    h_sv_pct = (a_sog - a_goals) / a_sog if a_sog > 0 else 0.0  # home goalie vs away shots
    a_sv_pct = (h_sog - h_goals) / h_sog if h_sog > 0 else 0.0  # away goalie vs home shots

    # PP values already set from right-rail above

    # Build rows (one per team perspective)
    def make_row(team_abbr, opp_abbr, is_home, goals_for, goals_against,
                 sog_for, sog_against, attempts_for, attempts_against,
                 attempts_5v5_for, attempts_5v5_against,
                 hd_for, hd_against, hits_for, hits_against,
                 blocks_for, blocks_against, penalties_drawn,
                 pp_goals_for, pp_opps_for, pp_goals_against, pp_opps_against,
                 giveaways, takeaways, goals_by_period_for, goals_by_period_against,
                 shots_by_period_for, shots_by_period_against, sv_pct):
        won = goals_for > goals_against
        return {
            "game_id": game_id,
            "season": season,
            "game_date": game_date,
            "playoff_round": playoff_round,
            "team": team_abbr,
            "opponent": opp_abbr,
            "is_home": 1 if is_home else 0,
            "won": 1 if won else 0,
            "goals_for": goals_for,
            "goals_against": goals_against,
            "went_to_ot": 1 if went_to_ot else 0,
            "ot_periods": ot_periods,
            "sog_for": sog_for,
            "sog_against": sog_against,
            "attempts_for": attempts_for,
            "attempts_against": attempts_against,
            "attempts_5v5_for": attempts_5v5_for,
            "attempts_5v5_against": attempts_5v5_against,
            "hd_chances_for": hd_for,
            "hd_chances_against": hd_against,
            "hits_for": hits_for,
            "hits_against": hits_against,
            "blocks_for": blocks_for,
            "blocks_against": blocks_against,
            "penalties_drawn": penalties_drawn,
            "pp_goals_for": pp_goals_for,
            "pp_opportunities": pp_opps_for,
            "pp_goals_against": pp_goals_against,
            "pk_opportunities": pp_opps_against,
            "giveaways": giveaways,
            "takeaways": takeaways,
            "save_pct": round(sv_pct, 4),
            "goals_for_1P": goals_by_period_for.get(1, 0),
            "goals_for_2P": goals_by_period_for.get(2, 0),
            "goals_for_3P": goals_by_period_for.get(3, 0),
            "goals_for_OT": goals_by_period_for.get("OT", 0),
            "goals_ag_1P": goals_by_period_against.get(1, 0),
            "goals_ag_2P": goals_by_period_against.get(2, 0),
            "goals_ag_3P": goals_by_period_against.get(3, 0),
            "goals_ag_OT": goals_by_period_against.get("OT", 0),
            "sog_for_1P": shots_by_period_for.get(1, 0),
            "sog_for_2P": shots_by_period_for.get(2, 0),
            "sog_for_3P": shots_by_period_for.get(3, 0),
            "sog_for_OT": shots_by_period_for.get("OT", 0),
            "sog_ag_1P": shots_by_period_against.get(1, 0),
            "sog_ag_2P": shots_by_period_against.get(2, 0),
            "sog_ag_3P": shots_by_period_against.get(3, 0),
            "sog_ag_OT": shots_by_period_against.get("OT", 0),
        }

    rows = []
    # Home perspective
    rows.append(make_row(
        home_abbr, away_abbr, True, home_score, away_score,
        h_sog, a_sog, h_attempts, a_attempts,
        h_attempts_5v5, a_attempts_5v5,
        h_hd_chances, a_hd_chances, h_hits, a_hits,
        h_blocks, a_blocks, h_pp_o,  # penalties_drawn = our PP opps = opponent's penalties taken
        h_pp_g, h_pp_o, a_pp_g, a_pp_o,
        h_giveaways, h_takeaways, h_goals_by_period, a_goals_by_period,
        h_shots_by_period, a_shots_by_period, h_sv_pct
    ))
    # Away perspective
    rows.append(make_row(
        away_abbr, home_abbr, False, away_score, home_score,
        a_sog, h_sog, a_attempts, h_attempts,
        a_attempts_5v5, h_attempts_5v5,
        a_hd_chances, h_hd_chances, a_hits, h_hits,
        a_blocks, h_blocks, a_pp_o,
        a_pp_g, a_pp_o, h_pp_g, h_pp_o,
        a_giveaways, a_takeaways, a_goals_by_period, h_goals_by_period,
        a_shots_by_period, h_shots_by_period, a_sv_pct
    ))
    return rows


def main():
    all_rows = []
    processed_ids = set()

    # Check for existing file to support resume
    if os.path.exists(OUTPUT_FILE):
        print(f"Found existing {OUTPUT_FILE}, loading processed game IDs...")
        with open(OUTPUT_FILE, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                processed_ids.add(int(row['game_id']))
                all_rows.append(row)
        print(f"  Loaded {len(processed_ids)} games already processed.")

    for season_info in SEASONS:
        season = season_info["season"]
        start = datetime.strptime(season_info["start"], "%Y-%m-%d")
        end = datetime.strptime(season_info["end"], "%Y-%m-%d")

        print(f"\n{'='*60}")
        print(f"Season {season} — {season_info['start']} to {season_info['end']}")
        print(f"{'='*60}")

        current = start
        season_games = 0

        while current <= end:
            date_str = current.strftime("%Y-%m-%d")
            schedule = get_schedule(date_str)

            if schedule and "gameWeek" in schedule:
                for day in schedule["gameWeek"]:
                    if day["date"] != date_str:
                        continue
                    for game in day.get("games", []):
                        game_id = game.get("id")
                        if not game_id:
                            continue

                        # Check it's a playoff game (type 03)
                        gid_str = str(game_id)
                        if len(gid_str) >= 6 and gid_str[4:6] != "03":
                            continue

                        # Check game is final
                        state = game.get("gameState", "")
                        if state not in ("OFF", "FINAL"):
                            continue

                        if game_id in processed_ids:
                            continue

                        print(f"  {date_str} — Game {game_id} "
                              f"(R{game_id_to_round(game_id)}): "
                              f"{game.get('awayTeam', {}).get('abbrev', '?')} @ "
                              f"{game.get('homeTeam', {}).get('abbrev', '?')}")

                        boxscore = get_boxscore(game_id)
                        pbp = get_pbp(game_id)
                        right_rail = get_right_rail(game_id)
                        time.sleep(0.3)  # Rate limit

                        rows = parse_game(game_id, boxscore, pbp, right_rail)
                        if rows:
                            all_rows.extend(rows)
                            processed_ids.add(game_id)
                            season_games += 1

            current += timedelta(days=1)

        print(f"  Season {season}: {season_games} playoff games scraped.")

    # Write output
    if not all_rows:
        print("No data collected!")
        return

    # Determine fieldnames from first row (handle both dict and OrderedDict)
    fieldnames = list(all_rows[0].keys())

    with open(OUTPUT_FILE, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    unique_games = len(processed_ids)
    print(f"\nDone! Wrote {len(all_rows)} rows ({unique_games} unique games) to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
