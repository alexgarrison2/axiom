"""Player ratings for the site: ``public/data/player_ratings.json`` (RAPM v2, EV xG/60).

The live serving bundle (``out/serving_bundle.json.gz``) carries one row per rated skater:
``o`` (offence: EV xGF/60 impact, higher is better) and ``d`` (defence: EV xGA/60 impact,
LOWER is better).  This module turns it into the one player-rating file every page reads:

    {"version": 2, "season": "20262027", "season_label": "2026-27", "as_of": "2026-09-30", ...,
     "columns": ["id", "name", "team", "pos", "roster", "rated", "off", "def", "net",
                 "toi", "gp", "toi_cur", "gp_cur"],
     "rows": [[8478402, "Connor McDavid", "EDM", "C", true, true, 0.763, -0.057, 0.706, ...], ...]}

The site file presents every rating as higher = better: ``off = o``, ``def = -d`` (EV xGA/60
PREVENTED vs an average skater) and ``net = off + def`` (= ``o - d``, xG/60 above an average
skater at even strength).  Version 1 files carried ``def = d`` (lower is better) and
``net = off - def``; only the presented sign changed, the bundle and the model keep ``d``.

``toi`` / ``gp`` are the rating's recent sample: EV minutes and games in the ``WINDOW`` completed seasons before this one
plus this season so far (``toi_cur`` / ``gp_cur``).  ``roster`` = on a current NHL roster
(``/v1/roster/{TEAM}/{season}``, explicit season id); ``rated`` = False for a rostered skater
with no NHL sample yet, who carries the rookie prior of his position group (the same value the
live lineup term uses for him).  Goalies are not rated.

Sources, all free and committed or fetched with an explicit season id:

* ratings: the serving bundle (refreshed by ``bu.lineup.refresh``, CI ``bu_refresh.yml``);
* rosters: the crosswalk parquet the refresh just built in ``<state>/crosswalk/``, else the
  NHL roster endpoint (32 calls, cached under ``<state>``), else the previous export;
* names / positions of players not on a roster and the prior-season sample:
  ``out/player_sample_<season>.json.gz``, built once per season from the full lake
  (``python -m bu.lineup.ratings_export sample --lake-dir <lake> --season <S>``, next to the
  season pack; DESIGN §5.2 season rollover);
* this season's sample: the season's stints in ``<state>/stints`` (the refresh builds them for
  the ``asof`` fit), else carried over from the previous export of the same season.

    python -m bu.lineup.ratings_export export [--state <lake>/state/rapm] [--fetch-rosters]
    python -m bu.lineup.ratings_export sample --lake-dir ../data/lake --season 20262027

The export rewrites the file only when its content changed (``generated_at`` aside), so a
refresh that learnt nothing new leaves no diff to commit.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE_DIR = os.path.dirname(os.path.dirname(HERE))
REPO_ROOT = os.path.dirname(PIPELINE_DIR)
OUT_DIR = os.path.join(HERE, "out")
BUNDLE = os.path.join(OUT_DIR, "serving_bundle.json.gz")
PUBLIC_FILE = os.path.join(REPO_ROOT, "public", "data", "player_ratings.json")

VERSION = 1                 # player sample file
RATINGS_VERSION = 4         # site file; 4: + box-score prior and penalties (ratings v4; v5 appends fin_pp); 3: per-game impact
                            # headline (ratings v3); 2: def = -d, net = off + def
WINDOW = 3                  # completed seasons in the sample (toi / gp) before the current one
MIN_ROSTER_SKATERS = 600    # an export with fewer named roster skaters is not written
GAMES = 82
DEFAULT_WEIGHTS = {"w_o": 1.0, "w_d": 1.0, "w_pp": 1.0, "w_pk": 1.0}
COLUMNS = ["id", "name", "team", "pos", "roster", "rated",
           "impact", "off_impact", "def_impact", "sd",
           "ev_off", "ev_def", "pp_off", "pk_def", "fin", "toi_ev_gp", "toi_pp_gp", "toi_pk_gp",
           "off", "def", "net", "off_total", "toi", "gp", "toi_cur", "gp_cur"]
COLUMNS_V4 = COLUMNS + ["pen_impact", "pd60", "pt60", "spm_off", "spm_def", "spm_pp", "spm_pk"]
COLUMNS_V5 = COLUMNS_V4 + ["fin_pp"]     # ratings v5 impact (still file version 4: columns only appended)
UNITS = {
    "impact": "goals per 82 games above an average player at his position (F / D): off_impact + def_impact",
    "off_impact": "goals per 82 games: EV offence + PP offence + finishing, each x his expected minutes",
    "def_impact": "goals per 82 games: EV defence + PK defence, each x his expected minutes",
    "sd": "posterior SD of impact (EV and PP / PK rating uncertainty; TOI and FIN taken as known)",
    "ev_off": "EV xGF/60 vs an average skater (higher is better)",
    "ev_def": "EV xGA/60 prevented vs an average skater (higher is better)",
    "pp_off": "PP xGF/60 vs an average PP skater (higher is better)",
    "pk_def": "PK xGA/60 prevented vs an average PK skater (higher is better)",
    "fin": "EV goals above xG per 60 from his own shots, shrunk (higher is better)",
    "toi_ev_gp": "expected EV minutes per game", "toi_pp_gp": "expected PP minutes per game",
    "toi_pk_gp": "expected PK minutes per game",
    "off": "EV xGF/60 vs average (= ev_off, the v2 name)", "def": "EV xGA/60 prevented vs average (= ev_def, the v2 name)",
    "net": "off + def (EV per 60)", "off_total": "off + fin",
    "toi": "EV minutes, window seasons + this season", "gp": "games, same span",
    "toi_cur": "EV minutes this season", "gp_cur": "games this season"}
UNITS_V4 = {
    **UNITS,
    "impact": "goals per 82 games above an average player at his position (F / D): off_impact + def_impact "
              "(EV, PP / PK, finishing and penalties)",
    "off_impact": "goals per 82 games: EV offence + PP offence + finishing + penalties drawn, each x his expected minutes",
    "def_impact": "goals per 82 games: EV defence + PK defence - penalties taken, each x his expected minutes",
    "pen_impact": "goals per 82 games from penalties drawn minus taken vs his position (included in off / def_impact)",
    "pd60": "penalties drawn per 60 all-situation minutes (power-play units, shrunk)",
    "pt60": "penalties taken per 60 all-situation minutes (power-play units, shrunk)",
    "spm_off": "box-score prior of ev_off: what his individual stats alone predict (EV xGF/60, higher is better)",
    "spm_def": "box-score prior of ev_def (EV xGA/60 prevented, higher is better)",
    "spm_pp": "box-score prior of pp_off", "spm_pk": "box-score prior of pk_def"}
UNITS_V5 = {
    **UNITS_V4,
    "off_impact": "goals per 82 games: EV offence + PP offence + EV and PP finishing + penalties drawn, each x his "
                  "expected minutes",
    "pd60": "penalties drawn per 60 all-situation minutes, in power-play-creating minor equivalents (every penalty, "
            "scaled by the share of his position's penalties that create a power play; shrunk)",
    "pt60": "penalties taken per 60 all-situation minutes, in power-play-creating minor equivalents (every penalty, "
            "scaled by the share of his position's penalties that create a power play; shrunk)",
    "fin_pp": "PP goals above xG per 60 PP minutes from his own shots, shrunk (higher is better; in off_impact x his "
              "PP minutes)"}
VOLATILE = ("generated_at",)
MODEL = "Ratings v3 (game-recency RAPM EV + PP / PK, FIN, xG v2 target)"
MODEL_V4 = "Ratings v4 (game-recency RAPM EV + PP / PK with a box-score prior, FIN, penalties, xG v2 target)"
MODEL_V5 = ("Ratings v5 (v4 ratings; impact with power-play-creating penalty units, separate drawn / taken "
            "shrinkage and PP finishing)")


def _season():
    if PIPELINE_DIR not in sys.path:
        sys.path.insert(0, PIPELINE_DIR)
    from season import SEASON_ID
    return str(SEASON_ID)


def season_label(season: str) -> str:
    y = int(str(season)[:4])
    return f"{y}-{str(y + 1)[2:]}"


def prior_seasons(season: str, n: int = WINDOW) -> list[str]:
    y = int(str(season)[:4])
    return [f"{a}{a + 1}" for a in range(y - n, y)]


def sample_path(season: str) -> str:
    return os.path.join(OUT_DIR, f"player_sample_{season}.json.gz")


def _read_gz(path):
    with gzip.open(path, "rt") as f:
        return json.load(f)


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _pos_code(p) -> str:
    """'C' | 'L' | 'R' | 'D' | 'G' (NHL positionCode; 'LW' -> 'L')."""
    p = str(p or "").upper()
    if p.startswith("D"):
        return "D"
    if p.startswith("G"):
        return "G"
    if p in ("L", "LW"):
        return "L"
    if p in ("R", "RW"):
        return "R"
    return "C" if p else ""


# ----------------------------------------------------------------------- EV sample

def ev_sample(st):
    """Per skater: (EV seconds, games) from a season's stints (both goalies in, 5v5 / 4v4 / 3v3:
    the rows the RAPM regression is fit on)."""
    from collections import defaultdict
    from bu.rapm.stints import MIN_GAME_ONICE_MATCH, ev_mask
    st = st[ev_mask(st) & st["game_type"].isin([2, 3]) & (st["game_onice_match"] >= MIN_GAME_ONICE_MATCH)]
    secs: dict[int, float] = defaultdict(float)
    games: dict[int, set] = defaultdict(set)
    for gid, hs, as_, d in zip(st["game_id"], st["home_sk"], st["away_sk"], st["dur"]):
        for p in list(hs) + list(as_):
            p = int(p)
            secs[p] += float(d)
            games[p].add(int(gid))
    return {p: (secs[p], len(games[p])) for p in secs}


def build_sample(paths, season: str, source: str = "v1", log=print) -> dict:
    """Prior-season sample + identity of every lake player (full lake; once per season)."""
    from bu.lake.build import read_table
    from bu.rapm.data import ensure_stints, lake_seasons
    have = lake_seasons(paths.lake)
    window = [s for s in prior_seasons(season) if s in have]
    tot: dict[int, list] = {}
    for s in window:
        for p, (sec, gp) in ev_sample(ensure_stints(paths, s, source)).items():
            t = tot.setdefault(p, [0.0, 0])
            t[0] += sec
            t[1] += gp
        log(f"  [sample] {s}: EV sample of {len(tot):,} skaters so far")
    pl = read_table(paths.lake, "players", [s for s in have if s < str(season)],
                    columns=["season", "player_id", "full_name", "position", "team_abbrevs"])
    ident = {}
    if len(pl):
        pl = pl.sort_values("season")
        for r in pl.itertuples(index=False):
            teams = list(r.team_abbrevs) if r.team_abbrevs is not None else []
            ident[int(r.player_id)] = [r.full_name or "", _pos_code(r.position), teams[-1] if teams else "", str(r.season)]
    return {
        "version": VERSION, "kind": "player_sample", "season": str(season), "window": window,
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sample": {"columns": ["player_id", "ev_s", "gp"],
                   "rows": [[p, round(v[0]), v[1]] for p, v in sorted(tot.items())]},
        "players": {"columns": ["player_id", "name", "pos", "team", "last_season"],
                    "rows": [[p, *v] for p, v in sorted(ident.items())]},
    }


# ----------------------------------------------------------------------- rosters

def roster_table(state_root: str | None, season: str, fetch: bool = False, teams=None, getter=None):
    """{player_id: (name, team, pos)} of every current NHL roster, or None when unavailable.

    The refresh's crosswalk parquet first (roster rows only), then (``fetch``) the roster
    endpoint, cached under ``<state>/crosswalk/raw``."""
    import pandas as pd
    out = {}
    p = os.path.join(state_root, "crosswalk", f"player_ids_{season}.parquet") if state_root else None
    if p and os.path.exists(p):
        cw = pd.read_parquet(p)
        cw = cw[cw["source"] == "roster"] if "source" in cw.columns else cw[cw["rank"] == 0]
        for r in cw.itertuples(index=False):
            out[int(r.player_id)] = (str(r.name), str(r.team), _pos_code(r.position))
        if len({t for _, t, _ in out.values()}) >= 30:
            return out
    if not fetch or not state_root:
        return out or None
    from bu.lake.paths import Lake
    from bu.rapm.paths import RapmPaths
    from .crosswalk import fetch_roster, roster_rows
    paths = RapmPaths(Lake(state_root), state_root)
    if teams is None:
        import csv
        with open(os.path.join(PIPELINE_DIR, "nhl_teams.csv"), newline="", encoding="utf-8") as f:
            teams = [r["Team Tricode"] for r in csv.DictReader(f) if r.get("Team Tricode")]
    got = 0
    for t in sorted(set(teams)):
        d = fetch_roster(paths, season, t, refresh=True, getter=getter)
        if not d:
            continue
        got += 1
        for r in roster_rows(d, t):
            out.setdefault(int(r["player_id"]), (r["name"], t, _pos_code(r["position"])))
    return out if got >= 30 else (out or None)


def current_sample(state_root: str | None, season: str):
    """{player_id: (EV seconds, games)} this season from the refresh's stints, or None."""
    if not state_root:
        return None
    p = os.path.join(state_root, "stints", f"season={season}.parquet")
    if not os.path.exists(p):
        return None
    import pandas as pd
    return ev_sample(pd.read_parquet(p))


