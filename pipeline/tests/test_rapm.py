"""RAPM v2 + lineup term (pipeline/bu/rapm, pipeline/bu/lineup): unit tests and a synthetic
end-to-end run on a tiny fake lake (no network, no real lake needed)."""
from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd
import pytest

from bu.lake.build import write_table
from bu.lake.paths import Lake
from bu.rapm import asof as A
from bu.rapm.design import COVARIATES, Index, design_matrix, stint_rows
from bu.rapm.engine import LAG_DAYS
from bu.rapm.paths import RapmPaths
from bu.rapm.priors import Chain, Hyper, RookieModel
from bu.rapm.ridge import Gram
from bu.rapm.stints import _game_stints, ev_mask
from bu.rapm.xg import flurry_adjust


# ----------------------------------------------------------------------------- units

def test_flurry_adjust():
    df = pd.DataFrame({"game_id": [1, 1, 1, 1], "shooting_team_id": [7, 7, 7, 7],
                       "game_seconds": [10, 12, 14, 30], "sort_order": [1, 2, 3, 4], "xg": [0.2, 0.5, 0.1, 0.3]})
    out = flurry_adjust(df)
    assert out[0] == pytest.approx(0.2)
    assert out[1] == pytest.approx(0.5 * 0.8)
    assert out[2] == pytest.approx(0.1 * 0.8 * 0.5)
    assert out[3] == pytest.approx(0.3)          # 16 s gap: new flurry


def _shift(pid, team, period, st, en, goalie=False):
    return {"player_id": pid, "team_id": team, "period": period, "start_s": st, "end_s": en, "is_goalie": goalie}


def test_game_stints_boundaries_score_zone():
    H, Aw = 1, 2
    sh = [_shift(100 + k, H, 1, 0, 60) for k in range(5)] + [_shift(100 + k, H, 1, 60, 120) for k in range(5, 10)]
    sh += [_shift(200 + k, Aw, 1, 0, 120) for k in range(5)]
    sh += [_shift(190, H, 1, 0, 120, True), _shift(290, Aw, 1, 0, 120, True)]
    sh = pd.DataFrame(sh)
    fo = pd.DataFrame({"period": [1, 1], "period_seconds": [0, 60], "zone_code": ["N", "O"], "event_team_id": [H, Aw]})
    goals = pd.DataFrame({"period": [1], "period_seconds": [60], "is_home": [True]})
    shots = pd.DataFrame({"period": [1, 1, 1], "period_seconds": [30, 60, 90], "acting_is_home": [True, True, False],
                          "xg": [0.1, 0.3, 0.2], "xg_flurry": [0.1, 0.3, 0.2], "is_goal": [0.0, 1.0, 0.0]})
    rows = _game_stints(5, sh, fo, goals, shots, H, Aw)
    assert [(r["start_s"], r["end_s"]) for r in rows] == [(0, 60), (60, 120)]
    a, b = rows
    assert a["home_sk"] == [100, 101, 102, 103, 104] and b["home_sk"] == [105, 106, 107, 108, 109]
    # the goal at t=60 belongs to the stint ending at 60 (players whose shift ends at t)
    assert a["g_home"] == 1 and a["xg_home"] == pytest.approx(0.4) and b["xg_away"] == pytest.approx(0.2)
    # score changes for the stint starting at the goal; the faceoff at 60 opens stint b
    assert a["home_diff"] == 0 and b["home_diff"] == 1
    # away won an O-zone draw => home D-zone start
    assert a["zone_home"] == "N" and b["zone_home"] == "D"
    assert a["n_home_g"] == 1 and a["n_away_g"] == 1


