"""Simulator vs logit game model as the engine of the model win % (``prereg_primary.json``).

    cd pipeline
    python -m bu.sim.primary dev --work <dir>        # dev seasons: ML candidates, totals, diagnostics
    python -m bu.sim.primary holdout --work <dir>    # the single 2025-26 look for this question

Candidates (all scored on the same games as the walk-forward logit ``B_logit``):

  A_sim     raw simulator P(home win), no anchoring (20,000 runs, the live seed)
  C1_avg    sigmoid(0.5 logit p_sim + 0.5 logit p_logit)
  C2_stack  the game model + feature sim_logit = logit p_sim, same walk-forward as B_logit

Totals: the simulator anchored to (p, T) for T = goal_model's expected total (T_gm) or the
simulator's own (T_sim), p the candidate's win %.  Report: ``out/validation.json`` section
``primary_dev`` / ``primary_holdout``; holdout look logged in ``out/look_log.jsonl``
(``question = primary_winpct``).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import time
from datetime import datetime, timezone
from multiprocessing import get_context

import numpy as np
import pandas as pd

from . import anchor as AN
from . import engine as EN
from . import markets as MK
from . import rates as RT
from . import validate as V
from .params import load_params

HERE = os.path.dirname(os.path.abspath(__file__))
PREREG = os.path.join(HERE, "prereg_primary.json")
QUESTION = "primary_winpct"
DEV = ["20232024", "20242025"]
HOLDOUT = "20252026"
STACK_TRAIN = ["20222023"]          # C2: the game model's first season (no logit OOS of its own)
N_SIMS = 20000
SEED = 20261002
EPS = 1e-6
TOTAL_MARKETS = ["tot55", "tot60", "tot65"]
PASS_MARGIN = 0.0010
TIE_C = 0.0002
# Pairings of (win %, total) the simulator is anchored to.  'sim' = its own raw value.
PAIRINGS = {"sim_gm": ("sim", "gm"), "logit_gm": ("logit", "gm"), "logit_sim": ("logit", "sim"),
            "c1_gm": ("c1", "gm"), "c1_sim": ("c1", "sim")}
ABLATIONS = {
    "home_ice": [("ev", "home"), ("conv", "home"), ("pp", "home"), ("pen", "home")],
    "lineup_rapm": [("ev", "bu_rel")],
    "team_5v5_state": [("ev", "st_off"), ("ev", "st_def")],
    "finishing": [("conv", "fin_rel"), ("conv", "st_fin")],
    "goalie": [("conv", "gsv")],
    "special_teams": [("pp", "st_pp"), ("pp", "st_pk")],
    "penalties": [("pen", "st_take"), ("pen", "st_draw")],
    "rest": [("ev", "b2b"), ("ev", "b2b_opp")],
}


def log(*a):
    print(*a, flush=True)


def sig(z):
    return 1.0 / (1.0 + np.exp(-np.asarray(z, float)))


def lgt(p):
    p = np.clip(np.asarray(p, float), EPS, 1 - EPS)
    return np.log(p / (1 - p))


# ---------------------------------------------------------------------------- logit walk-forward

def season_year(s) -> int:
    return int(str(s)[:4])


def logit_matrix(work: str) -> pd.DataFrame:
    p = os.path.join(work, "M.pkl")
    if os.path.exists(p):
        return pd.read_pickle(p)
    import train_game_model as T
    M, _ = T.build_matrix()
    M.to_pickle(p)
    return M


def logit_oos(work: str, test_years, extra: pd.DataFrame | None = None, tag: str = "B") -> pd.DataFrame:
    """Walk-forward OOS of the live feature set (``extra``: a game_id + sim_logit frame adds that
    feature; games without it are dropped from training and testing)."""
    import goal_model as GM
    import train_game_model as T
    path = os.path.join(work, f"logit_oos_{tag}_{'_'.join(map(str, test_years))}.parquet")
    if os.path.exists(path):
        return pd.read_parquet(path)
    M = logit_matrix(work).copy()
    cols, _ = T.live_feature_columns()
    cols = list(cols)
    if extra is not None:
        M = M.merge(extra[["game_id", "sim_logit"]], on="game_id", how="inner")
        cols = cols + ["sim_logit"]
    folds, oos = T.walk_forward(M, cols, test_seasons=tuple(test_years))
    oos = oos.merge(M[["game_id", "pace"]], on="game_id", how="left")
    oos["T_gm"] = [GM.expected_total(a, b) for a, b in zip(oos["league_gpg"], oos["pace"])]
    oos = oos[["game_id", "season", "p_model", "T_gm", "early"]].copy()
    oos["game_id"] = oos["game_id"].astype("int64")
    oos.to_parquet(path, index=False)
    for f in folds:
        log(f"[primary] logit {tag} fold {f['test_season']}: C {f['C']} n {f['n']} LL {f['log_loss']:.4f}")
    with open(path.replace(".parquet", "_folds.json"), "w") as fh:
        json.dump([{k: v for k, v in f.items() if k != "inner_C_scores"} for f in folds], fh, indent=1, default=float)
    return oos


# ---------------------------------------------------------------------------- simulation

_W = {}


def _init(params):
    _W["params"] = params
    _W["S"] = EN.Structure(params["structural"], params.get("dispersion"))


def _work(task):
    rows, n, seed, tg = task
    params, S = _W["params"], _W["S"]
    g = pd.DataFrame(rows)
    R = RT.build_rates(g, params)
    out = []
    for i in range(len(g)):
        gid = int(g["game_id"].iloc[i])
        sd = EN.game_seed(seed, gid)
        o = EN.simulate_game(R, i, S, n, sd)
        raw = V._summ(MK.summarize(o))
        rec = {"game_id": gid, "raw": raw}
        t = tg[i] if tg is not None else None
        if t:
            ps = {"sim": raw["p_home"], "logit": t["p_logit"],
                  "c1": float(sig(0.5 * lgt(raw["p_home"]) + 0.5 * lgt(t["p_logit"])))}
            ts = {"sim": raw["exp_total"], "gm": t["T_gm"]}
            pairs = dict(PAIRINGS)
            for k in t.get("extra_p", {}):
                ps[k] = t["extra_p"][k]
                pairs[f"{k}_gm"], pairs[f"{k}_sim"] = (k, "gm"), (k, "sim")
            for name, (pk, tk) in pairs.items():
                o2, w, info = AN.anchor_game(R, i, S, n, sd, ps[pk], ts[tk], o=o)
                rec[name] = V._summ(MK.summarize(o2, w=w))
                rec[name]["anchor_p_err"] = info["p_err"]
                rec[name]["anchor_t_err"] = info["t_err"]
        out.append(rec)
    return out


def run(G: pd.DataFrame, params: dict, targets: dict | None, n=N_SIMS, workers=8, chunk=30) -> list:
    cols = list(G.columns)
    tasks = []
    for s in range(0, len(G), chunk):
        sub = G.iloc[s:s + chunk]
        tg = [targets.get(int(g)) for g in sub["game_id"]] if targets is not None else None
        tasks.append((sub[cols].to_dict("records"), n, SEED, tg))
    with get_context("fork").Pool(workers, initializer=_init, initargs=(params,)) as pool:
        res = pool.map(_work, tasks)
    return [r for part in res for r in part]


def frame(res, key):
    return pd.DataFrame([{"game_id": r["game_id"], **r[key]} for r in res if key in r])


def sim_inputs(work: str) -> pd.DataFrame:
    G = V.history_inputs(work)
    return G[RT.finite_inputs(G)].reset_index(drop=True)


def raw_p(work: str, seasons, params=None, tag="base", workers=8) -> pd.DataFrame:
    """Raw simulator p / total of every game (any type) of ``seasons`` with finite inputs."""
    path = os.path.join(work, f"sim_raw_{tag}_{'_'.join(seasons)}.parquet")
    if os.path.exists(path):
        return pd.read_parquet(path)
    params = params or load_params()
    G = sim_inputs(work)
    G = G[G["season"].astype(str).isin(seasons)].reset_index(drop=True)
    t0 = time.time()
    f = frame(run(G, params, None, workers=workers), "raw")
    f = f[["game_id", "p_home", "exp_total"]].rename(columns={"p_home": "p_sim", "exp_total": "T_sim"})
    f.to_parquet(path, index=False)
    log(f"[primary] raw sim {tag} {seasons}: {len(f)} games in {time.time() - t0:.0f}s")
    return f


# ---------------------------------------------------------------------------- scoring

def ml_scores(y, p) -> dict:
    y, p = np.asarray(y, float), np.clip(np.asarray(p, float), EPS, 1 - EPS)
    ll = -(y * np.log(p) + (1 - y) * np.log(1 - p))
    s, c = V.calib_slope(p, y)
    return {"n": int(len(y)), "log_loss": round(float(ll.mean()), 5), "brier": round(float(((p - y) ** 2).mean()), 5),
            "cal_slope": round(s, 3), "cal_int": round(c, 3), "mean_p": round(float(p.mean()), 4),
            "home_rate": round(float(y.mean()), 4), "sd_logit": round(float(lgt(p).std()), 4),
            "reliability": V.reliability(p, y)}


def ll_vec(y, p):
    y, p = np.asarray(y, float), np.clip(np.asarray(p, float), EPS, 1 - EPS)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def paired(y, pa, pb) -> dict:
    d = ll_vec(y, pa) - ll_vec(y, pb)
    return {"diff": round(float(d.mean()), 5), "se": round(float(d.std(ddof=1) / math.sqrt(len(d))), 5),
            "n": int(len(d))}


def ml_table(D: pd.DataFrame, cands, seasons) -> dict:
    out = {}
    for s in list(seasons) + (["pooled"] if len(seasons) > 1 else []):
        d = D if s == "pooled" else D[D["season"] == s]
        y = d["home_win"].to_numpy(float)
        rec = {"B_logit": ml_scores(y, d["p_logit"])}
        for c in cands:
            rec[c] = ml_scores(y, d[c])
            rec[f"{c}_minus_B"] = paired(y, d[c], d["p_logit"])
        out[s] = rec
    return out


def totals_table(frames: dict, act: pd.DataFrame, seasons) -> dict:
    out = {}
    for s in list(seasons) + (["pooled"] if len(seasons) > 1 else []):
        a = act if s == "pooled" else act[act["season"].astype(str) == s]
        rec = {}
        L = {k: V.market_losses(f, a) for k, f in frames.items()}
        for k, l in L.items():
            sm = V.summarize_losses(l)
            rec[k] = {"total_score": round(sum(sm[m]["log_loss"] for m in TOTAL_MARKETS), 5),
                      "derivative_score": sm["derivative_ll_sum"],
                      **{m: {x: sm[m][x] for x in ("log_loss", "brier", "cal_slope", "cal_int") if x in sm[m]}
                         for m in TOTAL_MARKETS + ["tot60_2w"]},
                      "mean_exp_total": round(float(frames[k].merge(a, on="game_id")["exp_total"].mean()), 3),
                      "actual_mean_total": round(float(a[a["game_id"].isin(frames[k]["game_id"])]["total"].mean()), 3)}
        for p in ("sim", "logit", "c1", "c2"):
            if f"{p}_gm" in L and f"{p}_sim" in L:
                j = L[f"{p}_sim"].merge(L[f"{p}_gm"], on="game_id", suffixes=("_a", "_b"))
                d = sum(j[f"{m}_ll_a"] - j[f"{m}_ll_b"] for m in TOTAL_MARKETS)
                rec[f"{p}: T_sim_minus_T_gm"] = {"diff": round(float(d.mean()), 5),
                                                  "se": round(float(d.std(ddof=1) / math.sqrt(len(d))), 5),
                                                  "n": int(len(d))}
        out[s] = rec
    return out


# ---------------------------------------------------------------------------- diagnostics

def logistic_offset(X, y, offset, iters=60):
    """Logistic regression with an offset (IRLS); X includes the constant.  (beta, se, loglik)."""
    b = np.zeros(X.shape[1])
    for _ in range(iters):
        mu = sig(offset + X @ b)
        W = mu * (1 - mu)
        H = X.T @ (X * W[:, None]) + 1e-9 * np.eye(X.shape[1])
        nb = b + np.linalg.solve(H, X.T @ (y - mu))
        if np.max(np.abs(nb - b)) < 1e-10:
            b = nb
            break
        b = nb
    mu = np.clip(sig(offset + X @ b), EPS, 1 - EPS)
    H = X.T @ (X * (mu * (1 - mu))[:, None])
    se = np.sqrt(np.diag(np.linalg.inv(H)))
    return b, se, float(np.sum(y * np.log(mu) + (1 - y) * np.log(1 - mu)))


def component_logratios(G: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Home-minus-away linear-predictor contribution of each simulator component group."""
    beta = params["glm"]["beta"]
    k = float((params.get("dispersion") or {}).get("stretch", 1.0))
    fh, fa = RT.side_features(G, "h"), RT.side_features(G, "a")
    out = pd.DataFrame({"game_id": G["game_id"].astype("int64").to_numpy()})
    for name, terms in ABLATIONS.items():
        v = np.zeros(len(G))
        for grp, c in terms:
            kk = 1.0 if c == "home" else k
            v += kk * float(beta[grp].get(c, 0.0)) * (fh[c].to_numpy(float) - fa[c].to_numpy(float))
        out[f"sim_{name}"] = v
    return out


