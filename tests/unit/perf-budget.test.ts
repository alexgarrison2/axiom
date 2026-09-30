import { describe, expect, it } from 'vitest';
import { budgetFor, evaluateBudgets, missingTraceFiles, RUNTIME_TRACE_REQUIREMENTS, toBudgetMetrics, traceLimitMB, traceRouteFromNft } from '../../scripts/perf-budget.mjs';

type Result = { metric: string; value: number; limit: number; pass: boolean };

const healthyHome = {
    ttfbMs: 120, lcpMs: 1900, tbtMs: 90, cls: 0.01,
    htmlKB: 180, htmlGzKB: 30, jsKB: 170, totalKB: 520, domNodes: 1800,
};

describe('perf budgets', () => {
    it('passes a home page inside every budget', () => {
        const failed = (evaluateBudgets(healthyHome, budgetFor('/')) as Result[]).filter((r) => !r.pass);
        expect(failed).toEqual([]);
    });

    it('fails a 500KB home HTML payload', () => {
        const failed = (evaluateBudgets({ ...healthyHome, htmlKB: 500, htmlGzKB: 45 }, budgetFor('/')) as Result[])
            .filter((r) => !r.pass)
            .map((r) => r.metric);
        expect(failed).toEqual(expect.arrayContaining(['htmlKB', 'htmlGzKB']));
    });

    it('fails a 500KB client-side data fetch on home via the transfer budget', () => {
        const failed = (evaluateBudgets({ ...healthyHome, totalKB: healthyHome.totalKB + 500 }, budgetFor('/')) as Result[])
            .filter((r) => !r.pass)
            .map((r) => r.metric);
        expect(failed).toEqual(['totalKB']);
    });

    it('applies slack to timings only, never to bytes', () => {
        const budget = budgetFor('/');
        const results = evaluateBudgets({ ...healthyHome, lcpMs: budget.lcpMs * 1.2, htmlKB: budget.htmlKB + 1 }, budget, 1.25) as Result[];
        expect(results.find((r) => r.metric === 'lcpMs')?.pass).toBe(true);
        expect(results.find((r) => r.metric === 'htmlKB')?.pass).toBe(false);
    });

    it('treats a missing metric as a failure', () => {
        const { lcpMs: _omit, ...rest } = healthyHome;
        void _omit;
        const r = (evaluateBudgets(rest, budgetFor('/')) as Result[]).find((x) => x.metric === 'lcpMs');
        expect(r?.pass).toBe(false);
    });

    it('uses medians for timings and the worst run for bytes', () => {
        const run = (lcp: number, total: number) => ({
            ttfbMs: 100, fcpMs: 500, lcpMs: lcp, tbtMs: 50, cls: 0,
            htmlBytes: 1024, htmlGzBytes: 512, jsBytes: 2048, totalBytes: total, domNodes: 10,
        });
        const m = toBudgetMetrics([run(1000, 1024), run(5000, 4096), run(2000, 2048)]);
        expect(m.lcpMs).toBe(2000);
        expect(m.totalKB).toBe(4);
        expect(m.htmlKB).toBe(1);
    });
});

describe('function trace budgets', () => {
    it('maps nft files to routes', () => {
        expect(traceRouteFromNft('.next/server/app/page.js.nft.json')).toBe('/');
        expect(traceRouteFromNft('.next/server/app/teams/[teamAbbr]/page.js.nft.json')).toBe('/teams/[teamAbbr]');
        expect(traceRouteFromNft('.next/server/app/api/odds-history/route.js.nft.json')).toBe('/api/odds-history');
        expect(traceRouteFromNft('.next/server/chunks/foo.js.nft.json')).toBeNull();
    });

    it('flags a runtime-read file that is on disk but missing from the trace', () => {
        const traced = ['pipeline/data/nhl_schedule_20262027.json', 'public/data/player_news.json'];
        const { missing, absent } = missingTraceFiles('/news', traced, (g: string) => g !== 'public/data/manifest.json');
        expect(missing).toContain('public/data/upcoming_games.json');
        expect(missing).not.toContain('pipeline/data/nhl_schedule_*.json');
        expect(missing).not.toContain('public/data/player_news.json');
        // absent at build (fresh checkout): a note, not a failure
        expect(absent).toEqual(['public/data/manifest.json']);
    });

    it('matches * within one path segment only', () => {
        const r = missingTraceFiles('/api/odds-history', ['public/data/SiteHistory/old/2026-09-30.csv']);
        expect(r.missing).toEqual(['public/data/SiteHistory/*.csv']);
        expect(missingTraceFiles('/api/odds-history', ['public/data/SiteHistory/2026-09-30.csv']).missing).toEqual([]);
    });

    it('requires the schedule on every route that reads it with fs', () => {
        for (const route of ['/news', '/teams/[teamAbbr]']) {
            expect(RUNTIME_TRACE_REQUIREMENTS[route as keyof typeof RUNTIME_TRACE_REQUIREMENTS]).toContain('pipeline/data/nhl_schedule_*.json');
        }
        expect(missingTraceFiles('/unknown-route', []).missing).toEqual([]);
    });

    it('holds home to 5MB, playoffs to 15MB and everything else to 50MB', () => {
        expect(traceLimitMB('/')).toBe(5);
        expect(traceLimitMB('/playoffs')).toBe(15);
        expect(traceLimitMB('/playoffs/[season]')).toBe(15);
        expect(traceLimitMB('/api/teams/[teamAbbr]/stats')).toBe(50);
    });
});