def _stint_frame():
    return pd.DataFrame({
        "game_id": [9, 9], "season": ["20232024"] * 2, "game_date": ["2023-10-10"] * 2, "period": [1, 3],
        "dur": [30, 60], "home_sk": [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5]], "away_sk": [[6, 7, 8, 9, 10]] * 2,
        "n_home_sk": [5, 5], "n_away_sk": [5, 5], "home_diff": [0, 2], "zone_home": ["O", ""],
        "xgf_home": [0.1, 0.0], "xgf_away": [0.0, 0.2], "home_team_id": [1, 1], "away_team_id": [2, 2]})


def test_stint_rows_two_rows_and_covariates():
    r = stint_rows(_stint_frame(), {(9, 2): 1})
    assert len(r) == 4
    assert r.att[0] == [1, 2, 3, 4, 5] and r.dfn[0] == [6, 7, 8, 9, 10]
    assert r.att[1] == [6, 7, 8, 9, 10]
    assert r.y[0] == pytest.approx(0.1 * 3600 / 30) and r.w[0] == 30
    c = dict(zip(COVARIATES, r.cov[0]))
    assert c["home"] == 1 and c["zone_O"] == 1 and c["b2b_def"] == 1 and c["b2b_att"] == 0
    c1 = dict(zip(COVARIATES, r.cov[1]))
    assert c1["home"] == 0 and c1["zone_D"] == 1 and c1["b2b_att"] == 1
    c3 = dict(zip(COVARIATES, r.cov[3]))      # away attacking, down 2 in period 3
    assert c3["score_m2"] == 1 and c3["p3_trail"] == 1
    idx = Index.from_rows(r)
    X = design_matrix(r, idx).toarray()
    assert X[0, idx.o(idx.pos[1])] == 1 and X[0, idx.d(idx.pos[6])] == 1 and X[0, idx.o(idx.pos[6])] == 0


def test_ridge_recovers_and_prior_pulls():
    rng = np.random.default_rng(0)
    n, p = 4000, 6
    X = (rng.random((n, p)) < 0.4).astype(float)
    beta = np.array([1.0, -0.5, 0.25, 0.0, 2.0, -1.0])
    y = X @ beta + rng.normal(0, 0.1, n)
    w = rng.uniform(1, 3, n)
    import scipy.sparse as sp
    g = Gram(p)
    g.add(sp.csr_matrix(X[:1500]), y[:1500], w[:1500])
    g.add(sp.csr_matrix(X[1500:]), y[1500:], w[1500:])
    full = Gram(p)
    full.add(sp.csr_matrix(X), y, w)
    assert np.allclose(g.G, full.G) and np.allclose(g.r, full.r)
    b, inv = g.solve(np.full(p, 1e-6), np.zeros(p), want_inv=True)
    assert np.allclose(b, beta, atol=0.02)
    assert (inv > 0).all()
    b0 = np.full(p, 7.0)
    bp, _ = Gram(p).solve(np.ones(p), b0)       # no data: the posterior is the prior mean
    assert np.allclose(bp, b0)


def test_chain_prior_roll_forward():
    players = pd.DataFrame({"player_id": [1, 2, 3], "birth_date": ["1990-01-01", "2004-01-01", "1999-01-01"],
                            "pos_group": ["F", "F", "D"], "draft_overall": [5.0, np.nan, 40.0],
                            "first_season": [20102011, 20232024, 20202021]})
    h = Hyper(v_new=0.02, kappa=2.0, young_old_extra=0.5, use_aging=False)
    c = Chain(h)
    idx0 = Index([1, 3])
    b = np.zeros(idx0.p)
    b[idx0.o(0)], b[idx0.d(0)] = 0.3, -0.1
    c.update("20222023", idx0, b, np.full(idx0.p, 1e-6), 1000.0, pd.Series({1: 5000.0, 3: 0.0}))
    assert 3 not in c.state                     # no EV time: nothing to carry
    rk = RookieModel(means={("F", "all", "o"): -0.05, ("F", "all", "d"): 0.02})
    idx = Index([1, 2, 3])
    b0, lam, is_new = c.prior("20232024", idx, players, None, rk)
    k1 = idx.pos[1]
    assert b0[idx.o(k1)] == pytest.approx(0.3) and b0[idx.d(k1)] == pytest.approx(-0.1)
    # var0 = kappa * var_post (+ age extra for age >= 33: player 1 is 34) capped at v_new
    var1 = 1000.0 / lam[idx.o(k1)]
    assert var1 == pytest.approx(min(2.0 * 1000.0 * 1e-6 + 0.5 * 0.02, 0.02))
    k2 = idx.pos[2]
    assert is_new[k2] and b0[idx.o(k2)] == pytest.approx(-0.05)
    assert 1000.0 / lam[idx.o(k2)] == pytest.approx(0.02)
    assert lam[2 * idx.n] < 1e-3                 # intercept unpenalised


