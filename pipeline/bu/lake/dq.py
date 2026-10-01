"""Lake data-quality gate (DESIGN §2.6, the M0 gate).

    python -m bu.lake.dq                                # every built season, full-season coverage
    python -m bu.lake.dq --built-only                   # coverage vs the games fetched (samples)
    python -m bu.lake.dq --seasons 2023 --strict        # exit 2 on failure
    python -m bu.lake.dq --no-allowance                 # thresholds with no sampling allowance

Each check yields one row per season plus a pooled "all" row:
{check, season, value, op, threshold, allowance, effective_threshold, n, pass,
strict_pass, detail}.  The report goes to ``data/lake/dq/dq_report_latest.json``
(and a timestamped copy).

Thresholds (THRESHOLDS; "§2.6" = the value DESIGN §2.6 sets):

  game_coverage            built / target games (final, types 02+03)            >= 1.0    §2.6
  season_game_count        final regular-season games in the NHL game list      == league schedule
                           (closed seasons; 2012-13 lockout 720, 2019-20 1,082,
                           2020-21 868, 2021-22..2025-26 1,312; 2026-27 1,344)
  goals_vs_final           games whose PBP goals (reg+OT) equal the final       >= 1.0    §2.6
                           (final minus the shootout winner's +1)
  shift_duplicates         duplicate (game, player, period, start, end) rows    <= 0      §2.6
  duplicate_keys           duplicate games / (game, event) / (game, player)     <= 0
  shift_coverage_games     games with shift charts                              >= 0.99
  shift_coverage_players   players who played (boxscore TOI > 0) with a shift   >= 0.99
  shots_with_coords        non-shootout shot attempts with x and y              >= 0.99
  onice_vs_situation       shots whose shift-derived on-ice skater and goalie   >= 0.995  §2.6
                           counts equal situationCode (penalty shots excluded)
  onice_by_strength        the same, worst strength state with n >= 100         >= 0.98
  one_goalie_or_en         unblocked shots with exactly one defending goalie    >= 0.999  §2.6
                           on the ice, or the empty-net flag and none
  side_raw_vs_vote         periods with both homeTeamDefendingSide and the      >= 0.99
                           coordinate/zone vote that agree
  side_zone_consistency    unblocked shots with zone O/D and |x| >= 26 whose    >= 0.99
                           normalised x lies in that zone
  side_attacking_range     inferred-side seasons: shortfall of the share of     <= 0.01   §2.6*
                           unblocked non-EN shots < 89 ft from the attacked
                           net vs the raw-side 2021+ reference share
                           (raw-side rows are reported, informational)
  side_attacking_range_abs the same share, absolute, used only when no 2021+    >= 0.97   §2.6*
                           reference exists in the run or in the lake
  side_mean_distance       |mean distance - 2021+ mean| for inferred-side       <= 1 ft   §2.6
                           seasons
  crosswalk_coverage       event/shift player ids present in ``players``        >= 0.999
  events_per_game          mean events per game                                 in [200, 450]
  historical_shots_parity  |lake / nhl_historical_shots.csv - 1| unblocked      <= 0.005  §2.6
                           shots on overlapping games, per game type

Sampling allowance.  Rate checks with a ">=" threshold below 1 (and the
mean-distance check) pass when ``value + 3 SE >= threshold``, with SE clustered
by game (errors come in runs: a single 4-minute situationCode error in one game
is 14 shots).  The allowance is what makes a 20-game validation sample
meaningful; on a full season SE is tiny and the gate converges to the strict
threshold.  ``strict_pass`` reports the threshold without the allowance, and
``--no-allowance`` makes it binding.  Exact checks (coverage, goals,
duplicates) never get an allowance.

*DESIGN §2.6 deviation, documented: its "< 89 ft" side check is literal-99%, but
legitimate long shots on goal (dump-ins from the defensive/neutral zone, often
shorthanded) are 1.5-3% of unblocked shots even where the raw side field exists
(97.2-98.7% < 89 ft in 3-4-game-per-season samples; zone codes confirm they are
genuine D/N-zone shots).  A literal 99% would fail every full raw-side season.
So the inferred-side seasons are gated *relative* to the raw-side 2021+
reference share (a flipped period puts about half its shots beyond 89 ft, so a
1 pp shortfall catches a flip in ~2% of periods), and the reference comes from
the lake's 2021+ partitions when the run itself has none (e.g. the 2010-2017
leg of the backfill).  ``side_zone_consistency`` (zone code vs normalised x) is
the direct per-shot correctness test.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from .build import read_table, schedule_games
from .paths import PIPELINE_DIR, Lake

THRESHOLDS = {
    "game_coverage": (">=", 1.0),
    "season_game_count": ("<=", 0),
    "goals_vs_final": (">=", 1.0),
    "shift_duplicates": ("<=", 0),
    "duplicate_keys": ("<=", 0),
    "shift_coverage_games": (">=", 0.99),
    "shift_coverage_players": (">=", 0.99),
    "shots_with_coords": (">=", 0.99),
    "onice_vs_situation": (">=", 0.995),
    "onice_by_strength": (">=", 0.98),
    "one_goalie_or_en": (">=", 0.999),
    "side_raw_vs_vote": (">=", 0.99),
    "side_zone_consistency": (">=", 0.99),
    "side_attacking_range": ("<=", 0.01),
    "side_attacking_range_abs": (">=", 0.97),
    "side_mean_distance": ("<=", 1.0),
    "crosswalk_coverage": (">=", 0.999),
    "events_per_game": ("in", (200, 450)),
    "historical_shots_parity": ("<=", 0.005),
}
# Regular-season games per season (league schedule; 2019-20 stopped at 1,082 by COVID).
EXPECTED_REGULAR_GAMES = {
    2010: 1230, 2011: 1230, 2012: 720, 2013: 1230, 2014: 1230, 2015: 1230, 2016: 1230,
    2017: 1271, 2018: 1271, 2019: 1082, 2020: 868, 2021: 1312, 2022: 1312, 2023: 1312,
    2024: 1312, 2025: 1312, 2026: 1344,
}
MIN_STRENGTH_N = 100
REFERENCE_FROM = 2021   # seasons with the raw side field throughout
Z = 3.0


def _current_start_year() -> int:
    from season import START_YEAR
    return int(START_YEAR)


def _isnan(v) -> bool:
    return v is None or (isinstance(v, float) and math.isnan(v))


def _ok(op, value, thr) -> bool:
    if _isnan(value):
        return False
    if op == ">=":
        return value >= thr
    if op == "<=":
        return value <= thr
    if op == "in":
        return thr[0] <= value <= thr[1]
    raise ValueError(op)


def cluster_se(ok, groups=None) -> float:
    """SE of a proportion, clustered by ``groups`` (game ids) when given."""
    ok = np.asarray(ok, dtype="float64")
    n = len(ok)
    if n == 0:
        return float("nan")
    p = ok.mean()
    binom = math.sqrt(p * (1 - p) / n)
    if groups is None:
        return binom
    df = pd.DataFrame({"ok": ok, "g": np.asarray(groups)})
    agg = df.groupby("g")["ok"].agg(["sum", "size"])
    G = len(agg)
    if G < 2:
        return binom
    resid = agg["sum"] - p * agg["size"]
    se = math.sqrt(G / (G - 1) * float((resid ** 2).sum())) / n
    return max(se, binom)


class Report:
    def __init__(self, allowance: bool = True):
        self.rows = []
        self.allowance = allowance

    def add(self, check, season, value, n, detail=None, *, threshold=None, se=None, informational=False):
        op, thr = THRESHOLDS[check]
        if threshold is not None:
            thr = threshold
        allow = 0.0
        if self.allowance and se is not None and not _isnan(se) and op in (">=", "<=") \
                and not (op == ">=" and thr >= 1.0) and not (op == "<=" and thr == 0):
            allow = Z * se
        eff = thr - allow if op == ">=" else (thr + allow if op == "<=" else thr)
        strict = True if informational else _ok(op, value, thr)
        passed = True if informational else _ok(op, value, eff)
        if isinstance(value, (bool, np.bool_)):
            value = int(value)
        self.rows.append({
            "check": check, "season": season,
            "value": None if _isnan(value) else (int(value) if isinstance(value, (int, np.integer))
                                                  else round(float(value), 6)),
            "op": op, "threshold": thr, "allowance": round(allow, 6),
            "effective_threshold": eff if op == "in" else round(float(eff), 6),
            "n": int(n), "pass": bool(passed), "strict_pass": bool(strict),
            "informational": informational, "detail": detail or {},
        })


def _bool(s: pd.Series) -> np.ndarray:
    return s.astype("boolean").fillna(False).to_numpy(dtype=bool)


def _ub_far_base(shots: pd.DataFrame) -> pd.DataFrame:
    """Unblocked, non-empty-net shots with a distance (the side-check population)."""
    if shots is None or shots.empty:
        return pd.DataFrame(columns=["season", "game_id", "shot_distance", "side_source"])
    return shots[_bool(shots["is_unblocked"]) & shots["shot_distance"].notna()
                 & ~_bool(shots["empty_net_against"])]


REF_COLUMNS = ["season", "game_id", "is_unblocked", "shot_distance", "empty_net_against", "side_source"]


def reference_shots(lake: Lake, shots: pd.DataFrame) -> tuple[pd.DataFrame, str]:
    """Raw-side 2021+ shots for the side checks: from this run, else from the lake."""
    ub = _ub_far_base(shots)
    ref = ub[(ub["season"].str[:4].astype(int) >= REFERENCE_FROM) & (ub["side_source"] == "raw")] \
        if len(ub) else ub
    if len(ref):
        return ref, "run"
    d = lake.table_dir("shots")
    have = sorted(x.split("=", 1)[1] for x in os.listdir(d)) if os.path.isdir(d) else []
    ref_seasons = [x for x in have if int(x[:4]) >= REFERENCE_FROM]
    if not ref_seasons:
        return ref, "none"
    lk = _ub_far_base(read_table(lake, "shots", ref_seasons, columns=REF_COLUMNS))
    lk = lk[lk["side_source"] == "raw"] if len(lk) else lk
    return lk, ("lake:" + ",".join(ref_seasons)) if len(lk) else "none"


def _shots_for_onice(shots: pd.DataFrame) -> pd.DataFrame:
    s = shots[~_bool(shots["is_penalty_shot"])]
    return s[s["situation_code"].notna() & s["onice_rule"].ne("none")]


def run_dq(lake: Lake, seasons, *, targets: dict | None = None, full_targets: dict | None = None,
           historical_shots: str | None = None, write: bool = True, allowance: bool = True) -> dict:
    seasons = [str(s) for s in seasons]
    games = read_table(lake, "games", seasons)
    events = read_table(lake, "events", seasons)
    shots = read_table(lake, "shots", seasons)
    shifts = read_table(lake, "shifts", seasons)
    lineups = read_table(lake, "lineups", seasons)
    players = read_table(lake, "players", seasons)
    rep = Report(allowance)

    def per_season(df):
        if df is None or df.empty:
            return []
        return [(s, df[df["season"] == s]) for s in seasons if (df["season"] == s).any()] + [("all", df)]

    # --- coverage -------------------------------------------------------------
    tot_t = tot_b = 0
    n_missing = 0
    for s in seasons:
        if targets and s in targets:
            want = {int(g) for g in targets[s]}
        else:
            sched = schedule_games(lake, s)
            want = set(int(g) for g in sched["game_id"]) if len(sched) else set()
        have = set(int(g) for g in games.loc[games["season"] == s, "game_id"]) if len(games) else set()
        missing = sorted(want - have)
        n_missing += len(missing)
        detail = {"missing_sample": missing[:20], "n_missing": len(missing)}
        if full_targets and s in full_targets:
            detail["season_games_final"] = len(full_targets[s])
            detail["season_coverage_info"] = round(len(have & set(full_targets[s])) / max(1, len(full_targets[s])), 4)
        rep.add("game_coverage", s, len(want & have) / len(want) if want else float("nan"), len(want), detail)
        tot_t += len(want)
        tot_b += len(want & have)
    rep.add("game_coverage", "all", tot_b / tot_t if tot_t else float("nan"), tot_t, {"n_missing": n_missing})
    for s in seasons:
        sched = schedule_games(lake, s, game_types=(2,))
        exp = EXPECTED_REGULAR_GAMES.get(int(s[:4]))
        if not len(sched) or exp is None:
            continue
        n_reg = len(sched)
        closed = n_reg >= exp or int(s[:4]) < _current_start_year()
        rep.add("season_game_count", s, abs(n_reg - exp) if closed else None, n_reg,
                {"final_regular_games": n_reg, "expected": exp,
                 "playoff_games_final": int(len(schedule_games(lake, s, game_types=(3,))))},
                informational=not closed)
    if games.empty:
        return _finish(lake, rep, seasons, write)

    for s, g in per_season(games):
        has = _bool(g["has_shifts"])
        rep.add("shift_coverage_games", s, has.mean(), len(g), {
            "games_without_shifts": [int(x) for x in g.loc[~has, "game_id"]][:20]}, se=cluster_se(has))
        rep.add("events_per_game", s, g["n_events"].mean(), len(g),
                {"min": int(g["n_events"].min()), "max": int(g["n_events"].max())})
        so_win = g["last_period_type"].eq("SO")
        exp_h = g["home_score"] - (so_win & (g["home_score"] > g["away_score"])).astype(int)
        exp_a = g["away_score"] - (so_win & (g["away_score"] > g["home_score"])).astype(int)
        ok = ((g["home_goals_pbp"] == exp_h) & (g["away_goals_pbp"] == exp_a)).fillna(False).to_numpy(dtype=bool)
        rep.add("goals_vs_final", s, ok.mean(), len(g),
                {"mismatch_sample": g.loc[~ok, "game_id"].astype(int).head(10).tolist()})

    if len(lineups):
        with_shifts = set(games.loc[_bool(games["has_shifts"]), "game_id"])
        # Dressed players who played (backup goalies dress but have no shifts).
        played = lineups[(lineups["status"] == "dressed") & lineups["game_id"].isin(with_shifts)
                         & (lineups["toi_s"].fillna(1) > 0)]
        for s, d in per_season(played):
            ok = (d["n_shifts"] > 0).to_numpy()
            rep.add("shift_coverage_players", s, ok.mean(), len(d),
                    {"no_shift_sample": d.loc[~ok, ["game_id", "player_id"]].head(10).values.tolist()},
                    se=cluster_se(ok, d["game_id"]))

    # --- duplicates -------------------------------------------------------------
    for s, sh in per_season(shifts):
        gs = games if s == "all" else games[games["season"] == s]
        rep.add("shift_duplicates", s, int(sh.duplicated(["game_id", "player_id", "period", "start_s", "end_s"]).sum()),
                len(sh), {"raw_duplicates_removed": int(gs["n_shift_dups"].sum()),
                          "overlapping_shifts_merged": int(gs["n_shift_overlaps_merged"].sum()),
                          "foreign_team_rows_dropped": int(gs["n_shift_foreign_team"].fillna(0).sum())
                          if "n_shift_foreign_team" in gs else 0})
    dups = {
        "games": int(games.duplicated(["game_id"]).sum()),
        "events": int(events.duplicated(["game_id", "event_id"]).sum()) if len(events) else 0,
        "lineups": int(lineups.duplicated(["game_id", "player_id"]).sum()) if len(lineups) else 0,
        "players": int(players.duplicated(["season", "player_id"]).sum()) if len(players) else 0,
    }
    rep.add("duplicate_keys", "all", sum(dups.values()), len(events), dups)

    # --- shots: coordinates, on-ice, goalies, sides -------------------------------
    ref, ref_src = reference_shots(lake, shots)
    ref_rate = ref_se = None
    if len(ref):
        ref_ok = (ref["shot_distance"] < 89).to_numpy()
        ref_rate, ref_se = float(ref_ok.mean()), cluster_se(ref_ok, ref["game_id"])
    for s, sh in per_season(shots):
        has_xy = (sh["x"].notna() & sh["y"].notna()).to_numpy()
        rep.add("shots_with_coords", s, has_xy.mean(), len(sh), se=cluster_se(has_xy, sh["game_id"]))

        so = _shots_for_onice(sh)
        if len(so):
            m = so["onice_rule"].isin(["primary", "alt"]).to_numpy()
            rep.add("onice_vs_situation", s, m.mean(), len(so), {
                "primary_rule_only": round(float(so["onice_rule"].eq("primary").mean()), 6),
                "alt_rule_used": int(so["onice_rule"].eq("alt").sum()),
                "mismatch": int((~m).sum()),
                "mismatch_games": so.loc[~m, "game_id"].value_counts().head(10).to_dict(),
                "penalty_shots_excluded": int(_bool(sh["is_penalty_shot"]).sum()),
            }, se=cluster_se(m, so["game_id"]))
            by = so.assign(_m=m).groupby("strength")
            table = {k: {"match": round(float(v["_m"].mean()), 4), "n": int(len(v))} for k, v in by}
            big = [(k, v) for k, v in by if len(v) >= MIN_STRENGTH_N]
            if big:
                k, v = min(big, key=lambda kv: kv[1]["_m"].mean())
                rep.add("onice_by_strength", s, float(v["_m"].mean()), len(v),
                        {"worst_strength": k, "by_strength": table},
                        se=cluster_se(v["_m"].to_numpy(), v["game_id"]))
            elif s == "all":
                rep.add("onice_by_strength", s, None, 0, {"by_strength": table}, informational=True)

            ub = so[_bool(so["is_unblocked"])]
            if len(ub):
                def_home = ~_bool(ub["acting_is_home"])
                g_on = np.where(def_home, ub["home_goalies_n"].fillna(0).to_numpy(dtype="int64"),
                                ub["away_goalies_n"].fillna(0).to_numpy(dtype="int64"))
                en = _bool(ub["empty_net_against"])
                ok = ((g_on == 1) & ~en) | (en & (g_on == 0))
                rep.add("one_goalie_or_en", s, ok.mean(), len(ub), {"empty_net_shots": int(en.sum())},
                        se=cluster_se(ok, ub["game_id"]))

        ub = sh[_bool(sh["is_unblocked"]) & sh["x_norm"].notna()]
        z = ub[ub["zone_code"].isin(["O", "D"]) & (ub["x"].abs() >= 26)]
        if len(z):
            ok = np.where(z["zone_code"].eq("O"), z["x_norm"] > 0, z["x_norm"] < 0)
            rep.add("side_zone_consistency", s, ok.mean(), len(z),
                    {"by_source": {src: round(float(ok[(z["side_source"] == src).to_numpy()].mean()), 4)
                                   for src in ("raw", "inferred") if (z["side_source"] == src).any()}},
                    se=cluster_se(ok, z["game_id"]))
        far = _ub_far_base(ub)
        for src in ("raw", "inferred"):
            x = far[far["side_source"] == src]
            if not len(x):
                continue
            ok = (x["shot_distance"] < 89).to_numpy()
            rate, se = float(ok.mean()), cluster_se(ok, x["game_id"])
            detail = {"share_lt_89ft": round(rate, 6), "mean_distance": round(float(x["shot_distance"].mean()), 3),
                      "reference": ref_src}
            if src == "raw" or ref_rate is None:
                if src == "raw":
                    rep.add("side_attacking_range", f"{s}:{src}", rate, len(x), detail, informational=True)
                else:
                    rep.add("side_attacking_range_abs", f"{s}:{src}", rate, len(x), detail, se=se)
                continue
            detail["reference_share"] = round(ref_rate, 6)
            rep.add("side_attacking_range", f"{s}:{src}", ref_rate - rate, len(x), detail,
                    se=math.sqrt(se ** 2 + ref_se ** 2))

    if len(events):
        per = events.drop_duplicates(["game_id", "period"])[["season", "game_id", "period", "home_def_side_vote"]]
        raw_mode = (events.dropna(subset=["home_def_side_raw"]).groupby(["game_id", "period"])["home_def_side_raw"]
                    .agg(lambda v: v.mode().iloc[0]).rename("raw"))
        per = per.merge(raw_mode, left_on=["game_id", "period"], right_index=True, how="inner")
        per = per[per["home_def_side_vote"].notna()]
        for s, p in per_season(per):
            agree = (p["raw"] == p["home_def_side_vote"]).to_numpy()
            rep.add("side_raw_vs_vote", s, agree.mean(), len(p),
                    {"disagree_sample": p.loc[~agree, ["game_id", "period"]].head(10).values.tolist()},
                    se=cluster_se(agree, p["game_id"]))

    # Mean distance of inferred-side seasons vs the 2021+ reference.
    if len(shots):
        ubs = _ub_far_base(shots)
        for s in seasons:
            x = ubs[(ubs["season"] == s) & (ubs["side_source"] == "inferred")]
            if x.empty:
                continue
            if ref.empty:
                rep.add("side_mean_distance", s, None, len(x),
                        {"reason": "no 2021+ reference season in this run or the lake"}, informational=True)
                continue
            diff = abs(float(x["shot_distance"].mean()) - float(ref["shot_distance"].mean()))
            se = math.sqrt(x["shot_distance"].var() / len(x) + ref["shot_distance"].var() / len(ref))
            rep.add("side_mean_distance", s, diff, len(x),
                    {"season_mean": round(float(x["shot_distance"].mean()), 3),
                     "reference_mean": round(float(ref["shot_distance"].mean()), 3), "se": round(se, 3),
                     "reference": ref_src}, se=se)

    # Crosswalk coverage.
    if len(players):
        known = set(players["player_id"].astype("int64"))
        ids = [events[c].dropna().astype("int64") for c in (
            "shooter_id", "goalie_in_net_id", "scorer_id", "assist1_id", "assist2_id", "blocker_id",
            "hitter_id", "hittee_id", "fo_winner_id", "fo_loser_id", "pen_committed_by_id", "pen_drawn_by_id")
            if c in events]
        if len(shifts):
            ids.append(shifts["player_id"].dropna().astype("int64"))
        allids = pd.concat(ids) if ids else pd.Series([], dtype="int64")
        hit = allids.isin(known).to_numpy()
        rep.add("crosswalk_coverage", "all", hit.mean() if len(allids) else float("nan"), len(allids),
                {"unknown_sample": sorted(set(allids[~hit].tolist()))[:20]}, se=cluster_se(hit))

    # Parity with the tracked historical shots (2022-23 .. 2025-26).
    hist = historical_shots or os.path.join(PIPELINE_DIR, "nhl_historical_shots.csv")
    if len(shots) and os.path.exists(hist):
        h = pd.read_csv(hist, usecols=["game_id", "event_type"])
        h = h[h["event_type"].isin([505, 506, 507])]
        ov = sorted(set(h["game_id"]) & set(shots["game_id"]))
        mine = shots[shots["game_id"].isin(ov) & _bool(shots["is_unblocked"])]
        for gt, label in ((2, "regular"), (3, "playoffs")):
            ids_gt = [g for g in ov if int(str(g)[4:6]) == gt]
            if not ids_gt:
                continue
            a = int(mine["game_id"].isin(ids_gt).sum())
            b = int(h["game_id"].isin(ids_gt).sum())
            rep.add("historical_shots_parity", f"all:{label}", abs(a / b - 1) if b else float("nan"), len(ids_gt),
                    {"lake_unblocked": a, "historical_unblocked": b})
    return _finish(lake, rep, seasons, write)


def _finish(lake: Lake, rep: Report, seasons, write: bool) -> dict:
    gated = [r for r in rep.rows if not r["informational"]]
    report = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "lake": lake.root, "seasons": list(seasons), "sampling_allowance": rep.allowance,
        "pass": bool(gated) and all(r["pass"] for r in gated),
        "strict_pass": bool(gated) and all(r["strict_pass"] for r in gated),
        "n_checks": len(gated), "n_failed": sum(not r["pass"] for r in gated),
        "thresholds": {k: {"op": v[0], "threshold": v[1]} for k, v in THRESHOLDS.items()},
        "checks": rep.rows,
    }
    path = None
    if write:
        os.makedirs(lake.dq_dir, exist_ok=True)
        stamp = report["generated_at"].replace(":", "").replace("-", "")
        path = os.path.join(lake.dq_dir, "dq_report_latest.json")
        for p in (path, os.path.join(lake.dq_dir, f"dq_report_{stamp}.json")):
            with open(p, "w") as f:
                json.dump(report, f, indent=2, default=str)
    report["path"] = path
    return report


def summarize(report: dict, verbose: bool = False) -> str:
    lines = [f"\n== DQ gate: {'PASS' if report['pass'] else 'FAIL'} "
             f"({report['n_checks'] - report['n_failed']}/{report['n_checks']} checks; "
             f"strict thresholds {'pass' if report['strict_pass'] else 'not all met'}) =="]
    for r in report["checks"]:
        pooled = str(r["season"]).startswith("all")
        if not verbose and not pooled and r["pass"]:
            continue
        flag = "info" if r["informational"] else ("ok  " if r["pass"] else "FAIL")
        thr = r["threshold"]
        eff = r["effective_threshold"]
        extra = f" (eff {eff:.4f})" if r["allowance"] else ""
        if r["informational"]:
            lines.append(f"  [info] {r['check']:<24} {str(r['season']):<16} value={r['value']} (reported, not gated)"
                         f"  n={r['n']:,}")
            continue
        lines.append(f"  [{flag}] {r['check']:<24} {str(r['season']):<16} value={r['value']} "
                     f"{r['op']} {thr}{extra}  n={r['n']:,}" + ("" if r["strict_pass"] else "  [below strict]"))
    return "\n".join(lines)


def main(argv=None) -> int:
    from .backfill import parse_seasons
    from .sources import season_id
    ap = argparse.ArgumentParser(prog="python -m bu.lake.dq", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seasons", default=None, help="Start years (default: every built season)")
    ap.add_argument("--lake-dir", default=None)
    ap.add_argument("--built-only", action="store_true",
                    help="Coverage against the games fetched into the lake (samples), not the full season")
    ap.add_argument("--no-allowance", action="store_true", help="Strict thresholds, no sampling allowance")
    ap.add_argument("--strict", action="store_true", help="Exit 2 when the gate fails")
    ap.add_argument("-v", "--verbose", action="store_true", help="Print every row, not just pooled/failing")
    args = ap.parse_args(argv)
    lake = Lake(args.lake_dir)
    if args.seasons:
        seasons = [season_id(y) for y in parse_seasons(args.seasons)]
    else:
        d = lake.table_dir("games")
        seasons = sorted(x.split("=", 1)[1] for x in os.listdir(d)) if os.path.isdir(d) else []
    targets = None
    if args.built_only:
        d = os.path.join(lake.raw_dir, "pbp")
        targets = {s: [int(f.split(".")[0]) for f in os.listdir(os.path.join(d, s)) if f.endswith(".json.gz")]
                   for s in seasons if os.path.isdir(os.path.join(d, s))}
    report = run_dq(lake, seasons, targets=targets, allowance=not args.no_allowance)
    print(summarize(report, args.verbose))
    print(f"  report: {report['path']}")
    return 2 if (args.strict and not report["pass"]) else 0


if __name__ == "__main__":
    sys.exit(main())
