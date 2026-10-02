"""Player ratings v3 (bu.rapm.recency / v3 / v3_pack, bu.lineup.ratings_export v3): offline, synthetic."""
from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd
import pytest
import scipy.sparse as sp

from bu.rapm import v3 as V
from bu.rapm import v3_pack as P3
from bu.rapm.recency import LeagueClock, Recency, league_index

PIPELINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(PIPELINE)


# ── recency weights ──────────────────────────────────────────────────────────

def test_block_weights_steps_and_horizon():
    r = Recency()                                   # 5 x 30 games: 1 / .8 / .6 / .4 / .2
    ga = [0.5, 30.0, 30.5, 60.0, 61.0, 90.5, 120.5, 150.0, 150.5, 300.0]
    assert list(r.weight(ga)) == pytest.approx([1, 1, .8, .8, .6, .4, .2, .2, 0, 0])
    assert r.horizon == 150
    t = r.effective_table()
    assert sum(t["by_games_ago"].values()) == pytest.approx(1.0)
    assert t["by_games_ago"]["0-30"] == pytest.approx(1 / 3, abs=0.01)     # 30 / (30 * 3.0)
    assert t["by_82_game_season_back"]["S-2"] == 0 and t["by_82_game_season_back"]["S-3"] == 0


def test_decay_weights_truncate_three_seasons_back():
    r = Recency(kind="decay", half_life=60.0)
    assert r.weight([60.0])[0] == pytest.approx(0.5)
    assert r.weight([246.0])[0] > 0 and r.weight([246.5])[0] == 0          # 3 x 82 games: weight exactly 0
    assert Recency.from_dict(json.loads(json.dumps(r.as_dict()))) == r
    assert r.effective_table()["by_82_game_season_back"]["S-3"] == 0


def _games():
    # season A: 4 teams, 2 games on day 1 and 2 on day 3 (each team plays twice), playoffs on day 5 (1 game);
    # season B starts after a summer: 2 games on day 100
    rows = []
    gid = 1
    for season, day, pairs, gt in (("20202021", "2020-10-01", [(1, 2), (3, 4)], 2), ("20202021", "2020-10-03", [(1, 3), (2, 4)], 2),
                                   ("20202021", "2020-10-05", [(1, 2)], 3), ("20212022", "2021-01-08", [(1, 4), (2, 3)], 2)):
        for h, a in pairs:
            rows.append({"season": season, "game_id": gid, "game_date": day, "game_type": gt, "home_team_id": h,
                         "away_team_id": a})
            gid += 1
    return pd.DataFrame(rows)


def test_league_index_counts_games_per_team_by_date():
    clk = LeagueClock(league_index(_games()))
    d = np.datetime64
    # L_before: 0 on day 1, 1 on day 3 (2 games x 2 / 4 teams), 2 on day 5, 2.5 after the playoff night
    assert list(clk.before([d("2020-10-01"), d("2020-10-02"), d("2020-10-03"), d("2020-10-05")])) == [0, 1, 1, 2]
    assert clk.before([d("2020-12-01")])[0] == pytest.approx(2.5)          # the summer adds nothing
    assert clk.games_ago([d("2020-10-01")], d("2021-01-09"))[0] == pytest.approx(3.5)
    assert clk.season_start("20212022") == pytest.approx(2.5)
    assert clk.in_season("20212022", d("2021-01-09")) == pytest.approx(1.0)
    assert clk.in_season("20212022", d("2021-01-08")) == 0
    assert clk.date_at("20202021", 1.0) == d("2020-10-03")
    assert clk.date_at("20202021", 9.0) is None


# ── per-date Gram store and the two-component fit ───────────────────────────

