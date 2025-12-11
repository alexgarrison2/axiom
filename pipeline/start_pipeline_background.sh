#!/bin/bash

# Kill any existing instance of auto_pipeline.sh to prevent duplicates
pkill -f auto_pipeline.sh

# Run auto_pipeline.sh in the background with nohup
echo "Starting auto_pipeline.sh in the background..."
nohup ./auto_pipeline.sh > pipeline.log 2>&1 &

echo "Pipeline started! (PID: $!)"
echo "Logs are being written to 'pipeline.log'."
echo "You can close this terminal window now."
