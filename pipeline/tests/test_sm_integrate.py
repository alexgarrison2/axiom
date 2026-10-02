"""Ship of xG v2 + the RAPM v2 lineup term (sm-integrate): v1 rollback inputs, BU feature
merge, the PONYXG_BU switch, shadow columns, bundle publish rule, validate check, workflows."""
import gzip
import json
import os
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE = os.path.dirname(HERE)
ROOT = os.path.dirname(PIPELINE)


# ── features: xG inputs ──────────────────────────────────────────────────────

def _shots(**cols):
    base = {"game_id": [2026020001] * 3, "event_id": [1, 2, 3], "is_goal": [0, 1, 0]}
    base.update(cols)
    return pd.DataFrame(base)


def test_file_xg_v1_prefers_the_rollback_column(monkeypatch):
    import features as F
    monkeypatch.setattr(F, "_score_v1_pickle", lambda s, d: pd.Series(0.5, index=s.index))
    s = _shots(xg_raw=[0.2, 0.3, 0.4], xg_raw_v2=[0.2, 0.3, 0.4], xg_raw_v1=[0.1, np.nan, 0.05])
    out = F._file_xg(s, PIPELINE, "v1")
    assert out.tolist() == [0.1, 0.5, 0.05]          # NaN v1 shadow -> pickle
    assert F._file_xg(s, PIPELINE, "live").tolist() == [0.2, 0.3, 0.4]


def test_file_xg_v1_shadow_mode_file_and_history_file(monkeypatch):
    import features as F
    monkeypatch.setattr(F, "_score_v1_pickle", lambda s, d: pd.Series(0.9, index=s.index))
    shadow_file = _shots(xg_raw=[0.11, 0.12, 0.13], xg_raw_v2=[0.2, 0.3, 0.4])   # xg_raw is v1 there
    assert F._file_xg(shadow_file, PIPELINE, "v1").tolist() == [0.11, 0.12, 0.13]
    history_file = _shots(xg_raw=[0.2, 0.3, 0.4])                                # history: xg_raw is v2
    assert F._file_xg(history_file, PIPELINE, "v1").tolist() == [0.9, 0.9, 0.9]


def test_history_xg_version(tmp_path):
    import features as F
    assert F.history_xg_version(str(tmp_path)) == "v1"
    (tmp_path / "nhl_historical_shots.csv").write_text("game_id,event_id,xg_raw\n1,1,0.1\n")
    assert F.history_xg_version(str(tmp_path)) == "v2"
    (tmp_path / "nhl_historical_shots.csv").write_text("game_id,event_id\n1,1\n")
    assert F.history_xg_version(str(tmp_path)) == "v1"


def test_dedupe_keeps_distinct_shots_with_equal_xg():
    import features as F
    s = pd.DataFrame({"game_id": [1, 1, 1, 1], "event_id": [10, 11, 12, 10], "team_id": [5, 5, 5, 5],
                      "strength_state": ["5v5"] * 4, "is_goal": [0, 0, 0, 0], "xg_raw_": [0.05, 0.05, 0.07, 0.05]})
    assert len(F._dedupe_shots(s)) == 3                 # event 10 twice (two files) -> once
    assert len(F._dedupe_shots(s, "legacy")) == 2       # the old rule also merged event 11 into 10


def test_v1_and_live_inputs_share_games_and_goals():
    import features as F
    v1 = F.raw_team_game_xg(PIPELINE, use_cache=False, xg="v1")
    live = F.raw_team_game_xg(PIPELINE, use_cache=False)
    m = v1.merge(live, on=["game_id", "team"], suffixes=("_v1", "_live"))
    assert len(m) == len(live) == len(v1)
    assert (m["gf_noen_v1"] == m["gf_noen_live"]).all()


# ── training: BU features ────────────────────────────────────────────────────

