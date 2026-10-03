"""season_simulator.py - Monte Carlo standings and playoff odds.

    python3 season_simulator.py              # writes public/data/season_projections.json
    python3 season_simulator.py --backtest   # preseason-projection check of the sigma

Model
-----
* Game probabilities come from the live game model (ml_predict, the same
  model that makes the daily picks) for every remaining regular-season game,
  with rest days from the remaining schedule.  At 0 GP the model runs on its
  regressed preseason priors (Elo carried over and regressed, xG shares
  shrunk), which is what the rollover needs.  If the model is unavailable
  the old ratings-ratio model (``get_game_prob``) is the fallback.
  With ``PONYXG_SEASON_SIM=sim`` (opt-in; the pre-registered backtest,
  bu/sim/prereg_season_sim.json, did not promote it) each remaining game's
  regulation / tie / OT-share split comes from the game simulator instead
  (bu/sim/season.py: typical lineups, goalie start shares, 4,000 runs a game,
  cached for the day; per-game logit fallback), with the season calibration in
  sim_params.json season_sim.calibration (days-ahead logit shrink, strength
  sigma, lineup regression; bu/sim/prereg_season_calib.json tuned it to the
  identity and did not promote the simulator either).
* Regulation / overtime split from goal_model: the goal rates implied by
  the win probability give P(home in regulation), P(tie after 60) and the
  home share of OT/SO wins.
* Strength uncertainty: each simulated season draws one logit offset per
  team, N(0, sigma), with sigma = SIGMA0 * sqrt(SIGMA_GP / (SIGMA_GP + GP)),
  so preseason projections are not over-confident (a fixed-strength
  simulation gave several teams 0% / 100% in October).  SIGMA0 = 0.20 logit
  (about +-5% per game) was picked by ``--backtest`` (preseason projections
  of 2023-24 and 2025-26, 64 team-seasons, tests/out/season_sim_backtest.json):
  playoff Brier 0.2119 vs 0.2180 with fixed strengths (sigma 0), log loss
  0.6055 vs 0.6176, and 75% of final point totals inside the 80% interval
  (61% with fixed strengths); sigma 0.3 covers 86% but scores worse.
* Playoffs: the NHL bracket (division top 3 + 2 wild cards per conference,
  the better division winner plays the lower wild card), best-of-7 with
  2-2-1-1-1 home ice for the team with more points.
* Every simulation reuses the same random numbers for a given engine, so
  forced-result scenarios (game_implications.py) differ only by the forced
  game (common random numbers).

Outputs
-------
public/data/season_projections.json (+ pipeline/data copy):
  {season_id, generated_at, games_played, total_simulations, model,
   teams: [{team, make_playoffs_pct, won_division_pct, won_conference_pct,
            won_cup_pct, avg_points, point_dist, div_rank_dist,
            round_exit_dist, r1_matchups}]}
public/data/season_projections_history.json: one snapshot per day
  {season_id, snapshots: [{date, generated_at, games_played,
   teams: {TRI: {make_playoffs_pct, avg_points, won_cup_pct}}}]}
"""
from __future__ import annotations

import csv
import datetime
import json
import math
import os
import shutil
import sys

import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from season import SEASON_ID, today_local  # noqa: E402

SIMULATIONS = 5000
SIGMA0 = 0.20
SIGMA_GP = 40
SEED = 20262027
# Regulation ties.  Independent Poisson scoring gives P(tied after 60) of
# about 0.16 at a 6.1-goal total, but 22.4% of regular-season games went to
# OT/SO in 2022-23..2025-26 (nhl_historical_gamestats.csv: 23.0/20.7/21.0/
# 24.8%; score effects make ties likelier than independence implies).  The
# tie probability is scaled by TIE_SCALE so the simulated loser-point rate,
# and with it every team's point total, matches the league (``--backtest``
# reports the mean signed points error with and without the scale).
TIE_SCALE = 1.38
DATA_DIR = os.path.join(SCRIPT_DIR, "data")
PUBLIC_DATA = os.path.join(SCRIPT_DIR, "..", "public", "data")
PROJECTIONS_FILE = os.path.join(PUBLIC_DATA, "season_projections.json")
HISTORY_FILE = os.path.join(PUBLIC_DATA, "season_projections_history.json")


