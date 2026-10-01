"""Skater bio table for aging and rookie priors (DESIGN §3.2.1).

Source: NHL stats REST ``/stats/rest/en/skater/bios`` with an explicit ``seasonId`` (never
``/now``), regular season and playoffs, one request each per season (free; no key).  Raw
payloads are cached gzipped under ``<out>/bio`` and never re-fetched for closed seasons.

``players.parquet``: player_id, birth_date, position (C/L/R/D), pos_group (F/D), shoots,
draft_year, draft_overall (NaN = undrafted), first_season (first NHL regular season).
"""
from __future__ import annotations

import gzip
import json
import os

import pandas as pd

BIOS_URL = ("https://api.nhle.com/stats/rest/en/skater/bios?limit=-1"
            "&cayenneExp=seasonId={season}%20and%20gameTypeId={gt}")


def fetch_season(paths, season: str, *, refresh: bool = False) -> list[dict]:
    p = paths.bio_raw(season)
    if os.path.exists(p) and not refresh:
        with gzip.open(p, "rt") as f:
            return json.load(f)
    from http_utils import get_json
    rows = []
    for gt in (2, 3):
        d = get_json(BIOS_URL.format(season=season, gt=gt), ua="plain")
        rows.extend({**r, "gameTypeId": gt} for r in d.get("data") or [])
    tmp = p + ".tmp"
    with gzip.open(tmp, "wt") as f:
        json.dump(rows, f)
    os.replace(tmp, p)
    return rows


def build_players(paths, seasons, *, refresh_current: str | None = None, write: bool = True) -> pd.DataFrame:
    recs = {}
    for s in sorted(str(x) for x in seasons):
        for r in fetch_season(paths, s, refresh=(s == refresh_current)):
            pid = r.get("playerId")
            if pid is None:
                continue
            pos = r.get("positionCode")
            fs = [v for v in (r.get("firstSeasonForGameType") if r.get("gameTypeId", 2) == 2 else None,
                              (recs.get(int(pid)) or {}).get("first_season")) if v]
            recs[int(pid)] = {
                "player_id": int(pid), "birth_date": r.get("birthDate"), "position": pos,
                "pos_group": "D" if pos == "D" else "F", "shoots": r.get("shootsCatches"),
                "draft_year": r.get("draftYear"), "draft_overall": r.get("draftOverall"),
                "first_season": min(fs) if fs else None,
                "name": r.get("skaterFullName"),
            }
    df = pd.DataFrame(list(recs.values()))
    if len(df):
        df["draft_overall"] = pd.to_numeric(df["draft_overall"], errors="coerce")
        df["draft_year"] = pd.to_numeric(df["draft_year"], errors="coerce")
        df["first_season"] = pd.to_numeric(df["first_season"], errors="coerce")
    if write:
        df.to_parquet(paths.players(), index=False)
    return df


def age_at(birth_date: pd.Series, season: str) -> pd.Series:
    """Age in years on 1 February of the season (mid-season reference)."""
    ref = pd.Timestamp(f"{int(str(season)[:4]) + 1}-02-01")
    bd = pd.to_datetime(birth_date, errors="coerce")
    return (ref - bd).dt.days / 365.25
