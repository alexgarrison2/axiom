"""Ratings v4 (bu/rapm/box.py, v4.py, v4_pack.py): box-score counts, the joint SPM prior, export v4."""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from bu.rapm import box as B
from bu.rapm import v3 as V
from bu.rapm import v4 as V4
from bu.rapm import v4_pack as P4

from test_bu_ratings_v3 import ROSTER, _design, _v3_bundle


# ── box-score counts ────────────────────────────────────────────────────────

def _events():
    """One game: home 1-5 (+ G 90), away 11-15 (+ G 91)."""
    base = dict(game_id=1, period=1, period_type="REG", is_shootout=False, is_penalty_shot=False, sit_home_g=1,
                sit_away_g=1, sit_home_sk=5, sit_away_sk=5, zone_code="O", event_team_is_home=True)
    ev = []

    def add(**k):
        ev.append({**base, "event_id": len(ev) + 1, "sort_order": len(ev) + 1, **k})
    add(type_desc="faceoff", game_seconds=0, fo_winner_id=1, fo_loser_id=11, event_team_id=100, zone_code="N")
    add(type_desc="shot-on-goal", game_seconds=10, shooter_id=2, shooting_team_id=100, event_team_id=100)
    add(type_desc="goal", game_seconds=12, shooter_id=3, scorer_id=3, assist1_id=2, assist2_id=1, shooting_team_id=100,
        event_team_id=100)                                                  # rebound of 2's shot, 2 s later
    add(type_desc="blocked-shot", game_seconds=100, shooter_id=12, blocker_id=4, shooting_team_id=200,
        event_team_id=200, event_team_is_home=False)
    add(type_desc="penalty", game_seconds=200, pen_committed_by_id=13, pen_drawn_by_id=1, pen_desc_key="tripping",
        pen_duration=2, event_team_id=200, event_team_is_home=False)
    add(type_desc="penalty", game_seconds=200, pen_committed_by_id=5, pen_drawn_by_id=14, pen_desc_key="fighting",
        pen_duration=5, event_team_id=100)
    add(type_desc="goal", game_seconds=230, shooter_id=1, scorer_id=1, assist1_id=3, shooting_team_id=100,
        event_team_id=100, sit_away_sk=4)                                   # PP goal
    add(type_desc="blocked-shot", game_seconds=240, shooter_id=2, blocker_id=11, shooting_team_id=100,
        event_team_id=100, sit_away_sk=4)                                   # PK block for 11
    df = pd.DataFrame(ev)
    for c in ("shooter_id", "scorer_id", "assist1_id", "assist2_id", "blocker_id", "fo_winner_id", "fo_loser_id",
              "pen_committed_by_id", "pen_drawn_by_id", "player_id", "hitter_id", "pen_duration"):
        if c not in df.columns:
            df[c] = np.nan
        df[c] = df[c].astype("Int64")
    for c in ("shooting_team_id", "event_team_id"):
        df[c] = df[c].astype("Int64")
    df["pen_desc_key"] = df.get("pen_desc_key", pd.Series(dtype=object))
    return df


def _lineups():
    return pd.DataFrame({"game_id": 1, "player_id": list(range(1, 6)) + list(range(11, 16)),
                         "is_home": [True] * 5 + [False] * 5})


def _toi():
    d = np.datetime64("2025-01-01")
    return pd.DataFrame({"game_id": 1, "d": d, "player_id": list(range(1, 6)) + list(range(11, 16)),
                         "ev_s": 900.0, "pp_s": 60.0, "pk_s": 60.0})


