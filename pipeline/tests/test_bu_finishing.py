"""bu.rapm.finishing (FIN: shrunk EV goals above xG per 60) and its player_ratings export fields."""
from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd
import pytest

from bu.rapm import finishing as FN


def _pg(rows):
    return pd.DataFrame(rows, columns=["game_id", "player_id", "g", "x", "s"])


def test_fin_sign_shrinkage_and_scale():
    st = FN.FinState(prior_xg=40.0, decay=0.5)
    st.roll("20242025")
    # sniper: 30 goals on 20 xG; grinder: 10 on 20; league filler keeps the ratio at 1
    st.add_games(_pg([(1, 1, 30, 20, 60_000), (1, 2, 10, 20, 60_000), (1, 3, 960, 960, 3_000_000)]))
    assert st.multiplier(1) == pytest.approx((30 + 40) / (20 + 40 * 1.0), rel=0.02)
    assert st.fin(1) > 0 > st.fin(2)
    assert st.fin(99) == 0.0                        # no data: league average
    small = FN.FinState(prior_xg=40.0)
    small.roll("20242025")
    small.add_games(_pg([(1, 1, 3, 2, 6_000), (1, 3, 960, 960, 3_000_000)]))
    assert 0 < small.multiplier(1) - 1 < st.multiplier(1) - 1     # less data, more shrinkage


def test_roll_decays_and_normalises_to_the_league():
    st = FN.FinState(prior_xg=10.0, decay=0.5)
    st.roll("20232024")
    # the xG model under-predicts the whole league by 20%: everyone's raw goals/xG = 1.2
    st.add_games(_pg([(1, 1, 12, 10, 36_000), (1, 2, 1200, 1000, 3_600_000)]))
    st.roll("20242025", {1: "F", 2: "F"})
    g, x, s = st.sums(1)
    # last season counts in full, its xG scaled by the league's 1.2
    assert g == pytest.approx(12.0) and x == pytest.approx(12.0) and s == pytest.approx(36_000)
    assert st.multiplier(1) == pytest.approx(1.0)  # league-average finisher once scaled
    assert st.mu["F"] == pytest.approx((12 + 1200) / (36_000 + 3_600_000))
    st.roll("20252026")                            # one more season back: x DECAY
    assert st.sums(1)[0] == pytest.approx(6.0)


def test_pack_round_trip(tmp_path):
    st = FN.FinState()
    st.roll("20242025")
    st.add_games(_pg([(1, 1, 5, 3, 7_200), (1, 2, 1, 2, 7_200)]))
    st.roll("20252026")
    p = FN.write_pack(str(tmp_path / "fin.json.gz"), {"version": 1, "season": "20252026", "state": st.to_json()})
    back = FN.read_pack(p)
    assert back.season == "20252026" and back.fin(1, "F") == pytest.approx(st.fin(1, "F"), abs=1e-6)


def test_player_games_counts_even_strength_shots_only():
    xg = pd.DataFrame({"game_id": [1, 1, 1, 1], "shooter_id": [7, 7, 7, 8], "is_goal": [True, False, True, False],
                       "strength": ["5v5", "5v4", "4v4", "5v5"], "empty_net_against": [False, False, True, False],
                       "xg": [0.3, 0.2, 0.9, 0.1]})
    shares = pd.DataFrame({"game_id": [1, 1, 1], "player_id": [7, 8, 9], "ev_s": [900.0, 800.0, 700.0]})
    pg = FN.player_games(xg, shares).set_index("player_id")
    assert pg.loc[7, "g"] == 1 and pg.loc[7, "x"] == pytest.approx(0.3) and pg.loc[9, "x"] == 0.0
    assert pg.loc[8, "s"] == 800.0


