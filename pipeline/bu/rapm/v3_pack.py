"""Ratings v3 season pack, live ratings and point-in-time backfill.

``ratings_pack_<S>.json.gz`` (committed, built once per season from the full lake, next to the
lineup season pack) holds everything the in-season v3 fit needs that is not in the current
season's lake partition:

* ``grid``: the stage-1 pre-season prior (``v3.Engine.stage1``) at every ``v3.G_GRID`` point
  (EV OFF / DEF with variances, OFF-DEF covariance and role, PP / PK with variances, role and
  position means, the last season's covariates) and the pre-season finishing sums at the same
  weights (``v3.fin_pre``);
* ``toi``: each player's EWMA TOI state by game state at the season start and the position means;
* ``bio``: position group / draft tier of every carried player; ``goals_per_xg``: last season's
  league EV goals per xG (the impact's xG -> goals factor);
* ``config``: recency, shrinkage, FIN prior, TOI half-lives (the validated configuration).

``live_table`` (daily refresh, ``bu.lineup serve``) rolls it through the season's games in the
refresh's caches: the in-season fit is exact, the pre-season part interpolated in ``g`` (games
per team played) exactly as the backtest computed it (``v3_validate``), so a game played tonight
moves tomorrow's weights.  ``asof_backfill`` writes the same ratings for every game date of a
season in the ``bu.rapm asof`` layout (the lineup feature table of the game model).
"""
from __future__ import annotations

import gzip
import json
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import v3 as V
from .recency import LeagueClock, Recency, league_index

PACK_VERSION = 1
EV_COLS = ["player_id", "o", "d", "o_var", "d_var", "od_cov", "role"]
ST_COLS = ["player_id", "pp", "pk", "pp_var", "pk_var"]
FIN_COLS = ["player_id", "g", "x", "s"]
TOI_COLS = ["player_id"] + [f"{a}_{s}" for s in V.TOI_STATES for a in ("w", "x")]
LIVE_COLUMNS = ["player_id", "group", "rated", "o", "d", "o_var", "d_var", "od_cov", "pp", "pk", "pp_var", "pk_var",
                "fin", "toi_ev", "toi_pp", "toi_pk", "role"]


def pack_path(season: str) -> str:
    from bu.lineup.evaluate import OUT_DIR
    return os.path.join(OUT_DIR, f"ratings_pack_{season}.json.gz")


def _r(x, k=7):
    x = float(x)
    return round(x, k) + 0.0 if np.isfinite(x) else None


def _prior_json(p: V.Prior, fin: pd.DataFrame) -> dict:
    return {"g": p.g,
            "ev": [[int(k), _r(v[0]), _r(v[1]), _r(v[2], 9), _r(v[3], 9), _r(v[4], 9), v[5]] for k, v in sorted(p.ev.items())],
            "st": [[int(k), _r(v[0]), _r(v[1]), _r(v[2], 9), _r(v[3], 9)] for k, v in sorted(p.st.items())],
            "role_ev": {k: [_r(x, 9) for x in v] for k, v in p.role_ev.items()},
            "role_st": {k: [_r(x, 9) for x in v] for k, v in p.role_st.items()},
            "cov_ev": None if p.cov_ev is None else [_r(x, 9) for x in p.cov_ev],
            "cov_st": None if p.cov_st is None else [_r(x, 9) for x in p.cov_st],
            "fin": [[int(i), _r(a, 6), _r(b, 6), _r(c, 2)] for i, (a, b, c) in
                    zip(fin.index, fin[["g", "x", "s"]].to_numpy())]}


