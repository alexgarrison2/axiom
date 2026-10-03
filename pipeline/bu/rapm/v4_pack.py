"""Ratings v4 season pack, live ratings, serving-bundle table and point-in-time backfill.

The v4 pack (``bu/lineup/out/ratings_pack_v4_<S>.json.gz``, committed, built once per season from
the full lake) is the v3 pack (``v3_pack``: the stage-1 prior on the 5-game grid, pre-season FIN
sums, TOI state, bio, config) plus, at every grid point, the SPM part of the stage-1 prior
(``v4.Prior4``): the standardisation (``stats``), the coefficients (``coef``: o / d / pp / pk x F / D
per feature) and the players' pre-season weighted box-score sums (``box``), plus the penalty
value (league net PP goals per penalty unit of the last completed season).

``live_table`` rolls it through the season's games: this season's box score comes from the lake
events in the refresh (``box.load_season``), the in-season fit is v4's stage 2.  The serving
bundle's ``v4`` table (``bundle_table``) is ``LIVE_COLUMNS``: v3's columns plus

* ``spm_o`` / ``spm_d`` / ``spm_pp`` / ``spm_pk``: the box-score prior mean of each component
  (role / position mean + beta' z at the current box score; same units and signs as ``o`` / ``d`` /
  ``pp`` / ``pk``: xG/60, ``d`` and ``pk`` against, lower is better);
* ``pd60`` / ``pt60``: penalties drawn / taken (power-play units) per 60 all-situation minutes,
  recency-weighted and shrunk (``v4.penalty_rates``),

and ``meta.pen_value`` (goals per penalty unit).  ``player_ratings.json`` (``bu.lineup.ratings_export``)
and the game simulator read this table.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import v3 as V
from . import v3_pack as P3
from . import v4 as V4
from .recency import LeagueClock, Recency

PACK_VERSION = 1
PACK_KIND = "ratings_pack_v4"
LIVE_COLUMNS = P3.LIVE_COLUMNS[:-1] + ["spm_o", "spm_d", "spm_pp", "spm_pk", "pd60", "pt60", "role"]


def pack_path(season: str) -> str:
    from bu.lineup.evaluate import OUT_DIR
    return os.path.join(OUT_DIR, f"ratings_pack_v4_{season}.json.gz")


def _spm_json(p: V4.Prior4) -> dict:
    r = P3._r
    box = p.box if p.box is not None else V4.add_box()
    return {"stats": p.stats.to_json() if p.stats is not None else None,
            "coef": {c: {g: [r(x, 8) for x in v] for g, v in d.items()} for c, d in (p.coef or {}).items()},
            "box_columns": V4.SUM_COLS,
            "box": [[int(i)] + [r(x, 1 if c in V4.SEC_COLS else 4) for c, x in zip(V4.SUM_COLS, row)]
                    for i, row in zip(box.index, box[V4.SUM_COLS].to_numpy())]}


def _spm_from_json(j: dict | None):
    if not j or j.get("stats") is None:
        return None, None, None
    stats = V4.SpmStats.from_json(j["stats"])
    coef = {c: {g: np.array(v, float) for g, v in d.items()} for c, d in j["coef"].items()}
    cols = j.get("box_columns") or V4.SUM_COLS
    box = pd.DataFrame([r[1:] for r in j["box"]], index=[int(r[0]) for r in j["box"]], columns=cols).astype(float)
    return stats, coef, box[V4.SUM_COLS] if len(box) else V4.add_box()


def build_pack(engine: V4.Engine4, S: str, rec: Recency, sh: V4.Shrink4, prior_xg: float = V.FIN_PRIOR_XG,
               pen_value: float | None = None, log=print) -> dict:
    """Season-start v4 pack of season S (the v3 pack + the SPM part of every grid point)."""
    S = str(S)
    grid = []
    for g in V.G_GRID:
        pr = engine.stage1(S, float(g), rec, sh)
        gj = P3._prior_json(pr, V.fin_pre(engine, S, float(g), rec))
        gj["spm"] = _spm_json(pr)
        grid.append(gj)
        log(f"  [v4-pack] {S} g={g:g}: {len(gj['ev'])} EV, {len(gj['st'])} PP/PK, {len(gj['spm']['box'])} box rows")
    prev = [s for s in sorted(engine.inp) if s < S]
    toi_prev = pd.concat([engine.inp[s].toi for s in prev], ignore_index=True) if prev else None
    start = engine.clock.date_at(S, 0.0)
    if toi_prev is not None and len(toi_prev):
        tst = V.toi_state(toi_prev, np.datetime64(start, "D") - np.timedelta64(1, "D"), dict(V.TOI_HALF_LIFE))
        pm = V.toi_pos_means(engine.inp[prev[-1]].toi, engine.bio.group)
        gpx = V.season_ratio(engine.inp[prev[-1]].fin_pg)
    else:
        tst, pm, gpx = pd.DataFrame(columns=P3.TOI_COLS[1:]), V.toi_pos_means(pd.DataFrame(), {}), 1.0
    ids = sorted({int(r[0]) for gj in grid for r in gj["ev"]} | {int(r[0]) for gj in grid for r in gj["st"]}
                 | {int(p) for p in tst.index})
    cfg = {"recency": rec.as_dict(), "shrink": sh.as_dict(), "prior_xg": float(prior_xg),
           "toi_half_life": dict(V.TOI_HALF_LIFE), "toi_pseudo": V.TOI_PSEUDO, "sigma2_ev": V.SIGMA2_EV,
           "sigma2_st": V.SIGMA2_ST, "usage_tiers": V.USAGE_TIERS, "min_role_gp": V.MIN_ROLE_GP,
           "g_step": V.G_STEP, "lag_days": V.LAG_DAYS, "impact_weights": dict(V4.IMPACT_WEIGHTS),
           "features": V4.FEATURES, "pen_t0": V4.PEN_T0}
    return {"version": PACK_VERSION, "kind": PACK_KIND, "season": S,
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "config": cfg, "goals_per_xg": float(gpx), "pen_value": float(pen_value or 0.0), "grid": grid,
            "toi": {"columns": P3.TOI_COLS, "rows": [[int(p)] + [P3._r(v, 4) for v in row] for p, row in
                                                     zip(tst.index, tst[P3.TOI_COLS[1:]].to_numpy())], "pos_means": pm},
            "bio": {"columns": ["player_id", "group", "tier"],
                    "rows": [[p, engine.bio.g(p), engine.bio.t(p)] for p in ids]}}


def read_pack(path: str) -> dict | None:
    import gzip
    import json
    if not os.path.exists(path):
        return None
    with gzip.open(path, "rt") as f:
        p = json.load(f)
    if int(p.get("version", 0)) != PACK_VERSION or p.get("kind") != PACK_KIND:
        raise ValueError(f"{path}: not a v4 ratings pack of version {PACK_VERSION}")
    return p


write_pack = P3.write_pack


class Pack(P3.Pack):
    def __init__(self, j: dict):
        jj = dict(j)
        jj["config"] = dict(j["config"])
        sh = dict(jj["config"]["shrink"])
        super().__init__({**jj, "config": {**jj["config"], "shrink": {k: v for k, v in sh.items()
                                                                       if k in V.Shrink.__dataclass_fields__}}})
        self.sh = V4.Shrink4(**sh)
        self.pen_value = float(j.get("pen_value") or 0.0)
        self.pen_t0 = float(j["config"].get("pen_t0", V4.PEN_T0))
        g4 = []
        for (pr, fin), gj in zip(self.grid, j["grid"]):
            stats, coef, box = _spm_from_json(gj.get("spm"))
            g4.append((V4.Prior4(pr.g, pr.ev, pr.st, pr.role_ev, pr.role_st, pr.cov_ev, pr.cov_st, stats, coef, box),
                       fin))
        self.grid = g4

    def prior(self, g: float):
        gs = np.array([p.g for p, _ in self.grid])
        g = float(np.clip(g, gs.min(), gs.max()))
        k = min(int(np.searchsorted(gs, g, side="right")) - 1, len(gs) - 1)
        if k == len(gs) - 1 or g - gs[k] < 1e-9:
            return self.grid[k]
        a = (g - gs[k]) / (gs[k + 1] - gs[k])
        pr = V4.interpolate4([self.grid[k][0], self.grid[k + 1][0]], g, self.sh)
        return pr, V.interp_sums(self.grid[k][1], self.grid[k + 1][1], a)


def spm_columns(engine: V4.Engine4, df: pd.DataFrame, pr: V4.Prior4, box_now: pd.DataFrame,
                pen_t0: float) -> pd.DataFrame:
    """``spm_o`` / ``spm_d`` / ``spm_pp`` / ``spm_pk`` (role or position mean + beta' z at the current
    box score) and ``pd60`` / ``pt60`` for the rows of a ratings table."""
    df = df.copy()
    ids = df["player_id"].astype(int).to_numpy()
    grp = np.array([engine.bio.g(p) for p in ids])
    if pr.stats is not None and pr.coef is not None:
        sums = box_now.reindex(pd.Index(ids)).fillna(0.0)
        z = pr.stats.z(sums, engine.bio.group)
    else:
        z = np.zeros((len(ids), len(V4.FEATURES)))
    zero = np.zeros(len(V4.FEATURES))

    def lin(c):
        cf = (pr.coef or {}).get(c) or {}
        B = np.stack([cf.get(g, zero) for g in grp]) if len(grp) else np.zeros((0, len(V4.FEATURES)))
        return np.einsum("ij,ij->i", z, B)

    low = [f"{g}|low|{engine.bio.t(p)}" for p, g in zip(ids, grp)]
    role = [r if isinstance(r, str) and r in pr.role_ev else l_ for r, l_ in zip(df["role"], low)]
    mo = np.array([pr.role_ev.get(r, (0.0, 0.0, 0, 0))[0] for r in role])
    md = np.array([pr.role_ev.get(r, (0.0, 0.0, 0, 0))[1] for r in role])
    mpp = np.array([pr.role_st.get(g, (0.0, 0.0, 0, 0))[0] for g in grp])
    mpk = np.array([pr.role_st.get(g, (0.0, 0.0, 0, 0))[1] for g in grp])
    df["spm_o"], df["spm_d"] = mo + lin("o"), md + lin("d")
    df["spm_pp"], df["spm_pk"] = mpp + lin("pp"), mpk + lin("pk")
    pen = V4.penalty_rates(box_now, engine.bio.group, pen_t0)
    allb = box_now
    fb = {}
    sec = allb[V4.SEC_COLS].to_numpy(float).sum(axis=1) if len(allb) else np.zeros(0)
    gall = V4._groups(allb.index, engine.bio.group)
    for g in ("F", "D"):
        m = gall == g
        s = sec[m].sum() if len(sec) else 0.0
        fb[g] = ((float(allb["pd_all"].to_numpy()[m].sum()) / s * 3600, float(allb["pt_all"].to_numpy()[m].sum()) / s * 3600)
                 if s > 0 else (0.0, 0.0))
    rr = pen.reindex(pd.Index(ids))
    df["pd60"] = np.where(rr["pd60"].notna(), rr["pd60"], [fb[g][0] for g in grp]) if len(ids) else []
    df["pt60"] = np.where(rr["pt60"].notna(), rr["pt60"], [fb[g][1] for g in grp]) if len(ids) else []
    return df


def live_table(pack: Pack, inputs_cur: "V.SeasonInputs | None", box_cur: pd.DataFrame | None,
               games_cur: pd.DataFrame, players_cur: pd.DataFrame | None = None, asof=None):
    """The live v4 ratings (``LIVE_COLUMNS``) from the season pack, the season's inputs and box score."""
    S = pack.season
    played = games_cur
    flags = [c for c in ("has_shifts", "has_boxscore") if c in played.columns]
    if flags:
        played = played[np.logical_or.reduce([played[c].astype("boolean").fillna(False).to_numpy() for c in flags])]
    inp = {S: inputs_cur} if inputs_cur is not None else {}
    clk = P3.season_clock(played) if len(played) else None
    last = None
    if inputs_cur is not None and len(inputs_cur.ev.dates):
        last = inputs_cur.ev.dates.max()
    if asof is None:
        asof = (last + np.timedelta64(V.LAG_DAYS, "D")) if last is not None else None
    g = clk.in_season(S, asof) if (clk is not None and asof is not None) else 0.0
    empty = LeagueClock(pd.DataFrame({"d": [], "season": [], "inc": [], "L_before": []}))
    bx = {S: box_cur} if (box_cur is not None and inputs_cur is not None) else {}
    eng = V4.Engine4(inp, clk or empty, pack.players(players_cur), bx)
    pr, fin_pre = pack.prior(g)
    at = asof if asof is not None else np.datetime64("1970-01-01")
    df = P3.ratings_table(eng, S, at, pr, fin_pre, pack.toi, pack.pos_means, pack.rec, pack.sh, pack.prior_xg,
                          pack.toi_h)
    box_now = V4.add_box(pr.box, eng.box_in(S, at, pack.rec) if S in eng.box else None)
    df = spm_columns(eng, df, pr, box_now, pack.pen_t0)
    meta = {"season": S, "asof": None if asof is None else str(np.datetime64(asof, "D")),
            "max_source_date": None if last is None else str(last), "g": round(float(g), 3),
            "goals_per_xg": pack.goals_per_xg, "pen_value": pack.pen_value, "pen_t0": pack.pen_t0,
            "recency": pack.rec.as_dict(), "shrink": pack.sh.as_dict(), "prior_xg": pack.prior_xg}
    return df[LIVE_COLUMNS].sort_values("player_id").reset_index(drop=True), meta, pr


