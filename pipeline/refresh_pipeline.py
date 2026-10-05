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
from datetime import date, datetime, timedelta, timezone

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

    # Shot model flag PONYXG_XG=v1|shadow|v2 (bu/xg/live.py); the xg_raw contract is the same for all.
    # shadow/v2 first fill the additive xg_raw_v2 column (xG v2 from each game's PBP).
    from bu.xg import live as xg_live
    mh = xg_live.active_hash(model_hash)
    prev_src = (load_manifest().get("sources") or {}).get("xg_model") or {}
    prev_hash = prev_src.get("hash")
    v2_info = xg_live.fill_v2_column(df, prev_src)
    v2_changed = xg_live.V2_COL in df.columns and (
        xg_live.V2_COL not in before.columns
        or not before[xg_live.V2_COL].astype(float).fillna(-1).equals(df[xg_live.V2_COL].astype(float).fillna(-1)))
    if "xg_raw" not in df.columns:
        df["xg_raw"] = float("nan")
    need = df["xg_raw"].isna()
    if rescore_all or (prev_hash and prev_hash != mh):
        print(f"  Model hash changed ({prev_hash} -> {mh}) — rescoring every shot")
        need[:] = True
    need |= xg_live.pending_mask(df, prev_src)
    n_scored = int(need.sum())
    xg_info = {"mode": xg_live.mode(), "v1_fallback_games": []}

    def v1_score(rows):
        import pickle
        from xg_model import preprocess_data
        with open(os.path.join(PIPELINE_DIR, "xg_model_xgb.pkl"), "rb") as f:
            model = pickle.load(f)
        X, _ = preprocess_data(rows)
        if len(X) != len(rows):
            raise ValueError(f"preprocess_data returned {len(X)} rows for {len(rows)} shots")
        return model.predict_proba(X)[:, 1]

    if n_scored:
        sub = df[need]
        probs, xg_info = xg_live.score_shots(sub, v1_score)
        mean_new = float(probs.mean())
        print(f"  Scored {n_scored} shots with xG {xg_info['mode']} (v2: {xg_info['v2_scored']}, "
              f"v1 fallback games: {len(xg_info['v1_fallback_games'])}); mean raw xG {mean_new:.4f} (expected ~0.07)")
        if mean_new > 0.15:
            raise ValueError(f"ABORT: mean xG {mean_new:.4f} — model/library mismatch?")
        df.loc[need, "xg_raw"] = probs
        if "strength_state" in df.columns:
            # v1 has no empty-net model: its rows get the empirical EN rate; v2 scores EN shots itself
            v1_idx = sub.index[xg_info["v1_rows"]]
            df.loc[v1_idx[df.loc[v1_idx, "strength_state"] == "EmptyNet"], "xg_raw"] = EN_XG
    df["xg_raw"] = df["xg_raw"].astype(float).round(XG_DECIMALS)
    # Under v2 the incumbent's score stays in xg_raw_v1 (rollback shadow); dropped otherwise.
    v1_info = xg_live.fill_v1_shadow(df, v1_score, EN_XG, prev_src, v1_hash=model_hash())
    v1_changed = v1_info.pop("changed")
    v2_changed = v2_changed or v1_changed

    # Persist xg_raw first: shooting talent is computed from xg_raw on disk.
    if n_scored or v2_changed:
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
    changed = changed or v2_changed
    if changed:
        atomic_write_csv(path, df, min_rows=len(before), label="season shots")
        print(f"  Updated {path} (xg_raw + adjusted xG)")
    else:
        print(f"  {path}: xG unchanged — not rewritten")
    record_source("xg_model", hash=mh, mode=xg_info["mode"], v1_fallback_games=xg_info["v1_fallback_games"],
                  **{k: v for k, v in v2_info.items() if k != "v2_column"}, **v1_info)

    agg = df.groupby(["game_id", "team_id"])["xG"].sum().rename("xG_sum").reset_index()
    if "strength_state" in df.columns:
        for label, st in (("xG_5v5_sum", "5v5"), ("xG_pp_sum", "5v4")):
            part = df[df["strength_state"] == st].groupby(["game_id", "team_id"])["xG"].sum().rename(label)
            agg = agg.merge(part.reset_index(), on=["game_id", "team_id"], how="left")
        part = df[df["strength_state"] != "EmptyNet"].groupby(["game_id", "team_id"])["xG"].sum()
        agg = agg.merge(part.rename("xG_non_en_sum").reset_index(), on=["game_id", "team_id"], how="left")
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


