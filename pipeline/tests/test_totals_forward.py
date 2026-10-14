"""Totals-anchor forward test (bu/sim/prereg_totals_forward.json): the arms' logging (totals_test),
the market total, the scoring script's pure parts, the decision rule, the snapshot and the validator."""
import csv
import json
import math

import numpy as np
import pandas as pd
import pytest

from bu.sim import anchor as AN
from bu.sim import engine as EN
from bu.sim import markets as MK
from bu.sim import rates as RT
from bu.sim import totals_forward as TF
from bu.sim import totals_test as TT
from bu.sim.live import SimRun, SimServer
from bu.sim.params import load_params
from bu.sim.state import SimState

HIST = [0.0, 0.015, 0.02, 0.11, 0.08, 0.22, 0.11, 0.2, 0.07, 0.1, 0.027, 0.029, 0.01, 0.005, 0.003, 0.001]
ODDS = {"home_ml": -140, "away_ml": 120, "total_line": "6.5", "total_over": 110, "total_under": -130}


@pytest.fixture(scope="module")
def params():
    return load_params()


def _run(params, n=6000, gid=2026020099):
    row = {"game_type": 2, "lg_ev_goals": 2.5 / 3600, "lg_ev_xg": 2.4 / 3600, "lg_pp_goals": 7.0 / 3600,
           "lg_pp_xg": 6.5 / 3600, "lg_pen": 0.0008, "lg_fin": 1.0, "lg_gsv": 1.0, "bu_ok": True,
           "c_intercept": 2.5, "bu_h_off": 0.2, "bu_h_def": -0.1, "bu_a_off": -0.05, "bu_a_def": 0.1,
           "bu_h_fin": 0.05, "bu_a_fin": -0.02, "h_rest": 2, "a_rest": 2}
    for s in "ha":
        for q in ("ev_off", "ev_def", "pp", "pk", "take", "draw", "fin"):
            row[f"{s}_t_{q}"] = 1.0
        row[f"{s}_g_gsv"] = 1.0
    R = RT.build_rates(pd.DataFrame([row]), params)
    S = EN.Structure(params["structural"], params.get("dispersion"))
    seed = EN.game_seed(20261002, gid)
    return SimRun(gid, row, R, EN.simulate_game(R, 0, S, n, seed), seed), S


# ---------------------------------------------------------------- histogram helpers

def test_tilt_and_over_push_under():
    h = np.asarray(HIST) / sum(HIST)
    assert np.allclose(TT.tilt(HIST, 0.0), h)
    assert TT.mean(TT.tilt(HIST, 0.1)) > TT.mean(HIST) > TT.mean(TT.tilt(HIST, -0.1))
    for t in (5.4, 6.0, 6.9):
        assert TT.mean(TT.tilt_to_mean(HIST, t)) == pytest.approx(t, abs=1e-6)
    o, p, u = TT.ou(HIST, 6.5)
    assert p == 0 and o + u == pytest.approx(1.0)
    o, p, u = TT.ou(HIST, 6.0)
    assert p == pytest.approx(h[6]) and o + p + u == pytest.approx(1.0)
    assert TT.over_np(HIST, 6.0) == pytest.approx(o / (o + u))
    with pytest.raises(ValueError):
        TT.ou([1.0] * 5, 6.5)


def test_market_total_reads_the_market_through_the_histogram():
    q0 = TT.over_np(HIST, 6.5)
    t, bound = TT.market_total(HIST, 6.5, q0)            # the histogram's own P(over): its own mean
    assert t == pytest.approx(TT.mean(HIST), abs=1e-6) and not bound
    lo, _ = TT.market_total(HIST, 6.5, q0 - 0.05)
    hi, _ = TT.market_total(HIST, 6.5, q0 + 0.05)
    assert lo < t < hi
    # the tilted histogram at T_mkt reproduces q exactly
    assert TT.over_np(TT.tilt_to_mean(HIST, hi), 6.5) == pytest.approx(q0 + 0.05, abs=1e-6)
    _, bound = TT.market_total(HIST, 6.5, 1.0)
    assert bound


