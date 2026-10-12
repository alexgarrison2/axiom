#!/usr/bin/env python3
"""
skater_rates.py — descriptive on-ice rates per skater, per season (team skater cards).

The player model (player_impact.json) stays on last season until
PLAYER_MODEL_MIN_GAMES games are in, so it cannot show this season's on-ice
numbers.  This file can: it is plain description of the season so far, no
shrinkage and no model, built from the same sources as the game pages.

    5v5 (pony xG, wowy.py's stints and shot attribution)
        xgf60, xga60     on-ice xG for / against per 60
        xg_pct           on-ice xGF%
        rel              on-ice xGF% minus his team's xGF% with him off the ice
        ixg60            his own 5v5 shots' xG per 60
    All situations (NHL stats API, nhl_season_*_skater_games.csv)
        pen60            penalties drawn minus taken per 60
        ev_toi, pp_toi, pk_toi   seconds per game

A traded player's samples are summed over his teams; ``team`` is his team in
his latest game.  Regular season only.

Output: public/data/skater_rates/<seasonId>.json, columnar:
    { season, built_at, games, cols: [...], rows: [...] }

Run from pipeline/:  python3 skater_rates.py          (current season; last season once, when missing)
                     python3 skater_rates.py --prev   (last season)
"""
from __future__ import annotations

import os
import sys
import time

import numpy as np
import pandas as pd

import wowy as W
from io_utils import VOLATILE_KEYS, atomic_write_json, keep_if_unchanged, read_json, utc_now_iso
from paths import PIPELINE_DIR, PUBLIC_DATA_DIR
from season import PREV_START_YEAR, START_YEAR, season_file

COLS = ["player", "team", "pos", "gp", "toi5", "xgf60", "xga60", "xg_pct", "rel", "ixg60", "pen60",
        "ev_toi", "pp_toi", "pk_toi"]


def out_path(start_year: int) -> str:
    return os.path.join(PUBLIC_DATA_DIR, "skater_rates", f"{start_year}{start_year + 1}.json")


def per60(x, sec):
    return np.where(sec > 0, x / np.maximum(sec, 1e-9) * 3600, 0.0)


def share(f, a):
    return np.where(f + a > 0, f / np.maximum(f + a, 1e-9), 0.5)


def five_on_five(stints: pd.DataFrame, shots: pd.DataFrame) -> pd.DataFrame:
    """Per player (summed over teams): 5v5 seconds, on-ice xGF / xGA, the same
    for his team with him off the ice, and his own 5v5 xG."""
    on, _ = W.aggregate(stints)
    sides = W._sides(stints)
    team = sides.groupby("team")[["dur", "xgf", "xga"]].sum()
    for c in ("dur", "xgf", "xga"):
        on[f"off_{c}"] = on["team"].map(team[c]).to_numpy() - on[c]
    on = on.groupby("player", as_index=False)[["dur", "xgf", "xga", "off_dur", "off_xgf", "off_xga"]].sum()
    s5 = shots[shots["strength_state"] == "5v5"]
    ixg = pd.to_numeric(s5["xG"], errors="coerce").fillna(0.0).groupby(s5["player_id"]).sum()
    on["ixg"] = on["player"].map(ixg).fillna(0.0)
    return on


def all_situations(games: pd.DataFrame) -> pd.DataFrame:
    """Per player from the per-game logs: games, latest team and position, TOI
    splits (minutes) and penalties."""
    g = games.sort_values(["date", "game_id"])
    num = ["toi", "ev_toi", "pp_toi", "sh_toi", "pen_drawn", "pen_taken"]
    g[num] = g[num].apply(pd.to_numeric, errors="coerce").fillna(0.0)
    out = g.groupby("player_id").agg(gp=("game_id", "nunique"), team=("team", "last"), pos=("pos", "last"),
                                    **{c: (c, "sum") for c in num})
    return out.reset_index()


