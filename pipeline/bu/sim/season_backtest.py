"""Backtest of the season projections: simulator vs logit at as-of points (``prereg_season_sim.json``).

    cd pipeline     # PONYXG_LAKE_DIR, PONYXG_RAPM_DIR (stints caches for the EV TOI shares)
    python -m bu.sim.season_backtest dev --work W --ratings-dir R --st-dir T
    python -m bu.sim.season_backtest holdout --work W --ratings-dir R --st-dir T     # the single look

``--work``: the simulator's fit work dir (``team_games_<S>.parquet`` caches); ``--ratings-dir``: the
ratings v4 point-in-time state the lineup table was built from (``ratings/season=S.parquet``,
``fin_season=S``, ``cov_season=S``, ``prior_season=S``, ``reports/asof_summary.json``);
``--st-dir``: the player special-teams tables (``bu.sim.st_lineup``; only read when the live
parameters carry player special teams).

At each as-of date D: standings from the lake's regular-season games before D, the remaining
schedule = the lake's regular-season games on or after D, divisions / conferences from the NHL
standings of the season.  LOGIT: ``season_simulator.Probabilities`` with a walk-forward logit
(``train_game_model.fit_logit`` on the usable games of seasons < S, C by ``tune_C``) and
``MLPredictor(games = archive games before D)``.  SIM: ``bu.sim.season`` inputs as of D (team /
goalie state replayed through the lake's games before D, typical lineup of the last 10 dressed
games rated with the ratings as of D, goalie start shares of the last 20 games).  Both arms run
``season_simulator.Engine`` with 5,000 seasons and the same seed.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import pickle
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import data as D
from . import season as SE
from .params import load_params

HERE = os.path.dirname(os.path.abspath(__file__))
PREREG = os.path.join(HERE, "prereg_season_sim.json")
DEV = {"20232024": ["2023-11-01", "2024-01-01", "2024-03-01"], "20242025": ["2025-01-01", "2025-03-01"]}
HOLDOUT = {"20252026": ["2025-11-01", "2026-01-01", "2026-03-01"]}
N_SEASONS = 5000
MAE_MARGIN = 0.25
LL_MARGIN = 0.010
GUARD_SEASON = "20232024"


def log(*a):
    print(*a, flush=True)


# ------------------------------------------------------------------------------ standings

def nhl_divisions(season: str, work: str) -> dict:
    """{abbrev: (conference, division, clinch indicator)} from the NHL standings at the end of the
    season's regular season (cached in ``work``)."""
    p = os.path.join(work, f"nhl_standings_{season}.json")
    if not os.path.exists(p):
        from http_utils import get_json
        g = D.games(season)
        end = pd.to_datetime(g.loc[g["game_type"] == 2, "game_date"]).max().strftime("%Y-%m-%d")
        tab = get_json(f"https://api-web.nhle.com/v1/standings/{end}", ua="plain")["standings"]
        with open(p, "w") as f:
            json.dump(tab, f)
    with open(p) as f:
        tab = json.load(f)
    return {t["teamAbbrev"]["default"]: (t.get("conferenceAbbrev"), t.get("divisionAbbrev"), t.get("clinchIndicator"))
            for t in tab}


def standings_from(out: pd.DataFrame, teams, divs: dict) -> dict:
    """Season standings ({abbrev: {pts, rw, row, w, l, otl, gp, conference, division}}) of the
    regular-season outcomes ``out``."""
    st = {t: {"pts": 0, "rw": 0, "row": 0, "w": 0, "l": 0, "otl": 0, "gp": 0,
              "conference": divs[t][0], "division": divs[t][1]} for t in teams}
    for r in out.itertuples(index=False):
        hw = r.home_score > r.away_score
        dec = str(r.decision)
        for t, win in ((r.home_abbrev, hw), (r.away_abbrev, not hw)):
            s = st[t]
            s["gp"] += 1
            if win:
                s["w"] += 1
                s["pts"] += 2
                s["row"] += int(dec != "SO")
                s["rw"] += int(dec == "REG")
            elif dec in ("OT", "SO"):
                s["otl"] += 1
                s["pts"] += 1
            else:
                s["l"] += 1
    return st


