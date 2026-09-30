"""
refresh_pipeline.py — orchestrates the data pipeline.

    python refresh_pipeline.py --mode full   # daily ingest: scrape finals, rescore new shots,
                                             # ratings, player models, predictions, sims
    python refresh_pipeline.py --mode lite   # pregame hourly: schedule/goalies, injuries,
                                             # odds, predictions

Every stage is run through StageRunner, which records {stage, status
(ok/skip/fail), rows_written, seconds, required} and never lets a stage end
the interpreter (legacy ``sys.exit`` inside a stage is caught as a failure).
At the end the run summary is written to public/data/manifest.json:

    {schema_version, season_id, season_label, generated_at (UTC ISO), mode,
     games_played_current_season, phase{...}, stages[], stale{file: reason},
     sources{name: {fetched_at, ...}}, last_full_run, last_lite_run}

The process exits non-zero if any *required* stage failed.  For testing the
alerting path, PONYXG_FORCE_FAIL=<stage>[,<stage>] makes those stages raise.
"""
import os
import sys

os.environ.setdefault("PYTHONUNBUFFERED", "1")
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

import argparse
import hashlib
import importlib
import shutil
import time
import traceback
from datetime import datetime, timedelta, timezone

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
if PIPELINE_DIR not in sys.path:
    sys.path.insert(0, PIPELINE_DIR)

import pandas as pd

from season import (SEASON_ID, SEASON_LABEL, START_YEAR, season_file, read_season_csv,
                    PLAYER_MODEL_MIN_GAMES, game_type_of, today_local)
from io_utils import (utc_now_iso, load_manifest, update_manifest, record_source, source_age_hours,
                      mark_stale, clear_stale, atomic_write_csv, read_json)
from paths import PUBLIC_DATA_DIR, DATA_DIR, TEAM_RATINGS_FILE

XG_DECIMALS = 4
EN_XG = 0.52                 # empirical empty-net conversion rate
NORM_PRIOR_GOALS = 1000      # shrink league normalisation toward 1.0 early in a season
RATINGS_MAX_AGE_HOURS = 36
IMPLICATIONS_MIN_GP = 20
HIGH_DANGER_BINS = {'D2_W3_In', 'D2_W2', 'D1_W2_In', 'D3_W1', 'D2_W1', 'D1_W1'}


# ── Stage runner ─────────────────────────────────────────────────────────────

class StageRunner:
    def __init__(self, mode):
        self.mode = mode
        self.stages = []
        self.started_at = utc_now_iso()
        self.t0 = time.time()
        self.force_fail = {s.strip() for s in os.environ.get("PONYXG_FORCE_FAIL", "").split(",") if s.strip()}

    def run(self, name, fn, *args, required=False, title=None, **kwargs):
        print(f"\n=== [{name}] {title or ''} ===", flush=True)
        t = time.time()
        status, rows, err, extra, res = "ok", 0, None, {}, None
        try:
            if name in self.force_fail:
                raise RuntimeError(f"forced failure (PONYXG_FORCE_FAIL={name})")
            res = fn(*args, **kwargs)
            if isinstance(res, dict):
                status = res.get("status", "ok")
                rows = int(res.get("rows_written") or 0)
                if res.get("reason"):
                    extra["reason"] = str(res["reason"])[:300]
            elif isinstance(res, bool):
                status = "ok" if res else "fail"
            elif isinstance(res, int):
                rows = res
        except KeyboardInterrupt:
            raise
        except BaseException as e:           # includes SystemExit from legacy scripts
            status, err = "fail", f"{type(e).__name__}: {e}"
            traceback.print_exc()
        rec = {"stage": name, "status": status, "rows_written": rows,
               "seconds": round(time.time() - t, 1), "required": required}
        if err:
            rec["error"] = err[:500]
        rec.update(extra)
        self.stages.append(rec)
        print(f"[STAGE] {name}: {status} rows={rows} {rec['seconds']}s"
              + (f" — {err}" if err else (f" — {extra['reason']}" if extra.get('reason') else "")), flush=True)
        return res

    def skip(self, name, reason, required=False):
        self.stages.append({"stage": name, "status": "skip", "rows_written": 0, "seconds": 0.0,
                            "required": required, "reason": reason})
        print(f"[STAGE] {name}: skip — {reason}", flush=True)

    def failed_required(self):
        return [s for s in self.stages if s["required"] and s["status"] == "fail"]

    def summary(self):
        print("\n--- Stage summary ---")
        for s in self.stages:
            flag = "!" if s["status"] == "fail" else " "
            print(f"{flag} {s['stage']:<26} {s['status']:<5} rows={s['rows_written']:<7} "
                  f"{s['seconds']:>7.1f}s{'  (required)' if s['required'] else ''}"
                  + (f"  {s.get('error') or s.get('reason') or ''}" if s["status"] != "ok" else ""))
        print(f"  total {time.time() - self.t0:.1f}s")