def _design(seed=0, n_players=12, n_rows=600, n_dates=6):
    rng = np.random.default_rng(seed)
    o_true = rng.normal(0, 0.5, n_players)
    d_true = rng.normal(0, 0.05, n_players)
    att, dfn, y, w, dates = [], [], [], [], []
    for i in range(n_rows):
        p = rng.choice(n_players, 6, replace=False)
        a, b = list(p[:3]), list(p[3:])
        att.append([int(x) + 100 for x in a])
        dfn.append([int(x) + 100 for x in b])
        y.append(2.5 + o_true[a].sum() + d_true[b].sum() + rng.normal(0, 1.0))
        w.append(rng.uniform(5, 60))
        dates.append(np.datetime64("2021-01-01") + np.timedelta64(int(i % n_dates), "D"))
    cov = np.ones((n_rows, 1))
    return V.Design.from_rows("ev", "20202021", att, dfn, cov, np.array(y), np.array(w),
                              np.array(dates, dtype="datetime64[D]")), att, dfn, np.array(y), np.array(w), \
        np.array(dates, dtype="datetime64[D]"), o_true, d_true


def _dense_X(des, att, dfn):
    X = np.zeros((len(att), des.p))
    for i, (a, b) in enumerate(zip(att, dfn)):
        for p in a:
            X[i, des.pos[p]] += 1
        for p in b:
            X[i, des.n + des.pos[p]] += 1
        X[i, 2 * des.n] = 1.0
    return X


def test_design_gram_and_date_sse_are_exact():
    des, att, dfn, y, w, dates, *_ = _design()
    X = _dense_X(des, att, dfn)
    wd = np.linspace(0.2, 1.0, len(des.dates))                # per-date recency weights
    rw = w * wd[np.searchsorted(des.dates, dates)]
    G, r, yy, sw, n = des.gram(wd)
    assert np.allclose(G.toarray(), X.T @ (X * rw[:, None]))
    assert np.allclose(r, X.T @ (rw * y)) and yy == pytest.approx(float(np.sum(rw * y * y)))
    beta = np.random.default_rng(1).normal(0, 0.3, des.p)
    sse = des.date_sse(beta, wd)
    direct = [float(np.sum((rw * (y - X @ beta) ** 2)[dates == d])) for d in des.dates]
    assert np.allclose(sse, direct)


def test_separate_off_def_shrinkage():
    des, att, dfn, y, w, dates, o_true, d_true = _design(seed=3, n_rows=3000)
    w1 = np.ones(len(des.dates))
    G, r, *_ = des.gram(w1)
    blocks = [(des.ids, G.toarray(), r)]
    loose = V._solve_two_comp(blocks, des.ids, 1, 1.0, 1.0, None, None, None, None, 0.05, np.zeros((des.n, 2)), 1.0)
    split = V._solve_two_comp(blocks, des.ids, 1, 1.0, 1e-9, None, None, None, None, 0.05, np.zeros((des.n, 2)), 1.0)
    # OFF is barely shrunk in either fit; DEF collapses to its prior mean (0) only with a tight v_d
    assert np.corrcoef(split["a"], o_true)[0, 1] > 0.95
    assert np.abs(split["b"]).max() < 1e-3 < np.abs(loose["b"]).max()
    assert np.allclose(split["a"], loose["a"], atol=0.15)
    assert (split["var_b"] < 2e-6).all() and (split["var_a"] > 1e-4).all()


def test_role_means_and_recentering_keep_predictions():
    des, att, dfn, y, w, dates, o_true, d_true = _design(seed=5, n_rows=2000)
    G, r, *_ = des.gram(np.ones(len(des.dates)))
    roles = {int(p): ("F|u1" if i % 2 else "F|u4") for i, p in enumerate(des.ids)}
    out = V._solve_two_comp([(des.ids, G.toarray(), r)], des.ids, 1, 0.05, 0.01, roles, ["F|u1", "F|u4"], roles,
                            ["F|u1", "F|u4"], 1.0, None, 1.0)
    # totals = role mean + own effect; centring moves every player by c and the intercept by n x c
    c_a, c_b = V._center(out)
    X = _dense_X(des, att, dfn)
    b = np.concatenate([out["a"], out["b"], out["cov"][0]])
    bc = np.concatenate([out["a"] - c_a, out["b"] - c_b, out["cov"][0] + 3 * (c_a + c_b)])
    assert np.allclose(X @ b, X @ bc)
    assert np.average(out["a"] - c_a, weights=out["w_a"]) == pytest.approx(0, abs=1e-9)
    # the shipped helper does the same for 5v5 rows (intercept + 5 c) and the 4v4 / 3v3 terms
    cov = np.zeros(len(V.COVARIATES))
    cc = V.recenter_cov("ev", cov, 0.1, 0.02)
    assert cc[0] == pytest.approx(0.6) and cc[V.COVARIATES.index("st_4v4")] == pytest.approx(-0.12)
    sc = V.recenter_cov("st", np.zeros(len(V.ST_COVARIATES)), 0.1, 0.02)
    assert sc[0] == pytest.approx(0.58) and sc[V.ST_COVARIATES.index("st_5v3")] == pytest.approx(-0.02)


