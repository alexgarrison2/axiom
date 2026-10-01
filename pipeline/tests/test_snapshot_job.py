"""Forward-archive snapshot job (pipeline/bu/snapshots.py, DESIGN §2.4).

No network: every source is either parsed from a fixture payload or
monkeypatched.  Covers game selection for a given clock, price classes
(close = 0 < lead <= 15 min), the append-only gzip archive, idempotency and
tolerance of source failures."""
import gzip
import json
import os
from datetime import datetime, timezone

import pytest

from bu import snapshots as S

NOW = datetime(2026, 10, 1, 22, 47, tzinfo=timezone.utc)


def _sched_game(gid, start, state="FUT", gtype=2, home="NJD", away="PHI", hname="Devils", aname="Flyers",
                hplace="New Jersey", aplace="Philadelphia"):
    return {"id": gid, "gameType": gtype, "gameState": state, "startTimeUTC": start,
            "homeTeam": {"abbrev": home, "commonName": {"default": hname}, "placeName": {"default": hplace}},
            "awayTeam": {"abbrev": away, "commonName": {"default": aname}, "placeName": {"default": aplace}}}


SCHEDULE = {"gameWeek": [
    {"date": "2026-10-01", "games": [
        _sched_game(2026020009, "2026-10-01T23:00:00Z"),                                   # T-13: close window
        _sched_game(2026020010, "2026-10-01T23:00:00Z", home="NYR", away="TBL", hname="Rangers",
                    aname="Lightning", hplace="New York", aplace="Tampa Bay"),
        _sched_game(2026020012, "2026-10-02T00:00:00Z", home="NSH", away="MIN", hname="Predators",
                    aname="Wild", hplace="Nashville", aplace="Minnesota"),                 # T-73
        _sched_game(2026020008, "2026-10-01T22:30:00Z", state="LIVE", home="TOR", away="NYI"),  # started
        _sched_game(2026020007, "2026-10-01T22:47:00Z", home="COL", away="LAK"),           # lead exactly 0
        _sched_game(2026010099, "2026-10-01T23:05:00Z", gtype=1, home="BOS", away="MTL"),  # preseason
    ]},
    {"date": "2026-10-02", "games": [_sched_game(2026020017, "2026-10-02T22:30:00Z", home="DET", away="NYR")]},
]}


@pytest.fixture
def games():
    return S.parse_schedule(SCHEDULE)


# ── selection ────────────────────────────────────────────────────────────────

def test_parse_schedule_normalises_games(games):
    g = {x["game_id"]: x for x in games}
    assert len(games) == 7
    assert g[2026020009]["game_date"] == "2026-10-01" and g[2026020017]["game_date"] == "2026-10-02"
    assert g[2026020009]["home_full"] == "New Jersey Devils" and g[2026020009]["home_name"] == "Devils"
    assert g[2026010099]["game_type"] == "01" and g[2026020009]["game_type"] == "02"


def test_close_window_picks_only_games_starting_soon(games):
    chosen = S.select_games(games, NOW, window_min=25)
    assert [g["game_id"] for g in chosen] == [2026020009, 2026020010]
    assert all(g["lead_min"] == 13.0 for g in chosen)


def test_selection_excludes_started_live_and_preseason(games):
    ids = {g["game_id"] for g in S.select_games(games, NOW, window_min=24 * 60)}
    assert 2026020008 not in ids          # LIVE
    assert 2026020007 not in ids          # lead == 0: no longer pregame
    assert 2026010099 not in ids          # preseason
    assert {2026020009, 2026020010, 2026020012, 2026020017} <= ids


def test_selection_adds_named_games_outside_window_but_never_started_ones(games):
    ids = [g["game_id"] for g in S.select_games(games, NOW, 25, game_ids=[2026020012, 2026020008])]
    assert ids == [2026020009, 2026020010, 2026020012]


def test_selection_at_later_clock_moves_to_next_slot(games):
    later = datetime(2026, 10, 1, 23, 47, tzinfo=timezone.utc)
    assert [g["game_id"] for g in S.select_games(games, later, 25)] == [2026020012]
    assert S.select_games(games, datetime(2026, 10, 1, 15, 0, tzinfo=timezone.utc), 25) == []


# ── price classes, closes, q0 ────────────────────────────────────────────────

