"""Point-in-time team and goalie state for the game simulator.

Every quantity is a ratio of two exponentially decayed sums, shrunk toward the league:

    rel = ((S_num + k * mu) / (S_den + k)) / mu          mu = league S_num / S_den (decayed too)

updated after each game (``S <- lam * S + x``, ``lam = 0.5 ** (1 / half_life)`` per team game)
and rolled at each season boundary (``S <- carry * S``).  Quantities (numerator / denominator):

  ev_off   5v5 xG for / score-adjusted 5v5 seconds         (team)
  ev_def   5v5 xG against / score-adjusted 5v5 seconds     (team)
  pp       power-play xG for / power-play seconds          (team)
  pk       shorthanded xG against / shorthanded seconds    (team)
  take     power-play-creating penalties taken / seconds   (team)
  draw     penalties drawn / seconds                       (team)
  fin      goals / xG with the opposing goalie in net      (team finishing)
  gsv      goals against / xG against with him in net     (goalie; > 1 = worse than xG)

League levels used for the absolute rates are decayed the same way (``league``): 5v5 goals per
adjusted second, power-play goals per second, penalties per team second.

The state is fed team-game rows (``bu.sim.data.team_games`` schema) in date order; a game on
date ``d`` only sees games before ``d``.  ``to_json`` / ``from_json`` make the season pack the
live path starts from; ``rows_from_season_csvs`` turns the pipeline's own current-season CSVs
(gamestats + shots with ``xg_raw``) into the same rows, so the hourly run needs no lake.
"""
from __future__ import annotations

import gzip
import json
import math
import os
import re
import unicodedata
from collections import defaultdict

import numpy as np
import pandas as pd

TEAM_Q = {
    "ev_off": ("ev_xg", "ev_adj"),
    "ev_def": ("ev_xga", "ev_adj_a"),
    "pp": ("pp_xg", "pp_s"),
    "pk": ("pk_xga", "pk_s"),
    "take": ("pen_taken", "game_s"),
    "draw": ("pen_drawn", "game_s"),
    "fin": ("gf_vg", "xg_vg"),
}
GOALIE_Q = ("ga_og", "xga_og")
LEAGUE_Q = {
    "ev_goals": ("ev_gf", "ev_adj"),
    "ev_xg": ("ev_xg", "ev_adj"),
    "pp_goals": ("pp_gf", "pp_s"),
    "pp_xg": ("pp_xg", "pp_s"),
    "pen": ("pen_taken", "game_s"),
    "fin": ("gf_vg", "xg_vg"),
    "gsv": ("ga_og", "xga_og"),
}
FRANCHISE = {53: 59, 11: 52}   # Arizona -> Utah (2024), Atlanta -> Winnipeg (2011)
DEFAULT_HYPER = {
    "half_life": 60.0, "carry": 0.7, "league_half_life": 1300.0, "goalie_half_life": 60.0,
    "goalie_carry": 0.85,
    "k": {"ev_off": 20000.0, "ev_def": 20000.0, "pp": 6000.0, "pk": 6000.0, "take": 40000.0,
          "draw": 40000.0, "fin": 300.0, "gsv": 150.0},
}
PACK_VERSION = 1


def norm_name(name) -> str:
    s = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z]", "", s.lower())


def team_key(team_id) -> int:
    t = int(team_id)
    return FRANCHISE.get(t, t)


