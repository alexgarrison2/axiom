"""milestones.py: the pure pieces (ladders, list passes, streaks, pace)."""
import milestones as M


def test_next_rung_skips_reached_values():
    assert M.next_rung(99, M.LADDERS["g"]) == 100
    assert M.next_rung(100, M.LADDERS["g"]) == 150
    assert M.next_rung(1000, M.LADDERS["g"]) is None
    assert M.next_rung(49.9, M.LADDERS["ixg"]) == 50


def test_gp_ladder_keeps_the_headline_numbers_only():
    assert M.LADDERS["gp"][:5] == [100, 250, 500, 750, 1000]
    assert 1100 in M.LADDERS["gp"] and 300 not in M.LADDERS["gp"]


def test_games_needed_rounds_up_and_handles_zero_pace():
    assert M.games_needed(3, 0.5) == 6
    assert M.games_needed(1, 2.0) == 1
    assert M.games_needed(0, 0.5) == 0
    assert M.games_needed(2, 0) is None
    assert M.team_games_for(6, 0.5) == 12


def test_top_groups_ranks_ties_together_and_stops_at_depth():
    table = {1: 900, 2: 800, 3: 800, 4: 700, 5: 10}
    g = M.top_groups(table, 3)
    assert g == [(1, 900, [1]), (2, 800, [2, 3])]
    assert M.top_groups(table, 4)[-1] == (4, 700, [4])


def test_passes_nearest_first_and_never_himself():
    groups = M.top_groups({1: 900, 2: 800, 3: 800, 4: 700}, 10)
    ups = M.passes(750, 4, groups)
    assert ups[0] == (2, 800, [2, 3])
    assert ups[-1] == (1, 900, [1])
    # The leader has nobody left to pass.
    assert M.passes(900, 1, groups) == []


def test_streaks():
    assert M.streak([True, False, True, True]) == 2
    assert M.streak([True, True, False]) == 0
    assert M.longest([True, True, False, True, True, True, False]) == 3


def test_club_size_counts_everyone_at_or_above():
    assert M.club_size(500, [499, 500, 894]) == 2


def test_out_tag():
    assert M.out_tag({"status": "Injured Reserve"}) == "IR"
    assert M.out_tag({"status": "Day-To-Day"}) == "DTD"
    assert M.out_tag({"status": "Out"}) == "OUT"
    assert M.out_tag(None) is None


def test_assign_places_orders_chasers_and_ties_same_night():
    mk = lambda p, date, kind="career", **kw: {"p": p, "kind": kind, "stat": "g", "target": 500, "need": 1,
                                               "eta": [1, date, "X", 1, 5], "club": 46, **kw}
    a, b, c = mk(1, "2026-10-20"), mk(2, "2026-10-20"), mk(3, "2026-10-25")
    M.assign_places([c, a, b])
    assert (a["nth"], b["nth"], c["nth"]) == (47, 47, 49)
    assert a.get("tie") and b.get("tie") and not c.get("tie")
    x = mk(4, "2026-10-21", kind="franchise", rank=2, fr="UTA")
    y = mk(5, "2026-10-22", kind="franchise", rank=2, fr="UTA")
    M.assign_places([x, y])
    assert (x["rank"], y["rank"]) == (2, 3)