def diagnostics(work, D: pd.DataFrame, G: pd.DataFrame, params: dict, workers: int) -> dict:
    import train_game_model as T
    cols, _ = T.live_feature_columns()
    M = logit_matrix(work)
    X = D.merge(M[["game_id"] + list(cols)], on="game_id", how="left")
    y = X["home_win"].to_numpy(float)
    out = {}
    # D1a: what the logit's features add to the simulator
    cols = [c for c in cols if X[c].std() > 1e-9]
    Z = X[cols].to_numpy(float)
    Z = (Z - Z.mean(0)) / np.where(Z.std(0) > 0, Z.std(0), 1)
    A = np.column_stack([np.ones(len(Z)), Z])
    off = lgt(X["A_sim"])
    b0, _, ll0 = logistic_offset(np.ones((len(y), 1)), y, off)
    b, se, ll1 = logistic_offset(A, y, off)
    out["D1_logit_features_given_sim"] = {
        "n": int(len(y)), "lr_chi2": round(2 * (ll1 - ll0), 2), "df": len(cols),
        "coef_per_sd": {c: {"b": round(float(bb), 4), "se": round(float(ss), 4)}
                        for c, bb, ss in zip(["const"] + list(cols), b, se)}}
    # D1b: what the simulator's components add to the logit
    C = D[["game_id"]].merge(component_logratios(G, params), on="game_id", how="left")
    cc = [c for c in C.columns if c != "game_id" and C[c].std() > 1e-9]   # home ice: constant
    Z = C[cc].to_numpy(float)
    sd = np.where(Z.std(0) > 0, Z.std(0), 1)
    A = np.column_stack([np.ones(len(Z)), (Z - Z.mean(0)) / sd])
    off = lgt(X["p_logit"])
    b0, _, ll0 = logistic_offset(np.ones((len(y), 1)), y, off)
    b, se, ll1 = logistic_offset(A, y, off)
    out["D1_sim_components_given_logit"] = {
        "n": int(len(y)), "lr_chi2": round(2 * (ll1 - ll0), 2), "df": len(cc),
        "component_sd_logratio": {c: round(float(s), 4) for c, s in zip(cc, sd)},
        "coef_per_sd": {c: {"b": round(float(bb), 4), "se": round(float(ss), 4)}
                        for c, bb, ss in zip(["const"] + cc, b, se)}}
    # D1c: each side's information alone, logit slope on logit p (mixing weights)
    A = np.column_stack([np.ones(len(y)), lgt(X["A_sim"]), lgt(X["p_logit"])])
    b, se, _ = logistic_offset(A, y, np.zeros(len(y)))
    out["D1_joint_logistic_on_both"] = {"const": [round(float(b[0]), 4), round(float(se[0]), 4)],
                                        "logit_p_sim": [round(float(b[1]), 4), round(float(se[1]), 4)],
                                        "logit_p_logit": [round(float(b[2]), 4), round(float(se[2]), 4)]}
    # D2: ablations of the raw simulator
    Gd = G[G["game_id"].astype("int64").isin(D["game_id"])].reset_index(drop=True)
    base = D.set_index("game_id")
    abl = {}
    for name, terms in ABLATIONS.items():
        p2 = json.loads(json.dumps(params))
        for grp, c in terms:
            p2["glm"]["beta"][grp][c] = 0.0
        path = os.path.join(work, f"abl_{name}.parquet")
        if os.path.exists(path):
            f = pd.read_parquet(path)
        else:
            f = frame(run(Gd, p2, None, workers=workers), "raw")[["game_id", "p_home"]]
            f.to_parquet(path, index=False)
        j = f.merge(base[["home_win", "A_sim", "season"]], left_on="game_id", right_index=True)
        yy = j["home_win"].to_numpy(float)
        abl[name] = {"log_loss": round(float(ll_vec(yy, j["p_home"]).mean()), 5),
                     "minus_full": paired(yy, j["p_home"], j["A_sim"]),
                     "sd_logit": round(float(lgt(j["p_home"]).std()), 4)}
        log(f"[primary] ablation {name}: LL {abl[name]['log_loss']} (vs full {abl[name]['minus_full']})")
    out["D2_ablations"] = abl
    return out