def test_usage_roles():
    assert V.usage_role("F", 16.0, 40, "r1") == "F|u4"
    assert V.usage_role("F", 10.0, 40, "r1") == "F|u1"
    assert V.usage_role("D", 17.0, 40, "later") == "D|u2"
    assert V.usage_role("D", 22.0, 5, "later") == "D|low|later"      # fewer than 10 weighted games
    assert V.def_role("F|u3") == "F|all" and V.def_role("D|low|r1") == "D|low|r1"
    assert set(V.DEF_ROLES) >= {"F|all", "D|all"}


def test_interpolation_of_grid_priors():
    a = V.Prior(0.0, {1: (0.2, 0.0, 0.01, 0.004, 0.0, "F|u2")}, {1: (0.1, 0.0, 0.02, 0.01)},
                {"F|u2": (0.1, 0.0, 0.0, 0.0), "F|low|later": (0.0, 0.1, 0.0, 0.0)}, {"F": (0.0, 0.0, 0.0, 0.0)},
                np.zeros(3), None)
    b = V.Prior(5.0, {1: (0.4, 0.0, 0.02, 0.004, 0.0, "F|u2")}, {},
                {"F|u2": (0.3, 0.0, 0.0, 0.0), "F|low|later": (0.0, 0.1, 0.0, 0.0)}, {"F": (0.0, 0.0, 0.0, 0.0)},
                np.ones(3), None)
    sh = V.Shrink()
    m = V.interpolate([a, b], 2.5, sh)
    o, d, ov, dv, cv, role = m.ev[1]
    assert o == pytest.approx(0.3) and role == "F|u2"
    assert ov == pytest.approx(1 / (0.5 / 0.01 + 0.5 / 0.02))         # precisions are interpolated
    assert np.allclose(m.cov_ev, 0.5) and m.role_ev["F|u2"][0] == pytest.approx(0.2)
    assert m.st[1][2] == pytest.approx(1 / (0.5 / 0.02 + 0.5 / sh.v_pp))   # missing at g=5: base variance
    assert V.interpolate([a, b], 5.0, sh) is b


def test_pack_prior_json_roundtrip():
    pr = V.Prior(10.0, {7: (0.123456789, -0.05, 0.0123, 0.0044, -0.0001, "D|u2")}, {7: (0.3, -0.2, 0.05, 0.02)},
                 {r: (0.01, 0.02, 0.001, 0.001) for r in V.ROLES}, {"F": (0.1, 0.0, 0.01, 0.01), "D": (-0.5, 0.1, 0.01, 0.01)},
                 np.arange(len(V.COVARIATES), dtype=float), np.arange(len(V.ST_COVARIATES), dtype=float))
    fin = pd.DataFrame({"g": [3.0], "x": [2.5], "s": [36000.0]}, index=pd.Index([7], name="player_id"))
    back, fb = P3._prior_from_json(json.loads(json.dumps(P3._prior_json(pr, fin))))
    assert back.ev[7][0] == pytest.approx(0.1234568, abs=1e-7) and back.ev[7][5] == "D|u2"
    assert back.st[7] == pytest.approx((0.3, -0.2, 0.05, 0.02))
    assert np.allclose(back.cov_ev, pr.cov_ev) and fb.loc[7, "s"] == 36000.0


