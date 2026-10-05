"""Player props: Bovada parsing, probability helpers, book de-vig and the board."""
import numpy as np
import pandas as pd
import pytest

import fetch_props
import prop_board
import prop_model as pm


def _price(american, handicap=None):
    p = {"american": american}
    if handicap is not None:
        p["handicap"] = handicap
    return p


EVENT = {"displayGroups": [
    {"description": "Shots on Goal", "markets": [
        {"description": "Total Shots on Goal", "period": {"abbreviation": "G"},
         "outcomes": [{"description": "Over", "price": _price("-110", "53.5")}]},
        {"description": "Total Shots On Goal - Jackson Blake (CAR)", "period": {"abbreviation": "G"},
         "outcomes": [{"description": "Over", "price": _price("-180", "1.5")},
                      {"description": "Under", "price": _price("+150", "1.5")}]},
        {"description": "Total Shots On Goal - Nikolaj Ehlers (CAL)", "period": {"abbreviation": "1P"},
         "outcomes": [{"description": "Over", "price": _price("+200", "0.5")}]},
    ]},
    {"description": "Goalscorers", "markets": [
        {"description": "Anytime Goalscorer", "period": {"abbreviation": "G"},
         "outcomes": [{"description": "Jackson Blake (CAR)", "price": _price("+300")},
                      {"description": "Sebastian Aho (CAR)", "price": _price("EVEN")}]},
        {"description": "Player To Score 1st Goal", "period": {"abbreviation": "G"},
         "outcomes": [{"description": "Jackson Blake (CAR)", "price": _price("+1400")}]},
    ]},
    {"description": "Points/Assists", "markets": [
        {"description": "Player To Record 1 Or More Points", "period": {"abbreviation": "G"},
         "outcomes": [{"description": "Sebastian Aho (CAR)", "price": _price("-160")}]},
        {"description": "Assists Milestones - Sebastian Aho (CAR)", "period": {"abbreviation": "G"},
         "outcomes": [{"description": "To Record 1+ Assists", "price": _price("+120")},
                      {"description": "To Record 2+ Assists", "price": _price("+900")}]},
        {"description": "Player To Record 1 Or More Powerplay Points", "period": {"abbreviation": "G"},
         "outcomes": [{"description": "Sebastian Aho (CAR)", "price": _price("+225")}]},
    ]},
]}


def test_parse_event_reads_player_markets_and_skips_period_and_team_markets():
    players = fetch_props.parse_event(EVENT)
    assert set(players) == {"Jackson Blake", "Sebastian Aho"}
    blake, aho = players["Jackson Blake"], players["Sebastian Aho"]
    assert blake["sog"] == [{"line": 1.5, "over": -180, "under": 150}]
    assert blake["atg"] == 300 and "first" not in blake
    assert aho == {"tag": "CAR", "atg": 100, "p1": -160, "a1": 120, "a2": 900, "ppp1": 225}


def test_poisson_and_negative_binomial_tails():
    assert pm.p_at_least_poisson([1.0], 1)[0] == pytest.approx(1 - np.exp(-1))
    assert pm.p_at_least_poisson([2.0], 2)[0] == pytest.approx(1 - 3 * np.exp(-2))
    # A huge size collapses the negative binomial to the Poisson.
    assert pm.p_at_least_nb([2.4], 3, size=1e7)[0] == pytest.approx(pm.p_at_least_poisson([2.4], 3)[0], abs=1e-5)
    # Overdispersion fattens both tails: a high line is likelier than under the Poisson.
    assert pm.p_at_least_nb([2.4], 5, size=5)[0] > pm.p_at_least_poisson([2.4], 5)[0]


def test_american_round_trip():
    assert pm.american_to_prob(-150) == pytest.approx(0.6)
    assert pm.american_to_prob(150) == pytest.approx(0.4)
    assert pm.prob_to_american(0.6) == -150 and pm.prob_to_american(0.4) == 150


def test_book_devigs_two_way_and_keeps_one_way_raw():
    b = prop_board._book({"sog": [{"line": 2.5, "over": -110, "under": -110}], "atg": 300})
    assert b["sog25"]["imp"] == pytest.approx(0.5) and b["sog25"]["devig"] is True
    assert b["atg"] == {"over": 300, "imp": 0.25, "devig": False}


