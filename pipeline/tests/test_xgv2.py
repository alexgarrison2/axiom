"""sm-xgv2: xG v2 features, model IO, v1 emulation, live wiring and train/serve parity."""
import gzip
import json
import os

import numpy as np
import pandas as pd
import pytest

from bu.lake.parse import parse_game
from bu.xg import features as XF
from bu.xg import live, v1
from bu.xg.model import XGv2
from bu.xg.walkforward import asof_blocks, season_weights, train_window

PIPELINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTDATA = os.path.join(PIPELINE_DIR, "bu", "lake", "testdata", "raw")
GAMES = [("20232024", 2023020500), ("20192020", 2019020758), ("20102011", 2010020165)]


def _raw(endpoint, season, gid):
    with gzip.open(os.path.join(TESTDATA, endpoint, season, f"{gid}.json.gz"), "rb") as f:
        return json.loads(f.read())


def _full(season, gid):
    """The training path: payloads parsed with shifts, boxscore and right-rail (as bu.lake.build does)."""
    return parse_game(_raw("pbp", season, gid), _raw("shifts", season, gid), _raw("boxscore", season, gid),
                      _raw("rightrail", season, gid), season=season)


@pytest.fixture(scope="module")
def shots2023():
    r = _full("20232024", 2023020500)
    return XF.shot_features(r["events"], r["games"], {})


# ------------------------------------------------------------------ features

def test_features_unit_and_frame(shots2023):
    s = shots2023
    assert len(s) > 50
    assert set(s["type_code"].astype(int)) <= {505, 506, 507}
    assert s["is_goal"].sum() == (s["type_code"] == 505).sum()
    # shooter frame: the attacked net is at +89, most attempts come from the offensive zone
    assert (s["x_s"] > 25).mean() > 0.9
    assert np.allclose(s["distance"], np.hypot(89 - s["x_s"], s["y_s"]))
    for c in XF.FEATURES:
        assert c in s.columns, c
    core = ["distance", "angle", "x_s", "y_s", "own_skaters", "opp_skaters", "dt_prev", "score_diff", "period"]
    assert s[core].notna().all().all()
    assert set(s["strength_class"]) <= set(XF.STRENGTH_CLASSES)


def test_rebound_and_rush_definitions(shots2023):
    s = shots2023
    reb = s[s["is_rebound"] == 1]
    assert (reb["dt_prev"] <= 3).all() and (reb["prev_same_team"] == 1).all()
    assert (s.loc[s["is_rush"] == 1, "dt_prev"] <= 4).all()
    assert not ((s["is_rush"] == 1) & (s["is_rebound"] == 1)).any()
    assert (s["angle_change"].dropna() <= 180).all()


def test_score_diff_is_shooter_view_and_clipped():
    ev = pd.DataFrame({
        "game_id": [2023020001] * 3, "event_id": [1, 2, 3], "sort_order": [1, 2, 3], "season": "20232024",
        "period": [1, 1, 1], "period_seconds": [10, 20, 30], "game_seconds": [10, 20, 30],
        "type_code": [502, 506, 506], "type_desc": ["faceoff", "shot-on-goal", "shot-on-goal"],
        "situation_code": ["1551"] * 3, "acting_is_home": [True, True, False], "acting_team_id": [1, 1, 2],
        "shooting_team_id": [None, 1, 2], "shooter_id": [None, 10, 20], "x_home": [0.0, 60.0, -70.0],
        "y_home": [0.0, 10.0, -5.0], "zone_code": ["N", "O", "O"], "shot_type": [None, "wrist", "slap"],
        "own_skaters": [5, 5, 5], "opp_skaters": [5, 5, 5], "empty_net_against": [False] * 3,
        "own_goalie_pulled": [False] * 3, "is_penalty_shot": [False] * 3, "is_shootout": [False] * 3,
        "home_score": [5, 5, 5], "away_score": [0, 0, 0], "goalie_in_net_id": [None, 30, 31],
    })
    s = XF.shot_features(ev, None, {10: "L", 20: "R"})
    assert list(s["score_diff"]) == [3.0, -3.0]
    # away shooter at x_home = -70 attacks -x: in its own frame that is +70
    assert s["x_s"].tolist() == [60.0, 70.0]
    assert s["y_s"].tolist() == [10.0, 5.0]
    # L shooter on his left (+y) is on his forehand side; R shooter on +y is on his off wing
    assert s["off_wing"].tolist() == [0.0, 1.0]
    assert s["secs_since_faceoff"].tolist() == [10.0, 20.0]