def _call(module, func="main", *args, **kwargs):
    mod = importlib.import_module(module)
    return getattr(mod, func)(*args, **kwargs)


# ── Season phase ─────────────────────────────────────────────────────────────

def season_phase():
    """What part of the season we are in, from the schedule and scraped games."""
    upcoming = read_json(os.path.join(PIPELINE_DIR, "upcoming_games.json"), []) or []
    gs = read_season_csv("gamestats")
    reg = gs[gs["game_id"].astype(str).str[4:6] == "02"] if not gs.empty else gs
    counts = reg.groupby("team").size() if not reg.empty else pd.Series(dtype=int)
    min_gp = int(counts.min()) if len(counts) >= 32 else 0
    last_date = str(gs["game_date"].max()) if not gs.empty else None
    today = today_local()
    recent = bool(last_date and (today - datetime.fromisoformat(last_date).date()).days <= 7)
    playoff_upcoming = any(game_type_of(g.get("id")) == "03" for g in upcoming)
    playoff_recent = (not gs.empty and (gs["game_id"].astype(str).str[4:6] == "03").any() and recent)
    return {
        "in_season": bool(upcoming) or recent,
        "playoffs": bool(playoff_upcoming or playoff_recent),
        "games_played": int(gs["game_id"].nunique()) if not gs.empty else 0,
        "min_team_gp": min_gp,
        "last_game_date": last_date,
        "upcoming_games": len(upcoming),
    }


# ── Stages ───────────────────────────────────────────────────────────────────

def stage_rollover():
    """Run the season rollover (pipeline/rollover.py, owned by the season-
    context workstream) once per season.  Tracked by manifest.rollover_season_id."""
    m = load_manifest()
    if m.get("rollover_season_id") == SEASON_ID:
        return {"status": "skip", "reason": f"already rolled over to {SEASON_ID}"}
    if not os.path.exists(os.path.join(PIPELINE_DIR, "rollover.py")):
        return {"status": "skip", "reason": "rollover.py not present"}
    import rollover
    fn = getattr(rollover, "run", None) or getattr(rollover, "main")
    try:
        res = fn(old_season_id=m.get("season_id"), new_season_id=SEASON_ID)
    except TypeError:
        res = fn()
    update_manifest(lambda mm: mm.__setitem__("rollover_season_id", SEASON_ID))
    return res if isinstance(res, dict) else {"status": "ok"}


def stage_scrape():
    import scrape_games
    return scrape_games.main([])


def stage_special_teams():
    import scrape_games
    return scrape_games.patch_special_teams(season_file("gamestats"), season_id=SEASON_ID)


