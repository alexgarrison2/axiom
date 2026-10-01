"""Shooter handedness (``shootsCatches``) for the off-wing feature.

``pipeline/player_hand.json`` (read by xG v1) has 1,137 entries and every one
is ``"U"``, so v1's off-wing flag is always 0.  v2 builds a real map:

  1. NHL team rosters ``/v1/roster/{team}/{season}`` (explicit season ids),
     cached in the lake as ``raw/roster/{season}/{team}.json.gz`` by the lake
     fetcher (``python -m bu.xg.handedness --fetch``, <= 2 rps).
  2. MoneyPuck ``shooterLeftRight`` for anyone the rosters miss (D3).

The result is committed as ``bu/xg/models/handedness.json`` ({player_id: "L"|"R"})
so the live run needs no extra requests.  Unknown shooters get NaN, which the
model treats as missing (it is trained with the same gaps).
"""
from __future__ import annotations

import argparse
import json
import os

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
HAND_PATH = os.path.join(HERE, "models", "handedness.json")


def load(path: str = HAND_PATH) -> dict[int, str]:
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        d = json.load(f)
    return {int(k): v for k, v in d.items() if v in ("L", "R")}


def save(hand: dict[int, str], path: str = HAND_PATH) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out = {str(k): hand[k] for k in sorted(hand)}
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, separators=(",", ":"), sort_keys=False)
        f.write("\n")
    os.replace(tmp, path)


def from_lake_rosters(lake_root: str | None = None) -> dict[int, str]:
    from bu.lake.crosswalk import roster_rows
    from bu.lake.fetch import read_raw
    from bu.lake.paths import Lake
    lake = Lake(lake_root)
    base = os.path.join(lake.raw_dir, "roster")
    out: dict[int, str] = {}
    if not os.path.isdir(base):
        return out
    for season in sorted(os.listdir(base)):
        d = os.path.join(base, season)
        for fn in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            if not fn.endswith(".json.gz"):
                continue
            for r in roster_rows(read_raw(os.path.join(d, fn)), season, fn.split(".")[0]):
                if r.get("shoots") in ("L", "R"):
                    out[int(r["player_id"])] = r["shoots"]
    return out


def from_moneypuck(mp: pd.DataFrame | None) -> dict[int, str]:
    if mp is None or mp.empty or "shooterLeftRight" not in mp.columns:
        return {}
    s = mp[["shooterPlayerId", "shooterLeftRight"]].dropna()
    s = s[s["shooterLeftRight"].isin(["L", "R"])]
    s = s.drop_duplicates("shooterPlayerId", keep="last")
    return {int(p): h for p, h in zip(s["shooterPlayerId"], s["shooterLeftRight"])}


def fetch_rosters(lake_root: str | None, seasons, rps: float = 1.0) -> dict:
    """Fetch the team-season rosters of ``seasons`` that the lake does not have yet."""
    from bu.lake.backfill import season_teams
    from bu.lake.build import schedule_games
    from bu.lake.fetch import Fetcher, Task
    from bu.lake.paths import Lake
    lake = Lake(lake_root)
    tasks = []
    for s in seasons:
        sched = schedule_games(lake, s)
        abbrs = season_teams(lake, s, list(sched["game_id"]) if len(sched) else [])
        tasks += [Task("roster", s, a) for a in abbrs]
    fetcher = Fetcher(lake, rps=min(rps, 2.0), workers_per_host=1)
    return fetcher.run(tasks, label="rosters")


def build(lake_root: str | None = None, mp: pd.DataFrame | None = None, existing: dict | None = None) -> dict[int, str]:
    """Rosters win over MoneyPuck; both win over an existing (older) map."""
    hand = dict(existing or {})
    hand.update(from_moneypuck(mp))
    hand.update(from_lake_rosters(lake_root))
    return hand


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lake-dir")
    ap.add_argument("--seasons", default="", help="season ids to fetch rosters for, e.g. 20212022,20222023")
    ap.add_argument("--fetch", action="store_true", help="fetch missing team-season rosters (<= 2 rps)")
    ap.add_argument("--mp-dir", help="directory with MoneyPuck shots_<year>.zip files")
    ap.add_argument("--out", default=HAND_PATH)
    a = ap.parse_args(argv)
    seasons = [s for s in a.seasons.split(",") if s]
    if a.fetch and seasons:
        print(fetch_rosters(a.lake_dir, seasons))
    mp = None
    if a.mp_dir:
        from bu.xg.moneypuck import load_dir
        mp = load_dir(a.mp_dir, columns=["shooterPlayerId", "shooterLeftRight"])
    hand = build(a.lake_dir, mp, existing=load(a.out))
    save(hand, a.out)
    n_l = sum(v == "L" for v in hand.values())
    print(f"handedness: {len(hand)} players ({n_l} L, {len(hand) - n_l} R) -> {a.out}")


if __name__ == "__main__":
    main()