def test_attach_bu_features_neutral_policy(tmp_path):
    import train_game_model as T
    p = tmp_path / "lf.csv.gz"
    pd.DataFrame({"game_id": [1, 2, 3], "bu_ok": [True, False, True], "bu_d_net": [0.5, 0.7, np.nan],
                  "bu_d_delta": [0.1, 0.2, 0.3], "other": [9, 9, 9]}).to_csv(p, index=False)
    M = pd.DataFrame({"game_id": [1, 2, 3, 4], "bu_d_net": [5.0] * 4})
    out = T.attach_bu_features(M, str(p)).set_index("game_id")
    assert out.loc[1, "bu_d_net"] == 0.5 and out.loc[1, "bu_d_delta"] == 0.1 and out.loc[1, "bu_ok"]
    assert out.loc[2, "bu_d_net"] == 0.0 and out.loc[2, "bu_d_delta"] == 0.0 and not out.loc[2, "bu_ok"]
    assert out.loc[3, "bu_d_net"] == 0.0 and out.loc[3, "bu_d_delta"] == 0.3
    assert out.loc[4, "bu_d_net"] == 0.0 and not out.loc[4, "bu_ok"]
    assert "other" not in out.columns
    assert (out["bu_d_fin"] == 0).all()                # a table built before bu_d_fin: neutral
    missing = T.attach_bu_features(M, str(tmp_path / "nope.csv.gz"))
    assert (missing["bu_d_net"] == 0).all() and not missing["bu_ok"].any()
    pd.DataFrame({"game_id": [1, 2], "bu_ok": [True, False], "bu_d_net": [0.5, 0.7], "bu_d_delta": [0.1, 0.2],
                  "bu_d_fin": [0.03, 0.04]}).to_csv(p, index=False)
    out = T.attach_bu_features(M, str(p)).set_index("game_id")
    assert out.loc[1, "bu_d_fin"] == 0.03 and out.loc[2, "bu_d_fin"] == 0.0   # coverage gate: neutral


def test_evaluate_attach_replaces_existing_columns():
    from bu.lineup.evaluate import attach
    M = pd.DataFrame({"game_id": [1, 2], "bu_d_net": [9.0, 9.0], "bu_ok": [True, True]})
    f = pd.DataFrame({"game_id": [1, 2], "bu_ok": [True, False], "bu_d_net": [0.4, 0.6]})
    out = attach(M, f, ["bu_d_net"])
    assert out["bu_d_net"].tolist() == [0.4, 0.0]
    assert not any(c.endswith(("_x", "_y")) for c in out.columns)


def test_joint_checks_binding_rules():
    import retrain as R
    row = {"vs_live": {"pooled": {"delta": -0.001, "boot_ci95": [-0.002, 0.0]},
                       "per_fold": {"2023": {"delta": 0.0007}, "2024": {"delta": -0.002}, "2025": {"delta": -0.001}}},
           "calibration_pooled": {"slope": 1.02, "ci95": [0.9, 1.14]}}
    folds = {s: {"log_loss": 0.66, "home_rate_baseline": {"log_loss": 0.69}, "calibration_slope": 0.95}
             for s in (2023, 2024, 2025)}
    ok, checks = R.joint_checks(row, folds)
    assert ok                                         # a fold above +0.0005 is reported, not binding
    assert any(not c["binding"] and not c["passed"] for c in checks)
    row["vs_live"]["pooled"]["delta"] = 0.0002
    assert not R.joint_checks(row, folds)[0]


# ── serving: switch, shadows ─────────────────────────────────────────────────

@pytest.mark.parametrize("val,expect", [(None, "on"), ("", "on"), ("on", "on"), ("OFF", "off"),
                                        ("shadow", "shadow"), ("nofin", "nofin"), ("bogus", "on")])
def test_bu_mode(monkeypatch, val, expect):
    import ml_predict as MP
    if val is None:
        monkeypatch.delenv("PONYXG_BU", raising=False)
    else:
        monkeypatch.setenv("PONYXG_BU", val)
    assert MP.bu_mode() == expect


def test_term_groups_route_the_bu_columns():
    import ml_predict as MP
    groups = {k: cols for k, _, cols in MP.TERM_GROUPS if cols}
    assert "bu_d_net" in groups["strength_5v5"] and "bu_d_fin" in groups["strength_5v5"]
    assert "bu_d_delta" in groups["lineup_goalie"]


def test_model_version_tags():
    import train_game_model as T
    d = datetime(2026, 10, 2, tzinfo=timezone.utc)
    base = ["d_elo", "bu_d_net", "bu_d_delta"]
    assert T.model_version(d, base, "v2") == "logit-elo-v5-20261002-xg2-rapm"
    assert T.model_version(d, base + ["bu_d_fin"], "v2") == "logit-elo-v5-20261002-xg2-rapm-fin"
    assert T.model_version(d, ["d_elo"], "v1") == "logit-elo-v5-20261002"