def test_market_q_is_the_power_devig():
    import market
    assert TT.market_q(110, -130) == pytest.approx(market.devig([110, -130])[0])
    assert TT.market_q(-110, -110) == pytest.approx(0.5)
    assert TT.market_q(None, -110) is None and TT.market_q("", "") is None and TT.market_q(5, -110) is None


def test_arm_totals_blend_in_goals():
    t = TT.arm_totals(6.1, 6.7, 5.9)
    assert t == pytest.approx({"gm": 6.1, "sim": 6.7, "blend_gm": 0.8 * 6.1 + 0.2 * 5.9,
                               "blend_sim": 0.8 * 6.7 + 0.2 * 5.9})
    t = TT.arm_totals(6.1, None, None)
    assert t["sim"] is None and t["blend_gm"] is None and t["blend_sim"] is None
    assert TT.arm_totals(6.1, 6.7, None)["sim"] == 6.7


def test_record_round_trip():
    raw = TT.record("sim", 6.5, True, 0.4567891, 6.21234, False,
                    {"gm": {"t": 6.1, "o": 0.45, "p": 0.0, "u": 0.55}})
    d = TT.parse(raw)
    assert d["v"] == 1 and d["q"] == 0.4568 and d["t_mkt"] == 6.2123 and d["arms"]["sim"] is None
    assert TT.parse("") is None and TT.parse("not json") is None and TT.parse('{"v": 2}') is None
    assert TT.parse(TT.record("poisson_fallback"))["arms"] is None


# ---------------------------------------------------------------- live logging

def test_live_record_reanchors_every_arm_exactly(params):
    run, S = _run(params)
    p_pub, t_gm = 0.57, 6.05
    o2, w, _ = AN.anchor_game(run.R, 0, S, run.o.n, run.seed, p_pub, t_gm, o=run.o)
    gm_hist = MK.summarize(o2, w=w)["total_hist"]
    d = TT.parse(TT.live_record(run, S, run.o.n, p_pub, t_gm, gm_hist, ODDS))
    assert d["status"] == "sim" and d["line"] == 6.5 and d["posted"] is True
    assert d["q"] == pytest.approx(TT.market_q(110, -130), abs=1e-4)
    arms = d["arms"]
    assert arms["gm"]["t"] == pytest.approx(t_gm) and arms["sim"]["t"] == pytest.approx(run.total, abs=1e-4)
    assert arms["blend_sim"]["t"] == pytest.approx(0.8 * run.total + 0.2 * d["t_mkt"], abs=2e-4)
    for a in TT.ARMS:
        v = arms[a]
        assert v["o"] + v["p"] + v["u"] == pytest.approx(1.0, abs=2e-4) and v["p"] == 0
    # each arm is the same simulation anchored to (published win %, the arm's total)
    o3, w3, _ = AN.anchor_game(run.R, 0, S, run.o.n, run.seed, p_pub, arms["blend_gm"]["t"], o=run.o)
    assert arms["blend_gm"]["o"] == pytest.approx(TT.ou(MK.summarize(o3, w=w3)["total_hist"], 6.5)[0], abs=1e-4)
    # the dry run's approximation (tilting the GM-anchored histogram) is close to the exact re-anchoring
    for a in ("sim", "blend_gm", "blend_sim"):
        approx = TT.ou(TT.tilt_to_mean(gm_hist, arms[a]["t"]), 6.5)[0]
        assert approx == pytest.approx(arms[a]["o"], abs=0.01)


def test_live_record_without_a_market_or_line(params):
    run, S = _run(params)
    o2, w, _ = AN.anchor_game(run.R, 0, S, run.o.n, run.seed, 0.55, 6.0, o=run.o)
    h = MK.summarize(o2, w=w)["total_hist"]
    d = TT.parse(TT.live_record(run, S, run.o.n, 0.55, 6.0, h, {"total_line": "6.5"}))
    assert d["q"] is None and d["arms"]["blend_gm"] is None and d["arms"]["sim"] is not None
    d = TT.parse(TT.live_record(run, S, run.o.n, 0.55, 6.0, h, {}))
    assert d["line"] == 6.0 and d["posted"] is False and d["arms"]["blend_sim"] is None