def made_playoffs(final: dict) -> dict:
    """The bracket rule (season_simulator.Engine.playoff_field) on the actual final table."""
    from season_simulator import Engine
    eng = Engine(final, [], None, n_sims=1, seed=1, sigma0=0.0, playoff_date="2000-01-01")
    r = eng.run(playoffs=False)
    return {t: int(r["made"][i] > 0) for i, t in enumerate(eng.teams)}


# ------------------------------------------------------------------------------ LOGIT arm

def fold_model(S: str, work: str) -> tuple[str, str]:
    """Walk-forward logit for season S (train seasons < S): (model path, meta path) in ``work``."""
    y = int(S[:4])
    mp, jp = os.path.join(work, f"logit_fold_{y}.pkl"), os.path.join(work, f"logit_fold_{y}.json")
    if os.path.exists(mp) and os.path.exists(jp):
        return mp, jp
    import train_game_model as T
    mpath = os.path.join(work, "logit_matrix.pkl")
    if os.path.exists(mpath):
        M = pd.read_pickle(mpath)
    else:
        M, _ = T.build_matrix()
        M.to_pickle(mpath)
    cols, meta = T.live_feature_columns()
    usable = M[~M["burn_in"]]
    tr = usable[usable["season"] < y]
    C, _ = T.tune_C(tr, cols)
    m = T.fit_logit(tr, cols, C)
    betas, home = T.explain_coefficients(m, cols)
    meta = dict(meta)
    meta.update({"coefficients_raw": betas, "home_ice_logit": home, "C": C,
                 "training_seasons": sorted(int(s) for s in tr["season"].unique()),
                 "model_version": f"walk-forward-{y}"})
    with open(mp, "wb") as f:
        pickle.dump({"kind": "logit-v5", "model": m, "feature_columns": cols, "model_version": f"walk-forward-{y}"}, f)
    with open(jp, "w") as f:
        json.dump(meta, f, default=float)
    log(f"[season-bt] logit fold {y}: {len(tr)} games, C {C}")
    return mp, jp


def archive_games():
    import features as F
    pipe = os.path.dirname(os.path.dirname(HERE))
    games, _ = F.load_feature_games(pipe)
    return games


def logit_probs(S: str, Dt: str, work: str, games: pd.DataFrame, name_of: dict, live_model: bool = False):
    from ml_predict import MLPredictor
    from season_simulator import Probabilities
    if live_model:
        ml = MLPredictor(games=games[games["game_date"] < pd.Timestamp(Dt)])
    else:
        mp, jp = fold_model(S, work)
        ml = MLPredictor(games=games[games["game_date"] < pd.Timestamp(Dt)], model_path=mp, meta_path=jp)
    return Probabilities(name_of, ml=ml)


# ------------------------------------------------------------------------------ SIM arm

