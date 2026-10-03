"""Season projections on the game simulator (``prereg_season_sim.json``).

``season_simulator.py`` Monte-Carlos the rest of the regular season from one outcome distribution
per remaining game.  With the simulator as its engine (``SimProbabilities``) each game's
P(home regulation win), P(tie after 60) and the home share of OT / SO wins come from simulating it
(``N_RUNS`` runs, seed = SHA-256(base seed, game id)) at the current inputs:

* team / goalie state and league levels: the simulator's point-in-time state (live: the season
  pack rolled through the season's CSVs, ``live.SimServer``);
* expected lineup (``typical_lineup``): per team the 12 forwards and 6 defencemen with the most
  dressed games in its last ``LINEUP_GAMES`` games (ties: the most recent appearance), rated like
  tonight's lineups (``LiveLineupTerm.side``: expected EV TOI shares x ratings, FIN, player
  special teams); live only, the pool is restricted to the skaters DailyFaceoff lists for the team
  now (``team_lineups.json``, injured / IR excluded) and topped up from those lines, so a summer
  departure is not projected to play;
* expected starter: the goals-per-xG multiplier exp(sum share_g log gsv_g) over the goalies who
  started the team's last ``GOALIE_GAMES`` games;
* rest days from the remaining schedule; market-free (no blend), as the logit path was.

Each game is simulated once per run (vectorised inputs, a process pool); the per-game table is
cached for the day (``CACHE``) so ``game_implications.py`` reuses it.  Games the simulator cannot
run fall back to the logit ``Probabilities`` (counted in ``source``).  Playoff series (not part of
the validated question) use a Bradley-Terry fit to the simulated regular-season logits.

Backtest (``prereg_season_sim.json``; walk-forward logit vs simulator at as-of points):

    cd pipeline
    python -m bu.sim.season dev --work W --ratings-dir R --st-dir T     # then: holdout (one look)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import time
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from multiprocessing import get_context

import numpy as np
import pandas as pd

from . import engine as EN
from . import markets as MK
from . import rates as RT

PIPELINE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
N_RUNS = 4000
BASE_SEED = 20261002
LINEUP_GAMES = 10
GOALIE_GAMES = 20
N_F, N_D = 12, 6
CACHE = os.path.join(PIPELINE_DIR, "data", "season_sim_games.json")
ENV = "PONYXG_SEASON_SIM"          # 'logit' rolls the season projections back to the game model
QUESTION = "season_sim"


def log(*a):
    print(*a, flush=True)


def mode(params: dict | None = None) -> str:
    """'sim' or 'logit': the PONYXG_SEASON_SIM variable, else the pre-registered decision recorded in
    the simulator's parameters (``season_sim.engine``), else 'logit'."""
    v = (os.environ.get(ENV) or "").strip().lower()
    if v in ("sim", "logit"):
        return v
    if params is None:
        try:
            from .params import load_params
            params = load_params(missing_ok=True) or {}
        except Exception:  # noqa: BLE001
            params = {}
    return "sim" if ((params or {}).get("season_sim") or {}).get("engine") == "sim" else "logit"


# ------------------------------------------------------------------------------ expected inputs

def typical_lineup(past) -> tuple[list, list]:
    """(pids, groups) of the 12 F + 6 D with the most dressed games in ``past`` (the team's last
    dressed lineups, oldest first: [(pids, groups), ...]); ties go to the most recent appearance."""
    cnt, last, grp = Counter(), {}, {}
    for k, (pids, groups) in enumerate(list(past)[-LINEUP_GAMES:]):
        for p, g in zip(pids, groups):
            cnt[int(p)] += 1
            last[int(p)] = k
            grp[int(p)] = "D" if g == "D" else "F"
    order = sorted(cnt, key=lambda p: (-cnt[p], -last[p], p))
    f = [p for p in order if grp[p] == "F"][:N_F]
    d = [p for p in order if grp[p] == "D"][:N_D]
    return f + d, ["F"] * len(f) + ["D"] * len(d)


