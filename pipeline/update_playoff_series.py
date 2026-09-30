"""
Update playoff_series.json with actual game results from the NHL API.
Fetches scores for all completed games and updates series win counts.

Usage: python3 update_playoff_series.py
Run from the pipeline/ directory (writes to ../public/data/playoff_series.json).
"""

import json
import os
import sys
import datetime
import subprocess
import urllib.request
import ssl

DATA_FILE = os.path.join(os.path.dirname(__file__), "../public/data/playoff_series.json")
SEASON = 20252026
NHL_SEASON_YEAR = 2026  # second year of season

# NHL playoff game IDs: 202503SS0G
# SS = series code 11-18 (A-H in round 1), game = last digit(s)
# higherSeed is always home for G1/G2/G5/G7, lowerSeed home for G3/G4/G6
SERIES_CODE_MAP = {
    "R1_E_ATL1vWC2": 11,   # BUF vs BOS
    "R1_E_MET2vATL2": 12,  # TBL vs MTL
    "R1_E_MET1vWC2": 13,   # CAR vs OTT
    "R1_E_MET3vATL3": 14,  # PIT vs PHI
    "R1_W_C1vWC2": 15,     # COL vs LAK
    "R1_W_C2vP3": 16,      # DAL vs MIN
    "R1_W_P1vWC1": 17,     # VGK vs UTA
    "R1_W_P2vP4": 18,      # EDM vs ANA
}


def fetch_json(url):
    from http_utils import get_json
    return get_json(url, ua="plain")


def build_series_code_map_from_bracket():
    """
    Auto-detect series codes from the NHL bracket API rather than using a hardcoded map.
    Returns dict: seriesId -> NHL series code (11-18, 21-24, etc.)
    """
    try:
        data = fetch_json(f"https://api-web.nhle.com/v1/playoff-bracket/{NHL_SEASON_YEAR}")
    except Exception as e:
        print(f"  Warning: could not fetch bracket: {e}")
        return {}

    bracket_series = data.get("series", [])
    # Build a map: (topSeedAbbrev, bottomSeedAbbrev) -> seriesLetter
    bracket_map = {}
    for s in bracket_series:
        top = s.get("topSeedTeam", {}).get("abbrev", "")
        bot = s.get("bottomSeedTeam", {}).get("abbrev", "")
        letter = s.get("seriesLetter", "")
        rnd = s.get("playoffRound", 1)
        bracket_map[(top, bot)] = (letter, rnd, s)
        bracket_map[(bot, top)] = (letter, rnd, s)
    return bracket_map


def letter_to_code(letter, rnd):
    """Convert series letter + round to NHL game ID series code."""
    # Round 1: A-H -> 11-18
    # Round 2: A-D -> 21-24
    # Round 3: A-B -> 31-32 (conference finals)
    # Round 4: A   -> 41 (Stanley Cup Final)
    base = rnd * 10
    idx = ord(letter.upper()) - ord("A")
    return base + idx + 1


