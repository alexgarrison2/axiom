"""Players ruled out after the DFO lineup page was written (predict_games.mark_unavailable)."""
import predict_games as P
from bu.lineup.crosswalk import dfo_skaters

SAT = "2026-11-14"


def _lu(source="Last Game (2026-11-12)", updated="2026-11-13T14:26:12.394Z"):
    mk = lambda n: {"name": n, "number": 1, "injuryStatus": None, "gameTimeDecision": False}  # noqa: E731
    return {"COL": {"f1": [mk("Artturi Lehkonen"), mk("Nathan MacKinnon"), mk("Martin Necas")],
                    "d1": [mk("Devon Toews"), mk("Cale Makar")],
                    "ir": [mk("Josh Manson")], "lineup_source": source, "updated_at": updated}}


def _news(text, date=SAT, player="Nathan MacKinnon", ts=None):
    return {"player": player, "news": text, "category": "Injury", "date": date, "timestamp": ts or f"{date}T16:49:45.740Z"}


def test_news_rules_out():
    assert P.news_rules_out(_news("MacKinnon (lower-body) will not play Saturday in Montreal."), SAT)
    assert P.news_rules_out(_news("MacKinnon will not play Saturday.", date="2026-11-13"), SAT)
    assert P.news_rules_out(_news("MacKinnon has been ruled out."), SAT)
    assert not P.news_rules_out(_news("MacKinnon will not play Thursday.", date="2026-11-12"), SAT)   # another game
    assert not P.news_rules_out(_news("MacKinnon has been ruled out.", date="2026-11-12"), SAT)       # no day, old
    assert not P.news_rules_out(_news("MacKinnon is questionable to play Saturday."), SAT)
    assert not P.news_rules_out(_news("MacKinnon will play Saturday."), SAT)


def test_espn_out_and_news_mark_the_lineup():
    lu = _lu()
    marked = P.mark_unavailable(
        lu, {"COL": [{"name": "Cale Makar", "status": "Out", "date": "2026-11-14T17:37Z"},
                     {"name": "Martin Necas", "status": "Day-To-Day", "date": "2026-11-14T17:37Z"}]},
        {"COL": [_news("MacKinnon (lower-body) will not play Saturday in Montreal.")]}, {"COL": SAT})
    assert sorted(n for n, _ in marked["COL"]) == ["Cale Makar", "Nathan MacKinnon"]
    sk = dfo_skaters(lu, "COL")
    assert [p["name"] for p in sk] == ["Artturi Lehkonen", "Martin Necas", "Devon Toews"]
    kept = dfo_skaters(lu, "COL", keep_out=True)
    assert [p["out"] for p in kept] == [False, True, False, False, True]


def test_latest_news_item_wins():
    lu = _lu()
    news = [_news("MacKinnon will not play Saturday.", ts="2026-11-14T15:00:00Z"),
            _news("MacKinnon will play Saturday after all.", ts="2026-11-14T20:00:00Z")]
    assert P.mark_unavailable(lu, {}, {"COL": news}, {"COL": SAT}) == {}


def test_later_projection_beats_the_report_but_last_game_lineup_does_not():
    inj = {"COL": [{"name": "Cale Makar", "status": "Injured Reserve", "date": "2026-11-10T17:00Z"}]}
    back = _lu(source="Jesse Montano", updated="2026-11-14T16:00:00Z")
    assert P.mark_unavailable(back, inj, {}, {"COL": SAT}) == {}
    stale = _lu(source="Last Game (2026-11-12)", updated="2026-11-14T16:00:00Z")
    assert [n for n, _ in P.mark_unavailable(stale, inj, {}, {"COL": SAT})["COL"]] == ["Cale Makar"]