class LineupHistory:
    """EV TOI share state, team lineup histories and point-in-time ratings for as-of dates of one
    season (the ``bu.lineup.features.build`` replay, stopped at D)."""

    def __init__(self, S: str, ratings_dir: str, st_dir: str | None):
        from bu.lineup.features import lineup_tables
        from bu.lineup.serve import season_shares
        from bu.rapm.data import lake_seasons
        self.S = S
        lake = D.lake()
        allS = [s for s in lake_seasons(lake) if s <= S]
        seasons = allS[-3:]
        self.games, self.lineups, self.pos_group = lineup_tables(lake, seasons)
        self.shares = season_shares(D.rapm_paths(), seasons, self.games)
        rd = os.path.join(ratings_dir, "ratings")
        r = pd.read_parquet(os.path.join(rd, f"season={S}.parquet"))
        r["asof"] = pd.to_datetime(r["asof"]).values.astype("datetime64[D]")
        self.r = {a: sub for a, sub in r.groupby("asof")}
        f = pd.read_parquet(os.path.join(rd, f"fin_season={S}.parquet"))
        f["asof"] = pd.to_datetime(f["asof"]).values.astype("datetime64[D]")
        self.f = {a: sub for a, sub in f.groupby("asof")}
        c = pd.read_parquet(os.path.join(rd, f"cov_season={S}.parquet"))
        c["asof"] = pd.to_datetime(c["asof"]).values.astype("datetime64[D]")
        self.c0 = dict(zip(c["asof"], c["intercept"]))
        pr = pd.read_parquet(os.path.join(rd, f"prior_season={S}.parquet"))
        pr = pr[~pr["is_new"].astype(bool)]
        self.prior = {int(p): (o, d) for p, o, d in zip(pr["player_id"], pr["o"], pr["d"])}
        summ = json.load(open(os.path.join(ratings_dir, "reports", "asof_summary.json")))
        rm = (summ["seasons"].get(S) or {}).get("rookie", {}).get("means", {})
        self.rookie = {g: (rm.get(f"{g}|all|o", 0.0), rm.get(f"{g}|all|d", 0.0)) for g in ("F", "D")}
        self.st = None
        if st_dir:
            from .st_lineup import load_player_tables
            self.st = load_player_tables(st_dir, [S])

    def at(self, Dt: str):
        """(ShareState, {team_id: deque of past lineups}, rate fn, fin fn, c0, st (lookup, fb) or None)."""
        from bu.lineup.features import BASELINE_GAMES
        from bu.lineup.toi import ShareState, lag_cutoff
        d = np.datetime64(Dt, "D")
        state = ShareState()
        sh = self.shares[self.shares["d"] <= lag_cutoff(d)]
        for s, sub in sh.groupby("season", sort=True):
            state.apply(sub, self.pos_group, s)
        hist = defaultdict(lambda: deque(maxlen=BASELINE_GAMES))
        for g in self.games[self.games["d"] < d].itertuples(index=False):
            for tid in (int(g.home_team_id), int(g.away_team_id)):
                lp = self.lineups.get((int(g.game_id), tid))
                if lp and len(lp[0]) >= 10:
                    hist[tid].append(lp)
        keys = sorted(k for k in self.r if k <= d)
        a = keys[-1]
        rg = self.r[a]
        rmap = {int(p): (o, dd, bool((not nw) or toi > 0))
                for p, o, dd, nw, toi in zip(rg["player_id"], rg["o"], rg["d"], rg["is_new"], rg["ev_toi_s"])}

        def rate(pids, groups):
            o, df, rated = [], [], 0
            for p, grp in zip(pids, groups):
                if p in rmap:
                    x, y, rr = rmap[p]
                elif p in self.prior:
                    (x, y), rr = self.prior[p], True
                else:
                    (x, y), rr = self.rookie.get(grp, (0.0, 0.0)), False
                o.append(x); df.append(y); rated += int(rr)  # noqa: E702
            return np.array(o), np.array(df), rated
        fk = sorted(k for k in self.f if k <= d)
        fm = {} if not fk else {int(p): (x, y) for p, x, y in zip(self.f[fk[-1]]["player_id"], self.f[fk[-1]]["fin_f"],
                                                                    self.f[fk[-1]]["fin_d"])}

        def fin(pids, groups):
            return [fm.get(int(p), (0.0, 0.0))[1 if g == "D" else 0] for p, g in zip(pids, groups)]
        st = None
        if self.st is not None:
            tabs, dates = self.st
            ds = dates.get(self.S)
            k = int(np.searchsorted(ds, d, side="right")) - 1 if ds is not None and len(ds) else -1
            st = tabs[(self.S, ds[k])] if k >= 0 else None
        return state, hist, rate, fin, float(self.c0[a]), st


def state_snapshots(tg: pd.DataFrame, hyper: dict, dates: list) -> dict:
    """{as-of date: SimState of every team game before it} from one replay."""
    from .state import SimState
    want = sorted(pd.Timestamp(x) for x in dates)
    out, st = {}, SimState(hyper)
    for d, day in tg.groupby("game_date", sort=True):
        st.roll(str(day["season"].iloc[0]))
        while want and pd.Timestamp(d) >= want[0]:
            out[want.pop(0).strftime("%Y-%m-%d")] = st.copy()
        st.add_rows(day)
    for w in want:
        out[w.strftime("%Y-%m-%d")] = st.copy()
    return out


