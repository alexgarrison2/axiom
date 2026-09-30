"""B4/B6: scraper numbering, retry of failed games, game-type filter, official PP/PK.

python3 -m pytest pipeline/tests/test_reliability_scraper.py -q   (network: set PONYXG_OFFLINE=1 to skip)
"""
import json
import os
import sys
from datetime import date

import pandas as pd
import pytest

PIPELINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PIPELINE)

import scrape_games as sg  # noqa: E402
import season  # noqa: E402

OFFLINE = os.environ.get("PONYXG_OFFLINE") == "1"
S2526 = os.path.join(PIPELINE, "nhl_season_2025_2026_gamestats.csv")


@pytest.fixture
def tmp_manifest(tmp_path, monkeypatch):
    m = tmp_path / "manifest.json"
    monkeypatch.setenv("PONYXG_MANIFEST_FILE", str(m))
    return m


def test_season_helpers():
    assert season.game_type_of(2026020001) == "02"
    assert season.game_type_of("2026030111") == "03"
    assert season.season_id_of_game_id(2025021300) == "20252026"
    df = pd.DataFrame({"game_id": [2026010001, 2026020001, 2026030001, 2025020001, 2026090001]})
    assert list(season.filter_game_types(df, start_year=2026)["game_id"]) == [2026020001, 2026030001]
    from datetime import datetime, timezone
    # 01:30 UTC on Sep 30 is still Sep 29 in New York
    assert str(season.today_local(datetime(2026, 9, 30, 1, 30, tzinfo=timezone.utc))) == "2026-09-29"


def test_recompute_matches_full_season_rescrape():
    """The fully re-scraped 2025-26 regular season is the ground truth."""
    df = pd.read_csv(S2526, low_memory=False)
    r = sg.recompute_sequence_fields(df)
    old = df.set_index(["game_id", "team"])
    new = r.set_index(["game_id", "team"]).loc[old.index]
    reg = old.index.get_level_values(0).astype(str).str[4:6] == "02"
    for c in ["team_game_number", "opponent_game_number", "is_b2b", "is_3in4", "is_4in6", "is_6in9"]:
        assert (old.loc[reg, c].values == new.loc[reg, c].values).all(), c
    # date-derived b2b count
    x = r[r.game_id.astype(str).str[4:6] == "02"].copy()
    x["d"] = pd.to_datetime(x.game_date)
    x = x.sort_values(["team", "d"])
    derived = int(((x.d - x.groupby("team")["d"].shift()).dt.days == 1).sum())
    assert int(x["is_b2b"].sum()) == derived
    # one game #1 per team per game type
    ones = r[r.team_game_number == 1]
    assert ones.groupby(ones.game_id.astype(str).str[4:6])["team"].nunique().to_dict() == {"02": 32, "03": 16}


def test_incremental_numbering_seeded_from_existing():
    """The January bug: an incremental run numbered every team's first game
    of the window as game 1. Recompute over (existing + new) must not."""
    df = pd.read_csv(S2526, low_memory=False)
    df = df[df.game_id.astype(str).str[4:6] == "02"]
    old = df[df.game_date < "2026-01-01"].copy()
    jan = df[(df.game_date >= "2026-01-01") & (df.game_date < "2026-02-01")].copy()
    jan[["team_game_number", "opponent_game_number", "is_b2b"]] = [1, 1, 0]   # what the old loop produced
    r = sg.recompute_sequence_fields(pd.concat([old, jan]))
    rj = r[r.game_date >= "2026-01-01"]
    assert int((rj.team_game_number == 1).sum()) == 0
    truth = df.set_index(["game_id", "team"]).loc[list(zip(rj.game_id, rj.team))]
    assert (truth["team_game_number"].values == rj["team_game_number"].values).all()
    assert int(rj["is_b2b"].sum()) == int(truth["is_b2b"].sum())


@pytest.mark.skipif(OFFLINE, reason="network")
def test_failed_game_is_retried_next_run(tmp_path, tmp_manifest, monkeypatch):
    """Integration: a PBP failure is recorded and the game is fetched next run."""
    df = pd.read_csv(S2526, low_memory=False)
    df[df.game_date < "2026-01-01"].to_csv(tmp_path / "nhl_season_2025_2026_gamestats.csv", index=False)
    victim = int(df[df.game_date == "2026-01-02"].game_id.iloc[0])

    monkeypatch.setenv("PONYXG_HTTP_FAULTS", f"gamecenter/{victim}/play-by-play=500")
    import http_utils
    monkeypatch.setattr(http_utils.time, "sleep", lambda s: None)
    r1 = sg.main([], start_year=2025, workdir=str(tmp_path), end_date=date(2026, 1, 3), pause=0)
    assert str(victim) in r1["failed"]
    pend = json.loads((tmp_path / "pending_failed.json").read_text())
    assert str(victim) in pend and pend[str(victim)]["attempts"] == 1
    g1 = pd.read_csv(tmp_path / "nhl_season_2025_2026_gamestats.csv")
    assert victim not in set(g1.game_id)

    monkeypatch.delenv("PONYXG_HTTP_FAULTS")
    r2 = sg.main([], start_year=2025, workdir=str(tmp_path), end_date=date(2026, 1, 3), pause=0)
    assert r2["failed"] == [] and str(victim) in r2["recovered"]
    g2 = pd.read_csv(tmp_path / "nhl_season_2025_2026_gamestats.csv")
    assert victim in set(g2.game_id)
    assert json.loads((tmp_path / "pending_failed.json").read_text()) == {}

    # numbering / rest flags of the scraped window match the full-season truth
    truth = df.set_index(["game_id", "team"])
    got = g2[g2.game_date >= "2026-01-01"].set_index(["game_id", "team"])
    t = truth.loc[got.index]
    assert int((got.team_game_number == 1).sum()) == 0
    for c in ["team_game_number", "opponent_game_number", "is_b2b", "is_3in4"]:
        assert (t[c].values == got[c].values).all(), c
    # standings check as of the window end passes for all 32 teams
    assert r2["verify"]["status"] == "ok", r2["verify"]


@pytest.mark.skipif(OFFLINE, reason="network")
def test_official_special_teams_totals(tmp_path, tmp_manifest):
    df = pd.read_csv(S2526, low_memory=False)
    path = tmp_path / "gs.csv"
    df.to_csv(path, index=False)
    res = sg.patch_special_teams(str(path), season_id="20252026")
    assert res["missing"] == 0, res
    g = pd.read_csv(path)
    reg = g[g.game_id.astype(str).str[4:6] == "02"]
    tot = reg.groupby("team")["pp_opportunities"].sum()
    assert tot["Rangers"] == 215 and tot["Stars"] == 248 and tot["Golden Knights"] == 236
    # join covered 100% of team-games
    assert res["matched"] == len(g)
