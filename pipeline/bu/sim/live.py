"""predict_games integration: one simulated game per pregame row, every market we price.

``SimServer.load()`` reads the fitted parameters (``out/sim_params.json``), the season-start
team / goalie state pack (``out/sim_state_<season>.json.gz``) and rolls it forward through this
season's games from the pipeline's own CSVs (``nhl_season_<y>_<y+1>_gamestats.csv`` + the shots
file's ``xg_raw``), so the hourly run needs no lake.  ``SimServer.game(...)`` then

  1. builds the game's inputs (point-in-time team state, the expected starters' goalie state,
     tonight's RAPM lineup term + FIN from the serving bundle via ``LiveLineupTerm``, rest),
  2. simulates it ``N_SIMS`` times (seed = hash of the NHL game id: the same game gives the same
     numbers whatever else is on the slate),
  3. anchors it (variant chosen on the dev seasons, ``params['anchor']``) to the published win %
     and expected total, keeping the raw simulator's win % as a shadow,
  4. prices every market in ``odds.json``: probabilities, fair odds, EV with pushes.

Fallback (``sim_status = poisson_fallback``): when the lineup term is unavailable for the game
(``bu_ok`` False: stale bundle, coverage gate), the state pack or the parameters are missing, or
an input is not finite, the markets come from ``goal_model``'s independent Poisson anchored to
the same published win % and total.  Nothing is zero-filled.
"""
from __future__ import annotations

import json
import math
import os

import numpy as np
import pandas as pd

from . import anchor as AN
from . import engine as EN
from . import markets as MK
from . import rates as RT
from .params import load_params, state_pack_path
from .state import SimState, rows_from_season_csvs

PIPELINE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
N_SIMS = 20000
BASE_SEED = 20261002
BREAKDOWN_N = 3000          # runs per counterfactual of the 'why this pick' breakdown
# 'Why this pick' for a simulated win %: the simulator's coefficient groups, switched on one at a
# time (common random numbers: same seed) from a neutral game (league-average teams, no home ice);
# each group's term is the change in logit P(home win).  Computed in this order (the last,
# 5v5 strength, also absorbs the 3,000- vs 20,000-run Monte Carlo gap so the terms add up exactly
# to the published model logit), displayed in the game model's factor order.
BREAKDOWN_GROUPS = [
    ("home_ice", "Home ice", [("ev", "home"), ("conv", "home"), ("pp", "home"), ("pen", "home")]),
    ("rest", "Rest", [("ev", "b2b"), ("ev", "b2b_opp")]),
    ("goaltending", "Goaltending", [("conv", "gsv")]),
    ("special_teams", "Special teams & penalties", [("pp", "st_pp"), ("pp", "st_pk"), ("pen", "st_take"),
                                                    ("pen", "st_draw"), ("pp", "lu_ppo"), ("pp", "lu_pkd"),
                                                    ("pen", "lu_take"), ("pen", "lu_draw")]),
    ("strength_5v5", "5v5 strength (lineup, team, finishing)",
     [("ev", "bu_rel"), ("ev", "st_off"), ("ev", "st_def"), ("conv", "fin_rel"), ("conv", "st_fin")]),
]
DISPLAY_ORDER = ["home_ice", "strength_5v5", "special_teams", "goaltending", "rest"]
GATE_REASON = ("INFO ONLY: derivative-market prices await the live closing-line test "
               "(bu/sim/prereg.json live_test)")

