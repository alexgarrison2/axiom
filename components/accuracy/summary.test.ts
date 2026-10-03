import { describe, expect, it } from 'vitest';
import { dayShape, groupByDay, summarize, vsMarket } from './summary';
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

describe('groupByDay', () => {
    const games = [
        game({ id: 5, date: '2026-10-02' }),
        game({ id: 4, date: '2026-10-02', homeScore: 1, awayScore: 4, logLoss: 0.92 }),
        game({ id: 3, date: '2026-10-02', homeProb: 50.4, logLoss: 0.68 }),
        game({ id: 2, date: '2026-09-30', homeProb: 49.8 }),
        game({ id: 1, date: '2026-10-01', homeProb: 35, homeScore: 2, awayScore: 3, marketProb: null }),
    ];

    it('groups newest day first and keeps the input order inside a day', () => {
        const days = groupByDay(games);
        expect(days.map(d => d.date)).toEqual(['2026-10-02', '2026-10-01']);
        expect(days[0].picks.map(g => g.id)).toEqual([5, 4]);
    });

    it('summarises each day: record over picks, log loss over every game that day', () => {
        const [oct2, oct1] = groupByDay(games);
        expect(oct2.summary.n).toBe(3);
        expect(oct2.summary.picks).toBe(2);
        expect(oct2.summary.hits).toBe(1);
        expect(oct2.summary.accuracy).toBe(0.5);
        expect(oct2.summary.logLoss).toBeCloseTo((0.51 + 0.92 + 0.68) / 3);
        expect(oct1.summary.hits).toBe(1);
        expect(oct1.summary.avgConfidence).toBe(65);
    });

    it('drops a day with only coin flips (no rows to list)', () => {
        expect(groupByDay(games).some(d => d.date === '2026-09-30')).toBe(false);
        expect(groupByDay([])).toEqual([]);
    });

    it('reflects whatever filter ran first (only right picks in, a perfect day out)', () => {
        const [oct2] = groupByDay(games.filter(g => g.id === 5));
        expect(oct2.summary.picks).toBe(1);
        expect(oct2.summary.accuracy).toBe(1);
    });

    it('gives the day log loss vs the market as model minus market, null with no price', () => {
        const [oct2, oct1] = groupByDay(games);
        // Oct 2 priced games: 5 (home won, 60 vs 55), 4 (away won), 3 (coin flip, home won).
        const model = (-Math.log(0.6) - Math.log(0.4) - Math.log(0.504)) / 3;
        const market = (-Math.log(0.55) - Math.log(0.45) - Math.log(0.55)) / 3;
        expect(vsMarket(oct2.summary)).toBeCloseTo(model - market);
        expect(vsMarket(oct1.summary)).toBeNull();
    });

    it('sizes the day list: days with a pick and picks on the newest day', () => {
        expect(dayShape(games)).toEqual({ days: 2, lastDay: 2 });
        expect(dayShape([])).toEqual({ days: 0, lastDay: 0 });
    });
});
