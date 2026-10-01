"""Summer roll-forward of player ratings (DESIGN §3.2.1).

For season S, every skater column gets a prior mean b0 and a prior precision lam:

  returning player  b0 = b_post(last) + aging_scale x sum of one-season aging steps (age in   (Kalman-style carry)
                    each skipped-to season minus one: the curve is indexed by the earlier season's age)
                    var0 = min(kappa^k * var_post + k * q_add + extra_age, v_new)  k = seasons since last seen
  new player        b0 = rookie mean (position group x draft tier, fitted on seasons < S)
                    var0 = v_new
  lam = sigma2 / var0,  sigma2 = residual variance per unit weight of season S-1's fit

``extra_age`` = ``young_old_extra`` x v_new for players <= 22 or >= 33 (DESIGN: extra
variance at both ends of the age curve).  Covariates carry last season's values with a
moderate ridge ``cov_lam``; the intercept is effectively unpenalised.  Players with little
TOI fall back toward the prior automatically because their data precision is small.

Window mode (``Hyper.window``, owner directive 2026-10-01: seasons 4+ back should barely
matter).  The Kalman carry forgets geometrically (``kappa``), so every past season keeps some
weight.  With a window the season-start prior is instead a fresh fit on the last seasons' EV
stints only, each season's rows weighted by recency (default S-1 1.0, S-2 0.5, S-3 0.25, older
0), ridged toward the rookie / position-group means at ``v_new``, with every player's older
rows moved forward by his aging steps (an offset: ``y + X_att . delta_o + X_def . delta_d``),
summarised as (mean, posterior variance) per player (``window_prior``).  The in-season update
is unchanged: this season's stints at full weight on top of that prior.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd

from .aging import AgingCurve
from .bio import age_at
from .design import COVARIATES, ERA_WEIGHTS, Index

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
    q_add: float = 0.0              # additive innovation variance per season, (xG/60)^2: random-walk talent drift
    aging_scale: float = 1.0        # multiplier on the fitted one-season aging step
    window: str = ""                # "1,0.5,0.25": window-mode prior, weights of seasons S-1, S-2, ...

    def key(self) -> str:
        # the prior-dynamics terms enter the key only when set, so every key (and report)
        # written before they existed stays valid
        extra = (f"_q{self.q_add:g}" if self.q_add else "") + (f"_s{self.aging_scale:g}" if self.aging_scale != 1.0 else "")
        if self.window:
            extra += "_w" + "-".join(f"{w:g}" for w in self.window_weights())
        return (f"v{self.v_new:g}_k{self.kappa:g}{extra}_y{self.young_old_extra:g}_a{int(self.use_aging)}"
                f"_r{int(self.use_rookie_mean)}")

    def window_weights(self) -> tuple:
        return tuple(float(x) for x in str(self.window).split(",") if x.strip()) if self.window else ()

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
            if h.window:
                # window prior for this season (window_prior): aging already applied, no inflation
                b0[k], b0[n + k] = o, d
                var[k], var[n + k] = min(ov, h.v_new), min(dv, h.v_new)
                is_new[k] = False
                continue
            gap = int(gaps[k])
            b0[k] = o + h.aging_scale * d_o[k]
            b0[n + k] = d + h.aging_scale * d_d[k]
            drift = gap * h.q_add + extra[k]
            var[k] = min(ov * h.kappa ** gap + drift, h.v_new)
            var[n + k] = min(dv * h.kappa ** gap + drift, h.v_new)
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
        make every prior precision vanish.

        ``sigma2`` comes from rows weighted by ``seconds x era weight`` (``design.ERA_WEIGHTS``),
        so for an era-weighted season (2020-21 at 0.5) it is per *weighted* second; it is
        divided by the era weight to get back to the per-second scale that the next season's
        unweighted rows use (otherwise 2021-22 would get half-strength priors)."""
        n = idx.n
        if (n_rows is None or n_rows >= MIN_SIGMA2_ROWS) and np.isfinite(sigma2) and sigma2 > 0:
            self.sigma2 = float(sigma2) / ERA_WEIGHTS.get(str(season), 1.0)
        var = self.sigma2 * inv_diag
        for k, pid in enumerate(idx.ids):
            if toi is not None and float(toi.get(int(pid), 0.0)) <= 0:
                continue
            self.state[int(pid)] = (float(b[k]), float(b[n + k]), float(var[k]), float(var[n + k]), season)
        self.cov_prev = b[2 * n:].copy()

    def table(self) -> pd.DataFrame:
        return pd.DataFrame([(p, *v) for p, v in self.state.items()],
                            columns=["player_id", "o", "d", "o_var", "d_var", "last_season"])


