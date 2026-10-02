"""Regenerate the predictions_detailed.csv fixtures (contract v2).

    cd pipeline && python3 fixtures/make_fixtures.py

The fixtures are built by the real row builder (predict_games.build_rows)
from synthetic schedules, so they always match the contract in
pipeline/CONTRACT.md.  The game model is the committed one (ml_predict);
goalie lines, previous-season PP/PK ranks and H2H come from the committed
2025-26 archive (a network call is only used for the previous-season ranks,
with a hardcoded fallback).

Files
-----
predictions_opening_night.csv   2026-09-29 evening: every team at 0 GP
    (no L7 / H2H / ranks / goalie season line; previous-season values only
    in *_prev), CAR = last season's Cup finalist (its 2025-26 playoff games
    must not leak in), one FINAL game with a frozen pregame prediction, one
    LIVE game that was never predicted pregame (no_pregame_prediction), a
    pick'em with odds, and next-day games (TOR on a back-to-back).
predictions_week3.csv           2026-10-20: 6-9 GP per team (one team at 3
    GP -> 'L3'), a pair that met once and a pair that met twice this season,
    a team with >= 5 home games (home_loc_record), a long road trip, ranks
    still gated (not every team has 10 GP).
predictions_playoffs.csv        2027-04-24: a first-round game (game_type 03)
    with the career playoff goalie line and 'PO G<n>' numbering.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE = os.path.dirname(HERE)
if PIPELINE not in sys.path:
    sys.path.insert(0, PIPELINE)

import pandas as pd  # noqa: E402

import predict_games as P  # noqa: E402
import season_context as SC  # noqa: E402

UTC = timezone.utc

COMMON = {"CAR": "Hurricanes", "FLA": "Panthers", "TOR": "Maple Leafs", "MTL": "Canadiens",
          "BOS": "Bruins", "NYR": "Rangers", "VAN": "Canucks", "EDM": "Oilers", "VGK": "Golden Knights",
          "CHI": "Blackhawks", "NYI": "Islanders", "PHI": "Flyers", "PIT": "Penguins", "COL": "Avalanche",
          "LAK": "Kings", "TBL": "Lightning", "DAL": "Stars", "MIN": "Wild", "WPG": "Jets"}

# 2025-26 final PP/PK ranks (stats API team/summary; they match the
# gamecenter right-rail ranks) - fallback when offline.
PREV_RANKS = {"EDM": (1, 20), "TOR": (15, 8), "NYI": (30, 10), "VAN": (14, 32), "PHI": (32, 22),
              "PIT": (7, 6)}

SEASON_START = "2026-09-29"


def g(gid, day, hhmm, gtype, state, home, away, hs=None, as_=None, period="REG"):
    """Synthetic normalized game; ``hhmm`` is UTC and rolls into the next UTC
    day for late (western) starts, as in the real schedule (gameDate stays
    the NHL local date)."""
    hh = int(hhmm[:2])
    start_day = day if hh >= 12 else (datetime.fromisoformat(day) + timedelta(days=1)).strftime("%Y-%m-%d")
    start = f"{start_day}T{hhmm}:00Z"
    return {"id": gid, "date": day, "start_utc": start, "type": gtype, "state": state, "home": home,
            "away": away, "home_score": hs, "away_score": as_, "last_period": period}


def sched_entry(gm, state=None, h_goalie=None, a_goalie=None, h_status="Unconfirmed", a_status="Unconfirmed"):
    """upcoming_games.json entry for a synthetic game."""
    return {
        "id": gm["id"], "gameDate": gm["date"], "startTimeUTC": gm["start_utc"], "gameType": gm["type"],
        "gameState": state or gm["state"], "homeTeam": COMMON[gm["home"]], "awayTeam": COMMON[gm["away"]],
        "homeTeamAbbrev": gm["home"], "awayTeamAbbrev": gm["away"],
        "homeGoalieConfirmed": h_goalie, "homeGoalieStatus": h_status,
        "homeGoalieSource": "dailyfaceoff" if h_goalie else None,
        "awayGoalieConfirmed": a_goalie, "awayGoalieStatus": a_status,
        "awayGoalieSource": "dailyfaceoff" if a_goalie else None,
    }


def preseason(tris, first_id=2026010001):
    games, gid = [], first_id
    for i, t in enumerate(sorted(tris)):
        games.append(g(gid, "2026-09-26", "23:00", 1, "FINAL", t, "DAL", 3, 2))
        gid += 1
    return games


def club(games, tris):
    return {t: SC.team_games(games, t) for t in tris}


def real_goalie_lines(blank_current=True):
    from fetch_nhl_goalie_stats import load_goalie_season_lines
    lines = load_goalie_season_lines()
    if blank_current:
        lines = {n: {"cur": None, "prev": v.get("prev")} for n, v in lines.items()}
    return lines


def prev_ranks():
    try:
        teams = pd.read_csv(os.path.join(PIPELINE, "nhl_teams.csv"))
        ranks = SC.fetch_prev_season_ranks({int(i): t for i, t in zip(teams["NHL Team ID"], teams["Team Tricode"])})
        if len(ranks) == 32:
            return ranks
    except Exception:
        pass
    return {t: {"pp_rank": a, "pk_rank": b} for t, (a, b) in PREV_RANKS.items()}


def fixture_sim():
    """The game simulator on the committed parameters and season-start pack only (no
    current-season CSVs), so the fixtures do not move with the live season."""
    from bu.sim.live import SimServer
    from bu.sim.params import load_params, state_pack_path
    from bu.sim.state import SimState
    from season import SEASON_ID
    teams = pd.read_csv(os.path.join(PIPELINE, "nhl_teams.csv"))
    tri = {str(t): int(i) for t, i in zip(teams["Team Tricode"], teams["NHL Team ID"])}
    return SimServer(load_params(), SimState.load(state_pack_path(SEASON_ID)), tri)


def base_inputs(now, schedule, club_games, goalie_lines, ml, st_table=None, existing=None, odds=None):
    inp = P.Inputs(now=now, schedule=schedule)
    inp.club_games = club_games
    inp.standings_gp = {}
    inp.st_table = st_table or {}
    inp.st_prev = prev_ranks()
    inp.hist_gamestats = pd.read_csv(os.path.join(PIPELINE, "nhl_historical_gamestats.csv"),
                                     usecols=["game_id", "team", "opponent", "result"])
    inp.goalie_lines = goalie_lines
    inp.goalie_po = {"Sergei Bobrovsky": "61-50 | .907 | 2.71", "Jacob Markstrom": "14-17 | .911 | 2.88",
                     "Frederik Andersen": "38-33 | .913 | 2.60"}
    inp.odds = odds or {}
    inp.existing = existing or {}
    inp.ml = ml
    inp.sim = fixture_sim()
    inp.gate_state = {"backtest": {"n": 64, "roi": 0.14, "roi_ci_low": -0.095, "roi_ci_high": 0.379,
                                   "clv_mean": -0.052}, "rolling": {"n": 0}}
    inp.tiers = P._load_tiers()
    inp.full_names = {t: t for t in COMMON}
    inp.vs_opp = lambda name, tri, opp: {"vs_opp_gp": 9, "opponent": opp, "seasons": "2016-17..2026-27",
                                         "record": "5-3-1", "sv": 0.912, "gaa": 2.61, "gp": 9,
                                         "toi_min": 530.0, "win_pct": 0.556, "label": f"Career vs {opp} (9 GP)"}
    return inp


def odds_for(gm, home_price, away_price, fetched="2026-09-29T15:00:00Z"):
    return {str(gm["id"]): {"home_ml": home_price, "away_ml": away_price, "source": "bovada",
                            "fetched_at": fetched, "total_line": "6.0", "total_over": -110, "total_under": -110}}


def opening_night(ml):
    lines = real_goalie_lines(blank_current=True)
    reg = [
        g(2026020001, "2026-09-29", "21:00", 2, "FINAL", "CAR", "FLA", 4, 3, "OT"),
        g(2026020002, "2026-09-29", "23:00", 2, "LIVE", "TOR", "MTL", 1, 2),
        g(2026020004, "2026-09-29", "02:00", 2, "FUT", "VGK", "CHI"),
        g(2026020005, "2026-09-29", "02:30", 2, "FUT", "VAN", "EDM"),
        g(2026020006, "2026-09-30", "23:30", 2, "FUT", "PHI", "PIT"),
        g(2026020008, "2026-09-30", "23:30", 2, "FUT", "TOR", "NYI"),
    ]
    tris = {t for x in reg for t in (x["home"], x["away"])}
    games = preseason(tris) + reg
    goalies = {2026020001: ("Frederik Andersen", "Jacob Markstrom", "Confirmed", "Confirmed"),
               2026020002: ("Sergei Bobrovsky", "Jakub Dobes", "Confirmed", "Confirmed"),
               2026020004: ("Adin Hill", "Spencer Knight", "Likely", "Confirmed"),
               2026020005: ("Kevin Lankinen", "Tristan Jarry", "Confirmed", "Likely"),
               2026020006: ("Dan Vladar", "Arturs Silovs", "Unconfirmed", "Unconfirmed"),
               2026020008: ("Anthony Stolarz", "Ilya Sorokin", "Unconfirmed", "Likely")}
    schedule = [sched_entry(x, h_goalie=goalies[x["id"]][0], a_goalie=goalies[x["id"]][1],
                            h_status=goalies[x["id"]][2], a_status=goalies[x["id"]][3]) for x in reg]
    odds = {}
    odds.update(odds_for(reg[0], -135, 115))
    odds.update(odds_for(reg[2], -110, -120))          # pick'em
    odds.update(odds_for(reg[3], 140, -165))
    odds.update(odds_for(reg[4], -140, 120))
    # 1) the FINAL game was predicted before puck drop (20:00Z) ...
    pre_now = datetime(2026, 9, 29, 20, 0, tzinfo=UTC)
    pre_games = [dict(x, state="FUT", home_score=None, away_score=None) if x["id"] == 2026020001 else x for x in games]
    pre = base_inputs(pre_now, [dict(schedule[0], gameState="FUT")], club(pre_games, tris), lines, ml, odds=odds)
    pre_rows = P.build_rows(pre)
    existing = {r["nhl_game_id"]: r for r in pre_rows}
    # 2) ... and the slate is rebuilt at 23:40Z: CAR-FLA final, TOR-MTL live
    now = datetime(2026, 9, 29, 23, 40, tzinfo=UTC)
    inp = base_inputs(now, schedule, club(games, tris), lines, ml, existing=existing, odds=odds)
    return P.build_rows(inp)


def week3(ml):
    lines = real_goalie_lines(blank_current=False)
    teams = ["TOR", "NYI", "PHI", "PIT", "EDM", "VAN", "COL", "LAK", "BOS", "TBL"]
    # (day, home, away, home score, away score, last period) - all final
    played = [
        ("10-01", "TOR", "NYI", 2, 3, "OT"), ("10-01", "PHI", "PIT", 4, 2, "REG"), ("10-01", "LAK", "COL", 3, 1, "REG"),
        ("10-01", "BOS", "TBL", 2, 1, "REG"), ("10-02", "VAN", "LAK", 1, 4, "REG"),
        ("10-03", "TOR", "PIT", 5, 2, "REG"), ("10-03", "PHI", "NYI", 1, 3, "REG"), ("10-03", "COL", "VAN", 4, 3, "SO"),
        ("10-04", "EDM", "LAK", 3, 2, "REG"),
        ("10-05", "TOR", "BOS", 3, 4, "REG"), ("10-05", "PIT", "PHI", 3, 2, "OT"), ("10-05", "EDM", "COL", 2, 5, "REG"),
        ("10-06", "LAK", "VAN", 2, 3, "REG"),
        ("10-07", "TOR", "PHI", 4, 1, "REG"), ("10-07", "NYI", "PIT", 2, 1, "REG"), ("10-07", "VAN", "COL", 2, 1, "REG"),
        ("10-08", "BOS", "NYI", 3, 2, "REG"),
        ("10-09", "TOR", "EDM", 2, 5, "REG"), ("10-09", "PIT", "COL", 4, 3, "REG"), ("10-09", "PHI", "LAK", 2, 3, "SO"),
        ("10-10", "TBL", "BOS", 1, 2, "REG"), ("10-10", "VAN", "NYI", 3, 1, "REG"),
        ("10-11", "BOS", "EDM", 2, 4, "REG"), ("10-11", "COL", "TOR", 3, 2, "REG"), ("10-11", "LAK", "PIT", 2, 4, "REG"),
        ("10-12", "NYI", "PHI", 5, 2, "REG"),
        ("10-13", "NYI", "EDM", 1, 2, "OT"), ("10-13", "VAN", "TOR", 2, 3, "REG"), ("10-13", "COL", "PIT", 3, 0, "REG"),
        ("10-14", "LAK", "BOS", 3, 2, "REG"), ("10-14", "PHI", "VAN", 2, 1, "REG"),
        ("10-15", "PIT", "EDM", 3, 4, "REG"), ("10-15", "LAK", "TOR", 1, 4, "REG"), ("10-15", "BOS", "COL", 2, 1, "REG"),
        ("10-16", "NYI", "VAN", 3, 2, "REG"),
        ("10-17", "PHI", "EDM", 2, 3, "REG"), ("10-17", "TBL", "COL", 4, 1, "REG"), ("10-17", "BOS", "TOR", 1, 3, "REG"),
        ("10-18", "PIT", "NYI", 2, 3, "REG"), ("10-18", "LAK", "PHI", 3, 2, "REG"), ("10-18", "VAN", "BOS", 4, 2, "REG"),
    ]
    games = []
    for i, (day, h, a, hs, as_, per) in enumerate(played):
        hhmm = "02:00" if h in ("VAN", "LAK", "EDM", "COL") else "23:00"
        games.append(g(2026020100 + i, f"2026-{day}", hhmm, 2, "OFF", h, a, hs, as_, per))
    reg = [
        g(2026020300, "2026-10-20", "23:00", 2, "FUT", "TOR", "NYI"),   # met once before (10-01)
        g(2026020301, "2026-10-20", "23:30", 2, "FUT", "PIT", "PHI"),   # met twice before
        g(2026020302, "2026-10-20", "02:00", 2, "FUT", "LAK", "TBL"),   # TBL at 3 GP -> 'L3'
        g(2026020303, "2026-10-20", "02:30", 2, "FUT", "VAN", "EDM"),   # EDM 6th straight road game
    ]
    games += reg
    tris = set(teams)
    games += preseason(tris)
    schedule = [sched_entry(reg[0], h_goalie="Anthony Stolarz", a_goalie="Ilya Sorokin", h_status="Confirmed",
                            a_status="Likely"),
                sched_entry(reg[1], h_goalie="Arturs Silovs", a_goalie="Dan Vladar"),
                sched_entry(reg[2], h_goalie="Darcy Kuemper", a_goalie="Andrei Vasilevskiy", h_status="Likely",
                            a_status="Confirmed"),
                sched_entry(reg[3], h_goalie="Kevin Lankinen", a_goalie="Stuart Skinner")]
    odds = {}
    odds.update(odds_for(reg[0], -125, 105, "2026-10-20T14:00:00Z"))
    odds.update(odds_for(reg[1], 110, -130, "2026-10-20T14:00:00Z"))
    odds.update(odds_for(reg[3], 135, -160, "2026-10-20T14:00:00Z"))
    st = SC.special_teams_table(
        [{"teamId": 10, "powerPlayGoalsFor": 7, "ppOpportunities": 26}, {"teamId": 2, "powerPlayGoalsFor": 3,
                                                                          "ppOpportunities": 24}],
        [{"teamId": 10, "ppGoalsAgainst": 5, "timesShorthanded": 25}, {"teamId": 2, "ppGoalsAgainst": 4,
                                                                         "timesShorthanded": 27}],
        {t: 8 for t in teams} | {"TBL": 3}, {10: "TOR", 2: "NYI"}, teams)
    now = datetime(2026, 10, 20, 16, 0, tzinfo=UTC)
    inp = base_inputs(now, schedule, club(games, tris), lines, ml, st_table=st, odds=odds)
    return P.build_rows(inp)


def playoffs(ml):
    lines = real_goalie_lines(blank_current=False)
    games = [g(2026020800 + i, f"2027-04-{i + 1:02d}", "23:00", 2, "OFF", "TOR" if i % 2 else "BOS",
               "BOS" if i % 2 else "TOR", 3, 2) for i in range(10)]
    games += [g(2026030111, "2027-04-19", "23:00", 3, "OFF", "TOR", "BOS", 4, 1),
              g(2026030112, "2027-04-21", "23:00", 3, "OFF", "TOR", "BOS", 2, 3, "OT"),
              g(2026030113, "2027-04-24", "23:00", 3, "FUT", "BOS", "TOR")]
    reg = games[-1]
    schedule = [sched_entry(reg, h_goalie="Jeremy Swayman", a_goalie="Sergei Bobrovsky", h_status="Confirmed",
                            a_status="Confirmed")]
    odds = odds_for(reg, -105, -115, "2027-04-24T14:00:00Z")
    now = datetime(2027, 4, 24, 15, 0, tzinfo=UTC)
    inp = base_inputs(now, schedule, club(games, {"TOR", "BOS"}), lines, ml, odds=odds)
    return P.build_rows(inp)


def main():
    from ml_predict import MLPredictor
    from season import read_season_csv
    ml = MLPredictor(read_season_csv("gamestats"))
    for name, fn in (("predictions_opening_night.csv", opening_night), ("predictions_week3.csv", week3),
                     ("predictions_playoffs.csv", playoffs)):
        rows = fn(ml)
        P.write_rows(rows, [os.path.join(HERE, name)])


if __name__ == "__main__":
    main()
