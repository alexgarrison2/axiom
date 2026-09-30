"""
fetch_dailyfaceoff.py — DailyFaceoff goalies, lineups (+ cap data) and news.

Reliability rules
  * Dates are the NHL's local date (America/New_York via season.today_local),
    never the runner's UTC date, so evening runs keep tonight's games.
  * Goalies and lineups are MERGED into the existing JSON per game/team: a
    failed or partial fetch never deletes data, and a later fetch never
    downgrades a Confirmed starter to Unconfirmed for the same goalie.
  * Lineups are fetched hourly only for teams playing in the next 36 hours;
    all 32 teams are refreshed at most once per ALL_TEAMS_MAX_AGE_HOURS
    (overnight / full run).  Each team entry carries lineup_source
    ('Projected', 'Practice', ...) and updated_at from DFO.
  * The lineup payload's per-player ``cap`` object is kept in CAP_DATA for
    fetch_contracts (replaces the blocked PuckPedia scrape).
"""
import json
import os
import re
from datetime import datetime, timedelta, timezone

from season import today_local
from http_utils import get_text, HttpError
from io_utils import (atomic_write_json, read_json, record_source, source_age_hours,
                      utc_now_iso, mark_stale, keep_if_unchanged)
from paths import PIPELINE_DIR, public_path

GOALIES_FILE = os.path.join(PIPELINE_DIR, "dailyfaceoff_goalies.json")
LINEUPS_FILE = os.path.join(PIPELINE_DIR, "team_lineups.json")
NEWS_FILE = os.path.join(PIPELINE_DIR, "player_news.json")
PLAYOFF_NEWS_FILE = os.path.join(PIPELINE_DIR, "playoff_player_news.json")

GOALIE_REUSE_MINUTES = 10        # fetch_upcoming and predict_games both ask; one fetch serves both
ALL_TEAMS_MAX_AGE_HOURS = 20     # full 32-team lineup refresh at most ~daily
HOURLY_WINDOW_HOURS = 36         # hourly runs refresh teams playing within this window
LINE_GROUPS = ("f1", "f2", "f3", "f4", "d1", "d2", "d3", "g", "ir", "pk1", "pk2")

STATUS_RANK = {"confirmed": 3, "likely": 2, "probable": 2, "expected": 2, "unconfirmed": 1, "": 0, None: 0}

CAP_DATA: dict = {}               # tri -> [{name, pos, dfo_id, cap}] (filled by fetch_lineups)
_LINEUPS_FETCHED_THIS_RUN: dict = {}


