"""
validate_outputs.py — data-contract gate that runs before the workflow commits.

    python validate_outputs.py                 # all checks, exit 1 on any error
    python validate_outputs.py --offline       # skip the roster (network) check
    python validate_outputs.py --allow placeholders,season_ids
                                               # downgrade named checks to warnings
    python validate_outputs.py --print-schema  # manifest JSON schema

Checks (each is named; ``--allow`` or $PONYXG_VALIDATE_ALLOW can downgrade one):

  manifest       public/data/manifest.json matches MANIFEST_SCHEMA
  predictions    predictions_detailed.csv (data/ and public/data/) has the core
                 columns; schema v2 rows (schema_version=2) carry this season's
                 season_id and an ISO-8601 UTC start_time_utc
  placeholders   no neutral placeholder context (PP and PK rank both 16 with an
                 empty '0-0-0' L7, or any rank for a team with 0 GP in v2)
  after_start    no game got a win% for the first time after its puck drop
                 (compared with the last committed CSV)
  teams          32 teams in player_impact.json (>= 700 players), team_goalies.json
                 and every nhl_teams.csv copy; the copies agree on NHL Team IDs
  goalies        team_goalies.json == the goalies on each current NHL roster
  season_ids     season_id agrees across manifest, season_projections,
                 clinch_status and game_implications (where present)
  odds           odds.json: 10-digit gameId keys, no line fetched at/after start,
                 totals in [4.5, 9.5], puck-line prices within +-1000;
                 odds_closing.json keyed by gameId
  gamestats      every gamestats row is game type 02/03 and belongs to the
                 season its file is named for (the data/ and public/data/
                 mirrors must be this season and carry xga_non_en)
  reports        model_report.json / bet_ledger.json are not older than the
                 graded record, report n per season == graded live games, and
                 no ledger bet is pending on a graded game
  graded         every final with a pregame SiteHistory snapshot is graded; every
                 other clean-start-season final is listed in not_graded
  fair_odds      *_model_odds / *_blend_odds are the fair lines of the model-only
                 and published % (within 1 cent)
  sim_markets    game-simulator columns (bu/sim): every pregame row has a sim_status; each
                 market's percentages (regulation 3-way, puck line, total incl. push, 1st period
                 3-way and 2-way) lie in [0, 100], sum to 100.0 and are never NaN; an EV is set
                 exactly when its price is (pushes handled) and is never gate-open (INFO ONLY)
  model_independent
                 every predicted row has its own model-only % and model_version,
                 and that % is rebuilt from the row's factor breakdown (so a
                 model % equal to the market % is a coincidence, not a copy)
  winpct_engine  every pregame row names the engine of its model % (sim / logit) and logs the
                 logit's own %; a sim row was simulated, carries the simulator version and its
                 model % is the simulated %; a logit row's model % is the logit's
  goal_splits    current-season goals_ev + goals_pp + goals_sh + emptynet_goalsfor == goals_for
  bu_bundle      when the live game model uses the RAPM v2 lineup term: its serving bundle
                 (bu/lineup/out/serving_bundle.json.gz) is readable, carries the model's
                 columns, was built after its source data and, when fresh, is of this season
                 (age: manifest stale flag; with a stale bundle the F1 rollback model is published)
  player_ratings public/data/player_ratings.json (ratings v3: impact headline + per-60 rates): every row named,
                 >= 600 current-roster skaters on >= 28 teams, v2 signs (def = xGA/60 prevented,
                 higher = better; net = off + def), same season as
                 the serving bundle and at most 3 days behind its max_source_date

``--freshness`` instead only checks that manifest.generated_at is under 26 h
old during the season (the daily freshness workflow).

Runs in well under 10 s (the roster check is 32 parallel requests).
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
if PIPELINE_DIR not in sys.path:
    sys.path.insert(0, PIPELINE_DIR)

from paths import REPO_ROOT, PUBLIC_DATA_DIR, DATA_DIR, MANIFEST_FILE  # noqa: E402
from season import SEASON_ID, START_YEAR, season_file  # noqa: E402

ISO_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
GAME_ID = re.compile(r"^\d{10}$")

MANIFEST_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "pony xG pipeline manifest",
    "type": "object",
    "required": ["schema_version", "season_id", "generated_at", "mode",
                 "games_played_current_season", "stages", "stale"],
    "properties": {
        "schema_version": {"type": "integer", "minimum": 1},
        "season_id": {"type": "string", "pattern": r"^\d{8}$"},
        "season_label": {"type": "string"},
        "generated_at": {"type": "string", "pattern": ISO_Z.pattern},
        "mode": {"type": "string", "enum": ["full", "lite"]},
        "games_played_current_season": {"type": "integer", "minimum": 0},
        "ok": {"type": "boolean"},
        "phase": {"type": "object"},
        "stages": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "required": ["stage", "status", "rows_written", "seconds"],
                "properties": {
                    "stage": {"type": "string"},
                    "status": {"type": "string", "enum": ["ok", "skip", "fail"]},
                    "rows_written": {"type": "integer", "minimum": 0},
                    "seconds": {"type": "number", "minimum": 0},
                    "required": {"type": "boolean"},
                },
            },
        },
        "stale": {"type": "object", "additionalProperties": {"type": "string"}},
        "sources": {"type": "object"},
    },
}


# ── tiny JSON-schema subset (type/required/properties/items/enum/pattern/min) ─

_TYPES = {"object": dict, "array": list, "string": str, "boolean": bool, "number": (int, float)}


def schema_errors(value, schema, path="$"):
    errs = []
    t = schema.get("type")
    if t == "integer":
        ok = isinstance(value, int) and not isinstance(value, bool)
    elif t == "number":
        ok = isinstance(value, (int, float)) and not isinstance(value, bool)
    elif t:
        ok = isinstance(value, _TYPES[t])
    else:
        ok = True
    if not ok:
        return [f"{path}: expected {t}, got {type(value).__name__}"]
    if "enum" in schema and value not in schema["enum"]:
        errs.append(f"{path}: {value!r} not in {schema['enum']}")
    if "pattern" in schema and isinstance(value, str) and not re.match(schema["pattern"], value):
        errs.append(f"{path}: {value!r} does not match {schema['pattern']}")
    if "minimum" in schema and isinstance(value, (int, float)) and value < schema["minimum"]:
        errs.append(f"{path}: {value} < {schema['minimum']}")
    if isinstance(value, dict):
        for k in schema.get("required", []):
            if k not in value:
                errs.append(f"{path}: missing '{k}'")
        for k, sub in (schema.get("properties") or {}).items():
            if k in value:
                errs.extend(schema_errors(value[k], sub, f"{path}.{k}"))
        extra = schema.get("additionalProperties")
        if isinstance(extra, dict):
            for k, v in value.items():
                if k not in (schema.get("properties") or {}):
                    errs.extend(schema_errors(v, extra, f"{path}.{k}"))
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            errs.append(f"{path}: {len(value)} items < {schema['minItems']}")
        if "items" in schema:
            for i, v in enumerate(value):
                errs.extend(schema_errors(v, schema["items"], f"{path}[{i}]"))
    return errs


# ── helpers ──────────────────────────────────────────────────────────────────

def _json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _rows(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _dt(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _committed(relpath):
    """File content at HEAD (the last committed version), or None."""
    try:
        out = subprocess.run(["git", "show", f"HEAD:{relpath}"], cwd=REPO_ROOT,
                             capture_output=True, timeout=10)
        return out.stdout.decode("utf-8") if out.returncode == 0 else None
    except Exception:
        return None


def _blank(v):
    return v is None or str(v).strip() in ("", "nan", "None", "null")


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


PRED_FILES = [os.path.join(DATA_DIR, "predictions_detailed.csv"),
              os.path.join(PUBLIC_DATA_DIR, "predictions_detailed.csv")]
PRED_CORE = ["game_date", "game_id", "home_team", "away_team", "home_win_pct", "away_win_pct"]


# ── checks: each returns a list of problem strings ───────────────────────────

def check_manifest(ctx):
    m = _json(ctx.get("manifest_file", MANIFEST_FILE))
    if m is None:
        return ["manifest.json missing or not JSON"]
    errs = schema_errors(m, MANIFEST_SCHEMA)
    if m.get("ok") is False:
        failed = [s["stage"] for s in m.get("stages", []) if s.get("required") and s.get("status") == "fail"]
        errs.append(f"manifest reports failed required stage(s): {failed}")
    return errs


def check_predictions(ctx):
    errs = []
    for path in PRED_FILES:
        if not os.path.exists(path):
            continue
        name = os.path.relpath(path, REPO_ROOT)
        rows = _rows(path)
        if not rows:
            continue
        missing = [c for c in PRED_CORE if c not in rows[0]]
        if missing:
            errs.append(f"{name}: missing columns {missing}")
            continue
        if "schema_version" in rows[0]:
            for r in rows:
                gid = r.get("game_id")
                if str(r.get("schema_version")).split(".")[0] != "2":
                    errs.append(f"{name} {gid}: schema_version {r.get('schema_version')!r} != 2")
                if "season_id" in r and str(r["season_id"]).split(".")[0] != SEASON_ID:
                    errs.append(f"{name} {gid}: season_id {r['season_id']} != {SEASON_ID}")
                if "start_time_utc" in r and not ISO_Z.match(str(r["start_time_utc"])):
                    errs.append(f"{name} {gid}: start_time_utc {r['start_time_utc']!r} is not ISO-8601 UTC")
                if "game_type" in r and not _blank(r["game_type"]) and \
                        str(r["game_type"]).split(".")[0].zfill(2) not in ("02", "03"):
                    errs.append(f"{name} {gid}: game_type {r['game_type']}")
    return errs


def check_placeholders(ctx):
    errs = []
    for path in PRED_FILES:
        if not os.path.exists(path):
            continue
        name = os.path.relpath(path, REPO_ROOT)
        for r in _rows(path):
            for side in ("home", "away"):
                pp, pk = _num(r.get(f"{side}_pp_rank")), _num(r.get(f"{side}_pk_rank"))
                l7 = str(r.get(f"{side}_l7") or "").strip()
                gp = _num(r.get(f"{side}_gp"))
                if pp == 16 and pk == 16 and l7 in ("0-0-0", ""):
                    errs.append(f"{name} {r.get('game_id')}: {side} PP/PK rank 16/16 with L7 "
                                f"{l7 or 'empty'} (neutral placeholder)")
                elif gp == 0 and (pp is not None or pk is not None):
                    errs.append(f"{name} {r.get('game_id')}: {side} has 0 GP but PP/PK rank {pp}/{pk}")
    return errs


def _start(r):
    st = _dt(r.get("start_time_utc"))
    if st:
        return st
    # v1 rows: game_date + 'HH:MM AM' in US Central (predict_games' display clock)
    try:
        from zoneinfo import ZoneInfo
        local = datetime.strptime(f"{r['game_date']} {r['game_start_time']}", "%Y-%m-%d %I:%M %p")
        return local.replace(tzinfo=ZoneInfo("America/Chicago")).astimezone(timezone.utc)
    except Exception:
        return None


def check_after_start(ctx):
    """A row with a win% whose game has started must already have had that
    win% in the last committed CSV (i.e. it was predicted pregame and frozen)."""
    now = ctx.get("now") or datetime.now(timezone.utc)
    rel = "data/predictions_detailed.csv"
    path = os.path.join(REPO_ROOT, rel)
    if not os.path.exists(path):
        return []
    base_txt = ctx["baseline"].get(rel) if "baseline" in ctx else _committed(rel)
    base = {r.get("game_id"): r for r in csv.DictReader(io.StringIO(base_txt))} if base_txt else {}
    errs = []
    for r in _rows(path):
        if _blank(r.get("home_win_pct")) or (r.get("prediction_status") or "") == "no_pregame_prediction":
            continue
        st = _start(r)
        if not st or st > now:
            continue
        prev = base.get(r.get("game_id"))
        if prev is None or _blank(prev.get("home_win_pct")):
            errs.append(f"{r.get('game_id')}: win% first written after puck drop ({st.isoformat()})")
        elif _num(prev.get("home_win_pct")) != _num(r.get("home_win_pct")):
            errs.append(f"{r.get('game_id')}: win% changed after puck drop "
                        f"({prev.get('home_win_pct')} -> {r.get('home_win_pct')})")
    return errs


def check_teams(ctx):
    errs = []
    for path in (os.path.join(PIPELINE_DIR, "player_impact.json"),
                 os.path.join(PUBLIC_DATA_DIR, "player_impact.json")):
        d = _json(path, {}) or {}
        teams = {v.get("team") for v in d.values() if isinstance(v, dict) and v.get("team")}
        if len(teams) != 32 or len(d) < 700:
            errs.append(f"{os.path.relpath(path, REPO_ROOT)}: {len(teams)} teams, {len(d)} players "
                        "(need 32 teams, >= 700 players)")
    tg = _json(os.path.join(PUBLIC_DATA_DIR, "team_goalies.json"), {}) or {}
    empty = [t for t, g in tg.items() if not g]
    if len(tg) != 32 or empty:
        errs.append(f"team_goalies.json: {len(tg)} teams, empty for {empty}")
    ids = {}
    for path in (os.path.join(PIPELINE_DIR, "nhl_teams.csv"), os.path.join(DATA_DIR, "nhl_teams.csv"),
                 os.path.join(PUBLIC_DATA_DIR, "nhl_teams.csv")):
        if not os.path.exists(path):
            continue
        rows = _rows(path)
        name = os.path.relpath(path, REPO_ROOT)
        if len(rows) != 32:
            errs.append(f"{name}: {len(rows)} teams")
        for r in rows:
            tri = r.get("Team Tricode") or r.get("triCode")
            ids.setdefault(tri, {})[name] = r.get("NHL Team ID")
    for tri, by_file in sorted(ids.items()):
        if len(set(by_file.values())) > 1:
            errs.append(f"nhl_teams.csv copies disagree on {tri} NHL Team ID: {by_file}")
    return errs


def check_goalies(ctx):
    if ctx.get("offline"):
        return []
    from http_utils import try_get_json
    from fetch_player_bio import NHL_TEAMS, player_display_name
    tg = _json(os.path.join(PUBLIC_DATA_DIR, "team_goalies.json"), {}) or {}

    def roster(tri):
        d = try_get_json(f"https://api-web.nhle.com/v1/roster/{tri}/current", ua="plain", retries=2, timeout=8)
        return tri, d

    with ThreadPoolExecutor(max_workers=8) as ex:
        rosters = dict(ex.map(roster, NHL_TEAMS))
    errs = []
    for tri, data in sorted(rosters.items()):
        if not data:
            continue      # roster API unavailable: can't judge, don't block the commit
        want = {player_display_name(g) for g in data.get("goalies", []) or []}
        have = set(tg.get(tri) or [])
        if want and have != want:
            errs.append(f"team_goalies {tri}: {sorted(have)} != roster {sorted(want)}")
    return errs


def _season_of(obj):
    if isinstance(obj, dict):
        v = obj.get("season_id") or obj.get("seasonId")
        return str(v) if v else None
    return None


def check_season_ids(ctx):
    files = {
        "manifest.json": MANIFEST_FILE,
        "season_projections.json": os.path.join(PUBLIC_DATA_DIR, "season_projections.json"),
        "clinch_status.json": os.path.join(PUBLIC_DATA_DIR, "clinch_status.json"),
        "game_implications.json": os.path.join(PUBLIC_DATA_DIR, "game_implications.json"),
    }
    errs = []
    for name, path in files.items():
        sid = _season_of(_json(path))
        if sid is not None and sid != SEASON_ID:
            errs.append(f"{name}: season_id {sid} != {SEASON_ID}")
    impl = _json(files["game_implications.json"]) or {}
    for g in (impl.get("games") or []) if isinstance(impl, dict) else []:
        gid = str(g.get("game_id") or "")
        if GAME_ID.match(gid) and gid[:4] != SEASON_ID[:4]:
            errs.append(f"game_implications.json: game {gid} is not from {SEASON_ID}")
            break
    return errs


def check_odds(ctx):
    from fetch_odds import sanity_problems
    errs = []
    for path in (os.path.join(PIPELINE_DIR, "odds.json"), os.path.join(PUBLIC_DATA_DIR, "odds.json")):
        d = _json(path)
        if d is None:
            continue
        name = os.path.relpath(path, REPO_ROOT)
        if not isinstance(d, dict):
            errs.append(f"{name}: not an object")
            continue
        for k, e in d.items():
            if not GAME_ID.match(str(k)):
                errs.append(f"{name}: key {k!r} is not a 10-digit NHL gameId")
                continue
            for p in sanity_problems(e) if isinstance(e, dict) else ["not an object"]:
                errs.append(f"{name} {k}: {p}")
    closing = _json(os.path.join(PUBLIC_DATA_DIR, "odds_closing.json"))
    if isinstance(closing, dict):
        bad = [k for k in closing if not GAME_ID.match(str(k))]
        if bad:
            errs.append(f"odds_closing.json: non-gameId keys {bad[:5]}")
    return errs


def _gamestats_problems(path, start_year):
    name = os.path.relpath(path, REPO_ROOT)
    bad_type, bad_season, n = 0, 0, 0
    with open(path, newline="", encoding="utf-8") as f:
        rd = csv.reader(f)
        header = next(rd, None)
        if not header or "game_id" not in header:
            return [f"{name}: no game_id column"]
        i = header.index("game_id")
        for row in rd:
            if len(row) <= i:
                continue
            n += 1
            gid = row[i].split(".")[0]
            if gid[4:6] not in ("02", "03"):
                bad_type += 1
            if gid[:4] != str(start_year):
                bad_season += 1
    errs = []
    if bad_type:
        errs.append(f"{name}: {bad_type}/{n} rows are not game type 02/03")
    if bad_season:
        errs.append(f"{name}: {bad_season}/{n} rows are not from the {start_year}-{start_year + 1} season")
    return errs


def check_gamestats(ctx):
    errs = []
    for fn in sorted(os.listdir(PIPELINE_DIR)):
        m = re.match(r"^nhl_season_(\d{4})_\d{4}_gamestats\.csv$", fn)
        if m:
            errs += _gamestats_problems(os.path.join(PIPELINE_DIR, fn), int(m.group(1)))
    for path in (os.path.join(DATA_DIR, "gamestats.csv"), os.path.join(PUBLIC_DATA_DIR, "gamestats.csv")):
        if os.path.exists(path):
            errs += _gamestats_problems(path, START_YEAR)
            # Team GSAx on the site uses xga_non_en (empty-net shots excluded);
            # a mirror without it silently falls back to all-situations xGA.
            with open(path, newline="", encoding="utf-8") as f:
                header = next(csv.reader(f), None) or []
            if len(header) > 1 and "xga_non_en" not in header:
                errs.append(f"{os.path.relpath(path, REPO_ROOT)}: missing xga_non_en (team GSAx would count empty-net xG)")
    return errs


HISTORY_FILE = os.path.join(DATA_DIR, "prediction_history.json")
HISTORY_META_FILE = os.path.join(DATA_DIR, "prediction_history_meta.json")
REPORT_FILE = os.path.join(PUBLIC_DATA_DIR, "model_report.json")
LEDGER_FILE = os.path.join(PUBLIC_DATA_DIR, "bet_ledger.json")
EARLIEST_FINAL_HOURS = 2.0   # no NHL game is final less than 2 h after puck drop


def _history_season(r):
    if r.get("season"):
        return r["season"]
    y = int(str(r["gameId"])[:4])
    return f"{y}-{str(y + 1)[2:]}"


def check_reports(ctx):
    """model_report.json and bet_ledger.json are rebuilt after the graded record:
    (a) neither is older than the last change to prediction_history (meta
    graded_changed_at, else the newest graded start + 2 h); (b) each season's
    live-game count equals prediction_history's; (c) no ledger bet is 'pending'
    on a game that is already graded (final)."""
    hist = _json(ctx.get("history_file", HISTORY_FILE))
    if not isinstance(hist, list):
        return ["data/prediction_history.json missing or not a list"]
    rep = _json(ctx.get("report_file", REPORT_FILE))
    led = _json(ctx.get("ledger_file", LEDGER_FILE))
    meta = _json(ctx.get("history_meta_file", HISTORY_META_FILE), {}) or {}
    errs = []
    if not isinstance(rep, dict):
        errs.append("public/data/model_report.json missing or not JSON")
    if not isinstance(led, dict):
        errs.append("public/data/bet_ledger.json missing or not JSON")
    if errs:
        return errs
    ref = _dt(meta.get("graded_changed_at"))
    ref_what = f"prediction_history changed at {meta.get('graded_changed_at')}"
    if ref is None:
        starts = [_dt(r.get("startUtc")) for r in hist if not r.get("retro")]
        starts = [s for s in starts if s]
        if starts:
            from datetime import timedelta
            ref = max(starts) + timedelta(hours=EARLIEST_FINAL_HOURS)
            ref_what = f"newest graded game final no earlier than {ref.isoformat()}"
    for name, obj in (("model_report.json", rep), ("bet_ledger.json", led)):
        gen = _dt(obj.get("generated_at"))
        if gen is None:
            errs.append(f"{name}: generated_at {obj.get('generated_at')!r} is not a timestamp")
        elif ref is not None and gen < ref:
            errs.append(f"{name}: generated_at {obj.get('generated_at')} is older than the graded record "
                        f"({ref_what}); rerun model_report.py / grade_bets.py")
    live = {}
    for r in hist:
        if not r.get("retro"):
            s = _history_season(r)
            live[s] = live.get(s, 0) + 1
    seasons = rep.get("seasons") or {}
    for s in sorted(set(live) | {rep.get("current_season")} - {None}):
        n = ((seasons.get(s) or {}).get("all") or {}).get("n")
        if n != live.get(s, 0):
            errs.append(f"model_report.json seasons[{s}].all.n = {n} but prediction_history has "
                        f"{live.get(s, 0)} graded live games")
    final_ids = {int(r["gameId"]) for r in hist if r.get("gameId") is not None}
    for s, v in (led.get("seasons") or {}).items():
        for b in (v or {}).get("bets") or []:
            if b.get("result") == "pending" and int(b.get("gameId") or 0) in final_ids:
                errs.append(f"bet_ledger.json {s}: bet on {b.get('team')} ({b.get('gameId')}) is pending "
                            f"but the game is graded in prediction_history")
    return errs


def check_graded(ctx):
    """Every final (current-season gamestats) game with a pregame SiteHistory
    snapshot is graded in prediction_history, and every final of a clean-start
    season is either graded or listed in prediction_history_meta.not_graded."""
    import site_history as S
    from season import read_season_csv
    hist = _json(ctx.get("history_file", HISTORY_FILE))
    if not isinstance(hist, list):
        return ["data/prediction_history.json missing or not a list"]
    graded = {int(r["gameId"]) for r in hist if r.get("gameId") is not None}
    meta = _json(ctx.get("history_meta_file", HISTORY_META_FILE), {}) or {}
    listed = {int(g["gameId"]): g.get("reason") for g in meta.get("not_graded") or [] if g.get("gameId")}
    gs = ctx["gamestats"] if "gamestats" in ctx else read_season_csv("gamestats")
    if gs is None or len(gs) == 0:
        return []
    finals = sorted({int(str(g).split(".")[0]) for g in gs["game_id"]
                     if str(g).split(".")[0][4:6] in ("02", "03")})
    sh = ctx.get("site_history")
    if sh is None:
        sh, _ = S.load_keyed_site_history(allow_fetch=False)
    pre = set()
    if len(sh):
        p = S.pregame(sh)
        pre = {int(x) for x in p["game_id"].dropna()}
    errs = []
    for gid in finals:
        if gid in graded:
            continue
        if gid in pre and listed.get(gid) != "snapshot_after_start":
            errs.append(f"{gid}: final with a pregame SiteHistory snapshot but not in prediction_history")
        elif gid not in listed:
            errs.append(f"{gid}: final but neither graded nor listed in prediction_history_meta.not_graded")
    return errs


def check_fair_odds(ctx):
    """predictions_detailed.csv: *_model_odds is the fair American line of the
    model-only %, *_blend_odds the fair line of the published (blended) %,
    to within 1 cent (1 point of American odds)."""
    def fair(p):
        if abs(p - 0.5) < 1e-12:
            return 100.0
        return -(p / (1 - p)) * 100 if p > 0.5 else ((1 - p) / p) * 100

    errs = []
    for path in PRED_FILES:
        if not os.path.exists(path):
            continue
        name = os.path.relpath(path, REPO_ROOT)
        rows = _rows(path)
        if not rows or "home_model_odds" not in rows[0]:
            continue
        pairs = [("home_model_odds", "home_model_win_pct"), ("away_model_odds", "away_model_win_pct"),
                 ("home_blend_odds", "home_win_pct"), ("away_blend_odds", "away_win_pct")]
        for r in rows:
            for oc, pc in pairs:
                if oc not in r or pc not in r or _blank(r[oc]) or _blank(r[pc]):
                    continue
                o, p = _num(str(r[oc]).replace("+", "")), _num(str(r[pc]).replace("%", ""))
                if o is None or p is None or not 0 < p < 100:
                    continue
                want = fair(p / 100)
                if abs(o - want) > 1.0 + 1e-9:
                    errs.append(f"{name} {r.get('game_id')}: {oc} {o:+.0f} is not the fair line of "
                                f"{pc} {p} ({want:+.0f})")
        if "home_blend_odds" not in rows[0]:
            errs.append(f"{name}: missing home_blend_odds / away_blend_odds columns")
    return errs


SIM_GROUPS = {   # mutually exclusive outcomes of one market: their percentages sum to 100.0
    "reg3": ("home_reg_pct", "reg_tie_pct", "away_reg_pct"),
    "puckline": ("home_pl_pct", "away_pl_pct"),
    "total": ("over_pct", "total_push_pct", "under_pct"),
    "p1_3w": ("home_1p_pct", "p1_tie_pct", "away_1p_pct"),
    "p1_2w": ("home_1p_2w_pct", "away_1p_2w_pct"),
}
SIM_EV = ("home_reg_ev", "reg_tie_ev", "away_reg_ev", "home_pl_ev", "away_pl_ev", "over_ev", "under_ev",
          "home_1p_ev", "away_1p_ev", "home_1p3_ev", "p1_tie_ev", "away_1p3_ev")
SIM_PRICE_FOR_EV = {"home_reg_ev": "home_three_way", "reg_tie_ev": "three_way_tie", "away_reg_ev": "away_three_way",
                    "home_pl_ev": "home_puckline", "away_pl_ev": "away_puckline", "over_ev": "total_over",
                    "under_ev": "total_under", "home_1p_ev": "home_1p_ml", "away_1p_ev": "away_1p_ml",
                    "home_1p3_ev": "home_1p_three_way", "p1_tie_ev": "p1_three_way_tie",
                    "away_1p3_ev": "away_1p_three_way"}


def check_sim_markets(ctx):
    """predictions_detailed.csv game-simulator columns (bu/sim): every pregame / frozen row with a
    model has a simulator status; each market's percentages are in [0, 100] and sum to 100.0;
    an EV is present (finite) exactly when its posted price is, and is never gate-open (INFO
    ONLY until the live test); a half-goal puck line has no push and a whole total line can."""
    errs = []
    for path in PRED_FILES:
        if not os.path.exists(path):
            continue
        name = os.path.relpath(path, REPO_ROOT)
        rows = _rows(path)
        if not rows or "sim_status" not in rows[0]:
            continue
        for r in rows:
            gid = r.get("game_id")
            if r.get("prediction_status") not in ("pregame", "frozen") or _blank(r.get("home_win_pct")):
                continue
            if r.get("prediction_status") == "frozen" and _blank(r.get("sim_status")):
                continue      # frozen before the simulator shipped
            st = r.get("sim_status")
            if st not in ("sim", "poisson_fallback"):
                errs.append(f"{name} {gid}: sim_status {st!r}")
                continue
            for mkt, cols in SIM_GROUPS.items():
                vals = [_num(r.get(c)) for c in cols]
                if any(v is None or v != v for v in vals):
                    errs.append(f"{name} {gid}: {mkt} probabilities missing ({cols})")
                    continue
                if any(not 0 <= v <= 100 for v in vals):
                    errs.append(f"{name} {gid}: {mkt} probability out of [0, 100]: {vals}")
                if abs(sum(vals) - 100.0) > 0.051:
                    errs.append(f"{name} {gid}: {mkt} probabilities sum to {sum(vals):.2f}, not 100")
            spread = _num(r.get("sim_pl_spread"))
            if spread is None or abs(abs(spread) - round(abs(spread))) < 1e-9:
                errs.append(f"{name} {gid}: sim_pl_spread {r.get('sim_pl_spread')!r} is not a half-goal line")
            line = _num(r.get("sim_total_line"))
            push = _num(r.get("total_push_pct"))
            if line is None or not 3 <= line <= 12:
                errs.append(f"{name} {gid}: sim_total_line {r.get('sim_total_line')!r}")
            elif abs(line - round(line)) > 1e-9 and push not in (None, 0.0):
                errs.append(f"{name} {gid}: push {push} on a half-goal total {line}")
            for c in SIM_EV:
                pc = SIM_PRICE_FOR_EV[c]
                has_price = not _blank(r.get(pc)) and abs(_num(r.get(pc)) or 0) >= 100
                v = _num(r.get(c))
                if has_price and (v is None or v != v or not -1.0 <= v <= 20.0):
                    errs.append(f"{name} {gid}: {c} {r.get(c)!r} with price {r.get(pc)}")
                if not has_price and not _blank(r.get(c)):
                    errs.append(f"{name} {gid}: {c} set without a price")
            if str(r.get("sim_ev_gated")) != "False":
                errs.append(f"{name} {gid}: sim_ev_gated {r.get('sim_ev_gated')!r} (derivative EVs are INFO ONLY)")
            try:
                d = json.loads(r.get("sim_detail") or "")
                if not isinstance(d, dict) or len(d.get("total_hist") or []) != 16:
                    errs.append(f"{name} {gid}: sim_detail malformed")
            except ValueError:
                errs.append(f"{name} {gid}: sim_detail is not JSON")
            if st == "sim" and _blank(r.get("sim_home_win_pct")):
                errs.append(f"{name} {gid}: simulated row without sim_home_win_pct (shadow)")
    return errs


def check_winpct_engine(ctx):
    """predictions_detailed.csv win-% engine (contract v2.3): every pregame row says which engine
    made home_model_win_pct and logs the logit's own %. A 'sim' row was simulated (sim_status
    'sim'), carries the simulator's version and its model % is the raw simulated % (3-97% guard);
    a 'logit' row's model % is the logit's. Rows frozen before v2.3 are skipped."""
    errs = []
    for path in ctx.get("pred_files", PRED_FILES):
        if not os.path.exists(path):
            continue
        name = os.path.relpath(path, REPO_ROOT)
        rows = _rows(path)
        if not rows or "winpct_engine" not in rows[0]:
            continue
        for r in rows:
            st = r.get("prediction_status")
            if st not in ("pregame", "frozen") or _blank(r.get("home_win_pct")):
                continue
            eng = r.get("winpct_engine")
            if _blank(eng) and st == "frozen":
                continue
            gid = r.get("game_id")
            if eng not in ("sim", "logit"):
                errs.append(f"{name} {gid}: winpct_engine {eng!r}")
                continue
            pm, pl = _num(r.get("home_model_win_pct")), _num(r.get("logit_model_win_pct"))
            if pl is None or _num(r.get("logit_home_win_pct")) is None:
                errs.append(f"{name} {gid}: no logit shadow (logit_model_win_pct / logit_home_win_pct)")
                continue
            if eng == "logit":
                if pm is None or abs(pm - pl) > 0.051:
                    errs.append(f"{name} {gid}: logit engine but model % {pm} != logit % {pl}")
                continue
            ps = _num(r.get("sim_home_win_pct"))
            if r.get("sim_status") != "sim" or ps is None:
                errs.append(f"{name} {gid}: sim engine without a simulated game (sim_status {r.get('sim_status')!r})")
            elif pm is None or abs(pm - min(max(ps, 3.0), 97.0)) > 0.051:
                errs.append(f"{name} {gid}: sim engine but model % {pm} != simulated % {ps}")
            if not str(r.get("model_version") or "").startswith("sim-"):
                errs.append(f"{name} {gid}: sim engine with model_version {r.get('model_version')!r}")
    return errs


def model_pct_from_breakdown(row):
    """Home model-only win % rebuilt from the row's own factor breakdown, or None.

    home_wp_breakdown attributes the published % sequentially: the model's
    terms (each scaled by blend_weight w) come first, then one 'market' row
    worth (1 - w) * market logit. So after the model rows the running logit is
    w * model_logit, and the model-only % is sigmoid(that / w). This never
    touches the market price, so it proves the model % came from the model.
    """
    import math
    try:
        bd = json.loads(row.get("home_wp_breakdown") or "")
    except (TypeError, ValueError):
        return None
    if not isinstance(bd, list) or not bd:
        return None
    model_rows = [x for x in bd if x.get("factor") != "market"]
    has_market = len(model_rows) < len(bd)
    p_after = (50 + sum(float(x.get("wp_delta_pts") or 0) for x in model_rows)) / 100
    if not 0 < p_after < 1:
        return None
    if not has_market:
        return 100 * p_after
    w = _num(row.get("blend_weight"))
    if not w or not 0 < w <= 1:
        return None
    z = math.log(p_after / (1 - p_after)) / w
    return 100 / (1 + math.exp(-z))


# Rounding: breakdown deltas are 2-decimal and the market row can carry 80% of
# the weight, which amplifies the error by 1/w in logit space.
MODEL_REBUILD_TOL = 0.5


def check_model_independent(ctx):
    """Every predicted row has its own model % (never a copy of the market):
    home_model_win_pct must be present with a model_version and must be
    rebuildable from the model's factor breakdown. A model % that equals the
    de-vigged market % is fine when the factors reproduce it (a coincidence,
    e.g. TBL@NYR 2026-10-01 at 43.4%)."""
    errs = []
    for path in ctx.get("pred_files", PRED_FILES):
        if not os.path.exists(path):
            continue
        name = os.path.relpath(path, REPO_ROOT)
        for r in _rows(path):
            if r.get("prediction_status") not in ("pregame", "frozen") or _blank(r.get("home_win_pct")):
                continue
            gid = r.get("game_id")
            pm = _num(r.get("home_model_win_pct"))
            if pm is None:
                errs.append(f"{name} {gid}: published % without a model-only %")
                continue
            if _blank(r.get("model_version")):
                errs.append(f"{name} {gid}: model % without a model_version")
            rebuilt = model_pct_from_breakdown(r)
            if rebuilt is None:
                if r.get("prediction_status") == "pregame":
                    errs.append(f"{name} {gid}: model % {pm} has no factor breakdown to rebuild it from")
                continue      # legacy frozen rows predate the breakdown
            if abs(rebuilt - pm) > MODEL_REBUILD_TOL:
                errs.append(f"{name} {gid}: model % {pm} does not follow from its factors ({rebuilt:.1f}); "
                            f"market % is {r.get('home_vegas_win_pct')}")
    return errs


def check_gamestats_goals(ctx):
    """Current-season gamestats: goals_ev + goals_pp + goals_sh + emptynet_goalsfor == goals_for."""
    from season import read_season_csv
    gs = ctx["gamestats"] if "gamestats" in ctx else read_season_csv("gamestats")
    need = ("goals_ev", "goals_pp", "goals_sh", "goals_for")
    if gs is None or len(gs) == 0 or any(c not in gs.columns for c in need):
        return []
    en = gs["emptynet_goalsfor"].fillna(0) if "emptynet_goalsfor" in gs.columns else 0
    tot = gs["goals_ev"].fillna(0) + gs["goals_pp"].fillna(0) + gs["goals_sh"].fillna(0) + en
    # goals_for excludes the shootout (generate_history adds the deciding goal itself).
    bad = gs[tot != gs["goals_for"]]
    return [f"{r.game_id} {r.team}: ev+pp+sh+en = {int(t)} but goals_for = {int(r.goals_for)}"
            for r, t in zip(bad.itertuples(index=False), tot[bad.index])]


FRESHNESS_MAX_HOURS = 26


def check_freshness(ctx):
    """In season, manifest.generated_at must be under FRESHNESS_MAX_HOURS old
    (used by .github/workflows/freshness.yml, not by the commit gate)."""
    now = ctx.get("now") or datetime.now(timezone.utc)
    m = _json(ctx.get("manifest_file", MANIFEST_FILE))
    if not isinstance(m, dict):
        return ["manifest.json missing or not JSON"]
    gen = _dt(m.get("generated_at"))
    if not gen:
        return [f"manifest.generated_at {m.get('generated_at')!r} is not a timestamp"]
    age = (now - gen).total_seconds() / 3600
    in_season = (m.get("phase") or {}).get("in_season", True)
    probs = []
    if in_season and age > ctx.get("max_hours", FRESHNESS_MAX_HOURS):
        probs.append(f"manifest generated {age:.1f}h ago (> {ctx.get('max_hours', FRESHNESS_MAX_HOURS)}h) "
                     f"at {m.get('generated_at')}; last full run {m.get('last_full_run')}")
    if m.get("season_id") and m["season_id"] != SEASON_ID:
        probs.append(f"manifest season_id {m['season_id']} != {SEASON_ID} (rollover has not run)")
    return probs


def check_bu_bundle(ctx):
    """The RAPM v2 lineup bundle, when the live game model uses the term: readable, a serving
    bundle of this season with the model's lineup columns and built after its source data.
    Age is reported by the pipeline stage (manifest stale flag), not failed here: with a stale
    bundle predict_games publishes the F1 rollback model."""
    meta = _json(os.path.join(PIPELINE_DIR, "game_model_meta.json"), {}) or {}
    from features import BU_COLUMNS
    used = [c for c in (meta.get("feature_columns") or []) if c in BU_COLUMNS]
    if not used:
        return []
    rel = (meta.get("bu_lineup") or {}).get("serving_bundle") or "bu/lineup/out/serving_bundle.json.gz"
    path = ctx.get("bu_bundle_path") or os.path.join(PIPELINE_DIR, rel)
    try:
        from bu.lineup import serve as SV
        b = SV.read(path)
    except Exception as e:
        return [f"{rel}: unreadable ({type(e).__name__}: {e}); the live model uses {used}"]
    errs = []
    if b.get("kind") != "serving_bundle" or int(b.get("version", 0)) != SV.BUNDLE_VERSION:
        errs.append(f"{rel}: not a v{SV.BUNDLE_VERSION} serving bundle")
    built = _dt(b.get("built_at"))
    fresh = built is not None and (datetime.now(timezone.utc) - built).total_seconds() / 3600 <= SV.MAX_AGE_H
    if str(b.get("season")) != SEASON_ID and fresh:
        # a stale bundle of last season means the F1 rollback model is published; a FRESH
        # one of another season means the refresh is pointed at the wrong season pack
        errs.append(f"{rel}: freshly built for season {b.get('season')} != {SEASON_ID}")
    cols = set(b.get("columns") or [])
    from features import BU_FIN_COLUMNS
    rapm_used = [c for c in used if c not in BU_FIN_COLUMNS]
    fin_used = [c for c in used if c in BU_FIN_COLUMNS]
    if not set(rapm_used) <= cols:
        errs.append(f"{rel}: columns {b.get('columns')} do not cover the model's {rapm_used}")
    if fin_used and fresh and not (set(fin_used) <= cols and ((b.get("fin") or {}).get("rows"))):
        # served by the no-FIN rollback model (shadow.rapm): a fresh bundle without FIN means the
        # refresh ran without the season's fin pack (bu/lineup/out/fin_pack_<S>.json.gz)
        errs.append(f"{rel}: freshly built without a FIN table (columns {b.get('columns')}); the model uses "
                    f"{fin_used}, so the no-FIN rollback model is published: commit the season's fin pack")
    src = b.get("max_source_date")
    if built is None:
        errs.append(f"{rel}: built_at {b.get('built_at')!r} is not a timestamp")
    elif src and str(src)[:10] > built.date().isoformat():
        errs.append(f"{rel}: max_source_date {src} is after built_at {b.get('built_at')}")
    if not (b.get("players") or {}).get("rows"):
        errs.append(f"{rel}: no player ratings")
    v3 = b.get("v3") or {}
    if fresh and str(b.get("season")) == SEASON_ID and not v3.get("rows"):
        # the site's player ratings (v3) come from this table; a fresh bundle without it means the
        # refresh ran without the season's ratings pack (bu/lineup/out/ratings_pack_<S>.json.gz)
        errs.append(f"{rel}: freshly built without a v3 ratings table: commit the season's ratings pack "
                    "(python -m bu.rapm.v3_pack pack --season <S>)")
    v4p = os.path.join(PIPELINE_DIR, "bu", "lineup", "out", f"ratings_pack_v4_{b.get('season')}.json.gz")
    if fresh and str(b.get("season")) == SEASON_ID and os.path.exists(v4p) and not (b.get("v4") or {}).get("rows"):
        # ratings v4 (site file version 4 and the simulator's ratings) come from this table
        errs.append(f"{rel}: freshly built without a v4 ratings table although {os.path.basename(v4p)} is "
                    "committed (bu.lineup serve: v4_table failed?)")
    return errs


PLAYER_RATINGS_COLUMNS = ("id", "name", "team", "pos", "roster", "rated", "impact", "off_impact", "def_impact", "sd",
                          "ev_off", "ev_def", "pp_off", "pk_def", "fin", "toi_ev_gp", "toi_pp_gp", "toi_pk_gp",
                          "off", "def", "net", "off_total", "toi", "gp")
PLAYER_RATINGS_MIN_ROSTER = 600
PLAYER_RATINGS_MAX_LAG_DAYS = 3
PLAYER_RATINGS_VERSION = 4      # 4: ratings v4 (box-score prior, penalties); 3: per-game impact headline (ratings v3); 2: def = xGA/60 prevented
PLAYER_RATINGS_V4_COLUMNS = ("pen_impact", "pd60", "pt60", "spm_off", "spm_def", "spm_pp", "spm_pk")
PLAYER_RATINGS_TOI_MAX = {"toi_ev_gp": 30.0, "toi_pp_gp": 8.0, "toi_pk_gp": 8.0}


def check_player_ratings(ctx):
    """public/data/player_ratings.json (the site's player ratings, v3): readable, every row named,
    >= PLAYER_RATINGS_MIN_ROSTER current-roster skaters across >= 28 teams, the sign convention
    (every rating higher = better: def = xGA/60 prevented, net = off + def, off_total = off + fin),
    the v3 headline (impact = off_impact + def_impact, finite rates, sane expected minutes,
    position-average baseline), and not behind the committed serving bundle it is exported from
    (same season, as_of no older than the bundle's max_source_date)."""
    path = ctx.get("player_ratings_path") or os.path.join(PUBLIC_DATA_DIR, "player_ratings.json")
    doc = _json(path)
    if not isinstance(doc, dict):
        return ["player_ratings.json missing or not JSON (python -m bu.lineup.ratings_export export)"]
    cols = doc.get("columns") or []
    miss = [c for c in PLAYER_RATINGS_COLUMNS if c not in cols]
    if miss:
        return [f"player_ratings.json: columns {miss} missing"]
    rows = [dict(zip(cols, r)) for r in doc.get("rows") or []]
    errs = []
    if int(doc.get("version") or 0) < PLAYER_RATINGS_VERSION:
        errs.append(f"player_ratings.json: version {doc.get('version')} < {PLAYER_RATINGS_VERSION} "
                    "(ratings v4: box-score prior and penalties; re-export from a bundle with the v4 table)")
    unnamed = [r.get("id") for r in rows if not str(r.get("name") or "").strip()]
    if unnamed:
        errs.append(f"player_ratings.json: {len(unnamed)} rows without a name, e.g. {unnamed[:5]}")
    roster = [r for r in rows if r.get("roster")]
    if len(roster) < PLAYER_RATINGS_MIN_ROSTER:
        errs.append(f"player_ratings.json: {len(roster)} current-roster skaters (< {PLAYER_RATINGS_MIN_ROSTER})")
    teams = {r.get("team") for r in roster}
    if len(teams) < 28:
        errs.append(f"player_ratings.json: roster skaters on {len(teams)} teams (< 28)")
    bad = [r.get("name") for r in rows
           if not all(isinstance(r.get(k), (int, float)) and r[k] == r[k] for k in ("off", "def", "net"))
           or abs(r["off"] + r["def"] - r["net"]) > 0.002]
    if bad:
        errs.append(f"player_ratings.json: {len(bad)} rows with a missing or inconsistent off/def/net, e.g. {bad[:3]}")
    # finishing talent: off_total = off + fin; shrunk FIN stays small
    badf = [r.get("name") for r in rows
            if not all(isinstance(r.get(k), (int, float)) and r[k] == r[k] for k in ("fin", "off_total"))
            or abs(r["off"] + r["fin"] - r["off_total"]) > 0.002 or abs(r["fin"]) > 0.5]
    if badf:
        errs.append(f"player_ratings.json: {len(badf)} rows with a missing or inconsistent fin/off_total, e.g. {badf[:3]}")
    # v3 headline: impact = off_impact + def_impact (goals / 82 games), ev_* = the v2-named per-60 rates,
    # sane expected minutes, a non-negative SD, and an average player at each position ~ 0
    num = ("impact", "off_impact", "def_impact", "sd", "ev_off", "ev_def", "pp_off", "pk_def",
           *PLAYER_RATINGS_TOI_MAX)
    badi = [r.get("name") for r in rows
            if not all(isinstance(r.get(k), (int, float)) and r[k] == r[k] for k in num)
            or abs(r["off_impact"] + r["def_impact"] - r["impact"]) > 0.02 or r["sd"] < 0
            or abs(r["ev_off"] - r["off"]) > 0.002 or abs(r["ev_def"] - r["def"]) > 0.002
            or any(not (0 <= r[k] <= v) for k, v in PLAYER_RATINGS_TOI_MAX.items())]
    if badi:
        errs.append(f"player_ratings.json: {len(badi)} rows with a missing or inconsistent impact / rate / TOI, "
                    f"e.g. {badi[:3]}")
    else:
        for g in ("F", "D"):
            ref = [r["impact"] for r in roster if r.get("rated") and (r.get("pos") == "D") == (g == "D")]
            if ref and abs(sum(ref) / len(ref)) > 0.5:
                errs.append(f"player_ratings.json: mean impact of rated {g} {sum(ref) / len(ref):+.2f} "
                            "(the position-average baseline should put it near 0)")
    if int(doc.get("version") or 0) >= 4:
        # v4: penalty term inside the impact, box-score priors present and finite
        miss4 = [c for c in PLAYER_RATINGS_V4_COLUMNS if c not in cols]
        if miss4:
            errs.append(f"player_ratings.json: version 4 without columns {miss4}")
        else:
            bad4 = [r.get("name") for r in rows
                    if not all(isinstance(r.get(k), (int, float)) and r[k] == r[k] for k in PLAYER_RATINGS_V4_COLUMNS)
                    or abs(r["pen_impact"]) > 15 or r["pd60"] < 0 or r["pt60"] < 0
                    or any(abs(r[k]) > 2 for k in ("spm_off", "spm_def", "spm_pp", "spm_pk"))]
            if bad4:
                errs.append(f"player_ratings.json: {len(bad4)} rows with a missing or implausible penalty / "
                            f"box-score prior value, e.g. {bad4[:3]}")
    if any(r.get("pos") == "G" for r in rows):
        errs.append("player_ratings.json: goalies listed (skaters only)")
    try:
        from bu.lineup import serve as SV
        b = SV.read(ctx.get("bu_bundle_path") or os.path.join(PIPELINE_DIR, "bu", "lineup", "out", "serving_bundle.json.gz"))
    except Exception:
        b = None
    if b:
        if str(doc.get("season")) != str(b.get("season")):
            errs.append(f"player_ratings.json: season {doc.get('season')} != serving bundle {b.get('season')}")
        else:
            a, m = _dt(f"{doc.get('as_of')}T00:00:00+00:00"), _dt(f"{b.get('max_source_date')}T00:00:00+00:00")
            # bu_refresh exports with every bundle and the full run re-exports daily, so a short
            # lag heals itself; only a lasting one (a broken export) fails the gate
            if a is None or (m is not None and (m - a).days > PLAYER_RATINGS_MAX_LAG_DAYS):
                errs.append(f"player_ratings.json: as_of {doc.get('as_of')} is behind the serving bundle "
                            f"({b.get('max_source_date')}) by > {PLAYER_RATINGS_MAX_LAG_DAYS} days; re-export")
    return errs


CHECKS = {
    "manifest": check_manifest,
    "predictions": check_predictions,
    "placeholders": check_placeholders,
    "after_start": check_after_start,
    "teams": check_teams,
    "goalies": check_goalies,
    "season_ids": check_season_ids,
    "odds": check_odds,
    "gamestats": check_gamestats,
    "reports": check_reports,
    "graded": check_graded,
    "fair_odds": check_fair_odds,
    "sim_markets": check_sim_markets,
    "model_independent": check_model_independent,
    "winpct_engine": check_winpct_engine,
    "goal_splits": check_gamestats_goals,
    "bu_bundle": check_bu_bundle,
    "player_ratings": check_player_ratings,
}


def run(allow=(), offline=False, only=None, ctx=None, quiet=False):
    """Run the checks. Returns (errors, warnings) as {check: [problems]}."""
    ctx = dict(ctx or {})
    ctx.setdefault("offline", offline)
    errors, warnings = {}, {}
    for name, fn in CHECKS.items():
        if only and name not in only:
            continue
        t = time.time()
        try:
            probs = fn(ctx)
        except Exception as e:  # a crashing check is a failed check
            probs = [f"check crashed: {type(e).__name__}: {e}"]
        dt = time.time() - t
        bucket = warnings if name in allow else errors
        if probs:
            bucket[name] = probs
        if not quiet:
            status = "ok" if not probs else ("WARN" if name in allow else "FAIL")
            print(f"  [{status:<4}] {name:<13} {dt:5.2f}s"
                  + (f"  {len(probs)} problem(s)" if probs else ""))
            for p in probs[:12]:
                print(f"           - {p}")
            if len(probs) > 12:
                print(f"           ... {len(probs) - 12} more")
    return errors, warnings


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--offline", action="store_true", help="skip checks that need the network")
    ap.add_argument("--allow", default=os.environ.get("PONYXG_VALIDATE_ALLOW", ""),
                    help="comma-separated checks to report as warnings only")
    ap.add_argument("--only", default="", help="comma-separated checks to run")
    ap.add_argument("--print-schema", action="store_true")
    ap.add_argument("--freshness", action="store_true",
                    help=f"only check that the manifest is < {FRESHNESS_MAX_HOURS}h old in season")
    args = ap.parse_args(argv)
    if args.print_schema:
        print(json.dumps(MANIFEST_SCHEMA, indent=2))
        return 0
    if args.freshness:
        probs = check_freshness({})
        m = _json(MANIFEST_FILE, {}) or {}
        for name, reason in sorted((m.get("stale") or {}).items()):
            print(f"  [stale] {name}: {reason} (since {(m.get('stale_since') or {}).get(name, '?')})")
        for p in probs:
            print(f"  [FAIL] {p}")
        print("freshness: " + ("FAIL" if probs else f"ok (generated_at {m.get('generated_at')})"))
        return 1 if probs else 0
    allow = {a.strip() for a in args.allow.split(",") if a.strip()}
    only = {a.strip() for a in args.only.split(",") if a.strip()} or None
    t0 = time.time()
    print(f"validate_outputs: season {SEASON_ID}")
    errors, warnings = run(allow=allow, offline=args.offline, only=only)
    print(f"validate_outputs: {len(errors)} failed, {len(warnings)} warned, {time.time() - t0:.1f}s")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
