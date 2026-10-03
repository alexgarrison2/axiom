"""Individual (box-score) player-game counts for the ratings v4 statistical plus-minus prior.

Ratings v4 (``v4.py``, ``v4_prereg.json``) puts a box-score prior under the v3 on-ice RAPM: a
player's EV OFF / EV DEF / PP / PK prior mean is a ridge regression on his own recency-weighted
individual rates (goals, primary and secondary assists, individual xG, shot attempts, rebounds and
rush shots created, faceoffs, blocks, takeaways, giveaways, hits, penalties, usage).  This module
builds the per (game, player) counts those rates come from, from the lake's play-by-play events,
the xG source of the RAPM caches and the v3 TOI table (``v3.state_toi``), all free NHL data.

Counts are split by the player's own manpower state at the event (``situation_code``, both goalies
in): EV (5v5 / 4v4 / 3v3), PP (more skaters), PK (fewer); events with a goalie pulled count only
in the all-situation penalty columns.  The player's side comes from the game's roster spots
(``lineups``), so blocks, faceoff losses and penalties drawn are attributed to the right team
whatever the event owner is.

Columns (``COUNT_COLS``; per game and player, plus ``ev_s`` / ``pp_s`` / ``pk_s`` seconds and the
game date ``d``):

* EV: ``g_ev`` goals, ``a1_ev`` / ``a2_ev`` primary / secondary assists, ``ixg_ev`` individual xG
  (unblocked non-penalty-shot attempts, the RAPM target's xG), ``iff_ev`` unblocked attempts,
  ``icf_ev`` all attempts (blocked included), ``reb_ev`` rebounds created (his shot on goal followed
  within ``REBOUND_S`` seconds by a teammate's or his own attempt, no event in between), ``rush_ev``
  rush attempts (the previous event within ``RUSH_S`` seconds was in his neutral or defensive zone),
  ``blk_ev`` shots blocked, ``tk_ev`` takeaways, ``gv_ev`` giveaways, ``hit_ev`` hits, ``fow_ev`` /
  ``fol_ev`` faceoffs won / lost;
* PP: ``g_pp``, ``a1_pp``, ``a2_pp``, ``ixg_pp``, ``iff_pp``; PK: ``blk_pk``, ``tk_pk``;
* all situations: ``pd_all`` / ``pt_all`` penalties drawn / taken in power-play units
  (``penalty_units``: minor 1, double minor 2, non-fighting major 2.5; fighting, misconducts and
  penalty shots 0).

Only regular-season and playoff games whose TOI rows exist (the on-ice check of the stints) are
kept, so every count has its minutes.
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

REBOUND_S = 3
RUSH_S = 4
SHOT_TYPES = ("goal", "shot-on-goal", "missed-shot", "blocked-shot")
EV_COUNTS = ["g_ev", "a1_ev", "a2_ev", "ixg_ev", "iff_ev", "icf_ev", "reb_ev", "rush_ev", "blk_ev", "tk_ev",
             "gv_ev", "hit_ev", "fow_ev", "fol_ev"]
PP_COUNTS = ["g_pp", "a1_pp", "a2_pp", "ixg_pp", "iff_pp"]
PK_COUNTS = ["blk_pk", "tk_pk"]
ALL_COUNTS = ["pd_all", "pt_all"]
COUNT_COLS = EV_COUNTS + PP_COUNTS + PK_COUNTS + ALL_COUNTS
SEC_COLS = ["ev_s", "pp_s", "pk_s"]
BOX_VERSION = 1


def penalty_units(desc, duration) -> np.ndarray:
    """Power-play units of penalties: minor 1, double minor 2, major 2.5 (fighting 0), else 0."""
    desc = pd.Series(desc).fillna("").astype(str).str.lower().to_numpy()
    dur = pd.to_numeric(pd.Series(duration), errors="coerce").fillna(0).to_numpy(float)
    u = np.select([dur == 2, dur == 4, dur == 5], [1.0, 2.0, 2.5], 0.0)
    bad = np.array([d.startswith("fighting") or d.startswith("ps-") or "misconduct" in d for d in desc], dtype=bool)
    return np.where(bad, 0.0, u)


def _state(own_sk, opp_sk, both_g) -> np.ndarray:
    """'ev' / 'pp' / 'pk' / 'other' from the player's side."""
    own_sk, opp_sk = np.asarray(own_sk), np.asarray(opp_sk)
    ok = np.asarray(both_g, bool) & (own_sk >= 3) & (own_sk <= 5) & (opp_sk >= 3) & (opp_sk <= 5)
    return np.where(~ok, "other", np.where(own_sk == opp_sk, "ev", np.where(own_sk > opp_sk, "pp", "pk")))


