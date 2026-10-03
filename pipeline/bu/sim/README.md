# `bu.sim`: game-state simulator (M5)

A Monte Carlo of each game, built bottom up: who is dressed and who starts in net set each
team's rates in every skater / goalie state, and 20,000 simulated games give the probability of
every market we have a price for (moneyline, regulation 3-way, puck line +-1.5, the game total
including pushes on whole lines, the 1st-period 3-way and 2-way markets).  Since 2026-10-03 the
simulator is also the **engine of the model win %**: `home_model_win_pct` is its own raw win %
(player ratings -> tonight's lineup -> simulated game), blended with the de-vigged market exactly
as before (`market.py`), and the derivative markets are anchored to that published win % (see
"Win-% engine").  The logit game model is kept as a logged shadow (`logit_*`) and per-game
fallback; `PONYXG_WINPCT=logit` rolls back.  Since 2026-10-03 (later the same day) its player
ratings are **ratings v4** (`bu/rapm/README.md` "Ratings v4") instead of RAPM v2 (see "Lineup
inputs: ratings v4"); `PONYXG_SIM_INPUTS=v2` rolls the inputs back.  Two further pre-registered
questions (2026-10-03, "Player special teams and penalties", "Season projections on the
simulator") were scored on dev and did not pass their rules; both paths are built and opt-in
(`PONYXG_SIM_INPUTS=st`, `PONYXG_SEASON_SIM=sim`).  A calibrated version of the season path
("Calibrated season projections", `prereg_season_calib.json`) chose no calibration on its tuning
seasons, passed dev and missed the holdout playoff log-loss margin by 0.0009: still opt-in.

Everything runs from `pipeline/`.  Pre-declared rules: `prereg.json` (written before any dev or
holdout run, amendments timestamped).  Fitted parameters: `out/sim_params.json`.  Validation
report: `out/validation.json`; holdout look log: `out/look_log.jsonl`.

## Model

**Engine** (`engine.py`, vectorised numpy, continuous time).  State per simulation: clock, score,
each team's penalty slots (two releasable minors, one of which may be a double minor; one
non-releasable slot for majors and coincidental minors), each team's pulled-goalie window and the
time of the last goal.  Between events every hazard is constant, so each round draws one
exponential waiting time per simulation and either resolves an event (home goal, away goal,
home penalty, away penalty, coincidental minors) or jumps to the next scheduled change (period
end, a penalty expiring, a goalie pulled / returning, a score-effect segment boundary, the end of
a post-goal lull).  Deterministic: seed = SHA-256 of (base seed, NHL game id), so a game's
numbers do not depend on the rest of the slate.

Goal hazard of attacking team X in state (own skaters, opposing skaters, own goalie, opposing
goalie), with r[state] the league goal rate of the state relative to 5v5 (fitted):

| State | Hazard |
|---|---|
| 5v5 / 4v4 / 3v3 | L5 x r x E_X x C_X x se[segment, score from X's view] |
| power play (5v4, 5v3, 4v3) | L5 x r x P_X x C_X x Lpp / (L5 x r[5v4]) |
| shorthanded | L5 x r x C_X |
| extra attacker (X pulled) | L5 x r x E_X x C_X |
| empty net (Y pulled) | L5 x r |
| 3v3 OT (regular season) | L5 x r_ot x E_X x C_X |

times the post-goal lull (all goal hazards x m for 10 s and 10-30 s after any goal), the game's
strength tilt shock exp(+-e) (e ~ N(0, sd), opposite signs for the two teams), the pace shock
(Gamma; fitted shape) and the anchoring tilt / pace.  Penalties: X takes power-play-creating calls
at Lpen x Q_X x pen_score[score] x pen_period[period] x pen_state (5v5 or not), split
minor / double / major; coincidental minors at 5v5 make 4v4 for two minutes.  A power-play goal
ends the shorthanded team's shortest minor (a double minor's first half).  Pulled goalies: the
trailing team in the 3rd period has its goalie out while the seconds left lie inside the window
where the fitted pull curve of its deficit (1, 2, 3+) exceeds the simulation's own uniform draw
(comonotone, so the pulled time matches the league curve exactly).  Regular-season ties play 5
minutes of sudden-death 3v3 (a penalty adds a skater to the other side), then a shootout won by
the home team with the league rate; playoff ties play 20-minute 5v5 sudden-death periods.

**Rates** (`rates.py`, `state.py`, `history.py`): per attacking side, four Poisson regressions on
point-in-time inputs (fitted on the fit seasons, `fit.py glm`):

* `ev`: 5v5 xG per score-adjusted second ~ lineup ratings term (ratings v4 since 2026-10-03,
  RAPM v2 before; tonight's dressed skaters x
  expected EV TOI share: `log((c0 + OFF_X + DEF_Y) / c0)`), team 5v5 offence / opponent defence
  state, home, back-to-back (own / opponent);
* `conv`: goals per xG ~ FIN of the dressed skaters (share-weighted goals above xG / 60, as a
  fraction of their xGF / 60), team finishing state, the opposing starter's goals-per-xG state;
* `pp`: power-play xG per PP second ~ team PP state, opponent PK state, home;
* `pen`: calls taken per second ~ team calls-taken state, opponent calls-drawn state, home.

The team / goalie state is a set of exponentially decayed sums (half-life in team games, season
carry), shrunk toward the league by pseudo-exposure, tuned on the fit seasons by next-game
Poisson likelihood.  League levels (L5, Lpp, Lpen) are decayed the same way, so the simulator
follows the scoring environment.  Every input is as of the game date: the lineup term and FIN are
the committed point-in-time table of the parameters' lineup source (`lineup_source.py`; v4:
`bu/lineup/out/lineup_features_v4.csv.gz`, RAPM v2: `lineup_features_v2.csv.gz`, ratings as of
d - 2 days); live they come from the serving bundle (`LiveLineupTerm`: v4 reads its `v4` table
and intercept `meta.intercept`, v2 its `players` / `fin` tables and the RAPM covariate).  A strength
stretch s multiplies every team-strength term (fitted on the fit seasons' outcomes, see below).

**Live path** (`live.py`, `predict_games.sim_outputs`): the season-start pack
(`out/sim_state_<season>.json.gz`, built from the lake by `python -m bu.sim.fit pack`) is rolled
forward through this season's games from the pipeline's own CSVs (gamestats + the shots file's
`xg_raw`), so the hourly run needs no lake.  Fallback: when the lineup term is unusable for a game
(bundle stale, coverage gate), the pack or the parameters are missing, or an input is not finite,
the row's markets come from `goal_model`'s independent Poisson anchored to the same published
win % and total, flagged `sim_status = poisson_fallback`; nothing is zero-filled.

## Anchoring

`anchor.py`: the anchored game multiplies every goal hazard by pace x exp(+-tilt / 2); the pair
(tilt, pace) that makes P(home win) and E[total] equal the published win % and expected total is
found by nested bisection.  Each evaluation reweights the same simulations with exact likelihood
ratios (every goal hazard scaled by a constant: weight = a^N_h b^N_a exp(-(a - 1) Lambda_h -
(b - 1) Lambda_a), with the integrated hazards Lambda recorded by the engine), so the solve takes
~40 ms; when the effective sample size falls under 25% the game is re-simulated at the solution.
Tests: targets hit within 0.002.

## Fitting and validation

```bash
cd pipeline
export PONYXG_RAPM_DIR=<RAPM v2 state with the xG v2 stints>   # python -m bu.rapm stints --xg ...
W=<scratch dir>
python -m bu.sim.fit all --work $W            # structural, team games, state hyper, regressions, pack
python -m bu.sim.validate dispersion --work $W --n 2000
python -m bu.sim.validate dev --work $W       # rest rule, anchoring rule
python -m bu.sim.validate holdout --work $W   # the single 2025-26 look (refused a second time)
```

Season rollover: `python -m bu.sim.fit pack --work $W --season <S>` from the full lake before the
season's first game (until then every row is the Poisson fallback, flagged).

## Fitted parameters (fit seasons 2017-18 .. 2022-23; RAPM v2 inputs, now `out/sim_params_v2.json`)

The live parameters (`out/sim_params.json`, `sim-m5-v4-...`) share every structural and state
table below; their rate regressions and dispersion are re-fitted on ratings v4 inputs (see
"Lineup inputs: ratings v4").

**State goal rates** relative to 5v5 (both goalies in; league 5v5 2.48 goals per team-hour):
4v4 1.19, 3v3 1.16, 5v4 2.82, 5v3 7.42, 4v3 4.38, 4v5 0.38, 3v5 0.11, extra attacker 6v5 2.92 /
6v4 4.83, shooting at an empty net 5v6 7.12 / 4v6 5.14; 3v3 OT 2.46, 4v3 OT 5.28 (rare states
shrunk with 2 h of pseudo-exposure toward their class).

**Score effects** (5v5 xG multiplier, team-season adjusted, by segment x score from the attacking
team's view, -3..+3): P1 0.91 0.98 0.96 **0.96** 0.92 0.93 0.86; P2 1.13 1.11 1.15 **1.09** 1.10
1.06 1.05; P3 0-10 min 1.03 1.08 1.04 **1.00** 0.96 0.95 0.91; P3 10-18 min 0.98 1.03 1.00 **0.87**
0.82 0.91 0.87; P3 last 2 min 0.88 0.62 0.52 **0.75** 0.89 0.65 0.69 (trailing teams with their
goalie still in during the last two minutes are mostly about to pull it).

**Pulled goalie** (P(goalie out) by seconds left, 10-s bins from the end): down 1: 0.96 at the
end, 0.60 at 90-100 s, 0.06 at 150 s, 0 beyond 210 s; down 2: 0.54 at the end, peak 0.77 at 70 s,
0.49 at 150 s; down 3+: <= 0.08.  **Post-goal lull**: goal hazards x0.17 for 10 s and x0.79 for
the next 20 s after any goal.  **Penalties**: 2.92 power-play-creating calls per team-60, x1.10 /
x1.19 when the taking team leads by 1 / 2+, x0.92-0.93 when trailing; period x0.98 / 1.16 / 0.86;
non-5v5 states x1.14; 98.6% minors, 1.1% double minors, 0.3% majors; coincidental 4v4 0.29 per
5v5 game-hour; OT x0.65.  Shootout: home wins 50.4%.

**State** (decayed sums): half-life 30 team games, season carry 0.7; goalies half-life 30, carry
1.0; shrinkage 20,000 s (5v5), 8,000 s (PP / PK), 80,000 s (penalties), 200 xG (finishing),
100 xG (goalie).

**Rate regressions** (coefficient, SE): 5v5 xG: RAPM lineup term 0.68 (0.05), team offence 0.38
(0.06), opponent defence 0.35 (0.06), home +0.070, back-to-back -0.039, opponent b2b +0.044;
conversion: FIN 0.94 (0.23), team finishing 0.75 (0.19), opposing goalie 0.85 (0.11); PP: 1.18 /
PK 0.91, home +0.075; penalties: taken 1.07 / drawn 0.92, home -0.083.

**Dispersion grid** (fit seasons, 2,000 runs a game, criterion of `prereg.json`): stretch 1.25,
strength-tilt sd 0.10, no pace shock, scale 1.018 (best criterion -5.9875; stretch 1.0 / no
shocks -5.9951; every pace shock was worse: it inflates total variance, which is already above
the actual).

## Validation

No historical prices exist for the derivative markets (SiteHistory carries the total line only
from 2026-09-30; 2026-27 closes are archived from now on by `odds_close.yml` / `pipeline/snapshots`,
with the 1st-period 3-way added), so the comparisons below are against actual outcomes and the
naive baseline: `goal_model`'s independent Poisson with the same win % and expected total.  The
anchoring target is the live game model's walk-forward probability (folds trained on earlier
seasons; history has no market to blend with) and `goal_model.expected_total`.  Log loss /
Brier per game; differences are paired per game (negative = simulator better); 20,000 runs a game.

**Pre-declared rules on the dev seasons** (2,375 games: 1,312 of 2023-24, 1,063 of 2024-25 with a
walk-forward target and finite inputs):
* rest: ML + derivative score 6.98808 with the back-to-back terms, 6.99308 without -> **kept**
  (ML -0.0016, SE 0.0007; derivative -0.0035, SE 0.0022).
* anchoring: derivative score raw 6.32928, anchored 6.32802 -> **anchored** (published).
  Anchor solve: max |P err| 1.4e-6, max |total err| 1.6e-5, mean ESS 97%, no re-simulation.

Derivative score (sum of the eight derivative markets' mean log loss), simulator minus Poisson:

| Season | n | anchored sim | Poisson (game model) | diff (SE) | raw sim | Poisson (sim's own % / total) | diff (SE) |
|---|---|---|---|---|---|---|---|
| 2023-24 dev | 1,312 | 6.3176 | 6.3308 | **-0.0132 (0.0037)** | 6.3252 | 6.3375 | -0.0123 (0.0037) |
| 2024-25 dev | 1,063 | 6.3409 | 6.3528 | **-0.0120 (0.0042)** | 6.3344 | 6.3441 | -0.0098 (0.0043) |
| dev pooled | 2,375 | 6.3280 | 6.3406 | **-0.0127 (0.0028)** | 6.3293 | 6.3404 | -0.0112 (0.0028) |
| 2025-26 holdout | 1,312 | 6.3509 | 6.3742 | **-0.0233 (0.0040)** | 6.3256 | 6.3477 | -0.0221 (0.0041) |

Per market (log loss / Brier), dev pooled:

| Market | sim anchored | Poisson (game model) | anchored - Poisson (SE) | sim raw | raw - Poisson own (SE) |
|---|---|---|---|---|---|
| moneyline | 0.6594 / 0.2339 | 0.6594 / 0.2339 | +0.0000 (0.0000) | 0.6588 / 0.2334 | -0.0000 (0.0000) |
| regulation 3-way | 1.0249 / 0.6164 | 1.0319 / 0.6193 | -0.0070 (0.0028) | 1.0243 / 0.6159 | -0.0069 (0.0028) |
| home -1.5 | 0.6276 / 0.2186 | 0.6316 / 0.2202 | -0.0040 (0.0009) | 0.6267 / 0.2185 | -0.0030 (0.0009) |
| away -1.5 | 0.5603 / 0.1882 | 0.5608 / 0.1884 | -0.0005 (0.0010) | 0.5606 / 0.1883 | -0.0023 (0.0009) |
| over 5.5 | 0.6863 / 0.2466 | 0.6861 / 0.2465 | +0.0002 (0.0003) | 0.6876 / 0.2472 | +0.0009 (0.0004) |
| total 6.0 (3-class) | 0.9682 / 0.5930 | 0.9677 / 0.5927 | +0.0005 (0.0004) | 0.9698 / 0.5941 | +0.0012 (0.0004) |
| over 6.0 given no push | 0.6899 / 0.2483 | 0.6897 / 0.2483 | +0.0002 (0.0003) | 0.6913 / 0.2490 | +0.0009 (0.0004) |
| over 6.5 | 0.6816 / 0.2442 | 0.6814 / 0.2442 | +0.0001 (0.0002) | 0.6828 / 0.2448 | +0.0007 (0.0003) |
| 1st period 3-way | 1.0938 / 0.6635 | 1.0959 / 0.6651 | -0.0022 (0.0010) | 1.0929 / 0.6630 | -0.0019 (0.0010) |
| 1st period 2-way (ties refunded) | 0.6854 / 0.2461 | 0.6852 / 0.2460 | +0.0003 (0.0002) | 0.6847 / 0.2457 | +0.0003 (0.0002) |

Holdout 2025-26 (the single look, `out/look_log.jsonl`):

| Market | sim anchored | Poisson (game model) | anchored - Poisson (SE) | sim raw | raw - Poisson own (SE) |
|---|---|---|---|---|---|
| moneyline | 0.6792 / 0.2432 | 0.6792 / 0.2432 | +0.0000 (0.0000) | 0.6793 / 0.2432 | -0.0000 (0.0000) |
| regulation 3-way | 1.0639 / 0.6424 | 1.0849 / 0.6521 | -0.0210 (0.0041) | 1.0624 / 0.6412 | -0.0206 (0.0041) |
| home -1.5 | 0.5919 / 0.2021 | 0.5906 / 0.2015 | +0.0014 (0.0011) | 0.5923 / 0.2022 | +0.0011 (0.0011) |
| away -1.5 | 0.5702 / 0.1917 | 0.5722 / 0.1923 | -0.0020 (0.0013) | 0.5683 / 0.1910 | -0.0023 (0.0012) |
| over 5.5 | 0.6838 / 0.2454 | 0.6830 / 0.2450 | +0.0008 (0.0004) | 0.6780 / 0.2426 | +0.0011 (0.0005) |
| total 6.0 (3-class) | 0.9560 / 0.5886 | 0.9556 / 0.5880 | +0.0004 (0.0005) | 0.9498 / 0.5831 | +0.0008 (0.0006) |
| over 6.0 given no push | 0.6939 / 0.2504 | 0.6930 / 0.2499 | +0.0009 (0.0004) | 0.6873 / 0.2471 | +0.0013 (0.0005) |
| over 6.5 | 0.6927 / 0.2497 | 0.6922 / 0.2495 | +0.0005 (0.0003) | 0.6875 / 0.2471 | +0.0008 (0.0004) |
| 1st period 3-way | 1.0993 / 0.6672 | 1.1027 / 0.6696 | -0.0034 (0.0014) | 1.0975 / 0.6659 | -0.0031 (0.0014) |
| 1st period 2-way (ties refunded) | 0.6931 / 0.2497 | 0.6930 / 0.2496 | +0.0001 (0.0003) | 0.6898 / 0.2482 | +0.0001 (0.0003) |

Reliability (logistic recalibration slope / intercept of the outcome on logit p; 1 / 0 = calibrated;
10-bin tables in `out/validation.json`):

| Market | dev anchored | dev Poisson | holdout anchored | holdout Poisson | holdout raw |
|---|---|---|---|---|---|
| moneyline | 1.02 / +0.13 | 1.02 / +0.13 | 0.77 / -0.04 | 0.77 / -0.04 | 0.84 / -0.05 |
| home -1.5 | 0.92 / +0.12 | 0.89 / +0.18 | 1.04 / -0.08 | 1.01 / -0.01 | 1.18 / +0.04 |
| away -1.5 | 0.96 / -0.07 | 0.93 / -0.00 | 0.75 / -0.20 | 0.73 / -0.15 | 0.91 / -0.03 |
| over 5.5 | 0.80 / +0.05 | 0.87 / +0.01 | 0.55 / +0.20 | 0.56 / +0.18 | 0.93 / +0.17 |
| over 6.0 given no push | 0.87 / -0.00 | 0.94 / -0.03 | 0.59 / +0.12 | 0.60 / +0.10 | 0.89 / +0.17 |
| over 6.5 | 0.91 / -0.03 | 0.99 / -0.03 | 0.64 / +0.04 | 0.64 / +0.03 | 0.90 / +0.14 |
| 1st period 2-way (ties refunded) | 0.67 / +0.08 | 0.68 / +0.08 | 0.50 / -0.01 | 0.51 / -0.01 | 0.65 / -0.03 |

Distribution checks (simulated means over games vs actual):

| Check | dev actual | dev sim (anchored) | dev Poisson | holdout actual | holdout sim | holdout Poisson |
|---|---|---|---|---|---|---|
| mean total | 6.119 | 6.111 | 6.155 | 6.254 | 6.107 | 6.152 |
| sd of the total | 2.285 | 2.348 | 2.447 | 2.298 | 2.345 | 2.443 |
| tied after regulation | 0.2055 | 0.2113 | 0.1601 | 0.2485 | 0.2122 | 0.1607 |
| 1st-period share of regulation goals | 0.2972 | 0.3029 | - | 0.2924 | 0.303 | - |
| empty-net goals a game | 0.3655 | 0.2696 | - | 0.3872 | 0.266 | - |
| ties decided in OT (not SO) | 0.7029 | 0.6559 | - | 0.635 | 0.6562 | - |

Totals histogram, holdout (P(total = 0..12+)):

| | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12+ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| actual | 0.000 | 0.013 | 0.018 | 0.097 | 0.066 | 0.233 | 0.104 | 0.218 | 0.072 | 0.108 | 0.021 | 0.033 | 0.017 |
| simulator | 0.000 | 0.015 | 0.019 | 0.114 | 0.082 | 0.225 | 0.109 | 0.197 | 0.071 | 0.096 | 0.027 | 0.029 | 0.016 |
| Poisson | 0.000 | 0.018 | 0.023 | 0.112 | 0.085 | 0.209 | 0.112 | 0.185 | 0.076 | 0.095 | 0.032 | 0.032 | 0.020 |

Final margin, holdout (home - away, -5 and below .. +5 and above):

| | -5 | -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| actual | 0.026 | 0.050 | 0.104 | 0.087 | 0.211 | 0.000 | 0.221 | 0.088 | 0.127 | 0.056 | 0.029 |
| simulator | 0.026 | 0.034 | 0.097 | 0.100 | 0.202 | 0.000 | 0.218 | 0.116 | 0.120 | 0.047 | 0.040 |
| Poisson | 0.030 | 0.037 | 0.067 | 0.105 | 0.220 | 0.000 | 0.236 | 0.123 | 0.085 | 0.050 | 0.046 |

**Reading it.**  The simulator's gain is in the outcome *shape* the independent Poisson gets wrong:
regulation ties (Poisson 16% vs 21-25% actual; the simulator's score effects, P3 segments and
3v3 OT put it at 21%), the 1st period, and the puck line on the home side (empty-net goals widen
1-goal leads into 2-goal wins).  Totals are a wash: both use the same expected total when
anchored, and the simulator's totals are only slightly sharper.  On the holdout the raw simulator
would have beaten the anchored one by 0.024 (SE 0.011), almost all of it in totals (the raw
simulator's game-to-game totals were better calibrated in 2025-26, slope 0.90 vs 0.55 for the game
model's total it is anchored to; both under-shot the season's 6.25 goals a game); the pre-declared rule picked "anchored" on dev by
0.0013, so it stays: a candidate for the next pre-registered change is "anchor the win % only and
keep the simulator's own total".

## Win-% engine (`primary.py`, `prereg_primary.json`)

Pre-registered 2026-10-03 (committed before any run of the comparison) with the owner's rule: a
candidate replaces the logit game model as the source of the model win % if its moneyline log
loss is **lower on the dev seasons pooled** and **at most +0.0010 worse on the 2025-26 holdout**.
Candidates, in pre-declared order: **A** the raw simulator (no anchoring; its own rates from the
lineup RAPM term + FIN, team state, goalies, special teams, home ice, rest), then the better (on
dev) of **C1** a 50/50 logit-space average of the simulator and the logit and **C2** the game
model with `logit(p_sim)` as an extra feature.  Comparator **B**: the live logit's walk-forward
probability (`train_game_model.walk_forward`, live feature set, C tuned inside each fold),
rebuilt fresh.  Same games for everyone: regular season with finite simulator inputs and a
walk-forward logit (the archive has no games 2024-10-04 .. 11-04).  Not blind for A: the
moneyline of this exact comparison was in the M5 validation report (disclosed in the prereg).

```bash
cd pipeline
python -m bu.sim.primary dev --work $W       # dev: candidates, totals, diagnostics, ablations
python -m bu.sim.primary holdout --work $W   # the single 2025-26 look (logged, refused twice)
```

Moneyline log loss (Brier; logistic calibration slope), differences paired per game vs B:

| Season | n | B logit | A sim | A - B (SE) | C1 avg | C1 - B (SE) | C2 stack | C2 - B (SE) |
|---|---|---|---|---|---|---|---|---|
| 2023-24 dev | 1,312 | 0.65875 (0.2336; 0.97) | 0.65820 (0.2333; 1.01) | -0.00056 (0.0025) | 0.65742 | -0.00134 (0.0013) | 0.65886 | +0.00011 (0.0004) |
| 2024-25 dev | 1,063 | 0.66031 (0.2342; 1.10) | 0.65954 (0.2337; 1.09) | -0.00077 (0.0025) | 0.65911 | -0.00120 (0.0012) | 0.65968 | -0.00063 (0.0004) |
| dev pooled | 2,375 | 0.65945 (0.2339; 1.02) | 0.65880 (0.2335; 1.04) | **-0.00065 (0.0018)** | 0.65817 | -0.00128 (0.0009) | 0.65923 | -0.00022 (0.0003) |
| 2025-26 holdout | 1,312 | 0.67918 (0.2432; 0.77) | 0.67929 (0.2433; 0.85) | **+0.00011 (0.0021)** | 0.67853 | -0.00065 (0.0011) | 0.67805 | -0.00113 (0.0007) |

**Decision: A (the raw simulator) is promoted** (dev better, holdout +0.00011 <= +0.0010; recorded
in `out/sim_params.json` `primary` and `out/look_log.jsonl`).  C1 and C2 pass too and are a bit
better on the holdout, but the pre-declared order prefers the bottom-up engine.  The simulator's
predictions are less spread (SD of logit p 0.49 vs 0.51 dev, 0.41 vs 0.46 holdout) and better
calibrated on the holdout (slope 0.85 vs 0.77); its mean p sits closer to the home win rate on
dev (0.540 vs 0.522 for a rate of 0.552).

Market (descriptive, 328 holdout games with a last pregame SiteHistory price, Mar-Apr 2026;
blend weight 0.738): de-vigged market 0.6763; logit 0.6714 (blend 0.6715); simulator 0.6731
(blend 0.6732, -0.0031 vs the market, SE 0.0036; +0.0017 vs the logit blend, SE 0.0034).

**Totals** (rule: the simulator's own expected total replaces `goal_model.expected_total` as
the derivative anchor only if it is better on dev and not worse than +0.0010 on the holdout;
score = summed log loss of over 5.5, over / push / under 6.0, over 6.5, simulator anchored to the
promoted win % and either total): dev pooled T_sim - T_gm **+0.0039** (SE 0.0066; 2023-24 +0.0048,
2024-25 +0.0027), holdout **-0.0172** (SE 0.0086).  Fails on dev, so **`expected_total` stays
goal_model's** and the derivative markets are anchored to (published win %, goal_model total).
The holdout says the opposite (over 5.5 slope 0.93 with the sim's total vs 0.55): 2025-26 scored
6.25 goals a game and the simulator's game-to-game spread of totals tracked it better.  A next
pre-registered test should use the 2026-27 live totals closes.

**Diagnostics** (dev, descriptive).  Ablations of the raw simulator (each coefficient group set
to 0; ML log loss change, SE): RAPM lineup term +0.0091 (0.0024), home ice +0.0041 (0.0015),
team 5v5 state +0.0019 (0.0012), rest +0.0016 (0.0007), finishing +0.0009 (0.0012), special teams
+0.0009 (0.0008), penalties +0.0004 (0.0005), opposing goalie +0.0000 (0.0012).  What the logit
features add to the simulator (offset logistic): LR chi2 16.0 on 11 df (all-situations xG share
+0.32 per SD, SE 0.14; rest days +0.10, SE 0.06; the rest within noise).  What the simulator's
components add to the logit: chi2 7.3 on 7 df.  Jointly, logit(y) ~ 0.39 logit p_sim + 0.67
logit p_logit (SEs 0.27 / 0.26): the two carry largely the same information.

**Live** (`predict_games.build_model_outputs`): each pregame game is simulated once
(`SimServer.run`, 20,000 runs); `home_model_win_pct` = its win % (3-97% guard), `model_version` =
the simulator version, the "why this pick" breakdown = the simulator's coefficient groups
switched on one at a time from a neutral game (`SimServer.breakdown`, 3,000 runs a step, same
seed; terms add up exactly to the model logit), then `market.price_game` blends as before and the
same simulation is anchored to the published win % for the derivative markets.  The logit runs
every time and is logged (`logit_model_win_pct`, `logit_home_win_pct`, `logit_expected_total`;
SiteHistory `logit_model%` / `logit%`; the BU / F1 shadows stay blends of the logit models).
Per-game fallback to the logit (`winpct_engine = logit`) when the simulator cannot run the game
(lineup term stale / under the coverage gate, missing pack or parameters, non-finite inputs).
Rollback: repository variable `PONYXG_WINPCT=logit`.  `validate_outputs.py winpct_engine` checks
every row.

## Lineup inputs: ratings v4 (`prereg_inputs_v4.json`, `inputs_v4.py`)

The lineup inputs are pluggable (`lineup_source.py`: a point-in-time table + a serving-bundle
ratings table on the same per-side off / def / fin scale).  Pre-registered 2026-10-03 (committed
before any v4 simulation): **V4** = the simulator re-fitted on ratings v4 inputs vs **V2** = the
live simulator on RAPM v2 inputs, owner's rule: V4 is promoted iff its moneyline log loss is lower
on the dev seasons pooled, at most +0.0010 worse on the 2025-26 holdout, and its derivative score
(the 8 derivative markets of `prereg.json`, the simulation anchored to its own win % and
goal_model's total = the live configuration) is not worse on dev.  The same games as
`prereg_primary.json` (all have finite v4 inputs); 20,000 runs, the live seed.

Re-fit (fit seasons only; structural tables, state hyper-parameters, anchoring and totals choice
unchanged): 5v5 xG regression on the v4 lineup term **0.79** (SE 0.05; v2 0.68), team offence 0.24
(0.38), opponent defence 0.29 (0.35), b2b -0.038 / +0.043; conversion FIN 1.01 (0.33; v2 0.94),
team finishing 0.61 (0.75), goalie 0.85; PP and penalty regressions do not read the lineup and are
unchanged.  The v4 lineup term carries more of the team strength than v2's (the team-state terms
shrink).  Dispersion grid re-run on the v4 inputs (`prereg.json` criterion, 2,000 runs): the same
point as v2, **stretch 1.25, strength-tilt sd 0.10, no pace shock**, scale 1.020 (v2 1.018; best
criterion -5.98727 vs -5.98852 at stretch 1.25 / no tilt, -5.98857 at 1.5 / 0.1; stretch 1.0
-5.99604): the stretch was fitted on RAPM v2 inputs and did not move.

```bash
cd pipeline     # PONYXG_LAKE_DIR, PONYXG_RAPM_DIR as above; W holds the team-game caches
python -m bu.sim.fit glm --work $W --lineup-table bu/lineup/out/lineup_features_v4.csv.gz \
    --lineup-name v4 --lineup-ratings v4 --params-out $P4
PONYXG_SIM_PARAMS=$P4 python -m bu.sim.validate dispersion --work $W --n 2000
python -m bu.sim.inputs_v4 dev --work $W --v4-params $P4        # needs primary's logit_oos_B_* in $W
python -m bu.sim.inputs_v4 holdout --work $W --v4-params $P4    # the single look (logged, refused twice)
```

Moneyline (raw simulator win %) log loss (Brier; calibration slope) and derivative score, paired
per game (V4 - V2; negative favours V4):

| Season | n | V2 ML | V4 ML | V4 - V2 (SE) | V2 deriv. | V4 deriv. | V4 - V2 (SE) |
|---|---|---|---|---|---|---|---|
| 2023-24 dev | 1,312 | 0.65820 (0.2333; 1.01) | 0.65789 (0.2331; 1.01) | -0.00031 (0.0010) | 6.3207 | 6.3199 | -0.0008 (0.0036) |
| 2024-25 dev | 1,063 | 0.65954 (0.2337; 1.09) | 0.65847 (0.2332; 1.14) | -0.00107 (0.0010) | 6.3317 | 6.3303 | -0.0014 (0.0036) |
| dev pooled | 2,375 | 0.65880 (0.2334; 1.04) | 0.65815 (0.2331; 1.06) | **-0.00065 (0.0007)** | 6.3255 | 6.3245 | **-0.0011 (0.0025)** |
| 2025-26 holdout | 1,312 | 0.67929 (0.2432; 0.84) | 0.67952 (0.2433; 0.85) | **+0.00022 (0.0010)** | 6.3428 | 6.3419 | -0.0009 (0.0034) |

**Decision: V4 promoted** (dev better on both, holdout +0.00022 <= +0.0010; logged in
`out/look_log.jsonl`, question `sim_inputs_v4`, and in `out/sim_params.json` `lineup_promotion`).
V2 reproduces its published numbers exactly (0.65880 / 6.32554 dev, 0.67929 / 6.34283 holdout).
The two engines agree closely (correlation of logit p 0.99 dev, 0.98 holdout; SD of logit p 0.487
vs 0.489 dev).  Per derivative market (dev pooled, V4 - V2): reg 3-way -0.0005, home -1.5 -0.0009,
away -1.5 +0.0006, totals -0.0001 / -0.0007 / -0.0002, 1st period +0.0003 / +0.0003 (all within
about one SE except total 6.0, -0.0007, SE 0.0002); holdout: home -1.5 +0.0012, 1st period 3-way
-0.0010 and 2-way -0.0018, the rest within +-0.0004.  The gain is small: the simulator's win % was
already mostly lineup-driven and v4 changes the ratings much less than it changes their spread.

Descriptive: the raw v4 simulator's expected total is higher (dev mean 6.22 vs 6.06 for V2 and
6.12 actual; holdout 6.24 vs 6.06, actual 6.25; sd of the total 2.39 vs 2.36).  It is not
published as a market anchor (the derivative markets are anchored to goal_model's total), only as
`sim_expected_total`.

**Rollback**: repository variable `PONYXG_SIM_INPUTS=v2` loads `out/sim_params_v2.json` (the
RAPM v2 simulator, `sim-m5-20261002`, reading the bundle's `players` / `fin` tables);
`PONYXG_SIM_PARAMS=<file>` points at any parameter file.  Both also redirect `fit` / `validate`
writes.  `validate_outputs.py sim_inputs` checks that the active parameters' lineup table is
committed and that a fresh bundle carries their ratings table with its intercept.

## Player special teams and penalties (`prereg_st.json`, `st_lineup.py`, `player_st.py`)

Question `sim_player_st` (pre-registered 2026-10-03 before any re-fit or dev / holdout run):
should the PP / PK xG and penalty regressions read the dressed lineup's player ratings in addition
to the team-level state?  Per side, over the dressed skaters (`st_lineup.aggregate`; history: the
lake's dressed lineups, live: tonight's DFO lines through `LiveLineupTerm.side`, which now adds
`st` to each side when the ratings table has the columns):

* `ppo` = sum pp_i x 5 toi_pp_i / sum toi_pp (v4 PP OFF of the expected PP units, xG/60),
* `pkd` = sum pk_i x 4 toi_pk_i / sum toi_pk (v4 PK DEF of the expected PK units),
* `take` / `draw` = 5 x minutes-weighted mean of v5 `pt60` / `pd60` (all penalties rescaled to
  PP-creating units, shrunk 800 / 400 pseudo minutes);

features `lu_ppo = ppo_X / (3600 lg_pp_xg)`, `lu_pkd = pkd_Y / (3600 lg_pp_xg)` in the PP
regression, `lu_take = log(take_X / (3600 lg_pen))`, `lu_draw = log(draw_Y / (3600 lg_pen))` in the
penalty regression (`rates.ST_GROUPS`), team-state terms kept.  History:
`bu/lineup/out/lineup_st_v4.csv.gz` (2017-18 .. 2026-27), built from per-date player tables
(`st_lineup.player_table_asof`: the v4 table's `pp`, `pk`, `toi_*`, `pd60`, `pt60` as
`bu.rapm.v4_pack.live_table` computes them on each game date from games up to d - 2; a replica of
the live bundle's table at r >= 0.996 on every column) x the lake's dressed lineups.

Re-fit (fit seasons; the 5v5 and conversion regressions reproduce V4's exactly): PP xG
`lu_ppo` **0.715** (SE 0.101), `lu_pkd` 0.351 (0.136), team PP 0.362 (V4 1.180), opponent PK
0.670 (0.908); penalties `lu_take` **0.482** (0.074), `lu_draw` 0.679 (0.091), team taken 0.626
(1.070), opponent drawn 0.453 (0.923).  The player terms take over most of the team-state weight.
Dispersion grid (same procedure): stretch 1.25, strength-tilt sd **0** (V4 0.1), scale 1.024.

Dev (2,375 games, paired ST - V4; 20,000 runs):

| Season | n | ML V4 | ML ST | diff (SE) | derivative V4 | derivative ST | diff (SE) |
|---|---|---|---|---|---|---|---|
| 2023-24 | 1,312 | 0.65789 | 0.65702 | -0.00087 (0.00062) | 6.31987 | 6.31943 | -0.00043 (0.00246) |
| 2024-25 | 1,063 | 0.65847 | 0.65830 | -0.00016 (0.00064) | 6.33026 | 6.33153 | +0.00127 (0.00244) |
| pooled | 2,375 | 0.65815 | 0.65759 | **-0.00055 (0.00045)** | 6.32449 | 6.32481 | **+0.00033 (0.00174)** |

**Decision: not promoted.**  Rule (1) (dev ML lower) passes, rule (3) (dev derivative score not
worse) fails by +0.00033 (well inside one SE; per market: reg 3-way +0.0004, home -1.5 +0.0003,
total 6.0 +0.0003, 1st period -0.0004 / -0.0004).  The live simulator stays `sim-m5-v4`; the
2025-26 look for this question was **not** taken (the dev rule already decides), so it is unspent
for a later pre-registered version.  The ST parameters are kept as `out/sim_params_st.json`
(`decision` records the result); `PONYXG_SIM_INPUTS=st` serves them (opt-in only).  ST predictions
are a bit more spread (SD of logit p 0.509 vs 0.487) and better calibrated on 2024-25 (slope 1.08
vs 1.14).

```bash
cd pipeline     # PONYXG_LAKE_DIR, PONYXG_RAPM_DIR; per-date player tables in $T (st_season=<S>.parquet)
python -m bu.sim.st_lineup history --st-dir $T --out bu/lineup/out/lineup_st_v4.csv.gz
python -m bu.sim.fit glm --work $W --st-table bu/lineup/out/lineup_st_v4.csv.gz --params-out $P
PONYXG_SIM_PARAMS=$P python -m bu.sim.validate dispersion --work $W --n 2000
python -m bu.sim.player_st dev --work $W --st-params $P        # holdout: the single logged look
```

## Season projections on the simulator (`prereg_season_sim.json`, `season.py`, `season_backtest.py`)

Question `season_sim` (pre-registered 2026-10-03 before any backtest): should
`season_simulator.py` (playoff odds, point projections; `game_implications.py` reuses its engine)
take each remaining game's P(home regulation win), P(tie after 60) and the home share of OT / SO
wins from the simulator instead of the logit + `goal_model` split (TIE_SCALE 1.38)?

`bu/sim/season.py` builds, per team, the simulator's inputs for future games: team / goalie state
and league levels (the live `SimServer` state), the **typical lineup** (12 F + 6 D with the most
dressed games in the team's last 10, ties to the most recent; rated by `LiveLineupTerm.side`:
expected EV TOI shares x v4 ratings, FIN, player special teams when the parameters read them; live
only, a roster guard keeps the skaters DailyFaceoff lists for the team now and tops up from its
lines), the **expected starter** (goals-per-xG multiplier exp(sum share x log gsv) over the
starters of the last 20 games) and rest days from the remaining schedule; market-free.  Each
remaining game is simulated once (4,000 runs, seed by game id, a process pool), giving the
`Engine`'s (reg win, reg loss, tie, OT share, win) tuple; playoff series use a Bradley-Terry fit to
the simulated logits; a game the simulator cannot run falls back to the logit.  The per-game table
is cached in `pipeline/data/season_sim_games.json` (key: simulator version, bundle, state date,
DFO lines, day; per game id + rest days), committed by the workflow so the hourly implications
reuse the morning's table.

Backtest (walk-forward logit: `fit_logit` on seasons < S with in-fold C, `MLPredictor` on the
archive before D; SIM: everything replayed from the lake to D; both through `Engine`, 5,000
seasons, same seed; 160 team x as-of points):

| | n | points MAE LOGIT | SIM | SIM - LOGIT (SE, team-clustered) | playoff LL LOGIT | SIM | SIM - LOGIT (SE) |
|---|---|---|---|---|---|---|---|
| 2023-24 (Nov 1, Jan 1, Mar 1) | 96 | 6.41 | 5.70 | -0.72 (0.44) | 0.3284 | 0.3283 | -0.0001 (0.022) |
| 2024-25 (Jan 1, Mar 1) | 64 | 4.48 | 4.63 | +0.15 (0.29) | 0.2652 | 0.2785 | +0.0133 (0.029) |
| dev pooled | 160 | 5.64 | **5.27** | **-0.37 (0.28)** | 0.3031 | 0.3084 | **+0.0053 (0.015)** |

By as-of point (points MAE / playoff LL, LOGIT vs SIM): 2023-11-01 9.19 / 0.427 vs **7.52 / 0.392**;
2024-01-01 6.40 / 0.297 vs 5.83 / 0.307; 2024-03-01 3.64 / 0.261 vs 3.74 / 0.286; 2025-01-01
5.57 / 0.281 vs 5.77 / 0.293; 2025-03-01 3.38 / 0.250 vs 3.48 / 0.264.  Mean signed points error
+0.36 (LOGIT) vs +0.06 (SIM); 80% interval coverage 0.81 vs 0.83.  The in-sample live logit was
worse than the walk-forward one (MAE 5.98, LL 0.312).

**Decision: not promoted.**  Rule (1) (dev points MAE lower) and the 2023-24 guard pass; rule (2)
(dev playoff log loss not worse) fails by +0.0053 (a third of an SE).  The simulator is clearly
better early in the season (its lineup ratings carry the information the logit's Elo / xG state
has not accumulated yet) and slightly worse by March, when its playoff odds are less sharp than
it should be (the shared strength-uncertainty sigma was tuned for the logit).  `season_simulator`
stays on the logit (`sim_params.json` `season_sim.engine = "logit"`); the 2025-26 look for this
question was not taken.  Opt-in: repository variable `PONYXG_SEASON_SIM=sim` (`validate_outputs.py
season_projections` then also checks the file was made by the simulator).  A next question could
re-tune sigma for the simulator path or blend the two by GP.

```bash
cd pipeline     # PONYXG_LAKE_DIR, PONYXG_RAPM_DIR (stints for the EV TOI shares)
python -m bu.sim.season_backtest dev --work $W --ratings-dir <ratings v4 point-in-time state> [--st-dir $T]
python -m bu.sim.season_backtest holdout ...      # the single logged 2025-26 look
```

### Calibrated season projections (`prereg_season_calib.json`, `season_calib.py`)

Question `season_sim_calib` (pre-registered 2026-10-03 before any tuning or scoring): once its
season-level calibration is tuned on seasons it does not report on, should the simulator drive the
season projections?  Three knobs (`season.calibration()`, read from `sim_params.json`
`season_sim.calibration`; the identity is the uncalibrated simulator above):

* **A, logit shrink by days ahead** (`k_inf`, `tau_days`): each game's logit P(home win) shrunk toward
  the table's home-ice baseline by k(d) = k_inf + (1 - k_inf) exp(-d / tau) (`calibrate_table`);
* **B, strength sigma** (`sigma0`): the Engine's per-season team effect sigma0 sqrt(40 / (40 + GP)),
  re-estimated for the simulator (`SimProbabilities.sigma0`; the Engine takes it when no sigma is passed);
* **C, lineup regression** (`lineup_w_inf`, tau 60 days): the typical lineup's OFF / DEF multiplied by
  w(d) before the game is simulated (`lineup_scale`, `game_rows(scale=)`).

Tuning: the full grid (8 k_inf x 4 tau, 4 sigma0, 3 w_inf: 348 candidates) on 2017-18, 2018-19,
2021-22, 2022-23 at Nov 1 / Jan 1 / Mar 1 (378 team x as-of points; 2019-20 and 2020-21 excluded:
COVID stop / 56-game realigned divisions), 3,000 seasons each, objective J = points MAE + 25 x
playoff log loss (25 makes the +0.25-point and +0.010 margins equal).  **The identity won**: J
14.902 (MAE 6.63, LL 0.331); the lowest J, 14.898 (sigma0 0, w 0.75), is within the pre-declared
0.02 tie band with two knobs.  Shrinking hurt at every month (k 0.9: 14.98, 0.7: 15.35, 0.5: 16.01;
Nov 1 alone 20.42 at k 1 vs 20.65 at 0.9), lineup regression hurt (w 0.75: 14.94, 0.5: 15.05),
sigma was flat (0.1: 14.901, 0.3: 14.986).  A descriptive opening-night check on 2018-19 and
2022-23 (not part of the rule) agreed: the raw simulator's projected points (sd 12, 58 to 119)
score about as well as the best shrink (J 21.82 vs 21.70 at k 0.8, sigma 0), against final-points
sds of 13.7 and 18.9.  The simulator's preseason spread is not what costs it; the logit's (sd ~5)
looks too narrow.

| | n | points MAE LOGIT | CAL | CAL - LOGIT (SE) | playoff LL LOGIT | CAL | CAL - LOGIT (SE) |
|---|---|---|---|---|---|---|---|
| dev pooled (as season_sim) | 160 | 5.64 | 5.27 | -0.37 (0.28) | 0.3031 | 0.3084 | +0.0053 (0.015) |
| holdout 2025-26 | 96 | 6.29 | 6.41 | +0.11 (0.33) | 0.4542 | 0.4651 | **+0.0109** (0.029) |

Holdout by point (MAE / LL, LOGIT vs CAL): 2025-11-01 9.57 / 0.630 vs 10.09 / 0.658; 2026-01-01
5.51 / 0.429 vs 5.42 / 0.435; 2026-03-01 3.80 / 0.304 vs 3.71 / 0.303.  P(playoffs) reliability
by decile is in `out/validation.json` (`season_calib_dev`, `season_calib_holdout`).

**Decision: not promoted.**  Rules (1) dev MAE not worse, (2) dev LL within 1 SE and (3) holdout
MAE within +0.25 pass; (4) holdout LL within +0.010 fails by 0.0009 (a thirtieth of its SE).
`season_simulator` stays on the logit; `PONYXG_SEASON_SIM=sim` runs the simulator with
`season_sim.calibration` (the identity).  Because the chosen calibration is the identity, this
look scored the uncalibrated simulator on 2025-26, so question `season_sim`'s own holdout look is
spent in effect; a further season-engine question needs 2026-27 as its holdout.

2026-27 preseason (2026-10-03, 21 games played, 5,000 seasons): LOGIT 82.3 to 103.8 projected
points (sd 4.9), playoff odds 16.9% to 82.6%; simulator (raw = CAL) 61.1 to 117.4 (sd 12.2), 0.4% to
98.7% (COL 117.4 / 98.7% vs 103.8 / 82.6%; VAN 61.1 / 0.4% vs 83.7 / 19.6%).

```bash
cd pipeline     # PONYXG_LAKE_DIR, PONYXG_RAPM_DIR
python -m bu.sim.season_calib tune --work $W --ratings-dir $R --out $O     # tuning seasons only
python -m bu.sim.season_calib dev ...           # CAL and SIM_raw vs LOGIT
python -m bu.sim.season_calib holdout ...       # the single logged look (question season_sim_calib)
python -m bu.sim.season_calib preseason --out $O
```

## Runtime

One game, 20,000 runs: ~0.13 s simulation + ~0.04 s anchoring on an idle core.  `predict_games`
on 2026-10-02 (18 games, today and tomorrow): 3.4 s for the whole slate including anchoring and
pricing, on a loaded 8-core laptop.  With the simulator as the win-% engine (one simulation shared
by the win %, the breakdown's five 3,000-run counterfactuals, anchoring and pricing): lite run of
2026-10-03, 14 pregame games in 8.9 s (0.63 s a game) on a loaded laptop.  On the v4 inputs
(sim-m5-v4): lite run of 2026-10-03 03:06Z, 13 pregame games in 4.9 s (0.38 s a game), the whole
lite run 31 s.  Validation: ~1 min per season on 8 workers.  Season projections on the simulator
(opt-in): 1,323 remaining games x 4,000 runs in 16 s on 4 workers (laptop), 0.2 s from the day's
cache; the Monte Carlo of 5,000 seasons over the table ~7 s.  Full refresh of 2026-10-03 with
`PONYXG_SEASON_SIM=sim` on a laptop: `season_simulator` stage 26.5 s (11.8 s simulating 1,323
games on 8 workers).  The season backtest (5 as-of points,
both arms) ~100 s on 8 workers.

## Weaknesses (what is still heuristic)

* Empty-net goals are under-produced: 0.27 a game simulated vs 0.37 (dev) / 0.39 (2025-26)
  actual.  The pull curves are fitted on 2017-23 and coaches now pull earlier and at bigger
  deficits; the curve is also league-wide (no team / coach effect).  This mostly costs the
  away -1.5 / home +1.5 side and 2-goal margins.  Fix: as-of pull curves from the last two seasons.
* Regulation ties are still under-produced in high-tie seasons (2025-26: 24.9% actual vs 21.2%),
  and OT is decided in 3v3 a bit less often than in 2023-25 (65.6% vs 70%): both structural tables
  are fixed at their 2017-23 values.
* Totals are slightly over-dispersed (sd 2.35 vs 2.29-2.30 actual) even with the post-goal lull;
  the lull and score effects explain most but not all of the real under-dispersion.
* The strength stretch (1.25, re-chosen on the v4 inputs) is a single fitted factor standing in for the correlation between a
  team's strengths across states; a joint model of PP / PK / 5v5 / finishing would replace it.
* Delayed-penalty extra attackers, stacked third penalties (dropped), misconducts and penalty
  shots are not simulated; the shootout is a league coin (50.4% home), with no shooter / goalie
  history.
* Power-play strength and penalty rates are team level in the published simulator; the lineup
  version (`out/sim_params_st.json`) improved dev ML but not the derivative score (opt-in).  The
  goalie is the expected starter all game (no in-game pulls for performance).
* Season projections on the simulator (opt-in) use one typical lineup all season (no injuries,
  trades or call-ups after today); preseason they are much more spread than the logit's (2026-27
  opening week: 61 to 117 projected points vs 82 to 104).  Re-tuning sigma, shrinking far-ahead
  games or regressing future lineups did not score better on 2017-23 (`prereg_season_calib.json`),
  but those seasons are in the simulator's fit window and the tuning has no preseason point.
* In-season live updates of the team / goalie state come from the gamestats + shots CSVs (score-
  adjusted 5v5 time approximated from time leading / trailing / tied), not the lake's stints; FIN
  comes from the serving bundle's `fin` table.
* The 1st-period 2-way market is no better than Poisson (+0.0003): the period's tie-free split is
  almost entirely the win % split.
