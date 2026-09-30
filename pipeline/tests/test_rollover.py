"""A8: season rollover and the stale-baseline guards (projections,
implications, clinch status, playoff series)."""
import csv
import json
import os
import time

import numpy as np
import pytest

import fetch_clinch_status as FC
import game_implications as GI
import rollover
import season_simulator as SS
import update_playoff_series as UPS
from season import SEASON_ID

PIPELINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(os.path.dirname(PIPELINE), "public", "data")

DIVS = {"A": "E", "M": "E", "C": "W", "P": "W"}


def standings(gp=0):
    teams = {}
    for d, conf in DIVS.items():
        for k in range(8):
            teams[f"{d}{k}"] = {"pts": 0, "rw": 0, "row": 0, "w": 0, "l": 0, "otl": 0, "gp": gp,
                                "conference": conf, "division": d}
    return teams


def schedule(teams, n_rounds=20):
    names = sorted(teams)
    out, gid = [], 2026020001
    for r in range(n_rounds):
        order = names[r % 32:] + names[:r % 32]
        for i in range(0, 32, 2):
            out.append({"id": gid, "date": f"2026-{10 + r // 30:02d}-{1 + r % 28:02d}", "home": order[i],
                        "away": order[i + 1], "gameState": "FUT"})
            gid += 1
    return out


class FlatProbs:
    """Home team strength by the digit in its name (A7 strongest ... A0 weakest)."""
    source = "test"

    def __init__(self):
        self.cache = {}

    def game(self, home, away, date, h_rest=None, a_rest=None):
        z = 0.15 + 0.08 * (int(home[1]) - int(away[1]))
        p = 1 / (1 + np.exp(-z))
        return SS.split_outcomes(p, 6.1) + (p,)


@pytest.fixture(scope="module")
def engine():
    st = standings()
    return SS.Engine(st, schedule(st), FlatProbs(), n_sims=400, seed=1)


def test_projection_has_spread_and_season_id(engine):
    res = engine.run()
    out = SS.summarize(engine, res, "2026-09-30T00:00:00Z")
    assert out["season_id"] == SEASON_ID
    assert sum(t["make_playoffs_pct"] for t in out["teams"]) == pytest.approx(1600, abs=0.5)
    assert sum(t["won_cup_pct"] for t in out["teams"]) == pytest.approx(100, abs=0.5)
    for t in out["teams"]:
        assert len(t["point_dist"]) >= 10
        assert 0 < t["make_playoffs_pct"] < 100          # strength uncertainty: nobody locked in October


def test_committed_projections_are_this_season():
    d = json.load(open(os.path.join(PUBLIC, "season_projections.json")))
    assert str(d["season_id"]) == SEASON_ID and d.get("generated_at")
    col = next(t for t in d["teams"] if t["team"] == "COL")
    assert len(col["point_dist"]) >= 20
    h = json.load(open(os.path.join(PUBLIC, "season_projections_history.json")))
    assert h["season_id"] == SEASON_ID and h["snapshots"]


def test_history_keeps_one_snapshot_per_day(tmp_path):
    p = str(tmp_path / "h.json")
    out = {"generated_at": "x", "games_played": 0, "teams": [{"team": "A0", "make_playoffs_pct": 50.0,
                                                               "avg_points": 90.0, "won_cup_pct": 3.0}]}
    SS.append_history(out, p, date="2026-09-30")
    SS.append_history(dict(out, generated_at="y"), p, date="2026-09-30")
    h = SS.append_history(out, p, date="2026-10-01")
    assert [s["date"] for s in h["snapshots"]] == ["2026-09-30", "2026-10-01"]
    assert h["snapshots"][0]["generated_at"] == "y"


def test_forced_results_use_common_random_numbers(engine):
    gid = str(engine.schedule[0]["id"])
    h, a = engine.schedule[0]["home"], engine.schedule[0]["away"]
    win = engine.playoff_pct(forced=(gid, "home_reg_win"))
    loss = engine.playoff_pct(forced=(gid, "away_reg_win"))
    assert win[h][0] >= loss[h][0] and win[a][0] <= loss[a][0]
    # teams not in the game barely move (same random numbers everywhere else)
    other = next(t for t in engine.teams if t not in (h, a))
    assert abs(win[other][0] - loss[other][0]) <= 3.0


def test_implications_refuse_last_seasons_baseline(tmp_path, monkeypatch):
    monkeypatch.setattr(GI, "PUBLIC_PATH", str(tmp_path / "pub.json"))
    monkeypatch.setattr(GI, "LOCAL_PATH", str(tmp_path / "loc.json"))
    res = GI.compute_game_implications(projections={"teams": [], "total_simulations": 5000}, upcoming=[])
    assert res["status"] == "skip"
    doc = json.load(open(tmp_path / "pub.json"))
    assert doc["season_id"] == SEASON_ID and doc["games"] == [] and "not" in doc["reason"]
    ok, _ = GI.baseline_ok({"season_id": "20252026"})
    assert not ok


