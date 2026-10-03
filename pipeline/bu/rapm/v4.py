"""Player ratings v4: v3 + a box-score (statistical plus-minus) prior.

Why (owner, 2026-10-02): on-ice RAPM cannot split credit between players who share most of their
ice time (Rantanen 81% of his EV time with MacKinnon in 2023-24, 73% with Johnston in 2025-26;
Makar with MacKinnon / Toews), and v3 used no individual production at all, so a low-event fourth
liner was credited by default (Kiviranta above Rantanen).  v4 is the standard RPM / EPM remedy: the
prior mean of every RAPM component is a regression on the player's own recency-weighted box-score
rates, so the data only has to explain what the box score does not.

**Model.**  As v3 (``v3.py``: EV OFF / DEF two rows per stint, PP / PK one row, D90 game recency,
two stages), with the player effects

    o_i = mu_O[role(i)] + z_i' beta_O[grp(i)] + u_i,    u_i ~ N(0, v_o)
    d_i = mu_D[role(i)] + z_i' beta_D[grp(i)] + e_i,    e_i ~ N(0, v_d)
    pp_i = mu_PP[grp(i)] + z_i' beta_PP[grp(i)] + .,    pk_i = mu_PK[grp(i)] + z_i' beta_PK[grp(i)] + .

``z_i`` = the player's standardised individual rates (``FEATURES``: ``box.py`` counts, weighted
with the same per-game recency as his stints, shrunk to the position-group rate with ``t0`` pseudo
minutes, standardised within F / D, clipped at +-4), ``beta`` ~ N(0, ``v_beta``) per standardised
feature and position group, fitted jointly with the players in the stage-1 ridge (the role-mean
machinery of v3 with the feature matrix appended to the role indicator matrix).  So the SPM is fit
on the on-ice stint outcomes themselves (no two-step regression on shrunken RAPM estimates), its
weight against the player's own on-ice data is set by ``v_o`` / ``v_d``, and both are tuned on
the next-30-game stint MSE of the tuning seasons only (``v4_prereg.json``).

**Stage 2 (in season).**  Every player's stage-1 prior mean moves with his box score since the
season start: ``b0 += beta' (z(pre + this season) - z(pre))`` at the stage-1 standardisation (a
player without a stage-1 prior: role mean + ``beta' z``), then this season's stints are ridged
toward it exactly as in v3.

**Penalties** are individual and measurable, so they enter the impact directly (``penalty_rates``:
drawn / taken per 60 of all-situation TOI, recency-weighted and shrunk with ``PEN_T0`` pseudo
minutes; value = league net PP goals per penalty unit, ``box.pp_goal_value``), not through RAPM.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd
import scipy.linalg as la

from . import v3 as V
from .box import ALL_COUNTS, COUNT_COLS, EV_COUNTS, PK_COUNTS, PP_COUNTS, SEC_COLS
from .design import COVARIATES
from .recency import Recency

USAGE = ["toi_ev_gp", "toi_pp_gp", "toi_pk_gp"]
FEATURES = EV_COUNTS + PP_COUNTS + PK_COUNTS + ALL_COUNTS + USAGE
D_DROP = ("fow_ev", "fol_ev")       # defencemen take almost no faceoffs: no faceoff features for D
GP0 = 5.0                           # pseudo games of the usage features
PP_T0_FRAC = 0.15                   # PP / PK pseudo minutes = 0.15 x EV pseudo minutes
ALL_T0_FRAC = 1.2                   # all-situation pseudo minutes = 1.2 x EV
Z_CLIP = 4.0
SUM_COLS = COUNT_COLS + SEC_COLS + ["gp"]
PEN_T0 = 400.0                      # pseudo minutes of the impact's penalty rates (tuned: v4_validation "pen")
IMPACT_WEIGHTS = {"w_o": 1.0, "w_d": 1.0, "w_pp": 1.0, "w_pk": 1.0}   # calibration-slope rule (v4_prereg "impact")


@dataclass(frozen=True)
class Shrink4(V.Shrink):
    """v3 shrinkage + the SPM prior: ``v_beta`` / ``v_beta_st`` prior variance of a standardised
    feature's coefficient (EV / PP-PK), ``t0`` EV pseudo minutes of the rates, ``spm`` / ``spm_st``
    on/off (off = v3 exactly)."""
    spm: bool = True
    spm_st: bool = True
    v_beta: float = 0.003
    v_beta_st: float = 0.003
    t0: float = 150.0

    def key(self) -> str:
        k = f"vo{self.v_o:g}_vd{self.v_d:g}_r{self.role}_a{int(self.use_aging)}"
        if self.spm:
            k += f"_spm_b{self.v_beta:g}_t{self.t0:g}"
        return k

    def st_key(self) -> str:
        k = f"pp{self.v_pp:g}_pk{self.v_pk:g}"
        if self.spm_st:
            k += f"_bst{self.v_beta_st:g}"
        return k

    def as_dict(self) -> dict:
        return asdict(self)


# the selected configuration (out/v4_validation.json "chosen" / "chosen_st": v4_prereg rules on 2019-23)
SHRINK = Shrink4(v_o=0.01, v_d=0.02, v_beta=1e-4, t0=150.0, spm=True, spm_st=True, v_beta_st=3e-4, v_pp=0.04, v_pk=0.08)


# ----------------------------------------------------------------------- weighted box sums and features

def box_sums(pg: pd.DataFrame, w: np.ndarray) -> pd.DataFrame:
    """Per player weighted sums of ``COUNT_COLS``, ``SEC_COLS`` and games (``gp``)."""
    w = np.asarray(w, dtype=float)
    m = w > 0
    if not m.any():
        return pd.DataFrame(columns=SUM_COLS, dtype=float)
    x = pg.loc[m, COUNT_COLS + SEC_COLS].to_numpy(float) * w[m, None]
    df = pd.DataFrame(x, columns=COUNT_COLS + SEC_COLS)
    df["gp"] = w[m]
    df["player_id"] = pg["player_id"].to_numpy()[m]
    return df.groupby("player_id")[SUM_COLS].sum()


def add_box(*parts) -> pd.DataFrame:
    parts = [p for p in parts if p is not None and len(p)]
    if not parts:
        return pd.DataFrame(columns=SUM_COLS, dtype=float)
    return pd.concat(parts).groupby(level=0).sum()


def interp_box(a: pd.DataFrame, b: pd.DataFrame, t: float) -> pd.DataFrame:
    if t <= 0:
        return a
    idx = a.index.union(b.index)
    return a.reindex(idx).fillna(0.0) * (1 - t) + b.reindex(idx).fillna(0.0) * t


def _groups(index, groups: dict) -> np.ndarray:
    return np.array(["D" if groups.get(int(p)) == "D" else "F" for p in index])


def _t0s(t0: float) -> dict:
    s = 60.0 * float(t0)
    return {"ev": s, "pp": PP_T0_FRAC * s, "pk": PP_T0_FRAC * s, "all": ALL_T0_FRAC * s}


def _kind(f: str) -> str:
    if f in USAGE:
        return "usage"
    return f.rsplit("_", 1)[1]


def _sec(sums: pd.DataFrame, kind: str) -> np.ndarray:
    if kind == "all":
        return sums[SEC_COLS].to_numpy(float).sum(axis=1)
    return sums[f"{kind}_s"].to_numpy(float)


@dataclass
class SpmStats:
    """Per position group: shrink targets ``mu`` (league rate per second, usage: seconds per game),
    standardisation ``mean`` / ``sd`` of the shrunk rates (EV-seconds weighted), feature list."""
    t0: float
    mu: dict = field(default_factory=dict)      # grp -> np.array(len FEATURES)
    mean: dict = field(default_factory=dict)
    sd: dict = field(default_factory=dict)

    @classmethod
    def fit(cls, sums: pd.DataFrame, groups: dict, t0: float) -> "SpmStats":
        st = cls(float(t0))
        grp = _groups(sums.index, groups)
        for g in ("F", "D"):
            s = sums[grp == g]
            mu = np.zeros(len(FEATURES))
            for k, f in enumerate(FEATURES):
                kind = _kind(f)
                if kind == "usage":
                    tot_gp = float(s["gp"].sum())
                    mu[k] = float(s[f"{f.split('_')[1]}_s"].sum()) / tot_gp if tot_gp > 0 else 0.0
                else:
                    sec = float(_sec(s, kind).sum())
                    mu[k] = float(s[f].sum()) / sec if sec > 0 else 0.0
            st.mu[g] = mu
            r = rates(s, np.full(len(s), g), st)
            w = np.maximum(s["ev_s"].to_numpy(float), 0.0)
            if w.sum() <= 0:
                w = np.ones(len(s))
            m = np.average(r, axis=0, weights=w) if len(s) else np.zeros(len(FEATURES))
            sd = np.sqrt(np.average((r - m) ** 2, axis=0, weights=w)) if len(s) else np.ones(len(FEATURES))
            sd = np.where(sd > 1e-9, sd, 1.0)
            st.mean[g], st.sd[g] = m, sd
        return st

    def z(self, sums: pd.DataFrame, groups: dict) -> np.ndarray:
        """Standardised features (n x len FEATURES), D faceoff features 0."""
        grp = _groups(sums.index, groups)
        r = rates(sums, grp, self)
        out = np.zeros_like(r)
        for g in ("F", "D"):
            m = grp == g
            if m.any():
                out[m] = np.clip((r[m] - self.mean[g]) / self.sd[g], -Z_CLIP, Z_CLIP)
        if (grp == "D").any():
            for f in D_DROP:
                out[grp == "D", FEATURES.index(f)] = 0.0
        return out

    def to_json(self) -> dict:
        return {"t0": self.t0, **{k: {g: [float(x) for x in v] for g, v in getattr(self, k).items()}
                                  for k in ("mu", "mean", "sd")}}

    @classmethod
    def from_json(cls, j: dict) -> "SpmStats":
        return cls(float(j["t0"]), *[{g: np.array(v, float) for g, v in j[k].items()} for k in ("mu", "mean", "sd")])

    @staticmethod
    def mix(a: "SpmStats", b: "SpmStats", t: float) -> "SpmStats":
        return SpmStats(a.t0, *[{g: (1 - t) * getattr(a, k)[g] + t * getattr(b, k)[g] for g in getattr(a, k)}
                                for k in ("mu", "mean", "sd")])


def rates(sums: pd.DataFrame, grp: np.ndarray, st: SpmStats) -> np.ndarray:
    """Shrunk per-60 rates (usage: minutes per game) of ``FEATURES``: (count + mu t0) / (sec + t0)."""
    n = len(sums)
    out = np.zeros((n, len(FEATURES)))
    if not n:
        return out
    t0 = _t0s(st.t0)
    mu = np.stack([st.mu[g] for g in grp]) if len(grp) else np.zeros((0, len(FEATURES)))
    gp = sums["gp"].to_numpy(float)
    for k, f in enumerate(FEATURES):
        kind = _kind(f)
        if kind == "usage":
            x = sums[f"{f.split('_')[1]}_s"].to_numpy(float)
            out[:, k] = (x + GP0 * mu[:, k]) / (gp + GP0) / 60.0
        else:
            sec = _sec(sums, kind)
            out[:, k] = (sums[f].to_numpy(float) + mu[:, k] * t0[kind]) / (sec + t0[kind]) * 3600.0
    return out


def blocked(Z: np.ndarray, grp: np.ndarray) -> np.ndarray:
    """(n x 2K): the F block for forwards, the D block for defencemen."""
    K = Z.shape[1]
    out = np.zeros((len(Z), 2 * K))
    f = grp != "D"
    out[f, :K] = Z[f]
    out[~f, K:] = Z[~f]
    return out


# ----------------------------------------------------------------------- penalty rates (impact term)

def penalty_rates(sums: pd.DataFrame, groups: dict, t0: float = PEN_T0, mu: dict | None = None) -> pd.DataFrame:
    """Drawn / taken penalty units per 60 of all-situation TOI, shrunk to the position-group rate with
    ``t0`` pseudo minutes; ``mu``: {grp: (drawn, taken) per second} (default: from ``sums``)."""
    if not len(sums):
        return pd.DataFrame(columns=["pd60", "pt60"], dtype=float)
    grp = _groups(sums.index, groups)
    sec = sums[SEC_COLS].to_numpy(float).sum(axis=1)
    if mu is None:
        mu = {}
        for g in ("F", "D"):
            m = grp == g
            s = sec[m].sum()
            mu[g] = ((float(sums["pd_all"].to_numpy()[m].sum()) / s, float(sums["pt_all"].to_numpy()[m].sum()) / s)
                     if s > 0 else (0.0, 0.0))
    T = 60.0 * float(t0)
    md = np.array([mu[g][0] for g in grp])
    mt = np.array([mu[g][1] for g in grp])
    return pd.DataFrame({"pd60": (sums["pd_all"].to_numpy(float) + md * T) / (sec + T) * 3600.0,
                         "pt60": (sums["pt_all"].to_numpy(float) + mt * T) / (sec + T) * 3600.0}, index=sums.index)


# ----------------------------------------------------------------------- joint solve (players + roles + SPM)

def solve_spm(blocks, ids, ncov, v_a, v_b, Ma, Mb, lam_ma, lam_mb, sigma2, want_var=True) -> dict:
    """Joint ridge over seasons' blocks: [A comps, B comps, cov block per season, M_a coefs, M_b coefs].

    ``Ma`` / ``Mb`` (nU x k): the prior-mean design of each component (role indicators, then the
    blocked SPM features); ``lam_ma`` / ``lam_mb`` their ridge precisions.  A player's total =
    own effect + M row x coefficients.  ``v3._solve_two_comp`` with a dense M."""
    nU = len(ids)
    pos = {int(p): i for i, p in enumerate(ids)}
    nb = len(blocks)
    ka, kb = Ma.shape[1], Mb.shape[1]
    P = 2 * nU + ncov * nb + ka + kb
    A = np.zeros((P, P))
    r = np.zeros(P)
    for b, (lids, G, rl) in enumerate(blocks):
        pl = np.array([pos[int(p)] for p in lids], dtype=np.int64)
        m = np.concatenate([pl, nU + pl, 2 * nU + b * ncov + np.arange(ncov)])
        A[np.ix_(m, m)] += G
        r[m] += rl
    wdat = np.diag(A)[:2 * nU].copy()
    lam = np.full(P, V.COV_LAM)
    lam[:nU] = sigma2 / v_a
    lam[nU:2 * nU] = sigma2 / v_b
    lam[2 * nU:2 * nU + ncov * nb:ncov] = 1e-6
    o0 = 2 * nU + ncov * nb
    o1 = o0 + ka
    Ms = [(slice(0, nU), slice(o0, o1), Ma), (slice(nU, 2 * nU), slice(o1, o1 + kb), Mb)]
    Cs = [(cols, rc, M, A[:, cols] @ M) for cols, rc, M in Ms]
    for cols, rc, M, C in Cs:
        A[:, rc] = C
        A[rc, :] = C.T
        r[rc] = M.T @ r[cols]
    for cols1, rc1, M1, C1 in Cs:
        for cols2, rc2, M2, C2 in Cs:
            A[rc1, rc2] = M1.T @ C2[cols1]
    lam[o0:o1] = lam_ma
    lam[o1:o1 + kb] = lam_mb
    A[np.diag_indices_from(A)] += lam
    c = la.cho_factor(A, lower=False, check_finite=False)
    sol = la.cho_solve(c, r, check_finite=False)
    ca, cb = sol[o0:o1], sol[o1:o1 + kb]
    out = {"ids": ids, "w_a": wdat[:nU], "w_b": wdat[nU:], "coef_a": ca.copy(), "coef_b": cb.copy(),
           "a": sol[:nU] + Ma @ ca, "b": sol[nU:2 * nU] + Mb @ cb,
           "cov": [sol[2 * nU + b * ncov: 2 * nU + (b + 1) * ncov].copy() for b in range(nb)]}
    if want_var:
        E = np.zeros((P, 2 * nU))
        E[np.arange(nU), np.arange(nU)] = 1.0
        E[nU + np.arange(nU), nU + np.arange(nU)] = 1.0
        E[o0:o1, :nU] = Ma.T
        E[o1:o1 + kb, nU:] = Mb.T
        X = la.cho_solve(c, E, check_finite=False)
        out["var_a"] = sigma2 * np.einsum("ij,ij->j", E[:, :nU], X[:, :nU])
        out["var_b"] = sigma2 * np.einsum("ij,ij->j", E[:, nU:], X[:, nU:])
        out["cov_ab"] = sigma2 * np.einsum("ij,ij->j", E[:, :nU], X[:, nU:])
        Er = np.zeros((P, ka + kb))
        Er[o0 + np.arange(ka + kb), np.arange(ka + kb)] = 1.0
        Xr = la.cho_solve(c, Er, check_finite=False)
        dv = sigma2 * np.einsum("ij,ij->j", Er, Xr)
        out["mvar_a"], out["mvar_b"] = dv[:ka], dv[ka:]
    return out


def _onehot(ids, roles: dict, names: list) -> np.ndarray:
    ix = {n: k for k, n in enumerate(names)}
    M = np.zeros((len(ids), len(names)))
    M[np.arange(len(ids)), [ix[roles[int(p)]] for p in ids]] = 1.0
    return M


# ----------------------------------------------------------------------- prior and engine

@dataclass
class Prior4(V.Prior):
    """v3 ``Prior`` + the SPM: ``stats`` (standardisation), ``coef`` ({'o','d','pp','pk'} -> {grp:
    array(len FEATURES)}) and ``box`` (the pre-season weighted box sums at this g)."""
    stats: SpmStats | None = None
    coef: dict | None = None
    box: pd.DataFrame | None = None


def _split_coef(c: np.ndarray, nroles: int) -> dict:
    K = len(FEATURES)
    f = c[nroles:]
    if len(f) != 2 * K:
        return {"F": np.zeros(K), "D": np.zeros(K)}
    return {"F": f[:K].copy(), "D": f[K:].copy()}


class Engine4(V.Engine):
    """v3 engine + per-season box-score player-games (``box``: season -> ``box.player_game_counts``)."""

    def __init__(self, inputs: dict, clock, players: pd.DataFrame, box: dict, agings: dict | None = None,
                 rookies: dict | None = None):
        super().__init__(inputs, clock, players, agings, rookies)
        self.box = {str(k): v for k, v in box.items()}
        self._Lb = {s: clock.before(b["d"].to_numpy(dtype="datetime64[D]")) for s, b in self.box.items()}

    # ---- box sums
    def box_pre(self, S: str, g: float, rec: Recency) -> pd.DataFrame:
        L0 = self.clock.season_start(S)
        parts = [box_sums(b, rec.weight(g + (L0 - self._Lb[s]))) for s, b in self.box.items() if s < str(S)]
        return add_box(*parts)

    def box_in(self, S: str, asof, rec: Recency) -> pd.DataFrame:
        b = self.box.get(str(S))
        if b is None or not len(b):
            return add_box()
        d = b["d"].to_numpy(dtype="datetime64[D]")
        cutoff = np.datetime64(asof, "D") - np.timedelta64(V.LAG_DAYS, "D")
        w = np.where(d <= cutoff, rec.weight(float(self.clock.before([asof])[0]) - self._Lb[str(S)]), 0.0)
        return box_sums(b, w)

    # ---- stage 1
    def stage1(self, S: str, g: float, rec: Recency, sh, want_var: bool = True, st: bool = True,
               ev: bool = True) -> Prior4:
        if not isinstance(sh, Shrink4) or not (sh.spm or sh.spm_st):
            p = super().stage1(S, g, rec, sh, want_var, st, ev)
            return Prior4(**{k: getattr(p, k) for k in ("g", "ev", "st", "role_ev", "role_st", "cov_ev", "cov_st")})
        S = str(S)
        yr = int(S[:4])
        wd = self.pre_date_weights(S, g, rec)
        pre = [x.toi for s, x in self.inp.items() if s < S]
        toi_pre = pd.concat(pre, ignore_index=True) if pre else pd.DataFrame(columns=["player_id", "d", "ev_s"])
        use = V.weighted_usage(toi_pre, wd)
        sums = self.box_pre(S, g, rec)
        stats = SpmStats.fit(sums, self.bio.group, sh.t0)
        K = len(FEATURES)
        coef = {}

        def zrows(ids):
            Z = np.zeros((len(ids), K))
            have = np.array([int(p) in sums.index for p in ids], dtype=bool)
            if have.any():
                Z[have] = stats.z(sums.loc[[int(p) for p, h in zip(ids, have) if h]], self.bio.group)
            return blocked(Z, np.array([self.bio.g(p) for p in ids]))

        blocks = []
        aging = self.agings.get(S) if sh.use_aging else None
        for s, w in (sorted(self.pre_weights(S, g, rec, "ev").items()) if ev else []):
            des = self.inp[s].ev
            G, r, *_ = des.gram(w)
            if aging is not None:
                r = r + G @ V._aging_shift(des, aging, self.bio, S, yr - int(s[:4]))
            blocks.append((des.ids, G.toarray(), r))
        evd, role_ev, cov_ev = {}, {}, None
        if blocks:
            ids = np.array(sorted({int(p) for b in blocks for p in b[0]}), dtype=np.int64)
            ur = self.roles_for(ids, use, sh)
            R = _onehot(ids, ur, V.ROLES)
            nr = R.shape[1]
            if sh.spm:
                Zb = zrows(ids)
                M = np.hstack([R, Zb])
                lam_m = np.concatenate([np.full(nr, V.SIGMA2_EV / sh.v_role), np.full(Zb.shape[1], V.SIGMA2_EV / sh.v_beta)])
            else:
                M = R
                lam_m = np.full(nr, V.SIGMA2_EV / sh.v_role)
            out = solve_spm(blocks, ids, len(COVARIATES), sh.v_o, sh.v_d, M, M, lam_m, lam_m, V.SIGMA2_EV, want_var)
            c_a, c_b = V._center(out)
            cov_ev = V.recenter_cov("ev", out["cov"][-1], c_a, c_b)
            for i, p in enumerate(ids):
                evd[int(p)] = (float(out["a"][i] - c_a), float(out["b"][i] - c_b),
                               float(out["var_a"][i]) if want_var else sh.v_o,
                               float(out["var_b"][i]) if want_var else sh.v_d,
                               float(out["cov_ab"][i]) if want_var else 0.0, ur[int(p)])
            for k, nm in enumerate(V.ROLES):
                role_ev[nm] = (float(out["coef_a"][k]) - c_a, float(out["coef_b"][k]) - c_b,
                               float(out["mvar_a"][k]) if want_var else 0.0,
                               float(out["mvar_b"][k]) if want_var else 0.0)
            coef["o"], coef["d"] = _split_coef(out["coef_a"], nr), _split_coef(out["coef_b"], nr)
        stp, role_st, cov_st = {}, {}, None
        if st:
            sblocks = []
            for s, w in sorted(self.pre_weights(S, g, rec, "st").items()):
                des = self.inp[s].st
                G, r, *_ = des.gram(w)
                sblocks.append((des.ids, G.toarray(), r))
            if sblocks:
                ids = np.array(sorted({int(p) for b in sblocks for p in b[0]}), dtype=np.int64)
                roles = {int(p): self.bio.g(p) for p in ids}
                R = _onehot(ids, roles, ["F", "D"])
                if sh.spm_st:
                    Zb = zrows(ids)
                    M = np.hstack([R, Zb])
                    lam_m = np.concatenate([np.full(2, V.SIGMA2_ST / sh.v_role_st),
                                            np.full(Zb.shape[1], V.SIGMA2_ST / sh.v_beta_st)])
                else:
                    M = R
                    lam_m = np.full(2, V.SIGMA2_ST / sh.v_role_st)
                out = solve_spm(sblocks, ids, len(V.ST_COVARIATES), sh.v_pp, sh.v_pk, M, M, lam_m, lam_m, V.SIGMA2_ST,
                                want_var)
                c_a, c_b = V._center(out)
                cov_st = V.recenter_cov("st", out["cov"][-1], c_a, c_b)
                for i, p in enumerate(ids):
                    stp[int(p)] = (float(out["a"][i] - c_a), float(out["b"][i] - c_b),
                                   float(out["var_a"][i]) if want_var else sh.v_pp,
                                   float(out["var_b"][i]) if want_var else sh.v_pk)
                for k, nm in enumerate(["F", "D"]):
                    role_st[nm] = (float(out["coef_a"][k]) - c_a, float(out["coef_b"][k]) - c_b,
                                   float(out["mvar_a"][k]) if want_var else 0.0,
                                   float(out["mvar_b"][k]) if want_var else 0.0)
                coef["pp"], coef["pk"] = _split_coef(out["coef_a"], 2), _split_coef(out["coef_b"], 2)
        for k in ("o", "d", "pp", "pk"):
            coef.setdefault(k, {"F": np.zeros(K), "D": np.zeros(K)})
        if not sh.spm:
            coef["o"], coef["d"] = {"F": np.zeros(K), "D": np.zeros(K)}, {"F": np.zeros(K), "D": np.zeros(K)}
        if not sh.spm_st:
            coef["pp"], coef["pk"] = {"F": np.zeros(K), "D": np.zeros(K)}, {"F": np.zeros(K), "D": np.zeros(K)}
        return Prior4(float(g), evd, stp, role_ev, role_st, cov_ev, cov_st, stats, coef, sums)

    # ---- stage 2
    def spm_shift(self, ids, prior: Prior4, box_in: pd.DataFrame, comps=("o", "d")) -> np.ndarray:
        """(n x len comps): beta' (z(pre + in) - z(pre)) per player (z(pre) = 0 without a stage-1 prior)."""
        n = len(ids)
        out = np.zeros((n, len(comps)))
        if prior.stats is None or prior.coef is None or not n:
            return out
        pre = prior.box if prior.box is not None else add_box()
        idx = pd.Index([int(p) for p in ids])
        allb = add_box(pre, box_in).reindex(idx).fillna(0.0)
        preb = pre.reindex(idx).fillna(0.0)
        z1 = prior.stats.z(allb, self.bio.group)
        z0 = prior.stats.z(preb, self.bio.group)
        have = prior.ev if comps[0] == "o" else prior.st
        has_prior = np.array([int(p) in have for p in ids], dtype=bool)
        has_pre = (preb[SEC_COLS].to_numpy(float).sum(axis=1) > 0) & has_prior
        z0[~has_pre] = 0.0
        dz = z1 - z0
        grp = np.array([self.bio.g(p) for p in ids])
        for j, c in enumerate(comps):
            cf = prior.coef.get(c) or {}
            B = np.stack([cf.get(g, np.zeros(len(FEATURES))) for g in grp])
            out[:, j] = np.einsum("ij,ij->i", dz, B)
        return out

    def stage2(self, S: str, asof, rec: Recency, sh, prior, want_sd: bool = False, st: bool = True,
               ev: bool = True) -> dict:
        if not isinstance(sh, Shrink4) or not isinstance(prior, Prior4) or prior.coef is None:
            return super().stage2(S, asof, rec, sh, prior, want_sd, st, ev)
        S = str(S)
        x = self.inp[S]
        bi = self.box_in(S, asof, rec)
        out = {}
        if ev:
            des = x.ev
            n = des.n
            b0, lam, roles = self.prior_ev(S, asof, rec, sh, prior)
            if sh.spm:
                sh_ = self.spm_shift(des.ids, prior, bi, ("o", "d"))
                b0[:n] += sh_[:, 0]
                b0[n:2 * n] += sh_[:, 1]
            beta, var = self.solve(des, self.in_weights(S, asof, rec, "ev"), b0, lam, V.SIGMA2_EV, want_sd)
            df = pd.DataFrame({"player_id": des.ids, "o": beta[:n], "d": beta[n:2 * n]})
            if var is not None:
                df["o_var"], df["d_var"], df["od_cov"] = var
            df["role"] = df["player_id"].map(roles)
            out["ev"], out["beta_ev"] = df, beta
        if st:
            sdes = x.st
            ns = sdes.n
            b0, lam = self.prior_st(S, sh, prior)
            if sh.spm_st:
                sh_ = self.spm_shift(sdes.ids, prior, bi, ("pp", "pk"))
                b0[:ns] += sh_[:, 0]
                b0[ns:2 * ns] += sh_[:, 1]
            bs, var = self.solve(sdes, self.in_weights(S, asof, rec, "st"), b0, lam, V.SIGMA2_ST, want_sd)
            sdf = pd.DataFrame({"player_id": sdes.ids, "pp": bs[:ns], "pk": bs[ns:2 * ns]})
            if var is not None:
                sdf["pp_var"], sdf["pk_var"] = var[0], var[1]
            out["st"], out["beta_st"] = sdf, bs
        return out


