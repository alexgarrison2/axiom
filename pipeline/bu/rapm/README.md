# `bu.rapm` and `bu.lineup`: RAPM v2 and the lineup term (M2)

Design: DESIGN.md §3.2 (RAPM v2, priors, aging, eras, validation), §3.7 (TOI, lineups),
§4 (point-in-time protocol), §1.5 (season roles, holdout looks).  Everything runs from
`pipeline/`, reads the lake read-only and writes state to `<lake>/state/rapm` (gitignored,
override with `--out` / `PONYXG_RAPM_DIR`).  Only the small reports that back a model claim
and the per-game feature table are committed (`bu/rapm/out/`, `bu/lineup/out/`).

**Shipped (2026-10-01, owner decision): RAPM v2 on the xG v2 target, as the lineup term of the
live game model** (`logit-elo-v5-20261001-xg2-rapm`: `bu_d_net + bu_d_delta` replace the F1
`d_lineup`; `pipeline/bu/README.md` "Live").  The xG v1-target results below are kept for the
record; their reports are archived in `out/xgv1/` and `../lineup/out/xgv1/`.

## Re-run on the full lake (xG v2 target, as shipped)

```bash
cd pipeline
L=../data/lake; O=<state dir>; X=<scratch>/xg_v2
# 0. the xG v2 target: one season=S.parquet per lake season from the bu.xg walk-forward state
#    (OOS xg2_asof; burn-in 2010-11 scored by the fold fit on it; 2026-27 by the live artifacts)
python -m bu.rapm.v2_source --lake-dir $L --state-dir <bu.xg walk-forward state> --out $X
# 1. stints (+ xG) for every built lake season; bios fetched once per season
python -m bu.rapm stints   --lake-dir $L --out $O --xg $X --seasons 2010-2026
# 2. tuning + DESIGN §3.2.2 stint-level validation (burn-in = first lake season)
python -m bu.rapm validate --lake-dir $L --out $O --xg $X --seasons 2010-2025 --tune 2021,2022 --dev 2023,2024
# 3. daily point-in-time ratings with the shipped setting (window prior, owner directive
#    2026-10-01; through the current season: its prior pack)
python -m bu.rapm asof     --lake-dir $L --out $O --xg $X --seasons 2010-2026 --hyper bu/rapm/out/rapm_validation_window.json
# 3b. finishing-talent season pack for the player ratings export
python -m bu.rapm.finishing pack --lake-dir $L --out $O --xg $X --season 20262027
# 4. per-game lineup features, then the walk-forward inside the incumbent
python -m bu.lineup features --lake-dir $L --out $O --seasons 2010-2026
python -m bu.lineup evaluate --lake-dir $L --out $O --matrix /tmp/M.pkl   # dev folds only
# 5. live path: season-start pack (committed, once per season from the full lake)
python -m bu.lineup pack --lake-dir $L --out $O --season 20262027
# 6. joint game-model retrain against the live model (xG v2 inputs + this term)
python3 retrain.py --joint --no-legacy [--promote]
```

## Live refresh (no historical lake needed; CI: `.github/workflows/bu_refresh.yml`)

```bash
cd pipeline
python -m bu.lineup.refresh --lake-dir <runner-local lake> [--dry-run]
# = python -m bu.lake.backfill --seasons 2026 --endpoints pbp,boxscore,shifts   (gap-driven)
#   python -m bu.rapm asof --seasons 2026 --seed bu/lineup/out/season_pack_20262027.json.gz --xg v2
#   python -m bu.lineup serve --season 20262027 --seed <pack>   -> publish when changed or > 12 h old
```

`--xg v2` scores the current season's lake shots with the live xG v2 artifacts
(`pipeline/models/xg2_*.json`, the training feature path), the same scores `v2_source` used for
2026-27 in the full chain: on the lake of 2026-10-01 the CI path (empty lake -> backfill of 8
games -> seeded refit) reproduced the full-chain 2026-27 ratings exactly (2,816 players, max
|diff| 0.0) in 16 s.

`asof --seed` refits the season from the pack's chain, aging curve and rookie means; on the
real lake it reproduces the full-chain 2025-26 ratings exactly (max |diff| 0.0, also tested on
synthetic data).  `serve` rolls the pack's TOI-share state and team lineup histories through the
season's games, attaches the current ratings and the NHL-id crosswalk for DailyFaceoff names.
In `predict_games` the integrator calls