def roster_guard(pids, groups, current: tuple[list, list] | None):
    """Live only: keep the typical-lineup skaters who are in the team's current projected lines
    (``current``: DailyFaceoff skaters, injured / IR excluded) and top up each position from them."""
    if not current or len(current[0]) < 10:
        return list(pids), list(groups)
    cur = {int(p): g for p, g in zip(*current)}
    keep = [(p, g) for p, g in zip(pids, groups) if int(p) in cur]
    for pos, need in (("F", N_F), ("D", N_D)):
        have = sum(1 for _, g in keep if g == pos)
        for p, g in zip(*current):
            if have >= need:
                break
            if g == pos and int(p) not in {q for q, _ in keep}:
                keep.append((int(p), g))
                have += 1
    return [p for p, _ in keep], [g for _, g in keep]


def goalie_gsv(starts: list, rel) -> float:
    """exp(sum share x log gsv) over the starters of the team's last GOALIE_GAMES games; ``rel``:
    goalie -> goals-per-xG multiplier.  1.0 without starts."""
    s = [g for g in list(starts)[-GOALIE_GAMES:] if g is not None and not (isinstance(g, float) and math.isnan(g))]
    if not s:
        return 1.0
    c = Counter(s)
    return float(math.exp(sum(n / len(s) * math.log(max(float(rel(g)), 1e-6)) for g, n in c.items())))


def team_inputs(state, tid: int, gsv: float, side: dict | None, c0) -> dict:
    """One team's simulator inputs (the ``rates`` row layout without the h_ / a_ prefix)."""
    out = {f"t_{q}": state.team_rel(tid, q) for q in ("ev_off", "ev_def", "pp", "pk", "take", "draw", "fin")}
    out["g_gsv"] = float(gsv)
    out["c0"] = float(c0) if c0 is not None else float("nan")
    ok = bool(side) and side.get("off") is not None and side.get("def") is not None
    out["bu_ok"] = ok
    if ok:
        out["off"], out["def"] = float(side["off"]), float(side["def"])
        out["fin"] = float(side["fin"]) if side.get("fin") is not None else float("nan")
        out["st"] = side.get("st")
    return out


def game_rows(schedule: list, teams: dict, league: dict, rest: dict) -> pd.DataFrame:
    """Rate-layout rows for the remaining games (``schedule``: [{id, date, home, away}]; ``teams``:
    key -> ``team_inputs``; ``rest``: id -> (home rest, away rest))."""
    rows = []
    for g in schedule:
        h, a = teams.get(g["home"]), teams.get(g["away"])
        if h is None or a is None:
            continue
        hr, ar = rest.get(g["id"], (None, None))
        r = {"game_id": int(g["id"]), "game_type": 2, **{f"lg_{q}": v for q, v in league.items()},
             "h_rest": hr, "a_rest": ar}
        for side, t in (("h", h), ("a", a)):
            for q in ("ev_off", "ev_def", "pp", "pk", "take", "draw", "fin"):
                r[f"{side}_t_{q}"] = t[f"t_{q}"]
            r[f"{side}_g_gsv"] = t["g_gsv"]
        ok = bool(h["bu_ok"] and a["bu_ok"]) and np.isfinite(h["c0"])
        r["bu_ok"] = ok
        if ok:
            r["c_intercept"] = h["c0"]
            for side, t in (("h", h), ("a", a)):
                r[f"bu_{side}_off"], r[f"bu_{side}_def"], r[f"bu_{side}_fin"] = t["off"], t["def"], t["fin"]
            r["st_ok"] = bool(h.get("st") and a.get("st"))
            if r["st_ok"]:
                for side, t in (("h", h), ("a", a)):
                    for f in ("ppo", "pkd", "take", "draw"):
                        r[f"st_{side}_{f}"] = float(t["st"][f])
        rows.append(r)
    return pd.DataFrame(rows)


def runnable(G: pd.DataFrame) -> np.ndarray:
    if not len(G):
        return np.zeros(0, bool)
    fin = np.isfinite(pd.to_numeric(G.get("bu_h_fin"), errors="coerce").to_numpy(float)) & \
        np.isfinite(pd.to_numeric(G.get("bu_a_fin"), errors="coerce").to_numpy(float)) if "bu_h_fin" in G \
        else np.zeros(len(G), bool)
    return RT.finite_inputs(G) & G["bu_ok"].astype(bool).to_numpy() & fin


# ------------------------------------------------------------------------------ simulation

_W = {}


def _init(params):
    _W["params"] = params
    _W["S"] = EN.Structure(params["structural"], params.get("dispersion"))