def sim_probs(S: str, Dt: str, schedule: list, state, tg: pd.DataFrame, lh: LineupHistory, ids: dict,
              params: dict, workers: int):
    from bu.lineup.features import side_term
    from .lineup_source import has_st
    from .state import team_key
    from .st_lineup import aggregate
    rest = SE.rest_days_by_game(schedule)
    share, hist, rate, fin, c0, st = lh.at(Dt)
    state.roll(S)
    league = {q: state.league_rate(q) for q in ("ev_goals", "ev_xg", "pp_goals", "pp_xg", "pen", "fin", "gsv")}
    before = tg[tg["game_date"] < pd.Timestamp(Dt)].sort_values(["game_date", "game_id"])
    starts = defaultdict(list)
    for t, g in zip(before["team_id"], before["goalie"]):
        starts[team_key(t)].append(None if pd.isna(g) else int(g))
    teams, detail = {}, {}
    use_st = has_st(params)
    for abbr, tid in ids.items():
        pids, groups = SE.typical_lineup(hist.get(tid, ()))
        side = None
        if len(pids) >= 10:
            side = side_term(share, pids, groups, rate, hist.get(tid, ()), fin=fin)
            if use_st and st is not None:
                side["st"] = aggregate(st[0], pids, groups, st[1])
        gsv = SE.goalie_gsv(starts.get(team_key(tid), []), lambda g: state.goalie_rel(g)[0])
        teams[abbr] = SE.team_inputs(state, tid, gsv, side, c0)
        detail[abbr] = {"n": len(pids), "gsv": round(gsv, 4), "off": round(float((side or {}).get("off", np.nan)), 4),
                        "def": round(float((side or {}).get("def", np.nan)), 4)}
    G = SE.game_rows(schedule, teams, league, rest)
    ok = SE.runnable(G)
    if not ok.all():
        log(f"[season-bt] {S} {Dt}: {int((~ok).sum())} games not runnable by the simulator")
    res = SE.simulate(G[ok].reset_index(drop=True), params, workers=workers)
    table = SE.build_table(schedule, G, res, rest)
    return SE.SimProbabilities(table, None, "game simulator", {"teams": detail}, schedule), int((~ok).sum())


# ------------------------------------------------------------------------------ scoring

def project(standings, schedule, probs, seed):
    from season_simulator import Engine
    eng = Engine(standings, schedule, probs, n_sims=N_SEASONS, seed=seed)
    r = eng.run(playoffs=False)
    out = {}
    for i, t in enumerate(eng.teams):
        dist = sorted(int(k) for k, c in r["point_dist"][i].items() for _ in range(c))
        out[t] = {"made": float(r["made"][i] / N_SEASONS), "pts": float(r["pts"][i] / N_SEASONS),
                  "p10": dist[int(0.1 * len(dist))], "p90": dist[int(0.9 * len(dist)) - 1]}
    return out


def team_rows(S, Dt, proj, final, made):
    rows = []
    for t, p in proj.items():
        pm = min(max(p["made"], 1e-3), 1 - 1e-3)
        y = made[t]
        rows.append({"season": S, "asof": Dt, "team": t, "pts_proj": p["pts"], "pts_final": final[t]["pts"],
                     "abs_err": abs(p["pts"] - final[t]["pts"]), "err": p["pts"] - final[t]["pts"],
                     "p_made": p["made"], "made": y, "ll": -math.log(pm if y else 1 - pm), "brier": (p["made"] - y) ** 2,
                     "cover80": float(p["p10"] <= final[t]["pts"] <= p["p90"])})
    return rows


