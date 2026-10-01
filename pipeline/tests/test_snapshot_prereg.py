"""Pre-registration of the 2026-27 market tests (pipeline/bu/preregistration.yaml)
and its frozen analysis code (pipeline/bu/prereg_analysis.py).

* the YAML pins the analysis file by sha256 (editing the code without a dated
  amendment fails here);
* the YAML's numbers match the code's constants;
* the analysis recovers known effects from synthetic snapshot archives and
  applies the registered eligibility rules."""
import gzip
import io
import json
import math
import os
import re
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from bu import prereg_analysis as A

HERE = os.path.dirname(os.path.abspath(__file__))
PREREG = os.path.join(os.path.dirname(HERE), "bu", "preregistration.yaml")


# ── the registration itself ──────────────────────────────────────────────────

@pytest.fixture(scope="module")
def prereg_text():
    with open(PREREG, encoding="utf-8") as fh:
        return fh.read()


def test_analysis_code_hash_is_pinned(prereg_text):
    m = re.search(r"^\s*sha256:\s*([0-9a-f]{64})\s*$", prereg_text, re.M)
    assert m, "analysis_code.sha256 missing"
    pinned = m.group(1)
    amended = re.findall(r"^\s*new_analysis_sha256:\s*([0-9a-f]{64})\s*$", prereg_text, re.M)
    current = A.file_sha256()
    assert current == (amended[-1] if amended else pinned), (
        "pipeline/bu/prereg_analysis.py changed after registration: append a dated amendment "
        "(with new_analysis_sha256) to preregistration.yaml instead of editing silently")


def test_registration_names_every_required_part(prereg_text):
    for needle in ("registered_at:", "M-1", "M-2", "M-3", "Gate C", "Gate E", "min_n", "alpha",
                   "pipeline/bu/prereg_analysis.py", "pipeline/snapshots/", "D7", "No cap"):
        assert needle in prereg_text, needle
    ts = re.search(r'^registered_at:\s*"?([0-9TZ:\-]+)"?', prereg_text, re.M).group(1)
    assert datetime.fromisoformat(ts.replace("Z", "+00:00")) < datetime(2026, 10, 6, tzinfo=timezone.utc)