def player_game_counts(events: pd.DataFrame, lineups: pd.DataFrame, xg: pd.DataFrame | None,
                       toi: pd.DataFrame) -> pd.DataFrame:
    """Per (game_id, d, player_id): ``COUNT_COLS`` + ``SEC_COLS`` (see the module docstring).

    ``events``: one season's lake events; ``lineups``: its roster spots (game_id, player_id,
    is_home); ``xg``: game_id, event_id, xg of unblocked attempts (None: ixG = 0); ``toi``: the v3
    ``state_toi`` table (game_id, d, player_id, ev_s, pp_s, pk_s)."""
    games = set(toi["game_id"].unique())
    e = events[events["game_id"].isin(games)]
    e = e[(e["period_type"].astype(str) != "SO") & ~e["is_shootout"].astype("boolean").fillna(False)]
    e = e.sort_values(["game_id", "sort_order", "event_id"]).reset_index(drop=True)
    hs, as_ = e["sit_home_sk"].to_numpy(), e["sit_away_sk"].to_numpy()
    both_g = (e["sit_home_g"].to_numpy() == 1) & (e["sit_away_g"].to_numpy() == 1)
    gid = e["game_id"].to_numpy()
    typ = e["type_desc"].astype(str).to_numpy()
    xmap = {}
    if xg is not None and len(xg):
        xmap = {(int(g), int(i)): float(v) for g, i, v in xg[["game_id", "event_id", "xg"]].itertuples(index=False)}
    pen_shot = e["is_penalty_shot"].astype("boolean").fillna(False).to_numpy()

    # rebounds created / rush attempts (event order within a game, same period)
    per = e["period"].to_numpy()
    sec = e["game_seconds"].to_numpy(float)
    shoot_team = e["shooting_team_id"].to_numpy()
    owner = e["event_team_id"].to_numpy()
    zone = e["zone_code"].astype(object).to_numpy()
    is_att = np.isin(typ, SHOT_TYPES) & ~pen_shot
    nxt_same = np.zeros(len(e), bool)
    prev_rush = np.zeros(len(e), bool)
    if len(e) > 1:
        same_g = (gid[1:] == gid[:-1]) & (per[1:] == per[:-1])
        dt = sec[1:] - sec[:-1]
        # rebound: this shot on goal, the next event an attempt by the same team within REBOUND_S
        nxt_same[:-1] = (same_g & (typ[:-1] == "shot-on-goal") & is_att[1:] & ~pen_shot[:-1]
                         & (shoot_team[1:] == shoot_team[:-1]) & (dt <= REBOUND_S) & (dt >= 0))
        # rush: the previous event within RUSH_S seconds in the shooting team's neutral / defensive zone
        pz = zone[:-1]
        mine = owner[:-1] == shoot_team[1:]
        flip = {"O": "D", "D": "O", "N": "N"}
        pz_own = np.array([z if m else flip.get(z, None) if z is not None else None for z, m in zip(pz, mine)],
                          dtype=object)
        prev_rush[1:] = same_g & is_att[1:] & (dt <= RUSH_S) & (dt >= 0) & np.isin(pz_own, ["N", "D"])

    side = lineups[["game_id", "player_id", "is_home"]].drop_duplicates(["game_id", "player_id"])
    parts = []

    def add(rows, pids, cmap, vals):
        """rows: event positions; pids: player ids; cmap: state -> column name (None: dropped)."""
        pids = pd.to_numeric(pd.Series(np.asarray(pids, dtype=object)), errors="coerce").to_numpy()
        ok = np.isfinite(pids.astype(float))
        rows, pids, vals = np.asarray(rows)[ok], pids[ok].astype(np.int64), np.asarray(vals, float)[ok]
        if not len(rows):
            return
        df = pd.DataFrame({"game_id": gid[rows].astype(np.int64), "player_id": pids, "k": rows, "v": vals})
        df = df.merge(side, on=["game_id", "player_id"], how="inner")
        k = df["k"].to_numpy()
        h = df["is_home"].to_numpy(bool)
        own = np.where(h, hs[k], as_[k])
        opp = np.where(h, as_[k], hs[k])
        st = _state(own, opp, both_g[k])
        df["col"] = pd.Series(st).map(cmap).to_numpy()
        df = df[df["col"].notna()]
        parts.append(df[["game_id", "player_id", "col", "v"]])

    idx = np.arange(len(e))
    col = lambda ev=None, pp=None, pk=None: {"ev": ev, "pp": pp, "pk": pk}  # noqa: E731
    gm = (typ == "goal") & ~pen_shot
    add(idx[gm], e.loc[gm, "scorer_id"], col("g_ev", "g_pp"), np.ones(gm.sum()))
    add(idx[gm], e.loc[gm, "assist1_id"], col("a1_ev", "a1_pp"), np.ones(gm.sum()))
    add(idx[gm], e.loc[gm, "assist2_id"], col("a2_ev", "a2_pp"), np.ones(gm.sum()))
    un = np.isin(typ, ("goal", "shot-on-goal", "missed-shot")) & ~pen_shot
    shooter = e["shooter_id"].where(e["shooter_id"].notna(), e["scorer_id"])
    eid = e["event_id"].to_numpy()
    xs = np.array([xmap.get((int(gid[k]), int(eid[k])), 0.0) for k in idx[un]])
    add(idx[un], shooter[un], col("ixg_ev", "ixg_pp"), xs)
    add(idx[un], shooter[un], col("iff_ev", "iff_pp"), np.ones(un.sum()))
    add(idx[is_att], shooter[is_att], col("icf_ev"), np.ones(is_att.sum()))
    add(idx[nxt_same], shooter[nxt_same], col("reb_ev"), np.ones(nxt_same.sum()))
    add(idx[prev_rush], shooter[prev_rush], col("rush_ev"), np.ones(prev_rush.sum()))
    bm = typ == "blocked-shot"
    add(idx[bm], e.loc[bm, "blocker_id"], col("blk_ev", None, "blk_pk"), np.ones(bm.sum()))
    tm = typ == "takeaway"
    add(idx[tm], e.loc[tm, "player_id"], col("tk_ev", None, "tk_pk"), np.ones(tm.sum()))
    gv = typ == "giveaway"
    add(idx[gv], e.loc[gv, "player_id"], col("gv_ev"), np.ones(gv.sum()))
    hm = typ == "hit"
    add(idx[hm], e.loc[hm, "hitter_id"], col("hit_ev"), np.ones(hm.sum()))
    fm = typ == "faceoff"
    add(idx[fm], e.loc[fm, "fo_winner_id"], col("fow_ev"), np.ones(fm.sum()))
    add(idx[fm], e.loc[fm, "fo_loser_id"], col("fol_ev"), np.ones(fm.sum()))
    # penalties: every situation (the state map sends all four states to one column)
    pm = typ == "penalty"
    units = penalty_units(e.loc[pm, "pen_desc_key"], e.loc[pm, "pen_duration"])
    allc = {"ev": None, "pp": None, "pk": None, "other": None}
    add(idx[pm], e.loc[pm, "pen_committed_by_id"], dict(allc, ev="pt_all", pp="pt_all", pk="pt_all", other="pt_all"), units)
    add(idx[pm], e.loc[pm, "pen_drawn_by_id"], dict(allc, ev="pd_all", pp="pd_all", pk="pd_all", other="pd_all"), units)

    r = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=["game_id", "player_id", "col", "v"])
    if len(r):
        c = r.pivot_table(index=["game_id", "player_id"], columns="col", values="v", aggfunc="sum", fill_value=0.0)
    else:
        c = pd.DataFrame(index=pd.MultiIndex.from_tuples([], names=["game_id", "player_id"]))
    c = c.reindex(columns=COUNT_COLS, fill_value=0.0).reset_index()
    t = toi[["game_id", "d", "player_id"] + SEC_COLS]
    out = t.merge(c, on=["game_id", "player_id"], how="left")
    out[COUNT_COLS] = out[COUNT_COLS].fillna(0.0)
    return out[["game_id", "d", "player_id"] + SEC_COLS + COUNT_COLS].reset_index(drop=True)


