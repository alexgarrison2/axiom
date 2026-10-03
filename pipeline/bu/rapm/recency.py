"""Game-based recency weights for player ratings v3 (owner decision 2026-10-02).

"I really don't care about four seasons ago at all.  I'm inclined to weight and regress by 5
previous 30-game stretches."  Recency is therefore counted in GAMES, not seasons: every stint
(and every finishing / TOI observation) gets a weight from how many games ago it was played.

**Indexing: league-average team games, by date.**  ``league_index`` gives every game date the
cumulative number of team games the league has played before it, divided by the number of
teams that season (each game is two team games), i.e. the average team's game count.  The age
of a game played on date ``t``, seen from as-of date ``d``, is

    games_ago(t; d) = L_before(d) - L_before(t)       (> 0 for every t < d)

where ``L_before(x)`` counts the team games on dates strictly before ``x``.  So the most recent
night is ~0.5 games ago, a full regular season is ~82 games, the summer adds nothing and a
truncated season (2019-20, 2012-13) is as short as it was.  Why league / team schedule and not
each player's own games played:

* a stint has ten skaters from two teams; a player-indexed weight is not defined for the row,
  while a date-based weight gives the whole row (both sides) one weight;
* the two teams in a game are within a couple of games of each other on the league index
  (schedule imbalance), so a per-team index would change weights by at most one step at a
  block edge; one weight per date keeps every Gram additive by date (cheap daily rebuilds);
* a player who missed games (injury, scratch) simply has less recent data and is shrunk more,
  instead of having older games pulled forward into his "last 150 games".

Playoff games count at their league average (16 teams play, so a playoff night adds about half
a game per round to the index): playoff data stays recent without dominating.

Two families (``Recency``):

* ``blocks``: ``steps[k]`` for games ago in ``(k * block, (k + 1) * block]``, zero beyond the
  last block (default 5 x 30 games with 1 / .8 / .6 / .4 / .2);
* ``decay``: ``0.5 ** (games_ago / half_life)``;

both truncated at ``max_games`` (default 246 = three 82-game seasons: anything 3+ seasons back
has weight exactly 0).  ``effective_table`` reports the share of total weight by games-ago band
and by season back, for a player who plays every game.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

SEASON_GAMES = 82.0
MAX_GAMES = 3 * SEASON_GAMES          # 246: three seasons back -> weight 0


@dataclass(frozen=True)
class Recency:
    kind: str = "blocks"                          # "blocks" | "decay" | "flat"
    block_games: float = 30.0
    steps: tuple = (1.0, 0.8, 0.6, 0.4, 0.2)
    half_life: float = 60.0
    max_games: float = MAX_GAMES

    def weight(self, ga) -> np.ndarray:
        """Weight of an observation ``ga`` games ago (array-like, ga >= 0)."""
        ga = np.asarray(ga, dtype=float)
        if self.kind == "blocks":
            k = np.ceil(np.maximum(ga, 1e-9) / self.block_games).astype(int) - 1
            st = np.asarray(self.steps, dtype=float)
            w = np.where(k < len(st), st[np.clip(k, 0, len(st) - 1)], 0.0)
        elif self.kind == "decay":
            w = 0.5 ** (ga / self.half_life)
        elif self.kind == "flat":
            w = np.ones_like(ga)
        else:
            raise ValueError(f"unknown recency kind {self.kind!r}")
        return np.where((ga >= 0) & (ga <= self.max_games), w, 0.0)

    @property
    def horizon(self) -> float:
        """Games ago beyond which every weight is 0."""
        if self.kind == "blocks":
            return min(self.block_games * len(self.steps), self.max_games)
        return self.max_games

    def key(self) -> str:
        if self.kind == "blocks":
            return f"b{self.block_games:g}x" + "-".join(f"{s:g}" for s in self.steps)
        if self.kind == "decay":
            return f"d{self.half_life:g}_t{self.max_games:g}"
        return f"flat_t{self.max_games:g}"

    def as_dict(self) -> dict:
        d = asdict(self)
        d["steps"] = list(self.steps)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Recency":
        d = dict(d)
        d["steps"] = tuple(float(x) for x in d.get("steps", ()))
        return cls(**d)

    def effective_table(self, step: float = 0.5) -> dict:
        """Share of the total weight by games-ago band and by season back (a player who plays
        every game; one game per ``step`` of the index)."""
        ga = np.arange(step, self.max_games + 2 * SEASON_GAMES, step)
        w = self.weight(ga)
        tot = w.sum()
        bands = [(0, 30), (30, 60), (60, 90), (90, 120), (120, 150), (150, 164), (164, 246), (246, 10 ** 6)]
        by_band = {f"{a}-{b if b < 10 ** 6 else 'inf'}": float(w[(ga > a) & (ga <= b)].sum() / tot) for a, b in bands}
        seasons = {}
        for k, (a, b) in enumerate([(0, 82), (82, 164), (164, 246), (246, 10 ** 6)]):
            seasons[f"S-{k}" if k else "last 82"] = float(w[(ga > a) & (ga <= b)].sum() / tot)
        return {"by_games_ago": by_band, "by_82_game_season_back": seasons,
                "weight_at": {str(g): float(self.weight([g])[0]) for g in (1, 30, 31, 60, 82, 120, 150, 164, 200, 246)}}


# ----------------------------------------------------------------------- league game index

def league_index(games: pd.DataFrame) -> pd.DataFrame:
    """Per game date: ``L_before`` (team games per team before the date) and ``inc`` (that date's
    games per team).  ``games``: season, game_date, game_type, home_team_id, away_team_id of every
    season involved (regular season + playoffs; other game types ignored)."""
    g = games[games["game_type"].isin([2, 3])].copy()
    g["d"] = pd.to_datetime(g["game_date"]).values.astype("datetime64[D]")
    teams = pd.concat([g[["season", "home_team_id"]].rename(columns={"home_team_id": "t"}),
                       g[["season", "away_team_id"]].rename(columns={"away_team_id": "t"})])
    n_teams = teams.groupby("season")["t"].nunique()
    per = g.groupby(["season", "d"]).size().rename("n").reset_index()
    per["inc"] = 2.0 * per["n"] / per["season"].map(n_teams).astype(float)
    per = per.groupby("d", as_index=False).agg(inc=("inc", "sum"), season=("season", "first")).sort_values("d")
    per["L_before"] = per["inc"].cumsum() - per["inc"]
    return per[["d", "season", "inc", "L_before"]].reset_index(drop=True)


class LeagueClock:
    """``L_before`` lookups for any date (dates between game days take the next game day's value)."""

    def __init__(self, idx: pd.DataFrame):
        self.d = idx["d"].to_numpy(dtype="datetime64[D]")
        self.L = idx["L_before"].to_numpy(dtype=float)
        self.inc = idx["inc"].to_numpy(dtype=float)
        self.total = float(self.L[-1] + self.inc[-1]) if len(self.L) else 0.0
        self.season = idx["season"].astype(str).to_numpy()

    def before(self, dates) -> np.ndarray:
        """Team games per team on game dates strictly before each date."""
        dates = np.asarray(dates, dtype="datetime64[D]")
        k = np.searchsorted(self.d, dates, side="left")
        Lk = np.append(self.L, self.total)
        return Lk[k]

    def games_ago(self, row_dates, asof) -> np.ndarray:
        return float(self.before([asof])[0]) - self.before(row_dates)

    def season_start(self, season: str) -> float:
        """``L_before`` of the season's first game date (= everything before the season)."""
        m = self.season == str(season)
        if not m.any():
            return self.total
        return float(self.L[np.argmax(m)])

    def in_season(self, season: str, asof) -> float:
        """Games per team of ``season`` played before ``asof`` (the ``g`` of the prior grid)."""
        return max(0.0, float(self.before([asof])[0]) - self.season_start(season))

    def date_at(self, season: str, g: float):
        """First game date of ``season`` with at least ``g`` games per team played before it."""
        m = self.season == str(season)
        if not m.any():
            return None
        L0 = self.season_start(season)
        ds, Ls = self.d[m], self.L[m] - L0
        k = int(np.searchsorted(Ls, g - 1e-9, side="left"))
        return ds[k] if k < len(ds) else None
