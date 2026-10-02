"""Calibration and validation of the game simulator against actual outcomes.

    cd pipeline
    python -m bu.sim.validate dispersion --work <dir>   # fit seasons: pace / team shocks, scale
    python -m bu.sim.validate dev --work <dir>          # dev seasons: variants + rules (prereg.json)
    python -m bu.sim.validate holdout --work <dir>      # the single 2025-26 look (logged)

Rules are pre-declared in ``bu/sim/prereg.json`` (written before any dev / holdout run).
Reports: ``bu/sim/out/validation.json`` (+ ``look_log.jsonl`` for the holdout look).

Markets scored per game (log loss, Brier, reliability):
  ml        P(home wins, OT / SO included)
  reg3      regulation 3-way (home / tie / away)
  pl_home   home -1.5 (final margin >= 2, shootout goal included);  pl_away  away -1.5
  tot55 / tot65   P(over 5.5 / 6.5);  tot60  over / push / under 6.0 (3-class), tot60_2w over | no push
  p1_3w     1st period 3-way;  p1_2w  1st period 2-way, ties refunded (scored on non-tied periods)
Naive baseline: ``goal_model``'s independent Poisson with the same win % and expected total.
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
from . import data as D
from . import engine as EN
from . import markets as MK
from . import rates as RT
from .params import OUT_DIR, load_params, save_params

HERE = os.path.dirname(os.path.abspath(__file__))
PREREG = os.path.join(HERE, "prereg.json")
REPORT = os.path.join(OUT_DIR, "validation.json")
LOOK_LOG = os.path.join(OUT_DIR, "look_log.jsonl")
FIT_SEASONS = ["20172018", "20182019", "20192020", "20202021", "20212022", "20222023"]
DEV_SEASONS = ["20232024", "20242025"]
HOLDOUT = "20252026"
DERIVATIVE = ["reg3", "pl_home", "pl_away", "tot55", "tot60", "tot65", "p1_3w", "p1_2w"]
EPS = 1e-6
STRETCH_GRID = (1.0, 1.25, 1.5, 1.75)
TILT_GRID = (0.0, 0.1, 0.2)
PACE_GRID = (0.0, 30.0)


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------------------- simulation pool

_W = {}


def _init(params):
    _W["params"] = params
    _W["S"] = EN.Structure(params["structural"], params.get("dispersion"))


def _summ(s: dict) -> dict:
    out = {k: v for k, v in s.items() if not k.endswith("_hist")}
    out["total_hist"] = [round(float(x), 6) for x in s["total_hist"]]
    out["margin_hist"] = [round(float(x), 6) for x in s["margin_hist"]]
    return out


def _work(task):
    rows, n, seed, anchor_targets = task
    params, S = _W["params"], _W["S"]
    g = pd.DataFrame(rows)
    R = RT.build_rates(g, params)
    out = []
    for i in range(len(g)):
        gid = int(g["game_id"].iloc[i])
        o = EN.simulate_game(R, i, S, n, EN.game_seed(seed, gid))
        rec = {"game_id": gid, "raw": _summ(MK.summarize(o))}
        if anchor_targets is not None:
            pt, tt = anchor_targets[i]
            if pt is not None and np.isfinite(pt) and np.isfinite(tt):
                o2, w, info = AN.anchor_game(R, i, S, n, EN.game_seed(seed, gid), pt, tt, o=o)
                rec["anchored"] = _summ(MK.summarize(o2, w=w))
                rec["anchor_info"] = info
        out.append(rec)
    return out


def run_sims(G: pd.DataFrame, params: dict, n: int = 20000, seed: int = 20261002, targets=None,
             workers: int = 8, chunk: int = 40) -> list:
    cols = list(G.columns)
    tasks = []
    for s in range(0, len(G), chunk):
        sub = G.iloc[s:s + chunk]
        rows = sub[cols].to_dict("records")
        tg = None
        if targets is not None:
            tg = [targets.get(int(gid), (None, None)) for gid in sub["game_id"]]
        tasks.append((rows, n, seed, tg))
    ctx = get_context("fork")
    with ctx.Pool(workers, initializer=_init, initargs=(params,)) as pool:
        res = pool.map(_work, tasks)
    return [r for part in res for r in part]


# ---------------------------------------------------------------------------- naive Poisson

def naive_summary(p_home: float, total: float) -> dict:
    """goal_model's independent-Poisson game with this win % and expected total."""
    import goal_model as GM
    from scipy.stats import poisson
    lh, la = GM.goal_rates(p_home, total)
    ot = GM._coeff("ot_decided_share")
    k = np.arange(GM.N_MAX + 1)
    ph, pa = poisson.pmf(k, lh), poisson.pmf(k, la)
    J = np.outer(ph, pa)
    i, j = np.meshgrid(k, k, indexing="ij")
    reg_h, reg_t, reg_a = J[i > j].sum(), J[i == j].sum(), J[i < j].sum()
    r = lh / (lh + la)
    p_ot_home = 0.5 + ot * (r - 0.5)
    out = {"p_home": reg_h + reg_t * p_ot_home, "reg_home": reg_h, "reg_tie": reg_t, "reg_away": reg_a,
           "pl_home_m15": J[i - j >= 2].sum(), "pl_away_m15": J[j - i >= 2].sum()}
    # final total: regulation total + 1 when tied (an OT or shootout goal)
    tot = np.zeros(2 * GM.N_MAX + 2)
    for a in range(GM.N_MAX + 1):
        for b in range(GM.N_MAX + 1):
            tot[a + b + (1 if a == b else 0)] += J[a, b]
    for L in MK.TOTAL_LINES:
        key = MK.line_key(L)
        x = np.arange(len(tot))
        out[f"over_{key}"] = tot[x > L].sum()
        out[f"under_{key}"] = tot[x < L].sum()
        out[f"push_{key}"] = tot[x == L].sum()
    q1h, q1a = poisson.pmf(k, lh / 3), poisson.pmf(k, la / 3)
    J1 = np.outer(q1h, q1a)
    out["p1_home"], out["p1_tie"], out["p1_away"] = J1[i > j].sum(), J1[i == j].sum(), J1[i < j].sum()
    out["p1_home_2w"] = out["p1_home"] / (out["p1_home"] + out["p1_away"])
    out["exp_total"] = float((np.arange(len(tot)) * tot).sum())
    th = np.zeros(16)
    for x, pr in enumerate(tot):
        th[min(x, 15)] += pr
    out["total_hist"] = list(th)
    mh = np.zeros(15)
    for a in range(GM.N_MAX + 1):
        for b in range(GM.N_MAX + 1):
            m = a - b
            if m == 0:
                mh[7 + 1] += J[a, b] * p_ot_home
                mh[7 - 1] += J[a, b] * (1 - p_ot_home)
            else:
                mh[int(np.clip(m, -7, 7)) + 7] += J[a, b]
    out["margin_hist"] = list(mh)
    out["exp_p1_total"] = (lh + la) / 3
    return {k2: float(v) if not isinstance(v, list) else v for k2, v in out.items()}


