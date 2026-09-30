"""Season context and the predictions data contract v2 (workstream A).

Covers A1 (contract, no placeholders), A2 (no predictions after puck drop,
freeze model outputs only), A3 (full-schedule fatigue, no variable leak),
A4 (gated, regressed PP/PK ranks), A5 (L7/H2H/location), A6 (goalie lines),
A7 (goalie status tied to the game), A9 (no GAS), A10 (market blend, EV
fraction, lineup gate), A11 (breakdown reconciles), A12 (timestamps).
"""
import csv
import json
import math
import os
import random
import re
from datetime import datetime, timedelta, timezone

import pytest

import predict_games as P
import season_context as SC
from season import SEASON_ID, SEASON_START_DATE, PREV_SEASON_ID

PIPELINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(PIPELINE, "fixtures")
UTC = timezone.utc
ISO_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
REC = re.compile(r"^\d+-\d+-\d+$")


def rows_of(name):
    with open(os.path.join(FIXTURES, name), newline="") as f:
        return list(csv.DictReader(f))


# ── synthetic inputs ─────────────────────────────────────────────────────────

class StubML:
    """Deterministic stand-in for ml_predict.MLPredictor (same API)."""
    available = True
    model_version = "stub-v1"

    def __init__(self):
        self.calls = []

    def predict_detail(self, home, away, date, h_goalie=None, a_goalie=None, h_rest_days=None,
                       a_rest_days=None, extra_terms=None, **kw):
        self.calls.append((home, away, date, h_rest_days, a_rest_days))
        rest = (-0.3 if h_rest_days == 1 else 0.0) + (0.3 if a_rest_days == 1 else 0.0)
        terms = [("home_ice", "Home ice", 0.12), ("strength_5v5", "5v5 strength", 0.04 * (len(home) - len(away))),
                 ("special_teams", "Special teams", -0.05), ("goaltending", "Goaltending", 0.03),
                 ("rest", "Rest & travel", rest)] + [tuple(t) for t in (extra_terms or [])]
        z = sum(t[2] for t in terms)
        p = 1 / (1 + math.exp(-z))
        return {"home_win_prob": p, "model_version": self.model_version, "expected_total": 6.1,
                "preseason_prior": True,
                "logit_terms": [{"factor": f, "label": lab, "logit": d} for f, lab, d in terms]}


def game(gid, day, hhmm, gtype, state, home, away, hs=None, as_=None, period="REG", start_day=None):
    return {"id": gid, "date": day, "start_utc": f"{start_day or day}T{hhmm}:00Z", "type": gtype, "state": state,
            "home": home, "away": away, "home_score": hs, "away_score": as_, "last_period": period}


NAMES = {"CAR": "Hurricanes", "FLA": "Panthers", "TOR": "Maple Leafs", "MTL": "Canadiens", "NYI": "Islanders",
         "EDM": "Oilers", "VAN": "Canucks", "PHI": "Flyers", "PIT": "Penguins"}


def entry(gm, state=None, hg=None, ag=None, hs="Unconfirmed", as_="Unconfirmed", src="dailyfaceoff"):
    return {"id": gm["id"], "gameDate": gm["date"], "startTimeUTC": gm["start_utc"], "gameType": gm["type"],
            "gameState": state or gm["state"], "homeTeam": NAMES[gm["home"]], "awayTeam": NAMES[gm["away"]],
            "homeTeamAbbrev": gm["home"], "awayTeamAbbrev": gm["away"],
            "homeGoalieConfirmed": hg, "homeGoalieStatus": hs, "homeGoalieSource": src if hg else None,
            "awayGoalieConfirmed": ag, "awayGoalieStatus": as_, "awayGoalieSource": src if ag else None}


def inputs(now, schedule, games, **kw):
    tris = {t for g in games for t in (g["home"], g["away"])}
    inp = P.Inputs(now=now, schedule=schedule)
    inp.club_games = {t: SC.team_games(games, t) for t in tris}
    inp.ml = kw.pop("ml", StubML())
    inp.gate_state = kw.pop("gate_state", {"backtest": {"roi_ci_low": -0.09, "clv_mean": -0.05}, "rolling": {"n": 0}})
    inp.full_names = {t: t for t in tris}
    for k, v in kw.items():
        setattr(inp, k, v)
    return inp


