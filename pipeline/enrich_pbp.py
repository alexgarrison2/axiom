"""
enrich_pbp.py
-------------
Joins shift chart data onto PBP events to add on-ice player IDs for each event.

For every PBP row, finds all players whose shift overlaps the event's timestamp
and adds them as home_on1...home_on6, away_on1...away_on6 columns.

Usage:
  python enrich_pbp.py                         # Process all unprocessed games
  python enrich_pbp.py --game 2025020018       # Single game (for testing)
  python enrich_pbp.py --full                  # Re-enrich all games from scratch

Output: nhl_season_2025_2026_pbp.csv with on-ice columns added/updated.
"""

import pandas as pd
import numpy as np
import sys
import os
from datetime import datetime

# ── Config ──────────────────────────────────────────────────────────────────
PBP_FILE = "nhl_season_2025_2026_pbp.csv"
SHIFTS_FILE = "nhl_season_2025_2026_shifts.csv"
MAX_ON_ICE = 6  # Max players per team (5 skaters + 1 goalie)

HOME_COLS = [f"home_on{i}" for i in range(1, MAX_ON_ICE + 1)]
AWAY_COLS = [f"away_on{i}" for i in range(1, MAX_ON_ICE + 1)]
ON_ICE_COLS = HOME_COLS + AWAY_COLS


def time_str_to_seconds(t) -> int:
    """Convert MM:SS string to seconds."""
    try:
        m, s = str(t).split(":")
        return int(m) * 60 + int(s)
    except Exception:
        return 0


def get_event_seconds(row) -> int:
    """
    Convert a PBP row's time_in_period to absolute game seconds.
    PBP stores period + time_in_period (MM:SS).
    """
    period = int(row.get("period", 1))
    t = str(row.get("time_in_period", "00:00"))
    try:
        m, s = map(int, t.split(":"))
        secs_in_period = m * 60 + s
    except Exception:
        secs_in_period = 0
    # Each regulation period is 20 minutes (1200s)
    # OT periods are also 20 min (or 5 min in regular season OT)
    # We track period + seconds-within-period separately, so just return within-period seconds
    # The shifts CSV also stores period + start/end_seconds within that period
    return secs_in_period


def enrich_game(pbp_game: pd.DataFrame, shifts_game: pd.DataFrame,
                home_team_id: int, away_team_id: int) -> pd.DataFrame:
    """
    For a single game, add on-ice player columns to each PBP event row.
    Returns the enriched dataframe.
    """
    # Pre-assign empty on-ice columns
    for col in ON_ICE_COLS:
        pbp_game = pbp_game.copy()
        pbp_game[col] = pd.NA

    # Group shifts by team
    home_shifts = shifts_game[shifts_game["team_id"] == home_team_id]
    away_shifts = shifts_game[shifts_game["team_id"] == away_team_id]

    def get_on_ice(period: int, event_sec: int, team_shifts: pd.DataFrame) -> list:
        """Find player_ids whose shift covers this period + second."""
        on_ice = team_shifts[
            (team_shifts["period"] == period) &
            (team_shifts["start_seconds"] <= event_sec) &
            (team_shifts["end_seconds"] >= event_sec)
        ]["player_id"].tolist()
        # Sort for determinism, cap at MAX_ON_ICE
        return sorted(set(on_ice))[:MAX_ON_ICE]

    enriched_rows = []
    for _, row in pbp_game.iterrows():
        period = int(row.get("period", 1))
        event_sec = get_event_seconds(row)

        home_players = get_on_ice(period, event_sec, home_shifts)
        away_players = get_on_ice(period, event_sec, away_shifts)

        row = row.copy()
        for i, pid in enumerate(home_players):
            row[f"home_on{i+1}"] = pid
        for i, pid in enumerate(away_players):
            row[f"away_on{i+1}"] = pid

        enriched_rows.append(row)

    return pd.DataFrame(enriched_rows)


