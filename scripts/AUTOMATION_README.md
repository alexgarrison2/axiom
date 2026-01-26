# Automation Instructions

To run the prediction snapshot script automatically at 9am, 2pm, and 6pm Central Time, follow these steps to set up a cron job on your machine.

## Prerequisites

1. **Python dependencies**: Ensure `psycopg2-binary` is installed.

   ```bash
   pip3 install psycopg2-binary
   ```

2. **Database Password**: You will need your Supabase database password.

## Cron Schedule

The cron expression for 9am, 2pm (14:00), and 6pm (18:00) is:
`0 9,14,18 * * *`

## Setup Steps

1. Open your terminal.
2. Type `crontab -e` to edit your cron jobs.
3. Add the following line to the file (adjust the paths to match your system):

```bash
0 9,14,18 * * * cd /Users/alexgarrison/Downloads/HockeyData/nhl-predictions-app && DB_PASSWORD='YOUR_SUPABASE_DB_PASSWORD' /usr/bin/python3 scripts/snapshot_predictions.py >> /tmp/snapshot.log 2>&1
```

> **Important**: Replace `YOUR_SUPABASE_DB_PASSWORD` with your actual Supabase database password.
> The `>> /tmp/snapshot.log 2>&1` part is optional but recommended to log the output for debugging.

## Verification

You can test the script manually by running:

```bash
export DB_PASSWORD='somfo6-wiprip-Devzuj'
python3 scripts/snapshot_predictions.py
```