def _row(gid, captured, prices, start="2026-10-01T23:00:00Z", date="2026-10-01"):
    return {"v": 1, "game_id": gid, "game_date": date, "season": "2026-27", "game_type": "02",
            "start_utc": start, "captured_at": captured, "prices": prices}


def _p(book, fetched, home=-150, away=130, source="x"):
    return {"book": book, "source": source, "fetched_at": fetched, "home_ml": home, "away_ml": away}


def test_price_class_boundaries():
    assert S.price_class(15.0) == "close"
    assert S.price_class(0.5) == "close"
    assert S.price_class(15.01) == "snapshot"
    assert S.price_class(0) is None and S.price_class(-3) is None and S.price_class(None) is None


def test_closes_and_earliest_pick_the_right_prices():
    rows = [
        _row(1, "2026-10-01T15:07:00Z", [_p("draftkings", "2026-10-01T15:07:10Z", -140, 120),
                                         _p("bovada", "2026-10-01T15:07:12Z", -145, 125)]),
        _row(1, "2026-10-01T22:30:00Z", [_p("draftkings", "2026-10-01T22:30:05Z", -150, 130)]),   # T-30
        _row(1, "2026-10-01T22:47:00Z", [_p("draftkings", "2026-10-01T22:47:05Z", -155, 135)]),   # T-13
        _row(1, "2026-10-01T22:52:00Z", [_p("draftkings", "2026-10-01T22:52:05Z", -160, 140)]),   # T-8: close
        _row(1, "2026-10-01T23:01:00Z", [_p("draftkings", "2026-10-01T23:01:00Z", -400, 300)]),   # after start
        _row(2, "2026-09-30T23:10:00Z", [_p("draftkings", "2026-09-30T23:10:00Z")],               # day before
             start="2026-10-02T00:00:00Z", date="2026-10-01"),
        _row(2, "2026-10-01T16:00:00Z", [_p("draftkings", "2026-10-01T16:00:00Z", -110, -110)],
             start="2026-10-02T00:00:00Z", date="2026-10-01"),
    ]
    pr = S.price_rows(rows)
    assert all(p["lead_min"] > 0 for p in pr)          # the post-start price is dropped
    c = S.closes(pr)
    assert set(c) == {(1, "draftkings")}
    assert c[(1, "draftkings")]["home_ml"] == -160 and c[(1, "draftkings")]["lead_min"] == pytest.approx(7.92, abs=0.01)
    e = S.earliest(pr, min_lead_min=60)
    assert e[(1, "draftkings")]["home_ml"] == -140 and e[(1, "bovada")]["home_ml"] == -145
    assert e[(2, "draftkings")]["home_ml"] == -110      # the previous day's price is not q0
    assert S.closes(pr, book="bovada") == {}
    cov = S.coverage(rows, [1, 2])
    assert cov["games"] == 2 and cov["with_close"] == 1 and cov["pct"] == 50.0 and cov["missing"] == [2]


# ── source parsers ───────────────────────────────────────────────────────────

ESPN_SCOREBOARD = {"events": [{
    "date": "2026-10-01T23:00Z",
    "competitions": [{
        "status": {"type": {"state": "pre"}},
        "competitors": [{"homeAway": "home", "team": {"abbreviation": "NJ"}},
                        {"homeAway": "away", "team": {"abbreviation": "PHI"}}],
        "odds": [{
            "provider": {"name": "DraftKings"}, "overUnder": 5.5,
            "moneyline": {"home": {"close": {"odds": "-162"}, "open": {"odds": "-155"}},
                          "away": {"close": {"odds": "+136"}, "open": {"odds": "+130"}}},
            "pointSpread": {"home": {"close": {"line": "-1.5", "odds": "+154"}},
                            "away": {"close": {"line": "+1.5", "odds": "-185"}}},
            "total": {"over": {"close": {"line": "o5.5", "odds": "-130"}},
                      "under": {"close": {"line": "u5.5", "odds": "+110"}}},
        }],
    }],
}, {
    "date": "2026-10-01T22:00Z",
    "competitions": [{"status": {"type": {"state": "in"}}, "competitors": [], "odds": []}],
}]}