# ── data loading ─────────────────────────────────────────────────────────────

def load_json(path):
    with open(path, "r") as f:
        return json.load(f)


def load_csv(path):
    with open(path, "r") as f:
        return list(csv.DictReader(f))


def build_team_map(teams_csv):
    """Tricode -> common name (the names the game model uses)."""
    return {row["Team Tricode"]: row["Common Name"] for row in teams_csv}


def parse_standings(data):
    out = {}
    for t in data.get("standings", []) or []:
        if str(t.get("seasonId")) != SEASON_ID:
            continue
        abbrev = t["teamAbbrev"]["default"]
        out[abbrev] = {
            "pts": t.get("points") or 0, "rw": t.get("regulationWins") or 0,
            "row": t.get("regulationPlusOtWins") or 0, "w": t.get("wins") or 0, "l": t.get("losses") or 0,
            "otl": t.get("otLosses") or 0, "gp": t.get("gamesPlayed") or 0,
            "conference": t.get("conferenceAbbrev"), "division": t.get("divisionAbbrev"),
        }
    return out


def fetch_current_standings(now=None):
    """This season's standings (today's NHL date), {TRI: {...}}.

    Raises when the API returns another season's table, so a stale '/now'
    response around opening night can't seed the simulation."""
    from http_utils import get_json
    print("Fetching current standings...")
    day = today_local(now).isoformat()
    out = parse_standings(get_json(f"https://api-web.nhle.com/v1/standings/{day}", ua="plain"))
    if len(out) < 32:
        out = parse_standings(get_json("https://api-web.nhle.com/v1/standings/now", ua="plain"))
    if len(out) < 32:
        raise RuntimeError(f"standings for {SEASON_ID} have {len(out)} teams")
    return out


def fetch_remaining_schedule(now=None):
    """Unplayed regular-season games of this season, [{id, date, home, away, gameState}]."""
    from http_utils import get_json
    today = today_local(now).isoformat()
    season_end, current, loops, games = None, today, 0, []
    print(f"Fetching remaining schedule from {today}...")
    while (season_end is None or current <= season_end) and loops < 40:
        try:
            data = get_json(f"https://api-web.nhle.com/v1/schedule/{current}", ua="plain")
        except Exception as e:
            print(f"  [WARN] schedule fetch failed for {current}: {e}")
            break
        season_end = season_end or data.get("regularSeasonEndDate")
        for week in data.get("gameWeek", []):
            for g in week.get("games", []):
                if g.get("gameType") != 2 or str(g.get("season", SEASON_ID)) != SEASON_ID:
                    continue
                if g.get("gameState") in ("OFF", "FINAL"):
                    continue
                games.append({"id": g["id"], "date": week["date"], "home": g["homeTeam"]["abbrev"],
                              "away": g["awayTeam"]["abbrev"], "gameState": g.get("gameState", "FUT")})
        nxt = data.get("nextStartDate")
        loops += 1
        if not nxt or nxt <= current:
            break
        current = nxt
    seen, unique = set(), []
    for g in sorted(games, key=lambda x: (x["date"], x["id"])):
        if g["id"] not in seen:
            seen.add(g["id"])
            unique.append(g)
    print(f"  {len(unique)} remaining games ({loops} API calls).")
    return unique


# ── game probabilities ───────────────────────────────────────────────────────

def get_game_prob(home_rating, away_rating):
    """Fallback ratings-ratio model: (p_home_reg, p_away_reg, p_ot, p_home_ot)."""
    h_xg = (home_rating["xgf_rating"] + away_rating["xga_rating"]) / 2 * 1.05
    a_xg = (away_rating["xgf_rating"] + home_rating["xga_rating"]) / 2
    raw = h_xg / (h_xg + a_xg) if (h_xg + a_xg) else 0.5
    return 0.77 * raw, 0.77 * (1 - raw), 0.23, raw