# ------------------------------------------------------------ synthetic end to end

TEAMS = (1, 2, 3, 4)


def _players(team):
    return ([team * 100 + k for k in range(12)], [team * 100 + k for k in range(12, 18)], team * 100 + 18)


def _make_game(gid, season, date, home, away, rng, strength):
    shifts, events, shots = [], [], []
    eid = 0
    for period in (1, 2, 3):
        for team, (fl, fd), ph in ((home, (45, 50), 0), (away, (40, 55), 7)):
            F, D, G = _players(team)
            shifts.append(_shift(G, team, period, 0, 1200, True))
            t, line = 0, 0
            while t < 1200:
                e = min(1200, t + fl - (ph if t == 0 else 0))
                for p in F[3 * (line % 4): 3 * (line % 4) + 3]:
                    shifts.append(_shift(p, team, period, t, e))
                t, line = e, line + 1
            t, pair = 0, 0
            while t < 1200:
                e = min(1200, t + fd)
                for p in D[2 * (pair % 3): 2 * (pair % 3) + 2]:
                    shifts.append(_shift(p, team, period, t, e))
                t, pair = e, pair + 1
        eid += 1
        events.append({"event_id": eid, "period": period, "period_seconds": 0, "type_code": 502, "zone_code": "N",
                       "event_team_id": home})
        for t in range(13, 1200, 23):
            eid += 1
            att = home if rng.random() < strength[home] / (strength[home] + strength[away]) else away
            events.append({"event_id": eid, "period": period, "period_seconds": t, "type_code": 506,
                           "zone_code": "O", "event_team_id": att})
            shots.append({"event_id": eid, "period": period, "period_seconds": t, "team": att,
                          "xg": float(rng.uniform(0.02, 0.2))})
    ev = pd.DataFrame(events)
    ev["game_id"], ev["season"], ev["period_type"] = gid, season, "REG"
    ev["sort_order"] = ev["event_id"]
    ev["game_seconds"] = (ev["period"] - 1) * 1200 + ev["period_seconds"]
    sh = pd.DataFrame(shifts)
    sh["game_id"], sh["season"] = gid, season
    s = pd.DataFrame(shots)
    s = pd.DataFrame({
        "game_id": gid, "season": season, "event_id": s["event_id"], "sort_order": s["event_id"],
        "period": s["period"], "period_type": "REG", "period_seconds": s["period_seconds"],
        "game_seconds": (s["period"] - 1) * 1200 + s["period_seconds"], "type_code": 506, "is_goal": False,
        "is_unblocked": True, "shooting_team_id": s["team"], "acting_is_home": s["team"] == home,
        "shooter_id": s["team"] * 100, "shot_type": "wrist", "x": 70.0, "y": 0.0, "home_score": 0, "away_score": 0,
        "strength": "5v5", "empty_net_against": False, "is_penalty_shot": False, "onice_rule": "primary",
        "xg": s["xg"]})
    lu = []
    for team in (home, away):
        F, D, G = _players(team)
        for p in F:
            lu.append((team, p, "C", False))
        for p in D:
            lu.append((team, p, "D", False))
        lu.append((team, G, "G", True))
    lu = pd.DataFrame(lu, columns=["team_id", "player_id", "position", "is_goalie"])
    lu["game_id"], lu["season"], lu["status"] = gid, season, "dressed"
    game = {"game_id": gid, "season": season, "game_date": date, "game_type": 2, "home_team_id": home,
            "away_team_id": away, "home_abbrev": f"T{home}", "away_abbrev": f"T{away}", "has_shifts": True}
    return game, sh, ev, s, lu


