"""Shot-level metrics for the xG v2 report."""
from __future__ import annotations

import numpy as np
import pandas as pd

EPS = 1e-6


def _clip(p):
    return np.clip(np.asarray(p, dtype="float64"), EPS, 1 - EPS)


def ll_vec(y, p):
    p = _clip(p)
    y = np.asarray(y, dtype="float64")
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def auc(y, p) -> float:
    from sklearn.metrics import roc_auc_score
    y = np.asarray(y)
    return float(roc_auc_score(y, p)) if 0 < y.sum() < len(y) else float("nan")


def cal_slope(y, p) -> dict:
    """Logistic recalibration y ~ a + b*logit(p) (IRLS): slope b, intercept a, Wald SE of b."""
    y = np.asarray(y, dtype="float64")
    z = np.log(_clip(p) / (1 - _clip(p)))
    X = np.column_stack([np.ones_like(z), z])
    beta = np.array([0.0, 1.0])
    for _ in range(50):
        eta = X @ beta
        mu = 1 / (1 + np.exp(-eta))
        W = mu * (1 - mu)
        H = X.T @ (X * W[:, None])
        g = X.T @ (y - mu)
        step = np.linalg.solve(H + 1e-9 * np.eye(2), g)
        beta = beta + step
        if np.abs(step).max() < 1e-10:
            break
    cov = np.linalg.inv(H)
    return {"intercept": float(beta[0]), "slope": float(beta[1]), "slope_se": float(np.sqrt(cov[1, 1]))}


def reliability(y, p, bins: int = 10) -> list[dict]:
    d = pd.DataFrame({"y": np.asarray(y, dtype="float64"), "p": np.asarray(p, dtype="float64")})
    d["bin"] = pd.qcut(d["p"].rank(method="first"), bins, labels=False)
    g = d.groupby("bin").agg(n=("y", "size"), mean_p=("p", "mean"), rate=("y", "mean"))
    return [{k: (round(float(v), 5) if k != "n" else int(v)) for k, v in r.items()} for r in g.to_dict("records")]


def summary(y, p, groups=None) -> dict:
    y = np.asarray(y, dtype="float64")
    p = np.asarray(p, dtype="float64")
    out = {"n": int(len(y)), "goals": int(y.sum()), "xg": round(float(p.sum()), 2),
           "goals_per_xg": round(float(y.sum() / p.sum()), 4) if p.sum() > 0 else None,
           "log_loss": round(float(ll_vec(y, p).mean()), 6), "auc": round(auc(y, p), 5),
           "brier": round(float(np.mean((p - y) ** 2)), 6)}
    cs = cal_slope(y, p)
    out["cal_slope"] = round(cs["slope"], 4)
    out["cal_slope_se"] = round(cs["slope_se"], 4)
    out["cal_intercept"] = round(cs["intercept"], 4)
    return out


def paired_diff(y, pa, pb, groups) -> dict:
    """Mean per-shot LL(a) - LL(b), SE clustered by game."""
    d = pd.DataFrame({"g": np.asarray(groups), "d": ll_vec(y, pa) - ll_vec(y, pb)})
    per = d.groupby("g")["d"].agg(["sum", "size"])
    n = per["size"].sum()
    mean = per["sum"].sum() / n
    # cluster-robust SE of a ratio estimator
    resid = per["sum"] - mean * per["size"]
    k = len(per)
    se = float(np.sqrt(k / (k - 1) * (resid ** 2).sum()) / n) if k > 1 else float("nan")
    return {"mean": round(float(mean), 6), "se": round(se, 6),
            "ci95": [round(float(mean - 1.96 * se), 6), round(float(mean + 1.96 * se), 6)], "n_games": int(k)}


def by_group(y, p, keys, min_n: int = 1) -> dict:
    d = pd.DataFrame({"y": np.asarray(y, dtype="float64"), "p": np.asarray(p, dtype="float64"), "k": np.asarray(keys)})
    out = {}
    for k, g in d.groupby("k"):
        if len(g) < min_n:
            continue
        out[str(k)] = {"n": int(len(g)), "goals": int(g["y"].sum()), "xg": round(float(g["p"].sum()), 2),
                       "goals_per_xg": round(float(g["y"].sum() / g["p"].sum()), 4) if g["p"].sum() > 0 else None,
                       "log_loss": round(float(ll_vec(g["y"], g["p"]).mean()), 6)}
    return out
