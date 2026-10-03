"""Sim v2: lineup special teams in the simulator (prereg_st.json) and season projections on the
simulator (prereg_season_sim.json)."""
import json
import math

import numpy as np
import pandas as pd
import pytest

from bu.sim import rates as RT
from bu.sim import season as SE
from bu.sim import st_lineup as ST
from bu.sim.params import load_params


# ------------------------------------------------------------------ player special teams

FB = ST.fallbacks(None, {"F": (0.1, -1.0), "D": (-1.0, 1.0)}, {g: {"ev": 900.0, "pp": 60.0, "pk": 60.0}
                                                                 for g in ("F", "D")}, {"F": (0.7, 0.6), "D": (0.3, 0.6)})


def _lookup(pp_f=0.0, pt=0.6):
    lk = {}
    for i in range(12):
        lk[i] = (pp_f, -1.0, 13.0, 2.0 if i < 6 else 0.5, 1.0 if i >= 6 else 0.0, 0.7, pt)
    for i in range(12, 18):
        lk[i] = (-1.0, 1.0, 20.0, 1.0 if i < 14 else 0.0, 2.0 if i < 16 else 0.5, 0.3, pt)
    return lk, list(range(18)), ["F"] * 12 + ["D"] * 6


def test_aggregate_weights_and_units():
    lk, pids, groups = _lookup()
    a = ST.aggregate(lk, pids, groups, FB)
    tpp = np.array([lk[p][3] for p in pids])
    # PP units: 5 skaters, shares by expected PP minutes
    exp_ppo = 5 * sum(lk[p][0] * lk[p][3] for p in pids) / tpp.sum()
    assert a["ppo"] == pytest.approx(exp_ppo)
    assert a["take"] == pytest.approx(5 * 0.6)          # every skater at 0.6 / 60 -> 3.0 calls / 60
    assert a["n"] == 18 and a["rated"] == 18
    # a better PP forward group raises ppo exactly by 5 x their PP share
    b = ST.aggregate(_lookup(pp_f=0.5)[0], pids, groups, FB)
    f_share = sum(lk[p][3] for p in pids[:12]) / tpp.sum()
    assert b["ppo"] - a["ppo"] == pytest.approx(5 * 0.5 * f_share)
    # too few skaters: unavailable; an unknown skater takes his group's fallback
    assert ST.aggregate(lk, pids[:9], groups[:9], FB) is None
    c = ST.aggregate({}, pids, groups, FB)
    assert c["rated"] == 0 and c["draw"] == pytest.approx(5 * (12 * 0.7 * 17 + 6 * 0.3 * 17) / (18 * 17))


def test_side_frame_features_and_neutral_default():
    g = pd.DataFrame([{"st_ok": True, "st_h_ppo": 0.7, "st_h_pkd": 0.2, "st_h_take": 3.0, "st_h_draw": 2.5,
                       "st_a_ppo": -0.7, "st_a_pkd": -0.4, "st_a_take": 2.5, "st_a_draw": 3.0,
                       "lg_pp_xg": 7.0 / 3600, "lg_pen": 2.9 / 3600},
                      {"st_ok": False, "lg_pp_xg": 7.0 / 3600, "lg_pen": 2.9 / 3600}])
    h, a = ST.side_frame(g, "h"), ST.side_frame(g, "a")
    assert h.loc[0, "lu_ppo"] == pytest.approx(0.1) and h.loc[0, "lu_pkd"] == pytest.approx(-0.4 / 7)
    assert h.loc[0, "lu_take"] == pytest.approx(math.log(3.0 / 2.9))
    assert h.loc[0, "lu_draw"] == pytest.approx(math.log(3.0 / 2.9))      # the opponent's drawn
    assert a.loc[0, "lu_pkd"] == pytest.approx(0.2 / 7)
    assert (h.loc[1] == 0).all() and (a.loc[1] == 0).all()               # no ST row: neutral