def split_outcomes(p_home, total, tie_scale=None):
    """(p_home_reg, p_away_reg, p_tie, p_home_ot) implied by P(home win) and
    the expected total, via goal_model (same Poisson model as the site), with
    the tie probability scaled by ``tie_scale`` (TIE_SCALE) to the league's
    real OT/SO rate.  P(home win) is unchanged by the scaling."""
    import goal_model
    tie_scale = TIE_SCALE if tie_scale is None else tie_scale
    lh, la = goal_model.goal_rates(p_home, total)
    ph, pt, pa, _ = goal_model.outcome_probs(lh, la)
    q = (p_home - ph) / pt if pt > 0 else 0.5
    q = min(max(q, 0.05), 0.95)
    # keep both regulation-win probabilities non-negative
    pt = min(pt * tie_scale, 0.95 * min(p_home / q, (1 - p_home) / (1 - q)))
    return p_home - pt * q, 1 - p_home - pt * (1 - q), pt, q


def rest_days_by_game(schedule):
    """{game_id: (home_rest, away_rest)} in days since the team's previous
    remaining game (None for its first one)."""
    last, out = {}, {}
    for g in sorted(schedule, key=lambda x: (x["date"], x["id"])):
        d = datetime.date.fromisoformat(g["date"])
        rest = []
        for t in (g["home"], g["away"]):
            rest.append((d - last[t]).days if t in last else None)
            last[t] = d
        out[g["id"]] = tuple(rest)
    return out


class Probabilities:
    """Game-level probabilities from the game model, with a ratings fallback."""

    def __init__(self, team_map, ml=None, ratings=None, tie_scale=None):
        self.team_map = team_map
        self.tie_scale = TIE_SCALE if tie_scale is None else tie_scale
        self.ml = ml
        self.ratings = ratings or {}
        self.cache = {}
        self.source = "game model (%s)" % getattr(ml, "model_version", "") if ml is not None else "ratings ratio"

    def game(self, home, away, date, h_rest=None, a_rest=None):
        key = (home, away, date, h_rest, a_rest)
        if key in self.cache:
            return self.cache[key]
        if self.ml is not None:
            d = self.ml.predict_detail(self.team_map.get(home, home), self.team_map.get(away, away), date,
                                       h_rest_days=h_rest, a_rest_days=a_rest)
            res = split_outcomes(float(d["home_win_prob"]), float(d["expected_total"]), self.tie_scale)
            res = (res[0], res[1], res[2], res[3], float(d["home_win_prob"]))
        else:
            dflt = {"xgf_rating": 3.0, "xga_rating": 3.0}
            ph, pa, pt, q = get_game_prob(self.ratings.get(self.team_map.get(home), dflt),
                                          self.ratings.get(self.team_map.get(away), dflt))
            res = (ph, pa, pt, q, ph + pt * q)
        self.cache[key] = res
        return res


# ── engine ───────────────────────────────────────────────────────────────────

OUTCOMES = ("home_reg_win", "home_otw", "away_otw", "away_reg_win")


