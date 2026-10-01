"""Output layout for RAPM v2 state (DESIGN §2.3 ``state/``).

    <out>/xg/season=S.parquet            per-shot xG (source tagged) + flurry-adjusted xG
    <out>/stints/season=S.parquet        stints with on-ice sets and per-side xG/goals
    <out>/bio/season=S.json.gz           raw NHL stats REST skater bios
    <out>/bio/players.parquet            one row per player: birth date, position, draft
    <out>/ratings/season=S.parquet       point-in-time ratings, one row per (asof, player)
    <out>/posterior/season=S.parquet     end-of-season posterior (prior for S+1)
    <out>/reports/*.json                 validation reports

``<out>`` defaults to ``<lake>/state/rapm`` (the lake is gitignored, D4).  The
small reports that back a model claim are also copied to ``pipeline/bu/rapm/out``.
"""
from __future__ import annotations

import os

from bu.lake.paths import Lake

PKG_DIR = os.path.dirname(os.path.abspath(__file__))
REPORT_DIR = os.path.join(PKG_DIR, "out")


class RapmPaths:
    def __init__(self, lake: Lake, out: str | None = None):
        self.lake = lake
        self.root = os.path.abspath(out or os.environ.get("PONYXG_RAPM_DIR")
                                    or os.path.join(lake.root, "state", "rapm"))

    def _p(self, *parts) -> str:
        p = os.path.join(self.root, *parts)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        return p

    def xg(self, season) -> str:
        return self._p("xg", f"season={season}.parquet")

    def stints(self, season) -> str:
        return self._p("stints", f"season={season}.parquet")

    def bio_raw(self, season) -> str:
        return self._p("bio", f"season={season}.json.gz")

    def players(self) -> str:
        return self._p("bio", "players.parquet")

    def ratings(self, season) -> str:
        return self._p("ratings", f"season={season}.parquet")

    def posterior(self, season) -> str:
        return self._p("posterior", f"season={season}.parquet")

    def report(self, name) -> str:
        return self._p("reports", name)
