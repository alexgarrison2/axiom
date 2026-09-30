"""
fetch_contracts.py
Contract data (cap hit, UFA/RFA status) for public/data/contracts.json.

Source: the per-player ``cap`` object in DailyFaceoff's line-combination
pages (the same pages fetch_dailyfaceoff.fetch_lineups already downloads),
replacing the PuckPedia scrape that now returns 403.  DFO players are matched
to NHL player ids by normalised name + current roster team.

Output (keyed by NHL player id string; ``_meta`` holds provenance):
{
  "_meta": {"fetched_at": "2026-09-30T12:00:00Z", "source": "dailyfaceoff", "players": 812},
  "8482740": {"cap_hit": 12000000, "status": "UFA", "year": 2033},
  ...
}
- cap_hit: annual cap hit in dollars
- status:  "UFA" | "RFA" (what the player becomes when the contract ends)
- year:    the year he becomes a UFA/RFA, or null if that is this coming
           off-season (contract ends after the current season)

Freshness is judged by ``_meta.fetched_at`` stored in the file, never by the
file's mtime (a fresh checkout makes every file look new).

Run: python3 pipeline/fetch_contracts.py [--force]
"""
import re
import sys
import unicodedata
from datetime import datetime, timezone

from season import START_YEAR
from io_utils import atomic_write_json, read_json, utc_now_iso
from paths import public_path

OUTPUT_FILE = public_path("contracts.json")
MAX_AGE_DAYS = 7
MIN_PLAYERS = 600


def normalize_name(name: str) -> str:
    """Lowercase, strip accents, punctuation and suffixes for matching."""
    name = unicodedata.normalize("NFD", name or "")
    name = "".join(c for c in name if unicodedata.category(c) != "Mn").lower().strip()
    name = re.sub(r"\s+(jr\.?|sr\.?|ii|iii|iv)$", "", name)
    return re.sub(r"[^a-z ]", "", name.replace("-", " ")).strip()


def contracts_age_days(path=OUTPUT_FILE):
    meta = (read_json(path, {}) or {}).get("_meta") or {}
    ts = meta.get("fetched_at")
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (datetime.now(timezone.utc) - dt).total_seconds() / 86400


def contracts_due(path=OUTPUT_FILE, max_age_days=MAX_AGE_DAYS):
    age = contracts_age_days(path)
    return age is None or age >= max_age_days


def contract_from_cap(cap: dict) -> dict | None:
    cap_hit = cap.get("capHit")
    if not cap_hit:
        return None
    expiry = cap.get("contractExpiryYear")
    status = (cap.get("contractExpiresAs") or "").upper() or None
    year = int(expiry) if expiry else None
    if year is not None and year <= START_YEAR + 1:
        year = None          # becomes UFA/RFA this coming off-season
    return {"cap_hit": int(cap_hit), "status": status, "year": year}


def build_contracts(cap_data: dict, rosters: dict) -> tuple[dict, list]:
    """Map DFO cap rows {tri: [{name, cap}]} to NHL ids via rosters."""
    from fetch_player_bio import player_display_name
    by_team_name, by_name = {}, {}
    for tri, r in rosters.items():
        for grp in ("forwards", "defensemen", "goalies"):
            for p in r.get(grp, []) or []:
                n = normalize_name(player_display_name(p))
                by_team_name[(tri, n)] = str(p["id"])
                by_name.setdefault(n, set()).add(str(p["id"]))
    # Players on no current roster (IR/LTIR, AHL) — fall back to the NHL names
    # carried in player_impact.json (keyed by NHL id).
    from paths import pipeline_path
    for pid, d in (read_json(pipeline_path("player_impact.json"), {}) or {}).items():
        n = normalize_name(d.get("name"))
        if n and n not in by_name:
            by_name[n] = {str(pid)}
        by_team_name.setdefault((d.get("team"), n), str(pid))
    out, unmatched = {}, []
    for tri, rows in cap_data.items():
        for row in rows:
            c = contract_from_cap(row.get("cap") or {})
            if not c:
                continue
            n = normalize_name(row.get("name"))
            pid = by_team_name.get((tri, n))
            if pid is None and len(by_name.get(n, ())) == 1:
                pid = next(iter(by_name[n]))
            if pid is None:
                unmatched.append(f"{row.get('name')} ({tri})")
                continue
            out[pid] = c
    return out, unmatched


def main(force=False, cap_data=None, rosters=None):
    """Refresh contracts.json when stale (> MAX_AGE_DAYS by stored fetched_at)
    or ``force``.  Reuses DFO cap data already downloaded this run."""
    if not force and not contracts_due():
        age = contracts_age_days()
        print(f"Skipping contract refresh — fetched {age:.1f} days ago (threshold {MAX_AGE_DAYS} days).")
        return {"status": "skip", "rows_written": 0, "reason": "fresh"}

    import fetch_dailyfaceoff as dfo
    from fetch_player_bio import fetch_rosters, NHL_TEAMS
    cap_data = cap_data if cap_data is not None else dict(dfo.CAP_DATA)
    if len(cap_data) < len(NHL_TEAMS):
        import pandas as pd
        from paths import pipeline_path
        teams = pd.read_csv(pipeline_path("nhl_teams.csv"))
        todo = [{"triCode": r["Team Tricode"], "teamName": r["Team Name"]} for _, r in teams.iterrows()
                if r["Team Tricode"] not in cap_data]
        dfo.fetch_lineups(todo, force_all=True)
        cap_data.update(dfo.CAP_DATA)
    rosters = rosters if rosters is not None else fetch_rosters()

    contracts, unmatched = build_contracts(cap_data, rosters)
    previous = {k: v for k, v in (read_json(OUTPUT_FILE, {}) or {}).items() if not k.startswith("_")}
    merged = {**previous, **contracts}   # keep players DFO did not list this time
    merged_out = {"_meta": {"fetched_at": utc_now_iso(), "source": "dailyfaceoff",
                            "players": len(merged), "from_this_fetch": len(contracts),
                            "teams": len(cap_data)}}
    merged_out.update(dict(sorted(merged.items())))
    print(f"  Contracts: {len(contracts)} matched from DFO for {len(cap_data)} teams "
          f"({len(unmatched)} unmatched), {len(merged)} total")
    ok = atomic_write_json(OUTPUT_FILE, merged_out, indent=2, label="contracts.json",
                           validator=lambda _: None if len(contracts) >= MIN_PLAYERS
                           else f"only {len(contracts)} contracts matched (< {MIN_PLAYERS})")
    return {"status": "ok" if ok else "fail", "rows_written": len(merged) if ok else 0,
            "reason": "" if ok else f"{len(contracts)} matched"}


if __name__ == "__main__":
    print(main(force="--force" in sys.argv))
