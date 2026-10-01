"""
bu/prereg_analysis.py — the analysis code named by pipeline/bu/preregistration.yaml.

FROZEN.  preregistration.yaml records this file's sha256; any edit makes
tests/test_snapshot_prereg.py fail until a dated amendment is appended to the
YAML (amendments may not change a test that has already been looked at).

It is self-contained on purpose (stdlib + numpy, and it reads the snapshot
archive's schema-v1 rows directly), so the snapshot job and market.py can
evolve without changing what was registered.

Tests implemented (DESIGN v2 §1.5-1.7, owner decisions D1 and D7):
  M-1  line movement: logit q_c - logit q0 = a + b (logit p0 - logit q0)    [primary]
  M-2  unshrunk weight: y ~ a + b1 logit p_model + b2 logit q_close
  M-3  published blend vs close: mean LL(blend) - LL(close)
  M-4  CLV of the bets the live rule placed (reported; binding if n >= 150)
  M-5  standalone LL(model) - LL(close) (reported, never gated)
  C    live shadow non-inferiority, LL(blend_BU) - LL(blend_current) < +0.001
  E    early-season (min GP <= 15) non-inferiority, 2027-28

Usage (from pipeline/):
  python3 -m bu.prereg_analysis --test M-1 [--until YYYY-MM-DD] [--record]
  python3 -m bu.prereg_analysis --test all --until 2027-04-16
``--record`` appends the result to bu/prereg_looks.jsonl (the look ledger).
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
import zlib
from datetime import datetime, timedelta, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE_DIR = os.path.dirname(HERE)
SNAPSHOT_DIR = os.path.join(PIPELINE_DIR, "snapshots")
LOOK_LEDGER = os.path.join(HERE, "prereg_looks.jsonl")

# ── Registered constants (mirrored in preregistration.yaml) ──────────────────
SEASON_LABEL = "2026-27"
GAME_TYPES = ("02", "03")
REGULAR_SEASON = "02"
ALPHA_ONE_SIDED = 0.05
Z_ONE_SIDED = 1.6448536269514722          # one-sided 95%
Z_TWO_SIDED = 1.959963984540054           # two-sided 95%
CLOSE_MAX_LEAD_MIN = 15.0                 # close: 0 < lead <= 15
Q0_MIN_LEAD_MIN = 60.0                    # q0: earliest game-day price with lead >= 60
PRIMARY_BOOK = "draftkings"
SOURCE_PRIORITY = ("nhl_partner", "espn")  # DraftKings via the NHL feed, then via ESPN
OVERROUND_RANGE = (0.01, 0.10)            # two-way ML overround filter (price-only)
MAX_Q_JUMP = 0.25                         # |q_close - q0| filter (price-only)
M1_MIN_N = 400
M4_MIN_BETS = 150
NI_MARGIN = 0.001                         # Gates C and E
GATE_C_MIN_N = 400
GATE_E_MIN_N = 200
GATE_E_MAX_GP = 15
HOME_WIN_RESULTS = ("RW", "W", "OTW", "SOW")    # gamestats `result`, home row
HOME_LOSS_RESULTS = ("RL", "L", "OTL", "SOL")
BOOTSTRAP_N = 2000
SEED = 20261001
P_CLIP = 1e-6

ET_OFFSET_FALLBACK = timedelta(hours=-4)


# ── Small helpers ────────────────────────────────────────────────────────────

def _dt(s):
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _et_date(ts) -> str | None:
    d = _dt(ts)
    if d is None:
        return None
    try:
        from zoneinfo import ZoneInfo
        return d.astimezone(ZoneInfo("America/New_York")).date().isoformat()
    except Exception:  # pragma: no cover - zoneinfo always present on 3.9+
        return (d + ET_OFFSET_FALLBACK).date().isoformat()


def american_to_prob(price) -> float | None:
    try:
        p = float(price)
    except (TypeError, ValueError):
        return None
    if math.isnan(p) or abs(p) < 100:
        return None
    return 100.0 / (p + 100.0) if p > 0 else -p / (-p + 100.0)


def devig_power(home_ml, away_ml) -> float | None:
    """Fair home probability: solve r_h^k + r_a^k = 1 (power method)."""
    rh, ra = american_to_prob(home_ml), american_to_prob(away_ml)
    if rh is None or ra is None:
        return None
    if abs(rh + ra - 1.0) < 1e-12:
        return rh
    lo, hi = 0.1, 10.0
    for _ in range(200):
        k = (lo + hi) / 2
        if rh ** k + ra ** k > 1:
            lo = k
        else:
            hi = k
    k = (lo + hi) / 2
    return rh ** k / (rh ** k + ra ** k)


def overround(home_ml, away_ml) -> float | None:
    rh, ra = american_to_prob(home_ml), american_to_prob(away_ml)
    return None if rh is None or ra is None else rh + ra - 1.0


def logit(p):
    p = np.clip(np.asarray(p, dtype=float), P_CLIP, 1 - P_CLIP)
    return np.log(p / (1 - p))


def ll_per_game(y, p):
    p = np.clip(np.asarray(p, dtype=float), P_CLIP, 1 - P_CLIP)
    y = np.asarray(y, dtype=float)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def ols(y, x, clusters=None):
    """y = a + b x.  Returns (a, b, se_b_hc1, se_b_cluster)."""
    y, x = np.asarray(y, float), np.asarray(x, float)
    n = len(y)
    X = np.column_stack([np.ones(n), x])
    xtx_inv = np.linalg.inv(X.T @ X)
    beta = xtx_inv @ X.T @ y
    e = y - X @ beta
    meat = (X * e[:, None]).T @ (X * e[:, None])
    cov_hc1 = xtx_inv @ meat @ xtx_inv * n / max(n - 2, 1)
    se_cl = None
    if clusters is not None:
        groups = {}
        for i, c in enumerate(clusters):
            groups.setdefault(c, []).append(i)
        g = len(groups)
        meat_c = np.zeros((2, 2))
        for idx in groups.values():
            s = (X[idx] * e[idx, None]).sum(axis=0)
            meat_c += np.outer(s, s)
        adj = (g / max(g - 1, 1)) * ((n - 1) / max(n - 2, 1))
        se_cl = float(math.sqrt((xtx_inv @ meat_c @ xtx_inv * adj)[1, 1]))
    return float(beta[0]), float(beta[1]), float(math.sqrt(cov_hc1[1, 1])), se_cl


def logistic(X, y, iters=100):
    """Unpenalised logistic regression by IRLS. X without intercept column.
    Returns (coef incl. intercept first, standard errors)."""
    X = np.column_stack([np.ones(len(y)), np.asarray(X, float)])
    y = np.asarray(y, float)
    b = np.zeros(X.shape[1])
    for _ in range(iters):
        eta = X @ b
        mu = 1 / (1 + np.exp(-eta))
        w = np.clip(mu * (1 - mu), 1e-9, None)
        H = X.T @ (X * w[:, None])
        step = np.linalg.solve(H, X.T @ (y - mu))
        b = b + step
        if np.max(np.abs(step)) < 1e-10:
            break
    mu = 1 / (1 + np.exp(-(X @ b)))
    H = X.T @ (X * (mu * (1 - mu))[:, None])
    se = np.sqrt(np.diag(np.linalg.inv(H)))
    return b, se


def calibration_slope(y, p) -> dict:
    b, se = logistic(logit(p)[:, None], y)
    return {"slope": float(b[1]), "intercept": float(b[0]),
            "ci95": [float(b[1] - Z_TWO_SIDED * se[1]), float(b[1] + Z_TWO_SIDED * se[1])],
            "contains_1": bool(b[1] - Z_TWO_SIDED * se[1] <= 1 <= b[1] + Z_TWO_SIDED * se[1])}


def paired(d, seed=SEED, n_boot=BOOTSTRAP_N) -> dict:
    """Mean of per-game differences with analytic SE and a game bootstrap."""
    d = np.asarray(d, float)
    n = len(d)
    mean = float(d.mean()) if n else float("nan")
    se = float(d.std(ddof=1) / math.sqrt(n)) if n > 1 else float("nan")
    out = {"n": n, "mean": mean, "se": se,
           "upper95_one_sided": mean + Z_ONE_SIDED * se, "lower95_one_sided": mean - Z_ONE_SIDED * se}
    if n > 1:
        rng = np.random.default_rng(seed)
        means = d[rng.integers(0, n, size=(n_boot, n))].mean(axis=1)
        out["bootstrap_ci95"] = [float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))]
        out["bootstrap_upper95_one_sided"] = float(np.percentile(means, 95))
    return out


# ── Data ─────────────────────────────────────────────────────────────────────

def read_day_file(path) -> list[dict]:
    rows = []
    with open(path, "rb") as fh:
        raw = fh.read()
    text, pos = b"", 0
    while pos < len(raw):
        d = zlib.decompressobj(16 + zlib.MAX_WBITS)
        try:
            chunk = d.decompress(raw[pos:])
        except zlib.error:
            break
        if not d.eof:
            break
        text += chunk
        pos = len(raw) - len(d.unused_data)
    for line in text.decode("utf-8", errors="replace").splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    return rows


def load_snapshots(root=SNAPSHOT_DIR, season=SEASON_LABEL, until=None) -> list[dict]:
    d = os.path.join(root, season)
    rows = []
    if not os.path.isdir(d):
        return rows
    for name in sorted(os.listdir(d)):
        if name.endswith(".jsonl.gz") and (until is None or name[:10] <= str(until)):
            rows += read_day_file(os.path.join(d, name))
    return rows


def load_outcomes(path=None, season=SEASON_LABEL) -> dict:
    """{game_id: 1 if the home team won (incl. OT/SO) else 0} from the season
    gamestats CSV (one row per team).  The scraper writes RW/RL for
    regulation, OTW/OTL and SOW/SOL; plain W/L are accepted too."""
    y = int(season[:4])
    path = path or os.path.join(PIPELINE_DIR, f"nhl_season_{y}_{y + 1}_gamestats.csv")
    out = {}
    try:
        with open(path, newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                if (r.get("home_away") or "").lower() != "home":
                    continue
                res = (r.get("result") or "").upper()
                if res in HOME_WIN_RESULTS:
                    out[int(float(r["game_id"]))] = 1
                elif res in HOME_LOSS_RESULTS:
                    out[int(float(r["game_id"]))] = 0
    except OSError:
        pass
    return out


def _prices(rows, book=PRIMARY_BOOK):
    """Flat primary-book price records with lead minutes, pregame only."""
    out = []
    for r in rows:
        if r.get("game_type") not in GAME_TYPES:
            continue
        for p in r.get("prices") or []:
            if p.get("book") != book:
                continue
            fa, st = _dt(p.get("fetched_at") or r.get("captured_at")), _dt(r.get("start_utc"))
            if not fa or not st:
                continue
            lead = (st - fa).total_seconds() / 60.0
            if lead <= 0:
                continue
            out.append({"game_id": r["game_id"], "game_date": r.get("game_date"), "game_type": r.get("game_type"),
                        "start_utc": r.get("start_utc"), "source": p.get("source"), "fetched_at": fa,
                        "lead": lead, "home_ml": p.get("home_ml"), "away_ml": p.get("away_ml"),
                        "published": r.get("published") or {}})
    return out


def _published_ok(pub, at) -> bool:
    t = _dt(pub.get("predicted_at"))
    return bool(pub) and pub.get("home_model_pct") is not None and t is not None and t <= at


def market_games(rows, outcomes) -> tuple[list[dict], dict]:
    """One record per eligible game: q0, close, published model at each, y.
    Returns (games, exclusion counts)."""
    by_game: dict = {}
    for p in _prices(rows):
        by_game.setdefault(p["game_id"], []).append(p)
    excl = {"no_q0_and_close_in_one_source": 0, "price_filter": 0, "no_published_model": 0, "no_outcome": 0}
    games = []
    for gid, ps in sorted(by_game.items()):
        chosen = None
        for src in SOURCE_PRIORITY:
            s = sorted((p for p in ps if p["source"] == src), key=lambda p: p["fetched_at"])
            q0 = next((p for p in s if p["lead"] >= Q0_MIN_LEAD_MIN
                       and _et_date(p["fetched_at"]) == p["game_date"]), None)
            closes = [p for p in s if p["lead"] <= CLOSE_MAX_LEAD_MIN]
            if q0 and closes:
                chosen = (src, q0, closes[-1])
                break
        if not chosen:
            excl["no_q0_and_close_in_one_source"] += 1
            continue
        src, q0p, qcp = chosen
        q0, qc = devig_power(q0p["home_ml"], q0p["away_ml"]), devig_power(qcp["home_ml"], qcp["away_ml"])
        ors = [overround(x["home_ml"], x["away_ml"]) for x in (q0p, qcp)]
        if (q0 is None or qc is None or any(o is None or not (OVERROUND_RANGE[0] <= o <= OVERROUND_RANGE[1])
                                           for o in ors) or abs(qc - q0) >= MAX_Q_JUMP):
            excl["price_filter"] += 1
            continue
        pub0, pubc = q0p["published"], qcp["published"]
        if not (_published_ok(pub0, q0p["fetched_at"]) and _published_ok(pubc, qcp["fetched_at"])):
            excl["no_published_model"] += 1
            continue
        if gid not in outcomes:
            excl["no_outcome"] += 1
            continue
        games.append({
            "game_id": gid, "game_date": q0p["game_date"], "game_type": q0p["game_type"],
            "start_utc": q0p["start_utc"], "source": src, "y": outcomes[gid],
            "q0": q0, "q_close": qc, "q0_lead": q0p["lead"], "close_lead": qcp["lead"],
            "p0": pub0["home_model_pct"] / 100.0, "p_model_close": pubc["home_model_pct"] / 100.0,
            "p_blend_close": (pubc.get("home_win_pct") or pubc["home_model_pct"]) / 100.0,
            "blend_weight_close": pubc.get("blend_weight"),
            "model_version_q0": pub0.get("model_version"),
            "min_gp": min(float(pubc.get("home_gp", 99)), float(pubc.get("away_gp", 99))),
            "p_bu_blend_close": (pubc["bu_shadow_home_win_pct"] / 100.0
                                 if pubc.get("bu_shadow_home_win_pct") is not None else None),
            # Gate C / E incumbent (amendment 2026-10-01b): once the BU candidate is the live
            # model, blend_current is the replaced model's published-style blend (the rollback
            # shadow f1_shadow_home_win_pct); before that it is the published blend itself.
            "p_inc_blend_close": (pubc["f1_shadow_home_win_pct"] / 100.0
                                  if pubc.get("f1_shadow_home_win_pct") is not None
                                  else (pubc.get("home_win_pct") or pubc["home_model_pct"]) / 100.0),
        })
    games.sort(key=lambda g: (g["start_utc"], g["game_id"]))
    return games, excl


# ── Tests ────────────────────────────────────────────────────────────────────

def m1_line_movement(games, min_n=M1_MIN_N) -> dict:
    """Binding look: the first ``min_n`` eligible games by start time.
    ``min_n=0`` is a descriptive fit on every game given (Gate E's early-season
    beta); it is never binding."""
    n_avail = len(games)
    binding = bool(min_n) and n_avail >= min_n
    g = games[:min_n] if binding else games
    out = {"test": "M-1", "n_available": n_avail, "n_used": len(g), "min_n": min_n}
    if len(g) < 10:
        return {**out, "status": "insufficient data", "pass": None}
    q0, qc, p0 = (np.array([x[k] for x in g]) for k in ("q0", "q_close", "p0"))
    y, x = logit(qc) - logit(q0), logit(p0) - logit(q0)
    try:
        a, b, se, se_cl = ols(y, x, clusters=[x_["game_date"] for x_ in g])
    except np.linalg.LinAlgError:
        return {**out, "status": "degenerate design (no variation in the model-market gap)", "pass": None}
    lower = b - Z_ONE_SIDED * se
    out.update({
        "alpha": a, "beta": b, "se_hc1": se, "lower95_one_sided": lower,
        "se_cluster_by_date": se_cl,
        "lower95_one_sided_cluster_by_date": None if se_cl is None else b - Z_ONE_SIDED * se_cl,
        "sd_dlogit_q": float(np.std(y, ddof=1)), "sd_gap": float(np.std(x, ddof=1)),
        "model_versions": sorted({str(x_["model_version_q0"]) for x_ in g}),
        "binding": binding, "pass": bool(lower > 0) if binding else None,
        "status": "binding look" if binding else (f"descriptive (n < {min_n})" if min_n else "descriptive"),
    })
    return out


def m2_unshrunk_weight(games) -> dict:
    g = [x for x in games if x["game_type"] == REGULAR_SEASON]
    out = {"test": "M-2", "n": len(g)}
    if len(g) < 30:
        return {**out, "status": "insufficient data", "pass": None}
    X = np.column_stack([logit([x["p_model_close"] for x in g]), logit([x["q_close"] for x in g])])
    try:
        b, se = logistic(X, np.array([x["y"] for x in g]))
    except np.linalg.LinAlgError:
        return {**out, "status": "degenerate design (separation or collinearity)", "pass": None}
    lower = float(b[1] - Z_ONE_SIDED * se[1])
    return {**out, "a": float(b[0]), "b1_model": float(b[1]), "se_b1": float(se[1]),
            "b2_close": float(b[2]), "se_b2": float(se[2]), "b1_lower95_one_sided": lower,
            "pass": bool(lower > 0), "status": "season-end binding look"}


def m3_blend_vs_close(games) -> dict:
    g = [x for x in games if x["game_type"] == REGULAR_SEASON]
    out = {"test": "M-3", "n": len(g)}
    if len(g) < 30:
        return {**out, "status": "insufficient data", "pass": None}
    y = np.array([x["y"] for x in g])
    d = ll_per_game(y, [x["p_blend_close"] for x in g]) - ll_per_game(y, [x["q_close"] for x in g])
    res = paired(d)
    return {**out, "ll_blend": float(ll_per_game(y, [x["p_blend_close"] for x in g]).mean()),
            "ll_close": float(ll_per_game(y, [x["q_close"] for x in g]).mean()),
            "diff": res, "pass": bool(res["mean"] <= 0), "status": "season-end binding (point estimate)"}


def m4_clv(bets) -> dict:
    """``bets``: [{price: american odds taken, q_close_side: fair close prob of
    the side bet}].  CLV = decimal(price) * q_close_side - 1."""
    clv = []
    for b in bets:
        r = american_to_prob(b.get("price"))
        q = b.get("q_close_side")
        if r is None or q is None:
            continue
        clv.append((1.0 / r) * q - 1.0)
    clv = np.array(clv, float)
    out = {"test": "M-4", "n": int(len(clv)), "min_n": M4_MIN_BETS}
    if len(clv) < 2:
        return {**out, "status": "insufficient data", "pass": None}
    res = paired(clv)
    binding = len(clv) >= M4_MIN_BETS
    return {**out, "mean_clv": res["mean"], "ci": res.get("bootstrap_ci95"),
            "share_positive": float((clv > 0).mean()), "binding": binding,
            "pass": bool(res["lower95_one_sided"] > 0) if binding else None,
            "status": "binding" if binding else "reported only"}


def load_bets(path=None, season=SEASON_LABEL) -> list:
    """The live rule's bets for ``season`` from public/data/bet_ledger.json."""
    path = path or os.path.join(os.path.dirname(PIPELINE_DIR), "public", "data", "bet_ledger.json")
    try:
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
    except (OSError, ValueError):
        return []
    return ((d.get("seasons") or {}).get(season) or {}).get("bets") or []


