"""fetch_nhl_goalie_stats.py - season goalie lines for the current and previous season.

Writes
  public/data/goalie_season_lines.json
      {season_id, prev_season_id, generated_at,
       goalies: {"Full Name": {cur: {w,l,ot,svpct,gaa,gp} | null,
                               prev: {w,l,ot,svpct,gaa,gp} | null}}}
  pipeline/nhl_goalie_stats.json   (legacy flat map, CURRENT season only)
      {"Full Name": "(W-L-O) | .SV% | GAA"}

A goalie who has not played this season has cur = null (and no legacy
line), so last season's numbers are never shown as this season's.  Runs in
both the full and the lite update.
"""
from __future__ import annotations

import json
import os
import urllib.parse

from season import SEASON_ID, PREV_SEASON_ID

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
LINES_FILE = os.path.join(PIPELINE_DIR, "..", "public", "data", "goalie_season_lines.json")
LEGACY_FILE = os.path.join(PIPELINE_DIR, "nhl_goalie_stats.json")


def _summary(season_id, game_type=2):
    from http_utils import get_json
    params = {
        "isAggregate": "false", "isGame": "false",
        "sort": '[{"property":"wins","direction":"DESC"},{"property":"playerId","direction":"ASC"}]',
        "start": "0", "limit": "-1",
        "cayenneExp": f"gameTypeId={game_type} and seasonId={season_id}",
    }
    url = "https://api.nhle.com/stats/rest/en/goalie/summary?" + urllib.parse.urlencode(params)
    return get_json(url, ua="plain").get("data", []) or []


def to_line(row):
    """stats API goalie/summary row -> {w,l,ot,svpct,gaa,gp}."""
    return {
        "w": int(row.get("wins") or 0),
        "l": int(row.get("losses") or 0),
        "ot": int(row.get("otLosses") or 0),
        "svpct": round(float(row.get("savePct") or 0.0), 5),
        "gaa": round(float(row.get("goalsAgainstAverage") or 0.0), 2),
        "gp": int(row.get("gamesPlayed") or 0),
    }


def build(cur_rows, prev_rows):
    goalies = {}
    for key, rows in (("cur", cur_rows), ("prev", prev_rows)):
        for r in rows:
            name = r.get("goalieFullName")
            if not name or not r.get("gamesPlayed"):
                continue
            goalies.setdefault(name, {"cur": None, "prev": None})[key] = to_line(r)
    return goalies


def fetch_nhl_goalie_stats():
    from io_utils import atomic_write_json, utc_now_iso
    from season_context import format_goalie_line
    print(f"Fetching goalie season lines ({SEASON_ID} and {PREV_SEASON_ID})...")
    try:
        cur = _summary(SEASON_ID)
        prev = _summary(PREV_SEASON_ID)
    except Exception as e:
        print(f"Error fetching goalie stats: {e}")
        return {"status": "fail", "reason": str(e)[:200]}
    if not prev:
        return {"status": "fail", "reason": f"no {PREV_SEASON_ID} goalie lines returned"}
    goalies = dict(sorted(build(cur, prev).items()))
    try:
        with open(LINES_FILE) as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    # Only rewrite when a line changed, so an hourly run with no new games
    # leaves the committed file (and its generated_at) untouched.
    if old.get("season_id") != SEASON_ID or old.get("goalies") != goalies:
        out = {"season_id": SEASON_ID, "prev_season_id": PREV_SEASON_ID, "generated_at": utc_now_iso(),
               "goalies": goalies}
        atomic_write_json(LINES_FILE, out, indent=1, label="goalie_season_lines.json")
    legacy = {n: format_goalie_line(g["cur"]) for n, g in goalies.items() if g.get("cur")}
    atomic_write_json(LEGACY_FILE, legacy, indent=4, label="nhl_goalie_stats.json")
    print(f"  {sum(1 for g in goalies.values() if g['cur'])} goalies with {SEASON_ID} games, "
          f"{sum(1 for g in goalies.values() if g['prev'])} with {PREV_SEASON_ID} games")
    return {"status": "ok", "rows_written": len(goalies)}


def load_goalie_season_lines(path=LINES_FILE):
    """{name: {cur, prev}} for this season, or {} (wrong season or missing)."""
    try:
        with open(path) as f:
            d = json.load(f)
    except (OSError, ValueError):
        return {}
    if str(d.get("season_id")) != SEASON_ID:
        print(f"  [WARN] goalie_season_lines.json is for {d.get('season_id')}, not {SEASON_ID} - ignored")
        return {}
    return d.get("goalies") or {}


if __name__ == "__main__":
    print(fetch_nhl_goalie_stats())
