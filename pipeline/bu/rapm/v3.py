"""Player ratings v3: game-recency RAPM with separate OFF / DEF shrinkage and role priors.

Owner decisions 2026-10-02 (``bu/rapm/README.md`` "Ratings v3"): recency is counted in games
(``recency.Recency``: the last 5 x 30-game blocks or a per-game decay, nothing 3+ seasons back),
OFF and DEF get their own prior variance, low-minute players start at their role's level, and the
site's headline is a per-game impact that adds power play / penalty kill and finishing.

**Model.**  Every EV stint gives two rows (``design.stint_rows``: attacking side's xG/60, O column
of each attacker, D column of each defender, the shared covariates) and every PP stint one row
(the power-play side's xG/60, ``PP`` column of each PP skater, ``PK`` column of each PK skater,
``ST_COVARIATES``).  Row weight = stint seconds x era weight x recency weight of its date.  The
player effects are

    o_i = mu_O[role(i)] + u_i,   u_i ~ N(0, v_o)        d_i = mu_D[role(i)] + e_i,   e_i ~ N(0, v_d)

with ``role`` = position group x EV usage tier (EV minutes per game over the same weighted
games; ``USAGE_TIERS``), or position x draft tier for a player with fewer than ``MIN_ROLE_GP``
weighted games, and role means fitted jointly (light ridge ``v_role``).  ``Shrink.role = False``
replaces the role means by the fixed rookie means of position x draft tier (the v2 target).
PP / PK: ``v_pp`` / ``v_pk`` around position-group means.

**Two stages (what the live refresh can rebuild from a small pack).**  For season S and an
as-of date d with ``g`` games per team played this season:

1. *pre-season prior* (``stage1``): the weighted fit of every stint before S, weight
   ``w(g + a_t)`` (``a_t`` = games ago at the season start), each earlier season with its own
   covariate block and rows moved forward by the players' aging steps, summarised per player as
   (mean, posterior variance, OFF/DEF covariance).  It is computed on the grid ``G_GRID``
   (every 5 games) and interpolated linearly in ``g`` (means; precisions); the season pack carries
   the grid (``ratings_pack``) so CI needs no earlier season;
2. *in-season fit* (``stage2``): this season's stints available by ``d - LAG_DAYS``, each date at
   its exact weight ``w(L_before(d) - L_before(t))``, ridged toward the stage-1 prior (players
   without one: their role mean, ``v_o`` / ``v_d``).

A game played tonight therefore moves every in-season weight exactly and the pre-season weights
by interpolation; the validation scores the same two-stage computation the live path runs.
"""
from __future__ import annotations

import os
import pickle
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd
import scipy.linalg as la
import scipy.sparse as sp

from .design import COVARIATES, ERA_WEIGHTS, back_to_back, stint_rows
from .recency import LeagueClock, Recency
from .stints import MIN_GAME_ONICE_MATCH, ev_mask

SIGMA2_EV = 1160.0          # residual variance per second of 5v5 xG/60 (priors.SIGMA2_DEFAULT)
SIGMA2_ST = 2800.0          # same for PP rows (flat fits of 2021-22 and 2022-23: 3190, 2520 per row)
ST_COVARIATES = ["intercept", "home", "st_5v3", "st_4v3", "zone_O", "zone_N", "zone_D"]
USAGE_TIERS = {"F": (11.0, 13.0, 15.0), "D": (16.0, 18.5)}   # EV minutes / game edges (u1 < ... )
MIN_ROLE_GP = 10.0          # weighted games for a usage tier; fewer: position x draft tier
G_STEP = 5.0
G_GRID = tuple(np.arange(0.0, 120.0 + G_STEP / 2, G_STEP))
COV_LAM = 3600.0 * 20
LAG_DAYS = 2


@dataclass(frozen=True)
class Shrink:
    v_o: float = 0.03
    v_d: float = 0.015
    role: str = "both"           # "both": usage-role means for OFF and DEF; "off": OFF only; "none"
    v_role: float = 0.05
    use_aging: bool = True
    v_pp: float = 0.04
    v_pk: float = 0.02
    v_role_st: float = 0.05         # PP / PK position-group means (light ridge)

    def key(self) -> str:
        return f"vo{self.v_o:g}_vd{self.v_d:g}_r{self.role}_a{int(self.use_aging)}"

    def as_dict(self) -> dict:
        return asdict(self)


# ----------------------------------------------------------------------- per-date Gram store

