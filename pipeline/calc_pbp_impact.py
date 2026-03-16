"""
calc_pbp_impact.py
------------------
Computes PBP-derived 5v5 skater metrics from the enriched play-by-play data
and saves them to pbp_metrics.json for consumption by player_impact.py.

Metrics computed (5v5 only, situation_code == 1551):

  All skaters:
    ihd_attempts    Individual high-danger shot attempts (from shots CSV player_id)
    oihdf           On-ice HD shot attempts For (shooting team players on ice)
    oihda           On-ice HD shot attempts Against (defending team players on ice)
    oixgf           On-ice xGoals For (from shots CSV xG values)
    oixga           On-ice xGoals Against
    oif             On-ice total Corsi For (all shot attempts)
    oia             On-ice total Corsi Against

High-danger zone definition — 6 spatial bins from our xg_model bin system:
  D1_W1    (0.166 xG) — directly in front, central (0-10ft deep, 0-5ft wide)
  D1_W2_In (0.119 xG) — near-net, inner angle (0-10ft deep, 5-15ft wide, closer)
  D2_W1    (0.142 xG) — low slot center (10-20ft deep, 0-5ft wide)
  D2_W2    (0.119 xG) — low slot inner (10-20ft deep, 5-15ft wide)
  D2_W3_In (0.090 xG) — low slot mid-angle (10-20ft deep, 15-25ft wide, closer)
  D3_W1    (0.130 xG) — high slot CENTER ONLY (20-35ft deep, 0-5ft wide)

Note: D3_W1 kept (center-lane high slot, ~13% xG). D3_W2 removed — off-center
high slot shots (5-15ft wide) are not sufficiently dangerous to qualify as HD.
Wide-angle near-net shots (D1_W2_Out, D1_W3) are also excluded.

Output:
  pbp_metrics.json — {str(player_id): {ihd_attempts, oihdf, oihda, oixgf,
                                        oixga, oif, oia}} raw counts per player.
  player_impact.py reads this file and computes per-60 rates using the more
  accurate MoneyPuck 5v5 TOI as the denominator.

Usage:
  python calc_pbp_impact.py          # Run standalone; saves pbp_metrics.json
  from calc_pbp_impact import run_pbp_impact  # Called from refresh_pipeline.py
"""

import os
import json
import pandas as pd
import numpy as np
from datetime import datetime

# ── Config ──────────────────────────────────────────────────────────────────
PBP_FILE    = "nhl_season_2025_2026_pbp.csv"
SHIFTS_FILE = "nhl_season_2025_2026_shifts.csv"
SHOTS_FILE  = "nhl_season_2025_2026_shots.csv"
OUTPUT_FILE = "pbp_metrics.json"

# 5v5 situation code
SITUATION_5V5 = 1551

# Shot attempt type codes (Corsi events — goals, shots-on-goal, missed shots)
# Blocked shots (508) excluded — blocker typically isn't in PBP's on-ice columns.
SHOT_TYPES = {505, 506, 507}

# ── High-Danger Bin Definition ───────────────────────────────────────────────
# 7 bins from our spatial bin system representing the dangerous scoring areas.
# See module docstring for xG values and rationale.
HD_BINS = {
    "D1_W1",     # directly in front, central      (0.166 xG)
    "D1_W2_In",  # near-net, inner angle            (0.119 xG)
    "D2_W1",     # low slot center                  (0.142 xG)
    "D2_W2",     # low slot inner                   (0.119 xG)
    "D2_W3_In",  # low slot mid-angle               (0.090 xG)
    "D3_W1",     # high slot CENTER lane only       (0.130 xG)
    # D3_W2 removed — off-center high slot (5-15ft wide) not sufficiently HD
}

# On-ice player columns in enriched PBP
HOME_ON = [f"home_on{i}" for i in range(1, 7)]
AWAY_ON = [f"away_on{i}" for i in range(1, 7)]


# ── Spatial Bin Assignment ────────────────────────────────────────────────────

def assign_bin(x_coord, y_coord) -> str | None:
    """
    Assign a spatial bin to a shot location.
    Matches the 25-bin system in xg_model.py exactly.

    Returns bin name like "D1_W1", "D2_W3_In", or None if coordinates invalid.
    """
    try:
        x_f = float(x_coord)
        y_f = float(y_coord)
    except (TypeError, ValueError):
        return None

    depth_val = 89 - abs(x_f)

    if depth_val < 0:
        d = "D0"
    elif depth_val < 10:
        d = "D1"
    elif depth_val < 20:
        d = "D2"
    elif depth_val < 35:
        d = "D3"
    elif depth_val < 55:
        d = "D4"
    else:
        d = "D5"

    y_abs = abs(y_f)
    if y_abs < 5:
        w = "W1"
    elif y_abs < 15:
        w = "W2"
    elif y_abs < 25:
        w = "W3"
    elif y_abs < 35:
        w = "W4"
    else:
        w = "W5"

    bin_name = f"{d}_{w}"

    # Diagonal splits for the two mixed-danger bins
    if bin_name == "D1_W2":
        bin_name += "_In" if y_abs < depth_val + 5 else "_Out"
    elif bin_name == "D2_W3":
        bin_name += "_In" if y_abs < depth_val + 5 else "_Out"

    return bin_name