# ── FIN with game recency ────────────────────────────────────────────────────

def test_fin_values_match_finstate_and_age_out():
    from bu.rapm import finishing as FN
    pg = pd.DataFrame({"player_id": [1, 1, 2], "g": [5.0, 1.0, 0.0], "x": [2.0, 1.0, 3.0], "s": [30000.0, 9000.0, 40000.0]})
    w = np.array([1.0, 0.5, 1.0])
    sums = V.fin_sums(pg, w, ratio=1.1)
    assert sums.loc[1, "g"] == pytest.approx(5.5) and sums.loc[1, "x"] == pytest.approx(2.75)
    fv = V.fin_values(sums, {1: "F", 2: "D"}, prior_xg=60.0)
    st = FN.FinState(prior_xg=60.0)
    st.past = {1: list(sums.loc[1]), 2: list(sums.loc[2])}
    assert fv.loc[1, "fin_f"] == pytest.approx(st.fin(1, "F")) and fv.loc[1, "mult"] == pytest.approx(st.multiplier(1))
    assert fv.loc[1, "fin_f"] > 0 > fv.loc[2, "fin_d"]
    # a game older than the recency horizon has weight 0: it no longer moves FIN
    r = Recency()
    old = V.fin_sums(pg, r.weight(np.array([10.0, 200.0, 10.0])), 1.0)
    assert old.loc[1, "g"] == pytest.approx(5.0)
    mid = V.interp_sums(sums, old, 0.5)
    assert mid.loc[1, "g"] == pytest.approx((5.5 + 5.0) / 2)


def test_toi_ewma_rolls_exactly():
    rng = np.random.default_rng(2)
    rows = []
    for k in range(30):
        for p in (1, 2):
            rows.append({"game_id": k, "d": np.datetime64("2021-01-01") + np.timedelta64(k, "D"), "player_id": p,
                         "ev_s": rng.uniform(600, 1100), "pp_s": rng.uniform(0, 200), "pk_s": rng.uniform(0, 150)})
    toi = pd.DataFrame(rows)
    toi.loc[toi["player_id"] == 2, "d"] = toi.loc[toi["player_id"] == 2, "d"]   # same dates
    cut = np.datetime64("2021-01-20")
    a = V.toi_state(toi[toi["d"] <= cut], cut)
    rolled = V.roll_toi_state(a, toi[toi["d"] > cut])
    full = V.toi_state(toi, np.datetime64("2021-12-31"))
    assert np.allclose(rolled.loc[full.index, full.columns].to_numpy(), full.to_numpy())
    ex = V.expected_toi(full, {1: "F", 2: "D"}, {"F": {"ev": 900, "pp": 100, "pk": 60}, "D": {"ev": 1200, "pp": 60, "pk": 100}})
    assert 10 < ex.loc[1, "toi_ev"] < 19 and (ex >= 0).all().all()


# ── impact arithmetic and the site file ──────────────────────────────────────