class _FakeML:
    available = True
    uses_bu = True
    uses_lineups = False

    def __init__(self, p_on, p_off):
        self.p_on, self.p_off, self.calls = p_on, p_off, []

    def predict_detail(self, home, away, gd, extra_features=None, **kw):
        self.calls.append(extra_features)
        on = bool(extra_features) and any(v for v in extra_features.values())
        return {"home_win_prob": self.p_on if on else self.p_off, "model_prob_raw": self.p_on}


class _FakeShadow:
    available = True
    uses_lineups = True

    def lineup_features(self, *a, **k):
        return {"d_lineup": 0.2, "d_lineup_level": 0.0, "lineup_ok": True}

    def predict_detail(self, home, away, gd, extra_features=None, **kw):
        assert extra_features == {"d_lineup": 0.2, "d_lineup_level": 0.0}
        return {"home_win_prob": 0.40, "model_prob_raw": 0.40}


def _game():
    return {"homeTeam": "Maple Leafs", "awayTeam": "Bruins", "homeTeamAbbrev": "TOR", "awayTeamAbbrev": "BOS",
            "gameDate": "2026-10-02", "startTimeUTC": "2026-10-02T23:00:00Z", "id": 2026020020}


def _ctx():
    return {"home_goalie_confirmed": "", "away_goalie_confirmed": ""}


def test_shadow_outputs_term_on_and_off(monkeypatch):
    import market
    import predict_games as P
    inp = P.Inputs(now=datetime.now(timezone.utc), schedule=[])
    inp.ml = _FakeML(0.62, 0.55)
    inp.shadow = _FakeShadow()
    d = {"model_prob_raw": 0.62}
    q, w = 0.5, 0.4
    monkeypatch.setenv("PONYXG_BU", "on")
    out = P.shadow_outputs(_game(), _ctx(), inp, d, 0.571, q, w, {"bu_d_net": 0.3, "bu_d_delta": 0.1}, [])
    assert out["bu_shadow_home_win_pct"] == 57.1                     # = the published blend
    assert out["f1_shadow_model_win_pct"] == 40.0
    assert out["f1_shadow_home_win_pct"] == round(100 * market.blend(0.40, q, w), 1)
    monkeypatch.setenv("PONYXG_BU", "off")
    out = P.shadow_outputs(_game(), _ctx(), inp, d, 0.52, q, w, {"bu_d_net": 0.3, "bu_d_delta": 0.1}, [])
    assert inp.ml.calls[-1] == {"bu_d_net": 0.3, "bu_d_delta": 0.1}  # term-on refit for the shadow
    assert out["bu_shadow_home_win_pct"] == round(100 * market.blend(0.62, q, w), 1)
    # no market: the shadows are model-only
    out = P.shadow_outputs(_game(), _ctx(), inp, d, 0.62, None, 1.0, {"bu_d_net": 0.3, "bu_d_delta": 0.1}, [])
    assert out["f1_shadow_home_win_pct"] == 40.0


@pytest.fixture(scope="module")
def live_and_shadow():
    import predict_games as P
    from ml_predict import MLPredictor
    ml = MLPredictor(pd.DataFrame())
    if not ml.uses_bu:
        pytest.skip("the live model has no RAPM lineup term")
    sh = P.load_shadow(ml, pd.DataFrame())
    assert sh is not None and sh.available, "the live joint model must ship its F1 rollback shadow"
    return ml, sh


def _outputs(monkeypatch, ml, sh, bf, mode):
    import predict_games as P
    monkeypatch.setenv("PONYXG_BU", mode)
    monkeypatch.setattr(P, "bu_lineup", lambda game, inp: bf)
    inp = P.Inputs(now=datetime.now(timezone.utc), schedule=[])
    inp.ml, inp.shadow = ml, sh
    game = {"homeTeam": "Maple Leafs", "awayTeam": "Bruins", "homeTeamAbbrev": "TOR", "awayTeamAbbrev": "BOS",
            "gameDate": "2026-10-02", "startTimeUTC": "2026-10-02T23:00:00Z", "id": 2026020020}
    ctx = {"home_goalie_confirmed": "", "away_goalie_confirmed": "", "home_gp": 1, "away_gp": 1}
    return P.build_model_outputs(game, ctx, inp)