def m4_from_ledger(games, bets) -> dict:
    """M-4 on the ledger's bets joined to each game's primary-book close."""
    close = {g["game_id"]: g["q_close"] for g in games}
    rows = []
    for b in bets:
        try:
            gid = int(b.get("gameId"))
        except (TypeError, ValueError):
            continue
        if gid not in close or b.get("side") not in ("home", "away"):
            continue
        rows.append({"price": b.get("price"),
                     "q_close_side": close[gid] if b["side"] == "home" else 1.0 - close[gid]})
    return m4_clv(rows)


def m5_standalone(games) -> dict:
    g = [x for x in games if x["game_type"] == REGULAR_SEASON]
    if len(g) < 30:
        return {"test": "M-5", "n": len(g), "status": "insufficient data"}
    y = np.array([x["y"] for x in g])
    d = ll_per_game(y, [x["p_model_close"] for x in g]) - ll_per_game(y, [x["q_close"] for x in g])
    return {"test": "M-5", "n": len(g), "diff": paired(d), "status": "reported, never gated"}


def noninferiority(y, p_new, p_old, margin=NI_MARGIN, min_n=GATE_C_MIN_N, name="C") -> dict:
    y = np.asarray(y, float)
    out = {"test": name, "n": int(len(y)), "min_n": min_n, "margin": margin}
    if len(y) < 30:
        return {**out, "status": "insufficient data", "pass": None}
    d = ll_per_game(y, p_new) - ll_per_game(y, p_old)
    res = paired(d)
    try:
        cal = calibration_slope(y, p_new)
    except np.linalg.LinAlgError:
        cal = {"slope": None, "ci95": None, "contains_1": False, "status": "degenerate"}
    binding = len(y) >= min_n
    ok = res["upper95_one_sided"] < margin and cal["contains_1"]
    return {**out, "diff": res, "calibration_new": cal, "binding": binding,
            "pass": bool(ok) if binding else None,
            "status": "binding look" if binding else f"descriptive (n < {min_n})"}