class Engine:
    """Vectorised season simulation with common random numbers."""

    def __init__(self, standings, schedule, probs, n_sims=SIMULATIONS, seed=SEED, sigma0=None,
                 playoff_date=None):
        if sigma0 is None:      # the probabilities' own strength sigma (the calibrated simulator), else SIGMA0
            sigma0 = getattr(probs, "sigma0", None)
            sigma0 = SIGMA0 if sigma0 is None else float(sigma0)
        self.sigma0 = sigma0
        self.standings = standings
        self.teams = sorted(standings)
        self.idx = {t: i for i, t in enumerate(self.teams)}
        self.schedule = [g for g in schedule if g["home"] in self.idx and g["away"] in self.idx]
        self.probs = probs
        self.n = n_sims
        rng = np.random.default_rng(seed)
        T, G = len(self.teams), len(self.schedule)
        gp = np.array([standings[t]["gp"] for t in self.teams], dtype=float)
        sigma = sigma0 * np.sqrt(SIGMA_GP / (SIGMA_GP + gp))
        self.offset = rng.standard_normal((n_sims, T)) * sigma          # per-sim team strength
        self.u1 = rng.random((n_sims, G))
        self.u2 = rng.random((n_sims, G))
        self.u_playoff = rng.random((n_sims, 15, 7))
        rest = rest_days_by_game(self.schedule)
        self.h = np.array([self.idx[g["home"]] for g in self.schedule], dtype=int)
        self.a = np.array([self.idx[g["away"]] for g in self.schedule], dtype=int)
        cols = [probs.game(g["home"], g["away"], g["date"], *rest[g["id"]]) for g in self.schedule]
        arr = np.array(cols, dtype=float).reshape(G, 5) if G else np.zeros((0, 5))
        self.p_tie, self.q, self.p = arr[:, 2], arr[:, 3], arr[:, 4]
        self.game_pos = {str(g["id"]): j for j, g in enumerate(self.schedule)}
        self.playoff_date = playoff_date or (self.schedule[-1]["date"] if self.schedule else today_local().isoformat())
        self.base = {k: np.array([standings[t][k] for t in self.teams], dtype=float)
                     for k in ("pts", "rw", "row", "w")}

    # regular season -------------------------------------------------------
    def season(self, forced=None):
        """(pts, rw, row, w) arrays [n_sims, teams]; ``forced`` = (game_id, outcome)."""
        pts = np.tile(self.base["pts"], (self.n, 1))
        rw = np.tile(self.base["rw"], (self.n, 1))
        row = np.tile(self.base["row"], (self.n, 1))
        w = np.tile(self.base["w"], (self.n, 1))
        fj = self.game_pos.get(str(forced[0])) if forced else None
        sims = np.arange(self.n)
        for j in range(len(self.schedule)):
            h, a = self.h[j], self.a[j]
            z = math.log(self.p[j] / (1 - self.p[j])) + self.offset[:, h] - self.offset[:, a]
            p = 1 / (1 + np.exp(-z))
            q = np.clip(self.q[j] + 0.5 * (p - self.p[j]), 0.05, 0.95)
            p_hr = np.clip(p - self.p_tie[j] * q, 0, 1)
            p_ar = np.clip(1 - p - self.p_tie[j] * (1 - q), 0, 1)
            if fj == j:
                o = OUTCOMES.index(forced[1])
                home_reg = np.full(self.n, o == 0)
                away_reg = np.full(self.n, o == 3)
                ot = ~(home_reg | away_reg)
                home_ot = np.full(self.n, o == 1)
            else:
                u = self.u1[:, j]
                home_reg = u < p_hr
                away_reg = (~home_reg) & (u < p_hr + p_ar)
                ot = ~(home_reg | away_reg)
                home_ot = ot & (self.u2[:, j] < q)
            away_ot = ot & ~home_ot
            hw, aw = home_reg | home_ot, away_reg | away_ot
            pts[sims, h] += 2 * hw + away_ot
            pts[sims, a] += 2 * aw + home_ot
            rw[sims, h] += home_reg
            rw[sims, a] += away_reg
            row[sims, h] += hw
            row[sims, a] += aw
            w[sims, h] += hw
            w[sims, a] += aw
        return pts, rw, row, w

    # standings / bracket --------------------------------------------------
    def _order(self, members, s, key):
        return sorted(members, key=lambda i: key[i], reverse=True)

    def standings_of(self, s, pts, rw, row, w):
        key = {i: (pts[s, i], rw[s, i], row[s, i], w[s, i]) for i in range(len(self.teams))}
        divs, confs = {}, {}
        for t, i in self.idx.items():
            st = self.standings[t]
            divs.setdefault(st["division"], []).append(i)
            confs.setdefault(st["conference"], []).append(i)
        divs = {d: self._order(m, s, key) for d, m in divs.items()}
        confs = {c: self._order(m, s, key) for c, m in confs.items()}
        return divs, confs, key

    def playoff_field(self, divs, confs, key):
        """{conf: [(div_leader_bracket), ...]} -> list of 8 first-round pairs
        (higher seed first) plus the set of playoff teams."""
        pairs, field = [], set()
        for conf, members in confs.items():
            cdivs = [d for d, m in divs.items() if self.standings[self.teams[m[0]]]["conference"] == conf]
            top3 = {d: divs[d][:3] for d in cdivs}
            taken = {i for d in cdivs for i in top3[d]}
            wc = [i for i in members if i not in taken][:2]
            field |= taken | set(wc)
            leaders = sorted(cdivs, key=lambda d: key[top3[d][0]], reverse=True)
            for rank, d in enumerate(leaders):
                opp = wc[1] if rank == 0 else wc[0]
                pairs.append(((top3[d][0], opp), (top3[d][1], top3[d][2])))
        return pairs, field

    def series(self, s, hi, lo, key, slot):
        """Best-of-7; the team with more points hosts games 1, 2, 5 and 7."""
        home, away = (hi, lo) if key[hi] >= key[lo] else (lo, hi)
        th, ta = self.teams[home], self.teams[away]
        base = self.probs.game(th, ta, self.playoff_date)[4]
        z = math.log(base / (1 - base)) + self.offset[s, home] - self.offset[s, away]
        p_home_host = 1 / (1 + math.exp(-z))
        base_r = self.probs.game(ta, th, self.playoff_date)[4]
        zr = math.log(base_r / (1 - base_r)) + self.offset[s, away] - self.offset[s, home]
        p_away_host = 1 / (1 + math.exp(-zr))
        wins = [0, 0]
        for gnum in range(7):
            host_is_home = gnum in (0, 1, 4, 6)
            p_home_wins = p_home_host if host_is_home else 1 - p_away_host
            if self.u_playoff[s, slot, gnum] < p_home_wins:
                wins[0] += 1
            else:
                wins[1] += 1
            if max(wins) == 4:
                break
        return (home, away) if wins[0] == 4 else (away, home)

    def run(self, forced=None, playoffs=True):
        pts, rw, row, w = self.season(forced)
        T = len(self.teams)
        res = {
            "made": np.zeros(T), "div": np.zeros(T), "conf": np.zeros(T), "cup": np.zeros(T),
            "pts": pts.sum(axis=0), "point_dist": [dict() for _ in range(T)],
            "div_rank": [dict() for _ in range(T)],
            "exit": [{"MISS": 0, "R1": 0, "R2": 0, "CF": 0, "F": 0, "CUP": 0} for _ in range(T)],
            "r1": [dict() for _ in range(T)],
        }
        for s in range(self.n):
            divs, confs, key = self.standings_of(s, pts, rw, row, w)
            for d, members in divs.items():
                res["div"][members[0]] += 1
                for r, i in enumerate(members):
                    res["div_rank"][i][r + 1] = res["div_rank"][i].get(r + 1, 0) + 1
            for i in range(T):
                p = int(pts[s, i])
                res["point_dist"][i][p] = res["point_dist"][i].get(p, 0) + 1
            pairs, field = self.playoff_field(divs, confs, key)
            for i in field:
                res["made"][i] += 1
            for i in range(T):
                if i not in field:
                    res["exit"][i]["MISS"] += 1
            if not playoffs:
                continue
            slot = 0
            finalists = []
            for c in range(2):
                semis = []
                for (a1, b1), (a2, b2) in pairs[2 * c:2 * c + 2]:
                    for x, y in ((a1, b1), (a2, b2)):
                        ta, tb = self.teams[x], self.teams[y]
                        res["r1"][x][tb] = res["r1"][x].get(tb, 0) + 1
                        res["r1"][y][ta] = res["r1"][y].get(ta, 0) + 1
                    w1, l1 = self.series(s, a1, b1, key, slot)
                    w2, l2 = self.series(s, a2, b2, key, slot + 1)
                    slot += 2
                    res["exit"][l1]["R1"] += 1
                    res["exit"][l2]["R1"] += 1
                    wd, ld = self.series(s, w1, w2, key, slot)
                    slot += 1
                    res["exit"][ld]["R2"] += 1
                    semis.append(wd)
                wc_, lc = self.series(s, semis[0], semis[1], key, slot)
                slot += 1
                res["exit"][lc]["CF"] += 1
                res["conf"][wc_] += 1
                finalists.append(wc_)
            champ, runner = self.series(s, finalists[0], finalists[1], key, 14)
            res["cup"][champ] += 1
            res["exit"][champ]["CUP"] += 1
            res["exit"][runner]["F"] += 1
        return res

    def playoff_pct(self, forced=None):
        """{TRI: (playoff %, avg points)} without simulating the playoffs."""
        r = self.run(forced, playoffs=False)
        return {t: (round(100 * r["made"][i] / self.n, 1), round(float(r["pts"][i]) / self.n, 1))
                for i, t in enumerate(self.teams)}