class Design:
    """One season's regression rows of one kind ('ev' or 'st') as per-date Gram pieces.

    ``gram(w)`` returns the weighted X'WX (sparse), X'Wy, y'Wy, sum w and row count for any
    per-date weight vector ``w`` (len = number of dates) in O(nnz): the pieces are stored as a
    sparse (unique entry x date) matrix ``T``."""

    def __init__(self, kind, season, ids, ncov, dates, urow, ucol, T, R, yy, sw, nrow):
        self.kind, self.season = kind, str(season)
        self.ids = np.asarray(ids, dtype=np.int64)
        self.n = len(self.ids)
        self.ncov = int(ncov)
        self.p = 2 * self.n + self.ncov
        self.pos = {int(p): i for i, p in enumerate(self.ids)}
        self.dates = np.asarray(dates, dtype="datetime64[D]")
        self.urow, self.ucol, self.T, self.R = urow, ucol, T, R
        self.yy, self.sw, self.nrow = yy, sw, nrow

    @classmethod
    def from_rows(cls, kind, season, att, dfn, cov, y, w, dates) -> "Design":
        ids = np.array(sorted({int(p) for a in att for p in a} | {int(p) for a in dfn for p in a}), dtype=np.int64)
        pos = {int(p): i for i, p in enumerate(ids)}
        n, ncov = len(ids), cov.shape[1]
        p = 2 * n + ncov
        la_ = np.array([len(a) for a in att])
        ld_ = np.array([len(a) for a in dfn])
        rows = np.concatenate([np.repeat(np.arange(len(att)), la_), np.repeat(np.arange(len(dfn)), ld_)])
        cols = np.concatenate([np.array([pos[int(x)] for a in att for x in a], dtype=np.int64),
                               n + np.array([pos[int(x)] for a in dfn for x in a], dtype=np.int64)])
        cr, cc = np.nonzero(cov)
        X = sp.csr_matrix((np.concatenate([np.ones(len(rows)), cov[cr, cc]]),
                           (np.concatenate([rows, cr]), np.concatenate([cols, 2 * n + cc]))), shape=(len(y), p))
        order = np.argsort(dates, kind="stable")
        X, y, w, dates = X[order], y[order], w[order], dates[order]
        ud, start = np.unique(dates, return_index=True)
        bounds = np.append(start, len(y))
        keys, vals, kcol = [], [], []
        R = np.zeros((p, len(ud)))
        yy, sw, nrow = np.zeros(len(ud)), np.zeros(len(ud)), np.zeros(len(ud))
        for k in range(len(ud)):
            lo, hi = bounds[k], bounds[k + 1]
            Xk = X[lo:hi]
            wk = w[lo:hi]
            Xw = sp.csr_matrix(Xk.multiply(wk[:, None]))
            G = sp.triu(Xw.T @ Xk).tocoo()
            keys.append(G.row.astype(np.int64) * p + G.col)
            vals.append(G.data)
            kcol.append(np.full(len(G.data), k, dtype=np.int64))
            R[:, k] = Xw.T @ y[lo:hi]
            yy[k] = float(np.sum(wk * y[lo:hi] ** 2))
            sw[k] = float(np.sum(wk))
            nrow[k] = hi - lo
        keys = np.concatenate(keys)
        uk, inv = np.unique(keys, return_inverse=True)
        T = sp.csr_matrix((np.concatenate(vals), (inv, np.concatenate(kcol))), shape=(len(uk), len(ud)))
        return cls(kind, season, ids, ncov, ud, (uk // p).astype(np.int32), (uk % p).astype(np.int32), T, R, yy, sw,
                   nrow)

    def gram(self, w):
        """(G sparse symmetric p x p, r, yy, sw, n) for per-date weights ``w``."""
        w = np.asarray(w, dtype=float)
        v = self.T @ w
        m = v != 0
        r_, c_, v_ = self.urow[m], self.ucol[m], v[m]
        off = r_ != c_
        G = sp.csr_matrix((np.concatenate([v_, v_[off]]), (np.concatenate([r_, c_[off]]), np.concatenate([c_, r_[off]]))),
                          shape=(self.p, self.p))
        return G, self.R @ w, float(self.yy @ w), float(self.sw @ w), float(self.nrow @ (w != 0))

    def date_sse(self, beta, w=None):
        """Per-date weighted SSE of the rows given a full coefficient vector ``beta``."""
        q = beta[self.urow] * beta[self.ucol]
        q = np.where(self.urow == self.ucol, q, 2 * q)
        quad = self.T.T @ q
        lin = self.R.T @ beta
        out = self.yy - 2 * lin + quad
        return out if w is None else out * w


# ----------------------------------------------------------------------- season inputs

def st_rows(st: pd.DataFrame):
    """PP rows of one season's stints: (att, dfn, cov, y, w, dates)."""
    m = ((st["n_home_g"] == 1) & (st["n_away_g"] == 1) & (st["n_home_sk"] != st["n_away_sk"])
         & st["n_home_sk"].between(3, 5) & st["n_away_sk"].between(3, 5)
         & st["game_type"].isin([2, 3]) & (st["game_onice_match"] >= MIN_GAME_ONICE_MATCH))
    s = st[m]
    home_pp = (s["n_home_sk"] > s["n_away_sk"]).to_numpy()
    hs, as_ = list(s["home_sk"]), list(s["away_sk"])
    att = [list(h) if hp else list(a) for h, a, hp in zip(hs, as_, home_pp)]
    dfn = [list(a) if hp else list(h) for h, a, hp in zip(hs, as_, home_pp)]
    npp = np.where(home_pp, s["n_home_sk"], s["n_away_sk"])
    npk = np.where(home_pp, s["n_away_sk"], s["n_home_sk"])
    zone = s["zone_home"].fillna("").to_numpy()
    flip = {"O": "D", "D": "O", "N": "N", "": ""}
    zpp = np.array([z if hp else flip.get(z, "") for z, hp in zip(zone, home_pp)], dtype=object)
    cov = np.zeros((len(s), len(ST_COVARIATES)))
    cov[:, 0] = 1.0
    cov[:, 1] = home_pp
    cov[:, 2] = (npp == 5) & (npk == 3)
    cov[:, 3] = (npp == 4) & (npk == 3)
    cov[:, 4] = zpp == "O"
    cov[:, 5] = zpp == "N"
    cov[:, 6] = zpp == "D"
    dur = s["dur"].to_numpy(dtype=float)
    xg = np.where(home_pp, s["xgf_home"], s["xgf_away"]).astype(float)
    era = s["season"].astype(str).map(ERA_WEIGHTS).fillna(1.0).to_numpy(dtype=float)
    y = xg * 3600.0 / np.maximum(dur, 1.0)
    dates = pd.to_datetime(s["game_date"]).to_numpy(dtype="datetime64[D]")
    return att, dfn, cov, y, dur * era, dates


def state_toi(st: pd.DataFrame) -> pd.DataFrame:
    """(game_id, d, player_id, ev_s, pp_s, pk_s): seconds per state, both goalies in, regular
    season + playoffs, games passing the on-ice check."""
    s = st[(st["n_home_g"] == 1) & (st["n_away_g"] == 1) & st["game_type"].isin([2, 3])
           & (st["game_onice_match"] >= MIN_GAME_ONICE_MATCH)]
    nh, na = s["n_home_sk"].to_numpy(), s["n_away_sk"].to_numpy()
    dur = s["dur"].to_numpy(dtype=float)
    d = pd.to_datetime(s["game_date"]).to_numpy(dtype="datetime64[D]")
    gid = s["game_id"].to_numpy()
    recs = []
    for side, sk, mine, theirs in (("h", s["home_sk"], nh, na), ("a", s["away_sk"], na, nh)):
        lens = np.array([len(x) for x in sk])
        pid = np.concatenate([np.asarray(x, dtype=np.int64) for x in sk]) if len(sk) else np.zeros(0, np.int64)
        rep = lambda a: np.repeat(a, lens)  # noqa: E731
        m_, t_ = rep(mine), rep(theirs)
        okn = (m_ >= 3) & (m_ <= 5) & (t_ >= 3) & (t_ <= 5)
        st_ = np.where(m_ == t_, 0, np.where(m_ > t_, 1, 2))
        recs.append(pd.DataFrame({"game_id": rep(gid), "d": rep(d), "player_id": pid, "state": st_, "sec": rep(dur),
                                  "ok": okn}))
    x = pd.concat(recs, ignore_index=True)
    x = x[x["ok"]]
    t = x.pivot_table(index=["game_id", "d", "player_id"], columns="state", values="sec", aggfunc="sum",
                      fill_value=0.0)
    t = t.reindex(columns=[0, 1, 2], fill_value=0.0)
    t.columns = ["ev_s", "pp_s", "pk_s"]
    return t.reset_index()


class SeasonInputs:
    """Everything v3 needs from one season (cached under ``<state>/v3/season=S.pkl``)."""

    def __init__(self, season, ev: Design, st: Design, toi: pd.DataFrame, fin_pg: pd.DataFrame,
                 shots: pd.DataFrame, game_type_by_date: dict):
        self.season = str(season)
        self.ev, self.st = ev, st
        self.toi, self.fin_pg, self.shots = toi, fin_pg, shots
        self.gtype = game_type_by_date

    @classmethod
    def build(cls, paths, season: str, source: str, log=print) -> "SeasonInputs":
        from bu.lake.build import read_table
        from .data import ensure_stints, ensure_xg
        from .finishing import ev_shots, player_games
        from bu.lineup.toi import game_shares
        stt = ensure_stints(paths, season, source)
        xg = ensure_xg(paths, season, source)
        g = read_table(paths.lake, "games", [season], columns=["game_id", "game_date", "game_type"])
        g = g[g["game_type"].isin([2, 3])]
        stt = stt[stt["game_id"].isin(set(g["game_id"]))]
        evs = stt[ev_mask(stt) & stt["game_type"].isin([2, 3]) & (stt["game_onice_match"] >= MIN_GAME_ONICE_MATCH)]
        evs = evs.reset_index(drop=True)
        rows = stint_rows(evs, back_to_back(paths.lake, [season]))
        ev = Design.from_rows("ev", season, rows.att, rows.dfn, rows.cov, rows.y, rows.w, rows.date)
        att, dfn, cov, y, w, dates = st_rows(stt)
        st = Design.from_rows("st", season, att, dfn, cov, y, w, dates)
        toi = state_toi(stt)
        pg = player_games(xg[xg["game_id"].isin(set(g["game_id"]))], game_shares(stt))
        gd = g.assign(d=pd.to_datetime(g["game_date"]).values.astype("datetime64[D]"))
        pg = pg.merge(gd[["game_id", "d"]], on="game_id")
        sh = ev_shots(xg).merge(gd[["game_id", "d"]], on="game_id")
        gt = gd.groupby("d")["game_type"].min().to_dict()
        log(f"  [v3] {season}: {len(rows):,} EV rows ({ev.n} skaters, {ev.T.nnz:,} gram cells), "
            f"{len(y):,} PP rows ({st.n} skaters)")
        return cls(season, ev, st, toi, pg, sh, {np.datetime64(k, "D"): int(v) for k, v in gt.items()})

    @classmethod
    def load(cls, paths, season: str, source: str, rebuild: bool = False, log=print) -> "SeasonInputs":
        p = os.path.join(paths.root, "v3", f"season={season}.pkl")
        if not rebuild and os.path.exists(p):
            with open(p, "rb") as f:
                obj = pickle.load(f)
            if getattr(obj, "source", None) == str(source):
                return obj
        obj = cls.build(paths, season, source, log=log)
        obj.source = str(source)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p + ".tmp", "wb") as f:
            pickle.dump(obj, f, protocol=pickle.HIGHEST_PROTOCOL)
        os.replace(p + ".tmp", p)
        return obj


