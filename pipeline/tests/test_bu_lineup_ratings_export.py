"""bu.lineup.ratings_export: the site's RAPM v2 player ratings file (offline, synthetic inputs)."""
from __future__ import annotations

import gzip
import json
import os
from datetime import datetime, timezone

import pandas as pd
import pytest

from bu.lineup import ratings_export as RE

PIPELINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(PIPELINE)
NOW = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)


def _bundle(season="20262027", max_source_date="2026-09-30"):
    return {"version": 1, "kind": "serving_bundle", "season": season, "built_at": "2026-10-01T09:30:00+00:00",
            "max_source_date": max_source_date, "n_games": 8,
            "rookie": {"F": [-0.005, 0.001], "D": [-0.005, 0.017]},
            "players": {"columns": ["player_id", "o", "d", "rated"],
                        "rows": [[1, 0.76, 0.06, True],      # star forward
                                 [2, 0.10, -0.30, True],     # defensive defenceman
                                 [3, 0.41, -0.54, True],     # retired: rated, not on a roster
                                 [9, -0.2, 0.1, True]]}}     # a goalie id that slipped in


def _sample(season="20262027"):
    return {"version": 1, "kind": "player_sample", "season": season, "window": ["20232024", "20242025", "20252026"],
            "sample": {"columns": ["player_id", "ev_s", "gp"], "rows": [[1, 290_000, 270], [2, 180_000, 200], [3, 6_000, 10]]},
            "players": {"columns": ["player_id", "name", "pos", "team", "last_season"],
                        "rows": [[1, "Old Name", "C", "EDM", "20252026"], [3, "Patrice Bergeron", "C", "BOS", "20222023"]]}}


ROSTER = {1: ("Connor McDavid", "EDM", "C"), 2: ("Jaccob Slavin", "CAR", "D"), 4: ("Ivar Stenberg", "NYI", "L"),
          9: ("Some Goalie", "TOR", "G")}


def _rows(doc):
    return {r[0]: dict(zip(doc["columns"], r)) for r in doc["rows"]}


def test_build_export_rows_and_units():
    doc = RE.build_export(_bundle(), _sample(), ROSTER, {1: (600.0, 1)}, now=NOW)
    rows = _rows(doc)
    assert doc["season"] == "20262027" and doc["season_label"] == "2026-27" and doc["as_of"] == "2026-09-30"
    assert set(rows) == {1, 2, 3, 4}                      # goalie 9 dropped, retired 3 kept off-roster
    mc = rows[1]
    assert mc["name"] == "Connor McDavid" and mc["team"] == "EDM" and mc["roster"] and mc["rated"]
    assert mc["net"] == pytest.approx(0.70) and mc["off"] == 0.76 and mc["def"] == -0.06   # def = -d
    assert mc["toi"] == round((290_000 + 600) / 60) and mc["gp"] == 271 and mc["toi_cur"] == 10 and mc["gp_cur"] == 1
    assert rows[2]["def"] == 0.30 and rows[2]["net"] == pytest.approx(0.40)   # xGA prevented: net = off + def
    assert not rows[3]["roster"] and rows[3]["name"] == "Patrice Bergeron"
    rookie = rows[4]
    assert rookie["roster"] and not rookie["rated"] and rookie["off"] == -0.005 and rookie["def"] == -0.001
    assert rookie["toi"] == 0 and rookie["gp"] == 0
    assert [r[0] for r in doc["rows"]][:2] == [3, 1]       # sorted by net, best first
    assert doc["columns"] == RE.COLUMNS
    assert doc["version"] == 2 and "prevented" in doc["units"]["def"] and doc["units"]["net"] == "off + def"
    for r in rows.values():                               # every rating higher = better, net = off + def
        assert r["net"] == pytest.approx(r["off"] + r["def"], abs=0.002)
    assert all(not (isinstance(v, float) and v == 0 and str(v).startswith("-")) for r in doc["rows"] for v in r)


def test_fallbacks_carry_the_previous_export():
    prev = RE.build_export(_bundle(), _sample(), ROSTER, {1: (600.0, 1)}, now=NOW)
    # no roster source and no current-season stints: roster flags and this season's sample carry over
    doc = RE.build_export(_bundle(), _sample(), None, None, prev, now=NOW)
    rows = _rows(doc)
    assert rows[1]["roster"] and rows[1]["team"] == "EDM" and rows[1]["toi_cur"] == 10 and rows[1]["gp_cur"] == 1
    assert rows[4]["roster"] and rows[4]["name"] == "Ivar Stenberg"
    # a previous export of another season never carries its current-season sample
    old = dict(prev, season="20252026")
    rows = _rows(RE.build_export(_bundle(), _sample(), ROSTER, None, old, now=NOW))
    assert rows[1]["gp_cur"] == 0
    # a sample file of another season is ignored (the rollover builds a new one)
    rows = _rows(RE.build_export(_bundle(), _sample("20252026"), ROSTER, None, now=NOW))
    assert rows[1]["toi"] == 0 and 3 not in rows        # no name for the retired player -> dropped