def test_flurry_adjustment():
    d = pd.DataFrame({"game_id": [1, 1, 1, 1], "shooting_team_id": [7, 7, 7, 8],
                      "game_seconds": [100, 102, 110, 101], "xg": [0.2, 0.5, 0.1, 0.3]})
    f = XF.flurry_adjust(d, "xg")
    assert f.tolist() == pytest.approx([0.2, 0.5 * 0.8, 0.1, 0.3])


# --------------------------------------------------------------- parity

@pytest.mark.parametrize("season,gid", GAMES)
def test_live_features_equal_training_features(season, gid):
    """Live scoring parses the PBP alone; training parses PBP + shifts + boxscore + right-rail.
    The v2 features must not depend on the extra payloads (DESIGN §4.4.7 parity)."""
    r = _full(season, gid)
    train = XF.shot_features(r["events"], r["games"], {})
    serve = live.featurise_payloads({gid: _raw("pbp", season, gid)}, hand={})
    assert len(train) == len(serve)
    a = train[XF.FEATURES].to_numpy(float)
    b = serve[XF.FEATURES].to_numpy(float)
    assert np.allclose(a, b, equal_nan=True, atol=1e-9)


def test_parquet_roundtrip_parity(tmp_path):
    """Features from the lake parquet (training) equal features from the in-memory frame (serving)."""
    from bu.lake.build import _coerce, write_table
    r = _full("20232024", 2023020500)
    p = tmp_path / "events.parquet"
    write_table(_coerce(r["events"].copy()), str(p))
    back = pd.read_parquet(p)
    a = XF.shot_features(r["events"], r["games"], {})[XF.FEATURES].to_numpy(float)
    b = XF.shot_features(back, r["games"], {})[XF.FEATURES].to_numpy(float)
    assert np.allclose(a, b, equal_nan=True, atol=1e-9)


# -------------------------------------------------------------- v1 emulation

def test_v1_rows_match_season_csv():
    """bu.xg.v1 rebuilds the scraper's v1 inputs exactly (x, y, score diff, clock, shot type)."""
    r = _full("20232024", 2023020500)
    rows = v1.rows_from_events(r["events"])
    csv = pd.read_csv(os.path.join(PIPELINE_DIR, "nhl_historical_shots.csv"), low_memory=False)
    csv = csv[csv["game_id"] == 2023020500]
    if csv.empty:
        pytest.skip("game not in the historical shot CSV")
    m = rows.merge(csv, on=["game_id", "event_id"], suffixes=("", "_c"))
    assert len(m) >= 0.95 * len(csv)
    for c in ("x", "y", "score_differential", "time_since_last_event", "is_goal"):
        assert np.allclose(m[c].astype(float), m[c + "_c"].astype(float)), c
    assert (m["shot_type"] == m["shot_type_c"]).all()


# ------------------------------------------------------------------ model

def _synthetic(n=4000, seed=0):
    rng = np.random.default_rng(seed)
    d = pd.DataFrame({c: rng.normal(size=n) for c in XF.FEATURES})
    d["distance"] = rng.uniform(5, 70, n)
    d["angle"] = rng.uniform(0, 80, n)
    d["is_goal"] = (rng.uniform(size=n) < 1 / (1 + np.exp(0.08 * d["distance"]))).astype(int)
    d["strength_class"] = rng.choice(["5v5", "PP", "EN", "PS"], n, p=[0.8, 0.15, 0.04, 0.01])
    d["season"] = rng.choice(["20222023", "20232024"], n)
    d["game_id"] = rng.integers(0, 300, n)
    return d


