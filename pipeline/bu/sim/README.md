# `bu.sim`: game-state simulator (M5)

A Monte Carlo of each game, built bottom up: who is dressed and who starts in net set each
team's rates in every skater / goalie state, and 20,000 simulated games give the probability of
every market we have a price for (moneyline, regulation 3-way, puck line +-1.5, the game total
including pushes on whole lines, the 1st-period 3-way and 2-way markets).  The published
moneyline stays the validated, market-blended game model (`home_win_pct`); the simulator is
anchored to it (see "Anchoring") and its own raw win % is kept as a shadow.

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

* `ev`: 5v5 xG per score-adjusted second ~ RAPM v2 lineup term (tonight's dressed skaters x
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
the committed point-in-time table (`bu/lineup/out/lineup_features.csv.gz`, ratings as of d - 2
days); live they come from the serving bundle (`LiveLineupTerm`, its `fin` table).  A strength
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

## Fitted parameters (fit seasons 2017-18 .. 2022-23, `out/sim_params.json`)

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

## Runtime

One game, 20,000 runs: ~0.13 s simulation + ~0.04 s anchoring on an idle core.  `predict_games`
on 2026-10-02 (18 games, today and tomorrow): 3.4 s for the whole slate including anchoring and
pricing, on a loaded 8-core laptop.  Validation: ~1 min per season on 8 workers.

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
* The strength stretch (1.25) is a single fitted factor standing in for the correlation between a
  team's strengths across states; a joint model of PP / PK / 5v5 / finishing would replace it.
* Delayed-penalty extra attackers, stacked third penalties (dropped), misconducts and penalty
  shots are not simulated; the shootout is a league coin (50.4% home), with no shooter / goalie
  history.
* Power-play strength is team level (no PP-unit lineups); the goalie is the expected starter all
  game (no in-game pulls for performance).
* In-season live updates of the team / goalie state come from the gamestats + shots CSVs (score-
  adjusted 5v5 time approximated from time leading / trailing / tied), not the lake's stints; FIN
  comes from the serving bundle's `fin` table.
* The 1st-period 2-way market is no better than Poisson (+0.0003): the period's tie-free split is
  almost entirely the win % split.