class SimState:
    def __init__(self, hyper: dict | None = None):
        h = json.loads(json.dumps(DEFAULT_HYPER))
        for k, v in (hyper or {}).items():
            if k == "k":
                h["k"].update(v)
            else:
                h[k] = v
        self.hyper = h
        self.lam = 0.5 ** (1.0 / float(h["half_life"]))
        self.lam_g = 0.5 ** (1.0 / float(h["goalie_half_life"]))
        self.lam_l = 0.5 ** (1.0 / float(h["league_half_life"]))
        self.team = defaultdict(lambda: defaultdict(float))     # team -> field -> decayed sum
        self.goalie = defaultdict(lambda: defaultdict(float))   # goalie key -> field -> decayed sum
        self.league = defaultdict(float)
        self.season = None
        self.max_date = None
        self.n_games = 0
        self.goalie_names = {}                                  # norm name -> goalie key

    # ------------------------------------------------------------------ updates
    def roll(self, season: str) -> None:
        season = str(season)
        if self.season is not None and season != self.season:
            c, cg = float(self.hyper["carry"]), float(self.hyper["goalie_carry"])
            for t in self.team.values():
                for f in t:
                    t[f] *= c
            for g in self.goalie.values():
                for f in g:
                    g[f] *= cg
        self.season = season

    def add_rows(self, rows: pd.DataFrame) -> None:
        """Team-game rows of ONE date (or of dates all earlier than any later query)."""
        fields = sorted({f for q in TEAM_Q.values() for f in q} | {f for q in LEAGUE_Q.values() for f in q})
        for r in rows.to_dict("records"):
            t = self.team[team_key(r["team_id"])]
            for f in fields:
                if f in r and r[f] is not None and not (isinstance(r[f], float) and math.isnan(r[f])):
                    t[f] = self.lam * t[f] + float(r[f])
            for f in fields:
                v = r.get(f)
                if v is not None and not (isinstance(v, float) and math.isnan(v)):
                    self.league[f] = self.lam_l * self.league[f] + float(v)
            gk = r.get("goalie")
            if gk is not None and not (isinstance(gk, float) and math.isnan(gk)):
                g = self.goalie[self.gkey(gk)]
                for f in GOALIE_Q:
                    v = r.get(f)
                    if v is not None and not (isinstance(v, float) and math.isnan(v)):
                        g[f] = self.lam_g * g[f] + float(v)
            self.n_games += 0.5
        if len(rows):
            d = pd.to_datetime(rows["game_date"]).max()
            self.max_date = d if self.max_date is None or d > self.max_date else self.max_date

    def gkey(self, g) -> str:
        """State key of a goalie given as an NHL id or a display name (names resolve through the
        pack's name map to the id key, so lake history and the live CSVs share one entry)."""
        if isinstance(g, str) and g[:3] in ("id:", "n:"):
            return g
        if isinstance(g, str) and not g.strip().isdigit():
            n = norm_name(g)
            return self.goalie_names.get(n, "n:" + n)
        return "id:" + str(int(float(g)))

    # ------------------------------------------------------------------ queries
    def league_rate(self, q: str) -> float:
        num, den = LEAGUE_Q[q]
        d = self.league.get(den, 0.0)
        return self.league.get(num, 0.0) / d if d > 0 else float("nan")

    def team_rel(self, team_id, q: str) -> float:
        num, den = TEAM_Q[q]
        mu_q = {"ev_off": "ev_xg", "ev_def": "ev_xg", "pp": "pp_xg", "pk": "pp_xg", "take": "pen",
                "draw": "pen", "fin": "fin"}[q]
        mu = self.league_rate(mu_q)
        if not (mu > 0):
            return 1.0
        k = float(self.hyper["k"][q])
        t = self.team.get(team_key(team_id)) or {}
        return ((t.get(num, 0.0) + k * mu) / (t.get(den, 0.0) + k)) / mu

    def goalie_rel(self, goalie) -> tuple[float, float]:
        """(goals / xG multiplier shrunk to the league, decayed xG faced); 1.0 for an unknown goalie."""
        mu = self.league_rate("gsv")
        if goalie is None or not (mu > 0):
            return 1.0, 0.0
        g = self.goalie.get(self.gkey(goalie)) or {}
        k = float(self.hyper["k"]["gsv"])
        x = g.get("xga_og", 0.0)
        return ((g.get("ga_og", 0.0) + k * mu) / (x + k)) / mu, x

    # ------------------------------------------------------------------ pack I/O
    def to_json(self) -> dict:
        def dd(x):
            return {str(k): {f: round(v, 6) for f, v in d.items()} for k, d in x.items()}
        return {"version": PACK_VERSION, "kind": "sim_state", "hyper": self.hyper, "season": self.season,
                "max_date": None if self.max_date is None else str(pd.Timestamp(self.max_date).date()),
                "n_games": self.n_games, "team": dd(self.team), "goalie": dd(self.goalie),
                "league": {f: round(v, 6) for f, v in self.league.items()}, "goalie_names": self.goalie_names}

    @classmethod
    def from_json(cls, j: dict) -> "SimState":
        if j.get("kind") != "sim_state" or int(j.get("version", 0)) != PACK_VERSION:
            raise ValueError("not a sim_state pack")
        s = cls(j.get("hyper"))
        for k, d in (j.get("team") or {}).items():
            s.team[int(k)].update(d)
        for k, d in (j.get("goalie") or {}).items():
            s.goalie[k].update(d)
        s.league.update(j.get("league") or {})
        s.season = j.get("season")
        s.max_date = pd.Timestamp(j["max_date"]) if j.get("max_date") else None
        s.n_games = float(j.get("n_games") or 0)
        s.goalie_names = dict(j.get("goalie_names") or {})
        return s

    def save(self, path: str) -> str:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        tmp = path + ".tmp"
        with gzip.open(tmp, "wt") as f:
            json.dump(self.to_json(), f, separators=(",", ":"), sort_keys=True)
        os.replace(tmp, path)
        return path

    @classmethod
    def load(cls, path: str) -> "SimState":
        with gzip.open(path, "rt") as f:
            return cls.from_json(json.load(f))

    def copy(self) -> "SimState":
        return SimState.from_json(json.loads(json.dumps(self.to_json())))


