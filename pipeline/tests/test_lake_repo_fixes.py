"""sm-lake-3: duplicate PBP appends and shift-chart player IDs (DESIGN §3.0)."""
import os
from datetime import datetime, timezone

import pandas as pd
import pytest

import fetch_shifts as FS
import update_raw_pbp as U


@pytest.fixture(autouse=True)
def _isolated_manifest(tmp_path, monkeypatch):
    # atomic_write_csv records stale flags in the pipeline manifest; keep tests off the real one.
    monkeypatch.setenv("PONYXG_MANIFEST_FILE", str(tmp_path / "manifest.json"))


# ----------------------------------------------------------------- update_raw_pbp

def _week(start_day: int, games_by_day: dict[int, list[int]]):
    """A /schedule/{date} payload: the whole game week starting at ``start_day``."""
    return {"gameWeek": [
        {"date": f"2026-10-{d:02d}",
         "games": [{"id": g, "gameType": 2, "gameState": "OFF"} for g in games_by_day.get(d, [])]}
        for d in range(start_day, start_day + 7)
    ]}


def _pbp(gid, n=3):
    return {"plays": [{"eventId": i, "typeCode": 516, "typeDescKey": "stoppage", "sortOrder": i,
                       "periodDescriptor": {"number": 1, "periodType": "REG"}, "details": {}}
                      for i in range(1, n + 1)]}


def test_schedule_week_is_filtered_to_the_requested_day(monkeypatch):
    days = {7: [2026020011], 8: [2026020021, 2026020022], 9: [2026020031]}
    monkeypatch.setattr(U, "get_url", lambda url: _week(int(url[-2:]), days))
    assert [g["id"] for g in U.get_schedule_games("2026-10-08")] == [2026020021, 2026020022]


def test_lookback_run_never_duplicates_and_heals_existing(tmp_path, monkeypatch):
    path = str(tmp_path / "raw_pbp.csv")
    days = {d: [2026020000 + d] for d in range(1, 31)}
    calls = []

    def fake_get(url):
        calls.append(url)
        if "/schedule/" in url:
            return _week(int(url[-2:]), days)
        gid = int(url.split("/gamecenter/")[1].split("/")[0])
        return _pbp(gid)

    monkeypatch.setattr(U, "get_url", fake_get)
    monkeypatch.setattr(U, "DELAY", 0)

    class _D(U.date):
        @classmethod
        def today(cls):
            return U.date(2026, 10, 10)
    monkeypatch.setattr(U, "date", _D)

    U.main(days_back=3, path=path)
    U.main(days_back=3, path=path)          # second run: nothing new
    df = pd.read_csv(path)
    assert not df.duplicated(["game_id", "eventId"]).any()
    assert sorted(df["game_id"].unique()) == [2026020007, 2026020008, 2026020009]
    pbp_calls = [c for c in calls if "play-by-play" in c]
    assert len(pbp_calls) == 3              # each game fetched once, not once per look-back day

    # A file that already carries duplicates (the old 3x appends) is healed.
    dup = pd.concat([df, df, df], ignore_index=True)
    dup.to_csv(path, index=False)
    U.main(days_back=3, path=path)
    healed = pd.read_csv(path)
    assert len(healed) == len(df)
    assert not healed.duplicated(["game_id", "eventId"]).any()


def test_upsert_skips_stored_keys(tmp_path):
    path = str(tmp_path / "raw.csv")
    a = pd.DataFrame({"game_id": [1, 1], "eventId": [1, 2], "v": ["a", "b"]})
    assert U.upsert_rows(a, path) == 2
    b = pd.DataFrame({"game_id": [1, 1, 2], "eventId": [2, 3, 1], "v": ["b", "c", "d"]})
    assert U.upsert_rows(b, path) == 2
    out = pd.read_csv(path)
    assert len(out) == 4 and not out.duplicated(["game_id", "eventId"]).any()


# ------------------------------------------------------------------ fetch_shifts