@pytest.fixture(scope="module")
def synth(tmp_path_factory):
    root = tmp_path_factory.mktemp("lake")
    lake = Lake(str(root))
    rng = np.random.default_rng(3)
    strength = {1: 1.6, 2: 1.0, 3: 0.8, 4: 0.6}
    xg_rows = []
    gid = 0
    seasons = ["20222023", "20232024"]
    for season in seasons:
        y = int(season[:4])
        tabs = {k: [] for k in ("games", "shifts", "events", "shots", "lineups")}
        for day in range(12):
            date = str((pd.Timestamp(f"{y}-10-10") + pd.Timedelta(days=2 * day)).date())
            for home, away in (((1, 2), (3, 4)) if day % 2 == 0 else ((1, 3), (2, 4))):
                gid += 1
                g, sh, ev, s, lu = _make_game(y * 1000000 + 20000 + gid, season, date, home, away, rng, strength)
                tabs["games"].append(pd.DataFrame([g]))
                tabs["shifts"].append(sh)
                tabs["events"].append(ev)
                xg_rows.append(s[["game_id", "event_id", "xg"]])
                tabs["shots"].append(s.drop(columns="xg"))
                tabs["lineups"].append(lu)
        for t, frames in tabs.items():
            write_table(pd.concat(frames, ignore_index=True), lake.table_path(t, season))
    xg_path = root / "xg.parquet"
    pd.concat(xg_rows, ignore_index=True).to_parquet(xg_path)
    paths = RapmPaths(lake)
    pl = []
    for team in TEAMS:
        F, D, G = _players(team)
        pl += [(p, "1995-06-01", "C", "F", 10.0, 20152016) for p in F]
        pl += [(p, "1996-06-01", "D", "D", np.nan, 20152016) for p in D]
    players = pd.DataFrame(pl, columns=["player_id", "birth_date", "position", "pos_group", "draft_overall",
                                        "first_season"])
    players.to_parquet(paths.players(), index=False)
    return lake, paths, players, seasons, str(xg_path)