def summarize(T: pd.DataFrame, arm_a: str = "SIM", arms=("LOGIT", "SIM", "LOGIT_live")) -> dict:
    """Per arm means and paired ``arm_a`` - LOGIT differences (SE clustered by team)."""
    out = {"n": int((T["arm"] == arm_a).sum())}
    for arm in arms:
        x = T[T["arm"] == arm]
        if len(x):
            out[arm] = {k: round(float(x[k].mean()), 4) for k in ("abs_err", "err", "ll", "brier", "cover80")}
    a = T[T["arm"] == arm_a].set_index(["season", "asof", "team"])
    b = T[T["arm"] == "LOGIT"].set_index(["season", "asof", "team"]).loc[a.index]
    for k, name in (("abs_err", "points_mae"), ("ll", "playoff_ll"), ("brier", "playoff_brier")):
        d = (a[k] - b[k]).reset_index()
        n, m = len(d), float(d[k].mean())
        g = d.groupby("team")[k].agg(["sum", "size"])
        # cluster-robust SE of the mean (a team's errors at several as-of points are correlated)
        se = float(np.sqrt(((g["sum"] - g["size"] * m) ** 2).sum()) / n) if len(g) > 1 else float("nan")
        out[f"{name}_{arm_a}_minus_LOGIT"] = {"diff": round(float(d[k].mean()), 4), "se_team_clustered": round(se, 4)}
    return out


def run(work, ratings_dir, st_dir, points: dict, workers: int, live_model: bool = True) -> pd.DataFrame:
    from .fit import ALL_SEASONS, build_team_games, se_dict
    params = load_params()
    from .lineup_source import has_st
    tg = build_team_games([s for s in ALL_SEASONS if s <= max(points)], se_dict(params["structural"]["score_effects"]),
                          work)
    snaps = state_snapshots(tg, params["state"]["hyper"], [d for ds in points.values() for d in ds])
    games = archive_games()
    rows = []
    for S, dates in points.items():
        divs = nhl_divisions(S, work)
        o = D.outcomes(S)
        o = o[o["game_type"] == 2]
        g = D.games(S)
        g = g[g["game_type"] == 2]
        g["date"] = pd.to_datetime(g["game_date"]).dt.strftime("%Y-%m-%d")
        teams = sorted(set(g["home_abbrev"]) | set(g["away_abbrev"]))
        ids = {a: int(t) for a, t in zip(g["home_abbrev"], g["home_team_id"])}
        miss = [t for t in teams if t not in divs]
        if miss:
            raise SystemExit(f"{S}: no NHL division for {miss}")
        final = standings_from(o, teams, divs)
        made = made_playoffs(final)
        api = {t: int(divs[t][2] not in (None, "e")) for t in teams}
        if api != made:
            log(f"[season-bt] {S}: bracket rule vs NHL clinch flags differ for "
                f"{[t for t in teams if api[t] != made[t]]} (scored against the NHL flags)")
            made = api
        # archive team names for the logit (by game id)
        arch = games[(games["home_away"] == "Home") & games["game_id"].isin(g["game_id"])]
        name_of = dict(zip(g.set_index("game_id").loc[arch["game_id"], "home_abbrev"], arch["team"]))
        lh = LineupHistory(S, ratings_dir, st_dir if has_st(params) else None)
        for k, Dt in enumerate(dates):
            t0 = time.time()
            seed = 20262027 + int(S[:4]) * 10 + k
            st_now = standings_from(o[pd.to_datetime(o["game_date"]) < pd.Timestamp(Dt)], teams, divs)
            rem = g[g["date"] >= Dt].sort_values(["date", "game_id"])
            sched = [{"id": int(r.game_id), "date": r.date, "home": r.home_abbrev, "away": r.away_abbrev}
                     for r in rem.itertuples(index=False)]
            arms = {}
            arms["LOGIT"] = logit_probs(S, Dt, work, games, name_of)
            if live_model:
                arms["LOGIT_live"] = logit_probs(S, Dt, work, games, name_of, live_model=True)
            sp, nbad = sim_probs(S, Dt, sched, snaps[Dt], tg, lh, ids, params, workers)
            arms["SIM"] = sp
            for arm, pr in arms.items():
                proj = project(st_now, sched, pr, seed)
                for r in team_rows(S, Dt, proj, final, made):
                    rows.append({"arm": arm, **r})
            log(f"[season-bt] {S} {Dt}: {len(sched)} remaining games, GP {sum(v['gp'] for v in st_now.values()) // 2}, "
                f"{time.time() - t0:.0f}s")
    return pd.DataFrame(rows)


def _looked() -> bool:
    from .validate import LOOK_LOG
    if not os.path.exists(LOOK_LOG):
        return False
    with open(LOOK_LOG) as f:
        return any(json.loads(l).get("question") == SE.QUESTION and json.loads(l).get("stage") != "started"
                   for l in f if l.strip())