@pytest.mark.parametrize("mode,ok", [("on", False), ("off", True), ("shadow", True)])
def test_term_off_or_unavailable_publishes_the_f1_rollback_model(monkeypatch, live_and_shadow, mode, ok):
    """PONYXG_BU=off|shadow, a stale bundle or a failed coverage gate publish the incumbent
    without the term (the F1 rollback model), not the joint model with zero-filled bu_d_net /
    bu_d_delta (bu_d_net carries team strength there, so zeros shrink picks toward 50%)."""
    ml, sh = live_and_shadow
    bf = {"bu_d_net": 0.6, "bu_d_delta": 0.3, "bu_ok": ok, "reason": None if ok else "stale bundle (40 h > 36 h)",
          "home": {"delta": 0.2, "n": 18}, "away": {"delta": -0.1, "n": 18}}
    out = _outputs(monkeypatch, ml, sh, bf, mode)
    assert out["model_version"] == sh.model_version != ml.model_version
    assert out["home_model_win_pct"] == out["f1_shadow_model_win_pct"]
    assert out["home_win_pct"] == out["f1_shadow_home_win_pct"]
    assert {r["factor"] for r in out["home_wp_breakdown"]} >= {"lineup_goalie", "strength_5v5"}
    term_on = ml.predict_detail("Maple Leafs", "Bruins", "2026-10-02",
                                extra_features={"bu_d_net": 0.6 if ok else 0.0, "bu_d_delta": 0.3 if ok else 0.0})
    assert out["bu_shadow_home_win_pct"] == round(100 * term_on["home_win_prob"], 1)   # no market: model-only


def test_term_on_publishes_the_joint_model(monkeypatch, live_and_shadow):
    ml, sh = live_and_shadow
    bf = {"bu_d_net": 0.6, "bu_d_delta": 0.3, "bu_ok": True, "reason": None,
          "home": {"delta": 0.2, "n": 18}, "away": {"delta": -0.1, "n": 17}}
    out = _outputs(monkeypatch, ml, sh, bf, "on")
    assert out["model_version"] == ml.model_version
    assert out["bu_shadow_home_win_pct"] == out["home_win_pct"]
    assert (out["home_lineup_score"], out["away_lineup_matched"]) == (0.2, 17)
    assert out["f1_shadow_model_win_pct"] is not None and out["f1_shadow_model_win_pct"] != out["home_model_win_pct"]


def test_missing_fin_publishes_the_joint_model_without_fin(monkeypatch, live_and_shadow):
    """A serving bundle without a FIN table (older refresh, no fin pack) for a model with bu_d_fin:
    the joint model trained WITHOUT FIN (shadow.rapm) is published, not the FIN model with a
    zero-filled bu_d_fin; without that model on disk, the F1 rollback model."""
    import predict_games as P
    ml, sh = live_and_shadow
    if not ml.uses_fin:
        pytest.skip("the live model has no FIN term")
    bf = {"bu_d_net": 0.6, "bu_d_delta": 0.3, "bu_d_fin": 0.0, "bu_ok": True, "fin_ok": False, "fin_missing": True,
          "reason": None, "home": {"delta": 0.2, "n": 18}, "away": {"delta": -0.1, "n": 17}}
    out = _outputs(monkeypatch, ml, sh, bf, "on")
    nofin = P.load_shadow(ml, pd.DataFrame(), key="rapm")
    assert nofin is not None and not nofin.uses_fin and nofin.uses_bu
    assert out["model_version"] == nofin.model_version == ml.meta["shadow"]["rapm"]["model_version"]
    d = nofin.predict_detail("Maple Leafs", "Bruins", "2026-10-02", extra_features={"bu_d_net": 0.6, "bu_d_delta": 0.3})
    assert out["home_model_win_pct"] == round(100 * d["home_win_prob"], 1)
    assert out["bu_shadow_home_win_pct"] == out["home_win_pct"]
    assert (out["home_lineup_score"], out["away_lineup_matched"]) == (0.2, 17)
    monkeypatch.setattr(P, "nofin_model", lambda inp: None)
    out = _outputs(monkeypatch, ml, sh, bf, "on")
    assert out["model_version"] == sh.model_version


