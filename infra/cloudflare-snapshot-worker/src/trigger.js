/**
 * pony xG snapshot trigger (Cloudflare Worker, free plan): the logic.
 * src/worker.js is the entry point; this is a separate module because the
 * Workers runtime treats every named export of the entry module as an
 * entrypoint.
 *
 * Every 5 minutes (wrangler.toml cron) it reads today's NHL schedule and, when
 * one or more games start in (LEAD_MAX_MIN - CRON_INTERVAL_MIN, LEAD_MAX_MIN]
 * minutes (default 8-13), asks GitHub to run .github/workflows/odds_close.yml
 * (workflow_dispatch).  That workflow captures the closing prices and lineups
 * (docs/SNAPSHOTS.md).
 *
 * De-duplication is stateless: the lead window is exactly one cron interval
 * wide and measured from the run's scheduled time, so each start time falls
 * in exactly one run and each game triggers once.  If a KV namespace is bound
 * as SNAPSHOT_STATE (optional), dispatched game ids are also remembered for a
 * day and never re-sent.
 *
 * A second cron (DATA_CRON, hourly through the NHL day) asks GitHub to run
 * .github/workflows/update_data.yml in auto mode, because GitHub's own
 * schedule for that workflow is often skipped for hours at a time.
 *
 * Secrets / vars (see SETUP.md): GITHUB_TOKEN (secret: fine-grained token,
 * this repository only, "Actions: Read and write"), GITHUB_REPO, WORKFLOW_FILE,
 * GITHUB_REF, LEAD_MAX_MIN, CRON_INTERVAL_MIN, DATA_CRON, DATA_WORKFLOW_FILE.  The token is only ever sent
 * to api.github.com and is never logged or returned.
 */

export const SCHEDULE_URL = 'https://api-web.nhle.com/v1/schedule/';
export const GITHUB_API = 'https://api.github.com';
const PREGAME_STATES = new Set(['FUT', 'PRE']);
const COUNTED_TYPES = new Set([2, 3]); // regular season, playoffs

/** @typedef {{ id: number, startTimeUTC: string, gameState?: string, gameType?: number,
 *   homeTeam?: { abbrev?: string }, awayTeam?: { abbrev?: string } }} NhlGame */
/** @typedef {{ gameWeek?: Array<{ date?: string, games?: NhlGame[] }> }} NhlSchedule */
/** @typedef {{ id: number, start: string, leadMin: number, matchup: string }} DueGame */
/** @typedef {{ get(key: string): Promise<string | null>,
 *   put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> }} KvLike */
/** @typedef {{ GITHUB_TOKEN?: string, GITHUB_REPO?: string, WORKFLOW_FILE?: string, GITHUB_REF?: string,
 *   LEAD_MAX_MIN?: string, CRON_INTERVAL_MIN?: string, DATA_CRON?: string, DATA_WORKFLOW_FILE?: string,
 *   SNAPSHOT_STATE?: KvLike }} Env */
/** @typedef {(input: string, init?: { method?: string, headers?: Record<string, string>, body?: string })
 *   => Promise<{ ok: boolean, status: number, json(): Promise<unknown>, text(): Promise<string> }>} FetchLike */

/**
 * Today's date in America/New_York (the NHL schedules by Eastern time).
 * @param {number} ms
 * @returns {string} YYYY-MM-DD
 */