def test_export_adds_fin_and_off_total(tmp_path, monkeypatch):
    from bu.lineup import ratings_export as RE
    bundle = {"version": 1, "kind": "serving_bundle", "season": "20262027", "built_at": "2026-10-01T09:30:00+00:00",
              "max_source_date": "2026-09-30", "n_games": 8, "rookie": {"F": [0.0, 0.0], "D": [0.0, 0.0]},
              "players": {"columns": ["player_id", "o", "d", "rated"], "rows": [[1, 0.40, 0.0, True], [2, 0.30, 0.0, True]]}}
    roster = {1: ("Grinder", "AAA", "R"), 2: ("Sniper", "AAA", "R")}
    st = FN.FinState(prior_xg=40.0)
    st.roll("20252026")
    st.add_games(_pg([(1, 1, 60, 90, 300_000), (1, 2, 100, 75, 260_000), (1, 3, 5000, 5000, 9e7)]))
    st.roll("20262027")
    now = datetime(2026, 10, 1, tzinfo=timezone.utc)
    doc = RE.build_export(bundle, None, roster, None, now=now, fin=st, fin_current=True)
    rows = {r[0]: dict(zip(doc["columns"], r)) for r in doc["rows"]}
    assert rows[1]["fin"] < 0 < rows[2]["fin"]
    for r in rows.values():
        assert r["off_total"] == pytest.approx(r["off"] + r["fin"], abs=1e-9)
    assert rows[2]["off_total"] > rows[1]["off_total"]     # finishing reorders the two
    assert rows[1]["def"] == 0.0 and rows[1]["net"] == 0.40   # existing fields untouched
    # a run without this season's caches carries the previous export's FIN (no churn)
    again = RE.build_export(bundle, None, roster, None, doc, now=now, fin=FN.FinState(), fin_current=False)
    assert again["rows"] == doc["rows"]
    # no pack at all and no previous value: FIN 0
    bare = RE.build_export(bundle, None, roster, None, now=now)
    assert all(dict(zip(bare["columns"], r))["fin"] == 0.0 for r in bare["rows"])


# ── live FIN (bu_d_fin): serving bundle table and the lineup-side sum ─────────

def test_season_state_adds_the_seasons_games_to_the_pack(tmp_path, monkeypatch):
    st = FN.FinState()
    st.roll("20252026")
    st.add_games(_pg([(1, 1, 4, 3, 36_000), (1, 2, 1, 2, 36_000), (1, 3, 900, 900, 3_000_000)]))
    st.roll("20262027", {1: "F", 2: "D", 3: "F"})
    pack = FN.write_pack(str(tmp_path / "fin_pack_20262027.json.gz"),
                         {"version": 1, "season": "20262027", "state": st.to_json()})
    import bu.lineup.toi as TOI
    # EV seconds per player and game (the real function needs on-ice stint columns)
    monkeypatch.setattr(TOI, "game_shares", lambda s: pd.DataFrame(
        {"game_id": [5, 5], "player_id": [1, 2], "ev_s": [1000.0, 900.0]}))
    xg = pd.DataFrame({"game_id": [5, 5, 5, 6], "shooter_id": [1, 1, 2, 1], "is_goal": [True, True, False, True],
                       "strength": ["5v5"] * 4, "empty_net_against": [False] * 4, "xg": [0.2, 0.3, 0.4, 0.1]})
    stints = pd.DataFrame({"game_id": [5, 5, 6], "game_type": [2, 2, 1]})
    live, n = FN.season_state("20262027", xg, stints, pack=pack)
    assert n == 1                                    # the preseason game (type 1) is not counted
    g, x, s = live.sums(1)
    assert g == pytest.approx(4 + 2) and s == pytest.approx(36_000 + 1000)
    alone, n0 = FN.season_state("20262027", None, None, pack=pack)
    assert n0 == 0 and alone.fin(1, "F") == pytest.approx(st.fin(1, "F"))
    assert FN.season_state("20262027", xg, stints, pack=str(tmp_path / "missing.json.gz")) == (None, 0)
    rows = {r[0]: r for r in FN.bundle_rows(live)}
    assert rows[1][1] == pytest.approx(live.fin(1, "F"), abs=1e-6)
    assert rows[2][2] == pytest.approx(live.fin(2, "D"), abs=1e-6)
    assert rows[1][1] != rows[1][2]                  # the position group sets the volume prior


def test_side_term_fin_is_the_share_weighted_sum():
    import numpy as np
    from bu.lineup.features import side_term
    from bu.lineup.toi import ShareState, lineup_shares
    st = ShareState()
    pids = list(range(1, 19))
    groups = ["F"] * 12 + ["D"] * 6

    def rate(p, g):
        return np.zeros(len(p)), np.zeros(len(p)), len(p)

    fin = {p: 0.01 * p for p in pids}
    t = side_term(st, pids, groups, rate, [], fin=lambda ps, gs: [fin[p] for p in ps])
    s_ = lineup_shares(st, pids, groups)
    assert t["fin"] == pytest.approx(float(s_ @ np.array([fin[p] for p in pids])))
    assert "fin" not in side_term(st, pids, groups, rate, [])
