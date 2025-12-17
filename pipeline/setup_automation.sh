#!/bin/bash
# Move to the pipeline directory where the plist is located
cd "$(dirname "$0")"

echo "Installing Daily Update Automation..."

# Copy plist to LaunchAgents
cp com.nhl_predictions.daily_update.plist ~/Library/LaunchAgents/

# Unload if exists (to refresh)
launchctl unload ~/Library/LaunchAgents/com.nhl_predictions.daily_update.plist 2>/dev/null

# Load the new job
launchctl load ~/Library/LaunchAgents/com.nhl_predictions.daily_update.plist

echo "✅ Success! The update script will now run automatically every day at 6:30 AM."
echo "You can check logs at: /Users/alexgarrison/Downloads/HockeyData/nhl-predictions-app/pipeline/daily_update.log"
