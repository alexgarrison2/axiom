"""
backtest_props.py — calibration of prop_model's fair probabilities.

Replays a finished season in game order: each player-game is priced from the
player's previous games only (history crosses into earlier seasons when their
skater_games file exists) and scored against the result. Reports log loss and
Brier for every prop next to two baselines: the league base rate and the
player's own last-10 hit rate (shrunk 2 games toward the base rate), plus a
reliability table.

    cd pipeline && python3 tools/backtest_props.py [--season 2025] [--from 2025-11-15]

Record (2026-10-03, 2025-26 from Nov 15, 35,261 player-games, log loss
fair / last-10 / base rate): SOG o1.5 0.612 / 0.786 / 0.684, o2.5 0.462 /
0.626 / 0.530, o3.5 0.285 / 0.408 / 0.333, ATG 0.401 / 0.500 / 0.431,
1+ A 0.525 / 0.626 / 0.557, 1+ P 0.600 / 0.734 / 0.649, 2+ P 0.274 / 0.370 /
0.309, 1+ PPP 0.246 / 0.374 / 0.300. Pooled reliability within ~1 point per
10% bin. League position priors use the whole replayed season (a negligible
look-ahead: one game among ~47k rows).

Arms (tools/prereg_props_calib.json: BASE vs CAL / STRUCT / STRUCT_CAL):

    python3 tools/backtest_props.py --arms dev        # dev seasons -> tools/prereg_props_calib_dev.json
    python3 tools/backtest_props.py --arms book       # descriptive: arms vs Bovada on prop_lines/ games
    python3 tools/backtest_props.py --arms holdout --owner-look   # ONE logged look, owner's call

Each season S is priced from the regular-season logs of S-1 and S (the season
file, else that season's rows of nhl_historical_skater_games.csv), as
prop_board has them live. Arm differences are paired per player-game with
standard errors clustered by game date.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys

import numpy as np
import pandas as pd

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(TOOLS))
from fetch_skater_games import games_file  # noqa: E402
from paths import pipeline_path  # noqa: E402
import prop_model as pm  # noqa: E402

PREREG = os.path.join(TOOLS, "prereg_props_calib.json")
DEV_OUT = os.path.join(TOOLS, "prereg_props_calib_dev.json")
HOLDOUT_OUT = os.path.join(TOOLS, "prereg_props_calib_holdout.json")
LOOK_LOG = os.path.join(TOOLS, "out", "props_look_log.jsonl")
QUESTION = "props_calib"
FIRST_SEASON = 2022                 # nhl_historical_skater_games.csv starts in 2022-23
DEV_SEASONS = (2023, 2024)
HOLDOUT_SEASON = 2025
H2_FROM = "2026-10-15"
ARM_ORDER = ["cal", "struct", "struct_cal"]          # simplest first (tie rule)
KEYS = [k for k, _, _ in pm.PROPS]


def logloss(p, y):
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def _ll_rows(p, y):
    p = np.clip(np.asarray(p, dtype=float), 1e-4, 1 - 1e-4)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def season_logs(season: int, hist: pd.DataFrame | None = None) -> pd.DataFrame:
    """Regular-season skater logs of one season: its season file, else the historical archive."""
    if os.path.exists(games_file(season)):
        f = pd.read_csv(games_file(season))
    else:
        if hist is None:
            hist = pd.read_csv(pipeline_path("nhl_historical_skater_games.csv"))
        f = hist[hist["game_id"] // 1000000 == season]
    return f[(f["game_id"] // 10000) % 100 == 2].copy()


def priced(season: int, prior: str, hist: pd.DataFrame | None = None) -> pd.DataFrame:
    """Season S's player-games priced as prop_board would have (frame = seasons S-1 and S)."""
    frames = [season_logs(y, hist) for y in (season - 1, season) if y >= FIRST_SEASON]
    df = pm.pregame_features(pd.concat(frames, ignore_index=True), prior=prior)
    df = df[df["game_id"] // 1000000 == season]
    out = df[["game_id", "date", "player_id", "name", "team", "pos", "n_prev", "toi_exp"]].copy()
    out = pd.concat([out, pm.fair_probs(df), pm.outcomes(df).add_prefix("y_")], axis=1)
    return out.sort_values(["date", "game_id", "player_id"]).reset_index(drop=True)


def build_arms(seasons, arms, hist=None) -> dict:
    """{arm: table} over ``seasons`` (sorted list, each a full regular season), same rows in the same order."""
    by_prior = {}
    for prior in sorted({pm.ARMS[a][0] for a in arms}):
        by_prior[prior] = pd.concat([priced(s, prior, hist) for s in seasons], ignore_index=True)
    out = {}
    for arm in arms:
        prior, shift = pm.ARMS[arm]
        tab = by_prior[prior].copy()
        if shift:
            graded = tab[tab[[f"y_{k}" for k in KEYS]].notna().all(axis=1)]
            sh = pm.calibration_shifts(graded["date"], graded[KEYS],
                                       graded[[f"y_{k}" for k in KEYS]].set_axis(KEYS, axis=1), tab["date"].unique())
            tab[KEYS] = pm.apply_shifts(tab[KEYS], {k: sh.loc[tab["date"], k].to_numpy() for k in KEYS})
            tab.attrs["shifts"] = sh
        out[arm] = tab
    return out


def clustered_mean(d, clusters) -> tuple[float, float]:
    """Mean of d with a standard error clustered by ``clusters``."""
    d = np.asarray(d, dtype=float)
    n = len(d)
    m = d.mean()
    s = pd.Series(d - m).groupby(np.asarray(clusters)).sum().to_numpy()
    c = len(s)
    se = float(np.sqrt((s ** 2).sum() * c / max(c - 1, 1)) / n)
    return float(m), se


def compare(arm: pd.DataFrame, base: pd.DataFrame, mask) -> dict:
    """Primary metric and per-market numbers for one arm vs BASE on the rows in ``mask``."""
    a, b = arm[mask], base[mask]
    assert (a["player_id"].to_numpy() == b["player_id"].to_numpy()).all()
    dates = a["date"].to_numpy()
    d_rows = np.zeros(len(a))
    markets = {}
    m_arm = m_base = 0.0
    for k in KEYS:
        y = a[f"y_{k}"].to_numpy()
        la, lb = _ll_rows(a[k], y), _ll_rows(b[k], y)
        d_rows += (la - lb) / len(KEYS)
        diff, se = clustered_mean(la - lb, dates)
        m_arm += la.mean() / len(KEYS)
        m_base += lb.mean() / len(KEYS)
        markets[k] = {"ll_arm": round(float(la.mean()), 5), "ll_base": round(float(lb.mean()), 5),
                      "diff": round(diff, 6), "se": round(se, 6),
                      "ratio_arm": round(float(a[k].mean() / y.mean()), 4),
                      "ratio_base": round(float(b[k].mean() / y.mean()), 4),
                      "brier_arm": round(float(np.mean((a[k] - y) ** 2)), 5),
                      "brier_base": round(float(np.mean((b[k] - y) ** 2)), 5)}
    d, se = clustered_mean(d_rows, dates)
    return {"n": int(len(a)), "n_dates": int(len(set(dates))), "M_arm": round(m_arm, 6), "M_base": round(m_base, 6),
            "d": round(d, 6), "se": round(se, 6), "markets": markets}


def _ratios_by(tab: pd.DataFrame, mask, by) -> dict:
    t = tab[mask]
    out = {}
    for g, part in t.groupby(by, observed=True):
        out[str(g)] = {"n": int(len(part)), **{k: round(float(part[k].mean() / max(part[f"y_{k}"].mean(), 1e-9)), 3)
                                              for k in KEYS}}
    return out


def _shift_path(tab: pd.DataFrame, mask) -> dict | None:
    sh = tab.attrs.get("shifts")
    if sh is None:
        return None
    dates = sorted(set(tab.loc[mask, "date"]))
    sh = sh.loc[dates]
    return {k: {"first": round(float(sh[k].iloc[0]), 4), "median": round(float(sh[k].median()), 4),
                "last": round(float(sh[k].iloc[-1]), 4)} for k in KEYS}


def evaluate(tables: dict, masks: dict) -> dict:
    """For each arm != base and each named row mask: compare() plus descriptive breakdowns."""
    base = tables["base"]
    out = {}
    for arm, tab in tables.items():
        if arm == "base":
            continue
        out[arm] = {}
        for name, mask in masks.items():
            r = compare(tab, base, mask)
            if name.startswith("pooled") or name.isdigit():
                npb = pd.cut(tab["n_prev"], [-1, 9, 19, 39, 81, 10 ** 6], labels=["0-9", "10-19", "20-39", "40-81", "82+"])
                grp = np.where(tab["pos"].eq("D"), "D", "F")
                band = pd.Series(grp, index=tab.index) + pd.Series(pm.toi_band(grp, tab["toi_exp"]), index=tab.index).astype(str)
                r["ratio_by_prev_games"] = {"arm": _ratios_by(tab, mask, npb), "base": _ratios_by(base, mask, npb)}
                r["ratio_by_toi_band"] = {"arm": _ratios_by(tab, mask, band), "base": _ratios_by(base, mask, band)}
                r["shift_path"] = _shift_path(tab, mask)
            out[arm][name] = r
    return out


def select(results: dict, period: str = "pooled_dev") -> str | None:
    """Prereg selection: lowest pooled dev d among the arms, if d < 0 and |d| >= 1 SE; ties -> simplest."""
    ok = [(results[a][period]["d"], a) for a in ARM_ORDER if a in results
          if results[a][period]["d"] < 0 and abs(results[a][period]["d"]) >= results[a][period]["se"]]
    if not ok:
        return None
    best = min(d for d, _ in ok)
    return next(a for a in ARM_ORDER if any(a == b and d <= best + 0.00005 for d, b in ok))


def _git_head() -> str | None:
    try:
        import subprocess
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True,
                              cwd=TOOLS).stdout.strip() or None
    except Exception:
        return None