def _next_data(url):
    """Return the parsed __NEXT_DATA__ blob of a DFO page, or None."""
    try:
        html = get_text(url, retries=2, timeout=20)
    except HttpError as e:
        print(f"  [WARN] DFO {url}: {e}")
        return None
    m = re.search(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
    if not m:
        print(f"  [WARN] DFO {url}: no __NEXT_DATA__ (blocked or layout change)")
        return None
    try:
        return json.loads(m.group(1))
    except ValueError:
        return None


def _write_both(local_path, public_name, data, **kw):
    ok = atomic_write_json(local_path, data, indent=4, **kw)
    if ok and os.path.isdir(public_path()):
        atomic_write_json(public_path(public_name), data, indent=4, label=public_name)
    return ok


# ── Starting goalies ─────────────────────────────────────────────────────────

def _rank(status):
    return STATUS_RANK.get((status or "").strip().lower(), 1)


def merge_goalie_entry(old, new):
    """Keep a Confirmed starter unless DFO now names a different goalie."""
    if not old:
        return new
    if not new.get("goalie"):
        return old
    if keep_if_unchanged(old, new) is old:     # same report: keep it byte-identical
        return old
    same = (old.get("goalie") or "").lower() == (new.get("goalie") or "").lower()
    if same and _rank(old.get("status")) > _rank(new.get("status")):
        kept = dict(old)
        kept["fetched_at"] = new.get("fetched_at")
        kept["note"] = f"kept {old.get('status')} (DFO now says {new.get('status') or 'nothing'})"
        return keep_if_unchanged(old, kept)
    return new


def fetch_dailyfaceoff_goalies(dates=None, now=None, force=False):
    """Fetch DFO starting goalies for today and tomorrow (NHL local date) and
    merge them into dailyfaceoff_goalies.json.  Returns the merged dict
    keyed "<Team Full Name>_<YYYY-MM-DD>"."""
    existing = read_json(GOALIES_FILE, {}) or {}
    age_min = (source_age_hours("dfo_goalies") or 1e9) * 60
    if not force and dates is None and age_min < GOALIE_REUSE_MINUTES and existing:
        print(f"Daily Faceoff goalies fetched {age_min:.0f} min ago — reusing")
        return existing

    if not force and dates is None and not teams_playing_within(now=now):
        # No game in the next 36h (off-days, breaks, offseason): nothing to
        # confirm, so spend no DFO requests this hour.
        print("Daily Faceoff goalies: no games within 36h — skipping")
        return existing

    today = today_local(now)
    dates = dates or [today.isoformat(), (today + timedelta(days=1)).isoformat()]
    print(f"Fetching Daily Faceoff starting goalies for {', '.join(dates)} (ET)...")
    fetched_at = utc_now_iso()
    merged = dict(existing)
    ok_pages = 0
    for date_str in dates:
        data = _next_data(f"https://www.dailyfaceoff.com/starting-goalies/{date_str}")
        if not data:
            continue
        games = (data.get("props", {}).get("pageProps", {}) or {}).get("data", []) or []
        ok_pages += 1
        print(f"  {date_str}: {len(games)} games")
        for game in games:
            gdate = game.get("date") or date_str
            for side in ("home", "away"):
                team = game.get(f"{side}TeamName")
                if not team:
                    continue
                goalie = game.get(f"{side}GoalieName") or (game.get(f"{side}Goalie") or {}).get("name")
                status = game.get(f"{side}NewsStrengthName") or ("Unconfirmed" if goalie else None)
                entry = {
                    "goalie": goalie, "status": status, "date": gdate, "team": team,
                    "source": "dailyfaceoff", "news_source": game.get(f"{side}NewsSourceName"),
                    "news_at": game.get(f"{side}NewsCreatedAt"), "fetched_at": fetched_at,
                }
                key = f"{team}_{gdate}"
                merged[key] = merge_goalie_entry(existing.get(key), entry)

    # prune entries more than 3 days old
    cutoff = (today - timedelta(days=3)).isoformat()
    merged = {k: v for k, v in merged.items() if not isinstance(v, dict) or (v.get("date") or "9") >= cutoff}
    if ok_pages:
        _write_both(GOALIES_FILE, "dailyfaceoff_goalies.json", merged, label="dailyfaceoff_goalies.json")
        record_source("dfo_goalies", pages=ok_pages)
    else:
        mark_stale("dailyfaceoff_goalies.json", "DFO starting-goalies pages unavailable")
    return merged


# ── News ─────────────────────────────────────────────────────────────────────

def _news_items():
    data = _next_data("https://www.dailyfaceoff.com/hockey-player-news")
    if not data:
        return None
    return ((data.get("props", {}).get("pageProps", {}) or {}).get("data", {}) or {}).get("data", []) or []


_NEWS_CACHE = None


def _cached_news_items():
    global _NEWS_CACHE
    if _NEWS_CACHE is None:
        _NEWS_CACHE = _news_items()
    return _NEWS_CACHE


def fetch_player_news():
    print("Fetching Daily Faceoff Player News...")
    items = _cached_news_items()
    accumulated = read_json(NEWS_FILE, {}) or {}
    if items is None:
        return accumulated
    today_str = today_local().isoformat()
    for item in items:
        details, tri = item.get("details", ""), item.get("teamAbbreviation")
        if not details or not tri:
            continue
        player = item.get("playerName", "Unknown")
        ts, ndate = item.get("createdAt"), item.get("date", today_str)
        lst = accumulated.setdefault(tri, [])
        if f"{player}-{ts or ndate}" not in {f"{n['player']}-{n.get('timestamp') or n.get('date', '')}" for n in lst}:
            lst.append({"player": player, "news": details, "category": item.get("newsCategoryName", "Unknown"),
                        "date": ndate, "timestamp": ts})
    cutoff = (today_local() - timedelta(days=30)).isoformat()
    for tri in accumulated:
        accumulated[tri] = sorted([n for n in accumulated[tri] if (n.get("date") or "") >= cutoff],
                                  key=lambda x: x.get("timestamp") or x.get("date", ""), reverse=True)
    _write_both(NEWS_FILE, "player_news.json", accumulated, label="player_news.json")
    print(f"  News for {len(accumulated)} teams.")
    return accumulated


def fetch_playoff_player_news():
    print("Fetching Daily Faceoff Playoff Player News (accumulating)...")
    accumulated = read_json(PLAYOFF_NEWS_FILE, {}) or {}
    items = _cached_news_items()
    if items is None:
        return accumulated
    sigs = {f"{i.get('player', '')}-{i.get('timestamp', i.get('date', ''))}" for v in accumulated.values() for i in v}
    new = 0
    for item in items:
        details, tri = item.get("details", ""), item.get("teamAbbreviation")
        if not details or not tri:
            continue
        player, ts, ndate = item.get("playerName", "Unknown"), item.get("createdAt"), item.get("date", "")
        sig = f"{player}-{ts or ndate}"
        if sig in sigs:
            continue
        sigs.add(sig)
        accumulated.setdefault(tri, []).append({"player": player, "news": details,
                                                "category": item.get("newsCategoryName", "Unknown"),
                                                "date": ndate, "timestamp": ts})
        new += 1
    for tri in accumulated:
        accumulated[tri].sort(key=lambda x: x.get("timestamp") or x.get("date") or "", reverse=True)
    _write_both(PLAYOFF_NEWS_FILE, "playoff_player_news.json", accumulated, label="playoff_player_news.json")
    print(f"  Added {new} new items.")
    return accumulated


# ── Lineups ──────────────────────────────────────────────────────────────────

def _slug(team_name):
    return team_name.lower().replace(".", "").replace("é", "e").replace(" ", "-")


def teams_playing_within(hours=HOURLY_WINDOW_HOURS, now=None, upcoming_path=None):
    """Tricodes with a game starting within ``hours`` (from upcoming_games.json)."""
    now = now or datetime.now(timezone.utc)
    games = read_json(upcoming_path or os.path.join(PIPELINE_DIR, "upcoming_games.json"), []) or []
    out = set()
    for g in games:
        try:
            start = datetime.fromisoformat(g["startTimeUTC"].replace("Z", "+00:00"))
        except (KeyError, ValueError, AttributeError):
            continue
        if now - timedelta(hours=4) <= start <= now + timedelta(hours=hours):
            out.update(t for t in (g.get("homeTeamAbbrev"), g.get("awayTeamAbbrev")) if t)
    return out


def parse_lineup_payload(data):
    """(team_lines, meta, cap_rows) from a DFO line-combinations __NEXT_DATA__."""
    combos = (data.get("props", {}).get("pageProps", {}) or {}).get("combinations", {}) or {}
    players = combos.get("players", []) or []
    pp_map = {}
    for p in players:
        gid = (p.get("groupIdentifier") or "").lower()
        if gid in ("pp1", "pp2"):
            pp_map[p.get("playerId")] = int(gid[-1])
    lines, cap_rows = {}, []
    seen_cap = set()
    for p in players:
        gid = (p.get("groupIdentifier") or "").lower()
        pid = p.get("playerId")
        if p.get("cap") and pid not in seen_cap:
            seen_cap.add(pid)
            cap_rows.append({"name": p.get("name"), "pos": p.get("positionIdentifier"),
                             "dfo_id": pid, "cap": p.get("cap")})
        if gid not in LINE_GROUPS:
            continue
        lines.setdefault(gid, []).append({
            "name": p.get("name"),
            "number": p.get("jerseyNumber"),
            "pos": p.get("positionIdentifier"),
            "id": pid,
            "ppUnit": pp_map.get(pid),
            "injuryStatus": p.get("injuryStatus"),
            "gameTimeDecision": bool(p.get("gameTimeDecision")),
        })
    pos_order = {"lw": 1, "c": 2, "rw": 3, "ld": 1, "rd": 2, "g1": 1, "g2": 2}
    for gid in lines:
        lines[gid].sort(key=lambda x: pos_order.get(x["pos"], 99))
    meta = {"lineup_source": (combos.get("sourceName") or "").strip() or None,
            "updated_at": combos.get("updatedAt")}
    return lines, meta, cap_rows


def _movement(new_lines, old_lines):
    old_ranks = {}
    for gid, plist in (old_lines or {}).items():
        if not isinstance(plist, list) or gid[:1] not in ("f", "d"):
            continue
        rank = int(gid[1]) if len(gid) > 1 and gid[1].isdigit() else 99
        for p in plist:
            if isinstance(p, dict) and p.get("id"):
                old_ranks[p["id"]] = rank
    for gid, plist in new_lines.items():
        if gid[:1] not in ("f", "d"):
            continue
        rank = int(gid[1]) if len(gid) > 1 and gid[1].isdigit() else 99
        for p in plist:
            pid = p.get("id")
            p["movement"] = None
            if pid and old_ranks:
                if pid not in old_ranks:
                    p["movement"] = "new"
                elif rank < old_ranks[pid]:
                    p["movement"] = "up"
                elif rank > old_ranks[pid]:
                    p["movement"] = "down"


def fetch_lineups(teams, force_all=False, now=None):
    """Fetch DFO line combinations and merge into team_lineups.json.

    ``teams``: [{'triCode', 'teamName'}].  Unless ``force_all`` (or the last
    all-teams refresh is older than ALL_TEAMS_MAX_AGE_HOURS), only teams
    playing within HOURLY_WINDOW_HOURS are requested; every other team keeps
    its stored lineup.  Returns the full merged {tri: lineup} dict."""
    old = read_json(LINEUPS_FILE, {}) or {}
    all_age = source_age_hours("dfo_lineups_all")
    do_all = force_all or all_age is None or all_age >= ALL_TEAMS_MAX_AGE_HOURS
    wanted = {t.get("triCode") for t in teams if t.get("triCode")}
    if not do_all:
        wanted &= teams_playing_within(now=now)
    wanted -= set(_LINEUPS_FETCHED_THIS_RUN)
    todo = [t for t in teams if t.get("triCode") in wanted and t.get("teamName")]
    print(f"Fetching Daily Faceoff lineups for {len(todo)} team(s) "
          f"({'all-teams refresh' if do_all else 'teams playing within 36h'})...")

    merged = dict(old)
    fetched_at = utc_now_iso()
    ok = 0
    for t in todo:
        tri, name = t["triCode"], t["teamName"]
        data = _next_data(f"https://www.dailyfaceoff.com/teams/{_slug(name)}/line-combinations")
        if not data:
            continue
        lines, meta, cap_rows = parse_lineup_payload(data)
        if not any(g.startswith("f") for g in lines):
            print(f"  [WARN] {tri}: empty lineup payload — keeping stored lineup")
            continue
        prev = old.get(tri) if isinstance(old.get(tri), dict) else None
        _movement(lines, prev)
        entry = dict(lines)
        entry.update({"lineup_source": meta["lineup_source"], "updated_at": meta["updated_at"],
                      "fetched_at": fetched_at})
        # Same lines as stored: keep the stored entry (its movement arrows and
        # fetched_at) instead of rewriting it with a new timestamp.
        merged[tri] = keep_if_unchanged(prev, entry, keys=("fetched_at", "movement"))
        CAP_DATA[tri] = cap_rows
        _LINEUPS_FETCHED_THIS_RUN[tri] = fetched_at
        ok += 1
    if ok:
        _write_both(LINEUPS_FILE, "team_lineups.json", merged, min_items=len(old), label="team_lineups.json")
        if do_all and ok >= len(todo) * 0.9 and len(todo) >= 30:
            record_source("dfo_lineups_all", teams=ok)
    elif todo:
        mark_stale("team_lineups.json", "DFO line-combination pages unavailable")
    print(f"  Lineups refreshed for {ok}/{len(todo)} team(s); {len(merged)} teams stored.")
    return merged


if __name__ == "__main__":
    fetch_dailyfaceoff_goalies(force=True)
