"""C8: model_report.json and bet_ledger.json - content checks and JSON Schemas.

The schemas live in tests/schemas/ so validate_outputs.py (B11) can load the
same files.  ``validate`` below implements the subset of JSON Schema they use
(type, required, properties, additionalProperties, items, enum, minimum,
maximum, exclusiveMinimum, minItems, maxItems, minProperties, pattern, $ref)
so the check runs without the jsonschema package.
"""
import json
import os
import re

import pytest

import model_report as MR

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCHEMA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'schemas')
REPORT = os.path.join(ROOT, 'public', 'data', 'model_report.json')
LEDGER = os.path.join(ROOT, 'public', 'data', 'bet_ledger.json')

_TYPES = {'object': dict, 'array': list, 'string': str, 'boolean': bool, 'null': type(None)}


def _is_type(v, t):
    if t == 'integer':
        return isinstance(v, int) and not isinstance(v, bool)
    if t == 'number':
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    return isinstance(v, _TYPES[t])


def validate(v, schema, root=None, path='$'):
    """Return a list of error strings (empty when valid)."""
    root = root or schema
    if '$ref' in schema:
        node = root
        for part in schema['$ref'].lstrip('#/').split('/'):
            node = node[part]
        return validate(v, node, root, path)
    errs = []
    t = schema.get('type')
    if t is not None:
        ts = t if isinstance(t, list) else [t]
        if not any(_is_type(v, x) for x in ts):
            return [f"{path}: expected {t}, got {type(v).__name__}"]
    if 'enum' in schema and v not in schema['enum']:
        errs.append(f"{path}: {v!r} not in {schema['enum']}")
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if 'minimum' in schema and v < schema['minimum']:
            errs.append(f"{path}: {v} < {schema['minimum']}")
        if 'maximum' in schema and v > schema['maximum']:
            errs.append(f"{path}: {v} > {schema['maximum']}")
        if 'exclusiveMinimum' in schema and v <= schema['exclusiveMinimum']:
            errs.append(f"{path}: {v} <= {schema['exclusiveMinimum']}")
    if isinstance(v, str) and 'pattern' in schema and not re.search(schema['pattern'], v):
        errs.append(f"{path}: {v!r} !~ {schema['pattern']}")
    if isinstance(v, dict):
        for k in schema.get('required', []):
            if k not in v:
                errs.append(f"{path}: missing '{k}'")
        if len(v) < schema.get('minProperties', 0):
            errs.append(f"{path}: fewer than {schema['minProperties']} properties")
        props = schema.get('properties', {})
        for k, sub in v.items():
            if k in props:
                errs += validate(sub, props[k], root, f"{path}.{k}")
            elif isinstance(schema.get('additionalProperties'), dict):
                errs += validate(sub, schema['additionalProperties'], root, f"{path}.{k}")
    if isinstance(v, list):
        if len(v) < schema.get('minItems', 0):
            errs.append(f"{path}: fewer than {schema['minItems']} items")
        if 'maxItems' in schema and len(v) > schema['maxItems']:
            errs.append(f"{path}: more than {schema['maxItems']} items")
        if 'items' in schema:
            for i, x in enumerate(v):
                errs += validate(x, schema['items'], root, f"{path}[{i}]")
    return errs


def _load(p):
    with open(p) as f:
        return json.load(f)


@pytest.fixture(scope='module')
def report():
    return _load(REPORT)


@pytest.fixture(scope='module')
def ledger():
    return _load(LEDGER)


def test_validator_catches_errors():
    s = {'type': 'object', 'required': ['a'], 'properties': {'a': {'type': 'integer', 'minimum': 0}}}
    assert validate({'a': 1}, s) == []
    assert validate({}, s) and validate({'a': -1}, s) and validate({'a': 'x'}, s)


def test_model_report_matches_schema(report):
    errs = validate(report, _load(os.path.join(SCHEMA_DIR, 'model_report.schema.json')))
    assert errs == [], errs[:10]


def test_bet_ledger_matches_schema(ledger):
    errs = validate(ledger, _load(os.path.join(SCHEMA_DIR, 'bet_ledger.schema.json')))
    assert errs == [], errs[:10]


def test_2025_26_block_is_live_only_with_baselines(report):
    a = report['seasons']['2025-26']['all']
    assert a['n'] >= 400 and a['n_retro_excluded'] > 0
    for k in ('log_loss', 'brier', 'accuracy'):
        assert a['baselines']['home_rate'][k] is not None
        assert a['baselines']['market'][k] is not None
    assert a['baselines']['market']['n'] >= 400
    assert len(a['reliability']) == 10 and len(a['tiers']) == 4
    assert a['rolling'] and len(a['best_calls']) == 5 and len(a['worst_misses']) == 5


def test_current_season_block_supports_empty_state():
    """Opening night: no graded 2026-27 game yet -> a valid block with n = 0."""
    rep = MR.round_floats(MR.build_report(history=[]))
    b = rep['seasons'][rep['current_season']]['all']
    assert b['n'] == 0 and b['log_loss'] is None and b['reliability'] == []
    errs = validate(rep, _load(os.path.join(SCHEMA_DIR, 'model_report.schema.json')))
    assert errs == [], errs[:10]


def test_gate_reason_is_published(report):
    g = report['gate']
    assert isinstance(g['open'], bool) and g['reason']
    if not g['open']:
        assert g['reasons']


def test_ledger_join_rate(ledger):
    j = ledger['join']
    assert j['bets_on_finished_games'] >= 200
    assert j['join_rate'] >= 0.98
