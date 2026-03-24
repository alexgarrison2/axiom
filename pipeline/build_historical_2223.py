"""
build_historical_2223.py

One-time script to add the 2022-23 NHL season to:
  - pipeline/nhl_historical_shots.csv
  - pipeline/nhl_historical_gamestats.csv

Approach:
  1. Collect all 2022-23 regular-season game IDs from raw_pbp_20222023.csv
  2. Fetch club-schedule-season for all 32 teams → build game metadata dict
     (game_date, home_id, away_id, final scores, team names/abbrevs)
  3. Sort games chronologically; iterate with rest-days tracking
  4. For each game: fetch PBP from NHL API
  5. Call aggregate_game_stats() from nhl_scraper_poc.py
  6. Append new rows to both historical CSV files

Run from the project root:
  cd /path/to/nhl-predictions-app
  python3 pipeline/build_historical_2223.py
"""

import os
import sys
import time
import pickle
import pandas as pd

# ── Path setup ─────────────────────────────────────────────────────────────────
_PIPELINE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_PIPELINE)
sys.path.insert(0, _PIPELINE)

# ── Import existing scraper utilities ──────────────────────────────────────────
from nhl_scraper_poc import (
    get_url, get_pbp, get_boxscore,
    aggregate_game_stats, calculate_shot_metrics,
    assign_bin, load_href_stats,
)

# ── Constants ──────────────────────────────────────────────────────────────────
SEASON         = "20222023"
BASE_URL       = "https://api-web.nhle.com/v1"

SHOTS_OUT      = os.path.join(_PIPELINE, "nhl_historical_shots.csv")
GAMESTATS_OUT  = os.path.join(_PIPELINE, "nhl_historical_gamestats.csv")
RAW_PBP_CSV    = os.path.join(_ROOT, "data", "historical_pbp", "raw_pbp_20222023.csv")
MODEL_FILE     = os.path.join(_PIPELINE, "xg_model_xgb.pkl")

NHL_TEAMS = [
    "ANA","BOS","BUF","CAR","CBJ","CGY","CHI","COL","DAL","DET",
    "EDM","FLA","LAK","MIN","MTL","NJD","NSH","NYI","NYR","OTT",
    "PHI","PIT","SEA","SJS","STL","TBL","TOR","UTA","VAN","VGK",
    "WSH","WPG",
]

DELAY = 0.25   # seconds between API calls

# ── Load xG model ──────────────────────────────────────────────────────────────
def load_xg_model():
    with open(MODEL_FILE, "rb") as f:
        return pickle.load(f)


# ── Step 1: Get game IDs from raw CSV ──────────────────────────────────────────
def get_game_ids():
    df = pd.read_csv(RAW_PBP_CSV, usecols=["game_id"])
    ids = df["game_id"].unique()
    # Regular season only: game_type digits [4:6] == "02"
    reg = [g for g in ids if str(g)[4:6] == "02"]
    print(f"[1] Found {len(reg)} regular-season game IDs in raw_pbp_20222023.csv")
    return sorted(reg)


