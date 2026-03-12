"""
fetch_shifts.py
---------------
Fetches NHL shift chart data for all games in the current season and saves to
nhl_season_2025_2026_shifts.csv.

Run modes:
  - Backfill: processes all game_ids in gamestats that are missing from shifts CSV
  - Incremental (nightly): only fetches game_ids not already in the shifts CSV

Usage:
  python fetch_shifts.py           # Incremental (default)
  python fetch_shifts.py --full    # Full backfill
"""

import urllib.request
import json
import ssl
import csv
import os
import sys
import time
import pandas as pd
from datetime import datetime

ssl._create_default_https_context = ssl._create_unverified_context

# ── Config ──────────────────────────────────────────────────────────────────
SHIFTS_API = "https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId={game_id}"
GAMESTATS_FILE = "nhl_season_2025_2026_gamestats.csv"
SHIFTS_FILE = "nhl_season_2025_2026_shifts.csv"

SHIFTS_COLUMNS = [
    "game_id", "period", "start_seconds", "end_seconds",
    "player_id", "player_name", "team_id", "team_abbrev"
]

RATE_LIMIT_DELAY = 0.4   # seconds between API calls (stay polite)
MAX_RETRIES = 3


def time_to_seconds(t: str) -> int:
    """Convert MM:SS string to total seconds."""
    try:
        m, s = map(int, t.split(":"))
        return m * 60 + s
    except Exception:
        return 0


def get_url(url: str):
    """Fetch JSON with retries."""
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(1.5 * (attempt + 1))
            else:
                print(f"  ✗ Failed after {MAX_RETRIES} attempts: {e}")
                return None


def fetch_shifts_for_game(game_id: int) -> list[dict]:
    """Fetch and parse all shifts for a single game_id."""
    url = SHIFTS_API.format(game_id=game_id)
    data = get_url(url)
    if not data or "data" not in data:
        return []

    rows = []
    for shift in data["data"]:
        start = time_to_seconds(shift.get("startTime", "00:00"))
        end_t = time_to_seconds(shift.get("endTime", "00:00"))
        # Skip 0-second or malformed shifts
        if end_t <= start:
            continue
        rows.append({
            "game_id": game_id,
            "period": shift.get("period", 0),
            "start_seconds": start,
            "end_seconds": end_t,
            "player_id": shift.get("playerId"),
            "player_name": f"{shift.get('firstName', '')} {shift.get('lastName', '')}".strip(),
            "team_id": shift.get("teamId"),
            "team_abbrev": shift.get("teamAbbrev", ""),
        })
    return rows


def load_existing_game_ids(shifts_file: str) -> set:
    """Return set of game_ids already in the shifts CSV."""
    if not os.path.exists(shifts_file):
        return set()
    try:
        df = pd.read_csv(shifts_file, usecols=["game_id"])
        return set(df["game_id"].unique())
    except Exception:
        return set()


def get_all_game_ids(gamestats_file: str) -> list[int]:
    """Load all unique game_ids from the gamestats CSV."""
    df = pd.read_csv(gamestats_file, usecols=["game_id"])
    return sorted(df["game_id"].unique().tolist())


def append_rows(shifts_file: str, rows: list[dict]):
    """Append shift rows to the CSV, writing header if file doesn't exist."""
    file_exists = os.path.exists(shifts_file)
    with open(shifts_file, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=SHIFTS_COLUMNS)
        if not file_exists:
            writer.writeheader()
        writer.writerows(rows)


def main():
    full_mode = "--full" in sys.argv

    print(f"{'Full backfill' if full_mode else 'Incremental'} mode — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    if not os.path.exists(GAMESTATS_FILE):
        print(f"✗ {GAMESTATS_FILE} not found. Run from the pipeline/ directory.")
        sys.exit(1)

    all_game_ids = get_all_game_ids(GAMESTATS_FILE)
    existing_ids = set() if full_mode else load_existing_game_ids(SHIFTS_FILE)

    todo = [g for g in all_game_ids if g not in existing_ids]
    print(f"  Total games in gamestats: {len(all_game_ids)}")
    print(f"  Already fetched: {len(existing_ids)}")
    print(f"  To fetch: {len(todo)}")

    if not todo:
        print("  ✓ Shifts are up to date — nothing to do.")
        return

    # If full mode, wipe existing file so we don't double-up
    if full_mode and os.path.exists(SHIFTS_FILE):
        os.remove(SHIFTS_FILE)
        print(f"  Cleared existing {SHIFTS_FILE} for full re-fetch.")

    success, failed = 0, 0
    for i, game_id in enumerate(todo, 1):
        rows = fetch_shifts_for_game(game_id)
        if rows:
            append_rows(SHIFTS_FILE, rows)
            success += 1
            if i % 50 == 0 or i == len(todo):
                print(f"  [{i}/{len(todo)}] game {game_id} → {len(rows)} shifts (total ok: {success})")
        else:
            failed += 1
            print(f"  [{i}/{len(todo)}] game {game_id} → no data (failed: {failed})")
        time.sleep(RATE_LIMIT_DELAY)

    print(f"\n✓ Done. {success} games fetched, {failed} failed.")
    if os.path.exists(SHIFTS_FILE):
        df = pd.read_csv(SHIFTS_FILE)
        print(f"  Shifts file: {len(df):,} total rows across {df['game_id'].nunique()} games.")


if __name__ == "__main__":
    main()
