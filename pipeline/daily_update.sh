#!/bin/bash

# Log file
LOGFILE="/Users/alexgarrison/Downloads/HockeyData/nhl-predictions-app/pipeline/daily_update.log"

echo "========================================" >> "$LOGFILE"
echo "Starting Daily Update: $(date)" >> "$LOGFILE"

# Change directory to the pipeline folder
cd /Users/alexgarrison/Downloads/HockeyData/nhl-predictions-app/pipeline || { echo "Failed to cd to pipeline dir"; exit 1; }

# Run the refresh pipeline
# Using full path to python3 as detected
/Library/Frameworks/Python.framework/Versions/3.13/bin/python3 refresh_pipeline.py >> "$LOGFILE" 2>&1

echo "Daily Update Finished: $(date)" >> "$LOGFILE"
echo "========================================" >> "$LOGFILE"
