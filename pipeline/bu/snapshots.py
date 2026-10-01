"""
bu/snapshots.py — forward archive of pregame odds and lineups (DESIGN §2.4).

Prices, lineups and injury reports as they stood at a given minute cannot be
re-fetched later from any free source, so this job writes them to a tracked,
append-only archive on the run that captures them.

What one run does
  1. Reads the NHL schedule (``api-web /v1/schedule/{date}``, ET date).
  2. Selects the pregame games (types 02/03) that start within ``--window``
     minutes (default 25), plus any ``--games`` ids passed by the trigger.
  3. Captures, per game, from every free source it can reach (each one is
     optional; a failing source is recorded in ``errors`` and skipped):
       * prices: NHL partner feed (DraftKings), Bovada, ESPN scoreboard
         (provider, usually DraftKings, with ESPN's opening line);
       * DailyFaceoff starting goalies and line combinations (dressed lines,
         injured list, game-time decisions);
       * ESPN injury report for the two teams;
       * the site's published prediction for the game at that moment
         (``public/data/predictions_detailed.csv``: model %, blend %, weight,
         model_version, predicted_at) — the incumbent's shadow record.
  4. Appends one JSON row per game to
     ``pipeline/snapshots/<season label>/<game date>.jsonl.gz`` (one gzip
     member per run per file, so earlier bytes are never rewritten).

Idempotent: a row whose content (ignoring timestamps) matches a row already
stored for the same game less than DEDUPE_SECONDS earlier is skipped, so a
retried or doubly-triggered run does not duplicate data.  Never raises on a
source failure; exits non-zero only on a programming error.

Price classes (DESIGN §1.4): a price row is a *close* when
0 < lead_min <= CLOSE_MAX_LEAD_MIN (15) and a *snapshot* otherwise; the close
of a game for a book is the last close-class row.  Readers: ``read_rows``,
``price_rows``, ``closes``, ``earliest``, ``coverage``.

Usage (run from pipeline/):
    python3 -m bu.snapshots                       # close window (25 min)
    python3 -m bu.snapshots --window 1440         # whole-slate sweep (q0)
    python3 -m bu.snapshots --dry-run --window 1440 --out /tmp/snaps
    python3 -m bu.snapshots report --since 2026-10-01 [--until 2026-10-07]
"""
from __future__ import annotations

import argparse
import copy
import csv
import gzip
import hashlib
import io
import json
import os
import sys
import time
import zlib
from datetime import date, datetime, timedelta, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE_DIR = os.path.dirname(_HERE)
if PIPELINE_DIR not in sys.path:
    sys.path.insert(0, PIPELINE_DIR)

from http_utils import try_get_json  # noqa: E402
from season import COUNTED_GAME_TYPES, NHL_TZ, today_local  # noqa: E402

SCHEMA_VERSION = 1
SNAPSHOT_DIR = os.path.join(PIPELINE_DIR, "snapshots")
REPO_ROOT = os.path.dirname(PIPELINE_DIR)
PREDICTIONS_CSV = os.path.join(REPO_ROOT, "public", "data", "predictions_detailed.csv")

CLOSE_MAX_LEAD_MIN = 15.0      # DESIGN §1.4: close = timestamped, 0 < lead <= 15 min
DEFAULT_WINDOW_MIN = 25.0      # close runs capture games starting within this window
DEDUPE_SECONDS = 180           # identical row for the same game within 3 min = duplicate
MATCH_WINDOW = timedelta(hours=12)
PREGAME_STATES = {"FUT", "PRE", None, ""}
DFO_DELAY_S = 0.5              # polite spacing between DailyFaceoff page requests

SCHEDULE_URL = "https://api-web.nhle.com/v1/schedule/{date}"
ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates={d}"
ESPN_INJURIES_URL = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries"
DFO_GOALIES_URL = "https://www.dailyfaceoff.com/starting-goalies/{date}"
DFO_LINEUP_URL = "https://www.dailyfaceoff.com/teams/{slug}/line-combinations"
# ESPN's edge answers library user agents but 403s a bare "Mozilla/5.0" from
# some networks; identify honestly as Python's urllib.
ESPN_UA = f"Python-urllib/{sys.version_info.major}.{sys.version_info.minor}"

