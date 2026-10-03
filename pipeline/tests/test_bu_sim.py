"""Game simulator (bu.sim): invariants, determinism, push handling, anchoring, fallback, parsing."""
import json
import math

import numpy as np
import pandas as pd
import pytest

from bu.sim import anchor as AN
from bu.sim import engine as EN
from bu.sim import markets as MK
from bu.sim import rates as RT
from bu.sim.live import COLUMNS, Dist, SimServer, poisson_dist
from bu.sim.params import load_params
from bu.sim.state import SimState, rows_from_season_csvs


@pytest.fixture(scope="module")
def params():
    return load_params()


@pytest.fixture(scope="module")
def S(params):
    return EN.Structure(params["structural"], params.get("dispersion"))


def game(Eh=1.0, Ea=1.0, Ch=1.0, Ca=1.0, so_home=0.5, playoff=False):
    return RT.GameRates(L5=np.array([2.5 / 3600]), Lpp=np.array([7.0 / 3600]), Lpen=np.array([0.0008]),
                        E=np.array([[Eh, Ea]]), C=np.array([[Ch, Ca]]), P=np.ones((1, 2)), Q=np.ones((1, 2)),
                        playoff=np.array([playoff]), so_home=np.array([so_home]))


def test_market_probabilities_sum_to_one(S):
    o = EN.simulate_game(game(1.15, 0.9), 0, S, 20000, 11)
    s = MK.summarize(o)
    assert s["reg_home"] + s["reg_tie"] + s["reg_away"] == pytest.approx(1.0, abs=1e-9)
    assert s["p1_home"] + s["p1_tie"] + s["p1_away"] == pytest.approx(1.0, abs=1e-9)
    for L in MK.TOTAL_LINES:
        k = MK.line_key(L)
        assert s[f"over_{k}"] + s[f"push_{k}"] + s[f"under_{k}"] == pytest.approx(1.0, abs=1e-9)
    assert s["push_5_5"] == 0 and s["push_6_5"] == 0 and s["push_6_0"] > 0.05
    assert s["pl_home_m15"] + s["pl_away_p15"] == pytest.approx(1.0, abs=1e-12)
    assert sum(s["total_hist"]) == pytest.approx(1.0) and sum(s["margin_hist"]) == pytest.approx(1.0)
    # every game has a winner: no ties in the official result, OT / SO only after a regulation tie
    fh, fa = MK.final_scores(o)
    assert np.all(fh != fa)
    assert np.all((o.dec > 0) == (o.hreg == o.areg))
    assert np.all(o.h1 <= o.hreg) and np.all(o.a1 <= o.areg)


def test_identical_teams_are_symmetric(S):
    s = MK.summarize(EN.simulate_game(game(), 0, S, 40000, 5))
    se = math.sqrt(0.25 / 40000)
    assert abs(s["p_home"] - 0.5) < 4 * se
    assert abs(s["reg_home"] - s["reg_away"]) < 6 * se
    assert abs(s["exp_home"] - s["exp_away"]) < 0.05
    assert abs(s["p1_home"] - s["p1_away"]) < 6 * se
    assert abs(s["pl_home_m15"] - s["pl_away_m15"]) < 6 * se


def test_stronger_side_and_mirror(S):
    a = MK.summarize(EN.simulate_game(game(1.2, 0.85), 0, S, 20000, 3))
    b = MK.summarize(EN.simulate_game(game(0.85, 1.2), 0, S, 20000, 3))
    assert a["p_home"] > 0.6 and b["p_home"] < 0.4
    assert a["p_home"] + b["p_home"] == pytest.approx(1.0, abs=0.02)
    assert a["pl_home_m15"] == pytest.approx(b["pl_away_m15"], abs=0.02)


def test_deterministic_with_seed(S):
    o1 = EN.simulate_game(game(1.1, 1.0), 0, S, 5000, 42)
    o2 = EN.simulate_game(game(1.1, 1.0), 0, S, 5000, 42)
    o3 = EN.simulate_game(game(1.1, 1.0), 0, S, 5000, 43)
    for f in ("hg", "ag", "h1", "a1", "hreg", "areg", "dec", "so_home", "en_h", "en_a"):
        assert np.array_equal(getattr(o1, f), getattr(o2, f))
    assert not np.array_equal(o1.hg, o3.hg)
    assert EN.game_seed(1, 2026020017) == EN.game_seed(1, 2026020017) != EN.game_seed(1, 2026020018)


