# Supabase snapshot scripts

`scripts/snapshot_predictions.py` and `scripts/sync_history_to_supabase.py` push
prediction snapshots and prediction history to a Supabase Postgres database.
The site itself never reads Supabase; these are an optional side channel.

In production they run from `pipeline/refresh_pipeline.py` inside the GitHub
Actions workflow (`.github/workflows/update_data.yml`), which supplies the
connection details from repository secrets. No local cron job is needed.

## Configuration

Both scripts read the connection **only** from environment variables. Nothing
identifying the database is hardcoded in the repo.

| Variable      | Required | Notes                                            |
|---------------|----------|--------------------------------------------------|
| `DB_HOST`     | yes      | Supabase pooler host                             |
| `DB_USER`     | yes      | Pooler format: `postgres.<project-ref>`          |
| `DB_PASSWORD` | yes      | Never commit this value                          |
| `DB_NAME`     | no       | Defaults to `postgres`                           |
| `DB_PORT`     | no       | Defaults to `6543` (transaction pooler)          |

Set them as GitHub Actions secrets with the same names. For a local run, put
them in an untracked `.env` file (all `.env*` files are gitignored) or export
them in your shell.

## Manual run

From the repository root, with `psycopg2-binary` installed
(`pip3 install psycopg2-binary python-dotenv`):

```bash
export DB_HOST='<your-pooler-host>'
export DB_USER='postgres.<your-project-ref>'
export DB_PASSWORD='<your-db-password>'
python3 scripts/snapshot_predictions.py
```

If any required variable is missing the script prints which one and exits
without connecting.