# Keys that change on every run without the information changing.
_VOLATILE = {"captured_at", "lead_min", "run", "trigger", "fetched_at", "h", "errors"}


# ── Time helpers ─────────────────────────────────────────────────────────────

def _dt(s):
    if isinstance(s, datetime):
        return s if s.tzinfo else s.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def lead_minutes(start, at) -> float | None:
    s, a = _dt(start), _dt(at)
    if not s or not a:
        return None
    return round((s - a).total_seconds() / 60.0, 2)


def season_label_of(game_id) -> str:
    y = int(str(game_id)[:4])
    return f"{y}-{str(y + 1)[2:]}"


def game_type_str(g) -> str:
    gt = g.get("gameType")
    if gt is not None:
        try:
            return f"{int(gt):02d}"
        except (TypeError, ValueError):
            pass
    return str(g.get("id", ""))[4:6]


# ── Schedule and selection ───────────────────────────────────────────────────

def parse_schedule(data) -> list[dict]:
    """Normalised games from a /v1/schedule/{date} payload (every day in it)."""
    out = []
    for day in (data or {}).get("gameWeek", []) or []:
        for g in day.get("games", []) or []:
            try:
                gid = int(g["id"])
            except (KeyError, TypeError, ValueError):
                continue
            home, away = g.get("homeTeam") or {}, g.get("awayTeam") or {}

            def _name(t, k):
                return ((t.get(k) or {}).get("default") or "").strip()

            out.append({
                "game_id": gid,
                "game_date": day.get("date") or g.get("gameDate"),
                "start_utc": g.get("startTimeUTC"),
                "game_type": game_type_str(g),
                "state": g.get("gameState"),
                "home": home.get("abbrev"), "away": away.get("abbrev"),
                "home_name": _name(home, "commonName"), "away_name": _name(away, "commonName"),
                "home_full": f"{_name(home, 'placeName')} {_name(home, 'commonName')}".strip(),
                "away_full": f"{_name(away, 'placeName')} {_name(away, 'commonName')}".strip(),
            })
    return out


def fetch_schedule(now: datetime) -> tuple[list[dict], list[str]]:
    """Games from the NHL schedule week starting at the ET date of ``now``.
    The ET date (not the runner's UTC date) keeps tonight's late games in
    view between 00:00 and 04:00 UTC."""
    d = today_local(now)
    data = try_get_json(SCHEDULE_URL.format(date=d.isoformat()), ua="plain", retries=3)
    if not data:
        return [], [f"schedule {d}: unavailable"]
    return parse_schedule(data), []


def select_games(games, now, window_min=DEFAULT_WINDOW_MIN, game_ids=None,
                 game_types=COUNTED_GAME_TYPES) -> list[dict]:
    """Games to snapshot at ``now``: pregame, of a counted type, and either
    starting within ``window_min`` minutes or named in ``game_ids``.

    A game is never captured at or after its scheduled start (lead <= 0):
    such a price is not pregame."""
    now = _dt(now)
    wanted = {int(x) for x in (game_ids or [])}
    out = []
    for g in games:
        if game_types and g.get("game_type") not in game_types:
            continue
        if g.get("state") not in PREGAME_STATES:
            continue
        lead = lead_minutes(g.get("start_utc"), now)
        if lead is None or lead <= 0:
            continue
        if lead <= window_min or g["game_id"] in wanted:
            out.append(dict(g, lead_min=lead))
    return sorted(out, key=lambda g: (g["start_utc"], g["game_id"]))


# ── Prices ───────────────────────────────────────────────────────────────────

def _f(x):
    try:
        return float(str(x).strip().lstrip("oOuU+")) if x not in (None, "") else None
    except ValueError:
        return None


def _american(v):
    if v in (None, ""):
        return None
    if isinstance(v, str):
        v = v.strip().replace("+", "")
        if v.upper() == "EVEN":
            return 100
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def _clean(d: dict) -> dict:
    return {k: v for k, v in d.items() if v is not None}


def _book_shape(g) -> dict:
    """The upcoming_games.json shape fetch_odds.Book expects."""
    return {"id": g["game_id"], "gameDate": g["game_date"], "startTimeUTC": g["start_utc"],
            "homeTeam": g["home_name"], "awayTeam": g["away_name"],
            "homeTeamAbbrev": g["home"], "awayTeamAbbrev": g["away"]}