```python
from bu.lineup.serve import LiveLineupTerm
term = LiveLineupTerm.load("bu/lineup/out/serving_bundle.json.gz")
f = term.features(home, away, team_lineups.get(home), team_lineups.get(away))
extra_features = {"bu_d_net": f["bu_d_net"], "bu_d_delta": f["bu_d_delta"]}   # 0 when not f["bu_ok"]
```

It never raises; `bu_ok` is False (neutral 0 features, `reason` set) when the bundle is older
than 36 h (DESIGN §3.2.2 `bu_state_freshness`), a team has < 10 mapped skaters or either side
has < 14 rated skaters: the same neutral policy as the walk-forward (`evaluate.attach`).  At
the first game of a season the live term equals the backtest feature row (parity test).
Players DFO marks out / IR / suspended are dropped; game-time decisions are counted as dressed
(DESIGN's 50/50 mix is not implemented).

The RAPM target is chosen with `--xg` on `stints`/`validate`/`asof`: `v1` (the pickle),
`v2` (the live xG v2 artifacts) or a directory of `season=S.parquet` with
`game_id,event_id,xg` (the stints cache is keyed on the source, so it rebuilds).

## Pipeline

| Step | Module | Notes |
|---|---|---|
| xG | `xg.py` | v1 = `xg_model_xgb.pkl` re-scored on lake shots with its own features (in-sample for 2022-26: a target, not a predictor); flurry adjustment `xg * prod(1 - xg_prev)` within 3 s same-team sequences |
| Stints | `stints.py` | boundaries = shift starts/ends + faceoffs + goals; shots/goals on `(start, end]`, faceoff zone opens the stint at `t`; goalies separate; all strengths kept (EV, PP/PK, EN) with counts; games whose shift charts disagree with `situationCode` on > 10% of shots are excluded from the regression (138 games of 2019-20) |
| Design | `design.py` | two rows per EV stint (5v5/4v4/3v3, both goalies in); O and D column per skater; covariates home, score (7), P3 lead/trail shell, zone start, 4v4/3v3, back-to-back; 2020-21 rows at weight 0.5 |
| Solver | `ridge.py` | generalized ridge `(X'WX + L) b = X'Wy + L b0`; exact Cholesky (~2,000 columns per season), exact posterior variances |
| Priors | `priors.py`, `aging.py`, `pack.py` | Kalman-style chain: prior = last posterior + aging delta (one step per season since last rated, indexed by the earlier age), variance `min(kappa^gap var_post + extra_age, v_new)`, precision `sigma2 / var` with `sigma2` per second (divided by the era weight after 2020-21); rookies at the first-season mean of their position group x draft tier; aging = quadratic delta method on standalone season ratings with drop-outs imputed at replacement level; all fitted on seasons < S; the season-start state is saved as a prior pack |
| Ratings | `asof.py` | one row per (game date, skater): games up to `d - 2 days` (shift REST lag); exact SDs weekly; `max_source_date` stored and asserted; per season also the prior of every carried player and the latest (all-games) fit |
| Validation | `validate.py` | §3.2.2: 7 as-of dates per season, next-30-day weighted MSE of stint xG/60 vs team-only, no-prior RAPM, prior-only; hyper-parameters tuned on the tuning seasons only |
| TOI | `lineup/toi.py` | shrunk EWMA (half-life 8 games, 2 pseudo-games of slot prior), lag 2 days, F->3 / D->2 |
| Lineup term | `lineup/features.py` | team xGF60/xGA60 from tonight's dressed 18 (L-actual), net and baseline-relative delta, coverage gate 14/18; a dressed skater without a rating takes his season prior |
| Crosswalk | `lineup/crosswalk.py` | NHL rosters (explicit season id) + lake rosterSpots -> ids for DFO names; `out/crosswalk_coverage.json` |
| Live | `lineup/serve.py` | season pack -> serving bundle -> `LiveLineupTerm` (above) |
| Game level | `lineup/evaluate.py` | incumbent `train_game_model.walk_forward` with and without the lineup columns; dev folds pick the variant; one logged holdout look |
| Finishing | `finishing.py` | FIN = shrunk EV goals above xG per 60 from the player's own unblocked shots: gamma-Poisson multiplier `(G + 60) / (X + 60)` on league-scaled xG, times shrunk ixG/60; all seasons equally weighted; point-in-time `FinState` (games up to `d - 2 days`); season-start state `../lineup/out/fin_pack_<S>.json.gz` (`python -m bu.rapm.finishing pack --season S --xg <source>`, once per season next to the lineup season pack) |

## OFF credibility pass (2026-10-01): prior dynamics and finishing

Owner smell test: Brendan Gallagher (23 pts, 1.6 SOG/GP in 2025-26) ranked 11th in OFF (+0.46),
above Cole Caufield (51 goals, +0.34).  Evidence in `out/diagnosis_off_fin.json`,
`out/rapm_validation_prior_dynamics.json`, `out/fin_validation.json` and
`../lineup/out/lineup_eval_rapm_fin.json`.

**Why Gallagher rates high.** He is a real 5v5 xG driver: raw on-ice EV xGF/60 relative to his
team +0.37 (2023-24) and +0.43 (2024-25), no-prior RAPM +0.28 / +0.36 in those seasons, and
MoneyPuck's 3-season 5on5 relative xGF/60 +0.59 (rank 20 of 564; Caufield +0.38).  2025-26 was
weak (rel -0.02, no-prior +0.19 on 14 EV hours), but his season-start prior (+0.52, SD 0.11,
worth 24 EV hours) outweighs it, so the 2025-26 posterior is +0.475 (+0.16 with his own prior
reset).  Linemate collinearity is not the cause (his linemates are average or weak OFF players);
Caufield's credit is split with Suzuki (17-22 shared EV hours a season).

**Prior dynamics: window prior shipped by owner directive** (`out/rapm_validation_window.json`).
The season-start prior is now a fresh ridge fit on the last three seasons' EV stints weighted
1 / 0.5 / 0.25 (S-4 and older: 0), each older season's rows moved forward by the players'
aging steps, ridged to the rookie / position means at `v_new 0.04` (picked on the tuning
seasons among 0.02-0.06), summarised per player as mean + posterior variance
(`priors.window_prior`, `Hyper(window="1,0.5,0.25")`); the in-season update is unchanged and
the season pack / seeded live refit reproduce the full chain exactly.  Cost and gain vs the
Kalman chain it replaces: game level neutral (dev folds, lineup term vs no lineup term on the
live base: -0.00167 vs -0.00153; window minus current -0.00014, SE 0.00037; the owner's ship
threshold was +0.0010), but the stint-level metrics are worse everywhere: next-30-day MSE
+0.016 (tuning, z 5.5), +0.015 (dev, z 5.5), +0.013 (2025-26, z 3.3); next-season MSE +0.026,
+0.024, +0.015 (z 8.6, 8.1, 3.6), and worse in every age bucket (<=24, 25-29, 30-32, 33+) and
prior-strength bucket.  The next-season on-ice bias of 33+ players' O (the prior over-rates
them by -0.024 xG/60 on 2021-26 rows) is only slightly smaller in window mode (-0.020).
Correlation with MoneyPuck's 3-season 5on5 relative xGF/60 rises from 0.790 to 0.804.
Gallagher OFF 0.457 -> 0.340 (11th -> 24th of roster skaters), McDavid 0.763 -> 0.552
(2nd -> 5th; NET 2nd -> 14th).

