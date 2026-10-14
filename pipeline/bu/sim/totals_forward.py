"""Totals-anchor forward test on 2026-27 live games (``prereg_totals_forward.json``).

    cd pipeline
    python -m bu.sim.totals_forward status            # counts only (no arm comparison before the look)
    python -m bu.sim.totals_forward dry-run           # DESCRIPTIVE: pre-declaration games, reconstructed
    python -m bu.sim.totals_forward look              # the single decision look (logged, refused twice)

Each arm's over / push / under on the posted line comes from the last pregame SiteHistory snapshot's
``totals_test`` column (``bu/sim/totals_test.py``, written by the live run).  The actual total is
the season gamestats' home goals_for + goals_ag, + 1 for a shootout (the betting total counts the
shootout winner's goal).

``dry-run`` scores games played BEFORE the declaration, which have no ``totals_test``: it rebuilds
each game's last pregame row from the git history of data/predictions_detailed.csv (the frozen
row: published win %, expected_total, sim_expected_total, sim_detail.total_hist, line and prices)
and APPROXIMATES the SIM / BLEND arms by exponentially tilting the GM-anchored total histogram to
each arm's total (live re-anchors the simulation exactly).  Descriptive, never part of the decision.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import subprocess
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import totals_test as TT

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE_DIR = os.path.dirname(os.path.dirname(HERE))
REPO_ROOT = os.path.dirname(PIPELINE_DIR)
PREREG_PATH = os.path.join(HERE, "prereg_totals_forward.json")
LOOK_LOG = os.path.join(HERE, "out", "look_log.jsonl")
QUESTION = "totals_anchor"
SEASON = "20262027"
ARMS = TT.ARMS                       # gm first: the comparator
CANDIDATES = ("sim", "blend_sim", "blend_gm")   # the rule's tie-break order
EPS = 1e-6


def prereg() -> dict:
    with open(PREREG_PATH) as f:
        return json.load(f)


def declared_at() -> pd.Timestamp:
    return pd.Timestamp(prereg()["declared_at"])


# ------------------------------------------------------------------------------ outcomes

def actual_totals(gamestats: pd.DataFrame) -> dict:
    """{NHL game id: official betting total} from a season gamestats frame (home rows)."""
    g = gamestats[gamestats["home_away"] == "Home"]
    so = g["result"].isin(["SOW", "SOL"]).astype(int)
    tot = g["goals_for"].astype(int) + g["goals_ag"].astype(int) + so
    return {int(k): int(v) for k, v in zip(g["game_id"], tot)}


def outcome(total: int, line: float) -> int:
    """0 over, 1 push, 2 under."""
    return 0 if total > line else (1 if total == line else 2)


# ------------------------------------------------------------------------------ metrics

def ll_binary(p, y) -> np.ndarray:
    p = np.clip(np.asarray(p, float), EPS, 1 - EPS)
    y = np.asarray(y, float)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def ll_full(o, p, u, k) -> np.ndarray:
    """Log loss of the realised outcome k (0 over, 1 push, 2 under) under (o, p, u)."""
    P = np.stack([np.asarray(o, float), np.asarray(p, float), np.asarray(u, float)], axis=1)
    P = P / P.sum(axis=1, keepdims=True)
    return -np.log(np.clip(P[np.arange(len(P)), np.asarray(k, int)], EPS, 1.0))


def recalibration(p, y, iters: int = 50):
    """(slope, intercept) of the logistic regression of y on logit p (1 / 0 = calibrated)."""
    p = np.clip(np.asarray(p, float), EPS, 1 - EPS)
    y = np.asarray(y, float)
    X = np.column_stack([np.ones_like(p), np.log(p / (1 - p))])
    b = np.array([0.0, 1.0])
    for _ in range(iters):
        mu = 1 / (1 + np.exp(-X @ b))
        W = mu * (1 - mu)
        H = X.T @ (X * W[:, None])
        try:
            step = np.linalg.solve(H, X.T @ (y - mu))
        except np.linalg.LinAlgError:
            return float("nan"), float("nan")
        b = b + step
        if np.max(np.abs(step)) < 1e-10:
            break
    return float(b[1]), float(b[0])


def paired(a, b) -> dict:
    """Mean of a - b with SE = sd / sqrt(n)."""
    d = np.asarray(a, float) - np.asarray(b, float)
    n = len(d)
    se = float(d.std(ddof=1) / math.sqrt(n)) if n > 1 else float("nan")
    return {"diff": round(float(d.mean()), 5) if n else None, "se": round(se, 5), "n": n}


def _corr(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    if len(a) < 3 or a.std() == 0 or b.std() == 0:
        return None
    return round(float(np.corrcoef(a, b)[0, 1]), 3)


def score(df: pd.DataFrame) -> dict:
    """Per-arm metrics on a frame with columns actual, line, q and <arm>_{t,o,p,u} for each arm."""
    df = df.copy()
    df["k"] = [outcome(t, L) for t, L in zip(df["actual"], df["line"])]
    np_ = df[df["k"] != 1]
    y = (np_["k"] == 0).astype(float).values
    out = {"n_games": int(len(df)), "n_no_push": int(len(np_)), "n_push": int((df["k"] == 1).sum()),
           "n_whole_line": int((df["line"] % 1 == 0).sum()),
           "actual_mean": round(float(df["actual"].mean()), 3) if len(df) else None,
           "line_mean": round(float(df["line"].mean()), 3) if len(df) else None,
           "line_sd": round(float(df["line"].std()), 3) if len(df) > 1 else None,
           "arms": {}, "vs_gm": {}, "vs_mkt": {}}
    pri, full = {}, {}
    for a in ARMS:
        o, u = np_[f"{a}_o"].values, np_[f"{a}_u"].values
        p = o / (o + u)
        pri[a] = ll_binary(p, y)
        full[a] = ll_full(df[f"{a}_o"], df[f"{a}_p"], df[f"{a}_u"], df["k"])
        slope, icpt = recalibration(p, y) if len(y) > 2 else (float("nan"), float("nan"))
        t = df[f"{a}_t"].astype(float)
        out["arms"][a] = {
            "ll_over_no_push": round(float(pri[a].mean()), 5), "ll_full": round(float(full[a].mean()), 5),
            "brier": round(float(np.mean((p - y) ** 2)), 5), "calib_slope": round(slope, 3),
            "calib_intercept": round(icpt, 3), "mean_p_over": round(float(p.mean()), 4),
            "t_mean": round(float(t.mean()), 3), "t_sd": round(float(t.std()), 3),
            "corr_t_actual": _corr(t, df["actual"]), "corr_t_line": _corr(t, df["line"]),
        }
    q = np_["q"].values
    mkt = ll_binary(q, y)
    out["arms"]["mkt"] = {"ll_over_no_push": round(float(mkt.mean()), 5),
                          "brier": round(float(np.mean((q - y) ** 2)), 5), "mean_p_over": round(float(q.mean()), 4),
                          "calib_slope": round(recalibration(q, y)[0], 3) if len(y) > 2 else None}
    out["mean_p_over_actual"] = round(float(y.mean()), 4) if len(y) else None
    for a in CANDIDATES:
        out["vs_gm"][a] = {"primary": paired(pri[a], pri["gm"]), "full": paired(full[a], full["gm"])}
    for a in ARMS:
        out["vs_mkt"][a] = paired(pri[a], mkt)
    return out


def decide(sc: dict, margin: float = 0.0010) -> dict:
    """The pre-declared rule (prereg promotion_rule) on a decision-set score."""
    passing = {}
    for a in CANDIDATES:
        p, f = sc["vs_gm"][a]["primary"], sc["vs_gm"][a]["full"]
        ok = (p["diff"] is not None and p["se"] == p["se"] and p["diff"] <= -max(p["se"], margin)
              and f["diff"] is not None and f["diff"] <= margin)
        passing[a] = bool(ok)
    winners = [a for a in CANDIDATES if passing[a]]
    choice = "gm"
    if winners:
        best = min(winners, key=lambda a: sc["arms"][a]["ll_over_no_push"])
        lo = sc["arms"][best]["ll_over_no_push"]
        choice = next(a for a in CANDIDATES if a in winners and sc["arms"][a]["ll_over_no_push"] - lo <= margin)
    return {"pass": passing, "choice": choice}


# ------------------------------------------------------------------------------ live data (SiteHistory)

def _arm_columns(rec: dict) -> dict | None:
    """Flat arm columns of a totals_test record, None unless status 'sim', a posted line, q and every arm."""
    if not rec or rec.get("status") != "sim" or not rec.get("posted") or rec.get("q") is None:
        return None
    arms = rec.get("arms") or {}
    out = {"line": float(rec["line"]), "q": float(rec["q"]), "t_mkt": rec.get("t_mkt"),
           "k_bound": bool(rec.get("k_bound"))}
    for a in ARMS:
        v = arms.get(a)
        if not v or any(v.get(k) is None for k in "topu"):
            return None
        for k in "topu":
            out[f"{a}_{k}"] = float(v[k])
    return out


def live_frame(allow_fetch: bool = True) -> tuple[pd.DataFrame, dict]:
    """Every 2026-27 regular-season game's last pregame snapshot, with its totals_test arms (when
    usable), the published total market (consistency) and the result.  (frame, counts)."""
    import site_history as SH
    sh, _ = SH.load_keyed_site_history(allow_fetch=allow_fetch)
    if sh.empty:
        return pd.DataFrame(), {}
    last = SH.last_pregame(sh)
    last = last[(last["game_type"] == 2) & last["game_id"].astype(str).str.startswith(SEASON[:4] + "02")]
    gs_path = os.path.join(PIPELINE_DIR, f"nhl_season_{SEASON[:4]}_{SEASON[4:]}_gamestats.csv")
    act = actual_totals(pd.read_csv(gs_path)) if os.path.exists(gs_path) else {}
    rows, cons_bad = [], 0
    for r in last.itertuples(index=False):
        rec = TT.parse(getattr(r, "totals_test", None))
        cols = _arm_columns(rec)
        row = {"game_id": int(r.game_id), "start_ts": r.start_ts, "has_log": rec is not None,
               "usable": cols is not None, "actual": act.get(int(r.game_id))}
        if cols:
            row.update(cols)
            try:      # GM arm vs the published (rounded) total market
                tot = json.loads(getattr(r, "sim_markets", None))["tot"]
                if any(abs(cols[f"gm_{k}"] - tot[n] / 100) > 0.0006 for k, n in (("o", "over"), ("p", "push"),
                                                                                     ("u", "under"))):
                    cons_bad += 1
            except (TypeError, ValueError, KeyError):
                pass
        rows.append(row)
    return pd.DataFrame(rows), {"gm_vs_published_mismatch": cons_bad}


def decision_set(df: pd.DataFrame, N: int, since: pd.Timestamp) -> tuple[pd.DataFrame, dict]:
    """The prereg decision set: eligible games after ``since`` in puck-drop order, cut at the N-th no-push
    game (pushes up to it included).  (set or empty frame, counts)."""
    if df.empty:
        return df, {"eligible": 0, "no_push": 0, "push": 0, "complete": False}
    e = df[(df["start_ts"] > since) & df["usable"] & df["actual"].notna()].copy()
    if e.empty:
        return e, {"eligible": 0, "no_push": 0, "push": 0, "complete": False}
    e = e.sort_values(["start_ts", "game_id"])
    e["k"] = [outcome(int(t), L) for t, L in zip(e["actual"], e["line"])]
    nop = (e["k"] != 1).cumsum()
    counts = {"eligible": int(len(e)), "no_push": int((e["k"] != 1).sum()), "push": int((e["k"] == 1).sum()),
              "complete": bool((e["k"] != 1).sum() >= N)}
    if not counts["complete"]:
        return e.iloc[0:0], counts
    cut = e.index[nop.values == N][0]
    pos = e.index.get_loc(cut)
    return e.iloc[:pos + 1].drop(columns="k"), counts


# ------------------------------------------------------------------------------ dry run (git history)

def _git(*args) -> str:
    return subprocess.run(["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, check=True).stdout


def reconstruct_from_git(path: str = "data/predictions_detailed.csv", since: str = "2026-09-28") -> pd.DataFrame:
    """Each game's last pregame row (the frozen row when it froze, else its last pregame version) from the
    git history of predictions_detailed.csv."""
    commits = [c for c in _git("log", f"--since={since}", "--reverse", "--format=%H", "--", path).split() if c]
    last = {}
    for c in commits:
        try:
            text = _git("show", f"{c}:{path}")
        except subprocess.CalledProcessError:
            continue
        for r in csv.DictReader(io.StringIO(text)):
            if r.get("prediction_status") in ("pregame", "frozen") and (r.get("nhl_game_id") or "").strip():
                last[int(float(r["nhl_game_id"]))] = r
    return pd.DataFrame(list(last.values()))


def approximate_arms(r: dict) -> dict | None:
    """Dry-run arms of one reconstructed row: the GM-anchored histogram, the market total as live, the
    other arms by tilting that histogram to their totals (APPROXIMATE).  None when not scorable."""
    if r.get("sim_status") != "sim":
        return None
    L = TT.posted_line(r.get("total_line"))
    q = TT.market_q(r.get("total_over"), r.get("total_under")) if L is not None else None
    try:
        hist = json.loads(r.get("sim_detail") or "")["total_hist"]
        t_gm, t_sim = float(r["expected_total"]), float(r["sim_expected_total"])
    except (TypeError, ValueError, KeyError):
        return None
    if L is None or q is None:
        return None
    t_mkt, bound = TT.market_total(hist, L, q)
    targets = TT.arm_totals(t_gm, t_sim, t_mkt)
    out = {"line": L, "q": q, "t_mkt": t_mkt, "k_bound": bound}
    for a in ARMS:
        h = hist if a == "gm" else TT.tilt_to_mean(hist, targets[a])
        o, p, u = TT.ou(h, L)
        out.update({f"{a}_t": targets[a], f"{a}_o": o, f"{a}_p": p, f"{a}_u": u})
    return out


def dry_run_frame(before: pd.Timestamp) -> tuple[pd.DataFrame, dict]:
    import site_history as SH
    rec = reconstruct_from_git()
    sched = SH.schedule_frame([SEASON], allow_fetch=False)
    start = {int(g): t for g, t in zip(sched["game_id"], sched["start_ts"])}
    gtype = {int(g): int(t) for g, t in zip(sched["game_id"], sched["game_type"])}
    gs = pd.read_csv(os.path.join(PIPELINE_DIR, f"nhl_season_{SEASON[:4]}_{SEASON[4:]}_gamestats.csv"))
    act = actual_totals(gs)
    rows, n_seen, n_fb = [], 0, 0
    for r in rec.to_dict("records"):
        gid = int(float(r["nhl_game_id"]))
        if gtype.get(gid) != 2 or gid not in act or not (start.get(gid) is not None and start[gid] < before):
            continue
        n_seen += 1
        arms = approximate_arms(r)
        if arms is None:
            n_fb += 1
            continue
        rows.append({"game_id": gid, "start_ts": start[gid], "actual": act[gid], **arms})
    return pd.DataFrame(rows), {"graded_regular_season_games": n_seen, "not_scorable": n_fb}


# ------------------------------------------------------------------------------ look

def _looked() -> bool:
    if not os.path.exists(LOOK_LOG):
        return False
    with open(LOOK_LOG) as f:
        return any(json.loads(l).get("question") == QUESTION and json.loads(l).get("stage") != "started"
                   for l in f if l.strip())


def _print_score(sc: dict, title: str):
    print(f"\n{title}")
    print(f"  games {sc['n_games']} (no push {sc['n_no_push']}, pushes {sc['n_push']}, whole lines "
          f"{sc['n_whole_line']}); actual mean {sc['actual_mean']}, line mean {sc['line_mean']} sd {sc['line_sd']}, "
          f"P(over | no push) actual {sc['mean_p_over_actual']}")
    print(f"  {'arm':10s} {'LL o|np':>8s} {'LL full':>8s} {'Brier':>7s} {'slope':>6s} {'mean p':>7s} "
          f"{'T mean':>7s} {'T sd':>6s} {'r(T,act)':>8s} {'r(T,line)':>9s}")
    for a in ARMS:
        x = sc["arms"][a]
        print(f"  {a:10s} {x['ll_over_no_push']:8.4f} {x['ll_full']:8.4f} {x['brier']:7.4f} {x['calib_slope']:6.2f} "
              f"{x['mean_p_over']:7.3f} {x['t_mean']:7.2f} {x['t_sd']:6.3f} {x['corr_t_actual']!s:>8s} "
              f"{x['corr_t_line']!s:>9s}")
    m = sc["arms"]["mkt"]
    print(f"  {'market':10s} {m['ll_over_no_push']:8.4f} {'':8s} {m['brier']:7.4f} {m['calib_slope']!s:>6s} "
          f"{m['mean_p_over']:7.3f}")
    for a in CANDIDATES:
        p, f = sc["vs_gm"][a]["primary"], sc["vs_gm"][a]["full"]
        print(f"  {a} - gm: primary {p['diff']:+.4f} (SE {p['se']:.4f}, n {p['n']}); full {f['diff']:+.4f} "
              f"(SE {f['se']:.4f})")
    for a in ARMS:
        v = sc["vs_mkt"][a]
        print(f"  {a} - market: {v['diff']:+.4f} (SE {v['se']:.4f})")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["status", "dry-run", "look"])
    ap.add_argument("--offline", action="store_true", help="do not top up the NHL schedule cache")
    ap.add_argument("--out", help="write the result JSON here")
    a = ap.parse_args(argv)
    pr = prereg()
    N = int(pr["sample"]["N"])
    since = declared_at()
    payload = {"prereg": "bu/sim/prereg_totals_forward.json", "question": QUESTION, "declared_at": str(since),
               "N": N, "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    if a.cmd == "dry-run":
        df, info = dry_run_frame(since)
        sc = score(df)
        payload.update({"label": "DESCRIPTIVE dry run: pre-declaration games, reconstructed from git history; "
                                 "SIM / BLEND arms approximated by tilting the GM-anchored histogram; not part "
                                 "of the decision", "games": info, "k_bound_hits": int(df["k_bound"].sum()),
                        "score": sc, "rule_as_if": decide(sc)})
        _print_score(sc, f"DESCRIPTIVE dry run (pre-declaration, reconstructed, approximate arms): {info}")
        print(f"  market total at a tilt bound: {payload['k_bound_hits']}; "
              f"rule applied as if (descriptive only): {payload['rule_as_if']}")
    else:
        df, cons = live_frame(allow_fetch=not a.offline)
        dset, counts = decision_set(df, N, since)
        post = df[df["start_ts"] > since] if not df.empty else df
        cov = {"post_declaration_last_snapshots": int(len(post)),
               "with_totals_test": int(post["has_log"].sum()) if len(post) else 0,
               "usable": int(post["usable"].sum()) if len(post) else 0, **cons}
        payload.update({"counts": counts, "coverage": cov})
        print(f"[totals_anchor] decision set: {counts['no_push']} / {N} no-push games "
              f"({counts['eligible']} eligible, {counts['push']} pushes); coverage {cov}")
        if a.cmd == "look":
            if not counts["complete"]:
                raise SystemExit(f"the decision set is not complete ({counts['no_push']} / {N}); no look")
            if _looked():
                raise SystemExit(f"the '{QUESTION}' look has already been made ({LOOK_LOG}); one look only")
            stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
            with open(LOOK_LOG, "a") as f:      # logged before the numbers exist: a crash still counts
                f.write(json.dumps({"season": SEASON, "question": QUESTION, "stage": "started", "at": stamp}) + "\n")
            sc = score(dset)
            dec = decide(sc)
            with open(LOOK_LOG, "a") as f:
                f.write(json.dumps({"season": SEASON, "question": QUESTION,
                                    "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                    "n_games": sc["n_games"], "n_no_push": sc["n_no_push"],
                                    "vs_gm": sc["vs_gm"], "decision": dec}) + "\n")
            payload.update({"score": sc, "decision": dec})
            _print_score(sc, "DECISION LOOK (prereg_totals_forward.json)")
            print(f"  decision: {dec}")
    if a.out:
        with open(a.out, "w") as f:
            json.dump(payload, f, indent=1, default=str)
        print(f"wrote {a.out}")
    return payload


if __name__ == "__main__":
    sys.path.insert(0, PIPELINE_DIR)
    main()
