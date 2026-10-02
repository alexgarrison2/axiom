"""B2/B11/B12: stage runner, manifest, exit codes, HD patch, validators.

Offline.  Run from the repo root:  python3 -m pytest pipeline/tests -q
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

PIPELINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PIPELINE)

import refresh_pipeline as rp  # noqa: E402
import validate_outputs as vo  # noqa: E402
import fetch_contracts  # noqa: E402


@pytest.fixture
def manifest(tmp_path, monkeypatch):
    m = tmp_path / "manifest.json"
    monkeypatch.setenv("PONYXG_MANIFEST_FILE", str(m))
    return m


def test_stage_runner_catches_sys_exit_and_keeps_going():
    r = rp.StageRunner("lite")
    r.run("legacy", lambda: sys.exit(0), required=True)
    r.run("next", lambda: {"status": "ok", "rows_written": 3})
    assert [s["status"] for s in r.stages] == ["fail", "ok"]
    assert r.stages[1]["rows_written"] == 3
    assert [s["stage"] for s in r.failed_required()] == ["legacy"]


def _fake_lite(fail_predict):
    def run_lite(r, phase):
        r.run("upcoming_games", lambda: {"status": "ok", "rows_written": 8}, required=True)
        print("Running Predictions...")

        def predict():
            if fail_predict:
                raise RuntimeError("model exploded")
            return {"status": "ok", "rows_written": 8}
        r.run("predict", predict, required=True)
        print("Final Sync...")
        r.run("final_sync", lambda: {"status": "ok"}, required=True)
    return run_lite


@pytest.mark.parametrize("fail", [False, True])
def test_exit_code_and_manifest(manifest, monkeypatch, capsys, fail):
    monkeypatch.setattr(rp, "season_phase", lambda: {"in_season": True, "playoffs": False,
                                                    "games_played": 3, "min_team_gp": 0})
    monkeypatch.setattr(rp, "run_lite", _fake_lite(fail))
    monkeypatch.setattr(rp.os, "chdir", lambda p: None)
    code = rp.main(["--mode", "lite"])
    out = capsys.readouterr().out
    m = json.loads(manifest.read_text())
    assert vo.schema_errors(m, vo.MANIFEST_SCHEMA) == []
    assert m["season_id"] == rp.SEASON_ID and m["mode"] == "lite"
    assert m["games_played_current_season"] == 3
    assert {"predict", "final_sync"} <= {s["stage"] for s in m["stages"]}
    assert "Final Sync..." in out           # later stages still run after a failure
    if fail:
        assert code == 1 and m["ok"] is False
        assert "Pipeline Refresh Finished With Errors" in out
        assert vo.check_manifest({"manifest_file": str(manifest)})     # gate blocks the commit
    else:
        assert code == 0 and m["ok"] is True
        assert "--- Pipeline Refresh Complete ---" in out
        assert vo.check_manifest({"manifest_file": str(manifest)}) == []


def test_force_fail_env(monkeypatch):
    monkeypatch.setenv("PONYXG_FORCE_FAIL", "predict")
    r = rp.StageRunner("lite")
    r.run("predict", lambda: {"status": "ok"}, required=True)
    assert r.failed_required()


def test_hd_period_table_against_is_opponents_for():
    shots = pd.DataFrame({
        "game_id": [1, 1, 1, 1], "team_id": [10, 10, 20, 20],
        "x": [80, 30, -85, -40], "y": [0, 30, 2, 35], "period": [1, 2, 3, 4],
        "xG": [0.3, 0.05, 0.25, 0.02],
    })
    t = rp.hd_period_table(shots, {10: "A", 20: "B"}).set_index("team")
    for col in ("hdf", "xg_for_1P", "xg_for_3P", "xg_for_OT"):
        assert t.loc["A", col.replace("hdf", "hda").replace("xg_for", "xg_ag")] == t.loc["B", col]
    assert t.loc["A", "xg_for_1P"] == pytest.approx(0.3)
    assert t.loc["B", "xg_ag_1P"] == pytest.approx(0.3)


def test_gamestats_mirrors_reset_before_first_game(tmp_path, monkeypatch):
    pub, dat = tmp_path / "public", tmp_path / "data"
    pub.mkdir(), dat.mkdir()
    for d in (pub, dat):
        (d / "gamestats.csv").write_text("game_id,team\n2025020001,BOS\n")
    monkeypatch.setattr(rp, "PUBLIC_DATA_DIR", str(pub))
    monkeypatch.setattr(rp, "DATA_DIR", str(dat))
    monkeypatch.setattr(rp, "PIPELINE_DIR", str(tmp_path))       # no season file here
    res = rp.stage_sync_gamestats()
    assert res["status"] == "ok"
    assert (pub / "gamestats.csv").read_text() == "game_id,team\n"
    assert rp.stage_sync_gamestats()["status"] == "skip"           # idempotent


def test_contract_refresh_uses_stored_fetched_at(tmp_path):
    f = tmp_path / "contracts.json"
    old = (datetime.now(timezone.utc) - timedelta(days=8)).strftime("%Y-%m-%dT%H:%M:%SZ")
    f.write_text(json.dumps({"_meta": {"fetched_at": old}, "1": {"cap_hit": 1}}))
    # a fresh checkout makes the mtime "now" — the stored timestamp still says stale
    assert fetch_contracts.contracts_due(str(f)) is True
    f.write_text(json.dumps({"_meta": {"fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}}))
    assert fetch_contracts.contracts_due(str(f)) is False
    f.write_text(json.dumps({"1": {"cap_hit": 1}}))                # legacy file without _meta
    assert fetch_contracts.contracts_due(str(f)) is True


# ── validate_outputs gate ────────────────────────────────────────────────────

def _pred_row(**kw):
    row = {"game_date": "2026-10-01", "game_id": "g1", "home_team": "Leafs", "away_team": "Habs",
           "home_win_pct": "55.0", "away_win_pct": "45.0", "game_start_time": "06:00 PM",
           "home_pp_rank": "", "home_pk_rank": "", "away_pp_rank": "", "away_pk_rank": "",
           "home_l7": "", "away_l7": ""}
    row.update(kw)
    return row


def _write_preds(tmp_path, rows):
    p = tmp_path / "predictions_detailed.csv"
    pd.DataFrame(rows).to_csv(p, index=False)
    return str(p)


def test_placeholder_row_blocks_commit(tmp_path, monkeypatch):
    good = _write_preds(tmp_path, [_pred_row()])
    monkeypatch.setattr(vo, "PRED_FILES", [good])
    assert vo.check_placeholders({}) == []
    bad = _write_preds(tmp_path, [_pred_row(home_pp_rank=16, home_pk_rank=16, home_l7="0-0-0")])
    monkeypatch.setattr(vo, "PRED_FILES", [bad])
    assert vo.check_placeholders({})
    errors, _ = vo.run(only={"placeholders"}, quiet=True)
    assert "placeholders" in errors
    errors, warnings = vo.run(only={"placeholders"}, allow={"placeholders"}, quiet=True)
    assert not errors and "placeholders" in warnings


def test_live_odds_line_blocks_commit(tmp_path, monkeypatch):
    odds = {"2026020021": {"game_id": 2026020021, "start_time_utc": "2026-10-01T23:00:00Z",
                           "fetched_at": "2026-10-01T23:10:00Z", "home_ml": -900, "away_ml": 600}}
    pdir = tmp_path / "pipeline"
    pdir.mkdir()
    (pdir / "odds.json").write_text(json.dumps(odds))
    monkeypatch.setattr(vo, "PIPELINE_DIR", str(pdir))
    monkeypatch.setattr(vo, "PUBLIC_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(vo, "REPO_ROOT", str(tmp_path))
    probs = vo.check_odds({})
    assert any("fetched after start" in p for p in probs)


def test_row_first_predicted_after_start_blocks_commit(tmp_path, monkeypatch):
    rel = "data/predictions_detailed.csv"
    (tmp_path / "data").mkdir()
    monkeypatch.setattr(vo, "REPO_ROOT", str(tmp_path))
    now = datetime(2026, 10, 1, 23, 30, tzinfo=timezone.utc)   # 6:30 PM CT
    row = _pred_row(start_time_utc="2026-10-01T23:00:00Z")
    pd.DataFrame([row]).to_csv(tmp_path / rel, index=False)
    header = ",".join(row) + "\n"
    # absent from the last committed CSV -> predicted after puck drop
    assert vo.check_after_start({"now": now, "baseline": {rel: header}})
    # present (frozen pregame) with the same win% -> fine
    committed = pd.DataFrame([row]).to_csv(index=False)
    assert vo.check_after_start({"now": now, "baseline": {rel: committed}}) == []
    # no_pregame_prediction rows carry no win% and are exempt
    pd.DataFrame([_pred_row(home_win_pct="", away_win_pct="", prediction_status="no_pregame_prediction",
                            start_time_utc="2026-10-01T23:00:00Z")]).to_csv(tmp_path / rel, index=False)
    assert vo.check_after_start({"now": now, "baseline": {rel: header}}) == []


def test_gamestats_type_and_season(tmp_path):
    p = tmp_path / "g.csv"
    p.write_text("game_id,team\n2026020001,BOS\n2026010001,BOS\n2025020001,BOS\n")
    probs = vo._gamestats_problems(str(p), 2026)
    assert any("not game type 02/03" in x for x in probs)
    assert any("not from the 2026-2027 season" in x for x in probs)


def test_auto_mode(manifest, monkeypatch):
    at = lambda h, d=1: datetime(2026, 10, d, h, 5, tzinfo=timezone.utc)  # noqa: E731
    finals = [False]   # has_unscraped_finals() reads the repo's live season data; pin it
    monkeypatch.setattr(rp, "has_unscraped_finals", lambda: finals[0])
    assert rp.auto_mode(at(12)) == "full"                 # no successful full run recorded
    manifest.write_text(json.dumps({"last_full_run": "2026-10-01T12:20:00Z"}))
    assert rp.auto_mode(at(13)) == "lite"                 # morning full already done
    assert rp.auto_mode(at(20)) == "lite"
    assert rp.auto_mode(at(12, 2)) == "full"              # next morning
    assert rp.auto_mode(at(2, 3)) == "full"               # > 36h without a full run: catch up
    finals[0] = True
    assert rp.auto_mode(at(20)) == "full"                 # final games waiting to be scraped


def test_freshness_check(tmp_path):
    m = tmp_path / "manifest.json"
    now = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
    m.write_text(json.dumps({"season_id": rp.SEASON_ID, "generated_at": "2026-10-01T13:00:00Z",
                             "phase": {"in_season": True}}))
    assert vo.check_freshness({"manifest_file": str(m), "now": now}) == []
    assert vo.check_freshness({"manifest_file": str(m), "now": now + timedelta(hours=4)})
    m.write_text(json.dumps({"season_id": rp.SEASON_ID, "generated_at": "2026-07-01T13:00:00Z",
                             "phase": {"in_season": False}}))
    assert vo.check_freshness({"manifest_file": str(m), "now": now}) == []   # offseason
