"""Uncertain starting goalies: a start-probability mixture vs the single most likely starter
(``prereg_goalie_mix.json``, question ``sim_goalie_mix``).

    cd pipeline
    python -m bu.sim.goalie_mix startmodel --work <dir>      # fit the start model (fit seasons only)
    python -m bu.sim.goalie_mix dev --work <dir>             # dev seasons: BASE vs MIX (+ ORACLE reference)
    python -m bu.sim.goalie_mix holdout --work <dir>         # the single logged 2025-26 look (owner only)

History has no DailyFaceoff projections, so the uncertainty is a declared proxy.  For every team
game, point in time (only the team's earlier games):

  candidates  goalies with >= 1 start in the team's last 20 games (franchise, any game type)
  features    s10 = starts in the team's last 10 games / 10, s3 = starts in the last 3 / 3,
              prev = started the team's previous game, prev_b2b = prev x (that game was yesterday),
              sea = share of the team's starts this season (0 before its first game),
              gap = log(1 + days since his last start for the team)
  model       conditional logit (softmax over the candidates), L2 1e-3, fitted on the regular-season
              team games of the fit seasons 2017-18 .. 2022-23 whose actual starter is a candidate

Arms (the live parameters, ``out/sim_params_st.json`` = ``PONYXG_SIM_INPUTS=st``):

  ORACLE  the actual starter (the published validations' protocol; reference only)
  BASE    the single most likely candidate (the start model's argmax): the live behaviour, which
          treats the projected starter as certain
  MIX     every candidate with its start probability: each run of the simulation draws its own pair
          of starters (``engine.mixture_conversion``: stratified, common random numbers otherwise),
          so C (which reads the opposing starter's goals-per-xG gsv) varies by run

The goalie only enters through the conversion regression's ``gsv`` term.  Goalie state
(``state.SimState.goalie_rel``) of every candidate as of the game date, by the same replay that
builds the history inputs.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import armscore as A
from . import fit as F
from . import validate as V
from .params import OUT_DIR, load_params
from .state import SimState, replay, team_key

HERE = os.path.dirname(os.path.abspath(__file__))
PREREG = os.path.join(HERE, "prereg_goalie_mix.json")
QUESTION = "sim_goalie_mix"
DEV = ["20232024", "20242025"]
HOLDOUT = "20252026"
FIT_SEASONS = F.FIT_SEASONS
LIVE_PARAMS = os.path.join(OUT_DIR, "sim_params_st.json")
FEATURES = ["s10", "s3", "prev", "prev_b2b", "sea", "gap"]
N_CAND = 20
L2 = 1e-3
PASS_MARGIN = 0.0010
ARMS = ("ORACLE", "BASE", "MIX")


def log(*a):
    print(*a, flush=True)


def _gid(g):
    try:
        return int(float(g))
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------- candidates

def candidate_table(tg: pd.DataFrame) -> pd.DataFrame:
    """One row per (team game, candidate): features from the team's earlier games only, ``y`` = the
    candidate actually started, ``covered`` = the actual starter is among the candidates."""
    t = tg[["game_id", "team_id", "season", "game_type", "game_date", "goalie"]].copy()
    t["tk"] = t["team_id"].map(team_key)
    t = t.sort_values(["tk", "game_date", "game_id"]).reset_index(drop=True)
    rows = []
    for tk, grp in t.groupby("tk", sort=False):
        hist = []          # (date, goalie, season) of the team's earlier games
        for r in grp.itertuples(index=False):
            d = pd.Timestamp(r.game_date)
            act = _gid(r.goalie)
            last20 = hist[-N_CAND:]
            cands = sorted({g for _, g, _ in last20 if g is not None})
            if cands:
                last10 = [g for _, g, _ in hist[-10:]]
                last3 = [g for _, g, _ in hist[-3:]]
                prev_d, prev_g, _ = hist[-1]
                b2b = (d - prev_d).days == 1
                sea = [g for _, g, s in hist if s == r.season]
                for c in cands:
                    last = max(dd for dd, g, _ in last20 if g == c)
                    rows.append({"game_id": r.game_id, "team_id": r.team_id, "season": str(r.season),
                                 "game_type": r.game_type, "game_date": d, "goalie": c,
                                 "s10": last10.count(c) / 10.0, "s3": last3.count(c) / 3.0,
                                 "prev": float(prev_g == c), "prev_b2b": float(prev_g == c and b2b),
                                 "sea": (sea.count(c) / len(sea)) if sea else 0.0,
                                 "gap": float(np.log1p((d - last).days)),
                                 "y": float(act == c), "actual": act})
            hist.append((d, act, r.season))
    c = pd.DataFrame(rows)
    cov = c.groupby(["game_id", "team_id"])["y"].transform("sum")
    c["covered"] = cov > 0
    return c


def _softmax_groups(z: np.ndarray, grp: np.ndarray) -> np.ndarray:
    m = pd.Series(z).groupby(grp).transform("max").to_numpy()
    e = np.exp(z - m)
    s = pd.Series(e).groupby(grp).transform("sum").to_numpy()
    return e / s


def fit_start_model(c: pd.DataFrame) -> dict:
    """Conditional logit on the regular-season team games of the fit seasons (actual starter a
    candidate); returns the coefficients and the in-sample summary."""
    from scipy.optimize import minimize
    d = c[c["season"].isin(FIT_SEASONS) & (c["game_type"] == 2) & c["covered"]].reset_index(drop=True)
    X = d[FEATURES].to_numpy(float)
    y = d["y"].to_numpy(float)
    grp = pd.factorize(d["game_id"].astype(str) + "_" + d["team_id"].astype(str))[0]
    ng = grp.max() + 1

    def nll(b):
        z = X @ b
        m = np.zeros(ng)
        np.maximum.at(m, grp, z)
        e = np.exp(z - m[grp])
        s = np.bincount(grp, e, minlength=ng)
        lp = z - m[grp] - np.log(s[grp])
        p = e / s[grp]
        f = -float((y * lp).sum()) / ng + L2 * float(b @ b)
        gexp = np.zeros((ng, X.shape[1]))
        np.add.at(gexp, grp, p[:, None] * X)          # E_p[x] per team game
        g = -(y[:, None] * (X - gexp[grp])).sum(axis=0) / ng + 2 * L2 * b
        return f, g
    r = minimize(nll, np.zeros(X.shape[1]), jac=True, method="L-BFGS-B")
    beta = {k: round(float(v), 5) for k, v in zip(FEATURES, r.x)}
    p = _softmax_groups(X @ r.x, grp)
    ll = -float(np.log(np.clip(p[y == 1], 1e-12, 1)).mean())
    top = pd.DataFrame({"g": grp, "p": p, "y": y}).sort_values(["g", "p"], ascending=[True, False]).groupby("g").first()
    return {"beta": beta, "features": FEATURES, "n_team_games": int(ng), "n_rows": int(len(d)),
            "log_loss_per_team_game": round(ll, 4), "argmax_accuracy": round(float(top["y"].mean()), 4),
            "seasons": FIT_SEASONS, "l2": L2, "converged": bool(r.success)}


def start_probs(c: pd.DataFrame, beta: dict) -> pd.DataFrame:
    c = c.copy()
    z = c[FEATURES].to_numpy(float) @ np.array([beta[k] for k in FEATURES])
    grp = pd.factorize(c["game_id"].astype(str) + "_" + c["team_id"].astype(str))[0]
    c["p"] = _softmax_groups(z, grp)
    return c


# ---------------------------------------------------------------------------- goalie state

def candidate_gsv(tg: pd.DataFrame, cands: pd.DataFrame, hyper: dict) -> pd.DataFrame:
    """gsv (shrunk goals per xG against) of every candidate as of its game date: the replay of
    ``history.asof_sums`` (state before the day's games)."""
    need = defaultdict(list)
    for r in cands[["game_date", "goalie"]].drop_duplicates().itertuples(index=False):
        need[pd.Timestamp(r.game_date)].append(int(r.goalie))
    rec = {}

    def on_day(d, st: SimState):
        for g in need.get(pd.Timestamp(d), []):
            rec[(pd.Timestamp(d), g)] = st.goalie_rel(g)[0]
    replay(tg, hyper=hyper, on_day=on_day)
    out = cands.copy()
    out["gsv"] = [rec.get((pd.Timestamp(d), int(g)), np.nan) for d, g in zip(out["game_date"], out["goalie"])]
    return out


# ---------------------------------------------------------------------------- live (flag, off)

LIVE_FLAG = "PONYXG_SIM_GOALIE_MIX"
START_MODEL = os.path.join(OUT_DIR, "goalie_start_model.json")
Q_PROJECTED = 0.74          # DFO 'U' hit rate in the 2026-27 snapshots (23 / 31), prereg if_pass


def live_enabled() -> bool:
    return (os.environ.get(LIVE_FLAG) or "").strip().lower() in ("on", "1", "true")


def live_mixture(projected, confirmed: bool, starts, game_date, beta: dict | None = None,
                 q_projected: float = Q_PROJECTED):
    """[(goalie, weight), ...] for one side, or ``projected`` itself when there is nothing to mix
    (confirmed starter, no start history, no start model).  ``starts``: [(date, goalie name)] of the
    team's earlier games this season, oldest first."""
    if confirmed or not starts:
        return projected
    if beta is None:
        try:
            beta = json.load(open(START_MODEL))["beta"]
        except (OSError, ValueError, KeyError):
            return projected
    d = pd.Timestamp(str(game_date)[:10])
    hist = [(pd.Timestamp(str(x)[:10]), g) for x, g in starts if g and pd.Timestamp(str(x)[:10]) < d]
    last20 = hist[-N_CAND:]
    cands = sorted({g for _, g in last20})
    if not cands:
        return projected
    last10, last3 = [g for _, g in hist[-10:]], [g for _, g in hist[-3:]]
    prev_d, prev_g = hist[-1]
    b2b = (d - prev_d).days == 1
    sea = [g for _, g in hist]
    X = np.array([[last10.count(c) / 10.0, last3.count(c) / 3.0, float(prev_g == c), float(prev_g == c and b2b),
                   sea.count(c) / len(sea), float(np.log1p((d - max(x for x, g in last20 if g == c)).days))]
                  for c in cands])
    z = X @ np.array([beta[k] for k in FEATURES])
    p = np.exp(z - z.max())
    p = p / p.sum()
    if not projected:
        return [(c, float(w)) for c, w in zip(cands, p)]
    others = [(c, float(w)) for c, w in zip(cands, p) if c != projected]
    tot = sum(w for _, w in others)
    if tot <= 0:
        return projected
    return [(projected, q_projected)] + [(c, (1 - q_projected) * w / tot) for c, w in others]


# ---------------------------------------------------------------------------- arms

def arm_inputs(G: pd.DataFrame, cp: pd.DataFrame) -> dict:
    """ORACLE / BASE / MIX point-in-time input frames over the games of ``G``."""
    G = G.copy()
    side = {}
    for s, tcol in (("h", "home_team_id"), ("a", "away_team_id")):
        m = cp.merge(G[["game_id", tcol]].rename(columns={tcol: "team_id"}), on=["game_id", "team_id"])
        m = m.sort_values(["game_id", "p", "goalie"], ascending=[True, False, True])
        top = m.groupby("game_id").first()
        mix = m.groupby("game_id").apply(lambda x: [(float(p), float(g)) for p, g in zip(x["p"], x["gsv"])],
                                         include_groups=False)
        side[s] = (top, mix)
    base = G.copy()
    mixf = G.copy()
    for s in ("h", "a"):
        top, mix = side[s]
        gid = G["game_id"]
        has = gid.isin(top.index).to_numpy()
        bg = gid.map(top["gsv"]).to_numpy(float)
        base[f"{s}_g_gsv"] = np.where(has & np.isfinite(bg), bg, G[f"{s}_g_gsv"].to_numpy(float))
        base[f"{s}_base_goalie"] = gid.map(top["goalie"]).to_numpy()
        mixf[f"{s}_g_gsv"] = base[f"{s}_g_gsv"]
        mixf[f"{s}_g_mix"] = gid.map(mix).tolist()
    return {"ORACLE": G, "BASE": base, "MIX": mixf}


def build(work: str, seasons):
    params = load_params(LIVE_PARAMS)
    from .lineup_source import history_inputs_name
    G = pd.read_parquet(os.path.join(work, history_inputs_name(params)))
    D = A.game_set(work, seasons, G)
    # candidates of the fit seasons (start model) and of the scored seasons only
    path = os.path.join(work, f"goalie_candidates_{'_'.join(seasons)}.parquet")
    if os.path.exists(path):
        cg = pd.read_parquet(path)
    else:
        tg = F.build_team_games(F.ALL_SEASONS, F.se_dict(params["structural"]["score_effects"]), work)
        c = candidate_table(tg)
        c = c[c["season"].isin(list(FIT_SEASONS) + list(seasons))].reset_index(drop=True)
        cg = candidate_gsv(tg, c, params["state"]["hyper"])
        cg.to_parquet(path, index=False)
    sm_path = os.path.join(work, "goalie_start_model.json")
    if os.path.exists(sm_path):
        sm = json.load(open(sm_path))
    else:
        sm = fit_start_model(cg)
        json.dump(sm, open(sm_path, "w"), indent=1)
    cp = start_probs(cg[cg["season"].isin(seasons)], sm["beta"])
    Gs = G[G["game_id"].astype("int64").isin(D["game_id"])].reset_index(drop=True)
    return params, D, Gs, cp, sm


def proxy_summary(cp: pd.DataFrame, Gs: pd.DataFrame, D: pd.DataFrame) -> dict:
    """How uncertain the proxy is: BASE accuracy, start-model log loss, coverage, and the ORACLE
    gsv reproduction (the replay must give the history inputs' value for the actual starter)."""
    m = cp.merge(D[["game_id"]], on="game_id")
    g = m.sort_values(["game_id", "team_id", "p"], ascending=[True, True, False]).groupby(["game_id", "team_id"])
    top = g.first()
    act = m[m["y"] == 1]
    out = {"team_games": int(len(top)), "covered": round(float(top["covered"].mean()), 4),
           "base_accuracy": round(float(top["y"].mean()), 4),
           "start_log_loss_covered": round(float(-np.log(np.clip(act["p"], 1e-12, 1)).mean()), 4),
           "mean_p_top": round(float(top["p"].mean()), 4),
           "n_candidates_mean": round(float(g.size().mean()), 2)}
    # reliability of the top pick's probability
    bins = np.clip((top["p"].to_numpy() * 10).astype(int), 0, 9)
    out["top_p_reliability"] = [{"bin": f"{b / 10:.1f}", "n": int((bins == b).sum()),
                                 "pred": round(float(top["p"][bins == b].mean()), 3),
                                 "obs": round(float(top["y"][bins == b].mean()), 3)} for b in range(10) if (bins == b).sum()]
    chk = []
    for s, tcol in (("h", "home_team_id"), ("a", "away_team_id")):
        x = act.merge(Gs[["game_id", tcol, f"{s}_g_gsv"]].rename(columns={tcol: "team_id"}), on=["game_id", "team_id"])
        chk.append(np.abs(x["gsv"] - x[f"{s}_g_gsv"]).to_numpy())
    chk = np.concatenate(chk)
    out["oracle_gsv_max_abs_diff"] = float(np.nanmax(chk)) if len(chk) else None
    out["gsv_sd_log"] = round(float(np.log(cp["gsv"].clip(lower=1e-6)).std()), 4)
    return out


def run(work: str, seasons, workers: int):
    params, D, Gs, cp, sm = build(work, seasons)
    inputs = arm_inputs(Gs, cp)
    frames = {}
    for arm in ARMS:
        t0 = time.time()
        frames[arm] = A.simulate(inputs[arm], params, D, workers,
                                 cache=os.path.join(work, f"goalie_mix_{arm}_{'_'.join(seasons)}.pkl"))
        log(f"[goalie_mix] {arm} {seasons}: {len(D)} games ({time.time() - t0:.0f}s)")
    act = V.actual_table(seasons)
    sc = A.score(D, frames, act, seasons, ARMS, "BASE", "MIX")
    # ORACLE vs BASE: the cost of not knowing the starter (reference)
    return params, D, cp, sm, sc, proxy_summary(cp, Gs, D)


def cmd_startmodel(work):
    params = load_params(LIVE_PARAMS)
    tg = F.build_team_games(F.ALL_SEASONS, F.se_dict(params["structural"]["score_effects"]), work)
    c = candidate_table(tg)
    sm = fit_start_model(c)
    log(json.dumps(sm, indent=1))
    return sm


def cmd_dev(work, workers):
    params, D, cp, sm, sc, px = run(work, DEV, workers)
    pooled = sc["pooled"]
    ml = pooled["ml_MIX_minus_BASE"]
    dv = pooled["derivative_MIX_minus_BASE"]
    payload = {"prereg": "bu/sim/prereg_goalie_mix.json", "question": QUESTION, "seasons": DEV,
               "n_games": int(len(D)), "n_sims": 20000, "params": params.get("version"),
               "start_model": sm, "proxy": px, "scores": sc,
               "dev_ml_pass": bool(ml["diff"] < 0), "dev_derivative_pass": bool(dv["diff"] <= dv["se"]),
               "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    V._report("goalie_mix_dev", A.strip(payload))
    for s, r in sc.items():
        log(f"[goalie_mix] dev {s}: n {r['n']} ML ORACLE {r['ORACLE']['ml']['log_loss']} BASE {r['BASE']['ml']['log_loss']} "
            f"MIX {r['MIX']['ml']['log_loss']} MIX-BASE {r['ml_MIX_minus_BASE']} ORACLE-BASE {r['ml_ORACLE_minus_BASE']}; "
            f"deriv BASE {r['BASE']['derivative_score']} MIX {r['MIX']['derivative_score']} "
            f"MIX-BASE {r['derivative_MIX_minus_BASE']}")
    log(f"[goalie_mix] proxy {px}")
    log(f"[goalie_mix] dev ML pass {payload['dev_ml_pass']}, derivative pass {payload['dev_derivative_pass']}")
    return payload


def cmd_holdout(work, workers):
    """The single 2025-26 look for this question (prereg_goalie_mix.json); the owner runs it."""
    rep = json.load(open(V.REPORT))
    if "goalie_mix_dev" not in rep:
        raise SystemExit("run `dev` first")
    if A.looked(QUESTION):
        raise SystemExit(f"the {HOLDOUT} look for '{QUESTION}' has already been made ({V.LOOK_LOG}); one look only")
    dev = rep["goalie_mix_dev"]
    A.log_look({"season": HOLDOUT, "question": QUESTION, "stage": "started",
                "at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    params, D, cp, sm, sc, px = run(work, [HOLDOUT], workers)
    r = sc[HOLDOUT]
    ml, dv = r["ml_MIX_minus_BASE"], r["derivative_MIX_minus_BASE"]
    hold_ml, hold_dv = bool(ml["diff"] <= PASS_MARGIN), bool(dv["diff"] <= dv["se"])
    promote = bool(dev["dev_ml_pass"] and dev["dev_derivative_pass"] and hold_ml and hold_dv)
    A.log_look({"season": HOLDOUT, "question": QUESTION, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "version": params.get("version"), "n_games": int(len(D)), "ml_MIX_minus_BASE": ml,
                "derivative_MIX_minus_BASE": dv, "promote_mix": promote})
    payload = {"prereg": "bu/sim/prereg_goalie_mix.json", "question": QUESTION, "season": HOLDOUT,
               "n_games": int(len(D)), "proxy": px, "scores": sc, "holdout_ml_ok": hold_ml,
               "holdout_derivative_ok": hold_dv, "promote_mix": promote,
               "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    V._report("goalie_mix_holdout", A.strip(payload))
    log(f"[goalie_mix] holdout: {r['n']} games, ML MIX-BASE {ml}, derivative MIX-BASE {dv} -> promote {promote}")
    return payload


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bu.sim.goalie_mix")
    ap.add_argument("cmd", choices=["startmodel", "dev", "holdout"])
    ap.add_argument("--work", required=True)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args(argv)
    t0 = time.time()
    if a.cmd == "startmodel":
        cmd_startmodel(a.work)
    elif a.cmd == "dev":
        cmd_dev(a.work, a.workers)
    else:
        cmd_holdout(a.work, a.workers)
    log(f"[goalie_mix] done in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