# ----------------------------------------------------------------------- roles

def draft_tier(x) -> str:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return "undrafted"
    if not np.isfinite(v):
        return "undrafted"
    return "r1" if v <= 32 else "later"


def usage_role(group: str, toi_gp_min: float, eff_gp: float, tier: str) -> str:
    if eff_gp < MIN_ROLE_GP or not np.isfinite(toi_gp_min):
        return f"{group}|low|{tier}"
    edges = USAGE_TIERS["D" if group == "D" else "F"]
    k = int(np.searchsorted(np.asarray(edges), toi_gp_min, side="right"))
    return f"{group}|u{k + 1}"


def all_roles() -> list:
    out = []
    for g in ("F", "D"):
        out += [f"{g}|u{k + 1}" for k in range(len(USAGE_TIERS[g]) + 1)]
        out += [f"{g}|low|{t}" for t in ("r1", "later", "undrafted")]
    return out


ROLES = all_roles()


def def_role(role: str) -> str:
    """``Shrink.role == 'off'``: DEF role means by position (and draft tier for low samples) only."""
    return role if "|low|" in role else role.split("|")[0] + "|all"


DEF_ROLES = sorted({def_role(r) for r in ROLES})


def _center(out) -> tuple[float, float]:
    """Data-weighted mean of the player totals (an average skater on the ice = 0)."""
    wa, wb = np.maximum(out["w_a"], 0), np.maximum(out["w_b"], 0)
    ca = float(np.average(out["a"], weights=wa)) if wa.sum() > 0 else 0.0
    cb = float(np.average(out["b"], weights=wb)) if wb.sum() > 0 else 0.0
    return ca, cb