OPENER = [
    game(2026010001, "2026-09-26", "23:00", 1, "FINAL", "CAR", "TOR", 2, 1),
    game(2026010002, "2026-09-26", "23:00", 1, "FINAL", "FLA", "MTL", 2, 1),
    game(2026010003, "2026-09-26", "23:00", 1, "FINAL", "NYI", "EDM", 2, 1),
    game(2026020001, "2026-09-29", "21:00", 2, "FUT", "CAR", "FLA"),
    game(2026020002, "2026-09-29", "23:00", 2, "FUT", "TOR", "MTL"),
    game(2026020008, "2026-09-30", "23:30", 2, "FUT", "TOR", "NYI"),
]


# ── A1: contract ─────────────────────────────────────────────────────────────

def test_fixture_files_exist_and_are_v2():
    for name in ("predictions_opening_night.csv", "predictions_week3.csv", "predictions_playoffs.csv"):
        rows = rows_of(name)
        assert rows, name
        assert list(rows[0].keys()) == P.COLUMNS, f"{name} columns drift from predict_games.COLUMNS"
        for r in rows:
            assert r["schema_version"] == "2"
            assert r["season_id"] == SEASON_ID
            assert ISO_Z.match(r["start_time_utc"])
            assert re.fullmatch(r"\d{10}", r["nhl_game_id"])


def test_contract_documents_every_column():
    text = open(os.path.join(PIPELINE, "CONTRACT.md")).read()
    documented = set(re.findall(r"^\|\s*`([a-z0-9_%]+)`", text, flags=re.M))
    expanded = set()
    for c in documented:
        if c.startswith("side_"):
            expanded |= {c.replace("side_", "home_", 1), c.replace("side_", "away_", 1)}
        else:
            expanded.add(c)
    missing = [c for c in P.COLUMNS if c not in expanded]
    assert not missing, f"undocumented columns: {missing}"


def test_opening_night_zero_gp_teams_have_no_context():
    for r in rows_of("predictions_opening_night.csv"):
        for side in ("home", "away"):
            assert r[f"{side}_gp"] == "0"
            assert r[f"{side}_l7"] == "" and json.loads(r[f"{side}_l7_games"]) == []
            assert r[f"{side}_h2h_record"] == ""
            assert r[f"{side}_pp_rank"] == "" and r[f"{side}_pk_rank"] == ""
            assert r[f"{side}_loc_record"] == ""
            assert f"{side}_gas" not in r
        # previous-season values only in *_prev and flagged
        assert r["context_season"] == PREV_SEASON_ID


def test_no_rank_16_when_stats_api_returns_nothing():
    teams = [f"T{i:02d}" for i in range(32)]
    table = SC.special_teams_table([], [], {}, {}, teams)       # api total: 0
    assert all(t["pp_rank"] is None and t["pk_rank"] is None for t in table.values())
    now = datetime(2026, 9, 29, 20, 0, tzinfo=UTC)
    inp = inputs(now, [entry(g) for g in OPENER if g["type"] == 2], OPENER, st_table={})
    for r in P.build_rows(inp):
        for side in ("home", "away"):
            assert r[f"{side}_pp_rank"] != "16" and r[f"{side}_pk_rank"] != "16"
            assert r[f"{side}_pp_rank"] == "" and r[f"{side}_l7"] == ""


def test_start_time_matches_schedule_and_rest_is_integer():
    now = datetime(2026, 9, 29, 20, 0, tzinfo=UTC)
    sched = [entry(g) for g in OPENER if g["type"] == 2]
    rows = P.build_rows(inputs(now, sched, OPENER))
    by_id = {str(s["id"]): s["startTimeUTC"] for s in sched}
    for r in rows:
        assert r["start_time_utc"] == by_id[r["nhl_game_id"]]
        assert datetime.fromisoformat(r["start_time_utc"].replace("Z", "+00:00")).tzinfo is not None
        for side in ("home", "away"):
            assert re.fullmatch(r"\d+", r[f"{side}_rest_days"])
    for name in ("predictions_opening_night.csv", "predictions_week3.csv"):
        for r in rows_of(name):
            assert re.fullmatch(r"\d+", r["home_rest_days"]) and re.fullmatch(r"\d+", r["away_rest_days"])


# ── A2: puck drop ────────────────────────────────────────────────────────────