# ---------------------------------------------------------------------------- scoring

def actual_table(seasons) -> pd.DataFrame:
    o = pd.concat([D.outcomes(s) for s in seasons], ignore_index=True)
    o["total"] = o["home_score"] + o["away_score"]
    o["margin"] = o["home_score"] - o["away_score"]
    o["reg3"] = np.where(o["reg_h"] > o["reg_a"], 0, np.where(o["reg_h"] == o["reg_a"], 1, 2))
    o["p1"] = np.where(o["p1_h"] > o["p1_a"], 0, np.where(o["p1_h"] == o["p1_a"], 1, 2))
    return o


def _bin_ll(p, y):
    p = np.clip(np.asarray(p, float), EPS, 1 - EPS)
    y = np.asarray(y, float)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def market_losses(pred: pd.DataFrame, act: pd.DataFrame) -> pd.DataFrame:
    """Per-game log loss and Brier of every market (NaN where a market does not apply)."""
    d = pred.merge(act, on="game_id", how="inner")
    out = pd.DataFrame({"game_id": d["game_id"], "season": d["season"]})

    def binary(name, p, y, mask=None):
        ll = _bin_ll(p, y)
        br = (np.asarray(p, float) - np.asarray(y, float)) ** 2
        if mask is not None:
            ll = np.where(mask, ll, np.nan)
            br = np.where(mask, br, np.nan)
        out[f"{name}_ll"], out[f"{name}_brier"] = ll, br
        out[f"{name}_p"] = np.where(mask, p, np.nan) if mask is not None else p
        out[f"{name}_y"] = np.where(mask, y, np.nan) if mask is not None else y

    def multi(name, P, y):
        P = np.clip(np.asarray(P, float), EPS, 1)
        P = P / P.sum(axis=1, keepdims=True)
        out[f"{name}_ll"] = -np.log(P[np.arange(len(P)), y])
        Y = np.zeros_like(P)
        Y[np.arange(len(P)), y] = 1
        out[f"{name}_brier"] = ((P - Y) ** 2).sum(axis=1)

    binary("ml", d["p_home"], d["home_win"].astype(float))
    multi("reg3", d[["reg_home", "reg_tie", "reg_away"]].to_numpy(), d["reg3"].to_numpy())
    binary("pl_home", d["pl_home_m15"], (d["margin"] >= 2).astype(float))
    binary("pl_away", d["pl_away_m15"], (d["margin"] <= -2).astype(float))
    binary("tot55", d["over_5_5"], (d["total"] > 5.5).astype(float))
    binary("tot65", d["over_6_5"], (d["total"] > 6.5).astype(float))
    y60 = np.where(d["total"] > 6, 0, np.where(d["total"] == 6, 1, 2))
    multi("tot60", d[["over_6_0", "push_6_0", "under_6_0"]].to_numpy(), y60)
    nop = d["total"] != 6
    p2 = d["over_6_0"] / np.maximum(d["over_6_0"] + d["under_6_0"], EPS)
    binary("tot60_2w", p2, (d["total"] > 6).astype(float), mask=nop.to_numpy())
    multi("p1_3w", d[["p1_home", "p1_tie", "p1_away"]].to_numpy(), d["p1"].to_numpy())
    binary("p1_2w", d["p1_home_2w"], (d["p1"] == 0).astype(float), mask=(d["p1"] != 1).to_numpy())
    return out