def test_player_game_counts():
    xg = pd.DataFrame({"game_id": [1, 1, 1], "event_id": [2, 3, 7], "xg": [0.05, 0.3, 0.2]})
    pg = B.player_game_counts(_events(), _lineups(), xg, _toi()).set_index("player_id")
    assert len(pg) == 10 and pg["ev_s"].eq(900).all()
    assert pg.loc[3, "g_ev"] == 1 and pg.loc[2, "a1_ev"] == 1 and pg.loc[1, "a2_ev"] == 1
    assert pg.loc[1, "g_pp"] == 1 and pg.loc[3, "a1_pp"] == 1 and pg.loc[1, "g_ev"] == 0
    assert pg.loc[3, "ixg_ev"] == pytest.approx(0.3) and pg.loc[1, "ixg_pp"] == pytest.approx(0.2)
    assert pg.loc[2, "iff_ev"] == 1 and pg.loc[2, "icf_ev"] == 1 and pg.loc[12, "icf_ev"] == 1
    assert pg.loc[2, "reb_ev"] == 1 and pg.loc[3, "reb_ev"] == 0              # 2's save created the rebound
    assert pg.loc[4, "blk_ev"] == 1 and pg.loc[11, "blk_pk"] == 1 and pg.loc[11, "blk_ev"] == 0
    assert pg.loc[1, "fow_ev"] == 1 and pg.loc[11, "fol_ev"] == 1
    assert pg.loc[1, "pd_all"] == 1 and pg.loc[13, "pt_all"] == 1
    assert pg.loc[5, "pt_all"] == 0 and pg.loc[14, "pd_all"] == 0             # fighting: no power play
    assert list(B.penalty_units(["tripping", "high-sticking-double-minor", "boarding", "fighting", "misconduct"],
                                [2, 4, 5, 5, 10])) == [1, 2, 2.5, 0, 0]
    v = B.pp_goal_value(_events())
    assert v["ppg"] == 1 and v["units"] == 1 and v["value"] == 1.0


# ── SPM features and the joint solve ────────────────────────────────────────

def _sums(n=40, seed=0):
    rng = np.random.default_rng(seed)
    df = pd.DataFrame(rng.poisson(5, (n, len(B.COUNT_COLS))).astype(float), columns=B.COUNT_COLS,
                      index=pd.Index(range(1, n + 1)))
    df["ev_s"] = rng.uniform(0, 200_000, n)
    df["pp_s"] = rng.uniform(0, 20_000, n)
    df["pk_s"] = rng.uniform(0, 20_000, n)
    df["gp"] = df["ev_s"] / 900
    return df[V4.SUM_COLS]


def test_rates_shrink_and_standardise():
    s = _sums()
    groups = {p: ("D" if p % 4 == 0 else "F") for p in s.index}
    st = V4.SpmStats.fit(s, groups, 150.0)
    z = st.z(s, groups)
    grp = V4._groups(s.index, groups)
    k = V4.FEATURES.index("g_ev")
    w = s["ev_s"].to_numpy()
    assert np.average(z[grp == "F", k], weights=w[grp == "F"]) == pytest.approx(0, abs=0.05)   # up to the +-4 SD clip
    assert (z[grp == "D", V4.FEATURES.index("fow_ev")] == 0).all() and np.abs(z).max() <= V4.Z_CLIP
    # no ice time: exactly the position-group rate (z = position mean of the shrunk rates, ~0)
    empty = pd.DataFrame(0.0, index=pd.Index([999]), columns=V4.SUM_COLS)
    r = V4.rates(empty, np.array(["F"]), st)
    assert r[0, k] == pytest.approx(st.mu["F"][k] * 3600)
    back = V4.SpmStats.from_json(json.loads(json.dumps(st.to_json())))
    assert np.allclose(back.z(s, groups), z)
    pr = V4.penalty_rates(s, groups, 400.0)
    assert (pr["pd60"] > 0).all() and pr.index.equals(s.index)


def test_solve_spm_reduces_to_v3_with_role_columns_only():
    des, att, dfn, y, w, dates, o_true, d_true = _design(seed=5, n_rows=2000)
    G, r, *_ = des.gram(np.ones(len(des.dates)))
    blocks = [(des.ids, G.toarray(), r)]
    roles = {int(p): ("F|u1" if i % 2 else "F|u4") for i, p in enumerate(des.ids)}
    names = ["F|u1", "F|u4"]
    ref = V._solve_two_comp(blocks, des.ids, 1, 0.05, 0.01, roles, names, roles, names, 1.0, None, 1.0)
    M = V4._onehot(des.ids, roles, names)
    lam = np.full(2, 1.0 / 1.0)
    out = V4.solve_spm(blocks, des.ids, 1, 0.05, 0.01, M, M, lam, lam, 1.0)
    for k in ("a", "b", "var_a", "var_b", "cov_ab"):
        assert np.allclose(out[k], ref[k])
    assert np.allclose(out["coef_a"], ref["role_a"]) and np.allclose(out["mvar_b"], ref["role_var_b"])


