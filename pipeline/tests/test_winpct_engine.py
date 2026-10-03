"""The game simulator as the win-% engine (bu/sim/prereg_primary.json, contract v2.3).

* engine 'sim': home_model_win_pct is the simulator's own win %, the factor breakdown rebuilds it,
  the market blend is unchanged and the logit game model is logged in logit_*;
* PONYXG_WINPCT=logit (rollback) or a game the simulator cannot run: the logit publishes;
* validate_outputs 'winpct_engine' and 'model_independent' accept the rows.
"""
import copy
import csv
import json
from datetime import datetime, timezone

import pandas as pd
import pytest

import predict_games as P
import validate_outputs as V
from bu.sim import engine as EN
from bu.sim import rates as RT
from bu.sim.live import SimRun, SimServer
from bu.sim.params import load_params
from bu.sim.state import SimState
from test_season_context import OPENER, StubML, entry, inputs

NOW = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc)
GM = OPENER[3]
ODDS = {str(GM["id"]): {"home_ml": -150, "away_ml": 130, "source": "bovada", "fetched_at": "2026-09-29T11:00:00Z"}}


def _row():
    row = {"game_type": 2, "lg_ev_goals": 2.5 / 3600, "lg_ev_xg": 2.4 / 3600, "lg_pp_goals": 7.0 / 3600,
           "lg_pp_xg": 6.5 / 3600, "lg_pen": 0.0008, "lg_fin": 1.0, "lg_gsv": 1.0, "bu_ok": True,
           "c_intercept": 2.5, "bu_h_off": 0.2, "bu_h_def": -0.1, "bu_a_off": -0.05, "bu_a_def": 0.1,
           "bu_h_fin": 0.05, "bu_a_fin": -0.02, "h_rest": 2, "a_rest": 2}
    for s in "ha":
        for q in ("ev_off", "ev_def", "pp", "pk", "take", "draw", "fin"):
            row[f"{s}_t_{q}"] = 1.0
        row[f"{s}_g_gsv"] = 1.0
    return row


class StubSim(SimServer):
    """A real simulator on a fixed synthetic game (no state pack, no lineup bundle)."""

    def __init__(self, ok=True):
        params = copy.deepcopy(load_params())
        params["primary"] = {"winpct": "sim", "total": "gm"}
        super().__init__(params, SimState(), {}, n=4000)
        self.ok = ok

    def lineup_term(self, loaded=None):
        return None

    def run(self, game_id, home_tri, away_tri, **kw):
        if not self.ok:
            return None, "lineup term unavailable (stub)"
        row = _row()
        R = RT.build_rates(pd.DataFrame([row]), self.params)
        seed = EN.game_seed(20261002, int(game_id))
        return SimRun(game_id, row, R, EN.simulate_game(R, 0, self.S, self.n, seed), seed), None


def _build(sim, odds=ODDS):
    ml = StubML()
    return P.build_rows(inputs(NOW, [entry(GM)], OPENER, odds=odds, ml=ml, sim=sim))[0]


def _validate(tmp_path, row):
    path = tmp_path / "predictions_detailed.csv"
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=P.COLUMNS)
        w.writeheader()
        w.writerow(row)
    ctx = {"pred_files": [str(path)]}
    return V.check_winpct_engine(ctx) + V.check_model_independent(ctx)


def test_sim_engine_publishes_the_simulated_win_pct(tmp_path, monkeypatch):
    monkeypatch.delenv("PONYXG_WINPCT", raising=False)
    r = _build(StubSim())
    assert r["winpct_engine"] == "sim" and r["model_version"].startswith("sim-")
    assert r["sim_status"] == "sim"
    assert float(r["home_model_win_pct"]) == pytest.approx(float(r["sim_home_win_pct"]), abs=0.051)
    assert float(r["home_model_win_pct"]) > 55          # home lineup much stronger
    # the logit is logged, not published
    logit = _build(StubSim(), odds={})
    assert r["logit_model_win_pct"] == logit["logit_model_win_pct"] != r["home_model_win_pct"]
    # market blend unchanged: published % lies between the model and the market
    pm, pq, pp = (float(r[c]) for c in ("home_model_win_pct", "home_vegas_win_pct", "home_win_pct"))
    assert min(pm, pq) - 0.1 <= pp <= max(pm, pq) + 0.1
    factors = [x["factor"] for x in json.loads(r["home_wp_breakdown"])]
    assert factors == ["home_ice", "strength_5v5", "special_teams", "goaltending", "rest", "market"]
    # the derivative markets are anchored to the published %
    assert json.loads(r["sim_detail"])["anchor"]["p"] == pytest.approx(pp / 100, abs=0.002)
    assert _validate(tmp_path, r) == []


def test_rollback_variable_publishes_the_logit(tmp_path, monkeypatch):
    monkeypatch.setenv("PONYXG_WINPCT", "logit")
    r = _build(StubSim())
    assert r["winpct_engine"] == "logit" and r["model_version"] == "stub-v1"
    assert r["home_model_win_pct"] == r["logit_model_win_pct"]
    assert r["sim_status"] == "sim"                  # the simulator still prices the markets
    assert _validate(tmp_path, r) == []


def test_unsimulated_game_falls_back_to_the_logit(tmp_path, monkeypatch):
    monkeypatch.delenv("PONYXG_WINPCT", raising=False)
    r = _build(StubSim(ok=False))
    assert r["winpct_engine"] == "logit" and r["sim_status"] == "poisson_fallback"
    assert r["home_model_win_pct"] == r["logit_model_win_pct"]
    assert "stub" in json.loads(r["sim_detail"])["fallback_reason"]
    assert _validate(tmp_path, r) == []


def test_validator_flags_a_sim_row_that_is_not_the_simulation(tmp_path, monkeypatch):
    monkeypatch.delenv("PONYXG_WINPCT", raising=False)
    r = _build(StubSim())
    r["sim_home_win_pct"] = str(round(float(r["sim_home_win_pct"]) + 5, 1))
    errs = V.check_winpct_engine({"pred_files": [str(_write(tmp_path, r))]})
    assert errs and "simulated %" in errs[0]


def _write(tmp_path, row):
    path = tmp_path / "p.csv"
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=P.COLUMNS)
        w.writeheader()
        w.writerow(row)
    return path
