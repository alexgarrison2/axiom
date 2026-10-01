"""CLI for RAPM v2 (run from ``pipeline/``).

  python -m bu.rapm stints   [--seasons 2018-2025] [--xg v1|<parquet dir>]   # xG + stints cache
  python -m bu.rapm validate [--seasons 2018-2025] --tune 2021,2022 --dev 2023,2024
  python -m bu.rapm asof     [--seasons 2018-2026] [--hyper reports/rapm_validation.json]
  python -m bu.rapm asof     --seasons 2026 --seed bu/lineup/out/season_pack_20262027.json.gz   # live refresh
  python -m bu.rapm all      # bios, stints, validate, asof with the tuned setting

``--seasons`` defaults to every season with a built ``shifts`` partition in the lake
(``--lake-dir`` / PONYXG_LAKE_DIR).  The lake is only read; outputs go to ``--out``
(default ``<lake>/state/rapm``).  Reports backing a model claim are also copied to
``pipeline/bu/rapm/out/``.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys

import pandas as pd

from bu.lake.paths import Lake
from .data import ensure_stints, lake_seasons
from .paths import REPORT_DIR, RapmPaths


def _season_ids(spec: str | None, lake: Lake) -> list[str]:
    have = lake_seasons(lake)
    if not spec:
        return have
    years: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-")
            years.update(range(int(a[:4]), int(b[:4]) + 1))
        elif part:
            years.add(int(part[:4]))
    want = [f"{y}{y + 1}" for y in sorted(years)]
    missing = [s for s in want if s not in have]
    if missing:
        print(f"  [WARN] no built lake partition for {', '.join(missing)}; skipped")
    return [s for s in want if s in have]


def _players(paths, seasons, refresh_current=None):
    """Bio table; rebuilt (fetching only the missing season payloads) whenever a requested
    season has no cached bio payload, so a new season's rookies get their position and draft
    slot instead of the F / undrafted fallback."""
    from .bio import build_players
    want = sorted(set(seasons) | {f"{y}{y + 1}" for y in range(2010, int(seasons[-1][:4]) + 1)})
    have_all = all(os.path.exists(paths.bio_raw(s)) for s in want)
    if os.path.exists(paths.players()) and refresh_current is None and have_all:
        p = pd.read_parquet(paths.players())
        if len(p):
            return p
    return build_players(paths, want, refresh_current=refresh_current)


def _n_games(lake, season) -> int:
    from bu.lake.build import read_table
    return len(read_table(lake, "games", [season], columns=["game_id"]))


def _publish(path: str) -> str:
    os.makedirs(REPORT_DIR, exist_ok=True)
    dst = os.path.join(REPORT_DIR, os.path.basename(path))
    shutil.copyfile(path, dst)
    return dst


def cmd_stints(args, paths, seasons):
    for s in seasons:
        st = ensure_stints(paths, s, args.xg, rebuild=args.rebuild)
        print(f"  [stints] {s}: {len(st):,}")


def cmd_validate(args, paths, seasons):
    from . import validate as V
    players = _players(paths, seasons)
    tune = _season_ids(args.tune, paths.lake)
    dev = _season_ids(args.dev, paths.lake)
    res = V.run(paths, seasons, players, source=args.xg)
    tag = f"_{args.tag}" if args.tag else ""
    res["per_game"].to_parquet(paths.report(f"rapm_validation{tag}_per_game.parquet"), index=False)
    summ = V.summarize(res, tune, dev, seasons[1:])
    out = paths.report(f"rapm_validation{tag}.json")
    V.write_report(out, summ, {
        "design": "DESIGN §3.2.2 stint-level next-30-day weighted MSE (xG/60 of the attacking side, "
                  "weights = stint seconds), 7 as-of dates per season",
        "xg_source": args.xg, "seasons": seasons, "burn_in": seasons[0], "tune_seasons": tune,
        "dev_seasons": dev, "aging": res["meta"]["aging"], "rookie": res["meta"]["rookie"]})
    print(f"  [validate] gate {'PASS' if summ['gate']['pass'] else 'FAIL'}; selected {summ['selected']['rapm']}")
    for S, f in summ["folds"].items():
        print(f"    {S} ({f['role']}): " + ", ".join(f"{k} {v:.4f}" for k, v in f["mse"].items())
              + " | rapm-minus: " + ", ".join(f"{b} {v['delta_mse']:+.4f} (z {v['z']:.1f})"
                                               for b, v in f["rapm_vs"].items()))
    print(f"  report: {_publish(out)}")
    return summ


def cmd_asof(args, paths, seasons):
    from . import asof as A
    from .priors import Hyper
    if args.seed:
        # live refresh: one season from its prior pack; only that season's bio is needed (the
        # pack carries the bio of every returning player) and the full bio table is not touched
        from .bio import build_players
        from .pack import Seed
        seed = Seed.load(args.seed)
        if len(seasons) != 1 or seasons[0] != seed.season:
            raise SystemExit(f"--seed {os.path.basename(args.seed)} is for {seed.season}; pass --seasons {seed.season[:4]}")
        players = build_players(paths, seasons, refresh_current=args.refresh_bio, write=False)
        summ = A.run(paths, seasons, players, seed.hyper, source=args.xg, seed=args.seed)
        print(f"  [asof] seeded {seed.season}: {paths.ratings(seed.season)}")
        return summ
    players = _players(paths, seasons, refresh_current=args.refresh_bio)
    hp = args.hyper or paths.report("rapm_validation.json")
    if os.path.exists(hp):
        with open(hp) as f:
            h = Hyper(**json.load(f)["selected_hyper"])
    else:
        print(f"  [WARN] no validation report at {hp}; using default hyper-parameters")
        h = Hyper()
    summ = A.run(paths, seasons, players, h, source=args.xg)
    if not args.degrade:
        print(f"  report: {_publish(paths.report('asof_summary.json'))}")
    return summ


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bu.rapm", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["stints", "validate", "asof", "all"])
    ap.add_argument("--lake-dir", default=None)
    ap.add_argument("--out", default=None, help="state dir (default <lake>/state/rapm)")
    ap.add_argument("--seasons", default=None, help="e.g. 2018-2025 (start years)")
    ap.add_argument("--xg", default="v1", help="'v1' (xg_model_xgb.pkl) or a parquet path with game_id,event_id,xg")
    ap.add_argument("--tune", default="2021,2022", help="tuning seasons (DESIGN §1.5)")
    ap.add_argument("--dev", default="2023,2024", help="dev folds (DESIGN §1.5)")
    ap.add_argument("--hyper", default=None, help="validation report whose selected_hyper to use")
    ap.add_argument("--refresh-bio", default=None, help="season id whose bio payload to re-fetch")
    ap.add_argument("--seed", default=None, help="asof: refit one season from its prior pack "
                    "(bu/lineup/out/season_pack_<S>.json.gz) without replaying earlier seasons (live refresh)")
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--tag", default=None, help="validate: report suffix for a sensitivity run "
                    "(rapm_validation_<tag>.json), so the main report is not overwritten")
    ap.add_argument("--degrade", default=None, help="e.g. 0.35:2: DESIGN §4.3 degraded-data sensitivity "
                    "(35%% of games' shifts 2 days late); needs its own --out")
    args = ap.parse_args(argv)
    if args.degrade:
        if not args.out:
            raise SystemExit("--degrade needs a separate --out state dir")
        from .engine import DEGRADE_ENV
        os.environ[DEGRADE_ENV] = args.degrade
    lake = Lake(args.lake_dir)
    paths = RapmPaths(lake, args.out)
    seasons = _season_ids(args.seasons, lake)
    if not seasons:
        print("no lake seasons to process", file=sys.stderr)
        return 1
    print(f"bu.rapm {args.command}: lake {lake.root} -> {paths.root}; seasons {', '.join(seasons)}; xG {args.xg}")
    if args.command in ("stints", "all"):
        cmd_stints(args, paths, seasons)
    if args.command in ("validate", "all"):
        # validation needs complete seasons; a season in progress (e.g. 2026-27 in October) is skipped
        full = [s for s in seasons if _n_games(lake, s) >= 400]
        if len(full) < 2:
            print("  [validate] needs >= 2 complete seasons (a burn-in plus one to score); skipped",
                  file=sys.stderr)
        else:
            cmd_validate(args, paths, full)
    if args.command in ("asof", "all"):
        cmd_asof(args, paths, seasons)
    return 0


if __name__ == "__main__":
    sys.exit(main())
