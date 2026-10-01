"""DESIGN §3.2.2 stint-level, out-of-time validation and hyper-parameter tuning.

At ~7 as-of dates per season (first game + 14 days, then the 1st of each month), every model
is fitted on the season's stints available by that date (games up to ``LAG_DAYS`` before)
and predicts the attacking side's xG/60 of every EV stint row in the next 30 days.  The
score is the weighted (stint-seconds) MSE.  Models, all with the same covariates:

  const       league + covariates only (scale reference)
  team        (a) team O/D ridge, season to date                    lambda tuned
  flat        (b) player O/D ridge, no prior (classic RAPM)          lambda tuned
  prior_only  (c) players fixed at the prior mean, covariates fitted
  rapm        (d) RAPM v2: prior-informed generalized ridge          (v_new, kappa) tuned

The first season of the lake is a burn-in (no prior exists).  Hyper-parameters are chosen
on ``tune_seasons`` only and then frozen; the gate is "(d) beats (a), (b) and (c) on every
dev fold" (one-sided paired test by game reported alongside).  Each chain (one per
hyper-parameter setting) is rolled forward at every season end with that season's full
posterior, aging curves and rookie means fitted on earlier seasons only.
"""
from __future__ import annotations

import itertools
import json
import time

import numpy as np
import pandas as pd

from .aging import fit_aging
from .engine import SeasonData, fit_standalone, flat_prior
from .priors import Chain, Hyper, RookieModel
from .ridge import Gram

BIG = 1e12
N_BOOT = 2000


V_GRID = (0.01, 0.02, 0.03, 0.04)
K_GRID = (1.0, 1.25, 1.5, 2.5, 4.0, 6.0)   # 1.0/1.25 added in review: 1.5 was the grid edge
ABLATION_POINTS = ((0.02, 1.25), (0.02, 1.5), (0.03, 1.25))


def default_grid() -> list[Hyper]:
    grid = [Hyper(v_new=v, kappa=k) for v, k in itertools.product(V_GRID, K_GRID)]
    # ablations (DESIGN §3.2.1 components): no aging curve / no rookie mean, at the grid points
    # around the selected optimum (the full-lake runs select v0.02-0.03, kappa 1.25-1.5), so the
    # report can state each component's value at the chosen setting
    for v, k in ABLATION_POINTS:
        grid += [Hyper(v_new=v, kappa=k, use_aging=False), Hyper(v_new=v, kappa=k, use_rookie_mean=False)]
    return grid


FLAT_LAMS = (3600.0 * 5, 3600.0 * 10, 3600.0 * 20, 3600.0 * 40)
TEAM_LAMS = (3600.0 * 5, 3600.0 * 20, 3600.0 * 80)
COV_LAM = 3600.0 * 20


def _per_game(gid, w, e2):
    df = pd.DataFrame({"game_id": gid, "sse": w * e2, "sw": w})
    return df.groupby("game_id", sort=False).sum()