def test_nofin_switch_serves_the_rapm_model(monkeypatch, live_and_shadow):
    """PONYXG_BU=nofin: the joint model without FIN is the live model, its F1 chain intact."""
    import predict_games as P
    ml, sh = live_and_shadow
    if not ml.uses_fin:
        pytest.skip("the live model has no FIN term")
    alt = P.load_shadow(ml, pd.DataFrame(), key="rapm")
    f1 = P.load_shadow(alt, pd.DataFrame())
    assert f1 is not None and f1.model_version == sh.model_version
    bf = {"bu_d_net": 0.6, "bu_d_delta": 0.3, "bu_d_fin": 0.1, "bu_ok": True, "fin_ok": True, "reason": None,
          "home": {"delta": 0.2, "n": 18}, "away": {"delta": -0.1, "n": 17}}
    out = _outputs(monkeypatch, alt, f1, bf, "nofin")
    assert out["model_version"] == alt.model_version and out["bu_shadow_home_win_pct"] == out["home_win_pct"]


def test_shadow_outputs_without_bu_or_shadow():
    import predict_games as P
    inp = P.Inputs(now=datetime.now(timezone.utc), schedule=[])
    ml = _FakeML(0.6, 0.6)
    ml.uses_bu = False
    inp.ml = ml
    out = P.shadow_outputs(_game(), _ctx(), inp, {"model_prob_raw": 0.6}, 0.6, None, 1.0, None, [])
    assert out == {"bu_shadow_home_win_pct": None, "f1_shadow_model_win_pct": None, "f1_shadow_home_win_pct": None}


def test_shadow_columns_are_frozen_model_outputs():
    import predict_games as P
    for c in ("bu_shadow_home_win_pct", "f1_shadow_model_win_pct", "f1_shadow_home_win_pct"):
        assert c in P.FROZEN_COLUMNS and c in P.COLUMNS


def test_bu_detail_feeds_the_lineup_columns():
    import predict_games as P
    d = P.bu_detail({"home": {"delta": 0.123, "n": 18}, "away": {"delta": -0.05, "n": 17}})
    assert d == {"home": {"dq": 0.123, "matched": 18}, "away": {"dq": -0.05, "matched": 17}}


def test_load_shadow_needs_a_shadow_spec():
    import predict_games as P

    class M:
        meta = {}
    assert P.load_shadow(M()) is None
    assert P.load_shadow(None) is None


# ── bundle refresh and validation ────────────────────────────────────────────

def _bundle(built_at, n_games=10, season="20262027", **kw):
    b = {"version": 1, "kind": "serving_bundle", "season": season, "built_at": built_at,
         "max_source_date": "2026-09-30", "n_games": n_games, "columns": ["bu_d_net", "bu_d_delta"],
         "players": {"columns": ["player_id", "o", "d", "rated"], "rows": [[1, 0.1, 0.0, True]]},
         "v3": {"columns": ["player_id", "o", "d"], "rows": [[1, 0.1, 0.0]], "meta": {}}}
    b.update(kw)
    return b


def test_decide_publish():
    from bu.lineup.refresh import decide_publish
    now = datetime(2026, 10, 2, 12, tzinfo=timezone.utc)
    iso = lambda h: (now - timedelta(hours=h)).isoformat(timespec="seconds")  # noqa: E731
    new = _bundle(iso(0))
    assert decide_publish(new, None, now)[0]
    assert not decide_publish(new, _bundle(iso(3)), now)[0]                         # same content, fresh
    assert decide_publish(new, _bundle(iso(13)), now)[0]                            # same content, > 12 h
    assert decide_publish(new, _bundle(iso(3), n_games=9), now)[0]                  # new games
    assert decide_publish(new, _bundle(iso(3), season="20252026"), now)[0]
    assert not decide_publish(dict(new, dfo_coverage=0.9), _bundle(iso(3), dfo_coverage=0.8), now)[0]


def _write_gz(path, obj):
    with gzip.open(path, "wt") as f:
        json.dump(obj, f)


