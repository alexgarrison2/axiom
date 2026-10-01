"""Per-shot xG for the lake's unblocked shots, plus the flurry adjustment (DESIGN §3.1-3.2).

Sources (``--xg``):

* ``v1`` (default today): the current shot model ``pipeline/xg_model_xgb.pkl`` re-scored on
  the lake's shots with its own ``xg_model.preprocess_data`` features.  Caveat (DESIGN §1.3):
  v1 was trained on a random 80/20 split over 2022-26, so its xG is in-sample for those
  seasons.  It is a *target* here, not a predictor, which limits the damage; swap to v2 when
  it lands.
* ``v2``: the live xG v2 artifacts (``pipeline/models/xg2_*.json``, ``bu.xg.live``) scored on
  the lake's events with the training feature path (``bu.xg.features.shot_features``).  This is
  what the daily serving-bundle refresh uses for the current season, so the live RAPM target is
  the same model the pipeline publishes.  ``v2:<dir>`` scores with the artifacts in ``<dir>``.
* a path (file or directory) of parquet with ``game_id, event_id, xg`` (e.g. xG v2 per fold
  written by ``bu.xg``).  A directory is read as ``season=S.parquet`` / ``season=S/*.parquet``.
  The historical chain uses the walk-forward out-of-sample ``xg2_asof`` this way
  (``bu.rapm.v2_source``), so no season's target is scored by a model that saw it or later.

``xg_flurry = xg * prod(1 - xg_prev)`` over earlier shots of the same team in the same
flurry (consecutive unblocked shots <= 3 s apart).  It is the RAPM target.
"""
from __future__ import annotations

import contextlib
import glob
import io
import os
import pickle

import numpy as np
import pandas as pd

from bu.lake.build import read_table
from bu.lake.paths import PIPELINE_DIR, Lake

FLURRY_GAP_S = 3
V1_MODEL = os.path.join(PIPELINE_DIR, "xg_model_xgb.pkl")


def flurry_adjust(df: pd.DataFrame, gap: int = FLURRY_GAP_S) -> np.ndarray:
    """df: game_id, shooting_team_id, game_seconds, sort_order, xg (unblocked shots only)."""
    d = df[["game_id", "shooting_team_id", "game_seconds", "sort_order", "xg"]].copy()
    d["_i"] = np.arange(len(d))
    d = d.sort_values(["game_id", "shooting_team_id", "game_seconds", "sort_order"], kind="stable")
    g = d["game_id"].to_numpy()
    t = d["shooting_team_id"].to_numpy()
    s = d["game_seconds"].to_numpy(dtype=float)
    x = d["xg"].to_numpy(dtype=float)
    out = np.empty(len(d))
    keep = 1.0  # prod(1 - xg_prev) within the running flurry
    for k in range(len(d)):
        if k == 0 or g[k] != g[k - 1] or t[k] != t[k - 1] or s[k] - s[k - 1] > gap:
            keep = 1.0
        xv = 0.0 if np.isnan(x[k]) else x[k]
        out[k] = xv * keep
        keep *= (1.0 - xv)
    res = np.empty(len(d))
    res[d["_i"].to_numpy()] = out
    return res


def _time_since_last(lake: Lake, season: str) -> pd.DataFrame:
    ev = read_table(lake, "events", [season], columns=["game_id", "event_id", "sort_order", "game_seconds",
                                                       "period_type"])
    ev = ev[ev["period_type"] != "SO"].sort_values(["game_id", "sort_order"], kind="stable")
    gs = ev["game_seconds"].astype("float64")
    prev = gs.groupby(ev["game_id"]).shift(1)
    ev["time_since_last_event"] = (gs - prev).fillna(0).clip(lower=0)
    return ev[["game_id", "event_id", "time_since_last_event"]]


