# `bu.isolate`: isolated impact (spatial RAPM)

Where on the ice a skater changes the shots, after HockeyViz's isolated impact
(<https://hockeyviz.com/howto/isolate>), plus its parts in goals.  Site file:
`public/data/isolate/<season>.json` (schema: `pipeline/CONTRACT.md`), shown on `/players/[id]`
("Isolated impact", `components/player/IsolatedImpact.tsx`), explained on `/methodology#isolated-impact`.

## Model (`model.py`, `grid.py`)

* **Inputs** (`inputs.py`, cached in `<lake>/state/isolate/season=S/`, rebuilt when the lake partition
  changes): `bu.rapm.stints` on xG v2 (games whose shift charts disagree with the feed on >10% of
  shots dropped), every unblocked non-penalty-shot attempt assigned to its stint by the lake's
  `(start, end]` rule (checked: per-stint xG sums match the stints exactly), minors / double minors
  drawn and taken, TOI by state, positions.
* **Window**: season S and the two before it, every game weighted `0.5 ** (age_days / 365)` from the
  window's last game, so an October map is stable and still moves with every game.
* **5v5 maps**: two rows per 5v5 stint (one per attacking side), weight = seconds x recency.  Target =
  the attacking side's unblocked shots binned on a 2.5 ft grid of the offensive half (per hour);
  columns = offence indicator per attacking skater, defence indicator per defending skater, and
  covariates intercept, home, score (-3..+3), third-period lead / trail shell, faceoff zone that opened
  the stint (O / N / D).  One Cholesky factorisation solves every cell (1,360 right-hand sides).  Ridge
  lambda 20,000 s (pseudo-time at league average) for skaters, 1 for covariates.  Because ridge is
  linear in the target, the coefficient maps are then smoothed (10 ft Gaussian, mirror boundary, mass
  preserving) and summed to 5 ft cells; a map's sum is the player's scalar shots/60 impact.
  **Shot rate, not xG, on the maps**: xG-weighted maps put every good player's effect in one slot blob;
  rate maps show the shape of his game, and their shape repeats as well or better (offence 0.26 / 0.25 /
  0.25 vs xG 0.27 / 0.23 / 0.19 year to year).  The headline xGF/60 / xGA/60 is the same regression on
  flurry-adjusted xG v2 (the same lambda: both targets' CV optimum).
* **PP / PK**: one row per 5v4 stint (the PP side attacking), PP-offence and PK-defence columns,
  covariates intercept, home, score (-2..+2), zone; lambda 10,000 s.
* **Components** (goals over a standard season = 1,000 5v5 + 125 PP + 125 PK minutes, average
  teammates and opponents): the four xG impacts x minutes / 60 (defence signed so + = fewer against);
  finishing = (gamma-Poisson multiplier (G + 60) / (X + 60) on league-scaled xG of his own unblocked
  shots, all strengths but empty net, window-weighted, minus 1) x shrunk own xG/60 x 1,250 / 60;
  drawing / taking = minor-equivalents per 60 shrunk to the position mean (600 min), minus the mean, x
  1,250 / 60 x the window's net 5v4 xG per minor called (0.130).
* **Left out**: *setting* (teammates' shots beating their own finishing with him on the ice, a ridge on
  on-ice teammates): 5-fold CV picks infinite shrinkage, i.e. no out-of-sample signal without pass
  data.  *Ice won / lost* and coaching terms are not modelled.

## Validation (`validate.py` -> `out/isolate_validation.json`)

* Tuning (5-fold by game, window 2023-26): player lambda 20,000 (5v5, xG and shots), 10,000 (PP/PK).
* Year over year (one-season fits, skaters >= 500 5v5 min both years; 22-23->23-24, 23-24->24-25,
  24-25->25-26): 5v5 offence xG r = 0.55 / 0.55 / 0.50, defence 0.40 / 0.36 / 0.38, shots 0.54 / 0.54 /
  0.49 and 0.46 / 0.48 / 0.49; PP 0.53 / 0.31 / 0.32 (>= 100 PP min), PK 0.18 / 0.17 / 0.18; finishing
  0.22 / 0.12 / 0.25; drawn 0.64 / 0.59 / 0.58; taken 0.71 / 0.69 / 0.70; total 0.48 / 0.48 / 0.44.  Map
  shape (per-player correlation of offensive-zone cells): offence 0.25-0.27 vs ~0 for random pairs,
  defence 0.10-0.11 vs ~0.
* Agreement (window 2024-27): with `player_ratings.json` `ev_off` r = 0.90, `ev_def` r = 0.93 (that file
  signs defence + = prevented) over 720 skaters.  `player_impact.json` `rapm_off/def` is this season
  only (a week of games), so no agreement there yet.
* Sanity (2025-26 window): offence top = MacKinnon, Hagel, Kucherov, Tkachuk, Thomas, McDavid,
  Hyman, Draisaitl; defence top = Tanev, Hathaway, Karlsson, Desharnais, Pelech, Brodin, Seider.
* `tests/test_isolate.py`: grid mass / mirror symmetry, two symmetric rows per stint, and a synthetic
  recovery (one skater planted +30 shots/h at one spot on offence, another +30 against elsewhere:
  both recovered within 25% at the right cell, everyone else near 0).

## Running it

The window needs the multi-season lake (`data/lake`, not in CI: the daily refresh has no lake and the
bu_refresh runner only restores the current season), so this is a manual tool.  Runtime: about 35 s
with cold caches (3 seasons of inputs), 6-10 s warm, ~1 GB RAM.

```bash
cd pipeline
python -m bu.isolate refresh                  # current season: incremental lake update + build (weekly is plenty)
python -m bu.isolate build --season 20252026  # any season the lake covers
python -m bu.isolate validate                 # tuning, repeatability, agreement (~1 min)
```

Files: `20252026.json` 1.1 MB (850 skaters), `20262027.json` 0.9 MB (669 skaters, 52 games in).
To automate it, publish the two past seasons' `state/isolate` caches (~13 MB each) as a release asset
next to `lake-<season>` and add a `python -m bu.isolate build --season <S>` step to `bu_refresh.yml`.