# ---------------------------------------------------------------------------- market (SiteHistory)

def market_comparison(D: pd.DataFrame) -> dict:
    import market
    import site_history as SH
    sh, _ = SH.load_keyed_site_history(allow_fetch=False)
    last = SH.last_pregame(sh).dropna(subset=["home_odds", "away_odds", "game_id"])
    last = last[(last["home_odds"].abs() >= 100) & (last["away_odds"].abs() >= 100)]
    last["game_id"] = last["game_id"].astype("int64")
    last["q"] = [market.devig([h, a])[0] for h, a in zip(last["home_odds"], last["away_odds"])]
    j = D.merge(last[["game_id", "q"]], on="game_id", how="inner")
    if j.empty:
        return {"n": 0}
    w = market.blend_weight()
    y = j["home_win"].to_numpy(float)
    out = {"n": int(len(j)), "first_date": str(j["game_date"].min())[:10] if "game_date" in j else None,
           "blend_weight": w, "market": ml_scores(y, j["q"])}
    for c in ["p_logit"] + [c for c in ("A_sim", "C1_avg", "C2_stack") if c in j]:
        pb = sig(w * lgt(j[c]) + (1 - w) * lgt(j["q"]))
        out[c] = {"model": ml_scores(y, j[c]), "blend": ml_scores(y, pb),
                  "model_minus_market": paired(y, j[c], j["q"]), "blend_minus_market": paired(y, pb, j["q"])}
        if c != "p_logit":
            pl = sig(w * lgt(j["p_logit"]) + (1 - w) * lgt(j["q"]))
            out[c]["blend_minus_logit_blend"] = paired(y, pb, pl)
    for c in list(out):
        if isinstance(out[c], dict):
            for k in list(out[c]):
                if isinstance(out[c][k], dict):
                    out[c][k].pop("reliability", None)
    return out


