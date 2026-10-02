import { describe, expect, it, vi } from 'vitest';

import { dispatchDataRefresh, dispatchWorkflow, etDate, gamesDue, leadWindow, runOnce } from '../src/trigger.js';
import worker from '../src/worker.js';

type Call = { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } };

const SCHEDULE = {
  gameWeek: [
    {
      date: '2026-10-01',
      games: [
        { id: 2026020009, gameType: 2, gameState: 'FUT', startTimeUTC: '2026-10-01T23:00:00Z', homeTeam: { abbrev: 'NJD' }, awayTeam: { abbrev: 'PHI' } },
        { id: 2026020010, gameType: 2, gameState: 'FUT', startTimeUTC: '2026-10-01T23:00:00Z', homeTeam: { abbrev: 'NYR' }, awayTeam: { abbrev: 'TBL' } },
        { id: 2026020011, gameType: 2, gameState: 'FUT', startTimeUTC: '2026-10-01T23:08:00Z', homeTeam: { abbrev: 'CBJ' }, awayTeam: { abbrev: 'BUF' } },
        { id: 2026020012, gameType: 2, gameState: 'FUT', startTimeUTC: '2026-10-02T00:00:00Z', homeTeam: { abbrev: 'NSH' }, awayTeam: { abbrev: 'MIN' } },
        { id: 2026010001, gameType: 1, gameState: 'FUT', startTimeUTC: '2026-10-01T23:00:00Z', homeTeam: { abbrev: 'BOS' }, awayTeam: { abbrev: 'MTL' } },
        { id: 2026020008, gameType: 2, gameState: 'LIVE', startTimeUTC: '2026-10-01T22:55:00Z', homeTeam: { abbrev: 'TOR' }, awayTeam: { abbrev: 'NYI' } },
      ],
    },
  ],
};

const ENV = {
  GITHUB_TOKEN: 'test-token-not-real',
  GITHUB_REPO: 'owner/repo',
  WORKFLOW_FILE: 'odds_close.yml',
  GITHUB_REF: 'main',
  LEAD_MAX_MIN: '13',
  CRON_INTERVAL_MIN: '5',
};

const at = (iso: string) => Date.parse(iso);

/** Mocked fetch: NHL schedule + GitHub dispatch endpoint. */
function mockFetch(opts: { dispatchStatus?: number[]; scheduleStatus?: number; schedule?: unknown } = {}) {
  const calls: Call[] = [];
  const statuses = [...(opts.dispatchStatus ?? [204])];
  const fn = vi.fn(async (url: string, init?: Call['init']) => {
    calls.push({ url, init });
    if (url.startsWith('https://api-web.nhle.com/v1/schedule/')) {
      const status = opts.scheduleStatus ?? 200;
      return { ok: status === 200, status, json: async () => opts.schedule ?? SCHEDULE, text: async () => '' };
    }
    if (url.startsWith('https://api.github.com/')) {
      const status = statuses.length > 1 ? (statuses.shift() as number) : statuses[0];
      return { ok: status >= 200 && status < 300, status, json: async () => ({}), text: async () => `status ${status}` };
    }
    throw new Error(`unexpected URL ${url}`);
  });
  return { fn, calls };
}

describe('lead window and selection', () => {
  it('uses (LEAD_MAX - interval, LEAD_MAX]', () => {
    expect(leadWindow(ENV)).toEqual({ min: 8, max: 13 });
    expect(leadWindow({})).toEqual({ min: 8, max: 13 });
    expect(leadWindow({ LEAD_MAX_MIN: 'x', CRON_INTERVAL_MIN: '-1' })).toEqual({ min: 8, max: 13 });
  });

  it('computes the Eastern date, not the UTC date', () => {
    expect(etDate(at('2026-10-02T02:30:00Z'))).toBe('2026-10-01');
    expect(etDate(at('2026-10-01T15:00:00Z'))).toBe('2026-10-01');
  });

  it('picks regular-season pregame games starting 8-13 min out', () => {
    const due = gamesDue(SCHEDULE, at('2026-10-01T22:50:00Z'), { min: 8, max: 13 });
    expect(due.map((g) => g.id)).toEqual([2026020009, 2026020010]);
    expect(due[0]).toMatchObject({ leadMin: 10, matchup: 'PHI@NJD' });
  });

  it('triggers every game exactly once across consecutive 5-minute runs', () => {
    const seen: number[] = [];
    const start = at('2026-10-01T22:00:00Z');
    for (let t = start; t <= at('2026-10-02T01:00:00Z'); t += 5 * 60000) {
      seen.push(...gamesDue(SCHEDULE, t, leadWindow(ENV)).map((g) => g.id));
    }
    expect(seen.sort()).toEqual([2026020009, 2026020010, 2026020011, 2026020012]);
  });
});