# ── entry points ─────────────────────────────────────────────────────────────

def make_probabilities(team_map, schedule=None):
    """The per-game probabilities of the remaining ``schedule``: the game simulator's
    (bu/sim/season.py) when the pre-registered season_sim decision or PONYXG_SEASON_SIM says
    'sim', else (and per game when the simulator cannot run it) the logit game model."""
    logit = None
    try:
        from ml_predict import MLPredictor
        from season import read_season_csv
        ml = MLPredictor(read_season_csv("gamestats"))
        if ml.available:
            logit = Probabilities(team_map, ml=ml)
    except Exception as e:
        print(f"[WARN] game model unavailable for the simulation ({e}); using ratings")
    if logit is None:
        from paths import TEAM_RATINGS_FILE
        logit = Probabilities(team_map, ratings=load_json(TEAM_RATINGS_FILE))
    if schedule is not None:
        try:
            from bu.sim import season as SEASIM
            if SEASIM.mode() == "sim":
                sp = SEASIM.live_probabilities(schedule, fallback=logit)
                if sp is not None:
                    return sp
                print("[WARN] game simulator unavailable for the season projections; using the logit")
        except Exception as e:      # never break the projections
            print(f"[WARN] season simulator path failed ({type(e).__name__}: {e}); using the logit")
    return logit


