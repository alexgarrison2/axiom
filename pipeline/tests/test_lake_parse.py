"""sm-lake-1: raw payload normalisation (sides, strength, on-ice, shifts, lineups, crosswalk)."""
import gzip
import json
import os

import numpy as np
import pandas as pd
import pytest

from bu.lake import crosswalk as CW
from bu.lake.onice import assign_on_ice
from bu.lake.parse import mmss, parse_game, shots_table, split_situation
from bu.lake.sides import attacks_right, infer_period_sides

TESTDATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bu", "lake", "testdata", "raw")


def _raw(endpoint, season, gid):
    p = os.path.join(TESTDATA, endpoint, season, f"{gid}.json.gz")
    with gzip.open(p, "rb") as f:
        return json.loads(f.read())


def _game(season, gid):
    return parse_game(_raw("pbp", season, gid), _raw("shifts", season, gid), _raw("boxscore", season, gid),
                      _raw("rightrail", season, gid), season=season)


@pytest.fixture(scope="module")
def g2023():
    return _game("20232024", 2023020500)


@pytest.fixture(scope="module")
def g2010():
    return _game("20102011", 2010020165)


@pytest.fixture(scope="module")
def g2019():
    return _game("20192020", 2019020758)


# ------------------------------------------------------------------ small pieces

def test_clock_and_situation_parsing():
    assert mmss("12:34") == 754 and mmss(None) is None and mmss("bad") is None
    assert split_situation("1551") == (1, 5, 5, 1)
    assert split_situation("0651") == (0, 6, 5, 1)
    assert split_situation(None) is None and split_situation("15") is None


def test_side_vote_from_zone_and_coordinates():
    # Home attacks +x (defends left): home O-zone events at x>0, away O-zone events at x<0.
    ev = pd.DataFrame({
        "period": [1] * 6 + [2] * 2, "period_type": ["REG"] * 8,
        "x": [80, 60, -70, -50, 75, -20, -80, 70],
        "zone_code": ["O", "O", "O", "D", "D", "N", "O", "O"],
        "event_team_is_home": [True, True, False, True, False, True, True, False],
        "home_def_side_raw": [None] * 8,
    })
    sides = infer_period_sides(ev).set_index("period")
    assert sides.loc[1, "home_def_side"] == "left" and sides.loc[1, "side_source"] == "inferred"
    assert sides.loc[2, "home_def_side"] == "right"
    assert attacks_right([True, False, None], ["left", "left", "left"]) == [True, False, None]


def test_raw_side_wins_when_present():
    ev = pd.DataFrame({"period": [1, 1], "period_type": ["REG", "REG"], "x": [80, 70],
                       "zone_code": ["O", "O"], "event_team_is_home": [True, True],
                       "home_def_side_raw": ["right", "right"]})
    s = infer_period_sides(ev).iloc[0]
    assert s["home_def_side"] == "right" and s["side_source"] == "raw" and s["home_def_side_vote"] == "left"


def test_on_ice_boundary_rules_and_goalies():
    shifts = pd.DataFrame({
        "player_id": [1, 2, 3, 4, 90, 91],
        "team_id": [10, 10, 20, 20, 10, 20],
        "period": [1] * 6,
        "start_s": [0, 30, 0, 30, 0, 0],
        "end_s": [30, 60, 30, 60, 1200, 1200],
        "is_goalie": [False, False, False, False, True, True],
    })
    ev = pd.DataFrame({
        "period": [1, 1, 1], "period_type": ["REG"] * 3, "period_seconds": [30, 30, 45],
        "type_code": [516, 502, 506],          # stoppage at 30, faceoff at 30, shot at 45
        "sit_home_sk": [1, 1, 1], "sit_home_g": [1, 1, 1], "sit_away_sk": [1, 1, 1], "sit_away_g": [1, 1, 1],
    })
    out = assign_on_ice(ev, shifts, home_team_id=10)
    assert out.loc[0, "home_skaters"] == [1] and out.loc[0, "away_skaters"] == [3]   # shift ending at t
    assert out.loc[1, "home_skaters"] == [2] and out.loc[1, "away_skaters"] == [4]   # shift starting at t
    assert out.loc[2, "home_goalie_id"] == 90 and out.loc[2, "away_goalie_id"] == 91
    assert list(out["onice_rule"]) == ["primary"] * 3


# --------------------------------------------------------------- real payloads

def test_2023020500_shift_duplicates_and_overlaps(g2023):
    games, shifts = g2023["games"].iloc[0], g2023["shifts"]
    assert games["n_shift_dups"] == 295                   # DESIGN §2.1 example
    assert games["n_shift_overlaps_merged"] > 0
    assert not shifts.duplicated(["player_id", "period", "start_s", "end_s"]).any()
    # No player overlaps himself after the merge.
    s = shifts.sort_values(["player_id", "period", "start_s"])
    prev_end = s.groupby(["player_id", "period"])["end_s"].shift()
    assert not (s["start_s"] < prev_end).any()
    assert set(shifts["is_goalie"].unique()) == {True, False}


