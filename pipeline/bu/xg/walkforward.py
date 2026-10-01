"""Season walk-forward for xG v2 and the M1 shot-level report (DESIGN §3.1, §8 M1).

For every test season S the model is trained only on seasons [S-5, S-1] that
the lake has (never on S or later), then S is scored and compared, on the very
same shots, with

  * v1 PIT   the incumbent recipe re-fit on the same window (the M1 gate bar),
  * v1 prod  the committed ``xg_model_xgb.pkl`` (in sample on 2022-26: optimistic),
  * MoneyPuck ``xGoal`` (in sample for its own seasons: optimistic; D3).

Outputs
  bu/xg/out/xgv2_report.json        per-season metrics + the M1 gate (committed)
  <state-dir>/oos_xg2_<S>.parquet   per-shot out-of-sample scores (not committed;
                                    the game-level gate and RAPM read these)
  <state-dir>/fold_<S>/             the fold's model (booster JSON + calibrators JSON)

Usage (from pipeline/):
  python -m bu.xg.walkforward --lake-dir <lake> --mp-dir <moneypuck zips> --state-dir <dir>
  python -m bu.xg.walkforward ... --fit-production      # also writes models/xg2_*
Everything is re-runnable: a larger lake (2010+) just adds training seasons.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import handedness, v1
from .features import shot_features
from .metrics import by_group, paired_diff, reliability, summary
from .model import XGv2, config_hash
from .rink import RinkAdjuster

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "out")
REPORT = os.path.join(OUT_DIR, "xgv2_report.json")
PROD_DIR = os.path.join(os.path.dirname(os.path.dirname(HERE)), "models")
WINDOW = 5
DECAY = 0.0          # chosen on dev folds (bu/xg/out/xgv2_dev_experiments.json)
CUR_WEIGHT = 2.0     # weight of the current season's games in an as-of refit
ROLES = {"20212022": "tuning", "20222023": "tuning", "20232024": "dev", "20242025": "dev",
         "20252026": "soft-holdout"}
GATE_DESIGN_STRENGTHS = ["5v5", "5v4", "4v5", "3v3", "EN"]
GATE_LL_MARGIN = 0.002
GATE_RATIO = (0.97, 1.03)


def log(msg):
    print(msg, flush=True)


def lake_seasons(lake) -> list[str]:
    d = lake.table_dir("events")
    if not os.path.isdir(d):
        return []
    return sorted(x.split("=", 1)[1] for x in os.listdir(d) if x.startswith("season="))


def load_season(lake, season: str, hand: dict):
    from bu.lake.build import read_table
    ev = read_table(lake, "events", [season])
    g = read_table(lake, "games", [season])
    if ev.empty:
        return None, None
    keep_games = set(g.loc[pd.to_numeric(g["game_type"], errors="coerce").isin([2, 3]), "game_id"])
    ev = ev[ev["game_id"].isin(keep_games)]
    s = shot_features(ev, g, hand)
    r = v1.rows_from_events(ev)
    r["season"] = season
    return s, r


def detailed_strength(df: pd.DataFrame) -> np.ndarray:
    st = df["strength"].fillna("?").to_numpy(dtype=object).copy()
    sc = df["strength_class"].to_numpy()
    st[sc == "EN"] = "EN"
    st[sc == "PS"] = "PS"
    return st   # extra-attacker shots keep their skater counts (6v5, 6v4)


def train_window(S: str, available, window: int = WINDOW) -> list[str]:
    """Seasons [S-window, S-1] present in ``available``: never S, never later (leakage rule §4.4.2)."""
    sy = int(str(S)[:4])
    cand = [f"{y}{y + 1}" for y in range(sy - window, sy)]
    return [s for s in cand if s in set(available)]


def season_weights(seasons: pd.Series, S: str, decay: float = DECAY) -> np.ndarray:
    """Recency weight of each prior-season row: 1 for S-1, ``decay**(age-1)`` for older seasons.
    Scorer practice drifts season to season (5v5 missed-shot share 27% -> 36%, wrist-shot share
    57% -> 44% from 2021-22 to 2025-26), so older seasons describe a different recording regime."""
    age = int(str(S)[:4]) - seasons.astype(str).str[:4].astype(int).to_numpy()
    return np.where(age <= 1, 1.0, np.power(decay, np.maximum(age - 1, 0)) if decay > 0 else 0.0)


def asof_blocks(dates: pd.Series) -> list[pd.Timestamp]:
    """Month starts after the first game day of the season: the as-of refit points."""
    d = pd.to_datetime(dates)
    first, last = d.min(), d.max()
    months = pd.date_range(first.to_period("M").to_timestamp() + pd.offsets.MonthBegin(1), last, freq="MS")
    return [first] + list(months) + [last + pd.Timedelta(days=1)]


def fit_asof(prior: pd.DataFrame, prior_w: np.ndarray, current: pd.DataFrame, *, cur_weight: float = CUR_WEIGHT,
             rink=None, calibrate: bool = False, log=print, extra_meta=None) -> XGv2:
    """One as-of model: prior seasons (recency-weighted) + the current season's games so far."""
    tr = pd.concat([prior, current], ignore_index=True)
    w = np.concatenate([prior_w, np.full(len(current), cur_weight)])
    fit_seasons = sorted(set(prior.loc[np.asarray(prior_w) > 0, "season"].astype(str))
                         | set(current["season"].astype(str)))
    return XGv2.fit(tr, sample_weight=w, calibrate=calibrate, log=log, fit_seasons=fit_seasons, rink=rink,
                    extra_meta=extra_meta)