def test_check_bu_bundle(tmp_path, monkeypatch):
    import validate_outputs as V
    meta = {"feature_columns": ["d_elo", "bu_d_net", "bu_d_delta"]}
    monkeypatch.setattr(V, "_json", lambda p, d=None: meta if p.endswith("game_model_meta.json") else d)
    p = tmp_path / "b.json.gz"
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    _write_gz(p, _bundle(now, season=V.SEASON_ID))
    assert V.check_bu_bundle({"bu_bundle_path": str(p)}) == []
    _write_gz(p, _bundle(now, season="20202021"))
    assert any("season" in e for e in V.check_bu_bundle({"bu_bundle_path": str(p)}))
    old = (datetime.now(timezone.utc) - timedelta(hours=80)).isoformat(timespec="seconds")
    _write_gz(p, _bundle(old, season="20202021", max_source_date=old[:10]))   # stale: served neutral
    assert V.check_bu_bundle({"bu_bundle_path": str(p)}) == []
    _write_gz(p, _bundle(now, season=V.SEASON_ID, columns=["bu_d_net"]))
    assert any("columns" in e for e in V.check_bu_bundle({"bu_bundle_path": str(p)}))
    _write_gz(p, _bundle(now, season=V.SEASON_ID, v3=None))                         # site ratings source missing
    assert any("v3" in e for e in V.check_bu_bundle({"bu_bundle_path": str(p)}))
    assert any("unreadable" in e for e in V.check_bu_bundle({"bu_bundle_path": str(tmp_path / "x.gz")}))
    # a model with bu_d_fin: a fresh bundle must carry the FIN table (else the no-FIN model is served)
    meta["feature_columns"] = ["d_elo", "bu_d_net", "bu_d_delta", "bu_d_fin"]
    _write_gz(p, _bundle(now, season=V.SEASON_ID))
    assert any("FIN" in e for e in V.check_bu_bundle({"bu_bundle_path": str(p)}))
    _write_gz(p, _bundle(now, season=V.SEASON_ID, columns=["bu_d_net", "bu_d_delta", "bu_d_fin"],
                         fin={"columns": ["player_id", "fin_f", "fin_d"], "rows": [[1, 0.1, 0.05]]}))
    assert V.check_bu_bundle({"bu_bundle_path": str(p)}) == []
    _write_gz(p, _bundle(old, season=V.SEASON_ID, max_source_date=old[:10]))        # stale: F1 published
    assert V.check_bu_bundle({"bu_bundle_path": str(p)}) == []
    meta["feature_columns"] = ["d_elo"]
    assert V.check_bu_bundle({"bu_bundle_path": str(tmp_path / "x.gz")}) == []      # model without the term


def test_committed_bundle_and_meta_agree():
    """The committed model and bundle pass the contract check (when the model uses the term)."""
    import validate_outputs as V
    assert V.check_bu_bundle({}) == []