describe('runOnce with mocked schedule and GitHub API', () => {
  it('dispatches odds_close.yml once with the due game ids', async () => {
    const { fn, calls } = mockFetch();
    const r = await runOnce(ENV, at('2026-10-01T22:50:00Z'), fn);
    expect(r).toMatchObject({ date: '2026-10-01', dispatched: true, status: 204 });
    expect(calls[0].url).toBe('https://api-web.nhle.com/v1/schedule/2026-10-01');
    const gh = calls.filter((c) => c.url.startsWith('https://api.github.com/'));
    expect(gh).toHaveLength(1);
    expect(gh[0].url).toBe('https://api.github.com/repos/owner/repo/actions/workflows/odds_close.yml/dispatches');
    expect(gh[0].init?.method).toBe('POST');
    expect(gh[0].init?.headers?.Authorization).toBe('Bearer test-token-not-real');
    expect(gh[0].init?.headers?.['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(JSON.parse(gh[0].init?.body ?? '{}')).toEqual({
      ref: 'main',
      inputs: { window: '25', games: '2026020009,2026020010', trigger: 'worker' },
    });
  });

  it('does nothing when no game is due', async () => {
    const { fn, calls } = mockFetch();
    const r = await runOnce(ENV, at('2026-10-01T22:30:00Z'), fn);
    expect(r).toMatchObject({ dispatched: false, due: [] });
    expect(calls.some((c) => c.url.includes('api.github.com'))).toBe(false);
  });

  it('survives a schedule outage without dispatching', async () => {
    const { fn, calls } = mockFetch({ scheduleStatus: 503 });
    const r = await runOnce(ENV, at('2026-10-01T22:50:00Z'), fn);
    expect(r).toMatchObject({ dispatched: false, error: 'schedule HTTP 503' });
    expect(calls).toHaveLength(1);
  });

  it('retries a GitHub 5xx once, but not a 401', async () => {
    const flaky = mockFetch({ dispatchStatus: [502, 204] });
    expect(await runOnce(ENV, at('2026-10-01T22:50:00Z'), flaky.fn)).toMatchObject({ dispatched: true });
    expect(flaky.calls.filter((c) => c.url.includes('api.github.com'))).toHaveLength(2);

    const denied = mockFetch({ dispatchStatus: [401] });
    const r = await runOnce(ENV, at('2026-10-01T22:50:00Z'), denied.fn);
    expect(r).toMatchObject({ dispatched: false, status: 401 });
    expect(denied.calls.filter((c) => c.url.includes('api.github.com'))).toHaveLength(1);
  });

  it('refuses to dispatch without a token or with a malformed repo', async () => {
    const { fn, calls } = mockFetch();
    expect(await dispatchWorkflow({ ...ENV, GITHUB_TOKEN: '' }, [], fn)).toMatchObject({ ok: false });
    expect(await dispatchWorkflow({ ...ENV, GITHUB_REPO: 'evil.com/x/y' }, [], fn)).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });

  it('remembers dispatched games in the optional KV store', async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => void store.set(k, v),
    };
    const first = mockFetch();
    await runOnce({ ...ENV, SNAPSHOT_STATE: kv }, at('2026-10-01T22:50:00Z'), first.fn);
    expect([...store.keys()].sort()).toEqual(['dispatched:2026020009', 'dispatched:2026020010']);
    const again = mockFetch();
    const r = await runOnce({ ...ENV, SNAPSHOT_STATE: kv }, at('2026-10-01T22:50:00Z'), again.fn);
    expect(r).toMatchObject({ dispatched: false, due: [] });
    expect(again.calls.some((c) => c.url.includes('api.github.com'))).toBe(false);
  });
});

describe('scheduled handler', () => {
  it('runs one pass at the scheduled time via waitUntil', async () => {
    const { fn, calls } = mockFetch();
    vi.stubGlobal('fetch', fn);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const pending: Promise<unknown>[] = [];
    await worker.scheduled({ scheduledTime: at('2026-10-01T22:50:00Z') }, ENV, { waitUntil: (p) => void pending.push(p) });
    await Promise.all(pending);
    vi.unstubAllGlobals();
    expect(calls.filter((c) => c.url.includes('api.github.com'))).toHaveLength(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).not.toContain('test-token-not-real');
  });
  it('the hourly data cron dispatches update_data.yml in auto mode, not the snapshot pass', async () => {
    const { fn, calls } = mockFetch();
    vi.stubGlobal('fetch', fn);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const pending: Promise<unknown>[] = [];
    const env = { ...ENV, DATA_CRON: '1 0-3,12-23 * * *' };
    await worker.scheduled({ scheduledTime: at('2026-10-01T22:50:00Z'), cron: '1 0-3,12-23 * * *' }, env, { waitUntil: (p) => void pending.push(p) });
    await Promise.all(pending);
    vi.unstubAllGlobals();
    expect(calls.some((c) => c.url.includes('api-web.nhle.com'))).toBe(false);
    const gh = calls.filter((c) => c.url.includes('api.github.com'));
    expect(gh).toHaveLength(1);
    expect(gh[0].url).toBe('https://api.github.com/repos/owner/repo/actions/workflows/update_data.yml/dispatches');
    expect(JSON.parse(gh[0].init!.body!)).toEqual({ ref: 'main', inputs: { mode: 'auto' } });
    expect(String(log.mock.calls[0][0])).not.toContain('test-token-not-real');
  });

  it('the 5-minute cron still runs the snapshot pass when DATA_CRON is set', async () => {
    const { fn, calls } = mockFetch();
    vi.stubGlobal('fetch', fn);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const pending: Promise<unknown>[] = [];
    const env = { ...ENV, DATA_CRON: '1 0-3,12-23 * * *' };
    await worker.scheduled({ scheduledTime: at('2026-10-01T22:50:00Z'), cron: '*/5 * * * *' }, env, { waitUntil: (p) => void pending.push(p) });
    await Promise.all(pending);
    vi.unstubAllGlobals();
    const gh = calls.filter((c) => c.url.includes('api.github.com'));
    expect(gh).toHaveLength(1);
    expect(gh[0].url).toContain('/workflows/odds_close.yml/dispatches');
  });

  it('dispatchDataRefresh refuses without a token', async () => {
    const { fn, calls } = mockFetch();
    const r = await dispatchDataRefresh({ ...ENV, GITHUB_TOKEN: undefined }, fn);
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