def run_fold(S: str, shots: pd.DataFrame, v1rows: pd.DataFrame, mp: pd.DataFrame | None, *,
             state_dir: str | None, use_rink: bool = True, window: int = WINDOW, decay: float = DECAY,
             asof: bool = True, calibrate: bool = False) -> tuple[dict, pd.DataFrame]:
    sy = int(S[:4])
    train_seasons = train_window(S, set(shots["season"]), window)
    if not train_seasons:
        raise ValueError(f"no training seasons before {S}")
    tr = shots[shots["season"].isin(train_seasons)].copy()
    te = shots[shots["season"] == S].copy().reset_index(drop=True)
    ref = f"{int(max(train_seasons)[:4]) + 1}{int(max(train_seasons)[:4]) + 2}"   # = S unless S-1 is missing from the lake
    pw = season_weights(tr["season"], ref, decay)
    rink = None
    if use_rink:
        rink = RinkAdjuster.fit(tr[pw > 0])
        tr["dist_rink"] = rink.adjust(tr)
        te["dist_rink"] = rink.adjust(te)
    t0 = time.time()
    log(f"  fold {S}: train {train_seasons} ({len(tr):,} shots, decay {decay}), test {len(te):,}")
    m = XGv2.fit(tr, sample_weight=pw, calibrate=calibrate, log=log, fit_seasons=train_seasons, rink=rink)
    te["xg2"] = m.predict(te, calibrated=calibrate)
    fit_s = time.time() - t0

    # as-of: monthly refits on prior seasons + this season's games before the block (no future games)
    te["xg2_asof"] = te["xg2"]
    asof_log = []
    if asof and te["game_date"].notna().all():
        gd = pd.to_datetime(te["game_date"])
        edges = asof_blocks(gd)
        for lo, hi in zip(edges[1:-1], edges[2:]):
            blk = ((gd >= lo) & (gd < hi)).to_numpy()
            if not blk.any():
                continue
            cur = te[(gd < lo).to_numpy()]
            mk = fit_asof(tr, pw, cur, rink=rink, calibrate=calibrate, log=lambda *_: None)
            te.loc[blk, "xg2_asof"] = mk.predict(te[blk], calibrated=calibrate)
            asof_log.append({"block_start": str(lo.date()), "n_current_train": int(len(cur)),
                             "n_scored": int(blk.sum()), "trees": mk.meta["n_trees"]})
    asof_s = time.time() - t0 - fit_s

    # v1 PIT + production on the same shots
    v1_tr = v1rows[v1rows["season"].isin(train_seasons)].reset_index(drop=True)
    v1_te = v1rows[v1rows["season"] == S].reset_index(drop=True)
    t1 = time.time()
    pit = v1.fit_pit(v1_tr)
    v1_te["xg1_pit"] = v1.score(pit, v1_te[[c for c in v1_te.columns if c != "season"]])
    v1_te["xg1_prod"] = v1.score(v1.load_production(), v1_te[[c for c in v1_te.columns if c not in ("season", "xg1_pit")]])
    v1_s = time.time() - t1
    te = te.merge(v1_te[["game_id", "event_id", "xg1_pit", "xg1_prod"]], on=["game_id", "event_id"], how="left")
    te["xg_mp"] = np.nan
    if mp is not None and len(mp):
        from .moneypuck import JOIN_KEYS, join_keys
        mps = join_keys(mp[mp["season"] == sy])
        k = pd.DataFrame({"game_id": te["game_id"].astype("int64"), "period": te["period_raw"],
                          "game_seconds": te["game_seconds_raw"], "shooter_id": te["shooter_id"],
                          "type_code": te["type_code"]})
        k = k[k.notna().all(axis=1)].astype("int64")
        k["_i"] = k.index
        k = k[~k.duplicated(JOIN_KEYS, keep=False)].merge(mps, on=JOIN_KEYS, how="inner")
        te.loc[k["_i"].to_numpy(), "xg_mp"] = k["xg_mp"].to_numpy()
    te["strength_detail"] = detailed_strength(te)
    en = te["strength_class"].eq("EN").to_numpy()
    te["xg1_prod_live"] = np.where(en, v1.EN_XG, te["xg1_prod"])   # production applies the EN constant

    fold = {"season": S, "role": ROLES.get(S, "other"), "train_seasons": train_seasons,
            "season_weights": {s: round(float(season_weights(pd.Series([s]), ref, decay)[0]), 4) for s in train_seasons},
            "n_train": int(len(tr)), "n_test": int(len(te)), "n_trees": m.meta.get("n_trees"),
            "fit_seconds": round(fit_s, 1), "asof_seconds": round(asof_s, 1), "v1_pit_fit_seconds": round(v1_s, 1),
            "rink_adjust": bool(use_rink), "rinks_adjusted": len(rink.knots) if rink else 0,
            "asof_refits": asof_log}

    models = {"xg2": "xg2", "xg2_asof": "xg2_asof", "xg1_pit": "xg1_pit", "xg1_prod": "xg1_prod_live"}
    # --- main set: non-EN, non-PS, with coordinates, scored by every model ---
    main_mask = (~te["strength_class"].isin(["EN", "PS"]) & te["distance"].notna() & te["xg1_pit"].notna()).to_numpy()
    d = te[main_mask]
    y = d["is_goal"].to_numpy()
    fold["main"] = {"definition": "unblocked non-shootout attempts, excl. empty net and penalty shots, with coordinates"}
    for k, c in models.items():
        fold["main"][k] = summary(y, d[c])
    for k in ("xg2", "xg2_asof"):
        fold["main"][f"diff_{k}_minus_xg1_pit"] = paired_diff(y, d[k], d["xg1_pit"], d["game_id"])
        fold["main"][f"diff_{k}_minus_xg1_prod"] = paired_diff(y, d[k], d["xg1_prod"], d["game_id"])
    fold["main"]["diff_xg2_asof_minus_xg2"] = paired_diff(y, d["xg2_asof"], d["xg2"], d["game_id"])
    fold["main"]["reliability_xg2"] = reliability(y, d["xg2"])
    fold["main"]["reliability_xg2_asof"] = reliability(y, d["xg2_asof"])
    fold["main"]["reliability_xg1_pit"] = reliability(y, d["xg1_pit"])
    # --- all unblocked attempts (v1 prod gets the production EN override) ---
    a = te[te["xg1_pit"].notna()]
    ya = a["is_goal"].to_numpy()
    fold["all"] = {"definition": "every unblocked non-shootout attempt with coordinates (v1 prod: EN override 0.52)"}
    fold["by_strength_class"], fold["by_strength"] = {}, {}
    for k, c in models.items():
        fold["all"][k] = summary(ya, a[c])
        fold["by_strength_class"][k] = by_group(ya, a[c], a["strength_class"])
        fold["by_strength"][k] = by_group(ya, a[c], a["strength_detail"], min_n=200)
    # --- MoneyPuck intersection ---
    mpm = a["xg_mp"].notna().to_numpy()
    if mpm.sum() > 1000:
        b = a[mpm]
        yb = b["is_goal"].to_numpy()
        bm = ~b["strength_class"].isin(["EN", "PS"]).to_numpy()
        fold["moneypuck"] = {
            "coverage": round(float(mpm.mean()), 4),
            "note": "MoneyPuck xGoal is in sample for its own season (optimistic reference); joined on game, "
                    "period, game second, shooter and event type",
            "all": {**{k: summary(yb, b[c]) for k, c in models.items()}, "moneypuck": summary(yb, b["xg_mp"])},
            "main": {**{k: summary(yb[bm], b[c].to_numpy()[bm]) for k, c in models.items()},
                     "moneypuck": summary(yb[bm], b["xg_mp"].to_numpy()[bm])},
            "by_strength_class": by_group(yb, b["xg_mp"], b["strength_class"]),
        }
        for k in ("xg2", "xg2_asof"):
            fold["moneypuck"]["all"][f"diff_{k}_minus_mp"] = paired_diff(yb, b[k], b["xg_mp"], b["game_id"])
            fold["moneypuck"]["main"][f"diff_{k}_minus_mp"] = paired_diff(
                yb[bm], b[k].to_numpy()[bm], b["xg_mp"].to_numpy()[bm], b["game_id"].to_numpy()[bm])
    if state_dir:
        os.makedirs(state_dir, exist_ok=True)
        m.save(os.path.join(state_dir, f"fold_{S}"))
        from .features import flurry_adjust
        te["xg2_flurry"] = flurry_adjust(te, "xg2")
        te["xg2_asof_flurry"] = flurry_adjust(te, "xg2_asof")
        cols = ["game_id", "event_id", "season", "game_date", "period", "game_seconds", "shooting_team_id",
                "shooter_id", "goalie_in_net_id", "is_home", "strength", "strength_class", "is_goal", "xg2",
                "xg2_flurry", "xg2_asof", "xg2_asof_flurry", "xg1_pit", "xg1_prod", "xg_mp"]
        te[cols].to_parquet(os.path.join(state_dir, f"oos_xg2_{S}.parquet"), index=False)
    return fold, te