def reliability(p, y, bins=10) -> list:
    p, y = np.asarray(p, float), np.asarray(y, float)
    m = np.isfinite(p) & np.isfinite(y)
    p, y = p[m], y[m]
    if not len(p):
        return []
    q = np.quantile(p, np.linspace(0, 1, bins + 1))
    idx = np.clip(np.searchsorted(q, p, side="right") - 1, 0, bins - 1)
    rows = []
    for b in range(bins):
        s = idx == b
        if s.sum():
            rows.append({"n": int(s.sum()), "pred": round(float(p[s].mean()), 4), "obs": round(float(y[s].mean()), 4)})
    return rows


def calib_slope(p, y):
    """Logistic recalibration slope / intercept of y on logit(p)."""
    p, y = np.asarray(p, float), np.asarray(y, float)
    m = np.isfinite(p) & np.isfinite(y)
    p, y = np.clip(p[m], EPS, 1 - EPS), y[m]
    x = np.log(p / (1 - p))
    X = np.column_stack([np.ones_like(x), x])
    b = np.array([0.0, 1.0])
    for _ in range(50):
        mu = 1 / (1 + np.exp(-(X @ b)))
        W = mu * (1 - mu)
        nb = b + np.linalg.solve(X.T @ (X * W[:, None]) + 1e-9 * np.eye(2), X.T @ (y - mu))
        if np.max(np.abs(nb - b)) < 1e-10:
            b = nb
            break
        b = nb
    return float(b[1]), float(b[0])


def summarize_losses(L: pd.DataFrame, markets=None) -> dict:
    markets = markets or ["ml", "reg3", "pl_home", "pl_away", "tot55", "tot60", "tot60_2w", "tot65", "p1_3w", "p1_2w"]
    out = {}
    for m in markets:
        ll = L[f"{m}_ll"].dropna()
        br = L[f"{m}_brier"].dropna()
        rec = {"n": int(len(ll)), "log_loss": round(float(ll.mean()), 5), "brier": round(float(br.mean()), 5)}
        if f"{m}_p" in L:
            p, y = L[f"{m}_p"], L[f"{m}_y"]
            s, c = calib_slope(p, y)
            rec.update({"cal_slope": round(s, 3), "cal_int": round(c, 3), "mean_p": round(float(np.nanmean(p)), 4),
                        "mean_y": round(float(np.nanmean(y)), 4), "reliability": reliability(p, y)})
        out[m] = rec
    out["derivative_ll_sum"] = round(float(sum(out[m]["log_loss"] for m in DERIVATIVE if m in out)), 5)
    return out