def model_hash(path=os.path.join(PIPELINE_DIR, "xg_model_xgb.pkl")):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def stage_rescore_xg(state, rescore_all=False):
    """Idempotent xG for this season's shots.

    xg_raw   = model output (EN override applied), scored only for rows that
               don't have it yet, or for every row when the model file changes.
    xG       = xg_raw x shooting talent x league normalisation, recomputed
               deterministically from xg_raw each run.
    Both are rounded to 4 decimals and the file is only rewritten when a value
    actually changes, so a run with no new games produces a zero-line diff.
    nhl_historical_shots.csv is never touched here.
    """
    path = season_file("shots")
    if not os.path.exists(path):
        state["xg_agg"] = None
        return {"status": "skip", "reason": "no shots this season yet"}
    df = pd.read_csv(path, low_memory=False, float_precision="round_trip")
    if df.empty:
        state["xg_agg"] = None
        return {"status": "skip", "reason": "no shots this season yet"}
    before = df.copy()

    mh = model_hash()
    prev_hash = ((load_manifest().get("sources") or {}).get("xg_model") or {}).get("hash")
    if "xg_raw" not in df.columns:
        df["xg_raw"] = float("nan")
    need = df["xg_raw"].isna()
    if rescore_all or (prev_hash and prev_hash != mh):
        print(f"  Model hash changed ({prev_hash} -> {mh}) — rescoring every shot")
        need[:] = True
    n_scored = int(need.sum())
    if n_scored:
        import pickle
        from xg_model import preprocess_data
        with open(os.path.join(PIPELINE_DIR, "xg_model_xgb.pkl"), "rb") as f:
            model = pickle.load(f)
        sub = df[need]
        X, _ = preprocess_data(sub)
        if len(X) != len(sub):
            raise ValueError(f"preprocess_data returned {len(X)} rows for {len(sub)} shots")
        probs = model.predict_proba(X)[:, 1]
        mean_new = float(probs.mean())
        print(f"  Scored {n_scored} shots; mean raw xG {mean_new:.4f} (expected ~0.07)")
        if mean_new > 0.15:
            raise ValueError(f"ABORT: mean xG {mean_new:.4f} — model/library mismatch?")
        df.loc[need, "xg_raw"] = probs
        if "strength_state" in df.columns:
            df.loc[need & (df["strength_state"] == "EmptyNet"), "xg_raw"] = EN_XG
    df["xg_raw"] = df["xg_raw"].astype(float).round(XG_DECIMALS)

    # Persist xg_raw first: shooting talent is computed from xg_raw on disk.
    if n_scored:
        atomic_write_csv(path, df, min_rows=len(before), label="season shots")
    try:
        from shooting_talent import compute_shooting_talent
        talent_map = compute_shooting_talent()
    except Exception as e:
        print(f"  [WARN] Shooting talent computation failed: {e}")
        talent_map = {}

    adj = df["xg_raw"].astype(float).copy()
    if talent_map and "player_id" in df.columns:
        adj = adj * df["player_id"].map(talent_map).fillna(1.0)
    if "is_goal" in df.columns:
        tot_xg, tot_g = float(adj.sum()), float(pd.to_numeric(df["is_goal"], errors="coerce").fillna(0).sum())
        if tot_xg > 0 and tot_g > 0:
            factor = (tot_g + NORM_PRIOR_GOALS) / (tot_xg + NORM_PRIOR_GOALS)
            adj = adj * factor
            print(f"  League normalization factor {factor:.4f} (xG {tot_xg:.0f} vs {tot_g:.0f} goals)")
    df["xG"] = adj.round(XG_DECIMALS)
    df["xG_flurry_adj"] = df["xG"]

    cols = ["xg_raw", "xG", "xG_flurry_adj"]
    changed = any(c not in before.columns for c in cols) or not all(
        before[c].astype(float).round(XG_DECIMALS).fillna(-1).equals(df[c].astype(float).fillna(-1)) for c in cols)
    if changed:
        atomic_write_csv(path, df, min_rows=len(before), label="season shots")
        print(f"  Updated {path} (xg_raw + adjusted xG)")
    else:
        print(f"  {path}: xG unchanged — not rewritten")
    record_source("xg_model", hash=mh)

    agg = df.groupby(["game_id", "team_id"])["xG"].sum().rename("xG_sum").reset_index()
    if "strength_state" in df.columns:
        for label, st in (("xG_5v5_sum", "5v5"), ("xG_pp_sum", "5v4")):
            part = df[df["strength_state"] == st].groupby(["game_id", "team_id"])["xG"].sum().rename(label)
            agg = agg.merge(part.reset_index(), on=["game_id", "team_id"], how="left")
    agg = agg.fillna(0.0)
    state["xg_agg"] = agg
    state["shots_df"] = df
    return {"status": "ok", "rows_written": n_scored if changed else 0, "reason": f"{n_scored} new shots scored"}