def test_game_started_without_pregame_row_gets_no_prediction():
    now = datetime(2026, 9, 29, 21, 5, tzinfo=UTC)          # FLA@CAR started 21:00Z
    sched = [entry(OPENER[3])]
    rows = P.build_rows(inputs(now, sched, OPENER))
    r = rows[0]
    assert r["prediction_status"] == "no_pregame_prediction"
    for c in ("home_win_pct", "away_win_pct", "home_ev", "away_ev", "units", "wager_recommendation",
              "home_xg", "model_version"):
        assert r[c] == "", c


def test_live_state_counts_as_started_even_before_scheduled_time():
    now = datetime(2026, 9, 29, 20, 55, tzinfo=UTC)
    r = P.build_rows(inputs(now, [entry(OPENER[3], state="LIVE")], OPENER))[0]
    assert r["prediction_status"] == "no_pregame_prediction"


def test_frozen_row_keeps_model_outputs_and_refreshes_context():
    pre_now = datetime(2026, 9, 30, 20, 0, tzinfo=UTC)
    tor_nyi = OPENER[5]
    games0 = [g for g in OPENER]
    pre = P.build_rows(inputs(pre_now, [entry(tor_nyi, hg="Anthony Stolarz")], games0))
    existing = {pre[0]["nhl_game_id"]: pre[0]}
    assert pre[0]["prediction_status"] == "pregame"
    # after puck drop: TOR's opener is now final, a goalie news item arrives
    games1 = [dict(g, state="FINAL", home_score=2, away_score=3) if g["id"] == 2026020002 else g for g in OPENER]
    post_now = datetime(2026, 9, 30, 23, 45, tzinfo=UTC)
    post = P.build_rows(inputs(post_now, [entry(tor_nyi, state="LIVE", hg="Anthony Stolarz")], games1,
                               existing=existing, ml=None))
    a, b = pre[0], post[0]
    assert b["prediction_status"] == "frozen"
    for c in P.FROZEN_COLUMNS:
        assert a[c] == b[c], c
    assert a["home_l7"] == "" and b["home_l7"] == "0-1-0"        # context moved on


def test_rows_from_another_season_or_legacy_are_not_frozen():
    now = datetime(2026, 9, 29, 21, 5, tzinfo=UTC)
    base = {"home_win_pct": "63.1", "prediction_status": "pregame", "schema_version": "2"}
    for bad in ({**base, "season_id": "20252026"}, {"home_win_pct": "63.1", "home_l7": "5-1-1"}):
        existing = {"2026020001": bad, "2026-09-29-Panthers-Hurricanes": bad}
        r = P.build_rows(inputs(now, [entry(OPENER[3])], OPENER, existing=existing))[0]
        assert r["prediction_status"] == "no_pregame_prediction"
        assert r["home_win_pct"] == "" and r["home_l7"] == ""


def test_contaminated_opening_night_rows_excluded_from_history():
    import generate_history as GH
    assert {2026020001, 2026020002} <= GH.EXCLUDED_GAME_IDS
    hist = json.load(open(os.path.join(os.path.dirname(PIPELINE), "data", "prediction_history.json")))
    items = hist if isinstance(hist, list) else hist.get("games", [])
    assert not [x for x in items if x.get("gameId") in (2026020001, 2026020002)]


def test_site_history_opening_night_rows_have_no_wager():
    path = os.path.join(os.path.dirname(PIPELINE), "public", "data", "SiteHistory", "2026-09-29.csv")
    if not os.path.exists(path):
        pytest.skip("no 2026-09-29 SiteHistory")
    for r in csv.DictReader(open(path)):
        if r.get("gameid") in ("2026-09-29-Panthers-Hurricanes", "2026-09-29-Canadiens-Maple Leafs",
                               "2026020001", "2026020002"):
            assert not (r.get("home_bet") or r.get("away_bet")), r


# ── A3: fatigue ──────────────────────────────────────────────────────────────

def test_no_dir_hack_left():
    src = open(os.path.join(PIPELINE, "predict_games.py")).read()
    assert "in dir()" not in src


def test_back_to_back_from_the_full_schedule():
    # TOR plays 9/29 (not scraped / not final yet) and 9/30 -> B2B on 9/30
    f = SC.fatigue(SC.team_games(OPENER, "TOR"), "TOR", 2026020008, "2026-09-30")
    assert f["rest_days"] == 0 and f["is_b2b"] is True and f["model_rest_days"] == 1
    assert f["games_in_last_4"] == 2
    nyi = SC.fatigue(SC.team_games(OPENER, "NYI"), "NYI", 2026020008, "2026-09-30")
    assert nyi["is_b2b"] is False and nyi["road_trip_game_n"] == 1 and nyi["model_rest_days"] is None