def test_parameters_without_st_ignore_the_columns():
    """The live V4 parameters (no player ST terms) give identical rates with or without ST columns;
    the ST design adds exactly the four lineup terms."""
    p = load_params()
    base = {"lg_ev_goals": 2.5 / 3600, "lg_ev_xg": 2.4 / 3600, "lg_pp_goals": 7 / 3600, "lg_pp_xg": 7 / 3600,
            "lg_pen": 2.9 / 3600, "lg_fin": 1.0, "lg_gsv": 1.0, "bu_ok": False, "game_type": 2}
    for s in "ha":
        for q in ("ev_off", "ev_def", "pp", "pk", "take", "draw", "fin"):
            base[f"{s}_t_{q}"] = 1.05 if s == "h" else 0.97
        base[f"{s}_g_gsv"] = 1.0
    with_st = {**base, "st_ok": True, **{f"st_{s}_{f}": v for s in "ha" for f, v in
                                         (("ppo", 1.0), ("pkd", 0.5), ("take", 3.5), ("draw", 2.0))}}
    r0, r1 = RT.build_rates(pd.DataFrame([base]), p), RT.build_rates(pd.DataFrame([with_st]), p)
    if not any(c in p["glm"]["beta"]["pp"] for c in RT.ST_GROUPS["pp"]):
        assert np.allclose(r0.P, r1.P) and np.allclose(r0.Q, r1.Q)
    else:   # an ST parameter set: a better PP and a more penalised side move the rates
        assert not np.allclose(r0.P, r1.P) and not np.allclose(r0.Q, r1.Q)
    assert RT.groups_for(False) == RT.GROUPS
    g = RT.groups_for(True)
    assert g["pp"][-2:] == ["lu_ppo", "lu_pkd"] and g["pen"][-2:] == ["lu_take", "lu_draw"]
    assert g["ev"] == RT.GROUPS["ev"] and g["conv"] == RT.GROUPS["conv"]


def test_lineup_source_merges_the_st_table(tmp_path):
    from bu.sim import lineup_source as LS
    pd.DataFrame([{**{c: 1 for c in LS.REQUIRED}, "bu_ok": "True"}]).to_csv(tmp_path / "v4.csv", index=False)
    pd.DataFrame([{"game_id": 1, "st_ok": "True", "st_h_ppo": 0.5, "st_a_ppo": 0.1, "st_h_pkd": 0, "st_a_pkd": 0,
                   "st_h_take": 3, "st_a_take": 3, "st_h_draw": 3, "st_a_draw": 3, "st_h_n": 18,
                   "st_a_n": 18}]).to_csv(tmp_path / "st.csv", index=False)
    src = {"name": "v4_st", "history_table": str(tmp_path / "v4.csv"), "st_table": str(tmp_path / "st.csv")}
    t = LS.history_table(src)
    assert bool(t["st_ok"].iloc[0]) and t["st_h_ppo"].iloc[0] == 0.5
    assert LS.has_st({"lineup": src}) and LS.has_st(src) and not LS.has_st({"lineup": {"name": "v4"}})
    assert LS.history_inputs_name({"lineup": src}) == "history_inputs_v4_st.parquet"


def test_live_term_adds_side_special_teams():
    from bu.lineup.serve import LiveLineupTerm
    import os
    from bu.sim.lineup_source import resolve
    path = resolve("bu/lineup/out/serving_bundle.json.gz")
    if not os.path.exists(path):
        pytest.skip("no serving bundle")
    t = LiveLineupTerm.load(path, ratings="v4", max_age_h=1e9)
    if t.st_lookup is None:
        pytest.skip("bundle v4 table without special-teams columns")
    team = next(iter(t.teams))
    hist = t.history.get(t.teams[team])
    if not hist:
        pytest.skip("no lineup history")
    pids, groups = hist[-1]
    s = t.side(team, pids, groups)["st"]
    assert set(ST.ST_FIELDS) <= set(s) and 1.0 < s["take"] < 6.0 and 1.0 < s["draw"] < 6.0


# ------------------------------------------------------------------ season projections

def test_typical_lineup_and_roster_guard():
    past = []
    for k in range(10):
        f = list(range(1, 13)) if k < 7 else list(range(1, 12)) + [99]
        d = list(range(20, 26)) if k != 9 else list(range(20, 25)) + [98]
        past.append((f + d, ["F"] * 12 + ["D"] * 6))
    pids, groups = SE.typical_lineup(past)
    assert len(pids) == 18 and groups.count("F") == 12 and groups.count("D") == 6
    assert 12 in pids and 99 not in pids                       # 12 (7 games) beats 99 (3 games)
    assert 25 in pids and 98 not in pids                       # 25: 9 games, 98: 1
    # roster guard: 1 left the team, a new forward 77 tops the forwards up
    cur = ([p for p in pids if p != 1] + [77], [g for p, g in zip(pids, groups) if p != 1] + ["F"])
    p2, g2 = SE.roster_guard(pids, groups, cur)
    assert 1 not in p2 and 77 in p2 and g2.count("F") == 12 and g2.count("D") == 6
    assert SE.roster_guard(pids, groups, None) == (pids, groups)