def hd_period_table(shots, tid_to_name):
    """Per (game_id, team): HD attempts for/against (+ per period) and per-period xG for/against."""
    from scrape_games import assign_bin
    s = shots.copy()
    s["_hd"] = [int(assign_bin(x if pd.notna(x) else None, y if pd.notna(y) else None) in HIGH_DANGER_BINS)
                for x, y in zip(s["x"], s["y"])]
    s["_p"] = s["period"].apply(lambda p: {1: "1P", 2: "2P", 3: "3P"}.get(int(p), "OT") if pd.notna(p) else "OT")
    s["team"] = s["team_id"].astype(int).map(tid_to_name)
    s["_xG"] = pd.to_numeric(s["xG"], errors="coerce").fillna(0.0)
    g = s.groupby(["game_id", "team"])
    base = g["_hd"].sum().rename("hdf").to_frame()
    hdp = s.pivot_table(index=["game_id", "team"], columns="_p", values="_hd", aggfunc="sum", fill_value=0)
    xgp = s.pivot_table(index=["game_id", "team"], columns="_p", values="_xG", aggfunc="sum", fill_value=0.0)
    for p in ("1P", "2P", "3P", "OT"):
        base[f"hdf_{p}"] = hdp[p] if p in hdp.columns else 0
        base[f"xg_for_{p}"] = (xgp[p] if p in xgp.columns else 0.0)
    base = base.fillna(0).reset_index()
    # against = the other team in the same game
    opp = base.rename(columns={c: c.replace("hdf", "hda").replace("xg_for", "xg_ag") for c in base.columns
                               if c.startswith(("hdf", "xg_for"))}).rename(columns={"team": "opponent"})
    pairs = base[["game_id", "team"]].merge(base[["game_id", "team"]].rename(columns={"team": "opponent"}),
                                           on="game_id")
    pairs = pairs[pairs["team"] != pairs["opponent"]]
    out = base.merge(pairs, on=["game_id", "team"], how="left").merge(opp, on=["game_id", "opponent"], how="left")
    return out.drop(columns=["opponent"]).fillna(0)


def stage_update_gamestats(state):
    """Write the aggregated xG and HD/per-period columns into this season's gamestats."""
    path = season_file("gamestats")
    agg = state.get("xg_agg")
    if not os.path.exists(path) or agg is None:
        return {"status": "skip", "reason": "no gamestats/shots this season yet"}
    gs = pd.read_csv(path, low_memory=False, float_precision="round_trip")
    before = gs.copy()
    teams = pd.read_csv(os.path.join(PIPELINE_DIR, "nhl_teams.csv"))
    tid_to_name = dict(zip(teams["NHL Team ID"].astype(int), teams["Common Name"]))
    a = agg.copy()
    a["team"] = a["team_id"].astype(int).map(tid_to_name)
    a = a.dropna(subset=["team"]).set_index(["game_id", "team"])

    key_t = list(zip(gs["game_id"].astype("int64"), gs["team"]))
    key_o = list(zip(gs["game_id"].astype("int64"), gs["opponent"]))

    def pick(col, keys, fallback):
        vals = a[col].reindex(keys).values if col in a.columns else [float("nan")] * len(keys)
        out = pd.Series(vals, index=gs.index)
        return out.where(out.notna(), fallback).astype(float).round(XG_DECIMALS)

    gs["xG_for"] = pick("xG_sum", key_t, gs.get("xG_for"))
    gs["xG_against"] = pick("xG_sum", key_o, gs.get("xG_against"))
    gs["xG_for_5v5"] = pick("xG_5v5_sum", key_t, gs.get("xG_for_5v5"))
    gs["xG_against_5v5"] = pick("xG_5v5_sum", key_o, gs.get("xG_against_5v5"))
    gs["xG_pp_for"] = pick("xG_pp_sum", key_t, gs.get("xG_pp_for", 0.0))
    gs["xG_pp_against"] = pick("xG_pp_sum", key_o, gs.get("xG_pp_against", 0.0))

    hd = hd_period_table(state["shots_df"], tid_to_name).set_index(["game_id", "team"])
    for col in hd.columns:
        vals = hd[col].reindex(key_t).values
        cur = gs[col] if col in gs.columns else pd.Series([None] * len(gs), index=gs.index)
        new = pd.Series(vals, index=gs.index).where(pd.notna(vals), cur)
        gs[col] = new.round(XG_DECIMALS) if col.startswith("xg_") else new
    print(f"  Patched xG totals and HD/per-period columns for {len(gs)} team-games")

    changed = not before.reindex(columns=gs.columns).astype(str).equals(gs.astype(str))
    if changed:
        atomic_write_csv(path, gs, min_rows=len(before), label="gamestats")
    return {"status": "ok", "rows_written": len(gs) if changed else 0}