Before the directive, the Kalman chain's own dynamics were swept (kept for the record): a 180-point grid (`validate.prior_dynamics_grid`: additive
season drift `q_add`, `aging_scale`, `young_old_extra`, `v_new`, `kappa`) scored on the shipped
next-30-day stint MSE and on a new next-season metric (players fixed at the season-start prior,
`next|` models).  The tuning-season best (`q_add 0.001`) gains 0.0004 on the 30-day MSE (z -0.65)
but is worse on the next-season metric (tuning +0.0008, dev +0.0007, 2025-26 +0.0038, z 3.9)
and on the 2025-26 30-day MSE (+0.0021); the per-season stability check fails, so DESIGN §3.2
keeps the more regularised Kalman setting.  Stronger aging and wider age-tail variance are
worse everywhere.  The looser chain would move Gallagher *up* (+0.505), since his strong
2023-25 seasons then count for more.  At game level the looser candidate is -0.00017 (SE 0.00010)
vs current on the dev folds: too small to override the stint-level loss.

**Finishing (FIN).**  RAPM OFF is an xG impact by design, so it ignores finishing.  FIN is tuned
on held-out shot log loss (tuning seasons, one-SE rule: `PRIOR_XG 60`, no season decay) and
improves every season's shot LL vs xG alone (z -5.8, -4.4 tuning; -2.1, -2.8 dev; -2.6 2025-26).
Gallagher has the 5th-worst FIN of all skaters with 20+ EV hours (-0.145 goals/60), Caufield
the 11th best (+0.172).  `public/data/player_ratings.json` gains `fin` and `off_total = off + fin`
(existing fields unchanged; DEF keeps the v2 "xG prevented" sign): with the window prior
Gallagher 0.195 (93rd of roster skaters), Caufield 0.472 (14th).  Against MoneyPuck (goals
included: rel xGF/60 + GAx/60) the correlation rises from 0.725 (OFF) to 0.794 (OFF_total) on
the Kalman chain, 0.815 with the window prior.  Game level (dev folds, live features without
the lineup term as the base): adding the team FIN term `bu_d_fin` to `bu_d_net + bu_d_delta`
gives -0.00058 (SE 0.00040; 2023-24 -0.00067, 2024-25 -0.00048) on the Kalman ratings and
-0.00058 on the window ratings (window + FIN vs Kalman without: -0.00072), which passes the A2
dev rule, but it is **not wired into
the live game model yet**: that needs the FIN term in the serving bundle / `LiveLineupTerm`, a
joint retrain and the M3 component's holdout look (DESIGN §1.5), an owner decision.