def test_playoff_overtime_has_no_shootout(S):
    o = EN.simulate_game(game(playoff=True), 0, S, 4000, 9)
    assert not np.any(o.dec == 2)
    fh, fa = MK.final_scores(o)
    assert np.all(fh != fa)


def test_reweighting_matches_direct_simulation(S):
    o = EN.simulate_game(game(), 0, S, 40000, 21)
    w = EN.tilt_weights(o, 0.25, 1.06)
    rw = MK.summarize(o, w=w)
    g2 = game().with_anchor(tilt=0.25, pace=1.06)
    d = MK.summarize(EN.simulate_game(g2, 0, S, 40000, 22))
    assert rw["p_home"] == pytest.approx(d["p_home"], abs=0.012)
    assert rw["exp_total"] == pytest.approx(d["exp_total"], abs=0.06)
    assert rw["reg_tie"] == pytest.approx(d["reg_tie"], abs=0.012)


@pytest.mark.parametrize("p_t,t_t", [(0.62, 6.3), (0.41, 5.7), (0.5, 6.0), (0.75, 6.6)])
def test_anchoring_hits_targets(S, p_t, t_t):
    o, w, info = AN.anchor_game(game(1.05, 1.0), 0, S, 20000, 7, p_t, t_t)
    s = MK.summarize(o, w=w)
    assert abs(s["p_home"] - p_t) < 0.002
    assert abs(s["exp_total"] - t_t) < 0.002
    assert info["ess"] > 0.2


def test_push_handling_and_prices():
    # 6.0 total: win 0.45, push 0.12, lose 0.43 at -110
    ev = MK.ev(0.45, -110, 0.43)
    assert ev == pytest.approx(0.45 * (100 / 110) - 0.43)
    assert MK.fair_american(0.45, 0.43) == MK.fair_american(0.45 / 0.88)
    assert MK.fair_american(0.5) == "+100"
    assert MK.american_to_decimal(150) == pytest.approx(2.5)
    assert MK.american_to_decimal(-150) == pytest.approx(1 + 100 / 150)
    assert MK.ev(0.5, None) is None
    dv = MK.devig([-110, -110])
    assert dv == pytest.approx([0.5, 0.5])


def _check_row(row):
    assert row["home_reg_pct"] + row["reg_tie_pct"] + row["away_reg_pct"] == pytest.approx(100.0, abs=1e-9)
    assert row["home_1p_pct"] + row["p1_tie_pct"] + row["away_1p_pct"] == pytest.approx(100.0, abs=1e-9)
    assert row["home_1p_2w_pct"] + row["away_1p_2w_pct"] == pytest.approx(100.0, abs=1e-9)
    assert row["over_pct"] + row["total_push_pct"] + row["under_pct"] == pytest.approx(100.0, abs=1e-9)
    assert row["home_pl_pct"] + row["away_pl_pct"] == pytest.approx(100.0, abs=1e-9)
    assert row["sim_ev_gated"] is False and row["sim_gate_reason"].startswith("INFO ONLY")


ODDS = {"home_ml": -140, "away_ml": 120, "Home_puckline": 190, "Home_puckline_spread": "-1.5",
        "Away_puckline": -230, "Away_puckline_spread": "+1.5", "total_line": "6.0", "total_over": -105,
        "total_under": -115, "Home_three_way": 120, "Away_three_way": 180, "three_way_tie": 310,
        "Home_1p_ml": -130, "Away_1p_ml": 100, "Home_1p_three_way": 168, "Away_1p_three_way": 195,
        "1p_three_way_tie": 172}


def test_poisson_fallback_prices_every_market():
    srv = SimServer({}, None, {})
    row = srv.game(2026020017, "HOM", "AWY", 0.58, 6.1, bf=None, odds=ODDS, home_name="Home", away_name="Away")
    assert set(COLUMNS) <= set(row)
    assert row["sim_status"] == "poisson_fallback"
    _check_row(row)
    for c in ("home_reg_ev", "reg_tie_ev", "away_reg_ev", "home_pl_ev", "away_pl_ev", "over_ev", "under_ev",
              "home_1p_ev", "away_1p_ev", "home_1p3_ev", "p1_tie_ev", "away_1p3_ev"):
        assert row[c] is not None and math.isfinite(row[c])
    assert row["total_push_pct"] > 0                        # whole-number line
    assert json.loads(row["sim_detail"])["fallback_reason"]