def summarize(engine, res, now_iso):
    n = engine.n
    teams = []
    for i, t in enumerate(engine.teams):
        teams.append({
            "team": t,
            "make_playoffs_pct": round(100 * res["made"][i] / n, 1),
            "won_division_pct": round(100 * res["div"][i] / n, 1),
            "won_conference_pct": round(100 * res["conf"][i] / n, 1),
            "won_cup_pct": round(100 * res["cup"][i] / n, 1),
            "avg_points": round(float(res["pts"][i]) / n, 1),
            "point_dist": {str(k): v for k, v in sorted(res["point_dist"][i].items())},
            "div_rank_dist": {str(k): v for k, v in sorted(res["div_rank"][i].items())},
            "round_exit_dist": res["exit"][i],
            "r1_matchups": dict(sorted(res["r1"][i].items(), key=lambda kv: -kv[1])),
        })
    teams.sort(key=lambda x: (-x["make_playoffs_pct"], -x["avg_points"], x["team"]))
    gp = int(sum(engine.standings[t]["gp"] for t in engine.teams) // 2)
    return {
        "season_id": SEASON_ID,
        "generated_at": now_iso,
        "games_played": gp,
        "remaining_games": len(engine.schedule),
        "total_simulations": n,
        "model": {"probabilities": engine.probs.source, "strength_sigma0_logit": engine.sigma0,
                  "strength_sigma_gp_half": SIGMA_GP, "seed": SEED,
                  "engine": "sim" if hasattr(engine.probs, "table") else "logit",
                  **({"sim_games": len(engine.probs.table), "sim_runs_per_game": (engine.probs.meta or {}).get("n_runs"),
                      "logit_fallback_games": int(getattr(engine.probs, "n_fallback", 0)),
                      "calibration": (engine.probs.meta or {}).get("calibration")}
                     if hasattr(engine.probs, "table") else {})},
        "teams": teams,
    }


def append_history(out, path=HISTORY_FILE, date=None):
    """Keep one snapshot per NHL date (the latest run wins)."""
    date = date or today_local().isoformat()
    try:
        hist = load_json(path)
        if str(hist.get("season_id")) != SEASON_ID:
            hist = None
    except (OSError, ValueError):
        hist = None
    hist = hist or {"season_id": SEASON_ID, "snapshots": []}
    snap = {"date": date, "generated_at": out["generated_at"], "games_played": out["games_played"],
            "teams": {t["team"]: {"make_playoffs_pct": t["make_playoffs_pct"], "avg_points": t["avg_points"],
                                  "won_cup_pct": t["won_cup_pct"]} for t in out["teams"]}}
    hist["snapshots"] = [s for s in hist["snapshots"] if s.get("date") != date] + [snap]
    hist["snapshots"].sort(key=lambda s: s["date"])
    _write_json(path, hist, indent=1)
    return hist


def _write_json(path, data, indent=2):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=indent)
    os.replace(tmp, path)


