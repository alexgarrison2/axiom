"""Lineup term: tonight's 18 skaters x expected TOI x point-in-time RAPM v2 (DESIGN §3.7).

For every game in the lake (types 02/03), in date order:

* ratings = RAPM v2 state as of the game date (``bu.rapm.asof``: games up to d - LAG_DAYS);
  a dressed skater with no EV time yet this season takes his carried posterior from the
  previous season, else the season's rookie mean for his position group;
* shares = expected EV TOI shares (``toi.ShareState``, games up to d - LAG_DAYS),
  renormalised so forwards sum to 3 and defencemen to 2;
* team 5v5 rates (xG/60), with the fitted intercept and home term at that date:

    xGF60_home = c0 + c_home + sum_home s_i o_i + sum_away s_j d_j
    xGA60_home = c0          + sum_away s_j o_j + sum_home s_i d_i

* baseline-relative lineup delta (absences, call-ups): Qnet(tonight) minus the mean Qnet of
  the team's last ``BASELINE_GAMES`` dressed lineups, both with tonight's ratings and shares,
  so the team's usual lineup is exactly neutral (the ``lineup_adjust.py`` convention).

Lineups are L-actual (the dressed 18 from the game's own rosterSpots / boxscore, DESIGN §4.2):
valid for model-vs-incumbent comparisons (Gate A), not against market prices.

Columns (home minus away where prefixed ``bu_d_``):
  bu_h_off, bu_h_def, bu_a_off, bu_a_def    sum of share x rating (xG/60; def > 0 = worse)
  bu_h_net, bu_a_net, bu_d_net              off - def
  bu_h_xgf60, bu_h_xga60, bu_a_xgf60, bu_a_xga60, bu_h_xgpct, bu_a_xgpct, bu_d_xgpct
  bu_h_delta, bu_a_delta, bu_d_delta        vs the team's last 10 lineups
  bu_h_n, bu_a_n, bu_h_rated, bu_a_rated    dressed skaters / with an NHL rating
  bu_ok                                     both sides >= MIN_RATED rated skaters
  ratings_asof, max_source_date             leakage audit: max_source_date <= date - lag
"""
from __future__ import annotations

import json
import os
from collections import defaultdict, deque

import numpy as np
import pandas as pd

from bu.lake.build import read_table
from bu.rapm.asof import load_covs, load_ratings
from bu.rapm.engine import LAG_DAYS
from bu.rapm.stints import MIN_GAME_ONICE_MATCH  # noqa: F401  (re-exported for docs)
from .toi import ShareState, game_shares, lag_cutoff, lineup_shares

BASELINE_GAMES = 10
MIN_BASELINE = 3
MIN_RATED = 14          # of 18 (DESIGN §3.7 coverage gate)


def _group(pos) -> str:
    return "D" if pos == "D" else "F"