def test_simulated_prices_and_anchor(params):
    srv = SimServer(params, SimState(), {"HOM": 1, "AWY": 2})
    S = srv.S
    o, w, _ = AN.anchor_game(game(1.1, 0.95), 0, S, 20000, 3, 0.6, 6.2)
    row = srv.price(Dist(MK.summarize(o, w=w), "sim"), ODDS, "Home", "Away")
    _check_row(row)
    assert row["sim_pl_spread"] == "-1.5" and row["sim_total_line"] == "6.0"


def test_fallback_without_lineup_term(params):
    srv = SimServer(params, SimState(), {"HOM": 1, "AWY": 2})
    row = srv.game(2026020017, "HOM", "AWY", 0.55, 6.0, bf={"bu_ok": False, "reason": "stale bundle"},
                   odds=ODDS, home_name="Home", away_name="Away")
    assert row["sim_status"] == "poisson_fallback"
    assert "stale bundle" in json.loads(row["sim_detail"])["fallback_reason"]


def test_poisson_dist_matches_goal_model():
    import goal_model as GM
    d = poisson_dist(0.6, 6.1)
    assert d.s["p_home"] == pytest.approx(0.6, abs=1e-6)
    lh, la = GM.goal_rates(0.6, 6.1)
    assert d.s["exp_total"] == pytest.approx(sum(GM.expected_goals(lh, la)), abs=0.05)


def test_state_roundtrip_and_live_rows():
    st = SimState()
    gs = pd.DataFrame([
        {"game_id": 2026020001, "game_date": "2026-09-29", "team": "Hurricanes", "opponent": "Panthers",
         "home_away": "Home", "time_5v5": 3000, "time_leading": 1000, "time_trailing": 1000, "time_tied": 1600,
         "pp_time": 240, "pk_time": 120, "pk_opportunities": 2, "pp_opportunities": 3,
         "starting_goalie": "A Goalie", "starting_goalie_opp": "B Goalie"},
        {"game_id": 2026020001, "game_date": "2026-09-29", "team": "Panthers", "opponent": "Hurricanes",
         "home_away": "Away", "time_5v5": 3000, "time_leading": 1000, "time_trailing": 1000, "time_tied": 1600,
         "pp_time": 120, "pk_time": 240, "pk_opportunities": 3, "pp_opportunities": 2,
         "starting_goalie": "B Goalie", "starting_goalie_opp": "A Goalie"}])
    shots = pd.DataFrame([
        {"game_id": 2026020001, "team_id": 12, "period": 1, "strength_state": "5v5", "is_goal": 1, "xg_raw": 0.3},
        {"game_id": 2026020001, "team_id": 13, "period": 2, "strength_state": "5v4", "is_goal": 0, "xg_raw": 0.2}])
    rows = rows_from_season_csvs(gs, shots, {"Hurricanes": 12, "Panthers": 13}, {}, "20262027")
    assert len(rows) == 2
    h = rows[rows["is_home"]].iloc[0]
    assert h["ev_xg"] == pytest.approx(0.3) and h["ev_gf"] == 1 and h["pk_xga"] == pytest.approx(0.2)
    assert h["pen_taken"] == 2 and h["pen_drawn"] == 3
    st.roll("20262027")
    st.add_rows(rows)
    st2 = SimState.from_json(json.loads(json.dumps(st.to_json())))
    assert st2.team_rel(12, "ev_off") == pytest.approx(st.team_rel(12, "ev_off"))
    assert st2.goalie_rel("A Goalie")[0] == pytest.approx(st.goalie_rel("A Goalie")[0])
    st2.goalie_names["agoalie"] = "id:99"
    assert st2.gkey("A Goalie") == "id:99"