def _gate_a(f: dict, key: str) -> dict:
    d = f["main"][f"diff_{key}_minus_xg1_pit"]
    auc2, auc1 = f["main"][key]["auc"], f["main"]["xg1_pit"]["auc"]
    return {"role": f["role"], "ll_diff_vs_v1_pit": d["mean"], "se": d["se"], "auc": auc2, "auc_xg1_pit": auc1,
            "pass": bool(d["mean"] <= -GATE_LL_MARGIN and auc2 >= auc1)}


def _gate_b(f: dict, key: str) -> dict:
    ratios = {}
    lo, hi = GATE_RATIO
    for k in GATE_DESIGN_STRENGTHS:
        r = f["by_strength"][key].get(k)
        r1 = f["by_strength"]["xg1_pit"].get(k)
        if not r:
            continue
        se = (r["goals"] ** 0.5) / r["xg"] if r["xg"] else float("nan")   # Poisson SE of goals/xG
        ci = [round(r["goals_per_xg"] - 1.96 * se, 4), round(r["goals_per_xg"] + 1.96 * se, 4)]
        ratios[k] = {"goals_per_xg": r["goals_per_xg"], "n": r["n"], "goals": r["goals"], "ci95": ci,
                     "v1_pit_goals_per_xg": r1["goals_per_xg"] if r1 else None,
                     "pass": bool(lo <= r["goals_per_xg"] <= hi), "consistent": bool(ci[0] <= hi and ci[1] >= lo)}
    return {"role": f["role"], "ratios": ratios, "pass": all(v["pass"] for v in ratios.values()),
            "consistent": all(v["consistent"] for v in ratios.values())}