def build(paths, seasons: list[str], log=print) -> pd.DataFrame:
    lake = paths.lake
    games = read_table(lake, "games", seasons, columns=["game_id", "season", "game_date", "game_type",
                                                        "home_team_id", "away_team_id", "home_abbrev",
                                                        "away_abbrev"])
    games = games[games["game_type"].isin([2, 3])].copy()
    games["d"] = pd.to_datetime(games["game_date"]).values.astype("datetime64[D]")
    games = games.sort_values(["d", "game_id"]).reset_index(drop=True)
    lu = read_table(lake, "lineups", seasons, columns=["game_id", "team_id", "player_id", "position", "is_goalie",
                                                      "status"])
    lu = lu[(lu["status"] == "dressed") & ~lu["is_goalie"].astype("boolean").fillna(False)]
    lineups = {(int(g), int(t)): (sub["player_id"].astype(int).tolist(), [_group(p) for p in sub["position"]])
               for (g, t), sub in lu.groupby(["game_id", "team_id"])}
    pos_group = {int(p): _group(x) for p, x in zip(lu["player_id"], lu["position"])}

    from bu.rapm.data import ensure_stints
    shares = []
    for s in seasons:
        sh = game_shares(ensure_stints(paths, s))
        sh["season"] = s
        shares.append(sh)
    shares = pd.concat(shares, ignore_index=True).merge(games[["game_id", "d"]], on="game_id")
    shares = shares.sort_values(["d", "game_id"]).reset_index(drop=True)
    sh_d = shares["d"].to_numpy()
    actual = {(int(g), int(p)): float(x) for g, p, x in zip(shares["game_id"], shares["player_id"], shares["share"])}
    toi_err = []   # (season, |ewma - actual|, |last - actual|) per dressed skater with an actual share

    ratings = load_ratings(paths, seasons)
    covs = load_covs(paths, seasons)
    covs["asof"] = pd.to_datetime(covs["asof"]).values.astype("datetime64[D]")
    cov_by = {(s, a): (c0, ch) for s, a, c0, ch in zip(covs["season"], covs["asof"], covs["intercept"], covs["home"])}
    ratings["asof"] = pd.to_datetime(ratings["asof"]).values.astype("datetime64[D]")
    r_groups = {k: v for k, v in ratings.groupby(["season", "asof"])}
    fallback: dict[str, dict] = {}
    rookie: dict[str, dict] = {}
    summ_path = paths.report("asof_summary.json")
    summ = json.load(open(summ_path)) if os.path.exists(summ_path) else {"seasons": {}}
    for i, s in enumerate(seasons):
        prev = seasons[i - 1] if i else None
        fb = {}
        if prev and os.path.exists(paths.posterior(prev)):
            post = pd.read_parquet(paths.posterior(prev))
            fb = {int(p): (o, d) for p, o, d in zip(post["player_id"], post["o"], post["d"])}
        fallback[s] = fb
        rm = (summ["seasons"].get(s) or {}).get("rookie", {}).get("means", {})
        rookie[s] = {g: (rm.get(f"{g}|all|o", 0.0), rm.get(f"{g}|all|d", 0.0)) for g in ("F", "D")}

    state = ShareState()
    sh_ptr = 0
    history: dict[int, deque] = defaultdict(lambda: deque(maxlen=BASELINE_GAMES))
    cache_key, rmap = None, {}
    out = []
    for d, day in games.groupby("d", sort=True):
        cut = lag_cutoff(d)
        hi = int(np.searchsorted(sh_d, cut, side="right"))
        if hi > sh_ptr:
            chunk = shares.iloc[sh_ptr:hi]
            for s, sub in chunk.groupby("season", sort=False):
                state.apply(sub, pos_group, s)
            sh_ptr = hi
        for _, g in day.iterrows():
            S = g["season"]
            if cache_key != (S, d):
                rg = r_groups.get((S, d))
                rmap = {} if rg is None else {
                    int(p): (o, dd, bool((not nw) or toi > 0))
                    for p, o, dd, nw, toi in zip(rg["player_id"], rg["o"], rg["d"], rg["is_new"], rg["ev_toi_s"])}
                src = None if rg is None or rg["max_source_date"].isna().all() else rg["max_source_date"].max()
                cache_key = (S, d)

            def rate(pids, groups):
                o, df, rated = [], [], 0
                for p, grp in zip(pids, groups):
                    if p in rmap:
                        a, b, r = rmap[p]
                    elif p in fallback[S]:
                        (a, b), r = fallback[S][p], True
                    else:
                        (a, b), r = rookie[S].get(grp, (0.0, 0.0)), False
                    o.append(a); df.append(b); rated += int(r)  # noqa: E702
                return np.array(o), np.array(df), rated

            row = {"game_id": int(g["game_id"]), "season": S, "game_date": str(g["game_date"]),
                   "game_type": int(g["game_type"]), "home_team_id": int(g["home_team_id"]),
                   "away_team_id": int(g["away_team_id"]), "home_abbrev": g["home_abbrev"],
                   "away_abbrev": g["away_abbrev"], "ratings_asof": str(d),
                   "max_source_date": None if src is None else str(pd.Timestamp(src).date())}
            ok = True
            for side, tid in (("h", int(g["home_team_id"])), ("a", int(g["away_team_id"]))):
                pids, groups = lineups.get((int(g["game_id"]), tid), ([], []))
                if len(pids) < 10:
                    ok = False
                    row.update({f"bu_{side}_off": np.nan, f"bu_{side}_def": np.nan, f"bu_{side}_n": len(pids),
                                f"bu_{side}_rated": 0, f"bu_{side}_delta": np.nan})
                    continue
                s_ = lineup_shares(state, pids, groups)
                s_last = lineup_shares(state, pids, groups, method="last")
                for p_, e_, l_ in zip(pids, s_, s_last):
                    a_ = actual.get((int(g["game_id"]), int(p_)))
                    if a_ is not None:
                        toi_err.append((S, abs(e_ - a_), abs(l_ - a_)))
                o, df, rated = rate(pids, groups)
                row[f"bu_{side}_off"] = float(s_ @ o)
                row[f"bu_{side}_def"] = float(s_ @ df)
                row[f"bu_{side}_n"] = len(pids)
                row[f"bu_{side}_rated"] = rated
                past = []
                for ppids, pgroups in history[tid]:
                    ps = lineup_shares(state, ppids, pgroups)
                    po, pdf, _ = rate(ppids, pgroups)
                    past.append(float(ps @ (po - pdf)))
                net = row[f"bu_{side}_off"] - row[f"bu_{side}_def"]
                row[f"bu_{side}_delta"] = net - float(np.mean(past)) if len(past) >= MIN_BASELINE else 0.0
                ok = ok and rated >= MIN_RATED
            c0, ch = cov_by.get((S, d), (np.nan, np.nan))
            row["c_intercept"], row["c_home"] = c0, ch
            row["bu_ok"] = bool(ok)
            out.append(row)
        for _, g in day.iterrows():
            for tid in (int(g["home_team_id"]), int(g["away_team_id"])):
                lp = lineups.get((int(g["game_id"]), tid))
                if lp and len(lp[0]) >= 10:
                    history[tid].append(lp)
    F = pd.DataFrame(out)
    F["bu_h_net"] = F["bu_h_off"] - F["bu_h_def"]
    F["bu_a_net"] = F["bu_a_off"] - F["bu_a_def"]
    F["bu_d_net"] = F["bu_h_net"] - F["bu_a_net"]
    F["bu_h_xgf60"] = F["c_intercept"] + F["c_home"] + F["bu_h_off"] + F["bu_a_def"]
    F["bu_h_xga60"] = F["c_intercept"] + F["bu_a_off"] + F["bu_h_def"]
    F["bu_a_xgf60"] = F["bu_h_xga60"]
    F["bu_a_xga60"] = F["bu_h_xgf60"]
    F["bu_h_xgpct"] = F["bu_h_xgf60"] / (F["bu_h_xgf60"] + F["bu_h_xga60"])
    F["bu_a_xgpct"] = 1 - F["bu_h_xgpct"]
    F["bu_d_xgpct"] = F["bu_h_xgpct"] - F["bu_a_xgpct"]
    F["bu_d_delta"] = F["bu_h_delta"] - F["bu_a_delta"]
    F["lag_days"] = LAG_DAYS
    te = pd.DataFrame(toi_err, columns=["season", "ewma", "last"])
    F.attrs["toi_validation"] = {
        "metric": "MAE of expected EV TOI share (renormalised) vs actual, dressed skaters",
        "by_season": {s: {"n": int(len(x)), "ewma_mae": float(x["ewma"].mean()), "last_game_mae": float(x["last"].mean())}
                      for s, x in te.groupby("season")},
        "pooled": {"n": int(len(te)), "ewma_mae": float(te["ewma"].mean()), "last_game_mae": float(te["last"].mean())}}
    log(f"  [lineup] TOI share MAE {te['ewma'].mean():.4f} vs last-game {te['last'].mean():.4f}")
    log(f"  [lineup] {len(F):,} games, {F['bu_ok'].mean():.1%} with both sides >= {MIN_RATED} rated")
    return F


FEATURE_COLUMNS = ["bu_d_net", "bu_d_delta", "bu_d_xgpct"]
