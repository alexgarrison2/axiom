#!/usr/bin/env python3
"""
wowy.py — "With or without you": every 5v5 pairing of teammates, per season.

For each skater and each teammate he shared the ice with at 5v5 (five skaters
and a goalie on each side), three on-ice samples on his team:

    together            both on the ice
    him apart           he is on, the teammate is not
    mate apart          the teammate is on, he is not

each as 5v5 time on ice and xGF / xGA (pony xG, the ``xG`` column of the
season's scored shots, the same values the game pages show).  The site plots
the raw rates (xGF/60 and xGA/60), not shares.

Stints come from ``calc_rapm._build_stints`` (shift-chart breakpoints, exactly
five skaters a side) with no minimum length and both goalies required.  A shot
belongs to the stint ``(start, end]`` that covers its period second (players
whose shift ends at the shot were on for it; the game pages and the RAPM lake
use the same rule) and counts only when the shot itself is tagged 5v5.
Regular season only.  A traded player's samples stay with each team.

Threshold (``min_toi``): a pair is kept when its time together reaches
100 minutes scaled by how much of the season has been played (the most games
any team has played over the schedule length), floored at 10 minutes, so a
full season uses HockeyViz's 100 minutes and opening week still shows a top
line.  Each player keeps at most his ``TOP`` teammates by time together (a pair
is stored when it makes either player's list).

Output: public/data/wowy/<seasonId>.json, columnar:
    { season, built_at, games, team_gp, season_games, min_toi,
      names: { id: [first, last, pos] },
      on_cols: [player, team, toi, xgf, xga],          on: [...]   (all his 5v5 on that team)
      pair_cols: [a, b, team, toi, xgf, xga],          pairs: [...] (a < b, together)
    }
TOI in seconds, xG to two decimals.  "Apart" samples are derived on the site:
his on-ice total for the team minus the time together.

Run from pipeline/:  python3 wowy.py            (current season)
                     python3 wowy.py --prev     (last season)
                     python3 wowy.py --season 2025
"""
from __future__ import annotations

import json
import os
import sys
import time
from itertools import combinations

import numpy as np
import pandas as pd

from io_utils import VOLATILE_KEYS, atomic_write_json, keep_if_unchanged, read_json, utc_now_iso
from paths import PIPELINE_DIR, PUBLIC_DATA_DIR
from season import PREV_START_YEAR, REGULAR_SEASON, START_YEAR, season_file

FULL_SEASON_MIN = 100      # HockeyViz's bar for a full season, minutes together
FLOOR_MIN = 10             # never lower than this, however early in the season
TOP = 12                   # teammates kept per player (the site shows up to 8)


def season_games(start_year: int) -> int:
    return 84 if start_year >= 2026 else 82


def out_path(start_year: int) -> str:
    return os.path.join(PUBLIC_DATA_DIR, "wowy", f"{start_year}{start_year + 1}.json")


def min_toi_seconds(team_gp: int, start_year: int) -> int:
    frac = min(1.0, team_gp / season_games(start_year))
    return int(round(max(FLOOR_MIN, FULL_SEASON_MIN * frac) * 60))


# ── inputs ────────────────────────────────────────────────────────────────

def _regular(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["game_id"].astype(str).str[4:6] == REGULAR_SEASON]


def load_inputs(start_year: int):
    shifts = pd.read_csv(os.path.join(PIPELINE_DIR, season_file("shifts", start_year)), low_memory=False)
    shots = pd.read_csv(os.path.join(PIPELINE_DIR, season_file("shots", start_year)),
                        usecols=["game_id", "period", "time_seconds", "team_id", "strength_state", "xG"],
                        low_memory=False)
    return _regular(shifts), _regular(shots)


def load_people(start_year: int):
    """Goalie ids and display names for the season: the per-game player stats
    (is_goalie, "F. Last") overlaid by the Pony Score season (first, last, pos)."""
    sid = f"{start_year}{start_year + 1}"
    goalies: set[int] = set()
    names: dict[int, list] = {}
    ps_path = os.path.join(PUBLIC_DATA_DIR, f"nhl_season_{start_year}_{start_year + 1}_player_stats.csv")
    if os.path.exists(ps_path):
        ps = pd.read_csv(ps_path, usecols=["player_id", "name", "position", "is_goalie"], low_memory=False)
        ps = ps.dropna(subset=["player_id"])
        goalies |= set(ps.loc[ps["is_goalie"].astype(bool), "player_id"].astype(int))
        for pid, name, pos in ps.drop_duplicates("player_id", keep="last")[["player_id", "name", "position"]].itertuples(index=False):
            first, _, last = str(name).partition(" ")
            names[int(pid)] = [first, last or first, str(pos)]
    pony = read_json(os.path.join(PUBLIC_DATA_DIR, "pony", f"{sid}.json"), default=None) or {}
    for pid, row in (pony.get("players") or {}).items():
        first, last, pos = row[0], row[1], row[2]
        names[int(pid)] = [first, last, pos]
        if pos == "G":
            goalies.add(int(pid))
    return goalies, names


