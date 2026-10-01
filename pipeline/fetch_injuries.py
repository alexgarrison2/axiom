"""
fetch_injuries.py — ESPN's free NHL injury feed → public/data/injuries.json

GET site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries (plain UA).
Each entry is matched to an NHL playerId by normalised name + team (current
rosters, then player_impact.json names, then the ids resolved on previous
runs, then the NHL player search).

Output: a list sorted by team then name:
  [{playerId, name, team, position, status, type, returnDate, comment,
    date, espn_id, fetched_at}]

status is ESPN's label: "Out", "Injured Reserve", "Day-To-Day", "Suspension".
fetched_at is when the entry was first seen in its current form (an entry
ESPN still reports unchanged keeps it); manifest.sources.espn_injuries
records the latest fetch.
A failed or empty fetch never overwrites the previous file (the stale flag is
recorded in public/data/manifest.json instead).

Also exports ESPN_TO_NHL / espn_tri() for other ESPN consumers.
"""
import re
import unicodedata
from urllib.parse import quote

from http_utils import get_json, try_get_json, HttpError
from io_utils import atomic_write_json, read_json, utc_now_iso, mark_stale, keep_if_unchanged, record_source
from paths import public_path, pipeline_path

URL = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries"
OUTPUT_FILE = public_path("injuries.json")
SEARCH_URL = "https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=5&active=true&q={q}"

ESPN_TO_NHL = {"LA": "LAK", "NJ": "NJD", "SJ": "SJS", "TB": "TBL", "UTAH": "UTA", "UTA": "UTA",
               "WSH": "WSH", "VGK": "VGK", "MON": "MTL", "CLS": "CBJ", "NAS": "NSH", "WAS": "WSH"}


def espn_tri(abbrev: str) -> str:
    a = (abbrev or "").upper()
    return ESPN_TO_NHL.get(a, a)


def norm(name: str) -> str:
    s = unicodedata.normalize("NFD", name or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower().strip()
    s = re.sub(r"\s+(jr\.?|sr\.?|ii|iii|iv)$", "", s)
    s = re.sub(r"[^a-z ]", " ", s.replace("-", " "))
    return " ".join(s.split())


def _name_index(rosters):
    from fetch_player_bio import player_display_name
    by_team, by_name = {}, {}
    for tri, r in (rosters or {}).items():
        for grp in ("forwards", "defensemen", "goalies"):
            for p in r.get(grp, []) or []:
                n = norm(player_display_name(p))
                by_team[(tri, n)] = int(p["id"])
                by_name.setdefault(n, set()).add(int(p["id"]))
    for pid, d in (read_json(pipeline_path("player_impact.json"), {}) or {}).items():
        n = norm(d.get("name"))
        for t in {d.get("team"), d.get("team_prev")} - {None}:
            by_team.setdefault((t, n), int(pid))
        by_name.setdefault(n, set()).add(int(pid))
    return by_team, by_name


def _search_player(name, tri):
    data = try_get_json(SEARCH_URL.format(q=quote(name)), ua="espn", retries=2) or []
    cands = [d for d in data if norm(d.get("name")) == norm(name)] if isinstance(data, list) else []
    same_team = [d for d in cands if (d.get("teamAbbrev") or "") == tri]
    pick = same_team or (cands if len(cands) == 1 else [])
    return int(pick[0]["playerId"]) if pick else None


def fetch_injuries(rosters=None, search_budget=40):
    print("Fetching ESPN injury report...")
    try:
        data = get_json(URL, ua="espn", retries=3)
    except HttpError as e:
        mark_stale("injuries.json", f"ESPN injuries unavailable: {e}")
        print(f"  [WARN] {e} — keeping the previous injuries.json")
        return {"status": "fail", "rows_written": 0, "reason": str(e)}

    if rosters is None:
        from fetch_player_bio import fetch_rosters
        rosters = fetch_rosters()
    by_team, by_name = _name_index(rosters)
    prev_list = [e for e in (read_json(OUTPUT_FILE, []) or []) if isinstance(e, dict)]
    prev_ids = {(e.get("team"), norm(e.get("name"))): e.get("playerId") for e in prev_list if e.get("playerId")}
    prev_by_key = {(e.get("espn_id"), e.get("team"), e.get("name")): e for e in prev_list}

    fetched_at = utc_now_iso()
    out, unmatched, searches = [], [], 0
    for team in data.get("injuries", []) or []:
        for inj in team.get("injuries", []) or []:
            ath = inj.get("athlete") or {}
            name = ath.get("displayName") or f"{ath.get('firstName', '')} {ath.get('lastName', '')}".strip()
            tri = espn_tri((ath.get("team") or {}).get("abbreviation"))
            n = norm(name)
            pid = by_team.get((tri, n)) or prev_ids.get((tri, n))
            if pid is None and len(by_name.get(n, ())) == 1:
                pid = next(iter(by_name[n]))
            if pid is None and searches < search_budget:
                searches += 1
                pid = _search_player(name, tri)
            if pid is None:
                unmatched.append(f"{name} ({tri})")
            details = inj.get("details") or {}
            out.append({
                "playerId": pid,
                "name": name,
                "team": tri,
                "position": ((ath.get("position") or {}).get("abbreviation")),
                "status": inj.get("status"),
                "type": details.get("type"),
                "returnDate": details.get("returnDate"),
                "comment": inj.get("shortComment"),
                "date": inj.get("date"),
                "espn_id": inj.get("id"),
                "fetched_at": fetched_at,
            })
    # Unchanged entries keep their previous fetched_at, so a run where ESPN
    # reports nothing new writes an identical file (no commit, no rebuild).
    out = [keep_if_unchanged(prev_by_key.get((e["espn_id"], e["team"], e["name"])), e) for e in out]
    out.sort(key=lambda e: (e["team"] or "", e["name"] or ""))
    matched = sum(1 for e in out if e["playerId"])
    print(f"  {len(out)} injuries, {matched} matched to NHL ids"
          + (f"; unmatched: {', '.join(unmatched[:8])}" if unmatched else ""))
    ok = atomic_write_json(OUTPUT_FILE, out, min_items=1, indent=1, label="injuries.json")
    if ok:
        record_source("espn_injuries", entries=len(out), matched=matched)
    return {"status": "ok" if ok else "fail", "rows_written": len(out) if ok else 0,
            "matched": matched, "unmatched": len(unmatched)}


def main():
    return fetch_injuries()


if __name__ == "__main__":
    print(main())
