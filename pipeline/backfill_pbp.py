"""
backfill_pbp.py
---------------
One-time (and safe-to-rerun) backfill of raw PBP events for all games that are
present in the gamestats CSV but missing from the PBP CSV.

Run from the pipeline/ directory:
    python backfill_pbp.py

After this script completes, run:
    python enrich_pbp.py          # adds home_on1-6 / away_on1-6 from shifts
    python calc_pbp_impact.py     # regenerates pbp_metrics.json
"""

from season import season_file
import os
import sys
import time
import pandas as pd

# Ensure we're in the pipeline directory
os.chdir(os.path.dirname(os.path.abspath(__file__)))

from nhl_scraper_poc import get_pbp, extract_pbp_rows

GAMESTATS_FILE = season_file("gamestats")
PBP_FILE       = season_file("pbp")
RATE_LIMIT_SEC = 0.4   # seconds between NHL API calls


def main():
    print(f"=== backfill_pbp.py ===")

    # ── Determine missing game_ids ───────────────────────────────────────────
    gs = pd.read_csv(GAMESTATS_FILE)
    gs["game_date"] = pd.to_datetime(gs["game_date"])
    all_game_ids = set(gs["game_id"].unique())

    if os.path.exists(PBP_FILE):
        pbp_existing = pd.read_csv(PBP_FILE, usecols=["game_id"], low_memory=False)
        existing_ids = set(pbp_existing["game_id"].unique())
    else:
        existing_ids = set()

    missing_ids = sorted(all_game_ids - existing_ids)
    print(f"  Total games in gamestats : {len(all_game_ids)}")
    print(f"  Games already in PBP     : {len(existing_ids)}")
    print(f"  Games to backfill        : {len(missing_ids)}")

    if not missing_ids:
        print("  ✓ PBP already complete — nothing to backfill.")
        return

    # Build game_id → game_date lookup for the game_info dict we assemble
    gid_to_date = dict(zip(gs["game_id"].astype(int), gs["game_date"].dt.strftime("%Y-%m-%d")))

    # ── Fetch and write in batches ───────────────────────────────────────────
    BATCH = 100
    total_rows_added = 0

    for batch_start in range(0, len(missing_ids), BATCH):
        batch = missing_ids[batch_start: batch_start + BATCH]
        batch_rows = []

        for i, gid in enumerate(batch, 1):
            global_i = batch_start + i
            print(f"  [{global_i}/{len(missing_ids)}] Fetching PBP for game {gid}...", end="", flush=True)
            try:
                pbp_json = get_pbp(gid)
                if not pbp_json:
                    print(" no data — skip")
                    continue

                # Build a minimal game_info from the PBP JSON itself
                # (The play-by-play endpoint includes homeTeam / awayTeam)
                game_info = {
                    "id":       gid,
                    "gameType": pbp_json.get("gameType", 2),
                    "homeTeam": pbp_json.get("homeTeam", {}),
                    "awayTeam": pbp_json.get("awayTeam", {}),
                }
                game_date = gid_to_date.get(int(gid), "")

                rows = extract_pbp_rows(pbp_json, game_info, game_date)
                batch_rows.extend(rows)
                print(f" {len(rows)//2} events")

            except Exception as e:
                print(f" ERROR: {e}")

            time.sleep(RATE_LIMIT_SEC)

        # Append this batch to the PBP file
        if batch_rows:
            new_df = pd.DataFrame(batch_rows)
            if os.path.exists(PBP_FILE):
                try:
                    existing_df = pd.read_csv(PBP_FILE, low_memory=False)
                    combined = pd.concat([existing_df, new_df], ignore_index=True)
                    combined.drop_duplicates(
                        subset=["game_id", "event_id", "is_home_team"], keep="last", inplace=True
                    )
                    combined.to_csv(PBP_FILE, index=False)
                except Exception as e:
                    print(f"  [WARN] Merge failed ({e}) — appending raw.")
                    new_df.to_csv(PBP_FILE, mode="a", header=False, index=False)
            else:
                new_df.to_csv(PBP_FILE, index=False)

            total_rows_added += len(batch_rows)
            print(f"  Batch {batch_start//BATCH + 1} written. Cumulative rows added: {total_rows_added}")

    print(f"\n✓ Backfill complete. {total_rows_added} rows written across {len(missing_ids)} games.")
    print("  Next steps:")
    print("    python enrich_pbp.py       # add on-ice player IDs from shifts")
    print("    python calc_pbp_impact.py  # regenerate pbp_metrics.json")


if __name__ == "__main__":
    main()
