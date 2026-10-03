"""Ratings v5 (bu/rapm/box.py pp_units, v5.py, v4_pack v5 config, ratings_export v5 impact)."""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from bu.rapm import box as B
from bu.rapm import v4 as V4
from bu.rapm import v4_pack as P4
from bu.rapm import v5 as V5

from test_bu_ratings_v4 import _v4_bundle
from test_bu_ratings_v3 import ROSTER


def _pen_events(rows):
    """rows: (game_seconds, home?, desc, duration, committed, drawn[, type])"""
    ev = []
    for k, r in enumerate(rows):
        t, home, desc, dur, by, drawn = r[:6]
        typ = r[6] if len(r) > 6 else "penalty"
        ev.append({"game_id": 1, "event_id": k + 1, "sort_order": k + 1, "period": 1, "period_type": "REG",
                   "game_seconds": t, "type_desc": typ, "event_team_is_home": home, "pen_desc_key": desc,
                   "pen_duration": dur, "pen_committed_by_id": by, "pen_drawn_by_id": drawn, "is_penalty_shot": False,
                   "sit_home_sk": 5, "sit_away_sk": 5, "sit_home_g": 1, "sit_away_g": 1})
    return pd.DataFrame(ev)


def test_pp_units_cancel_like_the_rule_book():
    e = _pen_events([
        (100, True, "tripping", 2, 1, 11),                                      # plain minor: 1
        (200, True, "roughing", 2, 2, 12), (200, False, "roughing", 2, 12, 2),  # coincidental: 0 / 0
        (300, True, "roughing", 2, 3, 13), (300, True, "cross-checking", 2, 3, 13),
        (300, False, "roughing", 2, 13, 3),                                     # 2 vs 1: one PP for away
        (400, True, "high-sticking-double-minor", 4, 4, 14), (400, False, "slashing", 2, 14, 4),  # 4 vs 2: 1
        (500, True, "fighting", 5, 5, 15), (500, False, "fighting", 5, 15, 5),
        (500, False, "instigator", 2, 15, 5), (500, False, "instigator-misconduct", 10, 15, 5),
        (600, True, "boarding", 5, 1, 11), (600, True, "game-misconduct", 10, 1, 11),   # major: 2.5
        (700, True, "ps-hooking-on-breakaway", 0, 2, 12),                      # penalty shot: 0
    ])
    u = B.pp_units(e).to_numpy()
    assert list(u[:3]) == [1, 0, 0]
    assert u[3:6].sum() == pytest.approx(1.0) and u[5] == 0                 # home's two minors share the PP
    assert u[6] == pytest.approx(1.0) and u[7] == 0
    assert list(u[8:12]) == [0, 0, 1, 0]                                    # fights cancel, instigator creates it
    assert list(u[12:]) == [2.5, 0, 0]
    # a delayed minor washed out by the other team's goal at the same second
    w = _pen_events([(800, False, "goal-x", 0, None, None, "goal"), (800, True, "hooking", 2, 1, 11)])
    w.loc[0, "event_team_is_home"] = False
    assert B.pp_units(w).tolist() == [0.0]


def test_pp_goal_value_counts_pulled_goalie_power_play_goals():
    e = _pen_events([(100, True, "tripping", 2, 1, 11), (200, True, "slashing", 2, 2, 12),
                     (201, False, "", 0, None, None, "goal"), (300, True, "", 0, None, None, "goal")])
    e.loc[2, ["sit_home_sk", "sit_away_sk", "sit_away_g"]] = [4, 6, 0]      # away PP with the goalie pulled: 6v4
    e.loc[3, ["sit_home_sk", "sit_away_sk", "sit_away_g"]] = [4, 6, 0]      # home shorthanded empty-netter
    v = B.pp_goal_value(e)
    assert v["ppg"] == 0 and v["ppg_all"] == 1 and v["shg_all"] == 1 and v["pp_units"] == 2
    assert v["value_pp"] == 0.0


def _sums():
    idx = pd.Index([1, 2, 3, 4])
    s = pd.DataFrame(0.0, index=idx, columns=V4.SUM_COLS)
    s["ev_s"] = [60000.0, 60000.0, 60000.0, 0.0]
    s["pd_all"], s["pdu_all"] = [20.0, 10.0, 6.0, 0.0], [16.0, 8.0, 4.0, 0.0]
    s["pt_all"], s["ptu_all"] = [10.0, 10.0, 10.0, 0.0], [5.0, 5.0, 5.0, 0.0]
    return s


