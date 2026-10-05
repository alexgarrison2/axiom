"""
game_xg_export.py — pony xG per shot, keyed by game and NHL event id, for the
/games/[id] page.

The game page builds everything else (events, shifts, boxscore) from the NHL
feeds at request time; only the xG of each unblocked attempt comes from our
model. One file per season:

    public/data/game_xg/<seasonId>.json   { "<gameId>": [[eventId, xG], ...] }

Run after the xG rescore (refresh_pipeline full mode) and once with --prev to
write the previous season.
"""
from __future__ import annotations

import os
import sys

import pandas as pd

from io_utils import atomic_write_json, keep_if_unchanged, read_json
from paths import pipeline_path, public_path
from season import PREV_START_YEAR, START_YEAR, season_file


def out_path(start_year: int) -> str:
    return public_path("game_xg", f"{start_year}{start_year + 1}.json")


def build(start_year: int) -> dict | None:
    path = pipeline_path(season_file("shots", start_year))
    if not os.path.exists(path):
        return None
    shots = pd.read_csv(path, usecols=["game_id", "event_id", "xG"]).dropna(subset=["xG"])
    out: dict[str, list] = {}
    for gid, part in shots.groupby("game_id"):
        out[str(int(gid))] = [[int(e), round(float(x), 4)] for e, x in zip(part["event_id"], part["xG"])]
    return out


def main(argv=None):
    argv = argv or []
    years = [PREV_START_YEAR] if "--prev" in argv else [START_YEAR]
    written = 0
    for y in years:
        data = build(y)
        if not data:
            print(f"  game xG {y}: no scored shots yet")
            continue
        path = out_path(y)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        data = keep_if_unchanged(read_json(path), data, keys=set())
        if atomic_write_json(path, data, min_items=1, indent=None, separators=(",", ":"), label=f"game_xg_{y}"):
            written += len(data)
            print(f"  game xG {y}-{(y + 1) % 100:02d}: {len(data)} games")
    return {"status": "ok" if written else "skip", "rows_written": written}


if __name__ == "__main__":
    main(sys.argv[1:])