def test_bovada_first_period_three_way_parsed():
    import fetch_odds as FO
    ev = {"displayGroups": [
        {"description": "Game Lines", "markets": [
            {"description": "Moneyline", "period": {"abbreviation": "G"}, "outcomes": [
                {"description": "Away Team", "price": {"american": "+110"}},
                {"description": "Home Team", "price": {"american": "-130"}}]},
            {"description": "Moneyline", "period": {"abbreviation": "P1"}, "outcomes": [
                {"description": "Away Team - 1P", "price": {"american": "EVEN"}},
                {"description": "Home Team - 1P", "price": {"american": "-130"}}]}]},
        {"description": "Game Props", "markets": [
            {"description": "3-Way Moneyline", "period": {"abbreviation": "RT"}, "outcomes": [
                {"description": "Away Team - REG", "price": {"american": "+167"}},
                {"description": "Home Team - REG", "price": {"american": "+121"}},
                {"description": "Tie - REG", "price": {"american": "+305"}}]},
            {"description": "3-Way Moneyline", "period": {"abbreviation": "P1"}, "outcomes": [
                {"description": "Away Team - 1P", "price": {"american": "+195"}},
                {"description": "Home Team - 1P", "price": {"american": "+168"}},
                {"description": "Tie - 1P", "price": {"american": "+172"}}]}]}]}
    g = {"id": 2026020017, "gameDate": "2026-10-02", "startTimeUTC": "2026-10-02T22:30:00Z",
         "homeTeam": "Homes", "awayTeam": "Aways", "homeTeamAbbrev": "HOM", "awayTeamAbbrev": "AWY"}
    b = FO.Book(g, "2026-10-02T00:00:00Z")
    FO._parse_bovada_event(b, ev, "Away Team", "Home Team")
    e = b.e
    assert e["Homes_1p_ml"] == -130 and e["Aways_1p_ml"] == 100
    assert e["Homes_three_way"] == 121 and e["three_way_tie"] == 305
    assert e["Homes_1p_three_way"] == 168 and e["Aways_1p_three_way"] == 195 and e["1p_three_way_tie"] == 172


def _sim_row(**over):
    srv = SimServer({}, None, {})
    row = srv.game(2026020017, "HOM", "AWY", 0.58, 6.1, odds=ODDS, home_name="Home", away_name="Away")
    out = {k: ("" if v is None else ("True" if v is True else ("False" if v is False else str(v))))
           for k, v in row.items()}
    out.update({"game_id": "g1", "prediction_status": "pregame", "home_win_pct": "58.0",
                "home_three_way": "120", "away_three_way": "180", "three_way_tie": "310",
                "home_puckline": "190", "away_puckline": "-230", "total_over": "-105", "total_under": "-115",
                "home_1p_ml": "-130", "away_1p_ml": "100", "home_1p_three_way": "168",
                "away_1p_three_way": "195", "p1_three_way_tie": "172"})
    out.update(over)
    return out


def test_validate_sim_markets(tmp_path, monkeypatch):
    import csv
    import validate_outputs as VO
    good = _sim_row()
    bad = _sim_row(game_id="g2", home_reg_pct="60.0", over_ev="", sim_ev_gated="True")
    path = tmp_path / "predictions_detailed.csv"
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(good))
        w.writeheader()
        w.writerow(good)
        w.writerow(bad)
    monkeypatch.setattr(VO, "PRED_FILES", [str(path)])
    errs = VO.check_sim_markets({})
    assert errs and all(" g2:" in e for e in errs)
    assert any("reg3" in e for e in errs) and any("over_ev" in e for e in errs)
    assert any("sim_ev_gated" in e for e in errs)


def test_history_grades_sim_markets():
    import generate_history as GH
    import snapshot_predictions as SP
    row = _sim_row(expected_total="6.1")
    snap = {"p_home": 0.58, "sim_markets": SP.sim_markets(row), "sim_status": "poisson_fallback", "sim_home%": "",
            "home_xg": 3.2, "away_xg": 2.9}
    res = {"home_score": 4, "away_score": 2, "reg_home": 4, "reg_away": 2, "p1_home": 1, "p1_away": 1}
    g = GH.grade_sim_markets(snap, res)
    assert set(g) == {"reg3", "puckline", "total", "p1_3w"}      # tied 1st period: the 2-way is refunded
    assert g["reg3"]["outcome"] == 0 and g["puckline"]["outcome"] == 0     # home won by 2: covers -1.5
    assert g["total"]["outcome"] == 1                                     # 6 goals on a 6.0 line: push
    for m in g.values():
        assert m["ll"] is not None and m["naive_ll"] is not None
    assert g["reg3"]["market_p"] is not None
    assert GH.grade_sim_markets({"p_home": 0.5, "sim_markets": float("nan")}, res) is None


