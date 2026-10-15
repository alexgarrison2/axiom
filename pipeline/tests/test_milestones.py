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


def test_ladder_shows_two_above_the_passed_name_best_first():
    groups = M.top_groups({1: 900, 2: 800, 3: 700, 4: 600, 9: 550}, 10)
    ups = M.passes(550, 9, groups)
    names = {1: "A One", 2: "B Two", 3: "C Three", 4: "D Four"}
    rows, between, gap = M.ladder(ups, 0, names, {2}, set(), {2: 1200})
    assert [r[:4] for r in rows] == [[2, 2, "B Two", 800], [3, 3, "C Three", 700], [4, 4, "D Four", 600]]
    assert rows[0][4] == 1 and rows[0][6] == 1200 and rows[1][6] == 0
    assert between == [] and gap == 0
    assert M.rank_now(550, 9, {1: 900, 2: 800, 9: 550, 5: 550}) == 3


def test_entry_into_top_n_shows_the_names_between():
    # He is 13th; 10th is the top-10 cut, 11th and 12th sit between.
    table = {i: 1000 - i * 10 for i in range(1, 13)}
    table[99] = 860
    groups = M.top_groups(table, M.FULL)
    ups = M.passes(860, 99, groups)
    now = M.rank_now(860, 99, table)
    assert now == 13
    targets = M.pass_targets(ups, 10, 25, now)
    assert targets == [(0, None), (2, 10)]
    rows, between, gap = M.ladder(ups, 2, {}, set(), set(), {})
    assert [r[0] for r in rows] == [8, 9, 10]
    assert [r[0] for r in between] == [11, 12]
    assert gap == 0
    rows, between, gap = M.ladder(ups, 5, {}, set(), set(), {})
    assert [r[0] for r in between] == [11, 12] and gap == 3


def test_inside_the_top_n_only_the_next_name():
    table = {1: 900, 2: 800, 3: 700, 9: 650}
    ups = M.passes(650, 9, M.top_groups(table, M.FULL))
    assert M.pass_targets(ups, 10, 25, 4) == [(0, None)]



def _dates(table):
    return lambda club, sid: table.get((club, sid), [])


def test_missed_counts_the_new_club_after_a_trade_and_both_ends_across_seasons():
    cd = _dates({("EDM", "1"): ["01", "02", "03", "05"], ("TOR", "1"): ["02", "04"],
                 ("EDM", "0"): ["90", "95"], ("TOR", "0"): ["90"]})
    assert not M.missed(("1", "01", "EDM"), ("1", "02", "EDM"), cd)
    assert M.missed(("1", "01", "EDM"), ("1", "05", "EDM"), cd)
    # Traded EDM -> TOR after "01": EDM's "02"/"03" do not count, TOR's "02" does.
    assert M.missed(("1", "01", "EDM"), ("1", "04", "TOR"), cd)
    assert not M.missed(("1", "03", "EDM"), ("1", "04", "TOR"), cd)
    # Across seasons: the old club's games after his last, the new club's before his first.
    assert M.missed(("0", "90", "EDM"), ("1", "02", "TOR"), cd)
    assert not M.missed(("0", "95", "EDM"), ("1", "01", "EDM"), cd)
    assert M.missed(("0", "95", "EDM"), ("1", "03", "EDM"), cd)


def test_straight_games_ends_at_a_missed_game_and_at_zero_when_he_missed_the_latest():
    cd = _dates({("EDM", "1"): ["01", "02", "03", "04", "05"]})
    played = [("1", d, "EDM") for d in ("01", "03", "04", "05")]
    assert M.straight_games(played + [("1", M.END, "EDM")], cd) == 3
    assert M.straight_games(played[:-1] + [("1", M.END, "EDM")], cd) == 0
    assert M.straight_games([("1", M.END, "EDM")], _dates({})) == 0


def test_walk_tail_walks_back_through_unbroken_seasons(monkeypatch):
    prev, older = M.PREV_START_YEAR, M.PREV_START_YEAR - 1
    psid, osid = M._sid(prev), M._sid(older)
    logs = {prev: [(psid, "2026-01-01", "TOR"), (psid, "2026-01-03", "TOR")],
            older: [(osid, "2025-01-01", "EDM"), (osid, "2025-01-02", "EDM")]}
    cd = _dates({("TOR", psid): ["2026-01-01", "2026-01-03"], ("EDM", osid): ["2024-12-30", "2025-01-01", "2025-01-02"]})
    # A season he played whole, then an offseason move: 2 + 2. The streak starts at his first game
    # (the club's opener before it does not count) and the walk stops at a season he did not play.
    assert M.walk_tail(1, log=lambda pid, y: logs.get(y, []), club_dates=cd) == [4, "2026-01-03", "TOR"]
    # He missed his club's last game: no streak to carry.
    cd2 = _dates({("TOR", psid): ["2026-01-01", "2026-01-03", "2026-01-05"]})
    assert M.walk_tail(1, log=lambda pid, y: logs.get(y, []), club_dates=cd2) == [0]
    assert M.walk_tail(1, log=lambda pid, y: [], club_dates=cd) == [0]


def test_ironman_streaks_joins_this_season_to_the_cached_tail():
    import pandas as pd
    sid = M.SEASON_ID
    gid = lambda n: int(f"{sid[:4]}02{n:04d}")
    sg = pd.DataFrame([
        {"game_id": gid(1), "date": "2026-10-01", "player_id": 1, "team": "EDM", "opp": "TOR"},
        {"game_id": gid(1), "date": "2026-10-01", "player_id": 3, "team": "TOR", "opp": "EDM"},
        {"game_id": gid(2), "date": "2026-10-03", "player_id": 1, "team": "EDM", "opp": "CGY"},
    ])
    tails = {1: [500, "2026-04-16", "EDM"], 2: [80, "2026-04-16", "TOR"], 3: [40, "2026-04-16", "TOR"]}
    out = M.ironman_streaks(sg, {1: "EDM", 2: "TOR", 3: "TOR", 4: "CGY"}, tails)
    # 1 played both EDM games; 2 missed TOR's opener; 3 played TOR's only game; 4 has neither.
    assert out == {1: 502, 3: 41}
