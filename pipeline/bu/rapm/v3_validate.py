"""Ratings v3 validation: next-30-game stint prediction, walk-forward (``bu/rapm/v3_prereg.json``).

Primary metric (owner decision 2026-10-02): predict each player's NEXT 30 GAMES at stint level.
For every scored season S and as-of point ``g`` in ``ASOF_G`` (games per team played this season,
on the league clock of ``recency``), the ratings are fitted as the live path would at the first
date with ``g`` games played (stage-1 prior interpolated on the pack grid, stage-2 in-season fit on
games up to ``d - LAG_DAYS``), then scored on every EV stint row of the regular-season games in the
next ``HORIZON`` = 30 games per team:

* players fixed at the as-of ratings, the shared covariates (league level, home, score, zone,
  strength, back-to-back) refit on the test rows - the next-period stint metric of the RAPM
  audit, Gram-exact (``Design.date_sse``);
* score: stint-seconds-weighted MSE of the attacking side's xG/60 (EV: xGF and xGA of both teams
  given the lineups on the ice); ``gain`` = MSE(covariates only) - MSE(model);
* calibration: on the same rows, residual ~ a * (sum of attackers' OFF) + b * (sum of defenders'
  DEF) with the covariates partialled out per window and pooled (target a = b = 1);
* paired differences between candidates are clustered by game date (a date can sit in up to three
  overlapping windows; its differences are summed first).

Secondary: the season-start prior scored on the whole regular season ("next season", ``g = 0``,
``window = 'season'``), the same for PP rows (``kind = 'st'``: PP side's xG/60, PP / PK ratings).
"""
from __future__ import annotations

import json
import math
import os

import numpy as np
import pandas as pd
import scipy.sparse as sp

from . import v3 as V
from .recency import Recency

ASOF_G = (0.0, 10.0, 20.0, 30.0, 40.0, 50.0)
HORIZON = 30.0
TUNE = ("20192020", "20202021", "20212022", "20222023")
DEV = ("20232024", "20242025")
HOLDOUT = "20252026"


def windows(engine: V.Engine, S: str, kind: str = "ev", next_season: bool = True) -> list:
    """[(label, g, asof date, per-date test mask)] for season S."""
    x = engine.inp[str(S)]
    des = x.ev if kind == "ev" else x.st
    reg = np.array([x.gtype.get(d, 2) == 2 for d in des.dates])
    out = []
    for g in ASOF_G:
        d0 = engine.clock.date_at(S, g)
        if d0 is None:
            continue
        d1 = engine.clock.date_at(S, g + HORIZON)
        m = (des.dates >= d0) & reg & ((des.dates < d1) if d1 is not None else True)
        if m.any():
            out.append((f"g{int(g)}", float(engine.clock.in_season(S, d0)), d0, m))
    if next_season:
        d0 = engine.clock.date_at(S, 0.0)
        out.append(("season", 0.0, d0, (des.dates >= d0) & reg))
    return out


def score(des: V.Design, beta: np.ndarray, test: np.ndarray) -> dict:
    """Players fixed at ``beta`` (player part), covariates refit on the test rows."""
    n = des.n
    w = test.astype(float)
    G, r, yy, sw, _ = des.gram(w)
    C = np.arange(2 * n, des.p)
    bp = np.array(beta, dtype=float).copy()
    bp[C] = 0.0
    Gcc = G[C][:, C].toarray() + np.eye(len(C)) * 1e-6
    GcP = G[C]
    c0 = np.linalg.solve(Gcc, r[C])
    c1 = np.linalg.solve(Gcc, r[C] - GcP @ bp)
    b0 = np.zeros(des.p)
    b0[C] = c0
    b1 = bp.copy()
    b1[C] = c1
    sse0 = des.date_sse(b0, w)
    sse1 = des.date_sse(b1, w)
    # calibration: residual on (attackers' OFF, defenders' DEF), covariates partialled out
    u = np.zeros(des.p)
    u[:n] = bp[:n]
    v = np.zeros(des.p)
    v[n:2 * n] = bp[n:2 * n]
    Gu, Gv = G @ u, G @ v
    Mpp = np.array([[u @ Gu, u @ Gv], [v @ Gu, v @ Gv]])
    Mpc = np.stack([Gu[C], Gv[C]])
    qp = np.array([u @ r, v @ r])
    K = np.linalg.solve(Gcc, Mpc.T)
    Sx = Mpp - Mpc @ K
    t = qp - K.T @ r[C]
    m = test.astype(bool)
    return {"sse0": sse0[m], "sse1": sse1[m], "sw": (des.sw * w)[m], "dates": des.dates[m],
            "S": Sx, "t": t}


def slopes(S, t):
    try:
        a = np.linalg.solve(S, t)
        cov = np.linalg.inv(S)
        return float(a[0]), float(a[1]), cov
    except np.linalg.LinAlgError:
        return float("nan"), float("nan"), None