def _work(task):
    rows, n, seed = task
    g = pd.DataFrame(rows)
    R = RT.build_rates(g, _W["params"])
    out = []
    for i in range(len(g)):
        gid = int(g["game_id"].iloc[i])
        s = MK.summarize(EN.simulate_game(R, i, _W["S"], n, EN.game_seed(seed, gid)))
        out.append({"game_id": gid, "reg_home": s["reg_home"], "reg_tie": s["reg_tie"], "reg_away": s["reg_away"],
                    "p_home": s["p_home"], "p_ot": s["p_ot"], "p_so": s["p_so"], "exp_total": s["exp_total"]})
    return out


def simulate(G: pd.DataFrame, params: dict, n: int = N_RUNS, seed: int = BASE_SEED, workers: int | None = None,
             chunk: int = 40) -> pd.DataFrame:
    """Per-game outcome probabilities of every row of ``G`` (rate layout)."""
    if not len(G):
        return pd.DataFrame(columns=["game_id", "reg_home", "reg_tie", "reg_away", "p_home", "p_ot", "p_so"])
    G = G.copy()
    G["h_rest"] = pd.to_numeric(G["h_rest"], errors="coerce")
    G["a_rest"] = pd.to_numeric(G["a_rest"], errors="coerce")
    tasks = [(G.iloc[s:s + chunk].to_dict("records"), n, seed) for s in range(0, len(G), chunk)]
    workers = workers or max(1, min(os.cpu_count() or 1, 8))
    if workers == 1 or len(tasks) == 1:
        _init(params)
        res = [_work(t) for t in tasks]
    else:
        with get_context("fork").Pool(workers, initializer=_init, initargs=(params,)) as pool:
            res = pool.map(_work, tasks)
    return pd.DataFrame([r for part in res for r in part])


def outcome_tuple(r) -> tuple:
    """(p_home_reg, p_away_reg, p_tie, home share of OT / SO wins, p_home): the
    ``season_simulator.Probabilities.game`` layout."""
    pt = float(r["reg_tie"])
    p = float(r["p_home"])
    q = (p - float(r["reg_home"])) / pt if pt > 1e-9 else 0.5
    q = min(max(q, 0.05), 0.95)
    return (p - pt * q, 1 - p - pt * (1 - q), pt, q, p)


class SimProbabilities:
    """``season_simulator.Probabilities`` with every precomputed game from the simulator."""

    def __init__(self, table: dict, fallback=None, source: str = "game simulator", meta: dict | None = None,
                 schedule: list | None = None):
        self.table = table                # (home, away, date, h_rest, a_rest) -> outcome tuple
        self.fallback = fallback          # the logit Probabilities for a game the simulator could not run
        self.source = source
        self.meta = meta or {}
        self.n_fallback = 0
        self._bt = None
        self._sched = {(k[0], k[1], k[2]) for k in table} | {(g["home"], g["away"], g["date"]) for g in (schedule or [])}
        self._by_triple = {(k[0], k[1], k[2]): v for k, v in table.items()}

    def _fit_bt(self):
        keys = list(self.table)
        teams = sorted({k[0] for k in keys} | {k[1] for k in keys})
        if not keys or len(teams) < 2:
            self._bt = ({}, 0.0)
            return
        ix = {t: i for i, t in enumerate(teams)}
        X = np.zeros((len(keys) + 1, len(teams) + 1))
        y = np.zeros(len(keys) + 1)
        for r, k in enumerate(keys):
            p = min(max(self.table[k][4], 1e-4), 1 - 1e-4)
            X[r, -1] = 1.0
            X[r, ix[k[0]]] += 1.0
            X[r, ix[k[1]]] -= 1.0
            y[r] = math.log(p / (1 - p))
        X[-1, :-1] = 1.0                  # sum of ratings = 0
        b = np.linalg.lstsq(X, y, rcond=None)[0]
        self._bt = ({t: float(b[i]) for t, i in ix.items()}, float(b[-1]))

    def game(self, home, away, date, h_rest=None, a_rest=None):
        k = (home, away, date, h_rest, a_rest)
        if k in self.table:
            return self.table[k]
        # a scheduled regular-season game the simulator could not run: the logit
        if (home, away, date) in self._by_triple:      # the same game asked without its rest days
            return self._by_triple[(home, away, date)]
        if self.fallback is not None and (home, away, date) in self._sched:
            self.n_fallback += 1
            return self.fallback.game(home, away, date, h_rest, a_rest)
        if self._bt is None:
            self._fit_bt()
        r, h = self._bt                    # playoff series: Bradley-Terry on the simulated logits
        z = h + r.get(home, 0.0) - r.get(away, 0.0)
        p = 1 / (1 + math.exp(-z))
        pt = float(np.mean([v[2] for v in self.table.values()])) if self.table else 0.22
        return (p - pt * 0.5, 1 - p - pt * 0.5, pt, 0.5, p)