def m1_gate(folds: dict) -> dict:
    """DESIGN §8 M1 gate, parts (a) and (b), for the season-start model (``xg2``: what ships on a
    season's first day and what CI keeps scoring with until the next refit) and for the monthly
    as-of refits (``xg2_asof``).  (c) is the game-level gate (``bu.xg.game_gate``); (d) needs >= 100
    live shadow games."""
    dev = [s for s, f in folds.items() if f["role"] == "dev"]
    out = {"dev_folds": dev}
    for key in ("xg2", "xg2_asof"):
        a_rows = {s: _gate_a(f, key) for s, f in folds.items()}
        b_rows = {s: _gate_b(f, key) for s, f in folds.items()}
        out[key] = {
            "a_shot_ll": {"rule": f"dev folds: LL <= LL(v1 PIT) - {GATE_LL_MARGIN} and AUC >= AUC(v1 PIT)",
                          "per_fold": a_rows, "pass": bool(dev) and all(a_rows[s]["pass"] for s in dev)},
            "b_goals_per_xg": {"rule": f"dev folds: goals/xG in {list(GATE_RATIO)} for {GATE_DESIGN_STRENGTHS}",
                               "per_fold": b_rows, "pass": bool(dev) and all(b_rows[s]["pass"] for s in dev),
                               "consistent_within_sampling_error": bool(dev) and all(b_rows[s]["consistent"] for s in dev)},
        }
    out["note_b"] = ("the literal [0.97, 1.03] band is narrower than one season's sampling error for the small "
                     "strengths (3v3, 4v5, EN: ~100-250 goals, SE ~6-10%); 'consistent' asks whether the 95% "
                     "Poisson CI of goals/xG overlaps the band")
    return out