def window_prior(season: str, hist, players: pd.DataFrame, aging: AgingCurve | None, rookie: RookieModel | None,
                 hyper: Hyper, sigma2: float) -> dict:
    """Window-mode season-start prior: {pid: (o, d, o_var, d_var, season)} (see the module doc).

    ``hist``: (season, Index, Gram) of earlier full seasons (any order); season S-k enters with
    weight ``hyper.window_weights()[k-1]`` and its own covariate block (league level, score and
    zone effects of that season)."""
    import scipy.linalg as la
    yr = int(str(season)[:4])
    ws = hyper.window_weights()
    use = [(yr - int(str(s)[:4]), s, idx, g) for s, idx, g in hist if 1 <= yr - int(str(s)[:4]) <= len(ws)]
    use = [(k, s, idx, g) for k, s, idx, g in use if ws[k - 1] > 0]
    if not use:
        return {}
    ids = np.array(sorted({int(p) for _, _, idx, _ in use for p in idx.ids}), dtype=np.int64)
    pos = {int(p): i for i, p in enumerate(ids)}
    nU, nc = len(ids), len(COVARIATES)
    P = 2 * nU + nc * len(use)
    G = np.zeros((P, P))
    r = np.zeros(P)
    bio = players.set_index("player_id")
    for b, (k, s, idx, g) in enumerate(use):
        w = ws[k - 1]
        pl = np.array([pos[int(p)] for p in idx.ids])
        m = np.concatenate([pl, nU + pl, 2 * nU + b * nc + np.arange(nc)])
        shift = np.zeros(idx.p)
        if aging is not None and hyper.use_aging:
            pg = bio["pos_group"].reindex(idx.ids).fillna("F").to_numpy()
            age_S = age_at(bio["birth_date"].reindex(idx.ids), season).to_numpy()
            d_o, d_d = Chain._aging_deltas(aging, pg, age_S, np.full(idx.n, k))
            shift[:idx.n] = hyper.aging_scale * d_o
            shift[idx.n:2 * idx.n] = hyper.aging_scale * d_d
        G[np.ix_(m, m)] += w * g.G
        r[m] += w * (g.r + g.G @ shift)       # rows moved forward by the players' aging steps
    b0 = np.zeros(P)
    if rookie is not None and hyper.use_rookie_mean:
        pg = bio["pos_group"].reindex(ids).fillna("F").to_numpy()
        tier = RookieModel.tier(bio["draft_overall"].reindex(ids).to_numpy())
        b0[:nU] = [rookie.mean(a, t, "o") for a, t in zip(pg, tier)]
        b0[nU:2 * nU] = [rookie.mean(a, t, "d") for a, t in zip(pg, tier)]
    lam = np.full(P, hyper.cov_lam)
    lam[:2 * nU] = sigma2 / hyper.v_new
    lam[2 * nU::nc] = 1e-6                    # each season's intercept
    A = G
    A[np.diag_indices_from(A)] += lam
    c = la.cho_factor(A, lower=False, check_finite=False)
    bb = la.cho_solve(c, r + lam * b0, check_finite=False)
    var = sigma2 * _inv_diag(c, 2 * nU, P)
    return {int(p): (float(bb[i]), float(bb[nU + i]), float(var[i]), float(var[nU + i]), str(season))
            for i, p in enumerate(ids)}


def _inv_diag(c, k: int, P: int) -> np.ndarray:
    """First ``k`` diagonal entries of A^-1 from A's Cholesky factor."""
    import scipy.linalg as la
    E = np.zeros((P, k))
    E[np.arange(k), np.arange(k)] = 1.0
    X = la.cho_solve(c, E, check_finite=False)
    return X[np.arange(k), np.arange(k)].copy()


def set_window_state(chain: "Chain", season: str, hist, players, aging, rookie) -> None:
    """Replace the chain's carried state by the window prior of ``season`` (window mode only)."""
    if chain.h.window:
        chain.state = window_prior(season, hist, players, aging, rookie, chain.h, chain.sigma2)


COV_NAMES = COVARIATES
