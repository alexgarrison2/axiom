"""update_playoff_series.py - public/data/playoff_series.json from the NHL.

    python3 update_playoff_series.py

Exits immediately (logging 'no postseason games') unless playoff games
(gameType 3) are on the schedule, so it costs about one request during the
regular season.

In the postseason the series list is derived from the NHL, not hand-built:
/v1/playoff-series/carousel/{SEASON_ID} gives the series of every round and
/v1/schedule/playoff-series/{SEASON_ID}/{letter} each series' games, scores,
start times and national TV.  Series winner odds (Bovada) are merged in when
available.  A playoff_series.json from an earlier season is archived to
data/archive/playoff_series_<season>.json before it is replaced (never
deleted).

Series format (unchanged for the frontend, plus season_id and seriesLetter):
  {seriesId: 'R1_E_A', season_id, seriesLetter, round, conference,
   higherSeed: {triCode, seed, commonName}, lowerSeed: {...},
   seriesScore: [higherSeedWins, lowerSeedWins],
   games: [{gameNumber, gameId, date, startTimeUTC, startTimeCT,
            homeTriCode, awayTriCode, tvNetwork, score: [home, away] | null,
            status: 'final' | 'live' | 'scheduled'}],
   status: 'complete' | 'active' | 'scheduled', seriesOdds?}
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import time
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from season import SEASON_ID  # noqa: E402

DATA_FILE = os.path.join(SCRIPT_DIR, "..", "public", "data", "playoff_series.json")
ARCHIVE_DIR = os.path.join(SCRIPT_DIR, "..", "data", "archive")
CONFERENCE = {"E": "East", "W": "West"}
NATIONAL_NETWORKS = {"ESPN": "ESPN", "ESPN2": "ESPN2", "ABC": "ABC", "TNT": "TNT", "TBS": "TBS", "MAX": "MAX",
                     "truTV": "truTV", "SN": "SN", "CBC": "CBC", "TVAS": "TVAS", "NHL Network": "NHLN"}


def fetch_json(url):
    from http_utils import get_json
    return get_json(url, ua="plain")


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


def _local_date(start_utc):
    from zoneinfo import ZoneInfo
    d = datetime.fromisoformat(start_utc.replace("Z", "+00:00"))
    return d.astimezone(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")


def _central_clock(start_utc):
    from zoneinfo import ZoneInfo
    d = datetime.fromisoformat(start_utc.replace("Z", "+00:00")).astimezone(ZoneInfo("America/Chicago"))
    return f"{d.hour % 12 or 12}:{d.minute:02d} {'AM' if d.hour < 12 else 'PM'}"


def _national_tv(game):
    for b in game.get("tvBroadcasts", []) or []:
        if b.get("market") == "N" and b.get("countryCode") == "US":
            return NATIONAL_NETWORKS.get(b.get("network"), b.get("network", ""))
    return ""


def _game_status(state):
    if state in ("OFF", "FINAL"):
        return "final"
    if state in ("LIVE", "CRIT"):
        return "live"
    return "scheduled"


def series_from_nhl(payload, season_id=SEASON_ID):
    """One playoff_series.json entry from /schedule/playoff-series/{season}/{letter}."""
    top, bot = payload["topSeedTeam"], payload["bottomSeedTeam"]
    rnd = int(payload.get("round") or 1)
    conf_abbr = (top.get("conference") or {}).get("abbrev", "")
    conference = "Final" if rnd == 4 else CONFERENCE.get(conf_abbr, conf_abbr)
    letter = payload.get("seriesLetter", "")
    games = []
    for g in payload.get("games", []) or []:
        home, away = g.get("homeTeam") or {}, g.get("awayTeam") or {}
        status = _game_status(g.get("gameState"))
        has_score = status != "scheduled" and home.get("score") is not None
        start = g.get("startTimeUTC", "")
        entry = {
            "gameNumber": int(g.get("gameNumber") or (int(g["id"]) % 10)),
            "gameId": g.get("id"),
            "date": _local_date(start) if start else "",
            "startTimeUTC": start,
            "startTimeCT": _central_clock(start) if start else "",
            "homeTriCode": home.get("abbrev", ""),
            "awayTriCode": away.get("abbrev", ""),
            "tvNetwork": _national_tv(g),
            "score": [home.get("score"), away.get("score")] if has_score else None,
            "status": status,
        }
        if g.get("ifNecessary"):
            entry["ifNecessary"] = True
        games.append(entry)
    games.sort(key=lambda x: x["gameNumber"])
    tw, bw = int(top.get("seriesWins") or 0), int(bot.get("seriesWins") or 0)
    need = int(payload.get("neededToWin") or 4)
    if max(tw, bw) >= need:
        status = "complete"
    elif tw + bw or any(g["status"] != "scheduled" for g in games):
        status = "active"
    else:
        status = "scheduled"
    return {
        "seriesId": f"R{rnd}_{conf_abbr or 'F'}_{letter}",
        "season_id": str(season_id),
        "seriesLetter": letter,
        "round": rnd,
        "conference": conference,
        "higherSeed": {"triCode": top.get("abbrev", ""), "seed": str(top.get("seed", "")),
                       "commonName": (top.get("name") or {}).get("default", "")},
        "lowerSeed": {"triCode": bot.get("abbrev", ""), "seed": str(bot.get("seed", "")),
                      "commonName": (bot.get("name") or {}).get("default", "")},
        "seriesScore": [tw, bw],
        "games": games,
        "status": status,
    }


def build_series_list(season_id=SEASON_ID):
    """Every series announced so far this postseason, in round/letter order."""
    carousel = fetch_json(f"https://api-web.nhle.com/v1/playoff-series/carousel/{season_id}")
    out = []
    for rnd in carousel.get("rounds", []) or []:
        for s in rnd.get("series", []) or []:
            letter = s.get("seriesLetter")
            if not letter or not (s.get("topSeed") or {}).get("abbrev"):
                continue      # later-round slot not decided yet
            payload = fetch_json(f"https://api-web.nhle.com/v1/schedule/playoff-series/{season_id}/{letter.lower()}")
            out.append(series_from_nhl(payload, season_id))
    return out


def file_season(series_list):
    """Season of an existing playoff_series.json (explicit, else from game dates)."""
    for s in series_list or []:
        if s.get("season_id"):
            return str(s["season_id"])
        for g in s.get("games", []):
            if g.get("date"):
                y = int(g["date"][:4])
                return f"{y - 1}{y}"
    return None


def archive_previous(series_list, path=DATA_FILE, archive_dir=ARCHIVE_DIR):
    season = file_season(series_list)
    if not season or season == SEASON_ID:
        return None
    os.makedirs(archive_dir, exist_ok=True)
    dst = os.path.join(archive_dir, f"playoff_series_{season}.json")
    if not os.path.exists(dst):
        shutil.copyfile(path, dst)
        print(f"  Archived {season} playoff_series.json -> {os.path.relpath(dst, SCRIPT_DIR)}")
    return dst


def main():
    t0 = time.time()
    from season_context import postseason_games_exist
    if not postseason_games_exist():
        print(f"{SEASON_ID}: no postseason games on the schedule - nothing to update "
              f"({time.time() - t0:.1f}s).")
        return {"status": "skip", "reason": "no postseason games"}

    try:
        with open(DATA_FILE) as f:
            existing = json.load(f)
    except (OSError, ValueError):
        existing = []
    archive_previous(existing)
    series_list = build_series_list()
    if not series_list:
        print("  Carousel has no series yet - keeping the current file.")
        return {"status": "skip", "reason": "no series announced"}

    same_season = file_season(existing) == SEASON_ID
    old_odds = {frozenset([s["higherSeed"]["triCode"], s["lowerSeed"]["triCode"]]): s.get("seriesOdds")
                for s in existing if same_season and s.get("seriesOdds")}
    odds = fetch_series_odds()
    for s in series_list:
        key = frozenset([s["higherSeed"]["triCode"], s["lowerSeed"]["triCode"]])
        if key in odds:
            s["seriesOdds"] = odds[key]
        elif old_odds.get(key):
            s["seriesOdds"] = old_odds[key]

    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(series_list, f, indent=2)
    os.replace(tmp, DATA_FILE)
    for s in series_list:
        print(f"  {s['seriesId']}: {s['higherSeed']['triCode']} {s['seriesScore'][0]}-{s['seriesScore'][1]} "
              f"{s['lowerSeed']['triCode']} [{s['status']}]")
    return {"status": "ok", "rows_written": len(series_list)}


if __name__ == "__main__":
    main()
