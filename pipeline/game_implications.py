"""game_implications.py - how much tonight's result moves each team's playoff odds.

For every game on today's slate, four forced results (home regulation win,
home OT/SO win, away OT/SO win, away regulation win) are simulated with the
season_simulator engine.  All scenarios and the baseline share the same
random numbers (common random numbers), so the differences come from the
forced game rather than simulation noise, and the published "current" odds
come from the same run as the scenarios.

Guards
------
* The baseline projections (public/data/season_projections.json) must be
  for this season (``season_id``); otherwise nothing is written except an
  empty file saying why.  This stops last season's final table (every team
  at 0% or 100%) from being shown next to this season's scenarios.
* When the largest swing on the slate is under MIN_SWING_PTS (3 points of
  playoff probability, typical for October) ``games`` is empty: the
  "biggest games tonight" strip has nothing meaningful to show.

Output (public/data/game_implications.json + pipeline copy):
  {season_id, generated_at, baseline_generated_at, n_sims, max_swing_pts,
   min_swing_pts, reason, games: [{game_id, date, home_abbrev, away_abbrev,
   home_current_playoff_pct, away_current_playoff_pct, home_current_avg_pts,
   away_current_avg_pts, swing_pts, scenarios: {home_reg_win: {...}, ...}}]}
"""
from __future__ import annotations

import json
import os
import shutil
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from season import SEASON_ID, today_local  # noqa: E402
from season_simulator import (  # noqa: E402
    OUTCOMES, Engine, build_team_map, fetch_current_standings, fetch_remaining_schedule, load_csv,
    load_json, make_probabilities)

N_SIMS = 2000
MIN_SWING_PTS = 3.0
PUBLIC_PATH = os.path.join(SCRIPT_DIR, "..", "public", "data", "game_implications.json")
LOCAL_PATH = os.path.join(SCRIPT_DIR, "game_implications.json")
PROJECTIONS_PATH = os.path.join(SCRIPT_DIR, "..", "public", "data", "season_projections.json")


def baseline_ok(projections):
    """(ok, reason) for the season_projections baseline."""
    if not projections:
        return False, "season_projections.json missing"
    sid = str(projections.get("season_id") or "")
    if sid != SEASON_ID:
        return False, f"season_projections.json is for season {sid or 'unknown'}, not {SEASON_ID}"
    return True, ""


def game_swing(scen, home, away):
    """Largest change in either team's playoff % between the best and worst result."""
    sw = 0.0
    for side in ("home", "away"):
        vals = [s[f"{side}_playoff_pct"] for s in scen.values() if s.get(f"{side}_playoff_pct") is not None]
        if vals:
            sw = max(sw, max(vals) - min(vals))
    return round(sw, 1)


def implications(engine, today_games):
    base = engine.playoff_pct()
    out = []
    for game in today_games:
        gid = str(game.get("id", ""))
        h, a = game.get("homeTeamAbbrev", ""), game.get("awayTeamAbbrev", "")
        if gid not in engine.game_pos:
            print(f"  {a}@{h} ({gid}) is not in the remaining schedule - skipped")
            continue
        scen = {}
        for outcome in OUTCOMES:
            r = engine.playoff_pct(forced=(gid, outcome))
            scen[outcome] = {"home_playoff_pct": r[h][0], "away_playoff_pct": r[a][0],
                             "home_avg_pts": r[h][1], "away_avg_pts": r[a][1]}
        out.append({
            "game_id": int(gid), "date": game.get("gameDate"), "home_abbrev": h, "away_abbrev": a,
            "home_current_playoff_pct": base[h][0], "away_current_playoff_pct": base[a][0],
            "home_current_avg_pts": base[h][1], "away_current_avg_pts": base[a][1],
            "swing_pts": game_swing(scen, h, a), "scenarios": scen,
        })
    return out


def _write_output(output):
    try:
        with open(PUBLIC_PATH) as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = None
    volatile = ("generated_at", "baseline_generated_at")
    if isinstance(old, dict) and {k: v for k, v in old.items() if k not in volatile} == \
            {k: v for k, v in output.items() if k not in volatile}:
        print("  game_implications.json unchanged - not rewritten")
        return
    tmp = LOCAL_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(output, f, indent=2)
    os.replace(tmp, LOCAL_PATH)
    shutil.copyfile(LOCAL_PATH, PUBLIC_PATH + ".tmp")
    os.replace(PUBLIC_PATH + ".tmp", PUBLIC_PATH)
    print(f"  Written -> {os.path.relpath(PUBLIC_PATH, SCRIPT_DIR)}")


def compute_game_implications(n_sims=N_SIMS, now=None, engine=None, upcoming=None, projections=None):
    from io_utils import utc_now_iso
    print(f"[game_implications] {n_sims} sims per scenario...")
    doc = {"season_id": SEASON_ID, "generated_at": utc_now_iso(), "baseline_generated_at": None,
           "n_sims": n_sims, "min_swing_pts": MIN_SWING_PTS, "max_swing_pts": None, "reason": "", "games": []}
    if projections is None:
        try:
            projections = load_json(PROJECTIONS_PATH)
        except (OSError, ValueError):
            projections = None
    ok, why = baseline_ok(projections)
    if not ok:
        print(f"[game_implications] refusing baseline: {why}")
        doc["reason"] = why
        _write_output(doc)
        return {"status": "skip", "reason": why}
    doc["baseline_generated_at"] = projections.get("generated_at")

    if upcoming is None:
        try:
            upcoming = load_json(os.path.join(SCRIPT_DIR, "upcoming_games.json"))
        except (OSError, ValueError):
            upcoming = []
    today = today_local(now).isoformat()
    today_games = [g for g in upcoming if g.get("gameDate") == today and int(g.get("gameType") or 2) == 2]
    if not today_games:
        doc["reason"] = f"no regular-season games on {today}"
        _write_output(doc)
        return {"status": "ok", "rows_written": 0, "reason": doc["reason"]}

    if engine is None:
        team_map = build_team_map(load_csv(os.path.join(SCRIPT_DIR, "nhl_teams.csv")))
        engine = Engine(fetch_current_standings(now), fetch_remaining_schedule(now),
                        make_probabilities(team_map), n_sims=n_sims)
    games = implications(engine, today_games)
    mx = max((g["swing_pts"] for g in games), default=0.0)
    doc["max_swing_pts"] = mx
    if mx < MIN_SWING_PTS:
        doc["reason"] = f"largest swing {mx:.1f} pts < {MIN_SWING_PTS:.0f}"
        print(f"[game_implications] {doc['reason']} - no games published")
    else:
        doc["games"] = sorted(games, key=lambda g: -g["swing_pts"])
    _write_output(doc)
    print(f"[game_implications] Done - {len(doc['games'])} games written (max swing {mx:.1f}).")
    return {"status": "ok", "rows_written": len(doc["games"])}


if __name__ == "__main__":
    compute_game_implications()