def test_committed_predictions_mark_tor_b2b_on_sept_30():
    path = os.path.join(os.path.dirname(PIPELINE), "data", "predictions_detailed.csv")
    rows = [r for r in csv.DictReader(open(path)) if r.get("nhl_game_id") == "2026020008"]
    if not rows:
        pytest.skip("NYI@TOR 2026-09-30 no longer in the committed slate")
    assert rows[0]["home_is_b2b"] == "True" and rows[0]["home_rest_days"] == "0"


def test_schedule_order_does_not_change_probabilities():
    now = datetime(2026, 9, 29, 12, 0, tzinfo=UTC)
    sched = [entry(g) for g in OPENER if g["type"] == 2]
    a = {r["nhl_game_id"]: r for r in P.build_rows(inputs(now, sched, OPENER))}
    for seed in range(3):
        s2 = sched[:]
        random.Random(seed).shuffle(s2)
        b = {r["nhl_game_id"]: r for r in P.build_rows(inputs(now, s2, OPENER))}
        for gid in a:
            assert a[gid]["home_model_win_pct"] == b[gid]["home_model_win_pct"]
            assert a[gid]["home_rest_days"] == b[gid]["home_rest_days"]


# ── A4: special teams ────────────────────────────────────────────────────────

TEAMS = [f"T{i:02d}" for i in range(32)]
IDS = {i: t for i, t in enumerate(TEAMS)}


def _st_rows(gp, ppg, ppo, ga, sh):
    return ([{"teamId": i, "powerPlayGoalsFor": ppg[i], "ppOpportunities": ppo[i]} for i in range(32) if gp[i]],
            [{"teamId": i, "ppGoalsAgainst": ga[i], "timesShorthanded": sh[i]} for i in range(32) if gp[i]])


def test_ranks_gated_until_every_team_has_10_gp():
    gp = [1] * 10 + [0] * 22
    pp, pk = _st_rows(gp, [1] * 32, [3] * 32, [1] * 32, [3] * 32)
    table = SC.special_teams_table(pp, pk, {TEAMS[i]: gp[i] for i in range(32)}, IDS, TEAMS)
    assert all(t["pp_rank"] is None and t["pk_rank"] is None for t in table.values())


def test_ranks_are_permutations_once_all_teams_have_10_gp():
    rnd = random.Random(3)
    gp = [10 + rnd.randrange(5) for _ in range(32)]
    ppo = [30 + rnd.randrange(20) for _ in range(32)]
    ppg = [rnd.randrange(3, 14) for _ in range(32)]
    sh = [30 + rnd.randrange(20) for _ in range(32)]
    ga = [rnd.randrange(3, 14) for _ in range(32)]
    pp, pk = _st_rows(gp, ppg, ppo, ga, sh)
    table = SC.special_teams_table(pp, pk, {TEAMS[i]: gp[i] for i in range(32)}, IDS, TEAMS)
    assert sorted(t["pp_rank"] for t in table.values()) == list(range(1, 33))
    assert sorted(t["pk_rank"] for t in table.values()) == list(range(1, 33))


def test_one_for_two_night_cannot_rank_first():
    gp = [10] * 32
    ppo = [2] + [40] * 31
    ppg = [1] + [9] * 30 + [10]           # 50% on 2 chances vs 25% on 40
    pp, pk = _st_rows(gp, ppg, ppo, [8] * 32, [40] * 32)
    table = SC.special_teams_table(pp, pk, {t: 10 for t in TEAMS}, IDS, TEAMS)
    assert table["T00"]["pp_pct"] == 0.5
    assert table["T00"]["pp_rank"] != 1
    assert table["T31"]["pp_rank"] == 1


def test_prev_season_ranks_match_right_rail_values():
    rows = [{"teamId": 22, "powerPlayPct": 0.306306, "penaltyKillPct": 0.778281},
            {"teamId": 10, "powerPlayPct": 0.213197, "penaltyKillPct": 0.812228},
            {"teamId": 2, "powerPlayPct": 0.165289, "penaltyKillPct": 0.808412}]
    r = SC.rank_season_table(rows, {22: "EDM", 10: "TOR", 2: "NYI"})
    assert r["EDM"]["pp_rank"] == 1 and r["TOR"]["pp_rank"] == 2 and r["NYI"]["pp_rank"] == 3
    assert r["TOR"]["pk_rank"] == 1


