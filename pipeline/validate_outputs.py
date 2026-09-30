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
                 mirrors must be this season)

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
    return errs


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
