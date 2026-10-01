"""
fetch_shifts.py
---------------
Fetches NHL shift chart data for every game of a season into the season shifts
CSV (season.season_file("shifts")).

Sources, in order of preference:
  1. The NHL stats REST endpoint (``api.nhle.com/stats/rest/en/shiftcharts``).
     JSON with NHL player IDs.  It can lag a finished game by up to ~48 h.
  2. The official HTML TOI reports (``nhl.com/scores/htmlreports``).  Only used
     once a game is older than ``--html-after-hours`` (default 72 h) and REST
     still has nothing.  Player IDs are resolved from the game's boxscore by
     team + sweater number, so even fallback rows carry ``player_id``.

Gap-driven upgrades: every run also re-tries REST for up to ``--max-refetch``
games whose stored rows lack player IDs (older HTML-fallback games) and
replaces them when REST has the game.  ``--refetch-null-ids`` lifts that cap.

Rows are de-duplicated on (game_id, player, period, start, end) before they are
written; the REST feed itself repeats shifts (2023020500 has 295 duplicates)
and also carries goal rows (typeCode 505) that are not shifts.

Run modes:
  python fetch_shifts.py                       # incremental (new games + capped upgrades)
  python fetch_shifts.py --full                # full re-fetch of all games
  python fetch_shifts.py --season 2025 --refetch-null-ids   # repair an archived season
"""

from season import season_file, START_YEAR
import argparse
import csv
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

import pandas as pd
from bs4 import BeautifulSoup

from http_utils import get_text, get_json as _http_get_json, HttpError

# ── Config ──────────────────────────────────────────────────────────────────
SHIFTS_API = "https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId={game_id}"
BOXSCORE_API = "https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore"
HTML_REPORT = "https://www.nhl.com/scores/htmlreports/{season}/{team_code}{game_num}.HTM"

SHIFTS_COLUMNS = [
    "game_id", "period", "start_seconds", "end_seconds",
    "player_id", "player_name", "team_id", "team_abbrev"
]
SHIFT_KEY = ["game_id", "_who", "period", "start_seconds", "end_seconds"]

RATE_LIMIT_DELAY = 0.4
HTML_DELAY = 0.6   # Slightly slower for HTML pages
MAX_RETRIES = 3
HTML_AFTER_HOURS = 72      # REST lags up to ~48 h; only fall back after this
MAX_REFETCH_PER_RUN = 60   # capped gap-driven upgrades of null-id games per run
SHIFT_TYPE_CODE = 517      # shiftcharts also carries goal rows (505)


def season_paths(start_year: int = START_YEAR) -> dict:
    return {
        "season": f"{start_year}{start_year + 1}",
        "gamestats": season_file("gamestats", start_year),
        "shifts": season_file("shifts", start_year),
    }


# Back-compat module constants (current season).
SEASON = season_paths()["season"]
GAMESTATS_FILE = season_paths()["gamestats"]
SHIFTS_FILE = season_paths()["shifts"]


# ── Helpers ──────────────────────────────────────────────────────────────────

def time_to_seconds(t: str) -> int:
    """Convert M:SS or MM:SS string to total seconds."""
    try:
        t = t.strip()
        m, s = map(int, t.split(":"))
        return m * 60 + s
    except Exception:
        return 0


def get_url(url: str, encoding: str = "utf-8"):
    """Fetch URL with retries (TLS-verified). Returns (text, None) or (None, error)."""
    try:
        return get_text(url, encoding=encoding, retries=MAX_RETRIES, backoff=1.5, ua="plain", quiet=True), None
    except HttpError as e:
        return None, str(e)


def get_json(url: str):
    """Fetch URL and parse as JSON."""
    text, err = get_url(url)
    if text is None:
        return None
    try:
        return json.loads(text)
    except Exception:
        return None


def dedupe_shift_rows(df: pd.DataFrame) -> pd.DataFrame:
    """Drop repeated shifts: same game, player (id, else name+team), period, start, end."""
    if df.empty:
        return df
    who = df["player_id"].astype("string")
    fallback = df["player_name"].astype("string").fillna("") + "|" + df["team_id"].astype("string").fillna("")
    df = df.assign(_who=who.where(df["player_id"].notna(), fallback))
    df = df.drop_duplicates(subset=SHIFT_KEY, keep="first")
    return df.drop(columns="_who")


