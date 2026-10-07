import { describe, expect, it } from 'vitest';
import { clockSeconds, otLengthOf, readClock } from '../clock';
import { liveClock, type LiveGame } from '@/lib/matchup/lifecycle';

const live = (o: Partial<LiveGame>): LiveGame => ({
    id: '2026020044',
    state: 'LIVE',
    period: 2,
    periodType: 'REG',
    clock: null,
    intermission: false,
    lastPeriodType: null,
    away: { score: 2, sog: 12 },
    home: { score: 4, sog: 21 },
    ...o,
});

describe('period clock', () => {
    it('reads MM:SS', () => {
        expect(clockSeconds('12:41')).toBe(761);
        expect(clockSeconds('00:00')).toBe(0);
        expect(clockSeconds('')).toBeNull();
    });

    it('never shows more time than the period has: a 20:11 clock in P2 is the 1st intermission', () => {
        expect(readClock(2, '20:11', false, 1200)).toEqual({ period: 1, intermission: true, seconds: null });
        expect(liveClock(live({ clock: '20:11' }))).toBe('1st INT');
        expect(liveClock(live({ period: 1, clock: '20:30' }))).toBe('P1 20:00');
    });

    it('keeps normal clocks, the end of a period and flagged intermissions', () => {
        expect(liveClock(live({ clock: '12:41' }))).toBe('P2 12:41');
        expect(liveClock(live({ clock: '20:00' }))).toBe('P2 20:00');
        expect(liveClock(live({ clock: '00:00' }))).toBe('End P2');
        expect(liveClock(live({ clock: '14:02', intermission: true }))).toBe('2nd INT');
        expect(liveClock(live({ period: 4, periodType: 'OT', clock: '03:12' }))).toBe('OT 3:12');
    });

    it('knows regular-season overtime is five minutes and playoff overtime twenty', () => {
        expect(otLengthOf('2026020044')).toBe(300);
        expect(otLengthOf('2025030111')).toBe(1200);
        expect(liveClock(live({ period: 4, periodType: 'OT', clock: '07:00' }))).toBe('3rd INT');
    });
});