def _md5(path):
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def stage_sync_gamestats():
    """public/data/gamestats.csv and data/gamestats.csv mirror this season's
    gamestats whenever it changes (lite and full runs)."""
    src = os.path.join(PIPELINE_DIR, season_file("gamestats"))
    mirrors = (os.path.join(PUBLIC_DATA_DIR, "gamestats.csv"), os.path.join(DATA_DIR, "gamestats.csv"))
    if not os.path.exists(src):
        # New season, nothing scraped yet: the mirrors must not keep serving
        # last season's games as if they were this season's.
        n = 0
        for dst in mirrors:
            if not os.path.exists(dst):
                continue
            with open(dst, encoding="utf-8") as f:
                header, first = f.readline(), f.readline()
            if first and not first.startswith(str(START_YEAR)):
                tmp = dst + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write(header)
                os.replace(tmp, dst)
                n += 1
                print(f"  {os.path.relpath(dst, PIPELINE_DIR)} held another season's games — reset to header only")
        return {"status": "ok" if n else "skip", "rows_written": 0,
                "reason": "no games scraped this season yet" + (f"; reset {n} mirror(s)" if n else "")}
    h = _md5(src)
    n = 0
    for dst in mirrors:
        if os.path.isdir(os.path.dirname(dst)) and _md5(dst) != h:
            tmp = dst + ".tmp"
            shutil.copyfile(src, tmp)
            os.replace(tmp, dst)
            n += 1
            print(f"  Synced {season_file('gamestats')} -> {os.path.relpath(dst, PIPELINE_DIR)}")
    return {"status": "ok" if n else "skip", "rows_written": n, "reason": "" if n else "already in sync"}


def stage_team_ratings():
    from team_ratings import calculate_ratings
    calculate_ratings(gamestats_file=season_file("gamestats"))
    age_min = (time.time() - os.path.getmtime(TEAM_RATINGS_FILE)) / 60
    if age_min > 5:
        raise RuntimeError(f"team_ratings.json was not updated (age={age_min:.1f}m)")
    record_source("team_ratings", generated_at=utc_now_iso())
    return {"status": "ok", "rows_written": len(read_json(TEAM_RATINGS_FILE, {}) or {})}


def stage_ratings_freshness(phase):
    """Lite runs must not predict from ratings that stopped updating."""
    age = source_age_hours("team_ratings")
    if age is None:
        return {"status": "skip", "reason": "ratings generation time not recorded yet (first full run pending)"}
    if phase.get("in_season") and phase.get("games_played", 0) > 0 and age > RATINGS_MAX_AGE_HOURS:
        mark_stale("team_ratings.json", f"generated {age:.0f}h ago")
        raise RuntimeError(f"team_ratings.json generated {age:.0f}h ago (> {RATINGS_MAX_AGE_HOURS}h in season)")
    clear_stale("team_ratings.json")
    return {"status": "ok", "reason": f"{age:.1f}h old"}


def stage_player_models(state, n_games):
    """MoneyPuck + PBP + RAPM + player impact once the season has enough games;
    until then only re-point the committed profiles at current rosters."""
    import player_impact
    if n_games < PLAYER_MODEL_MIN_GAMES:
        print(f"  {n_games} games this season (< {PLAYER_MODEL_MIN_GAMES}); keeping last season's "
              "player ratings, refreshing roster teams only")
        return player_impact.refresh_roster_teams()
    mp = _call("fetch_moneypuck", "fetch_moneypuck")
    if mp.get("status") == "fail" and not os.path.exists(os.path.join(PIPELINE_DIR, "moneypuck_skaters.csv")):
        return {"status": "fail", "reason": "MoneyPuck unavailable and no cached skaters.csv"}
    for mod, fn in (("calc_pbp_impact", "run_pbp_impact"), ("calc_rapm", "run_rapm")):
        try:
            _call(mod, fn)
        except Exception as e:
            print(f"  [WARN] {mod} failed (impact scores fall back): {e}")
    pi, _ = player_impact.calculate_player_impact()
    return {"status": "ok", "rows_written": len(pi)}