def rest_days_by_game(schedule):
    from season_simulator import rest_days_by_game as R
    return R(schedule)


def build_table(schedule, G: pd.DataFrame, res: pd.DataFrame, rest: dict) -> dict:
    by_id = {int(g["id"]): g for g in schedule}
    out = {}
    for r in res.to_dict("records"):
        g = by_id[int(r["game_id"])]
        out[(g["home"], g["away"], g["date"], *rest[g["id"]])] = outcome_tuple(r)
    return out


# ------------------------------------------------------------------------------ live

def _starts_from_gamestats(frames, name_to_tri: dict) -> dict:
    """{tricode: [starting goalie names, oldest first]} from gamestats frames (any game type)."""
    rows = []
    for f in frames:
        if f is None or not len(f):
            continue
        x = f[["game_id", "game_date", "team", "starting_goalie"]].copy()
        rows.append(x)
    if not rows:
        return {}
    g = pd.concat(rows, ignore_index=True).drop_duplicates(["game_id", "team"])
    g = g.sort_values(["game_date", "game_id"])
    out = defaultdict(list)
    for t, s in zip(g["team"], g["starting_goalie"]):
        tri = name_to_tri.get(str(t))
        if tri:
            out[tri].append(s if isinstance(s, str) and s.strip() else None)
    return out


def live_teams(srv, term, schedule: list, lineups: dict | None = None) -> tuple[dict, dict]:
    """({tricode: team_inputs}, detail) for the teams of ``schedule`` from the live simulator state
    (``srv``), the lineup term (``term``: bundle ratings, shares, team histories), DailyFaceoff's
    current lines (``lineups``, the roster guard) and the season's starters (goalie shares)."""
    from season import SEASON_ID, season_file
    teams_csv = pd.read_csv(os.path.join(PIPELINE_DIR, "nhl_teams.csv"))
    name_to_tri = dict(zip(teams_csv["Common Name"], teams_csv["Team Tricode"]))
    frames = []
    for y in (int(SEASON_ID[:4]) - 1, int(SEASON_ID[:4])):
        p = os.path.join(PIPELINE_DIR, season_file("gamestats", y))
        if os.path.exists(p):
            frames.append(pd.read_csv(p, usecols=lambda c: c in ("game_id", "game_date", "team", "starting_goalie")))
    starts = _starts_from_gamestats(frames, name_to_tri)
    teams, detail = {}, {}
    for tri in sorted({g["home"] for g in schedule} | {g["away"] for g in schedule}):
        tid = srv.team_ids.get(tri)
        if tid is None:
            continue
        pids, groups = typical_lineup(term.history.get(term.teams.get(tri, tid), ()))
        cur = None
        if (lineups or {}).get(tri):
            cp, cg, _ = term.resolve(tri, lineups.get(tri))
            cur = (cp, cg)
        pids, groups = roster_guard(pids, groups, cur)
        side = term.side(tri, pids, groups) if len(pids) >= 10 else None
        if side is not None and side.get("rated", 0) < 10:
            side = None
        gsv = goalie_gsv(starts.get(tri, []), lambda g: srv.state.goalie_rel(g)[0])
        teams[tri] = team_inputs(srv.state, tid, gsv, side, term.intercept)
        detail[tri] = {"n": len(pids), "rated": (side or {}).get("rated"), "gsv": round(gsv, 4),
                       "off": None if side is None else round(float(side["off"]), 4),
                       "def": None if side is None else round(float(side["def"]), 4)}
    return teams, detail