def paired(La: pd.DataFrame, Lb: pd.DataFrame, markets=None) -> dict:
    """Mean per-game log-loss difference a - b with a game-level SE (negative favours a)."""
    markets = markets or ["ml"] + DERIVATIVE + ["tot60_2w"]
    j = La.merge(Lb, on="game_id", suffixes=("_a", "_b"))
    out = {}
    for m in markets:
        d = (j[f"{m}_ll_a"] - j[f"{m}_ll_b"]).dropna()
        out[m] = {"diff": round(float(d.mean()), 5), "se": round(float(d.std(ddof=1) / math.sqrt(max(len(d), 1))), 5),
                  "n": int(len(d))}
    dsum = sum((j[f"{m}_ll_a"].fillna(0) - j[f"{m}_ll_b"].fillna(0)) for m in DERIVATIVE)
    out["derivative_sum"] = {"diff": round(float(dsum.mean()), 5),
                             "se": round(float(dsum.std(ddof=1) / math.sqrt(len(dsum))), 5), "n": int(len(dsum))}
    return out


def distribution_checks(pred: pd.DataFrame, act: pd.DataFrame) -> dict:
    d = pred.merge(act, on="game_id", how="inner")
    th = np.mean(np.stack(d["total_hist"].to_numpy()), axis=0)
    mh = np.mean(np.stack(d["margin_hist"].to_numpy()), axis=0)
    at = np.bincount(np.minimum(d["total"].to_numpy(), 15), minlength=16) / len(d)
    am = np.bincount(np.clip(d["margin"].to_numpy() + 7, 0, 14), minlength=15) / len(d)
    out = {"n": int(len(d)),
           "total_hist": {"sim": [round(float(x), 4) for x in th], "actual": [round(float(x), 4) for x in at]},
           "margin_hist": {"sim": [round(float(x), 4) for x in mh], "actual": [round(float(x), 4) for x in am]},
           "mean_total": {"sim": round(float(d["exp_total"].mean()), 3), "actual": round(float(d["total"].mean()), 3)},
           "tie_after_reg": {"sim": round(float(d["reg_tie"].mean()), 4),
                             "actual": round(float((d["reg_h"] == d["reg_a"]).mean()), 4)},
           "p1_share": {"sim": round(float(d["exp_p1_total"].mean() / max(d["exp_reg_total"].mean(), EPS)), 4)
                        if "exp_reg_total" in d else None,
                        "actual": round(float((d["p1_h"] + d["p1_a"]).sum() / (d["reg_h"] + d["reg_a"]).sum()), 4)},
           "sd_total": {"sim": round(float(np.sqrt(np.sum(th * (np.arange(16) - (th * np.arange(16)).sum()) ** 2))), 3),
                        "actual": round(float(d["total"].std()), 3)}}
    if "exp_en" in d:
        out["en_goals_per_game"] = {"sim": round(float(d["exp_en"].mean()), 4),
                                    "actual": round(float((d["en_h"] + d["en_a"]).mean()), 4)}
    if "p_ot" in d:
        out["ot_share_of_ties"] = {"sim": round(float(d["p_ot"].mean() / max(d["reg_tie"].mean(), EPS)), 4),
                                   "actual": round(float((d["decision"] == "OT").sum() /
                                                         max((d["reg_h"] == d["reg_a"]).sum(), 1)), 4)}
    return out


def to_frame(res: list, key: str = "raw") -> pd.DataFrame:
    rows = []
    for r in res:
        if key in r:
            rows.append({"game_id": r["game_id"], **r[key]})
    return pd.DataFrame(rows)


def naive_frame(pred: pd.DataFrame, p_col="p_home", t_col="exp_total") -> pd.DataFrame:
    rows = []
    for gid, p, t in zip(pred["game_id"], pred[p_col], pred[t_col]):
        rows.append({"game_id": gid, **naive_summary(float(p), float(t))})
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------- inputs

def history_inputs(work: str) -> pd.DataFrame:
    return pd.read_parquet(os.path.join(work, "history_inputs.parquet"))