def test_impact_arithmetic():
    from bu.lineup import ratings_export as RE
    r = {"ev_off": 0.30, "ev_def": 0.10, "pp_off": 1.0, "pk_def": 0.5, "fin": 0.05, "toi_ev_gp": 15.0, "toi_pp_gp": 3.0,
         "toi_pk_gp": 2.0, "o_var": 0.01, "d_var": 0.004, "od_cov": -0.001, "pp_var": 0.04, "pk_var": 0.02}
    m = {"ev_off": 0.10, "ev_def": 0.0, "pp_off": 0.5, "pk_def": 0.0, "fin": 0.0}
    w = {"w_o": 1.0, "w_d": 0.8, "w_pp": 1.0, "w_pk": 0.5}
    im = RE.impact(r, m, w, k=1.05)
    off = 82 * (1.05 * 0.25 * 0.20 + 1.05 * 0.05 * 0.5 + 0.25 * 0.05)
    dfn = 82 * (1.05 * 0.8 * 0.25 * 0.10 + 1.05 * 0.5 * (2 / 60) * 0.5)
    assert im["off_impact"] == pytest.approx(off) and im["def_impact"] == pytest.approx(dfn)
    assert im["impact"] == pytest.approx(off + dfn)
    var = 0.25 ** 2 * (0.01 + 0.64 * 0.004 + 2 * 0.8 * 0.001) + 0.05 ** 2 * 0.04 + (2 / 60) ** 2 * 0.25 * 0.02
    assert im["sd"] == pytest.approx(82 * 1.05 * np.sqrt(var))
    # the average player of a position (rates at the TOI-weighted mean) is exactly 0 whatever his minutes
    avg = dict(r, **{k: m[k] for k in m})
    assert RE.impact(avg, m, w, 1.05)["impact"] == pytest.approx(0)
    pm = RE.position_means([r, avg], ["F", "F"])
    assert pm["F"]["pp_off"] == pytest.approx(0.75) and pm["D"]["ev_off"] == 0.0


def _v3_bundle(season="20262027"):
    cols = P3.LIVE_COLUMNS
    def row(pid, g, o, d, pp, pk, fin, ev, ppm, pkm, rated=True):
        return [pid, g, rated, o, d, 0.01, 0.004, -0.0005, pp, pk, 0.04, 0.02, fin, ev, ppm, pkm, f"{g}|u3"]
    rows = [row(1, "F", 0.6, 0.05, 1.2, -0.1, 0.08, 16.0, 3.5, 0.2),     # star forward
            row(2, "D", -0.3, -0.25, -0.2, -0.6, 0.0, 19.0, 0.5, 3.0),   # shutdown defenceman
            row(3, "F", 0.0, 0.0, 0.3, 0.0, 0.0, 11.0, 0.3, 1.0),        # fourth liner
            row(5, "D", -0.4, 0.05, -0.8, 0.1, -0.02, 17.0, 1.0, 1.0),
            row(8, "F", 0.2, -0.05, 0.4, 0.0, 0.0, 14.0, 1.5, 1.5, rated=False)]
    meta = {"season": season, "max_source_date": "2026-10-01", "goals_per_xg": 1.06, "g": 1.2,
            "impact_weights": {"w_o": 1.0, "w_d": 1.0, "w_pp": 1.0, "w_pk": 1.0},
            "low_role": {"F": [-0.1, 0.05, 0.0, 0.0], "D": [-0.5, 0.05, -0.5, 0.0]},
            "toi_pos_means": {"F": {"ev": 800, "pp": 100, "pk": 60}, "D": {"ev": 1100, "pp": 60, "pk": 100}},
            "prior_var": {"o": 0.03, "d": 0.015, "pp": 0.04, "pk": 0.02}}
    return {"version": 1, "kind": "serving_bundle", "season": season, "built_at": "2026-10-02T09:30:00+00:00",
            "max_source_date": "2026-10-01", "n_games": 12, "v3": {"columns": cols, "rows": rows, "meta": meta}}


ROSTER = {1: ("Star Forward", "AAA", "C"), 2: ("Shutdown D", "AAA", "D"), 3: ("Fourth Liner", "BBB", "L"),
          4: ("New Kid", "BBB", "R"), 5: ("Puck Mover", "BBB", "D"), 9: ("A Goalie", "AAA", "G")}