# ── stints and shots ──────────────────────────────────────────────────────

def build_stints(shifts: pd.DataFrame, goalies: set[int]) -> pd.DataFrame:
    """5v5 stints with both goalies in (calc_rapm's breakpoint builder, no minimum
    length).  Side "a" is the lower team id of the game, "b" the other."""
    import calc_rapm as R
    sh = shifts.copy()
    sh["resolved_id"] = sh["player_id"]
    if sh["resolved_id"].isna().any():
        sh = R._resolve_player_ids(sh)
    teams = sh.groupby("game_id")["team_id"].agg(["min", "max"])
    side_a = {int(g): int(r["min"]) for g, r in teams.iterrows()}
    stints = R._build_stints(sh, side_a, goalies, min_seconds=0)
    stints = [s for s in stints if s["home_goalie"] is not None and s["away_goalie"] is not None]
    if not stints:
        return pd.DataFrame()
    df = pd.DataFrame({
        "game_id": [s["game_id"] for s in stints],
        "period": [s["period"] for s in stints],
        "start": [float(s["start"]) for s in stints],
        "end": [float(s["end"]) for s in stints],
    })
    df["team_a"] = df["game_id"].map(teams["min"]).astype(int)
    df["team_b"] = df["game_id"].map(teams["max"]).astype(int)
    df[[f"a{i}" for i in range(5)]] = np.array([s["home_skaters"] for s in stints], dtype=np.int64)
    df[[f"b{i}" for i in range(5)]] = np.array([s["away_skaters"] for s in stints], dtype=np.int64)
    df["dur"] = df["end"] - df["start"]
    return df


def attribute_shots(stints: pd.DataFrame, shots: pd.DataFrame) -> pd.DataFrame:
    """xG for side a / side b in each stint: 5v5-tagged shots at period second t
    go to the stint with start < t <= end (one stint at most; none if t falls in
    a non-5v5 stretch by the shift charts)."""
    st = stints.sort_values(["game_id", "period", "start"]).reset_index(drop=True)
    st["xg_a"] = 0.0
    st["xg_b"] = 0.0
    sh = shots[shots["strength_state"] == "5v5"].copy()
    sh["xG"] = pd.to_numeric(sh["xG"], errors="coerce").fillna(0.0)
    key = st["game_id"].astype(np.int64) * 10 + st["period"].astype(np.int64)
    skey = sh["game_id"].astype(np.int64) * 10 + sh["period"].astype(np.int64)
    # Sorted by (key, start): binary search on a combined (key, time) scale.
    big = 10_000.0
    st_lo = key.to_numpy() * big + st["start"].to_numpy()
    st_hi = key.to_numpy() * big + st["end"].to_numpy()
    t = skey.to_numpy() * big + sh["time_seconds"].to_numpy(dtype=float)
    k = np.searchsorted(st_lo, t, side="left") - 1          # last stint with start < t
    ok = (k >= 0)
    k = np.where(ok, k, 0)
    ok &= (st_lo[k] < t) & (t <= st_hi[k])
    is_a = sh["team_id"].to_numpy() == st["team_a"].to_numpy()[k]
    xg = sh["xG"].to_numpy()
    xa = np.zeros(len(st))
    xb = np.zeros(len(st))
    np.add.at(xa, k[ok & is_a], xg[ok & is_a])
    np.add.at(xb, k[ok & ~is_a], xg[ok & ~is_a])
    st["xg_a"] = xa
    st["xg_b"] = xb
    return st


# ── aggregation ───────────────────────────────────────────────────────────

def _sides(st: pd.DataFrame):
    """Long form: one row per (stint, side) with the 5 skaters, team, xGF, xGA."""
    a = pd.DataFrame(st[[f"a{i}" for i in range(5)]].to_numpy(), columns=[f"s{i}" for i in range(5)])
    a["team"], a["xgf"], a["xga"] = st["team_a"].to_numpy(), st["xg_a"].to_numpy(), st["xg_b"].to_numpy()
    b = pd.DataFrame(st[[f"b{i}" for i in range(5)]].to_numpy(), columns=[f"s{i}" for i in range(5)])
    b["team"], b["xgf"], b["xga"] = st["team_b"].to_numpy(), st["xg_b"].to_numpy(), st["xg_a"].to_numpy()
    a["dur"] = b["dur"] = st["dur"].to_numpy()
    return pd.concat([a, b], ignore_index=True)


def aggregate(st: pd.DataFrame):
    """(on, pairs): per (player, team) on-ice totals and per (a, b, team) together totals."""
    sides = _sides(st)
    vals = ["dur", "xgf", "xga"]
    on = pd.concat([sides[[f"s{i}", "team"] + vals].rename(columns={f"s{i}": "player"}) for i in range(5)])
    on = on.groupby(["player", "team"], as_index=False)[vals].sum()
    parts = []
    sk = sides[[f"s{i}" for i in range(5)]].to_numpy()
    sk.sort(axis=1)                                    # a < b within each pair
    for i, j in combinations(range(5), 2):
        parts.append(pd.DataFrame({"a": sk[:, i], "b": sk[:, j], "team": sides["team"].to_numpy(),
                                   "dur": sides["dur"].to_numpy(), "xgf": sides["xgf"].to_numpy(),
                                   "xga": sides["xga"].to_numpy()}))
    pairs = pd.concat(parts).groupby(["a", "b", "team"], as_index=False)[vals].sum()
    return on, pairs