def _prior_from_json(j: dict) -> tuple[V.Prior, pd.DataFrame]:
    ev = {int(r[0]): (float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]), str(r[6])) for r in j["ev"]}
    st = {int(r[0]): (float(r[1]), float(r[2]), float(r[3]), float(r[4])) for r in j["st"]}
    pr = V.Prior(float(j["g"]), ev, st, {k: tuple(float(x) for x in v) for k, v in j["role_ev"].items()},
                 {k: tuple(float(x) for x in v) for k, v in j["role_st"].items()},
                 None if j["cov_ev"] is None else np.array(j["cov_ev"], float),
                 None if j["cov_st"] is None else np.array(j["cov_st"], float))
    fin = pd.DataFrame(j["fin"], columns=FIN_COLS).set_index("player_id").astype(float)
    return pr, fin


def build_pack(engine: V.Engine, S: str, rec: Recency, sh: V.Shrink, prior_xg: float = V.FIN_PRIOR_XG,
               toi_half_life: dict | None = None, log=print) -> dict:
    """Season-start pack of season S from an engine holding every earlier season it needs."""
    S = str(S)
    toi_half_life = toi_half_life or dict(V.TOI_HALF_LIFE)
    grid = []
    for g in V.G_GRID:
        grid.append(_prior_json(engine.stage1(S, float(g), rec, sh), V.fin_pre(engine, S, float(g), rec)))
        log(f"  [v3-pack] {S} g={g:g}: {len(grid[-1]['ev'])} EV, {len(grid[-1]['st'])} PP/PK, "
            f"{len(grid[-1]['fin'])} FIN rows")
    prev = [s for s in sorted(engine.inp) if s < S]
    toi_prev = pd.concat([engine.inp[s].toi for s in prev], ignore_index=True) if prev else None
    start = engine.clock.date_at(S, 0.0)
    if toi_prev is not None and len(toi_prev):
        tst = V.toi_state(toi_prev, np.datetime64(start, "D") - np.timedelta64(1, "D"), toi_half_life)
        pm = V.toi_pos_means(engine.inp[prev[-1]].toi, engine.bio.group)
        gpx = V.season_ratio(engine.inp[prev[-1]].fin_pg)
    else:
        tst, pm, gpx = pd.DataFrame(columns=TOI_COLS[1:]), V.toi_pos_means(pd.DataFrame(), {}), 1.0
    ids = sorted({int(r[0]) for gj in grid for r in gj["ev"]} | {int(r[0]) for gj in grid for r in gj["st"]}
                 | {int(p) for p in tst.index})
    return {"version": PACK_VERSION, "kind": "ratings_pack_v3", "season": S,
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "config": {"recency": rec.as_dict(), "shrink": sh.as_dict(), "prior_xg": float(prior_xg),
                       "toi_half_life": toi_half_life, "toi_pseudo": V.TOI_PSEUDO, "sigma2_ev": V.SIGMA2_EV,
                       "sigma2_st": V.SIGMA2_ST, "usage_tiers": V.USAGE_TIERS, "min_role_gp": V.MIN_ROLE_GP,
                       "g_step": V.G_STEP, "lag_days": V.LAG_DAYS, "impact_weights": dict(V.IMPACT_WEIGHTS)},
            "goals_per_xg": float(gpx), "grid": grid,
            "toi": {"columns": TOI_COLS, "rows": [[int(p)] + [_r(v, 4) for v in row] for p, row in
                                                  zip(tst.index, tst[TOI_COLS[1:]].to_numpy())], "pos_means": pm},
            "bio": {"columns": ["player_id", "group", "tier"],
                    "rows": [[p, engine.bio.g(p), engine.bio.t(p)] for p in ids]}}


def write_pack(path: str, pack: dict) -> str:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with gzip.open(path + ".tmp", "wt") as f:
        json.dump(pack, f, separators=(",", ":"))
    os.replace(path + ".tmp", path)
    return path


def read_pack(path: str) -> dict | None:
    if not os.path.exists(path):
        return None
    with gzip.open(path, "rt") as f:
        p = json.load(f)
    if int(p.get("version", 0)) != PACK_VERSION or p.get("kind") != "ratings_pack_v3":
        raise ValueError(f"{path}: not a v3 ratings pack of version {PACK_VERSION}")
    return p


