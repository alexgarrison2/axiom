"""B1: player_impact completeness guard, roster remap and MoneyPuck bulk fetch.

Run from the repo root:  python3 -m pytest pipeline/tests -q
Network tests are skipped when PONYXG_OFFLINE=1.
"""
import hashlib
import json
import os
import shutil
import sys

import pandas as pd
import pytest

PIPELINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PIPELINE)

import http_utils  # noqa: E402
import player_impact as pi  # noqa: E402
import fetch_moneypuck  # noqa: E402

OFFLINE = os.environ.get("PONYXG_OFFLINE") == "1"


def _md5(p):
    return hashlib.md5(open(p, "rb").read()).hexdigest()


@pytest.fixture
def tmp_manifest(tmp_path, monkeypatch):
    m = tmp_path / "manifest.json"
    monkeypatch.setenv("PONYXG_MANIFEST_FILE", str(m))
    return m


def _committed_impact():
    with open(os.path.join(PIPELINE, "player_impact.json")) as f:
        return json.load(f)


def test_committed_file_is_complete():
    d = _committed_impact()
    teams = {v["team"] for v in d.values()}
    assert len(teams) == 32
    assert len(d) >= 700
    names = {v["name"] for v in d.values()}
    for star in ["Nikita Kucherov", "William Nylander", "Auston Matthews", "Sidney Crosby", "Alex Ovechkin"]:
        assert star in names, star
    tk = {v["name"]: (k, v["impact_score"]) for k, v in d.items() if "Tkachuk" in v["name"]}
    assert tk["Brady Tkachuk"][0] != tk["Matthew Tkachuk"][0]
    assert tk["Brady Tkachuk"][1] != tk["Matthew Tkachuk"][1]


def test_guard_refuses_partial_set(tmp_path, tmp_manifest):
    """The 2026-06-17 failure: 21 of 32 teams arrived (11 teams 429'd)."""
    full = _committed_impact()
    for name in ("player_impact.json", "league_avg_impact.json", "player_name_lookup.json",
                 "team_lineup_baselines.json"):
        src = os.path.join(PIPELINE, name)
        if os.path.exists(src):
            shutil.copy(src, tmp_path / name)
    before = _md5(tmp_path / "player_impact.json")

    teams = sorted({v["team"] for v in full.values()})
    keep = set(teams[:21])
    partial = {k: v for k, v in full.items() if v["team"] in keep}
    ok = pi.save_player_impact_outputs(partial, {"x": 1}, {}, str(tmp_path))

    assert ok is False
    assert _md5(tmp_path / "player_impact.json") == before
    stale = json.loads(tmp_manifest.read_text())["stale"]
    assert "player_impact.json" in stale and "21 teams" in stale["player_impact.json"]


@pytest.mark.skipif(OFFLINE, reason="network")
def test_calculate_raises_on_partial_moneypuck(tmp_path, tmp_manifest):
    """A 21-team MoneyPuck file must not produce a player_impact.json."""
    res = fetch_moneypuck.fetch_moneypuck(season=2025, output_dir=str(tmp_path), force=True)
    assert res["status"] == "ok", res
    df = pd.read_csv(tmp_path / "moneypuck_skaters.csv")
    teams = sorted(df["team"].unique())[:21]
    sub = tmp_path / "sk_partial.csv"
    df[df["team"].isin(teams)].to_csv(sub, index=False)
    out = tmp_path / "out"
    out.mkdir()
    with pytest.raises(pi.PlayerImpactIncomplete):
        pi.calculate_player_impact(skater_file=str(sub), output_dir=str(out), rosters={})
    assert not (out / "player_impact.json").exists()


def test_remap_uses_roster_team_and_nhl_name():
    d = {
        "8481594": {"name": "Nathan Lgar", "team": "NJD"},
        "8477493": {"name": "Aleksander Barkov", "team": "FLA"},
        "1": {"name": "Retired Guy", "team": "FLA"},
    }
    from fetch_player_bio import NHL_TEAMS
    rosters = {t: {"forwards": [], "defensemen": [], "goalies": []} for t in NHL_TEAMS}
    rosters["PIT"]["forwards"].append({"id": 8481594, "firstName": {"default": "Nathan"},
                                       "lastName": {"default": "Légaré"}})
    rosters["FLA"]["forwards"].append({"id": 8477493, "firstName": {"default": "Aleksander"},
                                       "lastName": {"default": "Barkov"}})
    stats = pi.remap_to_rosters(d, rosters, stats_names={"1": "Retired Guy"})
    assert d["8481594"]["team"] == "PIT" and d["8481594"]["team_prev"] == "NJD"
    assert d["8481594"]["name"] == "Nathan Légaré"
    assert d["1"]["on_roster"] is False and d["1"]["team"] == "FLA"
    assert stats == {"moved": 1, "renamed": 1, "off_roster": 1}


def test_moneypuck_429_keeps_previous_file(tmp_path, tmp_manifest, monkeypatch):
    prev = tmp_path / "moneypuck_skaters.csv"
    prev.write_text("playerId,team\n1,ANA\n")
    before = _md5(prev)
    monkeypatch.setenv("PONYXG_HTTP_FAULTS", "moneypuck.com=429")
    monkeypatch.setattr(http_utils.time, "sleep", lambda s: None)
    n0 = len(http_utils.REQUEST_LOG)
    res = fetch_moneypuck.fetch_moneypuck(season=2025, output_dir=str(tmp_path), force=True)
    assert res["status"] == "fail"
    assert _md5(prev) == before
    assert len(http_utils.REQUEST_LOG) - n0 == 3          # 1 try + 2 retries
    assert "moneypuck_skaters.csv" in json.loads(tmp_manifest.read_text())["stale"]


@pytest.mark.skipif(OFFLINE, reason="network")
def test_moneypuck_bulk_fetch_request_budget(tmp_path, tmp_manifest):
    res = fetch_moneypuck.fetch_moneypuck(season=2025, output_dir=str(tmp_path), force=True)
    assert res["status"] == "ok", res
    assert res["requests"] <= 4
    sk = pd.read_csv(tmp_path / "moneypuck_skaters.csv")
    assert sk["team"].nunique() == 32
    # second call inside the freshness window makes zero requests
    res2 = fetch_moneypuck.fetch_moneypuck(season=2025, output_dir=str(tmp_path))
    assert res2["status"] == "skip" and res2["requests"] == 0
