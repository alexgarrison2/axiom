"""RAPM v2: prior-informed generalized-ridge player ratings (DESIGN §3.2, M2).

Modules (run from ``pipeline/``: ``python -m bu.rapm --help``):

  paths     output layout (``<lake>/state/rapm`` by default; ``--out`` overrides)
  xg        per-shot xG for the lake's shots: the current model (xg_model_xgb.pkl, "v1")
            or any parquet with (game_id, event_id, xg) such as xG v2; flurry adjustment
  stints    lake shifts + events -> stints (constant on-ice sets) with xG/goals per side
  bio       birth date / position / draft slot per player (NHL stats REST, one call per season)
  design    stints -> two weighted regression rows per stint (attacking side), sparse X
  ridge     generalized ridge with a prior mean: running Gram accumulator + Cholesky solve
  aging     delta-method aging curves (O and D, forwards and defence) with drop-out imputation
  priors    summer roll-forward: last season's posterior + aging -> this season's prior
  asof      point-in-time ratings by date (no future data, availability lag)
  validate  DESIGN §3.2.2 stint-level next-30-day test vs team-only / no-prior / prior-only
  pack      season-start prior pack (chain + aging + rookie means) for a one-season seeded refit
"""