def main():
    full_mode = "--full" in sys.argv
    single_game = None
    if "--game" in sys.argv:
        idx = sys.argv.index("--game")
        single_game = int(sys.argv[idx + 1])

    print(f"enrich_pbp.py — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Mode: {'single game ' + str(single_game) if single_game else 'full' if full_mode else 'incremental'}")

    if not os.path.exists(PBP_FILE):
        print(f"✗ {PBP_FILE} not found. Run from the pipeline/ directory.")
        sys.exit(1)
    if not os.path.exists(SHIFTS_FILE):
        print(f"✗ {SHIFTS_FILE} not found. Run fetch_shifts.py first.")
        sys.exit(1)

    print("  Loading PBP data...")
    pbp = pd.read_csv(PBP_FILE, low_memory=False)
    print(f"  PBP rows: {len(pbp):,}")

    print("  Loading shifts data...")
    shifts = pd.read_csv(SHIFTS_FILE)
    print(f"  Shifts rows: {len(shifts):,}")

    # Add on-ice columns if they don't exist yet
    for col in ON_ICE_COLS:
        if col not in pbp.columns:
            pbp[col] = pd.NA

    # Determine which games to process
    all_game_ids = pbp["game_id"].unique()
    shifts_game_ids = set(shifts["game_id"].unique())

    if single_game:
        to_process = [single_game]
    elif full_mode:
        to_process = [g for g in all_game_ids if g in shifts_game_ids]
    else:
        # Incremental: only enrich games where home_on1 is still NA
        unprocessed_mask = pbp["home_on1"].isna()
        to_process = [g for g in pbp[unprocessed_mask]["game_id"].unique() if g in shifts_game_ids]

    print(f"  Games to enrich: {len(to_process)}")

    if not to_process:
        print("  ✓ PBP already fully enriched — nothing to do.")
        return

    # Process game by game
    processed_count = 0
    for i, game_id in enumerate(to_process, 1):
        pbp_game = pbp[pbp["game_id"] == game_id].copy()
        shifts_game = shifts[shifts["game_id"] == game_id].copy()

        if shifts_game.empty:
            continue

        # Determine home/away team IDs from the PBP rows
        # PBP has is_home_team boolean and team_perspective (team name)
        # Use team_id from shifts to find home/away
        all_team_ids = shifts_game["team_id"].unique()
        if len(all_team_ids) < 2:
            continue
        home_team_id = int(all_team_ids[0])
        away_team_id = int(all_team_ids[1])

        # Cross-check: PBP has is_home_team; find the home team's team_perspective
        # and match to the shifts team. If PBP rows have is_home_team=True,
        # find their team name and cross-reference to the shifts' team_abbrev.
        home_pbp_rows = pbp_game[pbp_game["is_home_team"] == True]
        if not home_pbp_rows.empty and "team_perspective" in pbp_game.columns:
            home_name = home_pbp_rows.iloc[0].get("team_perspective", "")
            # Match to team_abbrev in shifts
            home_match = shifts_game[shifts_game["team_abbrev"] == home_name]
            if not home_match.empty:
                home_team_id = int(home_match.iloc[0]["team_id"])
                away_team_id = int(shifts_game[shifts_game["team_id"] != home_team_id]["team_id"].iloc[0])

        enriched = enrich_game(pbp_game, shifts_game, home_team_id, away_team_id)

        # Update the main PBP dataframe
        pbp.loc[pbp["game_id"] == game_id, ON_ICE_COLS] = enriched[ON_ICE_COLS].values

        processed_count += 1
        if i % 100 == 0 or i == len(to_process):
            print(f"  [{i}/{len(to_process)}] game {game_id} enriched")

    print(f"\n✓ Enriched {processed_count} games.")
    print("  Saving PBP file...")
    pbp.to_csv(PBP_FILE, index=False)
    print(f"  Saved to {PBP_FILE}")

    # Sanity check: count events with 5v5 on-ice data
    has_data = pbp["home_on1"].notna().sum()
    print(f"  Events with on-ice data: {has_data:,} / {len(pbp):,} ({100*has_data/len(pbp):.1f}%)")


if __name__ == "__main__":
    main()
