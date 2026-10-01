"""
fetch_odds.py — pregame betting lines keyed by NHL gameId.

Sources, in priority order (all free, no keys):
  1. NHL partner feed   api-web /v1/partner-game/US/now   (DraftKings; today's
     full markets: 2-way ML, puck line, total, 3-way)
  2. NHL schedule feed  api-web /v1/schedule/{date}       (per-team ML for the
     rest of the week, when published)
  3. Bovada             /services/sports/event/v2/events/A/description/hockey/nhl
     (secondary: fills 1st-period ML, 3-way and anything still missing)
  4. ESPN scoreboard    per-game fallback for any game still without a ML

Rules
  * Only pregame lines: an event that is live, has started (start <= now) or
    whose NHL state is not FUT/PRE is skipped.  Started games are dropped
    from odds.json.
  * Everything is keyed by the 10-digit NHL gameId; games from other sources
    are matched by team abbreviations plus a start time within ±12h.
  * Each game records ``source``, ``sources`` and ``fetched_at``.
  * Sanity: totals outside [4.5, 9.5] and prices beyond ±1000 (puck line) /
    ±2500 (ML) are dropped as live/garbage lines.
  * odds_closing.json keeps the last pregame snapshot of every game and is
    never modified after the game starts.
  * A game whose markets did not move keeps its previous entry and
    fetched_at ("unchanged since"), so a no-change run writes identical
    files; manifest.sources.odds.fetched_at records the latest check.
  * odds.json is written atomically and never empty.

Output (pipeline/odds.json, public/data/odds.json, data/odds.json):
  { "2026020006": { "game_id": 2026020006, "game_date": "2026-09-30",
      "start_time_utc": "2026-09-30T23:30:00Z", "home_abbrev": "PHI", ...,
      "Flyers": -142, "Penguins": 120,                 # legacy team-name keys
      "Flyers_puckline": 180, "Flyers_puckline_spread": "-1.5",
      "total_line": "5.5", "total_over": -110, "total_under": -110,
      "Flyers_three_way": 150, "three_way_tie": 290, "Flyers_1p_ml": -120,
      "source": "nhl_partner", "sources": [...], "fetched_at": "..." } }
"""
import os
from datetime import datetime, timedelta, timezone

from http_utils import try_get_json
from io_utils import atomic_write_json, read_json, utc_now_iso, mark_stale, keep_if_unchanged, record_source
from paths import pipeline_path, public_path, data_path

ODDS_FILE = pipeline_path("odds.json")
CLOSING_FILE = public_path("odds_closing.json")

PARTNER_URL = "https://api-web.nhle.com/v1/partner-game/US/now"
SCHEDULE_URL = "https://api-web.nhle.com/v1/schedule/{date}"
BOVADA_URL = "https://www.bovada.lv/services/sports/event/v2/events/A/description/hockey/nhl"
ESPN_URL = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates={d}"

PREGAME_STATES = {"FUT", "PRE", None, ""}
MATCH_WINDOW = timedelta(hours=12)
TOTAL_RANGE = (4.5, 9.5)
MAX_PUCKLINE = 1000
MAX_ML = 2500

# Bovada full team names → NHL tricodes
FULLNAME_TO_TRI = {
    "Anaheim Ducks": "ANA", "Boston Bruins": "BOS", "Buffalo Sabres": "BUF", "Calgary Flames": "CGY",
    "Carolina Hurricanes": "CAR", "Chicago Blackhawks": "CHI", "Colorado Avalanche": "COL",
    "Columbus Blue Jackets": "CBJ", "Dallas Stars": "DAL", "Detroit Red Wings": "DET",
    "Edmonton Oilers": "EDM", "Florida Panthers": "FLA", "Los Angeles Kings": "LAK", "Minnesota Wild": "MIN",
    "Montreal Canadiens": "MTL", "Montréal Canadiens": "MTL", "Nashville Predators": "NSH",
    "New Jersey Devils": "NJD", "New York Islanders": "NYI", "New York Rangers": "NYR",
    "Ottawa Senators": "OTT", "Philadelphia Flyers": "PHI", "Pittsburgh Penguins": "PIT",
    "San Jose Sharks": "SJS", "Seattle Kraken": "SEA", "St. Louis Blues": "STL", "St Louis Blues": "STL",
    "Tampa Bay Lightning": "TBL", "Toronto Maple Leafs": "TOR", "Utah Hockey Club": "UTA", "Utah Mammoth": "UTA",
    "Vancouver Canucks": "VAN", "Vegas Golden Knights": "VGK", "Washington Capitals": "WSH", "Winnipeg Jets": "WPG",
}