# ----------------------------------------------------------------------- export

def _prev_rows(prev: dict | None, season: str) -> dict:
    if not prev or not isinstance(prev.get("rows"), list):
        return {}
    cols = prev.get("columns") or []
    rows = {}
    for r in prev["rows"]:
        d = dict(zip(cols, r))
        if "id" in d:
            d["_same_season"] = str(prev.get("season")) == str(season)
            rows[int(d["id"])] = d
    return rows


def _impact_rows(v3: dict) -> dict:
    """{player_id: dict} of the bundle's v3 table plus the impact arithmetic (``impact``)."""
    cols = v3["columns"]
    return {int(r[0]): dict(zip(cols, r)) for r in v3["rows"]}


def impact(rates: dict, means: dict, weights: dict, k: float, pen_value: float = 0.0) -> dict:
    """Per-game impact (goals per 82 games) of one player from his per-60 rates (higher = better)
    and expected minutes per game by state.

    ``rates``: ev_off, ev_def, pp_off, pk_def (xG / 60), fin (goals / 60), toi_ev_gp, toi_pp_gp,
    toi_pk_gp (minutes), o_var, d_var, od_cov, pp_var, pk_var; ``means``: the position group's
    TOI-weighted mean of each rate (the baseline, so an average player at his position is 0);
    ``weights``: w_o, w_d, w_pp, w_pk (validation rule, ``v3_prereg.json`` "impact");
    ``k``: league goals per xG.

        off_impact = 82 [k w_o ev / 60 (ev_off - m) + k w_pp pp / 60 (pp_off - m) + ev / 60 (fin - m)]
        def_impact = 82 [k w_d ev / 60 (ev_def - m) + k w_pk pk / 60 (pk_def - m)]
        (v4, ``pen_value`` > 0: off_impact += 82 v_pen tall (pd60 - m), def_impact -= 82 v_pen tall (pt60 - m),
         tall = (ev + pp + pk) / 60, v_pen = goals per penalty unit)
        (v5, ``fin_pp`` in rates: off_impact += 82 pp / 60 (fin_pp - m))
        impact     = off_impact + def_impact
        sd         = 82 k sqrt((ev/60)^2 (w_o^2 o_var + w_d^2 d_var - 2 w_o w_d od_cov)
                               + (pp/60)^2 w_pp^2 pp_var + (pk/60)^2 w_pk^2 pk_var)    (FIN, TOI fixed)
    """
    ev, pp, pk = rates["toi_ev_gp"] / 60.0, rates["toi_pp_gp"] / 60.0, rates["toi_pk_gp"] / 60.0
    c = {x: rates[x] - means.get(x, 0.0) for x in ("ev_off", "ev_def", "pp_off", "pk_def", "fin")}
    off = GAMES * (k * weights["w_o"] * ev * c["ev_off"] + k * weights["w_pp"] * pp * c["pp_off"] + ev * c["fin"])
    if rates.get("fin_pp") is not None:      # v5: PP finishing x PP minutes
        off += GAMES * pp * (rates["fin_pp"] - means.get("fin_pp", 0.0))
    dfn = GAMES * (k * weights["w_d"] * ev * c["ev_def"] + k * weights["w_pk"] * pk * c["pk_def"])
    pen = 0.0
    if pen_value and "pd60" in rates:
        tall = ev + pp + pk
        drawn = GAMES * pen_value * tall * (rates["pd60"] - means.get("pd60", 0.0))
        taken = GAMES * pen_value * tall * (rates["pt60"] - means.get("pt60", 0.0))
        off, dfn, pen = off + drawn, dfn - taken, drawn - taken
    var = (ev ** 2 * (weights["w_o"] ** 2 * rates["o_var"] + weights["w_d"] ** 2 * rates["d_var"]
                      - 2 * weights["w_o"] * weights["w_d"] * rates["od_cov"])
           + pp ** 2 * weights["w_pp"] ** 2 * rates["pp_var"] + pk ** 2 * weights["w_pk"] ** 2 * rates["pk_var"])
    return {"off_impact": off, "def_impact": dfn, "impact": off + dfn, "pen_impact": pen,
            "sd": GAMES * k * float(np.sqrt(max(var, 0.0)))}