def gate_c(games) -> dict:
    g = [x for x in games if x.get("p_bu_blend_close") is not None]
    g = g[:GATE_C_MIN_N] if len(g) >= GATE_C_MIN_N else g
    return noninferiority([x["y"] for x in g], [x["p_bu_blend_close"] for x in g],
                          [x["p_inc_blend_close"] for x in g], NI_MARGIN, GATE_C_MIN_N, "C")


def gate_e(games) -> dict:
    """2027-28 only: games played in October-November with min GP <= 15."""
    g = [x for x in games if x.get("p_bu_blend_close") is not None and x["min_gp"] <= GATE_E_MAX_GP
         and str(x["game_date"])[5:7] in ("10", "11")]
    res = noninferiority([x["y"] for x in g], [x["p_bu_blend_close"] for x in g],
                         [x["p_inc_blend_close"] for x in g], NI_MARGIN, GATE_E_MIN_N, "E")
    res["m1_beta_early"] = m1_line_movement(g, min_n=0).get("beta") if len(g) >= 10 else None
    return res


TESTS = {"M-1": m1_line_movement, "M-2": m2_unshrunk_weight, "M-3": m3_blend_vs_close,
         "M-4": m4_from_ledger, "M-5": m5_standalone, "C": gate_c, "E": gate_e}