def test_parse_espn_odds(games):
    out = S.parse_espn_odds(ESPN_SCOREBOARD, games, "2026-10-01T22:47:03Z")
    assert set(out) == {2026020009}
    p = out[2026020009]
    assert p["book"] == "draftkings" and p["source"] == "espn" and p["fetched_at"] == "2026-10-01T22:47:03Z"
    assert (p["home_ml"], p["away_ml"], p["total_line"], p["over"], p["under"]) == (-162, 136, 5.5, -130, 110)
    assert (p["pl_spread"], p["pl_home"], p["pl_away"]) == (-1.5, 154, -185)
    assert p["open"] == {"home_ml": -155, "away_ml": 130}


def test_price_from_fetch_odds_book(games):
    import fetch_odds as FO
    g = games[0]
    b = FO.Book(S._book_shape(g), "t")
    b.put_ml(-150, 130, "nhl_partner_draftkings")
    b.put("total_line", "6.5", "s")
    b.put("total_over", -105, "s")
    b.put("Devils_puckline", 170, "s")
    b.put("Devils_puckline_spread", "-1.5", "s")
    b.put("Flyers_puckline", -200, "s")
    b.put("three_way_tie", 300, "s")
    p = S.price_from_book_entry(b.e, "draftkings", "nhl_partner", "2026-10-01T22:47:01Z")
    assert p == {"book": "draftkings", "source": "nhl_partner", "fetched_at": "2026-10-01T22:47:01Z",
                 "home_ml": -150, "away_ml": 130, "total_line": 6.5, "over": -105, "pl_spread": -1.5,
                 "pl_home": 170, "pl_away": -200, "three_way_tie": 300}
    assert S.price_from_book_entry(FO.Book(S._book_shape(g), "t").e, "x", "y", "z") is None


def test_partner_and_bovada_sources_use_fetch_odds(monkeypatch, games):
    import fetch_odds as FO
    partner = {"currentOddsDate": "2026-10-01", "bettingPartner": {"name": "DraftKings"}, "games": [
        {"gameId": 2026020009, "startTimeUTC": "2026-10-01T23:00:00Z",
         "homeTeam": {"odds": [{"description": "MONEY_LINE_2_WAY", "value": -150, "qualifier": ""}]},
         "awayTeam": {"odds": [{"description": "MONEY_LINE_2_WAY", "value": 130, "qualifier": ""}]}}]}
    monkeypatch.setattr(FO, "try_get_json", lambda url, *a, **k: partner if "partner-game" in url else None)
    got = S.fetch_odds_source(games[:2], NOW, "partner")
    assert list(got) == [2026020009]
    assert got[2026020009]["book"] == "draftkings" and got[2026020009]["source"] == "nhl_partner"
    assert S.fetch_odds_source(games[:2], NOW, "bovada") == {}


def test_parse_dfo_goalies_and_lineup():
    blob = {"props": {"pageProps": {"data": [{
        "date": "2026-10-01", "homeTeamName": "New Jersey Devils", "awayTeamName": "Philadelphia Flyers",
        "homeGoalieName": "Jake Allen", "homeGoalieId": 1305, "homeNewsStrengthName": "Confirmed",
        "homeTeamSlug": "new-jersey-devils", "awayGoalieName": "Joseph Woll", "awayGoalieId": 27288}]}}}
    g = S.parse_dfo_goalies(blob, "T")
    assert g[("2026-10-01", "NJD")]["status"] == "Confirmed"
    assert g[("2026-10-01", "PHI")]["status"] == "Unconfirmed" and g[("2026-10-01", "PHI")]["dfo_id"] == 27288
    lines = {"f1": [{"id": 1, "name": "A", "gameTimeDecision": True}, {"id": 2, "name": "B", "injuryStatus": "dtd"}],
             "d1": [{"id": 3, "name": "C"}], "g": [{"id": 4, "name": "G"}],
             "ir": [{"id": 5, "name": "E", "injuryStatus": "out"}], "pk1": [{"id": 1, "name": "A"}]}
    lu = S.compact_lineup(lines, {"lineup_source": "Beat", "updated_at": "U"}, "T")
    assert lu["lines"] == {"f1": [[1, "A"], [2, "B"]], "d1": [[3, "C"]], "g": [[4, "G"]]}
    assert lu["out"] == [[2, "B", "dtd", "lineup"], [5, "E", "out", "ir"]]
    assert lu["gtd"] == [[1, "A"]] and lu["source"] == "Beat"