def price_from_book_entry(e: dict, book: str, source: str, fetched_at: str) -> dict | None:
    """Normalised price dict from a fetch_odds.Book entry (None without a ML)."""
    if e.get("home_ml") is None or e.get("away_ml") is None:
        return None
    hn, an = e.get("home_team"), e.get("away_team")
    return _clean({
        "book": book, "source": source, "fetched_at": fetched_at,
        "home_ml": e.get("home_ml"), "away_ml": e.get("away_ml"),
        "total_line": _f(e.get("total_line")), "over": e.get("total_over"), "under": e.get("total_under"),
        "pl_spread": _f(e.get(f"{hn}_puckline_spread")),
        "pl_home": e.get(f"{hn}_puckline"), "pl_away": e.get(f"{an}_puckline"),
        "three_way_home": e.get(f"{hn}_three_way"), "three_way_away": e.get(f"{an}_three_way"),
        "three_way_tie": e.get("three_way_tie"),
        "ml_1p_home": e.get(f"{hn}_1p_ml"), "ml_1p_away": e.get(f"{an}_1p_ml"),
    })


def fetch_odds_source(games, now, which: str):
    """Prices from one fetch_odds.py source ('partner' or 'bovada'), each in
    its own set of Books so a source never fills another's markets."""
    import fetch_odds as FO

    fetched_at = iso(datetime.now(timezone.utc))
    books = {g["game_id"]: FO.Book(_book_shape(g), fetched_at) for g in games}
    if which == "partner":
        FO.from_partner(books, fetched_at, now)
        book_name = "draftkings"
    else:
        FO.from_bovada(books, now)
        book_name = "bovada"
    fetched_at = iso(datetime.now(timezone.utc))   # stamp after the response arrived
    out = {}
    for gid, b in books.items():
        src = b.e.get("source") or which
        name = book_name
        if which == "partner" and src.startswith("nhl_partner_"):
            name = src[len("nhl_partner_"):] or book_name
        p = price_from_book_entry(b.e, name, "nhl_partner" if which == "partner" else "bovada", fetched_at)
        if p:
            out[gid] = p
    return out


def _match(games, home, away, start):
    for g in games:
        if g["home"] == home and g["away"] == away:
            s = _dt(g["start_utc"])
            if s and start and abs(s - start) <= MATCH_WINDOW:
                return g
    return None


def parse_espn_odds(data, games, fetched_at) -> dict:
    """{game_id: price} from an ESPN scoreboard payload.  ``close`` in ESPN's
    feed is the current line; ``open`` (untimestamped) is kept as a reference."""
    from fetch_injuries import espn_tri

    out = {}
    for ev in (data or {}).get("events", []) or []:
        comp = (ev.get("competitions") or [{}])[0]
        state = ((comp.get("status") or {}).get("type") or {}).get("state")
        if state not in (None, "pre"):
            continue
        tris = {c.get("homeAway"): espn_tri((c.get("team") or {}).get("abbreviation"))
                for c in comp.get("competitors", []) or []}
        g = _match(games, tris.get("home"), tris.get("away"), _dt(ev.get("date")))
        if not g:
            continue
        for o in comp.get("odds", []) or []:
            prov = ((o.get("provider") or {}).get("name") or "espn").lower().replace(" ", "")
            ml, ps, tot = o.get("moneyline") or {}, o.get("pointSpread") or {}, o.get("total") or {}

            def leg(market, side, when, key="odds"):
                return ((market.get(side) or {}).get(when) or {}).get(key)

            def price(when):
                return _clean({
                    "home_ml": _american(leg(ml, "home", when)), "away_ml": _american(leg(ml, "away", when)),
                    "total_line": _f(leg(tot, "over", when, "line")) or (_f(o.get("overUnder")) if when == "close" else None),
                    "over": _american(leg(tot, "over", when)), "under": _american(leg(tot, "under", when)),
                    "pl_spread": _f(leg(ps, "home", when, "line")),
                    "pl_home": _american(leg(ps, "home", when)), "pl_away": _american(leg(ps, "away", when)),
                })

            cur = price("close")
            if cur.get("home_ml") is None or cur.get("away_ml") is None:
                continue
            p = {"book": prov, "source": "espn", "fetched_at": fetched_at, **cur}
            opn = price("open")
            if opn.get("home_ml") is not None:
                p["open"] = opn
            out[g["game_id"]] = p
            break      # first (priority) provider only
    return out


