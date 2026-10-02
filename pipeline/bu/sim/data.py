"""Fit-time extraction from the lake and the RAPM stints cache (read-only).

Nothing here runs when serving.  Sources:

* the lake (``bu.lake.paths.Lake``: ``PONYXG_LAKE_DIR`` or ``data/lake``): games, events
  (penalties, goals by period, empty-net goals);
* the RAPM v2 stints cache (``bu.rapm.paths.RapmPaths``: ``PONYXG_RAPM_DIR`` or
  ``<lake>/state/rapm``): every stint of every game with skater / goalie counts, the score,
  and per-side xG (the walk-forward xG v2 target, ``python -m bu.rapm stints --xg ...``) and goals.

A "state" below is seen from the attacking team: (own skaters, opposing skaters, own goalie in,
opposing goalie in), e.g. (5, 4, 1, 1) a power play, (6, 5, 0, 1) an extra attacker,
(5, 6, 1, 0) shooting at an empty net.
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

from bu.lake.build import read_table
from bu.lake.paths import Lake
from bu.rapm.paths import RapmPaths

STINT_COLS = ["game_id", "season", "game_date", "game_type", "period", "start_s", "end_s", "dur",
              "home_team_id", "away_team_id", "n_home_sk", "n_away_sk", "n_home_g", "n_away_g",
              "home_goalie_id", "away_goalie_id", "home_diff", "xg_home", "xg_away", "g_home", "g_away",
              "game_onice_match"]
MIN_ONICE_MATCH = 0.9          # the RAPM regression's own exclusion rule (stints.py)
# Game segments of the score-effect table: P1, P2, P3 0-10 min, P3 10-18 min, P3 last 2 min
SEG_BOUNDS_P3 = (600, 1080)
SEG_SECONDS = (1200.0, 1200.0, 600.0, 480.0, 120.0)


def segment(period, period_s):
    """Score-effect segment (0..4) of a regulation moment (numpy arrays or scalars)."""
    period = np.asarray(period)
    s = np.asarray(period_s)
    p3 = 2 + (s >= SEG_BOUNDS_P3[0]).astype(int) + (s >= SEG_BOUNDS_P3[1]).astype(int)
    return np.where(period >= 3, p3, np.clip(period - 1, 0, 1))
NO_STRENGTH_PEN = ("misconduct", "game-misconduct", "match-penalty", "instigator-misconduct",
                   "abuse-of-officials-misconduct")


def lake() -> Lake:
    return Lake()


def rapm_paths() -> RapmPaths:
    return RapmPaths(lake())


def stints(season: str) -> pd.DataFrame:
    p = rapm_paths().stints(season)
    if not os.path.exists(p):
        raise SystemExit(f"no stints cache for {season} at {p}: set PONYXG_RAPM_DIR "
                         "(python -m bu.rapm stints --xg <xG v2 source>)")
    d = pd.read_parquet(p, columns=STINT_COLS)
    return d[d["game_type"].isin([2, 3])].reset_index(drop=True)


def stints_long(st: pd.DataFrame) -> pd.DataFrame:
    """Two rows per stint, one per attacking team (team / opp ids, own state, score diff)."""
    common = ["game_id", "season", "game_type", "period", "start_s", "end_s", "dur", "game_onice_match"]
    h = st[common].copy()
    h["team_id"], h["opp_id"], h["is_home"] = st["home_team_id"].to_numpy(), st["away_team_id"].to_numpy(), True
    h["sk"], h["osk"], h["g"], h["og"] = st["n_home_sk"], st["n_away_sk"], st["n_home_g"], st["n_away_g"]
    h["diff"] = st["home_diff"]
    h["xg"], h["gf"] = st["xg_home"], st["g_home"]
    h["xga"], h["ga"] = st["xg_away"], st["g_away"]
    h["opp_goalie"] = st["away_goalie_id"]
    a = st[common].copy()
    a["team_id"], a["opp_id"], a["is_home"] = st["away_team_id"].to_numpy(), st["home_team_id"].to_numpy(), False
    a["sk"], a["osk"], a["g"], a["og"] = st["n_away_sk"], st["n_home_sk"], st["n_away_g"], st["n_home_g"]
    a["diff"] = -st["home_diff"]
    a["xg"], a["gf"] = st["xg_away"], st["g_away"]
    a["xga"], a["ga"] = st["xg_home"], st["g_home"]
    a["opp_goalie"] = st["home_goalie_id"]
    out = pd.concat([h, a], ignore_index=True)
    for c in ("sk", "osk", "g", "og", "diff", "period", "dur", "gf", "ga"):
        out[c] = out[c].astype("int64")
    return out


def state_key(sk, osk, g, og) -> pd.Series:
    return (pd.Series(sk).astype(str) + "v" + pd.Series(osk).astype(str) + "_"
            + pd.Series(g).astype(str) + pd.Series(og).astype(str))


def games(season: str) -> pd.DataFrame:
    g = read_table(lake(), "games", [season])
    g = g[pd.to_numeric(g["game_type"], errors="coerce").isin([2, 3])].copy()
    g["game_type"] = g["game_type"].astype(int)
    return g.reset_index(drop=True)


def outcomes(season: str) -> pd.DataFrame:
    """One row per final game: official score (a shootout winner gets the deciding goal), the
    decision, regulation / 1st-period goals per side, OT goal side, empty-net goals per side."""
    g = games(season)
    ev = read_table(lake(), "events", [season],
                    columns=["game_id", "period", "type_desc", "event_team_is_home", "empty_net_against",
                             "is_shootout"])
    gl = ev[(ev["type_desc"] == "goal") & ~ev["is_shootout"].astype("boolean").fillna(False)].copy()
    gl["home"] = gl["event_team_is_home"].astype("boolean").fillna(False).astype(bool)
    gl["en"] = gl["empty_net_against"].astype("boolean").fillna(False).astype(bool)
    agg = {}
    for name, mask in (("p1", gl["period"] == 1), ("p2", gl["period"] == 2), ("p3", gl["period"] == 3),
                       ("reg", gl["period"] <= 3), ("ot", gl["period"] >= 4), ("en", gl["en"])):
        sub = gl[mask]
        agg[f"{name}_h"] = sub[sub["home"]].groupby("game_id").size()
        agg[f"{name}_a"] = sub[~sub["home"]].groupby("game_id").size()
    a = pd.DataFrame(agg).fillna(0).astype(int)
    out = g[["game_id", "season", "game_type", "game_date", "home_team_id", "away_team_id", "home_abbrev",
             "away_abbrev", "home_score", "away_score", "last_period_type"]].merge(
        a, left_on="game_id", right_index=True, how="left")
    for c in a.columns:
        out[c] = out[c].fillna(0).astype(int)
    out["decision"] = out["last_period_type"].fillna("REG").replace({"": "REG"})
    out = out[out["home_score"].notna() & out["away_score"].notna()].copy()
    out["home_score"] = out["home_score"].astype(int)
    out["away_score"] = out["away_score"].astype(int)
    out["home_win"] = out["home_score"] > out["away_score"]
    return out.reset_index(drop=True)


def starters(st: pd.DataFrame) -> pd.DataFrame:
    """Starting goalie per (game, side): the goalie in net in the game's first stint."""
    f = st[st["period"] == 1].sort_values(["game_id", "start_s"]).groupby("game_id").first()
    return pd.DataFrame({"game_id": f.index, "home_goalie": f["home_goalie_id"].to_numpy(),
                         "away_goalie": f["away_goalie_id"].to_numpy()})