def full_simulation_loop(n_sims=SIMULATIONS, now=None, standings=None, schedule=None, probs=None):
    from io_utils import utc_now_iso
    teams_csv = load_csv(os.path.join(SCRIPT_DIR, "nhl_teams.csv"))
    team_map = build_team_map(teams_csv)
    standings = standings or fetch_current_standings(now)
    schedule = fetch_remaining_schedule(now) if schedule is None else schedule
    probs = probs or make_probabilities(team_map, schedule)
    print(f"Simulating {n_sims} seasons ({len(schedule)} remaining games, {probs.source})...")
    engine = Engine(standings, schedule, probs, n_sims=n_sims)
    res = engine.run()
    out = summarize(engine, res, utc_now_iso())
    os.makedirs(DATA_DIR, exist_ok=True)
    local = os.path.join(DATA_DIR, "season_projections.json")
    _write_json(local, out, indent=1)
    shutil.copyfile(local, PROJECTIONS_FILE + ".tmp")
    os.replace(PROJECTIONS_FILE + ".tmp", PROJECTIONS_FILE)
    append_history(out)
    top = ", ".join(f"{t['team']} {t['make_playoffs_pct']}%" for t in out["teams"][:5])
    print(f"Simulation complete ({out['games_played']} GP played). Top playoff odds: {top}")
    return {"status": "ok", "rows_written": len(out["teams"])}