def test_parse_espn_injuries_filters_teams_and_drops_comments():
    data = {"injuries": [{"displayName": "New Jersey Devils", "injuries": [
        {"status": "Out", "date": "D", "shortComment": "secret text", "longComment": "more",
         "athlete": {"displayName": "Connor Brown", "team": {"abbreviation": "NJ"}, "position": {"abbreviation": "RW"}},
         "details": {"type": "Knee", "returnDate": "2026-10-06"}}]},
        {"displayName": "Boston Bruins", "injuries": [
            {"status": "Out", "athlete": {"displayName": "X", "team": {"abbreviation": "BOS"}}}]}]}
    out = S.parse_espn_injuries(data, {"NJD", "PHI"})
    assert out == {"NJD": [{"name": "Connor Brown", "status": "Out", "type": "Knee", "date": "D",
                            "return": "2026-10-06", "pos": "RW"}]}


# ── end-to-end run (sources mocked) ──────────────────────────────────────────

@pytest.fixture
def mocked_sources(monkeypatch):
    state = {"home_ml": -150}

    def prices(games, now):
        return ({g["game_id"]: [_p("draftkings", S.iso(now), state["home_ml"], 130, "nhl_partner")] for g in games},
                ["bovada: no pregame prices"])

    def lineups(games):
        return ({("2026-10-01", "NJD"): {"name": "Jake Allen", "status": "Confirmed", "fetched_at": "T"}},
                {"NJD": {"lines": {"g": [[1305, "Jake Allen"]]}, "out": [], "gtd": [], "fetched_at": "T"}}, [])

    monkeypatch.setattr(S, "fetch_prices", prices)
    monkeypatch.setattr(S, "fetch_lineups_and_goalies", lineups)
    monkeypatch.setattr(S, "fetch_injuries", lambda teams: ({"NJD": [{"name": "Connor Brown", "status": "Out"}]}, []))
    monkeypatch.setattr(S, "read_published", lambda path=None: {2026020009: {
        "model_version": "logit-elo-v5", "predicted_at": "2026-10-01T22:05:00Z", "home_model_pct": 62.7,
        "home_win_pct": 60.9, "blend_weight": 0.2}})
    return state


def test_run_writes_timestamped_rows_and_is_idempotent(tmp_path, games, mocked_sources):
    res = S.run(now=NOW, window_min=25, root=str(tmp_path), games=games, trigger="cron", run_id="42")
    assert res["games"] == [2026020009, 2026020010]
    path = tmp_path / "2026-27" / "2026-10-01.jsonl.gz"
    assert res["written"] == {os.path.join("2026-27", "2026-10-01.jsonl.gz"): 2}
    rows = S.read_rows(str(path))
    assert [r["game_id"] for r in rows] == [2026020009, 2026020010]
    r = rows[0]
    assert r["captured_at"] == "2026-10-01T22:47:00Z" and r["lead_min"] == 13.0
    assert r["start_utc"] == "2026-10-01T23:00:00Z" and r["season"] == "2026-27" and r["game_type"] == "02"
    assert r["trigger"] == "cron" and r["run"] == "42" and r["v"] == S.SCHEMA_VERSION
    assert r["prices"][0]["home_ml"] == -150 and r["prices"][0]["fetched_at"] == "2026-10-01T22:47:00Z"
    assert r["goalies"]["home"]["status"] == "Confirmed" and r["goalies"]["away"] is None
    assert r["lineups"]["home"]["lines"]["g"] == [[1305, "Jake Allen"]] and r["lineups"]["away"] is None
    assert r["injuries"]["home"][0]["name"] == "Connor Brown" and r["injuries"]["away"] == []
    assert r["published"]["home_model_pct"] == 62.7
    assert r["errors"] == ["bovada: no pregame prices"]
    assert rows[1]["published"] is None
    size1 = path.stat().st_size

    # Same information a minute later (a retried / doubly-triggered run): nothing appended.
    again = S.run(now=datetime(2026, 10, 1, 22, 48, tzinfo=timezone.utc), window_min=25, root=str(tmp_path),
                  games=games)
    assert again["written"] == {os.path.join("2026-27", "2026-10-01.jsonl.gz"): 0}
    assert path.stat().st_size == size1

    # A moved line is new information: appended as a second gzip member, old bytes untouched.
    before = path.read_bytes()
    mocked_sources["home_ml"] = -160
    S.run(now=datetime(2026, 10, 1, 22, 52, tzinfo=timezone.utc), window_min=25, root=str(tmp_path), games=games)
    after = path.read_bytes()
    assert after.startswith(before) and len(after) > len(before)
    rows = S.read_rows(str(path))
    assert len(rows) == 4 and rows[-2]["prices"][0]["home_ml"] == -160
    with gzip.open(path, "rt") as fh:           # stock gzip readers see every member
        assert len([json.loads(x) for x in fh]) == 4
    c = S.closes(S.price_rows(rows))
    assert c[(2026020009, "draftkings")]["home_ml"] == -160