def test_sim_server_game_logs_totals_test(params):
    srv = SimServer(params, SimState(), {"HOM": 1, "AWY": 2}, n=4000)
    run, _ = _run(params, n=4000)
    row = srv.game(2026020099, "HOM", "AWY", 0.55, 6.0, run=run, odds=ODDS, home_name="Home", away_name="Away")
    d = TT.parse(row["totals_test"])
    assert d["status"] == "sim"
    # the GM arm is the published total market (fractions vs 1-decimal percentages)
    for k, c in (("o", "over_pct"), ("p", "total_push_pct"), ("u", "under_pct")):
        assert d["arms"]["gm"][k] == pytest.approx(row[c] / 100, abs=0.0006)
    assert d["arms"]["sim"]["t"] == pytest.approx(row["sim_expected_total"], abs=0.006)
    fb = srv.game(2026020099, "HOM", "AWY", 0.55, 6.0, run=None, why="lineup term unavailable (x)", odds=ODDS)
    assert TT.parse(fb["totals_test"])["status"] == "poisson_fallback"


# ---------------------------------------------------------------- scoring

def test_actual_totals_count_the_shootout_goal():
    g = pd.DataFrame({"game_id": [1, 1, 2, 2], "home_away": ["Home", "Away", "Home", "Away"],
                      "goals_for": [3, 3, 4, 2], "goals_ag": [3, 3, 2, 4], "result": ["SOW", "SOL", "RW", "RL"]})
    assert TF.actual_totals(g) == {1: 7, 2: 6}
    assert [TF.outcome(t, 6.0) for t in (7, 6, 5)] == [0, 1, 2]
    assert TF.outcome(6, 6.5) == 2


def test_log_losses_and_recalibration():
    assert TF.ll_binary([0.5], [1])[0] == pytest.approx(math.log(2))
    assert TF.ll_full([0.4], [0.1], [0.5], [1])[0] == pytest.approx(-math.log(0.1))
    rng = np.random.default_rng(0)
    p = rng.uniform(0.3, 0.7, 4000)
    y = (rng.uniform(size=4000) < p).astype(float)
    slope, icpt = TF.recalibration(p, y)
    assert slope == pytest.approx(1.0, abs=0.25) and icpt == pytest.approx(0.0, abs=0.1)
    assert TF.paired([1, 2, 3], [1, 1, 1]) == {"diff": 1.0, "se": pytest.approx(1 / math.sqrt(3), abs=1e-5), "n": 3}


def _synthetic(n=600, seed=1, better="sim"):
    """Games whose true P(over) is known: the 'better' arm is the truth, the others are flat 0.5."""
    rng = np.random.default_rng(seed)
    p_true = rng.uniform(0.3, 0.7, n)
    over = rng.uniform(size=n) < p_true
    rows = []
    for i in range(n):
        r = {"game_id": 2026020200 + i, "start_ts": pd.Timestamp("2026-10-15T23:00Z") + pd.Timedelta(hours=i),
             "line": 6.5, "q": 0.5, "actual": 7 if over[i] else 6, "usable": True}
        for a in TT.ARMS:
            po = p_true[i] if a == better else 0.5
            r.update({f"{a}_t": 6.0 + po, f"{a}_o": po, f"{a}_p": 0.0, f"{a}_u": 1 - po})
        rows.append(r)
    return pd.DataFrame(rows)


