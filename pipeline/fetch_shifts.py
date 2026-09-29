"""
fetch_shifts.py
---------------
Fetches NHL shift chart data for all games in the current season and saves to
the current season shifts CSV (season.season_file("shifts")).

Strategy (two-source approach):
  1. Try the NHL stats REST API (fast, JSON, but has gaps for ~50% of games)
  2. Fall back to parsing official NHL HTML TOI Reports (complete coverage for all games)

Run modes:
  python fetch_shifts.py           # Incremental (only new games)
  python fetch_shifts.py --full    # Full re-fetch of all games
"""

from season import season_file, SEASON_ID
import urllib.request
import json
import ssl
import csv
import os
import sys
import time
import re
import pandas as pd
from bs4 import BeautifulSoup
from datetime import datetime

ssl._create_default_https_context = ssl._create_unverified_context

# ── Config ──────────────────────────────────────────────────────────────────
SHIFTS_API = "https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId={game_id}"
HTML_REPORT = "https://www.nhl.com/scores/htmlreports/{season}/{team_code}{game_num}.HTM"
SEASON = SEASON_ID

GAMESTATS_FILE = season_file("gamestats")
SHIFTS_FILE = season_file("shifts")

SHIFTS_COLUMNS = [
    "game_id", "period", "start_seconds", "end_seconds",
    "player_id", "player_name", "team_id", "team_abbrev"
]

RATE_LIMIT_DELAY = 0.4
HTML_DELAY = 0.6   # Slightly slower for HTML pages
MAX_RETRIES = 3


# ── Helpers ──────────────────────────────────────────────────────────────────

def time_to_seconds(t: str) -> int:
    """Convert M:SS or MM:SS string to total seconds."""
    try:
        t = t.strip()
        m, s = map(int, t.split(":"))
        return m * 60 + s
    except Exception:
        return 0


def get_url(url: str, encoding: str = "utf-8"):
    """Fetch URL with retries. Returns (text, None) or (None, error)."""
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=15) as r:
                return r.read().decode(encoding), None
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(1.5 * (attempt + 1))
            else:
                return None, str(e)


def get_json(url: str):
    """Fetch URL and parse as JSON."""
    text, err = get_url(url)
    if text is None:
        return None
    try:
        return json.loads(text)
    except Exception:
        return None


# ── Source 1: NHL Stats REST API ─────────────────────────────────────────────

def fetch_shifts_rest_api(game_id: int) -> list[dict]:
    """Try to get shifts from the NHL stats REST API. Returns [] on failure."""
    url = SHIFTS_API.format(game_id=game_id)
    data = get_json(url)
    if not data or not data.get("data"):
        return []

    rows = []
    for shift in data["data"]:
        start = time_to_seconds(shift.get("startTime", "0:00"))
        end_t = time_to_seconds(shift.get("endTime", "0:00"))
        if end_t <= start:
            continue
        rows.append({
            "game_id": game_id,
            "period": shift.get("period", 0),
            "start_seconds": start,
            "end_seconds": end_t,
            "player_id": shift.get("playerId"),
            "player_name": f"{shift.get('firstName','')} {shift.get('lastName','')}".strip(),
            "team_id": shift.get("teamId"),
            "team_abbrev": shift.get("teamAbbrev", ""),
        })
    return rows


# ── Source 2: NHL HTML TOI Reports ──────────────────────────────────────────