# predictions_detailed.csv columns (CONTRACT.md "Game simulator"); all frozen at puck drop
COLUMNS = [
    "sim_status", "sim_version", "sim_variant", "sim_n", "sim_home_win_pct", "sim_expected_total",
    "home_reg_pct", "reg_tie_pct", "away_reg_pct", "home_reg_fair", "reg_tie_fair", "away_reg_fair",
    "home_reg_ev", "reg_tie_ev", "away_reg_ev",
    "sim_pl_spread", "home_pl_pct", "away_pl_pct", "home_pl_fair", "away_pl_fair", "home_pl_ev", "away_pl_ev",
    "sim_total_line", "over_pct", "total_push_pct", "under_pct", "over_fair", "under_fair", "over_ev", "under_ev",
    "home_1p_pct", "p1_tie_pct", "away_1p_pct", "home_1p_fair", "p1_tie_fair", "away_1p_fair",
    "home_1p3_ev", "p1_tie_ev", "away_1p3_ev",
    "home_1p_2w_pct", "away_1p_2w_pct", "home_1p_2w_fair", "away_1p_2w_fair", "home_1p_ev", "away_1p_ev",
    "home_1p_three_way", "away_1p_three_way", "p1_three_way_tie",
    "sim_ev_gated", "sim_gate_reason", "sim_detail",
]


def _pct_triple(ps):
    """Percentages (1 decimal) of mutually exclusive outcomes, summing to exactly 100.0."""
    raw = [max(float(p), 0.0) for p in ps]
    s = sum(raw) or 1.0
    vals = [100.0 * x / s for x in raw]
    floors = [math.floor(v * 10) for v in vals]
    diff = 1000 - sum(floors)
    order = sorted(range(len(vals)), key=lambda i: vals[i] * 10 - floors[i], reverse=True)
    for i in order[:max(diff, 0)]:
        floors[i] += 1
    return [f / 10 for f in floors]


def _r4(x):
    return None if x is None or not np.isfinite(x) else round(float(x), 4)