class Pack:
    def __init__(self, j: dict):
        self.j = j
        self.season = str(j["season"])
        c = j["config"]
        self.rec = Recency.from_dict(c["recency"])
        self.sh = V.Shrink(**c["shrink"])
        self.prior_xg = float(c["prior_xg"])
        self.toi_h = {k: float(v) for k, v in c["toi_half_life"].items()}
        self.goals_per_xg = float(j.get("goals_per_xg") or 1.0)
        self.grid = [_prior_from_json(gj) for gj in j["grid"]]
        t = j["toi"]
        self.toi = pd.DataFrame(t["rows"], columns=t["columns"]).set_index("player_id").astype(float)
        self.pos_means = t["pos_means"]
        self.bio = pd.DataFrame(j["bio"]["rows"], columns=j["bio"]["columns"])

    def prior(self, g: float) -> tuple[V.Prior, pd.DataFrame]:
        gs = np.array([p.g for p, _ in self.grid])
        g = float(np.clip(g, gs.min(), gs.max()))
        k = min(int(np.searchsorted(gs, g, side="right")) - 1, len(gs) - 1)
        if k == len(gs) - 1 or g - gs[k] < 1e-9:
            return self.grid[k]
        a = (g - gs[k]) / (gs[k + 1] - gs[k])
        pr = V.interpolate([self.grid[k][0], self.grid[k + 1][0]], g, self.sh)
        return pr, V.interp_sums(self.grid[k][1], self.grid[k + 1][1], a)

    def players(self, current: pd.DataFrame | None = None) -> pd.DataFrame:
        """A bio table for ``v3.Bio``: the current season's (when given) completed with the pack's."""
        tier_draft = {"r1": 1.0, "later": 100.0, "undrafted": np.nan}
        b = pd.DataFrame({"player_id": self.bio["player_id"].astype(int),
                          "pos_group": self.bio["group"], "draft_overall": self.bio["tier"].map(tier_draft),
                          "birth_date": None})
        if current is None or not len(current):
            return b
        cur = current[["player_id", "pos_group", "draft_overall", "birth_date"]]
        return pd.concat([cur, b[~b["player_id"].isin(cur["player_id"])]], ignore_index=True)


def season_clock(games: pd.DataFrame) -> LeagueClock:
    return LeagueClock(league_index(games))