def test_synthetic_end_to_end_point_in_time(synth):
    lake, paths, players, seasons, xg_path = synth
    from bu.rapm.data import ensure_stints
    st = ensure_stints(paths, seasons[0], xg_path)
    assert len(st) and ev_mask(st).all()
    shots = pd.read_parquet(xg_path)
    s0 = shots[shots["game_id"].astype(str).str.startswith("2022")]
    assert st["xg_home"].sum() + st["xg_away"].sum() == pytest.approx(s0["xg"].sum())
    assert (st["n_home_sk"] == 5).all() and (st["n_away_sk"] == 5).all()

    summ = A.run(paths, seasons, players, Hyper(v_new=0.02, kappa=2.0), source=xg_path, log=lambda *a: None)
    assert set(summ["seasons"]) == set(seasons)
    r = A.load_ratings(paths, seasons)
    r["asof"] = pd.to_datetime(r["asof"])
    src = pd.to_datetime(r["max_source_date"])
    # leakage contract: a rating as of d uses only games dated <= d - LAG_DAYS
    assert (src.isna() | (src <= r["asof"] - pd.Timedelta(days=LAG_DAYS))).all()
    first = r[r["asof"] == r["asof"].min()]
    assert first["max_source_date"].isna().all()
    # the carried prior: season 2's first-date ratings equal season 1's posterior (no aging fit yet:
    # only one earlier season, so the curve is empty)
    post = pd.read_parquet(paths.posterior(seasons[0])).set_index("player_id")
    s2 = r[(r["season"] == seasons[1])]
    s2_first = s2[s2["asof"] == s2["asof"].min()].set_index("player_id")
    common = s2_first.index.intersection(post.index)
    assert len(common) > 50
    assert np.allclose(s2_first.loc[common, "o"], post.loc[common, "o"], atol=1e-9)
    # the strong team's skaters end up with better net ratings than the weak team's
    last = s2[s2["asof"] == s2["asof"].max()].set_index("player_id")
    net = last["o"] - last["d"]
    strong = net[[p for p in net.index if p // 100 == 1]].mean()
    weak = net[[p for p in net.index if p // 100 == 4]].mean()
    assert strong > weak

    from bu.lineup.features import build
    F = build(paths, seasons, log=lambda *a: None)
    assert len(F) == 48
    assert (pd.to_datetime(F["max_source_date"].dropna())
            <= pd.to_datetime(F.loc[F["max_source_date"].notna(), "game_date"]) - pd.Timedelta(days=LAG_DAYS)).all()
    assert F["bu_h_n"].eq(18).all() and F.loc[F["season"] == seasons[1], "bu_ok"].all()
    assert not F["bu_ok"].iloc[0]                 # opening day of the first season: nobody rated yet
    # same dressed lineup every game => the baseline-relative delta is exactly neutral
    assert np.allclose(F["bu_d_delta"].fillna(0), 0, atol=1e-9)
    late = F[F["season"] == seasons[1]]
    t1 = late[(late["home_team_id"] == 1)]
    assert (t1["bu_d_net"] > 0).mean() > 0.5
    tv = F.attrs["toi_validation"]["pooled"]
    assert tv["n"] > 0 and np.isfinite(tv["ewma_mae"]) and np.isfinite(tv["last_game_mae"])


def test_validation_summary_selects_on_tuning_only():
    from bu.rapm import validate as V
    rng = np.random.default_rng(1)
    rows = []
    good, bad = "v0.02_k1.5_y0.25_a1_r1", "v0.04_k6_y0.25_a1_r1"
    models = {"const": 1.0, "team|18000": 0.9, "flat|36000": 0.8, f"rapm|{good}": 0.5, f"prior_only|{good}": 0.7,
              f"rapm|{bad}": 0.6, f"prior_only|{bad}": 0.75, f"rapm|{good.replace('_a1_', '_a0_')}": 0.4}
    for S in ("2021", "2022", "2023"):
        for g in range(200):
            noise = rng.normal(0, 0.05)
            for m, lvl in models.items():
                rows.append((S, "2021-11-01", m, g, (lvl + noise) * 100, 100.0))
    pg = pd.DataFrame(rows, columns=["season", "asof", "model", "game_id", "sse", "sw"])
    hypers = {good: Hyper(0.02, 1.5), bad: Hyper(0.04, 6.0)}
    s = V.summarize({"per_game": pg, "hypers": hypers}, ["2021", "2022"], ["2023"], ["2021", "2022", "2023"])
    assert s["selected"]["rapm"] == f"rapm|{good}"           # ablations are never selected
    assert s["stability"]["within_one_step"]
    assert s["gate"]["pass"] and s["folds"]["2023"]["role"] == "dev"
    assert s["folds"]["2023"]["rapm_vs"]["team"]["delta_mse"] == pytest.approx(-0.4)
    assert good.replace("_a1_", "_a0_") in s["ablations"]


def test_degraded_availability(monkeypatch):
    from bu.rapm.engine import DEGRADE_ENV, avail_dates
    gids = np.arange(2023020001, 2023021001)
    dates = np.full(len(gids), np.datetime64("2023-11-01"))
    assert (avail_dates(gids, dates) == dates).all()
    monkeypatch.setenv(DEGRADE_ENV, "0.35:2")
    a = avail_dates(gids, dates)
    late = a > dates
    assert 0.30 < late.mean() < 0.40
    assert ((a - dates)[late] == np.timedelta64(2, "D")).all()
    assert (avail_dates(gids, dates) == a).all()        # deterministic


def test_attach_coverage_gate_neutral():
    from bu.lineup.evaluate import attach
    M = pd.DataFrame({"game_id": [1, 2, 3], "season": [2023] * 3})
    feats = pd.DataFrame({"game_id": [1, 2], "bu_ok": [True, False], "bu_d_net": [0.4, 0.9]})
    out = attach(M, feats, ["bu_d_net"]).set_index("game_id")
    assert out.loc[1, "bu_d_net"] == 0.4
    assert out.loc[2, "bu_d_net"] == 0.0          # under the coverage gate: neutral
    assert out.loc[3, "bu_d_net"] == 0.0 and bool(out.loc[3, "bu_missing"])


def test_published_reports_are_consistent():
    """The committed reports (if present) carry the walk-forward numbers the commit claims."""
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    p = os.path.join(here, "bu", "rapm", "out", "rapm_validation.json")
    if not os.path.exists(p):
        pytest.skip("no committed validation report")
    rep = json.load(open(p))
    assert rep["selected"]["rapm"].endswith("_a1_r1")
    for s in rep["dev_seasons"]:
        f = rep["folds"][s]
        assert f["role"] == "dev"
        assert f["rapm_beats_all"] == all(f["rapm_vs"][b]["delta_mse"] < 0 for b in ("team", "flat", "prior_only"))
    assert rep["gate"]["pass"] == all(rep["folds"][s]["rapm_beats_all"] for s in rep["dev_seasons"])
    assert all(s < min(rep["dev_seasons"]) for s in rep["tune_seasons"])


def test_aging_step_uses_last_seasons_age():
    """The aging curve maps age in season S-1 to rating(S) - rating(S-1), so a returning
    player's prior steps from his age last season (and once per skipped season)."""
    from bu.rapm.aging import AgingCurve
    curve = AgingCurve(coef={("F", "o"): [0.0, 0.01, 0.0], ("F", "d"): [0.0, 0.0, 0.0],
                             ("D", "o"): [0.0, 0.0, 0.0], ("D", "d"): [0.0, 0.0, 0.0]})
    players = pd.DataFrame({"player_id": [1, 2], "birth_date": ["1996-02-01", "1996-02-01"],
                            "pos_group": ["F", "F"], "draft_overall": [5.0, 5.0], "first_season": [20152016] * 2})
    c = Chain(Hyper(v_new=0.02, kappa=1.5, use_aging=True))
    idx0 = Index([1])
    c.update("20232024", idx0, np.zeros(idx0.p), np.full(idx0.p, 1e-6), 1000.0, pd.Series({1: 5000.0}))
    idx1 = Index([2])
    c.update("20222023", idx1, np.zeros(idx1.p), np.full(idx1.p, 1e-6), 1000.0, pd.Series({2: 5000.0}))
    idx = Index([1, 2])
    b0, _, _ = c.prior("20242025", idx, players, curve, None)
    # age on 1 Feb 2025 is 29.0, so last season's age is 28 (= PEAK + 1): one step of 0.01 * 1
    assert b0[idx.o(idx.pos[1])] == pytest.approx(0.01, abs=1e-4)
    # two seasons since his last rating: steps at ages 28 and 27 (0.01 + 0.0)
    assert b0[idx.o(idx.pos[2])] == pytest.approx(0.01, abs=1e-4)


def test_sigma2_not_taken_from_a_tiny_season():
    c = Chain(Hyper())
    idx = Index([1])
    c.update("20262027", idx, np.zeros(idx.p), np.full(idx.p, 1e-6), 0.0, pd.Series({1: 60.0}), n_rows=40)
    assert c.sigma2 == pytest.approx(1160.0)
    assert c.state[1][2] == pytest.approx(1160.0 * 1e-6)


def _mini_lake(root, n_games_second):
    """Season 1: 8 game days; season 2: ``n_games_second`` games (0 = one game whose shift chart
    has not arrived: PBP, lineups and shots only)."""
    lake = Lake(str(root))
    rng = np.random.default_rng(5)
    strength = {1: 1.4, 2: 1.0, 3: 0.9, 4: 0.7}
    xg_rows, gid = [], 0
    seasons = ["20242025", "20252026"]
    for si, season in enumerate(seasons):
        y = int(season[:4])
        tabs = {k: [] for k in ("games", "shifts", "events", "shots", "lineups")}
        n_days = 8 if si == 0 else max(n_games_second, 1)
        for day in range(n_days):
            date = str((pd.Timestamp(f"{y}-10-10") + pd.Timedelta(days=2 * day)).date())
            pairs = ((1, 2), (3, 4)) if si == 0 else ((1, 2),)
            for home, away in pairs:
                gid += 1
                g, sh, ev, s, lu = _make_game(y * 1000000 + 20000 + gid, season, date, home, away, rng, strength)
                tabs["games"].append(pd.DataFrame([g]))
                if si == 1 and n_games_second == 0:
                    g["has_shifts"] = False      # PBP is in (lineups, shots), the shift chart is not yet
                else:
                    tabs["shifts"].append(sh)
                tabs["events"].append(ev)
                xg_rows.append(s[["game_id", "event_id", "xg"]])
                tabs["shots"].append(s.drop(columns="xg"))
                tabs["lineups"].append(lu)
        for t, frames in tabs.items():
            if frames:
                write_table(pd.concat(frames, ignore_index=True), lake.table_path(t, season))
    xg_path = root / "xg.parquet"
    pd.concat(xg_rows, ignore_index=True).to_parquet(xg_path)
    paths = RapmPaths(lake)
    pl = []
    for team in TEAMS:
        F, D, G = _players(team)
        pl += [(p, "1995-06-01", "C", "F", 10.0, 20152016) for p in F]
        pl += [(p, "1996-06-01", "D", "D", np.nan, 20152016) for p in D]
    players = pd.DataFrame(pl, columns=["player_id", "birth_date", "position", "pos_group", "draft_overall",
                                        "first_season"])
    players.to_parquet(paths.players(), index=False)
    return lake, paths, players, seasons, str(xg_path)


@pytest.mark.parametrize("n_games_second", [0, 1])
def test_season_in_progress_zero_or_one_game(tmp_path, n_games_second):
    """Opening week: the new season has no shift data yet (0) or a single game (1).  Ratings
    fall back to the carried prior, sigma2 is kept from the last full season and the lineup
    features still come out finite and point-in-time."""
    lake, paths, players, seasons, xg_path = _mini_lake(tmp_path, n_games_second)
    summ = A.run(paths, seasons, players, Hyper(v_new=0.02, kappa=2.0), source=xg_path, log=lambda *a: None)
    s1 = summ["seasons"][seasons[0]]["sigma2"]
    assert np.isfinite(s1) and s1 > 0
    post = pd.read_parquet(paths.posterior(seasons[1]))
    assert np.isfinite(post[["o", "d", "o_var", "d_var"]].to_numpy()).all()
    assert (post["o_var"] > 0).all()
    from bu.lineup.features import build
    F = build(paths, seasons, log=lambda *a: None)
    new = F[F["season"] == seasons[1]]
    assert len(new) == 1
    row = new.iloc[0]
    assert row["bu_h_n"] == 18 and row["bu_ok"]          # carried posteriors cover the dressed 18
    assert np.isfinite(row["bu_d_net"]) and np.isfinite(row["bu_h_xgf60"])
    assert row["max_source_date"] is None or pd.isna(row["max_source_date"]) \
        or pd.Timestamp(row["max_source_date"]) <= pd.Timestamp(row["game_date"]) - pd.Timedelta(days=LAG_DAYS)
