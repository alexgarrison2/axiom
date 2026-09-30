# pony xG

NHL game predictions, team analytics and playoff odds. A Python pipeline
collects free public data, runs the shot-quality (xG) and game models, and
writes plain CSV/JSON files. A Next.js app renders those files. There is no
database behind the site and no user accounts.

## Architecture

```
 NHL API · MoneyPuck · DailyFaceoff · sportsbook lines (free, public)
                         │
                         ▼
 pipeline/  (Python, GitHub Actions: hourly lite run, daily full run)
   scrape games ─► score shots (xG) ─► team/goalie ratings ─► predict games
   ─► history, season simulation, playoff implications
                         │  writes files, workflow commits them to main
                         ▼
 public/data/  (canonical site data)      data/  (server-side copies)
                         │
                         ▼
 Next.js 16 App Router (Vercel): server components read files with fs,
 client components fetch /data/*.json|csv
```

| Path | What lives there |
|---|---|
| `app/` | Routes (App Router) and API route handlers |
| `components/`, `hooks/`, `lib/`, `utils/`, `types/` | UI, client hooks, helpers and shared types |
| `pipeline/` | Data pipeline scripts, models (`*.pkl`) and pipeline-internal state |
| `pipeline/tools/` | Offline, run-by-hand scripts (see its README) |
| `public/data/` | Pipeline outputs served to the browser |
| `data/` | Legacy server-side copies (`predictions_detailed.csv`, `gamestats.csv`, `prediction_history.json`, `nhl_teams.csv`, ...) |
| `scripts/` | Optional Supabase snapshot sync (see `scripts/AUTOMATION_README.md`) |
| `docs/` | Design notes; `docs/archive/` holds superseded audits |

### Data files

`public/data/` is the canonical output directory: anything the browser needs
is written there and served at `/data/<file>`. The most important files:

| File | Written by | Used for |
|---|---|---|
| `predictions_detailed.csv` | `predict_games.py` | Tonight's matchup cards (also copied to `data/`) |
| `upcoming_games.json` | `fetch_upcoming.py` | Schedule, probable/confirmed goalies |
| `odds.json` | `fetch_odds.py` | Market lines shown next to model prices |
| `gamestats.csv` | `refresh_pipeline.py` | Team tables, splits, charts (current-season games) |
| `team_ratings.json`, `goalie_ratings.json` | `team_ratings.py` | Power ratings and goalie GSAx |
| `season_projections.json` | `season_simulator.py` | Playoff odds and projected points |
| `game_implications.json` | `game_implications.py` | Playoff stakes of tonight's games |
| `SiteHistory/<date>.csv` | `pipeline/snapshot_predictions.py` | Frozen pre-game predictions per day |
| `last_updated.json` | `predict_games.py` | "Updated at" stamp |
| `manifest.json` | `refresh_pipeline.py` | Run summary: `season_id`, `generated_at` (UTC), mode and per-stage status, used for freshness checks |

`data/prediction_history.json` (from `generate_history.py`) is the graded
record of past predictions. `pipeline/` also holds pipeline-only state that
the site never serves: the season CSVs `nhl_season_<yyyy>_<yyyy>_{gamestats,
shots,shifts,pbp}.csv`, the multi-season `nhl_historical_*.csv` training
files, and model artifacts (`xg_model_xgb.pkl`, `game_model.pkl` +
`game_model_meta.json`).

`nhl_teams.csv` exists in `pipeline/`, `data/` and `public/data/`; the three
copies must stay identical (Utah Mammoth is NHL team id 68).

## Seasons and rollover

The current season is computed, never hardcoded:

- `pipeline/season.py`: `SEASON_ID` (`"20262027"`), `SEASON_LABEL`,
  `season_file(kind)` → `nhl_season_2026_2027_<kind>.csv`, `SEASON_GAMES`
  (84 from 2026-27, 82 before) and `read_season_csv()`, which returns an
  empty frame before the first game is scraped.
- `lib/season.ts`: the same values for the frontend (`SEASON_ID`,
  `seasonFile()`, `SEASON_GAMES`, `SEASON_START_DATE`).

Both roll over on **July 1**, the start of the NHL league year, so offseason
runs already point at the new season's (still empty) files. At rollover, fold
the finished season into the historical training files:

```bash
cd pipeline
python3 tools/archive_season.py
```

It defaults to the previous season and is safe to re-run. Last season's
season CSVs stay in `pipeline/` as the archive; never delete them.

## Running locally

Requirements: Node 20+, Python 3.11+.

```bash
npm ci
npm run dev
```

The dev server runs at http://localhost:3000 and reads the committed data
files, so no pipeline run is needed to work on the UI.

Pipeline (run from `pipeline/`, because scripts use paths relative to it):

```bash
pip install -r requirements.txt
cd pipeline
python3 fetch_upcoming.py
python3 fetch_odds.py
python3 predict_games.py
```

That is the core of the hourly lite run. The daily full refresh is
`python3 refresh_pipeline.py` from `pipeline/` (scrape, re-score every shot,
ratings, player impact, predictions, history, simulation); it takes several
minutes and rewrites many committed files, so review `git status` before
committing anything it produces.

Retraining (from `pipeline/`): `python3 xg_model.py` rebuilds the shot model
(`xg_model_xgb.pkl`); `python3 train_game_model.py` rebuilds the game model
(`game_model.pkl`); `python3 tools/backtest_model.py` backtests it.

## Automation

`.github/workflows/update_data.yml` runs hourly from 12:00 to 02:00 UTC.
Runs that start between 12:00 and 14:59
UTC do the full refresh; the rest do the lite update. It then commits the
changed data files to `main`, which triggers a Vercel deploy. Secrets:
`DB_HOST`, `DB_USER`, `DB_PASSWORD` (optionally `DB_NAME`, `DB_PORT`) for the
optional Supabase sync, and `VERCEL_DEPLOY_HOOK`. Nothing else needs
credentials: every data source is free and public.

## Testing

```bash
npx tsc --noEmit
npm run lint
npm run build
npm run test:e2e
python3 scripts/check_doc_commands.py
```

`test:e2e` runs the Playwright specs in `tests/` (it starts the dev server
on port 3000 itself; install browsers once with `npx playwright install`). `check_doc_commands.py` checks that every command in the README and
CLAUDE.md code blocks still points at real scripts and files.

## Data sources and credits

Data: NHL (api-web.nhle.com, api.nhle.com), MoneyPuck.com (player data;
credit required by their terms), DailyFaceoff (lines, starting goalies) and
public sportsbook feeds for odds. Sources that were tried and do not work
from a headless runner or on a free tier are listed in `CLAUDE.md`.