def cmd_dev(a):
    from .validate import _report
    T = run(a.work, a.ratings_dir, a.st_dir, DEV, a.workers)
    T.to_csv(os.path.join(a.work, "season_bt_dev.csv"), index=False)
    s = {"pooled": summarize(T), **{S: summarize(T[T["season"] == S]) for S in DEV}}
    s["by_asof"] = {f"{S} {d}": summarize(T[(T["season"] == S) & (T["asof"] == d)]) for S, ds in DEV.items() for d in ds}
    p = s["pooled"]
    res = {"dev_mae_pass": bool(p["points_mae_SIM_minus_LOGIT"]["diff"] < 0),
           "dev_ll_pass": bool(p["playoff_ll_SIM_minus_LOGIT"]["diff"] <= 0),
           "guard_2023_pass": bool(s[GUARD_SEASON]["points_mae_SIM_minus_LOGIT"]["diff"] <= MAE_MARGIN)}
    payload = {"prereg": "bu/sim/prereg_season_sim.json", "points": DEV, "n_seasons_mc": N_SEASONS,
               "sim_version": load_params().get("version"), "scores": s, **res,
               "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    _report("season_sim_dev", payload)
    log(json.dumps({k: s[k] for k in ("pooled", *DEV)}, indent=1))
    log(f"[season-bt] dev: {res}")


def cmd_holdout(a):
    from .validate import LOOK_LOG, REPORT, _report
    rep = json.load(open(REPORT))
    if "season_sim_dev" not in rep:
        raise SystemExit("run `dev` first")
    if _looked():
        raise SystemExit(f"the holdout look for '{SE.QUESTION}' has already been made; one look only")
    dev = rep["season_sim_dev"]
    with open(LOOK_LOG, "a") as f:
        f.write(json.dumps({"season": "20252026", "question": SE.QUESTION, "stage": "started",
                            "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}) + "\n")
    T = run(a.work, a.ratings_dir, a.st_dir, HOLDOUT, a.workers)
    T.to_csv(os.path.join(a.work, "season_bt_holdout.csv"), index=False)
    s = {"20252026": summarize(T)}
    s["by_asof"] = {f"20252026 {d}": summarize(T[T["asof"] == d]) for d in HOLDOUT["20252026"]}
    h = s["20252026"]
    hold = {"holdout_mae_ok": bool(h["points_mae_SIM_minus_LOGIT"]["diff"] <= MAE_MARGIN),
            "holdout_ll_ok": bool(h["playoff_ll_SIM_minus_LOGIT"]["diff"] <= LL_MARGIN)}
    promote = bool(dev["dev_mae_pass"] and dev["dev_ll_pass"] and dev["guard_2023_pass"] and all(hold.values()))
    with open(LOOK_LOG, "a") as f:
        f.write(json.dumps({"season": "20252026", "question": SE.QUESTION,
                            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                            "sim_version": load_params().get("version"),
                            "points_mae_SIM_minus_LOGIT": h["points_mae_SIM_minus_LOGIT"],
                            "playoff_ll_SIM_minus_LOGIT": h["playoff_ll_SIM_minus_LOGIT"],
                            "promote_sim": promote}) + "\n")
    payload = {"prereg": "bu/sim/prereg_season_sim.json", "points": HOLDOUT, "n_seasons_mc": N_SEASONS,
               "sim_version": load_params().get("version"), "scores": s, **hold, "promote_sim": promote,
               "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    _report("season_sim_holdout", payload)
    log(json.dumps(s["20252026"], indent=1))
    log(f"[season-bt] holdout: {hold} -> promote SIM: {promote}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bu.sim.season_backtest")
    ap.add_argument("cmd", choices=["dev", "holdout"])
    ap.add_argument("--work", required=True)
    ap.add_argument("--ratings-dir", required=True)
    ap.add_argument("--st-dir", default=None)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args(argv)
    t0 = time.time()
    (cmd_dev if a.cmd == "dev" else cmd_holdout)(a)
    log(f"[season-bt] done in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