def pp_goal_value(events: pd.DataFrame, games: set | None = None) -> dict:
    """League net power-play goals per penalty unit of a season: (PP goals - shorthanded goals, both
    goalies in) / penalty units taken (``penalty_units``)."""
    e = events if games is None else events[events["game_id"].isin(games)]
    e = e[(e["period_type"].astype(str) != "SO")]
    g = e[(e["type_desc"] == "goal") & ~e["is_penalty_shot"].astype("boolean").fillna(False)
          & (e["sit_home_g"] == 1) & (e["sit_away_g"] == 1)]
    home = g["event_team_id"].to_numpy() == g["home_team_id"].to_numpy() if "home_team_id" in g.columns else \
        g["event_team_is_home"].astype("boolean").fillna(False).to_numpy()
    own = np.where(home, g["sit_home_sk"], g["sit_away_sk"])
    opp = np.where(home, g["sit_away_sk"], g["sit_home_sk"])
    ppg = float(np.sum(own > opp))
    shg = float(np.sum(own < opp))
    p = e[e["type_desc"] == "penalty"]
    units = float(penalty_units(p["pen_desc_key"], p["pen_duration"]).sum())
    return {"ppg": ppg, "shg": shg, "units": units, "value": (ppg - shg) / units if units > 0 else 0.0}