def test_spm_feature_recovers_the_split_of_inseparable_linemates():
    """Two players who are always on the ice together: RAPM alone splits their sum evenly; with a
    box-score feature that tracks talent across the league the split follows the feature."""
    rng = np.random.default_rng(7)
    n = 60
    talent = rng.normal(0, 0.3, n)
    feat = talent + rng.normal(0, 0.05, n)
    att, dfn, y, w, dates = [], [], [], [], []
    for i in range(6000):
        if i % 4 == 0:      # players 0 and 1 only ever play together
            a = [0, 1] + list(rng.choice(np.arange(2, n), 3, replace=False))
        else:
            a = list(rng.choice(np.arange(2, n), 5, replace=False))
        b = list(rng.choice([p for p in range(2, n) if p not in a], 5, replace=False))
        att.append([int(x) + 100 for x in a])
        dfn.append([int(x) + 100 for x in b])
        y.append(2.5 + talent[a].sum() + rng.normal(0, 1.0))
        w.append(30.0)
        dates.append(np.datetime64("2021-01-01"))
    des = V.Design.from_rows("ev", "20202021", att, dfn, np.ones((len(y), 1)), np.array(y), np.array(w),
                             np.array(dates, dtype="datetime64[D]"))
    G, r, *_ = des.gram(np.ones(1))
    blocks = [(des.ids, G.toarray(), r)]
    one = np.ones((des.n, 1))
    z = (feat - feat.mean()) / feat.std()
    M = np.hstack([one, z[des.ids - 100][:, None]])
    base = V4.solve_spm(blocks, des.ids, 1, 0.02, 0.02, one, one, np.full(1, 1e3), np.full(1, 1e3), 30.0)
    spm = V4.solve_spm(blocks, des.ids, 1, 0.02, 0.02, M, one, np.array([1e3, 1.0]), np.full(1, 1e3), 30.0)
    gap_true = talent[0] - talent[1]
    i0, i1 = list(des.ids).index(100), list(des.ids).index(101)
    assert abs((spm["a"][i0] - spm["a"][i1]) - gap_true) < abs((base["a"][i0] - base["a"][i1]) - gap_true)
    assert spm["coef_a"][1] > 0


def test_prior4_interpolation_and_pack_json():
    s0, s1 = _sums(seed=1), _sums(seed=2)
    groups = {p: "F" for p in s0.index}
    K = len(V4.FEATURES)
    mk = lambda g, s, c: V4.Prior4(g, {1: (0.1 * c, 0.0, 0.01, 0.01, 0.0, "F|u2")}, {}, {"F|u2": (0.0, 0.0, 0, 0)},  # noqa: E731
                                   {"F": (0.0, 0.0, 0, 0)}, None, None, V4.SpmStats.fit(s, groups, 150.0),
                                   {c_: {"F": np.full(K, c), "D": np.zeros(K)} for c_ in ("o", "d", "pp", "pk")}, s)
    a, b = mk(0.0, s0, 1.0), mk(5.0, s1, 3.0)
    m = V4.interpolate4([a, b], 2.5, V4.Shrink4())
    assert m.ev[1][0] == pytest.approx(0.2) and np.allclose(m.coef["o"]["F"], 2.0)
    assert np.allclose(m.box.loc[1].to_numpy(), 0.5 * (s0.loc[1] + s1.loc[1]).to_numpy())
    stats, coef, box = P4._spm_from_json(json.loads(json.dumps(P4._spm_json(a))))
    assert np.allclose(coef["o"]["F"], 1.0) and np.allclose(box["ev_s"], s0["ev_s"], atol=0.51)
    assert np.allclose(stats.mean["F"], a.stats.mean["F"])


def test_shrink4_off_is_v3():
    sh = V4.Shrink4(spm=False, spm_st=False)
    assert sh.key() == V.Shrink().key() and sh.v_o == V.Shrink().v_o


# ── export v4 ───────────────────────────────────────────────────────────────

def _v4_bundle():
    b = _v3_bundle()
    v3 = b["v3"]
    rows = []
    for r in v3["rows"]:
        rows.append(r[:-1] + [r[3] * 0.8, r[4] * 0.8, r[8] * 0.5, r[9] * 0.5, 0.7 if r[0] == 1 else 0.4,
                              0.2 if r[0] == 1 else 0.6, 0.0, r[-1]])
    meta = dict(v3["meta"], pen_value=0.15)
    b["v4"] = {"columns": P4.LIVE_COLUMNS, "rows": rows, "meta": meta}
    return b


