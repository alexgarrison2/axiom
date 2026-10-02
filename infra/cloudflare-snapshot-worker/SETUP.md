# Snapshot trigger: setup (about 15 minutes, free)

This small program runs on Cloudflare every 5 minutes. When an NHL game is
8-13 minutes from its start time, it tells GitHub to run the
**Odds close snapshots** workflow, which saves the closing odds and lineups.
It also starts the hourly **Update NHL Data** workflow at :01 past each hour
from 12:00 to 03:00 UTC. GitHub's own timer often fires late or skips runs
(it skipped four hours in a row on 2026-10-02); Cloudflare's does not.

You need: a computer with Node.js (already installed if you can run the site
locally), and this repository checked out. Nothing here costs money.

1. **Create a free Cloudflare account** at <https://dash.cloudflare.com/sign-up>
   (email + password, no card needed). Verify the email it sends you.

2. **Create a GitHub token that can only start workflows in this repo.**
   On GitHub open *Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token*.
   - Name: `ponyxg snapshot trigger`. Expiration: 1 year (set a reminder).
   - Repository access: **Only select repositories** → `axiom`.
   - Repository permissions: **Actions → Read and write**. Leave everything
     else at "No access" (Metadata: Read-only is added automatically).
   - Click *Generate token* and copy it. Keep the page open; you paste it in step 5.

3. **Open a terminal in this folder:**
   ```bash
   cd infra/cloudflare-snapshot-worker
   ```

4. **Log in to Cloudflare from the terminal:**
   ```bash
   npx wrangler@4 login
   ```
   A browser tab opens; click *Allow*. (If asked to install `wrangler`, answer `y`.)

5. **Store the GitHub token as a Worker secret** (it is encrypted by
   Cloudflare and never written to any file):
   ```bash
   npx wrangler@4 secret put GITHUB_TOKEN
   ```
   Paste the token from step 2 when prompted and press Enter. If it says the
   Worker does not exist yet and offers to create it, answer `y`.

6. **Deploy:**
   ```bash
   npx wrangler@4 deploy
   ```
   It prints a URL like `https://ponyxg-snapshot-trigger.<you>.workers.dev`
   and two schedules: `*/5 * * * *` and `1 0-3,12-23 * * *`.

7. **Check it:** open that URL in a browser. You should see
   `"token_configured": true` and the games starting in the next hour.
   (The page is read-only: it cannot start anything.)

8. **Watch the first triggers:** at :01 past the next hour, GitHub → *Actions* →
   *Update NHL Data* should show a new `workflow_dispatch` run.
   **Snapshot trigger:** about 10 minutes before the next game, open
   GitHub → *Actions* → *Odds close snapshots*. A run with the trigger
   `worker` should appear. Live logs: `npx wrangler@4 tail`.

9. **Turn off GitHub's backup timer** (saves Actions minutes) once you have
   seen a few `worker` runs: GitHub → repo *Settings → Secrets and variables →
   Actions → Variables → New repository variable*, name `SNAPSHOT_CRON`,
   value `off`. The morning slate sweep keeps running. Delete the variable to
   turn the backup back on.

10. **Once a year:** when the token expires, repeat step 2 and step 5
    (no redeploy needed).

## If something goes wrong

- *Dashboard shows errors with status 401/403*: the token expired or lacks
  "Actions: Read and write" on this repo. Redo steps 2 and 5.
- *Status 404*: `GITHUB_REPO` in `wrangler.toml` is not `owner/name` of this
  repo, or `odds_close.yml` is not on the `main` branch yet.
- *Nothing happens on game days*: Cloudflare dashboard → Workers →
  `ponyxg-snapshot-trigger` → *Settings → Triggers* should list the cron.
- To stop it entirely: `npx wrangler@4 delete` (GitHub's backup timer still
  works if `SNAPSHOT_CRON` is not `off`).

## For developers

- Code: `src/trigger.js` (logic) and `src/worker.js` (entry point); config: `wrangler.toml`; tests:
  `npx vitest run infra` from the repo root (mocked schedule and GitHub API).
- Local run without credentials: `npx wrangler@4 dev --test-scheduled`, then
  `curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"`.
- Each game triggers exactly once without any storage: the lead window
  (8, 13] minutes is one cron interval wide and is measured from the run's
  scheduled time. Optionally bind a KV namespace as `SNAPSHOT_STATE` to also
  remember dispatched games for a day.
- Free-plan budget: 288 cron runs a day, each one schedule request plus at
  most one GitHub API call, far inside the 100,000 requests/day limit.