def run_dev(out_path=DEV_OUT) -> dict:
    hist = pd.read_csv(pipeline_path("nhl_historical_skater_games.csv"))
    seasons = list(range(FIRST_SEASON, max(DEV_SEASONS) + 1))    # 2022 only feeds CAL windows
    arms = ["base"] + ARM_ORDER
    tables = build_arms(seasons, arms, hist)
    t = tables["base"]
    season = t["game_id"] // 1000000
    graded = t[[f"y_{k}" for k in KEYS]].notna().all(axis=1)
    dev = season.isin(DEV_SEASONS) & graded
    legacy = dev & (t["date"].str[5:] >= "11-15") & (t["n_prev"] >= 10)
    masks = {"pooled_dev": dev, **{str(s): dev & (season == s) for s in DEV_SEASONS}, "legacy_subset_dev": legacy}
    res = evaluate(tables, masks)
    cand = select(res)
    report = {"question": QUESTION, "period": "dev", "seasons": [f"{s}{s + 1}" for s in DEV_SEASONS],
              "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
              "code": _git_head(), "prereg": os.path.basename(PREREG),
              "base_M": {name: compare(tables["base"], tables["base"], m)["M_base"] for name, m in masks.items()},
              "arms": res, "candidate": cand,
              "selection_rule": "lowest pooled dev d among cal / struct / struct_cal with d < 0 and |d| >= 1 SE"}
    with open(out_path, "w") as f:
        json.dump(report, f, indent=1)
    return report