class PriorCache:
    def __init__(self, engine, rec, sh, kind):
        self.e, self.rec, self.sh, self.kind = engine, rec, sh, kind
        self.c = {}

    def grid(self, S, g):
        k = (S, g)
        if k not in self.c:
            self.c[k] = self.e.stage1(S, g, self.rec, self.sh, st=self.kind == "st", ev=self.kind == "ev")
        return self.c[k]

    def at(self, S, g):
        gs = np.array(V.G_GRID)
        k = int(np.searchsorted(gs, g, side="right")) - 1
        k = min(max(k, 0), len(gs) - 1)
        pts = [self.grid(S, float(gs[k]))]
        if k + 1 < len(gs) and g - gs[k] > 1e-9:
            pts.append(self.grid(S, float(gs[k + 1])))
        return V.interpolate(pts, g, self.sh) if len(pts) == 2 else pts[0]


def run_candidate(engine, seasons, rec: Recency, sh: V.Shrink, kind: str = "ev", label: str | None = None,
                  bench=None, log=print) -> tuple[pd.DataFrame, list]:
    """Per-date rows (season, window, date, sse0, sse1, sw) and per-window calibration pieces.

    ``bench``: callable (S, des, asof) -> (b0, lam) replacing the v3 prior (benchmarks); its
    in-season rows then enter at full weight (the shipped asof)."""
    label = label or f"{rec.key()}|{sh.key()}" + (f"|pp{sh.v_pp:g}_pk{sh.v_pk:g}" if kind == "st" else "")
    pc = PriorCache(engine, rec, sh, kind)
    recs, cal = [], []
    for S in seasons:
        x = engine.inp[str(S)]
        des = x.ev if kind == "ev" else x.st
        for wl, g, d0, m in windows(engine, S, kind):
            if bench is not None:
                b0, lam = bench(S, des, d0)
                w_in = np.where(des.dates <= np.datetime64(d0, "D") - np.timedelta64(V.LAG_DAYS, "D"), 1.0, 0.0)
                beta, _ = V.Engine.solve(des, w_in, b0, lam, V.SIGMA2_EV)
            else:
                pr = pc.at(S, g)
                res = engine.stage2(S, d0, rec, sh, pr, st=kind == "st", ev=kind == "ev")
                beta = res["beta_ev"] if kind == "ev" else res["beta_st"]
            sc = score(des, beta, m)
            recs.append(pd.DataFrame({"model": label, "season": S, "window": wl, "date": sc["dates"],
                                      "sse0": sc["sse0"], "sse1": sc["sse1"], "sw": sc["sw"]}))
            cal.append({"model": label, "season": S, "window": wl, "S": sc["S"].tolist(), "t": sc["t"].tolist()})
        log(f"  [v3-val] {label} {S} done")
    return pd.concat(recs, ignore_index=True), cal


# ----------------------------------------------------------------------- summaries

def mse_table(df: pd.DataFrame, seasons, windows_=None) -> pd.Series:
    x = df[df["season"].isin(seasons)]
    x = x[x["window"] != "season"] if windows_ is None else x[x["window"].isin(windows_)]
    g = x.groupby("model")
    return (g["sse1"].sum() / g["sw"].sum()).sort_values()


def gain_table(df: pd.DataFrame, seasons, windows_=None) -> pd.Series:
    x = df[df["season"].isin(seasons)]
    x = x[x["window"] != "season"] if windows_ is None else x[x["window"].isin(windows_)]
    g = x.groupby("model")
    return ((g["sse0"].sum() - g["sse1"].sum()) / g["sw"].sum()).sort_values(ascending=False)


def paired(df: pd.DataFrame, a: str, b: str, seasons, windows_=None) -> dict:
    """MSE(b) - MSE(a) on the same rows (negative = b better), clustered by date."""
    x = df[df["season"].isin(seasons)]
    x = x[x["window"] != "season"] if windows_ is None else x[x["window"].isin(windows_)]
    pa = x[x["model"] == a].set_index(["season", "window", "date"])
    pb = x[x["model"] == b].set_index(["season", "window", "date"])
    j = pa[["sse1", "sw"]].join(pb[["sse1"]], rsuffix="_b", how="inner")
    sw = float(j["sw"].sum())
    by = (j["sse1_b"] - j["sse1"]).groupby(level=["season", "date"]).sum().to_numpy()
    delta = float(by.sum() / sw)
    se = float(math.sqrt(len(by)) * by.std(ddof=1) / sw) if len(by) > 1 else float("nan")
    return {"delta_mse": delta, "se": se, "z": delta / se if se and se > 0 else None, "n_dates": int(len(by))}


def pooled_slopes(cal: list, model: str, seasons, windows_=None, sigma2: float = V.SIGMA2_EV) -> dict:
    Ss, ts = np.zeros((2, 2)), np.zeros(2)
    for c in cal:
        if c["model"] != model or c["season"] not in seasons:
            continue
        if (windows_ is None and c["window"] == "season") or (windows_ is not None and c["window"] not in windows_):
            continue
        Ss += np.array(c["S"])
        ts += np.array(c["t"])
    a, b, cov = slopes(Ss, ts)
    # Gaussian SE with the residual variance per stint-second (rows are weighted by seconds)
    se = np.sqrt(sigma2 * np.diag(cov)) if cov is not None else [np.nan, np.nan]
    return {"off": a, "def": b, "se_off": float(se[0]), "se_def": float(se[1])}


def write_json(path: str, obj) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, indent=2, default=float)
