"""xG v2 model: XGBoost + per-strength logit calibration + empty-net logistic (DESIGN §3.1).

* Non-empty-net, non-penalty-shot attempts: XGBoost (``hist``, fixed seed and
  ``nthread``) on ``features.FEATURES``.  The number of trees is chosen by early
  stopping on a game-grouped 10% slice of the *training* window.
* Calibration: a Platt map ``a + b * logit(p)`` per strength class, fit on
  game-grouped out-of-fold predictions over the training window (GroupKFold by
  game).  Classes with fewer than ``MIN_CAL_N`` shots use the pooled map.
  Deviation from DESIGN §3.1 (isotonic): on both dev folds the isotonic map
  made held-out log loss worse (+0.0006 / +0.0004 per shot; it is fit on fold
  models that are weaker than the final booster, so it over-sharpens), while
  the 2-parameter map is neutral (+0.00003 / -0.00002).  Numbers:
  ``bu/xg/out/xgv2_dev_experiments.json``.
* Empty-net shots: a logistic on distance / log-distance / angle.
* Penalty shots: the window's shrunk goal rate.

Everything except the booster is stored as JSON (thresholds + values,
coefficients); the booster is XGBoost's own JSON format.  No pickles.
"""
from __future__ import annotations

import hashlib
import json
import os

import numpy as np
import pandas as pd

from .features import FEATURES, STRENGTH_CLASSES

PARAMS = {
    "objective": "binary:logistic",
    "eval_metric": "logloss",
    "tree_method": "hist",
    "max_depth": 6,
    "learning_rate": 0.04,
    "min_child_weight": 25,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "reg_lambda": 5.0,
    "max_bin": 256,
    "seed": 20261001,
    "nthread": 8,
}
MAX_ROUNDS = 3000
EARLY_STOP = 75
N_CAL_FOLDS = 4
MIN_CAL_N = 1500
PS_PRIOR = (0.32, 30.0)      # penalty shots: prior rate and pseudo-shots
SEASON_WEIGHTS = {"20202021": 0.5}   # empty arenas; scorer bias uncertain (DESIGN §3.1)
EN_FEATURES = ["distance", "log_distance", "angle"]


def config_hash(extra: dict | None = None) -> str:
    blob = json.dumps({"params": PARAMS, "features": FEATURES, "max_rounds": MAX_ROUNDS, "early": EARLY_STOP,
                       "cal_folds": N_CAL_FOLDS, "min_cal_n": MIN_CAL_N, "ps": PS_PRIOR,
                       "season_w": SEASON_WEIGHTS, "calibration": "platt-per-strength", **(extra or {})}, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:12]


def _xgb():
    import xgboost as xgb
    return xgb


def _is_main(df: pd.DataFrame) -> np.ndarray:
    return ~df["strength_class"].isin(["EN", "PS"]).to_numpy() & df["distance"].notna().to_numpy()


def _weights(df: pd.DataFrame) -> np.ndarray:
    return df["season"].astype(str).map(SEASON_WEIGHTS).fillna(1.0).to_numpy(dtype="float64")


def _group_split(game_ids: np.ndarray, frac: float, seed: int) -> np.ndarray:
    """Boolean mask of a game-grouped random slice."""
    ug = np.unique(game_ids)
    rng = np.random.default_rng(seed)
    pick = set(rng.choice(ug, size=max(1, int(len(ug) * frac)), replace=False).tolist())
    return np.isin(game_ids, list(pick))


def _fit_booster(X, y, w, groups, params=None, rounds=None):
    xgb = _xgb()
    p = dict(PARAMS, **(params or {}))
    if rounds is None:
        va = _group_split(groups, 0.10, p["seed"])
        dtr = xgb.DMatrix(X[~va], label=y[~va], weight=w[~va], missing=np.nan)
        dva = xgb.DMatrix(X[va], label=y[va], weight=w[va], missing=np.nan)
        b = xgb.train(p, dtr, num_boost_round=MAX_ROUNDS, evals=[(dva, "va")],
                      early_stopping_rounds=EARLY_STOP, verbose_eval=False)
        rounds = int(b.best_iteration) + 1
    dall = xgb.DMatrix(X, label=y, weight=w, missing=np.nan)
    b = xgb.train(p, dall, num_boost_round=rounds, verbose_eval=False)
    return b, rounds


