"""Cached per-season inputs: xG -> stints -> regression rows (re-runnable, idempotent)."""
from __future__ import annotations

import json
import os

import pandas as pd

from bu.lake.build import read_table
from .design import back_to_back, stint_rows
from .stints import MIN_GAME_ONICE_MATCH, build_stints, ev_mask
from .xg import build_xg


def lake_seasons(lake) -> list[str]:
    """Seasons with a built ``shifts`` partition, ascending."""
    d = lake.table_dir("shifts")
    if not os.path.isdir(d):
        return []
    return sorted(x.split("=", 1)[1] for x in os.listdir(d) if x.startswith("season="))


def _meta_path(p):
    return p + ".meta.json"


def ensure_xg(paths, season: str, source: str = "v1", rebuild: bool = False) -> pd.DataFrame:
    p = paths.xg(season)
    meta = {"source": source}
    if not rebuild and os.path.exists(p) and os.path.exists(_meta_path(p)):
        with open(_meta_path(p)) as f:
            if json.load(f) == meta:
                return pd.read_parquet(p)
    x = build_xg(paths.lake, season, source)
    x.to_parquet(p, index=False)
    with open(_meta_path(p), "w") as f:
        json.dump(meta, f)
    return x


def ensure_stints(paths, season: str, source: str = "v1", rebuild: bool = False) -> pd.DataFrame:
    p = paths.stints(season)
    meta = {"xg_source": source, "version": 2}
    if not rebuild and os.path.exists(p) and os.path.exists(_meta_path(p)):
        with open(_meta_path(p)) as f:
            if json.load(f) == meta:
                return pd.read_parquet(p)
    x = ensure_xg(paths, season, source, rebuild=rebuild)
    st = build_stints(paths.lake, season, x)
    st.to_parquet(p, index=False)
    with open(_meta_path(p), "w") as f:
        json.dump(meta, f)
    return st


def season_rows(paths, season: str, source: str = "v1", entity: str = "player", target: str = "xgf",
                game_types=(2, 3)):
    st = ensure_stints(paths, season, source)
    st = st[ev_mask(st) & st["game_type"].isin(list(game_types))
            & (st["game_onice_match"] >= MIN_GAME_ONICE_MATCH)].reset_index(drop=True)
    b2b = back_to_back(paths.lake, [season])
    return stint_rows(st, b2b, target=target, entity=entity), st


def ev_toi(st: pd.DataFrame) -> pd.Series:
    """EV seconds on ice per skater from EV stints."""
    from collections import Counter
    c: Counter = Counter()
    for hs, as_, d in zip(st["home_sk"], st["away_sk"], st["dur"]):
        for p in hs:
            c[int(p)] += d
        for p in as_:
            c[int(p)] += d
    return pd.Series(c, dtype=float)


def games_table(lake, seasons) -> pd.DataFrame:
    return read_table(lake, "games", seasons)
