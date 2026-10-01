"""Delta-method aging curves with drop-out imputation (DESIGN §3.2.1).

Inputs are *standalone* per-season ratings (flat ridge, no prior), so a season-to-season
change is not damped by the prior chain.  For every consecutive season pair (S-1, S) with
both seasons before the target season:

    delta = rating(S) - rating(S-1),  weight = harmonic mean of the two seasons' EV hours

and a quadratic in (age - 27) is fitted by weighted least squares, separately for O and D and
for forwards and defencemen.  Survivor bias: a player with >= ``DROP_MIN_H`` EV hours in S-1
and none in S is imputed at replacement level (TOI-weighted mean rating of the bottom TOI
quartile of his position group in S) with weight ``DROP_WEIGHT`` x his S-1 hours.  Seasons
flagged as eras (2019-20, 2020-21) get half weight in either role.  Fit on seasons < S only
(``fit_seasons`` is stored with the curve and asserted by the tests).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .bio import age_at

PEAK = 27.0
DROP_MIN_H = 3.0          # EV hours in S-1 to count as a drop-out when absent in S
DROP_WEIGHT = 0.5
MAX_DELTA = 0.10          # xG/60, clip of the predicted one-season change
ERA_HALF = {"20192020", "20202021"}


@dataclass
class AgingCurve:
    coef: dict = field(default_factory=dict)   # (pos_group, comp) -> [c0, c1, c2]
    fit_seasons: list = field(default_factory=list)
    n: dict = field(default_factory=dict)

    def delta(self, pos_group, comp: str, age) -> np.ndarray:
        age = np.asarray(age, dtype=float)
        out = np.zeros_like(age)
        for g in ("F", "D"):
            c = self.coef.get((g, comp))
            if c is None:
                continue
            m = (np.asarray(pos_group) == g) & ~np.isnan(age)
            a = np.clip(age[m], 18, 42) - PEAK
            out[m] = c[0] + c[1] * a + c[2] * a * a
        return np.clip(out, -MAX_DELTA, MAX_DELTA)

    def to_json(self):
        return {"peak": PEAK, "fit_seasons": self.fit_seasons,
                "coef": {f"{g}_{c}": list(map(float, v)) for (g, c), v in self.coef.items()},
                "n": {f"{g}_{c}": int(v) for (g, c), v in self.n.items()}}


def _wls_quad(a, d, w):
    X = np.stack([np.ones_like(a), a, a * a], axis=1)
    W = w / w.sum()
    A = X.T @ (X * W[:, None]) + np.diag([0.0, 1e-4, 1e-4])
    return np.linalg.solve(A, X.T @ (W * d))


def fit_aging(standalone: dict[str, pd.DataFrame], players: pd.DataFrame, target_season: str) -> AgingCurve:
    """standalone: season -> DataFrame(player_id, o, d, toi_h) for seasons < target."""
    seasons = sorted(s for s in standalone if s < str(target_season))
    curve = AgingCurve(fit_seasons=seasons)
    pairs = [(a, b) for a, b in zip(seasons, seasons[1:]) if int(b[:4]) == int(a[:4]) + 1]
    if not pairs:
        return curve
    bio = players.set_index("player_id")
    frames = []
    for s0, s1 in pairs:
        r0, r1 = standalone[s0].set_index("player_id"), standalone[s1].set_index("player_id")
        era = (0.5 if s0 in ERA_HALF else 1.0) * (0.5 if s1 in ERA_HALF else 1.0)
        both = r0.index.intersection(r1.index)
        df = pd.DataFrame({"player_id": both})
        df["pos_group"] = bio["pos_group"].reindex(both).to_numpy()
        df["age"] = age_at(bio["birth_date"].reindex(both), s0).to_numpy()
        h0, h1 = r0.loc[both, "toi_h"].to_numpy(), r1.loc[both, "toi_h"].to_numpy()
        df["w"] = era * 2 * h0 * h1 / np.maximum(h0 + h1, 1e-9)
        for c in ("o", "d"):
            df[f"d_{c}"] = r1.loc[both, c].to_numpy() - r0.loc[both, c].to_numpy()
        # drop-outs: imputed at replacement level of S1
        drop = r0.index.difference(r1.index)
        drop = drop[r0.loc[drop, "toi_h"].to_numpy() >= DROP_MIN_H]
        if len(drop):
            dd = pd.DataFrame({"player_id": drop})
            dd["pos_group"] = bio["pos_group"].reindex(drop).to_numpy()
            dd["age"] = age_at(bio["birth_date"].reindex(drop), s0).to_numpy()
            dd["w"] = era * DROP_WEIGHT * r0.loc[drop, "toi_h"].to_numpy()
            r1b = r1.join(bio["pos_group"], how="left")
            for c in ("o", "d"):
                repl = {}
                for g, sub in r1b.groupby("pos_group"):
                    q = sub["toi_h"].quantile(0.25)
                    low = sub[sub["toi_h"] <= q]
                    repl[g] = float(np.average(low[c], weights=np.maximum(low["toi_h"], 1e-6))) if len(low) else 0.0
                dd[f"d_{c}"] = dd["pos_group"].map(repl).fillna(0.0).to_numpy() - r0.loc[drop, c].to_numpy()
            frames.append(dd)
        frames.append(df)
    allp = pd.concat(frames, ignore_index=True)
    allp = allp[allp["age"].notna() & allp["pos_group"].notna() & (allp["w"] > 0)]
    for g in ("F", "D"):
        sub = allp[allp["pos_group"] == g]
        if len(sub) < 50:
            continue
        a = np.clip(sub["age"].to_numpy(), 18, 42) - PEAK
        for c in ("o", "d"):
            curve.coef[(g, c)] = _wls_quad(a, sub[f"d_{c}"].to_numpy(), sub["w"].to_numpy())
            curve.n[(g, c)] = len(sub)
    return curve