def replay(rows: pd.DataFrame, state: SimState | None = None, hyper: dict | None = None,
           on_day=None) -> SimState:
    """Feed team-game rows (sorted by date) day by day; ``on_day(date, state)`` is called BEFORE
    the day's games are added (the point-in-time view for that day's predictions)."""
    st = state or SimState(hyper)
    for d, day in rows.groupby("game_date", sort=True):
        st.roll(str(day["season"].iloc[0]))
        if on_day is not None:
            on_day(d, st)
        st.add_rows(day)
    return st


# ---------------------------------------------------------------- live season rows (no lake)

def _se_avg(se: dict, lead: float, trail: float, tied: float, for_team: bool = True) -> float:
    """Average score-effect multiplier of a team's 5v5 time from its leading / trailing / tied
    seconds (the CSVs have no per-state 5v5 split); the +-1 entries, averaged over the game's
    segments by their length."""
    w = np.array([1200.0, 1200.0, 600.0, 480.0, 120.0])

    def m(d):
        vals = np.array([se.get((g, d), 1.0) for g in range(5)])
        return float((vals * w).sum() / w.sum())
    tot = lead + trail + tied
    if tot <= 0:
        return 1.0
    if for_team:
        return (lead * m(1) + trail * m(-1) + tied * m(0)) / tot
    return (lead * m(-1) + trail * m(1) + tied * m(0)) / tot