`lineup features` and the serving bundle now read the stints cache whatever xG source built it
(`data.cached_stints`): with the old default `ensure_stints(paths, s)` (source `v1`) they rebuilt
the cache that `asof --xg v2` had just written, re-scoring every season with the v1 pickle.

## Results on the xG v2 target (as shipped; lake 2010-11 .. 2026-27, code m2-r3, 2026-10-01)

Target: walk-forward out-of-sample xG v2 (`xg2_asof`) for 2011-12 .. 2025-26, the 2011-12 fold's
season-start model for the 2010-11 burn-in, the live artifacts for 2026-27 (`v2_source`); 100%
of the lake's unblocked non-penalty-shot attempts covered in every season.

**Stint level** (`out/rapm_validation.json`): tuning 2021-22 + 2022-23 picks `v_new 0.02`,
`kappa 1.25` (v1 target: kappa 1.5, one grid step away).  Next-30-day weighted MSE of stint
xG/60, RAPM v2 minus baseline (z, game-clustered):

| Fold | vs team-only (a) | vs no-prior RAPM (b) | vs prior-only (c) |
|---|---|---|---|
| 2023-24 dev | -0.2044 (-16.7) | -0.0966 (-9.8) | -0.0324 (-6.8) |
| 2024-25 dev | -0.2291 (-15.6) | -0.1127 (-10.1) | -0.0399 (-7.1) |
| 2025-26 (report) | -0.1956 (-13.4) | -0.0959 (-8.7) | -0.0395 (-6.7) |

Gate PASS, and RAPM v2 beats all three baselines in all 15 seasons 2011-12 .. 2025-26.

**Game level** (`../lineup/out/lineup_eval.json`, dev folds only, no holdout look): Δ log loss
vs the live feature set (`d_lineup` included) on xG v2 inputs, per game:

| Variant | 2023-24 | 2024-25 | dev pooled (SE) |
|---|---|---|---|
| `bu_d_net` | +0.00045 | -0.00175 | -0.00057 (0.00052) |
| `bu_d_delta` | +0.00045 | -0.00163 | -0.00051 (0.00085) |
| `bu_d_net + bu_d_delta` on top of `d_lineup` | +0.00100 | -0.00289 | -0.00080 (0.00100); A2 fails (2023-24 > +0.0005) |
| `bu_d_net + bu_d_delta` **replacing** `d_lineup` | +0.00003 | -0.00285 | **-0.00130 (0.00105)** |