def position_means(rows: list, groups: list) -> dict:
    """{group: {rate: TOI-weighted mean}} over the given rows (rated roster skaters): EV rates and
    FIN weighted by EV minutes per game, PP by PP minutes, PK by PK minutes."""
    w_of = {"ev_off": "toi_ev_gp", "ev_def": "toi_ev_gp", "fin": "toi_ev_gp", "pp_off": "toi_pp_gp",
            "pk_def": "toi_pk_gp", "pd60": "toi_all_gp", "pt60": "toi_all_gp", "fin_pp": "toi_pp_gp"}
    out = {}
    for g in ("F", "D"):
        sub = [r for r, gg in zip(rows, groups) if gg == g]
        out[g] = {}
        for rate, wcol in w_of.items():
            if sub and rate not in sub[0]:
                continue
            w = np.array([max(float(r[wcol]) if wcol in r else sum(float(r[c]) for c in ("toi_ev_gp", "toi_pp_gp",
                                                                                          "toi_pk_gp")), 0.0)
                          for r in sub])
            v = np.array([float(r[rate]) for r in sub])
            out[g][rate] = float(np.average(v, weights=w)) if len(sub) and w.sum() > 0 else 0.0
    return out


def build_export(bundle: dict, sample: dict | None, roster: dict | None, cur: dict | None,
                 prev: dict | None = None, now: datetime | None = None) -> dict:
    """The site file from the bundle's ``v4`` table (version 4: v3's columns + penalties and the
    box-score priors, ``COLUMNS_V4``), else its ``v3`` table (version 3), the season's sample file,
    the current rosters and this season's EV sample (see the module docstring for the fallbacks)."""
    season = str(bundle["season"])
    v4 = bundle.get("v4")
    is4 = bool(v4) and isinstance(v4.get("rows"), list)
    v3 = v4 if is4 else bundle.get("v3")
    if not v3 or not isinstance(v3.get("rows"), list):
        raise RuntimeError("the serving bundle has no v4 / v3 ratings table (bu.lineup serve without a ratings pack?)")
    meta = v3.get("meta") or {}
    is5 = is4 and "fin_pp" in (v3.get("columns") or []) and bool(meta.get("pen_units"))   # ratings v5 impact
    pen_value = float(meta.get("pen_value") or 0.0) if is4 else 0.0
    k = float(meta.get("goals_per_xg") or 1.0)
    weights = {**DEFAULT_WEIGHTS, **(meta.get("impact_weights") or {})}
    table = _impact_rows(v3)
    low = meta.get("low_role") or {}            # group -> [o, d, pp, pk]
    toi_means = meta.get("toi_pos_means") or {}  # group -> {ev, pp, pk} seconds per game
    prev_rows = _prev_rows(prev, season)
    hist, ident = {}, {}
    if sample and str(sample.get("season")) == season:
        sc = sample["sample"]["columns"]
        hist = {int(r[0]): (float(r[sc.index("ev_s")]), int(r[sc.index("gp")])) for r in sample["sample"]["rows"]}
        ic = sample["players"]["columns"]
        ident = {int(r[0]): dict(zip(ic, r)) for r in sample["players"]["rows"]}
    prev_roster = {p: (d["name"], d["team"], d["pos"]) for p, d in prev_rows.items() if d.get("roster")}
    if roster is None:      # no roster source at all: keep the previous export's roster view
        roster = prev_roster
    else:                   # a team whose roster call failed keeps its previous roster
        have = {t for _, t, _ in roster.values()}
        roster = {**{p: v for p, v in prev_roster.items() if v[1] not in have}, **roster}
    roster = {p: v for p, v in roster.items() if v[2] != "G"}

    base = []
    for pid in sorted(set(table) | set(roster)):
        old = prev_rows.get(pid, {})
        if pid in roster:
            name, team, pos = roster[pid]
        else:
            i = ident.get(pid) or {}
            name = i.get("name") or old.get("name") or ""
            team = i.get("team") or old.get("team") or ""
            pos = i.get("pos") or old.get("pos") or ""
        if pos == "G" or not name:
            continue
        grp = "D" if pos == "D" else "F"
        t = table.get(pid)
        if t is not None:
            rated = bool(t.get("rated"))
            rates = {"ev_off": float(t["o"]), "ev_def": -float(t["d"]), "pp_off": float(t["pp"]),
                     "pk_def": -float(t["pk"]), "fin": float(t["fin"]), "toi_ev_gp": float(t["toi_ev"]),
                     "toi_pp_gp": float(t["toi_pp"]), "toi_pk_gp": float(t["toi_pk"]), "o_var": float(t["o_var"]),
                     "d_var": float(t["d_var"]), "od_cov": float(t["od_cov"]), "pp_var": float(t["pp_var"]),
                     "pk_var": float(t["pk_var"])}
            if is4:
                rates.update({"pd60": float(t["pd60"]), "pt60": float(t["pt60"]), "spm_off": float(t["spm_o"]),
                              "spm_def": -float(t["spm_d"]), "spm_pp": float(t["spm_pp"]), "spm_pk": -float(t["spm_pk"])})
                if is5:
                    rates["fin_pp"] = float(t["fin_pp"])
        else:      # rostered, no NHL sample: the low-sample role prior of his position group
            o, d, pp, pk = (low.get(grp) or [0.0, 0.0, 0.0, 0.0])[:4]
            tm = toi_means.get(grp) or {}
            vv = meta.get("prior_var") or {}
            rated = False
            rates = {"ev_off": float(o), "ev_def": -float(d), "pp_off": float(pp), "pk_def": -float(pk), "fin": 0.0,
                     "toi_ev_gp": float(tm.get("ev", 0.0)) / 60.0, "toi_pp_gp": float(tm.get("pp", 0.0)) / 60.0,
                     "toi_pk_gp": float(tm.get("pk", 0.0)) / 60.0, "o_var": float(vv.get("o", 0.0)),
                     "d_var": float(vv.get("d", 0.0)), "od_cov": 0.0, "pp_var": float(vv.get("pp", 0.0)),
                     "pk_var": float(vv.get("pk", 0.0))}
            if is4:      # position-average penalty rates (filled below), the low role's box-score prior
                rates.update({"pd60": None, "pt60": None, "spm_off": float(o), "spm_def": -float(d),
                              "spm_pp": float(pp), "spm_pk": -float(pk)})
                if is5:
                    rates["fin_pp"] = None
        # This season's EV minutes are rounded on their own and the window's added to them, so a
        # run that carries them over from the previous export (no stints: the daily full run)
        # writes exactly what the bundle refresh wrote, not a +-1 minute churn.
        if cur is not None:
            c_s, c_gp = cur.get(pid, (0.0, 0))
            c_min = round(c_s / 60)
        elif old.get("_same_season"):
            c_min, c_gp = int(round(float(old.get("toi_cur") or 0))), int(old.get("gp_cur") or 0)
        else:
            c_min, c_gp = 0, 0
        h_s, h_gp = hist.get(pid, (0.0, 0))
        base.append((pid, name, team, pos, grp, pid in roster, rated, rates, round(h_s / 60) + c_min, h_gp + c_gp,
                     c_min, c_gp))
    ref = [(b[7], b[4]) for b in base if b[5] and b[6]]
    means = position_means([r for r, _ in ref], [g for _, g in ref])
    if is4:
        for b in base:
            for c in ("pd60", "pt60") + (("fin_pp",) if is5 else ()):
                if b[7].get(c) is None:
                    b[7][c] = means[b[4]].get(c, 0.0)
    rows = []
    for pid, name, team, pos, grp, ros, rated, r, toi, gp, c_min, c_gp in base:
        im = impact(r, means[grp], weights, k, pen_value)
        rd = lambda x, n=3: round(float(x), n) + 0.0  # noqa: E731
        off, dfn, fin = rd(r["ev_off"]), rd(r["ev_def"]), rd(r["fin"])
        rows.append([pid, name, team, pos, ros, rated, rd(im["impact"], 2), rd(im["off_impact"], 2),
                     rd(im["def_impact"], 2), rd(im["sd"], 2), off, dfn, rd(r["pp_off"]), rd(r["pk_def"]), fin,
                     rd(r["toi_ev_gp"], 2), rd(r["toi_pp_gp"], 2), rd(r["toi_pk_gp"], 2),
                     off, dfn, rd(off + dfn), rd(off + fin), toi, gp, c_min, c_gp]
                    + ([rd(im["pen_impact"], 2), rd(r["pd60"]), rd(r["pt60"]), rd(r["spm_off"]), rd(r["spm_def"]),
                        rd(r["spm_pp"]), rd(r["spm_pk"])] if is4 else [])
                    + ([rd(r["fin_pp"])] if is5 else []))
    rows.sort(key=lambda r: (-r[6], r[1]))
    now = now or datetime.now(timezone.utc)
    v5meta = {"pen_units": meta.get("pen_units"), "pen_t0": meta.get("pen_t0"), "fin_pp": meta.get("fin_pp")} if is5 else {}
    return {
        "version": RATINGS_VERSION if is4 else 3, "kind": "player_ratings",
        "model": MODEL_V5 if is5 else MODEL_V4 if is4 else MODEL,
        "season": season, "season_label": season_label(season),
        "as_of": meta.get("max_source_date") or bundle.get("max_source_date"),
        "bundle_built_at": bundle.get("built_at"), "season_games": int(bundle.get("n_games") or 0),
        "window": (sample or {}).get("window") or prior_seasons(season),
        "impact": {"games": GAMES, "goals_per_xg": round(k, 4), "weights": weights,
                   "baseline": "position average (F / D): every per-60 rate centred on its TOI-weighted mean "
                               "among rated roster skaters of the group",
                   "position_means": {g: {kk: round(v, 4) for kk, v in m.items()} for g, m in means.items()},
                   "recency": meta.get("recency"), "g": meta.get("g"),
                   **({"pen_value": round(pen_value, 4), "spm_coef": meta.get("spm_coef")} if is4 else {}), **v5meta},
        "units": UNITS_V5 if is5 else UNITS_V4 if is4 else UNITS, "generated_at": now.isoformat(timespec="seconds"),
        "columns": COLUMNS_V5 if is5 else COLUMNS_V4 if is4 else COLUMNS, "rows": rows,
    }


