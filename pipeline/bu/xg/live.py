"""Live xG v2 scoring for the pipeline (DESIGN §3.1 "Live wiring", §5.2 flags).

``refresh_pipeline.stage_rescore_xg`` keeps its contract: it fills the season
shot CSV's ``xg_raw`` column (raw shot-model output; shooting talent and league
normalisation are applied afterwards and land in ``xG``).  Which model fills
it is chosen by the flag

    PONYXG_XG=v1|v2        (unset: ``DEFAULT_MODE`` below)

v2 needs the whole play sequence of a game (previous event, faceoff and
strength clocks), which the season CSV does not carry, so v2 scores from the
game's play-by-play: the lake copy when one exists
(``data/lake/raw/pbp/<season>/<game>.json.gz``), otherwise one GET of
``/v1/gamecenter/{id}/play-by-play`` per game that has unscored shots.  The
payload is parsed with the lake parser (``bu.lake.parse.parse_game``) and
featurised with ``bu.xg.features.shot_features``, i.e. the exact training code
path; rows join back to the CSV on (game_id, event_id).  Any row v2 cannot
score (payload unavailable, event missing) is left for the v1 fallback, and the
counts are returned so the stage can report them.

Artifacts (committed, JSON, no pickles):
  pipeline/models/xg2_booster.json      XGBoost booster
  pipeline/models/xg2_calibrators.json  per-strength Platt maps, empty-net logistic,
                                        penalty-shot rate, rink knots, meta
  pipeline/bu/xg/models/handedness.json shooter handedness
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE_DIR = os.path.dirname(os.path.dirname(HERE))
MODEL_DIR = os.path.join(PIPELINE_DIR, "models")
PREFIX = "xg2"
MODE_ENV = "PONYXG_XG"
DEFAULT_MODE = "v1"
API_PBP = "https://api-web.nhle.com/v1/gamecenter/{gid}/play-by-play"

_MODEL = None


def artifacts_present(model_dir: str = MODEL_DIR) -> bool:
    return all(os.path.exists(os.path.join(model_dir, f"{PREFIX}_{k}.json")) for k in ("booster", "calibrators"))


def mode() -> str:
    """Active shot model: ``v1`` or ``v2`` (v2 falls back to v1 when its artifacts are missing)."""
    m = (os.environ.get(MODE_ENV) or DEFAULT_MODE).strip().lower()
    if m not in ("v1", "v2"):
        m = DEFAULT_MODE
    if m == "v2" and not artifacts_present():
        print(f"  [WARN] {MODE_ENV}=v2 but {MODEL_DIR}/{PREFIX}_*.json are missing; using v1")
        m = "v1"
    return m


def model_signature(model_dir: str = MODEL_DIR) -> str:
    """Hash of the v2 artifacts (+ handedness map): a change triggers a full-season rescore."""
    h = hashlib.md5(b"xg-v2")
    for p in (os.path.join(model_dir, f"{PREFIX}_booster.json"), os.path.join(model_dir, f"{PREFIX}_calibrators.json"),
              os.path.join(HERE, "models", "handedness.json")):
        if os.path.exists(p):
            with open(p, "rb") as f:
                h.update(f.read())
    return h.hexdigest()


def load_model(model_dir: str = MODEL_DIR):
    global _MODEL
    if _MODEL is None or getattr(_MODEL, "_dir", None) != model_dir:
        from .model import XGv2
        _MODEL = XGv2.load(model_dir, PREFIX)
        _MODEL._dir = model_dir
    return _MODEL


def _season_of(gid) -> str:
    y = int(str(gid)[:4])
    return f"{y}{y + 1}"


def fetch_pbp(game_id, lake_root: str | None = None) -> dict | None:
    """The game's PBP: lake copy if present, else the NHL API (cached into the lake when it exists)."""
    from bu.lake.paths import Lake
    lake = Lake(lake_root)
    path = lake.raw_path("pbp", _season_of(game_id), int(game_id))
    if os.path.exists(path):
        with gzip.open(path, "rb") as f:
            return json.loads(f.read().decode("utf-8"))
    from http_utils import HttpError, request_bytes
    try:
        body = request_bytes(API_PBP.format(gid=int(game_id)), timeout=20, retries=3, ua="plain", quiet=True)
        d = json.loads(body.decode("utf-8"))
    except (HttpError, ValueError) as e:
        print(f"  [WARN] xG v2: PBP {game_id} unavailable ({str(e)[:80]})")
        return None
    if not isinstance(d, dict) or not d.get("plays"):
        return None
    if os.path.isdir(lake.raw_dir) and d.get("gameState") in ("OFF", "FINAL"):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(gzip.compress(body, 6))
        os.replace(tmp, path)
    return d