def stage_lineups_all():
    """Overnight all-32-teams DailyFaceoff lineup refresh (also yields cap data)."""
    import fetch_dailyfaceoff
    teams = pd.read_csv(os.path.join(PIPELINE_DIR, "nhl_teams.csv"))
    lst = [{"triCode": r["Team Tricode"], "teamName": r["Team Name"]} for _, r in teams.iterrows()]
    merged = fetch_dailyfaceoff.fetch_lineups(lst, force_all=True)
    return {"status": "ok" if len(fetch_dailyfaceoff.CAP_DATA) >= 30 else "fail",
            "rows_written": len(fetch_dailyfaceoff.CAP_DATA), "reason": f"{len(merged)} teams stored"}


def stage_contracts():
    import fetch_contracts
    return fetch_contracts.main()


def stage_raw_pbp():
    """Incremental raw PBP archive (data/historical_pbp/raw_pbp_<season>.csv)."""
    import update_raw_pbp
    update_raw_pbp.main(days_back=3)
    return {"status": "ok"}


def stage_upcoming():
    import fetch_upcoming
    res = fetch_upcoming.fetch_schedule()
    return {k: v for k, v in res.items() if k != "games"}


def stage_predict():
    from predict_games import predict
    predict()
    return {"status": "ok", "rows_written": len(read_json(os.path.join(PIPELINE_DIR, "upcoming_games.json"), []) or [])}


def stage_implications():
    import game_implications
    importlib.reload(game_implications)
    game_implications.compute_game_implications()


def stage_final_sync():
    n = 0
    pairs = [
        (os.path.join(PUBLIC_DATA_DIR, "last_updated.json"), os.path.join(DATA_DIR, "last_updated.json")),
        (os.path.join(PIPELINE_DIR, "upcoming_games.json"), os.path.join(PUBLIC_DATA_DIR, "upcoming_games.json")),
        (os.path.join(PIPELINE_DIR, "team_lineups.json"), os.path.join(PUBLIC_DATA_DIR, "team_lineups.json")),
        (os.path.join(PIPELINE_DIR, "odds.json"), os.path.join(PUBLIC_DATA_DIR, "odds.json")),
        (os.path.join(PIPELINE_DIR, "odds.json"), os.path.join(DATA_DIR, "odds.json")),
    ]
    for src, dst in pairs:
        if os.path.exists(src) and _md5(src) != _md5(dst):
            shutil.copyfile(src, dst + ".tmp")
            os.replace(dst + ".tmp", dst)
            n += 1
            print(f"  Synced {os.path.relpath(src, PIPELINE_DIR)} -> {os.path.relpath(dst, PIPELINE_DIR)}")
    return {"status": "ok", "rows_written": n}


# ── Modes ────────────────────────────────────────────────────────────────────

def pregame_stages(r, phase, mode):
    """Stages shared by lite and full runs: schedule, availability, odds."""
    r.run("upcoming_games", stage_upcoming, required=True, title="Schedule, goalies, team_goalies")
    phase.update(season_phase())
    r.run("injuries", _call, "fetch_injuries", "fetch_injuries", title="ESPN injury report")
    r.run("clinch_status", _call, "fetch_clinch_status", title="Clinch indicators")
    r.run("player_boxscores", _call, "backfill_player_stats", title="Per-player boxscore stats")
    r.run("odds", _call, "fetch_odds", "fetch_odds", title="Pregame odds + closing lines")
    # Goalie season lines move with every game, so the lite run refreshes them too.
    r.run("goalie_stats", _call, "fetch_nhl_goalie_stats", "fetch_nhl_goalie_stats", title="Goalie season lines")
    if phase["playoffs"]:
        r.run("playoff_series", _call, "update_playoff_series", title="Playoff series")
    else:
        r.skip("playoff_series", "not in the playoffs")