def _rest_payload(gid, dup=True):
    rows = [
        {"playerId": 8478402, "firstName": "Connor", "lastName": "McDavid", "teamId": 22, "teamAbbrev": "EDM",
         "period": 1, "startTime": "00:00", "endTime": "00:45", "typeCode": 517},
        {"playerId": 8477934, "firstName": "Leon", "lastName": "Draisaitl", "teamId": 22, "teamAbbrev": "EDM",
         "period": 1, "startTime": "00:45", "endTime": "01:30", "typeCode": 517},
        # goal row carried by the shift feed — not a shift
        {"playerId": 8478402, "firstName": "Connor", "lastName": "McDavid", "teamId": 22, "teamAbbrev": "EDM",
         "period": 1, "startTime": "01:10", "endTime": "01:10", "typeCode": 505},
    ]
    if dup:
        rows.append(dict(rows[0]))
    return {"data": rows, "total": len(rows)}


def test_rest_parse_dedupes_and_drops_goal_rows():
    rows = FS.parse_rest_shifts(_rest_payload(2025020001), 2025020001)
    assert len(rows) == 2
    assert all(r["player_id"] is not None for r in rows)


def test_html_fallback_resolves_player_ids_from_boxscore_numbers():
    html = """
    <table>
      <tr><td>97 MCDAVID, CONNOR</td></tr>
      <tr class="oddColor"><td>1</td><td>1</td><td>0:00 / 20:00</td><td>0:45 / 19:15</td><td>00:45</td></tr>
      <tr class="evenColor"><td>2</td><td>1</td><td>2:00 / 18:00</td><td>2:40 / 17:20</td><td>00:40</td></tr>
      <tr><td>29 DRAISAITL, LEON</td></tr>
      <tr class="oddColor"><td>1</td><td>1</td><td>0:45 / 19:15</td><td>1:30 / 18:30</td><td>00:45</td></tr>
    </table>"""
    box = {"homeTeam": {"id": 22, "abbrev": "EDM"}, "awayTeam": {"id": 20, "abbrev": "CGY"},
           "playerByGameStats": {"homeTeam": {"forwards": [
               {"playerId": 8478402, "sweaterNumber": 97, "name": {"default": "C. McDavid"}},
               {"playerId": 8477934, "sweaterNumber": 29, "name": {"default": "L. Draisaitl"}}]},
               "awayTeam": {}}}
    meta = FS.boxscore_meta(box)
    rows = FS.parse_html_toi_report(html, 2025020001, 22, "EDM", meta["home"]["numbers"])
    assert len(rows) == 3
    assert {r["player_id"] for r in rows} == {8478402, 8477934}
    assert rows[0]["player_name"] == "Connor Mcdavid"


def _gamestats(path, games):
    pd.DataFrame({"game_id": [g for g, _ in games], "game_date": [d for _, d in games]}).to_csv(path, index=False)


def test_rest_preferred_html_only_after_gap_and_null_games_upgraded(tmp_path, monkeypatch):
    season = 2025
    paths = FS.season_paths(season)
    _gamestats(tmp_path / paths["gamestats"], [(2025020001, "2025-10-07"), (2025020002, "2026-09-30"),
                                                (2025020003, "2025-10-08")])
    # Stored: game 3 came from the old HTML fallback (no IDs) with a duplicate row.
    old = pd.DataFrame([
        {"game_id": 2025020003, "period": 1, "start_seconds": 0, "end_seconds": 40, "player_id": None,
         "player_name": "Connor Mcdavid", "team_id": 22, "team_abbrev": "EDM"},
        {"game_id": 2025020003, "period": 1, "start_seconds": 0, "end_seconds": 40, "player_id": None,
         "player_name": "Connor Mcdavid", "team_id": 22, "team_abbrev": "EDM"},
    ])
    FS.append_rows(str(tmp_path / paths["shifts"]), old.to_dict("records"))

    rest_ready = {2025020001, 2025020003}
    html_called = []
    monkeypatch.setattr(FS, "RATE_LIMIT_DELAY", 0)
    monkeypatch.setattr(FS, "fetch_shifts_rest_api",
                        lambda gid: FS.parse_rest_shifts(_rest_payload(gid), gid) if gid in rest_ready else [])
    monkeypatch.setattr(FS, "fetch_shifts_html", lambda *a, **k: html_called.append(a) or [])
    monkeypatch.setattr(FS, "fetch_boxscore_meta", lambda gid: {"home": {}, "away": {}})

    now = datetime(2026, 10, 1, 14, tzinfo=timezone.utc)   # game 2 finished < 72 h ago
    res = FS.main(["--season", str(season)], now=now, workdir=str(tmp_path))
    assert res["pending"] == 1 and res["upgraded"] == 1
    assert html_called == []                 # REST lag: no HTML fallback inside the gap window
    df = pd.read_csv(tmp_path / paths["shifts"])
    assert df["player_id"].notna().all()
    assert not df.duplicated(["game_id", "player_id", "period", "start_seconds", "end_seconds"]).any()
    assert sorted(df["game_id"].unique()) == [2025020001, 2025020003]
    with open(tmp_path / paths["shifts"], "rb") as f:
        assert f.read().count(b"\r\n") == len(df) + 1   # line endings stay consistent (CRLF)