def fetch_game_results_for_date(date_str):
    """Return list of completed playoff games for a given YYYY-MM-DD."""
    url = f"https://api-web.nhle.com/v1/schedule/{date_str}"
    try:
        data = fetch_json(url)
    except Exception as e:
        print(f"  Warning: could not fetch {date_str}: {e}")
        return []

    results = []
    for day in data.get("gameWeek", []):
        if day.get("date") != date_str:
            continue  # API returns full week; only process the requested date
        for g in day.get("games", []):
            if g.get("gameType") != 3:
                continue
            if g.get("gameState") not in ("OFF", "FINAL"):
                continue
            home = g.get("homeTeam", {})
            away = g.get("awayTeam", {})
            game_id = g.get("id", 0)
            # Extract series code and game number from ID
            # Format: YYYY 03 SS G  (last 3 digits = SSG, SS=2 digits, G=1 digit)
            series_code = (game_id // 10) % 100
            game_num = game_id % 10
            results.append({
                "gameId": game_id,
                "seriesCode": series_code,
                "gameNumber": game_num,
                "homeTriCode": home.get("abbrev", ""),
                "awayTriCode": away.get("abbrev", ""),
                "homeScore": home.get("score"),
                "awayScore": away.get("score"),
                "date": date_str,
            })
    return results


BOVADA_TEAM_MAP = {
    "Anaheim Ducks": "ANA", "Boston Bruins": "BOS", "Buffalo Sabres": "BUF",
    "Calgary Flames": "CGY", "Carolina Hurricanes": "CAR", "Chicago Blackhawks": "CHI",
    "Colorado Avalanche": "COL", "Columbus Blue Jackets": "CBJ", "Dallas Stars": "DAL",
    "Detroit Red Wings": "DET", "Edmonton Oilers": "EDM", "Florida Panthers": "FLA",
    "Los Angeles Kings": "LAK", "Minnesota Wild": "MIN", "Montreal Canadiens": "MTL",
    "Nashville Predators": "NSH", "New Jersey Devils": "NJD", "New York Islanders": "NYI",
    "New York Rangers": "NYR", "Ottawa Senators": "OTT", "Philadelphia Flyers": "PHI",
    "Pittsburgh Penguins": "PIT", "San Jose Sharks": "SJS", "Seattle Kraken": "SEA",
    "St. Louis Blues": "STL", "Tampa Bay Lightning": "TBL", "Toronto Maple Leafs": "TOR",
    "Utah Hockey Club": "UTA", "Utah Mammoth": "UTA", "Vancouver Canucks": "VAN",
    "Vegas Golden Knights": "VGK", "Washington Capitals": "WSH", "Winnipeg Jets": "WPG",
}

def fetch_series_odds():
    """Fetch live series winner odds from Bovada. Returns dict: (triA, triB) -> {triA: odds, triB: odds}."""
    url = "https://www.bovada.lv/services/sports/event/v2/events/A/description/hockey/nhl-playoff-series-betting"
    try:
        from http_utils import try_get_json
        data = try_get_json(url, retries=2)
        if not data:
            return {}
        events = data[0].get("events", []) if isinstance(data, list) else data.get("events", [])
    except Exception as e:
        print(f"  Warning: could not fetch series odds: {e}")
        return {}

    odds_map = {}
    for ev in events:
        teams_in_desc = ev.get("description", "")
        for dg in ev.get("displayGroups", []):
            for mkt in dg.get("markets", []):
                if mkt.get("description", "").lower() not in ("series winner", "moneyline"):
                    continue
                outcomes = mkt.get("outcomes", [])
                if len(outcomes) != 2:
                    continue
                pair = {}
                for o in outcomes:
                    name = o.get("description", "")
                    tri = BOVADA_TEAM_MAP.get(name)
                    raw = o.get("price", {}).get("american", "")
                    if tri and raw:
                        try:
                            pair[tri] = int(raw.replace("+", "").replace("EVEN", "100"))
                            if raw == "EVEN":
                                pair[tri] = 100
                        except ValueError:
                            pass
                if len(pair) == 2:
                    key = frozenset(pair.keys())
                    odds_map[key] = pair
    print(f"  Fetched series odds for {len(odds_map)} series from Bovada")
    return odds_map


NETWORK_MAP = {
    "ESPN": "ESPN", "ESPN2": "ESPN2", "ABC": "ABC",
    "TNT": "TNT", "TBS": "TBS", "MAX": "MAX",
    "SN": "SN", "TVAS": "TVAS", "NHL Network": "NHLN",
}

def fetch_scheduled_game_times(series_list):
    """
    Fetch start times and TV networks for all future scheduled playoff games
    from the NHL schedule API. Updates games in-place.
    """
    import datetime
    today = datetime.date.today()
    future_dates = set()
    for s in series_list:
        for g in s.get("games", []):
            if g.get("status") != "final":
                d = g.get("date", "")
                if d:
                    future_dates.add(d)

    if not future_dates:
        return

    print(f"Fetching scheduled times for {len(future_dates)} future date(s): {sorted(future_dates)}")

    # Build lookup: (homeTriCode, awayTriCode) -> game data
    api_games = {}
    for d in sorted(future_dates):
        url = f"https://api-web.nhle.com/v1/schedule/{d}"
        try:
            data = fetch_json(url)
        except Exception as e:
            print(f"  Warning: could not fetch {d}: {e}")
            continue
        for day in data.get("gameWeek", []):
            if day.get("date") != d:
                continue
            for g in day.get("games", []):
                if g.get("gameType") != 3:
                    continue
                home = g.get("homeTeam", {}).get("abbrev", "")
                away = g.get("awayTeam", {}).get("abbrev", "")
                start_utc = g.get("startTimeUTC", "")
                # Derive CT time
                start_ct = ""
                try:
                    from datetime import datetime as dt
                    import re
                    utc_dt = dt.fromisoformat(start_utc.replace("Z", "+00:00"))
                    # UTC to CT (CST=-6, CDT=-5; use CDT during April-Oct)
                    offset_hours = -5  # CDT
                    ct_dt = utc_dt.replace(tzinfo=None)
                    from datetime import timedelta
                    ct_dt = dt.fromisoformat(start_utc.replace("Z", "")).replace(tzinfo=None)
                    import calendar
                    ct_hour = ct_dt.hour - 5  # CDT offset
                    if ct_hour < 0:
                        ct_hour += 24
                    ampm = "AM" if ct_hour < 12 else "PM"
                    h12 = ct_hour % 12 or 12
                    mins = ct_dt.minute
                    start_ct = f"{h12}:{mins:02d} {ampm}"
                except Exception:
                    pass
                # Extract TV broadcast
                tv = ""
                for broadcast in g.get("tvBroadcasts", []):
                    if broadcast.get("market") in ("N", "U"):  # National/US
                        raw = broadcast.get("network", "")
                        tv = NETWORK_MAP.get(raw, raw)
                        break
                api_games[(home, away, d)] = {
                    "startTimeUTC": start_utc,
                    "startTimeCT": start_ct,
                    "tvNetwork": tv,
                }

    # Apply to series games
    updated = 0
    for s in series_list:
        for g in s.get("games", []):
            if g.get("status") == "final":
                continue
            home = g.get("homeTriCode", "")
            away = g.get("awayTriCode", "")
            game_date = g.get("date", "")
            if (home, away, game_date) in api_games:
                info = api_games[(home, away, game_date)]
                if info["startTimeUTC"]:
                    g["startTimeUTC"] = info["startTimeUTC"]
                if info["startTimeCT"]:
                    g["startTimeCT"] = info["startTimeCT"]
                else:
                    g["startTimeCT"] = ""  # unknown → show TBD
                if info["tvNetwork"]:
                    g["tvNetwork"] = info["tvNetwork"]
                updated += 1
    print(f"  Updated start times for {updated} scheduled game(s).")


def get_all_playoff_dates(series_list):
    """Collect all game dates from our local series data."""
    dates = set()
    today = datetime.date.today()
    for s in series_list:
        for g in s.get("games", []):
            d = g.get("date", "")
            if d and d <= today.isoformat():
                dates.add(d)
    return sorted(dates)


def main():
    with open(DATA_FILE) as f:
        series_list = json.load(f)

    # Regular season / offseason: every series is complete, so leave last
    # postseason's file alone. Seed new series here when the next postseason starts.
    if all(s.get("status") == "complete" for s in series_list):
        print("No playoff series in progress — skipping.")
        return

    # Build a lookup: series_code -> series index in our list
    # We need to match NHL's series codes to our seriesIds
    # Strategy: match by team tri-codes
    def make_team_key(s):
        return frozenset([s["higherSeed"]["triCode"], s["lowerSeed"]["triCode"]])

    series_by_teams = {make_team_key(s): i for i, s in enumerate(series_list)}

    # Build NHL bracket series letter map
    bracket_map = build_series_code_map_from_bracket()

    # Map: NHL series_code -> index in our series_list
    code_to_idx = {}
    for s in series_list:
        ht = s["higherSeed"]["triCode"]
        lt = s["lowerSeed"]["triCode"]
        key = (ht, lt)
        if key in bracket_map:
            letter, rnd, _ = bracket_map[key]
            code = letter_to_code(letter, rnd)
            idx = series_list.index(s)
            code_to_idx[code] = idx

    # Fetch all completed game dates
    dates = get_all_playoff_dates(series_list)
    print(f"Fetching results for {len(dates)} dates: {dates}")

    # Gather all completed game results
    all_results = []
    for d in dates:
        games = fetch_game_results_for_date(d)
        if games:
            print(f"  {d}: {len(games)} completed playoff game(s)")
        all_results.extend(games)

    # Reset all series scores and game results
    for s in series_list:
        s["seriesScore"] = [0, 0]
        for g in s.get("games", []):
            g["score"] = None
            g["status"] = "scheduled"

    # Apply results
    applied = 0
    for r in all_results:
        code = r["seriesCode"]
        if code not in code_to_idx:
            print(f"  Unknown series code {code} for {r['awayTriCode']} @ {r['homeTriCode']}")
            continue
        idx = code_to_idx[code]
        s = series_list[idx]
        gnum = r["gameNumber"]

        # Find the game slot
        game_slot = next((g for g in s["games"] if g["gameNumber"] == gnum), None)
        if game_slot is None:
            print(f"  No game slot found for series {code} game {gnum}")
            continue

        home_score = r["homeScore"]
        away_score = r["awayScore"]
        # score stored as [homeScore, awayScore] tuple (matches TS interface [number,number])
        game_slot["score"] = [home_score, away_score]
        game_slot["status"] = "final"

        # Update series score: seriesScore[0] = higherSeed wins, [1] = lowerSeed wins
        higher = s["higherSeed"]["triCode"]
        lower = s["lowerSeed"]["triCode"]
        home_tri = r["homeTriCode"]

        if home_score is not None and away_score is not None:
            if home_score > away_score:
                winner = home_tri
            else:
                winner = r["awayTriCode"]
            if winner == higher:
                s["seriesScore"][0] += 1
            else:
                s["seriesScore"][1] += 1

        applied += 1

    # Fetch start times and TV networks for scheduled games
    fetch_scheduled_game_times(series_list)

    # Fetch and update series odds
    series_odds = fetch_series_odds()
    odds_updated = 0
    for s in series_list:
        ht = s["higherSeed"]["triCode"]
        lt = s["lowerSeed"]["triCode"]
        key = frozenset([ht, lt])
        if key in series_odds:
            s["seriesOdds"] = series_odds[key]
            odds_updated += 1
    print(f"Updated series odds for {odds_updated} series.")

    # Mark series status
    for s in series_list:
        wins = s["seriesScore"]
        if max(wins) == 4:
            s["status"] = "complete"
        elif max(wins) > 0 or any(g.get("status") == "final" for g in s["games"]):
            s["status"] = "active"
        else:
            s["status"] = "scheduled"

    with open(DATA_FILE, "w") as f:
        json.dump(series_list, f, indent=2)

    print(f"\nUpdated {DATA_FILE}")
    print(f"Applied {applied} game results.")
    for s in series_list:
        h = s["higherSeed"]["triCode"]
        l = s["lowerSeed"]["triCode"]
        sc = s["seriesScore"]
        print(f"  {h} {sc[0]} - {sc[1]} {l}  [{s.get('status','?')}]")


if __name__ == "__main__":
    main()
