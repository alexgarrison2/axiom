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
"""

from season import season_file
import pandas as pd
import sys
import os
from datetime import datetime

# ── Config ──────────────────────────────────────────────────────────────────
PBP_FILE    = season_file("pbp")
SHIFTS_FILE = season_file("shifts")
TEAMS_FILE  = "nhl_teams.csv"
MAX_ON_ICE  = 6   # 5 skaters + 1 goalie per team

HOME_COLS  = [f"home_on{i}" for i in range(1, MAX_ON_ICE + 1)]
AWAY_COLS  = [f"away_on{i}" for i in range(1, MAX_ON_ICE + 1)]
ON_ICE_COLS = HOME_COLS + AWAY_COLS


def time_to_seconds(t) -> int:
    try:
        m, s = str(t).split(":")
        return int(m) * 60 + int(s)
    except Exception:
        return 0


def build_name_to_id(teams_file: str) -> dict:
    """Build Common Name → NHL Team ID lookup from nhl_teams.csv."""
    try:
        df = pd.read_csv(teams_file)
        return dict(zip(df["Common Name"], df["NHL Team ID"]))
    except Exception:
        return {}


def enrich_game(pbp_game: pd.DataFrame, shifts_game: pd.DataFrame,
                home_team_id: int, away_team_id: int) -> pd.DataFrame:
    """
    Add on-ice player columns to each PBP event row for one game.
    Uses period + elapsed seconds to find which players were on ice.
    """
    pbp_game = pbp_game.copy()
    for col in ON_ICE_COLS:
        pbp_game[col] = pd.NA

    home_shifts = shifts_game[shifts_game["team_id"] == home_team_id]
    away_shifts = shifts_game[shifts_game["team_id"] == away_team_id]

    def get_on_ice(period: int, event_sec: int, team_shifts: pd.DataFrame) -> list:
        active = team_shifts[
            (team_shifts["period"] == period) &
            (team_shifts["start_seconds"] <= event_sec) &
            (team_shifts["end_seconds"] >= event_sec)
        ]
        # Prefer player_id (int); fall back to player_name for HTML-sourced shifts
        result = []
        for _, s in active.iterrows():
            pid = s["player_id"]
            if pd.notna(pid):
                result.append(int(pid))
            else:
                result.append(str(s.get("player_name", "")))
        return list(dict.fromkeys(result))[:MAX_ON_ICE]  # dedupe, preserve order, cap at 6


    rows = []
    for _, row in pbp_game.iterrows():
        period = int(row.get("period", 1))
        event_sec = time_to_seconds(row.get("time_in_period", "0:00"))

        home_players = get_on_ice(period, event_sec, home_shifts)
        away_players = get_on_ice(period, event_sec, away_shifts)

        row = row.copy()
        for i, pid in enumerate(home_players):
            row[f"home_on{i+1}"] = pid
        for i, pid in enumerate(away_players):
            row[f"away_on{i+1}"] = pid
        rows.append(row)

    return pd.DataFrame(rows)


def resolve_home_away(pbp_game: pd.DataFrame, name_to_id: dict) -> tuple[int, int]:
    """
    Determine home and away team IDs for a game using PBP's is_home_team flag
    and the nhl_teams.csv Common Name → team_id mapping.
    Returns (home_team_id, away_team_id).
    """
    home_rows = pbp_game[pbp_game["is_home_team"] == True]
    away_rows = pbp_game[pbp_game["is_home_team"] == False]

    if home_rows.empty or away_rows.empty:
        return 0, 0

    home_name = home_rows.iloc[0].get("team_perspective", "")
    away_name  = away_rows.iloc[0].get("team_perspective", "")

    home_id = name_to_id.get(home_name, 0)
    away_id  = name_to_id.get(away_name, 0)

    return int(home_id), int(away_id)


def main(argv=None):
    """Enrich PBP rows with on-ice player ids. Never exits the interpreter;
    returns {'status': 'ok'|'skip'|'fail', 'rows_written': int, 'reason': str}."""
    argv = list(sys.argv[1:] if argv is None and __name__ == "__main__" else (argv or []))
    full_mode   = "--full" in argv
    single_game = None
    if "--game" in argv:
        idx = argv.index("--game")
        single_game = int(argv[idx + 1])

    print(f"enrich_pbp.py — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    mode_label = ("single game " + str(single_game)) if single_game else ("full" if full_mode else "incremental")
    print(f"Mode: {mode_label}")

    if not os.path.exists(PBP_FILE):
        print(f"[SKIP] {PBP_FILE} not found — nothing to enrich.")
        return {"status": "skip", "rows_written": 0, "reason": f"{PBP_FILE} not found"}
    if not os.path.exists(SHIFTS_FILE):
        print(f"[SKIP] {SHIFTS_FILE} not found — shifts must be fetched first.")
        return {"status": "skip", "rows_written": 0, "reason": f"{SHIFTS_FILE} not found"}

    # Load name → team_id lookup
    name_to_id = build_name_to_id(TEAMS_FILE)
    print(f"  Loaded team lookup: {len(name_to_id)} teams")

    print("  Loading PBP data...")
    pbp = pd.read_csv(PBP_FILE, low_memory=False)
    print(f"  PBP rows: {len(pbp):,}")

    print("  Loading shifts data...")
    shifts = pd.read_csv(SHIFTS_FILE)
    print(f"  Shifts rows: {len(shifts):,}")

    # Add on-ice columns if missing; player ids are nullable integers
    for col in ON_ICE_COLS:
        if col not in pbp.columns:
            pbp[col] = pd.NA
        pbp[col] = pd.to_numeric(pbp[col], errors="coerce").astype("Int64")

    shift_game_ids = set(shifts["game_id"].unique())
    all_pbp_game_ids = pbp["game_id"].unique()

    if single_game:
        to_process = [single_game]
    elif full_mode:
        to_process = [g for g in all_pbp_game_ids if g in shift_game_ids]
    else:
        # Incremental: games where ALL home_on1 values are NA
        unenriched = pbp.groupby("game_id")["home_on1"].apply(lambda x: x.isna().all())
        to_process = [g for g in unenriched[unenriched].index if g in shift_game_ids]

    print(f"  Games to enrich: {len(to_process)}")
    if not to_process:
        print("  ✓ PBP already fully enriched — nothing to do.")
        return {"status": "skip", "rows_written": 0, "reason": "up to date"}

    processed, skipped = 0, 0
    for i, game_id in enumerate(to_process, 1):
        pbp_game   = pbp[pbp["game_id"] == game_id].copy()
        shifts_game = shifts[shifts["game_id"] == game_id].copy()

        if shifts_game.empty:
            skipped += 1
            continue

        home_id, away_id = resolve_home_away(pbp_game, name_to_id)

        if home_id == 0 or away_id == 0:
            # Fallback: use the two team_ids found in the shifts themselves
            tids = shifts_game["team_id"].unique()
            if len(tids) >= 2:
                home_id, away_id = int(tids[0]), int(tids[1])
            else:
                skipped += 1
                continue

        enriched = enrich_game(pbp_game, shifts_game, home_id, away_id)
        pbp.loc[pbp["game_id"] == game_id, ON_ICE_COLS] = enriched[ON_ICE_COLS].values

        processed += 1
        if i % 100 == 0 or i == len(to_process):
            print(f"  [{i}/{len(to_process)}] game {game_id} enriched "
                  f"(home_id={home_id}, away_id={away_id})")

    print(f"\n✓ Enriched {processed} games ({skipped} skipped — no shifts or team match).")
    print("  Saving PBP file...")
    from io_utils import atomic_write_csv
    atomic_write_csv(PBP_FILE, pbp, min_rows=1, label=os.path.basename(PBP_FILE))

    enriched_rows = pbp["home_on1"].notna().sum()
    enriched_games = pbp[pbp["home_on1"].notna()]["game_id"].nunique()
    print(f"  On-ice coverage: {enriched_rows:,} rows / {enriched_games} games "
          f"({100 * enriched_rows / len(pbp):.1f}%)")
    return {"status": "ok", "rows_written": int(processed), "reason": ""}


if __name__ == "__main__":
    res = main()
    sys.exit(1 if res.get("status") == "fail" else 0)