def test_goalie_mixture():
    rel = {"A": 0.9, "B": 1.2}.get
    assert SE.goalie_gsv(["A"] * 15 + ["B"] * 5, rel) == pytest.approx(math.exp(0.75 * math.log(0.9) + 0.25 * math.log(1.2)))
    assert SE.goalie_gsv([], rel) == 1.0
    assert SE.goalie_gsv(["B"] * 30 + ["A"] * 20, rel) == pytest.approx(0.9)    # the last 20 starts only


def test_outcome_tuple_point_splits():
    r = {"reg_home": 0.42, "reg_tie": 0.22, "reg_away": 0.36, "p_home": 0.54}
    ph, pa, pt, q, p = SE.outcome_tuple(r)
    assert ph == pytest.approx(0.42) and pa == pytest.approx(0.36) and pt == pytest.approx(0.22)
    assert q == pytest.approx(0.12 / 0.22) and p == pytest.approx(0.54)
    assert ph + pa + pt == pytest.approx(1.0)


def _toy_engine(probs, n=4000, seed=7):
    from season_simulator import Engine
    teams = [f"T{i:02d}" for i in range(16)]           # 2 conferences x 2 divisions x 4 teams
    st = {t: {"pts": 0, "rw": 0, "row": 0, "w": 0, "gp": 0, "conference": "EW"[i // 8], "division": "ABCD"[i // 4]}
          for i, t in enumerate(teams)}
    sched = [{"id": 10 + i, "date": f"2026-11-{1 + i % 28:02d}", "home": teams[i % 16], "away": teams[(i * 7 + 3) % 16]}
             for i in range(40) if i % 16 != (i * 7 + 3) % 16]
    return Engine(st, sched, probs, n_sims=n, seed=seed, sigma0=0.0)


def test_standings_points_from_the_simulated_splits():
    """Every game hands out 2 points plus 1 for an OT / SO loser: with the simulator's regulation
    tie probability the expected points per game are 2 + P(tie), and a team's expected points
    follow its regulation / OT win splits."""
    t = (0.40, 0.35, 0.25, 0.6, 0.40 + 0.25 * 0.6)
    table = {}
    eng0 = _toy_engine(type("P", (), {"game": lambda self, *a: t})())
    for g in eng0.schedule:
        table[(g["home"], g["away"], g["date"], None, None)] = t
    probs = SE.SimProbabilities(table, source="test")
    eng = _toy_engine(probs, n=20000)
    pts, rw, row, w = eng.season()
    per_game = pts.sum(axis=1).mean() / len(eng.schedule)
    assert per_game == pytest.approx(2 + 0.25, abs=0.01)
    assert rw.sum(axis=1).mean() / len(eng.schedule) == pytest.approx(0.75, abs=0.01)


def test_sim_probabilities_fallback_and_series():
    t = (0.45, 0.33, 0.22, 0.55, 0.571)

    class Logit:
        source = "logit"

        def game(self, *a):
            return (0.4, 0.4, 0.2, 0.5, 0.5)
    sched = [{"id": 1, "date": "2026-11-01", "home": "AAA", "away": "BBB"},
             {"id": 2, "date": "2026-11-02", "home": "BBB", "away": "AAA"}]
    sp = SE.SimProbabilities({("AAA", "BBB", "2026-11-01", None, None): t}, Logit(), schedule=sched)
    assert sp.game("AAA", "BBB", "2026-11-01") == t
    assert sp.game("BBB", "AAA", "2026-11-02", 1, 1) == (0.4, 0.4, 0.2, 0.5, 0.5) and sp.n_fallback == 1
    p = sp.game("AAA", "BBB", "2027-04-20")[4]                  # a playoff game: Bradley-Terry
    assert p == pytest.approx(0.571, abs=1e-6)


def test_season_projection_is_deterministic():
    t = (0.45, 0.33, 0.22, 0.55, 0.571)
    eng0 = _toy_engine(type("P", (), {"game": lambda self, *a: t})())
    table = {(g["home"], g["away"], g["date"], None, None): t for g in eng0.schedule}
    a = _toy_engine(SE.SimProbabilities(table), n=500).run(playoffs=False)
    b = _toy_engine(SE.SimProbabilities(table), n=500).run(playoffs=False)
    assert np.array_equal(a["pts"], b["pts"]) and np.array_equal(a["made"], b["made"])


def test_season_mode_switch(monkeypatch):
    monkeypatch.delenv(SE.ENV, raising=False)
    assert SE.mode({}) == "logit"
    assert SE.mode({"season_sim": {"engine": "sim"}}) == "sim"
    monkeypatch.setenv(SE.ENV, "logit")
    assert SE.mode({"season_sim": {"engine": "sim"}}) == "logit"
    monkeypatch.setenv(SE.ENV, "sim")
    assert SE.mode({}) == "sim"


def test_simulated_game_rows_are_runnable_and_consistent():
    """Two teams' inputs -> a rate row the simulator runs; the per-game probabilities are a valid
    regulation / OT split and a stronger home lineup wins more often (determinism by game id)."""
    from bu.sim.state import SimState
    p = load_params()
    st = SimState(p["state"]["hyper"])
    side = lambda off, dfn: {"off": off, "def": dfn, "fin": 0.0,  # noqa: E731
                             "st": {"ppo": 0.0, "pkd": 0.0, "take": 2.9, "draw": 2.9}}
    st.league.update({"ev_gf": 2.5, "ev_xg": 2.4, "ev_adj": 3600.0, "pp_gf": 7.0, "pp_xg": 7.0, "pp_s": 3600.0,
                      "pen_taken": 2.9, "game_s": 3600.0, "gf_vg": 1.0, "xg_vg": 1.0, "ga_og": 1.0, "xga_og": 1.0})
    teams = {"AAA": SE.team_inputs(st, 1, 1.0, side(0.3, -0.2), 2.5), "BBB": SE.team_inputs(st, 2, 1.0, side(-0.2, 0.2), 2.5)}
    league = {q: st.league_rate(q) for q in ("ev_goals", "ev_xg", "pp_goals", "pp_xg", "pen", "fin", "gsv")}
    sched = [{"id": 2026029001, "date": "2026-11-01", "home": "AAA", "away": "BBB"},
             {"id": 2026029002, "date": "2026-11-02", "home": "BBB", "away": "AAA"}]
    G = SE.game_rows(sched, teams, league, {2026029001: (None, None), 2026029002: (1, None)})
    assert SE.runnable(G).all()
    res = SE.simulate(G, p, n=3000, workers=1)
    res2 = SE.simulate(G, p, n=3000, workers=1)
    assert res.equals(res2)
    r = res.set_index("game_id")
    assert (r[["reg_home", "reg_tie", "reg_away"]].sum(axis=1) - 1).abs().max() < 1e-9
    assert r.loc[2026029001, "p_home"] > 0.5 > r.loc[2026029002, "p_home"]
    for _, x in r.iterrows():
        ph, pa, pt, q, pw = SE.outcome_tuple(x)
        assert 0 < pt < 0.4 and 0.05 <= q <= 0.95 and ph + pt * q == pytest.approx(pw)


def test_check_season_projections(tmp_path, monkeypatch):
    import validate_outputs as Vo
    from season import SEASON_ID
    monkeypatch.delenv(SE.ENV, raising=False)
    teams = [{"team": f"T{i:02d}", "make_playoffs_pct": 50.0, "point_dist": {"90": 60, "92": 40}}
             for i in range(32)]
    doc = {"season_id": SEASON_ID, "total_simulations": 100, "games_played": 0, "remaining_games": 1312,
           "generated_at": "2026-10-03T12:00:00Z", "model": {"engine": "logit"}, "teams": teams}
    p = tmp_path / "sp.json"
    p.write_text(json.dumps(doc))
    assert Vo.check_season_projections({"season_projections_path": str(p)}) == []
    teams[0]["point_dist"] = {"90": 99}
    teams[1]["make_playoffs_pct"] = 60.0
    p.write_text(json.dumps(doc))
    errs = Vo.check_season_projections({"season_projections_path": str(p)})
    assert any("point_dist" in e for e in errs) and any("1600" in e for e in errs)


def test_committed_st_parameters_are_opt_in():
    """The player special-teams parameters are committed with their decision and their history
    table; the live parameters record the season_sim decision."""
    import os
    from bu.sim import lineup_source as LS
    from bu.sim import params as PR
    st = load_params(os.path.join(PR.OUT_DIR, "sim_params_st.json"))
    assert LS.has_st(st) and os.path.exists(LS.resolve(st["lineup"]["st_table"]))
    assert all(c in st["glm"]["beta"]["pp"] for c in RT.ST_GROUPS["pp"])
    assert st["decision"]["question"] == "sim_player_st"
    live = load_params(PR.PARAMS_PATH)
    assert (live.get("season_sim") or {}).get("engine") in ("sim", "logit")