def post_predict_stages(r, phase):
    r.run("snapshot", _call, "snapshot_predictions", "snapshot", title="SiteHistory snapshot")
    if phase["playoffs"]:
        r.skip("implications", "playoffs in progress (series odds replace implications)")
    elif phase["min_team_gp"] < IMPLICATIONS_MIN_GP:
        r.skip("implications", f"min team GP {phase['min_team_gp']} < {IMPLICATIONS_MIN_GP}")
    else:
        r.run("implications", stage_implications, title="Playoff implications")


def stage_model_report():
    import model_report
    importlib.reload(model_report)
    rep = model_report.write_report()
    cur = (rep.get("seasons") or {}).get(rep.get("current_season")) or {}
    return {"status": "ok", "rows_written": int((cur.get("all") or {}).get("n") or 0)}


def stage_bet_ledger():
    import grade_bets
    importlib.reload(grade_bets)
    led = grade_bets.write_ledger()
    return {"status": "ok", "rows_written": sum(len(v.get("bets") or []) for v in (led.get("seasons") or {}).values())}


def grading_stages(r):
    """model_report.json and bet_ledger.json are derived from prediction_history.json
    and SiteHistory, so they are rebuilt on every run right after the graded record
    (validate_outputs.py 'reports' fails when they fall behind it)."""
    r.run("model_report", stage_model_report, required=True, title="Model report card")
    r.run("bet_ledger", stage_bet_ledger, required=True, title="Graded bet ledger")


def run_lite(r, phase):
    print("Running Lite Update...")
    r.run("rollover_check", stage_rollover)
    pregame_stages(r, phase, "lite")
    r.run("sync_gamestats", stage_sync_gamestats)
    r.run("ratings_freshness", stage_ratings_freshness, phase, required=True)
    print("Running Predictions...")
    r.run("predict", stage_predict, required=True, title="Running Predictions")
    post_predict_stages(r, phase)
    # Cheap: re-grade so the report and ledger pick up this run's snapshot and any final.
    r.run("prediction_history", _call, "generate_history", "generate_history", required=True)
    grading_stages(r)
    print("Final Sync...")
    r.run("final_sync", stage_final_sync, required=True)


def run_full(r, phase, rescore_all=False):
    print("--- Starting Full Pipeline Refresh ---")
    state = {}
    r.run("rollover_check", stage_rollover)
    r.run("scrape_games", stage_scrape, required=True, title="Scrape completed games")
    r.run("special_teams", stage_special_teams, title="Official PP/PK counts")
    r.run("rosters_bio_goalies", _call, "fetch_player_bio", title="Rosters, bios, team_goalies")
    r.run("xg_rescore", stage_rescore_xg, state, rescore_all, required=True, title="Idempotent xG")
    r.run("gamestats_update", stage_update_gamestats, state, required=True, title="xG + HD into gamestats")
    r.run("sync_gamestats", stage_sync_gamestats, required=True)
    r.run("team_ratings", stage_team_ratings, required=True, title="Team & goalie ratings")
    phase.update(season_phase())
    r.run("shifts", _call, "fetch_shifts", "main", [], title="Shift charts")
    r.run("enrich_pbp", _call, "enrich_pbp", "main", [], title="On-ice players for PBP")
    r.run("raw_pbp", stage_raw_pbp, title="Append raw PBP to data/historical_pbp")
    r.run("player_models", stage_player_models, state, phase["games_played"], title="Player impact")
    r.run("lineups_all", stage_lineups_all, title="DailyFaceoff lineups (all 32 teams)")
    r.run("contracts", stage_contracts, title="Contracts (weekly by stored fetched_at)")
    r.run("player_news", _call, "fetch_dailyfaceoff", "fetch_player_news", title="Player news")
    if phase["playoffs"]:
        r.run("playoff_news", _call, "fetch_dailyfaceoff", "fetch_playoff_player_news")
        r.run("goalie_playoff_career", _call, "fetch_goalie_playoff_career_stats")
    else:
        r.skip("playoff_news", "not in the playoffs")
        r.skip("goalie_playoff_career", "not in the playoffs")
    pregame_stages(r, phase, "full")
    print("Running Predictions...")
    r.run("predict", stage_predict, required=True, title="Running Predictions")
    print("Generating Prediction History...")
    r.run("prediction_history", _call, "generate_history", "generate_history", required=True)
    grading_stages(r)
    if phase["in_season"]:
        r.run("season_simulator", _call, "season_simulator", "full_simulation_loop", title="Playoff odds")
    else:
        r.skip("season_simulator", "offseason")
    post_predict_stages(r, phase)
    print("Final Sync...")
    r.run("final_sync", stage_final_sync, required=True)