# ---------------------------------------------------------------------------- assemble

def game_set(work: str, seasons) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """(D: one row per scored game with p_logit / A_sim / C1 / T_gm / T_sim / home_win, G: their
    simulator inputs, act: outcomes)."""
    years = sorted({season_year(s) for s in seasons})
    oos = logit_oos(work, years)
    G = sim_inputs(work)
    G = G[G["season"].astype(str).isin(seasons) & (G["game_type"] == 2)]
    G = G[G["game_id"].astype("int64").isin(oos["game_id"])].reset_index(drop=True)
    act = V.actual_table(seasons)
    sim = pd.concat([raw_p(work, [s]) for s in seasons], ignore_index=True)
    D = oos.rename(columns={"p_model": "p_logit"}).merge(sim, on="game_id", how="inner")
    D = D[D["game_id"].isin(G["game_id"].astype("int64"))]
    D = D.merge(act[["game_id", "season", "home_win", "game_date"]].rename(columns={"season": "season_s"}),
                on="game_id", how="inner")
    D["season"] = D["season_s"].astype(str)
    D = D.drop(columns=["season_s"])
    D["home_win"] = D["home_win"].astype(float)
    D["A_sim"] = D["p_sim"]
    D["C1_avg"] = sig(0.5 * lgt(D["p_sim"]) + 0.5 * lgt(D["p_logit"]))
    G = G[G["game_id"].astype("int64").isin(D["game_id"])].reset_index(drop=True)
    return D.sort_values("game_id").reset_index(drop=True), G, act


