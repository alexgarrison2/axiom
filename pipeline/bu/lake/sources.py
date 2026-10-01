"""Endpoint catalogue for the lake (DESIGN §2.1).

Each endpoint knows its host (rate limits are per host), how to build its URL
from a key, and how to classify a payload:

  ok        cache it (immutable from now on)
  empty     served but has no usable data yet (e.g. REST shift charts lag a
            finished game by up to ~48 h); not cached, retried on resume
  notfinal  the game is not final; not cached, retried on resume

Explicit season IDs everywhere — never ``/now`` or ``/current`` (CLAUDE.md).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable
from urllib.parse import urlparse

API_WEB = "https://api-web.nhle.com/v1"
API_STATS = "https://api.nhle.com/stats/rest/en"

FINAL_STATES = {"OFF", "FINAL"}
# api.nhle.com /game gameStateId: 7 = final (6 appears on completed preseason games).
FINAL_STATE_IDS = {6, 7}
SHIFT_TYPE_CODE = 517


def _ok_game_payload(d) -> str:
    if not isinstance(d, dict):
        return "empty"
    state = d.get("gameState")
    if state is not None and state not in FINAL_STATES:
        return "notfinal"
    return "ok"


def _classify_pbp(d) -> str:
    if not isinstance(d, dict) or not isinstance(d.get("plays"), list) or not d["plays"]:
        return "empty"
    return _ok_game_payload(d)


def _classify_boxscore(d) -> str:
    if not isinstance(d, dict) or not d.get("playerByGameStats"):
        return "empty"
    return _ok_game_payload(d)


def _classify_rightrail(d) -> str:
    return "ok" if isinstance(d, dict) and isinstance(d.get("gameInfo"), dict) else "empty"


def _classify_shifts(d) -> str:
    rows = (d or {}).get("data") if isinstance(d, dict) else None
    if not rows or not any(r.get("typeCode") in (None, SHIFT_TYPE_CODE) for r in rows):
        return "empty"
    return "ok"


def _classify_schedule(d) -> str:
    return "ok" if isinstance(d, dict) and isinstance(d.get("data"), list) and d["data"] else "empty"


def _classify_roster(d) -> str:
    if not isinstance(d, dict):
        return "empty"
    n = sum(len(d.get(k) or []) for k in ("forwards", "defensemen", "goalies"))
    return "ok" if n else "empty"


@dataclass(frozen=True)
class Endpoint:
    name: str
    url: Callable[[object, str], str]   # (key, season_id) -> url
    classify: Callable[[object], str]
    per: str                            # "game" | "season" | "team-season"

    def host(self, key="0", season="20252026") -> str:
        return urlparse(self.url(key, season)).netloc


ENDPOINTS: dict[str, Endpoint] = {
    "schedule": Endpoint(
        "schedule", lambda key, season: f"{API_STATS}/game?cayenneExp=season={season}",
        _classify_schedule, "season"),
    "pbp": Endpoint(
        "pbp", lambda key, season: f"{API_WEB}/gamecenter/{key}/play-by-play", _classify_pbp, "game"),
    "boxscore": Endpoint(
        "boxscore", lambda key, season: f"{API_WEB}/gamecenter/{key}/boxscore", _classify_boxscore, "game"),
    # right-rail carries the scratches (with player IDs), officials and coaches.
    "rightrail": Endpoint(
        "rightrail", lambda key, season: f"{API_WEB}/gamecenter/{key}/right-rail", _classify_rightrail, "game"),
    "shifts": Endpoint(
        "shifts", lambda key, season: f"{API_STATS}/shiftcharts?cayenneExp=gameId={key}",
        _classify_shifts, "game"),
    "roster": Endpoint(
        "roster", lambda key, season: f"{API_WEB}/roster/{key}/{season}", _classify_roster, "team-season"),
}

GAME_ENDPOINTS = ("pbp", "boxscore", "rightrail", "shifts")
DEFAULT_ENDPOINTS = ("pbp", "boxscore", "rightrail", "shifts", "roster")


def season_id(start_year: int) -> str:
    return f"{start_year}{start_year + 1}"


def start_year_of(season: str | int) -> int:
    return int(str(season)[:4])