def price(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return int(x) if abs(x) >= 100 else None


def spread_of(v, default):
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return default


def line_of(v):
    try:
        x = float(str(v).strip())
        return x if 3.0 <= x <= 12.0 else None
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------------------------ distributions

class Dist:
    """What the market pricer needs from a simulated (or Poisson) game: the joint law of the final
    total and margin is summarised by the two marginal histograms plus the direct probabilities."""

    def __init__(self, summary: dict, source: str):
        self.s = summary
        self.source = source

    def cover(self, spread: float, side: str):
        """(win, push, lose) of ``side`` at ``spread`` (e.g. home -1.5) on the final margin."""
        mh = np.asarray(self.s["margin_hist"], float)          # margins -7..7 (clipped)
        m = np.arange(-7, 8)
        if side == "away":
            m = -m
        v = m + spread
        return float(mh[v > 0].sum()), float(mh[v == 0].sum()), float(mh[v < 0].sum())

    def total(self, line: float):
        th = np.asarray(self.s["total_hist"], float)            # totals 0..15 (15 = 15+)
        t = np.arange(16)
        return float(th[t > line].sum()), float(th[t == line].sum()), float(th[t < line].sum())


def poisson_dist(p_home: float, total: float) -> Dist:
    from .validate import naive_summary
    s = naive_summary(float(p_home), float(total))
    s.setdefault("p_ot", float("nan"))
    s.setdefault("p_so", float("nan"))
    s.setdefault("exp_en", float("nan"))
    return Dist(s, "poisson_fallback")


# ------------------------------------------------------------------------------ server

class SimRun:
    """One game simulated at its own (raw) rates: what the win-% engine, the breakdown and the
    market pricer share, so the game is simulated once per run."""

    def __init__(self, game_id, row: dict, rates, outcomes, seed: int):
        self.game_id, self.row, self.R, self.o, self.seed = game_id, row, rates, outcomes, seed
        self.raw = MK.summarize(outcomes)

    @property
    def p_home(self) -> float:
        return float(self.raw["p_home"])

    @property
    def total(self) -> float:
        return float(self.raw["exp_total"])


class SimServer:
    def __init__(self, params: dict, state: SimState | None, team_ids: dict, n: int = N_SIMS):
        self.params = params
        self.state = state
        self.team_ids = team_ids                  # tricode -> NHL team id
        self.n = int(n)
        self.S = EN.Structure(params["structural"], params.get("dispersion")) if params else None
        self.variant = ((params or {}).get("anchor") or {}).get("variant", "anchored")
        self.version = (params or {}).get("version", "sim-m5")
        self.error = None

    @classmethod
    def load(cls, season: str, pipeline_dir: str = PIPELINE_DIR, n: int = N_SIMS, gamestats=None,
             shots=None, verbose=True) -> "SimServer":
        teams = pd.read_csv(os.path.join(pipeline_dir, "nhl_teams.csv"))
        tri = {str(t): int(i) for t, i in zip(teams["Team Tricode"], teams["NHL Team ID"])}
        names = {str(c): int(i) for c, i in zip(teams["Common Name"], teams["NHL Team ID"])}
        try:
            params = load_params()
        except Exception as e:
            srv = cls({}, None, tri, n)
            srv.error = f"params unavailable: {e}"
            return srv
        state = None
        err = None
        try:
            state = SimState.load(state_pack_path(season))
        except Exception as e:
            err = f"state pack unavailable: {e}"
        srv = cls(params, state, tri, n)
        srv.error = err
        if state is not None:
            try:
                from season import season_file
                if gamestats is None:
                    p = os.path.join(pipeline_dir, season_file("gamestats", int(season[:4])))
                    gamestats = pd.read_csv(p) if os.path.exists(p) else None
                if shots is None:
                    p = os.path.join(pipeline_dir, season_file("shots", int(season[:4])))
                    shots = pd.read_csv(p) if os.path.exists(p) else None
                from .fit import se_dict
                rows = rows_from_season_csvs(gamestats, shots, names, se_dict(params["structural"]["score_effects"]),
                                             season)
                if len(rows):
                    state.roll(season)
                    for _, day in rows.groupby("game_date", sort=True):
                        state.add_rows(day)
                if verbose:
                    print(f"[sim] state pack {state.max_date.date() if state.max_date is not None else '-'} "
                          f"+ {len(rows) // 2} games of {season} from the season CSVs")
            except Exception as e:
                srv.error = f"season update failed: {e}"
                print(f"[sim] WARNING: {srv.error}; state pack only")
        return srv

    def lineup_term(self, loaded: dict | None = None):
        """The ``LiveLineupTerm`` of the parameters' lineup source (``lineup_source.py``), reusing
        an already loaded one ({abs path: term}, e.g. the game model's) when it is the same bundle."""
        if not hasattr(self, "_term"):
            from . import lineup_source as LS
            self._term = LS.live_term(LS.spec(self.params), loaded) if self.params else None
        return self._term

    @property
    def available(self) -> bool:
        return bool(self.params) and self.state is not None and self.S is not None

    # ---------------------------------------------------------------- inputs
    def inputs_row(self, home_tri, away_tri, h_goalie, a_goalie, bf, h_rest, a_rest, game_type=2) -> dict:
        st = self.state
        row = {"game_type": int(game_type)}
        for q in ("ev_goals", "ev_xg", "pp_goals", "pp_xg", "pen", "fin", "gsv"):
            row[f"lg_{q}"] = st.league_rate(q)
        for side, tri, gk, rest in (("h", home_tri, h_goalie, h_rest), ("a", away_tri, a_goalie, a_rest)):
            tid = self.team_ids.get(tri)
            for q in ("ev_off", "ev_def", "pp", "pk", "take", "draw", "fin"):
                row[f"{side}_t_{q}"] = st.team_rel(tid, q) if tid is not None else float("nan")
            row[f"{side}_g_gsv"] = st.goalie_rel(gk)[0] if gk else 1.0
            row[f"{side}_rest"] = rest
        ok = bool(bf and bf.get("bu_ok") and bf.get("home") and bf.get("away"))
        row["bu_ok"] = ok
        if ok:
            cov = getattr(self, "_cov", None)
            row["c_intercept"] = float(bf.get("c_intercept") or (cov or {}).get("intercept") or float("nan"))
            for side, key in (("h", "home"), ("a", "away")):
                s = bf[key]
                row[f"bu_{side}_off"] = float(s.get("off"))
                row[f"bu_{side}_def"] = float(s.get("def"))
                row[f"bu_{side}_fin"] = float(s["fin"]) if s.get("fin") is not None else float("nan")
            # player special teams / penalties (prereg_st.json): read only by parameters fitted with them
            sth, sta = (bf["home"] or {}).get("st"), (bf["away"] or {}).get("st")
            row["st_ok"] = bool(sth and sta)
            if row["st_ok"]:
                for side, s in (("h", sth), ("a", sta)):
                    for f in ("ppo", "pkd", "take", "draw"):
                        row[f"st_{side}_{f}"] = float(s[f])
        return row

    # ---------------------------------------------------------------- one game
    def run(self, game_id, home_tri, away_tri, *, h_goalie=None, a_goalie=None, bf=None, h_rest=None,
            a_rest=None, game_type=2):
        """(SimRun, None) for a game the simulator can run, else (None, why).  Never raises."""
        try:
            if not self.available:
                return None, self.error or "simulator unavailable"
            if not (bf and bf.get("bu_ok")):
                return None, f"lineup term unavailable ({(bf or {}).get('reason') or 'no bundle'})"
            row = self.inputs_row(home_tri, away_tri, h_goalie, a_goalie, bf, h_rest, a_rest, game_type)
            g = pd.DataFrame([row])
            fin_ok = np.isfinite(row.get("bu_h_fin", np.nan)) and np.isfinite(row.get("bu_a_fin", np.nan))
            if not RT.finite_inputs(g)[0] or not np.isfinite(row.get("c_intercept", np.nan)) or not fin_ok:
                return None, "non-finite simulator inputs"
            R = RT.build_rates(g, self.params)
            seed = EN.game_seed(BASE_SEED, int(game_id))
            return SimRun(game_id, row, R, EN.simulate_game(R, 0, self.S, self.n, seed), seed), None
        except Exception as e:      # never break the prediction run
            return None, f"error: {type(e).__name__}: {e}"

    def _group_params(self):
        """Parameter sets of the breakdown: neutral, then each BREAKDOWN_GROUPS group switched on."""
        if getattr(self, "_gp", None) is None:
            zero = json.loads(json.dumps(self.params))
            for _, _, terms in BREAKDOWN_GROUPS:
                for grp, c in terms:
                    zero["glm"]["beta"][grp][c] = 0.0
            steps = [json.loads(json.dumps(zero))]
            cur = zero
            for _, _, terms in BREAKDOWN_GROUPS:
                cur = json.loads(json.dumps(cur))
                for grp, c in terms:
                    cur["glm"]["beta"][grp][c] = self.params["glm"]["beta"][grp].get(c, 0.0)
                steps.append(cur)
            self._gp = steps
        return self._gp

    def breakdown(self, run: SimRun, p_model: float | None = None, n: int = BREAKDOWN_N) -> list:
        """[(factor, label, logit delta)] in DISPLAY_ORDER whose sum is logit(p_model) (default
        the run's own win %): each group's change in logit P(home win) when it is switched on,
        from a neutral game, re-simulated with the same seed."""
        g = pd.DataFrame([run.row])
        ps = []
        steps = self._group_params()
        for k, prm in enumerate(steps[:-1]):
            R = RT.build_rates(g, prm)
            ps.append(MK.summarize(EN.simulate_game(R, 0, self.S, n, run.seed))["p_home"])
        p_full = run.p_home if p_model is None else float(p_model)
        z = [RT.logit(min(max(p, 1e-4), 1 - 1e-4)) for p in ps + [p_full]]
        delta = {name: z[k + 1] - z[k] for k, (name, _, _) in enumerate(BREAKDOWN_GROUPS)}
        delta["home_ice"] += z[0]                 # the neutral game's own edge (shootout home rate)
        label = {name: lab for name, lab, _ in BREAKDOWN_GROUPS}
        return [(f, label[f], float(delta[f])) for f in DISPLAY_ORDER]

    def game(self, game_id, home_tri, away_tri, p_pub: float, total_pub: float, *, h_goalie=None, a_goalie=None,
             bf=None, h_rest=None, a_rest=None, game_type=2, odds=None, home_name=None, away_name=None,
             run: SimRun | None = None, why: str | None = None) -> dict:
        """All COLUMNS for one pregame row.  ``p_pub`` / ``total_pub``: the published (blended)
        home win probability and expected total; ``odds``: the game's odds.json entry.  ``run`` /
        ``why``: an already simulated game (or the reason it could not be), from ``run()``."""
        dist, info, raw_p, raw_total = None, {}, None, None
        if run is None and why is None:
            run, why = self.run(game_id, home_tri, away_tri, h_goalie=h_goalie, a_goalie=a_goalie, bf=bf,
                                h_rest=h_rest, a_rest=a_rest, game_type=game_type)
        try:
            if run is not None:
                raw_p, raw_total = run.p_home, run.total
                if self.variant == "anchored" and p_pub is not None and total_pub is not None:
                    o2, w, ainfo = AN.anchor_game(run.R, 0, self.S, self.n, run.seed, float(p_pub), float(total_pub),
                                                  o=run.o)
                    dist = Dist(MK.summarize(o2, w=w), "sim")
                    info = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in ainfo.items()}
                else:
                    dist = Dist(run.raw, "sim")
        except Exception as e:      # never break the prediction run
            why = f"error: {type(e).__name__}: {e}"
            dist = None
        if dist is None:
            if p_pub is None or total_pub is None:
                return {c: None for c in COLUMNS}
            dist = poisson_dist(p_pub, total_pub)
            print(f"  [sim] {away_tri}@{home_tri}: Poisson fallback ({why})")
        out = self.price(dist, odds or {}, home_name, away_name)
        out.update({
            "sim_status": dist.source, "sim_version": self.version,
            "sim_variant": (self.variant if dist.source == "sim" else "poisson"),
            "sim_n": self.n if dist.source == "sim" else None,
            "sim_home_win_pct": round(100 * raw_p, 1) if raw_p is not None else None,
            "sim_expected_total": round(raw_total, 2) if raw_total is not None else None,
        })
        s = dist.s
        detail = {"exp_home": _r4(s.get("exp_home")), "exp_away": _r4(s.get("exp_away")),
                  "exp_total": _r4(s.get("exp_total")), "p_ot": _r4(s.get("p_ot")), "p_so": _r4(s.get("p_so")),
                  "exp_en": _r4(s.get("exp_en")), "exp_p1_total": _r4(s.get("exp_p1_total")),
                  "total_hist": [round(float(x), 4) for x in s["total_hist"]],
                  "margin_hist": [round(float(x), 4) for x in s["margin_hist"]],
                  "anchor": info or None, "fallback_reason": why if dist.source != "sim" else None}
        out["sim_detail"] = json.dumps(detail, separators=(",", ":"))
        return out

    # ---------------------------------------------------------------- prices
    @staticmethod
    def price(dist: Dist, go: dict, home_name=None, away_name=None) -> dict:
        s = dist.s
        out = {c: None for c in COLUMNS}
        hn, an = home_name or "", away_name or ""
        # regulation 3-way
        rh, rt, ra = _pct_triple([s["reg_home"], s["reg_tie"], s["reg_away"]])
        out.update({"home_reg_pct": rh, "reg_tie_pct": rt, "away_reg_pct": ra,
                    "home_reg_fair": MK.fair_american(rh / 100), "reg_tie_fair": MK.fair_american(rt / 100),
                    "away_reg_fair": MK.fair_american(ra / 100)})
        for col, p, key in (("home_reg_ev", rh, f"{hn}_three_way"), ("reg_tie_ev", rt, "three_way_tie"),
                            ("away_reg_ev", ra, f"{an}_three_way")):
            out[col] = _r4(MK.ev(p / 100, price(go.get(key)))) if price(go.get(key)) is not None else None
        # puck line at the posted spread (home's spread; away's is its negative)
        hs = spread_of(go.get(f"{hn}_puckline_spread"), None)
        if hs is None:
            a_s = spread_of(go.get(f"{an}_puckline_spread"), None)
            hs = -a_s if a_s is not None else -1.5
        hw, _, hl = dist.cover(hs, "home")
        aw, _, al = dist.cover(-hs, "away")
        out.update({"sim_pl_spread": f"{hs:+.1f}", "home_pl_pct": round(100 * hw, 1), "away_pl_pct": round(100 * aw, 1),
                    "home_pl_fair": MK.fair_american(hw, hl), "away_pl_fair": MK.fair_american(aw, al)})
        if abs(hs - round(hs)) > 1e-9:          # half-goal spread: no push, the two sides sum to 100
            out["home_pl_pct"], out["away_pl_pct"] = _pct_triple([hw, aw])
        for col, (w_, l_), key in (("home_pl_ev", (hw, hl), f"{hn}_puckline"), ("away_pl_ev", (aw, al), f"{an}_puckline")):
            pr = price(go.get(key))
            out[col] = _r4(MK.ev(w_, pr, l_)) if pr is not None else None
        # total at the posted line (6.0 when none is posted)
        L = line_of(go.get("total_line"))
        L = 6.0 if L is None else L
        ov, pu, un = dist.total(L)
        o_, p_, u_ = _pct_triple([ov, pu, un])
        out.update({"sim_total_line": f"{L:.1f}", "over_pct": o_, "total_push_pct": p_, "under_pct": u_,
                    "over_fair": MK.fair_american(ov, un), "under_fair": MK.fair_american(un, ov)})
        for col, (w_, l_), key in (("over_ev", (ov, un), "total_over"), ("under_ev", (un, ov), "total_under")):
            pr = price(go.get(key))
            out[col] = _r4(MK.ev(w_, pr, l_)) if pr is not None else None
        # 1st period: 3-way, and the 2-way moneyline with ties refunded
        h1, t1, a1 = _pct_triple([s["p1_home"], s["p1_tie"], s["p1_away"]])
        out.update({"home_1p_pct": h1, "p1_tie_pct": t1, "away_1p_pct": a1,
                    "home_1p_fair": MK.fair_american(h1 / 100), "p1_tie_fair": MK.fair_american(t1 / 100),
                    "away_1p_fair": MK.fair_american(a1 / 100)})
        h2, a2 = _pct_triple([s["p1_home"], s["p1_away"]])
        out.update({"home_1p_2w_pct": h2, "away_1p_2w_pct": a2,
                    "home_1p_2w_fair": MK.fair_american(s["p1_home"], s["p1_away"]),
                    "away_1p_2w_fair": MK.fair_american(s["p1_away"], s["p1_home"])})
        for col, (w_, l_), key in (("home_1p_ev", (s["p1_home"], s["p1_away"]), f"{hn}_1p_ml"),
                                   ("away_1p_ev", (s["p1_away"], s["p1_home"]), f"{an}_1p_ml")):
            pr = price(go.get(key))
            out[col] = _r4(MK.ev(w_, pr, l_)) if pr is not None else None
        out["home_1p_three_way"] = price(go.get(f"{hn}_1p_three_way"))
        out["away_1p_three_way"] = price(go.get(f"{an}_1p_three_way"))
        out["p1_three_way_tie"] = price(go.get("1p_three_way_tie"))
        for col, p, pr in (("home_1p3_ev", s["p1_home"], out["home_1p_three_way"]),
                           ("p1_tie_ev", s["p1_tie"], out["p1_three_way_tie"]),
                           ("away_1p3_ev", s["p1_away"], out["away_1p_three_way"])):
            out[col] = _r4(MK.ev(p, pr)) if pr is not None else None
        out["sim_ev_gated"] = False
        out["sim_gate_reason"] = GATE_REASON
        return out
