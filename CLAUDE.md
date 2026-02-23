# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend (Next.js)
```bash
npm run dev      # Start dev server at http://localhost:3000
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

### Python Data Pipeline
```bash
# Full data refresh (run from repo root or pipeline/)
python pipeline/refresh_pipeline.py

# Lightweight hourly update
python pipeline/fetch_upcoming.py
python pipeline/fetch_odds.py
python pipeline/predict_games.py

# One-time model training
python pipeline/train_xg_model.py
```

## Architecture

### Overview
"Pony xG" is an NHL analytics/predictions app with two distinct layers:
1. **Python pipeline** – collects data, trains/runs an XGBoost xG model, generates predictions as CSV/JSON files
2. **Next.js frontend** – reads those files server-side and renders them as a React UI

There is no traditional backend API. Data flows: Python scripts → CSV/JSON files in `data/` and `public/data/` → Next.js SSR reads via `fs.readFileSync()` → React components.

### Data Pipeline (`pipeline/`)
The pipeline runs automatically via GitHub Actions (`.github/workflows/update_data.yml`):
- **Morning (12:00–14:00 UTC)**: Full refresh via `refresh_pipeline.py` — re-scrapes Hockey Reference, re-scores all shots through the XGBoost model, recalculates team ratings
- **Other hours**: Lite update — fetch upcoming games/goalies, update odds, re-run predictions

Key pipeline scripts:
| Script | Purpose |
|--------|---------|
| `refresh_pipeline.py` | Orchestrates the full daily refresh |
| `nhl_scraper_poc.py` | Scrapes NHL API for boxscores and play-by-play |
| `xg_model.py` | XGBoost shot model — 5×5 spatial bins + shot attributes |
| `team_ratings.py` | Power ratings: 50% L10 + 50% regressed season average |
| `predict_games.py` | Generates `predictions_detailed.csv` using Poisson distribution |
| `fetch_odds.py` | Scrapes Bovada for betting lines |
| `fetch_dailyfaceoff.py` | Confirms starting goalies |
| `calculate_gas.py` | Goalie performance (GSAx) metrics |

Trained model is stored as `pipeline/xg_model_xgb.pkl` (excluded from git via `.gitignore`).

### Frontend (`app/`, `components/`, `utils/`)
- **App Router** with `force-dynamic` / `revalidate: 0` on key pages to always serve fresh data
- `utils/data.ts` — loads and parses `predictions_detailed.csv`, `prediction_history.json`, etc.
- `utils/schedule.ts` — reads `upcoming_games.json` for schedule/lineup data
- `utils/simulation-engine.ts` — Poisson-based playoff bracket simulation
- `components/PredictionsViewer.tsx` — main matchup card list (entry point for predictions UI)
- `components/PlayoffBracket.tsx` — interactive playoff simulation
- UI components in `components/ui/` follow Shadcn (new-york style, zinc base color)

### Data Files
The pipeline writes to two places that must stay in sync:
- `data/` — canonical data storage (some files at repo root too)
- `public/data/` — copy served as static assets to the browser (odds.json, gamestats.csv)

Key files consumed by the frontend:
- `data/predictions_detailed.csv` — today's game predictions
- `data/prediction_history.json` — historical accuracy archive
- `pipeline/upcoming_games.json` — next games + confirmed goalies
- `pipeline/team_ratings.json` — xGF/xGA power ratings per team
- `pipeline/goalie_ratings.json` — GSAx metrics per goalie

### Path Alias
TypeScript uses `@/*` to map to the repo root (configured in `tsconfig.json`).

### Styling
Tailwind CSS with custom neon color tokens (`neon-blue`, `neon-green`, `neon-purple`) and custom animations (`pulse-glow`, `fade-in-up`). Fonts: Fira Sans + Fira Code via Google Fonts.

## Environment Variables
Required for Supabase (prediction history archival) and pipeline DB syncing:
```
DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, DB_PORT
```
Set as GitHub Actions secrets for CI; use a `.env` file locally.
