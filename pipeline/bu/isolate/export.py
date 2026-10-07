"""Isolated impact -> ``public/data/isolate/<season>.json`` (schema: ``pipeline/CONTRACT.md``).

One row per skater who played (or is rostered) in the season with >= ``MIN_EV_MIN`` 5v5 minutes in
the window.  Maps are the smoothed shot-rate impact maps (unblocked shots per 60 per 5 ft cell),
rows x >= 20 ft only, int8-quantised against one scale per state and base64-encoded
(``grid.b64``); special-teams maps are left out ("") under ``MIN_ST_MIN`` minutes in that state.
"""
from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd

from bu.lake.build import read_table
from bu.lake.paths import REPO_ROOT, Lake

from . import grid, inputs, model

OUT_DIR = os.path.join(REPO_ROOT, "public", "data", "isolate")
MIN_EV_MIN = 100.0
MIN_ST_MIN = 20.0
COLS = ["id", "pos", "toi", "toi_cur", "toi_pp", "toi_pk",
        "ev_off", "ev_def", "pp_off", "pk_def", "ev_off_sh", "ev_def_sh",
        "g_ev_off", "g_ev_def", "g_pp", "g_pk", "g_fin", "g_draw", "g_take", "g_total",
        "fin_x", "drawn60", "taken60",
        "m_ev_off", "m_ev_def", "m_pp", "m_pk"]


def window_seasons(season: str, n: int = model.WINDOW) -> list[str]:
    y = int(season[:4])
    return [f"{y - k}{y - k + 1}" for k in range(n - 1, -1, -1)]


def components(win: model.Window, ev: model.Fit, st: model.Fit) -> pd.DataFrame:
    """Per skater: minutes, impacts (xG/60) and the goal components over a standard season."""
    toi = model.player_toi(win)
    grp = win.pos.set_index("player_id")["position"].pipe(model._group)
    fin = model.finishing(win, toi, grp)
    value = model.minor_value(win)
    pen = model.penalties(win, toi, grp, value)
    idx = toi.index
    df = pd.DataFrame(index=idx)
    df["toi"] = toi["s5"] / 60.0
    df["toi_pp"] = toi["pp"] / 60.0
    df["toi_pk"] = toi["pk"] / 60.0
    e = pd.DataFrame({"o": ev.o, "d": ev.d, "osh": ev.o_sh, "dsh": ev.d_sh}, index=ev.players).reindex(idx).fillna(0.0)
    s = pd.DataFrame({"o": st.o, "d": st.d}, index=st.players).reindex(idx).fillna(0.0)
    df["ev_off"], df["ev_def"] = e["o"], e["d"]
    df["ev_off_sh"], df["ev_def_sh"] = e["osh"], e["dsh"]
    df["pp_off"], df["pk_def"] = s["o"], s["d"]
    std = model.STD_MIN
    df["g_ev_off"] = df["ev_off"] * std["ev"] / 60.0
    df["g_ev_def"] = -df["ev_def"] * std["ev"] / 60.0
    df["g_pp"] = df["pp_off"] * std["pp"] / 60.0
    df["g_pk"] = -df["pk_def"] * std["pk"] / 60.0
    df["g_fin"] = fin["fin_goals"].reindex(idx).fillna(0.0)
    df["g_draw"] = pen["draw_goals"]
    df["g_take"] = pen["take_goals"]
    parts = ["g_ev_off", "g_ev_def", "g_pp", "g_pk", "g_fin", "g_draw", "g_take"]
    df["g_total"] = df[parts].sum(axis=1)
    df["fin_x"] = fin["m"].reindex(idx).fillna(1.0)                     # finishing multiplier
    df["drawn60"], df["taken60"] = pen["drawn60"], pen["taken60"]
    df.attrs.update({"minor_value": value, "fin_scale": fin.attrs.get("scale", 1.0),
                     "ev_league": ev.league, "ev_league_sh": ev.league_sh, "pp_league": st.league,
                     "pp_league_sh": st.league_sh})
    return df


def _season_players(lake: Lake, season: str) -> set:
    lu = read_table(lake, "lineups", [season], columns=["player_id", "is_goalie", "status"])
    ids = set(pd.to_numeric(lu.loc[~lu["is_goalie"].astype("boolean").fillna(False), "player_id"],
                            errors="coerce").dropna().astype(np.int64).tolist())
    pl = read_table(lake, "players", [season], columns=["player_id", "position", "on_season_roster"])
    if len(pl):
        r = pl[pl["on_season_roster"].astype("boolean").fillna(False) & (pl["position"] != "G")]
        ids |= set(r["player_id"].astype(np.int64).tolist())
    return ids


def _round(v, k):
    return None if v is None or not np.isfinite(v) else round(float(v), k)