def _dt(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (TypeError, ValueError):
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


def _fmt_line(x):
    """Total line as '6.5'."""
    try:
        return f"{float(str(x).strip().lstrip('oOuU+')):.1f}"
    except ValueError:
        return None


def _fmt_spread(x):
    """Puck-line spread always signed: '+1.5' / '-1.5'."""
    try:
        return f"{float(str(x).strip()):+.1f}"
    except ValueError:
        return None


class Book:
    """Collects markets for one NHL game, never overwriting a market already
    supplied by a higher-priority source."""

    def __init__(self, g, fetched_at):
        self.g = g
        self.e = {
            "game_id": int(g["id"]), "game_date": g.get("gameDate"), "start_time_utc": g.get("startTimeUTC"),
            "home_team": g.get("homeTeam"), "away_team": g.get("awayTeam"),
            "home_abbrev": g.get("homeTeamAbbrev"), "away_abbrev": g.get("awayTeamAbbrev"),
            "source": None, "sources": [], "fetched_at": fetched_at,
        }

    def side_name(self, side):
        return self.e["home_team"] if side == "home" else self.e["away_team"]

    def put(self, key, val, source):
        if val is None or key in self.e:
            return False
        self.e[key] = val
        if source not in self.e["sources"]:
            self.e["sources"].append(source)
        return True

    def put_ml(self, home, away, source):
        if home is None or away is None or self.has_ml():
            return
        self.put(self.side_name("home"), home, source)
        self.put(self.side_name("away"), away, source)
        self.e["home_ml"], self.e["away_ml"] = home, away
        self.e["source"] = source

    def has_ml(self):
        return "home_ml" in self.e


# ── Sources ──────────────────────────────────────────────────────────────────

def from_partner(books, fetched_at, now=None):
    """DraftKings markets from the NHL partner feed.  The feed keeps serving
    the previous day's games (with live in-game prices) until it rolls over,
    so only games still in ``books`` (pregame) and not yet started are used."""
    data = try_get_json(PARTNER_URL, ua="plain", retries=2)
    if not data:
        return 0
    now = now or _dt(fetched_at)
    n = skipped = 0
    for pg in data.get("games", []) or []:
        b = books.get(int(pg.get("gameId", 0)))
        st = _dt(pg.get("startTimeUTC"))
        if not b or (st and now and st <= now):
            skipped += 1
            continue
        src = "nhl_partner_" + ((data.get("bettingPartner") or {}).get("name") or "dk").lower().replace(" ", "")
        side_ml = {}
        for side in ("home", "away"):
            team = pg.get(f"{side}Team") or {}
            name = b.side_name(side)
            for o in team.get("odds", []) or []:
                desc, q, val = o.get("description"), (o.get("qualifier") or "").strip(), _american(o.get("value"))
                if desc == "MONEY_LINE_2_WAY":
                    side_ml[side] = val
                elif desc == "PUCK_LINE" and q:
                    b.put(f"{name}_puckline", val, src)
                    b.put(f"{name}_puckline_spread", _fmt_spread(q), src)
                elif desc == "OVER_UNDER" and q[:1] in "OU":
                    b.put("total_over" if q[0] == "O" else "total_under", val, src)
                    b.put("total_line", _fmt_line(q[1:]), src)
                elif desc == "MONEY_LINE_3_WAY":
                    if q.lower() == "draw":
                        b.put("three_way_tie", val, src)
                    else:
                        b.put(f"{name}_three_way", val, src)
        b.put_ml(side_ml.get("home"), side_ml.get("away"), src)
        n += 1
    print(f"  NHL partner feed ({data.get('currentOddsDate')}): {n} pregame game(s) used, "
          f"{skipped} started/other-day skipped")
    return n


def from_schedule(books, dates, fetched_at):
    n = 0
    for d in dates:
        data = try_get_json(SCHEDULE_URL.format(date=d), ua="plain", retries=2)
        if not data:
            continue
        for day in data.get("gameWeek", []) or []:
            for g in day.get("games", []) or []:
                b = books.get(int(g.get("id", 0)))
                if not b or b.has_ml():
                    continue
                vals = {}
                for side in ("home", "away"):
                    odds = (g.get(f"{side}Team") or {}).get("odds") or []
                    if odds:
                        vals[side] = _american(odds[0].get("value"))
                if vals.get("home") is not None and vals.get("away") is not None:
                    b.put_ml(vals["home"], vals["away"], "nhl_schedule")
                    n += 1
    return n


def _match(books, home_tri, away_tri, start):
    for b in books.values():
        if b.e["home_abbrev"] == home_tri and b.e["away_abbrev"] == away_tri:
            s = _dt(b.e["start_time_utc"])
            if s and start and abs(s - start) <= MATCH_WINDOW:
                return b
    return None


def from_bovada(books, now):
    data = try_get_json(BOVADA_URL, retries=2)
    if not isinstance(data, list):
        return 0, 0
    seen, matched, skipped_live = set(), 0, 0
    for group in data:
        for ev in group.get("events", []) or []:
            desc = ev.get("description", "")
            if " @ " not in desc or ev.get("id") in seen:
                continue
            seen.add(ev.get("id"))
            start = datetime.fromtimestamp(ev["startTime"] / 1000, tz=timezone.utc) if ev.get("startTime") else None
            if ev.get("live") or (start and start <= now):
                skipped_live += 1
                continue
            away_raw, home_raw = desc.split(" @ ", 1)
            b = _match(books, FULLNAME_TO_TRI.get(home_raw.strip()), FULLNAME_TO_TRI.get(away_raw.strip()), start)
            if not b:
                continue
            matched += 1
            _parse_bovada_event(b, ev, away_raw.strip(), home_raw.strip())
    print(f"  Bovada: {len(seen)} NHL events, {matched} matched to upcoming games, {skipped_live} live/started skipped")
    return matched, skipped_live


def _parse_bovada_event(b, ev, away_raw, home_raw):
    src = "bovada"

    def side_of(out_desc):
        base = (out_desc or "").split(" - ")[0].strip()
        if base == home_raw or FULLNAME_TO_TRI.get(base) == b.e["home_abbrev"]:
            return "home"
        if base == away_raw or FULLNAME_TO_TRI.get(base) == b.e["away_abbrev"]:
            return "away"
        return None

    groups = {g.get("description"): g for g in ev.get("displayGroups", []) or []}
    ml = {}
    for m in (groups.get("Game Lines") or {}).get("markets", []) or []:
        mdesc, outs = m.get("description", ""), m.get("outcomes", []) or []
        period = ((m.get("period") or {}).get("abbreviation") or "").upper()
        is_1p = period in ("1P", "P1") or any((o.get("description") or "").endswith("1P") for o in outs)
        full_game = period in ("", "G", "M", "RT") and not is_1p
        for o in outs:
            price = o.get("price", {}) or {}
            val, hcap, side = _american(price.get("american")), price.get("handicap"), side_of(o.get("description"))
            if mdesc == "Moneyline" and full_game and side:
                ml[side] = val
            elif mdesc == "Moneyline" and is_1p and side:
                b.put(f"{b.side_name(side)}_1p_ml", val, src)
            elif mdesc == "Puck Line" and full_game and side:
                b.put(f"{b.side_name(side)}_puckline", val, src)
                if hcap:
                    b.put(f"{b.side_name(side)}_puckline_spread", _fmt_spread(hcap), src)
            elif mdesc == "Total" and full_game:
                d = (o.get("description") or "")
                if d.startswith("Over"):
                    b.put("total_over", val, src)
                elif d.startswith("Under"):
                    b.put("total_under", val, src)
                if hcap and ("total_over" in b.e or "total_under" in b.e):
                    b.put("total_line", _fmt_line(hcap), src)
    b.put_ml(ml.get("home"), ml.get("away"), src)
    for m in (groups.get("Game Props") or {}).get("markets", []) or []:
        outs = m.get("outcomes", []) or []
        if m.get("description") == "3-Way Moneyline" and not any("P" in (o.get("description") or "")[-3:] for o in outs):
            for o in outs:
                val = _american((o.get("price") or {}).get("american"))
                d = o.get("description") or ""
                if "Tie" in d or "Draw" in d:
                    b.put("three_way_tie", val, src)
                elif side_of(d):
                    b.put(f"{b.side_name(side_of(d))}_three_way", val, src)
            break


def from_espn(books, now):
    missing = [b for b in books.values() if not b.has_ml()]
    n = 0
    for d in sorted({b.e["game_date"] for b in missing if b.e["game_date"]}):
        data = try_get_json(ESPN_URL.format(d=d.replace("-", "")), ua="espn", retries=2)
        if not data:
            continue
        from fetch_injuries import espn_tri
        for ev in data.get("events", []) or []:
            comp = (ev.get("competitions") or [{}])[0]
            if ((comp.get("status") or {}).get("type") or {}).get("state") not in (None, "pre"):
                continue
            tris = {c.get("homeAway"): espn_tri((c.get("team") or {}).get("abbreviation"))
                    for c in comp.get("competitors", []) or []}
            b = _match(books, tris.get("home"), tris.get("away"), _dt(ev.get("date")))
            if not b or b.has_ml():
                continue
            o = (comp.get("odds") or [{}])[0]
            mlo = o.get("moneyline") or {}
            pick = lambda s: _american(((mlo.get(s) or {}).get("close") or {}).get("odds")  # noqa: E731
                                       or ((mlo.get(s) or {}).get("open") or {}).get("odds"))
            src = "espn_" + ((o.get("provider") or {}).get("name") or "").lower().replace(" ", "")
            b.put_ml(pick("home"), pick("away"), src)
            if o.get("overUnder") is not None:
                tot = o.get("total") or {}
                b.put("total_line", _fmt_line(o.get("overUnder")), src)
                b.put("total_over", _american(((tot.get("over") or {}).get("close") or {}).get("odds")), src)
                b.put("total_under", _american(((tot.get("under") or {}).get("close") or {}).get("odds")), src)
            n += 1
    return n


# ── Sanity ───────────────────────────────────────────────────────────────────

def sanity_problems(entry, now_iso=None):
    """List of problems with one odds entry (empty = ok)."""
    probs = []
    tl = entry.get("total_line")
    if tl not in (None, ""):
        try:
            t = float(tl)
            if not (TOTAL_RANGE[0] <= t <= TOTAL_RANGE[1]):
                probs.append(f"total_line {t}")
        except ValueError:
            probs.append(f"total_line {tl!r}")
    for k, v in entry.items():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            if k.endswith("_puckline") and abs(v) > MAX_PUCKLINE:
                probs.append(f"{k} {v}")
            if (k in ("home_ml", "away_ml")) and abs(v) > MAX_ML:
                probs.append(f"{k} {v}")
    st, fa = _dt(entry.get("start_time_utc")), _dt(entry.get("fetched_at") or now_iso)
    if st and fa and st <= fa:
        probs.append("fetched after start")
    return probs


def _scrub(entry):
    """Drop individual markets that fail the sanity rules."""
    tl = entry.get("total_line")
    try:
        bad_total = tl not in (None, "") and not (TOTAL_RANGE[0] <= float(tl) <= TOTAL_RANGE[1])
    except ValueError:
        bad_total = True
    if bad_total:
        print(f"  [SANITY] {entry['game_id']}: dropping total {tl}")
        for k in ("total_line", "total_over", "total_under"):
            entry.pop(k, None)
    for k in [k for k, v in entry.items() if k.endswith("_puckline") and isinstance(v, int) and abs(v) > MAX_PUCKLINE]:
        print(f"  [SANITY] {entry['game_id']}: dropping {k} {entry[k]}")
        entry.pop(k, None)
        entry.pop(k + "_spread", None)
    return entry


def validate_odds(data, now_iso=None):
    bad = {gid: p for gid, e in data.items() if isinstance(e, dict) for p in [sanity_problems(e, now_iso)] if p}
    keys_ok = all(str(k).isdigit() and len(str(k)) == 10 for k in data)
    if not keys_ok:
        return "non-gameId keys"
    return f"sanity: {bad}" if bad else None


# ── Main ─────────────────────────────────────────────────────────────────────

def fetch_odds(now=None, upcoming=None):
    now = now or datetime.now(timezone.utc)
    fetched_at = now.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    upcoming = upcoming if upcoming is not None else (read_json(pipeline_path("upcoming_games.json"), []) or [])
    pregame = {}
    for g in upcoming:
        st = _dt(g.get("startTimeUTC"))
        if st and st > now and g.get("gameState") in PREGAME_STATES:
            pregame[int(g["id"])] = g
    print(f"Fetching odds for {len(pregame)} pregame game(s) (of {len(upcoming)} upcoming)...")
    books = {gid: Book(g, fetched_at) for gid, g in pregame.items()}

    counts = {"nhl_partner": from_partner(books, fetched_at, now)}
    dates = sorted({b.e["game_date"] for b in books.values() if not b.has_ml() and b.e["game_date"]})
    counts["nhl_schedule"] = from_schedule(books, dates[:1], fetched_at) if dates else 0
    counts["bovada"], _ = from_bovada(books, now)
    counts["espn"] = from_espn(books, now)
    print(f"  Sources: {counts}")

    fresh = {}
    for gid, b in books.items():
        if not b.has_ml():
            continue
        e = _scrub(b.e)
        probs = sanity_problems(e)
        if probs:   # e.g. a live-looking moneyline: drop the game rather than the file
            print(f"  [SANITY] {gid}: dropped ({'; '.join(probs)})")
            continue
        fresh[str(gid)] = e

    # A game whose markets are unchanged keeps its previous entry (and
    # fetched_at, i.e. "price unchanged since"), so an hourly run with no line
    # moves writes a byte-identical file: no data commit, no site rebuild.
    prev = read_json(ODDS_FILE, {}) or {}
    for k in list(fresh):
        if isinstance(prev.get(k), dict):
            fresh[k] = keep_if_unchanged(prev[k], fresh[k])

    # Carry forward still-pregame games from the previous file when every
    # source missed them this run (e.g. Bovada blocked, NHL feed lagging).
    for k, e in prev.items():
        if k in fresh or not (str(k).isdigit() and isinstance(e, dict)):
            continue
        st = _dt(e.get("start_time_utc"))
        if st and st > now and int(k) in pregame:
            fresh[k] = e
    out = dict(sorted(fresh.items()))
    missing = [gid for gid in pregame if str(gid) not in out]
    if missing:
        print(f"  [WARN] no pregame line for {len(missing)} game(s): {missing[:8]}")

    ok = atomic_write_json(ODDS_FILE, out, min_items=1, indent=4, label="odds.json",
                           validator=lambda d: validate_odds(d))
    if ok:
        for path in (public_path("odds.json"), data_path("odds.json")):
            if os.path.isdir(os.path.dirname(path)):
                atomic_write_json(path, out, indent=4, label="odds.json")
        update_closing(out, now)
        record_source("odds", games=len(out), counts=counts)
        print(f"  ✓ odds.json: {len(out)} pregame games")
    else:
        mark_stale("odds.json", "no valid pregame odds this run")
    return {"status": "ok" if ok else ("skip" if not pregame else "fail"),
            "rows_written": len(out) if ok else 0, "sources": counts}


def update_closing(odds, now, path=None):
    """Record the latest pregame snapshot per game; frozen once the game starts."""
    path = path or CLOSING_FILE
    closing = read_json(path, {}) or {}
    changed = 0
    for gid, e in odds.items():
        st = _dt(e.get("start_time_utc"))
        if not st or st <= now:
            continue                       # never touch a started game
        if (closing.get(gid) or {}).get("start_time_utc") and _dt(closing[gid]["start_time_utc"]) <= now:
            continue
        snap = dict(e)
        snap["captured_at"] = now.replace(microsecond=0).isoformat().replace("+00:00", "Z")
        kept = keep_if_unchanged(closing.get(gid), snap)
        if kept is snap:
            closing[gid] = snap
            changed += 1
    if changed:
        atomic_write_json(path, dict(sorted(closing.items())), indent=1, min_items=len(closing),
                          label="odds_closing.json")
    return changed


if __name__ == "__main__":
    print(fetch_odds())
