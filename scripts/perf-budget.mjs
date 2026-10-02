#!/usr/bin/env node
/*
 * Performance budgets for the CI quality gate.
 *
 *   node scripts/perf-budget.mjs --base-url http://localhost:3100   # page budgets
 *   node scripts/perf-budget.mjs --traces                           # function trace sizes (after next build)
 *
 * Page budgets load every route in tests/routes.json cold (cache disabled) in
 * headless Chromium on a throttled mid-range phone profile (Lighthouse "slow 4G"
 * style: 4x CPU slowdown, 150ms RTT, 1.6Mbps down / 750Kbps up, 390x844 @3x)
 * and check payload bytes (deterministic) and timings (median of --runs).
 *
 * Options:
 *   --base-url URL     server to test (default $PLAYWRIGHT_BASE_URL or http://localhost:3100)
 *   --routes /,/teams  subset of tests/routes.json
 *   --runs N           loads per route; timing metrics use the median (default 3)
 *   --out FILE         write the full JSON report
 *   --traces           check .next/server/**\/*.nft.json traced sizes instead
 * Env:
 *   PERF_TIMING_SLACK  multiplier applied to timing budgets only (default 1).
 *                      CI sets 1.25 to absorb shared-runner CPU variance.
 *
 * Exit code 1 when any budget is exceeded or a route fails to load.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── Budgets ──────────────────────────────────────────────────────────────── */

// Sizes in KB (1024 bytes). htmlKB = decoded document, htmlGzKB = document as
// transferred, jsKB = compressed script bytes, totalKB = everything transferred
// during a cold load (HTML, JS, CSS, fonts, images, data fetches).
export const DEFAULT_BUDGET = {
    ttfbMs: 800,
    lcpMs: 3000,
    tbtMs: 300,
    cls: 0.1,
    htmlKB: 400,
    htmlGzKB: 60,
    jsKB: 250,
    totalKB: 1200,
    domNodes: 3000,
};

// Targets come from the workstream acceptance criteria (E7, F6, F7, G2, G3, G5).
export const ROUTE_BUDGETS = {
    '/': { lcpMs: 2500, tbtMs: 150, htmlKB: 400, htmlGzKB: 40, jsKB: 200, totalKB: 700, domNodes: 2500 },
    '/teams': { lcpMs: 2000, tbtMs: 200, jsKB: 250, totalKB: 900 },
    '/teams/EDM': { lcpMs: 3000, tbtMs: 250, jsKB: 250, totalKB: 900 },
    '/players': { tbtMs: 150, domNodes: 3000 },
    '/accuracy': { tbtMs: 200, domNodes: 3000 },
    '/playoffs/20252026': { htmlGzKB: 60, totalKB: 1000 },
};

const TIMING_METRICS = new Set(['ttfbMs', 'lcpMs', 'tbtMs']);

export function budgetFor(route) {
    return { ...DEFAULT_BUDGET, ...(ROUTE_BUDGETS[route] ?? {}) };
}

/**
 * Compare measured metrics against a budget. Timing budgets are scaled by
 * `slack`; byte, DOM and CLS budgets are exact.
 * @returns {{metric: string, value: number, limit: number, pass: boolean}[]}
 */
export function evaluateBudgets(metrics, budget, slack = 1) {
    return Object.entries(budget).map(([metric, base]) => {
        const limit = TIMING_METRICS.has(metric) ? Math.round(base * slack) : base;
        const value = metrics[metric];
        const pass = typeof value === 'number' && Number.isFinite(value) && value <= limit;
        return { metric, value, limit, pass };
    });
}

/* ── Function trace budgets ───────────────────────────────────────────────── */

const MB = 1024 * 1024;
export const TRACE_BUDGET_MB = { default: 50, '/': 5, '/playoffs': 15 };

export function traceRouteFromNft(nftRel) {
    // .next/server/app/teams/[teamAbbr]/page.js.nft.json -> /teams/[teamAbbr]
    const m = nftRel.replace(/\\/g, '/').match(/\.next\/server\/app(.*)\/(page|route)\.js\.nft\.json$/);
    if (!m) return null;
    return m[1] || '/';
}