# skaters per side by covariate: EV rows (attackers = defenders): 5, 4 (st_4v4), 3 (st_3v3); PP rows
# (PP, PK): (5, 4), (5, 3) st_5v3, (4, 3) st_4v3.  Moving every player effect by c moves each row's
# prediction by n x c, which the intercept and the strength terms absorb exactly.
def recenter_cov(kind: str, cov, c_a: float, c_b: float):
    cov = np.array(cov, dtype=float).copy()
    if kind == "ev":
        cov[COVARIATES.index("intercept")] += 5 * (c_a + c_b)
        cov[COVARIATES.index("st_4v4")] -= (c_a + c_b)
        cov[COVARIATES.index("st_3v3")] -= 2 * (c_a + c_b)
    else:
        cov[ST_COVARIATES.index("intercept")] += 5 * c_a + 4 * c_b
        cov[ST_COVARIATES.index("st_5v3")] -= c_b
        cov[ST_COVARIATES.index("st_4v3")] -= c_a + c_b
    return cov


class Bio:
    def __init__(self, players: pd.DataFrame):
        b = players.drop_duplicates("player_id").set_index("player_id")
        self.group = {int(k): ("D" if v == "D" else "F") for k, v in b["pos_group"].items()}
        self.tier = {int(k): draft_tier(v) for k, v in b["draft_overall"].items()}
        self.birth = b["birth_date"] if "birth_date" in b.columns else pd.Series(dtype=object)

    def g(self, p) -> str:
        return self.group.get(int(p), "F")

    def t(self, p) -> str:
        return self.tier.get(int(p), "undrafted")


def weighted_usage(toi: pd.DataFrame, wdate: dict) -> pd.DataFrame:
    """Per player: weighted EV seconds per game and weighted games over the dates in ``wdate``."""
    if not len(toi):
        return pd.DataFrame(columns=["toi_gp", "eff_gp"])
    w = toi["d"].map(wdate).fillna(0.0).to_numpy()
    df = pd.DataFrame({"player_id": toi["player_id"].to_numpy(), "w": w, "ws": w * toi["ev_s"].to_numpy()})
    a = df.groupby("player_id")[["w", "ws"]].sum()
    a = a[a["w"] > 0]
    return pd.DataFrame({"toi_gp": a["ws"] / a["w"] / 60.0, "eff_gp": a["w"]})


# ----------------------------------------------------------------------- stage 1 (pre-season prior)

@dataclass
class Prior:
    """Per-player prior summary at one ``g`` (EV and PP/PK) plus role means."""
    g: float
    ev: dict          # pid -> (o, d, o_var, d_var, od_cov, role)
    st: dict          # pid -> (pp, pk, pp_var, pk_var)
    role_ev: dict     # role -> (mu_o, mu_d, var_o, var_d)
    role_st: dict     # 'F' / 'D' -> (mu_pp, mu_pk, var_pp, var_pk)
    cov_ev: np.ndarray | None
    cov_st: np.ndarray | None


def _aging_shift(des: Design, aging, bio: Bio, target: str, k: int) -> np.ndarray:
    from .bio import age_at
    from .priors import Chain
    shift = np.zeros(des.p)
    if aging is None or k <= 0:
        return shift
    pg = np.array([bio.g(p) for p in des.ids])
    age = age_at(bio.birth.reindex(des.ids), target).to_numpy()
    d_o, d_d = Chain._aging_deltas(aging, pg, age, np.full(des.n, k))
    shift[:des.n] = d_o
    shift[des.n:2 * des.n] = d_d
    return shift