def bundle_table(paths, season: str, pack_file: str | None = None, source: str | None = None,
                 players_cur: pd.DataFrame | None = None, log=print) -> dict | None:
    """The serving bundle's ``v4`` table (see the module docstring); None without a v4 pack."""
    from bu.lake.build import read_table
    from .box import load_season
    from .data import cached_source, lake_seasons
    pf = pack_file or pack_path(season)
    j = read_pack(pf)
    if j is None:
        log(f"  [v4] no {os.path.basename(pf)}: no v4 ratings in the bundle")
        return None
    pk = Pack(j)
    S = str(season)
    inputs, box_cur, games = None, None, pd.DataFrame()
    if S in lake_seasons(paths.lake):
        games = read_table(paths.lake, "games", [S])
        src = source or cached_source(paths, S)
        if src is not None and os.path.exists(paths.stints(S)):
            inputs = V.SeasonInputs.build(paths, S, src, log=log)
            box_cur, _ = load_season(paths, S, inputs.toi, src, rebuild=True, log=log)
    if players_cur is None:
        try:
            from .bio import build_players
            players_cur = build_players(paths, [S], write=False)
        except Exception as e:  # noqa: BLE001
            log(f"  [v4] no bio for {S}: {type(e).__name__}: {e}")
            players_cur = None
    df, meta, pr = live_table(pk, inputs, box_cur, games, players_cur)
    low = {}
    for g_ in ("F", "D"):
        ev = pr.role_ev.get(f"{g_}|low|later", (0.0, 0.0, 0.0, 0.0))
        st = pr.role_st.get(g_, (0.0, 0.0, 0.0, 0.0))
        low[g_] = [round(float(ev[0]), 5), round(float(ev[1]), 5), round(float(st[0]), 5), round(float(st[1]), 5)]
    meta.update({"pack": os.path.basename(pf), "impact_weights": j["config"].get("impact_weights"),
                 "low_role": low, "toi_pos_means": pk.pos_means,
                 "prior_var": {"o": pk.sh.v_o, "d": pk.sh.v_d, "pp": pk.sh.v_pp, "pk": pk.sh.v_pk},
                 "spm_coef": V4.coef_table(pr).round(5).to_dict() if pr.coef is not None else None})
    rows = [[int(r.player_id), r.group, bool(r.rated)] + [round(float(getattr(r, c)), 6) + 0.0 for c in LIVE_COLUMNS[3:-1]]
            + [r.role or ""] for r in df.itertuples(index=False)]
    return {"columns": LIVE_COLUMNS, "rows": rows, "meta": meta}


