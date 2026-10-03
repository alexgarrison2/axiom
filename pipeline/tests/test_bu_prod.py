"""Production score (bu/rapm/prod.py, serve.prod_table, ratings_export.prod_columns, the validate gate)."""
from __future__ import annotations

import gzip
import json
import os

import numpy as np
import pandas as pd
import pytest

from bu.rapm import prod as PR
from bu.rapm.recency import LeagueClock, Recency, league_index

from test_bu_ratings_v3 import ROSTER
from test_bu_ratings_v5 import _v5_bundle

HOME = [11, 12, 13, 14, 15]
AWAY = [21, 22, 23, 24, 25]


def _ev(k, typ, **kw):
    e = {"game_id": 1, "event_id": k, "sort_order": k, "period": 1, "period_type": "REG", "type_desc": typ,
         "is_shootout": False, "is_penalty_shot": False, "sit_home_sk": 5, "sit_away_sk": 5, "sit_home_g": 1,
         "sit_away_g": 1, "shooting_team_id": None, "home_skaters": np.array(HOME), "away_skaters": np.array(AWAY),
         "scorer_id": None, "assist1_id": None, "assist2_id": None, "shooter_id": None, "blocker_id": None,
         "reason": None, "pen_desc_key": None, "pen_committed_by_id": None, "pen_drawn_by_id": None,
         "fo_winner_id": None, "fo_loser_id": None}
    e.update(kw)
    return e


def _game():
    ev = pd.DataFrame([
        _ev(1, "faceoff", fo_winner_id=12, fo_loser_id=22),
        _ev(2, "goal", shooting_team_id=100, scorer_id=11, shooter_id=11, assist1_id=12, assist2_id=13),
        _ev(3, "shot-on-goal", shooting_team_id=200, shooter_id=21),
        _ev(4, "blocked-shot", shooting_team_id=200, shooter_id=22, blocker_id=15, reason="blocked"),
        _ev(5, "blocked-shot", shooting_team_id=100, shooter_id=14, blocker_id=13, reason="teammate-blocked"),
        _ev(6, "missed-shot", shooting_team_id=100, shooter_id=14),
        _ev(7, "penalty", pen_desc_key="tripping", pen_committed_by_id=22, pen_drawn_by_id=11),
        _ev(8, "penalty", pen_desc_key="misconduct", pen_committed_by_id=23),
        # power play (home 5 v away 4): individual counts only, no 5v5 on-ice
        _ev(9, "goal", shooting_team_id=100, scorer_id=14, shooter_id=14, assist1_id=11, sit_away_sk=4,
            away_skaters=np.array(AWAY[:4])),
        _ev(10, "shot-on-goal", shooting_team_id=100, shooter_id=11, is_penalty_shot=True),
        _ev(11, "goal", shooting_team_id=200, scorer_id=24, shooter_id=24, period_type="SO", is_shootout=True),
    ])
    lu = pd.DataFrame([{"game_id": 1, "player_id": p, "is_home": p < 20, "is_goalie": False, "status": "dressed",
                        "position": "D" if p in (15, 25) else "C"} for p in HOME + AWAY + [26]]
                      + [{"game_id": 1, "player_id": 31, "is_home": True, "is_goalie": True, "status": "dressed",
                          "position": "G"}])
    gm = pd.DataFrame([{"game_id": 1, "game_date": "2026-10-07", "game_type": 2, "home_team_id": 100,
                        "has_shifts": True}])
    return ev, lu, gm


def test_game_counts_definition():
    pg = PR.game_counts(*_game()).set_index("player_id")
    assert set(pg.index) == set(HOME + AWAY + [26])          # every dressed skater, no goalie
    assert pg.loc[26, "gs"] == 0.0 and pg.loc[26, "group"] == "F" and pg.loc[15, "group"] == "D"
    p11 = pg.loc[11]
    # 5v5 goal + PP primary assist + penalty drawn; SOG = the goal + the penalty shot; on-ice 5v5: the goal,
    # three home attempts (goal, teammate-blocked attempt, miss) for, two away attempts against
    assert (p11["g"], p11["a1"], p11["sog"], p11["pd"]) == (1, 1, 2, 1)
    assert (p11["cf"], p11["ca"], p11["gf"], p11["ga"]) == (3, 2, 1, 0)
    assert p11["gs"] == pytest.approx(sum(PR.WEIGHTS[k] * p11[k] for k in PR.COUNT_COLS))
    assert pg.loc[11, "gs"] == pytest.approx(0.75 + 0.7 + 0.075 * 2 + 0.15 + 0.05 * 3 - 0.05 * 2 + 0.15)
    assert pg.loc[15, "blk"] == 1 and pg.loc[13, "blk"] == 0               # teammate block not credited
    assert pg.loc[22, "pt"] == 1 and pg.loc[23, "pt"] == 0                 # misconduct not counted
    assert (pg.loc[12, "fow"], pg.loc[22, "fol"]) == (1, 1)
    assert pg.loc[24, "g"] == 0                                            # shootout excluded
    assert (pg.loc[21, "cf"], pg.loc[21, "ca"], pg.loc[21, "ga"]) == (2, 3, 1)
    assert pg.loc[14, "g"] == 1 and pg.loc[14, "gf"] == 1                  # PP goal: his, but not 5v5 on-ice


