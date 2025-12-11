#!/bin/bash

# Configuration
INTERVAL=900 # 15 minutes (900 seconds)

# ANSI Colors for nicer output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}   NHL DATA PIPELINE & AUTO-SYNC | STARTED       ${NC}"
echo -e "${BLUE}=================================================${NC}"
echo -e "Update Interval: ${YELLOW}15 minutes${NC}"
echo -e "Press [CTRL+C] to stop."
echo ""

while true; do
    TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
    echo -e "${GREEN}[$TIMESTAMP] Starting Update Cycle...${NC}"

    # --- Step 1: Data Fetching ---
    echo -e "${YELLOW}>> Fetching Latest Schedule & Goalies (DailyFaceoff)...${NC}"
    if python3 fetch_upcoming.py; then
        echo -e "${GREEN}✓ Schedule Updated${NC}"
    else
        echo -e "${RED}✗ Error Fetching Schedule${NC}"
    fi
    
    echo -e "${YELLOW}>> Fetching Latest Odds...${NC}"
    if python3 fetch_odds.py; then
        echo -e "${GREEN}✓ Odds Updated${NC}"
    else
         # Don't exit, just warn. Odds might fail if API is down but we still want goalie updates.
        echo -e "${RED}✗ Error Fetching Odds (Continuing...)${NC}"
    fi

    # --- Step 2: Prediction & Local Sync ---
    echo -e "${YELLOW}>> Generating Predictions & Syncing to App...${NC}"
    # predict_games.py handles the write to nhl-predictions-app/data/predictions_detailed.csv
    if python3 predict_games.py; then
         echo -e "${GREEN}✓ Predictions Generated${NC}"
    else
         echo -e "${RED}✗ Error Generating Predictions${NC}"
    fi

    # --- Step 3: Git Sync ---
    echo -e "${YELLOW}>> Checking for changes to push to GitHub...${NC}"
    cd nhl-predictions-app || exit

    # Check for changes in the data directory specifically or just all changes
    if [[ -n $(git status --porcelain) ]]; then
        echo "Changes detected. Committing..."
        git add .
        git commit -m "Auto-Update: Data & Predictions [$TIMESTAMP]"
        
        echo "Pushing to origin main..."
        if git push origin main; then
            echo -e "${GREEN}✓ Successfully Pushed to GitHub${NC}"
        else
            echo -e "${RED}✗ Git Push Failed${NC}"
        fi
    else
        echo "No changes detected. Repository is up to date."
    fi
    
    # Return to root
    cd ..

    echo -e "${GREEN}[$TIMESTAMP] Cycle Complete. Next update in 15 minutes...${NC}"
    echo "---------------------------------------------------"
    
    sleep $INTERVAL
done