def test_score_and_rule():
    sc = TF.score(_synthetic())
    assert sc["n_no_push"] == 600 and sc["n_push"] == 0
    assert sc["vs_gm"]["sim"]["primary"]["diff"] < 0 and sc["vs_gm"]["blend_gm"]["primary"]["diff"] == 0
    dec = TF.decide(sc)
    assert dec == {"pass": {"sim": True, "blend_sim": False, "blend_gm": False}, "choice": "sim"}
    # nothing better than GM: GM stays
    none = TF.decide(TF.score(_synthetic(better="gm")))
    assert none["choice"] == "gm" and not any(none["pass"].values())


def test_rule_tie_break_prefers_the_declared_order():
    df = _synthetic(better="blend_gm")
    for k in "topu":                                   # blend_sim identical to blend_gm: a tie
        df[f"blend_sim_{k}"] = df[f"blend_gm_{k}"]
    dec = TF.decide(TF.score(df))
    assert dec["pass"]["blend_gm"] and dec["pass"]["blend_sim"] and dec["choice"] == "blend_sim"


def test_rule_needs_one_se_and_the_full_outcome():
    sc = {"arms": {a: {"ll_over_no_push": 0.69} for a in TT.ARMS},
          "vs_gm": {a: {"primary": {"diff": 0.0, "se": 0.003, "n": 500}, "full": {"diff": 0.0, "se": 0.003}}
                    for a in TF.CANDIDATES}}
    sc["vs_gm"]["sim"]["primary"]["diff"] = -0.0025               # better, but by less than one SE
    assert not TF.decide(sc)["pass"]["sim"]
    sc["vs_gm"]["sim"]["primary"]["diff"] = -0.0035
    assert TF.decide(sc)["pass"]["sim"]
    sc["vs_gm"]["sim"]["full"]["diff"] = 0.0011                   # worse on the full outcome
    assert not TF.decide(sc)["pass"]["sim"]


def test_decision_set_cut_and_exclusions():
    df = _synthetic(n=30)
    df.loc[2, "line"] = 6.0
    df.loc[2, "actual"] = 6                                        # a push, kept
    df.loc[5, "usable"] = False                                    # no totals_test: not eligible
    since = pd.Timestamp("2026-10-16T01:30Z")                      # the first three games are before it
    dset, counts = TF.decision_set(df, 10, since)
    assert counts["complete"] and counts["push"] == 0              # the push game is pre-declaration
    assert dset["game_id"].min() == 2026020203 and len(dset) == 10 and 2026020205 not in set(dset["game_id"])
    dset, counts = TF.decision_set(df, 40, since)
    assert not counts["complete"] and dset.empty                  # no numbers before the set is complete


def test_dry_run_approximation_of_a_reconstructed_row():
    r = {"sim_status": "sim", "total_line": "6.5", "total_over": "110", "total_under": "-130",
         "expected_total": "6.1", "sim_expected_total": "6.6",
         "sim_detail": json.dumps({"total_hist": HIST})}
    a = TF.approximate_arms(r)
    assert a["gm_t"] == 6.1 and a["sim_t"] == 6.6 and a["sim_o"] > a["gm_o"]
    assert a["gm_o"] == pytest.approx(TT.ou(HIST, 6.5)[0])
    assert TF.approximate_arms({**r, "sim_status": "poisson_fallback"}) is None
    assert TF.approximate_arms({**r, "total_over": ""}) is None


# ---------------------------------------------------------------- snapshot and validator

def test_snapshot_carries_totals_test(tmp_path):
    import datetime as dt
    import snapshot_predictions as SP
    assert SP.FIELDNAMES[-1] == "totals_test"
    rec = TT.record("sim", 6.5, True, 0.45, 6.2, False, {"gm": {"t": 6.1, "o": 0.45, "p": 0.0, "u": 0.55}})
    pred = tmp_path / "p.csv"
    with open(pred, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["nhl_game_id", "game_id", "game_date", "start_time_utc",
                                          "prediction_status", "home_team", "away_team", "home_win_pct",
                                          "totals_test"])
        w.writeheader()
        w.writerow({"nhl_game_id": "2026020300", "game_id": "2026-10-20-A-B", "game_date": "2026-10-20",
                    "start_time_utc": "2026-10-20T23:00:00Z", "prediction_status": "pregame",
                    "home_team": "B", "away_team": "A", "home_win_pct": "55.0", "totals_test": rec})
    hist = tmp_path / "hist"
    SP.snapshot(str(pred), str(hist), now_utc=dt.datetime(2026, 10, 20, 17, 0, tzinfo=dt.timezone.utc))
    rows = list(csv.DictReader(open(hist / "2026-10-20.csv")))
    assert TT.parse(rows[0]["totals_test"])["q"] == 0.45