def build(lake: Lake, season: str, out_dir: str = OUT_DIR, asof=None) -> dict:
    seasons = window_seasons(season)
    have = [s for s in seasons if os.path.isdir(lake.table_path("shifts", s).rsplit("/", 1)[0])]
    parts = [inputs.build(lake, s) for s in have]
    win = model.stack(parts, have, asof=asof)
    ev = model.fit_maps(win, "ev")
    st = model.fit_maps(win, "st")
    comp = components(win, ev, st)
    cur = parts[-1]["toi"] if have and have[-1] == season else None
    cur_toi = (cur.groupby("player_id")["s5"].sum() / 60.0) if cur is not None else pd.Series(dtype=float)
    pos = win.pos.set_index("player_id")["position"]
    who = _season_players(lake, season)
    keep = [p for p in comp.index if p in who and pos.get(p, "G") != "G" and comp.at[p, "toi"] >= MIN_EV_MIN]

    ie = pd.Series(np.arange(len(ev.players)), index=ev.players)
    is_ = pd.Series(np.arange(len(st.players)), index=st.players)
    ev_maps = {"o": grid.export_rows(ev.o_map), "d": grid.export_rows(ev.d_map)}
    st_maps = {"o": grid.export_rows(st.o_map), "d": grid.export_rows(st.d_map)}

    def scale(maps, ids, index):
        k = index.reindex(ids).dropna().astype(int).to_numpy()
        v = np.abs(np.concatenate([maps["o"][k].ravel(), maps["d"][k].ravel()])) if len(k) else np.array([1.0])
        return float(np.quantile(v, 0.998) / 127.0) or 1e-6

    s_ev = scale(ev_maps, keep, ie)
    s_st = scale(st_maps, [p for p in keep if comp.at[p, "toi_pp"] >= MIN_ST_MIN or comp.at[p, "toi_pk"] >= MIN_ST_MIN], is_)

    rows = []
    for p in sorted(keep, key=lambda q: -comp.at[q, "g_total"]):
        c = comp.loc[p]
        k = ie.get(p)
        j = is_.get(p)
        m_eo = grid.b64(grid.quantize(ev_maps["o"][k], s_ev)) if k is not None else ""
        m_ed = grid.b64(grid.quantize(ev_maps["d"][k], s_ev)) if k is not None else ""
        m_pp = grid.b64(grid.quantize(st_maps["o"][j], s_st)) if j is not None and c["toi_pp"] >= MIN_ST_MIN else ""
        m_pk = grid.b64(grid.quantize(st_maps["d"][j], s_st)) if j is not None and c["toi_pk"] >= MIN_ST_MIN else ""
        g = "D" if pos.get(p) == "D" else "F"
        rows.append([int(p), g, _round(c["toi"], 0), _round(cur_toi.get(p, 0.0), 0), _round(c["toi_pp"], 0),
                     _round(c["toi_pk"], 0),
                     _round(c["ev_off"], 3), _round(c["ev_def"], 3), _round(c["pp_off"], 3), _round(c["pk_def"], 3),
                     _round(c["ev_off_sh"], 2), _round(c["ev_def_sh"], 2),
                     _round(c["g_ev_off"], 2), _round(c["g_ev_def"], 2), _round(c["g_pp"], 2), _round(c["g_pk"], 2),
                     _round(c["g_fin"], 2), _round(c["g_draw"], 2), _round(c["g_take"], 2),
                     _round(c["g_total"], 2), _round(c["fin_x"], 3),
                     _round(c["drawn60"], 3), _round(c["taken60"], 3), m_eo, m_ed, m_pp, m_pk])
    a = comp.attrs
    doc = {
        "version": 1,
        "season": season,
        "window": have,
        "asof": str(win.asof.date()),
        "half_life_days": model.HALF_LIFE_DAYS,
        "grid": {"x0": grid.X_SHOW, "cell": grid.OUT_FT, "nx": grid.NX_EXPORT, "ny": grid.NY_OUT,
                 "y0": grid.Y_MIN, "sigma": grid.SIGMA_FT},
        "std": model.STD_MIN,
        "league": {"ev_xg": round(a["ev_league"], 4), "ev_sh": round(a["ev_league_sh"], 3),
                   "pp_xg": round(a["pp_league"], 4), "pp_sh": round(a["pp_league_sh"], 3),
                   "minor_value": round(a["minor_value"], 4)},
        "scale": {"ev": s_ev, "st": s_st},
        "columns": COLS,
        "rows": rows,
    }
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{season}.json")
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    os.replace(tmp, path)
    return {"path": path, "rows": len(rows), "bytes": os.path.getsize(path), "window": have,
            "asof": doc["asof"]}
