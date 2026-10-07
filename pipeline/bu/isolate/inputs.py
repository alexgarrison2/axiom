"""Per-season inputs from the lake, cached under ``<lake>/state/isolate/season=S/``.

* ``stints``: ``bu.rapm.stints.build_stints`` on xG v2 (every strength; filtered later)
* ``shots``: unblocked, non-penalty-shot, non-shootout attempts with xG v2, flurry xG, the
  attacking-direction coordinates (``x_norm``, ``y_norm``), the primary assist and the index
  of the stint they belong to (the lake's boundary rule: a shot at ``t`` belongs to the stint
  ``(start, end]``; ``t = 0`` to the stint starting at 0)
* ``pens``: penalties with the committing / drawing player and the minor-equivalent count
* ``toi``: seconds on ice per skater by state (5v5, PP 5v4, PK 4v5, all situations)
* ``pos``: position per skater (lake ``players`` table: C/L/R -> F, D)
"""
from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd

from bu.lake.build import read_table
from bu.lake.paths import Lake
from bu.rapm.stints import MIN_GAME_ONICE_MATCH, build_stints
from bu.rapm.xg import build_xg

VERSION = 1
XG_SOURCE = "v2"
PENALTY = 509


def state_dir(lake: Lake, season: str) -> str:
    d = os.path.join(lake.root, "state", "isolate", f"season={season}")
    os.makedirs(d, exist_ok=True)
    return d


def _fingerprint(lake: Lake, season: str) -> dict:
    """Size + mtime of the season's lake partitions, so a lake update rebuilds the cache."""
    out = {}
    for t in ("games", "shifts", "events", "shots", "players", "lineups"):
        p = lake.table_path(t, season)
        if os.path.exists(p):
            st = os.stat(p)
            out[t] = [st.st_size, int(st.st_mtime)]
    return out


def _stale(d: str, meta: dict) -> bool:
    p = os.path.join(d, "meta.json")
    if not os.path.exists(p):
        return True
    with open(p) as f:
        return json.load(f) != meta


def assign_stints(shots: pd.DataFrame, st: pd.DataFrame) -> np.ndarray:
    """Row index into ``st`` for every shot (-1 when no stint covers it).

    ``shots`` needs game_id, period, period_seconds; ``st`` game_id, period, start_s, end_s
    (contiguous, non-overlapping intervals per game and period)."""
    s = pd.DataFrame({"game_id": shots["game_id"].to_numpy(np.int64),
                      "period": shots["period"].to_numpy(np.int64),
                      "t": shots["period_seconds"].to_numpy(float),
                      "_i": np.arange(len(shots))})
    r = pd.DataFrame({"game_id": st["game_id"].to_numpy(np.int64),
                      "period": st["period"].to_numpy(np.int64),
                      "start_s": st["start_s"].to_numpy(float),
                      "end_s": st["end_s"].to_numpy(float),
                      "_k": np.arange(len(st))})
    s = s.dropna(subset=["t"]).sort_values("t", kind="stable")
    r = r.sort_values("end_s", kind="stable")
    m = pd.merge_asof(s, r, left_on="t", right_on="end_s", by=["game_id", "period"], direction="forward")
    ok = m["_k"].notna() & ((m["start_s"] < m["t"]) | ((m["t"] == 0) & (m["start_s"] == 0)))
    out = np.full(len(shots), -1, dtype=np.int64)
    out[m.loc[ok, "_i"].to_numpy(int)] = m.loc[ok, "_k"].to_numpy(np.int64)
    return out


def _penalties(lake: Lake, season: str) -> pd.DataFrame:
    ev = read_table(lake, "events", [season], columns=["game_id", "type_code", "period_type", "pen_duration",
                                                       "pen_desc_key", "pen_committed_by_id", "pen_drawn_by_id"])
    p = ev[(ev["type_code"] == PENALTY) & (ev["period_type"] != "SO")].copy()
    dur = pd.to_numeric(p["pen_duration"], errors="coerce").fillna(0)
    # minor-equivalents: a minor is one power play, a double minor two; majors (mostly fights,
    # offsetting), misconducts and penalty shots (0) are left out
    p["n"] = np.where(dur == 2, 1.0, np.where(dur == 4, 2.0, 0.0))
    p = p[p["n"] > 0]
    return pd.DataFrame({"game_id": p["game_id"].astype("int64").to_numpy(),
                         "taken_by": pd.to_numeric(p["pen_committed_by_id"], errors="coerce").to_numpy(),
                         "drawn_by": pd.to_numeric(p["pen_drawn_by_id"], errors="coerce").to_numpy(),
                         "n": p["n"].to_numpy(float)})


