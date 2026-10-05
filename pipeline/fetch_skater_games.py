"""
fetch_skater_games.py — one row per skater per game, for the props page.

Source: NHL stats REST ``skater/summary`` with ``isGame=true``, joined with
the ``skater/realtime`` (shot attempts, missed and blocked) and
``skater/timeonice`` (even-strength and power-play minutes) reports for the
same player-games. A query returns at most 10,000 rows (``limit=-1``; paging
past that returns nothing), so seasons are fetched in weekly ``gameDate``
windows (~2,000 rows each). Unlike the boxscore scrape it carries power-play
points, so PPP props can be graded. The current season is refreshed
incrementally from a few days before its last stored game; a file written
before a column existed is refetched whole.

Output: pipeline/nhl_season_<yyyy>_<yyyy>_skater_games.csv for the current
season (rewritten every full run) and, once, for the previous season (the
props windows reach back into it early in a season).

Columns: game_id, date, player_id, name, team, opp, home, pos, toi (minutes),
goals, assists, points, shots, pp_goals, pp_points
"""
from __future__ import annotations

import os
import sys
import urllib.parse
from datetime import date, timedelta

import pandas as pd

from http_utils import try_get_json
from io_utils import atomic_write_csv, mark_stale, record_source, clear_stale, utc_now_iso
from paths import pipeline_path
from season import START_YEAR, PREV_START_YEAR, season_file

REPORT_URL = "https://api.nhle.com/stats/rest/en/skater/{}"
WINDOW_DAYS = 7
OVERLAP_DAYS = 3        # re-fetch the last few stored days (late stat corrections)
COLUMNS = ["game_id", "date", "player_id", "name", "team", "opp", "home", "pos", "toi",
           "goals", "assists", "points", "shots", "pp_goals", "pp_points",
           "attempts", "missed", "blocked", "ev_toi", "pp_toi"]
# Extra reports joined onto ``summary``: {report: {api field: (column, seconds -> minutes)}}.
EXTRA = {
    "realtime": {"totalShotAttempts": ("attempts", False), "missedShots": ("missed", False),
                 "shotAttemptsBlocked": ("blocked", False)},
    "timeonice": {"evTimeOnIce": ("ev_toi", True), "ppTimeOnIce": ("pp_toi", True)},
}


def games_file(start_year=START_YEAR):
    return pipeline_path(season_file("skater_games", start_year))


def _window_url(season_id: str, lo: date, hi: date, report: str = "summary") -> str:
    q = {
        "isAggregate": "false", "isGame": "true", "start": "0", "limit": "-1",
        "cayenneExp": f'seasonId={season_id} and gameTypeId=2 and gameDate>="{lo}" and gameDate<="{hi}"',
    }
    return f"{REPORT_URL.format(report)}?{urllib.parse.urlencode(q)}"


def _frame(rows: list, extra: dict | None = None) -> pd.DataFrame:
    """Summary rows as COLUMNS; ``extra`` maps report -> its rows for the same window."""
    if not rows:
        return pd.DataFrame(columns=COLUMNS)
    df = pd.DataFrame(rows)
    out = pd.DataFrame({
        "game_id": df["gameId"].astype(int),
        "date": df["gameDate"].astype(str),
        "player_id": df["playerId"].astype(int),
        "name": df["skaterFullName"].astype(str),
        "team": df["teamAbbrev"].astype(str),
        "opp": df["opponentTeamAbbrev"].astype(str),
        "home": (df["homeRoad"] == "H").astype(int),
        "pos": df["positionCode"].astype(str),
        "toi": (df["timeOnIcePerGame"].fillna(0) / 60).round(2),
    })
    for src, dst in [("goals", "goals"), ("assists", "assists"), ("points", "points"), ("shots", "shots"),
                     ("ppGoals", "pp_goals"), ("ppPoints", "pp_points")]:
        out[dst] = df[src].fillna(0).astype(int)
    for report, fields in EXTRA.items():
        part = pd.DataFrame((extra or {}).get(report) or [])
        if part.empty:
            for col, _ in fields.values():
                out[col] = pd.NA
            continue
        part = part.drop_duplicates(["gameId", "playerId"]).set_index(["gameId", "playerId"])
        key = pd.MultiIndex.from_arrays([df["gameId"].astype(int), df["playerId"].astype(int)])
        for src, (col, minutes) in fields.items():
            v = part[src].reindex(key).to_numpy(dtype=float)
            out[col] = (v / 60).round(2) if minutes else pd.array(v, dtype="Int64")
    return out