def _solve_two_comp(blocks, ids, ncov, v_a, v_b, roles_a, names_a, roles_b, names_b, v_role, b0_fixed, sigma2,
                    want_var=True):
    """Joint ridge over seasons' blocks: [A comps, B comps, cov block per season, roles A, roles B].

    ``blocks``: list of (local ids, G dense local p x p, r local).  ``roles_a`` / ``roles_b``:
    player -> role name (None: no role columns for that component; its prior mean is the
    matching column of ``b0_fixed`` (nU x 2)).  Returns per-player means / variances / A-B
    covariance of the totals (role mean + own effect), role means and the data weights
    (diagonal of X'WX: weighted seconds) used for centering."""
    nU = len(ids)
    pos = {int(p): i for i, p in enumerate(ids)}
    nb = len(blocks)
    nRa = len(names_a) if roles_a is not None else 0
    nRb = len(names_b) if roles_b is not None else 0
    P = 2 * nU + ncov * nb + nRa + nRb
    A = np.zeros((P, P))
    r = np.zeros(P)
    for b, (lids, G, rl) in enumerate(blocks):
        pl = np.array([pos[int(p)] for p in lids], dtype=np.int64)
        m = np.concatenate([pl, nU + pl, 2 * nU + b * ncov + np.arange(ncov)])
        A[np.ix_(m, m)] += G
        r[m] += rl
    wdat = np.diag(A)[:2 * nU].copy()
    b0 = np.zeros(P)
    lam = np.full(P, COV_LAM)
    lam[:nU] = sigma2 / v_a
    lam[nU:2 * nU] = sigma2 / v_b
    lam[2 * nU:2 * nU + ncov * nb:ncov] = 1e-6
    o0 = 2 * nU + ncov * nb
    o1 = o0 + nRa
    # role columns = player columns aggregated by role (design X_A M_a and X_B M_b)
    Ms = []
    if roles_a is not None:
        ia = {n: k for k, n in enumerate(names_a)}
        Ma = np.zeros((nU, nRa))
        Ma[np.arange(nU), [ia[roles_a[int(p)]] for p in ids]] = 1.0
        Ms.append((slice(0, nU), slice(o0, o1), Ma))
    else:
        b0[:nU] = b0_fixed[:, 0]
    if roles_b is not None:
        ib = {n: k for k, n in enumerate(names_b)}
        Mb = np.zeros((nU, nRb))
        Mb[np.arange(nU), [ib[roles_b[int(p)]] for p in ids]] = 1.0
        Ms.append((slice(nU, 2 * nU), slice(o1, o1 + nRb), Mb))
    else:
        b0[nU:2 * nU] = b0_fixed[:, 1]
    if Ms:
        Cs = [(cols, rc, M, A[:, cols] @ M) for cols, rc, M in Ms]     # computed before any role block is set
        for cols, rc, M, C in Cs:
            A[:, rc] = C
            A[rc, :] = C.T
            r[rc] = M.T @ r[cols]
        for cols1, rc1, M1, C1 in Cs:
            for cols2, rc2, M2, C2 in Cs:
                A[rc1, rc2] = M1.T @ C2[cols1]
        lam[o0:] = sigma2 / v_role
    A[np.diag_indices_from(A)] += lam
    c = la.cho_factor(A, lower=False, check_finite=False)
    sol = la.cho_solve(c, r + lam * b0, check_finite=False)
    out = {"ids": ids, "w_a": wdat[:nU], "w_b": wdat[nU:]}
    ka = np.array([ia[roles_a[int(p)]] for p in ids]) if roles_a is not None else None
    kb = np.array([ib[roles_b[int(p)]] for p in ids]) if roles_b is not None else None
    out["a"] = sol[:nU] + (sol[o0:o1][ka] if ka is not None else 0.0)
    out["b"] = sol[nU:2 * nU] + (sol[o1:o1 + nRb][kb] if kb is not None else 0.0)
    out["role_a"] = sol[o0:o1] if ka is not None else None
    out["role_b"] = sol[o1:o1 + nRb] if kb is not None else None
    out["cov"] = [sol[2 * nU + b * ncov: 2 * nU + (b + 1) * ncov].copy() for b in range(nb)]
    if want_var:
        E = np.zeros((P, 2 * nU))
        E[np.arange(nU), np.arange(nU)] = 1.0
        E[nU + np.arange(nU), nU + np.arange(nU)] = 1.0
        if ka is not None:
            E[o0 + ka, np.arange(nU)] = 1.0
        if kb is not None:
            E[o1 + kb, nU + np.arange(nU)] = 1.0
        X = la.cho_solve(c, E, check_finite=False)
        out["var_a"] = sigma2 * np.einsum("ij,ij->j", E[:, :nU], X[:, :nU])
        out["var_b"] = sigma2 * np.einsum("ij,ij->j", E[:, nU:], X[:, nU:])
        out["cov_ab"] = sigma2 * np.einsum("ij,ij->j", E[:, :nU], X[:, nU:])
        nr = nRa + nRb
        if nr:
            Er = np.zeros((P, nr))
            Er[o0 + np.arange(nr), np.arange(nr)] = 1.0
            Xr = la.cho_solve(c, Er, check_finite=False)
            dv = sigma2 * np.einsum("ij,ij->j", Er, Xr)
            out["role_var_a"], out["role_var_b"] = dv[:nRa], dv[nRa:]
    return out


