"""Validation of the isolated-impact model (writes ``bu/isolate/out/isolate_validation.json``).

* tuning: 5-fold (by game) CV of the player ridge strength on the scalar xG and shot-rate
  targets (``model.cv_lambda``) and of the setting ridge, on the 2023-24..2025-26 window;
* repeatability: one-season fits (no recency weighting) of consecutive seasons, Pearson r of the
  scalar impacts and components for skaters with >= ``MIN_MIN`` minutes in both seasons, and the
  map-shape repeatability: the mean per-player correlation of his offensive-zone cells in year t
  vs year t+1, against the same statistic for a random other player (the "every good player is
  a slot blob" baseline), for shot-rate maps and xG-weighted maps;
* agreement: the window fit vs ``public/data/player_ratings.json`` (``ev_off`` / ``ev_def``, the
  site's game-recency RAPM) and ``public/data/player_impact.json`` (``rapm_off`` / ``rapm_def``).
"""
from __future__ import annotations

import json
import os
import time

import numpy as np
import pandas as pd

from bu.lake.paths import REPO_ROOT, Lake

from . import grid, inputs, model
from .export import components

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "isolate_validation.json")
MIN_MIN = 500.0


def _r(a, b) -> float:
    a, b = np.asarray(a, float), np.asarray(b, float)
    ok = np.isfinite(a) & np.isfinite(b)
    return float(np.corrcoef(a[ok], b[ok])[0, 1]) if ok.sum() > 2 else float("nan")


def _single(lake: Lake, season: str) -> dict:
    win = model.stack([inputs.build(lake, season)], [season], half_life=float("inf"))
    ev = model.fit_maps(win, "ev", xg_maps=True)
    st = model.fit_maps(win, "st")
    comp = components(win, ev, st)
    return {"win": win, "ev": ev, "st": st, "comp": comp}


def _oz(maps: np.ndarray) -> np.ndarray:
    """Offensive-zone cells (x >= 25 ft) of output maps."""
    m = maps.reshape(len(maps), grid.NX_OUT, grid.NY_OUT)
    return m[:, int(25 / grid.OUT_FT):, :].reshape(len(maps), -1)


def _shape_r(a: np.ndarray, b: np.ndarray, rng) -> tuple[float, float]:
    """Mean per-player correlation of matched rows vs randomly paired rows."""
    def rows_r(x, y):
        x = x - x.mean(1, keepdims=True)
        y = y - y.mean(1, keepdims=True)
        den = np.sqrt((x * x).sum(1) * (y * y).sum(1))
        return (x * y).sum(1) / np.where(den > 0, den, np.nan)
    same = float(np.nanmean(rows_r(a, b)))
    perm = rng.permutation(len(b))
    return same, float(np.nanmean(rows_r(a, b[perm])))


def repeatability(a: dict, b: dict) -> dict:
    ea, eb = a["ev"], b["ev"]
    ia = pd.Series(np.arange(len(ea.players)), index=ea.players)
    ib = pd.Series(np.arange(len(eb.players)), index=eb.players)
    both = [p for p in ia.index.intersection(ib.index)
            if ea.toi_o.get(p, 0) / 60 >= MIN_MIN and eb.toi_o.get(p, 0) / 60 >= MIN_MIN]
    ka, kb = ia[both].to_numpy(), ib[both].to_numpy()
    rng = np.random.default_rng(11)
    out = {"n": len(both),
           "ev_off_xg": _r(ea.o[ka], eb.o[kb]), "ev_def_xg": _r(ea.d[ka], eb.d[kb]),
           "ev_off_shots": _r(ea.o_sh[ka], eb.o_sh[kb]), "ev_def_shots": _r(ea.d_sh[ka], eb.d_sh[kb])}
    for nm, ma, mb in (("rate_off", ea.o_map, eb.o_map), ("rate_def", ea.d_map, eb.d_map),
                       ("xg_off", ea.xg_o_map, eb.xg_o_map), ("xg_def", ea.xg_d_map, eb.xg_d_map)):
        same, rand = _shape_r(_oz(ma[ka]), _oz(mb[kb]), rng)
        out[f"map_shape_{nm}"] = {"same_player": same, "random_pair": rand}
    ca, cb = a["comp"], b["comp"]
    ids = [p for p in both if p in ca.index and p in cb.index]
    for c in ("g_ev_off", "g_ev_def", "g_pp", "g_pk", "g_fin", "g_draw", "g_take", "g_total", "ixg60", "fin_x",
              "drawn60", "taken60"):
        out[c] = _r(ca.loc[ids, c], cb.loc[ids, c])
    pos = b["win"].pos.set_index("player_id")["position"]
    for g in ("F", "D"):
        sub = [p for p in ids if (pos.get(p) == "D") == (g == "D")]
        out[f"ixg60_{g}"] = _r(ca.loc[sub, "ixg60"], cb.loc[sub, "ixg60"])
    # special teams: skaters with >= 100 PP (PK) minutes in both
    sa, sb = a["st"], b["st"]
    ja = pd.Series(np.arange(len(sa.players)), index=sa.players)
    jb = pd.Series(np.arange(len(sb.players)), index=sb.players)
    common = ja.index.intersection(jb.index)
    pp = [p for p in common if sa.toi_o.get(p, 0) / 60 >= 100 and sb.toi_o.get(p, 0) / 60 >= 100]
    pk = [p for p in common if sa.toi_d.get(p, 0) / 60 >= 100 and sb.toi_d.get(p, 0) / 60 >= 100]
    out["pp_off_xg"] = {"n": len(pp), "r": _r(sa.o[ja[pp]], sb.o[jb[pp]])}
    out["pk_def_xg"] = {"n": len(pk), "r": _r(sa.d[ja[pk]], sb.d[jb[pk]])}
    return out