def run(paths, seasons: list[str], players: pd.DataFrame, grid=None, flat_lams=FLAT_LAMS, team_lams=TEAM_LAMS,
        source: str = "v1", log=print) -> dict:
    grid = grid or default_grid()
    chains = {h.key(): Chain(h) for h in grid}
    hypers = {h.key(): h for h in grid}
    standalone: dict[str, pd.DataFrame] = {}
    flat_cov_prev = None
    recs = []           # per (season, asof, model, game) sse / sw
    meta = {"aging": {}, "rookie": {}}
    for si, S in enumerate(seasons):
        t0 = time.time()
        sd = SeasonData.load(paths, S, source)
        aging = fit_aging(standalone, players, S)
        rookie = RookieModel.fit(standalone, players, S)
        meta["aging"][S] = aging.to_json()
        meta["rookie"][S] = rookie.to_json()
        priors = {k: c.prior(S, sd.idx, players, aging, rookie) for k, c in chains.items()}
        n = sd.idx.n
        if si > 0:
            g, gt = Gram(sd.idx.p), Gram(sd.tidx.p)
            ptr = 0
            for d in sd.asof_points():
                k = sd.upto(d)
                g.add(sd.X[ptr:k], sd.rows.y[ptr:k], sd.rows.w[ptr:k])
                gt.add(sd.Xt[ptr:k], sd.rows.y[ptr:k], sd.rows.w[ptr:k])
                ptr = k
                lo, hi = sd.window(d)
                if hi <= lo:
                    continue
                Xte, Xtte = sd.X[lo:hi], sd.Xt[lo:hi]
                y, w, gid = sd.rows.y[lo:hi], sd.rows.w[lo:hi], sd.rows.game_id[lo:hi]
                preds = {}
                b0, lam = flat_prior(sd.idx, BIG, COV_LAM, flat_cov_prev)
                preds["const"] = Xte @ g.solve(lam, b0)[0]
                for lf in flat_lams:
                    b0, lam = flat_prior(sd.idx, lf, COV_LAM, flat_cov_prev)
                    preds[f"flat|{lf:g}"] = Xte @ g.solve(lam, b0)[0]
                for lt in team_lams:
                    b0, lam = flat_prior(sd.tidx, lt, COV_LAM, flat_cov_prev)
                    preds[f"team|{lt:g}"] = Xtte @ gt.solve(lam, b0)[0]
                for key, (b0, lam, _new) in priors.items():
                    preds[f"rapm|{key}"] = Xte @ g.solve(lam, b0)[0]
                    lam_p = lam.copy()
                    lam_p[:2 * n] = BIG
                    preds[f"prior_only|{key}"] = Xte @ g.solve(lam_p, b0)[0]
                for m, p in preds.items():
                    pg = _per_game(gid, w, (y - p) ** 2)
                    recs.append(pd.DataFrame({"season": S, "asof": str(d), "model": m, "game_id": pg.index,
                                              "sse": pg["sse"].to_numpy(), "sw": pg["sw"].to_numpy()}))
        # season end: roll every chain forward with the full-season posterior
        G = sd.full_gram()
        for key, c in chains.items():
            b0, lam, _ = priors[key]
            b, inv = G.solve(lam, b0, want_inv=True)
            c.update(S, sd.idx, b, inv, G.sigma2(b), sd.toi, n_rows=len(sd.rows))
        standalone[S] = fit_standalone(sd, G)
        b0, lam = flat_prior(sd.idx, 3600.0 * 10, COV_LAM, flat_cov_prev)
        flat_cov_prev = G.solve(lam, b0)[0][2 * n:]
        log(f"  [validate] {S}: {len(sd.rows):,} rows, {n} skaters, {time.time() - t0:.0f}s")
    per_game = pd.concat(recs, ignore_index=True) if recs else pd.DataFrame()
    return {"per_game": per_game, "hypers": hypers, "meta": meta}


def _mse(df):
    return float(df["sse"].sum() / df["sw"].sum())


def paired(per_game: pd.DataFrame, a: str, b: str, seasons, seed: int = 7) -> dict:
    """MSE(b) - MSE(a) on the same (season, asof, game) cells; negative = b better."""
    x = per_game[per_game["season"].isin(seasons)]
    pa = x[x["model"] == a].set_index(["season", "asof", "game_id"])
    pb = x[x["model"] == b].set_index(["season", "asof", "game_id"])
    j = pa[["sse", "sw"]].join(pb[["sse"]], rsuffix="_b", how="inner")
    sw = j["sw"].sum()
    dd = (j["sse_b"] - j["sse"]).to_numpy()
    # cluster on game: one game can appear in two adjacent windows only at a boundary; sum by game
    by_game = pd.Series(dd, index=j.index.get_level_values("game_id")).groupby(level=0).sum().to_numpy()
    sw_g = j["sw"].groupby(level="game_id").sum().to_numpy()
    delta = float(by_game.sum() / sw)
    se = float(np.sqrt(len(by_game)) * by_game.std(ddof=1) / sw)
    rng = np.random.default_rng(seed)
    boots = np.empty(N_BOOT)
    for i in range(N_BOOT):
        s = rng.integers(0, len(by_game), len(by_game))
        boots[i] = by_game[s].sum() / sw_g[s].sum()
    return {"delta_mse": delta, "se": se, "z": delta / se if se > 0 else None,
            "upper95_one_sided": float(np.quantile(boots, 0.95)), "p_b_not_better": float((boots >= 0).mean()),
            "n_games": int(len(by_game))}


