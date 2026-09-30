"""B5/B7/B8/B9: schedule, starting goalies, lineups and injuries fail safe.

Offline: HTTP is either faulted with PONYXG_HTTP_FAULTS or stubbed.
Run from the repo root:  python3 -m pytest pipeline/tests -q
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

PIPELINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PIPELINE)

import http_utils  # noqa: E402
import io_utils  # noqa: E402
import fetch_dailyfaceoff as dfo  # noqa: E402
import fetch_injuries  # noqa: E402
import fetch_upcoming  # noqa: E402


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("PONYXG_MANIFEST_FILE", str(tmp_path / "manifest.json"))
    monkeypatch.setattr(http_utils.time, "sleep", lambda s: None)   # no real backoff waits
    return tmp_path


# ── B8: ESPN probable goalies and conflicts ──────────────────────────────────

def test_espn_probable_used_when_dfo_missing():
    espn = {("2026-10-01", "TOR"): "Anthony Stolarz"}
    g, status, src, conflict, alt = fetch_upcoming.resolve_goalie(
        "Home", "Maple Leafs", "TOR", "2026-10-01", {}, ["Sergei Bobrovsky", "Anthony Stolarz"], espn)
    assert (g, status, src, conflict, alt) == ("Anthony Stolarz", "Probable (ESPN)", "espn", False, None)


def test_conflict_flag_when_sources_disagree():
    dfo_goalies = {"Toronto Maple Leafs_2026-10-01": {"goalie": "Sergei Bobrovsky", "status": "Likely"}}
    espn = {("2026-10-01", "TOR"): "Anthony Stolarz"}
    g, status, src, conflict, alt = fetch_upcoming.resolve_goalie(
        "Home", "Maple Leafs", "TOR", "2026-10-01", dfo_goalies, ["Sergei Bobrovsky", "Anthony Stolarz"], espn)
    assert (g, status, src) == ("Sergei Bobrovsky", "Likely", "dailyfaceoff")
    assert conflict is True and alt == "Anthony Stolarz"


def test_unrostered_unconfirmed_dfo_goalie_rejected_before_use():
    dfo_goalies = {"Carolina Hurricanes_2026-10-01": {"goalie": "Frederik Andersen", "status": "Unconfirmed"}}
    g, status, src, _, _ = fetch_upcoming.resolve_goalie(
        "Home", "Hurricanes", "CAR", "2026-10-01", dfo_goalies, ["Pyotr Kochetkov", "Brandon Bussi"], {})
    assert g is None and src is None and status == "Unconfirmed"


def test_injuries_survive_espn_403(tmp_path, monkeypatch):
    out = tmp_path / "injuries.json"
    prev = [{"playerId": 8476454, "name": "Ryan Nugent-Hopkins", "team": "EDM", "status": "Out"}]
    out.write_text(json.dumps(prev))
    monkeypatch.setattr(fetch_injuries, "OUTPUT_FILE", str(out))
    monkeypatch.setenv("PONYXG_HTTP_FAULTS", "site.api.espn.com=403")
    res = fetch_injuries.fetch_injuries(rosters={})
    assert res["status"] == "fail"
    assert json.loads(out.read_text()) == prev
    assert "injuries.json" in io_utils.load_manifest().get("stale", {})


def test_injury_names_matched_to_nhl_ids(monkeypatch, tmp_path):
    monkeypatch.setattr(fetch_injuries, "OUTPUT_FILE", str(tmp_path / "injuries.json"))
    payload = {"injuries": [{"injuries": [{
        "status": "Out", "shortComment": "lower body", "date": "2026-09-29T16:32Z", "id": "1",
        "details": {"type": "Lower Body", "returnDate": "2026-10-13"},
        "athlete": {"displayName": "Ryan Nugent-Hopkins", "team": {"abbreviation": "EDM"},
                    "position": {"abbreviation": "C"}}}]}]}
    monkeypatch.setattr(fetch_injuries, "get_json", lambda *a, **k: payload)
    rosters = {"EDM": {"forwards": [{"id": 8476454, "firstName": {"default": "Ryan"},
                                     "lastName": {"default": "Nugent-Hopkins"}}]}}
    res = fetch_injuries.fetch_injuries(rosters=rosters, search_budget=0)
    data = json.loads((tmp_path / "injuries.json").read_text())
    assert res["matched"] == 1
    assert data[0]["playerId"] == 8476454 and data[0]["returnDate"] == "2026-10-13"


# ── B9: a failed schedule fetch never replaces upcoming_games.json ───────────

def test_schedule_522_keeps_upcoming(tmp_path, monkeypatch):
    up, pub = tmp_path / "upcoming.json", tmp_path / "public_upcoming.json"
    prev = [{"id": 2026020006, "startTimeUTC": "2026-09-30T23:30:00Z"}]
    for p in (up, pub):
        p.write_text(json.dumps(prev))
    monkeypatch.setattr(fetch_upcoming, "UPCOMING_FILE", str(up))
    monkeypatch.setattr(fetch_upcoming, "PUBLIC_UPCOMING_FILE", str(pub))
    monkeypatch.setattr(fetch_upcoming.fetch_dailyfaceoff, "fetch_dailyfaceoff_goalies", lambda **k: {})
    monkeypatch.setattr(fetch_upcoming, "get_team_goalies", lambda: {})
    monkeypatch.setattr(fetch_upcoming, "espn_probables", lambda d: {})
    monkeypatch.setenv("PONYXG_HTTP_FAULTS", "api-web.nhle.com/v1/schedule=522")
    res = fetch_upcoming.fetch_schedule()
    assert res["status"] == "fail"
    assert json.loads(up.read_text()) == prev and json.loads(pub.read_text()) == prev
    assert http_utils.request_count("/v1/schedule/") >= 3          # retried before giving up
    assert "upcoming_games.json" in io_utils.load_manifest().get("stale", {})


# ── B7: DailyFaceoff local date, merge-not-overwrite, hourly scope ───────────

def test_dfo_uses_eastern_date_and_merges(tmp_path, monkeypatch):
    gfile = tmp_path / "dfo.json"
    existing = {"Toronto Maple Leafs_2026-09-30": {
        "goalie": "Anthony Stolarz", "status": "Confirmed", "date": "2026-09-30", "team": "Toronto Maple Leafs"}}
    gfile.write_text(json.dumps(existing))
    monkeypatch.setattr(dfo, "GOALIES_FILE", str(gfile))
    monkeypatch.setattr(dfo, "_write_both", lambda path, name, data, **kw:
                        io_utils.atomic_write_json(path, data, **kw))
    urls = []

    def fake_next_data(url):
        urls.append(url)
        if url.endswith("2026-09-30"):
            return {"props": {"pageProps": {"data": [{
                "date": "2026-09-30", "homeTeamName": "Toronto Maple Leafs",
                "homeGoalieName": "Anthony Stolarz", "homeNewsStrengthName": "Unconfirmed"}]}}}
        return None   # tomorrow's page fails

    monkeypatch.setattr(dfo, "_next_data", fake_next_data)
    # 01:30 UTC on Oct 1 is still the evening of Sep 30 in the NHL's time zone
    merged = dfo.fetch_dailyfaceoff_goalies(now=datetime(2026, 10, 1, 1, 30, tzinfo=timezone.utc), force=True)
    assert urls[0].endswith("/starting-goalies/2026-09-30")
    assert urls[1].endswith("/starting-goalies/2026-10-01")
    e = merged["Toronto Maple Leafs_2026-09-30"]
    assert e["status"] == "Confirmed"              # not downgraded by a later 'Unconfirmed'
    on_disk = json.loads(gfile.read_text())
    assert on_disk["Toronto Maple Leafs_2026-09-30"]["status"] == "Confirmed"


def test_lineups_hourly_only_for_teams_playing_soon(tmp_path, monkeypatch):
    now = datetime(2026, 10, 1, 16, 0, tzinfo=timezone.utc)
    upcoming = tmp_path / "upcoming.json"
    upcoming.write_text(json.dumps([
        {"startTimeUTC": "2026-10-01T23:00:00Z", "homeTeamAbbrev": "TOR", "awayTeamAbbrev": "MTL"},
        {"startTimeUTC": "2026-10-04T23:00:00Z", "homeTeamAbbrev": "BOS", "awayTeamAbbrev": "NYR"}]))
    lfile = tmp_path / "team_lineups.json"
    lfile.write_text(json.dumps({"BOS": {"f1": [{"name": "old"}], "lineup_source": "Projected"}}))
    monkeypatch.setattr(dfo, "LINEUPS_FILE", str(lfile))
    monkeypatch.setattr(dfo, "_LINEUPS_FETCHED_THIS_RUN", {})
    monkeypatch.setattr(dfo, "_write_both", lambda path, name, data, **kw:
                        io_utils.atomic_write_json(path, data, **kw))
    real_tpw = dfo.teams_playing_within
    monkeypatch.setattr(dfo, "teams_playing_within",
                        lambda hours=36, now=None, upcoming_path=None: real_tpw(hours, now, str(upcoming)))
    io_utils.record_source("dfo_lineups_all", teams=32)          # all-teams refresh done recently
    calls = []

    def fake_next_data(url):
        calls.append(url)
        return {"props": {"pageProps": {"combinations": {
            "sourceName": "Practice", "updatedAt": "2026-10-01T15:00:00Z",
            "players": [{"groupIdentifier": "f1", "name": "P", "playerId": 1, "positionIdentifier": "c",
                         "cap": {"capHit": 1000000, "contractExpiryYear": 2028, "contractExpiresAs": "ufa"}}]}}}}

    monkeypatch.setattr(dfo, "_next_data", fake_next_data)
    teams = [{"triCode": t, "teamName": n} for t, n in
             (("TOR", "Toronto Maple Leafs"), ("MTL", "Montreal Canadiens"), ("BOS", "Boston Bruins"),
              ("NYR", "New York Rangers"))]
    merged = dfo.fetch_lineups(teams, now=now)
    assert len(calls) == 2 <= 2 * 2                                # only TOR and MTL
    assert merged["TOR"]["lineup_source"] == "Practice" and merged["TOR"]["updated_at"]
    assert merged["BOS"]["f1"][0]["name"] == "old"                  # untouched, not deleted
    assert dfo.CAP_DATA["TOR"][0]["cap"]["capHit"] == 1000000


def test_unchanged_lineups_and_injuries_are_not_rewritten(tmp_path, monkeypatch):
    """B10/B12: identical DFO lines / ESPN injuries keep the stored entries
    (movement arrows and fetched_at), so a no-change run writes nothing new."""
    lfile = tmp_path / "team_lineups.json"
    monkeypatch.setattr(dfo, "LINEUPS_FILE", str(lfile))
    monkeypatch.setattr(dfo, "_write_both", lambda path, name, data, **kw:
                        io_utils.atomic_write_json(path, data, **kw))
    payload = {"props": {"pageProps": {"combinations": {
        "sourceName": "Projected", "updatedAt": "2026-10-01T15:00:00Z",
        "players": [{"groupIdentifier": "f1", "name": "P", "playerId": 1, "positionIdentifier": "c"},
                    {"groupIdentifier": "f2", "name": "Q", "playerId": 2, "positionIdentifier": "c"}]}}}}
    monkeypatch.setattr(dfo, "_next_data", lambda url: payload)
    teams = [{"triCode": "TOR", "teamName": "Toronto Maple Leafs"}]
    lfile.write_text(json.dumps({"TOR": {"f1": [{"name": "Q", "id": 2, "pos": "c"}],
                                         "f2": [{"name": "P", "id": 1, "pos": "c"}]}}))
    monkeypatch.setattr(dfo, "_LINEUPS_FETCHED_THIS_RUN", {})
    first = dfo.fetch_lineups(teams, force_all=True)["TOR"]
    assert first["f1"][0]["movement"] == "up"
    snapshot = lfile.read_bytes()
    monkeypatch.setattr(dfo, "_LINEUPS_FETCHED_THIS_RUN", {})
    second = dfo.fetch_lineups(teams, force_all=True)["TOR"]
    assert second == first and second["f1"][0]["movement"] == "up"   # arrows kept
    assert lfile.read_bytes() == snapshot

    out = tmp_path / "injuries.json"
    monkeypatch.setattr(fetch_injuries, "OUTPUT_FILE", str(out))
    feed = {"injuries": [{"injuries": [{
        "id": "1", "status": "Out", "shortComment": "c", "date": "2026-09-29T16:32Z",
        "details": {"type": "Lower Body", "returnDate": "2026-10-13"},
        "athlete": {"displayName": "Ryan Nugent-Hopkins", "team": {"abbreviation": "EDM"},
                    "position": {"abbreviation": "C"}}}]}]}
    monkeypatch.setattr(fetch_injuries, "get_json", lambda url, **kw: feed)
    monkeypatch.setattr(fetch_injuries, "utc_now_iso", lambda: "2026-10-01T10:00:00Z")
    fetch_injuries.fetch_injuries(rosters={})
    snapshot = out.read_bytes()
    monkeypatch.setattr(fetch_injuries, "utc_now_iso", lambda: "2026-10-01T11:00:00Z")
    fetch_injuries.fetch_injuries(rosters={})
    assert out.read_bytes() == snapshot


def test_dfo_goalies_spend_no_requests_without_games(tmp_path, monkeypatch):
    """B7: hourly DFO requests <= 2 x teams playing within 36h — so zero on an off-day."""
    upcoming = tmp_path / "upcoming.json"
    upcoming.write_text("[]")
    real_tpw = dfo.teams_playing_within
    monkeypatch.setattr(dfo, "teams_playing_within",
                        lambda hours=36, now=None, upcoming_path=None: real_tpw(hours, now, str(upcoming)))
    monkeypatch.setattr(dfo, "GOALIES_FILE", str(tmp_path / "dfo.json"))
    calls = []
    monkeypatch.setattr(dfo, "_next_data", lambda url: calls.append(url))
    dfo.fetch_dailyfaceoff_goalies()
    assert calls == []
    upcoming.write_text(json.dumps([{"startTimeUTC": "2026-10-01T23:00:00Z",
                                     "homeTeamAbbrev": "TOR", "awayTeamAbbrev": "MTL"}]))
    dfo.fetch_dailyfaceoff_goalies(now=datetime(2026, 10, 1, 16, 0, tzinfo=timezone.utc))
    assert len(calls) == 2 <= 2 * 2