def rows(five: pd.DataFrame, allsit: pd.DataFrame) -> list:
    df = allsit.merge(five.rename(columns={"player": "player_id"}), on="player_id", how="left").fillna(
        {c: 0.0 for c in ("dur", "xgf", "xga", "off_dur", "off_xgf", "off_xga", "ixg")})
    df = df[df["pos"] != "G"]
    on_pct = share(df["xgf"].to_numpy(), df["xga"].to_numpy())
    off_pct = share(df["off_xgf"].to_numpy(), df["off_xga"].to_numpy())
    gp = df["gp"].to_numpy().clip(min=1)
    r2 = lambda v: [round(float(x), 2) for x in v]  # noqa: E731
    r4 = lambda v: [round(float(x), 4) for x in v]  # noqa: E731
    cols = {
        "player": df["player_id"].astype(int).tolist(),
        "team": df["team"].astype(str).tolist(),
        "pos": df["pos"].astype(str).tolist(),
        "gp": df["gp"].astype(int).tolist(),
        "toi5": df["dur"].round().astype(int).tolist(),
        "xgf60": r2(per60(df["xgf"].to_numpy(), df["dur"].to_numpy())),
        "xga60": r2(per60(df["xga"].to_numpy(), df["dur"].to_numpy())),
        "xg_pct": r4(on_pct),
        "rel": r4(np.where((df["dur"] > 0) & (df["off_dur"] > 0), on_pct - off_pct, 0.0)),
        "ixg60": r2(per60(df["ixg"].to_numpy(), df["dur"].to_numpy())),
        "pen60": r2(per60(df["pen_drawn"].to_numpy() - df["pen_taken"].to_numpy(), df["toi"].to_numpy() * 60)),
        "ev_toi": (df["ev_toi"].to_numpy() * 60 / gp).round().astype(int).tolist(),
        "pp_toi": (df["pp_toi"].to_numpy() * 60 / gp).round().astype(int).tolist(),
        "pk_toi": (df["sh_toi"].to_numpy() * 60 / gp).round().astype(int).tolist(),
    }
    return [list(t) for t in zip(*(cols[c] for c in COLS))]


def build(start_year: int) -> dict | None:
    games_path = os.path.join(PIPELINE_DIR, season_file("skater_games", start_year))
    if not os.path.exists(games_path):
        return None
    games = pd.read_csv(games_path)
    if games.empty or "sh_toi" not in games.columns:
        return None
    shifts, _ = W.load_inputs(start_year)
    shots = W._regular(pd.read_csv(os.path.join(PIPELINE_DIR, season_file("shots", start_year)),
                                   usecols=["game_id", "period", "time_seconds", "team_id", "player_id",
                                            "strength_state", "xG"], low_memory=False))
    five = pd.DataFrame(columns=["player", "dur", "xgf", "xga", "off_dur", "off_xgf", "off_xga", "ixg"])
    if not shifts.empty:
        goalies, _ = W.load_people(start_year)
        st = W.build_stints(shifts, goalies)
        if not st.empty:
            five = five_on_five(W.attribute_shots(st, shots), shots)
    return {
        "season": f"{start_year}{start_year + 1}",
        "built_at": utc_now_iso(),
        "games": int(games["game_id"].nunique()),
        "cols": COLS,
        "rows": rows(five, all_situations(games)),
    }


def main(argv=None):
    argv = list(argv or [])
    years = [START_YEAR]
    if "--prev" in argv:
        years = [PREV_START_YEAR]
    elif not os.path.exists(out_path(PREV_START_YEAR)):
        years.append(PREV_START_YEAR)
    written = 0
    for y in years:
        t0 = time.time()
        doc = build(y)
        if not doc or not doc["rows"]:
            print(f"  skater rates {y}: no games yet")
            continue
        path = out_path(y)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        doc = keep_if_unchanged(read_json(path), doc, keys=VOLATILE_KEYS | {"built_at"})
        if atomic_write_json(path, doc, min_items=1, indent=None, separators=(",", ":"), label=f"skater_rates_{y}"):
            written += len(doc["rows"])
        print(f"  skater rates {y}-{(y + 1) % 100:02d}: {doc['games']} games, {len(doc['rows'])} skaters, "
              f"{os.path.getsize(path) / 1024:.0f} KB, {time.time() - t0:.1f}s")
    return {"status": "ok" if written else "skip", "rows_written": written}


if __name__ == "__main__":
    os.chdir(PIPELINE_DIR)
    main(sys.argv[1:])
