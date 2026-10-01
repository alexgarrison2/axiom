"""Point-in-time RAPM v2 ratings for every game date (DESIGN §3, §4.1, §4.4).

For each season, in order:

1. Summer roll-forward: prior = last season's full posterior (``Chain``) + aging curve and
   rookie means fitted on earlier seasons only.
2. For every date d on which games are scheduled, the ratings are refit on the season's EV
   stints from games played on or before ``d - LAG_DAYS`` plus the prior (a refit is
   skipped when no new games became available).  One row per (asof, player).
3. At season end the full-season posterior is folded into the chain.

Leakage contract (asserted in tests/test_rapm.py): the ratings with ``asof = d`` never use
a stint from a game dated after ``d - LAG_DAYS``; ``max_source_date`` is stored per row.

Outputs (``RapmPaths``): ``ratings/season=S.parquet`` (asof, player_id, o, d, o_sd, d_sd,
is_new, ev_toi_s, max_source_date) and ``ratings/cov_season=S.parquet`` (asof + the fitted
covariates).  Posterior SDs are exact and refreshed weekly (Mondays and the first date),
NaN on other dates.  Per season also:

* ``prior_pack/season=S.json.gz``: the season-start chain (``bu.rapm.pack``), so the season can
  later be refit alone (``seed=``, the live refresh: CI has only the current season's lake);
* ``ratings/prior_season=S.parquet``: the season prior of every carried or new player (what a
  dressed skater with no EV time yet this season is rated at);
* ``ratings/latest_season=S.parquet`` + ``.json``: the fit on *all* the season's available
  stints (the live ratings), the prior for carried players who have not played, the fitted
  covariates and ``max_source_date``.
"""
from __future__ import annotations

import json
import os
import time

import numpy as np
import pandas as pd

from .aging import fit_aging
from .design import COVARIATES
from .engine import LAG_DAYS, SeasonData, avail_dates, fit_standalone
from . import pack as rpack
from .design import Index
from .priors import Chain, Hyper, RookieModel, set_window_state
from .ridge import Gram
from bu.lake.build import read_table


def _per_day_toi(sd: SeasonData) -> pd.DataFrame:
    """EV seconds per (game_date, player) from the season's EV stints."""
    st = sd.stints
    recs = []
    for d, hs, as_, dur in zip(st["game_date"], st["home_sk"], st["away_sk"], st["dur"]):
        for p in hs:
            recs.append((d, int(p), dur))
        for p in as_:
            recs.append((d, int(p), dur))
    df = pd.DataFrame(recs, columns=["game_date", "player_id", "sec"])
    df["game_date"] = pd.to_datetime(df["game_date"]).values.astype("datetime64[D]")
    return df.groupby(["game_date", "player_id"], as_index=False)["sec"].sum()


def _per_avail_toi(sd: SeasonData) -> pd.DataFrame:
    """Like _per_day_toi but keyed on the availability date (differs only when degraded)."""
    st = sd.stints.copy()
    st["game_date"] = avail_dates(st["game_id"], pd.to_datetime(st["game_date"]).values.astype("datetime64[D]"))
    tmp = SeasonData.__new__(SeasonData)
    tmp.stints = st
    return _per_day_toi(tmp).sort_values("game_date", kind="stable").reset_index(drop=True)


def _side_paths(paths, S):
    d = os.path.dirname(paths.ratings(S))
    return {"prior": os.path.join(d, f"prior_season={S}.parquet"),
            "latest": os.path.join(d, f"latest_season={S}.parquet"),
            "latest_meta": os.path.join(d, f"latest_season={S}.json"),
            "pack": os.path.join(paths.root, "prior_pack", f"season={S}.json.gz")}


