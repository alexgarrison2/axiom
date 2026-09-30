# pipeline/tools — offline, run-by-hand scripts

Nothing in the scheduled pipeline (`refresh_pipeline.py`, `predict_games.py`,
`.github/workflows/update_data.yml`) imports or runs these. They are kept for
occasional maintenance, rebuilding history, and research.

Run them **from `pipeline/`** (each one puts `pipeline/` on `sys.path` and
resolves its data files against `pipeline/`, so the working directory only
matters for readability):

```bash
cd pipeline
python3 tools/<script>.py
```

They can also be imported as a package from `pipeline/`, e.g.
`from tools.archive_season import archive`.

| Script | When to use it | Reads | Writes |
|---|---|---|---|
| `archive_season.py [start_year]` | Season rollover: fold the finished season's gamestats and shots into the `nhl_historical_*` files. Defaults to the previous season; safe to re-run. | `nhl_season_<prev>_{gamestats,shots}.csv` | `nhl_historical_{gamestats,shots}.csv` |
| `backtest_model.py` | Walk-forward backtest of the game model (`train_game_model.py`) against Poisson and home-rate baselines: log loss, Brier, accuracy, calibration. | historical + current gamestats | stdout |
| `backfill_pbp.py` | Backfill raw play-by-play for games present in the current season's gamestats but missing from its PBP file. Follow with `python3 enrich_pbp.py` and `python3 calc_pbp_impact.py`. | `nhl_season_<cur>_gamestats.csv`, NHL API | `nhl_season_<cur>_pbp.csv` |
| `build_historical_2223.py` | One-time rebuild of the 2022-23 season into the historical files (already done; kept for reproducibility). | `data/historical_pbp/raw_pbp_20222023.csv`, NHL API | `nhl_historical_{gamestats,shots}.csv` |
| `fetch_nhl_teams.py` | Regenerate the team metadata table (ids, tricodes, logos, arenas, colours) from the NHL API. | NHL API | `pipeline/nhl_teams.csv` |
| `scrape_playoff_history.py` | Research: per-team playoff game metrics for 2021-22 to 2024-25, used to derive the playoff coefficients. | NHL API | `pipeline/playoff_historical.csv` (gitignored) |

## Notes

- `nhl_teams.csv` exists in three places that must stay identical:
  `pipeline/`, `data/` and `public/data/`. After running `fetch_nhl_teams.py`,
  copy the new file to the other two and review the diff (the Tampa Bay logo
  deliberately uses `TBL_dark.svg` for the dark UI; Utah Mammoth is team id 68).
- The model trainer, `train_game_model.py`, stays in `pipeline/` because the
  retrain job uses it.
- All tools verify TLS certificates; do not reintroduce `CERT_NONE`.
