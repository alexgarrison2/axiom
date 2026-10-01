"""
update_raw_pbp.py

Incremental daily updater for raw_pbp_<season>.csv.

Fetches PBP for any completed games from the last N days that are not
already present in the CSV, and appends them.  Much faster than a full
season re-scrape (~15 min) — each run typically processes 0-15 new games.

The write is an upsert on (game_id, eventId): candidates are de-duplicated
(``/schedule/{date}`` returns the whole game *week*, so looking back N days used
to queue the same game N times and append its plays 2-3x), rows whose key is
already stored are skipped, and a file that already carries duplicate keys is
rewritten once without them.

Run manually:
    cd pipeline
    python3 update_raw_pbp.py

Called by the GitHub Actions workflow during Full Refresh (12-14 UTC).

Options (via env / CLI):
    --days N       Look back N days for games (default: 2 — covers yesterday)
    --dry-run      Print what would be added without writing
"""

from season import SEASON_ID
import argparse
import os
import sys
import json
import time
import urllib.request
from datetime import date, timedelta

import pandas as pd

# ── Paths ──────────────────────────────────────────────────────────────────────
_PIPELINE = os.path.dirname(os.path.abspath(__file__))
_ROOT     = os.path.dirname(_PIPELINE)

RAW_PBP   = os.path.join(_ROOT, "data", "historical_pbp", f"raw_pbp_{SEASON_ID}.csv")
BASE_URL  = "https://api-web.nhle.com/v1"
SEASON    = int(SEASON_ID)
DELAY     = 0.25   # seconds between API calls


# Expected column order — must match the existing CSV exactly so pd.concat aligns
RAW_PBP_COLS = [
    "eventId", "timeInPeriod", "timeRemaining", "situationCode",
    "homeTeamDefendingSide", "typeCode", "typeDescKey", "sortOrder",
    "game_id", "season",
    "periodDescriptor.number", "periodDescriptor.periodType",
    "periodDescriptor.maxRegulationPeriods",
    "details.eventOwnerTeamId", "details.losingPlayerId", "details.winningPlayerId",
    "details.xCoord", "details.yCoord", "details.zoneCode",
    "details.blockingPlayerId", "details.shootingPlayerId",
    "details.reason", "details.playerId", "details.shotType",
    "details.goalieInNetId", "details.awaySOG", "details.homeSOG",
    "details.hittingPlayerId", "details.hitteePlayerId",
    "details.secondaryReason", "details.typeCode", "details.descKey",
    "details.duration", "details.committedByPlayerId", "details.drawnByPlayerId",
    "pptReplayUrl",
    "details.scoringPlayerId", "details.scoringPlayerTotal",
    "details.assist1PlayerId", "details.assist1PlayerTotal",
    "details.assist2PlayerId", "details.assist2PlayerTotal",
    "details.awayScore", "details.homeScore",
    "details.highlightClipSharingUrl", "details.highlightClipSharingUrlFr",
    "details.highlightClip", "details.highlightClipFr",
    "details.discreteClip", "details.discreteClipFr",
    "details.servedByPlayerId",
    # Note: no "is_playoff" column — not present in the raw_pbp CSVs
]


# ── HTTP helper ────────────────────────────────────────────────────────────────
def get_url(url: str):
    from http_utils import get_json, HttpError
    try:
        return get_json(url, ua="plain")
    except HttpError as e:
        if e.status != 404:   # 404 = game not available yet (in-progress or future)
            print(f"  {e}")
        return None


KEY = ["game_id", "eventId"]


# ── Load existing game IDs ─────────────────────────────────────────────────────
def load_existing_game_ids(path: str | None = None) -> set:
    path = path or RAW_PBP
    if not os.path.exists(path):
        return set()
    df = pd.read_csv(path, usecols=["game_id"])
    return set(int(g) for g in df["game_id"].unique())