# ── A5: records ──────────────────────────────────────────────────────────────

CAR_2526 = (
    [game(2025020000 + i, (datetime(2025, 10, 8) + timedelta(days=2 * i)).strftime("%Y-%m-%d"), "23:00", 2, "OFF",
          "CAR", "BOS", 3, 1) for i in range(82)]
    + [game(2025030100 + i, (datetime(2026, 5, 29) + timedelta(days=3 * i)).strftime("%Y-%m-%d"), "00:00", 3,
            "OFF", "CAR", "VGK", 2 if i % 2 else 1, 1 if i % 2 else 2, "OT" if i == 1 else "REG") for i in range(6)]
)


def test_game_numbers_ascend_and_playoffs_count_separately():
    ln = SC.last_n(CAR_2526, "CAR", "2026-06-20", game_type="03")
    nums = [g["gameNumber"] for g in ln["games"]]
    assert nums[0] == "PO G6" and ln["games"][0]["gameDate"] == max(g["gameDate"] for g in ln["games"])
    assert nums[-1] == "G82"
    assert "L-OT" not in [g["result"] for g in ln["games"]] or ln["record"].endswith("-0")
    reg = SC.last_n(CAR_2526, "CAR", "2026-06-20", game_type="02")
    assert all(g["gameType"] == "02" for g in reg["games"]) and reg["games"][0]["gameNumber"] == "G82"


def test_playoff_overtime_loss_is_a_loss():
    g1 = game(2026030111, "2027-04-20", "23:00", 3, "OFF", "CAR", "NYR", 2, 3, "OT")
    assert SC.result_for(g1, "CAR") == ("L", "L-OT")
    g2 = dict(g1, type=2)
    assert SC.result_for(g2, "CAR") == ("O", "O")


def test_last_n_window_label_and_empty_state():
    games = [game(2026020100 + i, f"2026-10-0{i + 1}", "23:00", 2, "OFF", "TOR", "MTL", 3, 2) for i in range(3)]
    ln = SC.last_n(games, "TOR", "2026-10-09")
    assert ln["record"] == "3-0-0" and ln["label"] == "L3" and ln["n"] == 3
    assert SC.last_n([], "TOR", "2026-10-09") == {"record": "", "n": 0, "label": "", "games": []}
    for r in rows_of("predictions_week3.csv"):
        if r["away_abbrev"] == "TBL":
            assert r["away_l7_label"] == "L3"


def test_no_l7_game_before_season_start():
    for name in ("predictions_opening_night.csv", "predictions_week3.csv"):
        for r in rows_of(name):
            for side in ("home", "away"):
                for g in json.loads(r[f"{side}_l7_games"]):
                    assert g["gameDate"] >= SEASON_START_DATE


def test_h2h_always_three_parts_and_location_gated():
    for name in ("predictions_opening_night.csv", "predictions_week3.csv", "predictions_playoffs.csv"):
        for r in rows_of(name):
            for c in ("home_h2h_record", "away_h2h_record", "home_h2h_prev", "away_h2h_prev"):
                assert r[c] == "" or REC.match(r[c]), (c, r[c])
            for side in ("home", "away"):
                n = int(r[f"{side}_loc_gp"] or 0)
                assert (r[f"{side}_loc_record"] == "") == (n < 5)
    games = [game(2026020100, "2026-10-01", "23:00", 2, "OFF", "TOR", "NYI", 2, 3, "SO")]
    assert SC.head_to_head(games, "TOR", "NYI", "2026-10-20") == ("0-0-1", "1-0-0", 1)


# ── A6: goalie lines ─────────────────────────────────────────────────────────

def test_opening_night_goalie_lines():
    rows = {r["home_abbrev"]: r for r in rows_of("predictions_opening_night.csv")}
    van = rows["VAN"]
    assert van["home_goalie_confirmed"] == "Kevin Lankinen"
    assert van["home_goalie_stats_cur"] == "" and van["home_goalie_cur_gp"] == "0"
    assert van["home_goalie_stats_prev"] == "(11-27-5) | .875 | 3.70"
    for r in rows.values():
        assert r["home_goalie_stats_cur"] == "" and r["away_goalie_stats_cur"] == ""


