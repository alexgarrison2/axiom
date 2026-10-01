"""xG v2 target for the RAPM chain: one ``season=S.parquet`` (game_id, event_id, xg) per lake season.

The historical chain must not use a target scored by a model that saw the season or later, so

  * seasons with a walk-forward fold (``<state-dir>/oos_xg2_<S>.parquet`` from
    ``python -m bu.xg.walkforward``) take its out-of-sample ``xg2_asof`` (the shipped scheme:
    S-1 plus S's games before each month);
  * the burn-in season (the first lake season, which has no S-1) is scored by the S+1 fold's
    season-start model, which was fit on that season only: in sample for the burn-in, which
    only seeds the priors, and never forward-looking;
  * the current season is scored by the live artifacts (``pipeline/models/xg2_*.json``), the
    same model the pipeline publishes, so the season pack and the daily ``--xg v2`` refresh
    use one target.

  python -m bu.rapm.v2_source --lake-dir ../data/lake --state-dir <walk-forward state> --out <dir>
  python -m bu.rapm stints --lake-dir ../data/lake --xg <dir> ...
"""
from __future__ import annotations

import argparse
import os
import sys

import pandas as pd

from bu.lake.paths import Lake
from .data import lake_seasons
from .xg import score_v2


def build(lake: Lake, state_dir: str, out: str, current: str | None = None) -> dict:
    from season import SEASON_ID
    current = current or str(SEASON_ID)
    os.makedirs(out, exist_ok=True)
    seasons = lake_seasons(lake)
    info = {}
    for i, S in enumerate(seasons):
        oos = os.path.join(state_dir, f"oos_xg2_{S}.parquet")
        if S == current:
            d, how = score_v2(lake, S), "live artifacts (models/xg2_*.json)"
        elif os.path.exists(oos):
            o = pd.read_parquet(oos, columns=["game_id", "event_id", "xg2_asof"])
            d = o.rename(columns={"xg2_asof": "xg"})
            how = "walk-forward OOS xg2_asof"
        elif i + 1 < len(seasons) and os.path.isdir(os.path.join(state_dir, f"fold_{seasons[i + 1]}")):
            d = score_v2(lake, S, os.path.join(state_dir, f"fold_{seasons[i + 1]}"))
            how = f"fold_{seasons[i + 1]} season-start model (fit on {S} only; burn-in)"
        else:
            print(f"  [WARN] no v2 source for {S}; skipped", file=sys.stderr)
            continue
        d = d.dropna(subset=["xg"]).copy()
        d["game_id"] = d["game_id"].astype("int64")
        d["event_id"] = pd.to_numeric(d["event_id"], errors="coerce").astype("int64")
        d = d.drop_duplicates(["game_id", "event_id"])
        d.to_parquet(os.path.join(out, f"season={S}.parquet"), index=False)
        info[S] = {"rows": int(len(d)), "source": how}
        print(f"  {S}: {len(d):,} shots ({how})")
    return info


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bu.rapm.v2_source", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lake-dir", default=None)
    ap.add_argument("--state-dir", required=True, help="bu.xg.walkforward state dir (oos_xg2_<S>.parquet, fold_<S>/)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--current", default=None, help="season id scored by the live artifacts (default: season.SEASON_ID)")
    a = ap.parse_args(argv)
    build(Lake(a.lake_dir), a.state_dir, a.out, a.current)
    return 0


if __name__ == "__main__":
    sys.exit(main())