def game_model_targets(work: str) -> pd.DataFrame:
    """Walk-forward OOS probability of the live game model's feature set (2023-24, 2024-25,
    2025-26 folds) and goal_model's expected total for each game: the 'published model' the
    anchored variant matches (history has no market prices to blend with)."""
    p = os.path.join(work, "game_model_oos.parquet")
    if os.path.exists(p):
        return pd.read_parquet(p)
    import goal_model as GM
    import train_game_model as T
    cols, meta = T.live_feature_columns()
    M, _ = T.build_matrix()
    folds, oos = T.walk_forward(M, cols)          # C tuned inside each fold's training seasons
    oos = oos.merge(M[["game_id", "pace"]], on="game_id", how="left")
    oos["exp_total"] = [GM.expected_total(lg, pc) for lg, pc in zip(oos["league_gpg"], oos["pace"])]
    oos = oos[["game_id", "season", "p_model", "exp_total"]].copy()
    oos["game_id"] = oos["game_id"].astype("int64")
    oos.to_parquet(p, index=False)
    log(f"[validate] game model walk-forward: {len(oos)} games, folds "
        + ", ".join(f"{f['test_season']}: LL {f['log_loss']:.4f}" for f in folds))
    return oos


def select(G: pd.DataFrame, seasons, regular=True) -> pd.DataFrame:
    m = G["season"].astype(str).isin(seasons)
    if regular:
        m &= G["game_type"] == 2
    return G[m & RT.finite_inputs(G)].reset_index(drop=True)


# ---------------------------------------------------------------------------- commands

def cmd_dispersion(work: str, n: int, workers: int) -> dict:
    """Fit seasons: overall scale (mean total), then the pace / team shock shapes by the summed
    log-likelihood of the final total, final margin, regulation 3-way and moneyline
    (prereg.json rule 'dispersion')."""
    params = load_params()
    G = select(history_inputs(work), FIT_SEASONS)
    act = actual_table(FIT_SEASONS)
    params["dispersion"] = {"k_game": 0.0, "k_team": 0.0, "sd_tilt": 0.0, "scale": 1.0, "stretch": 1.0}
    res = to_frame(run_sims(G, params, n=n, workers=workers))
    a = act.set_index("game_id").loc[res["game_id"]]
    scale = float(a["total"].mean() / res["exp_total"].mean())
    log(f"[dispersion] scale {scale:.4f} (sim mean total {res['exp_total'].mean():.3f}, actual {a['total'].mean():.3f})")

    def crit(r):
        d = r.merge(act, on="game_id")
        th = np.stack(d["total_hist"].to_numpy())
        mh = np.stack(d["margin_hist"].to_numpy())
        ti = np.minimum(d["total"].to_numpy(), 15)
        mi = np.clip(d["margin"].to_numpy() + 7, 0, 14)
        ll = np.log(np.clip(th[np.arange(len(d)), ti], 1e-4, 1)) + np.log(np.clip(mh[np.arange(len(d)), mi], 1e-4, 1))
        L = market_losses(r, act)
        return float(ll.mean() - L["reg3_ll"].mean() - L["ml_ll"].mean())

    grid = []
    best = None
    for st in STRETCH_GRID:
        for sd in TILT_GRID:
            for kg in PACE_GRID:
                params["dispersion"] = {"k_game": kg, "k_team": 0.0, "sd_tilt": sd, "scale": scale, "stretch": st}
                r = to_frame(run_sims(G, params, n=n, workers=workers))
                c = crit(r)
                dc = distribution_checks(r, act)
                grid.append({"stretch": st, "sd_tilt": sd, "k_game": kg, "crit": round(c, 5),
                             "sd_total": dc["sd_total"], "mean_total": dc["mean_total"],
                             "tie_after_reg": dc["tie_after_reg"]})
                log(f"[dispersion] stretch {st} sd_tilt {sd} k_game {kg}: crit {c:.5f} sd_total {dc['sd_total']} "
                    f"tie {dc['tie_after_reg']}")
                if best is None or c > best[0]:
                    best = (c, kg, sd, st)
    params["dispersion"] = {"k_game": best[1], "k_team": 0.0, "sd_tilt": best[2], "scale": scale, "stretch": best[3]}
    r = to_frame(run_sims(G, params, n=n, workers=workers))
    scale2 = scale * float(act.set_index("game_id").loc[r["game_id"]]["total"].mean() / r["exp_total"].mean())
    params["dispersion"] = {"k_game": best[1], "k_team": 0.0, "sd_tilt": best[2], "stretch": best[3],
                            "scale": round(scale2, 5),
                            "grid": grid, "seasons": FIT_SEASONS, "n_sims": n,
                            "criterion": "mean log P(final total) + log P(final margin) - LL(reg 3-way) - LL(ML), fit seasons"}
    save_params(params)
    log(f"[dispersion] chosen stretch {best[3]} sd_tilt {best[2]} k_game {best[1]} scale {scale2:.4f}")
    return params["dispersion"]