def _dedupe_rows(rows: list[dict]) -> list[dict]:
    if not rows:
        return rows
    df = dedupe_shift_rows(pd.DataFrame(rows, columns=SHIFTS_COLUMNS))
    return df.to_dict("records")


# ── Source 1: NHL Stats REST API ─────────────────────────────────────────────

def parse_rest_shifts(data: dict, game_id: int) -> list[dict]:
    rows = []
    for shift in (data or {}).get("data") or []:
        tc = shift.get("typeCode")
        if tc is not None and tc != SHIFT_TYPE_CODE:
            continue
        start = time_to_seconds(shift.get("startTime") or "0:00")
        end_t = time_to_seconds(shift.get("endTime") or "0:00")
        if end_t <= start:
            continue
        rows.append({
            "game_id": game_id,
            "period": shift.get("period", 0),
            "start_seconds": start,
            "end_seconds": end_t,
            "player_id": shift.get("playerId"),
            "player_name": f"{shift.get('firstName','')} {shift.get('lastName','')}".strip(),
            "team_id": shift.get("teamId"),
            "team_abbrev": shift.get("teamAbbrev", ""),
        })
    return _dedupe_rows(rows)


def keep_game_teams(rows: list[dict], team_ids) -> list[dict]:
    """Drop rows of any team other than the game's two (the REST feed occasionally mixes
    in another game's shifts: 2025020565, NJD-BUF, also carries ~670 VGK/SJS rows)."""
    keep = {int(t) for t in team_ids if t is not None}
    if len(keep) != 2:
        return rows
    return [r for r in rows if r.get("team_id") is not None and int(r["team_id"]) in keep]


def fetch_shifts_rest_api(game_id: int) -> list[dict]:
    """Shifts from the NHL stats REST API (with player IDs). Returns [] when absent."""
    rows = parse_rest_shifts(get_json(SHIFTS_API.format(game_id=game_id)), game_id)
    if len({r["team_id"] for r in rows}) > 2:
        meta = fetch_boxscore_meta(game_id)
        if meta:
            n0 = len(rows)
            rows = keep_game_teams(rows, (meta["home"]["id"], meta["away"]["id"]))
            print(f"    game {game_id}: dropped {n0 - len(rows)} REST shift rows of other teams")
    return rows


# ── Boxscore: teams + sweater-number → player id for the HTML fallback ──────

def fetch_boxscore_meta(game_id: int) -> dict | None:
    """{'home': {id, abbrev, numbers{num: (pid, name)}}, 'away': {...}} or None."""
    try:
        box = _http_get_json(BOXSCORE_API.format(game_id=game_id), ua="plain", quiet=True)
    except HttpError:
        return None
    return boxscore_meta(box)


def boxscore_meta(box: dict) -> dict | None:
    if not box or "homeTeam" not in box:
        return None
    out = {}
    stats = box.get("playerByGameStats") or {}
    for side in ("home", "away"):
        team = box.get(f"{side}Team") or {}
        numbers = {}
        for group in ("forwards", "defense", "goalies"):
            for p in (stats.get(f"{side}Team") or {}).get(group) or []:
                num = p.get("sweaterNumber")
                if num is not None and p.get("playerId"):
                    name = (p.get("name") or {}).get("default", "")
                    numbers[str(num)] = (int(p["playerId"]), name)
        out[side] = {"id": team.get("id"), "abbrev": team.get("abbrev", ""), "numbers": numbers}
    return out


# ── Source 2: NHL HTML TOI Reports ──────────────────────────────────────────

