"""wowy.py: 5v5 with-or-without pairs on a tiny synthetic game (no files, no network)."""
from __future__ import annotations

import pandas as pd
import pytest

import wowy as W

GID = 2026020001
A, B = 10, 20                       # team ids (side a = lower id)
GA, GB = 19, 29                     # goalies


def _shift(pid, team, st, en, period=1):
    return {"game_id": GID, "period": period, "start_seconds": st, "end_seconds": en,
            "player_id": pid, "player_name": str(pid), "team_id": team, "team_abbrev": "AAA" if team == A else "BBB"}


def _game():
    rows = [_shift(GA, A, 0, 120), _shift(GB, B, 0, 120)]
    # Team A: 11-14 all 120 s; 15 plays 0-60, 16 plays 60-120.
    rows += [_shift(p, A, 0, 120) for p in (11, 12, 13, 14)]
    rows += [_shift(15, A, 0, 60), _shift(16, A, 60, 120)]
    # Team B: five skaters all 120 s.
    rows += [_shift(p, B, 0, 120) for p in (21, 22, 23, 24, 25)]
    # 120-150: team B's goalie is pulled (6 skaters vs 5): not 5v5.
    rows += [_shift(p, A, 120, 150) for p in (11, 12, 13, 14, 15)] + [_shift(GA, A, 120, 150)]
    rows += [_shift(p, B, 120, 150) for p in (21, 22, 23, 24, 25, 26)]
    shifts = pd.DataFrame(rows)
    shots = pd.DataFrame({
        "game_id": [GID] * 4, "period": [1] * 4,
        "time_seconds": [30, 60, 90, 140],          # 60 = a shift change: belongs to (0, 60]
        "team_id": [A, A, B, A],
        "strength_state": ["5v5", "5v5", "5v5", "6v5"],
        "xG": [0.1, 0.3, 0.2, 0.5],
    })
    return shifts, shots


def test_pairs_together_and_apart():
    shifts, shots = _game()
    st = W.attribute_shots(W.build_stints(shifts, {GA, GB}), shots)
    assert st["dur"].sum() == pytest.approx(120)           # the goalie-pulled stretch is out
    on, pairs = W.aggregate(st)
    o = on.set_index(["player", "team"])
    p = pairs.set_index(["a", "b", "team"])
    # 11 with 15: together 0-60 (both A shots at 30 and 60), 11 apart 60-120 (the B shot at 90).
    assert p.loc[(11, 15, A), "dur"] == 60
    assert p.loc[(11, 15, A), "xgf"] == pytest.approx(0.4)
    assert p.loc[(11, 15, A), "xga"] == pytest.approx(0.0)
    assert o.loc[(11, A), "dur"] == 120
    assert o.loc[(11, A), "xgf"] - p.loc[(11, 15, A), "xgf"] == pytest.approx(0.0)
    assert o.loc[(11, A), "xga"] - p.loc[(11, 15, A), "xga"] == pytest.approx(0.2)
    # 15 and 16 never share the ice.
    assert (15, 16, A) not in p.index
    # Opponents see the mirror image.
    assert o.loc[(21, B), "xga"] == pytest.approx(0.4)
    assert o.loc[(21, B), "xgf"] == pytest.approx(0.2)
    # Goalies are never skaters in a pair.
    assert not ({GA, GB} & (set(pairs["a"]) | set(pairs["b"])))


def test_threshold_scales_with_season():
    assert W.min_toi_seconds(84, 2026) == 100 * 60
    assert W.min_toi_seconds(82, 2025) == 100 * 60
    assert W.min_toi_seconds(42, 2026) == 50 * 60
    assert W.min_toi_seconds(2, 2026) == 10 * 60       # floor


def test_select_pairs_top_n():
    pairs = pd.DataFrame({"a": [1, 1, 1, 2], "b": [2, 3, 4, 3], "team": [A] * 4,
                          "dur": [500, 400, 50, 300], "xgf": [1.0] * 4, "xga": [1.0] * 4})
    kept = W.select_pairs(pairs, min_toi=100, top=1)
    got = {(r.a, r.b) for r in kept.itertuples()}
    # (1,4) is under the bar; (1,2) is 1's and 2's top; (1,3) is 3's top.
    assert got == {(1, 2), (1, 3)}
