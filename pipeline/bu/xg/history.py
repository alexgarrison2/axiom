"""xG v2 for the historical shot files the game model trains on (DESIGN §3.1 live wiring, item 2).

``game_model.pkl`` reads per-game raw xG through ``features.raw_team_game_xg``,
which takes a shot file's ``xg_raw`` column when it has one and otherwise
re-scores the shots with the v1 pickle.  The historical files
(``nhl_historical_shots.csv`` and last season's ``nhl_season_<y>_<y+1>_shots.csv``)
have no ``xg_raw``, so a game model retrained today would still learn from v1 xG.
This tool gives them a v2 ``xg_raw``:

  export  walk-forward out-of-sample scores (``<state-dir>/oos_xg2_<S>.parquet``,
          column ``xg2_asof``: the pre-registered candidate; every shot of season S is
          scored by a model fit on S-1 plus S's games before that month) ->
          ``pipeline/models/xg2_history.csv.gz`` (committed, ~3 MB, no re-run needed)
  apply   append ``xg_raw`` to each historical shot file: v2 where the lake has the
          shot (joined on game_id + event_id), the v1 pickle's score otherwise (the
          value the file implied before).  Every other byte of the file is kept.
  revert  drop ``xg_raw`` again: the files are byte-identical to before ``apply`` and
          the readers fall back to v1.  Files the live pipeline wrote (they carry
          ``xg_raw_v2``, e.g. 2026-27 once it is last season) are never touched.  Rollback is ``revert`` + the previous
          ``game_model.pkl`` + ``PONYXG_XG=v1``.
  status  which files carry v2 and the match rate.

Run from pipeline/:
  python -m bu.xg.history export --state-dir <walk-forward state dir>
  python -m bu.xg.history apply
  python -m bu.xg.history status
  python -m bu.xg.history revert

``shooting_talent`` and ``retrain`` read the same column, so after ``apply`` they see
v2 too.  The adjusted ``xG`` / ``xG_flurry_adj`` columns of the historical files stay
as they were (descriptive history; nothing model-facing reads them).
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE_DIR = os.path.dirname(os.path.dirname(HERE))
HISTORY = os.path.join(PIPELINE_DIR, "models", "xg2_history.csv.gz")
OOS_COL = "xg2_asof"
COL = "xg_raw"
LIVE_MARK = "xg_raw_v2"   # a season file the live pipeline wrote (its xg_raw is not ours to touch)
DECIMALS = 4


def history_files(pipeline_dir: str = PIPELINE_DIR) -> list[str]:
    """Shot files of completed seasons that ``features._shot_files`` reads (never the current season)."""
    from season import START_YEAR, season_file
    files = [os.path.join(pipeline_dir, "nhl_historical_shots.csv"),
             os.path.join(pipeline_dir, season_file("shots", START_YEAR - 1))]
    return [f for f in files if os.path.exists(f)]


def _seasons_in(files) -> list[str]:
    out = set()
    for f in files:
        g = pd.read_csv(f, usecols=["game_id"], dtype=str)["game_id"].str[:4].dropna().unique()
        out |= {f"{int(y)}{int(y) + 1}" for y in g}
    return sorted(out)


def export(state_dir: str, out: str = HISTORY, seasons=None) -> dict:
    seasons = seasons or _seasons_in(history_files())
    parts, missing = [], []
    for s in seasons:
        p = os.path.join(state_dir, f"oos_xg2_{s}.parquet")
        if not os.path.exists(p):
            missing.append(s)
            continue
        d = pd.read_parquet(p, columns=["game_id", "event_id", OOS_COL])
        parts.append(d)
    if missing:
        raise SystemExit(f"no walk-forward scores for {missing} in {state_dir} "
                         f"(run python -m bu.xg.walkforward --test-seasons ... --state-dir {state_dir})")
    d = pd.concat(parts, ignore_index=True).dropna(subset=[OOS_COL])
    d = d.drop_duplicates(["game_id", "event_id"])
    d = pd.DataFrame({"game_id": d["game_id"].astype("int64"), "event_id": d["event_id"].astype("int64"),
                      "xg2": d[OOS_COL].astype("float64").round(DECIMALS)})
    d = d.sort_values(["game_id", "event_id"]).reset_index(drop=True)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out + ".tmp"
    # mtime=0: the same scores give the same bytes (no diff on a re-export)
    import gzip
    with open(tmp, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, compresslevel=9) as gz:
        gz.write(d.to_csv(index=False, float_format=f"%.{DECIMALS}f").encode())
    os.replace(tmp, out)
    res = {"rows": int(len(d)), "seasons": seasons, "column": OOS_COL, "out": os.path.relpath(out, PIPELINE_DIR)}
    print(json.dumps(res))
    return res


def load_history(path: str = HISTORY) -> pd.DataFrame:
    return pd.read_csv(path, dtype={"game_id": "int64", "event_id": "int64", "xg2": "float64"})


def _read_text(path: str) -> pd.DataFrame:
    return pd.read_csv(path, dtype=str, keep_default_na=False, na_filter=False)


def _write_text(path: str, df: pd.DataFrame):
    tmp = path + ".tmp"
    df.to_csv(tmp, index=False)
    os.replace(tmp, path)


def _v1_scores(rows: pd.DataFrame) -> np.ndarray:
    """The v1 pickle's raw score of ``rows`` (read as ``features`` reads the file: numeric dtypes),
    i.e. what ``features._score_raw_xg`` computes for a file without ``xg_raw``."""
    from . import v1
    return v1.score(v1.load_production(), rows.reset_index(drop=True))


def apply(files=None, history: str = HISTORY, v1_score=_v1_scores) -> dict:
    files = history_files() if files is None else files
    h = load_history(history)
    res = {}
    for f in files:
        df = _read_text(f)
        if LIVE_MARK in df.columns:
            res[os.path.basename(f)] = "skipped: written by the live pipeline (has xg_raw_v2)"
            continue
        prev = df.pop(COL) if COL in df.columns else None
        key = pd.DataFrame({"game_id": pd.to_numeric(df["game_id"], errors="coerce"),
                            "event_id": pd.to_numeric(df["event_id"], errors="coerce")})
        m = key.merge(h, on=["game_id", "event_id"], how="left")
        v2 = m["xg2"].to_numpy(dtype="float64")
        miss = np.isnan(v2)
        vals = v2.copy()
        if prev is not None:   # re-apply: rows the export lacks keep the value they had
            had = pd.to_numeric(prev.replace("", np.nan), errors="coerce").to_numpy(dtype="float64")
            keep = miss & ~np.isnan(had)
            vals[keep] = had[keep]
            miss = miss & ~keep
        if miss.any():
            num = pd.read_csv(f, low_memory=False)
            if COL in num.columns:
                num = num.drop(columns=[COL])
            vals[miss] = np.asarray(v1_score(num[miss]), dtype="float64")
        v1_rows = int(np.isnan(v2).sum())
        df[COL] = [f"{v:.{DECIMALS}f}" if v == v else "" for v in vals]
        _write_text(f, df)
        res[os.path.basename(f)] = {"rows": int(len(df)), "v2": int(len(df) - v1_rows), "v1_fallback": v1_rows,
                                    "v2_share": round(float(1 - v1_rows / len(df)), 5) if len(df) else None}
    print(json.dumps(res, indent=1))
    return res


def revert(files=None) -> dict:
    files = history_files() if files is None else files
    res = {}
    for f in files:
        df = _read_text(f)
        if LIVE_MARK in df.columns:
            res[os.path.basename(f)] = "skipped: written by the live pipeline (has xg_raw_v2)"
        elif COL in df.columns:
            _write_text(f, df.drop(columns=[COL]))
            res[os.path.basename(f)] = "reverted"
        else:
            res[os.path.basename(f)] = "no xg_raw"
    print(json.dumps(res, indent=1))
    return res


def status(files=None) -> dict:
    files = history_files() if files is None else files
    res = {}
    for f in files:
        cols = pd.read_csv(f, nrows=0).columns
        res[os.path.basename(f)] = "xg_raw present (v2 applied)" if COL in cols else "no xg_raw (readers use v1)"
    res["history_file"] = os.path.relpath(HISTORY, PIPELINE_DIR) if os.path.exists(HISTORY) else None
    print(json.dumps(res, indent=1))
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["export", "apply", "revert", "status"])
    ap.add_argument("--state-dir", help="export: the walk-forward state dir with oos_xg2_<S>.parquet")
    ap.add_argument("--seasons", help="export: comma list (default: the seasons in the historical shot files)")
    a = ap.parse_args(argv)
    if a.action == "export":
        if not a.state_dir:
            ap.error("export needs --state-dir")
        return export(a.state_dir, seasons=a.seasons.split(",") if a.seasons else None)
    return {"apply": apply, "revert": revert, "status": status}[a.action]()


if __name__ == "__main__":
    main()
