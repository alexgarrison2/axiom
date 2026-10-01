"""Summer roll-forward of player ratings (DESIGN §3.2.1).

For season S, every skater column gets a prior mean b0 and a prior precision lam:

  returning player  b0 = b_post(last) + sum of one-season aging steps (age in each       (Kalman-style carry)
                    skipped-to season minus one: the curve is indexed by the earlier season's age)
                    var0 = min(kappa^k * var_post + extra_age, v_new)  k = seasons since last seen
  new player        b0 = rookie mean (position group x draft tier, fitted on seasons < S)
                    var0 = v_new
  lam = sigma2 / var0,  sigma2 = residual variance per unit weight of season S-1's fit

``extra_age`` = ``young_old_extra`` x v_new for players <= 22 or >= 33 (DESIGN: extra
variance at both ends of the age curve).  Covariates carry last season's values with a
moderate ridge ``cov_lam``; the intercept is effectively unpenalised.  Players with little
TOI fall back toward the prior automatically because their data precision is small.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd

from .aging import AgingCurve
from .bio import age_at
from .design import COVARIATES, Index

SIGMA2_DEFAULT = 1160.0   # residual variance per second of 5v5 xG/60 (2022-23 flat fit; any season ~1150-1170)
MIN_SIGMA2_ROWS = 20_000  # regression rows (~2 rows per stint, ~1,000 per game) to re-estimate sigma2


@dataclass(frozen=True)
class Hyper:
    v_new: float = 0.02             # prior variance of an unknown skater, (xG/60)^2
    kappa: float = 1.5              # inflation of last season's posterior variance per season
    young_old_extra: float = 0.25   # x v_new added for age <= 22 or >= 33
    cov_lam: float = 3600.0 * 20    # pseudo-seconds of ridge on covariates (toward last season)
    use_aging: bool = True
    use_rookie_mean: bool = True

    def key(self) -> str:
        return f"v{self.v_new:g}_k{self.kappa:g}_y{self.young_old_extra:g}_a{int(self.use_aging)}_r{int(self.use_rookie_mean)}"

    def as_dict(self):
        return asdict(self)


@dataclass
class RookieModel:
    """TOI-weighted mean first-season standalone rating by (pos_group, draft tier), shrunk."""
    means: dict = field(default_factory=dict)   # (pos_group, tier, comp) -> value
    fit_seasons: list = field(default_factory=list)
    SHRINK_N = 30.0

    @staticmethod
    def tier(draft_overall) -> np.ndarray:
        d = pd.to_numeric(pd.Series(draft_overall), errors="coerce").to_numpy()
        return np.where(np.isnan(d), "undrafted", np.where(d <= 32, "r1", "later"))

    @classmethod
    def fit(cls, standalone: dict, players: pd.DataFrame, target_season: str) -> "RookieModel":
        seasons = sorted(s for s in standalone if s < str(target_season))
        m = cls(fit_seasons=seasons)
        bio = players.set_index("player_id")
        rows = []
        for s in seasons:
            r = standalone[s]
            fs = bio["first_season"].reindex(r["player_id"]).to_numpy()
            rk = r[pd.Series(fs).astype("float").to_numpy() == float(s)].copy()
            if not len(rk):
                continue
            rk["pos_group"] = bio["pos_group"].reindex(rk["player_id"]).to_numpy()
            rk["tier"] = cls.tier(bio["draft_overall"].reindex(rk["player_id"]).to_numpy())
            rows.append(rk)
        if not rows:
            return m
        rk = pd.concat(rows, ignore_index=True)
        for g, sub in rk.groupby("pos_group"):
            for c in ("o", "d"):
                pm = float(np.average(sub[c], weights=np.maximum(sub["toi_h"], 1e-6)))
                m.means[(g, "all", c)] = pm
                for t, st in sub.groupby("tier"):
                    n = float(len(st))
                    tm = float(np.average(st[c], weights=np.maximum(st["toi_h"], 1e-6)))
                    m.means[(g, t, c)] = (n * tm + cls.SHRINK_N * pm) / (n + cls.SHRINK_N)
        return m

    def mean(self, pos_group, tier, comp) -> float:
        return self.means.get((pos_group, tier, comp), self.means.get((pos_group, "all", comp), 0.0))

    def to_json(self):
        return {"fit_seasons": self.fit_seasons, "means": {"|".join(k): v for k, v in self.means.items()}}


class Chain:
    """Per-player posterior carried across seasons (one chain per hyper-parameter setting)."""

    def __init__(self, hyper: Hyper):
        self.h = hyper
        self.state: dict[int, tuple] = {}     # pid -> (o, d, o_var, d_var, last_season)
        self.cov_prev: np.ndarray | None = None
        self.sigma2 = SIGMA2_DEFAULT

    def prior(self, season: str, idx: Index, players: pd.DataFrame, aging: AgingCurve | None,
              rookie: RookieModel | None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """(b0, lam, is_new) for the season's columns."""
        h = self.h
        n = idx.n
        bio = players.set_index("player_id")
        pg = bio["pos_group"].reindex(idx.ids).fillna("F").to_numpy()
        age = age_at(bio["birth_date"].reindex(idx.ids), season).to_numpy()
        tier = RookieModel.tier(bio["draft_overall"].reindex(idx.ids).to_numpy())
        b0 = np.zeros(idx.p)
        var = np.full(2 * n, h.v_new)
        is_new = np.ones(n, dtype=bool)
        yr = int(season[:4])
        # seasons since each returning player's last posterior (1 = played last season)
        gaps = np.array([max(1, yr - int(str(self.state[int(p)][4])[:4])) if int(p) in self.state else 1
                         for p in idx.ids], dtype=int)
        d_o, d_d = self._aging_deltas(aging, pg, age, gaps) if (aging is not None and h.use_aging) \
            else (np.zeros(n), np.zeros(n))
        extra = np.where((age <= 22) | (age >= 33), h.young_old_extra * h.v_new, 0.0)
        for k, pid in enumerate(idx.ids):
            s = self.state.get(int(pid))
            if s is None:
                if rookie is not None and h.use_rookie_mean:
                    b0[k] = rookie.mean(pg[k], tier[k], "o")
                    b0[n + k] = rookie.mean(pg[k], tier[k], "d")
                continue
            o, d, ov, dv, last = s
            gap = int(gaps[k])
            b0[k] = o + d_o[k]
            b0[n + k] = d + d_d[k]
            var[k] = min(ov * h.kappa ** gap + extra[k], h.v_new)
            var[n + k] = min(dv * h.kappa ** gap + extra[k], h.v_new)
            is_new[k] = False
        lam = np.empty(idx.p)
        lam[:2 * n] = self.sigma2 / var
        lam[2 * n:] = h.cov_lam
        lam[2 * n] = 1e-6                     # intercept
        if self.cov_prev is not None:
            b0[2 * n:] = self.cov_prev
            b0[2 * n] = self.cov_prev[0]
        return b0, lam, is_new

    @staticmethod
    def _aging_deltas(aging: AgingCurve, pg, age, gaps) -> tuple[np.ndarray, np.ndarray]:
        """Summed one-season aging steps from the last rated season to this one.

        The curve is fitted as ``rating(S) - rating(S-1)`` against the age in season S-1
        (``aging.fit_aging``), so a player last rated ``gap`` seasons ago gets
        ``sum_{j=1..gap} delta(age_S - j)``: for the usual gap of 1, the step indexed by
        last season's age."""
        age = np.asarray(age, dtype=float)
        gaps = np.asarray(gaps, dtype=int)
        d_o, d_d = np.zeros(len(age)), np.zeros(len(age))
        for j in range(1, int(gaps.max(initial=1)) + 1):
            m = gaps >= j
            d_o += np.where(m, aging.delta(pg, "o", age - j), 0.0)
            d_d += np.where(m, aging.delta(pg, "d", age - j), 0.0)
        return d_o, d_d

    def update(self, season: str, idx: Index, b: np.ndarray, inv_diag: np.ndarray, sigma2: float,
               toi: pd.Series | None = None, n_rows: int | None = None) -> None:
        """Fold the end-of-season posterior in (players without EV time keep their old state).

        ``sigma2`` (residual variance per unit weight, which scales next season's prior
        precisions) is only taken from a season with at least ``MIN_SIGMA2_ROWS`` regression
        rows: a season in progress or an empty partition would otherwise set it to ~0 and
        make every prior precision vanish."""
        n = idx.n
        if (n_rows is None or n_rows >= MIN_SIGMA2_ROWS) and np.isfinite(sigma2) and sigma2 > 0:
            self.sigma2 = float(sigma2)
        var = self.sigma2 * inv_diag
        for k, pid in enumerate(idx.ids):
            if toi is not None and float(toi.get(int(pid), 0.0)) <= 0:
                continue
            self.state[int(pid)] = (float(b[k]), float(b[n + k]), float(var[k]), float(var[n + k]), season)
        self.cov_prev = b[2 * n:].copy()

    def table(self) -> pd.DataFrame:
        return pd.DataFrame([(p, *v) for p, v in self.state.items()],
                            columns=["player_id", "o", "d", "o_var", "d_var", "last_season"])


COV_NAMES = COVARIATES
