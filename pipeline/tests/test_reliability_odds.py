"""B3: pregame-only odds keyed by NHL gameId, sanity rules, closing-line snapshot.

Offline: every source is served from in-memory fixtures.
Run from the repo root:  python3 -m pytest pipeline/tests -q
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

PIPELINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PIPELINE)

import fetch_odds  # noqa: E402
import validate_outputs  # noqa: E402

NOW = datetime(2026, 10, 1, 23, 30, tzinfo=timezone.utc)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def game(gid, home, away, hname, aname, start, state="FUT"):
    return {"id": gid, "gameDate": "2026-10-01", "startTimeUTC": iso(start), "gameState": state,
            "homeTeam": hname, "awayTeam": aname, "homeTeamAbbrev": home, "awayTeamAbbrev": away}


UPCOMING = [
    game(2026020020, "BOS", "NYR", "Bruins", "Rangers", NOW - timedelta(minutes=30), "LIVE"),  # started
    game(2026020021, "TOR", "MTL", "Maple Leafs", "Canadiens", NOW + timedelta(hours=1)),
    game(2026020022, "EDM", "VAN", "Oilers", "Canucks", NOW + timedelta(hours=3)),
]


def bovada_event(eid, away_full, home_full, start, live=False, total="6.5", pl_home="+140",
                 ml_home="-150", ml_away="+130"):
    return {
        "id": eid, "description": f"{away_full} @ {home_full}", "live": live,
        "startTime": int(start.timestamp() * 1000),
        "displayGroups": [{"description": "Game Lines", "markets": [
            {"description": "Moneyline", "period": {"abbreviation": "G"}, "outcomes": [
                {"description": home_full, "price": {"american": ml_home}},
                {"description": away_full, "price": {"american": ml_away}}]},
            {"description": "Puck Line", "period": {"abbreviation": "G"}, "outcomes": [
                {"description": home_full, "price": {"american": pl_home, "handicap": "-1.5"}},
                {"description": away_full, "price": {"american": "-160", "handicap": "1.5"}}]},
            {"description": "Total", "period": {"abbreviation": "G"}, "outcomes": [
                {"description": "Over", "price": {"american": "-110", "handicap": total}},
                {"description": "Under", "price": {"american": "-110", "handicap": total}}]},
        ]}],
    }


def partner_payload():
    def team(ml):
        return {"odds": [{"description": "MONEY_LINE_2_WAY", "value": ml, "qualifier": ""},
                         {"description": "OVER_UNDER", "value": -115, "qualifier": "O6.5"}]}
    return {"currentOddsDate": "2026-10-01", "bettingPartner": {"name": "DraftKings"}, "games": [
        # live in-game prices for the started game must be ignored
        {"gameId": 2026020020, "startTimeUTC": iso(NOW - timedelta(minutes=30)),
         "homeTeam": team(-3500), "awayTeam": team(1800)},
        {"gameId": 2026020021, "startTimeUTC": iso(NOW + timedelta(hours=1)),
         "homeTeam": team(-135), "awayTeam": team(115)},
    ]}


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    monkeypatch.setenv("PONYXG_MANIFEST_FILE", str(tmp_path / "manifest.json"))
    monkeypatch.setattr(fetch_odds, "ODDS_FILE", str(tmp_path / "odds.json"))
    monkeypatch.setattr(fetch_odds, "CLOSING_FILE", str(tmp_path / "odds_closing.json"))
    monkeypatch.setattr(fetch_odds, "public_path", lambda *p: str(tmp_path / "public" / os.path.join(*p)))
    monkeypatch.setattr(fetch_odds, "data_path", lambda *p: str(tmp_path / "data" / os.path.join(*p)))
    (tmp_path / "public").mkdir()
    (tmp_path / "data").mkdir()
    feeds = {
        "partner-game": partner_payload(),
        "/schedule/": {"gameWeek": []},
        "bovada": [{"events": [
            bovada_event("b1", "New York Rangers", "Boston Bruins", NOW - timedelta(minutes=30), live=True,
                         total="2.5", pl_home="+1400"),
            bovada_event("b2", "Montreal Canadiens", "Toronto Maple Leafs", NOW + timedelta(hours=1)),
            bovada_event("b3", "Vancouver Canucks", "Edmonton Oilers", NOW + timedelta(hours=3), total="3.5",
                         pl_home="+1500"),
        ]}],
        "espn": {"events": []},
    }

    def fake(url, default=None, **kw):
        for key, payload in feeds.items():
            if key in url:
                return payload
        return default

    monkeypatch.setattr(fetch_odds, "try_get_json", fake)
    return tmp_path, feeds


def test_pregame_only_keyed_by_game_id(sandbox, capsys):
    tmp, _ = sandbox
    res = fetch_odds.fetch_odds(now=NOW, upcoming=UPCOMING)
    odds = json.load(open(tmp / "odds.json"))
    assert set(odds) == {"2026020021", "2026020022"}          # started game dropped
    for gid, e in odds.items():
        assert len(gid) == 10 and gid.isdigit()
        assert e["start_time_utc"] > e["fetched_at"]            # no game at/after start
        assert not fetch_odds.sanity_problems(e)
    tor = odds["2026020021"]
    assert tor["source"] == "nhl_partner_draftkings" and tor["home_ml"] == -135   # partner is primary
    assert tor["Maple Leafs_puckline"] == 140                   # Bovada fills what partner lacks
    edm = odds["2026020022"]
    assert edm["source"] == "bovada"
    assert "total_line" not in edm                              # 3.5 total scrubbed
    assert "Oilers_puckline" not in edm                         # +1500 puck line scrubbed
    out = capsys.readouterr().out
    assert "live/started skipped" in out and "matched 16 of 8" not in out
    assert res["status"] == "ok"
    # public and data copies are identical
    assert json.load(open(tmp / "public" / "odds.json")) == odds


def test_never_writes_empty_file(sandbox):
    tmp, feeds = sandbox
    fetch_odds.fetch_odds(now=NOW, upcoming=UPCOMING)
    before = open(tmp / "odds.json").read()
    feeds["partner-game"] = None
    feeds["bovada"] = None
    res = fetch_odds.fetch_odds(now=NOW + timedelta(minutes=5), upcoming=UPCOMING)
    # previous pregame lines carried forward, file never emptied
    after = json.load(open(tmp / "odds.json"))
    assert set(after) == set(json.loads(before))
    # every game started, all sources down: the file is kept, not emptied
    res = fetch_odds.fetch_odds(now=NOW + timedelta(hours=4), upcoming=UPCOMING)
    assert res["status"] in ("skip", "fail")
    assert json.load(open(tmp / "odds.json"))


def test_closing_snapshot_frozen_after_start(sandbox):
    tmp, feeds = sandbox
    fetch_odds.fetch_odds(now=NOW, upcoming=UPCOMING)
    fetch_odds.fetch_odds(now=NOW + timedelta(minutes=50), upcoming=UPCOMING)
    closing = json.load(open(tmp / "odds_closing.json"))
    snap = closing["2026020021"]
    assert snap["captured_at"] == iso(NOW + timedelta(minutes=50))   # last pregame capture
    # after puck drop the price moves (live) — the closing entry must not change
    feeds["partner-game"]["games"][1]["homeTeam"]["odds"][0]["value"] = -900
    fetch_odds.fetch_odds(now=NOW + timedelta(hours=2), upcoming=UPCOMING)
    closing2 = json.load(open(tmp / "odds_closing.json"))
    assert closing2["2026020021"] == snap
    assert list(closing2).count("2026020021") == 1
    assert all(len(k) == 10 for k in closing2)


def test_validator_rejects_live_line(tmp_path, monkeypatch):
    live = {"2026020021": {"game_id": 2026020021, "start_time_utc": "2026-10-01T23:00:00Z",
                           "fetched_at": "2026-10-01T23:10:00Z", "home_ml": -135, "away_ml": 115,
                           "total_line": "6.5"}}
    probs = fetch_odds.sanity_problems(live["2026020021"])
    assert "fetched after start" in probs
    low = dict(live["2026020021"], fetched_at="2026-10-01T22:00:00Z", total_line="2.5")
    assert any("total_line" in p for p in fetch_odds.sanity_problems(low))
    pl = dict(low, total_line="6.5", **{"Leafs_puckline": 1400})
    assert any("puckline" in p for p in fetch_odds.sanity_problems(pl))
    assert fetch_odds.validate_odds({"2026-10-01:A@B": low}) == "non-gameId keys"
