"""Season rollover: fold the finished season's gamestats and shots into the
nhl_historical_* files so everything that reads "historical + current"
(team/goalie priors, shooting talent, xG re-scoring and training) keeps
last season once season.py points at the new season.

The season file is authoritative: any rows for that season already in the
historical file (e.g. a partial mid-season snapshot) are replaced.

Usage (from pipeline/): python archive_season.py [start_year]
Defaults to the previous season. Safe to re-run.
"""
import os
import sys

import pandas as pd

from season import PREV_START_YEAR, season_file, season_of_game_id

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))


def archive(kind, start_year):
    src = os.path.join(PIPELINE_DIR, season_file(kind, start_year))
    dst = os.path.join(PIPELINE_DIR, f"nhl_historical_{kind}.csv")
    season_df = pd.read_csv(src, low_memory=False)
    season_df = season_df[season_df["game_id"].map(season_of_game_id) == start_year]
    hist_df = pd.read_csv(dst, low_memory=False)

    kept = hist_df[hist_df["game_id"].map(season_of_game_id) != start_year]
    combined = pd.concat([kept, season_df], ignore_index=True)
    # Union of columns: older seasons get NaN for columns added later.
    combined.to_csv(dst, index=False)
    print(f"{kind}: replaced {len(hist_df) - len(kept)} rows with {len(season_df)} "
          f"from {os.path.basename(src)} -> {len(combined)} rows")


if __name__ == "__main__":
    year = int(sys.argv[1]) if len(sys.argv) > 1 else PREV_START_YEAR
    for kind in ("gamestats", "shots"):
        archive(kind, year)