def summary(doc: dict) -> dict:
    cols = doc["columns"]
    rows = [dict(zip(cols, r)) for r in doc["rows"]]
    ros = [r for r in rows if r["roster"]]
    return {"rows": len(rows), "roster_skaters": len(ros), "roster_rated": sum(r["rated"] for r in ros),
            "roster_named": sum(bool(r["name"]) for r in ros), "teams": len({r["team"] for r in ros}),
            "as_of": doc.get("as_of"), "season": doc.get("season")}


def _content(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k not in VOLATILE}


def write_if_changed(doc: dict, path: str = PUBLIC_FILE) -> bool:
    old = _read_json(path)
    if isinstance(old, dict) and _content(old) == _content(doc):
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    os.replace(tmp, path)
    return True


def export(bundle_path: str = BUNDLE, out_path: str = PUBLIC_FILE, state_root: str | None = None,
           fetch_rosters: bool = False, season: str | None = None, log=print) -> dict:
    """Build and (when changed) write the site file.  Returns the summary plus ``written``.
    Raises when the result would not be a usable file (no bundle, too few roster skaters)."""
    with gzip.open(bundle_path, "rt") as f:
        bundle = json.load(f)
    season = str(season or bundle["season"])
    if str(bundle["season"]) != season:
        raise RuntimeError(f"bundle is for season {bundle['season']}, not {season}")
    sp = sample_path(season)
    sample = _read_gz(sp) if os.path.exists(sp) else None
    if sample is None:
        log(f"  [ratings] no {os.path.relpath(sp, PIPELINE_DIR)}: sample = this season only")
    roster = roster_table(state_root, season, fetch=fetch_rosters)
    if roster is None:
        log("  [ratings] no roster source: keeping the previous export's roster flags")
    cur = current_sample(state_root, season)
    prev = _read_json(out_path)
    doc = build_export(bundle, sample, roster, cur, prev)
    s = summary(doc)
    if s["roster_named"] < MIN_ROSTER_SKATERS:
        raise RuntimeError(f"only {s['roster_named']} named roster skaters (< {MIN_ROSTER_SKATERS}); not written")
    s["written"] = write_if_changed(doc, out_path)
    log(f"  [ratings] {s['roster_skaters']} roster skaters ({s['roster_rated']} rated), {s['rows']} rows, "
        f"as of {s['as_of']}: {'written' if s['written'] else 'unchanged'} {os.path.relpath(out_path, REPO_ROOT)}")
    return s


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bu.lineup.ratings_export", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["export", "sample"])
    ap.add_argument("--bundle", default=BUNDLE)
    ap.add_argument("--out", default=PUBLIC_FILE, help="export: the site file")
    ap.add_argument("--state", default=None, help="export: RAPM state dir of the refresh (<lake>/state/rapm)")
    ap.add_argument("--fetch-rosters", action="store_true", help="export: call the NHL roster endpoint "
                    "when the state has no crosswalk (cached under --state, a temp dir by default)")
    ap.add_argument("--season", default=None)
    ap.add_argument("--lake-dir", default=None, help="sample: the full lake")
    ap.add_argument("--rapm-out", default=None, help="sample: RAPM state dir with the stints cache")
    ap.add_argument("--xg", default="v1", help="sample: stints cache source key (EV time does not depend on it)")
    a = ap.parse_args(argv)
    if a.command == "sample":
        from bu.lake.paths import Lake
        from bu.rapm.paths import RapmPaths
        season = str(a.season or _season())
        paths = RapmPaths(Lake(a.lake_dir), a.rapm_out)
        doc = build_sample(paths, season, a.xg)
        p = sample_path(season)
        os.makedirs(OUT_DIR, exist_ok=True)
        with gzip.open(p + ".tmp", "wt") as f:
            json.dump(doc, f, separators=(",", ":"))
        os.replace(p + ".tmp", p)
        print(f"  [sample] {season}: window {doc['window']}, {len(doc['sample']['rows']):,} skaters, "
              f"{len(doc['players']['rows']):,} named players -> {p}")
        return 0
    state = a.state
    tmp = None
    if a.fetch_rosters and not state:
        import tempfile
        tmp = tempfile.mkdtemp(prefix="ponyxg-ratings-")
        state = tmp
    try:
        s = export(a.bundle, a.out, state, a.fetch_rosters, a.season)
    except Exception as e:
        print(f"  [ratings] FAILED: {type(e).__name__}: {e}")
        return 1
    finally:
        if tmp:
            import shutil
            shutil.rmtree(tmp, ignore_errors=True)
    print(json.dumps(s))
    return 0


if __name__ == "__main__":
    sys.exit(main())