def fit_production(shots: pd.DataFrame, out_dir: str = PROD_DIR, window: int = WINDOW, decay: float = DECAY,
                   cur_weight: float = CUR_WEIGHT, use_rink: bool = True, asof: str | None = None,
                   calibrate: bool = False) -> dict:
    """The live model: completed seasons before the current one (recency-weighted) plus the current
    season's games played before ``asof`` (default: every current-season game in the lake)."""
    from season import SEASON_ID
    seasons = sorted(set(shots["season"]))
    done = [s for s in seasons if s < SEASON_ID][-window:]
    prior = shots[shots["season"].isin(done)].copy()
    pw = season_weights(prior["season"], SEASON_ID, decay)
    cur = shots[shots["season"] == SEASON_ID].copy()
    if asof:
        cur = cur[pd.to_datetime(cur["game_date"]) < pd.Timestamp(asof)]
    rink = RinkAdjuster.fit(prior[pw > 0]) if use_rink else None
    if rink is not None:
        prior["dist_rink"] = rink.adjust(prior)
        cur["dist_rink"] = rink.adjust(cur)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    last_game = str(pd.to_datetime(cur["game_date"]).max().date()) if len(cur) else None
    meta = {"trained_at": stamp, "asof": asof or stamp[:10], "current_season": SEASON_ID,
            "current_season_shots": int(len(cur)), "current_season_last_game": last_game,
            "season_weights": {s: round(float(season_weights(pd.Series([s]), SEASON_ID, decay)[0]), 4) for s in done},
            "current_season_weight": cur_weight, "decay": decay, "window": window}
    m = fit_asof(prior, pw, cur, cur_weight=cur_weight, rink=rink, calibrate=calibrate, log=log, extra_meta=meta)
    paths = m.save(out_dir)
    return {"fit_seasons": m.meta["fit_seasons"], "n_train": m.meta["n_train"], "n_trees": m.meta["n_trees"],
            **meta, **{k: os.path.relpath(v, os.path.dirname(os.path.dirname(HERE))) for k, v in paths.items()}}


def load_lake_shots(lake, hand: dict):
    seasons = [s for s in lake_seasons(lake) if s[4:] == str(int(s[:4]) + 1)]
    shots, rows = [], []
    for s in seasons:
        sh, r = load_season(lake, s, hand)
        if sh is not None and len(sh):
            shots.append(sh)
            rows.append(r)
            log(f"  loaded {s}: {len(sh):,} unblocked shots")
    return seasons, pd.concat(shots, ignore_index=True), pd.concat(rows, ignore_index=True)


