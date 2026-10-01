"""Per-rink distance CDF matching (Schuckers-Curro style), fit on seasons < S.

Rink scorers record shot locations with a rink-specific bias.  For each rink
(keyed by the home team id, so a relocated team starts fresh) we map a
recorded distance d to ``F_other^{-1}(F_rink(d))``: the quantile it has among
shots recorded at that rink, read off the distribution of shots recorded in
every *other* rink.  Only the visiting team's shots are used to build both
CDFs, so the home team's own style does not leak into its rink's correction
(visitors rotate through every rink).  The map is shrunk toward identity by
``n / (n + prior_n)`` and stored as quantile knots (JSON-friendly).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

QS = np.linspace(0.0, 1.0, 51)


class RinkAdjuster:
    def __init__(self, knots: dict | None = None, fit_seasons=None, prior_n: float = 1500.0):
        self.knots = knots or {}          # rink -> {"src": [...], "dst": [...], "w": float}
        self.fit_seasons = list(fit_seasons or [])
        self.prior_n = prior_n

    @classmethod
    def fit(cls, shots: pd.DataFrame, prior_n: float = 1500.0, min_n: int = 300) -> "RinkAdjuster":
        d = shots[["home_team_id", "is_home", "distance", "season"]].dropna()
        d = d[d["is_home"] == 0]  # visitors' shots only
        knots = {}
        for rink, part in d.groupby("home_team_id"):
            n = len(part)
            if n < min_n:
                continue
            other = d.loc[d["home_team_id"] != rink, "distance"].to_numpy()
            src = np.quantile(part["distance"].to_numpy(), QS)
            dst = np.quantile(other, QS)
            knots[str(int(rink))] = {"src": [round(float(v), 3) for v in src],
                                     "dst": [round(float(v), 3) for v in dst],
                                     "w": round(n / (n + prior_n), 4), "n": int(n)}
        return cls(knots, sorted(set(d["season"].astype(str))), prior_n)

    def adjust(self, shots: pd.DataFrame) -> pd.Series:
        dist = pd.to_numeric(shots["distance"], errors="coerce").to_numpy(dtype="float64")
        out = dist.copy()
        rinks = pd.to_numeric(shots.get("home_team_id"), errors="coerce")
        if rinks is None:
            return pd.Series(out, index=shots.index)
        rk = rinks.to_numpy()
        for key, k in self.knots.items():
            m = rk == float(key)
            if not m.any():
                continue
            src, dst = np.asarray(k["src"]), np.asarray(k["dst"])
            # strictly increasing knots for interp (ties in the low tail)
            src = src + np.arange(len(src)) * 1e-6
            mapped = np.interp(dist[m], src, dst)
            out[m] = k["w"] * mapped + (1 - k["w"]) * dist[m]
        return pd.Series(out, index=shots.index)

    def to_json(self) -> dict:
        return {"method": "visitor-shot distance CDF matching, shrunk to identity",
                "prior_n": self.prior_n, "fit_seasons": self.fit_seasons, "knots": self.knots}

    @classmethod
    def from_json(cls, d: dict | None) -> "RinkAdjuster | None":
        if not d:
            return None
        return cls(d.get("knots") or {}, d.get("fit_seasons"), d.get("prior_n", 1500.0))