def test_2023020500_events_are_complete(g2023):
    ev, g = g2023["events"], g2023["games"].iloc[0]
    assert not ev.duplicated(["game_id", "event_id"]).any()
    assert g["side_source"] == "raw"
    assert (ev["home_def_side"] == ev["home_def_side_vote"]).all()
    assert (g["home_goals_pbp"], g["away_goals_pbp"]) == (g["home_score"], g["away_score"])
    shots = shots_table(ev)
    assert len(shots) and shots["x"].notna().all()
    # Shooting team = the shooter's roster team, also for blocked shots.
    roster = {r["playerId"]: r["teamId"] for r in _raw("pbp", "20232024", 2023020500)["rosterSpots"]}
    assert (shots["shooting_team_id"] == shots["shooter_id"].map(roster)).all()
    five = shots[shots["strength"] == "5v5"]
    assert (five["home_on_n"] == 5).mean() > 0.97 and (five["away_on_n"] == 5).mean() > 0.97
    ub = shots[shots["is_unblocked"]]
    assert ub["shot_distance"].between(0, 200).all() and ub["shot_distance"].median() < 45
    assert ((shots["onice_rule"] == "primary") | (shots["onice_rule"] == "alt")).mean() > 0.97


def test_2023020500_lineups(g2023):
    lu = g2023["lineups"]
    dressed = lu[lu["status"] == "dressed"]
    assert len(dressed) == 40 and dressed.groupby("team_id").size().tolist() == [20, 20]
    assert (lu["status"] == "scratched").sum() >= 1
    assert dressed["starter"].eq(True).sum() == 2
    played = dressed[dressed["toi_s"] > 0]
    assert (played["n_shifts"] > 0).all()
    assert not lu.duplicated(["game_id", "player_id"]).any()


def test_2010_inferred_sides_and_shootout(g2010):
    ev, g = g2010["events"], g2010["games"].iloc[0]
    assert g["last_period_type"] == "SO"
    reg = ev[~ev["is_shootout"]]
    assert set(reg["side_source"]) == {"inferred"}
    assert ev.loc[ev["is_shootout"], "home_skaters"].isna().all()       # no on-ice in the shootout
    # Final includes the shootout winner's +1; PBP goals (reg+OT) do not.
    assert g["home_goals_pbp"] + g["away_goals_pbp"] == g["home_score"] + g["away_score"] - 1
    shots = shots_table(ev)
    ub = shots[shots["is_unblocked"] & ~shots["empty_net_against"].eq(True)]
    assert (ub["shot_distance"] < 89).mean() > 0.97
    z = ub[ub["zone_code"].isin(["O", "D"]) & (ub["x"].abs() >= 26)]
    assert (np.where(z["zone_code"] == "O", z["x_norm"] > 0, z["x_norm"] < 0)).all()
    # 3-on-3 overtime is not in 2010-11 (4v4), strengths come from situationCode.
    assert set(ev.loc[ev["period"] == 4, "strength"].dropna()) <= {"4v4", "4v3", "3v4", "5v4", "4v5", "3v3"}


def test_2019_situation_code_error_is_flagged_not_hidden(g2019):
    # Two minors to one player (interference + unsportsmanlike) are coded 5v3 ("1531") by the
    # feed for ~4 minutes; the shift charts show 4 home skaters. The lake keeps both and marks it.
    ev = g2019["events"]
    window = ev[(ev["period"] == 2) & ev["period_seconds"].between(271, 499) & (ev["situation_code"] == "1531")]
    assert len(window) > 10
    assert (window["onice_rule"] == "mismatch").all()
    assert (window["home_on_n"] == 4).all()


# -------------------------------------------------------------------- crosswalk

def test_name_keys_and_resolve():
    assert CW.name_key("Tim Stützle") == "tim stutzle"
    assert CW.name_key("J.T. Miller") == "j t miller"
    assert CW.name_key("Alex Ovechkin", first_alias=True) == "alexander ovechkin"
    lineups = pd.DataFrame([
        {"player_id": 1, "first_name": "Sebastian", "last_name": "Aho", "position": "C", "team_abbrev": "CAR",
         "sweater_number": 20, "status": "dressed"},
        {"player_id": 2, "first_name": "Sebastian", "last_name": "Aho", "position": "D", "team_abbrev": "NYI",
         "sweater_number": 25, "status": "dressed"},
        {"player_id": 3, "first_name": "Tim", "last_name": "Stützle", "position": "C", "team_abbrev": "OTT",
         "sweater_number": 18, "status": "scratched"},
    ])
    rosters = pd.DataFrame([{"season": "20252026", "player_id": 3, "team_abbrev": "OTT", "first_name": "Tim",
                             "last_name": "Stützle", "position": "C", "sweater_number": 18, "shoots": "L",
                             "birth_date": "2002-01-15", "birth_country": "DEU", "height_in": 74, "weight_lb": 196}])
    players = CW.build_players(lineups, rosters, "20252026")
    assert len(players) == 3 and not players.duplicated("player_id").any()
    p3 = players.set_index("player_id").loc[3]
    assert p3["birth_date"] == "2002-01-15" and bool(p3["on_season_roster"]) and p3["games_scratched"] == 1
    assert CW.resolve(players, "Sebastian Aho", team="NYI") == 2
    assert CW.resolve(players, "Sebastian Aho", number=20) == 1
    assert CW.resolve(players, "Tim Stutzle") == 3
    assert CW.resolve(players, "Nobody Here") is None
