/**
 * Cloudflare Worker entry point for the pony xG snapshot trigger.
 * The logic and its documentation live in ./trigger.js; this module must only
 * have a default export (the runtime treats named exports as entrypoints).
 */
import { SCHEDULE_URL, dispatchDataRefresh, etDate, gamesDue, leadWindow, runOnce } from './trigger.js';

/** @typedef {import('./trigger.js').Env} Env */
/** @typedef {import('./trigger.js').FetchLike} FetchLike */
/** @typedef {import('./trigger.js').NhlSchedule} NhlSchedule */

const handler = {
  /**
   * @param {{ scheduledTime: number, cron?: string }} event
   * @param {Env} env
   * @param {{ waitUntil(p: Promise<unknown>): void }} ctx
   */
  async scheduled(event, env, ctx) {
    const nowMs = event.scheduledTime;
    if (env.DATA_CRON && event.cron === env.DATA_CRON) {
      ctx.waitUntil(
        dispatchDataRefresh(env, /** @type {FetchLike} */ (/** @type {unknown} */ (fetch))).then((r) => {
          console.log(JSON.stringify({ at: new Date(nowMs).toISOString(), data_refresh: r }));
        }),
      );
      return;
    }
    ctx.waitUntil(
      runOnce(env, nowMs, /** @type {FetchLike} */ (/** @type {unknown} */ (fetch))).then((r) => {
        if (r.due.length || r.error) console.log(JSON.stringify({ at: new Date(nowMs).toISOString(), ...r }));
      }),
    );
  },

  /**
   * Read-only status page: what would trigger in the next hour.  Never
   * dispatches and never reveals the token.
   * @param {Request} _request
   * @param {Env} env
   */
  async fetch(_request, env) {
    const nowMs = Date.now();
    let upcoming = [];
    try {
      const res = await fetch(`${SCHEDULE_URL}${etDate(nowMs)}`, { headers: { 'User-Agent': 'ponyxg-snapshot-worker' } });
      upcoming = gamesDue(/** @type {NhlSchedule} */ (await res.json()), nowMs, { min: 0, max: 60 });
    } catch {
      upcoming = [];
    }
    const body = {
      ok: true,
      repo: env.GITHUB_REPO ?? null,
      workflow: env.WORKFLOW_FILE ?? 'odds_close.yml',
      data_workflow: env.DATA_CRON ? `${env.DATA_WORKFLOW_FILE ?? 'update_data.yml'} at "${env.DATA_CRON}"` : null,
      token_configured: Boolean(env.GITHUB_TOKEN),
      lead_window_min: leadWindow(env),
      games_starting_within_60_min: upcoming,
    };
    return new Response(JSON.stringify(body, null, 2), { headers: { 'content-type': 'application/json' } });
  },
};

export default handler;