def _clock():
    rows = []
    for s, y in (("20252026", 2025), ("20262027", 2026)):
        for k in range(40):
            d = (pd.Timestamp(f"{y}-10-07") + pd.Timedelta(days=k)).strftime("%Y-%m-%d")
            rows.append({"season": s, "game_date": d, "game_type": 2, "home_team_id": 1, "away_team_id": 2})
    return LeagueClock(league_index(pd.DataFrame(rows)))


def test_sums_weights_and_shrink():
    clk = _clock()
    rec = Recency(kind="decay", half_life=90.0)
    d = np.array(["2025-10-07", "2025-11-15"], dtype="datetime64[D]")
    pg = pd.DataFrame({"player_id": [1, 1], "d": d, "group": ["F", "F"], "gs": [1.0, 2.0]})
    pre = PR.pre_sums(pg, clk, "20262027", 0.0, rec)
    ga = clk.season_start("20262027") - clk.before(d)
    w = rec.weight(ga)
    assert pre.loc[1, "sw"] == pytest.approx(w.sum()) and pre.loc[1, "sgs"] == pytest.approx(w @ [1.0, 2.0])
    later = PR.pre_sums(pg, clk, "20262027", 10.0, rec)
    assert later.loc[1, "sw"] == pytest.approx(rec.weight(ga + 10).sum())
    cur = pd.DataFrame({"player_id": [1, 2], "d": np.array(["2026-10-07", "2026-10-09"], dtype="datetime64[D]"),
                        "group": ["F", "D"], "gs": [3.0, 0.5]})
    asof = np.datetime64("2026-10-11")
    ins = PR.in_sums(cur, clk, asof, rec, lag_days=2)
    assert ins.loc[1, "sw"] == pytest.approx(rec.weight(clk.before([asof])[0] - clk.before(cur["d"].to_numpy()[:1]))[0])
    assert 2 in ins.index                                                   # 10-09 <= 10-11 - 2 days
    assert 2 not in PR.in_sums(cur, clk, np.datetime64("2026-10-10"), rec, 2).index
    tot = PR.add_sums(pre, ins)
    assert tot.loc[1, "sw"] == pytest.approx(pre.loc[1, "sw"] + ins.loc[1, "sw"]) and tot.loc[2, "group"] == "D"
    gs, prod = PR.shrink([10.0, 0.0], [12.0, 0.0], [0.5, 0.5], 5.0)
    assert gs[0] == pytest.approx((12 + 2.5) / 15) and gs[1] == pytest.approx(0.5)
    assert prod[0] == pytest.approx(82 * (gs[0] - 0.5)) and prod[1] == 0.0


def test_pack_prior_interpolates():
    pack = {"grid": [{"g": 0.0, "rows": [[1, "F", 10.0, 8.0, 6.0]]},
                     {"g": 5.0, "rows": [[1, "F", 10.0, 6.0, 4.0], [2, "D", 1.0, 1.0, 0.5]]}]}
    mid = PR.pack_prior(pack, 2.5)
    assert mid.loc[1, "sw"] == pytest.approx(7.0) and mid.loc[2, "sw"] == pytest.approx(0.5)
    assert mid.loc[2, "group"] == "D" and PR.pack_prior(pack, 50.0).loc[1, "sgs"] == 4.0


def _prod_bundle():
    b = _v5_bundle()
    b["prod"] = {"columns": PR.TABLE_COLUMNS,
                 "rows": [[1, "F", 150.0, 100.0, 150.0], [2, "D", 150.0, 100.0, 40.0], [3, "F", 100.0, 60.0, 15.0],
                          [5, "D", 120.0, 80.0, 40.0], [77, "F", 10.0, 5.0, 9.0]],
                 "meta": {"pseudo_games": 5.0, "games": 82, "weights": PR.WEIGHTS, "asof": "2026-10-04", "g": 1.0}}
    return b


