"""On-ice skaters and goalies for every event, from shift charts (DESIGN §3.0, §3.7).

Boundary convention (an event at period second ``t``; a shift covers [start, end]):

* faceoffs and period starts ("primary" rule):  start <= t <  end
  — the players *starting* a shift at t take the draw, not those who just left.
* every other event ("primary" rule):            start <  t <= end
  — a stoppage/goal at t belongs to the players whose shift ends at t.

Shift times are whole seconds, so a change in the same second as an event is
ambiguous.  When the primary rule's per-team skater/goalie counts disagree with
the event's ``situationCode``, the opposite boundary rule is tried and kept only
if it matches exactly ("alt").  The DQ gate reports both the primary-only and
the final agreement, so this tie-break never hides a real coverage gap.
Goalies are kept separate from skaters (never truncated to six).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

FACEOFF_LIKE = {502, 520}  # faceoff, period-start


def _counts(mask, team_is_home, is_goalie):
    """(home_sk, home_g, away_sk, away_g) per event row of a boolean [E, S] mask."""
    h = team_is_home[None, :]
    g = is_goalie[None, :]
    return (
        (mask & h & ~g).sum(1), (mask & h & g).sum(1),
        (mask & ~h & ~g).sum(1), (mask & ~h & g).sum(1),
    )


def assign_on_ice(events: pd.DataFrame, shifts: pd.DataFrame, home_team_id: int) -> pd.DataFrame:
    """Return a frame aligned to ``events`` with the on-ice columns.

    events: period, period_type, period_seconds, type_code, sit_home_sk, sit_home_g,
            sit_away_sk, sit_away_g (nullable ints)
    shifts: player_id, team_id, period, start_s, end_s, is_goalie
    """
    n = len(events)
    out = {
        "home_skaters": [None] * n, "away_skaters": [None] * n,
        "home_goalie_id": [None] * n, "away_goalie_id": [None] * n,
        "home_on_n": [None] * n, "away_on_n": [None] * n,
        "home_goalies_n": [None] * n, "away_goalies_n": [None] * n,
        "onice_rule": ["none"] * n, "onice_primary_match": [None] * n,
    }
    if n == 0 or shifts is None or shifts.empty:
        return pd.DataFrame(out, index=events.index)

    ev = events.reset_index(drop=True)
    pos = np.arange(n)
    for period, sp in shifts.groupby("period", sort=False):
        idx = pos[(ev["period"].to_numpy() == period) & (ev["period_type"].to_numpy() != "SO")]
        if not len(idx):
            continue
        e = ev.iloc[idx]
        t = e["period_seconds"].to_numpy(dtype="float64")[:, None]
        fo = e["type_code"].isin(FACEOFF_LIKE).to_numpy()[:, None]
        st = sp["start_s"].to_numpy(dtype="float64")[None, :]
        en = sp["end_s"].to_numpy(dtype="float64")[None, :]
        team_home = (sp["team_id"].to_numpy() == home_team_id)
        goalie = sp["is_goalie"].to_numpy(dtype=bool)
        pids = sp["player_id"].to_numpy()

        rule_fo = (st <= t) & (t < en)
        rule_other = (st < t) & (t <= en)
        primary = np.where(fo, rule_fo, rule_other)
        alt = np.where(fo, rule_other, rule_fo)

        sit = np.stack([
            e["sit_home_sk"].to_numpy(dtype="float64"), e["sit_home_g"].to_numpy(dtype="float64"),
            e["sit_away_sk"].to_numpy(dtype="float64"), e["sit_away_g"].to_numpy(dtype="float64"),
        ], axis=1)
        has_sit = ~np.isnan(sit).any(axis=1)
        cp = np.stack(_counts(primary, team_home, goalie), axis=1)
        ca = np.stack(_counts(alt, team_home, goalie), axis=1)
        match_p = has_sit & (cp == sit).all(axis=1)
        match_a = has_sit & (ca == sit).all(axis=1)
        use_alt = has_sit & ~match_p & match_a
        chosen = np.where(use_alt[:, None], alt, primary)

        for k, row in enumerate(idx):
            m = chosen[k]
            hs = m & team_home & ~goalie
            as_ = m & ~team_home & ~goalie
            hg = m & team_home & goalie
            ag = m & ~team_home & goalie
            out["home_skaters"][row] = sorted(int(p) for p in pids[hs])
            out["away_skaters"][row] = sorted(int(p) for p in pids[as_])
            hgl = [int(p) for p in pids[hg]]
            agl = [int(p) for p in pids[ag]]
            out["home_goalie_id"][row] = hgl[0] if len(hgl) == 1 else None
            out["away_goalie_id"][row] = agl[0] if len(agl) == 1 else None
            out["home_on_n"][row] = int(hs.sum())
            out["away_on_n"][row] = int(as_.sum())
            out["home_goalies_n"][row] = len(hgl)
            out["away_goalies_n"][row] = len(agl)
            if not has_sit[k]:
                out["onice_rule"][row] = "nosit"
            elif match_p[k]:
                out["onice_rule"][row] = "primary"
            elif use_alt[k]:
                out["onice_rule"][row] = "alt"
            else:
                out["onice_rule"][row] = "mismatch"
            out["onice_primary_match"][row] = bool(match_p[k]) if has_sit[k] else None
    res = pd.DataFrame(out)
    res.index = events.index
    return res