def test_model_save_load_roundtrip(tmp_path):
    import bu.xg.model as XM
    old = XM.MAX_ROUNDS
    XM.MAX_ROUNDS = 40
    try:
        d = _synthetic()
        m = XGv2.fit(d, log=lambda *_: None)
    finally:
        XM.MAX_ROUNDS = old
    p1 = m.predict(d)
    m.save(str(tmp_path))
    m2 = XGv2.load(str(tmp_path))
    p2 = m2.predict(d)
    assert np.allclose(p1, p2, atol=1e-9)
    assert ((p1 > 0) & (p1 < 1)).all()
    assert set(m.calibrators) >= {"_pooled", "5v5"}
    assert m.en and m.ps_rate is not None
    # no pickles: both artifacts are JSON
    for f in os.listdir(tmp_path):
        assert f.endswith(".json")
        json.load(open(tmp_path / f))


def test_train_window_never_includes_test_season():
    avail = ["20172018", "20182019", "20192020", "20202021", "20212022", "20222023", "20232024", "20242025",
             "20252026", "20262027"]
    assert train_window("20232024", avail) == ["20182019", "20192020", "20202021", "20212022", "20222023"]
    for S in avail:
        assert all(s < S for s in train_window(S, avail))
    assert train_window("20172018", avail) == []


def test_season_weights_recency():
    s = pd.Series(["20222023", "20232024", "20242025"])
    assert season_weights(s, "20252026", 0.5).tolist() == [0.25, 0.5, 1.0]
    assert season_weights(s, "20252026", 0.0).tolist() == [0.0, 0.0, 1.0]


def test_asof_blocks_cover_season_without_lookahead():
    d = pd.Series(pd.to_datetime(["2024-10-08", "2024-10-30", "2024-11-02", "2025-01-15", "2025-06-20"]))
    e = asof_blocks(d)
    assert e[0] == pd.Timestamp("2024-10-08") and e[1] == pd.Timestamp("2024-11-01")
    assert e[-1] > d.max()
    assert all(a < b for a, b in zip(e, e[1:]))
    # every game falls in exactly one block, and a block's refit sees only games before its start
    for lo, hi in zip(e[1:-1], e[2:]):
        blk = (d >= lo) & (d < hi)
        assert (d[d < lo] < lo).all() and not (blk & (d < lo)).any()


# ------------------------------------------------------------------- live

def test_mode_flag(monkeypatch):
    monkeypatch.setenv(live.MODE_ENV, "v1")
    assert live.mode() == "v1"
    monkeypatch.setenv(live.MODE_ENV, "bogus")
    assert live.mode() == live.DEFAULT_MODE or live.mode() == "v1"
    monkeypatch.setenv(live.MODE_ENV, "v2")
    monkeypatch.setattr(live, "artifacts_present", lambda *a, **k: False)
    assert live.mode() == "v1"   # missing artifacts fall back to v1


@pytest.mark.skipif(not live.artifacts_present(), reason="production xG v2 artifacts not committed")
def test_production_model_scores_csv_rows():
    """The committed v2 model scores a season-CSV game through the live path (offline: lake payload)."""
    csv = pd.read_csv(os.path.join(PIPELINE_DIR, "nhl_historical_shots.csv"), low_memory=False)
    rows = csv[csv["game_id"] == 2023020500].reset_index(drop=True)
    if rows.empty:
        pytest.skip("game not in the historical shot CSV")
    xg, st = live.score_rows(rows, fetch=lambda g: _raw("pbp", "20232024", g))
    assert st["scored"] == len(rows) and st["games_without_pbp"] == 0
    assert 0.03 < xg.mean() < 0.15
    en = rows["strength_state"].eq("EmptyNet")
    if en.any():
        assert xg[en].mean() > 0.2


