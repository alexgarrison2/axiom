import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/season_projections_opening.json';
import {
    CONFERENCE_OF_DIVISION,
    DIVISION_OF,
    compareProjected,
    distPercentile,
    likelyMatchups,
    parseProjectionHistory,
    parseProjections,
    seedConference,
    seriesOdds,
    seriesWinProb,
    trendFor,
    AVERAGE_STRENGTH,
    type StandingsRow,
} from './model';
import { fmtSimPct } from '../views/format';

function rowsFrom(raw: unknown): StandingsRow[] {
    const p = parseProjections(raw);
    return Object.keys(DIVISION_OF).map(tri => ({
        tri,
        name: tri,
        short: tri,
        division: DIVISION_OF[tri],
        conference: CONFERENCE_OF_DIVISION[DIVISION_OF[tri]],
        gp: 0,
        w: 0,
        l: 0,
        otl: 0,
        pts: 0,
        rw: 0,
        row: 0,
        proj: p.byTeam[tri] ?? null,
        delta24: null,
        trend: [],
    }));
}

describe('parseProjections', () => {
    it('reads season id, sims and an 80% band from point_dist', () => {
        const p = parseProjections(fixture);
        expect(p.seasonId).toBe('20262027');
        expect(p.totalSims).toBe(5000);
        expect(Object.keys(p.byTeam)).toHaveLength(32);
        const col = p.byTeam.COL;
        expect(col.p10).toBeLessThan(col.avgPoints);
        expect(col.p90).toBeGreaterThan(col.avgPoints);
    });

    it('treats a file without season_id as not current', () => {
        expect(parseProjections({ total_simulations: 5000, teams: [] }).seasonId).toBeNull();
    });

    it('opening-night fixture shows no 0% or 100% playoff odds', () => {
        const p = parseProjections(fixture);
        for (const t of Object.values(p.byTeam)) {
            expect(fmtSimPct(t.playoffPct)).not.toMatch(/^(0|100)(\.0)?%$/);
        }
        // Even a certain outcome is never printed as a hard 0 / 100.
        expect(fmtSimPct(100)).toBe('>99.9%');
        expect(fmtSimPct(0)).toBe('<0.1%');
        expect(fmtSimPct(99.6)).toBe('99.6%');
    });
});

describe('distPercentile', () => {
    it('handles a degenerate distribution', () => {
        expect(distPercentile({ '121': 5000 }, 0.1)).toBe(121);
        expect(distPercentile({}, 0.5)).toBeUndefined();
    });
    it('finds quantiles', () => {
        const d = { '80': 10, '90': 80, '100': 10 };
        expect(distPercentile(d, 0.1)).toBe(80);
        expect(distPercentile(d, 0.5)).toBe(90);
        expect(distPercentile(d, 0.95)).toBe(100);
    });
});

describe('projection history', () => {
    it('reads snapshot lists and keeps one point per day, ignoring other seasons', () => {
        const raw = {
            season_id: '20262027',
            snapshots: [
                { date: '2026-09-29', teams: { COL: { make_playoffs_pct: 60 } } },
                { date: '2026-09-30', teams: [{ team: 'COL', make_playoffs_pct: 64 }] },
                { date: '2026-09-30T20:00:00Z', teams: { COL: 65.6 } },
            ],
        };
        const h = parseProjectionHistory(raw, '20262027');
        expect(h.COL).toEqual([
            { date: '2026-09-29', pct: 60 },
            { date: '2026-09-30', pct: 65.6 },
        ]);
        expect(parseProjectionHistory({ ...raw, season_id: '20252026' }, '20262027')).toEqual({});
        const t = trendFor(h.COL, 66);
        expect(t.delta24).toBeCloseTo(6);
        expect(t.trend).toEqual([60, 66]);
    });

    it('reads a per-team map', () => {
        const h = parseProjectionHistory({ COL: [{ date: '2026-10-01', pct: 50 }] }, '20262027');
        expect(h.COL).toHaveLength(1);
        expect(trendFor(h.COL, 50).delta24).toBeNull();
    });
});

describe('seeding', () => {
    it('builds the NHL divisional bracket with wild cards', () => {
        const rows = rowsFrom(fixture);
        for (const conf of ['East', 'West'] as const) {
            const s = seedConference(rows, conf, compareProjected)!;
            expect(s.r1).toHaveLength(4);
            const tris = s.r1.flat().map(x => x.tri);
            expect(new Set(tris).size).toBe(8);
            expect(s.r1[0][1].label).toBe('WC2');
            expect(s.r1[2][1].label).toBe('WC1');
            for (const t of tris) expect(rows.find(r => r.tri === t)!.conference).toBe(conf);
        }
    });

    it('lists likely first-round matchups inside one conference', () => {
        const rows = rowsFrom(fixture);
        const west = likelyMatchups(rows, 'West', 6);
        expect(west.length).toBe(6);
        expect(west[0].p).toBeGreaterThan(0);
        expect(west[0].p).toBeLessThan(1);
        for (const m of west) {
            expect(rows.find(r => r.tri === m.a)!.conference).toBe('West');
            expect(rows.find(r => r.tri === m.b)!.conference).toBe('West');
        }
    });
});

describe('series odds', () => {
    it('is 50% for a coin flip and symmetric', () => {
        expect(seriesWinProb(0.5)).toBeCloseTo(0.5, 6);
        expect(seriesWinProb(0.6) + seriesWinProb(0.4)).toBeCloseTo(1, 6);
        const p = seriesOdds(AVERAGE_STRENGTH, AVERAGE_STRENGTH);
        expect(p).toBeGreaterThan(0.5); // home ice
        expect(p).toBeLessThan(0.6);
    });
});
