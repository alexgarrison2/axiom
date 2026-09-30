"""predict_games.py - builds predictions_detailed.csv (data contract v2).

One row per game in upcoming_games.json (today and tomorrow, NHL local
date).  The column contract (types, nullability, units) is documented in
pipeline/CONTRACT.md; pipeline/validate_outputs.py enforces it before a
commit.

Pipeline for one game
---------------------
1. Status.  A game that has started (start_time_utc <= now, or gameState
   not FUT/PRE) is never predicted.  If a pregame v2 row of THIS season
   exists it is frozen: only its model outputs (FROZEN_COLUMNS) are kept.
   Otherwise the row is written with prediction_status
   'no_pregame_prediction' and no win %, EV or wager.
2. Context (every run, frozen or not): season-scoped records, special
   teams, schedule fatigue, goalie lines and status - see season_context.py.
   Nothing falls back to a placeholder: empty means "no data yet", and
   previous-season values only appear in *_prev columns (context_season).
3. Model (pregame only): ml_predict (logistic + Elo, v5) with rest from
   the full club schedule, the lineup term from lineup_adjust (both sides
   must pass its coverage gate), then market.price_game: de-vigged market,
   logit blend, EV as a FRACTION of the stake, and the proven-edge gate that
   decides whether units are shown.  goal_model turns the published
   probability into xG and the 'why this pick' breakdown, whose parts add up
   to the displayed win % and xG.
"""
from __future__ import annotations

import csv
import json
import math
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import pandas as pd  # noqa: E402

import goal_model  # noqa: E402
import market  # noqa: E402
import season_context as SC  # noqa: E402
from season import (SEASON_ID, PREV_SEASON_ID, PREV_START_YEAR, read_season_csv, today_local,  # noqa: E402
                    game_type_of)

REPO_ROOT = os.path.dirname(SCRIPT_DIR)
PRED_PATHS = [os.path.join(REPO_ROOT, "data", "predictions_detailed.csv"),
              os.path.join(REPO_ROOT, "public", "data", "predictions_detailed.csv")]
LAST_UPDATED_PATHS = [os.path.join(REPO_ROOT, "data", "last_updated.json"),
                      os.path.join(REPO_ROOT, "public", "data", "last_updated.json")]
PUBLIC_DATA = os.path.join(REPO_ROOT, "public", "data")

SCHEMA_VERSION = 2

STATUS_PREGAME = "pregame"
STATUS_FROZEN = "frozen"
STATUS_NO_PREGAME = "no_pregame_prediction"
STATUS_NO_MODEL = "no_model"
PREDICTED_STATUSES = (STATUS_PREGAME, STATUS_FROZEN)

STARTED_STATES = {"LIVE", "CRIT", "FINAL", "OFF"}

SIDES = ("home", "away")

# Model outputs: computed once before puck drop, frozen byte-for-byte after.
FROZEN_COLUMNS = [
    "predicted_at", "model_version", "preseason_prior",
    "home_model_win_pct", "away_model_win_pct", "home_win_pct", "away_win_pct",
    "home_model_odds", "away_model_odds", "home_blend_odds", "away_blend_odds",
    "home_vegas_odds", "away_vegas_odds", "home_vegas_win_pct", "away_vegas_win_pct",
    "blend_weight", "home_ev", "away_ev", "ev_gated", "bet_side", "units", "wager_recommendation",
    "gate_reason", "market_source", "market_fetched_at",
    "home_xg", "away_xg", "expected_total", "home_xg_explained", "away_xg_explained",
    "home_wp_breakdown", "pick_summary", "confidence_grade", "confidence_note",
    "home_model_goalie", "away_model_goalie",
    "home_lineup_score", "away_lineup_score", "home_lineup_matched", "away_lineup_matched",
    "total_line", "total_over", "total_under",
    "home_puckline", "away_puckline", "home_puckline_spread", "away_puckline_spread",
    "home_1p_ml", "away_1p_ml", "home_three_way", "away_three_way", "three_way_tie",
]


def _side_cols(*names):
    return [f"{s}_{n}" for n in names for s in SIDES]


# Display context: recomputed on every run, frozen rows included.
CONTEXT_COLUMNS = (
    ["schema_version", "season_id", "game_type", "nhl_game_id", "game_id", "game_date", "start_time_utc",
     "game_start_time", "game_state", "prediction_status", "context_season",
     "home_team", "away_team", "home_abbrev", "away_abbrev"]
    + _side_cols("gp")
    + _side_cols("l7", "l7_n", "l7_label", "l7_games")
    + _side_cols("h2h_record", "h2h_prev") + ["h2h_gp", "h2h_prev_gp"]
    + _side_cols("loc_record", "loc_gp")
    + _side_cols("pp_rank", "pk_rank", "pp_pct", "pk_pct", "pp_opps", "pk_opps",
                 "pp_rank_prev", "pk_rank_prev")
    + _side_cols("rest_days", "is_b2b", "games_in_last_4", "games_in_last_6", "games_in_last_9",
                 "road_trip_game_n")
    + _side_cols("starter", "goalie_confirmed", "goalie_status", "goalie_status_source", "goalie_status_at",
                 "goalie_stats", "goalie_stats_cur", "goalie_stats_prev", "goalie_cur_gp", "goalie_po",
                 "gsax", "gsax_total", "gsax_pct", "starter_vs_opp", "starter_vs_opp_gp")
    + _side_cols("news", "lineup")
)