def repair_goal_splits(gs, shots, tid_to_name):
    """Fill goals_5v5/ev/pp/sh (and the goals_ag_* mirrors) on rows scraped before
    the scraper tallied them (all four 0 while goals_for > empty-net goals).

    PP = the scraper's official pp_goals minus EN PP goals, EN = emptynet_goalsfor,
    SH and 5v5 come from the goal rows of the shots file ('4v5' etc.), and EV is
    the remainder, so goals_ev + goals_pp + goals_sh + emptynet_goalsfor ==
    goals_for always holds.  Rows with a real split are left alone."""
    need = ("goals_for", "pp_goals", "emptynet_goalsfor")
    if any(c not in gs.columns for c in need):
        return 0
    cols = ("goals_5v5", "goals_ev", "goals_pp", "goals_sh")
    for c in cols:
        if c not in gs.columns:
            gs[c] = 0
    num = lambda c: pd.to_numeric(gs[c], errors="coerce").fillna(0).astype(int)
    en = num("emptynet_goalsfor")
    en_pp = num("en_pp_goalsfor") if "en_pp_goalsfor" in gs.columns else 0
    legacy = (num("goals_ev") + num("goals_pp") + num("goals_sh") == 0) & (num("goals_for") - en > 0)
    if not legacy.any():
        return 0
    sh_n = pd.Series(0, index=gs.index)
    v5_n = pd.Series(0, index=gs.index)
    if shots is not None and {"game_id", "team_id", "is_goal", "strength_state"} <= set(shots.columns):
        g = shots[pd.to_numeric(shots["is_goal"], errors="coerce").fillna(0) == 1].copy()
        parts = g["strength_state"].astype(str).str.extract(r"^(\d)v(\d)$").astype(float)
        g["_sh"] = ((parts[0] < parts[1]) & (parts[0] < 5)).astype(int)
        g["_5v5"] = ((parts[0] == 5) & (parts[1] == 5)).astype(int)
        g["team"] = g["team_id"].astype(int).map(tid_to_name)
        t = g.groupby(["game_id", "team"])[["_sh", "_5v5"]].sum()
        keys = list(zip(gs["game_id"].astype("int64"), gs["team"]))
        sh_n = pd.Series(t["_sh"].reindex(keys).values, index=gs.index).fillna(0).astype(int)
        v5_n = pd.Series(t["_5v5"].reindex(keys).values, index=gs.index).fillna(0).astype(int)
    non_en = num("goals_for") - en
    pp = (num("pp_goals") - en_pp).clip(lower=0).clip(upper=non_en)
    sh = sh_n.clip(upper=non_en - pp)
    ev = non_en - pp - sh
    v5 = v5_n.clip(upper=ev)
    for c, v in (("goals_pp", pp), ("goals_sh", sh), ("goals_ev", ev), ("goals_5v5", v5)):
        gs.loc[legacy, c] = v[legacy]
    # goals against = the opponent row's goals for
    fk = {(int(r.game_id), r.team): r for r in gs[list(cols) + ["game_id", "team"]].itertuples(index=False)}
    for c in cols:
        ag = c.replace("goals_", "goals_ag_")
        vals = [getattr(fk.get((int(gid), opp)), c, None) if fk.get((int(gid), opp)) is not None else None
                for gid, opp in zip(gs["game_id"], gs["opponent"])]
        cur = gs[ag] if ag in gs.columns else pd.Series(0, index=gs.index)
        gs[ag] = pd.Series(vals, index=gs.index).where(lambda x: x.notna(), cur).astype(int)
    print(f"  Filled goal strength splits for {int(legacy.sum())} team-games scraped before the split fix")
    return int(legacy.sum())


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
    # xG against without empty-net shots: the GSAx denominator (EN goals are not on the goalie).
    gs["xga_non_en"] = pick("xG_non_en_sum", key_o, gs.get("xga_non_en", gs.get("xG_against")))
    repair_goal_splits(gs, state["shots_df"], tid_to_name)

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


def stage_bu_bundle():
    """Freshness of the RAPM v2 lineup bundle the live model reads (bu_refresh.yml rebuilds it):
    manifest ``sources.bu_bundle`` and a ``stale`` flag past ``serve.MAX_AGE_H`` (predict_games
    then publishes the F1 rollback model, so this never fails the run)."""
    meta = read_json(os.path.join(PIPELINE_DIR, "game_model_meta.json"), {}) or {}
    from features import BU_COLUMNS
    if not any(c in (meta.get("feature_columns") or []) for c in BU_COLUMNS):
        return {"status": "skip", "reason": "the live game model has no RAPM lineup term"}
    from bu.lineup import serve as SV
    from ml_predict import bu_mode
    rel = (meta.get("bu_lineup") or {}).get("serving_bundle") or "bu/lineup/out/serving_bundle.json.gz"
    b = SV.read(os.path.join(PIPELINE_DIR, rel))
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(b["built_at"])).total_seconds() / 3600
    record_source("bu_bundle", built_at=b["built_at"], max_source_date=b.get("max_source_date"),
                  n_games=b.get("n_games"), season=b.get("season"), age_h=round(age, 1), flag=bu_mode())
    msg = f"built {age:.1f}h ago, {b.get('n_games')} games of {b.get('season')}, PONYXG_BU={bu_mode()}"
    if age > SV.MAX_AGE_H:
        mark_stale("serving_bundle.json.gz", f"built {age:.0f}h ago (> {SV.MAX_AGE_H:.0f}h): F1 rollback model published")
        return {"status": "ok", "reason": "STALE " + msg}
    clear_stale("serving_bundle.json.gz")
    return {"status": "ok", "reason": msg}


