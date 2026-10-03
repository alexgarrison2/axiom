"""Ratings v4 validation (``v4_prereg.json``): v3's next-30-game stint metrics on the v4 engine.

The scoring is ``v3_validate`` unchanged (same windows, same Gram-exact next-30-game EV / PP stint
MSE with the covariates refit on the test rows, same date-clustered paired SEs, same calibration
slopes), so v4 rows pair one-to-one with the logged v3 / window / Kalman rows of the same season,
window and date.  Only the fit differs: ``v4.Engine4`` stage 1 (role means + the joint SPM prior)
interpolated on the ``v3.G_GRID`` with ``v4.interpolate4``, and stage 2 with the in-season box-score
shift of the prior mean.

Penalty rates (the impact's direct penalty term, ``v4.penalty_rates``): ``pen_scores`` scores the
shrunk drawn / taken rates as of each as-of point on the player's penalties in the next 30 games
(Poisson deviance per player-game, rate x his all-situation minutes).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import v3 as V
from . import v3_validate as VV
from . import v4 as V4
from .recency import Recency


class PriorCache4(VV.PriorCache):
    def at(self, S, g):
        gs = np.array(V.G_GRID)
        k = int(np.searchsorted(gs, g, side="right")) - 1
        k = min(max(k, 0), len(gs) - 1)
        pts = [self.grid(S, float(gs[k]))]
        if k + 1 < len(gs) and g - gs[k] > 1e-9:
            pts.append(self.grid(S, float(gs[k + 1])))
        return V4.interpolate4(pts, g, self.sh) if len(pts) == 2 else pts[0]


def run_candidate(engine: V4.Engine4, seasons, rec: Recency, sh, kind: str = "ev", label: str | None = None,
                  log=print, keep_priors: dict | None = None) -> tuple[pd.DataFrame, list]:
    """``v3_validate.run_candidate`` on the v4 engine: per-date rows and calibration pieces."""
    if label is None:
        label = f"v4|{sh.key()}" + (f"|{sh.st_key()}" if kind == "st" else "")
    pc = PriorCache4(engine, rec, sh, kind)
    recs, cal = [], []
    for S in seasons:
        x = engine.inp[str(S)]
        des = x.ev if kind == "ev" else x.st
        for wl, g, d0, m in VV.windows(engine, S, kind):
            pr = pc.at(S, g)
            if keep_priors is not None and wl in ("g0",):
                keep_priors[(S, wl)] = pr
            res = engine.stage2(S, d0, rec, sh, pr, st=kind == "st", ev=kind == "ev")
            beta = res["beta_ev"] if kind == "ev" else res["beta_st"]
            sc = VV.score(des, beta, m)
            recs.append(pd.DataFrame({"model": label, "season": S, "window": wl, "date": sc["dates"],
                                      "sse0": sc["sse0"], "sse1": sc["sse1"], "sw": sc["sw"]}))
            cal.append({"model": label, "season": S, "window": wl, "S": sc["S"].tolist(), "t": sc["t"].tolist()})
        pc.c.clear()
        log(f"  [v4-val] {label} {S} done")
    return pd.concat(recs, ignore_index=True), cal


# ----------------------------------------------------------------------- penalty rates

def pen_scores(engine: V4.Engine4, seasons, rec: Recency, t0s, horizon: float = VV.HORIZON) -> pd.DataFrame:
    """Poisson deviance of next-``horizon``-game penalties drawn / taken given the shrunk rates as of
    each ``ASOF_G`` point (pre-season + in-season box sums at the recency weights)."""
    out = []
    for S in seasons:
        b = engine.box[str(S)]
        reg = b["game_id"].astype(str).str[4:6].eq("02").to_numpy()
        d = b["d"].to_numpy(dtype="datetime64[D]")
        for g in VV.ASOF_G:
            d0 = engine.clock.date_at(S, g)
            if d0 is None:
                continue
            d1 = engine.clock.date_at(S, g + horizon)
            gg = engine.clock.in_season(S, d0)
            sums = V4.add_box(engine.box_pre(S, gg, rec), engine.box_in(S, d0, rec))
            test = b[(d >= d0) & reg & ((d < d1) if d1 is not None else True)]
            if not len(test):
                continue
            tsec = test[["ev_s", "pp_s", "pk_s"]].to_numpy(float).sum(axis=1)
            for t0 in t0s:
                r = V4.penalty_rates(sums, engine.bio.group, t0)
                grp = np.array(["D" if engine.bio.g(p) == "D" else "F" for p in test["player_id"]])
                sec_all = sums[["ev_s", "pp_s", "pk_s"]].to_numpy(float).sum(axis=1)
                fb = {}
                for g_ in ("F", "D"):
                    m = V4._groups(sums.index, engine.bio.group) == g_
                    s_ = sec_all[m].sum()
                    fb[g_] = (sums["pd_all"].to_numpy()[m].sum() / s_ * 3600, sums["pt_all"].to_numpy()[m].sum() / s_ * 3600)
                rr = r.reindex(test["player_id"].to_numpy())
                for j, (c, col) in enumerate((("pd60", "pd_all"), ("pt60", "pt_all"))):
                    lam = rr[c].to_numpy(float)
                    miss = ~np.isfinite(lam)
                    lam[miss] = [fb[g_][j] for g_ in grp[miss]]
                    mu = np.maximum(lam * tsec / 3600.0, 1e-9)
                    y = test[col].to_numpy(float)
                    dev = 2 * (np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / mu), 0.0) - (y - mu))
                    out.append({"season": S, "g": g, "t0": t0, "kind": c, "dev": float(dev.sum()), "n": len(y)})
    return pd.DataFrame(out)