def fetch_espn_odds(games):
    out, errors = {}, []
    for d in sorted({g["game_date"] for g in games if g.get("game_date")}):
        data = try_get_json(ESPN_SCOREBOARD_URL.format(d=d.replace("-", "")), ua=ESPN_UA, retries=2)
        if not data:
            errors.append(f"espn scoreboard {d}: unavailable")
            continue
        out.update(parse_espn_odds(data, games, iso(datetime.now(timezone.utc))))
    return out, errors


def fetch_prices(games, now) -> tuple[dict, list[str]]:
    """{game_id: [price, ...]} across every reachable book."""
    prices: dict = {g["game_id"]: [] for g in games}
    errors = []
    for which in ("partner", "bovada"):
        try:
            got = fetch_odds_source(games, now, which)
        except Exception as e:      # a source must never sink the run
            errors.append(f"{which}: {type(e).__name__}: {e}"[:200])
            continue
        if not got:
            errors.append(f"{which}: no pregame prices")
        for gid, p in got.items():
            prices[gid].append(p)
    try:
        got, errs = fetch_espn_odds(games)
        errors += errs
        for gid, p in got.items():
            prices[gid].append(p)
    except Exception as e:
        errors.append(f"espn odds: {type(e).__name__}: {e}"[:200])
    return prices, errors


# ── Lineups, goalies, injuries ───────────────────────────────────────────────

def parse_dfo_goalies(data, fetched_at) -> dict:
    """{(date, tri): goalie} from a DFO starting-goalies __NEXT_DATA__ blob."""
    from fetch_odds import FULLNAME_TO_TRI

    out = {}
    games = ((data or {}).get("props", {}).get("pageProps", {}) or {}).get("data", []) or []
    for game in games:
        gdate = game.get("date")
        for side in ("home", "away"):
            tri = FULLNAME_TO_TRI.get((game.get(f"{side}TeamName") or "").strip())
            if not tri:
                continue
            out[(gdate, tri)] = _clean({
                "name": game.get(f"{side}GoalieName"),
                "status": game.get(f"{side}NewsStrengthName") or ("Unconfirmed" if game.get(f"{side}GoalieName") else None),
                "dfo_id": game.get(f"{side}GoalieId"),
                "news_at": game.get(f"{side}NewsCreatedAt"),
                "slug": game.get(f"{side}TeamSlug"),
                "fetched_at": fetched_at,
            })
    return out


def compact_lineup(lines: dict, meta: dict, fetched_at: str) -> dict:
    """Small archive form of fetch_dailyfaceoff.parse_lineup_payload output."""
    groups = {}
    out_list, gtd = [], []
    for gid in ("f1", "f2", "f3", "f4", "d1", "d2", "d3", "g"):
        plist = lines.get(gid) or []
        if plist:
            groups[gid] = [[p.get("id"), p.get("name")] for p in plist]
        for p in plist:
            if p.get("gameTimeDecision"):
                gtd.append([p.get("id"), p.get("name")])
            if p.get("injuryStatus"):
                out_list.append([p.get("id"), p.get("name"), p.get("injuryStatus"), "lineup"])
    for p in lines.get("ir") or []:
        out_list.append([p.get("id"), p.get("name"), p.get("injuryStatus") or "ir", "ir"])
        if p.get("gameTimeDecision"):
            gtd.append([p.get("id"), p.get("name")])
    return _clean({"source": meta.get("lineup_source"), "updated_at": meta.get("updated_at"),
                   "fetched_at": fetched_at, "lines": groups, "out": out_list, "gtd": gtd})


def _dfo_slug(full_name: str) -> str:
    import fetch_dailyfaceoff as DFO
    return DFO._slug(full_name)


