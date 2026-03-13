"""
calc_pbp_impact.py
------------------
Computes PBP-derived 5v5 skater metrics from the enriched play-by-play data
and merges them into player_impact.json.

Metrics computed (5v5 only, situation_code == 1551):

  Forwards:
    pbp_ihd_per60     Individual high-danger shot attempts per 60 min
                      (goals + shots-on-goal + missed shots from HD zone)

  Defenders:
    pbp_oihda_per60   On-ice high-danger shot attempts against per 60 min
                      (team allowed HD attempts while player was on ice)

  All skaters:
    pbp_oihdcf_pct    On-ice HD shot attempt % (HD Corsi For / (CF + CA))
    pbp_oixgf_per60   On-ice xGF per 60 min at 5v5 (our own xG model values)
    pbp_oixga_per60   On-ice xGA per 60 min at 5v5
    pbp_toi_5v5       Total 5v5 TOI in seconds (from shifts, as sanity check)

High-danger zone definition (matches xg_model.py spatial bins):
  depth_from_goal = 89 - abs(x_coord) < 20  (D1 and D2 bins)
  No width restriction — any angle within 20ft of the net is HD.

Shot attempt events: type_code 505 (goal) | 506 (shot-on-goal) | 507 (missed-shot)
Blocked shots (508) excluded — blocker typically isn't in PBP's on-ice columns.

Usage:
  python calc_pbp_impact.py          # Updates player_impact.json in-place
  from calc_pbp_impact import run_pbp_impact  # Called from refresh_pipeline.py
"""

import os
import json
import pandas as pd
import numpy as np
from datetime import datetime

# ── Config ──────────────────────────────────────────────────────────────────
PBP_FILE          = "nhl_season_2025_2026_pbp.csv"
SHIFTS_FILE       = "nhl_season_2025_2026_shifts.csv"
SHOTS_FILE        = "nhl_season_2025_2026_shots.csv"   # for xG values
PLAYER_IMPACT_IN  = "player_impact.json"
PLAYER_IMPACT_OUT = "player_impact.json"

# 5v5 situation code
SITUATION_5V5 = 1551

# Shot attempt type codes (Corsi events)
SHOT_TYPES = {505, 506, 507}   # goal, shot-on-goal, missed-shot

# High-danger depth threshold (matches D1+D2 spatial bins in xg_model.py)
# depth_from_goal = 89 - abs(x_coord); < 20 = D1 or D2
HD_DEPTH_MAX = 20

# On-ice player columns
HOME_ON = [f"home_on{i}" for i in range(1, 7)]
AWAY_ON = [f"away_on{i}" for i in range(1, 7)]

# Minimum 5v5 TOI seconds to include a player (< 5 min → ignore)
MIN_TOI_SECONDS = 300


def is_hd(x_coord) -> bool:
    """True if the shot is in the high-danger zone (within 20ft of the net)."""
    try:
        return (89 - abs(float(x_coord))) < HD_DEPTH_MAX
    except (TypeError, ValueError):
        return False


def parse_player_id(val) -> str | None:
    """Convert on-ice cell value to a string player key. Handles int IDs and name strings."""
    if pd.isna(val) or val == "" or val is None:
        return None
    # int-like → use as numeric ID string
    try:
        return str(int(float(val)))
    except (ValueError, TypeError):
        # String (player_name from HTML-sourced shifts) — use as-is
        s = str(val).strip()
        return s if s else None


def build_player_name_index(impact: dict) -> dict:
    """Build normalized-name → player_key lookup from existing player_impact dict."""
    idx = {}
    for pid, d in impact.items():
        name = d.get("name", "")
        if name:
            idx[name.lower().strip()] = pid
    return idx


