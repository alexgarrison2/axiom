"""Lineup term: TOI allocation x RAPM v2 -> team lineup-adjusted xG rates (DESIGN §3.7, M2).

  toi       point-in-time expected EV TOI shares (shrunk EWMA + slot prior), MAE validation
  features  per-game point-in-time feature table (L-actual lineups), all lake seasons
  evaluate  walk-forward Δ log loss as a feature of the incumbent (dev folds; one holdout look)

CLI: ``python -m bu.lineup features|evaluate`` from ``pipeline/``.
"""
