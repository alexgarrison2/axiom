"""Point-in-time inputs for every historical game (fit, tuning and validation).

``asof_sums`` replays the team-game rows through ``state.SimState`` and records, for each row,
the decayed sums of the team, its opponent, both starting goalies and the league as they stood
BEFORE the game's date.  ``game_inputs`` joins them with the RAPM lineup term (the committed
``bu/lineup/out/lineup_features.csv.gz``: point-in-time ratings as of d - 2 days, FIN, dressed
18) and rest days, one row per game in the home / away layout the rates module expects.
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

from .state import GOALIE_Q, LEAGUE_Q, TEAM_Q, SimState, replay, team_key

PIPELINE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LINEUP_FEATURES = os.path.join(PIPELINE_DIR, "bu", "lineup", "out", "lineup_features.csv.gz")


def asof_sums(tg: pd.DataFrame, hyper: dict | None = None) -> pd.DataFrame:
    rows = []
    fields = sorted({f for q in TEAM_Q.values() for f in q})

    def on_day(d, st: SimState):
        day = tg_by_day[d]
        lg = {q: st.league_rate(q) for q in LEAGUE_Q}
        for r in day.itertuples(index=False):
            t = st.team.get(team_key(r.team_id)) or {}
            o = st.team.get(team_key(r.opp_id)) or {}
            rec = {"game_id": r.game_id, "team_id": r.team_id}
            for f in fields:
                rec[f"t_{f}"] = t.get(f, 0.0)
                rec[f"o_{f}"] = o.get(f, 0.0)
            for side, gk in (("g", r.goalie), ("og", r.opp_goalie)):
                g = st.goalie.get(st.gkey(gk)) if pd.notna(gk) else None
                for f in GOALIE_Q:
                    rec[f"{side}_{f}"] = (g or {}).get(f, 0.0)
            for q, v in lg.items():
                rec[f"lg_{q}"] = v
            rows.append(rec)

    tg_by_day = {d: day for d, day in tg.groupby("game_date", sort=True)}
    replay(tg, hyper=hyper, on_day=on_day)
    return pd.DataFrame(rows)


def rel(num, den, k, mu):
    return ((num + k * mu) / (den + k)) / mu


def team_rels(S: pd.DataFrame, hyper: dict) -> pd.DataFrame:
    """Shrunk relative rates of the team (``t``) and its opponent (``o``) and the goalies."""
    k = hyper["k"]
    out = pd.DataFrame({"game_id": S["game_id"], "team_id": S["team_id"]})
    mu = {"ev_off": "lg_ev_xg", "ev_def": "lg_ev_xg", "pp": "lg_pp_xg", "pk": "lg_pp_xg", "take": "lg_pen",
          "draw": "lg_pen", "fin": "lg_fin"}
    for q, (num, den) in TEAM_Q.items():
        for side in ("t", "o"):
            out[f"{side}_{q}"] = rel(S[f"{side}_{num}"], S[f"{side}_{den}"], k[q], S[mu[q]])
    for side in ("g", "og"):
        out[f"{side}_gsv"] = rel(S[f"{side}_ga_og"], S[f"{side}_xga_og"], k["gsv"], S["lg_gsv"])
        out[f"{side}_xga_seen"] = S[f"{side}_xga_og"]
    for q in LEAGUE_Q:
        out[f"lg_{q}"] = S[f"lg_{q}"]
    return out


def rest_days(tg: pd.DataFrame) -> pd.Series:
    """Days since the team's previous game (any type), NaN for the first lake game."""
    d = tg[["game_id", "team_id", "game_date"]].copy()
    d["tk"] = d["team_id"].map(team_key)
    d = d.sort_values(["tk", "game_date", "game_id"])
    prev = d.groupby("tk")["game_date"].shift(1)
    return pd.Series(((d["game_date"] - prev).dt.days).to_numpy(), index=d.index).reindex(tg.index)


def load_lineup_features(path: str = LINEUP_FEATURES) -> pd.DataFrame:
    cols = ["game_id", "bu_ok", "c_intercept", "c_home", "bu_h_off", "bu_h_def", "bu_a_off", "bu_a_def",
            "bu_h_fin", "bu_a_fin", "bu_h_xgf60", "bu_h_xga60", "bu_a_xgf60", "bu_a_xga60", "bu_h_rated",
            "bu_a_rated"]
    f = pd.read_csv(path, usecols=lambda c: c in cols)
    f["bu_ok"] = f["bu_ok"].astype(str).str.lower().isin(("true", "1"))
    return f.drop_duplicates("game_id")


def game_inputs(tg: pd.DataFrame, rels: pd.DataFrame, lineup: pd.DataFrame | None = None) -> pd.DataFrame:
    """One row per game: home (``h_``) and away (``a_``) point-in-time inputs + lineup term."""
    t = tg.merge(rels, on=["game_id", "team_id"], how="left")
    t["rest"] = rest_days(tg).to_numpy()
    base = ["game_id", "team_id", "game_date", "season", "game_type"]
    side = ["goalie", "rest", "t_ev_off", "t_ev_def", "t_pp", "t_pk", "t_take", "t_draw", "t_fin", "g_gsv",
            "g_xga_seen"]
    lg = [c for c in t.columns if c.startswith("lg_")]
    h = t[t["is_home"]][base + side + lg].rename(columns={c: "h_" + c for c in side})
    a = t[~t["is_home"]][["game_id", "team_id"] + side].rename(columns={c: "a_" + c for c in side})
    a = a.rename(columns={"team_id": "away_team_id"})
    h = h.rename(columns={"team_id": "home_team_id"})
    g = h.merge(a, on="game_id", how="inner")
    if lineup is None:
        lineup = load_lineup_features() if os.path.exists(LINEUP_FEATURES) else None
    if lineup is not None:
        g = g.merge(lineup, on="game_id", how="left")
        g["bu_ok"] = g["bu_ok"].astype("boolean").fillna(False).astype(bool)
    return g.sort_values(["game_date", "game_id"]).reset_index(drop=True)
