"""
fetch_player_bio.py
NHL roster helpers plus player bio output.

* fetch_rosters()      — current rosters for all 32 teams from
                         api-web /v1/roster/{TRI}/current (memoised per process).
* build_team_goalies() — public/data/team_goalies.json: each team's roster
                         goalies ordered by current-season GP, then prior-season GP.
* main()               — public/data/player_bio.json (age, height, weight,
                         shoots, isRookie) keyed by NHL player id.

Output format of player_bio.json (keyed by player_id string):
{
  "8482740": {"age": 21, "height": "6'1\\"", "weight": 185, "shoots": "R", "isRookie": false},
  ...
}

Run: python3 pipeline/fetch_player_bio.py
"""

from season import SEASON_ID, PREV_SEASON_ID
import os
import time
from datetime import date

from http_utils import try_get_json, get_json, HttpError
from io_utils import atomic_write_json
from paths import public_path

BASE_URL = "https://api-web.nhle.com/v1"
STATS_URL = "https://api.nhle.com/stats/rest/en"
OUTPUT_FILE = public_path("player_bio.json")
TEAM_GOALIES_FILE = public_path("team_goalies.json")

SEASON = SEASON_ID

NHL_TEAMS = [
    "ANA", "BOS", "BUF", "CAR", "CBJ", "CGY", "CHI", "COL", "DAL", "DET",
    "EDM", "FLA", "LAK", "MIN", "MTL", "NJD", "NSH", "NYI", "NYR", "OTT",
    "PHI", "PIT", "SEA", "SJS", "STL", "TBL", "TOR", "UTA", "VAN", "VGK",
    "WSH", "WPG",
]

_ROSTER_CACHE: dict | None = None


def player_display_name(p: dict) -> str:
    first = (p.get("firstName") or {}).get("default", "")
    last = (p.get("lastName") or {}).get("default", "")
    return f"{first} {last}".strip()


def fetch_rosters(teams=NHL_TEAMS, refresh: bool = False) -> dict:
    """{TRI: {'forwards': [...], 'defensemen': [...], 'goalies': [...]}} for the
    teams whose roster call succeeded.  Failed teams are simply absent, so
    callers must check completeness (len == 32) before overwriting data."""
    global _ROSTER_CACHE
    if _ROSTER_CACHE is not None and not refresh:
        return _ROSTER_CACHE
    rosters = {}
    for team in teams:
        try:
            data = get_json(f"{BASE_URL}/roster/{team}/current", ua="plain")
        except HttpError as e:
            print(f"  [WARN] roster {team}: {e}")
            continue
        if isinstance(data, dict) and any(data.get(g) for g in ("forwards", "defensemen", "goalies")):
            rosters[team] = data
    print(f"  Rosters fetched for {len(rosters)}/{len(teams)} teams")
    _ROSTER_CACHE = rosters
    return rosters


def roster_index(rosters: dict) -> dict:
    """{player_id(str): {'team': TRI, 'name': 'First Last', 'pos': 'C'|'L'|'R'|'D'|'G'}}"""
    idx = {}
    for tri, data in rosters.items():
        for group in ("forwards", "defensemen", "goalies"):
            for p in data.get(group, []) or []:
                pid = p.get("id")
                if pid:
                    idx[str(pid)] = {"team": tri, "name": player_display_name(p),
                                     "pos": p.get("positionCode", "")}
    return idx


def _goalie_gp(season_id: str) -> dict:
    """{playerId: regular-season games played} for one season (1 request)."""
    url = (f"{STATS_URL}/goalie/summary?isAggregate=false&isGame=false&limit=-1"
           f"&cayenneExp=seasonId={season_id}%20and%20gameTypeId=2")
    data = try_get_json(url, ua="plain") or {}
    out = {}
    for row in data.get("data", []) or []:
        pid = row.get("playerId")
        if pid:
            out[int(pid)] = out.get(int(pid), 0) + int(row.get("gamesPlayed") or 0)
    return out