def add_c2(work: str, D: pd.DataFrame, years) -> pd.DataFrame:
    seasons_needed = sorted({f"{y}{y + 1}" for y in range(2022, max(years) + 1)})
    sim_all = pd.concat([raw_p(work, [s]) for s in seasons_needed], ignore_index=True)
    sim_all["sim_logit"] = lgt(sim_all["p_sim"])
    c2 = logit_oos(work, years, extra=sim_all, tag="C2")
    return D.merge(c2[["game_id", "p_model"]].rename(columns={"p_model": "C2_stack"}), on="game_id", how="left")


def totals_frames(work, D, G, params, workers, extra_p=None, tag="dev"):
    path = os.path.join(work, f"totals_{tag}.pkl")
    if os.path.exists(path):
        return pd.read_pickle(path)
    tg = {}
    for r in D.itertuples(index=False):
        t = {"p_logit": float(r.p_logit), "T_gm": float(r.T_gm)}
        if extra_p:
            t["extra_p"] = {k: float(getattr(r, col)) for k, col in extra_p.items()}
        tg[int(r.game_id)] = t
    t0 = time.time()
    res = run(G, params, tg, workers=workers)
    names = list(PAIRINGS) + [f"{k}_{t}" for k in (extra_p or {}) for t in ("gm", "sim")]
    frames = {"raw": frame(res, "raw")}
    frames.update({k: frame(res, k) for k in names})
    frames["sim_sim"] = frames["raw"]
    pd.to_pickle(frames, path)
    errs = {k: float(np.nanmax(np.abs(f["anchor_p_err"]))) for k, f in frames.items() if "anchor_p_err" in f}
    log(f"[primary] totals frames {tag}: {len(res)} games in {time.time() - t0:.0f}s; max |p err| {errs}")
    return frames


