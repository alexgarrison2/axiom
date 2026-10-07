"""Isolated impact (pipeline/bu/isolate): grid, design shape/symmetry and a synthetic recovery run
(plant one skater's offence and another's defence at known spots, recover both).  No lake needed."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from bu.isolate import grid, model


# ----------------------------------------------------------------------------- grid

def test_raw_cell_bounds_and_clamping():
    c = grid.raw_cell(np.array([0.0, 99.99, -30.0, 150.0, np.nan]), np.array([-42.5, 42.4, 0.0, 0.0, 1.0]))
    assert c[0] == 0
    assert c[1] == grid.K_RAW - 1
    assert c[2] == grid.NY_RAW // 2          # own-half shot clamps onto the centre-line row
    assert c[3] == (grid.NX_RAW - 1) * grid.NY_RAW + grid.NY_RAW // 2
    assert c[4] == -1


def test_smooth_conserves_mass_and_mirrors():
    rng = np.random.default_rng(0)
    raw = np.zeros((3, grid.K_RAW))
    raw[0, 5] = 1.0                           # corner cell next to two boundaries
    raw[1] = rng.normal(size=grid.K_RAW)
    raw[2, grid.raw_cell(np.array([80.0]), np.array([10.0]))[0]] = 2.0
    out = grid.smooth(raw)
    assert out.shape == (3, grid.NX_OUT * grid.NY_OUT)
    np.testing.assert_allclose(out.sum(1), raw.sum(1), atol=1e-9)
    # left/right symmetry: a shot at +y and its mirror at -y give mirrored maps
    a = np.zeros((2, grid.K_RAW))
    a[0, grid.raw_cell(np.array([70.0]), np.array([21.25]))[0]] = 1.0     # raw-cell centres, mirrored
    a[1, grid.raw_cell(np.array([70.0]), np.array([-21.25]))[0]] = 1.0
    m = grid.smooth(a).reshape(2, grid.NX_OUT, grid.NY_OUT)
    np.testing.assert_allclose(m[0], m[1][:, ::-1], atol=1e-12)


def test_quantize_roundtrip():
    v = np.array([0.0, 0.5, -0.5, 10.0, -10.0])
    q = grid.quantize(v, 0.01)
    assert q.dtype == np.int8 and list(q) == [0, 50, -50, 127, -127]
    assert np.array_equal(grid.unb64(grid.b64(q)), q)
    rows = grid.export_rows(np.arange(grid.NX_OUT * grid.NY_OUT, dtype=float)[None, :])
    assert rows.shape == (1, grid.NX_EXPORT * grid.NY_OUT)
    assert rows[0, 0] == grid.IX_SHOW * grid.NY_OUT


# ----------------------------------------------------------------------------- synthetic world

STAR, WALL = 7, 11                 # planted offence (more shots at A) / defence (more shots against at B)
A_XY, B_XY = (75.0, 15.0), (60.0, -20.0)
BASE, PLANT = 40.0, 30.0           # shots per hour


def _world(seed=3, n_stints=6000, dur=60, n_players=30):
    rng = np.random.default_rng(seed)
    st_rows, shots = [], []
    for i in range(n_stints):
        on = rng.choice(n_players, 10, replace=False)
        home, away = sorted(on[:5].tolist()), sorted(on[5:].tolist())
        rec = {"game_id": 1000 + i // 50, "period": 1, "start_s": 0, "end_s": dur, "dur": dur,
               "home_sk": np.array(home), "away_sk": np.array(away), "n_home_sk": 5, "n_away_sk": 5,
               "n_home_g": 1, "n_away_g": 1, "home_diff": 0, "zone_home": "", "xgf_home": 0.0, "xgf_away": 0.0,
               "sh_home": 0, "sh_away": 0}
        for side, att, dfn in (("home", home, away), ("away", away, home)):
            def add(n, xy, spread):
                for _ in range(n):
                    if xy is None:
                        x, y = rng.uniform(30, 89), rng.uniform(-38, 38)
                    else:
                        x, y = rng.normal(xy[0], spread), rng.normal(xy[1], spread)
                    shots.append({"game_id": rec["game_id"], "stint": i, "acting_is_home": side == "home",
                                  "x_norm": x, "y_norm": y, "xg": 0.05, "xg_flurry": 0.05, "is_goal": False,
                                  "shooter_id": att[0], "empty_net_against": False})
                    rec[f"sh_{side}"] += 1
                    rec[f"xgf_{side}"] += 0.05
            add(rng.poisson(BASE * dur / 3600), None, 0)
            if STAR in att:
                add(rng.poisson(PLANT * dur / 3600), A_XY, 3.0)
            if WALL in dfn:
                add(rng.poisson(PLANT * dur / 3600), B_XY, 3.0)
        st_rows.append(rec)
    st = pd.DataFrame(st_rows)
    sh = pd.DataFrame(shots)
    games = sorted(st["game_id"].unique())
    win = model.Window(st, sh, pd.DataFrame(columns=["game_id", "taken_by", "drawn_by", "n"]),
                       pd.DataFrame(columns=["game_id", "player_id", "all", "s5", "pp", "pk"]),
                       pd.DataFrame({"player_id": range(n_players), "position": "C", "full_name": "x"}),
                       {g: 1.0 for g in games}, pd.Timestamp("2026-01-01"), ("20252026",))
    return win


@pytest.fixture(scope="module")
def world():
    return _world()


def test_design_two_symmetric_rows_per_stint(world):
    des = model.build_design(world, "ev")
    n_st = len(world.stints)
    assert des.X.shape == (2 * n_st, 2 * des.n + len(model.EV_COV))
    nnz = np.diff(des.X.indptr)
    home, away = slice(0, n_st), slice(n_st, 2 * n_st)    # home-attacking rows first, then away
    assert (nnz[home] == 5 + 5 + 2).all()     # 5 offence + 5 defence + intercept + home
    assert (nnz[away] == 5 + 5 + 1).all()     # the away-attacking row has no home flag
    X = des.X.toarray()
    n = des.n
    # the two rows of a stint swap the O and D blocks
    np.testing.assert_array_equal(X[home, :n], X[away, n:2 * n])
    np.testing.assert_array_equal(X[home, n:2 * n], X[away, :n])
    np.testing.assert_array_equal(X[home, 2 * n + 1], 1.0)   # home flag
    np.testing.assert_array_equal(X[away, 2 * n + 1], 0.0)
    rows = model.shot_rows(des, world.shots)
    assert (rows >= 0).all()


def test_synthetic_recovery(world):
    fit = model.fit_maps(world, "ev", lam=2000.0, xg_maps=True)
    k = {p: i for i, p in enumerate(fit.players)}
    # shot-rate impacts: planted +30/h, everybody else ~0
    assert fit.o_sh[k[STAR]] == pytest.approx(PLANT, rel=0.25)
    assert fit.d_sh[k[WALL]] == pytest.approx(PLANT, rel=0.25)
    others = [k[p] for p in k if p not in (STAR, WALL)]
    assert np.abs(fit.o_sh[others]).max() < 0.3 * PLANT
    assert np.abs(fit.d_sh[others]).max() < 0.3 * PLANT
    # xG impacts follow (0.05 xG per shot)
    assert fit.o[k[STAR]] == pytest.approx(PLANT * 0.05, rel=0.25)
    # the maps put the effect where it was planted
    def peak(m):
        ix, iy = np.unravel_index(np.argmax(m.reshape(grid.NX_OUT, grid.NY_OUT)), (grid.NX_OUT, grid.NY_OUT))
        return (ix + 0.5) * grid.OUT_FT + grid.X_MIN, (iy + 0.5) * grid.OUT_FT + grid.Y_MIN
    px, py = peak(fit.o_map[k[STAR]])
    assert abs(px - A_XY[0]) <= 5 and abs(py - A_XY[1]) <= 5
    px, py = peak(fit.d_map[k[WALL]])
    assert abs(px - B_XY[0]) <= 5 and abs(py - B_XY[1]) <= 5
    # mass: a map sums to its scalar impact
    np.testing.assert_allclose(fit.o_map.sum(1), fit.o_sh, atol=1e-9)
    # the league rate is the baseline plus the planted share
    assert 40 <= fit.league_sh <= 50


def test_recency_weights_halve_per_half_life():
    d = pd.Series(pd.to_datetime(["2026-01-01", "2025-01-01", "2024-01-01"]))
    w = model.recency(d, pd.Timestamp("2026-01-01"), 365.0)
    assert w[0] == 1.0
    assert w[1] == pytest.approx(0.5, rel=1e-3)
    assert w[2] == pytest.approx(0.25, rel=1e-2)