def parse_html_toi_report(html: str, game_id: int, team_id: int,
                           team_abbrev: str) -> list[dict]:
    """
    Parse one team's HTML TOI report into a list of shift dicts.
    
    HTML structure:
      - Player header row: contains '#NUM LAST, FIRST'
      - Shift rows (class oddColor/evenColor): ShiftNum | Period | StartElapsed/GameTime | ... | Duration
    """
    soup = BeautifulSoup(html, "html.parser")
    all_rows = soup.find_all("tr")

    shifts = []
    current_player_name = None
    current_player_num = None

    # Pattern to detect player header rows like "4 BYRAM, BOWEN"
    player_re = re.compile(r"^(\d+)\s+([A-Z'\-]+),\s*([A-Z'\-]+)", re.IGNORECASE)
    # Pattern to extract start time from "0:42 / 19:18" → "0:42"
    time_re = re.compile(r"^(\d{1,2}:\d{2})\s*/")

    for row in all_rows:
        text = row.get_text("|", strip=True)
        row_class = row.get("class", [])

        # Detect player header rows
        if "oddColor" not in row_class and "evenColor" not in row_class:
            # Check for player name pattern
            m = player_re.match(text.replace("|", " ").strip())
            if m:
                current_player_num = m.group(1)
                last = m.group(2).capitalize()
                first = m.group(3).capitalize()
                current_player_name = f"{first} {last}"
            continue

        # This is a shift data row
        if current_player_name is None:
            continue

        cells = [c.strip() for c in text.split("|") if c.strip()]
        # Expected: [shift_num, period, start_elapsed/game, end_elapsed/game, duration, (optional event)]
        if len(cells) < 4:
            continue

        try:
            period = int(cells[1])
        except (ValueError, IndexError):
            continue

        # Extract start and end times (elapsed time within period)
        start_str = cells[2]
        end_str   = cells[3]

        sm = time_re.match(start_str)
        em = time_re.match(end_str)

        if not sm or not em:
            continue

        start_sec = time_to_seconds(sm.group(1))
        end_sec   = time_to_seconds(em.group(1))

        if end_sec <= start_sec and end_sec != 0:
            continue

        shifts.append({
            "game_id": game_id,
            "period": period,
            "start_seconds": start_sec,
            "end_seconds": end_sec,
            "player_id": None,    # HTML reports don't have NHL player IDs
            "player_name": current_player_name,
            "team_id": team_id,
            "team_abbrev": team_abbrev,
        })

    return shifts


def game_id_to_html_num(game_id: int) -> str:
    """Convert game_id like 2025020057 to zero-padded report number '020057'."""
    # The last 6 digits of the game_id are the game number
    return str(game_id)[-6:].zfill(6)


def fetch_shifts_html(game_id: int, home_team_id: int, home_abbrev: str,
                      away_team_id: int, away_abbrev: str) -> list[dict]:
    """
    Scrape NHL HTML TOI reports (home + away) for a game.
    Returns combined shift list for both teams.
    """
    game_num = game_id_to_html_num(game_id)
    all_shifts = []

    for team_code, team_id, team_abbrev in [
        ("TH", home_team_id, home_abbrev),  # TH = Home TOI
        ("TV", away_team_id, away_abbrev),  # TV = Visitor TOI
    ]:
        url = HTML_REPORT.format(season=SEASON, team_code=team_code, game_num=game_num)
        html, err = get_url(url, encoding="latin-1")
        if html is None:
            print(f"    HTML {team_code} error for game {game_id}: {err}")
            continue

        shifts = parse_html_toi_report(html, game_id, team_id, team_abbrev)
        all_shifts.extend(shifts)
        time.sleep(HTML_DELAY)

    return all_shifts


# ── Game Metadata Lookup ─────────────────────────────────────────────────────

def build_game_metadata(gamestats_file: str) -> dict[int, dict]:
    """
    Build a lookup: game_id → {home_team_id, home_abbrev, away_team_id, away_abbrev}
    from the gamestats CSV (which has team/opponent on each row).
    """
    gs = pd.read_csv(gamestats_file, usecols=["game_id", "team", "opponent", "is_home"])
    # We need tricodes too — load from nhl_teams.csv
    try:
        teams_df = pd.read_csv("nhl_teams.csv")
        name_to_tricode = dict(zip(teams_df["Common Name"], teams_df["Team Tricode"]))
        name_to_id = dict(zip(teams_df["Common Name"], teams_df["NHL Team ID"]))
    except Exception:
        name_to_tricode = {}
        name_to_id = {}

    meta = {}
    for _, row in gs.iterrows():
        gid = int(row["game_id"])
        if gid in meta:
            continue
        try:
            is_home = row.get("is_home", 1)
            if is_home:
                home_name, away_name = row["team"], row["opponent"]
            else:
                home_name, away_name = row["opponent"], row["team"]

            meta[gid] = {
                "home_team_id": name_to_id.get(home_name, 0),
                "home_abbrev":  name_to_tricode.get(home_name, ""),
                "away_team_id": name_to_id.get(away_name, 0),
                "away_abbrev":  name_to_tricode.get(away_name, ""),
            }
        except Exception:
            continue
    return meta