def is_hd(x_coord, y_coord) -> bool:
    """Return True if shot location falls in one of the 6 high-danger bins."""
    return assign_bin(x_coord, y_coord) in HD_BINS


# ── Player Key Helpers ────────────────────────────────────────────────────────

def parse_player_id(val) -> str | None:
    """Convert on-ice cell value to a string player key."""
    if pd.isna(val) or val == "" or val is None:
        return None
    try:
        return str(int(float(val)))
    except (ValueError, TypeError):
        s = str(val).strip()
        return s if s else None


def on_ice_players(row, cols) -> list[str]:
    """Return list of player keys from the given on-ice columns."""
    return [k for c in cols if (k := parse_player_id(row.get(c))) is not None]


# ── Main Entry Point ──────────────────────────────────────────────────────────

def run_pbp_impact(pbp_file=PBP_FILE, shots_file=SHOTS_FILE,
                   shifts_file=SHIFTS_FILE, output_file=OUTPUT_FILE):
    """
    Compute PBP-derived 5v5 metrics and save raw counts to pbp_metrics.json.

    player_impact.py reads this file to incorporate HD metrics into the
    player impact score, using MoneyPuck 5v5 TOI as the denominator.

    Returns: dict of {player_key: {ihd_attempts, oihdf, oihda, ...}}
    """
    print(f"=== calc_pbp_impact.py — {datetime.now().strftime('%Y-%m-%d %H:%M')} ===")

    # ── Load enriched PBP ───────────────────────────────────────────────────
    if not os.path.exists(pbp_file):
        print(f"  ✗ {pbp_file} not found. Run enrich_pbp.py first.")
        return {}

    print("  Loading PBP data...")
    pbp = pd.read_csv(pbp_file, low_memory=False)
    print(f"  PBP rows: {len(pbp):,}")

    # Filter to 5v5 events with on-ice enrichment
    fives    = pbp[pbp["situation_code"] == SITUATION_5V5].copy()
    enriched = fives[fives["home_on1"].notna()].copy()
    print(f"  5v5 rows: {len(fives):,} | enriched with on-ice data: {len(enriched):,}")

    if enriched.empty:
        print("  ✗ No enriched 5v5 data — run enrich_pbp.py first.")
        return {}

    # Filter to shot attempt events
    shots_5v5 = enriched[enriched["type_code"].isin(SHOT_TYPES)].copy()

    # PBP records each event twice (once per team perspective). We need exactly
    # one row per physical event and the correct is_home_team value for the
    # shooting team. We determine this from the shots CSV team_id.

    # ── Build game → home team ID lookup ────────────────────────────────────
    # From PBP: for each game, find the home team's common name (is_home_team=True rows)
    # From nhl_teams.csv: map common name → NHL team ID
    teams_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nhl_teams.csv")
    name_to_id: dict[str, int] = {}
    try:
        teams_df = pd.read_csv(teams_file)
        name_to_id = dict(zip(teams_df["Common Name"], teams_df["NHL Team ID"].astype(int)))
    except Exception as e:
        print(f"  [WARN] Could not load nhl_teams.csv: {e}")

    game_home_id: dict[int, int] = {}  # game_id → home team NHL ID
    for gid, grp in pbp.groupby("game_id"):
        home_rows = grp[grp["is_home_team"] == True]
        if not home_rows.empty:
            home_name = home_rows.iloc[0].get("team_perspective", "")
            tid = name_to_id.get(home_name)
            if tid:
                game_home_id[int(gid)] = int(tid)

    print(f"  Home team lookup: {len(game_home_id)} games resolved")

    # ── Build shooter/team/xG lookups from shots CSV ─────────────────────────
    shooter_lookup: dict[tuple, str]   = {}  # (game_id, event_id) → player_id str
    shot_team_lookup: dict[tuple, int] = {}  # (game_id, event_id) → shooting team_id
    xg_lookup: dict[tuple, float]      = {}  # (game_id, event_id) → xG

    if os.path.exists(shots_file):
        try:
            shots_df = pd.read_csv(shots_file, usecols=["game_id", "event_id",
                                                          "player_id", "team_id", "xG"])
            for _, r in shots_df.iterrows():
                key = (int(r["game_id"]), int(r["event_id"]))
                shooter_lookup[key]   = str(int(r["player_id"]))
                shot_team_lookup[key] = int(r["team_id"])
                xg_lookup[key]        = float(r["xG"])
            print(f"  Shots CSV lookup: {len(shooter_lookup):,} events")
        except Exception as e:
            print(f"  [WARN] Could not load shots CSV: {e}")

    # ── Keep one PBP row per event with correct shooting-side flag ───────────
    # For each (game_id, event_id), we know which team shot (shot_team_lookup).
    # Keep the row where is_home_team matches whether the shooting team is home.
    def shooting_is_home(game_id: int, event_id: int) -> bool | None:
        team_id = shot_team_lookup.get((game_id, event_id))
        home_id = game_home_id.get(game_id)
        if team_id is None or home_id is None:
            return None
        return team_id == home_id

    shots_5v5["_shooting_is_home"] = shots_5v5.apply(
        lambda r: shooting_is_home(int(r["game_id"]),
                                   int(r["event_id"]) if pd.notna(r.get("event_id")) else -1),
        axis=1
    )
    # Keep rows where is_home_team matches the shooting side (correct perspective)
    # For rows where we couldn't determine shooting side, keep is_home_team=True
    # (arbitrary but consistent; these fallback rows are deduplicated below)
    mask_correct = shots_5v5["_shooting_is_home"] == shots_5v5["is_home_team"]
    mask_unknown = shots_5v5["_shooting_is_home"].isna()
    shots_5v5 = shots_5v5[mask_correct | mask_unknown].copy()
    # Final dedup in case of any remaining duplicates
    before_dedup = len(shots_5v5)
    shots_5v5 = shots_5v5.drop_duplicates(subset=["game_id", "event_id"]).copy()
    print(f"  Kept {before_dedup:,} correctly-sided rows → {len(shots_5v5):,} unique events")

    # Classify HD using spatial bins
    shots_5v5["is_hd"] = shots_5v5.apply(
        lambda r: is_hd(r.get("x_coord"), r.get("y_coord")), axis=1
    )

    hd_count    = shots_5v5["is_hd"].sum()
    total_count = len(shots_5v5)
    print(f"  5v5 shot attempts: {total_count:,} | HD (6-bin): {hd_count:,} ({100*hd_count/max(total_count,1):.1f}%)")

    # ── Accumulate per-player raw counts ────────────────────────────────────
    # Keyed by player_id string (numeric from REST API) or player_name (HTML fallback).
    # player_impact.py will resolve name-keyed entries via its name lookup.
    stats: dict[str, dict] = {}

    def get_or_create(key: str) -> dict:
        if key not in stats:
            stats[key] = {
                "ihd_attempts": 0,   # individual HD shot attempts (from shots CSV ID)
                "oihdf":        0,   # on-ice HD For attempts
                "oihda":        0,   # on-ice HD Against attempts
                "oixgf":        0.0, # on-ice xGoals For
                "oixga":        0.0, # on-ice xGoals Against
                "oif":          0,   # on-ice Corsi For (all strengths in 5v5 events)
                "oia":          0,   # on-ice Corsi Against
            }
        return stats[key]

    # Process each 5v5 shot attempt event (one row per physical event,
    # with is_home_team correctly reflecting the shooting team's side)
    for _, row in shots_5v5.iterrows():
        hd = bool(row.get("is_hd", False))

        game_id  = int(row["game_id"])
        event_id = int(row["event_id"]) if pd.notna(row.get("event_id")) else -1
        xg_val   = xg_lookup.get((game_id, event_id), 0.0)

        # Shooter player_id from shots CSV (clean numeric ID)
        shooter_pid = shooter_lookup.get((game_id, event_id))

        home_players = on_ice_players(row, HOME_ON)
        away_players = on_ice_players(row, AWAY_ON)

        # is_home_team now correctly identifies the shooting team (set during dedup)
        if bool(row.get("is_home_team", False)):
            shooting_players  = home_players
            defending_players = away_players
        else:
            shooting_players  = away_players
            defending_players = home_players

        # ── Credit shooting-team on-ice players ──
        for p in shooting_players:
            s = get_or_create(p)
            s["oif"] += 1
            if hd:
                s["oihdf"] += 1
            if xg_val > 0:
                s["oixgf"] += xg_val

        # ── Individual HD: credit only the shooter (via clean numeric ID) ──
        if hd and shooter_pid:
            get_or_create(shooter_pid)["ihd_attempts"] += 1

        # ── Credit defending-team on-ice players ──
        for p in defending_players:
            s = get_or_create(p)
            s["oia"] += 1
            if hd:
                s["oihda"] += 1
            if xg_val > 0:
                s["oixga"] += xg_val

    print(f"  Accumulated stats for {len(stats)} player keys")

    # ── Save raw counts to pbp_metrics.json ─────────────────────────────────
    # player_impact.py will compute per-60 rates using MoneyPuck 5v5 TOI as
    # the denominator (more accurate than shift-summed all-situations TOI).
    script_dir = os.path.dirname(os.path.abspath(__file__))
    out_path   = os.path.join(script_dir, output_file)
    with open(out_path, "w") as f:
        json.dump(stats, f)
    print(f"  ✓ Saved {output_file} ({len(stats)} player keys)")

    # ── Summary of HD bin breakdown ─────────────────────────────────────────
    if not shots_5v5.empty:
        shots_5v5["bin"] = shots_5v5.apply(
            lambda r: assign_bin(r.get("x_coord"), r.get("y_coord")), axis=1
        )
        hd_bins_found = shots_5v5[shots_5v5["is_hd"]]["bin"].value_counts()
        print("  HD bin breakdown (5v5 shot attempts):")
        for bn, cnt in hd_bins_found.items():
            print(f"    {bn:<14} {cnt:>5}")

    print("=== calc_pbp_impact.py complete ===\n")
    return stats


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    run_pbp_impact()