def run_book() -> dict:
    """Descriptive: each arm and the Bovada price on the archived prop_lines games that have results."""
    import glob
    from prop_board import norm
    lines = pd.concat([pd.read_csv(p) for p in sorted(glob.glob(pipeline_path("prop_lines", "*.csv")))],
                      ignore_index=True)
    hist = pd.read_csv(pipeline_path("nhl_historical_skater_games.csv"))
    tables = build_arms([2024, 2025, 2026], ["base"] + ARM_ORDER, hist)
    base = tables["base"]
    key = pd.Series(list(zip(base["game_id"], base["name"].map(norm))))
    idx = {k: i for i, k in enumerate(key)}
    sog = {1.5: "sog15", 2.5: "sog25", 3.5: "sog35"}
    rows = []
    for r in lines.itertuples():
        i = idx.get((int(r.game_id), norm(r.player)))
        if i is None:
            continue
        if r.market == "sog":
            k = sog.get(float(r.line))
            po, pu = pm.american_to_prob(r.over), pm.american_to_prob(r.under)
            if k is None or not po or not pu:
                continue
            rows.append((i, k, po / (po + pu), True))
        elif r.market in KEYS:
            rows.append((i, r.market, pm.american_to_prob(r.over), False))
    out = {}
    for k in KEYS:
        sel = [(i, p, dv) for i, kk, p, dv in rows if kk == k and not np.isnan(base.at[i, f"y_{k}"])]
        if not sel:
            continue
        ii = [i for i, _, _ in sel]
        y = base.loc[ii, f"y_{k}"].to_numpy()
        book = np.array([p for _, p, _ in sel])
        out[k] = {"n": len(sel), "hit_rate": round(float(y.mean()), 4), "book_devigged": bool(sel[0][2]),
                  "ll_book": round(logloss(book, y), 5), "mean_book_p": round(float(book.mean()), 4),
                  **{f"ll_{a}": round(logloss(tables[a].loc[ii, k].to_numpy(), y), 5) for a in tables},
                  **{f"mean_p_{a}": round(float(tables[a].loc[ii, k].mean()), 4) for a in tables}}
    return {"dates": sorted(set(lines["game_date"])), "markets": out,
            "note": "SOG two-way de-vigged proportionally; one-way markets scored raw (vig included). Descriptive only."}