def test_carry_over_is_byte_identical():
    """The daily full run (no stints) re-exports exactly what the bundle refresh wrote, so the
    two jobs never trade +-1 minute EV totals back and forth."""
    cur = {1: (629.0, 1), 2: (31.0, 1)}       # 10.48 and 0.52 minutes: rounding edges
    sample = _sample()
    sample["sample"]["rows"] = [[1, 290_029, 270], [2, 180_031, 200], [3, 6_000, 10]]
    first = RE.build_export(_bundle(), sample, ROSTER, cur, now=NOW)
    again = RE.build_export(_bundle(), sample, ROSTER, None, first, now=NOW)
    assert again["rows"] == first["rows"]


def test_missing_team_keeps_its_previous_roster():
    prev = RE.build_export(_bundle(), _sample(), ROSTER, None, now=NOW)
    partial = {k: v for k, v in ROSTER.items() if v[1] != "CAR"}     # CAR's roster call failed
    rows = _rows(RE.build_export(_bundle(), _sample(), partial, None, prev, now=NOW))
    assert rows[2]["roster"] and rows[2]["team"] == "CAR"
    # a player who left a team that did answer is no longer rostered there
    moved = dict(partial)
    del moved[1]
    moved[5] = ("Leon Draisaitl", "EDM", "C")
    rows = _rows(RE.build_export(_bundle(), _sample(), moved, None, prev, now=NOW))
    assert not rows[1]["roster"]


def test_write_only_when_content_changes(tmp_path):
    p = str(tmp_path / "player_ratings.json")
    doc = RE.build_export(_bundle(), _sample(), ROSTER, None, now=NOW)
    assert RE.write_if_changed(doc, p)
    later = RE.build_export(_bundle(), _sample(), ROSTER, None, now=datetime(2026, 10, 2, tzinfo=timezone.utc))
    assert not RE.write_if_changed(later, p)              # only generated_at differs
    newer = RE.build_export(_bundle(max_source_date="2026-10-01"), _sample(), ROSTER, None, now=NOW)
    assert RE.write_if_changed(newer, p)
    assert json.load(open(p))["as_of"] == "2026-10-01"


def test_ev_sample_counts_even_strength_only():
    st = pd.DataFrame({
        "game_id": [1, 1, 2, 2], "game_type": [2, 2, 2, 1], "game_onice_match": [1.0, 1.0, 1.0, 1.0],
        "n_home_g": [1, 1, 1, 1], "n_away_g": [1, 1, 1, 1], "n_home_sk": [5, 5, 4, 5], "n_away_sk": [5, 4, 4, 5],
        "home_sk": [[1, 2], [1], [1], [1]], "away_sk": [[3], [3], [3], [3]], "dur": [60.0, 30.0, 20.0, 100.0]})
    s = RE.ev_sample(st)
    assert s[1] == (80.0, 2)          # 5v5 + 4v4; the 5v4 stint and the preseason game are out
    assert s[2] == (60.0, 1)


def test_roster_table_from_the_refresh_crosswalk(tmp_path):
    cw = pd.DataFrame([{"player_id": 100 + i, "name": f"P{i}", "team": f"T{i % 32:02d}", "position": "C",
                        "source": "roster", "rank": 0} for i in range(64)]
                      + [{"player_id": 999, "name": "Lake Only", "team": "T00", "position": "D", "source": "lake", "rank": 1}])
    d = tmp_path / "crosswalk"
    d.mkdir()
    cw.to_parquet(d / "player_ids_20262027.parquet", index=False)
    r = RE.roster_table(str(tmp_path), "20262027")
    assert len(r) == 64 and 999 not in r and r[100] == ("P0", "T00", "C")
    assert RE.roster_table(None, "20262027") is None


def test_roster_table_fetches_rosters(tmp_path):
    def getter(url):
        team = url.split("/roster/")[1].split("/")[0]
        return {"forwards": [{"id": hash(team) % 10_000, "firstName": {"default": "A"}, "lastName": {"default": team},
                              "sweaterNumber": 9, "positionCode": "C"}], "defensemen": [], "goalies": []}
    teams = [f"T{i:02d}" for i in range(32)]
    r = RE.roster_table(str(tmp_path), "20262027", fetch=True, teams=teams, getter=getter)
    assert len(r) == 32 and all(v[2] == "C" for v in r.values())


