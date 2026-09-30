"""fix2-I6: the model always produces its own probability, never the market's.

TBL@NYR on 2026-10-01 showed model = forecast = market = 43.4%. Recomputing
it with ml_predict gave 0.43419 from its own terms (home ice +0.115, 5v5
-0.149, special teams -0.093, goaltending -0.016, rest -0.123): a genuine
coincidence with the de-vigged NYR +120 / TBL -140 line, not a fallback.
These tests pin that there is no market fallback path at all:

* the model % does not move when the market price moves (only the blend does);
* when the game model is unavailable or returns nothing, the row is marked
  ``no_model`` with no probabilities (it is never filled from the market);
* validate_outputs 'model_independent' rebuilds the model % from the row's
  own factor breakdown and flags a row whose model % was overwritten.
"""
import csv
import json
from datetime import datetime, timezone

import predict_games as P
import validate_outputs as V
from test_season_context import OPENER, StubML, entry, inputs

UTC = timezone.utc
NOW = datetime(2026, 9, 29, 12, 0, tzinfo=UTC)
GM = OPENER[3]


def _row(odds=None, **kw):
    odds = odds if odds is not None else {}
    return P.build_rows(inputs(NOW, [entry(GM)], OPENER, odds=odds, **kw))[0]


def _odds(home, away):
    return {str(GM["id"]): {"home_ml": home, "away_ml": away, "source": "bovada",
                            "fetched_at": "2026-09-29T11:00:00Z"}}


def test_model_pct_ignores_the_market_price():
    fav = _row(_odds(-200, 170))
    dog = _row(_odds(180, -210))
    none = _row({})
    assert fav["home_model_win_pct"] == dog["home_model_win_pct"] == none["home_model_win_pct"] != ""
    # the published forecast is the blend, so it does follow the market
    assert float(fav["home_win_pct"]) > float(dog["home_win_pct"])
    # without a market the forecast is the model itself
    assert none["home_win_pct"] == none["home_model_win_pct"]
    assert none["home_vegas_win_pct"] == "" and none["blend_weight"] == ""


class NoModel(StubML):
    def predict_detail(self, *a, **k):
        return None


class Unavailable(StubML):
    available = False


def test_missing_model_is_flagged_not_filled_from_the_market():
    for ml in (NoModel(), Unavailable(), None):
        r = _row(_odds(-150, 130), ml=ml)
        assert r["prediction_status"] == P.STATUS_NO_MODEL
        for c in ("home_model_win_pct", "away_model_win_pct", "home_win_pct", "away_win_pct",
                  "home_vegas_win_pct", "model_version", "home_wp_breakdown"):
            assert r[c] == "", (type(ml).__name__, c, r[c])


def _write(tmp_path, rows):
    p = tmp_path / "predictions_detailed.csv"
    with open(p, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=P.COLUMNS)
        w.writeheader()
        w.writerows(rows)
    return {"pred_files": [str(p)]}


def test_validate_rebuilds_model_pct_from_its_factors(tmp_path):
    r = _row(_odds(-150, 130))
    assert r["prediction_status"] == "pregame"
    rebuilt = V.model_pct_from_breakdown(r)
    assert abs(rebuilt - float(r["home_model_win_pct"])) <= V.MODEL_REBUILD_TOL
    assert V.check_model_independent(_write(tmp_path, [r])) == []

    # A row whose model % was replaced by the market % is caught.
    copied = dict(r, home_model_win_pct=r["home_vegas_win_pct"],
                  away_model_win_pct=r["away_vegas_win_pct"])
    assert float(copied["home_model_win_pct"]) - rebuilt > 1
    errs = V.check_model_independent(_write(tmp_path, [copied]))
    assert len(errs) == 1 and "does not follow from its factors" in errs[0]

    # A published % with no model % at all is caught too.
    blank = dict(r, home_model_win_pct="", away_model_win_pct="")
    assert "without a model-only %" in V.check_model_independent(_write(tmp_path, [blank]))[0]


def test_validate_accepts_a_model_pct_that_happens_to_equal_the_market(tmp_path):
    # Built so the model % lands exactly on the de-vigged market %: allowed,
    # because the factors (not the price) produce it.
    r = _row(_odds(-150, 130))
    r = dict(r, home_vegas_win_pct=r["home_model_win_pct"],
             away_vegas_win_pct=r["away_model_win_pct"])
    assert V.check_model_independent(_write(tmp_path, [r])) == []


def test_committed_predictions_pass():
    errs = V.check_model_independent({})
    assert errs == [], errs
    for path in V.PRED_FILES:
        with open(path, newline="") as f:
            for r in csv.DictReader(f):
                if r["prediction_status"] in ("pregame", "frozen") and r["home_win_pct"]:
                    assert r["model_version"], r["game_id"]
                    bd = json.loads(r["home_wp_breakdown"])
                    assert any(x["factor"] != "market" and abs(x["wp_delta_pts"]) > 0 for x in bd)