# ---------------------------------------------------------------- win-% engine (prereg_primary.json)

def _sim_inputs_row(**kw):
    row = {"game_type": 2, "lg_ev_goals": 2.5 / 3600, "lg_ev_xg": 2.4 / 3600, "lg_pp_goals": 7.0 / 3600,
           "lg_pp_xg": 6.5 / 3600, "lg_pen": 0.0008, "lg_fin": 1.0, "lg_gsv": 1.0,
           "bu_ok": True, "c_intercept": 2.5, "bu_h_off": 0.15, "bu_h_def": -0.05, "bu_a_off": -0.05,
           "bu_a_def": 0.10, "bu_h_fin": 0.05, "bu_a_fin": -0.02, "h_rest": 2, "a_rest": 1}
    for s, k in (("h", 1.04), ("a", 0.97)):
        for q in ("ev_off", "pp", "take", "fin"):
            row[f"{s}_t_{q}"] = k
        for q in ("ev_def", "pk", "draw"):
            row[f"{s}_t_{q}"] = 2 - k
        row[f"{s}_g_gsv"] = 1.0 if s == "h" else 1.03
    row.update(kw)
    return row


def _sim_run(params, n=4000, gid=2026020099):
    from bu.sim.live import SimRun
    row = _sim_inputs_row()
    R = RT.build_rates(pd.DataFrame([row]), params)
    seed = EN.game_seed(20261002, gid)
    S = EN.Structure(params["structural"], params.get("dispersion"))
    return SimRun(gid, row, R, EN.simulate_game(R, 0, S, n, seed), seed)


def test_breakdown_adds_up_to_the_simulated_win_pct(params):
    from bu.sim.live import DISPLAY_ORDER
    srv = SimServer(params, SimState(), {"HOM": 1, "AWY": 2}, n=4000)
    run = _sim_run(params)
    terms = srv.breakdown(run, n=2000)
    assert [t[0] for t in terms] == DISPLAY_ORDER
    assert sum(t[2] for t in terms) == pytest.approx(RT.logit(run.p_home), abs=1e-9)
    d = {t[0]: t[2] for t in terms}
    assert d["home_ice"] > 0 and d["strength_5v5"] > 0          # home is the stronger lineup
    assert d["rest"] > 0                                         # the away team is on a back-to-back
    # an explicit model probability (after the 3-97% guard) is what the terms add up to
    assert sum(t[2] for t in srv.breakdown(run, 0.6, n=2000)) == pytest.approx(RT.logit(0.6), abs=1e-9)


def test_game_reuses_a_run_and_keeps_the_raw_shadow(params):
    srv = SimServer(params, SimState(), {"HOM": 1, "AWY": 2}, n=4000)
    run = _sim_run(params)
    row = srv.game(2026020099, "HOM", "AWY", 0.55, 6.0, run=run, odds=ODDS, home_name="Home", away_name="Away")
    assert row["sim_status"] == "sim" and row["sim_variant"] == "anchored"
    assert row["sim_home_win_pct"] == round(100 * run.p_home, 1)
    assert json.loads(row["sim_detail"])["anchor"]["p"] == pytest.approx(0.55, abs=0.002)
    fb = srv.game(2026020099, "HOM", "AWY", 0.55, 6.0, run=None, why="lineup term unavailable (x)", odds=ODDS)
    assert fb["sim_status"] == "poisson_fallback"


def test_winpct_mode_switch(monkeypatch):
    import predict_games as P

    class Srv:
        params = {"primary": {"winpct": "sim", "total": "gm"}}
    monkeypatch.delenv("PONYXG_WINPCT", raising=False)
    assert P.winpct_mode(Srv()) == "sim" and P.sim_total_mode(Srv()) == "gm"
    assert P.winpct_mode(None) == "logit"              # nothing promoted: the logit
    monkeypatch.setenv("PONYXG_WINPCT", "logit")       # rollback variable
    assert P.winpct_mode(Srv()) == "logit"
    monkeypatch.setenv("PONYXG_WINPCT", "bogus")
    assert P.winpct_mode(Srv()) == "sim"