def test_penalty_rates_all_scaled():
    s = _sums()
    groups = {1: "F", 2: "F", 3: "F", 4: "F"}
    r_all, fb = V5.penalty_rates(s, groups, (800.0, 400.0), "all_scaled")
    r_v4 = V4.penalty_rates(s, groups, (800.0, 400.0), cols=V4.PEN_COLS_V4)
    assert np.allclose(r_all["pd60"], r_v4["pd60"] * 28 / 36) and np.allclose(r_all["pt60"], r_v4["pt60"] * 0.5)
    # no sample: the group's PP-unit rate
    assert r_all.loc[4, "pd60"] == pytest.approx(28 / 180000 * 3600) and fb["F"][1] == pytest.approx(15 / 180000 * 3600)
    r_pp, _ = V5.penalty_rates(s, groups, 400.0, "pp")
    assert np.allclose(r_pp["pd60"], V4.penalty_rates(s, groups, 400.0, cols=V4.PEN_COLS_V5)["pd60"])
    # separate drawn / taken pseudo minutes
    a = V4.penalty_rates(s, groups, (50.0, 5000.0), cols=V4.PEN_COLS_V4)
    assert a.loc[1, "pd60"] > a.loc[2, "pd60"] + 0.4 and a["pt60"].std() < 1e-9


def test_fin_pp_values():
    s = pd.DataFrame({"G_ev": [10.0, 0.0, 0.0], "X_ev": [10.0, 5.0, 0.0], "G_pp": [6.0, 0.0, 0.0],
                      "X_pp": [3.0, 3.0, 0.0], "S_pp": [36000.0, 36000.0, 0.0]}, index=[1, 2, 3])
    own = V5.fin_pp_values(s, {}, 30.0, "own")
    sh = V5.fin_pp_values(s, {}, 30.0, "shared")
    assert own[1] > 0 > own[2] and own[3] == 0
    assert sh[1] < own[1] and sh[2] < own[2] < 0          # shared multiplier: EV shots count too
    with pytest.raises(ValueError):
        V5.fin_pp_values(s, {}, 30.0, "nope")


def _v5_bundle():
    b = _v4_bundle()
    cols = b["v4"]["columns"]
    j = cols.index("fin_pp")
    for r in b["v4"]["rows"]:
        r[j] = 0.3 if r[0] == 1 else -0.05
    b["v4"]["meta"] = dict(b["v4"]["meta"], pen_units="all_scaled", pen_t0=[800.0, 400.0],
                           fin_pp={"variant": "shared", "prior_xg": 30.0})
    return b


def test_export_v5_fin_pp_in_impact():
    from datetime import datetime, timezone
    from bu.lineup import ratings_export as RE
    now = datetime(2026, 10, 3, tzinfo=timezone.utc)
    d5 = RE.build_export(_v5_bundle(), None, ROSTER, None, now=now)
    d4 = RE.build_export(_v4_bundle(), None, ROSTER, None, now=now)
    assert d5["version"] == 4 and d5["columns"] == RE.COLUMNS_V5 and d4["columns"] == RE.COLUMNS_V4
    assert d5["impact"]["pen_units"] == "all_scaled" and d5["impact"]["pen_t0"] == [800.0, 400.0]
    r5 = {r[0]: dict(zip(d5["columns"], r)) for r in d5["rows"]}
    r4 = {r[0]: dict(zip(d4["columns"], r)) for r in d4["rows"]}
    m = d5["impact"]["position_means"]["F"]["fin_pp"]
    for p, r in r5.items():
        assert r["impact"] == pytest.approx(r["off_impact"] + r["def_impact"], abs=0.011)
        add = 82 * r["toi_pp_gp"] / 60 * (r["fin_pp"] - m) if r["pos"] != "D" else None
        if add is not None and r["rated"]:
            assert r["off_impact"] - r4[p]["off_impact"] == pytest.approx(add, abs=0.02)
    assert not r5[4]["rated"] and r5[4]["fin_pp"] == pytest.approx(m, abs=1e-3)


def test_v5_pack_config_round_trip():
    j = {"version": P4.PACK_VERSION, "kind": P4.PACK_KIND, "season": "20262027", "pen_value": 0.18,
         "config": {"pen_t0": [800.0, 400.0], "pen_units": "all_scaled", "fin_pp": {"variant": "shared", "prior_xg": 30.0}},
         "grid": [{"fin_pp": P4._fin_pp_json(pd.DataFrame([[1.0, 2.0, 3.0, 4.0, 5.0]], index=[7], columns=V5.FIN_PP_COLS))},
                  {"fin_pp": []}]}
    rows = P4._fin_pp_from_json(json.loads(json.dumps(j["grid"][0]["fin_pp"])))
    assert rows.loc[7, "S_pp"] == 5.0 and P4._fin_pp_from_json(None) is None and len(P4._fin_pp_from_json([])) == 0
    mid = V5.interp_fin_pp(rows, V5.add_fin_pp(), 0.5)
    assert mid.loc[7, "G_pp"] == pytest.approx(1.5)
