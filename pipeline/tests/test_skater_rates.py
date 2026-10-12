"""skater_rates.py: season on-ice rates on wowy's tiny synthetic game (no files, no network)."""
from __future__ import annotations

import pandas as pd
import pytest

import skater_rates as S
import wowy as W
from tests.test_wowy import GA, GB, GID, _game


def test_rates_on_off_and_splits():
    shifts, shots = _game()
    shots["player_id"] = [11, 15, 21, 11]
    st = W.attribute_shots(W.build_stints(shifts, {GA, GB}), shots)
    five = S.five_on_five(st, shots).set_index("player")
    # 15 is on 0-60 (A shots 0.1 + 0.3), off 60-120 (B shot 0.2); his own 5v5 xG is the 0.3.
    assert five.loc[15, "dur"] == pytest.approx(60)
    assert (five.loc[15, "xgf"], five.loc[15, "xga"]) == pytest.approx((0.4, 0.0))
    assert (five.loc[15, "off_dur"], five.loc[15, "off_xgf"], five.loc[15, "off_xga"]) == pytest.approx((60, 0.0, 0.2))
    assert five.loc[15, "ixg"] == pytest.approx(0.3)
    assert five.loc[11, "ixg"] == pytest.approx(0.1)            # the 6v5 shot is not 5v5

    games = pd.DataFrame([
        {"game_id": GID, "date": "2026-10-01", "player_id": 15, "team": "AAA", "pos": "C", "toi": 20.0,
         "ev_toi": 15.0, "pp_toi": 3.0, "sh_toi": 2.0, "pen_drawn": 1, "pen_taken": 0},
        {"game_id": GID, "date": "2026-10-01", "player_id": GA, "team": "AAA", "pos": "G", "toi": 60.0,
         "ev_toi": 0, "pp_toi": 0, "sh_toi": 0, "pen_drawn": 0, "pen_taken": 0},
    ])
    out = [dict(zip(S.COLS, r)) for r in S.rows(five.reset_index(), S.all_situations(games))]
    assert [r["player"] for r in out] == [15]                     # goalies dropped
    r = out[0]
    assert (r["toi5"], r["xgf60"], r["xga60"], r["xg_pct"], r["ixg60"]) == (60, 24.0, 0.0, 1.0, 18.0)
    assert r["rel"] == pytest.approx(1.0)                         # 100% on, 0% off
    assert r["pen60"] == 3.0                                       # +1 in 20 minutes
    assert (r["ev_toi"], r["pp_toi"], r["pk_toi"]) == (900, 180, 120)
