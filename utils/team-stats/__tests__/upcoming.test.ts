import { describe, expect, it } from 'vitest';
import { firstUpcoming, oddsPct } from '../format';

describe('firstUpcoming', () => {
    const starts = ['2026-10-14T23:00:00Z', '2026-10-16T23:30:00Z', null];
    it('keeps a game "next" until 3 hours after puck drop', () => {
        expect(firstUpcoming(starts, Date.parse('2026-10-14T12:00:00Z'))).toBe(0);
        expect(firstUpcoming(starts, Date.parse('2026-10-15T01:59:00Z'))).toBe(0);
        expect(firstUpcoming(starts, Date.parse('2026-10-15T02:01:00Z'))).toBe(1);
    });
    it('treats a game without a start time as upcoming, and -1 when all are past', () => {
        expect(firstUpcoming(starts, Date.parse('2026-10-20T00:00:00Z'))).toBe(2);
        expect(firstUpcoming(starts.slice(0, 2), Date.parse('2026-10-20T00:00:00Z'))).toBe(-1);
        expect(firstUpcoming([], Date.now())).toBe(-1);
    });
});

describe('oddsPct', () => {
    it('never prints a hard 0% or 100%', () => {
        expect(oddsPct(0)).toBe('<1%');
        expect(oddsPct(0.3)).toBe('<1%');
        expect(oddsPct(63.4)).toBe('63%');
        expect(oddsPct(99.6)).toBe('>99%');
        expect(oddsPct(100)).toBe('>99%');
    });
});