def interpolate4(grid: list, g: float, sh) -> Prior4:
    """``v3.interpolate`` + the SPM parts (coefficients, standardisation and box sums linear in g)."""
    gs = np.array([p.g for p in grid])
    g = float(np.clip(g, gs.min(), gs.max()))
    k = int(np.searchsorted(gs, g, side="right")) - 1
    k = min(max(k, 0), len(grid) - 1)
    if k == len(grid) - 1 or abs(g - gs[k]) < 1e-9:
        return grid[k]
    p0, p1 = grid[k], grid[k + 1]
    a = (g - gs[k]) / (gs[k + 1] - gs[k])
    base = V.interpolate([p0, p1], g, sh)
    stats = coef = box = None
    if p0.stats is not None and p1.stats is not None:
        stats = SpmStats.mix(p0.stats, p1.stats, a)
        coef = {c: {gg: (1 - a) * p0.coef[c][gg] + a * p1.coef[c][gg] for gg in p0.coef[c]} for c in p0.coef}
        box = interp_box(p0.box, p1.box, a)
    return Prior4(base.g, base.ev, base.st, base.role_ev, base.role_st, base.cov_ev, base.cov_st, stats, coef, box)


def coef_table(prior: Prior4) -> pd.DataFrame:
    """Coefficients per standardised feature (xG/60 per SD; DEF and PK in the 'prevented' sign,
    higher = better), columns <comp>_<grp>."""
    out = {}
    for c, sign in (("o", 1), ("d", -1), ("pp", 1), ("pk", -1)):
        for g in ("F", "D"):
            out[f"{c}_{g}"] = sign * np.asarray(prior.coef[c][g])
    return pd.DataFrame(out, index=FEATURES)