def parse_html_toi_report(html: str, game_id: int, team_id: int,
                          team_abbrev: str, numbers: dict | None = None) -> list[dict]:
    """
    Parse one team's HTML TOI report into a list of shift dicts.

    HTML structure:
      - Player header row: contains '#NUM LAST, FIRST'
      - Shift rows (class oddColor/evenColor): ShiftNum | Period | StartElapsed/GameTime | ... | Duration

    ``numbers`` maps sweater number → (player_id, name) from the boxscore so the
    rows carry NHL player IDs.
    """
    soup = BeautifulSoup(html, "html.parser")
    all_rows = soup.find_all("tr")
    numbers = numbers or {}

    shifts = []
    current_player_name = None
    current_player_id = None

    # Pattern to detect player header rows like "4 BYRAM, BOWEN"
    player_re = re.compile(r"^(\d+)\s+([A-Z'\-. ]+?),\s*([A-Z'\-. ]+)", re.IGNORECASE)
    # Pattern to extract start time from "0:42 / 19:18" → "0:42"
    time_re = re.compile(r"^(\d{1,2}:\d{2})\s*/")

    for row in all_rows:
        text = row.get_text("|", strip=True)
        row_class = row.get("class", [])

        # Detect player header rows
        if "oddColor" not in row_class and "evenColor" not in row_class:
            m = player_re.match(text.replace("|", " ").strip())
            if m:
                num = m.group(1)
                last = m.group(2).strip().title()
                first = m.group(3).strip().title()
                current_player_name = f"{first} {last}"
                current_player_id = numbers.get(num, (None, None))[0]
            continue

        if current_player_name is None:
            continue

        cells = [c.strip() for c in text.split("|") if c.strip()]
        # Expected: [shift_num, period, start_elapsed/game, end_elapsed/game, duration, (optional event)]
        if len(cells) < 4:
            continue
        try:
            period = int(cells[1])
        except (ValueError, IndexError):
            continue

        sm = time_re.match(cells[2])
        em = time_re.match(cells[3])
        if not sm or not em:
            continue
        start_sec = time_to_seconds(sm.group(1))
        end_sec = time_to_seconds(em.group(1))
        if end_sec <= start_sec:
            continue

        shifts.append({
            "game_id": game_id,
            "period": period,
            "start_seconds": start_sec,
            "end_seconds": end_sec,
            "player_id": current_player_id,
            "player_name": current_player_name,
            "team_id": team_id,
            "team_abbrev": team_abbrev,
        })

    return shifts


def game_id_to_html_num(game_id: int) -> str:
    """Convert game_id like 2025020057 to zero-padded report number '020057'."""
    return str(game_id)[-6:].zfill(6)


def fetch_shifts_html(game_id: int, meta: dict, season: str = SEASON) -> list[dict]:
    """Scrape the home (TH) and visitor (TV) HTML TOI reports for a game."""
    game_num = game_id_to_html_num(game_id)
    all_shifts = []
    for team_code, side in (("TH", "home"), ("TV", "away")):
        team = meta[side]
        url = HTML_REPORT.format(season=season, team_code=team_code, game_num=game_num)
        html, err = get_url(url, encoding="latin-1")
        if html is None:
            print(f"    HTML {team_code} error for game {game_id}: {err}")
            continue
        all_shifts.extend(parse_html_toi_report(html, game_id, team["id"], team["abbrev"],
                                                team.get("numbers")))
        time.sleep(HTML_DELAY)
    return _dedupe_rows(all_shifts)


# ── CSV Helpers ──────────────────────────────────────────────────────────────

def load_shifts(shifts_file: str) -> pd.DataFrame:
    if not os.path.exists(shifts_file):
        return pd.DataFrame(columns=SHIFTS_COLUMNS)
    try:
        return pd.read_csv(shifts_file)
    except Exception:
        return pd.DataFrame(columns=SHIFTS_COLUMNS)


def load_existing_game_ids(shifts_file: str) -> set:
    if not os.path.exists(shifts_file):
        return set()
    try:
        df = pd.read_csv(shifts_file, usecols=["game_id"])
        return set(int(g) for g in df["game_id"].unique())
    except Exception:
        return set()


def null_id_game_ids(shifts_file: str) -> list[int]:
    """Games whose stored rows include shifts without a player ID."""
    if not os.path.exists(shifts_file):
        return []
    df = pd.read_csv(shifts_file, usecols=["game_id", "player_id"])
    return sorted(int(g) for g in df.loc[df["player_id"].isna(), "game_id"].unique())


def stored_duplicate_count(shifts_file: str) -> int:
    """Duplicate shift rows already in the stored CSV (written before de-duplication existed)."""
    if not os.path.exists(shifts_file):
        return 0
    df = load_shifts(shifts_file)
    return 0 if df.empty else len(df) - len(dedupe_shift_rows(df))


def load_game_dates(gamestats_file: str) -> dict[int, str]:
    df = pd.read_csv(gamestats_file, usecols=lambda c: c in ("game_id", "game_date"))
    if "game_date" not in df.columns:
        return {}
    return {int(g): str(d) for g, d in df.drop_duplicates("game_id")[["game_id", "game_date"]].values}


