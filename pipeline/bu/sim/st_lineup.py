"""Lineup-driven special teams and penalties for the simulator (``prereg_st.json``).

Ratings v4 / v5 carry, per skater: power-play offence ``pp`` and penalty-kill defence ``pk`` (RAPM
on the PP side's xG/60 with SPM priors; ``pk`` > 0 = the PK allows more), expected minutes per game
by state ``toi_ev`` / ``toi_pp`` / ``toi_pk`` (EWMA), and penalties drawn / taken per 60 on-ice
minutes ``pd60`` / ``pt60`` (v5: every penalty rescaled to power-play-creating units, shrunk with
800 / 400 pseudo minutes).  One side's aggregates over its dressed (or expected) skaters P:

  ppo   = sum_P pp_i  x 5 toi_pp_i / sum_P toi_pp      PP offence of its expected PP units (xG/60)
  pkd   = sum_P pk_i  x 4 toi_pk_i / sum_P toi_pk      PK defence of its expected PK units (xG/60)
  take  = 5 x sum_P pt60_i toi_i / sum_P toi_i          penalties taken per 60 (toi = ev + pp + pk)
  draw  = 5 x sum_P pd60_i toi_i / sum_P toi_i          penalties drawn per 60

A skater missing from the ratings table takes his position group's role means (``pp`` / ``pk``),
the group's mean minutes and the group's penalty rates.  The rate regressions read them relative
to the point-in-time league level (``rates.side_features``):

  pp   lu_ppo = ppo_X / (3600 lg_pp_xg),  lu_pkd = pkd_Y / (3600 lg_pp_xg)
  pen  lu_take = log(take_X / (3600 lg_pen)),  lu_draw = log(draw_Y / (3600 lg_pen))

History (``history`` command): every game of the per-date player tables (one parquet per season,
``asof`` = game date, built from games up to d - 2 days, the layout of ``player_table_asof``) x the
game's dressed skaters (lake ``lineups``) -> one row per game (``ST_COLUMNS``).  Live: the serving
bundle's ``v4`` table (``bu.lineup.serve.LiveLineupTerm`` adds ``st`` to each side).

    cd pipeline
    python -m bu.sim.st_lineup history --st-dir <dir of st_season=S.parquet> --out bu/lineup/out/lineup_st_v4.csv.gz
"""
from __future__ import annotations

import argparse
import json
import math
import os

import numpy as np
import pandas as pd

ST_FIELDS = ("ppo", "pkd", "take", "draw")
ST_COLUMNS = ["game_id", "st_ok"] + [f"st_{s}_{f}" for s in "ha" for f in ST_FIELDS] + ["st_h_n", "st_a_n"]
PLAYER_COLS = ("pp", "pk", "toi_ev", "toi_pp", "toi_pk", "pd60", "pt60")
PP_SKATERS, PK_SKATERS, EV_SKATERS = 5.0, 4.0, 5.0
MIN_SKATERS = 10


def fallbacks(table: pd.DataFrame | None = None, role_st: dict | None = None, toi_pm: dict | None = None,
              pen_fb: dict | None = None) -> dict:
    """Per position group ('F' / 'D'): the PLAYER_COLS values of a skater missing from the table.
    ``role_st``: {grp: (pp, pk)} role means; ``toi_pm``: {grp: {ev, pp, pk}} mean SECONDS per game;
    ``pen_fb``: {grp: (pd60, pt60)}; anything not given comes from ``table``'s group means
    (minutes-weighted for the penalty rates)."""
    out = {}
    for g in ("F", "D"):
        t = table[table["group"] == g] if table is not None and len(table) else None
        rec = {}
        if role_st and g in role_st:
            rec["pp"], rec["pk"] = float(role_st[g][0]), float(role_st[g][1])
        elif t is not None and len(t):
            rec["pp"], rec["pk"] = float(t["pp"].mean()), float(t["pk"].mean())
        else:
            rec["pp"], rec["pk"] = 0.0, 0.0
        for s in ("ev", "pp", "pk"):
            if toi_pm and g in toi_pm:
                rec[f"toi_{s}"] = float(toi_pm[g][s]) / 60.0
            elif t is not None and len(t):
                rec[f"toi_{s}"] = float(t[f"toi_{s}"].mean())
            else:
                rec[f"toi_{s}"] = 0.0
        if pen_fb and g in pen_fb:
            rec["pd60"], rec["pt60"] = float(pen_fb[g][0]), float(pen_fb[g][1])
        elif t is not None and len(t):
            w = (t["toi_ev"] + t["toi_pp"] + t["toi_pk"]).to_numpy(float)
            w = w if w.sum() > 0 else np.ones(len(t))
            rec["pd60"] = float(np.average(t["pd60"], weights=w))
            rec["pt60"] = float(np.average(t["pt60"], weights=w))
        else:
            rec["pd60"], rec["pt60"] = 0.0, 0.0
        out[g] = tuple(rec[c] for c in PLAYER_COLS)
    return out