def test_tracked_2025_26_shifts_have_player_ids():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "nhl_season_2025_2026_shifts.csv")
    if not os.path.exists(path):
        pytest.skip("archived 2025-26 shifts not present")
    df = pd.read_csv(path, usecols=["game_id", "player_id", "period", "start_seconds", "end_seconds", "team_id"])
    assert df["player_id"].isna().mean() < 0.001
    assert not df.drop(columns="team_id").duplicated().any()
    # 2025020565's REST feed mixes in another game's VGK/SJS shifts; only the two teams stay.
    assert df.groupby("game_id")["team_id"].nunique().max() == 2


def test_rest_rows_of_other_teams_are_dropped(monkeypatch):
    payload = _rest_payload(2025020565)
    payload["data"].append({"gameId": 2025020565, "typeCode": 517, "playerId": 8470000, "firstName": "X",
                            "lastName": "Y", "teamId": 54, "teamAbbrev": "VGK", "period": 1,
                            "startTime": "00:00", "endTime": "00:50"})
    payload["data"].append({"gameId": 2025020565, "typeCode": 517, "playerId": 8470001, "firstName": "Z",
                            "lastName": "W", "teamId": 28, "teamAbbrev": "SJS", "period": 1,
                            "startTime": "00:00", "endTime": "00:50"})
    monkeypatch.setattr(FS, "get_json", lambda url: payload)
    payload["data"].append({"gameId": 2025020565, "typeCode": 517, "playerId": 8470002, "firstName": "A",
                            "lastName": "B", "teamId": 20, "teamAbbrev": "CGY", "period": 1,
                            "startTime": "00:00", "endTime": "00:50"})
    assert {r["team_id"] for r in FS.parse_rest_shifts(payload, 2025020565)} == {22, 20, 54, 28}
    monkeypatch.setattr(FS, "fetch_boxscore_meta", lambda gid: {"home": {"id": 22}, "away": {"id": 20}})
    rows = FS.fetch_shifts_rest_api(2025020565)
    assert {r["team_id"] for r in rows} == {22, 20}
    assert FS.keep_game_teams(rows, (None, 1)) == rows      # unknown teams: keep everything


def test_stored_duplicates_are_healed_when_up_to_date(tmp_path, monkeypatch):
    season = 2026
    paths = FS.season_paths(season)
    _gamestats(tmp_path / paths["gamestats"], [(2026020001, "2026-09-29")])
    rows = FS.parse_rest_shifts(_rest_payload(2026020001), 2026020001)
    FS.append_rows(str(tmp_path / paths["shifts"]), rows + rows[:1])   # written before de-dup existed
    monkeypatch.setattr(FS, "fetch_shifts_rest_api", lambda gid: (_ for _ in ()).throw(AssertionError(gid)))
    res = FS.main(["--season", str(season)], now=datetime(2026, 10, 1, tzinfo=timezone.utc),
                  workdir=str(tmp_path))
    assert res["status"] == "ok" and res["healed"] == 1
    df = pd.read_csv(tmp_path / paths["shifts"])
    assert len(df) == len(rows)
    res = FS.main(["--season", str(season)], now=datetime(2026, 10, 1, tzinfo=timezone.utc), workdir=str(tmp_path))
    assert res["status"] == "skip"