def stage_player_ratings():
    """public/data/player_ratings.json (RAPM v2 OFF / DEF / NET, the site's player ratings) from
    the committed serving bundle and today's NHL rosters.  bu_refresh.yml re-exports it with
    this season's EV sample after each bundle refresh; this daily pass keeps names, teams and
    roster flags current between bundle refreshes (trades, call-ups)."""
    import shutil
    import tempfile
    from bu.lineup import ratings_export as RE
    tmp = tempfile.mkdtemp(prefix="ponyxg-ratings-")
    try:
        s = RE.export(state_root=tmp, fetch_rosters=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    record_source("player_ratings", as_of=s.get("as_of"), roster_skaters=s.get("roster_skaters"),
                  roster_rated=s.get("roster_rated"), season=s.get("season"))
    return {"status": "ok", "rows_written": int(s.get("rows") or 0),
            "reason": f"{s.get('roster_skaters')} roster skaters, as of {s.get('as_of')}"
                      + ("" if s.get("written") else " (unchanged)")}


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
    r.run("player_props", _call, "fetch_props", "fetch_props", title="Bovada player props")
    # Goalie season lines move with every game, so the lite run refreshes them too.
    r.run("goalie_stats", _call, "fetch_nhl_goalie_stats", "fetch_nhl_goalie_stats", title="Goalie season lines")
    if phase["playoffs"]:
        r.run("playoff_series", _call, "update_playoff_series", title="Playoff series")
    else:
        r.skip("playoff_series", "not in the playoffs")


def post_predict_stages(r, phase):
    r.run("snapshot", _call, "snapshot_predictions", "snapshot", title="SiteHistory snapshot")
    # Uses the game model's expected goals, so it runs after predict.
    r.run("props_board", _call, "prop_board", title="Props page board")
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
    r.run("bu_bundle", stage_bu_bundle, title="RAPM lineup bundle freshness")
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
    r.run("game_xg", _call, "game_xg_export", "main", [], title="Per-shot xG for game pages")
    r.run("sync_gamestats", stage_sync_gamestats, required=True)
    r.run("team_ratings", stage_team_ratings, required=True, title="Team & goalie ratings")
    phase.update(season_phase())
    r.run("shifts", _call, "fetch_shifts", "main", [], title="Shift charts")
    r.run("enrich_pbp", _call, "enrich_pbp", "main", [], title="On-ice players for PBP")
    r.run("raw_pbp", stage_raw_pbp, title="Append raw PBP to data/historical_pbp")
    r.run("player_models", stage_player_models, state, phase["games_played"], title="Player impact")
    r.run("skater_games", _call, "fetch_skater_games", title="Per-game skater logs (props)")
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
    r.run("bu_bundle", stage_bu_bundle, title="RAPM lineup bundle freshness")
    r.run("player_ratings", stage_player_ratings, title="Player ratings (RAPM v2) export")
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
FULL_UNSCRAPED_RETRY_HOURS = 0.9   # min gap between full attempts triggered by unstored final games (hourly cron)


def has_unscraped_finals():
    """True when the NHL schedule lists a completed game that is not yet in this
    season's gamestats.  Only the full run scrapes games, so the lite hours
    would otherwise serve stale records, game logs and player stats until the
    next morning window (which GitHub's cron can skip).  Any lookup failure
    counts as False so the hourly run stays lite."""
    import scrape_games
    try:
        path = os.path.join(PIPELINE_DIR, season_file("gamestats"))
        stored = set()
        if os.path.exists(path):
            stored = set(pd.read_csv(path, usecols=["game_id"])["game_id"].astype("int64"))
        sched, _ = scrape_games.completed_schedule_games(date(START_YEAR, 9, 1), today_local())
    except Exception as e:
        print(f"[WARN] unscraped-finals check failed: {e}")
        return False
    return any(gid not in stored for gid in sched)


def auto_mode(now=None):
    """'full' once per morning window (retrying on later hours of the window
    if the first attempt failed), when final games are waiting to be scraped,
    and as a catch-up when the last successful full run is older than
    FULL_CATCH_UP_HOURS; otherwise 'lite'."""
    now = now or datetime.now(timezone.utc)
    manifest = load_manifest()
    last = manifest.get("last_full_run")
    try:
        age = (now - datetime.fromisoformat(last.replace("Z", "+00:00"))).total_seconds() / 3600
    except (AttributeError, TypeError, ValueError):
        age = float("inf")
    if now.hour in FULL_WINDOW_UTC and age >= FULL_MIN_INTERVAL_HOURS:
        return "full"
    if age >= FULL_CATCH_UP_HOURS:
        return "full"
    try:
        attempt_age = (now - datetime.fromisoformat(manifest["last_full_attempt"].replace("Z", "+00:00"))
                       ).total_seconds() / 3600
    except (KeyError, AttributeError, TypeError, ValueError):
        attempt_age = float("inf")
    if attempt_age >= FULL_UNSCRAPED_RETRY_HOURS and has_unscraped_finals():
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
