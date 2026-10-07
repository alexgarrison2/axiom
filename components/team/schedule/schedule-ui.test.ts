import { describe, expect, it } from 'vitest';
import { daysOff } from './schedule-ui';

type G = Parameters<typeof daysOff>[0][number];
const g = (date: string, n: number, trip: string | null = null) => ({ date, n, trip }) as unknown as G;

describe('days off', () => {
    // Season Oct 2 - Nov 20; three games in October, two in November on a trip.
    const all = [g('2026-10-02', 1), g('2026-10-03', 2), g('2026-10-10', 3), g('2026-11-05', 4, 't1'), g('2026-11-07', 5, 't1'), g('2026-11-20', 6)];

    it('counts a month from the season start, not the 1st', () => {
        // Oct 2-31 = 30 days, 3 game days.
        expect(daysOff(all, { kind: 'month', key: '2026-10' })).toBe(27);
    });

    it('stops a month at the season end', () => {
        // Nov 1-20 = 20 days, 3 game days.
        expect(daysOff(all, { kind: 'month', key: '2026-11' })).toBe(17);
    });

    it('counts a trip from its first game to its last', () => {
        expect(daysOff(all, { kind: 'trip', id: 't1' } as never)).toBe(1);
    });

    it('counts the whole season', () => {
        // Oct 2 - Nov 20 = 50 days, 6 game days.
        expect(daysOff(all, { kind: 'season' })).toBe(44);
    });
});