def heal_duplicates(path: str | None = None) -> int:
    """Rewrite ``path`` without duplicate (game_id, eventId) rows. Returns rows dropped."""
    path = path or RAW_PBP
    if not os.path.exists(path):
        return 0
    keys = pd.read_csv(path, usecols=KEY)
    n_dup = int(keys.duplicated(KEY).sum())
    if not n_dup:
        return 0
    from io_utils import atomic_write_csv
    df = pd.read_csv(path, low_memory=False)
    df = df.drop_duplicates(subset=KEY, keep="last")
    atomic_write_csv(path, df, min_rows=1, label=os.path.basename(path))
    return n_dup


def upsert_rows(new_df: pd.DataFrame, path: str | None = None) -> int:
    """Append rows whose (game_id, eventId) is not stored yet. Returns rows written."""
    path = path or RAW_PBP
    new_df = new_df.drop_duplicates(subset=KEY, keep="last")
    if os.path.exists(path):
        heal_duplicates(path)
        stored = pd.read_csv(path, usecols=KEY)
        stored_keys = set(zip(stored["game_id"].astype("int64"), stored["eventId"].astype("int64")))
        mask = [(int(g), int(e)) not in stored_keys for g, e in zip(new_df["game_id"], new_df["eventId"])]
        new_df = new_df[mask]
        if new_df.empty:
            return 0
        existing_df = pd.read_csv(path, nrows=0)
        for col in existing_df.columns:
            if col not in new_df.columns:
                new_df[col] = None
        new_df = new_df.reindex(columns=existing_df.columns)
        new_df.to_csv(path, mode="a", header=False, index=False)
    else:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        new_df.to_csv(path, index=False)
    return len(new_df)


# ── Flatten one PBP JSON → list of play-row dicts ─────────────────────────────
def flatten_pbp(pbp: dict, game_id: int) -> list[dict]:
    """
    Flatten the plays array from the NHL PBP JSON into row dicts that match
    the raw_pbp CSV schema.  Uses the same dotted-key naming that pandas
    json_normalize uses so the column names are consistent.
    """
    plays = pbp.get("plays", [])
    max_reg = pbp.get("regPeriods", 3)

    rows = []
    for play in plays:
        row: dict = {}

        # Top-level scalar fields
        for key in ("eventId", "timeInPeriod", "timeRemaining", "situationCode",
                    "homeTeamDefendingSide", "typeCode", "typeDescKey", "sortOrder",
                    "pptReplayUrl"):
            row[key] = play.get(key)

        # periodDescriptor sub-dict
        pd_dict = play.get("periodDescriptor", {})
        row["periodDescriptor.number"]               = pd_dict.get("number")
        row["periodDescriptor.periodType"]            = pd_dict.get("periodType")
        row["periodDescriptor.maxRegulationPeriods"]  = pd_dict.get("maxRegulationPeriods", max_reg)

        # details sub-dict — every key we track
        d = play.get("details", {})
        for sub in (
            "eventOwnerTeamId", "losingPlayerId", "winningPlayerId",
            "xCoord", "yCoord", "zoneCode",
            "blockingPlayerId", "shootingPlayerId",
            "reason", "playerId", "shotType",
            "goalieInNetId", "awaySOG", "homeSOG",
            "hittingPlayerId", "hitteePlayerId",
            "secondaryReason", "typeCode", "descKey", "duration",
            "committedByPlayerId", "drawnByPlayerId",
            "scoringPlayerId", "scoringPlayerTotal",
            "assist1PlayerId", "assist1PlayerTotal",
            "assist2PlayerId", "assist2PlayerTotal",
            "awayScore", "homeScore",
            "highlightClipSharingUrl", "highlightClipSharingUrlFr",
            "highlightClip", "highlightClipFr",
            "discreteClip", "discreteClipFr",
            "servedByPlayerId",
        ):
            row[f"details.{sub}"] = d.get(sub)

        # Metadata columns
        row["game_id"] = game_id
        row["season"]  = SEASON

        rows.append(row)

    return rows