def test_playoff_line_only_in_playoff_games():
    for name in ("predictions_opening_night.csv", "predictions_week3.csv"):
        for r in rows_of(name):
            assert r["game_type"] == "02" and r["home_goalie_po"] == "" and r["away_goalie_po"] == ""
    po = rows_of("predictions_playoffs.csv")[0]
    assert po["game_type"] == "03" and po["away_goalie_po"]


def test_relief_appearance_counts_its_minutes():
    import fetch_goalie_history as H
    log = [{"opponentAbbrev": "VAN", "decision": "W", "shotsAgainst": 30, "goalsAgainst": 2, "toi": "60:00"},
           {"opponentAbbrev": "VAN", "decision": None, "shotsAgainst": 8, "goalsAgainst": 2, "toi": "20:00"},
           {"opponentAbbrev": "VAN", "decision": "L", "shotsAgainst": 25, "goalsAgainst": 3, "toi": "58:30"}]
    s = H.summarize([H.split_by_opponent(log)], {"VAN"}, "VAN")
    assert s["vs_opp_gp"] == 3 and s["record"] == "1-1-0"
    assert s["gaa"] == round(7 * 60 / (60 + 20 + 58.5), 2)
    small = H.summarize([H.split_by_opponent(log[:2])], {"VAN"}, "VAN")
    assert small["vs_opp_gp"] == 2 and "record" not in small


def test_goalie_history_seasons_include_current_and_warm_cache_calls(monkeypatch, tmp_path):
    import fetch_goalie_history as H
    assert H.season_ids()[0] == SEASON_ID and len(H.season_ids()) == 11
    calls = []
    listed = [{"season": int(s), "gameTypes": [2, 3]} for s in H.season_ids()[:4]]

    def fake(url):
        calls.append(url)
        return {"playerStatsSeasons": listed, "gameLog": [
            {"opponentAbbrev": "EDM", "decision": "W", "shotsAgainst": 30, "goalsAgainst": 1, "toi": "60:00"}]}
    monkeypatch.setattr(H, "make_request", fake)
    monkeypatch.setattr(H, "CACHE_FILE", str(tmp_path / "c.json"))
    monkeypatch.setattr(H, "_CACHE", {"version": H.CACHE_VERSION, "ids": {"stuart skinner": 1}, "players": {}})
    cold = H.fetch_goalie_vs_opponent("Stuart Skinner", "PIT", "EDM")
    n_cold = len(calls)
    calls.clear()
    warm = H.fetch_goalie_vs_opponent("Stuart Skinner", "PIT", "EDM")
    assert len(calls) <= 2 and n_cold > len(calls)
    assert cold == warm and warm["vs_opp_gp"] == 8       # 4 seasons x 2 types, incl. 20262027


# ── A7: goalie status ────────────────────────────────────────────────────────

def test_goalie_start_news_from_another_date_does_not_confirm():
    news = [{"player": "Sergei Bobrovsky", "category": "Goalie Start", "date": "2026-09-29",
             "news": "Bobrovsky will start Tuesday against Montreal.", "timestamp": "2026-09-29T20:00:00Z"}]
    now = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)
    st, src, at = SC.resolve_goalie_status("Sergei Bobrovsky", "Unconfirmed", "dailyfaceoff", None, news,
                                           "2026-09-30", ["Islanders", "NYI", "New York Islanders"], now)
    assert st == "Unconfirmed" and src == "DFO"
    news.append({"player": "Sergei Bobrovsky", "category": "Goalie Start", "date": "2026-09-29",
                 "news": "Bobrovsky will get the nod Wednesday against the Islanders.",
                 "timestamp": "2026-09-29T23:50:00Z"})
    st, src, at = SC.resolve_goalie_status("Sergei Bobrovsky", "Unconfirmed", "dailyfaceoff", None, news,
                                           "2026-09-30", ["Islanders", "NYI"], now)
    assert (st, src, at) == ("Confirmed", "news", "2026-09-29T23:50:00Z")


