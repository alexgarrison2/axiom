"""validate_outputs 'reports' / 'graded' / 'fair_odds' / 'goal_splits' checks (fix1-G1)."""
import json

import pandas as pd

import validate_outputs as V

HIST = [
    {'gameId': 2026020003, 'season': '2026-27', 'retro': False, 'startUtc': '2026-09-30T00:00:00Z'},
    {'gameId': 2026020005, 'season': '2026-27', 'retro': False, 'startUtc': '2026-09-30T02:30:00Z'},
]
META = {'graded_changed_at': '2026-09-30T12:42:00Z',
        'not_graded': [{'gameId': 2026020001, 'reason': 'snapshot_after_start'}]}


def _ctx(tmp_path, report_at='2026-09-30T12:50:00Z', ledger_at='2026-09-30T12:50:00Z', n=2,
         result='win', meta=META):
    files = {
        'history_file': HIST,
        'history_meta_file': meta,
        'report_file': {'generated_at': report_at, 'current_season': '2026-27',
                        'seasons': {'2026-27': {'all': {'n': n}}}},
        'ledger_file': {'generated_at': ledger_at, 'seasons': {'2026-27': {'bets': [
            {'gameId': 2026020005, 'team': 'Golden Knights', 'result': result}]}}},
    }
    ctx = {}
    for k, v in files.items():
        p = tmp_path / f'{k}.json'
        p.write_text(json.dumps(v))
        ctx[k] = str(p)
    return ctx


def test_reports_pass_when_rebuilt_after_history(tmp_path):
    assert V.check_reports(_ctx(tmp_path)) == []


def test_reports_fail_when_aged(tmp_path):
    errs = V.check_reports(_ctx(tmp_path, report_at='2026-09-30T04:48:00Z'))
    assert any('model_report.json' in e and 'older' in e for e in errs)
    errs = V.check_reports(_ctx(tmp_path, ledger_at='2026-09-30T04:40:00Z'))
    assert any('bet_ledger.json' in e and 'older' in e for e in errs)


def test_reports_fall_back_to_start_times_without_meta(tmp_path):
    errs = V.check_reports(_ctx(tmp_path, report_at='2026-09-30T04:00:00Z', meta={}))
    assert any('older' in e for e in errs)


def test_reports_fail_on_count_mismatch_and_pending(tmp_path):
    assert any('all.n = 0' in e for e in V.check_reports(_ctx(tmp_path, n=0)))
    assert any('pending' in e for e in V.check_reports(_ctx(tmp_path, result='pending')))


def test_graded_requires_grade_or_reason(tmp_path):
    ctx = _ctx(tmp_path)
    ctx['gamestats'] = pd.DataFrame({'game_id': [2026020001, 2026020003, 2026020005, 2026020002]})
    ctx['site_history'] = pd.DataFrame()
    errs = V.check_graded(ctx)
    assert errs == ['2026020002: final but neither graded nor listed in prediction_history_meta.not_graded']


def test_goal_splits(tmp_path):
    ok = pd.DataFrame({'game_id': [1, 2], 'team': ['A', 'B'], 'goals_for': [3, 2], 'goals_ev': [1, 1],
                       'goals_pp': [1, 0], 'goals_sh': [0, 0], 'en_goals': [1, 0], 'result': ['W', 'SOW']})
    assert V.check_gamestats_goals({'gamestats': ok}) == []
    bad = ok.assign(goals_ev=[0, 0])
    assert len(V.check_gamestats_goals({'gamestats': bad})) == 2