class Engine:
    """Season inputs + league clock + bio: stage-1 priors, stage-2 fits, FIN and TOI state."""

    def __init__(self, inputs: dict, clock: LeagueClock, players: pd.DataFrame, agings: dict | None = None,
                 rookies: dict | None = None):
        self.inp = {str(k): v for k, v in inputs.items()}
        self.clock = clock
        self.bio = Bio(players)
        self.agings = agings or {}      # season -> AgingCurve fitted on earlier seasons
        self.rookies = rookies or {}    # season -> RookieModel (role-off prior means)
        self._La = {s: clock.before(x.ev.dates) for s, x in self.inp.items()}
        self._Ls = {s: clock.before(x.st.dates) for s, x in self.inp.items()}

    # ---- weights
    def pre_weights(self, S: str, g: float, rec: Recency, kind: str = "ev") -> dict:
        """{season: per-date weight vector} for the seasons before S at in-season count g."""
        L0 = self.clock.season_start(S)
        out = {}
        for s, x in self.inp.items():
            if s >= str(S):
                continue
            L = self._La[s] if kind == "ev" else self._Ls[s]
            w = rec.weight(g + (L0 - L))
            if w.any():
                out[s] = w
        return out

    def pre_date_weights(self, S: str, g: float, rec: Recency) -> dict:
        """{date: weight} of every pre-season game date (for usage / FIN / TOI)."""
        L0 = self.clock.season_start(S)
        out = {}
        for s, x in self.inp.items():
            if s >= str(S):
                continue
            w = rec.weight(g + (L0 - self._La[s]))
            for d, v in zip(x.ev.dates, w):
                if v > 0:
                    out[d] = v
        return out

    # ---- stage 1
    def roles_for(self, ids, use: pd.DataFrame, sh: Shrink) -> dict:
        """Usage role of each player (position x EV minutes / game tier, or position x draft tier
        under ``MIN_ROLE_GP`` weighted games)."""
        out = {}
        for p in ids:
            u = use.loc[p] if p in use.index else None
            out[int(p)] = usage_role(self.bio.g(p), float(u["toi_gp"]) if u is not None else np.nan,
                                     float(u["eff_gp"]) if u is not None else 0.0, self.bio.t(p))
        return out

    def stage1(self, S: str, g: float, rec: Recency, sh: Shrink, want_var: bool = True, st: bool = True,
               ev: bool = True) -> Prior:
        S = str(S)
        yr = int(S[:4])
        wd = self.pre_date_weights(S, g, rec)
        pre = [x.toi for s, x in self.inp.items() if s < S]
        toi_pre = pd.concat(pre, ignore_index=True) if pre else pd.DataFrame(columns=["player_id", "d", "ev_s"])
        use = weighted_usage(toi_pre, wd)
        blocks = []
        aging = self.agings.get(S) if sh.use_aging else None
        for s, w in (sorted(self.pre_weights(S, g, rec, "ev").items()) if ev else []):
            des = self.inp[s].ev
            G, r, *_ = des.gram(w)
            if aging is not None:
                r = r + G @ _aging_shift(des, aging, self.bio, S, yr - int(s[:4]))
            blocks.append((des.ids, G.toarray(), r))
        ev, role_ev, cov_ev = {}, {}, None
        if blocks:
            ids = np.array(sorted({int(p) for b in blocks for p in b[0]}), dtype=np.int64)
            ur = self.roles_for(ids, use, sh)
            ra = rb = None
            b0 = np.zeros((len(ids), 2))
            if sh.role in ("both", "off"):
                ra = ur
                rb = ur if sh.role == "both" else {p: def_role(v) for p, v in ur.items()}
            rk = self.rookies.get(S)
            if rk is not None:
                for i, p in enumerate(ids):
                    b0[i] = (rk.mean(self.bio.g(p), self.bio.t(p), "o"), rk.mean(self.bio.g(p), self.bio.t(p), "d"))
            names_b = ROLES if sh.role == "both" else DEF_ROLES
            out = _solve_two_comp(blocks, ids, len(COVARIATES), sh.v_o, sh.v_d, ra, ROLES, rb, names_b, sh.v_role,
                                  b0, SIGMA2_EV, want_var)
            c_a, c_b = _center(out)
            cov_ev = recenter_cov("ev", out["cov"][-1], c_a, c_b)
            for i, p in enumerate(ids):
                ev[int(p)] = (float(out["a"][i] - c_a), float(out["b"][i] - c_b),
                              float(out["var_a"][i]) if want_var else sh.v_o,
                              float(out["var_b"][i]) if want_var else sh.v_d,
                              float(out["cov_ab"][i]) if want_var else 0.0, ur[int(p)])
            ib = {n: k for k, n in enumerate(names_b)}
            for k, nm in enumerate(ROLES):
                grp, tier = nm.split("|")[0], nm.split("|")[-1]
                if ra is not None:
                    mo, vo = float(out["role_a"][k]) - c_a, float(out["role_var_a"][k]) if want_var else 0.0
                else:
                    mo, vo = (rk.mean(grp, tier if "|low|" in nm else "all", "o") if rk is not None else 0.0) - c_a, 0.0
                if rb is not None:
                    j = ib[nm if sh.role == "both" else def_role(nm)]
                    md, vd = float(out["role_b"][j]) - c_b, float(out["role_var_b"][j]) if want_var else 0.0
                else:
                    md, vd = (rk.mean(grp, tier if "|low|" in nm else "all", "d") if rk is not None else 0.0) - c_b, 0.0
                role_ev[nm] = (mo, md, vo, vd)
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
                out = _solve_two_comp(sblocks, ids, len(ST_COVARIATES), sh.v_pp, sh.v_pk, roles, ["F", "D"], roles,
                                      ["F", "D"], sh.v_role_st, None, SIGMA2_ST, want_var)
                c_a, c_b = _center(out)
                cov_st = recenter_cov("st", out["cov"][-1], c_a, c_b)
                for i, p in enumerate(ids):
                    stp[int(p)] = (float(out["a"][i] - c_a), float(out["b"][i] - c_b),
                                   float(out["var_a"][i]) if want_var else sh.v_pp,
                                   float(out["var_b"][i]) if want_var else sh.v_pk)
                for k, nm in enumerate(["F", "D"]):
                    role_st[nm] = (float(out["role_a"][k]) - c_a, float(out["role_b"][k]) - c_b,
                                   float(out["role_var_a"][k]) if want_var else 0.0,
                                   float(out["role_var_b"][k]) if want_var else 0.0)
        return Prior(float(g), ev, stp, role_ev, role_st, cov_ev, cov_st)

    # ---- stage 2
    def in_weights(self, S: str, asof, rec: Recency, kind: str = "ev") -> np.ndarray:
        x = self.inp[str(S)]
        des = x.ev if kind == "ev" else x.st
        L = self._La[str(S)] if kind == "ev" else self._Ls[str(S)]
        cutoff = np.datetime64(asof, "D") - np.timedelta64(LAG_DAYS, "D")
        ga = float(self.clock.before([asof])[0]) - L
        return np.where(des.dates <= cutoff, rec.weight(ga), 0.0)

    def prior_ev(self, S: str, asof, rec: Recency, sh: Shrink, prior: Prior):
        """(b0, lam, roles) of the season's EV columns: the stage-1 prior, else the role mean."""
        S = str(S)
        x = self.inp[S]
        des = x.ev
        n = des.n
        cutoff = np.datetime64(asof, "D") - np.timedelta64(LAG_DAYS, "D")
        w_ev = self.in_weights(S, asof, rec, "ev")
        wd_in = {d: v for d, v in zip(des.dates, w_ev) if v > 0}
        use = weighted_usage(x.toi[x.toi["d"] <= cutoff], wd_in)
        b0 = np.zeros(des.p)
        lam = np.full(des.p, COV_LAM)
        roles = {}
        for i, p in enumerate(des.ids):
            e = prior.ev.get(int(p))
            if e is not None:
                b0[i], b0[n + i] = e[0], e[1]
                lam[i], lam[n + i] = SIGMA2_EV / max(e[2], 1e-6), SIGMA2_EV / max(e[3], 1e-6)
                roles[int(p)] = e[5]
                continue
            low = f"{self.bio.g(p)}|low|{self.bio.t(p)}"
            rl = low
            if sh.role != "none":
                u = use.loc[p] if p in use.index else None
                rl = usage_role(self.bio.g(p), float(u["toi_gp"]) if u is not None else np.nan,
                                float(u["eff_gp"]) if u is not None else 0.0, self.bio.t(p))
            mo, md, vo, vd = prior.role_ev.get(rl, prior.role_ev.get(low, (0.0, 0.0, 0.0, 0.0)))
            b0[i], b0[n + i] = mo, md
            lam[i], lam[n + i] = SIGMA2_EV / (sh.v_o + vo), SIGMA2_EV / (sh.v_d + vd)
            roles[int(p)] = rl
        if prior.cov_ev is not None:
            b0[2 * n:] = prior.cov_ev
        lam[2 * n] = 1e-6
        return b0, lam, roles

    def prior_st(self, S: str, sh: Shrink, prior: Prior):
        des = self.inp[str(S)].st
        ns = des.n
        b0 = np.zeros(des.p)
        lam = np.full(des.p, COV_LAM)
        for i, p in enumerate(des.ids):
            e = prior.st.get(int(p))
            if e is not None:
                b0[i], b0[ns + i] = e[0], e[1]
                lam[i], lam[ns + i] = SIGMA2_ST / max(e[2], 1e-6), SIGMA2_ST / max(e[3], 1e-6)
            else:
                mo, md, vo, vd = prior.role_st.get(self.bio.g(p), (0.0, 0.0, 0.0, 0.0))
                b0[i], b0[ns + i] = mo, md
                lam[i], lam[ns + i] = SIGMA2_ST / (sh.v_pp + vo), SIGMA2_ST / (sh.v_pk + vd)
        if prior.cov_st is not None:
            b0[2 * ns:] = prior.cov_st
        lam[2 * ns] = 1e-6
        return b0, lam

    @staticmethod
    def solve(des: Design, w, b0, lam, sigma2: float, want_sd: bool = False):
        """Posterior mean (and per-player variances / A-B covariance) of one season's fit."""
        n = des.n
        G, r, *_ = des.gram(w)
        A = G.toarray()
        A[np.diag_indices_from(A)] += lam
        c = la.cho_factor(A, lower=False, check_finite=False)
        beta = la.cho_solve(c, r + lam * b0, check_finite=False)
        var = None
        if want_sd:
            E = np.zeros((des.p, 2 * n))
            E[np.arange(2 * n), np.arange(2 * n)] = 1.0
            X = la.cho_solve(c, E, check_finite=False)
            var = (sigma2 * X[np.arange(n), np.arange(n)], sigma2 * X[n + np.arange(n), n + np.arange(n)],
                   sigma2 * X[np.arange(n), n + np.arange(n)])
        return beta, var

    def stage2(self, S: str, asof, rec: Recency, sh: Shrink, prior: Prior, want_sd: bool = False,
               st: bool = True, ev: bool = True) -> dict:
        """In-season fit as of ``asof``: {'ev': DataFrame(player_id, o, d, role[, o_var, d_var, od_cov]),
        'beta_ev', 'st': DataFrame(player_id, pp, pk[, pp_var, pk_var]), 'beta_st'}."""
        S = str(S)
        x = self.inp[S]
        out = {}
        if ev:
            des = x.ev
            n = des.n
            b0, lam, roles = self.prior_ev(S, asof, rec, sh, prior)
            beta, var = self.solve(des, self.in_weights(S, asof, rec, "ev"), b0, lam, SIGMA2_EV, want_sd)
            df = pd.DataFrame({"player_id": des.ids, "o": beta[:n], "d": beta[n:2 * n]})
            if var is not None:
                df["o_var"], df["d_var"], df["od_cov"] = var
            df["role"] = df["player_id"].map(roles)
            out["ev"], out["beta_ev"] = df, beta
        if st:
            sdes = x.st
            ns = sdes.n
            b0, lam = self.prior_st(S, sh, prior)
            bs, var = self.solve(sdes, self.in_weights(S, asof, rec, "st"), b0, lam, SIGMA2_ST, want_sd)
            sdf = pd.DataFrame({"player_id": sdes.ids, "pp": bs[:ns], "pk": bs[ns:2 * ns]})
            if var is not None:
                sdf["pp_var"], sdf["pk_var"] = var[0], var[1]
            out["st"], out["beta_st"] = sdf, bs
        return out