def _predict_booster(b, X) -> np.ndarray:
    xgb = _xgb()
    return b.predict(xgb.DMatrix(X, missing=np.nan))


def _logit(p):
    p = np.clip(np.asarray(p, dtype="float64"), 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def _platt_fit(p, y, w=None) -> dict:
    """Weighted logistic y ~ a + b*logit(p) by IRLS."""
    z = _logit(p)
    y = np.asarray(y, dtype="float64")
    w = np.ones_like(z) if w is None else np.asarray(w, dtype="float64")
    X = np.column_stack([np.ones_like(z), z])
    beta = np.array([0.0, 1.0])
    for _ in range(50):
        mu = 1 / (1 + np.exp(-(X @ beta)))
        W = w * mu * (1 - mu)
        H = X.T @ (X * W[:, None]) + 1e-9 * np.eye(2)
        step = np.linalg.solve(H, X.T @ (w * (y - mu)))
        beta = beta + step
        if np.abs(step).max() < 1e-10:
            break
    return {"a": float(beta[0]), "b": float(beta[1]), "n": int(len(z))}


def _platt_apply(cal: dict, p: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-(cal["a"] + cal["b"] * _logit(p))))


def _en_design(df: pd.DataFrame) -> np.ndarray:
    d = pd.to_numeric(df["distance"], errors="coerce").fillna(60.0).to_numpy()
    a = pd.to_numeric(df["angle"], errors="coerce").fillna(30.0).to_numpy()
    return np.column_stack([d, np.log1p(d), a])


