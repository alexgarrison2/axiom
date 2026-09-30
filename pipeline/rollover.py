"""rollover.py - put every season-scoped output on the new season.

    python3 rollover.py              # full rollover (network: standings, schedule, goalie lines)
    python3 rollover.py --no-sim     # skip the Monte Carlo projection

refresh_pipeline.stage_rollover runs this once per season (when
manifest.rollover_season_id != season.SEASON_ID).  It is idempotent and
never deletes history: last season's files stay in pipeline/ as the archive
(nhl_season_<prev>_*) and are folded into nhl_historical_*.csv by
tools/archive_season.py.

Steps
-----
1. gamestats: create a header-only pipeline/nhl_season_<new>_gamestats.csv
   if nothing has been scraped yet, and point the data/ and public/data/
   gamestats.csv mirrors at it (they must not keep serving last season).
2. clinch_status.json -> {season_id, generated_at, teams: {}} (filled by
   fetch_clinch_status.py from this season's standings).
3. goalie season lines: refetch (cur = new season, prev = last season); if
   the API is down, last season's lines become ``prev`` and ``cur`` is empty.
4. season_simulator: projections for the full new schedule from the game
   model's regressed preseason priors; writes season_id / generated_at and
   the first daily snapshot of season_projections_history.json.
5. game_implications.json -> empty document for the new season (the old
   one paired last season's final table with new-season scenarios).
Any failed step raises at the end so the stage is retried next run.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from season import SEASON_ID, PREV_SEASON_ID, START_YEAR, season_file  # noqa: E402

REPO_ROOT = os.path.dirname(SCRIPT_DIR)
PUBLIC_DATA = os.path.join(REPO_ROOT, "public", "data")
MIRRORS = (os.path.join(PUBLIC_DATA, "gamestats.csv"), os.path.join(REPO_ROOT, "data", "gamestats.csv"))


def _write_json(path, data, indent=2):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=indent)
    os.replace(tmp, path)


def _header_of(path):
    try:
        with open(path, newline="", encoding="utf-8") as f:
            return next(csv.reader(f), None)
    except OSError:
        return None


def roll_gamestats(start_year=START_YEAR, pipeline_dir=SCRIPT_DIR, mirrors=MIRRORS):
    """Header-only current-season file (if missing) and mirrors of it."""
    cur = os.path.join(pipeline_dir, season_file("gamestats", start_year))
    created = False
    if not os.path.exists(cur):
        header = _header_of(os.path.join(pipeline_dir, season_file("gamestats", start_year - 1)))
        if not header:
            raise RuntimeError("no previous-season gamestats header to seed the new season file")
        with open(cur, "w", newline="", encoding="utf-8") as f:
            csv.writer(f).writerow(header)
        created = True
    with open(cur, encoding="utf-8") as f:
        text = f.read()
    changed = 0
    for dst in mirrors:
        try:
            with open(dst, encoding="utf-8") as f:
                if f.read() == text:
                    continue
        except OSError:
            pass
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst + ".tmp", "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(dst + ".tmp", dst)
        changed += 1
    return {"created_season_file": created, "mirrors_rewritten": changed}


def roll_clinch(path=os.path.join(PUBLIC_DATA, "clinch_status.json")):
    from io_utils import utc_now_iso
    try:
        with open(path) as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    if isinstance(old, dict) and old.get("season_id") == SEASON_ID:
        return {"reset": False}
    _write_json(path, {"season_id": SEASON_ID, "generated_at": utc_now_iso(), "teams": {}})
    return {"reset": True}


def roll_goalie_lines():
    import fetch_nhl_goalie_stats as G
    res = G.fetch_nhl_goalie_stats()
    if isinstance(res, dict) and res.get("status") == "ok":
        return {"refetched": True}
    # Offline fallback: last season's current lines become 'prev'.
    from io_utils import utc_now_iso
    try:
        with open(G.LINES_FILE) as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    if old.get("season_id") != SEASON_ID:
        goalies = {n: {"cur": None, "prev": v.get("cur")} for n, v in (old.get("goalies") or {}).items()
                   if old.get("season_id") == PREV_SEASON_ID and v.get("cur")}
        _write_json(G.LINES_FILE, {"season_id": SEASON_ID, "prev_season_id": PREV_SEASON_ID,
                                   "generated_at": utc_now_iso(), "goalies": goalies}, indent=1)
    _write_json(G.LEGACY_FILE, {}, indent=4)
    return {"refetched": False, "reason": (res or {}).get("reason")}


def roll_implications(path=os.path.join(PUBLIC_DATA, "game_implications.json")):
    from io_utils import utc_now_iso
    try:
        with open(path) as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    if isinstance(old, dict) and old.get("season_id") == SEASON_ID:
        return {"reset": False}
    import game_implications as GI
    GI._write_output({"season_id": SEASON_ID, "generated_at": utc_now_iso(), "baseline_generated_at": None,
                      "n_sims": 0, "min_swing_pts": GI.MIN_SWING_PTS, "max_swing_pts": None,
                      "reason": f"season rollover to {SEASON_ID}", "games": []})
    return {"reset": True}


def run(old_season_id=None, new_season_id=SEASON_ID, simulate=True, n_sims=None):
    if str(new_season_id) != SEASON_ID:
        raise ValueError(f"rollover target {new_season_id} != season.SEASON_ID {SEASON_ID}")
    print(f"=== Season rollover {old_season_id or '?'} -> {SEASON_ID} ===")
    done, failed = {}, []
    steps = [("gamestats", roll_gamestats), ("clinch_status", roll_clinch),
             ("goalie_lines", roll_goalie_lines)]
    if simulate:
        import season_simulator as SS
        steps.append(("season_simulator",
                      lambda: SS.full_simulation_loop(**({"n_sims": n_sims} if n_sims else {}))))
    steps.append(("game_implications", roll_implications))
    for name, fn in steps:
        try:
            done[name] = fn()
            print(f"  [rollover] {name}: {done[name]}")
        except Exception as e:  # keep going; report at the end
            failed.append(f"{name}: {type(e).__name__}: {e}")
            print(f"  [rollover] {name} FAILED: {e}")
    if failed:
        raise RuntimeError("rollover incomplete - " + "; ".join(failed))
    return {"status": "ok", "rows_written": len(done), "reason": f"rolled over to {SEASON_ID}"}


main = run


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-sim", action="store_true")
    ap.add_argument("--sims", type=int, default=None)
    a = ap.parse_args()
    print(run(simulate=not a.no_sim, n_sims=a.sims))
