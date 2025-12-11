#!/bin/bash

# Configuration
INTERVAL=1800 # 30 minutes in seconds

echo "Checking execution environment..."
# Ensure we are in the correct directory (HockeyData) by checking for a known file
if [ ! -f "fetch_upcoming.py" ]; then
    echo "Error: Please run this script from the HockeyData directory."
    exit 1
fi

echo "Starting Goalie & Odds Monitor..."
echo "Monitoring Interval: 30 minutes"
echo "Press [CTRL+C] to stop."
echo "---------------------------------------------------"

while true; do
    TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
    echo "[$TIMESTAMP] Starting update cycle..."

    # 1. Fetch Schedule & Goalie Status
    echo "[$TIMESTAMP] Fetching schedule & goalies..."
    if python3 fetch_upcoming.py; then
        echo "[$TIMESTAMP] Schedule updated."
    else
        echo "[$TIMESTAMP] Error fetching schedule."
    fi

    # 2. Fetch Odds
    echo "[$TIMESTAMP] Fetching odds..."
    if python3 fetch_odds.py; then
        echo "[$TIMESTAMP] Odds updated."
    else
        echo "[$TIMESTAMP] Error fetching odds."
    fi

    # 3. Generate Predictions & Sync
    echo "[$TIMESTAMP] Generating predictions csv..."
    if python3 predict_games.py; then
        echo "[$TIMESTAMP] Predictions generated & synced."
    else
        echo "[$TIMESTAMP] Error generating predictions."
    fi

    echo "[$TIMESTAMP] Cycle complete. Sleeping for 30 minutes..."
    echo "---------------------------------------------------"
    
    sleep $INTERVAL
done