def fetch_lineups_and_goalies(games, delay=DFO_DELAY_S):
    """(goalies {(date, tri): ...}, lineups {tri: ...}, errors)."""
    import fetch_dailyfaceoff as DFO

    goalies, lineups, errors = {}, {}, []
    for d in sorted({g["game_date"] for g in games if g.get("game_date")}):
        data = DFO._next_data(DFO_GOALIES_URL.format(date=d))
        if not data:
            errors.append(f"dfo goalies {d}: unavailable")
            continue
        goalies.update(parse_dfo_goalies(data, iso(datetime.now(timezone.utc))))
    teams = {}
    for g in games:
        for side in ("home", "away"):
            tri = g[side]
            slug = (goalies.get((g["game_date"], tri)) or {}).get("slug") or _dfo_slug(g[f"{side}_full"])
            teams.setdefault(tri, slug)
    for i, (tri, slug) in enumerate(sorted(teams.items())):
        if i and delay:
            time.sleep(delay)
        data = DFO._next_data(DFO_LINEUP_URL.format(slug=slug))
        if not data:
            errors.append(f"dfo lineup {tri}: unavailable")
            continue
        try:
            lines, meta, _cap = DFO.parse_lineup_payload(data)
        except Exception as e:
            errors.append(f"dfo lineup {tri}: {type(e).__name__}")
            continue
        if not any(k.startswith("f") for k in lines):
            errors.append(f"dfo lineup {tri}: empty")
            continue
        lineups[tri] = compact_lineup(lines, meta, iso(datetime.now(timezone.utc)))
    return goalies, lineups, errors


def parse_espn_injuries(data, teams) -> dict:
    """{tri: [{name, status, type, date, return}]} for ``teams``.  Comment
    text is not archived (status fields are what the models use)."""
    from fetch_injuries import espn_tri
    from fetch_odds import FULLNAME_TO_TRI

    out: dict = {}
    for team in (data or {}).get("injuries", []) or []:
        for inj in team.get("injuries", []) or []:
            ath = inj.get("athlete") or {}
            tri = espn_tri((ath.get("team") or {}).get("abbreviation")) or FULLNAME_TO_TRI.get(team.get("displayName"))
            if tri not in teams:
                continue
            det = inj.get("details") or {}
            out.setdefault(tri, []).append(_clean({
                "name": ath.get("displayName"), "status": inj.get("status"), "type": det.get("type"),
                "date": inj.get("date"), "return": det.get("returnDate"),
                "pos": (ath.get("position") or {}).get("abbreviation"),
            }))
    for tri in out:
        out[tri].sort(key=lambda x: x.get("name") or "")
    return out


def fetch_injuries(teams):
    data = try_get_json(ESPN_INJURIES_URL, ua=ESPN_UA, retries=2)
    if not data:
        return None, ["espn injuries: unavailable"]
    return parse_espn_injuries(data, set(teams)), []


# ── Published prediction (incumbent shadow record) ───────────────────────────

PUBLISHED_FIELDS = {
    "model_version": "model_version", "predicted_at": "predicted_at",
    "home_model_pct": "home_model_win_pct", "home_win_pct": "home_win_pct",
    "blend_weight": "blend_weight", "market_source": "market_source",
    "market_fetched_at": "market_fetched_at", "home_market_pct": "home_vegas_win_pct",
    "home_gp": "home_gp", "away_gp": "away_gp",
    # DESIGN §6.2 shadow column (absent until a BU stage ships in shadow).
    "bu_shadow_home_win_pct": "bu_shadow_home_win_pct",
}


