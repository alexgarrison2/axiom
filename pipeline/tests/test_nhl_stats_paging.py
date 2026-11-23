"""http_utils.get_nhl_stats_rows: NHL stats REST reports come 100 rows per request."""
import json
import urllib.parse

import pytest

import http_utils as H


def _fake_report(n_rows, calls, total=None, short_after=None):
    """A get_json stand-in serving ``n_rows`` rows in pages, recording each request's query."""
    def get_json(url, **kw):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
        calls.append((q, kw))
        start, limit = int(q["start"]), int(q["limit"])
        stop = n_rows if short_after is None else min(n_rows, short_after)
        return {"data": [{"gameId": i} for i in range(start, min(start + limit, stop))],
                "total": n_rows if total is None else total}
    return get_json


def test_reads_every_page_and_replaces_start_limit_sort(monkeypatch):
    calls = []
    monkeypatch.setattr(H, "get_json", _fake_report(250, calls))
    url = ("https://api.nhle.com/stats/rest/en/skater/summary?isGame=true&start=0&limit=-1&sort=playerId"
           "&cayenneExp=seasonId=20262027%20and%20gameDate%3E=%222026-11-19%22")
    rows = H.get_nhl_stats_rows(url, sort=("gameId", "-playerId"), ua="plain", timeout=7)
    assert [r["gameId"] for r in rows] == list(range(250))
    assert [(q["start"], q["limit"]) for q, _ in calls] == [("0", "100"), ("100", "100"), ("200", "100")]
    q, kw = calls[0]
    assert json.loads(q["sort"]) == [{"property": "gameId", "direction": "ASC"},
                                     {"property": "playerId", "direction": "DESC"}]
    assert q["cayenneExp"] == 'seasonId=20262027 and gameDate>="2026-11-19"' and q["isGame"] == "true"
    assert kw == {"ua": "plain", "timeout": 7}


def test_exact_page_and_empty_report(monkeypatch):
    calls = []
    monkeypatch.setattr(H, "get_json", _fake_report(100, calls))
    assert len(H.get_nhl_stats_rows("https://x/report?cayenneExp=a=1", sort=("playerId",))) == 100
    assert len(calls) == 1                                   # no extra request once total is reached
    monkeypatch.setattr(H, "get_json", _fake_report(0, []))
    assert H.get_nhl_stats_rows("https://x/report", sort=("playerId",)) == []


def test_a_short_report_raises_instead_of_returning_part(monkeypatch):
    monkeypatch.setattr(H, "get_json", _fake_report(1116, [], short_after=100))   # pages dry up at 100 rows
    with pytest.raises(H.HttpError, match="100 of 1116 rows"):
        H.get_nhl_stats_rows("https://x/report", sort=("gameId", "playerId"))
    monkeypatch.setattr(H, "get_json", lambda url, **kw: ["not", "a", "report"])
    with pytest.raises(H.HttpError, match="badshape"):
        H.get_nhl_stats_rows("https://x/report", sort=("playerId",))


def test_skater_game_windows_keep_the_old_file_when_a_report_is_short(monkeypatch):
    import fetch_skater_games as fsg

    def boom(url, **kw):
        raise H.HttpError(url, "short", "100 of 1116 rows")
    monkeypatch.setattr(fsg, "get_nhl_stats_rows", boom)
    assert fsg._report("https://x/report", "2026-11-19..2026-11-22") is None
