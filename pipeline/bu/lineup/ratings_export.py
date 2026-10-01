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

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE_DIR = os.path.dirname(os.path.dirname(HERE))
REPO_ROOT = os.path.dirname(PIPELINE_DIR)
OUT_DIR = os.path.join(HERE, "out")
BUNDLE = os.path.join(OUT_DIR, "serving_bundle.json.gz")
PUBLIC_FILE = os.path.join(REPO_ROOT, "public", "data", "player_ratings.json")

VERSION = 1                 # player sample file
RATINGS_VERSION = 2         # site file; 2: def = xGA/60 prevented (-d), net = off + def
WINDOW = 3                  # completed seasons in the sample before the current one
MIN_ROSTER_SKATERS = 600    # an export with fewer named roster skaters is not written
COLUMNS = ["id", "name", "team", "pos", "roster", "rated", "off", "def", "net", "toi", "gp", "toi_cur", "gp_cur",
           "fin", "off_total"]
# fin       finishing talent (bu.rapm.finishing): shrunk EV goals above xG per 60 from the player's own
#           shots, decayed over seasons; season-start state out/fin_pack_<S>.json.gz + this season's
#           games from the refresh's xG / stints caches
# off_total off + fin (both EV, per 60): xG impact plus finishing
VOLATILE = ("generated_at",)
MODEL = "RAPM v2 (EV, xG v2 target)"


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


def current_fin(state_root: str | None, season: str, log=print):
    """(FinState, counted this season's games) from ``out/fin_pack_<season>.json.gz`` plus the
    season's games in the refresh's caches (``<state>/xg`` for the shooter's goals and xG,
    ``<state>/stints`` for EV time); (None, False) without a pack for the season."""
    from bu.rapm import finishing as FN
    st = FN.read_pack(FN.pack_path(season))
    if st is None:
        log(f"  [ratings] no fin_pack_{season}.json.gz: fin carried over / 0")
        return None, False
    st.roll(season)
    if not state_root:
        return st, False
    xp = os.path.join(state_root, "xg", f"season={season}.parquet")
    sp = os.path.join(state_root, "stints", f"season={season}.parquet")
    if not (os.path.exists(xp) and os.path.exists(sp)):
        return st, False
    import pandas as pd
    from .toi import game_shares
    stints = pd.read_parquet(sp)
    stints = stints[stints["game_type"].isin([2, 3])]
    xg = pd.read_parquet(xp)
    st.add_games(FN.player_games(xg[xg["game_id"].isin(set(stints["game_id"]))], game_shares(stints)))
    return st, True


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


def build_export(bundle: dict, sample: dict | None, roster: dict | None, cur: dict | None,
                 prev: dict | None = None, now: datetime | None = None, fin=None,
                 fin_current: bool = False) -> dict:
    """The site file from the bundle, the season's sample file, the current rosters and this
    season's EV sample (see the module docstring for the fallbacks)."""
    season = str(bundle["season"])
    cols = bundle["players"]["columns"]
    ratings = {int(r[cols.index("player_id")]): (float(r[cols.index("o")]), float(r[cols.index("d")]),
                                                  bool(r[cols.index("rated")]))
               for r in bundle["players"]["rows"]}
    rookie = {g: tuple(v) for g, v in (bundle.get("rookie") or {}).items()}
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

    rows = []
    for pid in sorted(set(ratings) | set(roster)):
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
        if pid in ratings:
            o, d, rated = ratings[pid]
        else:
            o, d = rookie.get("D" if pos == "D" else "F", (0.0, 0.0))
            rated = False
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
        # FIN: this season's games counted when the refresh's caches are there; otherwise the
        # previous export's value of the same season (no churn on a run without them), else the
        # season-start pack alone
        if fin is not None and (fin_current or not old.get("_same_season") or old.get("fin") is None):
            f_ = round(fin.fin(pid, "D" if pos == "D" else "F"), 3) + 0.0
        elif old.get("_same_season") and old.get("fin") is not None:
            f_ = float(old["fin"])
        else:
            f_ = 0.0
        # Presented higher = better: def = xGA/60 prevented (-d); net = off + def = o - d;
        # off_total = off + fin (xG impact plus finishing, both EV per 60).
        rows.append([pid, name, team, pos, pid in roster, bool(rated), round(o, 3), round(-d, 3) + 0.0, round(o - d, 3),
                     round(h_s / 60) + c_min, h_gp + c_gp, c_min, c_gp, f_, round(round(o, 3) + f_, 3) + 0.0])
    rows.sort(key=lambda r: (-r[8], r[1]))
    now = now or datetime.now(timezone.utc)
    return {
        "version": RATINGS_VERSION, "kind": "player_ratings", "model": MODEL,
        "season": season, "season_label": season_label(season),
        "as_of": bundle.get("max_source_date"), "bundle_built_at": bundle.get("built_at"),
        "season_games": int(bundle.get("n_games") or 0),
        "window": (sample or {}).get("window") or prior_seasons(season),
        "units": {"off": "EV xGF/60 vs average (higher is better)",
                  "def": "EV xGA/60 prevented vs average (higher is better)", "net": "off + def",
                  "toi": "EV minutes, window seasons + this season", "gp": "games, same span",
                  "fin": "EV goals above xG per 60 from own shots, shrunk (higher is better)",
                  "off_total": "off + fin"},
        "generated_at": now.isoformat(timespec="seconds"),
        "columns": COLUMNS, "rows": rows,
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
    fin, fin_current = current_fin(state_root, season, log)
    doc = build_export(bundle, sample, roster, cur, prev, fin=fin, fin_current=fin_current)
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