# ----------------------------------------------------------------------- prior grid (pack) and interpolation

def interpolate(grid: list, g: float, sh: Shrink) -> Prior:
    """The stage-1 prior at ``g`` from priors on the ``G_GRID`` (means and precisions linear in g;
    a player missing at one end takes his role / position mean there with the base variance)."""
    gs = np.array([p.g for p in grid])
    g = float(np.clip(g, gs.min(), gs.max()))
    k = int(np.searchsorted(gs, g, side="right")) - 1
    k = min(max(k, 0), len(grid) - 1)
    if k == len(grid) - 1 or abs(g - gs[k]) < 1e-9:
        return grid[k]
    p0, p1 = grid[k], grid[k + 1]
    a = (g - gs[k]) / (gs[k + 1] - gs[k])

    def fb_ev(pr, role):
        grp, tier = role.split("|")[0], role.split("|")[-1]
        low = f"{grp}|low|{tier}" if "|low|" in role else None
        m = pr.role_ev.get(role) or (pr.role_ev.get(low) if low else None) or (0.0, 0.0, 0.0, 0.0)
        return (m[0], m[1], sh.v_o + m[2], sh.v_d + m[3], 0.0, role)

    ev = {}
    for pid in set(p0.ev) | set(p1.ev):
        e0, e1 = p0.ev.get(pid), p1.ev.get(pid)
        role = (e1 or e0)[5]
        e0 = e0 or fb_ev(p0, role)
        e1 = e1 or fb_ev(p1, role)
        ev[pid] = _mix(e0, e1, a) + (role,)
    st = {}
    for pid in set(p0.st) | set(p1.st):
        e0, e1 = p0.st.get(pid), p1.st.get(pid)
        st[pid] = _mix(e0 or (0.0, 0.0, sh.v_pp, sh.v_pk), e1 or (0.0, 0.0, sh.v_pp, sh.v_pk), a)[:4]
    role_ev = {k: tuple((1 - a) * np.array(p0.role_ev.get(k, v)) + a * np.array(v)) for k, v in p1.role_ev.items()}
    role_st = {k: tuple((1 - a) * np.array(p0.role_st.get(k, v)) + a * np.array(v)) for k, v in p1.role_st.items()}
    cov_ev = p1.cov_ev if p0.cov_ev is None else (p0.cov_ev if p1.cov_ev is None else (1 - a) * p0.cov_ev + a * p1.cov_ev)
    cov_st = p1.cov_st if p0.cov_st is None else (p0.cov_st if p1.cov_st is None else (1 - a) * p0.cov_st + a * p1.cov_st)
    return Prior(g, ev, st, role_ev, role_st, cov_ev, cov_st)


def _mix(e0, e1, a):
    """Linear in the mean, linear in the precision (variance = 1 / mixed precision)."""
    m0, m1 = np.array(e0[:2], float), np.array(e1[:2], float)
    p0 = 1.0 / np.maximum(np.array(e0[2:4], float), 1e-9)
    p1 = 1.0 / np.maximum(np.array(e1[2:4], float), 1e-9)
    m = (1 - a) * m0 + a * m1
    v = 1.0 / ((1 - a) * p0 + a * p1)
    extra = ((1 - a) * float(e0[4]) + a * float(e1[4]),) if len(e0) > 4 and not isinstance(e0[4], str) else ()
    return (float(m[0]), float(m[1]), float(v[0]), float(v[1])) + extra


def prior_grid(engine: Engine, S: str, rec: Recency, sh: Shrink, grid=G_GRID, log=None) -> list:
    out = []
    for g in grid:
        out.append(engine.stage1(S, float(g), rec, sh))
        if log:
            log(f"  [v3] {S} prior g={g:g}: {len(out[-1].ev)} EV, {len(out[-1].st)} PP/PK players")
    return out