L-asof (previous game's 18): -0.00047 dev pooled.  The shipped configuration is "replacing"
(fixed by the v1-target review before this run, see below); its joint retrain against the live
model, 2023-24 .. 2025-26, is in `../lineup/out/joint_retrain.json` and `pipeline/bu/README.md`.

Descriptive, not used for selection: the same joint candidate with the **v1-target** feature
table scores better in the backtest (vs the live model, dev pooled -0.00214 vs -0.00147 for the
v2 target; 2025-26 -0.00317 vs -0.00180).  The v1 pickle is in sample for 2022-26 (fit on a
random 80/20 split of those seasons' shots, goals included), so a v1 target carries
information from later games of the same seasons into point-in-time ratings, and that edge
cannot carry over to live 2026-27 games.  The v2 target is strictly walk-forward and ships.

## Results (lake 2010-11 .. 2026-27, xG v1 target, code m2-r3, 2026-10-01; archived in out/xgv1/)

Era handling: 2020-21 rows at weight 0.5; the 2019-20 on-ice anomalies are handled by dropping
games whose shift charts disagree with `situationCode` on > 10% of shots (138 games; the kept
2019-20 games match on 99.7% of shots), and 2019-20 / 2020-21 get half weight in the aging fit.
Sensitivity (DESIGN §3.2.1): with 2019-21 left out entirely the tuning picks `v_new 0.03,
kappa 1.25`, within one grid step of the main pick, so the main run stands
(`out/xgv1/rapm_validation_excl_2019_2021.json`).

**Stint level (DESIGN §3.2.2, `out/xgv1/rapm_validation.json`).** Burn-in 2010-11; tuning 2021-22 +
2022-23 picks `v_new = 0.02`, `kappa = 1.5` (each tuning season alone: v0.03/k1.25 and
v0.02/k1.25, both within one grid step).  Next-30-day weighted MSE of stint xG/60, RAPM v2 minus
baseline (z, game-clustered):

| Fold | vs team-only (a) | vs no-prior RAPM (b) | vs prior-only (c) |
|---|---|---|---|
| 2023-24 dev | -0.2258 (-15.1) | -0.1057 (-9.3) | -0.0403 (-6.6) |
| 2024-25 dev | -0.2215 (-13.9) | -0.1064 (-9.0) | -0.0350 (-5.8) |
| 2025-26 (report) | -0.1919 (-12.3) | -0.0923 (-8.0) | -0.0391 (-5.8) |

Gate PASS; RAPM v2 beats all three in every one of the 15 seasons 2011-12 .. 2025-26.
Ablations at the selected setting (`ablations_at_selected`, MSE without minus with; + = the
component helps): aging curve +0.0036 (z 2.1) 2021-22, +0.0015 (0.9) 2022-23, -0.0007 (-0.5)
2023-24, +0.0018 (1.3) 2024-25, +0.0051 (3.1) 2025-26; rookie mean -0.0005 (-0.7), -0.0014
(-2.0), +0.0006 (1.1), +0.0016 (2.8), +0.0003 (0.6).  The rookie mean is mixed (it slightly hurts
the 2022-23 tuning season); both components are kept as designed.

**TOI shares** (`../lineup/out/toi_validation.json`): MAE 0.0323 vs 0.0403 for "last game's share".

**Game level, lineup term as a feature of the incumbent** (`../lineup/out/xgv1/lineup_eval.json`):
Δ log loss vs the `train_game_model` walk-forward on the same games (negative = better).
Candidate `bu_d_net + bu_d_delta`, chosen on the dev folds:

| Fold | n | Δ LL | SE | Calibration slope (95% CI) | Role |
|---|---|---|---|---|---|
| 2023-24 | 1,399 | -0.00032 | 0.00149 | 1.01 (0.79-1.22) | dev |
| 2024-25 | 1,206 | -0.00402 | 0.00118 | 1.15 (0.85-1.44) | dev |
| dev pooled | 2,605 | -0.00204 | 0.00097 | 1.06 (0.89-1.24) | A2 PASS |
| 2025-26 | 1,394 | -0.00254 | 0.00162 | 0.91 (0.64-1.17) | soft holdout, the single logged look (`look_log.jsonl`, code m2-r1) |

Early season (GP <= 15) on dev: -0.0034 (SE 0.0025; one-sided upper bound +0.0007 < +0.002, A4).
L-asof (previous game's 18): -0.00113 on dev.  Degraded shifts (35% of games +2 days,
`../lineup/out/xgv1/lineup_eval_degraded.json`): -0.00194, a 0.0001 loss (< the 0.0005 DESIGN §4.3 threshold).

The holdout A-comp test (one-sided 98.75% upper bound < +0.0005) did **not** pass on its single
look (+0.0011: favourable point estimate, underpowered).  The look was taken with code m2-r1;
the review fixes since (aging step, sigma2 guard and era scale, season-prior fallback) cannot be
re-looked at on 2025-26 (one look per component), so their holdout value is unknown.  Pooling
dev and the logged look: -0.0022 (SE ~0.0008, n 3,999).  **Owner decision (2026-10-01): ship on
this pooled evidence, keeping the old version in shadow for rollback; the 2026-27 live games are
the clean re-test.**

**Against the live F1 model** (`../lineup/out/xgv1/lineup_eval_vs_f1_main.json`, descriptive: main's
`train_game_model` with `d_lineup`, logit-elo-v5-20261001): adding the term on top of `d_lineup`
gives dev Δ -0.00137 (SE 0.00097; 2023-24 +0.00014, 2024-25 -0.00313; A2 passes, early-season
upper bound +0.0029 fails A4), while **replacing `d_lineup` with it gives -0.00183**
(2023-24 -0.00072, 2024-25 -0.00312).  Recommendation for the joint retrain: replace `d_lineup`
with `bu_d_net + bu_d_delta`, and keep F1 in shadow.