def test_validator_checks_totals_test(tmp_path):
    import validate_outputs as V
    rec = {"gm": {"t": 6.1, "o": 0.452, "p": 0.0, "u": 0.548}, "sim": {"t": 6.6, "o": 0.5, "p": 0.0, "u": 0.5},
           "blend_gm": {"t": 6.1, "o": 0.45, "p": 0.0, "u": 0.55}, "blend_sim": {"t": 6.5, "o": 0.49, "p": 0.0,
                                                                                 "u": 0.51}}
    base = {"game_id": "g", "prediction_status": "pregame", "sim_status": "sim", "sim_total_line": "6.5",
            "over_pct": "45.2", "total_push_pct": "0.0", "under_pct": "54.8",
            "totals_test": TT.record("sim", 6.5, True, 0.45, 6.0, False, rec)}

    def errs(row):
        path = tmp_path / "p.csv"
        with open(path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(base))
            w.writeheader()
            w.writerow(row)
        return V.check_totals_test({"pred_files": [str(path)]})
    assert errs(base) == []
    bad = dict(rec, gm={"t": 6.1, "o": 0.47, "p": 0.0, "u": 0.53})
    assert "published total market" in errs({**base, "totals_test": TT.record("sim", 6.5, True, 0.45, 6.0, False,
                                                                                bad)})[0]
    assert "missing" in errs({**base, "totals_test": ""})[0]
    assert errs({**base, "prediction_status": "frozen", "totals_test": ""}) == []      # frozen before v2.5
    no_blend = {k: v for k, v in rec.items() if not k.startswith("blend")}
    assert errs({**base, "totals_test": TT.record("sim", 6.5, True, None, None, None, no_blend)}) == []
    assert errs({**base, "sim_status": "poisson_fallback", "totals_test": TT.record("poisson_fallback")}) == []


def test_predict_games_row_logs_totals_test_and_publishes_the_same(tmp_path, monkeypatch):
    """The whole row builder: a simulated pregame row carries totals_test, its arms' totals are the row's
    expected_total / sim_expected_total, the validator passes, and every other column is what a run
    without the logging writes (logging only)."""
    import predict_games as P
    import validate_outputs as V
    from test_winpct_engine import ODDS as ML_ODDS, StubSim, _build
    monkeypatch.delenv("PONYXG_WINPCT", raising=False)
    gid = next(iter(ML_ODDS))
    odds = {gid: dict(ML_ODDS[gid], total_line="6.5", total_over=105, total_under=-125)}
    r = _build(StubSim(), odds=odds)
    d = TT.parse(r["totals_test"])
    assert d["status"] == "sim" and d["posted"] and all(d["arms"][a] for a in TT.ARMS)
    assert d["arms"]["gm"]["t"] == pytest.approx(float(r["expected_total"]), abs=0.006)
    assert d["arms"]["sim"]["t"] == pytest.approx(float(r["sim_expected_total"]), abs=0.006)
    path = tmp_path / "p.csv"
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=P.COLUMNS)
        w.writeheader()
        w.writerow(r)
    assert V.check_totals_test({"pred_files": [str(path)]}) == []
    monkeypatch.setattr(TT, "live_record", lambda *a, **k: "")
    r0 = _build(StubSim(), odds=odds)
    assert r0["totals_test"] == ""
    assert {k: v for k, v in r.items() if k != "totals_test"} == {k: v for k, v in r0.items() if k != "totals_test"}
