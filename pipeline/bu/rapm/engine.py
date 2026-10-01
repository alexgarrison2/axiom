"""Season replay machinery shared by validation (§3.2.2) and point-in-time ratings (§4.1).

``SeasonData`` holds one season's EV regression rows sorted by game date with both the player
and the team design matrices.  ``fit_standalone`` is the flat-ridge season fit used for aging
curves and rookie means.  ``Availability``: a game's stints are usable for a rating as of
date d only if ``game_date <= d - lag_days`` (DESIGN §4.3: shifts arrive ~30 h after the
game, so the default lag of 2 days means "games up to two days before").
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .data import ev_toi, season_rows
from .design import Index, Rows, design_matrix
from .ridge import Gram

LAG_DAYS = 2
DEGRADE_ENV = "PONYXG_BU_DEGRADE"   # "0.35:2" = 35% of games get their shifts 2 days late (DESIGN §4.3)
LAM_STANDALONE = 3600.0 * 10   # flat ridge for the standalone (aging / rookie) fits


def degrade_spec() -> tuple[float, int]:
    import os
    v = os.environ.get(DEGRADE_ENV, "")
    if not v:
        return 0.0, 0
    frac, days = v.split(":")
    return float(frac), int(days)


def avail_dates(game_ids, dates) -> np.ndarray:
    """Date from which a game's shifts count as available, before the base LAG_DAYS.

    Normally the game date.  Under the degraded-data sensitivity (``PONYXG_BU_DEGRADE``), a
    deterministic pseudo-random ``frac`` of games (hash of the game id) arrive ``days`` later,
    reproducing the live REST shift lag (DESIGN §4.3)."""
    dates = np.asarray(dates, dtype="datetime64[D]")
    frac, days = degrade_spec()
    if frac <= 0:
        return dates
    gid = np.asarray(game_ids, dtype=np.int64)
    u = ((gid * 2654435761) % 2 ** 32) / 2 ** 32
    return dates + np.where(u < frac, days, 0).astype("timedelta64[D]")


def team_rows(rows: Rows) -> Rows:
    return Rows([[int(t)] for t in rows.att_team], [[int(t)] for t in rows.def_team], rows.cov, rows.y, rows.w,
                rows.date, rows.game_id, rows.att_team, rows.def_team)


@dataclass
class SeasonData:
    season: str
    rows: Rows
    stints: pd.DataFrame
    idx: Index
    X: object
    tidx: Index
    Xt: object
    toi: pd.Series        # EV seconds per player, whole season
    dates: np.ndarray     # unique game dates (datetime64[D]) ascending
    avail: np.ndarray     # per-row availability date (sorted); equals rows.date unless degraded

    @classmethod
    def load(cls, paths, season: str, source: str = "v1", target: str = "xgf") -> "SeasonData":
        rows, st = season_rows(paths, season, source, target=target)
        avail = avail_dates(rows.game_id, rows.date)
        order = np.lexsort((rows.date, avail))
        rows = Rows([rows.att[i] for i in order], [rows.dfn[i] for i in order], rows.cov[order], rows.y[order],
                    rows.w[order], rows.date[order], rows.game_id[order], rows.att_team[order],
                    rows.def_team[order])
        idx = Index.from_rows(rows)
        tr = team_rows(rows)
        tidx = Index.from_rows(tr)
        return cls(season, rows, st, idx, design_matrix(rows, idx), tidx, design_matrix(tr, tidx),
                   ev_toi(st), np.unique(rows.date), avail[order])

    def upto(self, d) -> int:
        """Number of leading rows usable for a rating as of date d (lag applied)."""
        cutoff = np.datetime64(d, "D") - np.timedelta64(LAG_DAYS, "D")
        return int(np.searchsorted(self.avail, cutoff, side="right"))

    def max_source_date(self, k: int):
        """Latest game date among the first k (available) rows."""
        return self.rows.date[:k].max() if k > 0 else np.datetime64("NaT")

    def window(self, d, days: int = 30) -> tuple[int, int]:
        assert degrade_spec()[0] == 0, "validation windows assume rows sorted by game date"
        d0 = np.datetime64(d, "D")
        lo = int(np.searchsorted(self.rows.date, d0, side="left"))
        hi = int(np.searchsorted(self.rows.date, d0 + np.timedelta64(days, "D"), side="left"))
        return lo, hi

    def asof_points(self, n_max: int = 7, min_tail_days: int = 10) -> list:
        """First game date + 14 days, then the 1st of each following month (DESIGN §5.1: 7 per season)."""
        if not len(self.dates):
            return []
        first, last = self.dates[0], self.dates[-1]
        pts = [first + np.timedelta64(14, "D")]
        m = (first.astype("datetime64[M]") + np.timedelta64(1, "M")).astype("datetime64[D]")
        while m < last:
            if m > pts[-1]:
                pts.append(m)
            m = (m.astype("datetime64[M]") + np.timedelta64(1, "M")).astype("datetime64[D]")
        pts = [p for p in pts if (last - p) >= np.timedelta64(min_tail_days, "D")]
        return pts[:n_max]

    def full_gram(self, team: bool = False) -> Gram:
        X = self.Xt if team else self.X
        g = Gram(X.shape[1])
        g.add(X, self.rows.y, self.rows.w)
        return g


def flat_prior(idx: Index, lam_players: float, cov_lam: float, cov_prev=None) -> tuple[np.ndarray, np.ndarray]:
    b0 = np.zeros(idx.p)
    lam = np.full(idx.p, float(lam_players))
    lam[2 * idx.n:] = cov_lam
    lam[2 * idx.n] = 1e-6
    if cov_prev is not None:
        b0[2 * idx.n:] = cov_prev
    return b0, lam


def fit_standalone(sd: SeasonData, gram: Gram | None = None, lam: float = LAM_STANDALONE) -> pd.DataFrame:
    g = gram or sd.full_gram()
    b0, L = flat_prior(sd.idx, lam, 3600.0 * 20)
    b, _ = g.solve(L, b0)
    n = sd.idx.n
    return pd.DataFrame({"player_id": sd.idx.ids, "o": b[:n], "d": b[n:2 * n],
                         "toi_h": sd.toi.reindex(sd.idx.ids).fillna(0).to_numpy() / 3600.0})