export function etDate(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

/**
 * Lead window (exclusive min, inclusive max), in minutes.
 * @param {Env} env
 * @returns {{ min: number, max: number }}
 */
export function leadWindow(env) {
  const max = Number(env.LEAD_MAX_MIN ?? 13);
  const interval = Number(env.CRON_INTERVAL_MIN ?? 5);
  const safeMax = Number.isFinite(max) && max > 0 ? max : 13;
  const safeInterval = Number.isFinite(interval) && interval > 0 ? interval : 5;
  return { min: safeMax - safeInterval, max: safeMax };
}

/**
 * Games whose scheduled start is within (min, max] minutes of `nowMs`.
 * @param {NhlSchedule} schedule
 * @param {number} nowMs
 * @param {{ min: number, max: number }} window
 * @returns {DueGame[]}
 */
export function gamesDue(schedule, nowMs, window) {
  /** @type {DueGame[]} */
  const out = [];
  const seen = new Set();
  for (const day of schedule?.gameWeek ?? []) {
    for (const g of day?.games ?? []) {
      if (!g || seen.has(g.id)) continue;
      seen.add(g.id);
      if (!PREGAME_STATES.has(String(g.gameState ?? 'FUT'))) continue;
      if (g.gameType != null && !COUNTED_TYPES.has(Number(g.gameType))) continue;
      const start = Date.parse(g.startTimeUTC);
      if (!Number.isFinite(start)) continue;
      const leadMin = (start - nowMs) / 60000;
      if (leadMin > window.min && leadMin <= window.max) {
        out.push({
          id: g.id, start: g.startTimeUTC, leadMin: Math.round(leadMin * 10) / 10,
          matchup: `${g.awayTeam?.abbrev ?? '?'}@${g.homeTeam?.abbrev ?? '?'}`,
        });
      }
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
}

/**
 * Ask GitHub to run the snapshot workflow.
 * @param {Env} env
 * @param {DueGame[]} games
 * @param {FetchLike} fetchImpl
 * @returns {Promise<{ ok: boolean, status: number, detail?: string }>}
 */
export async function dispatchWorkflow(env, games, fetchImpl) {
  return dispatch(env, env.WORKFLOW_FILE ?? 'odds_close.yml',
    { window: '25', games: games.map((g) => String(g.id)).join(','), trigger: 'worker' }, fetchImpl);
}

/**
 * Ask GitHub to run the hourly data refresh (update_data.yml, auto mode).
 * @param {Env} env
 * @param {FetchLike} fetchImpl
 */
export async function dispatchDataRefresh(env, fetchImpl) {
  return dispatch(env, env.DATA_WORKFLOW_FILE ?? 'update_data.yml', { mode: 'auto' }, fetchImpl);
}

/**
 * POST a workflow_dispatch for `file` with `inputs`.
 * @param {Env} env
 * @param {string} file
 * @param {Record<string, string>} inputs
 * @param {FetchLike} fetchImpl
 * @returns {Promise<{ ok: boolean, status: number, detail?: string }>}
 */
async function dispatch(env, file, inputs, fetchImpl) {
  if (!env.GITHUB_TOKEN) return { ok: false, status: 0, detail: 'GITHUB_TOKEN secret is not set' };
  const repo = env.GITHUB_REPO ?? '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { ok: false, status: 0, detail: 'GITHUB_REPO must be owner/name' };
  const url = `${GITHUB_API}/repos/${repo}/actions/workflows/${encodeURIComponent(file)}/dispatches`;
  const body = JSON.stringify({ ref: env.GITHUB_REF ?? 'main', inputs });
  /** @type {{ ok: boolean, status: number, detail?: string }} */
  let last = { ok: false, status: 0 };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'ponyxg-snapshot-worker',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body,
      });
      if (res.status === 204 || res.ok) return { ok: true, status: res.status };
      last = { ok: false, status: res.status, detail: (await res.text()).slice(0, 200) };
      if (res.status < 500 && res.status !== 429) break; // 401/403/404/422: retrying will not help
    } catch (e) {
      last = { ok: false, status: 0, detail: String(e).slice(0, 200) };
    }
  }
  return last;
}

/**
 * One trigger pass.  Never throws.
 * @param {Env} env
 * @param {number} nowMs scheduled time of this cron run
 * @param {FetchLike} fetchImpl
 */
export async function runOnce(env, nowMs, fetchImpl) {
  const window = leadWindow(env);
  const date = etDate(nowMs);
  /** @type {NhlSchedule} */
  let schedule;
  try {
    const res = await fetchImpl(`${SCHEDULE_URL}${date}`, { headers: { 'User-Agent': 'ponyxg-snapshot-worker' } });
    if (!res.ok) return { date, due: [], dispatched: false, error: `schedule HTTP ${res.status}` };
    schedule = /** @type {NhlSchedule} */ (await res.json());
  } catch (e) {
    return { date, due: [], dispatched: false, error: `schedule: ${String(e).slice(0, 120)}` };
  }
  let due = gamesDue(schedule, nowMs, window);
  const kv = env.SNAPSHOT_STATE;
  if (kv && due.length) {
    const fresh = [];
    for (const g of due) {
      if (!(await kv.get(`dispatched:${g.id}`))) fresh.push(g);
    }
    due = fresh;
  }
  if (!due.length) return { date, due, dispatched: false };
  const result = await dispatchWorkflow(env, due, fetchImpl);
  if (result.ok && kv) {
    for (const g of due) await kv.put(`dispatched:${g.id}`, String(nowMs), { expirationTtl: 86400 });
  }
  return { date, due, dispatched: result.ok, status: result.status, error: result.ok ? undefined : result.detail };
}
