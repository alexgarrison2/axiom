"""sm-lake-1/2: per-season parquet build and the DESIGN §2.6 data-quality gate."""
import json
import os
import shutil

import pandas as pd
import pytest

pytest.importorskip("pyarrow")

from bu.lake import backfill as BF  # noqa: E402
from bu.lake.build import TABLES, build_season, read_table, write_table  # noqa: E402
from bu.lake.dq import cluster_se, run_dq  # noqa: E402
from bu.lake.paths import Lake  # noqa: E402

TESTDATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bu", "lake", "testdata")
GAMES = {"20102011": [2010020165], "20192020": [2019020758], "20232024": [2023020500]}


@pytest.fixture()
def lake(tmp_path):
    shutil.copytree(os.path.join(TESTDATA, "raw"), tmp_path / "raw")
    lk = Lake(str(tmp_path))
    for s, ids in GAMES.items():
        build_season(lk, s, ids, jobs=1, log=lambda *a: None)
    return lk


def _check(rep, name, season="all"):
    rows = [r for r in rep["checks"] if r["check"] == name and r["season"] == season]
    assert rows, (name, season)
    return rows[0]


def test_build_writes_every_table(lake):
    for s in GAMES:
        for t in TABLES:
            assert os.path.exists(lake.table_path(t, s)), (t, s)
    ev = read_table(lake, "events")
    assert ev["game_id"].nunique() == 3
    assert isinstance(ev["home_skaters"].dropna().iloc[0], (list, tuple)) or hasattr(ev["home_skaters"].dropna().iloc[0], "__len__")
    shots = read_table(lake, "shots", ["20232024"])
    assert shots["season"].unique().tolist() == ["20232024"]
    players = read_table(lake, "players")
    assert players["name_key"].str.len().gt(0).all()


def test_dq_gate_on_fixture_games_flags_only_the_feed_error(lake, tmp_path):
    # The fixture set deliberately contains 2019020758, whose feed codes a 4-minute 5v4 as 5v3.
    # With one game in that season there is no clustering to lean on, so that season row fails;
    # every other check passes.
    rep = run_dq(lake, list(GAMES), targets=GAMES, historical_shots=str(tmp_path / "none.csv"))
    failed = [(r["check"], r["season"]) for r in rep["checks"] if not r["pass"]]
    assert failed == [("onice_vs_situation", "20192020")]
    assert _check(rep, "game_coverage")["value"] == 1.0
    assert _check(rep, "goals_vs_final")["value"] == 1.0
    assert _check(rep, "shift_duplicates")["value"] == 0
    assert _check(rep, "shift_duplicates")["detail"]["raw_duplicates_removed"] == 295
    assert _check(rep, "one_goalie_or_en")["value"] >= 0.999
    assert _check(rep, "side_zone_consistency")["value"] == 1.0
    assert _check(rep, "crosswalk_coverage")["value"] == 1.0
    # The 2019 situationCode error is visible: strict threshold missed, allowance documented.
    on = _check(rep, "onice_vs_situation", "20192020")
    assert not on["strict_pass"] and on["allowance"] > 0 and on["detail"]["mismatch"] > 10
    with open(rep["path"]) as f:
        assert json.load(f)["checks"]


def test_dq_gate_catches_defects(lake, tmp_path):
    # Re-introduce duplicate shifts and drop a goal: both exact checks must fail.
    sh = read_table(lake, "shifts", ["20232024"])
    write_table(pd.concat([sh, sh.head(5)], ignore_index=True), lake.table_path("shifts", "20232024"))
    g = read_table(lake, "games", ["20232024"])
    g.loc[0, "home_goals_pbp"] = g.loc[0, "home_goals_pbp"] + 1
    write_table(g, lake.table_path("games", "20232024"))
    targets = dict(GAMES, **{"20232024": [2023020500, 2023020501]})   # one game never built
    rep = run_dq(lake, list(GAMES), targets=targets, historical_shots=str(tmp_path / "none.csv"))
    assert not rep["pass"]
    assert not _check(rep, "shift_duplicates")["pass"]
    assert not _check(rep, "goals_vs_final")["pass"]
    cov = _check(rep, "game_coverage", "20232024")
    assert not cov["pass"] and cov["detail"]["missing_sample"] == [2023020501]


def test_no_allowance_is_strict(lake, tmp_path):
    games = {k: v for k, v in GAMES.items() if k != "20192020"}
    rep = run_dq(lake, list(games), targets=games, historical_shots=str(tmp_path / "none.csv"), allowance=False)
    assert all(r["allowance"] == 0 for r in rep["checks"])
    assert rep["pass"] == rep["strict_pass"]
    rep = run_dq(lake, list(GAMES), targets=GAMES, historical_shots=str(tmp_path / "none.csv"), allowance=False)
    assert not _check(rep, "onice_vs_situation")["pass"]   # pooled row fails without the allowance


def test_cluster_se_grows_with_clustered_errors():
    ok = [1] * 90 + [0] * 10
    flat = cluster_se(ok, list(range(100)))
    clustered = cluster_se(ok, [i // 10 for i in range(100)])       # all errors in one game
    assert clustered > flat > 0


def test_backfill_cli_build_only(tmp_path, capsys):
    shutil.copytree(os.path.join(TESTDATA, "raw"), tmp_path / "raw")
    rc = BF.main(["--games", "2023020500,2010020165", "--build-only", "--lake-dir", str(tmp_path), "--jobs", "1",
                  "--rps", "5"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "using 2" in out and "2.0 rps/host" in out      # D5 ceiling enforced
    assert "Remaining full backfill" in out and "DQ gate" in out
    assert os.path.exists(tmp_path / "dq" / "dq_report_latest.json")
    assert os.path.exists(tmp_path / "dq" / "throughput_latest.json")
    assert os.path.exists(Lake(str(tmp_path)).table_path("events", "20102011"))


def test_side_range_is_relative_to_the_raw_reference_and_read_from_the_lake(lake, tmp_path):
    # Run with the inferred-side season only (the 2010-2017 leg of the backfill): the
    # 2021+ raw-side reference must come from the lake, not silently disappear.
    rep = run_dq(lake, ["20102011"], targets={"20102011": GAMES["20102011"]},
                 historical_shots=str(tmp_path / "none.csv"))
    row = _check(rep, "side_attacking_range", "20102011:inferred")
    assert row["op"] == "<=" and row["detail"]["reference"].startswith("lake:") and row["pass"]
    md = [r for r in rep["checks"] if r["check"] == "side_mean_distance"]
    assert md and not md[0]["informational"] and md[0]["detail"]["reference"].startswith("lake:")
    # Raw-side rows are reported but not gated (legitimate long shots exist there).
    rep = run_dq(lake, list(GAMES), targets=GAMES, historical_shots=str(tmp_path / "none.csv"))
    assert _check(rep, "side_attacking_range", "all:raw")["informational"]
    assert _check(rep, "side_attacking_range", "all:inferred")["detail"]["reference"] == "run"


def test_side_range_falls_back_to_an_absolute_floor_without_a_reference(lake, tmp_path):
    for s in ("20192020", "20232024"):
        shutil.rmtree(os.path.dirname(lake.table_path("shots", s)))
    rep = run_dq(lake, ["20102011"], targets={"20102011": GAMES["20102011"]},
                 historical_shots=str(tmp_path / "none.csv"))
    row = _check(rep, "side_attacking_range_abs", "20102011:inferred")
    assert row["threshold"] == 0.97 and row["detail"]["reference"] == "none"