def _toi(st: pd.DataFrame) -> pd.DataFrame:
    """Seconds on ice per (game, skater) by state, from stints (both goalies in except 'all')."""
    both_g = (st["n_home_g"] == 1) & (st["n_away_g"] == 1)
    hs, as_ = st["n_home_sk"].to_numpy(), st["n_away_sk"].to_numpy()
    recs = []
    for side, own, opp in (("home_sk", hs, as_), ("away_sk", as_, hs)):
        d = pd.DataFrame({"game_id": st["game_id"].to_numpy(np.int64), "p": st[side], "dur": st["dur"].to_numpy(float),
                          "s5": both_g & (own == 5) & (opp == 5), "pp": both_g & (own == 5) & (opp == 4),
                          "pk": both_g & (own == 4) & (opp == 5)})
        d = d.explode("p").dropna(subset=["p"])
        recs.append(d)
    d = pd.concat(recs, ignore_index=True)
    d["p"] = d["p"].astype(np.int64)
    for c in ("s5", "pp", "pk"):
        d[c] = d[c].astype(bool) * d["dur"]
    return (d.rename(columns={"dur": "all"}).groupby(["game_id", "p"], as_index=False)[["all", "s5", "pp", "pk"]].sum()
            .rename(columns={"p": "player_id"}))


def build(lake: Lake, season: str, rebuild: bool = False) -> dict:
    """Build (or read the cache of) one season's inputs."""
    d = state_dir(lake, season)
    meta = {"version": VERSION, "xg": XG_SOURCE, "lake": _fingerprint(lake, season)}
    names = ("stints", "shots", "pens", "toi", "games", "pos")
    if not rebuild and not _stale(d, meta) and all(os.path.exists(os.path.join(d, f"{n}.parquet")) for n in names):
        return {n: pd.read_parquet(os.path.join(d, f"{n}.parquet")) for n in names}

    x = build_xg(lake, season, XG_SOURCE)
    st = build_stints(lake, season, x)
    st = st[st["game_onice_match"] >= MIN_GAME_ONICE_MATCH].reset_index(drop=True)
    sh = read_table(lake, "shots", [season], columns=["game_id", "event_id", "period_seconds", "x_norm", "y_norm",
                                                      "assist1_id"])
    shots = x.merge(sh, on=["game_id", "event_id"], how="left")
    shots["stint"] = assign_stints(shots, st)
    shots = shots[shots["stint"] >= 0].reset_index(drop=True)
    shots = shots[["game_id", "event_id", "stint", "acting_is_home", "shooter_id", "assist1_id", "is_goal",
                   "empty_net_against", "xg", "xg_flurry", "x_norm", "y_norm"]]
    shots["acting_is_home"] = shots["acting_is_home"].astype(bool)
    shots["is_goal"] = shots["is_goal"].astype(bool)
    shots["empty_net_against"] = shots["empty_net_against"].astype("boolean").fillna(False).astype(bool)
    for c in ("shooter_id", "assist1_id"):
        shots[c] = pd.to_numeric(shots[c], errors="coerce").fillna(0).astype(np.int64)

    games = read_table(lake, "games", [season], columns=["game_id", "game_date", "game_type", "home_team_id",
                                                         "away_team_id"])
    games = games[pd.to_numeric(games["game_type"], errors="coerce").isin([2, 3])]
    pl = read_table(lake, "players", [season], columns=["player_id", "position", "full_name", "on_season_roster"])
    pos = pl.drop_duplicates("player_id")[["player_id", "position", "full_name", "on_season_roster"]]
    out = {"stints": st, "shots": shots, "pens": _penalties(lake, season), "toi": _toi(st), "games": games,
           "pos": pos}
    for n, df in out.items():
        df.to_parquet(os.path.join(d, f"{n}.parquet"), index=False)
    with open(os.path.join(d, "meta.json"), "w") as f:
        json.dump(meta, f)
    return out