def test_implications_hidden_below_three_points(tmp_path, monkeypatch, engine):
    monkeypatch.setattr(GI, "PUBLIC_PATH", str(tmp_path / "pub.json"))
    monkeypatch.setattr(GI, "LOCAL_PATH", str(tmp_path / "loc.json"))
    monkeypatch.setattr(GI, "MIN_SWING_PTS", 99.0)
    g = engine.schedule[0]
    from season import today_local
    up = [{"id": g["id"], "gameDate": today_local().isoformat(), "gameType": 2, "homeTeamAbbrev": g["home"],
           "awayTeamAbbrev": g["away"]}]
    GI.compute_game_implications(engine=engine, upcoming=up, projections={"season_id": SEASON_ID})
    doc = json.load(open(tmp_path / "pub.json"))
    assert doc["games"] == [] and doc["max_swing_pts"] is not None
    monkeypatch.setattr(GI, "MIN_SWING_PTS", 0.0)
    GI.compute_game_implications(engine=engine, upcoming=up, projections={"season_id": SEASON_ID})
    doc = json.load(open(tmp_path / "pub.json"))
    assert len(doc["games"]) == 1
    gm = doc["games"][0]
    for side in ("home", "away"):
        assert 0 < gm[f"{side}_current_playoff_pct"] < 100


def test_committed_implications_are_this_season():
    d = json.load(open(os.path.join(PUBLIC, "game_implications.json")))
    assert d["season_id"] == SEASON_ID
    for g in d["games"]:
        assert str(g["game_id"])[:4] == SEASON_ID[:4]
        assert 0 < g["home_current_playoff_pct"] < 100 and 0 < g["away_current_playoff_pct"] < 100


def test_clinch_status_is_season_scoped(tmp_path):
    payload = {"standings": [{"seasonId": 20252026, "teamAbbrev": {"default": "COL"}, "clinchIndicator": "p"},
                             {"seasonId": int(SEASON_ID), "teamAbbrev": {"default": "VAN"}, "clinchIndicator": None}]}
    assert FC.clinch_map(payload) == {"VAN": None}
    p = str(tmp_path / "c.json")
    assert FC.write({"VAN": None}, p) is True
    assert FC.write({"VAN": None}, p) is False        # unchanged -> not rewritten
    d = json.load(open(p))
    assert d["season_id"] == SEASON_ID and d["teams"] == {"VAN": None}
    committed = json.load(open(os.path.join(PUBLIC, "clinch_status.json")))
    assert committed["season_id"] == SEASON_ID
    assert not [v for v in committed["teams"].values() if v in ("e", "p")] or len(committed["teams"]) == 32


def test_rollover_gamestats_and_clinch(tmp_path):
    prev = tmp_path / "nhl_season_2025_2026_gamestats.csv"
    prev.write_text("game_id,team\n2025020001,Oilers\n")
    mirrors = (str(tmp_path / "m1.csv"), str(tmp_path / "m2.csv"))
    for m in mirrors:
        open(m, "w").write("game_id,team\n2025020001,Oilers\n")
    r = rollover.roll_gamestats(2026, str(tmp_path), mirrors)
    assert r["created_season_file"] and r["mirrors_rewritten"] == 2
    for m in mirrors:
        assert open(m).read().strip() == "game_id,team"
    again = rollover.roll_gamestats(2026, str(tmp_path), mirrors)
    assert not again["created_season_file"] and again["mirrors_rewritten"] == 0
    c = str(tmp_path / "clinch.json")
    json.dump({"COL": "p"}, open(c, "w"))
    assert rollover.roll_clinch(c) == {"reset": True}
    assert json.load(open(c))["teams"] == {} and rollover.roll_clinch(c) == {"reset": False}


def test_playoff_series_exits_fast_in_regular_season(monkeypatch, capsys):
    import season_context
    monkeypatch.setattr(season_context, "postseason_games_exist", lambda *a, **k: False)
    t = time.time()
    res = UPS.main()
    assert res["status"] == "skip" and time.time() - t < 2
    assert "no postseason games" in capsys.readouterr().out


def test_playoff_series_from_nhl_payload():
    payload = {"round": 1, "seriesLetter": "A", "neededToWin": 4,
               "topSeedTeam": {"abbrev": "BUF", "seed": 1, "seriesWins": 4, "name": {"default": "Sabres"},
                               "conference": {"abbrev": "E"}},
               "bottomSeedTeam": {"abbrev": "BOS", "seed": 4, "seriesWins": 2, "name": {"default": "Bruins"}},
               "games": [{"id": 2025030111, "gameNumber": 1, "startTimeUTC": "2026-04-19T23:30:00Z",
                          "gameState": "OFF", "homeTeam": {"abbrev": "BUF", "score": 4},
                          "awayTeam": {"abbrev": "BOS", "score": 3},
                          "tvBroadcasts": [{"market": "N", "countryCode": "US", "network": "ESPN"}]}]}
    s = UPS.series_from_nhl(payload, "20252026")
    assert s["seriesId"] == "R1_E_A" and s["status"] == "complete" and s["seriesScore"] == [4, 2]
    g = s["games"][0]
    assert g["date"] == "2026-04-19" and g["startTimeCT"] == "6:30 PM" and g["score"] == [4, 3]
    assert g["tvNetwork"] == "ESPN" and g["status"] == "final"
    assert UPS.file_season([{"games": [{"date": "2026-04-19"}]}]) == "20252026"
    assert "SEASON = 2025" not in open(os.path.join(PIPELINE, "update_playoff_series.py")).read()