def holdout_look(confirm: bool, log_path=LOOK_LOG, dev_path=DEV_OUT, out_path=HOLDOUT_OUT, scorer=None) -> dict:
    """The one logged holdout look (prereg_props_calib.json). Refuses without the dev result or a second time."""
    if not confirm:
        raise SystemExit("holdout look needs --owner-look (one look, the owner's call; see prereg_props_calib.json)")
    if not os.path.exists(dev_path):
        raise SystemExit(f"no dev result at {dev_path}: score dev first")
    if os.path.exists(log_path):
        with open(log_path) as f:
            if any(json.loads(line).get("question") == QUESTION for line in f if line.strip()):
                raise SystemExit(f"holdout look for {QUESTION!r} already taken ({log_path}); refusing a second look")
    with open(dev_path) as f:
        cand = json.load(f).get("candidate")
    if cand is None:
        raise SystemExit("dev selected no candidate: BASE stays, no holdout look needed")
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    with open(log_path, "a") as f:
        f.write(json.dumps({"question": QUESTION, "stage": "started", "candidate": cand, "at": now}) + "\n")
    report = (scorer or _score_holdout)(cand)
    with open(out_path, "w") as f:
        json.dump(report, f, indent=1)
    with open(log_path, "a") as f:
        f.write(json.dumps({"question": QUESTION, "at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                            "candidate": cand, "n_h1": report["H1"]["n"],
                            "d_h1": report["H1"]["d"], "se_h1": report["H1"]["se"], "pass": report["pass"]}) + "\n")
    return report