N_IDENTITY = 15   # schema_version .. away_abbrev
COLUMNS = CONTEXT_COLUMNS[:N_IDENTITY] + FROZEN_COLUMNS + CONTEXT_COLUMNS[N_IDENTITY:]

FACTOR_SHORT = {
    "home_ice": "home ice", "strength_5v5": "5v5 strength", "special_teams": "special teams",
    "goaltending": "goaltending", "rest": "rest", "lineup": "lineups & injuries",
    "market": "betting market", "other": "other factors",
}


# ── small helpers ────────────────────────────────────────────────────────────

def blank(v):
    return v is None or (isinstance(v, float) and math.isnan(v)) or str(v).strip() in ("", "nan", "None")


def fmt(v):
    """CSV cell text: '' for None/NaN, 'True'/'False' for bools."""
    if blank(v):
        return ""
    if isinstance(v, bool):
        return "True" if v else "False"
    if isinstance(v, (dict, list)):
        return json.dumps(v)
    return str(v)


def prob_to_odds(prob):
    """Fair American odds of a probability ('' when undefined)."""
    if prob is None or not 0 < prob < 1:
        return ""
    if abs(prob - 0.5) < 1e-12:
        return "+100"
    odds = -(prob / (1 - prob)) * 100 if prob > 0.5 else ((1 - prob) / prob) * 100
    return f"+{int(round(odds))}" if odds > 0 else f"{int(round(odds))}"


def relabel_fair_odds(row):
    """Rows frozen before *_blend_odds existed stored the BLENDED fair line in
    *_model_odds.  Relabel it (no prediction changes): the old value becomes
    *_blend_odds and *_model_odds is re-derived from the model-only %."""
    for side in SIDES:
        if row.get(f"{side}_blend_odds") not in (None, ""):
            continue
        try:
            pm = float(row.get(f"{side}_model_win_pct"))
            pb = float(row.get(f"{side}_win_pct"))
        except (TypeError, ValueError):
            continue
        row[f"{side}_blend_odds"] = prob_to_odds(pb / 100)
        row[f"{side}_model_odds"] = prob_to_odds(pm / 100)


def convert_to_central(start):
    """Legacy display clock ('07:00 PM', US Central)."""
    if start is None:
        return ""
    try:
        from zoneinfo import ZoneInfo
        return start.astimezone(ZoneInfo("America/Chicago")).strftime("%I:%M %p")
    except Exception:
        return ""


def round_to_sum(values, target, nd):
    """Round ``values`` to ``nd`` decimals so that they add up exactly to
    round(target, nd) (largest-remainder method)."""
    scale = 10 ** nd
    raw = [v * scale for v in values]
    floors = [math.floor(x) for x in raw]
    diff = int(round(target * scale)) - sum(floors)
    order = sorted(range(len(raw)), key=lambda i: raw[i] - floors[i], reverse=True)
    if diff >= 0:
        for i in order[:diff]:
            floors[i] += 1
    else:
        for i in order[::-1][:(-diff)]:
            floors[i] -= 1
    return [f / scale for f in floors]