def test_export_schema_v4_penalties():
    from datetime import datetime, timezone
    from bu.lineup import ratings_export as RE
    now = datetime(2026, 10, 2, tzinfo=timezone.utc)
    doc = RE.build_export(_v4_bundle(), None, ROSTER, None, now=now)
    assert doc["version"] == 4 and doc["columns"] == RE.COLUMNS_V4 and doc["impact"]["pen_value"] == 0.15
    rows = {r[0]: dict(zip(doc["columns"], r)) for r in doc["rows"]}
    d3 = {r[0]: dict(zip(doc["columns"], r)) for r in RE.build_export(_v3_bundle(), None, ROSTER, None, now=now)["rows"]}
    for p, r in rows.items():
        assert r["impact"] == pytest.approx(r["off_impact"] + r["def_impact"], abs=0.011)
        assert r["impact"] - d3[p]["impact"] == pytest.approx(r["pen_impact"], abs=0.02)
        assert r["spm_def"] == pytest.approx(0.8 * d3[p]["ev_def"], abs=0.002) if p in (1, 2, 3, 5) else True
    assert rows[1]["pen_impact"] > 0 > rows[3]["pen_impact"]          # draws more / takes fewer than average
    assert rows[4]["pen_impact"] == 0 and not rows[4]["rated"]       # rookie: position-average penalties
    # only the v3 table: the version 3 file, unchanged
    assert RE.build_export(_v3_bundle(), None, ROSTER, None, now=now)["version"] == 3


def test_committed_v4_files():
    """The committed site file is v4 (gate passes), the v4 pack carries the selected configuration and
    the serving bundle's v4 table the documented columns."""
    import os
    import validate_outputs as Vo
    from bu.lineup import serve as SV
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    doc = json.load(open(os.path.join(root, "public", "data", "player_ratings.json")))
    assert doc["version"] == 4 and Vo.check_player_ratings({}) == []
    pk = P4.read_pack(P4.pack_path(doc["season"]))
    assert pk is not None and pk["config"]["recency"]["max_games"] <= 246
    sh = V4.Shrink4(**pk["config"]["shrink"])
    assert sh == V4.SHRINK and pk["config"]["features"] == V4.FEATURES and pk["pen_value"] > 0
    b = SV.read(os.path.join(root, "pipeline", "bu", "lineup", "out", "serving_bundle.json.gz"))
    assert b["v4"]["columns"] == P4.LIVE_COLUMNS and len(b["v4"]["rows"]) > 1000
    term = SV.LiveLineupTerm(b, max_age_h=1e9, ratings="v4")
    assert len(term.ratings) == len(b["v4"]["rows"]) and set(term.rookie) == {"F", "D"}


def test_check_player_ratings_v4(tmp_path):
    import gzip
    import validate_outputs as Vo
    from bu.lineup import ratings_export as RE
    b = _v4_bundle()
    rng = np.random.default_rng(0)
    b["v4"]["rows"] = [[i, "D" if i % 3 == 0 else "F", True, float(rng.normal(0, .2)), float(rng.normal(0, .1)), 0.01,
                        0.004, 0.0, float(rng.normal(0, .3)), float(rng.normal(0, .2)), 0.04, 0.02, 0.0, 15.0, 1.5, 1.5,
                        0.0, 0.0, 0.0, 0.0, 0.5, 0.5, 0.0, ""] for i in range(1, 701)]
    roster = {i: (f"Player {i}", f"T{i % 32:02d}", "D" if i % 3 == 0 else "C") for i in range(1, 701)}
    doc = RE.build_export(b, None, roster, None)
    p, bp = tmp_path / "pr.json", tmp_path / "b.json.gz"
    with gzip.open(bp, "wt") as f:
        json.dump(b, f)
    p.write_text(json.dumps(doc))
    ctx = {"player_ratings_path": str(p), "bu_bundle_path": str(bp)}
    assert Vo.check_player_ratings(ctx) == []
    bad = json.loads(json.dumps(doc))
    bad["rows"][0][bad["columns"].index("pd60")] = None
    p.write_text(json.dumps(bad))
    assert any("penalty" in e for e in Vo.check_player_ratings(ctx))