def run(test="all", until=None, root=SNAPSHOT_DIR, season=SEASON_LABEL, outcomes_path=None,
        bets_path=None) -> dict:
    rows = load_snapshots(root, season, until)
    games, excl = market_games(rows, load_outcomes(outcomes_path, season))
    names = list(TESTS) if test == "all" else [test]
    results = {}
    for n in names:
        results[n] = TESTS[n](games, load_bets(bets_path, season)) if n == "M-4" else TESTS[n](games)
    return {"season": season, "until": until, "snapshot_rows": len(rows), "eligible_games": len(games),
            "excluded": excl, "results": results}


def file_sha256(path=__file__) -> str:
    import hashlib
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Pre-registered 2026-27 market tests")
    ap.add_argument("--test", default="all", choices=["all", *TESTS])
    ap.add_argument("--until", default=None, help="last game date (YYYY-MM-DD) to include")
    ap.add_argument("--season", default=SEASON_LABEL)
    ap.add_argument("--record", action="store_true", help="append the result to the look ledger")
    a = ap.parse_args(argv)
    res = run(a.test, a.until, season=a.season)
    res["analysis_sha256"] = file_sha256()
    res["run_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    print(json.dumps(res, indent=1, default=str))
    if a.record:
        with open(LOOK_LEDGER, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(res, default=str, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
