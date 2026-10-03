"""Season-level calibration of the simulator's season projections (prereg_season_calib.json)."""
import json
import math
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from bu.sim import season as SE  # noqa: E402
from bu.sim import season_calib as SC  # noqa: E402


def _logit(p):
    return math.log(p / (1 - p))


def _table():
    return {("AAA", "BBB", "2026-10-10", None, None): (0.48, 0.30, 0.22, 0.6, 0.48 + 0.22 * 0.6),
            ("BBB", "AAA", "2027-03-10", 2, 1): (0.25, 0.54, 0.21, 0.4, 0.25 + 0.21 * 0.4),
            ("CCC", "AAA", "2026-12-01", None, 3): (0.40, 0.38, 0.22, 0.55, 0.40 + 0.22 * 0.55)}


def test_calibrate_table_identity_and_shrink():
    t = _table()
    assert SE.calibrate_table(t, "2026-10-07", SE.CAL_IDENTITY) == t
    cal = {**SE.CAL_IDENTITY, "k_inf": 0.5, "tau_days": 60.0}
    c = SE.calibrate_table(t, "2026-10-07", cal)
    z0 = np.mean([_logit(v[4]) for v in t.values()])
    for k, v in c.items():
        ph, pa, pt, q, p = v
        assert ph >= 0 and pa >= 0 and ph + pa + pt == pytest.approx(1.0)
        assert ph + pt * q == pytest.approx(p)
        d = (np.datetime64(k[2]) - np.datetime64("2026-10-07")).astype(int)
        kk = 0.5 + 0.5 * math.exp(-d / 60.0)
        assert _logit(p) - z0 == pytest.approx(kk * (_logit(t[k][4]) - z0))
        assert pt == pytest.approx(t[k][2])          # the tie probability is kept
    # constant shrink (tau 0): every game by k_inf
    c0 = SE.calibrate_table(t, "2026-10-07", {**SE.CAL_IDENTITY, "k_inf": 0.5})
    for k, v in c0.items():
        assert _logit(v[4]) - z0 == pytest.approx(0.5 * (_logit(t[k][4]) - z0))


def test_lineup_scale_and_game_rows():
    sched = [{"id": 1, "date": "2026-10-07", "home": "AAA", "away": "BBB"},
             {"id": 2, "date": "2027-02-04", "home": "BBB", "away": "AAA"}]
    assert SE.lineup_scale(sched, "2026-10-07", SE.CAL_IDENTITY) is None
    w = SE.lineup_scale(sched, "2026-10-07", {**SE.CAL_IDENTITY, "lineup_w_inf": 0.5, "lineup_tau_days": 60.0})
    assert w[1] == pytest.approx(1.0) and w[2] == pytest.approx(0.5 + 0.5 * math.exp(-120 / 60))
    from bu.sim.state import SimState
    from bu.sim.params import load_params
    st = SimState(load_params()["state"]["hyper"])
    side = lambda off, dfn: {"off": off, "def": dfn, "fin": 0.1}  # noqa: E731
    teams = {"AAA": SE.team_inputs(st, 1, 1.0, side(0.3, -0.2), 2.5), "BBB": SE.team_inputs(st, 2, 1.0, side(-0.2, 0.2), 2.5)}
    league = {q: 1.0 for q in ("ev_goals", "ev_xg", "pp_goals", "pp_xg", "pen", "fin", "gsv")}
    rest = {1: (None, None), 2: (None, None)}
    G0 = SE.game_rows(sched, teams, league, rest).set_index("game_id")
    G1 = SE.game_rows(sched, teams, league, rest, w).set_index("game_id")
    for c in ("bu_h_off", "bu_h_def", "bu_a_off", "bu_a_def"):
        assert G1.loc[2, c] == pytest.approx(w[2] * G0.loc[2, c]) and G1.loc[1, c] == pytest.approx(G0.loc[1, c])
    assert G1.loc[2, "bu_h_fin"] == G0.loc[2, "bu_h_fin"]


def _toy(probs, n=600, sigma0=None):
    from season_simulator import Engine
    teams = [f"T{i:02d}" for i in range(16)]
    st = {t: {"pts": 0, "rw": 0, "row": 0, "w": 0, "gp": 0, "conference": "EW"[i // 8], "division": "ABCD"[i // 4]}
          for i, t in enumerate(teams)}
    sched = [{"id": 10 + i, "date": f"2026-11-{1 + i % 28:02d}", "home": teams[i % 16], "away": teams[(i * 7 + 3) % 16]}
             for i in range(60) if i % 16 != (i * 7 + 3) % 16]
    return Engine(st, sched, probs, n_sims=n, seed=11, sigma0=sigma0)


def test_engine_takes_the_calibrated_sigma():
    import season_simulator as SS
    t = (0.45, 0.33, 0.22, 0.55, 0.571)
    flat = type("P", (), {"game": lambda self, *a: t})()
    assert _toy(flat).sigma0 == SS.SIGMA0
    sp = SE.SimProbabilities({}, flat, sigma0=0.1)
    assert _toy(sp).sigma0 == 0.1
    assert _toy(sp, sigma0=0.0).sigma0 == 0.0        # an explicit sigma wins
    assert _toy(SE.SimProbabilities({}, flat, sigma0=0.0)).sigma0 == 0.0


def test_fast_playoff_field_matches_engine():
    class P:
        def game(self, h, a, *x):
            p = 0.35 + 0.3 * ((int(h[1:]) * 7 + int(a[1:]) * 3) % 16) / 16
            return (p - 0.22 * 0.5, 1 - p - 0.22 * 0.5, 0.22, 0.5, p)
    eng = _toy(P(), sigma0=0.3)
    r = eng.run(playoffs=False)
    pts, rw, row, w = eng.season()
    assert np.array_equal(SC.fast_made(eng, pts, rw, row, w).sum(axis=0), r["made"])


def test_calibration_from_params_and_grid():
    assert SE.calibration({}) == SE.CAL_IDENTITY
    c = SE.calibration({"season_sim": {"calibration": {"k_inf": 0.6, "sigma0": 0.1, "junk": 1}}})
    assert c["k_inf"] == 0.6 and c["sigma0"] == 0.1 and "junk" not in c and c["lineup_w_inf"] == 1.0
    cands = SC.candidates()
    assert len(cands) == 348 and len({SC.cid(x) for x in cands}) == 348
    assert SC.knobs({"k_inf": 1.0, "tau_days": 0.0, "sigma0": 0.2, "lineup_w_inf": 1.0}) == 0


def test_prereg_is_declared():
    p = os.path.join(os.path.dirname(SE.__file__), "prereg_season_calib.json")
    d = json.load(open(p))
    assert d["question"].startswith(SC.QUESTION)
    assert set(d["tuning"]["seasons_and_points"]) == set(SC.TUNE)
    assert d["as_of_points"]["dev"] == SC.DEV and d["as_of_points"]["holdout"] == SC.HOLDOUT