def backtest(seasons=(2023, 2025), sigmas=(0.0, 0.1, 0.2, 0.3), n_sims=1000, tie_scales=(1.0, TIE_SCALE),
             out_path=os.path.join(SCRIPT_DIR, "tests", "out", "season_sim_backtest.json")):
    """Preseason projection check for the strength-uncertainty sigma.

    For each season, the game model's state is built from games BEFORE
    opening night only, every regular-season game of that season is
    simulated from 0-0-0, and the projection is scored against the final
    table: Brier / log loss of 'makes the playoffs' (NHL clinch flags) and
    the share of teams whose final points fall inside the 80% interval,
    the mean absolute and mean signed (bias) points error.  The sigma sweep
    uses TIE_SCALE; ``tie_scales`` are compared at SIGMA0.
    (Seasons with an incomplete archive, e.g. 2024-25 without October, are
    skipped; the game model's coefficients saw these seasons, so this tests
    the simulation layer, not the model.)"""
    import features as F
    from http_utils import get_json
    from ml_predict import MLPredictor
    games, _ = F.load_feature_games(SCRIPT_DIR)
    report = {"method": backtest.__doc__.strip().split("\n")[0], "n_sims": n_sims, "seasons": {}, "sigmas": {}}
    runs = [(s, TIE_SCALE) for s in sigmas] + [(SIGMA0, t) for t in tie_scales if t != TIE_SCALE]
    per_run = {r: {"brier": [], "ll": [], "cover80": [], "mae_pts": [], "bias_pts": []} for r in runs}
    for y in seasons:
        g = games[(games["season"] == y) & (games["game_id"].astype(str).str[4:6] == "02")]
        start = g["game_date"].min()
        ml = MLPredictor(games=games[games["game_date"] < start])
        home = g[g["home_away"] == "Home"].sort_values(["game_date", "game_id"])
        sched = [{"id": int(r.game_id), "date": r.game_date.strftime("%Y-%m-%d"), "home": r.team,
                  "away": r.opponent} for r in home.itertuples()]
        end = g["game_date"].max().strftime("%Y-%m-%d")
        table = get_json(f"https://api-web.nhle.com/v1/standings/{end}", ua="plain")["standings"]
        info = {t["teamCommonName"]["default"]: t for t in table}
        teams = sorted(set(home["team"]) | set(home["opponent"]))
        missing = [t for t in teams if t not in info]
        if missing:
            raise RuntimeError(f"{y}: no standings for {missing}")
        standings = {t: {"pts": 0, "rw": 0, "row": 0, "w": 0, "l": 0, "otl": 0, "gp": 0,
                         "conference": info[t]["conferenceAbbrev"], "division": info[t]["divisionAbbrev"]}
                     for t in teams}
        made = {t: 0 if info[t].get("clinchIndicator") in (None, "e") else 1 for t in teams}
        pts = {t: info[t]["points"] for t in teams}
        report["seasons"][str(y)] = {"games": len(sched), "playoff_teams": sum(made.values())}
        probs_by_tie = {t: Probabilities({tm: tm for tm in teams}, ml=ml, tie_scale=t) for t in {r[1] for r in runs}}
        for s, ts in runs:
            eng = Engine(standings, sched, probs_by_tie[ts], n_sims=n_sims, sigma0=s, seed=SEED + y)
            r = eng.run(playoffs=False)
            for i, t in enumerate(eng.teams):
                p = min(max(r["made"][i] / n_sims, 1e-3), 1 - 1e-3)
                m = per_run[(s, ts)]
                m["brier"].append((p - made[t]) ** 2)
                m["ll"].append(-math.log(p if made[t] else 1 - p))
                dist = sorted(int(k) for k, c in r["point_dist"][i].items() for _ in range(c))
                lo, hi = dist[int(0.1 * len(dist))], dist[int(0.9 * len(dist)) - 1]
                m["cover80"].append(1.0 if lo <= pts[t] <= hi else 0.0)
                m["mae_pts"].append(abs(float(r["pts"][i]) / n_sims - pts[t]))
                m["bias_pts"].append(float(r["pts"][i]) / n_sims - pts[t])
    report["tie_scale"] = TIE_SCALE
    report["tie_scales"] = {}
    for (s, ts), m in per_run.items():
        row = {k: round(float(np.mean(v)), 4) for k, v in m.items()}
        row["n_team_seasons"] = len(m["brier"])
        if ts == TIE_SCALE:
            report["sigmas"][f"{s:.2f}"] = row
        if s == SIGMA0:
            report["tie_scales"][f"{ts:.2f}"] = row
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    _write_json(out_path, report)
    print(json.dumps({"sigmas": report["sigmas"], "tie_scales": report["tie_scales"]}, indent=1))
    return report


if __name__ == "__main__":
    if "--backtest" in sys.argv:
        backtest()
    else:
        full_simulation_loop()