def live_probabilities(schedule: list, fallback=None, n: int = N_RUNS, now=None, lineups: dict | None = None,
                       srv=None, workers: int | None = None) -> SimProbabilities | None:
    """SimProbabilities for the remaining ``schedule`` from the live simulator, or None when it cannot
    run at all (no parameters / pack / lineup bundle).  Per-game results are cached in ``CACHE`` for
    the day and the same inputs (simulator version, bundle, state date, DailyFaceoff lines), so the
    hourly game_implications run and a re-run only simulate games whose rest days changed."""
    from season import SEASON_ID, today_local
    from . import lineup_source as LS
    from .live import SimServer
    t0 = time.time()
    srv = srv or SimServer.load(SEASON_ID, n=n, verbose=False)
    if not srv.available:
        log(f"[season-sim] simulator unavailable ({srv.error})")
        return None
    term = LS.live_term(LS.spec(srv.params))
    if term is None:
        log("[season-sim] lineup bundle unavailable")
        return None
    if lineups is None:
        try:
            with open(os.path.join(PIPELINE_DIR, "team_lineups.json")) as f:
                lineups = json.load(f)
        except (OSError, ValueError):
            lineups = {}
    rest = rest_days_by_game(schedule)
    lu_hash = hashlib.sha256(json.dumps({t: {k: v for k, v in (x or {}).items() if k not in ("updated_at", "fetched_at")}
                                         for t, x in sorted((lineups or {}).items())}, sort_keys=True,
                                        default=str).encode()).hexdigest()[:16]
    key = {"date": today_local(now).isoformat(), "version": srv.version, "bundle": term.b.get("built_at"),
           "state": None if srv.state.max_date is None else str(pd.Timestamp(srv.state.max_date).date()),
           "n_runs": int(n), "lineups": lu_hash}
    cached = _read_cache(key)
    teams, detail = live_teams(srv, term, schedule, lineups)
    league = {q: srv.state.league_rate(q) for q in ("ev_goals", "ev_xg", "pp_goals", "pp_xg", "pen", "fin", "gsv")}
    G = game_rows(schedule, teams, league, rest)
    ok = runnable(G)
    gk = [f"{int(i)}|{rest[int(i)][0]}|{rest[int(i)][1]}" for i in G["game_id"]] if len(G) else []
    have = (cached or {}).get("games", {})
    need = np.array([o and k not in have for o, k in zip(ok, gk)], dtype=bool)
    res = simulate(G[need].reset_index(drop=True), srv.params, n=n, workers=workers)
    games = {k: have[k] for o, k in zip(ok, gk) if o and k in have}
    for r in res.to_dict("records"):
        i = int(r["game_id"])
        games[f"{i}|{rest[i][0]}|{rest[i][1]}"] = [round(float(r[c]), 6) for c in ("reg_home", "reg_tie", "reg_away",
                                                                                  "p_home")]
    by_id = {int(g["id"]): g for g in schedule}
    table = {}
    for k, v in games.items():
        i = int(k.split("|")[0])
        g = by_id[i]
        table[(g["home"], g["away"], g["date"], *rest[i])] = outcome_tuple(
            {"reg_home": v[0], "reg_tie": v[1], "reg_away": v[2], "p_home": v[3]})
    meta = {"version": srv.version, "n_runs": int(n), "games": len(schedule), "simulated": int(len(table)),
            "simulated_now": int(len(res)), "from_cache": int(len(table) - len(res)),
            "not_runnable": int((~ok).sum()) if len(ok) else 0, "seconds": round(time.time() - t0, 1), "teams": detail}
    if len(res) or cached is None or set(games) != set(have):     # unchanged: no rewrite (no commit churn)
        _write_cache(key, games, {"version": srv.version, "n_runs": int(n)})
    log(f"[season-sim] {len(table)}/{len(schedule)} games ({len(res)} simulated now, {n} runs; "
        f"{len(table) - len(res)} from the cache) in {time.time() - t0:.1f} s")
    return SimProbabilities(table, fallback, f"game simulator ({srv.version})", meta, schedule)


def _read_cache(key: dict):
    try:
        with open(CACHE) as f:
            c = json.load(f)
        return c if c.get("key") == key else None
    except (OSError, ValueError):
        return None


def _write_cache(key: dict, games: dict, meta: dict) -> None:
    try:
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        tmp = CACHE + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"key": key, "meta": {k: v for k, v in meta.items() if k != "teams"}, "games": games}, f,
                      separators=(",", ":"))
        os.replace(tmp, CACHE)
    except OSError as e:
        log(f"[season-sim] cache not written: {e}")
