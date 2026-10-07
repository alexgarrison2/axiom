import { describe, expect, it } from 'vitest';
import type { SchedGame } from '../metrics';
import { largestRemainder, OT_SHARE, outcomeOf, projectRecord, recordText } from '../record';

type G = Pick<SchedGame, 'result' | 'winPct' | 'state'>;
const played = (code: 'W' | 'L' | 'OTL'): G => ({ state: 'final', winPct: null, result: { gf: 0, ga: 0, code, ot: code === 'OTL' ? 'OT' : null } });
const ahead = (pct: number, otl?: number): G => ({ state: 'future', result: null, winPct: { pct, otl, src: 'sim' } });

describe('largestRemainder', () => {
    it('keeps the total and gives leftovers to the largest remainders', () => {
        expect(largestRemainder([5.6, 3.3, 1.1], 10)).toEqual([6, 3, 1]);
        expect(largestRemainder([4.45, 4.45, 1.1], 10)).toEqual([5, 4, 1]); // tie → earlier value
        expect(largestRemainder([2, 3, 5], 10)).toEqual([2, 3, 5]);
        const r = largestRemainder([0.4, 0.4, 0.2], 1);
        expect(r.reduce((a, b) => a + b, 0)).toBe(1);
    });
});

describe('outcomeOf', () => {
    it('uses the forecast’s own OT-loss probability', () => {
        expect(outcomeOf(ahead(55, 11))).toEqual({ w: 0.55, otl: 0.11 });
    });
    it('falls back to the league OT share when the forecast has no split', () => {
        const o = outcomeOf(ahead(60))!;
        expect(o.w).toBeCloseTo(0.6);
        expect(o.otl).toBeCloseTo(OT_SHARE * 0.4);
    });
    it('never lets P(W) + P(OTL) pass 1', () => {
        const o = outcomeOf(ahead(95, 12))!;
        expect(o.w + o.otl).toBeLessThanOrEqual(1 + 1e-12);
    });
    it('is null without a forecast', () => {
        expect(outcomeOf({ winPct: null })).toBeNull();
    });
});

describe('projectRecord', () => {
    it('sums expected points as 2·P(W) + P(OTL) over games ahead', () => {
        const p = projectRecord([ahead(50, 12), ahead(50, 12), ahead(50, 12), ahead(50, 12)]);
        expect(p.pts).toBeCloseTo(4 * (2 * 0.5 + 0.12));
        expect(p.possible).toBe(8);
        // E[W] = 2, E[OTL] = 0.48, E[L] = 1.52 → 2-2-0 (0.52 > 0.48 for the last unit).
        expect(p.record).toEqual({ w: 2, l: 2, otl: 0 });
        expect(p.range).not.toBeNull();
        expect(p.range![0]).toBeLessThan(p.pts!);
        expect(p.range![1]).toBeGreaterThan(p.pts!);
    });

    it('adds actual results to the projection for the rest', () => {
        const p = projectRecord([played('W'), played('L'), played('OTL'), ahead(60, 10), ahead(60, 10)]);
        expect(p.actual).toEqual({ w: 1, l: 1, otl: 1 });
        expect(p.actualPts).toBe(3);
        expect(p.pts).toBeCloseTo(3 + 2 * (1.2 + 0.1));
        const r = p.record!;
        expect(r.w + r.l + r.otl).toBe(5);
        expect(recordText(r)).toBe('2-2-1');
    });

    it('has no projection once every game is played', () => {
        const p = projectRecord([played('W'), played('W'), played('OTL')]);
        expect(p.record).toBeNull();
        expect(p.pts).toBeNull();
        expect(p.actualPts).toBe(5);
        expect(p.possible).toBe(6);
    });

    it('does not project when a game ahead has no forecast', () => {
        const p = projectRecord([ahead(50, 12), { state: 'future', result: null, winPct: null }]);
        expect(p.record).toBeNull();
    });
});