def team_games(st: pd.DataFrame, pen: pd.DataFrame, se: dict) -> pd.DataFrame:
    """One row per (game, team): the per-game counts and exposures the team / goalie state and
    the rate regressions use.  ``se``: score-effect table {(segment, diff clipped +-3): mult} for
    the score-adjusted 5v5 exposure (``ev_adj``: sum of seconds x multiplier of the attacking
    team's score state; ``ev_adj_a``: the same for the opponent's attack).

    Columns: ev_s, ev_adj, ev_adj_a, ev_xg, ev_gf, ev_xga, ev_ga (5v5, both goalies in,
    regulation); pp_s, pp_xg, pp_gf, pk_s, pk_xga, pk_ga (more / fewer skaters, both goalies
    in, regulation); xg_vg, gf_vg (all strengths, opposing goalie in net: finishing);
    xga_og, ga_og (own goalie in net); pen_taken, pen_drawn (power-play-creating calls);
    game_s (seconds played); goalie / opp_goalie (starters)."""
    lo = stints_long(st)
    lo["dc"] = lo["diff"].clip(-3, 3)
    reg = lo["period"] <= 3
    both = (lo["g"] == 1) & (lo["og"] == 1)
    ev = reg & both & (lo["sk"] == 5) & (lo["osk"] == 5)
    tab = np.array([[se.get((g, d), 1.0) for d in range(-3, 4)] for g in range(5)])
    pi = segment(lo["period"].clip(1, 3).to_numpy(), lo["start_s"].to_numpy())
    di = lo["dc"].to_numpy()
    mult, mult_a = tab[pi, di + 3], tab[pi, 3 - di]
    dur = lo["dur"].to_numpy(dtype=float)
    f = pd.DataFrame({"game_id": lo["game_id"], "team_id": lo["team_id"]})
    pp = reg & both & (lo["sk"] > lo["osk"])
    pk = reg & both & (lo["sk"] < lo["osk"])
    cols = {
        "ev_s": np.where(ev, dur, 0.0), "ev_adj": np.where(ev, dur * mult, 0.0),
        "ev_adj_a": np.where(ev, dur * mult_a, 0.0),
        "ev_xg": np.where(ev, lo["xg"], 0.0), "ev_gf": np.where(ev, lo["gf"], 0),
        "ev_xga": np.where(ev, lo["xga"], 0.0), "ev_ga": np.where(ev, lo["ga"], 0),
        "pp_s": np.where(pp, dur, 0.0), "pp_xg": np.where(pp, lo["xg"], 0.0), "pp_gf": np.where(pp, lo["gf"], 0),
        "pk_s": np.where(pk, dur, 0.0), "pk_xga": np.where(pk, lo["xga"], 0.0), "pk_ga": np.where(pk, lo["ga"], 0),
        "xg_vg": np.where(lo["og"] == 1, lo["xg"], 0.0), "gf_vg": np.where(lo["og"] == 1, lo["gf"], 0),
        "xga_og": np.where(lo["g"] == 1, lo["xga"], 0.0), "ga_og": np.where(lo["g"] == 1, lo["ga"], 0),
        "game_s": dur,
    }
    for k, v in cols.items():
        f[k] = v
    out = f.groupby(["game_id", "team_id"], sort=False).sum().reset_index()
    meta = lo.groupby(["game_id", "team_id"], sort=False).agg(
        opp_id=("opp_id", "first"), is_home=("is_home", "first"), season=("season", "first"),
        game_type=("game_type", "first")).reset_index()
    out = out.merge(meta, on=["game_id", "team_id"])
    s0 = starters(st)
    out = out.merge(s0, on="game_id", how="left")
    out["goalie"] = np.where(out["is_home"], out["home_goalie"], out["away_goalie"])
    out["opp_goalie"] = np.where(out["is_home"], out["away_goalie"], out["home_goalie"])
    out = out.drop(columns=["home_goalie", "away_goalie"])
    pt = pen[pen["kind"] != "c44"].groupby(["game_id", "team_id"]).size().rename("pen_taken")
    out = out.merge(pt, left_on=["game_id", "team_id"], right_index=True, how="left")
    out["pen_taken"] = out["pen_taken"].fillna(0).astype(int)
    drawn = out[["game_id", "team_id", "pen_taken"]].rename(columns={"team_id": "opp_id", "pen_taken": "pen_drawn"})
    out = out.merge(drawn, on=["game_id", "opp_id"], how="left")
    out["pen_drawn"] = out["pen_drawn"].fillna(0).astype(int)
    d = st.groupby("game_id")["game_date"].first()
    out["game_date"] = pd.to_datetime(out["game_id"].map(d))
    return out.sort_values(["game_date", "game_id", "is_home"]).reset_index(drop=True)