def _report(section, payload):
    V._report(section, payload)


def cmd_dev(work, workers):
    params = load_params()
    D, G, act = game_set(work, DEV)
    D = add_c2(work, D, [2023, 2024])
    log(f"[primary] dev games: {len(D)} ({D.groupby('season').size().to_dict()})")
    cands = ["A_sim", "C1_avg", "C2_stack"]
    ml = ml_table(D, cands, DEV)
    pooled = ml["pooled"]
    for c in ["B_logit"] + cands:
        log(f"[primary] dev pooled {c}: LL {pooled[c]['log_loss']} Brier {pooled[c]['brier']} "
            f"slope {pooled[c]['cal_slope']}" + (f"  diff {pooled[c + '_minus_B']}" if c != "B_logit" else ""))
    c1, c2 = pooled["C1_avg"]["log_loss"], pooled["C2_stack"]["log_loss"]
    stacked = "C1_avg" if c1 <= c2 + TIE_C else "C2_stack"
    dev_pass = {c: bool(pooled[c]["log_loss"] < pooled["B_logit"]["log_loss"]) for c in cands}
    frames = totals_frames(work, D, G, params, workers, extra_p={"c2": "C2_stack"}, tag="dev")
    tot = totals_table(frames, act, DEV)
    diag = diagnostics(work, D, G, params, workers)
    D.to_parquet(os.path.join(work, "primary_dev_games.parquet"), index=False)
    payload = {"prereg": "bu/sim/prereg_primary.json", "seasons": DEV, "n_games": int(len(D)), "n_sims": N_SIMS,
               "ml": ml, "stacked_choice": stacked, "dev_pass": dev_pass, "totals": tot, "diagnostics": diag,
               "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    _report("primary_dev", payload)
    log(f"[primary] dev pass {dev_pass}; stacked choice {stacked}")
    return payload


def _looked() -> bool:
    if not os.path.exists(V.LOOK_LOG):
        return False
    with open(V.LOOK_LOG) as f:
        return any(json.loads(l).get("question") == QUESTION for l in f if l.strip())


def cmd_holdout(work, workers):
    rep = json.load(open(V.REPORT))
    if "primary_dev" not in rep:
        raise SystemExit("run `dev` first")
    if _looked():
        raise SystemExit(f"the {HOLDOUT} look for '{QUESTION}' has already been made ({V.LOOK_LOG}); one look only")
    dev = rep["primary_dev"]
    params = load_params()
    D, G, act = game_set(work, [HOLDOUT])
    D = add_c2(work, D, [2025])
    cands = ["A_sim", "C1_avg", "C2_stack"]
    ml = ml_table(D, cands, [HOLDOUT])[HOLDOUT]
    hold_ok = {c: bool(ml[f"{c}_minus_B"]["diff"] <= PASS_MARGIN) for c in cands}
    passes = {c: bool(dev["dev_pass"][c] and hold_ok[c]) for c in cands}
    if passes["A_sim"]:
        promoted = "A_sim"
    elif passes[dev["stacked_choice"]]:
        promoted = dev["stacked_choice"]
    else:
        promoted = None
    frames = totals_frames(work, D, G, params, workers, extra_p={"c2": "C2_stack"}, tag="holdout")
    tot = totals_table(frames, act, [HOLDOUT])[HOLDOUT]
    key = {"A_sim": "sim", "C1_avg": "c1", "C2_stack": "c2", None: "logit"}[promoted]
    dev_t = dev["totals"]["pooled"]
    t_dev_ok = dev_t[f"{key}_sim"]["total_score"] < dev_t[f"{key}_gm"]["total_score"]
    t_hold = tot[f"{key}: T_sim_minus_T_gm"]["diff"]
    use_sim_total = bool(t_dev_ok and t_hold <= PASS_MARGIN)
    mk = market_comparison(D)
    with open(V.LOOK_LOG, "a") as f:
        f.write(json.dumps({"season": HOLDOUT, "question": QUESTION,
                            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                            "version": params.get("version"), "n_games": int(len(D)),
                            "promoted": promoted, "use_sim_total": use_sim_total}) + "\n")
    payload = {"prereg": "bu/sim/prereg_primary.json", "season": HOLDOUT, "n_games": int(len(D)), "n_sims": N_SIMS,
               "ml": ml, "holdout_ok": hold_ok, "passes": passes, "promoted": promoted,
               "totals": tot, "totals_pairing": key, "totals_dev_ok": bool(t_dev_ok),
               "use_sim_total": use_sim_total, "market": mk,
               "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    _report("primary_holdout", payload)
    D.to_parquet(os.path.join(work, "primary_holdout_games.parquet"), index=False)
    log(f"[primary] holdout: {json.dumps({c: ml[c + '_minus_B'] for c in cands})}")
    log(f"[primary] passes {passes} -> promoted {promoted}; sim total {use_sim_total} (dev ok {t_dev_ok}, "
        f"holdout diff {t_hold})")
    return payload


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bu.sim.primary")
    ap.add_argument("cmd", choices=["dev", "holdout"])
    ap.add_argument("--work", required=True)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args(argv)
    t0 = time.time()
    (cmd_dev if a.cmd == "dev" else cmd_holdout)(a.work, a.workers)
    log(f"[primary] done in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