def get_all_game_ids(gamestats_file: str) -> list[int]:
    df = pd.read_csv(gamestats_file, usecols=["game_id"])
    return sorted(int(g) for g in df["game_id"].unique())


def append_rows(shifts_file: str, rows: list[dict]):
    file_exists = os.path.exists(shifts_file)
    with open(shifts_file, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=SHIFTS_COLUMNS)
        if not file_exists:
            writer.writeheader()
        writer.writerows(rows)


def _int_cols(df: pd.DataFrame) -> pd.DataFrame:
    for c in ("game_id", "period", "start_seconds", "end_seconds", "player_id", "team_id"):
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce").astype("Int64")
    return df


def replace_games(shifts_file: str, replacements: dict[int, list[dict]]) -> int:
    """Rewrite the CSV with ``replacements`` (game_id → rows) swapped in, de-duplicated."""
    from io_utils import atomic_write_csv
    df = load_shifts(shifts_file)
    if replacements:
        df = df[~df["game_id"].isin(list(replacements))]
        new = pd.DataFrame([r for rows in replacements.values() for r in rows], columns=SHIFTS_COLUMNS)
        df = pd.concat([df, new], ignore_index=True) if len(df) else new
    # Stable sort on game_id only: untouched games keep their stored row order,
    # so the diff of a tracked season file is limited to the replaced games.
    df = _int_cols(dedupe_shift_rows(df[SHIFTS_COLUMNS].copy()))
    df = df.sort_values(["game_id"], kind="stable")
    # csv.DictWriter (append_rows) writes CRLF; keep the whole file consistent.
    atomic_write_csv(shifts_file, df, min_rows=1, label=os.path.basename(shifts_file),
                     lineterminator="\r\n")
    return len(df)