def ratings_table(engine: V.Engine, S: str, asof, pr: V.Prior, fin_pre: pd.DataFrame, toi_state0: pd.DataFrame,
                  pos_means: dict, rec: Recency, sh: V.Shrink, prior_xg: float, toi_h: dict) -> pd.DataFrame:
    """Every player's v3 ratings as of ``asof`` (``LIVE_COLUMNS``): the season fit for players in
    the season's rows, the stage-1 prior for the others."""
    S = str(S)
    x = engine.inp.get(S)
    cutoff = np.datetime64(asof, "D") - np.timedelta64(V.LAG_DAYS, "D")
    rows = {}
    for p, e in pr.ev.items():
        rows[p] = {"o": e[0], "d": e[1], "o_var": e[2], "d_var": e[3], "od_cov": e[4], "role": e[5], "rated": True}
    for p, e in pr.st.items():
        rows.setdefault(p, {"rated": False}).update({"pp": e[0], "pk": e[1], "pp_var": e[2], "pk_var": e[3]})
    if x is not None and len(x.ev.dates):
        res = engine.stage2(S, asof, rec, sh, pr, want_sd=True)
        cur_s = x.toi[x.toi["d"] <= cutoff].groupby("player_id")["ev_s"].sum()
        for r in res["ev"].itertuples(index=False):
            p = int(r.player_id)
            had = p in pr.ev
            if not had and float(cur_s.get(p, 0.0)) <= 0:
                # in the season's rows only after the cutoff: his role prior, not rated yet
                pass
            rows.setdefault(p, {"rated": False}).update(
                {"o": r.o, "d": r.d, "o_var": r.o_var, "d_var": r.d_var, "od_cov": r.od_cov, "role": r.role,
                 "rated": bool(had or float(cur_s.get(p, 0.0)) > 0)})
        for r in res["st"].itertuples(index=False):
            rows.setdefault(int(r.player_id), {"rated": False}).update(
                {"pp": r.pp, "pk": r.pk, "pp_var": r.pp_var, "pk_var": r.pk_var})
        sums = V.add_sums(fin_pre, V.fin_in(engine, S, asof, rec))
        tst = V.roll_toi_state(toi_state0, x.toi[x.toi["d"] <= cutoff], toi_h)
    else:
        sums, tst = fin_pre, toi_state0
    df = pd.DataFrame.from_dict(rows, orient="index")
    df.index.name = "player_id"
    df = df.reset_index()
    df["group"] = [engine.bio.g(p) for p in df["player_id"]]
    for c, fb in (("pp", None), ("pk", None)):
        if c not in df.columns:
            df[c] = np.nan
    # players without a PP / PK row: their position mean (no PP / PK sample)
    for c, k, vk in (("pp", 0, 2), ("pk", 1, 3)):
        miss = df[c].isna()
        df.loc[miss, c] = [pr.role_st.get(g_, (0.0, 0.0, 0.0, 0.0))[k] for g_ in df.loc[miss, "group"]]
        vc = f"{c}_var"
        if vc not in df.columns:
            df[vc] = np.nan
        df.loc[df[vc].isna(), vc] = sh.v_pp if c == "pp" else sh.v_pk
    for c, k, vk, v0 in (("o", 0, 2, sh.v_o), ("d", 1, 3, sh.v_d)):
        miss = df[c].isna() if c in df.columns else pd.Series(True, index=df.index)
        if c not in df.columns:
            df[c] = np.nan
        low = [f"{g_}|low|{engine.bio.t(p)}" for p, g_ in zip(df["player_id"], df["group"])]
        df.loc[miss, c] = [pr.role_ev.get(l_, (0.0, 0.0, 0.0, 0.0))[k] for l_, m_ in zip(low, miss) if m_]
        vc = f"{c}_var"
        if vc not in df.columns:
            df[vc] = np.nan
        df.loc[df[vc].isna(), vc] = v0
    df["od_cov"] = df["od_cov"].fillna(0.0) if "od_cov" in df.columns else 0.0
    df["role"] = df["role"].fillna("") if "role" in df.columns else ""
    df["rated"] = df["rated"].fillna(False).astype(bool)
    fv = V.fin_values(sums, engine.bio.group, prior_xg)
    df["fin"] = [float(fv.at[p, "fin_d" if g_ == "D" else "fin_f"]) if p in fv.index else 0.0
                 for p, g_ in zip(df["player_id"], df["group"])]
    et = V.expected_toi(tst.reindex(df["player_id"]).fillna(0.0), engine.bio.group, pos_means)
    for s in V.TOI_STATES:
        df[f"toi_{s}"] = et[f"toi_{s}"].to_numpy()
    return df[LIVE_COLUMNS].sort_values("player_id").reset_index(drop=True)


