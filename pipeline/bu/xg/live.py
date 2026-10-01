"""Live xG v2 scoring for the pipeline (DESIGN §3.1 "Live wiring", §5.2 flags).

``refresh_pipeline.stage_rescore_xg`` keeps its contract: it fills the season
shot CSV's ``xg_raw`` column (raw shot-model output; shooting talent and league
normalisation are applied afterwards and land in ``xG``).  The flag

    PONYXG_XG=v1|shadow|v2        (unset: ``DEFAULT_MODE`` below)

  v1      xg_raw from ``xg_model_xgb.pkl`` (the incumbent); no v2 work at all
  shadow  xg_raw from v1 (published numbers unchanged) plus the additive column
          ``xg_raw_v2`` from xG v2, so live shadow games accumulate (M1 gate (d))
  v2      xg_raw from xG v2 (v1 only for rows v2 cannot score yet) plus ``xg_raw_v2``

v2 needs the whole play sequence of a game (previous event, faceoff and
strength clocks), which the season CSV does not carry, so v2 scores from the
game's play-by-play: the lake copy when one exists
(``data/lake/raw/pbp/<season>/<game>.json.gz``), otherwise one GET of
``/v1/gamecenter/{id}/play-by-play`` per game with unscored shots.  The payload
is parsed with the lake parser (``bu.lake.parse.parse_game``) and featurised
with ``bu.xg.features.shot_features``, i.e. the exact training code path; rows
join back to the CSV on (game_id, event_id).  Rows v2 cannot score stay NaN in
``xg_raw_v2`` and are retried on the next run; under v2 their ``xg_raw`` holds
v1 until then (the games are queued in the manifest).

Artifacts (committed, JSON, no pickles):
  pipeline/models/xg2_booster.json      XGBoost booster
  pipeline/models/xg2_calibrators.json  meta (fit seasons, as-of date), empty-net logistic,
                                        penalty-shot rate, rink knots, optional Platt maps
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
MODES = ("v1", "shadow", "v2")
DEFAULT_MODE = "shadow"   # M1 gate not passed (see bu/xg/README.md): publish v1, log v2 in shadow
V2_COL = "xg_raw_v2"
XG_DECIMALS = 4
API_PBP = "https://api-web.nhle.com/v1/gamecenter/{gid}/play-by-play"

_MODEL = None


def artifacts_present(model_dir: str = MODEL_DIR) -> bool:
    return all(os.path.exists(os.path.join(model_dir, f"{PREFIX}_{k}.json")) for k in ("booster", "calibrators"))


def mode() -> str:
    """Active flag: ``v1``, ``shadow`` or ``v2`` (shadow/v2 fall back to v1 without the artifacts)."""
    m = (os.environ.get(MODE_ENV) or DEFAULT_MODE).strip().lower()
    if m not in MODES:
        m = DEFAULT_MODE
    if m != "v1" and not artifacts_present():
        print(f"  [WARN] {MODE_ENV}={m} but {MODEL_DIR}/{PREFIX}_*.json are missing; using v1")
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


def score_rows(rows: pd.DataFrame, fetch=fetch_pbp, model=None) -> tuple[pd.Series, dict]:
    """v2 xG for season-CSV shot rows (aligned to ``rows.index``; NaN where v2 could not score)."""
    out = pd.Series(np.nan, index=rows.index, dtype="float64")
    if rows.empty:
        return out, {"rows": 0, "scored": 0, "games": 0, "games_without_pbp": 0}
    gids = rows["game_id"].astype("int64")
    sc = score_games(gids.unique(), fetch=fetch, model=model)
    key = pd.DataFrame({"game_id": gids.to_numpy(), "event_id": pd.to_numeric(rows["event_id"], errors="coerce").to_numpy()},
                       index=rows.index)
    m = key.reset_index().merge(sc, on=["game_id", "event_id"], how="left").set_index("index")
    out.loc[m.index] = pd.to_numeric(m["xg_v2"], errors="coerce").to_numpy(dtype="float64")
    # rows whose game payload was read but whose event is not in it (the NHL edits PBP after the
    # fact and renumbers/removes plays): retrying cannot help, so the caller stops asking
    have = set(sc["game_id"])
    unmatched = key[out.isna() & key["game_id"].isin(have)]
    stats = {"rows": int(len(rows)), "scored": int(out.notna().sum()), "games": int(gids.nunique()),
             "games_without_pbp": int(len(set(gids) - have)),
             "unmatched_events": [[int(g), int(e)] for g, e in zip(unmatched["game_id"], unmatched["event_id"])
                                  if e == e]}
    return out, stats


# ------------------------------------------------------------- stage helpers

def active_hash(v1_hash_fn) -> str:
    """The ``xg_model`` hash recorded in the manifest for ``xg_raw``: v1 and shadow keep the
    pickle md5 (shadow publishes v1), v2 is tagged, so flipping v1 <-> v2 rescores the season."""
    return f"v2:{model_signature()}" if mode() == "v2" else v1_hash_fn()


def pending_mask(df: pd.DataFrame, prev_source: dict | None) -> pd.Series:
    """Rows whose ``xg_raw`` still holds v1 because v2 could not score them on an earlier v2 run."""
    games = set((prev_source or {}).get("v1_fallback_games") or [])
    if not games or mode() != "v2" or "game_id" not in df.columns:
        return pd.Series(False, index=df.index)
    return df["game_id"].astype("int64").isin({int(g) for g in games})


def fill_v2_column(df: pd.DataFrame, prev_source: dict | None, fetch=fetch_pbp) -> dict:
    """Shadow/v2: fill ``df[V2_COL]`` in place where it is missing (every row when the v2
    artifacts changed since the last run).  Returns what happened, for the manifest."""
    m = mode()
    if m == "v1":
        return {"v2_column": "off"}
    sig = model_signature()
    if V2_COL not in df.columns:
        df[V2_COL] = np.nan
    df[V2_COL] = pd.to_numeric(df[V2_COL], errors="coerce").astype("float64")
    need = df[V2_COL].isna()
    gone = {tuple(k) for k in (prev_source or {}).get("v2_unmatched_events") or []}
    if gone:
        keys = list(zip(df["game_id"].astype("int64"), pd.to_numeric(df["event_id"], errors="coerce")))
        need &= ~pd.Series([k in gone for k in keys], index=df.index)
    prev_sig = (prev_source or {}).get("v2_signature")
    if prev_sig and prev_sig != sig:
        print(f"  xG v2 artifacts changed ({prev_sig[:8]} -> {sig[:8]}): rescoring {V2_COL} for every shot")
        need[:] = True
        gone = set()
    info = {"v2_signature": sig, "v2_rows_scored": 0, "v2_missing_games": [],
            "v2_unmatched_events": sorted([list(k) for k in gone])}
    if need.any():
        # Never fail the run over v2: a broken model, library or feed leaves the column NaN
        # (shadow: nothing published changes; v2: those rows fall back to v1) and is retried.
        try:
            vals, st = score_rows(df[need], fetch=fetch)
            if vals.notna().any() and float(vals.mean()) > 0.15:
                raise ValueError(f"mean xG v2 {float(vals.mean()):.4f} - model/library mismatch?")
        except Exception as e:  # noqa: BLE001
            print(f"  [WARN] xG v2 scoring failed ({m}); left for the next run: {str(e)[:200]}")
            info["v2_error"] = str(e)[:200]
            info["v2_missing_games"] = sorted({int(g) for g in df.loc[need & df[V2_COL].isna(), "game_id"]})
            if prev_sig and prev_sig != sig:
                info["v2_signature"] = prev_sig   # retry the full rescore next run
            return info
        df.loc[need, V2_COL] = vals.round(XG_DECIMALS)
        info["v2_rows_scored"] = int(vals.notna().sum())
        new_gone = {tuple(k) for k in st.get("unmatched_events") or []}
        info["v2_unmatched_events"] = sorted([list(k) for k in gone | new_gone])
        still = need & df[V2_COL].isna()
        info["v2_missing_games"] = sorted({int(g) for g, e in zip(df.loc[still, "game_id"], df.loc[still, "event_id"])
                                           if (int(g), e) not in new_gone})
        print(f"  xG v2 ({m}): scored {info['v2_rows_scored']}/{int(need.sum())} shots in {st['games']} games"
              + (f"; {len(info['v2_missing_games'])} game(s) without a payload yet" if info["v2_missing_games"] else "")
              + (f"; {len(new_gone)} event(s) no longer in the feed" if new_gone else ""))
    return info


def score_shots(sub: pd.DataFrame, v1_score) -> tuple[np.ndarray, dict]:
    """``xg_raw`` for the season-CSV rows ``sub`` under the active flag.

    ``v1_score(rows) -> ndarray`` is the incumbent scorer (the pickle path).  Under v2 the
    values come from ``sub[V2_COL]`` (``fill_v2_column`` runs first); rows without one fall
    back to v1 and their games are listed in ``info["v1_fallback_games"]`` so the next run
    rescores them.  ``info["v1_rows"]`` marks rows holding v1 values (the empty-net constant
    applies only to those).
    """
    m = mode()
    info = {"mode": m, "rows": int(len(sub)), "v2_scored": 0, "v1_fallback_games": []}
    probs = np.full(len(sub), np.nan)
    if m == "v2" and V2_COL in sub.columns:
        probs = pd.to_numeric(sub[V2_COL], errors="coerce").to_numpy(dtype="float64").copy()
        info["v2_scored"] = int(np.isfinite(probs).sum())
    v1_rows = ~np.isfinite(probs)
    if v1_rows.any():
        probs[v1_rows] = np.asarray(v1_score(sub[v1_rows]), dtype="float64")
        if m == "v2":
            info["v1_fallback_games"] = sorted({int(g) for g in sub.loc[v1_rows, "game_id"]})
    info["v1_rows"] = v1_rows
    return probs, info
