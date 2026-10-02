import { describe, expect, it } from 'vitest';
import { summarize } from './summary';
import type { GradedGame } from './types';

const game = (o: Partial<GradedGame>): GradedGame => ({
    id: 1,
    date: '2026-10-01',
    season: '2026-27',
    type: '02',
    home: 'EDM',
    away: 'VAN',
    homeScore: 3,
    awayScore: 2,
    decision: 'REG',
    homeProb: 60,
    marketProb: 55,
    homeXg: 3.1,
    awayXg: 2.4,
    brier: 0.16,
    logLoss: 0.51,
    retro: false,
    snapshotUtc: null,
    ...o,
});

describe('summarize', () => {
    it('counts picks right over games with a lean, and leaves coin flips out of the record', () => {
        const s = summarize([game({ id: 1 }), game({ id: 2, homeScore: 1, awayScore: 4 }), game({ id: 3, homeProb: 50.4 })]);
        expect(s.n).toBe(3);
        expect(s.picks).toBe(2);
        expect(s.hits).toBe(1);
        expect(s.accuracy).toBe(0.5);
        expect(s.avgConfidence).toBe(60);
    });

    it('averages the miss on total goals from the projected score', () => {
        const s = summarize([game({ id: 1 }), game({ id: 2, homeScore: 0, awayScore: 0 })]);
        // |5.5 - 5| = 0.5 and |5.5 - 0| = 5.5
        expect(s.scoreN).toBe(2);
        expect(s.totalGoalsMae).toBeCloseTo(3);
    });

    it('compares log loss to the market on the same games only', () => {
        const s = summarize([game({ id: 1 }), game({ id: 2, marketProb: null }), game({ id: 3, placeholderOdds: true })]);
        expect(s.marketN).toBe(1);
        expect(s.modelLogLossSame).toBeCloseTo(-Math.log(0.6));
        expect(s.marketLogLoss).toBeCloseTo(-Math.log(0.55));
    });

    it('is empty-safe', () => {
        const s = summarize([]);
        expect(s.accuracy).toBeNull();
        expect(s.logLoss).toBeNull();
        expect(s.totalGoalsMae).toBeNull();
    });
});