def live_table(pack: Pack, inputs_cur: "V.SeasonInputs | None", games_cur: pd.DataFrame,
               players_cur: pd.DataFrame | None = None, asof=None) -> tuple[pd.DataFrame, dict]:
    """The live v3 ratings from the season pack and the season's games so far (``games_cur``: the
    lake games of the season; only games with a final boxscore advance the clock)."""
    S = pack.season
    played = games_cur
    if "has_boxscore" in played.columns:
        played = played[played["has_boxscore"].astype("boolean").fillna(False)]
    inp = {S: inputs_cur} if inputs_cur is not None else {}
    clk = season_clock(played) if len(played) else None
    last = None
    if inputs_cur is not None and len(inputs_cur.ev.dates):
        last = inputs_cur.ev.dates.max()
    if asof is None:
        asof = (last + np.timedelta64(V.LAG_DAYS, "D")) if last is not None else None
    g = clk.in_season(S, asof) if (clk is not None and asof is not None) else 0.0
    eng = V.Engine(inp, clk or LeagueClock(pd.DataFrame({"d": [], "season": [], "inc": [], "L_before": []})),
                   pack.players(players_cur))
    pr, fin_pre = pack.prior(g)
    df = ratings_table(eng, S, asof if asof is not None else np.datetime64("1970-01-01"), pr, fin_pre, pack.toi,
                       pack.pos_means, pack.rec, pack.sh, pack.prior_xg, pack.toi_h)
    meta = {"season": S, "asof": None if asof is None else str(np.datetime64(asof, "D")),
            "max_source_date": None if last is None else str(last), "g": round(float(g), 3),
            "goals_per_xg": pack.goals_per_xg, "recency": pack.rec.as_dict(), "shrink": pack.sh.as_dict(),
            "prior_xg": pack.prior_xg}
    return df, meta


# ----------------------------------------------------------------------- point-in-time backfill (feature table)

def asof_backfill(engine: V.Engine, S: str, rec: Recency, sh: V.Shrink, out_root: str, prior_xg: float,
                  log=print) -> None:
    """Ratings for every game date of season S in the ``bu.rapm asof`` layout under ``out_root``
    (``ratings/season=S``, ``cov_season=S``, ``prior_season=S``) plus ``fin_season=S`` (FIN as of
    each date), so ``bu.lineup.features`` builds the lineup term from v3."""
    S = str(S)
    x = engine.inp[S]
    des = x.ev
    n = des.n
    from bu.lake.build import read_table  # noqa: F401  (layout parity with asof.run)
    grid = {g: engine.stage1(S, float(g), rec, sh) for g in V.G_GRID}
    fgrid = {g: V.fin_pre(engine, S, float(g), rec) for g in V.G_GRID}
    gs = np.array(V.G_GRID)
    dates = np.unique(np.concatenate([des.dates, x.st.dates]))
    first = engine.clock.date_at(S, 0.0)
    dates = np.unique(np.concatenate([[np.datetime64(first, "D")], dates]))
    toi = x.toi
    out, covs, fins = [], [], []
    for d in dates:
        g = engine.clock.in_season(S, d)
        k = min(int(np.searchsorted(gs, g, side="right")) - 1, len(gs) - 1)
        if k == len(gs) - 1 or g - gs[k] < 1e-9:
            pr, fp = grid[gs[k]], fgrid[gs[k]]
        else:
            a = (g - gs[k]) / V.G_STEP
            pr = V.interpolate([grid[gs[k]], grid[gs[k + 1]]], g, sh)
            fp = V.interp_sums(fgrid[gs[k]], fgrid[gs[k + 1]], a)
        res = engine.stage2(S, d, rec, sh, pr, st=False)
        beta = res["beta_ev"]
        cutoff = np.datetime64(d, "D") - np.timedelta64(V.LAG_DAYS, "D")
        cum = toi[toi["d"] <= cutoff].groupby("player_id")["ev_s"].sum()
        src = toi.loc[toi["d"] <= cutoff, "d"].max() if (toi["d"] <= cutoff).any() else np.datetime64("NaT")
        out.append(pd.DataFrame({"asof": d, "player_id": des.ids, "o": beta[:n], "d": beta[n:2 * n],
                                 "o_sd": np.nan, "d_sd": np.nan,
                                 "is_new": [int(p) not in pr.ev for p in des.ids],
                                 "ev_toi_s": cum.reindex(des.ids).fillna(0.0).to_numpy(),
                                 "max_source_date": src}))
        from .design import COVARIATES
        covs.append({"asof": d, **{c: float(v) for c, v in zip(COVARIATES, beta[2 * n:])}})
        fv = V.fin_values(V.add_sums(fp, V.fin_in(engine, S, d, rec)), engine.bio.group, prior_xg)
        fins.append(pd.DataFrame({"asof": d, "player_id": fv.index.to_numpy(), "fin_f": fv["fin_f"].to_numpy(),
                                  "fin_d": fv["fin_d"].to_numpy()}))
    rd = os.path.join(out_root, "ratings")
    os.makedirs(rd, exist_ok=True)
    R = pd.concat(out, ignore_index=True)
    R["season"] = S
    R.to_parquet(os.path.join(rd, f"season={S}.parquet"), index=False)
    pd.DataFrame(covs).to_parquet(os.path.join(rd, f"cov_season={S}.parquet"), index=False)
    pd.concat(fins, ignore_index=True).to_parquet(os.path.join(rd, f"fin_season={S}.parquet"), index=False)
    p0 = grid[gs[0]]
    pd.DataFrame({"player_id": list(p0.ev), "o": [v[0] for v in p0.ev.values()], "d": [v[1] for v in p0.ev.values()],
                  "o_sd": [np.sqrt(v[2]) for v in p0.ev.values()], "d_sd": [np.sqrt(v[3]) for v in p0.ev.values()],
                  "is_new": False}).to_parquet(os.path.join(rd, f"prior_season={S}.parquet"), index=False)
    log(f"  [v3-asof] {S}: {len(dates)} dates x {n} skaters")


