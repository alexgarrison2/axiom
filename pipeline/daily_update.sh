#!/bin/bash
# Daily full pipeline update — run by launchd at 6:30 AM
# Runs refresh_pipeline.py, then commits and pushes updated data files to GitHub
# so Vercel auto-deploys the latest stats.

set -euo pipefail

PIPELINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$PIPELINE_DIR")"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
LOG_PREFIX="[daily_update $TIMESTAMP]"

echo "$LOG_PREFIX Starting full pipeline..."

# 1. Run the full refresh pipeline from the pipeline/ directory
cd "$PIPELINE_DIR"
python3 refresh_pipeline.py
echo "$LOG_PREFIX Pipeline complete."

# 2. Commit and push updated data files to trigger Vercel re-deploy
cd "$REPO_DIR"

if [[ -n $(git status --porcelain) ]]; then
    echo "$LOG_PREFIX Changes detected — committing..."

    # Stage data files and pipeline outputs (avoid committing huge CSV history files)
    git add public/data/
    git add pipeline/player_impact.json pipeline/league_avg_impact.json pipeline/pbp_metrics.json 2>/dev/null || true

    git commit -m "Auto-Update: Daily Pipeline [$TIMESTAMP]"

    echo "$LOG_PREFIX Pushing to origin main..."
    git push origin main && echo "$LOG_PREFIX Push succeeded." || echo "$LOG_PREFIX Push failed — will retry next cycle."
else
    echo "$LOG_PREFIX No changes detected. Repository is up to date."
fi

echo "$LOG_PREFIX Done."