# ── Step 2: Fetch game metadata from club schedules ────────────────────────────
def fetch_game_metadata(game_ids: list) -> dict:
    """
    Returns dict keyed by game_id:
      { game_date, home_id, away_id, home_name, away_name,
        home_abbrev, away_abbrev, home_score, away_score }
    """
    meta = {}
    game_id_set = set(game_ids)

    print(f"[2] Fetching 2022-23 schedule for {len(NHL_TEAMS)} teams ...")
    for team in NHL_TEAMS:
        url = f"{BASE_URL}/club-schedule-season/{team}/{SEASON}"
        data = get_url(url)
        if not data:
            print(f"  WARNING: no schedule for {team}")
            time.sleep(DELAY)
            continue

        for g in data.get("games", []):
            gid = g.get("id")
            if gid not in game_id_set:
                continue
            if gid in meta:
                continue   # already processed

            ht = g.get("homeTeam", {})
            at = g.get("awayTeam", {})
            meta[gid] = {
                "game_date":   g.get("gameDate"),
                "home_id":     ht.get("id"),
                "away_id":     at.get("id"),
                "home_name":   ht.get("commonName", {}).get("default", "Home"),
                "away_name":   at.get("commonName", {}).get("default", "Away"),
                "home_abbrev": ht.get("abbrev", "HOM"),
                "away_abbrev": at.get("abbrev", "AWY"),
                "home_score":  ht.get("score", 0),
                "away_score":  at.get("score", 0),
            }

        time.sleep(DELAY)
        print(f"  {team}: {len(meta)} games accumulated so far")

    missing = [g for g in game_ids if g not in meta]
    if missing:
        print(f"  [!] {len(missing)} games not found in club schedules; fetching boxscores ...")
        for gid in missing:
            bs = get_boxscore(gid)
            if bs:
                ht = bs.get("homeTeam", {})
                at = bs.get("awayTeam", {})
                meta[gid] = {
                    "game_date":   bs.get("gameDate"),
                    "home_id":     ht.get("id"),
                    "away_id":     at.get("id"),
                    "home_name":   ht.get("commonName", {}).get("default", "Home"),
                    "away_name":   at.get("commonName", {}).get("default", "Away"),
                    "home_abbrev": ht.get("abbrev", "HOM"),
                    "away_abbrev": at.get("abbrev", "AWY"),
                    "home_score":  ht.get("score", 0),
                    "away_score":  at.get("score", 0),
                }
            time.sleep(DELAY)

    print(f"  → Metadata for {len(meta)}/{len(game_ids)} games")
    return meta


# ── Step 3: Build rest metrics ─────────────────────────────────────────────────
def build_rest_metrics(team_id, game_date_str, history_set):
    """Mirrors the scraper's calculate_rest() logic."""
    from datetime import datetime, timedelta
    game_date = datetime.strptime(game_date_str, "%Y-%m-%d").date()

    prev_dates = sorted(
        [d for d in history_set if d < game_date], reverse=True
    )

    if not prev_dates:
        return {"is_b2b": 0, "is_3in4": 0, "is_4in6": 0, "is_6in9": 0}

    days_since_last = (game_date - prev_dates[0]).days

    def count_in_window(days):
        cutoff = game_date - timedelta(days=days)
        return sum(1 for d in prev_dates if d >= cutoff)

    is_b2b  = 1 if days_since_last == 1 else 0
    is_3in4 = 1 if count_in_window(3) >= 2 else 0
    is_4in6 = 1 if count_in_window(5) >= 3 else 0
    is_6in9 = 1 if count_in_window(8) >= 5 else 0

    return {"is_b2b": is_b2b, "is_3in4": is_3in4, "is_4in6": is_4in6, "is_6in9": is_6in9}


# ── Step 4 & 5: Process games ─────────────────────────────────────────────────
def process_games(game_ids, meta, xg_model):
    from datetime import datetime

    # Sort by date then game_id for determinism
    ordered = sorted(
        [g for g in game_ids if g in meta],
        key=lambda g: (meta[g]["game_date"] or "2000-01-01", g)
    )

    team_game_dates   = {}   # team_id → set of date objects played so far
    team_game_numbers = {}   # team_id → count of games played

    all_gamestats = []
    all_shots     = []

    print(f"\n[3] Processing {len(ordered)} games ...")
    for idx, gid in enumerate(ordered):
        m = meta[gid]
        date_str  = m["game_date"]
        home_id   = m["home_id"]
        away_id   = m["away_id"]

        # Rest metrics
        for tid in (home_id, away_id):
            if tid not in team_game_dates:
                team_game_dates[tid]   = set()
                team_game_numbers[tid] = 0

        home_rest = build_rest_metrics(home_id, date_str, team_game_dates[home_id])
        away_rest = build_rest_metrics(away_id, date_str, team_game_dates[away_id])

        # Fetch PBP
        pbp = get_pbp(gid)
        time.sleep(DELAY)

        if not pbp:
            print(f"  [{idx+1}/{len(ordered)}] {gid} SKIP (no PBP)")
            continue

        # Build game_info the same way as in the live scraper
        # Use PBP for plays + inject final scores from metadata
        pbp["homeTeam"]["score"] = m["home_score"]
        pbp["awayTeam"]["score"] = m["away_score"]

        # Game numbers (before increment)
        team_game_numbers[home_id] += 1
        team_game_numbers[away_id] += 1
        home_num = team_game_numbers[home_id]
        away_num = team_game_numbers[away_id]

        try:
            game_rows, shot_rows = aggregate_game_stats(
                pbp, pbp, date_str, xg_model, home_rest, away_rest
            )
        except Exception as e:
            print(f"  [{idx+1}] {gid} ERROR: {e}")
            # Still update history
            from datetime import date as date_cls
            d = datetime.strptime(date_str, "%Y-%m-%d").date()
            team_game_dates[home_id].add(d)
            team_game_dates[away_id].add(d)
            continue

        # Inject game numbers
        for row in game_rows:
            if row.get("home_away") == "Home":
                row["team_game_number"]     = home_num
                row["opponent_game_number"] = away_num
            else:
                row["team_game_number"]     = away_num
                row["opponent_game_number"] = home_num

        all_gamestats.extend(game_rows)
        all_shots.extend(shot_rows)

        # Update history
        from datetime import date as date_cls
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
        team_game_dates[home_id].add(d)
        team_game_dates[away_id].add(d)

        if (idx + 1) % 50 == 0:
            print(f"  [{idx+1}/{len(ordered)}] processed — "
                  f"{len(all_gamestats)} stat rows, {len(all_shots)} shots so far")

    print(f"\n  Done: {len(all_gamestats)} gamestats rows, {len(all_shots)} shot rows")
    return all_gamestats, all_shots


