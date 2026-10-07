"""fetch_shifts.py: a stored game counts as done only when its shift chart is complete;
partial captures are re-fetched on later runs, with a bounded number of tries."""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd

import fetch_shifts as FS

GID = 2026020028
NOW = datetime(2026, 10, 7, 14, tzinfo=timezone.utc)


def _game(gid=GID, p3_end=1200, players=6):
    """Each team: `players` on for all of periods 1-2 and period 3 up to `p3_end`."""
    rows = []
    for t in (55, 22):
        for k in range(players):
            for per in (1, 2, 3):
                end = p3_end if per == 3 else 1200
                if end > 0:
                    rows.append({"game_id": gid, "period": per, "start_seconds": 0, "end_seconds": end,
                                 "player_id": 8470000 + 100 * t + k, "player_name": f"P{t}{k}",
                                 "team_id": t, "team_abbrev": f"T{t}"})
    return rows


def test_coverage_complete_partial_and_missing():
    assert FS.is_complete(FS.rows_coverage(_game(), GID))
    # A 5v4 stretch or a pulled goalie keeps a team under six: still complete.
    five = _game(players=6)[:-3] + [dict(r, end_seconds=900) for r in _game(players=6)[-3:]]
    assert FS.is_complete(FS.rows_coverage(five, GID))
    # Captured mid-third: the shifts stop at 10:00 of the 3rd.
    assert not FS.is_complete(FS.rows_coverage(_game(p3_end=600), GID))
    # A period with only half the players.
    thin = [r for r in _game() if not (r["period"] == 2 and r["player_id"] % 100 >= 3)]
    assert FS.rows_coverage(thin, GID) == 0.5
    # Only one team, or no third period at all.
    assert FS.rows_coverage([r for r in _game() if r["team_id"] == 55], GID) == 0.0
    assert FS.rows_coverage(_game(p3_end=0), GID) == 0.0
    assert FS.rows_coverage([], GID) == 0.0


def _setup(tmp_path, stored_rows):
    paths = FS.season_paths(2026)
    pd.DataFrame({"game_id": [GID], "game_date": ["2026-10-05"]}).to_csv(tmp_path / paths["gamestats"], index=False)
    FS.append_rows(str(tmp_path / paths["shifts"]), stored_rows)
    return paths


def test_incomplete_game_is_refetched_until_complete(tmp_path, monkeypatch):
    paths = _setup(tmp_path, _game(p3_end=400))
    captures = [_game(p3_end=800), _game()]           # the feed fills in over two later runs
    calls = []
    monkeypatch.setattr(FS, "RATE_LIMIT_DELAY", 0)
    monkeypatch.setattr(FS, "fetch_shifts_rest_api", lambda gid: calls.append(gid) or captures[len(calls) - 1])
    monkeypatch.setattr(FS, "fetch_shifts_html", lambda *a, **k: [])
    monkeypatch.setattr(FS, "fetch_boxscore_meta", lambda gid: None)

    res = FS.main(["--season", "2026"], now=NOW, workdir=str(tmp_path))
    assert res["recaptured"] == 1 and res["completed"] == 0
    state = json.loads((tmp_path / FS.INCOMPLETE_FILE).read_text())
    assert state[str(GID)]["tries"] == 1
    df = pd.read_csv(tmp_path / paths["shifts"])
    assert df.loc[df["period"] == 3, "end_seconds"].max() == 800

    res = FS.main(["--season", "2026"], now=NOW, workdir=str(tmp_path))
    assert res["completed"] == 1
    assert json.loads((tmp_path / FS.INCOMPLETE_FILE).read_text()) == {}
    df = pd.read_csv(tmp_path / paths["shifts"])
    assert FS.is_complete(FS.coverage_by_game(df)[GID])
    assert len(df) == len(_game())

    # Complete now: the next run fetches nothing.
    res = FS.main(["--season", "2026"], now=NOW, workdir=str(tmp_path))
    assert res["status"] == "skip" and calls == [GID, GID]