def test_yaml_numbers_match_the_code():
    yaml = pytest.importorskip("yaml")
    with open(PREREG, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    assert doc["analysis_code"]["path"] == "pipeline/bu/prereg_analysis.py"
    pr = doc["prices"]
    assert pr["close_max_lead_min"] == A.CLOSE_MAX_LEAD_MIN
    assert pr["q0_min_lead_min"] == A.Q0_MIN_LEAD_MIN
    assert pr["primary_book"] == A.PRIMARY_BOOK
    assert tuple(pr["source_priority"]) == A.SOURCE_PRIORITY
    assert tuple(pr["filters"]["overround_range"]) == A.OVERROUND_RANGE
    assert pr["filters"]["max_abs_q_move"] == A.MAX_Q_JUMP
    t = doc["tests"]
    assert t["M-1"]["min_n"] == A.M1_MIN_N and t["M-1"]["alpha"] == A.ALPHA_ONE_SIDED
    assert t["M-2"]["alpha"] == A.ALPHA_ONE_SIDED
    assert t["M-4"]["min_n"] == A.M4_MIN_BETS
    assert t["Gate C"]["min_n"] == A.GATE_C_MIN_N and t["Gate C"]["margin"] == A.NI_MARGIN
    assert t["Gate E"]["min_n"] == A.GATE_E_MIN_N and t["Gate E"]["max_gp"] == A.GATE_E_MAX_GP
    assert t["Gate E"]["margin"] == A.NI_MARGIN
    assert doc["inference"]["bootstrap"]["resamples"] == A.BOOTSTRAP_N
    assert doc["inference"]["bootstrap"]["seed"] == A.SEED
    for name, spec in t.items():
        assert spec["function"] in dir(A), name


# ── statistics helpers ───────────────────────────────────────────────────────

def test_devig_power_and_overround():
    assert A.devig_power(-110, -110) == pytest.approx(0.5)
    q = A.devig_power(-150, 130)
    assert 0.57 < q < 0.59
    assert A.overround(-110, -110) == pytest.approx(2 * 110 / 210 - 1)
    assert A.devig_power(None, 120) is None and A.american_to_prob(50) is None


def test_logistic_recovers_coefficients():
    rng = np.random.default_rng(1)
    x = rng.normal(size=(20000, 2))
    p = 1 / (1 + np.exp(-(0.2 + 0.8 * x[:, 0] - 0.5 * x[:, 1])))
    y = (rng.random(20000) < p).astype(float)
    b, se = A.logistic(x, y)
    assert b == pytest.approx([0.2, 0.8, -0.5], abs=0.06)
    assert all(s > 0 for s in se)


def test_paired_and_noninferiority():
    rng = np.random.default_rng(2)
    y = (rng.random(800) < 0.55).astype(float)
    p = np.clip(0.55 + rng.normal(0, 0.05, 800), 0.05, 0.95)
    same = A.noninferiority(y, p, p, min_n=400)
    assert same["binding"] and same["diff"]["mean"] == 0 and same["pass"] in (True, False)
    worse = A.noninferiority(y, np.full(800, 0.2), p, min_n=400)
    assert worse["pass"] is False
    small = A.noninferiority(y[:100], p[:100], p[:100], min_n=400)
    assert small["binding"] is False and small["pass"] is None


# ── synthetic archive → eligibility + M-1 ────────────────────────────────────

def _gz(rows):
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
        for r in rows:
            gz.write((json.dumps(r) + "\n").encode())
    return buf.getvalue()


def _ml(q, vig=0.045):
    """American moneylines with a proportional overround around fair prob q."""
    def am(r):
        return int(round(-100 * r / (1 - r))) if r >= 0.5 else int(round(100 * (1 - r) / r))
    return am(q * (1 + vig)), am((1 - q) * (1 + vig))


def synthetic_archive(tmp_path, n_games=480, beta=0.4, seed=3, source="nhl_partner"):
    rng = np.random.default_rng(seed)
    base = datetime(2026, 10, 3, 23, 0, tzinfo=timezone.utc)
    by_day, outcomes = {}, {}
    for i in range(n_games):
        gid = 2026020100 + i
        start = base + timedelta(days=i // 8, minutes=30 * (i % 3))
        gdate = (start - timedelta(hours=4)).date().isoformat()
        q0 = float(np.clip(rng.normal(0.55, 0.08), 0.2, 0.8))
        p0 = float(np.clip(q0 + rng.normal(0, 0.04), 0.1, 0.9))
        z = math.log(q0 / (1 - q0)) + beta * (math.log(p0 / (1 - p0)) - math.log(q0 / (1 - q0))) \
            + rng.normal(0, 0.03)
        qc = 1 / (1 + math.exp(-z))
        outcomes[gid] = int(rng.random() < qc)
        pub = {"model_version": "logit-elo-v5", "predicted_at": "2026-10-01T04:00:00Z",
               "home_model_pct": round(100 * p0, 3), "home_win_pct": round(100 * (0.2 * p0 + 0.8 * qc), 3),
               "blend_weight": 0.2, "home_gp": float(i // 16), "away_gp": float(i // 16),
               "bu_shadow_home_win_pct": round(100 * (0.2 * p0 + 0.8 * qc), 3)}
        for lead, q in ((540, q0), (300, (q0 + qc) / 2), (11, qc)):
            t = start - timedelta(minutes=lead)
            h, a = _ml(q)
            row = {"v": 1, "game_id": gid, "game_date": gdate, "season": "2026-27", "game_type": "02",
                   "start_utc": start.isoformat().replace("+00:00", "Z"),
                   "captured_at": t.isoformat().replace("+00:00", "Z"),
                   "prices": [{"book": "draftkings", "source": source, "fetched_at": t.isoformat().replace("+00:00", "Z"),
                               "home_ml": h, "away_ml": a},
                              {"book": "bovada", "source": "bovada", "fetched_at": t.isoformat().replace("+00:00", "Z"),
                               "home_ml": h - 5, "away_ml": a}],
                   "published": pub}
            by_day.setdefault(gdate, []).append(row)
    d = tmp_path / "2026-27"
    d.mkdir(parents=True)
    for day, rows in by_day.items():
        (d / f"{day}.jsonl.gz").write_bytes(_gz(rows))
    return outcomes


def test_m1_recovers_line_movement_and_binds_at_400(tmp_path):
    outcomes = synthetic_archive(tmp_path, beta=0.4)
    rows = A.load_snapshots(str(tmp_path))
    games, excl = A.market_games(rows, outcomes)
    assert len(games) == 480 and sum(excl.values()) == 0
    g0 = games[0]
    assert g0["q0_lead"] == pytest.approx(540) and g0["close_lead"] == pytest.approx(11)
    r = A.m1_line_movement(games)
    assert r["binding"] and r["n_used"] == 400 and r["n_available"] == 480
    assert r["beta"] == pytest.approx(0.4, abs=0.08) and r["pass"] is True
    assert r["lower95_one_sided_cluster_by_date"] is not None
    early = A.m1_line_movement(games[:150])
    assert early["binding"] is False and early["pass"] is None


def test_m1_null_effect_does_not_pass(tmp_path):
    outcomes = synthetic_archive(tmp_path, beta=0.0, seed=11)
    games, _ = A.market_games(A.load_snapshots(str(tmp_path)), outcomes)
    r = A.m1_line_movement(games)
    assert abs(r["beta"]) < 0.12 and r["binding"]


def test_season_end_tests_run_on_the_synthetic_archive(tmp_path):
    outcomes = synthetic_archive(tmp_path)
    games, _ =A.market_games(A.load_snapshots(str(tmp_path)), outcomes)
    m2, m3, m5, c = A.m2_unshrunk_weight(games), A.m3_blend_vs_close(games), A.m5_standalone(games), A.gate_c(games)
    assert m2["n"] == 480 and "b1_lower95_one_sided" in m2 and m2["pass"] in (True, False)
    assert m3["n"] == 480 and m3["pass"] in (True, False) and "bootstrap_ci95" in m3["diff"]
    assert m5["n"] == 480
    assert c["n"] == 400 and c["binding"] and c["diff"]["mean"] == pytest.approx(0, abs=1e-12)
    e = A.gate_e(games)       # all synthetic games are in October; min GP <= 15 for the first 256
    assert e["n"] == 256 and e["binding"]


def test_eligibility_rules(tmp_path):
    outcomes = synthetic_archive(tmp_path, n_games=24)
    rows = A.load_snapshots(str(tmp_path))
    by_gid = {}
    for r in rows:
        by_gid.setdefault(r["game_id"], []).append(r)
    ids = sorted(by_gid)
    # (a) no close: drop the T-11 capture of game 0
    rows = [r for r in rows if not (r["game_id"] == ids[0] and r["captured_at"] == max(x["captured_at"] for x in by_gid[ids[0]]))]
    # (b) published model computed after q0 -> excluded (information-set rule)
    for r in rows:
        if r["game_id"] == ids[1]:
            r["published"] = dict(r["published"], predicted_at="2030-01-01T00:00:00Z")
    # (c) a garbage close (live-looking price) -> price filter
    for r in rows:
        if r["game_id"] == ids[2] and r["captured_at"] == max(x["captured_at"] for x in by_gid[ids[2]]):
            r["prices"][0].update(home_ml=-2000, away_ml=1000)
    # (d) no outcome
    outcomes.pop(ids[3])
    # (e) DraftKings only via ESPN for game 4 -> still eligible through the source chain
    for r in rows:
        if r["game_id"] == ids[4]:
            r["prices"][0]["source"] = "espn"
    # (f) preseason game type is ignored entirely
    for r in rows:
        if r["game_id"] == ids[5]:
            r["game_type"] = "01"
    games, excl = A.market_games(rows, outcomes)
    got = {g["game_id"] for g in games}
    assert excl == {"no_q0_and_close_in_one_source": 1, "price_filter": 1, "no_published_model": 1, "no_outcome": 1}
    assert ids[4] in got and next(g for g in games if g["game_id"] == ids[4])["source"] == "espn"
    assert not ({ids[0], ids[1], ids[2], ids[3], ids[5]} & got)
    assert len(games) == 24 - 5


def test_m4_clv():
    bets = [{"price": 150, "q_close_side": 0.42}, {"price": -110, "q_close_side": 0.50}] * 80
    r = A.m4_clv(bets)
    assert r["n"] == 160 and r["binding"]
    assert r["mean_clv"] == pytest.approx(((2.5 * 0.42 - 1) + ((1 + 100 / 110) * 0.5 - 1)) / 2)
    assert A.m4_clv(bets[:10])["binding"] is False


def test_m4_joins_the_bet_ledger_to_closes(tmp_path):
    games = [{"game_id": 1, "q_close": 0.6}, {"game_id": 2, "q_close": 0.3}]
    ledger = {"seasons": {"2026-27": {"bets": [
        {"gameId": 1, "side": "home", "price": -120}, {"gameId": 2, "side": "away", "price": -150},
        {"gameId": 3, "side": "home", "price": 110}]}}}
    p = tmp_path / "ledger.json"
    p.write_text(json.dumps(ledger))
    bets = A.load_bets(str(p))
    r = A.m4_from_ledger(games, bets)
    assert r["n"] == 2
    assert r["mean_clv"] == pytest.approx(((1 + 100 / 120) * 0.6 - 1 + (1 + 100 / 150) * 0.7 - 1) / 2)
    assert A.load_bets(str(tmp_path / "missing.json")) == []


def test_run_on_an_empty_archive(tmp_path):
    res = A.run("M-1", root=str(tmp_path), outcomes_path=str(tmp_path / "none.csv"))
    assert res["eligible_games"] == 0 and res["results"]["M-1"]["status"] == "insufficient data"


def test_outcomes_from_gamestats(tmp_path):
    p = tmp_path / "gs.csv"
    p.write_text("game_id,home_away,result\n2026020001,Home,OTL\n2026020001,Away,OTW\n"
                 "2026020002,Home,SOW\n2026020003,Home,\n")
    assert A.load_outcomes(str(p)) == {2026020001: 0, 2026020002: 1}