def test_home_and_home_blurb_does_not_confirm_the_rematch():
    # Real DFO item (2026-09-30 01:29Z) about VAN's 9/29 game AT Edmonton; VAN
    # hosts EDM again on Thursday 10/1.  'EDM' is a substring of 'Edmonton',
    # and the blurb names the opponent, but it is about the earlier game.
    item = {"player": "Kevin Lankinen", "category": "Goalie Start", "date": "2026-09-29",
            "news": "Lankinen led the Canucks onto the ice for warmups; he'll start Tuesday in Edmonton. ",
            "timestamp": "2026-09-30T01:29:51.277Z"}
    terms = SC.opponent_terms("Oilers", "EDM", "Edmonton Oilers")
    assert "Edmonton" in terms
    now = datetime(2026, 9, 30, 5, 40, tzinfo=UTC)
    prev_start = datetime(2026, 9, 30, 2, 0, tzinfo=UTC)          # VAN@EDM 9/29, 02:00Z
    st, src, _ = SC.resolve_goalie_status("Kevin Lankinen", "Unconfirmed", "dailyfaceoff", None, [item],
                                          "2026-10-01", terms, now, not_before=prev_start)
    assert (st, src) == ("Unconfirmed", "DFO")
    # the weekday alone rules it out as well
    assert SC.news_confirms([item], "Kevin Lankinen", "2026-10-01", terms) is None
    # a Thursday blurb posted after the 9/29 game does confirm
    ok = dict(item, news="Lankinen will start Thursday against Edmonton.", timestamp="2026-09-30T15:00:00Z",
              date="2026-09-30")
    assert SC.news_confirms([item, ok], "Kevin Lankinen", "2026-10-01", terms, not_before=prev_start) is ok


def test_tricode_is_matched_as_a_whole_word():
    terms = SC.opponent_terms("Kraken", "SEA", "Seattle Kraken")
    assert not SC._names_opponent("Wolf will start the season opener.", terms)
    assert not SC._names_opponent("Andersen, a career backup, starts.", SC.opponent_terms("Hurricanes", "CAR",
                                                                                           "Carolina Hurricanes"))
    assert SC._names_opponent("Wolf gets the nod vs. SEA.", terms)
    assert SC._names_opponent("Wolf gets the nod against Seattle.", terms)
    # 'New York' names two teams: not an opponent identifier
    assert "New York" not in SC.opponent_terms("Rangers", "NYR", "New York Rangers")


def test_every_confirmed_status_has_source_and_time():
    for name in ("predictions_opening_night.csv", "predictions_week3.csv", "predictions_playoffs.csv"):
        for r in rows_of(name):
            for side in ("home", "away"):
                if r[f"{side}_goalie_status"] == "Confirmed":
                    assert r[f"{side}_goalie_status_source"] and ISO_Z.match(r[f"{side}_goalie_status_at"])


def test_committed_nyi_tor_row_not_confirmed_from_old_news():
    path = os.path.join(os.path.dirname(PIPELINE), "data", "predictions_detailed.csv")
    rows = [r for r in csv.DictReader(open(path)) if r.get("nhl_game_id") == "2026020008"]
    if not rows:
        pytest.skip("NYI@TOR not in the committed slate")
    assert rows[0]["home_goalie_status_source"] != "news"


# ── A9 / A12: removed fields ─────────────────────────────────────────────────

def test_no_gas_or_dead_columns():
    dead = re.compile(r"(^|_)(gas|gas_breakdown|xg_sparkline|avg_speed|rr_rate)$")
    assert not [c for c in P.COLUMNS if dead.search(c)]
    assert not os.path.exists(os.path.join(PIPELINE, "calculate_gas.py"))
    for root, _, files in os.walk(PIPELINE):
        for f in files:
            if f.endswith(".py") and "tests" not in root:
                assert "Default: 65" not in open(os.path.join(root, f), errors="ignore").read(), f


def test_last_updated_is_iso_utc(tmp_path):
    p = tmp_path / "lu.json"
    stamp = P.write_last_updated(datetime(2026, 9, 30, 1, 2, 3, tzinfo=UTC), [str(p)])
    assert stamp == "2026-09-30T01:02:03Z"
    assert ISO_Z.match(json.load(open(p))["last_refresh"])
    for rel in ("data/last_updated.json", "public/data/last_updated.json"):
        path = os.path.join(os.path.dirname(PIPELINE), rel)
        assert ISO_Z.match(json.load(open(path))["last_refresh"]), rel


# ── A10 / A11: market and explanation ────────────────────────────────────────

