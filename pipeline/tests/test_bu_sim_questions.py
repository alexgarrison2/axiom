"""Simulator questions sim_goalie_mix / sim_pull_asof: the per-run starter mixture (off by default,
exact when degenerate), stratified assignment, the conditional-logit start model, as-of tables."""
import numpy as np
import pandas as pd
import pytest

from bu.sim import engine as EN
from bu.sim import goalie_mix as GM
from bu.sim import pull_asof as PA
from bu.sim import rates as RT
from bu.sim.params import load_params

FIELDS = ("hg", "ag", "h1", "a1", "hreg", "areg", "dec", "so_home", "en_h", "en_a")


@pytest.fixture(scope="module")
def params():
    return load_params()


@pytest.fixture(scope="module")
def S(params):
    return EN.Structure(params["structural"], params.get("dispersion"))


def game(Ch=1.0, Ca=1.0, gmix=None):
    return RT.GameRates(L5=np.array([2.5 / 3600]), Lpp=np.array([7.0 / 3600]), Lpen=np.array([0.0008]),
                        E=np.array([[1.05, 0.95]]), C=np.array([[Ch, Ca]]), P=np.ones((1, 2)), Q=np.ones((1, 2)),
                        playoff=np.array([False]), so_home=np.array([0.5]),
                        gmix=None if gmix is None else np.array([gmix], dtype=object))


def same(o1, o2):
    return all(np.array_equal(getattr(o1, f), getattr(o2, f)) for f in FIELDS)


def test_no_mixture_is_bit_identical(S):
    a = EN.simulate_game(game(1.02, 0.97), 0, S, 4000, 7)
    b = EN.simulate_game(game(1.02, 0.97, gmix=None), 0, S, 4000, 7)
    assert same(a, b)
    g = game(1.02, 0.97)
    g.gmix = np.array([None], dtype=object)
    assert same(a, EN.simulate_game(g, 0, S, 4000, 7))


def test_degenerate_mixture_equals_single_starter(S):
    gm = {"w_home": np.array([1.0]), "C_away": np.array([0.97]), "w_away": np.array([1.0]), "C_home": np.array([1.02])}
    a = EN.simulate_game(game(1.02, 0.97), 0, S, 4000, 7)
    b = EN.simulate_game(game(1.02, 0.97, gmix=gm), 0, S, 4000, 7)
    assert same(a, b)


def test_mixture_moves_toward_weaker_goalie(S):
    # the away side's candidates: a much worse goalie (home C 1.3) with weight 0.5
    gm = {"w_home": np.array([1.0]), "C_away": np.array([1.0]), "w_away": np.array([0.5, 0.5]),
          "C_home": np.array([1.0, 1.3])}
    p0 = (lambda o: np.mean(o.hg + (o.so_home == 1) > o.ag + (o.so_home == -1)))
    a = p0(EN.simulate_game(game(), 0, S, 20000, 3))
    b = p0(EN.simulate_game(game(gmix=gm), 0, S, 20000, 3))
    c = p0(EN.simulate_game(game(Ch=1.3), 0, S, 20000, 3))
    assert a < b < c


def test_stratified_assignment_counts():
    rng = np.random.Generator(np.random.PCG64(1))
    k = EN.stratified_assign([0.62, 0.3, 0.08], 1000, rng)
    assert np.bincount(k).tolist() == [620, 300, 80]
    k = EN.stratified_assign([1, 1, 1], 10, rng)
    assert sorted(np.bincount(k).tolist()) == [3, 3, 4]


def test_build_rates_mixture(params):
    G = pd.DataFrame([{"lg_ev_goals": 2.5 / 3600, "lg_pp_goals": 7 / 3600, "lg_pen": 8e-4, "game_type": 2,
                       **{f"{s}_t_{q}": 1.0 for s in "ha" for q in ("ev_off", "ev_def", "pp", "pk", "take", "draw", "fin")},
                       "h_g_gsv": 1.0, "a_g_gsv": 1.0, "bu_ok": False}])
    R0 = RT.build_rates(G, params)
    assert R0.gmix is None
    G["a_g_mix"] = [[(0.7, 1.0), (0.3, 1.1)]]
    R = RT.build_rates(G, params)
    gm = R.gmix[0]
    b = params["glm"]["beta"]["conv"]["gsv"] * params["dispersion"].get("stretch", 1.0)
    assert gm["C_home"][0] == pytest.approx(R0.C[0, 0])
    assert gm["C_home"][1] == pytest.approx(R0.C[0, 0] * 1.1 ** b)
    assert list(gm["w_away"]) == pytest.approx([0.7, 0.3]) and list(gm["C_away"]) == pytest.approx([R0.C[0, 1]])
    assert R.subset([0]).gmix[0] is gm and R.with_anchor(tilt=0.1).gmix[0]["C_home"][1] == gm["C_home"][1]


def test_start_model_recovers_regular_starter():
    # synthetic team: goalie 1 starts except the 2nd of back-to-backs
    rows, d = [], pd.Timestamp("2018-10-01")
    for j in range(300):
        b2b = j % 4 == 1
        d = d + pd.Timedelta(days=1 if b2b else 2)
        rows.append({"game_id": j, "team_id": 10, "season": "20182019", "game_type": 2, "game_date": d,
                     "goalie": 2.0 if b2b else 1.0})
    c = GM.candidate_table(pd.DataFrame(rows))
    sm = GM.fit_start_model(c)
    assert sm["argmax_accuracy"] > 0.95 and sm["beta"]["prev_b2b"] < 0


def test_live_mixture_rules(monkeypatch):
    beta = {"s10": 3.0, "s3": 1.0, "prev": 0.5, "prev_b2b": -2.0, "sea": 1.0, "gap": -0.3}
    starts = [(f"2026-10-{d:02d}", "A" if d % 3 else "B") for d in range(1, 13)]
    # confirmed or no history: the projected goalie as is
    assert GM.live_mixture("A", True, starts, "2026-10-14", beta) == "A"
    assert GM.live_mixture("A", False, [], "2026-10-14", beta) == "A"
    mix = GM.live_mixture("A", False, starts, "2026-10-14", beta)
    assert mix[0] == ("A", GM.Q_PROJECTED) and sum(w for _, w in mix) == pytest.approx(1.0)
    assert {g for g, _ in mix} == {"A", "B"}
    none = GM.live_mixture(None, False, starts, "2026-10-14", beta)
    assert sum(w for _, w in none) == pytest.approx(1.0) and dict(none)["A"] > dict(none)["B"]
    monkeypatch.delenv(GM.LIVE_FLAG, raising=False)
    assert not GM.live_enabled()
    monkeypatch.setenv(GM.LIVE_FLAG, "on")
    assert GM.live_enabled()


def test_prior_seasons():
    assert PA.prior_seasons("20252026") == ["20232024", "20242025"]
    assert PA.prior_seasons("20232024") == ["20212022", "20222023"]
