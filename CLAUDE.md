# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. `README.md` has the fuller architecture and data-file tour.

## Commands

### Frontend (Next.js)
```bash
npm ci           # Install exact dependencies from package-lock.json
npm run dev      # Start dev server at http://localhost:3000
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
npx tsc --noEmit # Type-check
```

### Python Data Pipeline
Scripts use paths relative to `pipeline/`, so always run them from there.
```bash
pip install -r requirements.txt
cd pipeline
python3 refresh_pipeline.py   # Full daily refresh (slow; rewrites many committed files)
python3 fetch_upcoming.py     # Lite hourly update, step 1: schedule + goalies
python3 fetch_odds.py         # step 2: market lines
python3 predict_games.py      # step 3: predictions_detailed.csv
python3 xg_model.py           # Retrain the shot (xG) model -> xg_model_xgb.pkl
python3 train_game_model.py   # Retrain the game model -> game_model.pkl + game_model_meta.json
python3 tools/backtest_model.py
```
One-off maintenance scripts (season archive, PBP backfill, historical rebuilds, team table regeneration) live in `pipeline/tools/`; see `pipeline/tools/README.md`.

## Architecture

### Overview
"pony xG" is an NHL analytics/predictions app with two layers:
1. **Python pipeline**: collects data, runs an XGBoost shot-quality (xG) model and a game-outcome model, writes predictions and stats as CSV/JSON files
2. **Next.js frontend**: reads those files (server-side via `fs`, client-side via `/data/...` fetches) and renders them

There is no database behind the site. Data flows: Python scripts → files in `public/data/` (canonical, served to the browser) plus legacy server copies in `data/` → Next.js → React components.

### Season handling
Never hardcode a season. `pipeline/season.py` (`SEASON_ID`, `season_file()`, `read_season_csv()`, `SEASON_GAMES`) and `lib/season.ts` (`SEASON_ID`, `seasonFile()`, `SEASON_GAMES`) are the single sources of truth; both roll over on July 1. 2026-27 is an 84-game season. Early in a season most current-season stats are empty or tiny samples: show "no games yet" or label prior-season values explicitly rather than presenting last season's numbers as current. Last season's files stay in `pipeline/` as the archive (`nhl_season_2025_2026_*`), and `pipeline/tools/archive_season.py` folds a finished season into `nhl_historical_*.csv`.

### Data Pipeline (`pipeline/`)
Runs via GitHub Actions (`.github/workflows/update_data.yml`), hourly 12:00-02:00 UTC:
- **12:00-14:59 UTC**: full refresh via `refresh_pipeline.py` (scrape new games, re-score every shot with the xG model, team/goalie ratings, player impact, shifts/PBP enrichment, predictions, history, season simulation, playoff implications)
- **Other hours**: lite update (upcoming games/goalies, odds, predictions, implications)

The workflow commits the changed data files to `main`, which deploys to Vercel.

Key pipeline scripts:
| Script | Purpose |
|--------|---------|
| `refresh_pipeline.py` | Orchestrates the full daily refresh |
| `nhl_scraper_poc.py` | Scrapes NHL API boxscores and play-by-play into the season CSVs |
| `xg_model.py` | XGBoost shot model (spatial bins + shot attributes), isotonic-calibrated |
| `team_ratings.py` | Team power ratings and goalie ratings |
| `ml_predict.py` / `train_game_model.py` | Game-outcome model (`game_model.pkl`) used by predictions |
| `predict_games.py` | Builds `predictions_detailed.csv` (xG, win %, odds, EV) |
| `fetch_upcoming.py` | Schedule and starting goalies |
| `fetch_odds.py` | Market lines |
| `fetch_dailyfaceoff.py` | Line combinations, starting goalies and news |
| `season_simulator.py` | Monte Carlo playoff odds (`season_projections.json`) |
| `generate_history.py` | Graded prediction history (`data/prediction_history.json`) |

### Model files and tracking
Model artifacts are committed to git (they are small enough and the lite run needs them): `pipeline/xg_model_xgb.pkl` (shot model), `pipeline/game_model.pkl` + `game_model_meta.json` (game model). Retraining changes these binaries, so commit a retrain on its own with the validation numbers (log loss, Brier, calibration vs the previous model and vs the de-vigged market) in the message. Frozen pre-game predictions are archived per day in `public/data/SiteHistory/<date>.csv`; `data/prediction_history.json` is the graded record built from them.

### Frontend (`app/`, `components/`, `utils/`, `lib/`, `types/`)
- App Router; server components read files with `fs`, client components fetch `/data/*`
- `utils/data.ts`: loads and parses `predictions_detailed.csv`, `prediction_history.json`, etc.
- `utils/schedule.ts`: NHL schedule/standings helpers
- `types/simulation.ts`: standings and simulation-result types (the simulation itself runs in Python)
- `components/PredictionsViewer.tsx`: home page matchup list
- UI primitives in `components/ui/` follow shadcn (new-york style, zinc base color)

### Data Files
- `public/data/`: canonical outputs served to the browser (predictions, odds, gamestats, ratings, projections, SiteHistory, ...)
- `data/`: legacy server-side copies (`predictions_detailed.csv`, `gamestats.csv`, `prediction_history.json`, `nhl_teams.csv`, `odds.json`)
- `pipeline/`: pipeline-only state (season CSVs, historical training CSVs, models, intermediate JSON)
- `nhl_teams.csv` exists in `pipeline/`, `data/` and `public/data/` and the three copies must be identical

### Path Alias
TypeScript uses `@/*` to map to the repo root (configured in `tsconfig.json`).

### Styling
Tailwind CSS with custom neon color tokens (`neon-blue`, `neon-green`, `neon-purple`) and custom animations. Fonts: Fira Sans + Fira Code via `next/font`.

## Data sources

Working, free sources: NHL `api-web.nhle.com` and `api.nhle.com` (schedule, boxscores, PBP, shifts, standings, rosters, and DraftKings odds via `partner-game` and `schedule/{date}`), MoneyPuck (player data; credit required), DailyFaceoff (lines, goalies, news; needs a browser UA), ESPN site API (scoreboard, injuries, probables; use a plain non-browser UA).

Not viable, do not build on them:
- **Natural Stat Trick**: Cloudflare challenge (403 "Just a moment...") on every headless request.
- **DraftKings direct API**: Akamai 403. Get DraftKings prices through the NHL `partner-game` / `schedule` feeds instead.
- **The Odds API, hourly**: needs a key and the free tier is 500 credits/month, far below ~720 hourly calls. At most one closing-line snapshot per game day.
- **PuckPedia**: 403 for scripted requests. `fetch_contracts.py` still targets it, so `contracts.json` is sparse; replace it with the per-player `cap` object in the DailyFaceoff line-combination pages the pipeline already downloads, backfilled from CapWages.
- **Nitter / X scraping**: all public nitter instances are dead.
- **NHL transactions/injuries endpoint**: does not exist (`/v1/transactions/now` is 404); use ESPN injuries.
- NHL `.../now` endpoints (`club-stats/{team}/now`, `player/{id}/game-log/now`, `edge/*/now`) keep returning the previous season around opening night; always pass an explicit season id.

## Environment Variables
Only the optional Supabase sync (`scripts/snapshot_predictions.py`, `scripts/sync_history_to_supabase.py`) needs credentials:
```
DB_HOST, DB_USER, DB_PASSWORD (required), DB_NAME, DB_PORT (optional)
```
Set them as GitHub Actions secrets for CI or in an untracked `.env` locally. Never commit credentials, `.env` files or local databases (`*.db` is gitignored).