def _hours_since(game_date: str | None, now: datetime) -> float:
    """Hours since the end of ``game_date`` (ET evening ≈ 04:00 UTC next day)."""
    if not game_date:
        return float("inf")
    try:
        d = datetime.strptime(game_date[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return float("inf")
    return (now - (d + timedelta(hours=28))).total_seconds() / 3600


# ── Main ─────────────────────────────────────────────────────────────────────

def main(argv=None, *, now: datetime | None = None, workdir: str | None = None):
    """Fetch shifts for games not yet in the shifts CSV and upgrade null-id games.

    Never exits the interpreter; returns {'status': 'ok'|'skip'|'fail', 'rows_written': int, ...}.
    """
    argv = list(sys.argv[1:] if argv is None and __name__ == "__main__" else (argv or []))
    ap = argparse.ArgumentParser(description="Fetch NHL shift charts")
    ap.add_argument("--full", action="store_true", help="Re-fetch every game of the season")
    ap.add_argument("--season", type=int, default=START_YEAR, help="Season start year (default: current)")
    ap.add_argument("--refetch-null-ids", action="store_true",
                    help="Re-try REST for every stored game lacking player IDs (no per-run cap)")
    ap.add_argument("--max-refetch", type=int, default=MAX_REFETCH_PER_RUN)
    ap.add_argument("--html-after-hours", type=float, default=HTML_AFTER_HOURS)
    ap.add_argument("--no-html", action="store_true", help="Never use the HTML fallback")
    args = ap.parse_args(argv)

    now = now or datetime.now(timezone.utc)
    paths = season_paths(args.season)
    wd = workdir or "."
    gamestats_file = os.path.join(wd, paths["gamestats"])
    shifts_file = os.path.join(wd, paths["shifts"])
    full_mode = args.full
    print(f"fetch_shifts.py — {paths['season']} — {'Full' if full_mode else 'Incremental'} — "
          f"{now.strftime('%Y-%m-%d %H:%M:%S')} UTC")

    if not os.path.exists(gamestats_file):
        print(f"[SKIP] {gamestats_file} not found — no games scraped yet this season.")
        return {"status": "skip", "rows_written": 0, "reason": "no season gamestats"}

    all_game_ids = get_all_game_ids(gamestats_file)
    game_dates = load_game_dates(gamestats_file)
    existing_ids = set() if full_mode else load_existing_game_ids(shifts_file)
    todo = [g for g in all_game_ids if g not in existing_ids]

    null_games = [] if full_mode else null_id_game_ids(shifts_file)
    cap = len(null_games) if args.refetch_null_ids else max(0, args.max_refetch)
    upgrade = null_games[:cap]

    stored_dups = 0 if full_mode else stored_duplicate_count(shifts_file)
    print(f"  Total games: {len(all_game_ids)} | Stored: {len(existing_ids)} | New: {len(todo)} | "
          f"Stored without player IDs: {len(null_games)} (re-trying {len(upgrade)}) | "
          f"Stored duplicate rows: {stored_dups}")

    if not todo and not upgrade:
        if stored_dups:
            n = replace_games(shifts_file, {})
            print(f"  Healed {stored_dups} duplicate shift rows in {shifts_file} ({n:,} rows)")
            return {"status": "ok", "rows_written": 0, "healed": stored_dups}
        print("  ✓ Shifts up to date.")
        return {"status": "skip", "rows_written": 0, "reason": "up to date"}

    if full_mode and os.path.exists(shifts_file):
        os.remove(shifts_file)
        print(f"  Cleared existing {shifts_file} for full re-fetch.")

    rest_ok, html_ok, pending, failed, upgraded = 0, 0, 0, 0, 0
    rows_written = 0

    for i, game_id in enumerate(todo, 1):
        rows = fetch_shifts_rest_api(game_id)
        time.sleep(RATE_LIMIT_DELAY)
        if rows:
            append_rows(shifts_file, rows)
            rest_ok += 1
            rows_written += len(rows)
            if i % 100 == 0 or i == len(todo):
                print(f"  [{i}/{len(todo)}] REST ✓ game {game_id} → {len(rows)} shifts")
            continue

        age_h = _hours_since(game_dates.get(game_id), now)
        if args.no_html or age_h < args.html_after_hours:
            pending += 1   # REST lags finished games; retried on the next run
            if pending <= 10:
                print(f"  [{i}/{len(todo)}] … game {game_id}: REST not ready ({age_h:.0f} h old) — retry later")
            continue

        meta = fetch_boxscore_meta(game_id)
        rows = fetch_shifts_html(game_id, meta, paths["season"]) if meta else []
        if rows:
            append_rows(shifts_file, rows)
            html_ok += 1
            rows_written += len(rows)
            print(f"  [{i}/{len(todo)}] HTML ✓ game {game_id} → {len(rows)} shifts "
                  f"({sum(r['player_id'] is None for r in rows)} without IDs)")
        else:
            failed += 1
            if failed <= 10 or i == len(todo):
                print(f"  [{i}/{len(todo)}] ✗ game {game_id} → no data from either source")

    replacements = {}
    for j, game_id in enumerate(upgrade, 1):
        rows = fetch_shifts_rest_api(game_id)
        time.sleep(RATE_LIMIT_DELAY)
        if rows and all(r["player_id"] is not None for r in rows):
            replacements[game_id] = rows
            upgraded += 1
        if j % 50 == 0 or j == len(upgrade):
            print(f"  upgrade [{j}/{len(upgrade)}] REST replacements so far: {upgraded}")

    # Rewrite (de-duplicating the whole file) only when a game was upgraded or the
    # stored file still carries duplicate rows.
    if replacements or (stored_dups and os.path.exists(shifts_file)):
        n = replace_games(shifts_file, replacements)
        print(f"  Rewrote {shifts_file}: {n:,} rows ({upgraded} games upgraded to REST IDs, "
              f"{stored_dups} stored duplicates healed)")
        rows_written += sum(len(r) for r in replacements.values())

    print(f"\n✓ Done. REST: {rest_ok} | HTML fallback: {html_ok} | Pending REST: {pending} | "
          f"Failed: {failed} | Upgraded: {upgraded}")
    if os.path.exists(shifts_file):
        df = pd.read_csv(shifts_file, usecols=["game_id", "player_id"])
        print(f"  Shifts file: {len(df):,} rows across {df['game_id'].nunique()} games; "
              f"null player_id share {df['player_id'].isna().mean():.4f}")
    ok = (rest_ok + html_ok + upgraded) or not failed
    return {"status": "ok" if ok else "fail", "rows_written": rows_written, "failed": failed,
            "pending": pending, "upgraded": upgraded}


if __name__ == "__main__":
    res = main()
    sys.exit(1 if res.get("status") == "fail" else 0)