def featurise_payloads(payloads: dict, hand: dict | None = None, rink=None) -> pd.DataFrame:
    """{game_id: pbp payload} -> v2 feature rows (the training code path)."""
    from bu.lake.parse import parse_game
    from .features import shot_features
    from . import handedness
    hand = handedness.load() if hand is None else hand
    evs, games = [], []
    for gid, pbp in payloads.items():
        if not pbp:
            continue
        r = parse_game(pbp, None, None, None, season=_season_of(gid))
        if r["events"] is not None and len(r["events"]):
            evs.append(r["events"])
            games.append(r["games"])
    if not evs:
        return pd.DataFrame()
    return shot_features(pd.concat(evs, ignore_index=True), pd.concat(games, ignore_index=True), hand, rink=rink)


def score_games(game_ids, fetch=fetch_pbp, model=None) -> pd.DataFrame:
    """(game_id, event_id, xg_v2, strength_class) for every unblocked shot of ``game_ids``."""
    model = model or load_model()
    payloads = {int(g): fetch(int(g)) for g in sorted({int(g) for g in game_ids})}
    feats = featurise_payloads(payloads, rink=model.rink)
    if feats.empty:
        return pd.DataFrame(columns=["game_id", "event_id", "xg_v2", "strength_class"])
    feats["xg_v2"] = model.predict(feats)
    out = feats[["game_id", "event_id", "xg_v2", "strength_class"]].copy()
    out["game_id"] = out["game_id"].astype("int64")
    out["event_id"] = pd.to_numeric(out["event_id"], errors="coerce").astype("int64")
    return out.drop_duplicates(["game_id", "event_id"])


def active_hash(v1_hash_fn) -> str:
    """The ``xg_model`` hash recorded in the manifest: v1 keeps its historical pickle md5,
    v2 is tagged, so switching the flag either way forces a full-season rescore."""
    return v1_hash_fn() if mode() == "v1" else f"v2:{model_signature()}"


def pending_mask(df: pd.DataFrame, prev_source: dict | None) -> pd.Series:
    """Rows of games that v2 could not score on an earlier run (they hold v1 values)."""
    games = set((prev_source or {}).get("v1_fallback_games") or [])
    if not games or mode() != "v2" or "game_id" not in df.columns:
        return pd.Series(False, index=df.index)
    return df["game_id"].astype("int64").isin({int(g) for g in games})


def score_shots(sub: pd.DataFrame, v1_score, fetch=fetch_pbp) -> tuple[np.ndarray, dict]:
    """``xg_raw`` for the season-CSV rows ``sub`` under the active flag.

    ``v1_score(rows) -> ndarray`` is the incumbent scorer (the pickle path).  Under v2,
    rows v2 cannot score (no payload yet) fall back to v1 and their games are listed in
    ``info["v1_fallback_games"]`` so the next run rescores them.  ``info["v1_rows"]``
    marks the rows that hold v1 values (the empty-net override applies only to those).
    """
    m = mode()
    info = {"mode": m, "rows": int(len(sub)), "v2_scored": 0, "v1_fallback_games": []}
    probs = np.full(len(sub), np.nan)
    if m == "v2" and len(sub):
        v2, st = score_rows(sub, fetch=fetch)
        probs = v2.to_numpy(dtype="float64")
        info["v2_scored"] = st["scored"]
        info["games"] = st["games"]
    v1_rows = np.isnan(probs)
    if v1_rows.any():
        probs[v1_rows] = np.asarray(v1_score(sub[v1_rows]), dtype="float64")
        if m == "v2":
            info["v1_fallback_games"] = sorted({int(g) for g in sub.loc[v1_rows, "game_id"]})
    info["v1_rows"] = v1_rows
    return probs, info


def score_rows(rows: pd.DataFrame, fetch=fetch_pbp, model=None) -> tuple[pd.Series, dict]:
    """v2 xG for season-CSV shot rows (aligned to ``rows.index``; NaN where v2 could not score)."""
    out = pd.Series(np.nan, index=rows.index, dtype="float64")
    if rows.empty:
        return out, {"rows": 0, "scored": 0, "games": 0}
    gids = rows["game_id"].astype("int64")
    sc = score_games(gids.unique(), fetch=fetch, model=model)
    key = pd.DataFrame({"game_id": gids.to_numpy(), "event_id": pd.to_numeric(rows["event_id"], errors="coerce").to_numpy()},
                       index=rows.index)
    m = key.reset_index().merge(sc, on=["game_id", "event_id"], how="left").set_index("index")
    out.loc[m.index] = pd.to_numeric(m["xg_v2"], errors="coerce").to_numpy(dtype="float64")
    stats = {"rows": int(len(rows)), "scored": int(out.notna().sum()), "games": int(gids.nunique()),
             "games_without_pbp": int(len(set(gids) - set(sc["game_id"])))}
    return out, stats