# ── Step 6: Append to flurry-adjusted shots + gamestats ───────────────────────
def apply_flurry_adjustment(shots_df: pd.DataFrame) -> pd.DataFrame:
    """
    Discount xG for 2nd/3rd shots within 3 seconds (flurry adjustment).
    Mirrors the logic in the main pipeline.
    """
    shots_df = shots_df.sort_values(["game_id", "time_seconds"]).copy()
    shots_df["xG_flurry_adj"] = shots_df["xG"]

    for _, grp in shots_df.groupby("game_id"):
        idxs = grp.index.tolist()
        for i in range(1, len(idxs)):
            cur  = shots_df.loc[idxs[i]]
            prev = shots_df.loc[idxs[i - 1]]
            if cur["time_seconds"] - prev["time_seconds"] <= 3:
                shots_df.loc[idxs[i], "xG_flurry_adj"] *= 0.5

    return shots_df


def append_to_csv(new_rows: list, filepath: str, label: str):
    if not new_rows:
        print(f"  No {label} rows to append.")
        return

    new_df = pd.DataFrame(new_rows)

    if os.path.exists(filepath):
        existing = pd.read_csv(filepath)
        # Drop any 2022-23 rows that might already be there
        if "game_id" in existing.columns:
            existing = existing[
                existing["game_id"].astype(str).str[:4] != "2022"
            ]
        combined = pd.concat([existing, new_df], ignore_index=True)
    else:
        combined = new_df

    combined.to_csv(filepath, index=False)
    print(f"  Saved {len(combined)} total rows → {filepath}")
    print(f"  (Added {len(new_df)} new 2022-23 rows)")


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("  build_historical_2223.py — Adding 2022-23 season data")
    print("=" * 60)

    # 0. Load href stats if available (PP/PK accuracy improvement)
    os.chdir(_PIPELINE)
    load_href_stats()

    # 1. Load xG model
    print(f"\n[0] Loading xG model from {MODEL_FILE} ...")
    xg_model = load_xg_model()

    # 1. Game IDs
    game_ids = get_game_ids()

    # 2. Metadata
    meta = fetch_game_metadata(game_ids)

    # 3-5. Process
    gamestats_rows, shot_rows = process_games(game_ids, meta, xg_model)

    # 6a. Append gamestats
    print(f"\n[4] Writing gamestats ...")
    append_to_csv(gamestats_rows, GAMESTATS_OUT, "gamestats")

    # 6b. Apply flurry adjustment + append shots
    print(f"\n[5] Applying flurry adjustment and writing shots ...")
    if shot_rows:
        shots_df = pd.DataFrame(shot_rows)
        shots_df = apply_flurry_adjustment(shots_df)
        shot_dicts = shots_df.to_dict("records")
        append_to_csv(shot_dicts, SHOTS_OUT, "shots")
    else:
        print("  No shot rows generated.")

    print("\n✓ Done. Next step: retrain game_model.pkl")
    print("  cd pipeline && python3 train_game_model.py")


if __name__ == "__main__":
    main()