# ── workflows ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def bu_wf():
    yaml = pytest.importorskip("yaml")
    with open(os.path.join(ROOT, ".github", "workflows", "bu_refresh.yml"), encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def test_bu_refresh_workflow(bu_wf):
    on = bu_wf.get("on") or bu_wf.get(True)
    assert "schedule" in on and "workflow_dispatch" in on
    assert bu_wf["permissions"] == {"contents": "read"}
    job = bu_wf["jobs"]["refresh"]
    assert job["permissions"] == {"contents": "write"}
    assert job["timeout-minutes"] <= 60
    runs = "\n".join(s.get("run", "") for s in job["steps"])
    assert "python -m bu.lineup.refresh --lake-dir" in runs
    assert "serving_bundle.json.gz" in runs
    # the lake is never committed: only the bundle is staged
    assert "git add -- \"$f\"" in runs and "git add -A" not in runs
    for s in job["steps"]:
        if "uses" in s:
            assert "@" in s["uses"] and len(s["uses"].split("@")[1].split()[0]) == 40


@pytest.fixture(scope="module")
def live_meta():
    with open(os.path.join(PIPELINE, "game_model_meta.json")) as f:
        return json.load(f)


def test_live_model_is_the_joint_model_with_a_rollback_shadow(live_meta):
    import features as F
    if not any(c in live_meta["feature_columns"] for c in F.BU_COLUMNS):
        pytest.skip("live model has no RAPM lineup term")
    assert live_meta["xg_version"] == "v2"                   # releases the bu.xg.live interlock
    assert not any(c in live_meta["feature_columns"] for c in F.LINEUP_COLUMNS)
    fin = any(c in live_meta["feature_columns"] for c in F.BU_FIN_COLUMNS)
    assert live_meta["model_version"].endswith("-xg2-rapm-fin" if fin else "-xg2-rapm")
    if fin:   # the replaced joint model (no FIN) stays reachable: PONYXG_BU=nofin / a bundle without FIN
        r = live_meta["shadow"]["rapm"]
        assert r["model_version"].endswith("-xg2-rapm") and "bu_d_fin" not in r["features"]
        assert os.path.exists(os.path.join(PIPELINE, r["model"])) and os.path.exists(os.path.join(PIPELINE, r["meta"]))
        with open(os.path.join(PIPELINE, r["meta"])) as f:
            assert json.load(f)["shadow"]["f1"] == live_meta["shadow"]["f1"]   # its own F1 chain
    sh = live_meta["shadow"]["f1"]
    assert os.path.exists(os.path.join(PIPELINE, sh["model"])) and os.path.exists(os.path.join(PIPELINE, sh["meta"]))
    assert sh["xg_inputs"] == "v1" and sh["dedupe"] == "legacy" and "d_lineup" in sh["features"]
    g = live_meta["bu_lineup"]["gate"]
    # owner decision 2026-10-01 (window prior directive): the retrain on the window-prior lineup
    # table ships unless it is worse than the model it replaces by more than +0.0010 pooled
    rule = str((live_meta.get("promotion") or {}).get("rule", ""))
    window = "window prior directive" in rule
    if fin:   # owner approval 2026-10-02: better on both dev seasons, 2025-26 look within +0.0010
        assert rule.startswith("owner approval 2026-10-02")
        assert g["dev_pooled"]["delta_ll"] < 0
        assert g["per_fold"]["2023"]["delta"] < 0 and g["per_fold"]["2024"]["delta"] < 0
        assert g["per_fold"]["2025"]["delta"] <= 0.0010
        assert g["previous_gate"]["pooled_delta_vs_previous"]["delta"] <= 0.0010   # the window retrain
        assert os.path.exists(os.path.join(PIPELINE, g["report"]))
        return
    assert g["pooled_delta_vs_previous"]["delta"] <= (0.0010 if window else 0)
    if window:   # and the replaced joint model's own gain over the F1 rollback model is kept
        assert g["previous_gate"]["pooled_delta_vs_previous"]["delta"] <= 0
    assert os.path.exists(os.path.join(PIPELINE, g["report"]))


def test_live_model_routes_the_bu_terms(live_meta):
    from ml_predict import MLPredictor
    ml = MLPredictor(pd.DataFrame())
    if not ml.uses_bu:
        pytest.skip("live model has no RAPM lineup term")
    d0 = ml.predict_detail("Kings", "Ducks", "2026-10-03")
    d1 = ml.predict_detail("Kings", "Ducks", "2026-10-03",
                           extra_features={"bu_d_net": 0.3, "bu_d_delta": 0.2, "bu_d_fin": 0.05})
    t0 = {t["factor"]: t["logit"] for t in d0["logit_terms"]}
    t1 = {t["factor"]: t["logit"] for t in d1["logit_terms"]}
    b = live_meta["coefficients_raw"]
    assert abs((t1["strength_5v5"] - t0["strength_5v5"]) - 0.3 * b["bu_d_net"]
               - 0.05 * b.get("bu_d_fin", 0.0)) < 1e-9
    assert abs((t1["lineup_goalie"] - t0["lineup_goalie"]) - 0.2 * b["bu_d_delta"]) < 1e-9
    p = d1["model_prob_raw"]
    assert abs(sum(t1.values()) - np.log(p / (1 - p))) < 1e-9


def test_update_data_passes_the_rollback_switches():
    yaml = pytest.importorskip("yaml")
    with open(os.path.join(ROOT, ".github", "workflows", "update_data.yml"), encoding="utf-8") as fh:
        wf = yaml.safe_load(fh)
    step = next(s for s in wf["jobs"]["update-data"]["steps"] if s.get("name") == "Run data pipeline")
    assert step["env"]["PONYXG_BU"] == "${{ vars.PONYXG_BU }}"
    assert step["env"]["PONYXG_XG"] == "${{ vars.PONYXG_XG }}"
