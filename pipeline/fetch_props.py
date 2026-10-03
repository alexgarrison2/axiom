"""
fetch_props.py — pregame player prop lines from Bovada, keyed by NHL gameId.

Bovada's public coupon API is the only free source of NHL player props that
answers scripted requests (DraftKings direct is Akamai-blocked; the NHL
partner feed carries game markets only). One request lists the events, then
one request per event returns its prop groups:

  Shots on Goal    "Total Shots On Goal - Name (TRI)"     over/under at a line
  Goalscorers      "Anytime Goalscorer"                    one price per player
                   "Who Will Score 2 Or More Goals"
  Points/Assists   "Player To Record 1|2 Or More Points"
                   "Player To Record 1 Or More Powerplay Points"
                   "Assists Milestones - Name (TRI)"       1+ / 2+ assists

Team tags in Bovada's labels are sometimes wrong ("Nikolaj Ehlers (CAL)"), so
players are keyed by name here and matched to NHL ids (restricted to the two
teams in the game) by prop_board.py.

Rules (same as fetch_odds.py): only pregame lines; a started or live event is
skipped. Games are matched to upcoming_games.json by team tricodes and a start
within 12h. Started games keep their last pregame lines in the per-day archive.

Outputs
  pipeline/player_props.json        { fetched_at, games: { gameId: { ..., players: { name: markets } } } }
  pipeline/prop_lines/<date>.csv    last pregame line per game/player/market (archive for grading)
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone

import pandas as pd

from fetch_odds import FULLNAME_TO_TRI, _american
from http_utils import try_get_json
from io_utils import atomic_write_json, atomic_write_csv, keep_if_unchanged, read_json, utc_now_iso, record_source, mark_stale
from paths import pipeline_path

EVENTS_URL = "https://www.bovada.lv/services/sports/event/v2/events/A/description/hockey/nhl"
EVENT_URL = "https://www.bovada.lv/services/sports/event/coupon/events/A/description{link}?lang=en"
PROPS_FILE = pipeline_path("player_props.json")
ARCHIVE_DIR = pipeline_path("prop_lines")
MATCH_WINDOW = timedelta(hours=12)

# One-price "milestone" markets: Bovada market description -> our key
LIST_MARKETS = {
    "Anytime Goalscorer": "atg",
    "Who Will Score 2 Or More Goals": "g2",
    "Player To Record 1 Or More Points": "p1",
    "Player To Record 2 Or More Points": "p2",
    "Player To Record 1 Or More Powerplay Points": "ppp1",
}
ASSIST_OUTCOMES = {"To Record 1+ Assists": "a1", "To Record 2+ Assists": "a2"}
NAME_TAG = re.compile(r"^(.*?)\s*\(([A-Z]{2,3})\)\s*$")


def _split_name(label: str):
    m = NAME_TAG.match(label or "")
    return (m.group(1).strip(), m.group(2)) if m else ((label or "").strip(), None)


def _full_game(market) -> bool:
    return ((market.get("period") or {}).get("abbreviation") or "G").upper() in ("G", "M", "RT", "")


def parse_event(ev) -> dict:
    """{player name: {"tag": TRI, "sog": [{line, over, under}], "atg": price, ...}}"""
    players: dict[str, dict] = {}

    def slot(name, tag):
        p = players.setdefault(name, {"tag": tag})
        if tag and not p.get("tag"):
            p["tag"] = tag
        return p

    for g in ev.get("displayGroups", []) or []:
        for m in g.get("markets", []) or []:
            if not _full_game(m):
                continue
            desc = m.get("description") or ""
            outs = m.get("outcomes", []) or []
            if desc.startswith("Total Shots On Goal - "):
                name, tag = _split_name(desc[len("Total Shots On Goal - "):])
                by_line: dict[float, dict] = {}
                for o in outs:
                    pr = o.get("price") or {}
                    try:
                        line = float(pr.get("handicap"))
                    except (TypeError, ValueError):
                        continue
                    side = (o.get("description") or "").split(" ")[0].lower()
                    if side in ("over", "under"):
                        by_line.setdefault(line, {"line": line})[side] = _american(pr.get("american"))
                lines = [v for v in by_line.values() if v.get("over") is not None]
                if lines:
                    slot(name, tag)["sog"] = sorted(lines, key=lambda v: v["line"])
            elif desc in LIST_MARKETS:
                key = LIST_MARKETS[desc]
                for o in outs:
                    name, tag = _split_name(o.get("description"))
                    val = _american((o.get("price") or {}).get("american"))
                    if name and val is not None:
                        slot(name, tag)[key] = val
            elif desc.startswith("Assists Milestones - "):
                name, tag = _split_name(desc[len("Assists Milestones - "):])
                for o in outs:
                    key = ASSIST_OUTCOMES.get((o.get("description") or "").strip())
                    val = _american((o.get("price") or {}).get("american"))
                    if key and val is not None:
                        slot(name, tag)[key] = val
    return {n: p for n, p in players.items() if len(p) > 1}


def _upcoming():
    return read_json(pipeline_path("upcoming_games.json"), []) or []


def _match_game(upcoming, home_tri, away_tri, start):
    for g in upcoming:
        if g.get("homeTeamAbbrev") == home_tri and g.get("awayTeamAbbrev") == away_tri:
            try:
                s = datetime.fromisoformat(str(g.get("startTimeUTC")).replace("Z", "+00:00"))
            except ValueError:
                continue
            if start and abs(s - start) <= MATCH_WINDOW:
                return g
    return None


def _archive(games: dict):
    """Upsert each pregame line into prop_lines/<game date>.csv (one row per game/player/market/line)."""
    rows = []
    for gid, g in games.items():
        for name, p in g["players"].items():
            for key, val in p.items():
                if key == "tag":
                    continue
                if key == "sog":
                    for ln in val:
                        rows.append((g["game_date"], int(gid), name, p.get("tag"), "sog", ln["line"], ln.get("over"), ln.get("under")))
                else:
                    rows.append((g["game_date"], int(gid), name, p.get("tag"), key, None, val, None))
    if not rows:
        return 0
    cols = ["game_date", "game_id", "player", "tag", "market", "line", "over", "under"]
    new = pd.DataFrame(rows, columns=cols)
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    for day, part in new.groupby("game_date"):
        path = os.path.join(ARCHIVE_DIR, f"{day}.csv")
        if os.path.exists(path):
            old = pd.read_csv(path)
            # Replace only the games this run saw pregame; started games keep their last line.
            old = old[~old["game_id"].isin(part["game_id"].unique())]
            part = pd.concat([old, part], ignore_index=True)
        atomic_write_csv(path, part.sort_values(["game_id", "player", "market", "line"]), label="prop_lines")
    return len(rows)


def fetch_props(now=None):
    now = now or datetime.now(timezone.utc)
    upcoming = _upcoming()
    listing = try_get_json(EVENTS_URL, retries=2)
    if not isinstance(listing, list):
        mark_stale("player_props", "Bovada event list unavailable")
        return {"status": "fail", "reason": "event list unavailable"}
    games, seen = {}, set()
    for group in listing:
        for ev in group.get("events", []) or []:
            desc, link = ev.get("description", ""), ev.get("link")
            if " @ " not in desc or not link or ev.get("id") in seen:
                continue
            seen.add(ev.get("id"))
            start = datetime.fromtimestamp(ev["startTime"] / 1000, tz=timezone.utc) if ev.get("startTime") else None
            if ev.get("live") or (start and start <= now):
                continue
            away_raw, home_raw = (s.strip() for s in desc.split(" @ ", 1))
            g = _match_game(upcoming, FULLNAME_TO_TRI.get(home_raw), FULLNAME_TO_TRI.get(away_raw), start)
            if not g:
                continue
            detail = try_get_json(EVENT_URL.format(link=link), retries=2)
            events = [e for blk in (detail or []) for e in blk.get("events", []) or []]
            if not events:
                continue
            players = parse_event(events[0])
            if players:
                games[str(g["id"])] = {
                    "game_id": int(g["id"]), "game_date": g.get("gameDate"),
                    "start_time_utc": g.get("startTimeUTC"),
                    "home": g.get("homeTeamAbbrev"), "away": g.get("awayTeamAbbrev"),
                    "players": players,
                }
    fetched = utc_now_iso()
    n_players = sum(len(g["players"]) for g in games.values())
    print(f"  Bovada props: {len(games)} games, {n_players} players priced")
    # Unchanged prices keep the old file (and its fetched_at): an hourly run with no line move commits nothing.
    doc = keep_if_unchanged(read_json(PROPS_FILE), {"fetched_at": fetched, "source": "bovada", "games": games})
    atomic_write_json(PROPS_FILE, doc)
    archived = _archive(games)
    record_source("player_props", fetched_at=fetched, games=len(games))
    return {"status": "ok", "rows_written": archived}


def main():
    return fetch_props()


if __name__ == "__main__":
    main()
