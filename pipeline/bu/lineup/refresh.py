"""Daily refresh of the RAPM v2 serving bundle (DESIGN §5.2; CI: .github/workflows/bu_refresh.yml).

CI has no historical lake.  It keeps only the current season's partition in a runner-local
lake directory (restored from / saved to the ``lake-<season>`` release asset, never committed)
and refits the season from the committed season pack:

  1. ``python -m bu.lake.backfill --seasons <Y> --endpoints pbp,boxscore,shifts``
     gap-driven: only final games missing from the lake are fetched (<= 2 rps per host)
  2. ``python -m bu.rapm asof --seasons <Y> --seed <pack> --xg v2``
     the season refit from the pack's chain, with the live xG v2 artifacts as target
  3. ``python -m bu.lineup serve --season <S> --seed <pack>``
     the bundle: pack + this season's games + current ratings + DFO-name crosswalk + the FIN
     table (committed ``fin_pack_<S>.json.gz`` + this season's games, ``bu_d_fin``)
  4. publish ``bu/lineup/out/serving_bundle.json.gz`` when its content changed or the
     committed copy is older than ``REPUBLISH_H`` (so ``built_at`` never ages past the
     36 h serving limit while the content is unchanged, e.g. over a break)
  5. export the site's player ratings ``public/data/player_ratings.json``
     (``bu.lineup.ratings_export``; rewritten only when its content changed)

Run from ``pipeline/``:

  python -m bu.lineup.refresh --lake-dir $RUNNER_TEMP/lake            # CI
  python -m bu.lineup.refresh --lake-dir /tmp/lake --dry-run          # local: no publish

Every step runs as a subprocess with a timeout; the first failure stops the refresh and
leaves the committed bundle untouched (the live term then goes neutral once the bundle is
older than 36 h: ``LiveLineupTerm``).  Exit 0 on success (published or unchanged), 1 on a
failed step.  A JSON summary is printed on the last line and written to
``<lake>/state/rapm/lineup/refresh_last.json``.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE_DIR = os.path.dirname(os.path.dirname(HERE))
OUT_DIR = os.path.join(HERE, "out")
BUNDLE = os.path.join(OUT_DIR, "serving_bundle.json.gz")
REPUBLISH_H = 12.0
STEP_TIMEOUT_S = {"backfill": 15 * 60, "asof": 10 * 60, "serve": 10 * 60}
VOLATILE = ("built_at", "dfo_coverage")   # bundle keys that change without new information


def _season():
    if PIPELINE_DIR not in sys.path:
        sys.path.insert(0, PIPELINE_DIR)
    from season import SEASON_ID, START_YEAR
    return str(SEASON_ID), int(START_YEAR)


def _read(path):
    with gzip.open(path, "rt") as f:
        return json.load(f)


def _content(b: dict) -> dict:
    return {k: v for k, v in b.items() if k not in VOLATILE}


def _age_h(b: dict, now=None) -> float:
    now = now or datetime.now(timezone.utc)
    return (now - datetime.fromisoformat(b["built_at"])).total_seconds() / 3600.0


def decide_publish(new: dict, old: dict | None, now=None, republish_h: float = REPUBLISH_H) -> tuple[bool, str]:
    """(publish?, why).  Publish when there is no committed bundle, its season differs, its
    content changed, or it is older than ``republish_h`` hours."""
    if old is None:
        return True, "no committed bundle"
    if str(old.get("season")) != str(new.get("season")):
        return True, f"season {old.get('season')} -> {new.get('season')}"
    if _content(new) != _content(old):
        return True, (f"content changed: games {old.get('n_games')} -> {new.get('n_games')}, max_source_date "
                      f"{old.get('max_source_date')} -> {new.get('max_source_date')}")
    age = _age_h(old, now)
    if age > republish_h:
        return True, f"unchanged content, committed bundle {age:.1f} h old (> {republish_h:.0f} h)"
    return False, f"unchanged content, committed bundle {age:.1f} h old"


def _log(msg):
    print(msg, flush=True)


def _run(name, cmd, timeout, log=_log) -> dict:
    t = time.time()
    log(f"[bu-refresh] {name}: {' '.join(cmd)}")
    try:
        p = subprocess.run(cmd, cwd=PIPELINE_DIR, timeout=timeout, text=True,
                           stdout=sys.stdout, stderr=sys.stderr)
        ok = p.returncode == 0
        return {"step": name, "ok": ok, "returncode": p.returncode, "seconds": round(time.time() - t, 1)}
    except subprocess.TimeoutExpired:
        return {"step": name, "ok": False, "returncode": None, "seconds": round(time.time() - t, 1),
                "error": f"timeout after {timeout}s"}


def refresh(lake_dir: str, season: str | None = None, publish: bool = True, xg: str = "v2",
            endpoints: str = "pbp,boxscore,shifts", skip_backfill: bool = False, log=_log) -> dict:
    sid, start_year = _season()
    season = str(season or sid)
    year = int(season[:4])
    pack = os.path.join(OUT_DIR, f"season_pack_{season}.json.gz")
    state = os.path.join(os.path.abspath(lake_dir), "state", "rapm")
    py = sys.executable
    summary = {"season": season, "lake_dir": os.path.abspath(lake_dir), "pack": os.path.relpath(pack, PIPELINE_DIR),
               "xg": xg, "steps": [], "published": False,
               "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    if not os.path.exists(pack):
        summary["error"] = f"no season pack {pack} (python -m bu.lineup pack --season {season}, from the full lake)"
        return summary
    steps = []
    if not skip_backfill:
        steps.append(("backfill", [py, "-m", "bu.lake.backfill", "--seasons", str(year), "--lake-dir", lake_dir,
                                   "--endpoints", endpoints, "--no-dq"]))
    steps += [
        ("asof", [py, "-m", "bu.rapm", "asof", "--lake-dir", lake_dir, "--out", state, "--seasons", str(year),
                  "--seed", pack, "--xg", xg]),
        ("serve", [py, "-m", "bu.lineup", "serve", "--lake-dir", lake_dir, "--out", state, "--season", season,
                   "--seed", pack]),
    ]
    for name, cmd in steps:
        r = _run(name, cmd, STEP_TIMEOUT_S[name], log)
        summary["steps"].append(r)
        if not r["ok"]:
            summary["error"] = f"step {name} failed"
            return _finish(summary, state, log)
    built = os.path.join(state, "lineup", "serving_bundle.json.gz")
    new = _read(built)
    old = _read(BUNDLE) if os.path.exists(BUNDLE) else None
    do, why = decide_publish(new, old)
    summary.update({"n_games": new.get("n_games"), "max_source_date": new.get("max_source_date"),
                    "built_at": new.get("built_at"), "players": len(new["players"]["rows"]),
                    "crosswalk_rows": len((new.get("crosswalk") or {}).get("rows") or []),
                    "fin_rows": len((new.get("fin") or {}).get("rows") or []),
                    "decision": why})
    if not summary["fin_rows"]:
        log(f"[bu-refresh] WARNING: no FIN table (no out/fin_pack_{season}.json.gz?): a model with bu_d_fin "
            "is served by its no-FIN rollback (shadow.rapm)")
    if do and publish:
        os.makedirs(OUT_DIR, exist_ok=True)
        tmp = BUNDLE + ".tmp"
        shutil.copyfile(built, tmp)
        os.replace(tmp, BUNDLE)
        summary["published"] = True
    log(f"[bu-refresh] {'published' if summary['published'] else 'not published'}: {why}")
    if publish:
        summary["player_ratings"] = export_ratings(BUNDLE, state, log)
    return _finish(summary, state, log)


def export_ratings(bundle_path, state, log=_log, out_path=None) -> dict:
    """5. ``public/data/player_ratings.json`` from the committed bundle, this run's rosters
    (crosswalk parquet) and stints.  Never fails the refresh: the bundle is the product, and
    ``validate_outputs.py player_ratings`` flags a missing or stale file."""
    from . import ratings_export as RE
    try:
        return RE.export(bundle_path, out_path or RE.PUBLIC_FILE, state_root=state, fetch_rosters=True, log=log)
    except Exception as e:  # noqa: BLE001
        log(f"[bu-refresh] player ratings export failed: {type(e).__name__}: {e}")
        return {"error": f"{type(e).__name__}: {e}"}


def _finish(summary, state, log):
    summary["finished_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        os.makedirs(os.path.join(state, "lineup"), exist_ok=True)
        with open(os.path.join(state, "lineup", "refresh_last.json"), "w") as f:
            json.dump(summary, f, indent=1)
    except OSError as e:
        log(f"[bu-refresh] could not write the summary: {e}")
    return summary


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bu.lineup.refresh", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lake-dir", required=True, help="runner-local lake (current season only; never committed)")
    ap.add_argument("--season", default=None, help="season id (default season.SEASON_ID)")
    ap.add_argument("--xg", default="v2", help="RAPM target for the season refit (default: live xG v2 artifacts)")
    ap.add_argument("--endpoints", default="pbp,boxscore,shifts")
    ap.add_argument("--skip-backfill", action="store_true", help="use the lake as it is (no network)")
    ap.add_argument("--dry-run", action="store_true", help="build the bundle but never publish it")
    a = ap.parse_args(argv)
    s = refresh(a.lake_dir, a.season, publish=not a.dry_run, xg=a.xg, endpoints=a.endpoints,
                skip_backfill=a.skip_backfill)
    print(json.dumps(s, default=str))
    return 1 if s.get("error") else 0


if __name__ == "__main__":
    sys.exit(main())