def aggregate(lookup: dict, pids, groups, fb: dict) -> dict | None:
    """One side's ``ST_FIELDS`` (see the module docstring) from ``lookup`` {player_id: PLAYER_COLS
    tuple}; None with fewer than MIN_SKATERS skaters or no PP / PK / total minutes."""
    if len(pids) < MIN_SKATERS:
        return None
    rows = np.array([lookup.get(int(p), fb.get(g, fb["F"])) for p, g in zip(pids, groups)], dtype=float)
    pp, pk, tev, tpp, tpk, pd60, pt60 = rows.T
    tall = tev + tpp + tpk
    if tpp.sum() <= 0 or tpk.sum() <= 0 or tall.sum() <= 0:
        return None
    n_rated = int(sum(int(p) in lookup for p in pids))
    return {"ppo": float(PP_SKATERS * (pp * tpp).sum() / tpp.sum()),
            "pkd": float(PK_SKATERS * (pk * tpk).sum() / tpk.sum()),
            "take": float(EV_SKATERS * (pt60 * tall).sum() / tall.sum()),
            "draw": float(EV_SKATERS * (pd60 * tall).sum() / tall.sum()),
            "n": int(len(pids)), "rated": n_rated}


def features(row_st_x: dict | None, row_st_y: dict | None, lg_pp_xg: float, lg_pen: float) -> dict:
    """The rate-regression features of attacking side X against Y (0 when unavailable)."""
    out = {"lu_ppo": 0.0, "lu_pkd": 0.0, "lu_take": 0.0, "lu_draw": 0.0}
    if row_st_x is None or row_st_y is None:
        return out
    c_pp, c_pen = 3600.0 * float(lg_pp_xg), 3600.0 * float(lg_pen)
    if not (c_pp > 0 and c_pen > 0):
        return out
    out["lu_ppo"] = float(row_st_x["ppo"]) / c_pp
    out["lu_pkd"] = float(row_st_y["pkd"]) / c_pp
    if row_st_x["take"] > 0 and row_st_y["draw"] > 0:
        out["lu_take"] = math.log(float(row_st_x["take"]) / c_pen)
        out["lu_draw"] = math.log(float(row_st_y["draw"]) / c_pen)
    return out


def side_frame(g: pd.DataFrame, side: str) -> pd.DataFrame:
    """Vectorised ``features`` for the attacking side of every game row of ``g`` (the history /
    live input layout: ``st_ok``, ``st_{h,a}_{ppo,pkd,take,draw}``, ``lg_pp_xg``, ``lg_pen``)."""
    o = "a" if side == "h" else "h"
    n = len(g)

    def col(c):
        return pd.to_numeric(g[c], errors="coerce").to_numpy(dtype=float) if c in g else np.full(n, np.nan)
    ok = (g["st_ok"].astype(str).str.lower().isin(("true", "1")).to_numpy() if "st_ok" in g else np.zeros(n, bool))
    c_pp = 3600.0 * col("lg_pp_xg")
    c_pen = 3600.0 * col("lg_pen")
    ppo, pkd, take, draw = col(f"st_{side}_ppo"), col(f"st_{o}_pkd"), col(f"st_{side}_take"), col(f"st_{o}_draw")
    ok = ok & np.isfinite(c_pp) & (c_pp > 0) & np.isfinite(c_pen) & (c_pen > 0) & np.isfinite(ppo) & np.isfinite(pkd) \
        & np.isfinite(take) & np.isfinite(draw) & (take > 0) & (draw > 0)
    f = pd.DataFrame(index=g.index)
    safe = lambda a, d=1.0: np.where(ok, a, d)  # noqa: E731
    f["lu_ppo"] = np.where(ok, safe(ppo, 0.0) / safe(c_pp), 0.0)
    f["lu_pkd"] = np.where(ok, safe(pkd, 0.0) / safe(c_pp), 0.0)
    f["lu_take"] = np.where(ok, np.log(safe(take) / safe(c_pen)), 0.0)
    f["lu_draw"] = np.where(ok, np.log(safe(draw) / safe(c_pen)), 0.0)
    return f