def agreement(fit: model.Fit) -> dict:
    out = {}
    keep = fit.toi_o / 60 >= MIN_MIN
    o = pd.Series(fit.o, index=fit.players)[keep.to_numpy()]
    d = pd.Series(fit.d, index=fit.players)[keep.to_numpy()]
    p = os.path.join(REPO_ROOT, "public", "data", "player_ratings.json")
    if os.path.exists(p):
        doc = json.load(open(p))
        df = pd.DataFrame(doc["rows"], columns=doc["columns"]).set_index("id")
        ids = o.index.intersection(df.index)
        out["player_ratings"] = {"n": len(ids), "ev_off": _r(o[ids], df.loc[ids, "ev_off"]),
                                 "ev_def": _r(d[ids], df.loc[ids, "ev_def"])}
    p = os.path.join(REPO_ROOT, "public", "data", "player_impact.json")
    if os.path.exists(p):
        doc = json.load(open(p))   # {player_id: {..., rapm_off, rapm_def, rapm_toi}} (current season only)
        df = pd.DataFrame.from_dict(doc, orient="index")
        if {"rapm_off", "rapm_def"} <= set(df.columns):
            df = df.dropna(subset=["rapm_off"])
            df.index = df.index.astype(np.int64)
            ids = o.index.intersection(df.index)
            big = [i for i in ids if (df.at[i, "rapm_toi"] or 0) >= 3600]
            out["player_impact"] = {"n": len(ids), "rapm_off": _r(o[ids], df.loc[ids, "rapm_off"]),
                                    "rapm_def": _r(d[ids], df.loc[ids, "rapm_def"]),
                                    "n_60min": len(big), "rapm_off_60min": _r(o[big], df.loc[big, "rapm_off"]),
                                    "rapm_def_60min": _r(d[big], df.loc[big, "rapm_def"])}
    return out


def _cv_split(des: model.Design, lam_o, lam_d, folds: int = 5) -> dict:
    """5-fold CV loss for every (offence, defence) ridge strength pair, minus the best."""
    fold = (pd.util.hash_array(des.game_id.astype(np.int64)) % folds).astype(int)
    wy = des.w * des.y
    Gs, rs, yy = [], [], []
    for f in range(folds):
        m = fold == f
        Gs.append(model.gram(des.X[m], des.w[m]))
        rs.append(des.X[m].T @ wy[m])
        yy.append(float(np.sum(des.w[m] * des.y[m] ** 2)))
    G, r, n = sum(Gs), sum(rs), des.n
    out = {}
    for a in lam_o:
        for b in lam_d:
            L = np.concatenate([np.full(n, a), np.full(n, b), np.full(len(des.cov), model.LAMBDA_COV)])
            loss = sum(yy[f] - 2 * (bb := model.solve(G - Gs[f], L, r - rs[f])) @ rs[f] + bb @ Gs[f] @ bb
                       for f in range(folds))
            out[f"{a}/{b}"] = loss / float(des.w.sum())
    best = min(out.values())
    return {"best": min(out, key=out.get), "excess": {k: round(v - best, 5) for k, v in out.items()}}


def run(lake: Lake, seasons=("20222023", "20232024", "20242025", "20252026")) -> dict:
    t0 = time.time()
    report: dict = {"min_minutes": MIN_MIN}
    win = model.stack([inputs.build(lake, s) for s in seasons[-3:]], seasons[-3:])
    report["tuning"] = {
        "window": list(seasons[-3:]),
        "ev_xg": model.cv_lambda(model.build_design(win, "ev"), [5000, 10000, 20000, 40000, 80000]),
        "ev_shots": model.cv_lambda(model.build_design(win, "ev", target="sh"), [5000, 10000, 20000, 40000, 80000]),
        "st_xg": model.cv_lambda(model.build_design(win, "st"), [2500, 5000, 10000, 20000, 40000]),
        "st_shots": model.cv_lambda(model.build_design(win, "st", target="sh"), [2500, 5000, 10000, 20000, 40000]),
    }
    toi = model.player_toi(win)
    grp = win.pos.set_index("player_id")["position"].pipe(model._group)
    fin = model.finishing(win, toi, grp)
    _, _, cv_set = model.setting(win, fin, folds=5)
    report["tuning"]["setting"] = cv_set
    # defence over-shrunk?  Separate offence / defence strengths, CV on the map (shot-rate) target
    report["tuning"]["ev_shots_off_def"] = _cv_split(model.build_design(win, "ev", target="sh"),
                                                     [10000, 20000, 40000], [5000, 10000, 20000, 40000, 80000])
    report["tuning"]["st_shots_off_def"] = _cv_split(model.build_design(win, "st", target="sh"),
                                                     [5000, 10000, 20000], [2500, 5000, 10000, 20000, 40000])
    cur = "20262027"
    if os.path.isdir(os.path.dirname(lake.table_path("shifts", cur))):
        cw = ["20242025", "20252026", cur]
        report["agreement_window"] = {"window": cw, **agreement(model.fit_maps(
            model.stack([inputs.build(lake, s) for s in cw], cw), "ev"))}
    singles = {s: _single(lake, s) for s in seasons}
    report["repeatability"] = {f"{a}->{b}": repeatability(singles[a], singles[b])
                               for a, b in zip(seasons[:-1], seasons[1:])}
    report["seconds"] = round(time.time() - t0, 1)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(report, f, indent=1, default=float)
    return report