def test_identical_rows_far_apart_are_both_kept(tmp_path, games, mocked_sources):
    S.run(now=NOW, window_min=25, root=str(tmp_path), games=games)
    res = S.run(now=datetime(2026, 10, 1, 22, 55, tzinfo=timezone.utc), window_min=25, root=str(tmp_path),
                games=games)
    assert sum(res["written"].values()) == 2      # 8 min later: a fresh confirmation of the price


def test_dry_run_writes_nothing(tmp_path, games, mocked_sources):
    res = S.run(now=NOW, window_min=25, root=str(tmp_path), games=games, dry_run=True)
    assert len(res["rows"]) == 2 and not any(tmp_path.iterdir())


def test_no_games_in_window_is_a_quiet_no_op(tmp_path, games, mocked_sources):
    res = S.run(now=datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc), root=str(tmp_path), games=games)
    assert res["selected"] == 0 and not any(tmp_path.iterdir())


def test_truncated_trailing_member_is_tolerated(tmp_path):
    p = tmp_path / "d.jsonl.gz"
    good = S._gzip_member([{"game_id": 1}, {"game_id": 2}])
    bad = S._gzip_member([{"game_id": 3}])[:-12]
    p.write_bytes(good + bad)
    assert [r["game_id"] for r in S.read_rows(str(p))] == [1, 2]
    assert S.read_rows(str(tmp_path / "missing.jsonl.gz")) == []


def test_source_failures_never_raise(tmp_path, games, monkeypatch):
    """Every host down: the run records the errors and still writes the rows
    (schedule-derived fields and the published model are still worth keeping)."""
    import http_utils
    monkeypatch.setattr(http_utils.time, "sleep", lambda s: None)
    monkeypatch.setattr(S.time, "sleep", lambda s: None)
    monkeypatch.setenv("PONYXG_HTTP_FAULTS", "nhle.com=503,bovada=503,espn.com=403,dailyfaceoff=timeout")
    res = S.run(now=NOW, window_min=25, root=str(tmp_path), games=games)
    rows = S.read_rows(str(tmp_path / "2026-27" / "2026-10-01.jsonl.gz"))
    assert len(rows) == 2 and all(r["prices"] == [] for r in rows)
    assert rows[0]["injuries"] is None
    errs = " | ".join(res["errors"])
    for needle in ("partner", "bovada", "espn scoreboard", "espn injuries", "dfo goalies", "dfo lineup"):
        assert needle in errs


def test_schedule_failure_selects_nothing(monkeypatch, tmp_path):
    monkeypatch.setattr(S, "try_get_json", lambda *a, **k: None)
    res = S.run(now=NOW, root=str(tmp_path))
    assert res["selected"] == 0 and res["errors"] == ["schedule 2026-10-01: unavailable"]


def test_read_published_parses_committed_predictions(tmp_path):
    p = tmp_path / "pred.csv"
    p.write_text("nhl_game_id,model_version,predicted_at,home_model_win_pct,home_win_pct,blend_weight,home_gp\n"
                 "2026020009,logit-elo-v5,2026-10-01T04:35:46Z,62.7,60.9,0.2,0\n"
                 "bad,,,,,,\n")
    out = S.read_published(str(p))
    assert out == {2026020009: {"model_version": "logit-elo-v5", "predicted_at": "2026-10-01T04:35:46Z",
                                "home_model_pct": 62.7, "home_win_pct": 60.9, "blend_weight": 0.2,
                                "home_gp": 0.0}}
    assert S.read_published(str(tmp_path / "missing.csv")) == {}


def test_cli_dry_run_with_fixture_schedule(monkeypatch, capsys, mocked_sources):
    monkeypatch.setattr(S, "try_get_json", lambda url, *a, **k: SCHEDULE if "schedule" in url else None)
    assert S.main(["--dry-run", "--now", "2026-10-01T22:47:00Z", "--window", "25"]) == 0
    out = capsys.readouterr().out
    assert '"selected": 2' in out and '"game_id": 2026020009' in out