def build_season(lake, season: str, toi: pd.DataFrame, xg: pd.DataFrame | None) -> tuple[pd.DataFrame, dict]:
    """(player-game counts, pp_goal_value) of one lake season."""
    from bu.lake.build import read_table
    ev = read_table(lake, "events", [season])
    lu = read_table(lake, "lineups", [season], columns=["game_id", "player_id", "is_home"])
    pg = player_game_counts(ev, lu, xg, toi)
    return pg, pp_goal_value(ev, set(toi["game_id"].unique()))


def cache_path(root: str, season: str) -> str:
    return os.path.join(root, "v4", f"box_season={season}.parquet")


def load_season(paths, season: str, toi: pd.DataFrame, source: str, rebuild: bool = False, log=print):
    """Cached ``build_season`` under ``<state>/v4`` (keyed on the xG source and ``BOX_VERSION``)."""
    import json
    p = cache_path(paths.root, season)
    meta_p = p.replace(".parquet", ".json")
    if not rebuild and os.path.exists(p) and os.path.exists(meta_p):
        with open(meta_p) as f:
            m = json.load(f)
        if m.get("source") == str(source) and m.get("version") == BOX_VERSION:
            return pd.read_parquet(p), m["pp_goal_value"]
    from .data import ensure_xg
    xg = ensure_xg(paths, season, source)
    pg, pv = build_season(paths.lake, season, toi, xg[["game_id", "event_id", "xg"]] if xg is not None else None)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    pg.to_parquet(p + ".tmp", index=False)
    os.replace(p + ".tmp", p)
    with open(meta_p, "w") as f:
        json.dump({"source": str(source), "version": BOX_VERSION, "pp_goal_value": pv}, f)
    log(f"  [box] {season}: {len(pg):,} player-games, PP goal value {pv['value']:.3f} per unit")
    return pg, pv