def test_export_schema_v3():
    from datetime import datetime, timezone
    from bu.lineup import ratings_export as RE
    doc = RE.build_export(_v3_bundle(), None, ROSTER, {1: (900.0, 1)}, now=datetime(2026, 10, 2, tzinfo=timezone.utc))
    assert doc["version"] == 3 and doc["columns"] == RE.COLUMNS and doc["as_of"] == "2026-10-01"
    rows = {r[0]: dict(zip(doc["columns"], r)) for r in doc["rows"]}
    assert set(rows) == {1, 2, 3, 4, 5}                       # goalie dropped, rookie 4 listed (unrated)
    imp = [r[doc["columns"].index("impact")] for r in doc["rows"]]
    assert imp == sorted(imp, reverse=True)                   # sorted by impact, best first
    assert rows[1]["impact"] > rows[3]["impact"]              # the star beats the fourth liner
    for r in rows.values():
        assert r["impact"] == pytest.approx(r["off_impact"] + r["def_impact"], abs=0.011)
        assert r["net"] == pytest.approx(r["off"] + r["def"], abs=0.002)
        assert r["off_total"] == pytest.approx(r["off"] + r["fin"], abs=0.002)
        assert r["ev_off"] == r["off"] and r["ev_def"] == r["def"] and r["sd"] >= 0
    assert rows[2]["def"] == 0.25 and rows[2]["pk_def"] == 0.6      # prevented: -d, -pk
    assert not rows[4]["rated"] and rows[4]["toi_ev_gp"] == pytest.approx(800 / 60, abs=0.01)
    assert not rows[8 if 8 in rows else 4]["rated"]
    assert rows[1]["toi_cur"] == 15 and rows[1]["gp_cur"] == 1
    # position-average baseline: TOI-weighted EV offence of the rated roster forwards is centred
    f = [r for r in rows.values() if r["rated"] and r["roster"] and r["pos"] != "D"]
    assert sum(r["toi_ev_gp"] * (r["ev_off"] - doc["impact"]["position_means"]["F"]["ev_off"]) for r in f) == \
        pytest.approx(0, abs=0.01)
    assert doc["impact"]["goals_per_xg"] == 1.06 and set(doc["units"]) >= {"impact", "off_impact", "def_impact", "sd"}
    with pytest.raises(RuntimeError):
        RE.build_export({k: v for k, v in _v3_bundle().items() if k != "v3"}, None, ROSTER, None)


def test_check_player_ratings_v3(tmp_path):
    import gzip
    import validate_outputs as Vo
    from bu.lineup import ratings_export as RE
    b = _v3_bundle()
    cols = P3.LIVE_COLUMNS
    rng = np.random.default_rng(0)
    b["v3"]["rows"] = [[i, "D" if i % 3 == 0 else "F", True, float(rng.normal(0, .2)), float(rng.normal(0, .1)), 0.01,
                        0.004, 0.0, float(rng.normal(0, .3)), float(rng.normal(0, .2)), 0.04, 0.02, 0.0, 15.0, 1.5, 1.5, ""]
                       for i in range(1, 701)]
    roster = {i: (f"Player {i}", f"T{i % 32:02d}", "D" if i % 3 == 0 else "C") for i in range(1, 701)}
    doc = RE.build_export(b, None, roster, None)
    p, bp = tmp_path / "pr.json", tmp_path / "b.json.gz"
    with gzip.open(bp, "wt") as f:
        json.dump(b, f)
    p.write_text(json.dumps(doc))
    ctx = {"player_ratings_path": str(p), "bu_bundle_path": str(bp)}
    assert Vo.check_player_ratings(ctx) == []
    bad = json.loads(json.dumps(doc))
    bad["rows"][0][bad["columns"].index("impact")] = 99.0
    p.write_text(json.dumps(bad))
    assert any("impact" in e for e in Vo.check_player_ratings(ctx))
    old = json.loads(json.dumps(doc))
    old["version"] = 2
    p.write_text(json.dumps(old))
    assert any("version" in e for e in Vo.check_player_ratings(ctx))
    assert cols[0] == "player_id"


def test_committed_v3_files():
    """The committed site file and ratings pack are v3 and the gate passes on them."""
    import validate_outputs as Vo
    doc = json.load(open(os.path.join(ROOT, "public", "data", "player_ratings.json")))
    assert doc["version"] == 3 and Vo.check_player_ratings({}) == []
    pk = P3.read_pack(P3.pack_path(doc["season"]))
    assert pk is not None and pk["config"]["recency"]["max_games"] <= 246
    assert Recency.from_dict(pk["config"]["recency"]).effective_table()["by_82_game_season_back"]["S-3"] == 0