def test_flag_modes_fill_column_and_fall_back(monkeypatch):
    monkeypatch.setattr(live, "artifacts_present", lambda *a, **k: True)
    monkeypatch.setattr(live, "model_signature", lambda *a, **k: "sigA")
    monkeypatch.setattr(live, "score_rows", lambda sub, fetch=None: (
        pd.Series([0.08, 0.1, np.nan][:len(sub)], index=sub.index), {"scored": 2, "games": 2}))
    v1 = lambda r: np.full(len(r), 0.05)  # noqa: E731
    base = pd.DataFrame({"game_id": [1, 1, 2], "event_id": [1, 2, 3]}, index=[10, 11, 12])

    # v1: no v2 work, nothing added
    monkeypatch.setenv(live.MODE_ENV, "v1")
    df = base.copy()
    assert live.fill_v2_column(df, {}) == {"v2_column": "off"} and live.V2_COL not in df
    probs, info = live.score_shots(df, v1)
    assert probs.tolist() == [0.05] * 3 and info["v1_rows"].all() and info["v1_fallback_games"] == []
    assert live.active_hash(lambda: "md5v1") == "md5v1"

    # shadow: xg_raw stays v1, the v2 column is filled (NaN where v2 had no payload)
    monkeypatch.setenv(live.MODE_ENV, "shadow")
    df = base.copy()
    inf = live.fill_v2_column(df, {})
    assert df[live.V2_COL].tolist()[:2] == [0.08, 0.1] and np.isnan(df[live.V2_COL].iloc[2])
    assert inf["v2_missing_games"] == [2] and inf["v2_signature"] == "sigA"
    probs, info = live.score_shots(df, v1)
    assert probs.tolist() == [0.05] * 3 and info["v1_fallback_games"] == []
    assert live.active_hash(lambda: "md5v1") == "md5v1"     # shadow publishes v1

    # v2: xg_raw from the v2 column, v1 fallback queued for the next run
    monkeypatch.setenv(live.MODE_ENV, "v2")
    probs, info = live.score_shots(df, v1)
    assert probs.tolist() == [0.08, 0.1, 0.05]
    assert info["v1_fallback_games"] == [2] and info["v1_rows"].tolist() == [False, False, True]
    assert live.pending_mask(df, {"v1_fallback_games": [2]}).tolist() == [False, False, True]
    assert live.active_hash(lambda: "md5v1") == "v2:sigA"

    # a new v2 artifact rescores the whole column
    calls = []
    monkeypatch.setattr(live, "score_rows", lambda sub, fetch=None: (
        calls.append(len(sub)) or pd.Series(0.12, index=sub.index), {"scored": len(sub), "games": 2}))
    live.fill_v2_column(df, {"v2_signature": "sigOLD"})
    assert calls == [3] and df[live.V2_COL].tolist() == [0.12] * 3


@pytest.mark.skipif(not live.artifacts_present(), reason="production xG v2 artifacts not committed")
def test_events_missing_from_feed_are_not_retried(monkeypatch):
    monkeypatch.setenv(live.MODE_ENV, "shadow")
    calls = []

    def fetch(g):
        calls.append(g)
        return _raw("pbp", "20232024", g)
    pbp = _raw("pbp", "20232024", 2023020500)
    real = [p["eventId"] for p in pbp["plays"] if p.get("typeCode") == 506][:2]
    df = pd.DataFrame({"game_id": [2023020500] * 3, "event_id": real + [999999]})
    info = live.fill_v2_column(df, {}, fetch=fetch)
    assert df[live.V2_COL].notna().tolist() == [True, True, False]
    assert info["v2_unmatched_events"] == [[2023020500, 999999]] and info["v2_missing_games"] == []
    info2 = live.fill_v2_column(df, info, fetch=fetch)
    assert len(calls) == 1 and info2["v2_unmatched_events"] == [[2023020500, 999999]]


def test_v2_failure_never_breaks_the_run(monkeypatch):
    monkeypatch.setattr(live, "artifacts_present", lambda *a, **k: True)
    monkeypatch.setattr(live, "model_signature", lambda *a, **k: "sigNEW")
    monkeypatch.setenv(live.MODE_ENV, "shadow")

    def boom(*a, **k):
        raise RuntimeError("xgboost exploded")
    monkeypatch.setattr(live, "score_rows", boom)
    df = pd.DataFrame({"game_id": [1, 2], "event_id": [1, 2], live.V2_COL: [0.05, np.nan]})
    info = live.fill_v2_column(df, {"v2_signature": "sigOLD"})
    assert "v2_error" in info and info["v2_signature"] == "sigOLD"   # full rescore retried next run
    assert df[live.V2_COL].iloc[0] == 0.05                            # nothing overwritten