def run_pbp_impact(pbp_file=PBP_FILE, shots_file=SHOTS_FILE,
                   shifts_file=SHIFTS_FILE,
                   impact_in=PLAYER_IMPACT_IN, impact_out=PLAYER_IMPACT_OUT):
    """
    Main entry point. Loads PBP + existing player_impact.json, computes
    PBP-derived metrics, merges them in, and saves.
    """
    print(f"=== calc_pbp_impact.py — {datetime.now().strftime('%Y-%m-%d %H:%M')} ===")

    # ── Load data ──────────────────────────────────────────────────────────
    if not os.path.exists(pbp_file):
        print(f"  ✗ {pbp_file} not found. Run from pipeline/ directory.")
        return {}

    print("  Loading PBP data...")
    pbp = pd.read_csv(pbp_file, low_memory=False)
    print(f"  PBP rows: {len(pbp):,}")

    # ── Filter to 5v5 ──────────────────────────────────────────────────────
    fives = pbp[pbp["situation_code"] == SITUATION_5V5].copy()
    enriched = fives[fives["home_on1"].notna()].copy()
    print(f"  5v5 rows: {len(fives):,} | enriched with on-ice data: {len(enriched):,}")

    if enriched.empty:
        print("  ✗ No enriched 5v5 data found. Run enrich_pbp.py first.")
        return {}

    # ── Shot attempt events (Corsi) ────────────────────────────────────────
    shots_5v5 = enriched[enriched["type_code"].isin(SHOT_TYPES)].copy()
    shots_5v5["is_hd"] = shots_5v5["x_coord"].apply(is_hd)
    hd_shots = shots_5v5[shots_5v5["is_hd"]].copy()
    print(f"  5v5 shot attempts: {len(shots_5v5):,} | HD attempts: {len(hd_shots):,}")

    # ── Load xG values from shots CSV if available ──────────────────────────
    xg_lookup = {}   # (game_id, event_id) → xG
    if os.path.exists(shots_file):
        shots_df = pd.read_csv(shots_file, usecols=["game_id", "event_id", "xG"]
                               if "event_id" in pd.read_csv(shots_file, nrows=0).columns
                               else ["game_id", "xG"])
        print(f"  Shots CSV loaded: {len(shots_df):,} rows")
        if "event_id" in shots_df.columns:
            xg_lookup = {(int(r.game_id), int(r.event_id)): float(r.xG)
                         for _, r in shots_df.iterrows()}

    # ── Load shifts for TOI calculation ────────────────────────────────────
    toi_by_player: dict[str, float] = {}   # player_key → 5v5 seconds
    if os.path.exists(shifts_file):
        shifts = pd.read_csv(shifts_file)
        # We only have 5v5 TOI from shifts combined with PBP — use shift duration
        # summed over all shifts that occurred during 5v5 game time
        # Simpler: sum (end - start) per player_id across all shifts
        for _, row in shifts.iterrows():
            pid = str(int(row["player_id"])) if pd.notna(row["player_id"]) else str(row["player_name"]).strip()
            if pid:
                dur = float(row["end_seconds"]) - float(row["start_seconds"])
                toi_by_player[pid] = toi_by_player.get(pid, 0.0) + max(dur, 0)
        print(f"  TOI data: {len(toi_by_player)} players")

    # ── Accumulate per-player stats ────────────────────────────────────────
    # Each player gets:
    #   ihd_attempts      HD shot attempts they took individually (For rows)
    #   oihdf             on-ice HD For attempts (any player on their team)
    #   oihda             on-ice HD Against attempts (opponent HD while on ice)
    #   oixgf             on-ice xGF (from shots CSV xG values)
    #   oixga             on-ice xGA
    #   oif               on-ice total shot attempts For (for HD CF%)
    #   oia               on-ice total shot attempts Against
    #   toi_5v5           seconds of 5v5 time on ice (from shifts)

    stats: dict[str, dict] = {}

    def get_or_create(player_key: str) -> dict:
        if player_key not in stats:
            stats[player_key] = {
                "ihd_attempts": 0,
                "oihdf":        0,
                "oihda":        0,
                "oixgf":        0.0,
                "oixga":        0.0,
                "oif":          0,
                "oia":          0,
                "toi_5v5":      toi_by_player.get(player_key, 0.0),
            }
        return stats[player_key]

    def on_ice_players(row, side: str) -> list[str]:
        cols = HOME_ON if side == "home" else AWAY_ON
        return [k for c in cols
                if (k := parse_player_id(row.get(c))) is not None]

    # Process shot attempt events
    for _, row in shots_5v5.iterrows():
        is_home_event = bool(row.get("is_home_team", False))
        hd = bool(row.get("is_hd", False))

        # get_xg from lookup or shots CSV value
        xg_val = xg_lookup.get((int(row["game_id"]), int(row["event_id"])), 0.0) \
                 if "event_id" in row and pd.notna(row.get("event_id")) else 0.0

        # Home team shooting → For home, Against away
        if is_home_event:
            shooting_side, defending_side = "home", "away"
        else:
            shooting_side, defending_side = "away", "home"

        shooting_players  = on_ice_players(row, shooting_side)
        defending_players = on_ice_players(row, defending_side)

        # Individual HD attempt: only the shooter themselves
        shooter_name = str(row.get("shooter_name", "") or "").strip()

        for p in shooting_players:
            s = get_or_create(p)
            s["oif"] += 1
            if hd:
                s["oihdf"] += 1
            if xg_val > 0:
                s["oixgf"] += xg_val
            # Individual HD: check if this player is the shooter
            if hd and shooter_name:
                pname = str(p).lower()
                sname = shooter_name.lower()
                # Match either by name partial or if p is numeric, cross-ref later
                try:
                    int(p)   # numeric player_id — can't name-match here; skip iHD for now
                except ValueError:
                    if pname == sname or sname in pname or pname in sname:
                        s["ihd_attempts"] += 1

        for p in defending_players:
            s = get_or_create(p)
            s["oia"] += 1
            if hd:
                s["oihda"] += 1
            if xg_val > 0:
                s["oixga"] += xg_val

    print(f"  Accumulated stats for {len(stats)} player keys (on-ice records)")

    # ── Load existing player_impact.json ───────────────────────────────────
    impact = {}
    if os.path.exists(impact_in):
        with open(impact_in) as f:
            impact = json.load(f)
        print(f"  Loaded player_impact.json: {len(impact)} players")
    else:
        print(f"  [WARN] {impact_in} not found — will create new file")

    # Build name → pid lookup from existing impact data
    name_to_pid = build_player_name_index(impact)

    # ── Merge PBP stats into impact profiles ──────────────────────────────
    merged, new = 0, 0

    def per60(n, toi):
        return round((n / toi) * 3600.0, 4) if toi >= 60 else 0.0

    for player_key, s in stats.items():
        # Determine TOI from shifts (use accumulated toi from stats dict)
        toi = s["toi_5v5"]
        if toi < MIN_TOI_SECONDS:
            continue

        # Try to find existing impact profile
        pid = None

        # 1. Numeric player_id key
        try:
            int(player_key)
            if player_key in impact:
                pid = player_key
        except ValueError:
            pass

        # 2. Name-based lookup for HTML-sourced shifts
        if pid is None:
            pid = name_to_pid.get(player_key.lower().strip())

        # 3. Partial name match
        if pid is None:
            for norm_name, ppid in name_to_pid.items():
                if player_key.lower() in norm_name or norm_name in player_key.lower():
                    pid = ppid
                    break

        oif  = s["oif"]
        oia  = s["oia"]
        oihdf = s["oihdf"]
        oihda = s["oihda"]

        hd_cf_pct = round(oihdf / (oihdf + oihda), 4) if (oihdf + oihda) > 0 else 0.0
        cf_pct    = round(oif / (oif + oia), 4) if (oif + oia) > 0 else 0.0

        pbp_metrics = {
            "pbp_ihd_per60":    per60(s["ihd_attempts"], toi),
            "pbp_oihdf_per60":  per60(oihdf, toi),
            "pbp_oihda_per60":  per60(oihda, toi),
            "pbp_oihdcf_pct":   hd_cf_pct,
            "pbp_oicf_pct":     cf_pct,
            "pbp_oixgf_per60":  per60(s["oixgf"], toi),
            "pbp_oixga_per60":  per60(s["oixga"], toi),
            "pbp_toi_5v5":      round(toi, 1),
        }

        if pid and pid in impact:
            impact[pid].update(pbp_metrics)
            merged += 1
        else:
            # Create minimal profile with just PBP metrics
            impact[player_key] = {
                "name": player_key,
                "team": "",
                "position": "?",
                "is_forward": None,
                "games_played": 0,
                **pbp_metrics,
            }
            new += 1

    print(f"  Merged into {merged} existing profiles | {new} new PBP-only profiles")

    # ── Save updated player_impact.json ───────────────────────────────────
    with open(impact_out, "w") as f:
        json.dump(impact, f, indent=2)
    print(f"  ✓ Saved {impact_out} ({len(impact)} total profiles)")

    # Sync to public/data
    public_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "..", "public", "data", "player_impact.json")
    try:
        import shutil
        shutil.copy(impact_out, public_path)
        print(f"  ✓ Synced to public/data/player_impact.json")
    except Exception as e:
        print(f"  [WARN] public sync failed: {e}")

    print("=== calc_pbp_impact.py complete ===\n")
    return impact


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    run_pbp_impact()