def summarize(res: dict, tune_seasons, dev_seasons, report_seasons) -> dict:
    pg = res["per_game"]
    tune = pg[pg["season"].isin(tune_seasons)]
    by_model_tune = {m: _mse(d) for m, d in tune.groupby("model")}

    def best(prefix, table=by_model_tune):
        c = {m: v for m, v in table.items() if m.startswith(prefix + "|")
             and (prefix != "rapm" or m.endswith("_a1_r1"))}
        return min(c, key=c.get) if c else None
    sel = {"team": best("team"), "flat": best("flat"), "rapm": best("rapm")}
    # DESIGN §3.2: the setting chosen on each tuning season alone must sit within one grid
    # step of the joint choice; otherwise the more regularised neighbour is preferred.
    stability = {}
    for S in tune_seasons:
        tS = {m: _mse(d) for m, d in pg[pg["season"] == S].groupby("model")}
        stability[S] = best("rapm", tS)
    stability_ok = all(_grid_steps(stability[S], sel["rapm"]) <= 1 for S in stability)
    sel["prior_only"] = "prior_only|" + sel["rapm"].split("|", 1)[1]
    sel["const"] = "const"
    folds = {}
    for S in report_seasons:
        x = pg[pg["season"] == S]
        if x.empty:
            continue
        mse = {name: _mse(x[x["model"] == m]) for name, m in sel.items()}
        f = {"role": "tuning" if S in tune_seasons else ("dev" if S in dev_seasons else "report"),
             "n_games": int(x["game_id"].nunique()), "n_asof": int(x["asof"].nunique()),
             "mse": mse, "skill_vs_const": {k: 1 - v / mse["const"] for k, v in mse.items()},
             "rapm_vs": {b: paired(pg, sel[b], sel["rapm"], [S]) for b in ("team", "flat", "prior_only", "const")},
             "by_asof": {}}
        for a, xa in x.groupby("asof"):
            ma = {name: _mse(xa[xa["model"] == m]) for name, m in sel.items()}
            f["by_asof"][a] = {k: round(v, 5) for k, v in ma.items()}
        f["rapm_beats_all"] = all(f["rapm_vs"][b]["delta_mse"] < 0 for b in ("team", "flat", "prior_only"))
        folds[S] = f
    gate_seasons = [s for s in dev_seasons if s in folds]
    gate = {"rule": "RAPM v2 (d) MSE < team-only (a), no-prior RAPM (b) and prior-only (c) on every dev fold",
            "dev_seasons": gate_seasons,
            "pass": bool(gate_seasons) and all(folds[s]["rapm_beats_all"] for s in gate_seasons)}
    ablations = {}
    full_key = sel["rapm"].split("|", 1)[1]
    for m in sorted({m for m in pg["model"].unique() if m.startswith("rapm|") and not m.endswith("_a1_r1")}):
        base = "rapm|" + m.split("|", 1)[1].replace("_a0_", "_a1_").replace("_r0", "_r1")
        ablations[m.split("|", 1)[1]] = {"vs": base.split("|", 1)[1], **{
            S: paired(pg, base, m, [S]) for S in report_seasons if S in folds}}
    return {"selected": sel, "selected_hyper": res["hypers"][sel["rapm"].split("|", 1)[1]].as_dict(),
            "tuning_mse": {k: round(v, 5) for k, v in sorted(by_model_tune.items(), key=lambda kv: kv[1])},
            "folds": folds, "gate": gate,
            "stability": {"per_tuning_season": stability, "within_one_step": stability_ok},
            "ablations": ablations, "selected_key": full_key,
            "ablations_at_selected": {k: v for k, v in ablations.items() if v["vs"] == full_key}}


def _grid_steps(a: str, b: str) -> int:
    """Grid distance between two rapm keys (max over v_new and kappa index differences)."""
    def parse(m):
        k = m.split("|", 1)[1]
        v = float(k.split("_")[0][1:]); kk = float(k.split("_")[1][1:])  # noqa: E702
        return (V_GRID.index(v) if v in V_GRID else 0, K_GRID.index(kk) if kk in K_GRID else 0)
    pa, pb = parse(a), parse(b)
    return max(abs(pa[0] - pb[0]), abs(pa[1] - pb[1]))


def write_report(path: str, summary: dict, extra: dict) -> None:
    with open(path, "w") as f:
        json.dump({**extra, **summary}, f, indent=2, default=float)