def test_export_prod_columns():
    from datetime import datetime, timezone
    from bu.lineup import ratings_export as RE
    now = datetime(2026, 10, 3, tzinfo=timezone.utc)
    dp = RE.build_export(_prod_bundle(), None, ROSTER, None, now=now)
    d5 = RE.build_export(_v5_bundle(), None, ROSTER, None, now=now)
    assert dp["columns"] == RE.COLUMNS_V5 + RE.PROD_COLUMNS and dp["version"] == 4 and "prod" not in d5
    # the ratings are untouched: every v5 cell identical
    n5 = len(RE.COLUMNS_V5)
    assert sorted(r[:n5] for r in dp["rows"]) == sorted(d5["rows"])
    m = dp["prod"]["position_means"]
    assert m["F"] == pytest.approx(165 / 160, abs=1e-4) and m["D"] == pytest.approx(80 / 180, abs=1e-4)
    rows = {r[0]: dict(zip(dp["columns"], r)) for r in dp["rows"]}
    for p, r in rows.items():
        g = "D" if r["pos"] == "D" else "F"
        assert r["prod"] == pytest.approx(82 * (r["gs_pg"] - m[g]), abs=0.05)
    assert rows[1]["gs_pg"] == pytest.approx((150 + 5 * m["F"]) / 105, abs=1e-3) and rows[1]["prod"] > 0
    assert rows[3]["prod"] < 0 and rows[4]["prod"] == 0.0 and rows[4]["gs_pg"] == pytest.approx(m["F"], abs=1e-3)
    assert "prod" in dp["units"] and dp["prod"]["pseudo_games"] == 5.0


def test_check_player_ratings_prod(tmp_path):
    import validate_outputs as Vo
    from bu.lineup import ratings_export as RE
    from test_bu_ratings_v4 import _v4_bundle
    b = _v4_bundle()
    rng = np.random.default_rng(1)
    b["v4"]["rows"] = [[i, "D" if i % 3 == 0 else "F", True, float(rng.normal(0, .2)), float(rng.normal(0, .1)), 0.01,
                        0.004, 0.0, float(rng.normal(0, .3)), float(rng.normal(0, .2)), 0.04, 0.02, 0.0, 15.0, 1.5, 1.5,
                        0.0, 0.0, 0.0, 0.0, 0.5, 0.5, 0.0, ""] for i in range(1, 701)]
    b["prod"] = {"columns": PR.TABLE_COLUMNS, "meta": {"pseudo_games": 5.0, "games": 82},
                 "rows": [[i, "D" if i % 3 == 0 else "F", 100.0, 80.0, float(80 * rng.uniform(0.1, 1.2))]
                          for i in range(1, 701)]}
    roster = {i: (f"Player {i}", f"T{i % 32:02d}", "D" if i % 3 == 0 else "C") for i in range(1, 701)}
    doc = RE.build_export(b, None, roster, None)
    p, bp = tmp_path / "pr.json", tmp_path / "b.json.gz"
    with gzip.open(bp, "wt") as f:
        json.dump(b, f)
    ctx = {"player_ratings_path": str(p), "bu_bundle_path": str(bp)}
    p.write_text(json.dumps(doc))
    assert Vo.check_player_ratings(ctx) == []
    bad = json.loads(json.dumps(doc))
    bad["rows"][0][bad["columns"].index("prod")] += 5.0
    p.write_text(json.dumps(bad))
    assert any("prod" in e for e in Vo.check_player_ratings(ctx))
    old = json.loads(json.dumps(doc))
    k = old["columns"].index("prod")
    old["columns"] = old["columns"][:k]
    old["rows"] = [r[:k] for r in old["rows"]]
    old.pop("prod")
    p.write_text(json.dumps(old))
    assert any("no prod column" in e for e in Vo.check_player_ratings(ctx))


def test_committed_prod_files():
    """The committed pack carries the tuned configuration; the bundle a prod table; the site file prod."""
    from bu.lineup import serve as SV
    from bu.rapm import v3 as V
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    doc = json.load(open(os.path.join(root, "public", "data", "player_ratings.json")))
    pk = PR.read_pack(PR.pack_path(doc["season"]))
    assert pk is not None and pk["config"]["pseudo_games"] == PR.PSEUDO_GAMES and pk["config"]["weights"] == PR.WEIGHTS
    assert Recency.from_dict(pk["config"]["recency"]) == V.RECENCY and [x["g"] for x in pk["grid"]] == list(V.G_GRID)
    b = SV.read(os.path.join(root, "pipeline", "bu", "lineup", "out", "serving_bundle.json.gz"))
    assert b["prod"]["columns"] == PR.TABLE_COLUMNS and len(b["prod"]["rows"]) > 800
    assert b["prod"]["meta"]["g"] == b["v4"]["meta"]["g"] and b["prod"]["meta"]["asof"] == b["v4"]["meta"]["asof"]
    assert doc["columns"][-2:] == ["prod", "gs_pg"]
    rep = json.load(open(os.path.join(root, "pipeline", "bu", "rapm", "out", "prod_validation.json")))
    assert rep["best_k"] == PR.PSEUDO_GAMES