def score_v1(lake: Lake, season: str, shots: pd.DataFrame) -> pd.Series:
    """Re-score unblocked lake shots with xg_model_xgb.pkl (features as the live scraper builds them)."""
    tsl = _time_since_last(lake, season)
    s = shots.merge(tsl, on=["game_id", "event_id"], how="left")
    home = s["acting_is_home"].astype("boolean").fillna(False).to_numpy(dtype=bool)
    hs = s["home_score"].astype("float64").fillna(0)
    as_ = s["away_score"].astype("float64").fillna(0)
    v1 = pd.DataFrame({
        "event_type": s["type_code"].astype(int),
        "player_id": s["shooter_id"].astype("Int64").astype(str),
        "x": s["x"].astype(float).fillna(0.0), "y": s["y"].astype(float).fillna(0.0),
        "shot_type": s["shot_type"].fillna("Unknown"),
        "is_rebound": 0, "is_rush": 0,  # always 0 in v1's training data (DESIGN §3.0)
        "score_differential": np.where(home, hs - as_, as_ - hs),
        "time_since_last_event": s["time_since_last_event"].fillna(0.0),
        "is_goal": s["is_goal"].astype(int),
    }, index=s.index)
    import sys
    if PIPELINE_DIR not in sys.path:
        sys.path.insert(0, PIPELINE_DIR)
    cwd = os.getcwd()
    try:
        os.chdir(PIPELINE_DIR)  # preprocess_data reads player_hand.json relative to cwd
        from xg_model import preprocess_data
        with open(V1_MODEL, "rb") as f:
            model = pickle.load(f)
        with contextlib.redirect_stdout(io.StringIO()):
            X, _ = preprocess_data(v1)
    finally:
        os.chdir(cwd)
    out = pd.Series(np.nan, index=s.index)
    if len(X):
        out.loc[X.index] = model.predict_proba(X)[:, 1]
    out.index = shots.index
    return out


def score_v2(lake: Lake, season: str, model_dir: str | None = None) -> pd.DataFrame:
    """(game_id, event_id, xg) from xG v2 for every unblocked regular/playoff lake shot of ``season``."""
    from bu.xg import handedness
    from bu.xg.features import shot_features
    from bu.xg.live import MODEL_DIR
    from bu.xg.model import XGv2
    model = XGv2.load(model_dir or MODEL_DIR, "xg2")
    ev = read_table(lake, "events", [season])
    g = read_table(lake, "games", [season])
    if ev.empty:
        return pd.DataFrame(columns=["game_id", "event_id", "xg"])
    keep = set(g.loc[pd.to_numeric(g["game_type"], errors="coerce").isin([2, 3]), "game_id"])
    ev = ev[ev["game_id"].isin(keep)]
    f = shot_features(ev, g, handedness.load(), rink=model.rink)
    if f.empty:
        return pd.DataFrame(columns=["game_id", "event_id", "xg"])
    out = pd.DataFrame({"game_id": f["game_id"].astype("int64").to_numpy(),
                        "event_id": pd.to_numeric(f["event_id"], errors="coerce").astype("int64").to_numpy(),
                        "xg": model.predict(f)})
    return out.drop_duplicates(["game_id", "event_id"])


def _read_external(source: str, season: str) -> pd.DataFrame:
    if os.path.isfile(source):
        files = [source]
    else:
        files = sorted(glob.glob(os.path.join(source, f"season={season}.parquet"))
                       + glob.glob(os.path.join(source, f"season={season}", "*.parquet"))
                       + glob.glob(os.path.join(source, f"*{season}*.parquet")))
    if not files:
        raise FileNotFoundError(f"no xG parquet for season {season} under {source}")
    d = pd.concat([pd.read_parquet(f, columns=None) for f in files], ignore_index=True)
    col = "xg" if "xg" in d.columns else next(c for c in ("xg_v2", "xg_raw", "xG") if c in d.columns)
    return d[["game_id", "event_id", col]].rename(columns={col: "xg"}).drop_duplicates(["game_id", "event_id"])


def build_xg(lake: Lake, season: str, source: str = "v1") -> pd.DataFrame:
    """Unblocked, non-shootout, non-penalty-shot attempts with xg + xg_flurry."""
    cols = ["game_id", "event_id", "sort_order", "period", "game_seconds", "type_code", "is_goal",
            "shooting_team_id", "acting_is_home", "shooter_id", "shot_type", "x", "y", "home_score",
            "away_score", "strength", "empty_net_against", "is_penalty_shot", "is_unblocked"]
    shots = read_table(lake, "shots", [season], columns=cols)
    if shots.empty:
        return pd.DataFrame()
    shots = shots[shots["is_unblocked"].astype(bool) & ~shots["is_penalty_shot"].astype("boolean").fillna(False)]
    shots = shots.reset_index(drop=True)
    if source == "v1":
        shots["xg"] = score_v1(lake, season, shots).to_numpy()
    elif source == "v2" or source.startswith("v2:"):
        sc = score_v2(lake, season, source[3:] or None)
        shots = shots.merge(sc, on=["game_id", "event_id"], how="left")
    else:
        ext = _read_external(source, season)
        shots = shots.merge(ext, on=["game_id", "event_id"], how="left")
    shots["xg_source"] = source if source in ("v1", "v2") else os.path.basename(os.path.normpath(source))
    shots["xg_flurry"] = flurry_adjust(shots)
    keep = ["game_id", "event_id", "period", "game_seconds", "shooting_team_id", "acting_is_home", "shooter_id",
            "is_goal", "strength", "empty_net_against", "xg", "xg_flurry", "xg_source"]
    return shots[keep]