# ----------------------------------------------------------------------------- history table

def player_table_asof(E, S: str, rec=None, sh=None, log=print):
    """Yield (asof, player table, meta) for every game date of season S from a ratings v4 engine
    holding the season and the four before it (``bu.rapm.v4_pack.engine_for``): the stage-1 PP / PK
    grid (``want_var`` as the season pack), the stage-2 PP / PK fit on the season's games up to
    d - LAG_DAYS, the TOI EWMA state and the v5 penalty rates of the box sums - the ``v4`` table's
    columns as ``bu.rapm.v4_pack.live_table`` computes them on that date."""
    from bu.rapm import v3 as V
    from bu.rapm import v4 as V4
    from bu.rapm import v5 as V5
    rec, sh, S = rec or V.RECENCY, sh or V4.SHRINK, str(S)
    grid = [E.stage1(S, float(g), rec, sh, want_var=True, st=True, ev=False) for g in V.G_GRID]
    prev = [s for s in sorted(E.inp) if s < S]
    toi_prev = pd.concat([E.inp[s].toi for s in prev], ignore_index=True)
    start = E.clock.date_at(S, 0.0)
    tst0 = V.toi_state(toi_prev, np.datetime64(start, "D") - np.timedelta64(1, "D"), dict(V.TOI_HALF_LIFE))
    pm = V.toi_pos_means(E.inp[prev[-1]].toi, E.bio.group)
    x = E.inp[S]
    dates = np.unique(np.concatenate([x.ev.dates, x.st.dates, [np.datetime64(start, "D")]]))
    for d in dates:
        pr = V4.interpolate4(grid, E.clock.in_season(S, d), sh)
        cutoff = np.datetime64(d, "D") - np.timedelta64(V.LAG_DAYS, "D")
        rows = {p: [e[0], e[1]] for p, e in pr.st.items()}
        if len(x.st.dates) and (x.st.dates <= cutoff).any():
            res = E.stage2(S, d, rec, sh, pr, want_sd=False, st=True, ev=False)
            for p, a, b in zip(res["st"]["player_id"], res["st"]["pp"], res["st"]["pk"]):
                rows[int(p)] = [float(a), float(b)]
        tst = V.roll_toi_state(tst0, x.toi[x.toi["d"] <= cutoff], dict(V.TOI_HALF_LIFE))
        box_now = V4.add_box(pr.box, E.box_in(S, d, rec))
        pen, fb = V5.penalty_rates(box_now, E.bio.group, V5.PEN_T0, V5.PEN_UNITS)
        ids = sorted(set(rows) | {int(p) for p in tst.index} | {int(p) for p in pen.index})
        grp = np.array([E.bio.g(p) for p in ids])
        et = V.expected_toi(tst.reindex(ids).fillna(0.0), E.bio.group, pm)
        rr = pen.reindex(pd.Index(ids))
        tab = pd.DataFrame({
            "asof": d, "player_id": ids, "group": grp,
            "pp": [rows[p][0] if p in rows else pr.role_st.get(g_, (0.0, 0.0))[0] for p, g_ in zip(ids, grp)],
            "pk": [rows[p][1] if p in rows else pr.role_st.get(g_, (0.0, 0.0))[1] for p, g_ in zip(ids, grp)],
            "toi_ev": et["toi_ev"].to_numpy(), "toi_pp": et["toi_pp"].to_numpy(), "toi_pk": et["toi_pk"].to_numpy(),
            "pd60": np.where(rr["pd60"].notna(), rr["pd60"], [fb[g_][0] for g_ in grp]),
            "pt60": np.where(rr["pt60"].notna(), rr["pt60"], [fb[g_][1] for g_ in grp]),
            "has_st": [p in rows for p in ids]})
        meta = {"asof": str(d), "role_st": {k: [float(v[0]), float(v[1])] for k, v in pr.role_st.items()},
                "pen_fb": {k: [float(v[0]), float(v[1])] for k, v in fb.items()}, "toi_pm": pm}
        yield d, tab, meta


