"""CLI for the lineup term (run from ``pipeline/`` after ``python -m bu.rapm asof``).

  python -m bu.lineup features [--seasons 2018-2025]   # point-in-time feature table
  python -m bu.lineup evaluate [--holdout]             # Δ log loss inside the incumbent
  python -m bu.lineup all [--holdout]
  python -m bu.lineup crosswalk [--season 20262027]    # NHL-id crosswalk + DFO lineup coverage

Outputs: ``<out>/lineup/lineup_features.parquet`` (state) and, committed,
``pipeline/bu/lineup/out/lineup_features.csv.gz``, ``toi_validation.json``,
``lineup_eval.json`` and the holdout ``look_log.jsonl``.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

import pandas as pd

from bu.lake.paths import Lake
from bu.rapm.__main__ import _season_ids
from bu.rapm.paths import RapmPaths
from bu.rapm.engine import DEGRADE_ENV
from .evaluate import OUT_DIR

CODE_VERSION = "m2-r2"


def _feature_meta(paths) -> dict:
    p = paths.report("asof_summary.json")
    s = json.load(open(p)) if os.path.exists(p) else {}
    # code_version: "m2-r1" = the build that took the single 2025-26 look (look_log.jsonl,
    # config b89386dcfb31); "m2-r2" = review fixes (aging step indexed by last season's age).
    return {"code_version": CODE_VERSION,
            "hyper": s.get("hyper"), "lag_days": s.get("lag_days"), "xg_source": s.get("xg_source"),
            "lineups": "L-actual", "toi": "ewma-hl8-m2", "baseline_games": 10, "min_rated": 14,
            "degrade": os.environ.get(DEGRADE_ENV) or None}


def cmd_features(args, paths, seasons) -> pd.DataFrame:
    from .features import build
    F = build(paths, seasons)
    p = os.path.join(paths.root, "lineup", "lineup_features.parquet")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    F.to_parquet(p, index=False)
    print(f"  [lineup] wrote {p}")
    if os.environ.get(DEGRADE_ENV):
        return F          # sensitivity run: state only, the committed table stays the base case
    os.makedirs(OUT_DIR, exist_ok=True)
    keep = [c for c in F.columns if c not in ("home_abbrev", "away_abbrev")] + ["home_abbrev", "away_abbrev"]
    F[keep].to_csv(os.path.join(OUT_DIR, "lineup_features.csv.gz"), index=False, float_format="%.6g")
    with open(os.path.join(OUT_DIR, "toi_validation.json"), "w") as f:
        json.dump(F.attrs.get("toi_validation", {}), f, indent=2)
    meta = _feature_meta(paths)
    meta["sha256_csv"] = hashlib.sha256(open(os.path.join(OUT_DIR, "lineup_features.csv.gz"), "rb").read()).hexdigest()
    with open(os.path.join(OUT_DIR, "lineup_features.meta.json"), "w") as f:
        json.dump({**meta, "seasons": seasons, "n_games": int(len(F)), "coverage_ok": float(F["bu_ok"].mean())},
                  f, indent=2)
    return F


def cmd_evaluate(args, paths) -> dict:
    import train_game_model as T
    from .evaluate import run
    p = os.path.join(paths.root, "lineup", "lineup_features.parquet")
    feats = pd.read_parquet(p)
    if args.matrix and os.path.exists(args.matrix):
        M = pd.read_pickle(args.matrix)
    else:
        M, _ = T.build_matrix()
        if args.matrix:
            M.to_pickle(args.matrix)
    degraded = bool(os.environ.get(DEGRADE_ENV))
    if degraded and args.holdout:
        raise SystemExit("the holdout look is taken on the base case only")
    rep = run(M, feats, _feature_meta(paths), holdout=args.holdout)
    out = os.path.join(OUT_DIR, "lineup_eval_degraded.json" if degraded else "lineup_eval.json")
    with open(out, "w") as f:
        json.dump(rep, f, indent=2, default=float)
    print(f"  [lineup] candidate {rep['candidate']}; report {out}")
    if "holdout" in rep:
        print(f"  [lineup] holdout: {json.dumps(rep['holdout'], default=float)[:400]}")
    return rep


def cmd_crosswalk(args, paths, lake_seasons) -> dict:
    """Build the season's NHL-id crosswalk and report DFO lineup coverage (DESIGN §3.7)."""
    from . import crosswalk as X
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    from season import SEASON_ID
    season = str(args.season or SEASON_ID)
    with open(args.dfo) as f:
        dfo = json.load(f)
    teams = [k for k, v in dfo.items() if isinstance(v, dict)]
    cw = X.build(paths, season, teams, lake_seasons=lake_seasons[-1:])
    cov = X.coverage(X.Resolver(cw), dfo, teams)
    cov.update({"season": season, "dfo_file": os.path.relpath(args.dfo), "crosswalk_rows": int(len(cw)),
                "lake_seasons": lake_seasons[-1:]})
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "crosswalk_coverage.json"), "w") as f:
        json.dump(cov, f, indent=2, default=str)
    bad = {t: v["unmapped"] for t, v in cov["per_team"].items() if v["unmapped"]}
    print(f"  [crosswalk] {season}: {len(cw):,} rows; teams >= {X.MIN_MAPPED}/18 mapped: "
          f"{cov['share_ok']:.0%} of {cov['teams']}; unmapped: {bad or 'none'}")
    return cov


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bu.lineup", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["features", "evaluate", "all", "crosswalk"])
    ap.add_argument("--season", default=None, help="crosswalk: season id (default season.SEASON_ID)")
    ap.add_argument("--dfo", default=os.path.join("..", "public", "data", "team_lineups.json"),
                    help="crosswalk: DailyFaceoff team_lineups.json")
    ap.add_argument("--lake-dir", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--seasons", default=None)
    ap.add_argument("--matrix", default=None, help="cache path for the incumbent training matrix (pickle)")
    ap.add_argument("--holdout", action="store_true", help="take the single 2025-26 soft-holdout look")
    ap.add_argument("--degrade", default=None, help="e.g. 0.35:2 (DESIGN §4.3 sensitivity; needs its own --out)")
    args = ap.parse_args(argv)
    if args.degrade:
        if not args.out:
            raise SystemExit("--degrade needs a separate --out state dir")
        os.environ[DEGRADE_ENV] = args.degrade
    lake = Lake(args.lake_dir)
    paths = RapmPaths(lake, args.out)
    seasons = _season_ids(args.seasons, lake)
    if args.command == "crosswalk":
        cmd_crosswalk(args, paths, seasons)
        return 0
    if args.command in ("features", "all"):
        cmd_features(args, paths, seasons)
    if args.command in ("evaluate", "all"):
        cmd_evaluate(args, paths)
    return 0


if __name__ == "__main__":
    sys.exit(main())
