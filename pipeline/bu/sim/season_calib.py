"""Season-level calibration of the simulator's season projections (``prereg_season_calib.json``).

The uncalibrated simulator (question ``season_sim``) projects every remaining game with today's
typical lineup and the logit's strength sigma, and its season projections are too spread.  Three
season-level knobs (``season.calibration``; identity = the uncalibrated simulator):

* A ``k_inf`` / ``tau_days``: each game's logit P(home win) shrunk toward the table's home-ice
  baseline by k(d) = k_inf + (1 - k_inf) exp(-d / tau), d = days ahead (``season.calibrate_table``);
* B ``sigma0``: the Engine's per-season team random effect sigma0 sqrt(40 / (40 + GP));
* C ``lineup_w_inf`` (tau 60 days): the typical lineup's OFF / DEF multiplied by w(d) before the
  game is simulated (``season.lineup_scale``).

    cd pipeline     # PONYXG_LAKE_DIR, PONYXG_RAPM_DIR (stints for the EV TOI shares)
    python -m bu.sim.season_calib tune --work W --ratings-dir R --out O     # tuning seasons only
    python -m bu.sim.season_calib dev --work W --ratings-dir R --out O      # CAL vs LOGIT (+ SIM_raw)
    python -m bu.sim.season_calib holdout --work W --ratings-dir R --out O  # the single logged look
    python -m bu.sim.season_calib preseason --out O                         # 2026-27 spread, 3 engines

``--work``: the simulator's fit work dir (``team_games_<S>.parquet``, logit folds, NHL standings);
``--ratings-dir``: the ratings v4 point-in-time state (as ``season_backtest``); ``--out``: where the
per-game simulator tables (one per as-of point and lineup w) and the per-team rows are kept.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import pickle
import time
from collections import defaultdict
from datetime import datetime, timezone
from multiprocessing import get_context

import numpy as np
import pandas as pd

from . import data as D
from . import season as SE
from . import season_backtest as BT
from .params import load_params

HERE = os.path.dirname(os.path.abspath(__file__))
PREREG = "bu/sim/prereg_season_calib.json"
QUESTION = "season_sim_calib"
TUNE = {"20172018": ["2017-11-01", "2018-01-01", "2018-03-01"],
        "20182019": ["2018-11-01", "2019-01-01", "2019-03-01"],
        "20212022": ["2021-11-01", "2022-01-01", "2022-03-01"],
        "20222023": ["2022-11-01", "2023-01-01", "2023-03-01"]}
DEV = BT.DEV
HOLDOUT = BT.HOLDOUT
K_INF = (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0)
TAUS = (0.0, 30.0, 60.0, 120.0)
SIGMAS = (0.0, 0.1, 0.2, 0.3)
W_INF = (1.0, 0.75, 0.5)
W_TAU = 60.0
N_TUNE = 3000
N_EVAL = BT.N_SEASONS
WEIGHT = 25.0          # J = points MAE + WEIGHT x playoff log loss
NEAR = 0.02            # selection: within NEAR of the best J, the fewest knobs wins
MAE_MARGIN, LL_MARGIN = 0.25, 0.010


def log(*a):
    print(*a, flush=True)


def candidates() -> list:
    out = []
    for w in W_INF:
        for k in K_INF:
            for tau in (TAUS if k < 1.0 else (0.0,)):
                for s in SIGMAS:
                    out.append({"k_inf": k, "tau_days": tau, "sigma0": s, "lineup_w_inf": w, "lineup_tau_days": W_TAU})
    return out


def knobs(c: dict) -> int:
    return int(c["k_inf"] < 1) + int(c["tau_days"] > 0) + int(abs(c["sigma0"] - 0.2) > 1e-9) + int(c["lineup_w_inf"] < 1)


def cid(c: dict) -> str:
    return f"k{c['k_inf']:.2f}_t{c['tau_days']:.0f}_s{c['sigma0']:.2f}_w{c['lineup_w_inf']:.2f}"


# ------------------------------------------------------------------------------ as-of contexts

def season_context(S: str, work: str) -> dict:
    """Standings inputs of season S: divisions, outcomes, schedule rows, final table, playoff field."""
    divs = BT.nhl_divisions(S, work)
    o = D.outcomes(S)
    o = o[o["game_type"] == 2]
    g = D.games(S)
    g = g[g["game_type"] == 2].copy()
    g["date"] = pd.to_datetime(g["game_date"]).dt.strftime("%Y-%m-%d")
    teams = sorted(set(g["home_abbrev"]) | set(g["away_abbrev"]))
    ids = {a: int(t) for a, t in zip(g["home_abbrev"], g["home_team_id"])}
    miss = [t for t in teams if t not in divs]
    if miss:
        raise SystemExit(f"{S}: no NHL division for {miss}")
    final = BT.standings_from(o, teams, divs)
    made = BT.made_playoffs(final)
    api = {t: int(divs[t][2] not in (None, "e")) for t in teams}
    if api != made:
        log(f"[season-calib] {S}: bracket rule vs NHL clinch flags differ for "
            f"{[t for t in teams if api[t] != made[t]]} (scored against the NHL flags)")
        made = api
    return {"S": S, "divs": divs, "o": o, "g": g, "teams": teams, "ids": ids, "final": final, "made": made}


def point_inputs(ctx: dict, Dt: str) -> tuple[dict, list]:
    o, g = ctx["o"], ctx["g"]
    st_now = BT.standings_from(o[pd.to_datetime(o["game_date"]) < pd.Timestamp(Dt)], ctx["teams"], ctx["divs"])
    rem = g[g["date"] >= Dt].sort_values(["date", "game_id"])
    sched = [{"id": int(r.game_id), "date": r.date, "home": r.home_abbrev, "away": r.away_abbrev}
             for r in rem.itertuples(index=False)]
    return st_now, sched


def sim_tables(S: str, Dt: str, schedule: list, state, tg: pd.DataFrame, lh, ids: dict, params: dict,
               workers: int, w_values) -> dict:
    """{w_inf: raw simulator table} for the remaining ``schedule`` as of Dt (``season_backtest.sim_probs``
    with the lineup regression applied per game before simulating)."""
    from bu.lineup.features import side_term
    from .state import team_key
    rest = SE.rest_days_by_game(schedule)
    share, hist, rate, fin, c0, _st = lh.at(Dt)
    state.roll(S)
    league = {q: state.league_rate(q) for q in ("ev_goals", "ev_xg", "pp_goals", "pp_xg", "pen", "fin", "gsv")}
    before = tg[tg["game_date"] < pd.Timestamp(Dt)].sort_values(["game_date", "game_id"])
    starts = defaultdict(list)
    for t, gl in zip(before["team_id"], before["goalie"]):
        starts[team_key(t)].append(None if pd.isna(gl) else int(gl))
    teams = {}
    for abbr, tid in ids.items():
        pids, groups = SE.typical_lineup(hist.get(tid, ()))
        side = side_term(share, pids, groups, rate, hist.get(tid, ()), fin=fin) if len(pids) >= 10 else None
        gsv = SE.goalie_gsv(starts.get(team_key(tid), []), lambda x: state.goalie_rel(x)[0])
        teams[abbr] = SE.team_inputs(state, tid, gsv, side, c0)
    out = {}
    for w in w_values:
        cal = {**SE.CAL_IDENTITY, "lineup_w_inf": w, "lineup_tau_days": W_TAU}
        G = SE.game_rows(schedule, teams, league, rest, SE.lineup_scale(schedule, Dt, cal))
        ok = SE.runnable(G)
        if not ok.all():
            log(f"[season-calib] {S} {Dt}: {int((~ok).sum())} games not runnable by the simulator")
        res = SE.simulate(G[ok].reset_index(drop=True), params, workers=workers)
        out[w] = SE.build_table(schedule, G, res, rest)
    return out


def build_points(points: dict, work: str, ratings_dir: str, out: str, workers: int, w_values, logit: bool) -> list:
    """Per as-of point: {S, Dt, k, st_now, sched, final, made, tables {w: table}, logit Probabilities}.
    Simulator tables are cached in ``out`` (tables_<S>_<Dt>_w<w>.pkl)."""
    from .fit import ALL_SEASONS, build_team_games, se_dict
    params = load_params()
    os.makedirs(out, exist_ok=True)

    def tpath(S, Dt, w):
        return os.path.join(out, f"tables_{S}_{Dt}_w{w:.2f}.pkl")
    need_sim = any(not os.path.exists(tpath(S, Dt, w)) for S, ds in points.items() for Dt in ds for w in w_values)
    tg = snaps = None
    if need_sim:
        tg = build_team_games([s for s in ALL_SEASONS if s <= max(points)], se_dict(params["structural"]["score_effects"]),
                              work)
        snaps = BT.state_snapshots(tg, params["state"]["hyper"], [d for ds in points.values() for d in ds])
    games = BT.archive_games() if logit else None
    res = []
    for S, dates in points.items():
        ctx = season_context(S, work)
        lh = None
        name_of = None
        if logit:
            g = ctx["g"]
            arch = games[(games["home_away"] == "Home") & games["game_id"].isin(g["game_id"])]
            name_of = dict(zip(g.set_index("game_id").loc[arch["game_id"], "home_abbrev"], arch["team"]))
        for k, Dt in enumerate(dates):
            t0 = time.time()
            st_now, sched = point_inputs(ctx, Dt)
            missing = [w for w in w_values if not os.path.exists(tpath(S, Dt, w))]
            if missing:
                if lh is None:
                    lh = BT.LineupHistory(S, ratings_dir, None)
                tabs = sim_tables(S, Dt, sched, snaps[Dt].copy(), tg, lh, ctx["ids"], params, workers, missing)
                for w, tab in tabs.items():
                    with open(tpath(S, Dt, w), "wb") as f:
                        pickle.dump(tab, f)
            tables = {}
            for w in w_values:
                with open(tpath(S, Dt, w), "rb") as f:
                    tables[w] = pickle.load(f)
            pt = {"S": S, "Dt": Dt, "seed": 20262027 + int(S[:4]) * 10 + k, "st_now": st_now, "sched": sched,
                  "final": ctx["final"], "made": ctx["made"], "tables": tables}
            if logit:
                pt["logit"] = BT.logit_probs(S, Dt, work, games, name_of)
            res.append(pt)
            log(f"[season-calib] {S} {Dt}: {len(sched)} remaining games, "
                f"GP {sum(v['gp'] for v in st_now.values()) // 2}, tables {sorted(tables)} "
                f"({len(missing)} simulated now), {time.time() - t0:.0f}s")
    return res


def cal_probs(table: dict, Dt: str, schedule: list, cal: dict) -> SE.SimProbabilities:
    return SE.SimProbabilities(SE.calibrate_table(table, Dt, cal), None, "game simulator (calibrated)",
                               {"calibration": cal}, schedule, sigma0=cal["sigma0"])


# ------------------------------------------------------------------------------ tuning (fast scorer)

def fast_made(eng, pts, rw, row, w) -> np.ndarray:
    """[n_sims, teams] playoff-field indicator: Engine.playoff_field vectorised over simulations
    (division top 3 + the next 2 of each conference; NHL tiebreak keys; exact ties to the lower team
    index, as Python's stable sort does)."""
    n, T = pts.shape
    key = ((pts * 1000.0 + rw) * 1000.0 + row) * 1000.0 + w - np.arange(T)[None, :] * 1e-3
    divs, confs = defaultdict(list), defaultdict(list)
    for t, i in eng.idx.items():
        divs[eng.standings[t]["division"]].append(i)
        confs[eng.standings[t]["conference"]].append(i)
    rows = np.arange(n)[:, None]
    top = np.zeros((n, T), bool)
    for m in divs.values():
        m = np.array(m)
        o = np.argsort(-key[:, m], axis=1)[:, :3]
        top[rows, m[o]] = True
    made = top.copy()
    for m in confs.values():
        m = np.array(m)
        kk = np.where(top[:, m], -np.inf, key[:, m])
        o = np.argsort(-kk, axis=1)[:, :2]
        made[rows, m[o]] = True
    return made


def score_engine(eng, final: dict, made_actual: dict, fast: bool = True) -> list:
    pts, rw, row, w = eng.season()
    made = fast_made(eng, pts, rw, row, w) if fast else None
    if not fast:
        r = eng.run(playoffs=False)
        pm = r["made"] / eng.n
    else:
        pm = made.mean(axis=0)
    srt = np.sort(pts, axis=0)
    lo, hi = srt[int(0.1 * eng.n)], srt[int(0.9 * eng.n) - 1]
    mean = pts.mean(axis=0)
    out = []
    for i, t in enumerate(eng.teams):
        y = made_actual[t]
        p = min(max(float(pm[i]), 1e-3), 1 - 1e-3)
        out.append({"team": t, "pts_proj": float(mean[i]), "pts_final": final[t]["pts"],
                    "abs_err": abs(float(mean[i]) - final[t]["pts"]), "err": float(mean[i]) - final[t]["pts"],
                    "p_made": float(pm[i]), "made": y, "ll": -math.log(p if y else 1 - p),
                    "brier": (float(pm[i]) - y) ** 2, "cover80": float(lo[i] <= final[t]["pts"] <= hi[i])})
    return out


_P = {}


def _tune_task(task):
    j, w = task
    from season_simulator import Engine
    pt = _P["points"][j]
    rows = []
    for c in _P["cands"]:
        if c["lineup_w_inf"] != w:
            continue
        pr = cal_probs(pt["tables"][w], pt["Dt"], pt["sched"], c)
        eng = Engine(pt["st_now"], pt["sched"], pr, n_sims=_P["n"], seed=pt["seed"])
        for r in score_engine(eng, pt["final"], pt["made"]):
            rows.append({"cand": cid(c), "season": pt["S"], "asof": pt["Dt"], **r})
    return rows


def objective(T: pd.DataFrame) -> pd.DataFrame:
    g = T.groupby("cand").agg(mae=("abs_err", "mean"), ll=("ll", "mean"), brier=("brier", "mean"),
                              bias=("err", "mean"), cover80=("cover80", "mean"), n=("team", "size"))
    g["J"] = g["mae"] + WEIGHT * g["ll"]
    return g.sort_values("J")


def choose(obj: pd.DataFrame, cands: list) -> dict:
    by = {cid(c): c for c in cands}
    best = float(obj["J"].min())
    near = obj[obj["J"] <= best + NEAR].copy()
    near["knobs"] = [knobs(by[i]) for i in near.index]
    pick = near.sort_values(["knobs", "J"]).index[0]
    return by[pick]


def cmd_tune(a):
    cands = candidates()
    pts = build_points(TUNE, a.work, a.ratings_dir, a.out, a.workers, W_INF, logit=False)
    # fast scorer check: the vectorised playoff field equals Engine.run on one point
    from season_simulator import Engine
    c0 = {**SE.CAL_IDENTITY, "sigma0": 0.2}
    p0 = pts[0]
    e1 = Engine(p0["st_now"], p0["sched"], cal_probs(p0["tables"][1.0], p0["Dt"], p0["sched"], c0), n_sims=500,
                seed=p0["seed"])
    r = e1.run(playoffs=False)
    pts_, rw, row, w = e1.season()
    fm = fast_made(e1, pts_, rw, row, w).sum(axis=0)
    if not np.array_equal(fm, r["made"]):
        raise SystemExit(f"fast playoff field differs from Engine.run: {fm} vs {r['made']}")
    log("[season-calib] fast playoff field == Engine.run on the check point")
    _P.update({"points": pts, "cands": cands, "n": N_TUNE})
    tasks = [(j, w) for j in range(len(pts)) for w in W_INF]
    t0 = time.time()
    with get_context("fork").Pool(a.workers) as pool:
        parts = pool.map(_tune_task, tasks, chunksize=1)
    T = pd.DataFrame([r for p in parts for r in p])
    T.to_csv(os.path.join(a.out, "tune_rows.csv.gz"), index=False)
    obj = objective(T)
    pick = choose(obj, cands)
    ident = cid({"k_inf": 1.0, "tau_days": 0.0, "sigma0": 0.2, "lineup_w_inf": 1.0})
    log(f"[season-calib] tuning grid scored in {time.time() - t0:.0f}s; top 15:\n{obj.head(15).round(4)}")
    log(f"[season-calib] identity (uncalibrated): {obj.loc[ident].round(4).to_dict()}")
    log(f"[season-calib] chosen: {pick} {obj.loc[cid(pick)].round(4).to_dict()}")
    by_asof = {}
    for (S, Dt), sub in T[T["cand"].isin([cid(pick), ident])].groupby(["season", "asof"]):
        o = objective(sub)
        by_asof[f"{S} {Dt}"] = {k: o.loc[k, ["mae", "ll", "brier"]].round(4).to_dict() for k in o.index}
    # one-knob profiles around the chosen point
    prof = {}
    for knob, vals in (("k_inf", K_INF), ("tau_days", TAUS), ("sigma0", SIGMAS), ("lineup_w_inf", W_INF)):
        prof[knob] = {}
        for v in vals:
            c = {**pick, knob: v}
            if c["k_inf"] >= 1.0:
                c["tau_days"] = 0.0
            if cid(c) in obj.index:
                prof[knob][str(v)] = obj.loc[cid(c), ["mae", "ll", "J"]].round(4).to_dict()
    payload = {"prereg": PREREG, "question": QUESTION, "points": TUNE, "n_seasons_mc": N_TUNE,
               "sim_version": load_params().get("version"), "objective": f"points MAE + {WEIGHT} x playoff LL",
               "chosen": pick, "chosen_scores": obj.loc[cid(pick)].round(4).to_dict(),
               "identity_scores": obj.loc[ident].round(4).to_dict(),
               "best_J": round(float(obj["J"].min()), 4), "best_by_J": obj.index[0], "n_candidates": len(obj),
               "top10": obj.head(10).round(4).reset_index().to_dict("records"), "profiles": prof, "by_asof": by_asof,
               "grid_J": obj["J"].round(4).to_dict(),
               "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    from .validate import _report
    _report("season_calib_tune", payload)


# ------------------------------------------------------------------------------ dev / holdout

def reliability(p, y) -> list:
    p, y = np.asarray(p, float), np.asarray(y, float)
    b = np.clip((p * 10).astype(int), 0, 9)
    return [{"bin": f"{k / 10:.1f}-{(k + 1) / 10:.1f}", "n": int((b == k).sum()),
             "pred": round(float(p[b == k].mean()), 4), "obs": round(float(y[b == k].mean()), 4)}
            for k in range(10) if (b == k).any()]


def evaluate(points: dict, a, raw: bool) -> pd.DataFrame:
    from season_simulator import Engine
    rep = json.load(open(os.path.join(HERE, "out", "validation.json")))
    if "season_calib_tune" not in rep:
        raise SystemExit("run `tune` first")
    cal = rep["season_calib_tune"]["chosen"]
    ws = sorted({1.0, float(cal["lineup_w_inf"])}) if raw else [float(cal["lineup_w_inf"])]
    pts = build_points(points, a.work, a.ratings_dir, a.out, a.workers, ws, logit=True)
    rows = []
    for pt in pts:
        arms = {"LOGIT": pt["logit"], "CAL": cal_probs(pt["tables"][float(cal["lineup_w_inf"])], pt["Dt"], pt["sched"], cal)}
        if raw:
            arms["SIM_raw"] = SE.SimProbabilities(pt["tables"][1.0], None, "game simulator", {}, pt["sched"])
        for arm, pr in arms.items():
            eng = Engine(pt["st_now"], pt["sched"], pr, n_sims=N_EVAL, seed=pt["seed"])
            for r in score_engine(eng, pt["final"], pt["made"], fast=False):
                rows.append({"arm": arm, "season": pt["S"], "asof": pt["Dt"], **r})
    return pd.DataFrame(rows), cal


def summary(T: pd.DataFrame, points: dict, arms) -> dict:
    s = {"pooled": BT.summarize(T, "CAL", arms)}
    if len(points) > 1:
        s.update({S: BT.summarize(T[T["season"] == S], "CAL", arms) for S in points})
    s["by_asof"] = {f"{S} {d}": BT.summarize(T[(T["season"] == S) & (T["asof"] == d)], "CAL", arms)
                    for S, ds in points.items() for d in ds}
    s["reliability"] = {arm: reliability(T.loc[T["arm"] == arm, "p_made"], T.loc[T["arm"] == arm, "made"])
                        for arm in arms if (T["arm"] == arm).any()}
    if "SIM_raw" in arms:
        x = T[T["arm"].isin(["SIM_raw", "LOGIT"])].replace({"arm": {"SIM_raw": "SIM"}})
        s["pooled_SIM_raw_vs_LOGIT"] = {k: v for k, v in BT.summarize(x).items() if "minus" in k}
    return s


def cmd_dev(a):
    from .validate import _report
    T, cal = evaluate(DEV, a, raw=True)
    T.to_csv(os.path.join(a.out, "dev_rows.csv"), index=False)
    s = summary(T, DEV, ("LOGIT", "CAL", "SIM_raw"))
    p = s["pooled"]
    d_mae, d_ll = p["points_mae_CAL_minus_LOGIT"], p["playoff_ll_CAL_minus_LOGIT"]
    res = {"dev_mae_pass": bool(d_mae["diff"] <= 0), "dev_ll_pass": bool(d_ll["diff"] <= d_ll["se_team_clustered"])}
    _report("season_calib_dev", {"prereg": PREREG, "question": QUESTION, "points": DEV, "n_seasons_mc": N_EVAL,
                                 "calibration": cal, "sim_version": load_params().get("version"), "scores": s, **res,
                                 "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    log(json.dumps({k: s[k] for k in ("pooled", *DEV, "pooled_SIM_raw_vs_LOGIT")}, indent=1))
    log(f"[season-calib] dev: {res}")


def _looked() -> bool:
    from .validate import LOOK_LOG
    if not os.path.exists(LOOK_LOG):
        return False
    with open(LOOK_LOG) as f:
        return any(json.loads(ln).get("question") == QUESTION for ln in f if ln.strip())


def cmd_holdout(a):
    from .validate import LOOK_LOG, REPORT, _report
    rep = json.load(open(REPORT))
    if "season_calib_dev" not in rep:
        raise SystemExit("run `dev` first")
    if _looked():
        raise SystemExit(f"the holdout look for '{QUESTION}' has already been made; one look only")
    dev = rep["season_calib_dev"]
    with open(LOOK_LOG, "a") as f:
        f.write(json.dumps({"season": "20252026", "question": QUESTION, "stage": "started",
                            "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}) + "\n")
    T, cal = evaluate(HOLDOUT, a, raw=False)
    T.to_csv(os.path.join(a.out, "holdout_rows.csv"), index=False)
    s = summary(T, HOLDOUT, ("LOGIT", "CAL"))
    h = s["pooled"]
    hold = {"holdout_mae_ok": bool(h["points_mae_CAL_minus_LOGIT"]["diff"] <= MAE_MARGIN),
            "holdout_ll_ok": bool(h["playoff_ll_CAL_minus_LOGIT"]["diff"] <= LL_MARGIN)}
    promote = bool(dev["dev_mae_pass"] and dev["dev_ll_pass"] and all(hold.values()))
    with open(LOOK_LOG, "a") as f:
        f.write(json.dumps({"season": "20252026", "question": QUESTION,
                            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                            "sim_version": load_params().get("version"), "calibration": cal,
                            "points_mae_CAL_minus_LOGIT": h["points_mae_CAL_minus_LOGIT"],
                            "playoff_ll_CAL_minus_LOGIT": h["playoff_ll_CAL_minus_LOGIT"],
                            "promote_cal": promote}) + "\n")
    _report("season_calib_holdout", {"prereg": PREREG, "question": QUESTION, "points": HOLDOUT, "n_seasons_mc": N_EVAL,
                                     "calibration": cal, "sim_version": load_params().get("version"), "scores": s,
                                     **hold, "promote_cal": promote,
                                     "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    log(json.dumps(s["pooled"], indent=1))
    log(f"[season-calib] holdout: {hold} -> promote CAL: {promote}")


# ------------------------------------------------------------------------------ 2026-27 preseason spread

def cmd_preseason(a):
    """Projections of the current season from today's standings with LOGIT, SIM_raw and CAL (5,000
    seasons, the live seed); prints and saves the spread (projected points range, playoff odds)."""
    import season_simulator as SS
    rep = json.load(open(os.path.join(HERE, "out", "validation.json")))
    cal = rep["season_calib_tune"]["chosen"]
    team_map = SS.build_team_map(SS.load_csv(os.path.join(SS.SCRIPT_DIR, "nhl_teams.csv")))
    standings = SS.fetch_current_standings()
    schedule = SS.fetch_remaining_schedule()
    os.environ[SE.ENV] = "logit"
    logit = SS.make_probabilities(team_map, schedule)
    arms = {"LOGIT": logit,
            "SIM_raw": SE.live_probabilities(schedule, fallback=logit, cal=dict(SE.CAL_IDENTITY)),
            "CAL": SE.live_probabilities(schedule, fallback=logit, cal=cal)}
    out = {"calibration": cal, "games_played": sum(v["gp"] for v in standings.values()) // 2,
           "remaining_games": len(schedule), "arms": {}}
    for arm, pr in arms.items():
        eng = SS.Engine(standings, schedule, pr, n_sims=N_EVAL)
        r = eng.run(playoffs=False)
        t = {tm: {"pts": round(float(r["pts"][i]) / eng.n, 1), "playoffs": round(100 * r["made"][i] / eng.n, 1)}
             for i, tm in enumerate(eng.teams)}
        pts = [v["pts"] for v in t.values()]
        po = [v["playoffs"] for v in t.values()]
        out["arms"][arm] = {"sigma0": eng.sigma0, "pts_min": min(pts), "pts_max": max(pts),
                            "pts_sd": round(float(np.std(pts)), 2), "playoffs_min": min(po), "playoffs_max": max(po),
                            "teams": t}
        log(f"{arm}: points {min(pts)}..{max(pts)} (sd {np.std(pts):.1f}), playoffs {min(po)}%..{max(po)}%")
    with open(os.path.join(a.out, "preseason_2026_27.json"), "w") as f:
        json.dump(out, f, indent=1)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bu.sim.season_calib")
    ap.add_argument("cmd", choices=["tune", "dev", "holdout", "preseason"])
    ap.add_argument("--work", default=None)
    ap.add_argument("--ratings-dir", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args(argv)
    t0 = time.time()
    {"tune": cmd_tune, "dev": cmd_dev, "holdout": cmd_holdout, "preseason": cmd_preseason}[a.cmd](a)
    log(f"[season-calib] {a.cmd} done in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