export function traceLimitMB(route) {
    if (route === '/') return TRACE_BUDGET_MB['/'];
    if (route === '/playoffs' || route.startsWith('/playoffs/')) return TRACE_BUDGET_MB['/playoffs'];
    return TRACE_BUDGET_MB.default;
}

/*
 * Files each function reads with fs at request time (ISR re-renders, dynamic
 * routes). The build fails --traces when a route's nft.json lacks one of them,
 * because on Vercel the function would silently fall back to empty data.
 * Source of truth: `grep -rnE "readFile|readdir|existsSync" app utils lib
 * components`. `*` matches within one path segment. A file absent on disk at
 * build time (e.g. the pipeline-written manifest.json in a fresh checkout) is
 * reported but not failed: nft can only trace files that exist.
 */
const STAMP_FILES = ['data/last_updated.json', 'public/data/last_updated.json', 'public/data/manifest.json'];
const READ_DATA = ['public/data/player_bio.json', 'public/data/player_news.json',
    'public/data/upcoming_games.json', 'public/data/season_projections.json', 'public/data/team_ratings.json'];
export const RUNTIME_TRACE_REQUIREMENTS = {
    '/': ['data/predictions_detailed.csv', 'data/prediction_history.json', 'public/data/upcoming_games.json',
        'public/data/season_projections.json', 'public/data/playoff_series.json', 'public/data/game_implications.json',
        ...STAMP_FILES],
    '/accuracy': ['public/data/model_report.json', 'public/data/bet_ledger.json', 'public/data/gamestats.csv',
        'data/prediction_history.json', ...STAMP_FILES],
    '/methodology': ['public/data/model_report.json', ...STAMP_FILES],
    '/news': ['pipeline/data/nhl_schedule_*.json', ...READ_DATA, ...STAMP_FILES],
    '/players': ['public/data/player_ratings.json', 'public/data/player_bio.json', ...STAMP_FILES],
    '/standings': [...READ_DATA, ...STAMP_FILES],
    '/teams/[teamAbbr]': ['pipeline/data/nhl_schedule_*.json', 'public/data/upcoming_games.json',
        'public/data/gamestats.csv', 'public/data/nhl_teams.csv', ...STAMP_FILES],
    '/api/matchup-details': ['data/predictions_detailed.csv', 'data/prediction_history.json',
        'public/data/team_goalies.json', 'public/data/goalie_season_lines.json', 'public/data/goalie_ratings.json',
        'public/data/injuries.json', 'public/data/player_ratings.json', 'public/data/team_lineups.json', 'public/data/gamestats.csv'],
    '/api/odds-history': ['public/data/SiteHistory/*.csv'],
    '/opengraph-image': ['data/predictions_detailed.csv'],
};