def main(argv=None):
    from bu.lake.paths import Lake
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lake-dir")
    ap.add_argument("--mp-dir", help="directory of MoneyPuck shots_<year>.zip (optional)")
    ap.add_argument("--state-dir", help="where fold models and per-shot OOS scores go")
    ap.add_argument("--test-seasons", help="comma list; default: every completed lake season with an earlier one")
    ap.add_argument("--window", type=int, default=WINDOW)
    ap.add_argument("--decay", type=float, default=DECAY)
    ap.add_argument("--cur-weight", type=float, default=CUR_WEIGHT)
    ap.add_argument("--no-rink", action="store_true")
    ap.add_argument("--no-asof", action="store_true", help="skip the monthly as-of refits")
    ap.add_argument("--calibrate", action="store_true", help="per-strength Platt maps (neutral on dev folds)")
    ap.add_argument("--out", default=REPORT)
    ap.add_argument("--fit-production", action="store_true", help="also write models/xg2_* (live model)")
    ap.add_argument("--production-only", action="store_true", help="only refit the live model (no walk-forward)")
    ap.add_argument("--asof", help="production refit: use current-season games before this date (YYYY-MM-DD)")
    a = ap.parse_args(argv)
    lake = Lake(a.lake_dir)
    hand = handedness.load()
    seasons, shots, rows = load_lake_shots(lake, hand)
    if a.production_only:
        res = fit_production(shots, window=a.window, decay=a.decay, cur_weight=a.cur_weight,
                             use_rink=not a.no_rink, asof=a.asof, calibrate=a.calibrate)
        log(json.dumps(res, indent=1))
        return res
    from season import SEASON_ID
    complete = [s for s in sorted(set(shots["season"])) if s < SEASON_ID]
    tests = a.test_seasons.split(",") if a.test_seasons else complete[1:]
    mp = None
    if a.mp_dir:
        from .moneypuck import load_dir
        mp = load_dir(a.mp_dir, years=[int(s[:4]) for s in tests])
    folds = {}
    for S in tests:
        f, _ = run_fold(S, shots, rows, mp, state_dir=a.state_dir, use_rink=not a.no_rink, window=a.window,
                        decay=a.decay, asof=not a.no_asof, calibrate=a.calibrate)
        folds[S] = f
        m = f["main"]
        log(f"  {S}: LL v2 {m['xg2']['log_loss']:.5f}  v2-asof {m['xg2_asof']['log_loss']:.5f}  "
            f"v1-PIT {m['xg1_pit']['log_loss']:.5f}  v1-prod {m['xg1_prod']['log_loss']:.5f}  "
            f"diff {m['diff_xg2_minus_xg1_pit']['mean']:+.5f}/{m['diff_xg2_asof_minus_xg1_pit']['mean']:+.5f}  "
            f"AUC {m['xg2']['auc']:.4f}/{m['xg2_asof']['auc']:.4f}/{m['xg1_pit']['auc']:.4f}")
    cfg = {"rink": not a.no_rink, "window": a.window, "decay": a.decay, "cur_weight": a.cur_weight,
           "calibrate": a.calibrate}
    report = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "design": "DESIGN.md v2 §3.1, §8 M1",
        "config": cfg, "config_hash": config_hash(cfg),
        "lake_seasons": seasons, "test_seasons": tests,
        "handedness_players": len(hand),
        "models": {
            "xg2": "xG v2 season-start model: trained on seasons < S only, scores all of S",
            "xg2_asof": "xG v2 with monthly as-of refits: block [m, m+1) scored by a model trained on seasons < S "
                        "plus S games before m (weight cur_weight)",
            "xg1_pit": "incumbent v1 recipe re-fit on seasons [S-window, S-1] (the M1 bar)",
            "xg1_prod": "committed xg_model_xgb.pkl with the production empty-net override (in sample on 2022-26)",
        },
        "moneypuck_credit": "MoneyPuck.com shot data (benchmark only)",
        "folds": folds, "gate": m1_gate(folds),
    }
    if a.fit_production:
        report["production"] = fit_production(shots, window=a.window, decay=a.decay, cur_weight=a.cur_weight,
                                              use_rink=not a.no_rink, asof=a.asof, calibrate=a.calibrate)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(report, f, indent=1)
        f.write("\n")
    log(f"report -> {a.out}")
    return report


if __name__ == "__main__":
    main()