def write_manifest(r, mode, phase):
    finished = utc_now_iso()
    failed = r.failed_required()

    def mut(m):
        m["schema_version"] = 1
        m["season_id"] = SEASON_ID
        m["season_label"] = SEASON_LABEL
        m["generated_at"] = finished
        m["mode"] = mode
        m["games_played_current_season"] = int(phase.get("games_played", 0))
        m["phase"] = phase
        m["stages"] = r.stages
        m["ok"] = not failed
        m["run"] = {"started_at": r.started_at, "finished_at": finished,
                    "seconds": round(time.time() - r.t0, 1),
                    "github_run_id": os.environ.get("GITHUB_RUN_ID")}
        m[f"last_{mode}_attempt"] = finished
        if not failed:
            m[f"last_{mode}_run"] = finished      # auto mode keys off successful full runs
        m.setdefault("stale", {})
        m.setdefault("sources", {})
    update_manifest(mut)
    print(f"Wrote manifest.json ({mode}, {len(r.stages)} stages, "
          f"{'OK' if not failed else str(len(failed)) + ' required stage(s) failed'})")


FULL_WINDOW_UTC = range(12, 15)   # 12:00-14:59 UTC (7-10 am ET): last night's games are final
FULL_MIN_INTERVAL_HOURS = 20       # one successful full run per morning window
FULL_CATCH_UP_HOURS = 36           # outside the window, force a full run if none succeeded for this long


def auto_mode(now=None):
    """'full' once per morning window (retrying on later hours of the window
    if the first attempt failed), and as a catch-up when the last successful
    full run is older than FULL_CATCH_UP_HOURS; otherwise 'lite'."""
    now = now or datetime.now(timezone.utc)
    last = load_manifest().get("last_full_run")
    try:
        age = (now - datetime.fromisoformat(last.replace("Z", "+00:00"))).total_seconds() / 3600
    except (AttributeError, TypeError, ValueError):
        age = float("inf")
    if now.hour in FULL_WINDOW_UTC and age >= FULL_MIN_INTERVAL_HOURS:
        return "full"
    if age >= FULL_CATCH_UP_HOURS:
        return "full"
    return "lite"


def main(argv=None):
    parser = argparse.ArgumentParser(description="pony xG data pipeline")
    parser.add_argument("--mode", choices=("full", "lite", "auto"), default="full")
    parser.add_argument("--print-mode", action="store_true",
                        help="Print the mode that --mode auto would pick and exit")
    parser.add_argument("--rescore-all", action="store_true", help="Rescore every season shot (model changed)")
    args = parser.parse_args(argv)
    if args.print_mode:
        print(auto_mode() if args.mode == "auto" else args.mode)
        return 0
    if args.mode == "auto":
        args.mode = auto_mode()
        print(f"--mode auto -> {args.mode}")
    os.chdir(PIPELINE_DIR)

    r = StageRunner(args.mode)
    phase = {}
    try:
        phase.update(season_phase())
    except Exception as e:
        print(f"[WARN] could not determine season phase: {e}")
        phase.update({"in_season": True, "playoffs": False, "games_played": 0, "min_team_gp": 0})
    print(f"Season {SEASON_LABEL} ({SEASON_ID}) — phase: {phase}")

    if args.mode == "lite":
        run_lite(r, phase)
    else:
        run_full(r, phase, rescore_all=args.rescore_all)

    r.summary()
    try:
        write_manifest(r, args.mode, phase)
    except Exception as e:
        print(f"[ERROR] could not write manifest.json: {e}")
        return 1
    failed = r.failed_required()
    if failed:
        print(f"[FAIL] required stage(s) failed: {', '.join(s['stage'] for s in failed)}")
        print("--- Pipeline Refresh Finished With Errors ---")
        return 1
    print("--- Pipeline Refresh Complete ---")
    return 0


def refresh_pipeline():
    """Backwards-compatible entry point (full refresh)."""
    return main(["--mode", "full"])


if __name__ == "__main__":
    sys.exit(main())