def build_game_metadata_from_pbp() -> dict[int, dict]:
    """
    Build game metadata from the PBP CSV (more reliable home/away detection).
    Uses is_home_team column and team_perspective + team_id from shots.
    """
    try:
        shots = pd.read_csv(season_file("shots"),
                            usecols=["game_id", "team_id"])
        teams_df  = pd.read_csv("nhl_teams.csv")
        id_to_abbrev = dict(zip(teams_df["NHL Team ID"], teams_df["Team Tricode"]))
    except Exception:
        return {}

    # For each game, get the two team_ids
    game_teams = shots.groupby("game_id")["team_id"].unique()
    meta = {}
    for gid, tids in game_teams.items():
        if len(tids) < 2:
            continue
        t1, t2 = int(tids[0]), int(tids[1])
        meta[int(gid)] = {
            "home_team_id": t1,
            "home_abbrev":  id_to_abbrev.get(t1, ""),
            "away_team_id": t2,
            "away_abbrev":  id_to_abbrev.get(t2, ""),
        }
    return meta


# ── CSV Helpers ──────────────────────────────────────────────────────────────

def load_existing_game_ids(shifts_file: str) -> set:
    if not os.path.exists(shifts_file):
        return set()
    try:
        df = pd.read_csv(shifts_file, usecols=["game_id"])
        return set(df["game_id"].unique())
    except Exception:
        return set()


def get_all_game_ids(gamestats_file: str) -> list[int]:
    df = pd.read_csv(gamestats_file, usecols=["game_id"])
    return sorted(df["game_id"].unique().tolist())


def append_rows(shifts_file: str, rows: list[dict]):
    file_exists = os.path.exists(shifts_file)
    with open(shifts_file, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=SHIFTS_COLUMNS)
        if not file_exists:
            writer.writeheader()
        writer.writerows(rows)


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    full_mode = "--full" in sys.argv
    print(f"fetch_shifts.py — {'Full' if full_mode else 'Incremental'} — "
          f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    if not os.path.exists(GAMESTATS_FILE):
        print(f"✗ {GAMESTATS_FILE} not found. Run from the pipeline/ directory.")
        sys.exit(1)

    all_game_ids = get_all_game_ids(GAMESTATS_FILE)
    existing_ids = set() if full_mode else load_existing_game_ids(SHIFTS_FILE)
    todo = [g for g in all_game_ids if g not in existing_ids]

    print(f"  Total games: {len(all_game_ids)} | Already fetched: {len(existing_ids)} | To fetch: {len(todo)}")

    if not todo:
        print("  ✓ Shifts up to date.")
        return

    if full_mode and os.path.exists(SHIFTS_FILE):
        os.remove(SHIFTS_FILE)
        print(f"  Cleared existing {SHIFTS_FILE} for full re-fetch.")

    # Build game metadata for HTML fallback
    print("  Building game metadata for HTML fallback...")
    game_meta = build_game_metadata_from_pbp()
    print(f"  Metadata available for {len(game_meta)} games.")

    rest_ok, html_ok, failed = 0, 0, 0

    for i, game_id in enumerate(todo, 1):
        # --- Try REST API first ---
        rows = fetch_shifts_rest_api(game_id)
        time.sleep(RATE_LIMIT_DELAY)

        if rows:
            append_rows(SHIFTS_FILE, rows)
            rest_ok += 1
            if i % 100 == 0 or i == len(todo):
                print(f"  [{i}/{len(todo)}] REST ✓ game {game_id} → {len(rows)} shifts")
            continue

        # --- Fallback: HTML TOI Report ---
        meta = game_meta.get(game_id)
        if meta:
            rows = fetch_shifts_html(
                game_id,
                meta["home_team_id"], meta["home_abbrev"],
                meta["away_team_id"], meta["away_abbrev"],
            )
        else:
            rows = []

        if rows:
            append_rows(SHIFTS_FILE, rows)
            html_ok += 1
            if i % 50 == 0 or i == len(todo):
                print(f"  [{i}/{len(todo)}] HTML ✓ game {game_id} → {len(rows)} shifts")
        else:
            failed += 1
            if failed <= 10 or i == len(todo):
                print(f"  [{i}/{len(todo)}] ✗ game {game_id} → no data from either source")

    print(f"\n✓ Done. REST: {rest_ok} | HTML fallback: {html_ok} | Failed: {failed}")
    if os.path.exists(SHIFTS_FILE):
        df = pd.read_csv(SHIFTS_FILE)
        print(f"  Shifts file: {len(df):,} rows across {df['game_id'].nunique()} games.")


if __name__ == "__main__":
    main()
