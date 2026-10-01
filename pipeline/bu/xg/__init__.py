"""xG v2: the unblocked-shot model of the bottom-up model (DESIGN §3.1, milestone M1).

Modules:
  features     lake ``events`` -> one row per unblocked shot with every v2 feature
  handedness   shooter handedness map (NHL team rosters, MoneyPuck fallback)
  rink         per-arena distance CDF matching (Schuckers-Curro), fit on seasons < S
  model        XGBoost + per-strength isotonic calibrators + empty-net logistic, all JSON
  v1           the incumbent (``xg_model_xgb.pkl``) features, and its point-in-time retrain
  moneypuck    MoneyPuck shot files as a benchmark (D3: allowed, credit required)
  walkforward  season walk-forward training + the M1 report (``bu/xg/out``)
  live         scoring of live PBP payloads for the pipeline (``PONYXG_XG=v2``)

Run from ``pipeline/``:  ``python -m bu.xg.walkforward --help``.
"""