const globRe = (g) => new RegExp('^' + g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');

/**
 * Required files missing from a route's trace. `traced` are repo-relative
 * paths; `exists(glob)` says whether the requirement has any file on disk.
 * Returns { missing, absent }: missing = on disk but not traced (a failure),
 * absent = not on disk at build time (a note).
 * @param {string} route
 * @param {string[]} traced
 * @param {(glob: string) => boolean} [exists]
 */
export function missingTraceFiles(route, traced, exists = /** @type {(glob: string) => boolean} */ (() => true)) {
    const need = RUNTIME_TRACE_REQUIREMENTS[route] ?? [];
    const missing = [];
    const absent = [];
    for (const g of need) {
        const re = globRe(g);
        if (traced.some((f) => re.test(f))) continue;
        (exists(g) ? missing : absent).push(g);
    }
    return { missing, absent };
}

function existsOnDisk(glob) {
    if (!glob.includes('*')) return fs.existsSync(path.join(ROOT, glob));
    const dir = path.join(ROOT, path.dirname(glob));
    const re = globRe(path.basename(glob));
    try {
        return fs.readdirSync(dir).some((f) => re.test(f));
    } catch {
        return false;
    }
}

function checkTraces() {
    const serverDir = path.join(ROOT, '.next', 'server');
    if (!fs.existsSync(serverDir)) {
        console.error('No .next/server directory. Run `npm run build` first.');
        process.exit(2);
    }
    const nfts = [];
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.nft.json')) nfts.push(p);
        }
    };
    walk(serverDir);
    const rows = [];
    for (const nft of nfts) {
        const route = traceRouteFromNft(path.relative(ROOT, nft));
        if (!route) continue;
        const { files } = JSON.parse(fs.readFileSync(nft, 'utf8'));
        let bytes = 0;
        const big = [];
        for (const rel of files) {
            const abs = path.resolve(path.dirname(nft), rel);
            let st;
            try { st = fs.statSync(abs); } catch { continue; }
            if (!st.isFile()) continue;
            bytes += st.size;
            if (st.size > MB && !abs.includes(`${path.sep}node_modules${path.sep}`)) big.push(`${path.relative(ROOT, abs)} ${(st.size / MB).toFixed(1)}MB`);
        }
        const limit = traceLimitMB(route);
        const traced = files.map((rel) => path.relative(ROOT, path.resolve(path.dirname(nft), rel)).split(path.sep).join('/'));
        const { missing, absent } = missingTraceFiles(route, traced, existsOnDisk);
        rows.push({ route, mb: bytes / MB, limit, pass: bytes / MB <= limit && missing.length === 0, big, missing, absent });
    }
    rows.sort((a, b) => b.mb - a.mb);
    let failed = 0;
    for (const r of rows) {
        if (!r.pass) failed++;
        const over = r.mb > r.limit ? `\n       largest: ${r.big.slice(0, 5).join(', ')}` : '';
        const miss = r.missing.length ? `\n       not traced (read at runtime): ${r.missing.join(', ')}` : '';
        const note = r.absent.length ? `\n       note: not on disk at build, cannot trace: ${r.absent.join(', ')}` : '';
        console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.mb.toFixed(1).padStart(6)}MB / ${String(r.limit).padStart(2)}MB  ${r.route}${over}${miss}${note}`);
    }
    const unseen = Object.keys(RUNTIME_TRACE_REQUIREMENTS).filter((k) => !rows.some((r) => r.route === k));
    if (unseen.length) {
        failed += unseen.length;
        console.log(`FAIL no function trace for runtime route(s): ${unseen.join(', ')}`);
    }
    console.log(failed ? `\n${failed} function trace(s) over budget or missing runtime files.` : '\nAll function traces within budget and every runtime-read file is traced.');
    return failed === 0;
}

/* ── Page budgets ─────────────────────────────────────────────────────────── */

export const PROFILE = {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    cpuSlowdown: 4,
    network: { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
};

// Registered before any page script so buffered entries are never missed.
const OBSERVERS = `(() => {
  const p = (window.__perf = { lcp: 0, cls: 0, longtasks: [] });
  const obs = (type, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch {} };
  obs('largest-contentful-paint', (e) => { p.lcp = e.startTime; });
  obs('layout-shift', (e) => { if (!e.hadRecentInput) p.cls += e.value; });
  obs('longtask', (e) => { p.longtasks.push([e.startTime, e.duration]); });
})();`;

async function measureOnce(browser, url) {
    const context = await browser.newContext({
        viewport: PROFILE.viewport,
        deviceScaleFactor: PROFILE.deviceScaleFactor,
        isMobile: PROFILE.isMobile,
        hasTouch: PROFILE.hasTouch,
        userAgent: PROFILE.userAgent,
    });
    await context.addInitScript(OBSERVERS);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', PROFILE.network);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: PROFILE.cpuSlowdown });

    let status = 0;
    try {
        const res = await page.goto(url, { waitUntil: 'load', timeout: 90_000 });
        status = res?.status() ?? 0;
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
        await page.waitForTimeout(1500);
        const m = await page.evaluate(() => {
            const nav = performance.getEntriesByType('navigation')[0];
            const res = performance.getEntriesByType('resource');
            const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
            const p = window.__perf;
            const tbt = p.longtasks.filter(([s]) => s >= fcp).reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0);
            const isJs = (r) => r.initiatorType === 'script' || /\.m?js(\?|$)/.test(r.name);
            const sum = (list, key) => list.reduce((s, r) => s + (r[key] || 0), 0);
            return {
                ttfbMs: nav.responseStart,
                fcpMs: fcp,
                lcpMs: p.lcp || fcp,
                tbtMs: tbt,
                cls: p.cls,
                htmlBytes: nav.decodedBodySize,
                htmlGzBytes: nav.encodedBodySize,
                jsBytes: sum(res.filter(isJs), 'encodedBodySize'),
                totalBytes: nav.transferSize + sum(res, 'transferSize'),
                requests: res.length + 1,
                domNodes: document.getElementsByTagName('*').length,
            };
        });
        return { status, ...m };
    } finally {
        await context.close();
    }
}

const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function toBudgetMetrics(runs) {
    const first = runs[0];
    const kb = (b) => Math.round((b / 1024) * 10) / 10;
    return {
        ttfbMs: Math.round(median(runs.map((r) => r.ttfbMs))),
        lcpMs: Math.round(median(runs.map((r) => r.lcpMs))),
        tbtMs: Math.round(median(runs.map((r) => r.tbtMs))),
        cls: Math.round(median(runs.map((r) => r.cls)) * 1000) / 1000,
        htmlKB: kb(first.htmlBytes),
        htmlGzKB: kb(first.htmlGzBytes),
        jsKB: kb(first.jsBytes),
        totalKB: kb(Math.max(...runs.map((r) => r.totalBytes))),
        domNodes: Math.max(...runs.map((r) => r.domNodes)),
    };
}

async function checkPages({ baseUrl, routes, runs, out, slack }) {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    const report = { baseUrl, profile: PROFILE, slack, runs, routes: [] };
    let failed = 0;
    try {
        for (const route of routes) {
            const url = new URL(route, baseUrl).toString();
            const samples = [];
            let error = null;
            for (let i = 0; i < runs; i++) {
                try {
                    const s = await measureOnce(browser, url);
                    if (s.status >= 400 || s.status === 0) { error = `HTTP ${s.status}`; break; }
                    samples.push(s);
                } catch (e) {
                    error = e instanceof Error ? e.message.split('\n')[0] : String(e);
                    break;
                }
            }
            if (error || !samples.length) {
                failed++;
                console.log(`\nFAIL ${route}: ${error ?? 'no samples'}`);
                report.routes.push({ route, error });
                continue;
            }
            const metrics = toBudgetMetrics(samples);
            const results = evaluateBudgets(metrics, budgetFor(route), slack);
            const over = results.filter((r) => !r.pass);
            if (over.length) failed++;
            console.log(`\n${over.length ? 'FAIL' : 'ok  '} ${route}`);
            for (const r of results) {
                // Timing metrics are medians: show every load so a flaky median is visible in the log.
                const runs = TIMING_METRICS.has(r.metric) && samples.length > 1 ? `  runs ${samples.map((s) => Math.round(s[r.metric])).join(', ')}` : '';
                console.log(`   ${r.pass ? ' ' : '✗'} ${r.metric.padEnd(9)} ${String(r.value).padStart(9)}  (budget ${r.limit})${runs}`);
            }
            report.routes.push({ route, metrics, results, samples });
        }
    } finally {
        await browser.close();
    }
    if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(failed ? `\n${failed} route(s) over budget.` : '\nAll routes within budget.');
    return failed === 0;
}

/* ── CLI ──────────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
    const args = { traces: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--traces') args.traces = true;
        else if (a === '--base-url') args.baseUrl = argv[++i];
        else if (a === '--routes') args.routes = argv[++i];
        else if (a === '--runs') args.runs = Number(argv[++i]);
        else if (a === '--out') args.out = argv[++i];
        else throw new Error(`Unknown option ${a}`);
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.traces) {
        process.exit(checkTraces() ? 0 : 1);
    }
    const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'routes.json'), 'utf8')).routes.map((r) => r.path);
    const only = args.routes?.split(',').map((s) => s.trim()).filter(Boolean);
    const ok = await checkPages({
        baseUrl: args.baseUrl ?? process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3100',
        routes: only ?? all,
        runs: args.runs && args.runs > 0 ? args.runs : 3,
        out: args.out,
        slack: Number(process.env.PERF_TIMING_SLACK ?? 1) || 1,
    });
    process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch((e) => {
        console.error(e);
        process.exit(2);
    });
}