def test_export_refuses_a_thin_file(tmp_path, monkeypatch):
    b = tmp_path / "b.json.gz"
    with gzip.open(b, "wt") as f:
        json.dump(_bundle(), f)
    monkeypatch.setattr(RE, "sample_path", lambda s: str(tmp_path / "none.json.gz"))
    out = tmp_path / "pr.json"
    with pytest.raises(RuntimeError, match="named roster skaters"):
        RE.export(str(b), str(out), state_root=None, log=lambda *a: None)
    assert not out.exists()


def test_refresh_export_never_raises(tmp_path):
    from bu.lineup import refresh as R
    s = R.export_ratings(str(tmp_path / "missing.json.gz"), str(tmp_path), log=lambda *a: None,
                         out_path=str(tmp_path / "pr.json"))
    assert "error" in s


# ── validate_outputs.player_ratings ──────────────────────────────────────────

def _big_doc(season="20262027", as_of="2026-09-30"):
    roster = {i: (f"Player {i}", f"T{i % 32:02d}", "D" if i % 3 == 0 else "C") for i in range(1, 701)}
    b = _bundle(season, as_of)
    b["players"]["rows"] = [[i, 0.01 * (i % 50), 0.01 * (i % 7) - 0.03, True] for i in range(1, 701)]
    return RE.build_export(b, None, roster, None, now=NOW)


def test_check_player_ratings(tmp_path):
    import validate_outputs as V
    p = tmp_path / "pr.json"
    bp = tmp_path / "b.json.gz"
    with gzip.open(bp, "wt") as f:
        json.dump(_bundle(max_source_date="2026-10-01"), f)
    ctx = {"player_ratings_path": str(p), "bu_bundle_path": str(bp)}
    p.write_text(json.dumps(_big_doc()))
    assert V.check_player_ratings(ctx) == []
    p.write_text(json.dumps(_big_doc(as_of="2026-09-20")))
    assert any("behind" in e for e in V.check_player_ratings(ctx))
    p.write_text(json.dumps(_big_doc(season="20252026", as_of="2026-10-01")))
    assert any("season" in e for e in V.check_player_ratings(ctx))
    doc = _big_doc()
    doc["rows"] = doc["rows"][:100]
    p.write_text(json.dumps(doc))
    assert any("current-roster" in e for e in V.check_player_ratings(ctx))
    doc = _big_doc()
    doc["rows"][0][doc["columns"].index("name")] = ""
    doc["rows"][1][doc["columns"].index("net")] = 9.0
    p.write_text(json.dumps(doc))
    errs = V.check_player_ratings(ctx)
    assert any("without a name" in e for e in errs) and any("inconsistent" in e for e in errs)
    doc = _big_doc()                                      # a v1 file (def = xGA impact, lower = better)
    doc["version"] = 1
    i, j, k = (doc["columns"].index(c) for c in ("off", "def", "net"))
    for r in doc["rows"]:
        r[j] = -r[j]
        r[k] = round(r[i] - r[j], 3)
    p.write_text(json.dumps(doc))
    assert any("version" in e for e in V.check_player_ratings(ctx))
    assert V.check_player_ratings({"player_ratings_path": str(tmp_path / "x.json")})


def test_committed_player_ratings():
    """The committed file passes the gate and has the expected stars near the top."""
    import validate_outputs as V
    assert V.check_player_ratings({}) == []
    doc = json.load(open(os.path.join(ROOT, "public", "data", "player_ratings.json")))
    ros = [dict(zip(doc["columns"], r)) for r in doc["rows"] if r[doc["columns"].index("roster")]]
    assert len(ros) >= 700 and all(r["name"] for r in ros)
    top = [r["name"] for r in sorted(ros, key=lambda r: -r["net"])[:15]]
    for name in ("Connor McDavid", "Nathan MacKinnon", "Auston Matthews"):
        assert name in top, (name, top)
    # v2 signs: DEF is xGA/60 prevented (Mark Stone, a defensive forward, is positive), NET = OFF + DEF
    by = {r["name"]: r for r in ros}
    assert doc["version"] == 2 and by["Mark Stone"]["def"] > 0.2 and by["Connor McDavid"]["def"] < 0
    assert all(abs(r["off"] + r["def"] - r["net"]) <= 0.002 for r in ros)


def test_workflows_publish_the_ratings():
    with open(os.path.join(ROOT, ".github", "workflows", "bu_refresh.yml"), encoding="utf-8") as fh:
        bu = fh.read()
    assert "public/data/player_ratings.json" in bu and "serving_bundle.json.gz" in bu
    with open(os.path.join(ROOT, ".github", "workflows", "update_data.yml"), encoding="utf-8") as fh:
        assert "public/data/player_ratings.json" in fh.read()
    with open(os.path.join(PIPELINE, "refresh_pipeline.py"), encoding="utf-8") as fh:
        assert "stage_player_ratings" in fh.read()
    assert os.path.exists(RE.sample_path(json.load(open(os.path.join(ROOT, "public", "data", "player_ratings.json")))["season"]))