def _report(url: str, label: str) -> list | None:
    data = try_get_json(url, retries=3, timeout=60)
    if not isinstance(data, dict) or "data" not in data:
        return None
    if int(data.get("total") or 0) > len(data["data"]):
        print(f"  [WARN] skater games {label}: {data['total']} rows, got {len(data['data'])}")
        return None
    return data["data"]


def fetch_range(start_year: int, lo: date, hi: date) -> pd.DataFrame | None:
    """Regular-season player-game rows dated lo..hi, or None on a fetch failure."""
    season_id = f"{start_year}{start_year + 1}"
    frames, d = [], lo
    while d <= hi:
        end = min(hi, d + timedelta(days=WINDOW_DAYS - 1))
        label = f"{d}..{end}"
        rows = _report(_window_url(season_id, d, end), label)
        if rows is None:
            return None
        extra = {}
        if rows:
            for report in EXTRA:
                extra[report] = _report(_window_url(season_id, d, end, report), f"{report} {label}")
                if extra[report] is None:
                    return None
        frames.append(_frame(rows, extra))
        d = end + timedelta(days=1)
    frames = [f for f in frames if len(f)]
    return pd.concat(frames, ignore_index=True) if frames else _frame([])


def refresh_season(start_year: int, today: date | None = None) -> pd.DataFrame | None:
    """The season's file merged with freshly fetched rows (None on a fetch failure)."""
    path = games_file(start_year)
    old = pd.read_csv(path) if os.path.exists(path) else pd.DataFrame(columns=COLUMNS)
    season_lo = date(start_year, 9, 1)
    season_hi = min(today or date.today(), date(start_year + 1, 6, 30))
    lo = season_lo
    # A file from before a column existed is refetched whole so every row carries it.
    if len(old) and set(COLUMNS) <= set(old.columns):
        lo = max(season_lo, date.fromisoformat(str(old["date"].max())) - timedelta(days=OVERLAP_DAYS))
    new = fetch_range(start_year, lo, season_hi)
    if new is None:
        return None
    keep = old[old["date"].astype(str) < str(lo)]
    df = pd.concat([f for f in (keep, new) if len(f)], ignore_index=True) if len(keep) or len(new) else new
    return df.drop_duplicates(["game_id", "player_id"], keep="last").sort_values(
        ["date", "game_id", "player_id"])[COLUMNS]


def main(argv=None):
    """Refresh the current season; fetch the previous season when its file is missing or
    lacks a column. ``--season YYYY`` fetches that season only."""
    argv = argv or []
    if "--season" in argv:
        years = [int(argv[argv.index("--season") + 1])]
    else:
        years = [START_YEAR]
        prev = games_file(PREV_START_YEAR)
        if "--prev" in argv or not os.path.exists(prev) or not set(COLUMNS) <= set(pd.read_csv(prev, nrows=0).columns):
            years.append(PREV_START_YEAR)
    written = 0
    for y in years:
        df = refresh_season(y)
        if df is None:
            mark_stale("skater_games", f"stats API fetch failed for {y}")
            print(f"  [WARN] skater games {y}: fetch failed, keeping the previous file")
            continue
        old = pd.read_csv(games_file(y)) if os.path.exists(games_file(y)) else None
        # Never shrink: a short page from the API must not erase graded games.
        min_rows = 0 if old is None else int(len(old) * 0.95)
        if atomic_write_csv(games_file(y), df, min_rows=min_rows, label="skater_games"):
            written += len(df)
            print(f"  skater games {y}-{(y + 1) % 100:02d}: {len(df)} rows, {df['game_id'].nunique()} games")
    if written:
        clear_stale("skater_games")
        record_source("skater_games", fetched_at=utc_now_iso())
    return {"status": "ok" if written else "fail", "rows_written": written}


if __name__ == "__main__":
    main(sys.argv[1:])