def select_pairs(pairs: pd.DataFrame, min_toi: int, top: int = TOP) -> pd.DataFrame:
    """Pairs at or over the threshold that make either player's top ``top`` by time together."""
    p = pairs[pairs["dur"] >= min_toi]
    if p.empty:
        return p
    long = pd.concat([p.assign(me=p["a"]), p.assign(me=p["b"])])
    long["rk"] = long.groupby(["me", "team"])["dur"].rank(method="first", ascending=False)
    keep = long[long["rk"] <= top][["a", "b", "team"]].drop_duplicates()
    return p.merge(keep, on=["a", "b", "team"]).sort_values(["team", "a", "dur"], ascending=[True, True, False])


def team_gp(shifts: pd.DataFrame) -> int:
    g = shifts[["game_id", "team_id"]].drop_duplicates()
    return int(g.groupby("team_id").size().max()) if len(g) else 0


def build(start_year: int) -> dict | None:
    shifts, shots = load_inputs(start_year)
    if shifts.empty:
        return None
    goalies, names = load_people(start_year)
    st = build_stints(shifts, goalies)
    if st.empty:
        return None
    st = attribute_shots(st, shots)
    on, pairs = aggregate(st)
    gp = team_gp(shifts)
    min_toi = min_toi_seconds(gp, start_year)
    kept = select_pairs(pairs, min_toi)
    ids = set(kept["a"]) | set(kept["b"])
    on = on[on["player"].isin(ids)].sort_values(["player", "team"])
    abbr = (shifts[["team_id", "team_abbrev"]].drop_duplicates("team_id").set_index("team_id")["team_abbrev"].to_dict())
    r2 = lambda v: round(float(v), 2)  # noqa: E731
    return {
        "season": f"{start_year}{start_year + 1}",
        "built_at": utc_now_iso(),
        "games": int(shifts["game_id"].nunique()),
        "team_gp": gp,
        "season_games": season_games(start_year),
        "min_toi": min_toi,
        "names": {str(int(p)): names.get(int(p), ["", str(int(p)), ""]) for p in sorted(ids)},
        "on_cols": ["player", "team", "toi", "xgf", "xga"],
        "on": [[int(r.player), abbr.get(int(r.team), str(r.team)), int(round(r.dur)), r2(r.xgf), r2(r.xga)]
               for r in on.itertuples(index=False)],
        "pair_cols": ["a", "b", "team", "toi", "xgf", "xga"],
        "pairs": [[int(r.a), int(r.b), abbr.get(int(r.team), str(r.team)), int(round(r.dur)), r2(r.xgf), r2(r.xga)]
                  for r in kept.itertuples(index=False)],
    }


def check(doc: dict) -> None:
    """Internal consistency: together never exceeds either player's on-ice total
    on that team, xG together never exceeds his on-ice xG, every id is named."""
    on = {(r[0], r[1]): r for r in doc["on"]}
    for a, b, team, toi, xgf, xga in doc["pairs"]:
        assert a < b, (a, b)
        assert toi >= doc["min_toi"], (a, b, toi)
        for p in (a, b):
            o = on[(p, team)]
            assert toi <= o[2], (p, team, toi, o)
            assert xgf <= o[3] + 0.011 and xga <= o[4] + 0.011, (p, team, xgf, xga, o)
            assert str(p) in doc["names"]


def main(argv=None):
    argv = list(argv or [])
    years = [START_YEAR]
    if "--prev" in argv:
        years = [PREV_START_YEAR]
    if "--season" in argv:
        years = [int(argv[argv.index("--season") + 1])]
    if "--all" in argv:
        years = [PREV_START_YEAR, START_YEAR]
    written = 0
    for y in years:
        t0 = time.time()
        doc = build(y)
        if not doc or not doc["pairs"]:
            print(f"  wowy {y}: no 5v5 pairs yet")
            continue
        check(doc)
        path = out_path(y)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        doc = keep_if_unchanged(read_json(path), doc, keys=VOLATILE_KEYS | {"built_at"})
        if atomic_write_json(path, doc, min_items=1, indent=None, separators=(",", ":"), label=f"wowy_{y}"):
            written += len(doc["pairs"])
        print(f"  wowy {y}-{(y + 1) % 100:02d}: {doc['games']} games, {len(doc['pairs'])} pairs "
              f"(>= {doc['min_toi'] / 60:.0f} min), {len(doc['on'])} players, "
              f"{os.path.getsize(path) / 1024:.0f} KB, {time.time() - t0:.1f}s")
    return {"status": "ok" if written else "skip", "rows_written": written}


if __name__ == "__main__":
    os.chdir(PIPELINE_DIR)
    main(sys.argv[1:])