# ----------------------------------------------------------------------- CLI (season rollover)

def engine_for(paths, season: str, source: str, n_back: int = 4, log=print) -> V4.Engine4:
    """``v3_pack.engine_for`` + every season's box score (``box.load_season``, cached under <state>/v4)."""
    from .box import load_season
    e3 = P3.engine_for(paths, season, source, n_back, log)
    bx = {s: load_season(paths, s, x.toi, source, log=log)[0] for s, x in e3.inp.items()}
    e = V4.Engine4.__new__(V4.Engine4)
    e.__dict__.update(e3.__dict__)
    e.box = bx
    e._Lb = {s: e.clock.before(b["d"].to_numpy(dtype="datetime64[D]")) for s, b in bx.items()}
    return e


def main(argv=None) -> int:
    import argparse
    from bu.lake.paths import Lake
    from .box import load_season
    from .paths import RapmPaths
    ap = argparse.ArgumentParser(prog="python -m bu.rapm.v4_pack", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["pack"])
    ap.add_argument("--lake-dir", default=None)
    ap.add_argument("--out", default=None, help="RAPM state dir (stints / xG caches of the --xg source)")
    ap.add_argument("--xg", required=True, help="xG source key of the caches (as passed to bu.rapm)")
    ap.add_argument("--season", required=True)
    a = ap.parse_args(argv)
    paths = RapmPaths(Lake(a.lake_dir), a.out)
    eng = engine_for(paths, a.season, a.xg)
    prev = max(s for s in eng.inp if s < str(a.season))
    pv = load_season(paths, prev, eng.inp[prev].toi, a.xg)[1]["value"]
    pk = build_pack(eng, a.season, V.RECENCY, V4.SHRINK, V.FIN_PRIOR_XG, pen_value=pv)
    print(f"  [v4-pack] -> {write_pack(pack_path(a.season), pk)}")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