# ── Fetch one day's schedule ───────────────────────────────────────────────────
def get_schedule_games(date_str: str) -> list[dict]:
    """Return list of game dicts for a given date (YYYY-MM-DD)."""
    data = get_url(f"{BASE_URL}/schedule/{date_str}")
    if not data:
        return []

    # The endpoint returns the whole game week; keep only ``date_str`` so a
    # multi-day look-back does not queue the same game several times.
    games = []
    for day in data.get("gameWeek", []):
        if day.get("date") not in (None, date_str):
            continue
        for g in day.get("games", []):
            games.append(g)
    return games


# ── Main ───────────────────────────────────────────────────────────────────────
def main(days_back: int = 2, dry_run: bool = False, path: str | None = None):
    print(f"{'[DRY RUN] ' if dry_run else ''}update_raw_pbp.py — incremental {SEASON_ID} PBP updater")

    # 1. Which game IDs do we already have?
    path = path or RAW_PBP
    if not dry_run:
        healed = heal_duplicates(path)
        if healed:
            print(f"  Healed {healed} duplicate (game_id, eventId) rows in {path}")
    existing_ids = load_existing_game_ids(path)
    print(f"  Existing games in CSV: {len(existing_ids)}")

    # 2. Gather candidate game IDs from the last `days_back` days
    today      = date.today()
    candidates = []   # (game_id, is_playoff, date_str)
    seen = set()

    for offset in range(1, days_back + 1):
        check_date = today - timedelta(days=offset)
        date_str   = check_date.strftime("%Y-%m-%d")
        games      = get_schedule_games(date_str)
        time.sleep(DELAY)

        for g in games:
            gid       = g.get("id")
            gtype     = g.get("gameType", 2)
            gstate    = g.get("gameState", "")

            # Only regular season (02) and playoffs (03)
            if gtype not in (2, 3):
                continue
            # Only completed games
            if gstate not in ("OFF", "FINAL"):
                continue
            # Skip games from previous seasons
            if str(gid)[:4] != SEASON_ID[:4]:
                continue
            # Skip if already in CSV or already queued this run
            if gid in existing_ids or gid in seen:
                continue
            seen.add(gid)

            is_playoff = 1 if gtype == 3 else 0
            candidates.append((gid, is_playoff, date_str))

    if not candidates:
        print("  No new games to add.")
        return

    print(f"  Found {len(candidates)} new games: {[c[0] for c in candidates]}")

    if dry_run:
        print("  [DRY RUN] Would fetch PBP and append rows. Exiting.")
        return

    # 3. Fetch PBP + flatten
    all_new_rows = []
    for gid, is_playoff, date_str in candidates:
        print(f"  Fetching PBP for {gid} ({date_str})...", end="", flush=True)
        pbp = get_url(f"{BASE_URL}/gamecenter/{gid}/play-by-play")
        time.sleep(DELAY)

        if not pbp:
            print(" SKIP (no PBP)")
            continue

        rows = flatten_pbp(pbp, gid)
        all_new_rows.extend(rows)
        print(f" {len(rows)} events")

    if not all_new_rows:
        print("  No rows extracted.")
        return

    # 4. Align columns + upsert on (game_id, eventId)
    new_df = pd.DataFrame(all_new_rows)
    for col in RAW_PBP_COLS:
        if col not in new_df.columns:
            new_df[col] = None
    new_df = new_df[RAW_PBP_COLS]
    written = upsert_rows(new_df, path)

    print(f"\n  ✓ Upserted {written} rows for {len(candidates)} games → {path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Incremental raw PBP updater")
    parser.add_argument("--days",    type=int,  default=2,
                        help="How many days back to check (default: 2)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would be added without writing")
    args = parser.parse_args()
    main(days_back=args.days, dry_run=args.dry_run)