# ----------------------------------------------------------------------- serving bundle table

def bundle_table(paths, season: str, pack_file: str | None = None, source: str | None = None,
                 players_cur: pd.DataFrame | None = None, log=print) -> dict | None:
    """The serving bundle's ``v3`` table: the season's ratings pack rolled through the season's games
    in the refresh's caches (``bu.rapm asof`` built the stints / xG caches); None without a pack."""
    from bu.lake.build import read_table
    from .data import cached_source, lake_seasons
    pf = pack_file or pack_path(season)
    j = read_pack(pf)
    if j is None:
        log(f"  [v3] no {os.path.basename(pf)}: no v3 ratings in the bundle")
        return None
    pk = Pack(j)
    S = str(season)
    inputs, games = None, pd.DataFrame()
    if S in lake_seasons(paths.lake):
        games = read_table(paths.lake, "games", [S])
        src = source or cached_source(paths, S)
        if src is not None and os.path.exists(paths.stints(S)):
            inputs = V.SeasonInputs.build(paths, S, src, log=log)
    if players_cur is None:
        try:
            from .bio import build_players
            players_cur = build_players(paths, [S], write=False)
        except Exception as e:  # noqa: BLE001  (no bio payload: the pack's bio and F / undrafted)
            log(f"  [v3] no bio for {S}: {type(e).__name__}: {e}")
            players_cur = None
    df, meta = live_table(pk, inputs, games, players_cur)
    pr0, _ = pk.prior(float(meta["g"]))
    low = {}
    for g_ in ("F", "D"):
        ev = pr0.role_ev.get(f"{g_}|low|later", (0.0, 0.0, 0.0, 0.0))
        st = pr0.role_st.get(g_, (0.0, 0.0, 0.0, 0.0))
        low[g_] = [round(float(ev[0]), 5), round(float(ev[1]), 5), round(float(st[0]), 5), round(float(st[1]), 5)]
    meta.update({"pack": os.path.basename(pf), "impact_weights": j["config"].get("impact_weights"),
                 "low_role": low, "toi_pos_means": pk.pos_means,
                 "prior_var": {"o": pk.sh.v_o, "d": pk.sh.v_d, "pp": pk.sh.v_pp, "pk": pk.sh.v_pk}})
    rows = []
    for r in df.itertuples(index=False):
        rows.append([int(r.player_id), r.group, bool(r.rated)] + [round(float(getattr(r, c)), 6) + 0.0 for c in
                     LIVE_COLUMNS[3:-1]] + [r.role or ""])
    return {"columns": LIVE_COLUMNS, "rows": rows, "meta": meta}