def test_pickem_ev_from_blended_probability_and_gate():
    now = datetime(2026, 9, 29, 12, 0, tzinfo=UTC)
    gm = OPENER[3]
    odds = {str(gm["id"]): {"home_ml": -110, "away_ml": -120, "source": "bovada", "fetched_at": "2026-09-29T11:00:00Z"}}
    r = P.build_rows(inputs(now, [entry(gm)], OPENER, odds=odds))[0]
    import market
    p = float(r["home_win_pct"]) / 100
    assert abs(float(r["home_ev"]) - market.ev_from(p, -110)) < 0.0015        # fraction, from the blend
    assert r["units"] == "" and r["ev_gated"] == "False" and r["wager_recommendation"] == "No Bet"
    assert abs(float(r["home_vegas_win_pct"]) + float(r["away_vegas_win_pct"]) - 100) <= 0.1
    assert r["home_model_win_pct"] != r["home_win_pct"]
    assert r["model_version"] == "stub-v1" and r["market_source"] == "bovada"


def test_units_only_when_the_gate_is_open():
    now = datetime(2026, 11, 29, 12, 0, tzinfo=UTC)
    gm = OPENER[3]
    odds = {str(gm["id"]): {"home_ml": 150, "away_ml": -170}}
    open_state = {"backtest": {"roi_ci_low": 0.01, "clv_mean": 0.01},
                  "rolling": {"n": 300, "model_log_loss": 0.66, "market_log_loss": 0.67}}
    many = [game(2026020200 + i, "2026-11-0%d" % (1 + i % 9), "23:00", 2, "OFF", t, "EDM" if t != "EDM" else "VAN",
                 3, 2) for i, t in enumerate(["CAR", "FLA"] * 6)]
    r = P.build_rows(inputs(now, [entry(gm)], OPENER + many, odds=odds, gate_state=open_state))[0]
    if r["ev_gated"] == "True":
        assert float(r["units"]) > 0 and r["bet_side"] in ("home", "away")
    else:
        assert r["units"] == ""


def test_lineup_scores_empty_without_coverage():
    class Adj:
        def adjust(self, *a, **k):
            return None
    now = datetime(2026, 9, 29, 12, 0, tzinfo=UTC)
    r = P.build_rows(inputs(now, [entry(OPENER[3])], OPENER, lineup_adj=Adj()))[0]
    assert r["home_lineup_score"] == "" and r["away_lineup_score"] == ""
    lineup = [x for x in json.loads(r["home_wp_breakdown"]) if x["factor"] == "lineup"][0]
    assert lineup["wp_delta_pts"] == 0


@pytest.mark.parametrize("name", ["predictions_opening_night.csv", "predictions_week3.csv", "predictions_playoffs.csv"])
def test_breakdown_reconciles_with_displayed_numbers(name):
    for r in rows_of(name):
        if r["prediction_status"] not in ("pregame", "frozen"):
            continue
        assert r["model_version"]
        bd = json.loads(r["home_wp_breakdown"])
        assert abs(50 + sum(x["wp_delta_pts"] for x in bd) - float(r["home_win_pct"])) <= 0.1
        for side in ("home", "away"):
            parts = [float(p.rsplit(":", 1)[1]) for p in json.loads(r[f"{side}_xg_explained"])]
            assert abs(sum(parts) - float(r[f"{side}_xg"])) <= 0.02
        assert len(r["pick_summary"]) <= 160
        top2 = sorted(bd, key=lambda x: abs(x["wp_delta_pts"]), reverse=True)[:2]
        for x in top2:
            assert P.FACTOR_SHORT[x["factor"]] in r["pick_summary"]
        assert r["confidence_grade"] in ("A", "B", "C")
        # xG favourite == win % favourite
        assert (float(r["home_xg"]) >= float(r["away_xg"])) == (float(r["home_win_pct"]) >= 50) or \
            abs(float(r["home_win_pct"]) - 50) < 0.3


def test_snapshot_keeps_ev_as_percent_and_adds_model_columns():
    import snapshot_predictions as SP
    v2 = {"schema_version": "2", "home_ev": "-0.0457", "away_ev": "0.0163"}
    assert SP.format_ev(SP.ev_pct(v2, "home")) == "-4.57"
    assert SP.format_ev(SP.ev_pct(v2, "away")) == "+1.63"
    v1 = {"home_ev": "20.45"}
    assert SP.format_ev(SP.ev_pct(v1, "home")) == "+20.45"
    src = open(os.path.join(PIPELINE, "snapshot_predictions.py")).read()
    for col in ("timestamp_utc", "model_version", "home_model%", "home_market%", "no_pregame_prediction"):
        assert col in src
