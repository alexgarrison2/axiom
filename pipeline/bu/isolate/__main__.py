"""CLI (run from ``pipeline/``):

    python -m bu.isolate refresh                     # current season: lake update + build (the routine run)
    python -m bu.isolate build --season 20252026     # any season the local lake covers (window S-2..S)
    python -m bu.isolate validate                    # tuning, repeatability, agreement -> bu/isolate/out/
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time

from bu.lake.paths import Lake

from . import export, validate


def _build(lake: Lake, seasons, out: str, asof=None) -> None:
    for s in seasons:
        t = time.time()
        res = export.build(lake, s, out, asof=asof)
        res["seconds"] = round(time.time() - t, 1)
        print(json.dumps(res))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="bu.isolate")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("refresh", help="incremental lake update of the current season, then build it")
    r.add_argument("--lake-dir", default=None)
    r.add_argument("--out", default=export.OUT_DIR)
    r.add_argument("--skip-backfill", action="store_true", help="use the lake as it is (no network)")
    b = sub.add_parser("build", help="write public/data/isolate/<season>.json")
    b.add_argument("--season", action="append", required=True, help="e.g. 20262027 (repeatable)")
    b.add_argument("--lake-dir", default=None)
    b.add_argument("--out", default=export.OUT_DIR)
    b.add_argument("--asof", default=None, help="recency anchor date (default: the window's last game)")
    v = sub.add_parser("validate", help="tuning, repeatability and agreement -> bu/isolate/out/")
    v.add_argument("--lake-dir", default=None)
    a = ap.parse_args(argv)
    lake = Lake(a.lake_dir)
    if a.cmd == "refresh":
        from season import SEASON_ID, START_YEAR
        if not a.skip_backfill:
            subprocess.run([sys.executable, "-m", "bu.lake.backfill", "--seasons", str(START_YEAR),
                            "--endpoints", "pbp,boxscore,shifts,roster", "--lake-dir", lake.root], check=True)
        _build(lake, [SEASON_ID], a.out)
    elif a.cmd == "build":
        _build(lake, a.season, a.out, a.asof)
    else:
        rep = validate.run(lake)
        print(json.dumps(rep, indent=1, default=float))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
