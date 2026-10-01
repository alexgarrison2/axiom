"""The incumbent shot model (xG v1, ``pipeline/xg_model_xgb.pkl``) as a benchmark.

Two references, both scored on exactly the shots v2 is scored on:

* **v1 production**: the committed pickle.  It was fit on a random 80/20 split
  of 2022-26 shots, so on those seasons it is *in sample*; it is reported, but
  it is not a fair out-of-sample bar (DESIGN §1.3, §3.1).
* **v1 PIT** (point in time): the v1 recipe (``xg_model.preprocess_data`` +
  ``train_xgboost`` + 5-fold isotonic ``CalibratedClassifierCV``) re-fit on the
  same training window as v2 (seasons < S).  This is the M1 gate's bar.

v1 inputs are rebuilt from the lake exactly as ``scrape_games.py`` builds the
season shot CSVs: raw (unnormalised) x/y, ``time_since_last_event`` from the
period clock of the previous play, the event owner's score differential,
``is_rebound`` / ``is_rush`` always 0 (the scraper compares against old type
names and zone codes, DESIGN §3.0), handedness from ``player_hand.json``
(every entry is "U").  ``tests/test_xgv2.py`` checks this against the CSVs.
"""
from __future__ import annotations

import contextlib
import io
import os
import pickle
import sys

import numpy as np
import pandas as pd

PIPELINE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
V1_PKL = os.path.join(PIPELINE_DIR, "xg_model_xgb.pkl")
EN_XG = 0.52   # refresh_pipeline.EN_XG: production overrides empty-net shots with this constant


def rows_from_events(events: pd.DataFrame) -> pd.DataFrame:
    """v1 shot rows (the season-CSV schema) for the unblocked, non-shootout shots of ``events``."""
    ev = events.sort_values(["game_id", "sort_order", "event_id"], kind="stable").reset_index(drop=True)
    gid = ev["game_id"].astype("int64")
    psec = pd.to_numeric(ev["period_seconds"], errors="coerce").astype("float64")
    prev = psec.shift(1).where(gid == gid.shift(1))
    tsl = (psec - prev).fillna(psec)
    tsl = tsl.where(tsl >= 0, 0.0)
    tc = pd.to_numeric(ev["type_code"], errors="coerce")
    so = ev["is_shootout"].fillna(False).astype(bool)
    keep = tc.isin([505, 506, 507]) & ~so
    s = ev.loc[keep].copy()
    owner_home = s["event_team_is_home"].astype("boolean")
    hs = pd.to_numeric(s["home_score"], errors="coerce")
    as_ = pd.to_numeric(s["away_score"], errors="coerce")
    sd = np.where(owner_home.fillna(True).to_numpy(dtype=bool), hs - as_, as_ - hs)
    pid = pd.to_numeric(s["shooter_raw_id"], errors="coerce")
    pid = pid.where(pid.notna(), pd.to_numeric(s["scorer_id"], errors="coerce"))
    out = pd.DataFrame({
        "game_id": s["game_id"].astype("int64").to_numpy(),
        "event_id": pd.to_numeric(s["event_id"], errors="coerce").astype("int64").to_numpy(),
        "player_id": pid.to_numpy(),
        "shot_type": s["shot_type"].fillna("Unknown").to_numpy(),
        "x": pd.to_numeric(s["x"], errors="coerce").to_numpy(),
        "y": pd.to_numeric(s["y"], errors="coerce").to_numpy(),
        "is_rebound": 0, "is_rush": 0,
        "score_differential": sd,
        "time_since_last_event": tsl.loc[keep].round(2).to_numpy(),
        "event_type": tc.loc[keep].astype(int).to_numpy(),
        "is_goal": (tc.loc[keep] == 505).astype(int).to_numpy(),
    })
    return out.dropna(subset=["x", "y"]).reset_index(drop=True)


@contextlib.contextmanager
def _in_pipeline_dir():
    cwd = os.getcwd()
    if PIPELINE_DIR not in sys.path:
        sys.path.insert(0, PIPELINE_DIR)
    os.chdir(PIPELINE_DIR)   # preprocess_data reads player_hand.json relative to cwd
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            yield
    finally:
        os.chdir(cwd)


def preprocess(rows: pd.DataFrame):
    with _in_pipeline_dir():
        from xg_model import preprocess_data
        return preprocess_data(rows)


def score(model, rows: pd.DataFrame) -> np.ndarray:
    X, _ = preprocess(rows)
    out = np.full(len(rows), np.nan)
    if len(X):
        out[rows.index.get_indexer(X.index)] = model.predict_proba(X)[:, 1]
    return out


def load_production():
    with open(V1_PKL, "rb") as f:
        return pickle.load(f)


def fit_pit(train_rows: pd.DataFrame):
    """The v1 recipe (xg_model.main) re-fit on ``train_rows`` only."""
    with _in_pipeline_dir():
        from sklearn.calibration import CalibratedClassifierCV
        from xg_model import preprocess_data, train_xgboost
        X, y = preprocess_data(train_rows)
        base = train_xgboost(X, y)
        cal = CalibratedClassifierCV(base, method="isotonic", cv=5)
        cal.fit(X, y)
    return cal
