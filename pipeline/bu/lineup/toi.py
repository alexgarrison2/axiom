"""Expected even-strength TOI shares (DESIGN §3.7).

``share`` = a skater's EV seconds / the game's EV seconds (5v5 + 4v4 + 3v3 with both goalies
in), so a team's skaters sum to ~5.  For a game on date d a skater's expected share is a
shrunk exponentially weighted mean of his own past shares from games on or before
``d - LAG_DAYS`` (shifts arrive ~30 h after a game, DESIGN §4.3):

    est = (sum_k decay^k share_k + M_PRIOR * slot_prior) / (sum_k decay^k + M_PRIOR)

``slot_prior`` is the running mean share of skaters in their first NHL game in the data, by
position group (call-ups and rookies take it, DESIGN §3.7); it is itself point-in-time.  At a
season boundary a skater's history is halved (role changes over the summer).  Tonight's
estimates are renormalised so forwards sum to 3 and defencemen to 2.

``validate_toi`` reports the share MAE against the "last game's share" baseline.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from bu.rapm.engine import LAG_DAYS
from bu.rapm.stints import MIN_GAME_ONICE_MATCH, ev_mask

HALFLIFE_GAMES = 8.0
DECAY = 0.5 ** (1.0 / HALFLIFE_GAMES)
M_PRIOR = 2.0
SEASON_CARRY = 0.5
SLOT_PRIOR0 = {"F": 0.20, "D": 0.30}
GROUP_SUM = {"F": 3.0, "D": 2.0}


def game_shares(stints: pd.DataFrame) -> pd.DataFrame:
    """(game_id, player_id, share, ev_s) from one season's stints (EV, quality-filtered)."""
    st = stints[ev_mask(stints) & (stints["game_onice_match"] >= MIN_GAME_ONICE_MATCH)]
    game_ev = st.groupby("game_id")["dur"].sum()
    recs = []
    for gid, hs, as_, dur in zip(st["game_id"], st["home_sk"], st["away_sk"], st["dur"]):
        for p in hs:
            recs.append((gid, int(p), dur))
        for p in as_:
            recs.append((gid, int(p), dur))
    df = pd.DataFrame(recs, columns=["game_id", "player_id", "ev_s"]).groupby(
        ["game_id", "player_id"], as_index=False)["ev_s"].sum()
    df["share"] = df["ev_s"] / df["game_id"].map(game_ev)
    return df


class ShareState:
    """Point-in-time EWMA share per skater; feed games in date order with ``apply``."""

    def __init__(self):
        self.s: dict[int, float] = {}
        self.w: dict[int, float] = {}
        self.season: dict[int, str] = {}
        self.last: dict[int, float] = {}
        self.first_sum = {"F": 0.0, "D": 0.0}
        self.first_n = {"F": 0, "D": 0}

    def slot_prior(self, g: str) -> float:
        n = self.first_n[g]
        return (self.first_sum[g] + 20 * SLOT_PRIOR0[g]) / (n + 20)

    def apply(self, rows: pd.DataFrame, pos_group: dict, season: str) -> None:
        """rows: player_id, share for one game (or several games, in order)."""
        for pid, sh in zip(rows["player_id"].to_numpy(), rows["share"].to_numpy()):
            pid = int(pid)
            if pid not in self.s:
                g = pos_group.get(pid, "F")
                self.first_sum[g] += float(sh)
                self.first_n[g] += 1
                self.s[pid], self.w[pid] = 0.0, 0.0
            elif self.season.get(pid) != season:
                self.s[pid] *= SEASON_CARRY
                self.w[pid] *= SEASON_CARRY
            self.s[pid] = DECAY * self.s[pid] + float(sh)
            self.w[pid] = DECAY * self.w[pid] + 1.0
            self.season[pid] = season
            self.last[pid] = float(sh)

    def expected(self, pid: int, g: str) -> tuple[float, bool]:
        prior = self.slot_prior(g)
        if pid not in self.s:
            return prior, False
        return (self.s[pid] + M_PRIOR * prior) / (self.w[pid] + M_PRIOR), True


def lineup_shares(state: ShareState, pids, groups, method: str = "ewma") -> np.ndarray:
    """Expected shares for one team's dressed skaters, renormalised (F -> 3, D -> 2).
    ``method='last'`` is the DESIGN §3.7 baseline: each skater's previous game share."""
    if method == "last":
        est = np.array([state.last.get(int(p), state.slot_prior(g)) for p, g in zip(pids, groups)], dtype=float)
    else:
        est = np.array([state.expected(int(p), g)[0] for p, g in zip(pids, groups)], dtype=float)
    groups = np.asarray(groups)
    for g, tot in GROUP_SUM.items():
        m = groups == g
        if m.any() and est[m].sum() > 0:
            est[m] *= tot / est[m].sum()
    return est


def lag_cutoff(d) -> np.datetime64:
    return np.datetime64(d, "D") - np.timedelta64(LAG_DAYS, "D")