def read_published(path=PREDICTIONS_CSV) -> dict:
    """{game_id: published fields} from the committed predictions CSV."""
    out = {}
    try:
        with open(path, newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                gid = r.get("nhl_game_id") or r.get("game_id")
                try:
                    gid = int(float(gid))
                except (TypeError, ValueError):
                    continue
                rec = {}
                for k, col in PUBLISHED_FIELDS.items():
                    v = (r.get(col) or "").strip()
                    if v == "":
                        continue
                    try:
                        rec[k] = float(v) if k.endswith(("_pct", "_weight", "_gp")) else v
                    except ValueError:
                        rec[k] = v
                out[gid] = rec
    except OSError:
        pass
    return out


# ── Rows ─────────────────────────────────────────────────────────────────────

def _strip_volatile(o):
    if isinstance(o, dict):
        return {k: _strip_volatile(v) for k, v in o.items() if k not in _VOLATILE}
    if isinstance(o, list):
        return [_strip_volatile(x) for x in o]
    return o


def content_hash(row: dict) -> str:
    blob = json.dumps(_strip_volatile(copy.deepcopy(row)), sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(blob.encode()).hexdigest()[:16]


def build_rows(games, captured_at, prices, goalies, lineups, injuries, published, errors,
               trigger="manual", run_id=None) -> list[dict]:
    rows = []
    for g in games:
        gid = g["game_id"]
        row = {
            "v": SCHEMA_VERSION, "game_id": gid, "game_date": g["game_date"],
            "season": season_label_of(gid), "game_type": g["game_type"],
            "start_utc": g["start_utc"], "captured_at": captured_at,
            "lead_min": lead_minutes(g["start_utc"], captured_at), "state": g.get("state"),
            "home": g["home"], "away": g["away"], "trigger": trigger, "run": run_id,
            "prices": sorted(prices.get(gid, []), key=lambda p: (p["book"], p["source"])),
            "goalies": {s: {k: v for k, v in (goalies.get((g["game_date"], g[s])) or {}).items() if k != "slug"}
                        or None for s in ("home", "away")},
            "lineups": {s: lineups.get(g[s]) for s in ("home", "away")},
            "injuries": None if injuries is None else {s: injuries.get(g[s], []) for s in ("home", "away")},
            "published": published.get(gid),
            "errors": sorted(errors),
        }
        row["h"] = content_hash(row)
        rows.append(row)
    return rows


def day_path(row, root=SNAPSHOT_DIR) -> str:
    return os.path.join(root, row["season"], f"{row['game_date']}.jsonl.gz")


def read_rows(path) -> list[dict]:
    """Every row of a (multi-member) .jsonl.gz day file.  A truncated trailing
    member (a killed run) is tolerated: the rows before it are returned."""
    rows = []
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
    except OSError:
        return rows
    text = b""
    pos = 0
    while pos < len(raw):
        d = zlib.decompressobj(16 + zlib.MAX_WBITS)
        try:
            chunk = d.decompress(raw[pos:])
        except zlib.error:
            break
        if not d.eof:
            break                       # truncated member: ignore it
        text += chunk
        pos = len(raw) - len(d.unused_data)
    for line in text.decode("utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    return rows


def _gzip_member(rows) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0, compresslevel=9) as gz:
        for r in rows:
            gz.write((json.dumps(r, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8"))
    return buf.getvalue()


def is_duplicate(row, existing, dedupe_s=DEDUPE_SECONDS) -> bool:
    t = _dt(row["captured_at"])
    for e in existing:
        if e.get("game_id") != row["game_id"] or e.get("h") != row["h"]:
            continue
        et = _dt(e.get("captured_at"))
        if et and t and abs((t - et).total_seconds()) < dedupe_s:
            return True
    return False


def append_rows(rows, root=SNAPSHOT_DIR) -> dict:
    """Append ``rows`` to their day files; returns {path: rows_written}."""
    by_path: dict = {}
    for r in rows:
        by_path.setdefault(day_path(r, root), []).append(r)
    written = {}
    for path, new in sorted(by_path.items()):
        existing = read_rows(path)
        keep = [r for r in new if not is_duplicate(r, existing)]
        if not keep:
            written[path] = 0
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        try:
            with open(path, "rb") as fh:
                prev = fh.read()
        except OSError:
            prev = b""
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(prev + _gzip_member(keep))
        os.replace(tmp, path)
        written[path] = len(keep)
    return written


# ── Run ──────────────────────────────────────────────────────────────────────

def run(now=None, window_min=DEFAULT_WINDOW_MIN, game_ids=None, root=SNAPSHOT_DIR, dry_run=False,
        trigger="manual", run_id=None, with_lineups=True, with_injuries=True, games=None) -> dict:
    now = _dt(now) or datetime.now(timezone.utc)
    errors = []
    if games is None:
        games, errs = fetch_schedule(now)
        errors += errs
    chosen = select_games(games, now, window_min, game_ids)
    summary = {"now": iso(now), "window_min": window_min, "scheduled": len(games), "selected": len(chosen),
               "games": [g["game_id"] for g in chosen], "written": {}, "errors": errors}
    if not chosen:
        print(f"[snapshots] {iso(now)}: no pregame game within {window_min:g} min — nothing to capture")
        return summary
    print(f"[snapshots] {iso(now)}: capturing {len(chosen)} game(s): "
          + ", ".join(f"{g['away']}@{g['home']} (T-{g['lead_min']:.0f}m)" for g in chosen))
    prices, errs = fetch_prices(chosen, now)
    errors += errs
    goalies, lineups = {}, {}
    if with_lineups:
        goalies, lineups, errs = fetch_lineups_and_goalies(chosen)
        errors += errs
    injuries = None
    if with_injuries:
        injuries, errs = fetch_injuries({g[s] for g in chosen for s in ("home", "away")})
        errors += errs
    published = read_published()
    rows = build_rows(chosen, iso(now), prices, goalies, lineups, injuries, published, errors,
                      trigger=trigger, run_id=run_id)
    summary["errors"] = sorted(errors)
    summary["books"] = {str(r["game_id"]): [p["book"] + "/" + p["source"] for p in r["prices"]] for r in rows}
    if dry_run:
        summary["rows"] = rows
        print(f"[snapshots] dry run: {len(rows)} row(s) built, nothing written")
        return summary
    summary["written"] = {os.path.relpath(p, root): n for p, n in append_rows(rows, root).items()}
    print(f"[snapshots] wrote {summary['written']}; source errors: {summary['errors'] or 'none'}")
    return summary


# ── Readers (used by the pre-registered analysis, bu/prereg_analysis.py) ─────

def iter_day_files(root=SNAPSHOT_DIR, season=None, since=None, until=None):
    seasons = [season] if season else sorted(os.listdir(root)) if os.path.isdir(root) else []
    for s in seasons:
        d = os.path.join(root, s)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if not name.endswith(".jsonl.gz"):
                continue
            day = name[:10]
            if (since and day < str(since)) or (until and day > str(until)):
                continue
            yield os.path.join(d, name)


def load_rows(root=SNAPSHOT_DIR, season=None, since=None, until=None) -> list[dict]:
    rows = []
    for p in iter_day_files(root, season, since, until):
        rows += read_rows(p)
    return rows


def price_class(lead_min) -> str | None:
    if lead_min is None or lead_min <= 0:
        return None                     # not pregame: never a usable price
    return "close" if lead_min <= CLOSE_MAX_LEAD_MIN else "snapshot"


def price_rows(rows) -> list[dict]:
    """One flat record per (snapshot row, book price) in the DESIGN §2.4 field
    set: game_id, book, source, fetched_at, start_utc, lead_min, class, prices,
    goalies, out lists and the published model at capture time."""
    out = []
    for r in rows:
        lu = r.get("lineups") or {}
        go = r.get("goalies") or {}
        for p in r.get("prices") or []:
            lead = lead_minutes(r.get("start_utc"), p.get("fetched_at") or r.get("captured_at"))
            rec = {k: v for k, v in p.items() if k != "open"}
            rec.update({
                "game_id": r["game_id"], "game_date": r.get("game_date"), "game_type": r.get("game_type"),
                "start_utc": r.get("start_utc"), "captured_at": r.get("captured_at"),
                "fetched_at": p.get("fetched_at") or r.get("captured_at"),
                "lead_min": lead, "class": price_class(lead),
                "goalie_home": go.get("home"), "goalie_away": go.get("away"),
                "out_home": [x[1] for x in ((lu.get("home") or {}).get("out") or [])],
                "out_away": [x[1] for x in ((lu.get("away") or {}).get("out") or [])],
                "gtd": [x[1] for s in ("home", "away") for x in ((lu.get(s) or {}).get("gtd") or [])],
                "published": r.get("published"),
            })
            if rec["class"]:
                out.append(rec)
    return out


def _sort_key(p):
    return (_dt(p["fetched_at"]) or datetime.min.replace(tzinfo=timezone.utc), p.get("source") or "")


def closes(prices, book=None) -> dict:
    """{(game_id, book): close price}: the last price with 0 < lead <= 15."""
    out = {}
    for p in sorted(prices, key=_sort_key):
        if p["class"] == "close" and (book is None or p["book"] == book):
            out[(p["game_id"], p["book"])] = p
    return out


def et_date(ts) -> str | None:
    d = _dt(ts)
    return d.astimezone(NHL_TZ).date().isoformat() if d else None


def earliest(prices, book=None, min_lead_min=0.0) -> dict:
    """{(game_id, book): earliest price captured on the game's ET date with
    lead >= min_lead_min} (q0 of the line-movement test)."""
    out = {}
    for p in sorted(prices, key=_sort_key):
        if book is not None and p["book"] != book:
            continue
        if p["lead_min"] is None or p["lead_min"] < min_lead_min:
            continue
        if p.get("game_date") and et_date(p["fetched_at"]) != p["game_date"]:
            continue                      # captured before the game day
        out.setdefault((p["game_id"], p["book"]), p)
    return out


def coverage(rows, game_ids, book=None) -> dict:
    """Share of ``game_ids`` with at least one close (any book unless ``book``)."""
    pr = price_rows(rows)
    with_close = {gid for (gid, _b) in closes(pr, book)}
    ids = sorted({int(g) for g in game_ids})
    missing = [g for g in ids if g not in with_close]
    leads = sorted(p["lead_min"] for p in closes(pr, book).values())
    return {"games": len(ids), "with_close": len(ids) - len(missing),
            "pct": round(100.0 * (len(ids) - len(missing)) / len(ids), 1) if ids else None,
            "missing": missing, "close_lead_median": leads[len(leads) // 2] if leads else None}


def scheduled_game_ids(since: date, until: date) -> list[int]:
    """Counted-type game ids scheduled between two ET dates (NHL schedule)."""
    ids, d = set(), since
    while d <= until:
        data = try_get_json(SCHEDULE_URL.format(date=d.isoformat()), ua="plain", retries=2)
        for g in parse_schedule(data):
            if g["game_type"] in COUNTED_GAME_TYPES and g["game_date"] and since.isoformat() <= g["game_date"] <= until.isoformat():
                ids.add(g["game_id"])
        d += timedelta(days=7)
    return sorted(ids)


def report(since, until=None, root=SNAPSHOT_DIR) -> dict:
    since = date.fromisoformat(str(since))
    until = date.fromisoformat(str(until)) if until else today_local() - timedelta(days=1)
    rows = load_rows(root, since=since.isoformat(), until=until.isoformat())
    ids = scheduled_game_ids(since, until)
    out = {"since": since.isoformat(), "until": until.isoformat(), "rows": len(rows),
           "any_book": coverage(rows, ids)}
    books = sorted({p["book"] for r in rows for p in (r.get("prices") or [])})
    for b in books:
        out[b] = {k: v for k, v in coverage(rows, ids, b).items() if k != "missing"}
    out["gate_m0a_80pct"] = bool(out["any_book"]["pct"] is not None and out["any_book"]["pct"] >= 80.0)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("command", nargs="?", default="capture", choices=["capture", "report"])
    ap.add_argument("--window", type=float, default=DEFAULT_WINDOW_MIN,
                    help="capture games starting within this many minutes (default 25; 1440 = whole slate)")
    ap.add_argument("--games", default="", help="comma-separated game ids to capture regardless of window")
    ap.add_argument("--now", default=None, help="override the clock (ISO UTC), for replays/tests")
    ap.add_argument("--out", default=SNAPSHOT_DIR, help="archive root (default pipeline/snapshots)")
    ap.add_argument("--dry-run", action="store_true", help="build rows and print them; write nothing")
    ap.add_argument("--trigger", default=os.environ.get("SNAPSHOT_TRIGGER", "manual"))
    ap.add_argument("--no-lineups", action="store_true")
    ap.add_argument("--no-injuries", action="store_true")
    ap.add_argument("--since", default=None)
    ap.add_argument("--until", default=None)
    a = ap.parse_args(argv)
    if a.command == "report":
        if not a.since:
            ap.error("report needs --since YYYY-MM-DD")
        print(json.dumps(report(a.since, a.until, a.out), indent=1))
        return 0
    ids = [int(x) for x in a.games.replace(" ", "").split(",") if x.strip().isdigit()]
    res = run(now=a.now, window_min=a.window, game_ids=ids, root=a.out, dry_run=a.dry_run,
              trigger=a.trigger, run_id=os.environ.get("GITHUB_RUN_ID"),
              with_lineups=not a.no_lineups, with_injuries=not a.no_injuries)
    if a.dry_run:
        print(json.dumps(res.get("rows", []), indent=1, ensure_ascii=False)[:20000])
    print(json.dumps({k: v for k, v in res.items() if k != "rows"}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