def rows_from_season_csvs(gamestats: pd.DataFrame, shots: pd.DataFrame, team_ids: dict, se: dict,
                          season: str) -> pd.DataFrame:
    """Team-game rows for the current season from ``nhl_season_<y>_<y+1>_gamestats.csv`` (times,
    penalties, starters, goals) and the shots file's ``xg_raw`` (xG v2, the lake's model family).

    ``team_ids``: common team name -> NHL team id.  Regular season and playoff games only; a game
    whose shots are not scored yet (no ``xg_raw``) is skipped."""
    if gamestats is None or not len(gamestats):
        return pd.DataFrame()
    g = gamestats.copy()
    g["gid"] = pd.to_numeric(g["game_id"], errors="coerce")
    g = g[g["gid"].notna()]
    g["gid"] = g["gid"].astype("int64")
    g = g[g["gid"].astype(str).str[4:6].isin(["02", "03"])]
    s = shots.copy() if shots is not None else pd.DataFrame()
    xcol = "xg_raw" if "xg_raw" in s.columns else None
    if xcol is None or not len(s):
        return pd.DataFrame()
    s = s[pd.to_numeric(s[xcol], errors="coerce").notna()].copy()
    s["xg"] = pd.to_numeric(s[xcol], errors="coerce")
    s["gid"] = pd.to_numeric(s["game_id"], errors="coerce").astype("int64")
    s["goal"] = pd.to_numeric(s["is_goal"], errors="coerce").fillna(0)
    s["reg"] = pd.to_numeric(s["period"], errors="coerce") <= 3
    ss = s["strength_state"].astype(str)
    s["ev"] = (ss == "5v5") & s["reg"]
    parts = ss.str.extract(r"^(\d)v(\d)$").astype(float)
    s["pp"] = (parts[0] > parts[1]) & (parts[0] <= 5) & s["reg"]
    s["vg"] = ss != "EmptyNet"
    keyed = {}
    for (gid, team), sub in s.groupby(["gid", "team_id"]):
        keyed[(int(gid), int(team))] = {
            "ev_xg": float(sub.loc[sub["ev"], "xg"].sum()), "ev_gf": int(sub.loc[sub["ev"], "goal"].sum()),
            "pp_xg": float(sub.loc[sub["pp"], "xg"].sum()), "pp_gf": int(sub.loc[sub["pp"], "goal"].sum()),
            "xg_vg": float(sub.loc[sub["vg"], "xg"].sum()), "gf_vg": int(sub.loc[sub["vg"], "goal"].sum())}
    scored = {gid for gid, _ in keyed}
    rows = []
    for r in g.to_dict("records"):
        gid = int(r["gid"])
        if gid not in scored:
            continue
        tid, oid = team_ids.get(r["team"]), team_ids.get(r["opponent"])
        if tid is None or oid is None:
            continue
        me = keyed.get((gid, tid), {})
        op = keyed.get((gid, oid), {})

        def num(c, default=0.0):
            v = pd.to_numeric(r.get(c), errors="coerce")
            return float(v) if pd.notna(v) else default
        t5 = num("time_5v5")
        lead, trail, tied = num("time_leading"), num("time_trailing"), num("time_tied")
        game_s = lead + trail + tied
        rows.append({
            "game_id": gid, "team_id": tid, "opp_id": oid, "season": season,
            "game_date": pd.Timestamp(str(r["game_date"])[:10]), "is_home": str(r.get("home_away")) == "Home",
            "game_type": int(str(gid)[4:6]),
            "ev_s": t5, "ev_adj": t5 * _se_avg(se, lead, trail, tied, True),
            "ev_adj_a": t5 * _se_avg(se, lead, trail, tied, False),
            "ev_xg": me.get("ev_xg", 0.0), "ev_gf": me.get("ev_gf", 0), "ev_xga": op.get("ev_xg", 0.0),
            "ev_ga": op.get("ev_gf", 0),
            "pp_s": num("pp_time"), "pp_xg": me.get("pp_xg", 0.0), "pp_gf": me.get("pp_gf", 0),
            "pk_s": num("pk_time"), "pk_xga": op.get("pp_xg", 0.0), "pk_ga": op.get("pp_gf", 0),
            "xg_vg": me.get("xg_vg", 0.0), "gf_vg": me.get("gf_vg", 0),
            "xga_og": op.get("xg_vg", 0.0), "ga_og": op.get("gf_vg", 0),
            "pen_taken": num("pk_opportunities"), "pen_drawn": num("pp_opportunities"),
            "game_s": game_s if game_s > 0 else 3600.0,
            "goalie": r.get("starting_goalie") or None, "opp_goalie": r.get("starting_goalie_opp") or None,
        })
    out = pd.DataFrame(rows)
    return out.sort_values(["game_date", "game_id", "is_home"]).reset_index(drop=True) if len(out) else out