def test_lineup_source_is_pluggable(tmp_path, monkeypatch):
    from bu.sim import lineup_source as LS
    from bu.sim import params as PR
    assert LS.spec(None)["name"] == "rapm_v2" and LS.history_inputs_name({}) == "history_inputs.parquet"
    p = {"lineup": {"name": "v4", "history_table": str(tmp_path / "v4.csv")}}
    assert LS.spec(p)["serving_bundle"] == LS.DEFAULT["serving_bundle"]
    assert LS.history_inputs_name(p) == "history_inputs_v4.parquet"
    pd.DataFrame([{**{c: 1 for c in LS.REQUIRED}, "bu_ok": "True", "extra": 3}]).to_csv(tmp_path / "v4.csv",
                                                                                        index=False)
    t = LS.history_table(LS.spec(p))
    assert bool(t["bu_ok"].iloc[0]) and "extra" not in t
    pd.DataFrame([{"game_id": 1}]).to_csv(tmp_path / "bad.csv", index=False)
    with pytest.raises(ValueError):
        LS.history_table(str(tmp_path / "bad.csv"))
    alt = tmp_path / "params.json"
    PR.save_params({"version": "x"}, str(alt))
    monkeypatch.setenv(PR.PARAMS_ENV, str(alt))
    assert PR.load_params()["version"] == "x"


def test_lineup_source_reads_its_own_ratings_table(monkeypatch):
    """The simulator reuses the game model's loaded term only when it reads the same ratings table
    of the bundle (the r4 logit serves v4; a v2-fitted simulator must not get v4 inputs)."""
    from bu.lineup import serve as SV
    from bu.sim import lineup_source as LS
    loads = []

    class Term:
        def __init__(self, ratings):
            self.ratings_source = ratings

    monkeypatch.setattr(SV.LiveLineupTerm, "load", classmethod(lambda cls, path, **kw: loads.append(kw) or
                                                               Term(kw.get("ratings"))))
    path = LS.resolve(LS.DEFAULT["serving_bundle"])
    model_v4 = Term("v4")
    t = LS.live_term(LS.spec(None), {path: model_v4})
    assert t is not model_v4 and t.ratings_source == "v2" and loads == [{"ratings": "v2"}]
    v4 = {"lineup": {"name": "v4", "history_table": "x.csv", "ratings": "v4"}}
    assert LS.live_term(LS.spec(v4), {path: model_v4}) is model_v4 and len(loads) == 1
    assert LS.spec(None)["history_table"].endswith("lineup_features_v2.csv.gz")


def test_sim_inputs_switch(tmp_path, monkeypatch):
    from bu.sim import params as PR
    monkeypatch.delenv(PR.PARAMS_ENV, raising=False)
    monkeypatch.setattr(PR, "OUT_DIR", str(tmp_path))
    (tmp_path / "sim_params_v2.json").write_text("{}")
    monkeypatch.setenv(PR.INPUTS_ENV, "v2")
    assert PR.params_path() == str(tmp_path / "sim_params_v2.json")
    monkeypatch.setenv(PR.INPUTS_ENV, "../etc")            # unknown / unsafe: the default file
    assert PR.params_path() == PR.PARAMS_PATH
    monkeypatch.setenv(PR.PARAMS_ENV, "/x/p.json")         # an explicit file wins
    assert PR.params_path() == "/x/p.json"


def test_committed_sim_params_lineup_source():
    """The committed simulator parameters name their lineup source; a v4 source reads the bundle's
    v4 table and the v2 rollback parameters (then committed) are the RAPM v2 source."""
    import os
    from bu.sim import lineup_source as LS
    from bu.sim import params as PR
    p = load_params(PR.PARAMS_PATH)
    src = LS.spec(p)
    assert src["name"] in ("rapm_v2", "v4") and os.path.exists(LS.resolve(src["history_table"]))
    if src["name"] == "v4":
        assert src["ratings"] == "v4" and p["glm"]["lineup_source"] == "v4"
        p2 = load_params(os.path.join(PR.OUT_DIR, "sim_params_v2.json"))
        assert LS.spec(p2)["name"] == "rapm_v2" and LS.spec(p2)["ratings"] == "v2"