def _no_b2b(params: dict) -> dict:
    p = json.loads(json.dumps(params))
    for c in ("b2b", "b2b_opp"):
        p["glm"]["beta"]["ev"][c] = 0.0
    return p


def _targets(work: str, seasons) -> dict:
    oos = game_model_targets(work)
    oos = oos[oos["season"].astype(str).isin([s[:4] for s in seasons]) | oos["season"].astype(str).isin(seasons)]
    return {int(g): (float(p), float(t)) for g, p, t in zip(oos["game_id"], oos["p_model"], oos["exp_total"])}


def evaluate(G: pd.DataFrame, params: dict, act: pd.DataFrame, targets: dict, n: int, workers: int,
             with_anchor: bool = True) -> dict:
    """Raw / anchored simulator frames + the matching naive Poisson frames, restricted to games
    that have an anchoring target (the comparisons are on the same games)."""
    G = G[G["game_id"].astype(int).isin(targets)].reset_index(drop=True)
    res = run_sims(G, params, n=n, workers=workers, targets=targets if with_anchor else None)
    raw = to_frame(res, "raw")
    out = {"raw": raw, "naive_raw": naive_frame(raw)}
    if with_anchor:
        anc = to_frame(res, "anchored")
        tg = pd.DataFrame([{"game_id": g, "p_home": p, "exp_total": t} for g, (p, t) in targets.items()])
        tg = tg[tg["game_id"].isin(anc["game_id"])]
        out["anchored"] = anc
        out["naive_anchored"] = naive_frame(tg)
        info = [r["anchor_info"] for r in res if "anchor_info" in r]
        out["anchor_info"] = {"n": len(info), "max_abs_p_err": float(max(abs(i["p_err"]) for i in info)),
                              "max_abs_t_err": float(max(abs(i["t_err"]) for i in info)),
                              "resim_share": float(np.mean([i["resim"] for i in info])),
                              "mean_ess": float(np.mean([i["ess"] for i in info])),
                              "tilt_sd": float(np.std([i["tilt"] for i in info])),
                              "pace_mean": float(np.mean([i["pace"] for i in info]))}
    return out


def _season_table(frames: dict, act: pd.DataFrame, seasons) -> dict:
    out = {}
    for s in seasons + ["pooled"]:
        a = act if s == "pooled" else act[act["season"].astype(str) == s]
        rec = {}
        for k, f in frames.items():
            if not isinstance(f, pd.DataFrame):
                continue
            L = market_losses(f, a)
            rec[k] = summarize_losses(L)
        if "raw" in frames and "naive_raw" in frames:
            rec["raw_vs_naive"] = paired(market_losses(frames["raw"], a), market_losses(frames["naive_raw"], a))
        if "anchored" in frames and "naive_anchored" in frames:
            rec["anchored_vs_naive"] = paired(market_losses(frames["anchored"], a),
                                              market_losses(frames["naive_anchored"], a))
            rec["anchored_vs_raw"] = paired(market_losses(frames["anchored"], a), market_losses(frames["raw"], a))
        rec["distribution"] = {k: distribution_checks(f, a) for k, f in frames.items()
                               if isinstance(f, pd.DataFrame) and "total_hist" in f}
        out[s] = rec
    return out


def _report(section: str, payload: dict) -> None:
    rep = {}
    if os.path.exists(REPORT):
        with open(REPORT) as f:
            rep = json.load(f)
    rep[section] = payload
    rep["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w") as f:
        json.dump(rep, f, indent=1, default=float)
        f.write("\n")