def run(paths, seasons: list[str], players: pd.DataFrame, hyper: Hyper, source: str = "v1", log=print,
        seed: str | None = None) -> dict:
    """``seed``: a prior pack (``bu.rapm.pack`` / a lineup season pack) for ``seasons == [S]``:
    the season is refit from the pack's chain, aging curve and rookie means instead of
    replaying earlier seasons (same numbers as the full chain)."""
    chain = Chain(hyper)
    hist = []           # (season, Index, full-season Gram) for window-mode priors
    standalone: dict[str, pd.DataFrame] = {}
    seeded = None
    if seed is not None:
        seeded = rpack.Seed.load(seed)
        if [str(s) for s in seasons] != [seeded.season]:
            raise SystemExit(f"a prior pack for {seeded.season} can only seed that season, not {seasons}")
        if seeded.hyper != hyper:
            log(f"  [asof] using the pack's hyper-parameters {seeded.hyper.key()} (not {hyper.key()})")
            hyper = seeded.hyper
        chain = seeded.chain
        players = seeded.players(players)
    summary = {"hyper": hyper.as_dict(), "lag_days": LAG_DAYS, "xg_source": source, "seasons": {},
               "seed": os.path.basename(seed) if seed else None}
    for S in seasons:
        t0 = time.time()
        sp = _side_paths(paths, S)
        sd = SeasonData.load(paths, S, source)
        if seeded is not None:
            aging, rookie = seeded.aging, seeded.rookie
        else:
            aging = fit_aging(standalone, players, S)
            rookie = RookieModel.fit(standalone, players, S)
            set_window_state(chain, S, hist, players, aging, rookie)
            rpack.write(sp["pack"], rpack.to_json(S, chain, aging, rookie, players))
        b0, lam, is_new = chain.prior(S, sd.idx, players, aging, rookie)
        n = sd.idx.n
        # season prior of every carried or new player (dressed skaters with no EV time yet)
        idx_all = Index(set(chain.state) | set(int(p) for p in sd.idx.ids))
        b0a, lama, newa = chain.prior(S, idx_all, players, aging, rookie)
        na = idx_all.n
        prior_all = pd.DataFrame({"player_id": idx_all.ids, "o": b0a[:na], "d": b0a[na:2 * na],
                                  "o_sd": np.sqrt(chain.sigma2 / lama[:na]),
                                  "d_sd": np.sqrt(chain.sigma2 / lama[na:2 * na]), "is_new": newa})
        prior_all.to_parquet(sp["prior"], index=False)
        sched = read_table(paths.lake, "games", [S], columns=["game_date"])
        dates = np.unique(pd.to_datetime(sched["game_date"]).values.astype("datetime64[D]"))
        toi_day = _per_avail_toi(sd)
        g = Gram(sd.idx.p)
        ptr, b, last_k = 0, None, -1
        out, covs, srcs = [], [], []
        toi_cum = pd.Series(0.0, index=sd.idx.ids)
        toi_ptr = 0
        toi_dates = toi_day["game_date"].to_numpy()
        for d in dates:
            k = sd.upto(d)
            if k > ptr:
                g.add(sd.X[ptr:k], sd.rows.y[ptr:k], sd.rows.w[ptr:k])
                ptr = k
            cutoff = d - np.timedelta64(LAG_DAYS, "D")
            tk = int(np.searchsorted(toi_dates, cutoff, side="right"))
            if tk > toi_ptr:
                add = toi_day.iloc[toi_ptr:tk].groupby("player_id")["sec"].sum()
                toi_cum = toi_cum.add(add.reindex(toi_cum.index).fillna(0.0), fill_value=0.0)
                toi_ptr = tk
            weekly = (pd.Timestamp(d).dayofweek == 0) or b is None
            if k != last_k or weekly:
                b, inv = g.solve(lam, b0, want_inv=weekly)
                last_k = k
            sdv = np.sqrt(chain.sigma2 * inv) if weekly else np.full(sd.idx.p, np.nan)
            src = sd.max_source_date(k)
            out.append(pd.DataFrame({
                "asof": d, "player_id": sd.idx.ids, "o": b[:n], "d": b[n:2 * n],
                "o_sd": sdv[:n], "d_sd": sdv[n:2 * n], "is_new": is_new,
                "ev_toi_s": toi_cum.to_numpy(),
            }))
            srcs.append(src)
            covs.append({"asof": d, **{c: float(v) for c, v in zip(COVARIATES, b[2 * n:])}})
        ratings = pd.concat(out, ignore_index=True)
        ratings["max_source_date"] = np.repeat(np.array(srcs, dtype="datetime64[D]"), n)
        ratings["season"] = S
        ratings.to_parquet(paths.ratings(S), index=False)
        pd.DataFrame(covs).to_parquet(os.path.join(os.path.dirname(paths.ratings(S)), f"cov_season={S}.parquet"),
                                      index=False)
        # preseason prior for every carried player (players with no EV time this season)
        G = sd.full_gram()
        bf, inv = G.solve(lam, b0, want_inv=True)
        s2 = G.sigma2(bf)
        # live ratings: the fit on every available stint of the season + the prior for the rest
        sdf = np.sqrt(chain.sigma2 * inv)
        fit = pd.DataFrame({"player_id": sd.idx.ids, "o": bf[:n], "d": bf[n:2 * n], "o_sd": sdf[:n],
                            "d_sd": sdf[n:2 * n], "is_new": is_new,
                            "ev_toi_s": sd.toi.reindex(sd.idx.ids).fillna(0.0).to_numpy()})
        rest = prior_all[~prior_all["player_id"].isin(fit["player_id"])].assign(ev_toi_s=0.0)
        pd.concat([fit, rest], ignore_index=True).to_parquet(sp["latest"], index=False)
        last_src = sd.max_source_date(len(sd.rows))
        with open(sp["latest_meta"], "w") as f:
            json.dump({"season": S, "covariates": {c: float(v) for c, v in zip(COVARIATES, bf[2 * n:])},
                       "max_source_date": None if pd.isna(last_src) else str(last_src),
                       "n_rows": int(len(sd.rows)), "hyper": hyper.as_dict(), "xg_source": source,
                       "seeded": bool(seeded)}, f, indent=1)
        chain.update(S, sd.idx, bf, inv, s2, sd.toi, n_rows=len(sd.rows))
        post = chain.table()
        post.to_parquet(paths.posterior(S), index=False)
        if seeded is None:
            standalone[S] = fit_standalone(sd, G)
            hist = (hist + [(S, sd.idx, G)])[-4:]
        summary["seasons"][S] = {"n_dates": int(len(dates)), "n_skaters": int(n), "sigma2": s2,
                                 "aging": aging.to_json(), "rookie": rookie.to_json(),
                                 "seconds": round(time.time() - t0, 1)}
        log(f"  [asof] {S}: {len(dates)} dates x {n} skaters in {time.time() - t0:.0f}s")
    name = "asof_summary.json" if seeded is None else f"asof_summary_seeded_{seasons[0]}.json"
    with open(paths.report(name), "w") as f:  # a seeded refit never overwrites the full-chain summary
        json.dump(summary, f, indent=2, default=float)
    return summary


def load_ratings(paths, seasons) -> pd.DataFrame:
    frames = [pd.read_parquet(paths.ratings(s)) for s in seasons if os.path.exists(paths.ratings(s))]
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def load_covs(paths, seasons) -> pd.DataFrame:
    frames = []
    for s in seasons:
        p = os.path.join(os.path.dirname(paths.ratings(s)), f"cov_season={s}.parquet")
        if os.path.exists(p):
            frames.append(pd.read_parquet(p).assign(season=s))
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