def load_player_tables(st_dir: str, seasons) -> tuple[dict, dict]:
    """({(season, asof): (lookup, fallbacks)}, {season: sorted asof dates}) from ``st_dir``."""
    tabs, dates = {}, {}
    for s in seasons:
        p = os.path.join(st_dir, f"st_season={s}.parquet")
        if not os.path.exists(p):
            continue
        r = pd.read_parquet(p)
        r["asof"] = pd.to_datetime(r["asof"]).values.astype("datetime64[D]")
        mp = os.path.join(st_dir, f"st_meta_season={s}.json")
        metas = {np.datetime64(m["asof"][:10], "D"): m for m in json.load(open(mp))} if os.path.exists(mp) else {}
        for a, sub in r.groupby("asof"):
            m = metas.get(a) or {}
            fb = fallbacks(sub, m.get("role_st"), m.get("toi_pm"), m.get("pen_fb"))
            lk = {int(p): tuple(float(v) for v in vals) for p, *vals in
                  sub[["player_id", *PLAYER_COLS]].itertuples(index=False, name=None)}
            tabs[(s, a)] = (lk, fb)
        dates[s] = np.array(sorted(r["asof"].unique()), dtype="datetime64[D]")
    return tabs, dates


def history(lake, st_dir: str, seasons, log=print) -> pd.DataFrame:
    """One row per lake game (types 2 / 3) of ``seasons``: ``ST_COLUMNS`` from the dressed skaters and
    the player table as of the game date (the latest table at or before it)."""
    from bu.lineup.features import lineup_tables
    games, lineups, _ = lineup_tables(lake, list(seasons))
    tabs, dates = load_player_tables(st_dir, seasons)
    out = []
    for g in games.itertuples(index=False):
        S, d = str(g.season), np.datetime64(g.d, "D")
        rec = {"game_id": int(g.game_id), "st_ok": False}
        ds = dates.get(S)
        k = int(np.searchsorted(ds, d, side="right")) - 1 if ds is not None and len(ds) else -1
        if k >= 0:
            lk, fb = tabs[(S, ds[k])]
            sides = {}
            for side, tid in (("h", int(g.home_team_id)), ("a", int(g.away_team_id))):
                pids, groups = lineups.get((int(g.game_id), tid), ([], []))
                sides[side] = aggregate(lk, pids, groups, fb)
                rec[f"st_{side}_n"] = len(pids)
            if sides["h"] is not None and sides["a"] is not None:
                rec["st_ok"] = True
                for side, a in sides.items():
                    for f in ST_FIELDS:
                        rec[f"st_{side}_{f}"] = a[f]
        out.append(rec)
    df = pd.DataFrame(out)
    for c in ST_COLUMNS:
        if c not in df:
            df[c] = np.nan
    log(f"[st_lineup] {len(df)} games, st_ok {df['st_ok'].mean():.3f}")
    return df[ST_COLUMNS]


def load_history(path: str) -> pd.DataFrame:
    f = pd.read_csv(path)
    f["st_ok"] = f["st_ok"].astype(str).str.lower().isin(("true", "1"))
    f["game_id"] = pd.to_numeric(f["game_id"], errors="coerce").astype("int64")
    return f[[c for c in ST_COLUMNS if c in f.columns]].drop_duplicates("game_id")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bu.sim.st_lineup")
    ap.add_argument("cmd", choices=["history"])
    ap.add_argument("--st-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--lake-dir", default=None)
    ap.add_argument("--seasons", default=None, help="comma list (default: every season with a player table)")
    a = ap.parse_args(argv)
    from bu.lake.paths import Lake
    seasons = a.seasons.split(",") if a.seasons else sorted(
        f.split("=")[1].split(".")[0] for f in os.listdir(a.st_dir) if f.startswith("st_season="))
    df = history(Lake(a.lake_dir), a.st_dir, seasons)
    df.to_csv(a.out, index=False, float_format="%.6g")
    print(f"[st_lineup] wrote {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
