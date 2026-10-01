# `bu.rapm` and `bu.lineup`: RAPM v2 and the lineup term (M2)

Design: DESIGN.md §3.2 (RAPM v2, priors, aging, eras, validation), §3.7 (TOI, lineups),
§4 (point-in-time protocol), §1.5 (season roles, holdout looks).  Everything runs from
`pipeline/`, reads the lake read-only and writes state to `<lake>/state/rapm` (gitignored,
override with `--out` / `PONYXG_RAPM_DIR`).  Only the small reports that back a model claim
and the per-game feature table are committed (`bu/rapm/out/`, `bu/lineup/out/`).

## Re-run on the full lake

```bash
cd pipeline
# 1. stints (+ xG re-score) for every built lake season; bios fetched once per season
python -m bu.rapm stints   --lake-dir ../data/lake
# 2. tuning + DESIGN §3.2.2 stint-level validation (burn-in = first lake season)
python -m bu.rapm validate --lake-dir ../data/lake --tune 2021,2022 --dev 2023,2024
# 3. daily point-in-time ratings with the tuned setting
python -m bu.rapm asof     --lake-dir ../data/lake
# 4. per-game lineup features, then the walk-forward inside the incumbent
python -m bu.lineup features --lake-dir ../data/lake
python -m bu.lineup evaluate --lake-dir ../data/lake --matrix /tmp/M.pkl   # dev folds only
python -m bu.lineup evaluate --lake-dir ../data/lake --holdout             # ONE 2025-26 look per config
```

Swap the RAPM target to xG v2 with `--xg <dir of parquet with game_id,event_id,xg>` on
`stints`/`validate`/`asof` (the stints cache is keyed on the xG source, so it rebuilds).

## Pipeline

| Step | Module | Notes |
|---|---|---|
| xG | `xg.py` | v1 = `xg_model_xgb.pkl` re-scored on lake shots with its own features (in-sample for 2022-26: a target, not a predictor); flurry adjustment `xg * prod(1 - xg_prev)` within 3 s same-team sequences |
| Stints | `stints.py` | boundaries = shift starts/ends + faceoffs + goals; shots/goals on `(start, end]`, faceoff zone opens the stint at `t`; goalies separate; all strengths kept (EV, PP/PK, EN) with counts; games whose shift charts disagree with `situationCode` on > 10% of shots are excluded from the regression (138 games of 2019-20) |
| Design | `design.py` | two rows per EV stint (5v5/4v4/3v3, both goalies in); O and D column per skater; covariates home, score (7), P3 lead/trail shell, zone start, 4v4/3v3, back-to-back; 2020-21 rows at weight 0.5 |
| Solver | `ridge.py` | generalized ridge `(X'WX + L) b = X'Wy + L b0`; exact Cholesky (~2,000 columns per season), exact posterior variances |
| Priors | `priors.py`, `aging.py` | Kalman-style chain: prior = last posterior + aging delta, variance `min(kappa^gap var_post + extra_age, v_new)`; rookies at the first-season mean of their position group x draft tier; aging = quadratic delta method on standalone season ratings with drop-outs imputed at replacement level; all fitted on seasons < S |
| Ratings | `asof.py` | one row per (game date, skater): games up to `d - 2 days` (shift REST lag); exact SDs weekly; `max_source_date` stored and asserted |
| Validation | `validate.py` | §3.2.2: 7 as-of dates per season, next-30-day weighted MSE of stint xG/60 vs team-only, no-prior RAPM, prior-only; hyper-parameters tuned on the tuning seasons only |
| TOI | `lineup/toi.py` | shrunk EWMA (half-life 8 games, 2 pseudo-games of slot prior), lag 2 days, F->3 / D->2 |
| Lineup term | `lineup/features.py` | team xGF60/xGA60 from tonight's dressed 18 (L-actual), net and baseline-relative delta, coverage gate 14/18 |
| Game level | `lineup/evaluate.py` | incumbent `train_game_model.walk_forward` with and without the lineup columns; dev folds pick the variant; one logged holdout look |

## Results

See `out/rapm_validation.json`, `../lineup/out/lineup_eval.json`, `../lineup/out/toi_validation.json`
and the commit messages for the numbers.