def _logit(p):
    p = min(max(float(p), 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def price_of(v):
    """American price from odds.json (None unless a real line: |x| >= 100)."""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if abs(x) >= 100 else None


# ── inputs ───────────────────────────────────────────────────────────────────

@dataclass
class Inputs:
    now: datetime
    schedule: list
    club_games: dict = field(default_factory=dict)       # TRI -> normalized games (all types)
    standings_gp: dict = field(default_factory=dict)     # TRI -> current RS GP
    st_table: dict = field(default_factory=dict)         # TRI -> special_teams_table row
    st_prev: dict = field(default_factory=dict)          # TRI -> previous-season ranks
    hist_gamestats: object = None                        # DataFrame for previous-season H2H
    goalie_lines: dict = field(default_factory=dict)     # name -> {cur, prev}
    goalie_po: dict = field(default_factory=dict)        # name -> career playoff display
    goalie_ratings: dict = field(default_factory=dict)
    odds: dict = field(default_factory=dict)
    lineups: dict = field(default_factory=dict)
    news: dict = field(default_factory=dict)
    injuries: dict = field(default_factory=dict)         # TRI -> [{name, status}]
    dfo_goalies: dict = field(default_factory=dict)
    team_goalies: dict = field(default_factory=dict)     # TRI -> roster goalies
    existing: dict = field(default_factory=dict)         # key -> previous CSV row
    ml: object = None
    lineup_adj: object = None
    gate_state: dict = None
    tiers: list = field(default_factory=list)
    starter_lookup: dict = field(default_factory=dict)
    full_names: dict = field(default_factory=dict)       # TRI -> 'Toronto Maple Leafs'
    vs_opp: object = None                                # callable(name, tri, opp_tri) -> dict | None


def goalie_percentiles(goalie_ratings):
    vals = sorted(((n, d.get("gsax_per_game", 0) or 0) for n, d in goalie_ratings.items()), key=lambda x: x[1])
    n = len(vals)
    return {name: ((i / (n - 1)) * 100 if n > 1 else 50) for i, (name, _) in enumerate(vals)}


def existing_key(row):
    gid = str(row.get("nhl_game_id") or "").split(".")[0]
    return gid if gid.isdigit() and len(gid) == 10 else row.get("game_id")


def load_existing_predictions(path=PRED_PATHS[0]):
    out = {}
    try:
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                out[existing_key(row)] = row
                if row.get("game_id"):
                    out.setdefault(row["game_id"], row)
    except FileNotFoundError:
        pass
    return out


# ── status (A2) ──────────────────────────────────────────────────────────────

def has_started(game, now):
    start = SC.parse_utc(game.get("startTimeUTC"))
    state = (game.get("gameState") or "FUT").upper()
    return state in STARTED_STATES or (start is not None and now >= start)


def freezable(row):
    """A previous row may be frozen only if it is a v2 pregame prediction of
    THIS season (legacy rows and other seasons are never frozen)."""
    if not row:
        return False
    return (str(row.get("schema_version") or "").split(".")[0] == str(SCHEMA_VERSION)
            and str(row.get("season_id") or "").split(".")[0] == SEASON_ID
            and row.get("prediction_status") in PREDICTED_STATUSES
            and not blank(row.get("home_win_pct")))


def game_status(game, existing_row, now):
    """'predict', 'freeze' or 'no_pregame' for one scheduled game."""
    if not has_started(game, now):
        return "predict"
    return "freeze" if freezable(existing_row) else "no_pregame"


def find_existing(game, existing):
    legacy = legacy_game_id(game)
    return existing.get(str(game.get("id"))) or existing.get(legacy)


def legacy_game_id(game):
    return f"{game_date_of(game)}-{game['awayTeam']}-{game['homeTeam']}"


def game_date_of(game):
    return game.get("gameDate") or str(game.get("startTimeUTC", ""))[:10]


# ── context ──────────────────────────────────────────────────────────────────

def _goalie_for(game, side, inp):
    """(name, sched_status, sched_source) of the projected starter."""
    name = game.get(f"{side}GoalieConfirmed")
    status = game.get(f"{side}GoalieStatus")
    source = game.get(f"{side}GoalieSource")
    if not name:
        roster = inp.team_goalies.get(game.get(f"{side}TeamAbbrev")) or []
        if roster:
            return roster[0], "Unconfirmed", ""
        return "", "", ""
    return name, status or "Unconfirmed", source or ""


def _dfo_entry(inp, tri, game_date):
    full = inp.full_names.get(tri, "")
    return inp.dfo_goalies.get(f"{full}_{game_date}") if full else None


def build_context(game, inp, existing_row=None):
    """Display context for one game (see CONTRACT.md).  Never placeholders."""
    now = inp.now
    home, away = game["homeTeam"], game["awayTeam"]
    h_tri, a_tri = game.get("homeTeamAbbrev"), game.get("awayTeamAbbrev")
    gd = game_date_of(game)
    gtype = game_type_of(game.get("id")) or f"{int(game.get('gameType') or 2):02d}"
    start = SC.parse_utc(game.get("startTimeUTC"))
    ctx = {
        "schema_version": SCHEMA_VERSION, "season_id": SEASON_ID, "game_type": gtype,
        "nhl_game_id": game.get("id"), "game_id": legacy_game_id(game), "game_date": gd,
        "start_time_utc": SC.iso_z(start), "game_start_time": convert_to_central(start),
        "game_state": game.get("gameState") or "FUT",
        "home_team": home, "away_team": away, "home_abbrev": h_tri, "away_abbrev": a_tri,
    }
    prev_used = False
    games = {s: inp.club_games.get(t, []) for s, t in (("home", h_tri), ("away", a_tri))}
    for side, tri, team, opp_tri, opp in (("home", h_tri, home, a_tri, away), ("away", a_tri, away, h_tri, home)):
        g = games[side]
        # GP before this game, from the club schedule; standings (which also
        # count a game in progress or finished tonight) only as a fallback.
        gp = SC.games_played(g, tri, gd, before_start=start) if g else inp.standings_gp.get(tri, 0)
        ctx[f"{side}_gp"] = int(gp)
        ln = SC.last_n(g, tri, gd, gtype, starter_lookup=inp.starter_lookup, common_name=team,
                       before_start=start)
        ctx[f"{side}_l7"] = ln["record"]
        ctx[f"{side}_l7_n"] = ln["n"]
        ctx[f"{side}_l7_label"] = ln["label"]
        ctx[f"{side}_l7_games"] = ln["games"]
        rec, n = SC.location_record(g, tri, gd, at_home=(side == "home"), before_start=start)
        ctx[f"{side}_loc_record"], ctx[f"{side}_loc_gp"] = rec, n
        st = inp.st_table.get(tri) or {}
        ctx[f"{side}_pp_rank"] = st.get("pp_rank")
        ctx[f"{side}_pk_rank"] = st.get("pk_rank")
        ctx[f"{side}_pp_pct"] = st.get("pp_pct")
        ctx[f"{side}_pk_pct"] = st.get("pk_pct")
        ctx[f"{side}_pp_opps"] = st.get("pp_opps") if st.get("pp_opps") else None
        ctx[f"{side}_pk_opps"] = st.get("pk_opps") if st.get("pk_opps") else None
        if st.get("pp_rank") is None:
            prev = inp.st_prev.get(tri) or {}
            ctx[f"{side}_pp_rank_prev"] = prev.get("pp_rank")
            ctx[f"{side}_pk_rank_prev"] = prev.get("pk_rank")
            prev_used |= prev.get("pp_rank") is not None
        fat = SC.fatigue(g, tri, game.get("id"), gd)
        for k in ("rest_days", "is_b2b", "games_in_last_4", "games_in_last_6", "games_in_last_9",
                  "road_trip_game_n"):
            ctx[f"{side}_{k}"] = fat[k]
        ctx[f"_{side}_model_rest"] = fat["model_rest_days"]

        # goalies
        name, sched_status, sched_source = _goalie_for(game, side, inp)
        status, source, at = SC.resolve_goalie_status(
            name, sched_status, sched_source, _dfo_entry(inp, tri, gd), inp.news.get(tri, []), gd,
            SC.opponent_terms(opp, opp_tri, inp.full_names.get(opp_tri, "")), now,
            not_before=SC.previous_start(g, tri, start))
        if existing_row and existing_row.get(f"{side}_goalie_confirmed") == name \
                and existing_row.get(f"{side}_goalie_status") == status \
                and existing_row.get(f"{side}_goalie_status_source") == source \
                and existing_row.get(f"{side}_goalie_status_at"):
            at = existing_row[f"{side}_goalie_status_at"]   # unchanged status: keep its first time
        ctx[f"{side}_starter"] = f"{name} ({status})" if name else ""
        ctx[f"{side}_goalie_confirmed"] = name
        ctx[f"{side}_goalie_status"] = status if name else "Unconfirmed"
        ctx[f"{side}_goalie_status_source"] = source if name else ""
        ctx[f"{side}_goalie_status_at"] = at if name and source else ""
        cur, prev_line, cur_gp = SC.goalie_lines(inp.goalie_lines, name)
        ctx[f"{side}_goalie_stats"] = cur
        ctx[f"{side}_goalie_stats_cur"] = cur
        ctx[f"{side}_goalie_stats_prev"] = prev_line
        ctx[f"{side}_goalie_cur_gp"] = cur_gp if name else None
        prev_used |= bool(prev_line)
        ctx[f"{side}_goalie_po"] = (inp.goalie_po.get(name) or "") if (gtype == "03" and name) else ""
        gr = inp.goalie_ratings.get(name) if name else None
        ctx[f"{side}_gsax"] = round(gr.get("gsax_per_game", 0) or 0, 3) if gr else None
        ctx[f"{side}_gsax_total"] = gr.get("gsax_total") if gr else None
        ctx[f"{side}_gsax_pct"] = round(inp._gsax_pct.get(name, 50), 1) if gr else None
        vs = inp.vs_opp(name, tri, opp_tri) if (name and inp.vs_opp) else None
        ctx[f"{side}_starter_vs_opp_gp"] = vs.get("vs_opp_gp") if vs else None
        ctx[f"{side}_starter_vs_opp"] = vs if (vs and vs.get("record")) else None
        ctx[f"{side}_news"] = inp.news.get(tri, [])
        ctx[f"{side}_lineup"] = inp.lineups.get(tri, {})

    hr, ar, n = SC.head_to_head(games["home"], h_tri, a_tri, gd, before_start=start)
    ctx["home_h2h_record"], ctx["away_h2h_record"], ctx["h2h_gp"] = hr, ar, n
    # gamestats has one row per team per game, so the home team's rows vs
    # this opponent cover the meetings at both venues.
    hp, ap, npv = SC.head_to_head_from_gamestats(inp.hist_gamestats, home, away, PREV_START_YEAR) \
        if inp.hist_gamestats is not None else ("", "", 0)
    ctx["home_h2h_prev"], ctx["away_h2h_prev"], ctx["h2h_prev_gp"] = hp, ap, (npv or None)
    prev_used |= bool(hp)
    ctx["context_season"] = PREV_SEASON_ID if prev_used else ""
    return ctx


# ── model (A10 / A11) ────────────────────────────────────────────────────────

def lineup_names(lineup):
    names = []
    for key in ("f1", "f2", "f3", "f4", "d1", "d2", "d3"):
        for p in (lineup or {}).get(key) or []:
            if isinstance(p, dict) and p.get("name"):
                names.append(p["name"])
    return names


def lineup_term(game, inp):
    """(logit, detail) from lineup_adjust, or (0.0, None) when either side
    fails the coverage gate (then the factor is 1.0 for both teams)."""
    if inp.lineup_adj is None:
        return 0.0, None
    h, a = game.get("homeTeamAbbrev"), game.get("awayTeamAbbrev")
    try:
        r = inp.lineup_adj.adjust(h, a, lineup_names(inp.lineups.get(h)), lineup_names(inp.lineups.get(a)),
                                  injured=inp.injuries)
    except Exception as e:
        print(f"  [WARN] lineup adjust {a}@{h}: {e}")
        return 0.0, None
    if not r:
        return 0.0, None
    return float(r["logit"]), r


def confidence(p, preseason, tiers):
    """(grade, note).  A: favourite >= 65%, B: 60-65%, C: below 60%; capped at
    B while either team is on preseason priors (< 10 GP).  The note quotes
    the live hit rate of that tier from model_report.json."""
    conf = max(p, 1 - p)
    grade = "A" if conf >= 0.65 else ("B" if conf >= 0.60 else "C")
    if preseason and grade == "A":
        grade = "B"
    tier = "65+" if conf >= 0.65 else ("60-65" if conf >= 0.60 else ("55-60" if conf >= 0.55 else "50-55"))
    t = next((x for x in tiers if x.get("tier") == tier and x.get("n")), None)
    note = ""
    if t and t.get("accuracy") is not None:
        note = (f"{tier}% favourites won {100 * t['accuracy']:.0f}% of {t['n']} live picks "
                f"({t.get('season', 'last season')})")
    if preseason:
        note = (note + "; " if note else "") + "early season: model on preseason priors"
    return grade, note


def pick_summary(home, away, p_home, rows):
    """<=160-char sentence naming the favourite and the top 2 factors."""
    fav, pct = (home, p_home) if p_home >= 0.5 else (away, 1 - p_home)
    top = sorted(rows, key=lambda r: abs(r["wp_delta_pts"]), reverse=True)[:2]
    parts = []
    for r in top:
        who = home if r["wp_delta_pts"] >= 0 else away
        parts.append(f"{FACTOR_SHORT.get(r['factor'], r['label'].lower())} "
                     f"({abs(r['wp_delta_pts']):.1f} pts to {who})")
    s = f"{fav} {100 * pct:.0f}%. Biggest factors: {' and '.join(parts)}."
    if len(s) > 160:
        s = s[:157].rstrip() + "..."
    return s


def build_model_outputs(game, ctx, inp):
    """Model outputs for a pregame game (FROZEN_COLUMNS), or None."""
    ml = inp.ml
    if ml is None or not getattr(ml, "available", False):
        return None
    home, away = game["homeTeam"], game["awayTeam"]
    gd = game_date_of(game)
    l_logit, l_detail = lineup_term(game, inp)
    extra = [("lineup", "Lineups & injuries", l_logit)]
    d = ml.predict_detail(home, away, gd, h_goalie=ctx["home_goalie_confirmed"] or None,
                          a_goalie=ctx["away_goalie_confirmed"] or None,
                          h_rest_days=ctx.get("_home_model_rest"), a_rest_days=ctx.get("_away_model_rest"),
                          extra_terms=extra)
    if d is None:
        return None
    p_model = float(d["home_win_prob"])
    go = inp.odds.get(str(game.get("id"))) or {}
    hp = price_of(go.get("home_ml", go.get(home)))
    ap = price_of(go.get("away_ml", go.get(away)))
    priced = market.price_game(p_model, hp, ap, ctx["home_gp"], ctx["away_gp"], state=inp.gate_state,
                               market_source=go.get("source"), fetched_at=go.get("fetched_at"))
    q = priced["market_prob_home"]
    w = priced["blend_weight"]
    terms = [(t["factor"], t["label"], float(t["logit"])) for t in d["logit_terms"]]
    rows, p_final = goal_model.wp_breakdown(terms, d["expected_total"],
                                            market_logit=_logit(q) if q is not None else None,
                                            blend_weight=w if q is not None else None)
    p = float(priced["blended_prob_home"])
    if abs(p_final - p) > 0.002:     # only the model's 3-97% numerical guard can cause this
        print(f"  [WARN] breakdown {p_final:.4f} vs published {p:.4f} for {away}@{home}")
    win_pct = round(100 * p, 1)
    wp = round_to_sum([r["wp_delta_pts"] for r in rows], win_pct - 50, 2)
    total = d["expected_total"]
    hx, ax = goal_model.display_xg(p, total)
    hx, ax = round(hx, 2), round(ax, 2)
    bx, bax = goal_model.display_xg(0.5, total)
    hparts = round_to_sum([bx] + [r["xg_home_delta"] for r in rows], hx, 2)
    aparts = round_to_sum([bax] + [r["xg_away_delta"] for r in rows], ax, 2)
    breakdown = [{"factor": r["factor"], "label": r["label"], "wp_delta_pts": v,
                  "xg_home_delta": round(r["xg_home_delta"], 3), "xg_away_delta": round(r["xg_away_delta"], 3)}
                 for r, v in zip(rows, wp)]

    def explained(parts):
        out = [f"Even matchup: {parts[0]:.2f}"]
        out += [f"{r['label']}: {v:+.2f}" for r, v in zip(rows, parts[1:])]
        return out

    preseason = bool(d.get("preseason_prior"))
    grade, note = confidence(p, preseason, inp.tiers)
    ev_h, ev_a = priced["ev_home"], priced["ev_away"]
    units, side = priced["units"], priced["bet_side"]
    wager = f"{side.title()} {units} {'Unit' if units == 1.0 else 'Units'}" if (units and side) else "No Bet"
    out = {
        "model_version": d.get("model_version") or getattr(ml, "model_version", ""),
        "preseason_prior": preseason,
        "home_model_win_pct": round(100 * p_model, 1), "away_model_win_pct": round(100 * (1 - p_model), 1),
        "home_win_pct": win_pct, "away_win_pct": round(100 - win_pct, 1),
        # Fair lines: *_model_odds of the model-only %, *_blend_odds of the published (blended) %.
        # Computed from the rounded percentages so the CSV is self-consistent.
        "home_model_odds": prob_to_odds(round(100 * p_model, 1) / 100),
        "away_model_odds": prob_to_odds(round(100 * (1 - p_model), 1) / 100),
        "home_blend_odds": prob_to_odds(win_pct / 100),
        "away_blend_odds": prob_to_odds(round(100 - win_pct, 1) / 100),
        "home_vegas_odds": int(hp) if hp is not None else None,
        "away_vegas_odds": int(ap) if ap is not None else None,
        "home_vegas_win_pct": round(100 * q, 1) if q is not None else None,
        "away_vegas_win_pct": round(100 - round(100 * q, 1), 1) if q is not None else None,
        "blend_weight": round(w, 3) if q is not None else None,
        "home_ev": round(ev_h, 4) if ev_h is not None else None,
        "away_ev": round(ev_a, 4) if ev_a is not None else None,
        "ev_gated": bool(priced["ev_gated"]),
        "bet_side": side if units else None,
        "units": units if units else None,
        "wager_recommendation": wager,
        "gate_reason": (priced.get("gate_reasons") or [""])[0],
        "market_source": priced.get("market_source") if q is not None else None,
        "market_fetched_at": priced.get("market_fetched_at") if q is not None else None,
        "home_xg": hx, "away_xg": ax, "expected_total": round(total, 2),
        "home_xg_explained": explained(hparts), "away_xg_explained": explained(aparts),
        "home_wp_breakdown": breakdown,
        "pick_summary": pick_summary(home, away, p, breakdown),
        "confidence_grade": grade, "confidence_note": note,
        "home_model_goalie": ctx["home_goalie_confirmed"], "away_model_goalie": ctx["away_goalie_confirmed"],
        "home_lineup_score": round(l_detail["home"]["dq"], 4) if l_detail else None,
        "away_lineup_score": round(l_detail["away"]["dq"], 4) if l_detail else None,
        "home_lineup_matched": l_detail["home"]["matched"] if l_detail else None,
        "away_lineup_matched": l_detail["away"]["matched"] if l_detail else None,
    }
    for k in ("total_line", "total_over", "total_under", "three_way_tie"):
        out[k] = go.get(k)
    for side_, team in (("home", home), ("away", away)):
        for k in ("puckline", "puckline_spread", "1p_ml", "three_way"):
            out[f"{side_}_{k}"] = go.get(f"{team}_{k}")
    return out


# ── rows ─────────────────────────────────────────────────────────────────────

def build_row(game, inp):
    existing_row = find_existing(game, inp.existing)
    status = game_status(game, existing_row, inp.now)
    ctx = build_context(game, inp, existing_row)
    row = {c: None for c in COLUMNS}
    row.update({k: v for k, v in ctx.items() if not k.startswith("_")})
    if status == "freeze":
        for c in FROZEN_COLUMNS:
            row[c] = existing_row.get(c, "")
        relabel_fair_odds(row)
        row["prediction_status"] = STATUS_FROZEN
    elif status == "no_pregame":
        row["prediction_status"] = STATUS_NO_PREGAME
    else:
        out = build_model_outputs(game, ctx, inp)
        if out is None:
            row["prediction_status"] = STATUS_NO_MODEL
        else:
            row.update(out)
            row["prediction_status"] = STATUS_PREGAME
            row["predicted_at"] = SC.iso_z(inp.now)
            # Keep the earlier timestamp when nothing the model produced
            # changed, so an unchanged hourly run rewrites nothing.
            if existing_row and existing_row.get("prediction_status") == STATUS_PREGAME and \
                    all(fmt(row[c]) == (existing_row.get(c) or "") for c in FROZEN_COLUMNS if c != "predicted_at"):
                row["predicted_at"] = existing_row.get("predicted_at") or row["predicted_at"]
    return {c: fmt(row.get(c)) for c in COLUMNS}


def build_rows(inp):
    inp._gsax_pct = goalie_percentiles(inp.goalie_ratings or {})
    rows = []
    for game in sorted(inp.schedule, key=lambda g: (g.get("startTimeUTC") or "", g.get("id") or 0)):
        if not game.get("homeTeam") or not game.get("awayTeam"):
            continue
        rows.append(build_row(game, inp))
    return rows


# ── I/O ──────────────────────────────────────────────────────────────────────

def _read_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _load_tiers():
    rep = _read_json(os.path.join(PUBLIC_DATA, "model_report.json"), {}) or {}
    seasons = rep.get("seasons") or {}
    for label in sorted(seasons, reverse=True):
        tiers = ((seasons[label] or {}).get("all") or {}).get("tiers") or []
        if sum(t.get("n") or 0 for t in tiers) >= 100:
            return [dict(t, season=label) for t in tiers]
    return []


def _starter_lookup(gs):
    out = {}
    if gs is None or gs.empty or "starting_goalie" not in gs.columns:
        return out
    for d, team, g in zip(gs["game_date"].astype(str), gs["team"], gs["starting_goalie"]):
        if isinstance(g, str) and g:
            out[(d[:10], team)] = g
    return out


def load_inputs(now=None, schedule=None):
    """Everything build_rows needs, from disk and the network."""
    now = now or datetime.now(timezone.utc)
    teams = pd.read_csv(os.path.join(SCRIPT_DIR, "nhl_teams.csv"))
    id_to_tri = {int(i): t for i, t in zip(teams["NHL Team ID"], teams["Team Tricode"])}
    all_tris = sorted(teams["Team Tricode"])
    full_names = dict(zip(teams["Team Tricode"], teams["Team Name"]))

    if schedule is None:
        schedule = _read_json(os.path.join(SCRIPT_DIR, "upcoming_games.json"), []) or []
    inp = Inputs(now=now, schedule=schedule, full_names=full_names)

    tris = sorted({g.get(k) for g in schedule for k in ("homeTeamAbbrev", "awayTeamAbbrev") if g.get(k)})
    print(f"Club schedules for {len(tris)} teams...")
    inp.club_games = {t: SC.load_club_schedule(t, now=now) for t in tris}
    inp.standings_gp = SC.fetch_standings_gp(now)
    if len(inp.standings_gp) < 32:
        print(f"  [WARN] standings returned {len(inp.standings_gp)} teams; GP from club schedules")
    inp.st_table = SC.fetch_special_teams(inp.standings_gp, id_to_tri, all_tris)
    inp.st_prev = SC.fetch_prev_season_ranks(id_to_tri)
    try:
        inp.hist_gamestats = pd.read_csv(os.path.join(SCRIPT_DIR, "nhl_historical_gamestats.csv"),
                                         usecols=["game_id", "team", "opponent", "result"])
    except Exception as e:
        print(f"  [WARN] historical gamestats unavailable ({e}); no previous-season H2H")

    from fetch_nhl_goalie_stats import load_goalie_season_lines
    inp.goalie_lines = load_goalie_season_lines()
    po = _read_json(os.path.join(PUBLIC_DATA, "goalie_playoff_career_stats.json"), {}) or {}
    inp.goalie_po = {n: v.get("display", "") for n, v in po.items() if isinstance(v, dict)}
    inp.goalie_ratings = _read_json(os.path.join(PUBLIC_DATA, "goalie_ratings.json"), {}) or {}
    inp.odds = _read_json(os.path.join(SCRIPT_DIR, "odds.json"), {}) or {}
    inp.dfo_goalies = _read_json(os.path.join(SCRIPT_DIR, "dailyfaceoff_goalies.json"), {}) or {}
    inp.team_goalies = _read_json(os.path.join(PUBLIC_DATA, "team_goalies.json"), {}) or {}
    inj = _read_json(os.path.join(PUBLIC_DATA, "injuries.json"), []) or []
    if isinstance(inj, dict):
        inj = inj.get("players") or [p for v in inj.values() if isinstance(v, list) for p in v]
    for p in inj:
        if isinstance(p, dict) and p.get("team"):
            inp.injuries.setdefault(p["team"], []).append(p)

    import fetch_dailyfaceoff
    print("Fetching lineups...")
    try:
        lst = [{"triCode": t, "teamName": full_names.get(t, t)} for t in all_tris]
        inp.lineups = fetch_dailyfaceoff.fetch_lineups(lst) or {}
    except Exception as e:
        print(f"  [WARN] lineups unavailable: {e}")
        inp.lineups = _read_json(os.path.join(SCRIPT_DIR, "team_lineups.json"), {}) or {}
    try:
        inp.news = fetch_dailyfaceoff.fetch_player_news() or {}
    except Exception as e:
        print(f"  [WARN] player news unavailable: {e}")
        inp.news = _read_json(os.path.join(SCRIPT_DIR, "player_news.json"), {}) or {}

    gs = read_season_csv("gamestats")
    inp.starter_lookup = _starter_lookup(gs)
    inp.existing = load_existing_predictions()
    inp.gate_state = market.load_gate_state()
    inp.tiers = _load_tiers()

    try:
        from ml_predict import MLPredictor
        inp.ml = MLPredictor(gs, goalie_ratings=inp.goalie_ratings)
    except Exception as e:
        print(f"[WARN] ML predictor unavailable: {e}")
        inp.ml = None
    try:
        from lineup_adjust import LineupAdjuster
        inp.lineup_adj = LineupAdjuster.from_files()
    except Exception as e:
        print(f"[WARN] lineup adjuster unavailable: {e}")
        inp.lineup_adj = None

    import fetch_goalie_history
    memo = {}

    def vs_opp(name, tri, opp):
        k = (name, opp)
        if k not in memo:
            try:
                memo[k] = fetch_goalie_history.fetch_goalie_vs_opponent(name, tri, opp)
            except Exception as e:
                print(f"  [WARN] vs-opponent {name} vs {opp}: {e}")
                memo[k] = None
        return memo[k]
    inp.vs_opp = vs_opp
    inp._save_vs_cache = fetch_goalie_history.save_cache
    return inp


def write_rows(rows, paths=PRED_PATHS):
    for p in paths:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        tmp = p + ".tmp"
        with open(tmp, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=COLUMNS)
            w.writeheader()
            for r in rows:
                w.writerow(r)
        os.replace(tmp, p)
        print(f"Saved {len(rows)} predictions to {os.path.relpath(p, REPO_ROOT)}")


def write_last_updated(now, paths=LAST_UPDATED_PATHS):
    stamp = SC.iso_z(now)
    for p in paths:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            json.dump({"last_refresh": stamp}, f)
    return stamp


def _print_rows(rows):
    print(f"\n{'Date':<11} {'Away':<14} {'Home':<14} {'Status':<22} {'H win%':>7} {'Mkt%':>6} {'H EV':>7} {'Wager'}")
    for r in rows:
        print(f"{r['game_date']:<11} {r['away_team']:<14} {r['home_team']:<14} {r['prediction_status']:<22} "
              f"{r['home_win_pct']:>7} {r['home_vegas_win_pct']:>6} {r['home_ev']:>7} {r['wager_recommendation']}")


def predict(now=None):
    now = now or datetime.now(timezone.utc)
    print(f"Predicting for NHL date {today_local(now)} ({SEASON_ID})...")
    inp = load_inputs(now)
    from http_utils import request_count
    before = request_count("/game-log/")
    rows = build_rows(inp)
    goalies = {r[f"{s}_goalie_confirmed"] for r in rows for s in SIDES if r[f"{s}_goalie_confirmed"]}
    print(f"Goalie vs-opponent lines: {len(goalies)} goalies, {request_count('/game-log/') - before} "
          "game-log API calls (<= 2 per goalie on a warm cache)")
    try:
        inp._save_vs_cache()
    except Exception as e:
        print(f"  [WARN] could not save goalie vs-opponent cache: {e}")
    _print_rows(rows)
    write_rows(rows)
    stamp = write_last_updated(now)
    print(f"Done. {len(rows)} games, refresh stamp {stamp}")
    return {"status": "ok", "rows_written": len(rows)}


if __name__ == "__main__":
    predict()