def test_score_rows_missing_payload_leaves_nan():
    rows = pd.DataFrame({"game_id": [2023020500, 2023020500], "event_id": [1, 2]})

    class Dummy:
        rink = None

        def predict(self, df):
            return np.full(len(df), 0.1)

    xg, st = live.score_rows(rows, fetch=lambda g: None, model=Dummy())
    assert xg.isna().all() and st["scored"] == 0 and st["games_without_pbp"] == 1


def test_v2_rows_rewritten_this_run_retake_xg_raw(monkeypatch):
    """Under v2, rows whose xg_raw_v2 was rewritten this run get xg_raw re-taken from it (an
    artifact rescore that failed on the run that moved the hash must not leave stale xg_raw)."""
    monkeypatch.setattr(live, "artifacts_present", lambda *a, **k: True)
    monkeypatch.setattr(live, "model_signature", lambda *a, **k: "sigNEW")
    monkeypatch.setattr(live, "score_rows", lambda sub, fetch=None: (
        pd.Series(0.09, index=sub.index), {"scored": len(sub), "games": 1}))
    df = pd.DataFrame({"game_id": [1, 1, 2], "event_id": [1, 2, 3], live.V2_COL: [0.05, 0.06, 0.07]},
                      index=[5, 6, 7])
    monkeypatch.setenv(live.MODE_ENV, "v2")
    live.fill_v2_column(df, {"v2_signature": "sigOLD"})
    assert live.pending_mask(df, {}).all()
    live.fill_v2_column(df, {"v2_signature": "sigNEW"})          # nothing to do this time
    assert not live.pending_mask(df, {}).any()
    monkeypatch.setenv(live.MODE_ENV, "shadow")                   # shadow never touches xg_raw
    live.fill_v2_column(df, {"v2_signature": "sigOLD"})
    assert not live.pending_mask(df, {}).any()


def test_feed_outage_stops_fetching():
    calls = []

    class Dummy:
        rink = None

        def predict(self, df):
            return np.full(len(df), 0.1)

    def fetch(g):
        calls.append(g)
        return None
    out = live.score_games(range(2026020001, 2026020011), fetch=fetch, model=Dummy())
    assert out.empty and len(calls) == live.MAX_CONSECUTIVE_MISSES


def test_shadow_gate_counts_only_out_of_sample_games(tmp_path):
    from bu.xg.summary import shadow_status
    rng = np.random.default_rng(2)
    n_games, per = 160, 60
    gids = np.repeat(np.arange(2026020001, 2026020001 + n_games), per)
    p = rng.uniform(0.01, 0.3, len(gids))
    shots = pd.DataFrame({"game_id": gids, "is_goal": (rng.uniform(size=len(gids)) < p).astype(int),
                          "xg_raw_v2": p})
    dates = pd.date_range("2026-10-01", periods=n_games, freq="12h").strftime("%Y-%m-%d")
    gs = pd.DataFrame({"game_id": np.arange(2026020001, 2026020001 + n_games), "game_date": dates})
    shots.to_csv(tmp_path / "shots.csv", index=False)
    gs.to_csv(tmp_path / "gs.csv", index=False)
    kw = dict(shots_csv=str(tmp_path / "shots.csv"), gamestats_csv=str(tmp_path / "gs.csv"))
    allg = shadow_status(cutoff=None, **kw)
    assert allg["games"] == n_games and allg["pass"]
    assert 0.8 < allg["cal_slope"] < 1.2
    cut = shadow_status(cutoff="2026-10-20", **kw)    # games through Oct 20 were in the training set
    assert cut["games"] == n_games - 40 and cut["games_in_sample_excluded"] == 40 and cut["pass"]
    late = shadow_status(cutoff="2026-11-20", **kw)
    assert late["games"] == int((dates > "2026-11-20").sum()) < 100 and not late["pass"]