def build_team_goalies(rosters: dict | None = None, output_file: str = TEAM_GOALIES_FILE) -> dict:
    """Write team_goalies.json {TRI: [goalie names]} from current rosters,
    ordered by current-season GP then prior-season GP (desc).  Keeps the
    previous file unless all 32 teams have at least one goalie."""
    rosters = rosters if rosters is not None else fetch_rosters()
    cur, prev = _goalie_gp(SEASON_ID), _goalie_gp(PREV_SEASON_ID)
    out = {}
    for tri in sorted(rosters):
        goalies = rosters[tri].get("goalies", []) or []
        ranked = sorted(goalies, key=lambda g: (-cur.get(int(g.get("id", 0)), 0),
                                                -prev.get(int(g.get("id", 0)), 0),
                                                player_display_name(g)))
        names = [player_display_name(g) for g in ranked if player_display_name(g)]
        if names:
            out[tri] = names

    def _validate(d):
        missing = sorted(set(NHL_TEAMS) - set(d))
        return f"teams without roster goalies: {missing}" if missing else None

    ok = atomic_write_json(output_file, out, min_items=32, validator=_validate, label="team_goalies.json")
    if ok:
        print(f"  ✓ team_goalies.json ({len(out)} teams)")
    return out if ok else {}


def calc_age(birth_date_str: str) -> int:
    """Calculate current age from 'YYYY-MM-DD' birth date string."""
    today = date.today()
    bd = date.fromisoformat(birth_date_str)
    return today.year - bd.year - ((today.month, today.day) < (bd.month, bd.day))


def inches_to_ft(inches: int) -> str:
    """Convert integer inches to e.g. '6\'1"'."""
    return f"{inches // 12}'{inches % 12}\""


def main():
    print("--- Fetching Player Bio Data ---")
    bio: dict = {}
    rosters = fetch_rosters()

    for team, data in rosters.items():
        for group in ("forwards", "defensemen", "goalies"):
            for player in data.get(group, []):
                pid = str(player.get("id", ""))
                if not pid:
                    continue
                birth = player.get("birthDate", "")
                height_in = player.get("heightInInches")
                weight_lb = player.get("weightInPounds")
                shoots = player.get("shootsCatches", "")
                bio[pid] = {
                    "age": calc_age(birth) if birth else None,
                    "height": inches_to_ft(height_in) if height_in else None,
                    "weight": weight_lb,
                    "shoots": shoots if shoots else None,
                    "isRookie": False,
                }

    # ── Rookie flags from the NHL stats API (current season) ──
    print("  Fetching rookies...", end="", flush=True)
    rookie_ids = set()
    for kind in ("skater", "goalie"):
        url = (f"{STATS_URL}/{kind}/summary?isAggregate=false&isGame=false&limit=-1"
               f"&cayenneExp=seasonId={SEASON}%20and%20isRookie=1%20and%20gameTypeId=2")
        data = try_get_json(url, ua="plain") or {}
        for p in data.get("data", []) or []:
            rookie_ids.add(str(p.get("playerId", "")))
        time.sleep(0.1)

    tagged = 0
    for pid in rookie_ids:
        if pid in bio:
            bio[pid]["isRookie"] = True
            tagged += 1
    print(f" {len(rookie_ids)} rookies found, {tagged} matched to roster")

    # A partial roster fetch must not shrink the bio file.
    if atomic_write_json(OUTPUT_FILE, bio, min_items=600, indent=None, label="player_bio.json",
                         validator=lambda _: None if len(rosters) == len(NHL_TEAMS)
                         else f"only {len(rosters)}/32 rosters"):
        print(f"\nSaved bio for {len(bio)} players → {OUTPUT_FILE}")

    # team_goalies.json reuses the same roster pull.
    build_team_goalies(rosters)
    return {"rows_written": len(bio)}


if __name__ == "__main__":
    main()