def _score_holdout(cand: str) -> dict:
    hist = pd.read_csv(pipeline_path("nhl_historical_skater_games.csv"))
    seasons = list(range(HOLDOUT_SEASON - 1, HOLDOUT_SEASON + 2))     # 2024 only feeds CAL windows
    tables = build_arms(seasons, ["base", cand], hist)
    t = tables["base"]
    season = t["game_id"] // 1000000
    graded = t[[f"y_{k}" for k in KEYS]].notna().all(axis=1)
    h1 = graded & (season == HOLDOUT_SEASON)
    h2 = graded & (season == HOLDOUT_SEASON + 1) & (t["date"] >= H2_FROM)
    masks = {"H1": h1}
    if h2.any():
        masks["H2"] = h2
    res = evaluate(tables, masks)[cand]
    r1 = res["H1"]
    worst = max(m["diff"] - 2 * m["se"] for m in r1["markets"].values())
    passed = bool(r1["d"] < 0 and worst <= 0)
    return {"question": QUESTION, "candidate": cand, "code": _git_head(), "H1": r1, "H2": res.get("H2"),
            "pass": passed, "rule": "H1 d < 0 and no market's H1 diff > +2 SE"}


def arms_main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["dev", "book", "holdout"])
    ap.add_argument("--owner-look", action="store_true")
    a = ap.parse_args(argv)
    if a.mode == "dev":
        r = run_dev()
        for arm in ARM_ORDER:
            p = r["arms"][arm]["pooled_dev"]
            print(f"{arm:10} pooled dev d={p['d']:+.6f} (SE {p['se']:.6f}) n={p['n']}")
        print(f"candidate: {r['candidate']}  -> {DEV_OUT}")
    elif a.mode == "book":
        print(json.dumps(run_book(), indent=1))
    else:
        r = holdout_look(a.owner_look)
        print(json.dumps({k: r[k] for k in ("candidate", "pass")}), "->", HOLDOUT_OUT)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "--arms":
        return arms_main(argv[1:])
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2025)
    ap.add_argument("--from", dest="since", default=None)
    ap.add_argument("--min-prev", type=int, default=10)
    a = ap.parse_args(argv)
    frames = [pd.read_csv(games_file(y)) for y in (a.season - 1, a.season) if os.path.exists(games_file(y))]
    logs = pd.concat(frames, ignore_index=True)
    df = pm.pregame_features(logs)
    fair = pm.fair_probs(df)
    since = a.since or f"{a.season}-11-15"
    keep = (df["date"] >= since) & (df["game_id"] // 10000 == a.season * 100 + 2) & (df["n_prev"] >= a.min_prev)
    df, fair = df[keep], fair[keep]
    print(f"{len(df)} player-games from {since}, >= {a.min_prev} previous games")
    print(f"{'prop':6} {'base':>6} {'LL fair':>8} {'LL L10':>8} {'LL base':>8} {'Brier':>7} {'mean p':>7}")
    srt = logs.sort_values(["player_id", "date", "game_id"])
    for key, stat, k in pm.PROPS:
        hit_all = (srt[stat] >= k).astype(float)
        l10 = hit_all.groupby(srt["player_id"]).transform(lambda x: x.shift(1).rolling(10, min_periods=1).sum())
        n10 = hit_all.groupby(srt["player_id"]).transform(lambda x: x.shift(1).rolling(10, min_periods=1).count())
        y = (df[stat] >= k).astype(float).to_numpy()
        base = y.mean()
        l10p = ((l10 + 2 * base) / (n10 + 2)).reindex(df.index).fillna(base).to_numpy()
        p = fair[key].to_numpy()
        print(f"{key:6} {base:6.3f} {logloss(p, y):8.4f} {logloss(l10p, y):8.4f} {logloss(np.full_like(y, base), y):8.4f}"
              f" {np.mean((p - y) ** 2):7.4f} {p.mean():7.3f}")
    print("\nReliability (all props pooled): predicted bin -> observed")
    ys, ps = [], []
    for key, stat, k in pm.PROPS:
        ys.append((df[stat] >= k).astype(float).to_numpy())
        ps.append(fair[key].to_numpy())
    y, p = np.concatenate(ys), np.concatenate(ps)
    bins = np.linspace(0, 1, 11)
    idx = np.digitize(p, bins) - 1
    for b in range(10):
        m = idx == b
        if m.sum() > 200:
            print(f"  {bins[b]:.1f}-{bins[b + 1]:.1f}: n={m.sum():6d} pred={p[m].mean():.3f} obs={y[m].mean():.3f}")


if __name__ == "__main__":
    main()