class XGv2:
    """A fitted fold (or the production model)."""

    def __init__(self, booster=None, calibrators=None, en=None, ps_rate=None, meta=None, rink=None):
        self.booster = booster
        self.calibrators = calibrators or {}
        self.en = en or {}
        self.ps_rate = ps_rate
        self.meta = meta or {}
        self.rink = rink

    # ------------------------------------------------------------------ fit
    @classmethod
    def fit(cls, train: pd.DataFrame, *, params=None, calibrate: bool = True, log=print,
            fit_seasons=None, rink=None, sample_weight=None, extra_meta=None) -> "XGv2":
        """``sample_weight`` (aligned with ``train``) multiplies the era weights (season decay,
        current-season weight for as-of refits)."""
        from sklearn.linear_model import LogisticRegression
        from sklearn.model_selection import GroupKFold
        sw = np.ones(len(train)) if sample_weight is None else np.asarray(sample_weight, dtype="float64")
        keep = sw > 0
        train, sw = train[keep], sw[keep]
        main = _is_main(train)
        tr = train[main]
        X = tr[FEATURES].to_numpy(dtype="float64")
        y = tr["is_goal"].to_numpy(dtype="float64")
        w = _weights(tr) * sw[main]
        groups = tr["game_id"].to_numpy()
        booster, rounds = _fit_booster(X, y, w, groups, params)
        log(f"    booster: {len(tr):,} shots, {rounds} trees")

        calibrators = {}
        if calibrate:
            oof = np.full(len(tr), np.nan)
            for k, (a, b) in enumerate(GroupKFold(n_splits=N_CAL_FOLDS).split(X, y, groups)):
                bk, _ = _fit_booster(X[a], y[a], w[a], groups[a], params, rounds=rounds)
                oof[b] = _predict_booster(bk, X[b])
            sc = tr["strength_class"].to_numpy()
            calibrators["_pooled"] = _platt_fit(oof, y, w)
            for c in STRENGTH_CLASSES:
                m = sc == c
                if m.sum() >= MIN_CAL_N:
                    calibrators[c] = _platt_fit(oof[m], y[m], w[m])
            log(f"    calibrators: {sorted(k for k in calibrators if k != '_pooled')} + pooled")

        en_m = (train["strength_class"].eq("EN") & train["distance"].notna()).to_numpy()
        en = train[en_m]
        en_model = {}
        if len(en) >= 50:
            lr = LogisticRegression(C=1.0, max_iter=2000)
            Z = _en_design(en)
            mu, sd = Z.mean(0), Z.std(0) + 1e-9
            lr.fit((Z - mu) / sd, en["is_goal"].to_numpy(), sample_weight=sw[en_m])
            en_model = {"features": EN_FEATURES, "mu": mu.tolist(), "sd": sd.tolist(),
                        "coef": lr.coef_[0].tolist(), "intercept": float(lr.intercept_[0]), "n": int(len(en))}
        ps = train[train["strength_class"].eq("PS")]
        p0, k = PS_PRIOR
        ps_rate = float((ps["is_goal"].sum() + p0 * k) / (len(ps) + k))
        meta = {"features": FEATURES, "params": dict(PARAMS, **(params or {})), "n_trees": rounds,
                "n_train": int(len(train)), "n_train_main": int(len(tr)),
                "fit_seasons": sorted(set((fit_seasons or train["season"].astype(str).unique()))),
                "config_hash": config_hash(), "train_goal_rate": float(train["is_goal"].mean()),
                **(extra_meta or {})}
        return cls(booster, calibrators, en_model, ps_rate, meta, rink)

    # -------------------------------------------------------------- predict
    def predict_raw(self, df: pd.DataFrame) -> np.ndarray:
        X = df[FEATURES].to_numpy(dtype="float64")
        return _predict_booster(self.booster, X)

    def predict(self, df: pd.DataFrame, calibrated: bool = True) -> np.ndarray:
        out = np.full(len(df), np.nan)
        sc = df["strength_class"].to_numpy()
        main = _is_main(df)
        if main.any():
            raw = self.predict_raw(df[main])
            if calibrated and self.calibrators:
                cal = np.empty_like(raw)
                scm = sc[main]
                for c in np.unique(scm):
                    m = scm == c
                    cal[m] = _platt_apply(self.calibrators.get(c, self.calibrators["_pooled"]), raw[m])
                raw = cal
            out[main] = raw
        en = (sc == "EN") & df["distance"].notna().to_numpy()
        if en.any() and self.en:
            Z = (_en_design(df[en]) - np.asarray(self.en["mu"])) / np.asarray(self.en["sd"])
            out[en] = 1.0 / (1.0 + np.exp(-(Z @ np.asarray(self.en["coef"]) + self.en["intercept"])))
        out[sc == "PS"] = self.ps_rate if self.ps_rate is not None else 0.32
        # rows without coordinates: the class mean of the training window is not stored;
        # use the pooled calibrated mean of a typical attempt
        miss = np.isnan(out)
        if miss.any():
            out[miss] = float(self.meta.get("train_goal_rate", 0.07))
        return np.clip(out, 1e-4, 0.999)

    # ------------------------------------------------------------------- io
    def save(self, directory: str, prefix: str = "xg2") -> dict:
        os.makedirs(directory, exist_ok=True)
        bpath = os.path.join(directory, f"{prefix}_booster.json")
        self.booster.save_model(bpath)
        side = {"meta": self.meta, "calibrators": self.calibrators, "empty_net": self.en,
                "penalty_shot_rate": self.ps_rate,
                "rink": self.rink.to_json() if self.rink is not None else None}
        cpath = os.path.join(directory, f"{prefix}_calibrators.json")
        with open(cpath, "w") as f:
            json.dump(side, f, indent=1, sort_keys=True)
            f.write("\n")
        return {"booster": bpath, "calibrators": cpath}

    @classmethod
    def load(cls, directory: str, prefix: str = "xg2") -> "XGv2":
        from .rink import RinkAdjuster
        xgb = _xgb()
        b = xgb.Booster()
        b.load_model(os.path.join(directory, f"{prefix}_booster.json"))
        b.set_param({"nthread": PARAMS["nthread"]})
        with open(os.path.join(directory, f"{prefix}_calibrators.json")) as f:
            side = json.load(f)
        return cls(b, side.get("calibrators"), side.get("empty_net"), side.get("penalty_shot_rate"),
                   side.get("meta"), RinkAdjuster.from_json(side.get("rink")))