def cmd_dev(work: str, n: int, workers: int) -> dict:
    """Dev seasons: the rest rule, then the anchoring rule (prereg.json), applied in that order."""
    params = load_params()
    if not params.get("dispersion"):
        raise SystemExit("run `dispersion` first")
    G = select(history_inputs(work), DEV_SEASONS)
    act = actual_table(DEV_SEASONS)
    targets = _targets(work, DEV_SEASONS)
    # rule 'rest': raw simulator with vs without the back-to-back terms
    with_b2b = evaluate(G, params, act, targets, n, workers, with_anchor=False)["raw"]
    no_b2b = evaluate(G, _no_b2b(params), act, targets, n, workers, with_anchor=False)["raw"]

    def score(f):
        s = summarize_losses(market_losses(f, act))
        return s["ml"]["log_loss"] + s["derivative_ll_sum"]
    s_with, s_without = score(with_b2b), score(no_b2b)
    keep_b2b = s_with < s_without
    log(f"[dev] rest rule: ML + derivative score with b2b {s_with:.5f}, without {s_without:.5f} -> "
        f"{'keep' if keep_b2b else 'drop'}")
    if not keep_b2b:
        params = _no_b2b(params)
    params["rest"] = {"keep_b2b": bool(keep_b2b), "score_with": round(s_with, 5), "score_without": round(s_without, 5),
                      "paired_with_minus_without": paired(market_losses(with_b2b, act), market_losses(no_b2b, act))}
    # rule 'anchoring'
    fr = evaluate(G, params, act, targets, n, workers, with_anchor=True)
    pooled_raw = summarize_losses(market_losses(fr["raw"], act))["derivative_ll_sum"]
    pooled_anc = summarize_losses(market_losses(fr["anchored"], act))["derivative_ll_sum"]
    diff = pooled_anc - pooled_raw
    variant = "anchored" if diff < 0.0005 else "raw"
    log(f"[dev] anchoring rule: derivative score raw {pooled_raw:.5f}, anchored {pooled_anc:.5f} -> {variant}")
    params["anchor"] = {"variant": variant, "dev_derivative_score": {"raw": pooled_raw, "anchored": pooled_anc},
                        "rule": "lower dev derivative score; ties (< 0.0005) to anchored", "info": fr["anchor_info"]}
    params["version"] = f"sim-m5-{datetime.now(timezone.utc).strftime('%Y%m%d')}"
    save_params(params)
    frames = {k: v for k, v in fr.items() if isinstance(v, pd.DataFrame)}
    payload = {"seasons": DEV_SEASONS, "n_sims": n, "n_games": int(len(fr["raw"])),
               "rest": params["rest"], "anchor": params["anchor"],
               "by_season": _season_table(frames, act, DEV_SEASONS)}
    _report("dev", payload)
    return payload


def cmd_holdout(work: str, n: int, workers: int) -> dict:
    """The single 2025-26 look (prereg 'holdout'): refused when the log already has one."""
    params = load_params()
    if not params.get("anchor"):
        raise SystemExit("run `dev` first: the configuration must be fixed before the holdout look")
    if os.path.exists(LOOK_LOG):
        with open(LOOK_LOG) as f:
            if any(json.loads(l).get("season") == HOLDOUT for l in f if l.strip()):
                raise SystemExit(f"the {HOLDOUT} holdout has already been looked at ({LOOK_LOG}); one look only")
    G = select(history_inputs(work), [HOLDOUT])
    act = actual_table([HOLDOUT])
    targets = _targets(work, [HOLDOUT])
    fr = evaluate(G, params, act, targets, n, workers, with_anchor=True)
    frames = {k: v for k, v in fr.items() if isinstance(v, pd.DataFrame)}
    payload = {"season": HOLDOUT, "n_sims": n, "n_games": int(len(fr["raw"])), "variant": params["anchor"]["variant"],
               "anchor_info": fr["anchor_info"], "by_season": _season_table(frames, act, [HOLDOUT])}
    with open(LOOK_LOG, "a") as f:
        f.write(json.dumps({"season": HOLDOUT, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                            "variant": params["anchor"]["variant"], "version": params.get("version"),
                            "n_games": payload["n_games"]}) + "\n")
    _report("holdout", payload)
    return payload


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bu.sim.validate")
    ap.add_argument("cmd", choices=["dispersion", "dev", "holdout"])
    ap.add_argument("--work", required=True)
    ap.add_argument("--n", type=int, default=20000)
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args(argv)
    t0 = time.time()
    if args.cmd == "dispersion":
        cmd_dispersion(args.work, args.n, args.workers)
    elif args.cmd == "dev":
        cmd_dev(args.work, args.n, args.workers)
    elif args.cmd == "holdout":
        cmd_holdout(args.work, args.n, args.workers)
    log(f"[validate] done in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