def penalties(season: str) -> pd.DataFrame:
    """Strength-changing penalty events: one row per (game, second, team, kind).

    Per stoppage (game, game second) each team's minors (2), double minors (4) and majors (5)
    are offset against the other team's of the same length (misconducts, penalty shots and
    zero-minute calls never change strength).  A single coincidental minor each at 5v5 is the
    4v4 rule (kind ``c44``, team = home).  What is left is a power-play-creating penalty taken
    by ``team_id``: ``minor`` / ``double`` / ``major``.  ``diff`` is the score from the taking
    team's view, ``state5`` whether the call came at 5v5 with both goalies in."""
    ev = read_table(lake(), "events", [season],
                    columns=["game_id", "period", "game_seconds", "period_seconds", "type_desc", "event_team_id",
                             "event_team_is_home", "pen_desc_key", "pen_duration", "home_score", "away_score",
                             "sit_home_sk", "sit_away_sk", "sit_home_g", "sit_away_g"])
    p = ev[ev["type_desc"] == "penalty"].copy()
    p["dur"] = pd.to_numeric(p["pen_duration"], errors="coerce").fillna(0).astype(int)
    key = p["pen_desc_key"].fillna("").astype(str)
    p = p[p["dur"].isin([2, 4, 5]) & ~key.str.startswith("ps-") & ~key.isin(NO_STRENGTH_PEN)]
    p["home"] = p["event_team_is_home"].astype("boolean").fillna(False).astype(bool)
    rows = []
    for (gid, t), grp in p.groupby(["game_id", "game_seconds"], sort=False):
        cnt = {(h, d): 0 for h in (True, False) for d in (2, 4, 5)}
        for h, d in zip(grp["home"], grp["dur"]):
            cnt[(h, d)] += 1
        r0 = grp.iloc[0]
        sit = [r0[c] for c in ("sit_home_sk", "sit_away_sk", "sit_home_g", "sit_away_g")]
        five = all(pd.notna(v) for v in sit) and [int(v) for v in sit] == [5, 5, 1, 1]
        tid = {True: None, False: None}
        for h, team in zip(grp["home"], grp["event_team_id"]):
            tid[h] = team
        only_single_minors = (cnt[(True, 2)] == 1 and cnt[(False, 2)] == 1 and cnt[(True, 4)] == cnt[(False, 4)]
                              and cnt[(True, 5)] == cnt[(False, 5)])
        hs, as_ = r0["home_score"], r0["away_score"]
        if only_single_minors and five:
            rows.append((gid, t, r0["period"], r0["period_seconds"], tid[True], True, "c44", int(hs - as_), five))
            continue
        for d, kind in ((2, "minor"), (4, "double"), (5, "major")):
            k = min(cnt[(True, d)], cnt[(False, d)])
            for h in (True, False):
                for _ in range(cnt[(h, d)] - k):
                    diff = int(hs - as_) if h else int(as_ - hs)
                    rows.append((gid, t, r0["period"], r0["period_seconds"], tid[h], h, kind, diff, five))
    return pd.DataFrame(rows, columns=["game_id", "game_seconds", "period", "period_seconds", "team_id", "is_home",
                                       "kind", "diff", "state5"])