def test_gives_up_after_max_tries_and_keeps_best_capture(tmp_path, monkeypatch):
    paths = _setup(tmp_path, _game(p3_end=600))
    calls = []
    monkeypatch.setattr(FS, "RATE_LIMIT_DELAY", 0)
    monkeypatch.setattr(FS, "MAX_INCOMPLETE_TRIES", 3)
    # The feed never completes and sometimes returns a worse capture: never replace with it.
    monkeypatch.setattr(FS, "fetch_shifts_rest_api", lambda gid: calls.append(gid) or _game(p3_end=300))
    monkeypatch.setattr(FS, "fetch_shifts_html", lambda *a, **k: [])
    monkeypatch.setattr(FS, "fetch_boxscore_meta", lambda gid: None)
    for _ in range(5):
        FS.main(["--season", "2026"], now=NOW, workdir=str(tmp_path))
    assert len(calls) == 3
    state = json.loads((tmp_path / FS.INCOMPLETE_FILE).read_text())
    assert state[str(GID)]["gave_up"] is True and state[str(GID)]["tries"] == 3
    df = pd.read_csv(tmp_path / paths["shifts"])
    assert df.loc[df["period"] == 3, "end_seconds"].max() == 600


def test_html_report_completes_an_old_game_rest_never_fills(tmp_path, monkeypatch):
    paths = _setup(tmp_path, _game(p3_end=600))
    monkeypatch.setattr(FS, "RATE_LIMIT_DELAY", 0)
    monkeypatch.setattr(FS, "fetch_shifts_rest_api", lambda gid: _game(p3_end=600))
    monkeypatch.setattr(FS, "fetch_boxscore_meta", lambda gid: {"home": {}, "away": {}})
    monkeypatch.setattr(FS, "fetch_shifts_html", lambda *a, **k: _game())
    late = datetime(2026, 10, 10, 14, tzinfo=timezone.utc)   # past the 72 h HTML gap
    res = FS.main(["--season", "2026"], now=late, workdir=str(tmp_path))
    assert res["completed"] == 1
    df = pd.read_csv(tmp_path / paths["shifts"])
    assert FS.is_complete(FS.coverage_by_game(df)[GID])


def test_new_partial_capture_is_stored_and_marked(tmp_path, monkeypatch):
    paths = FS.season_paths(2026)
    pd.DataFrame({"game_id": [GID], "game_date": ["2026-10-06"]}).to_csv(tmp_path / paths["gamestats"], index=False)
    monkeypatch.setattr(FS, "RATE_LIMIT_DELAY", 0)
    monkeypatch.setattr(FS, "fetch_shifts_rest_api", lambda gid: _game(p3_end=500))
    FS.main(["--season", "2026"], now=NOW, workdir=str(tmp_path))
    state = json.loads((tmp_path / FS.INCOMPLETE_FILE).read_text())
    assert state[str(GID)]["tries"] == 1
    assert len(pd.read_csv(tmp_path / paths["shifts"])) == len(_game(p3_end=500))


def test_enrich_pbp_redoes_games_enriched_from_a_partial_chart():
    import enrich_pbp as E
    full = {c: 1 for c in E.ON_ICE_COLS}
    thin = {c: (1 if c in ("home_on1", "away_on1") else None) for c in E.ON_ICE_COLS}
    rows = [{"game_id": 1, "period": 1, **full}] * 99 + [{"game_id": 1, "period": 1, **thin}]           # 1% thin: fine
    rows += [{"game_id": 2, "period": 3, **full}] * 50 + [{"game_id": 2, "period": 3, **thin}] * 50    # half thin
    rows += [{"game_id": 3, "period": 5, **thin}] * 10                                                 # shootout only: ignored
    assert E.thin_on_ice_games(pd.DataFrame(rows)) == {2}