@pytest.mark.parametrize("raw,expected", [
    ("Charles-Alexis Legault", "charles alexis legault"),
    ("J.J. Moser", "jj moser"),
    ("Tim Stützle", "tim stutzle"),
])
def test_name_normalization(raw, expected):
    assert prop_board.norm(raw) == expected


def test_pregame_features_use_previous_games_only():
    rows = []
    for i in range(12):
        for pid, team, opp in ((1, "AAA", "BBB"), (2, "BBB", "AAA")):
            rows.append({"game_id": 2025020000 + i, "date": f"2025-10-{i + 1:02d}", "player_id": pid,
                         "team": team, "opp": opp, "pos": "C", "toi": 18.0,
                         "goals": 0, "assists": 0, "points": 0, "shots": 3 if pid == 1 else 1, "pp_points": 0})
    logs = pd.DataFrame(rows)
    lg = pm.position_rates(logs)          # league priors held fixed: only the player's own history may move
    base = pm.pregame_features(logs, lg)
    # Changing the last game's outcome must not change that game's own player inputs.
    logs.loc[(logs.player_id == 1) & (logs.game_id == 2025020011), "shots"] = 15
    bumped = pm.pregame_features(logs, lg)
    key = (base.player_id == 1) & (base.game_id == 2025020011)
    for col in ("rate_shots", "toi_exp", "rate_points"):
        assert bumped.loc[key, col].iloc[0] == pytest.approx(base.loc[key, col].iloc[0])
    # The steady 3-shot shooter projects above the 1-shot one.
    last = base[base.game_id == 2025020011].set_index("player_id")
    assert last.at[1, "lam_shots"] > last.at[2, "lam_shots"]


def test_skater_game_frame_joins_attempts_and_toi_reports():
    import fetch_skater_games as fsg
    summary = [{"gameId": 1, "gameDate": "2026-10-01", "playerId": 7, "skaterFullName": "A B", "teamAbbrev": "AAA",
                "opponentTeamAbbrev": "BBB", "homeRoad": "H", "positionCode": "C", "timeOnIcePerGame": 1200,
                "goals": 1, "assists": 0, "points": 1, "shots": 4, "ppGoals": 0, "ppPoints": 0},
               {"gameId": 1, "gameDate": "2026-10-01", "playerId": 8, "skaterFullName": "C D", "teamAbbrev": "AAA",
                "opponentTeamAbbrev": "BBB", "homeRoad": "H", "positionCode": "D", "timeOnIcePerGame": 900,
                "goals": 0, "assists": 0, "points": 0, "shots": 0, "ppGoals": 0, "ppPoints": 0}]
    extra = {"realtime": [{"gameId": 1, "playerId": 7, "totalShotAttempts": 9, "missedShots": 3, "shotAttemptsBlocked": 2}],
             "timeonice": [{"gameId": 1, "playerId": 7, "evTimeOnIce": 960, "ppTimeOnIce": 150}]}
    df = fsg._frame(summary, extra).set_index("player_id")
    assert set(fsg.COLUMNS) <= set(df.reset_index().columns)
    assert (df.at[7, "attempts"], df.at[7, "missed"], df.at[7, "blocked"]) == (9, 3, 2)
    assert df.at[7, "ev_toi"] == 16.0 and df.at[7, "pp_toi"] == 2.5
    # A player missing from an extra report keeps the row, with the extra columns empty.
    assert pd.isna(df.at[8, "attempts"]) and pd.isna(df.at[8, "pp_toi"])


def test_rest_days_count_from_each_teams_last_game():
    logs = pd.DataFrame({"team": ["AAA", "AAA", "BBB"], "date": ["2026-10-01", "2026-10-04", "2026-10-02"]})
    assert prop_board._rest(logs, "2026-10-05") == {"AAA": 1, "BBB": 3}


def test_goalie_carries_regressed_gsax_when_rated():
    g = prop_board._goalie("X Y", "Confirmed", {"X Y": {"gsax_per_game": 0.2149}})
    assert g == {"name": "X Y", "status": "Confirmed", "gsax": 0.21}
    assert prop_board._goalie(None, None, {}) is None
