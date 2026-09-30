import { describe, expect, it } from 'vitest';
import { freshnessState, freshnessTone, parseDataTimestamp, relativeAge } from '../freshness';

const utc = (s: string) => new Date(`${s}Z`);

describe('freshness badge rules', () => {
    it('is not red at 09:00 UTC when the last run was at 02:00 UTC', () => {
        expect(freshnessState(utc('2026-09-30T02:00:00'), utc('2026-09-30T09:00:00'))).not.toBe('stale');
        expect(freshnessState(utc('2026-09-30T02:07:00'), utc('2026-09-30T11:59:00'))).not.toBe('stale');
    });

    it('allows the first morning runs to be late (12:00–13:59 UTC)', () => {
        expect(freshnessState(utc('2026-09-30T02:05:00'), utc('2026-09-30T12:40:00'))).not.toBe('stale');
        expect(freshnessState(utc('2026-09-30T02:05:00'), utc('2026-09-30T13:30:00'))).not.toBe('stale');
    });

    it('turns amber when a pregame-window run is >2h overdue but the data is under 6h old', () => {
        // Evening: last data 19:05, now 22:10 → 20:00 slot is >2h overdue, data 3h old.
        expect(freshnessState(utc('2026-09-30T19:05:00'), utc('2026-09-30T22:10:00'))).toBe('late');
    });

    it('goes red when a missed slot leaves the data over 6h old on a game day', () => {
        // 12:00 run never landed; at 14:30 the data is from 02:05 (12h).
        expect(freshnessState(utc('2026-09-30T02:05:00'), utc('2026-09-30T14:30:00'))).toBe('stale');
    });

    it('30m / 3h / 8h old in the window → ok / amber / stale', () => {
        const now = utc('2026-09-30T22:00:00');
        const tone = (ageMin: number) => freshnessTone(freshnessState(new Date(now.getTime() - ageMin * 60_000), now));
        expect(tone(30)).toBe('ok');
        expect(tone(180)).toBe('amber');
        expect(tone(480)).toBe('stale');
    });

    it('the local 3.5h-old stamp (14:39 at 18:09 UTC on opening Wednesday) is amber, not red', () => {
        const starts = [utc('2026-09-30T23:30:00'), utc('2026-10-01T02:00:00')];
        expect(freshnessTone(freshnessState(utc('2026-09-30T14:39:07'), utc('2026-09-30T18:09:00'), { starts }))).toBe('amber');
    });

    it('stays amber past 6h when no game is near (not a game day)', () => {
        expect(freshnessState(utc('2026-12-24T12:05:00'), utc('2026-12-24T20:30:00'), { starts: [] })).toBe('late');
        expect(freshnessState(utc('2026-12-24T12:05:00'), utc('2026-12-24T20:30:00'), { starts: [utc('2026-12-27T00:00:00')] })).toBe('late');
    });

    it('goes red when a puck drop has passed with no run in the 3h before it', () => {
        const starts = [utc('2026-09-30T23:30:00')];
        // Last run 19:30 (4h before puck drop), now 23:45: only 4.25h old but pregame data is missing.
        expect(freshnessState(utc('2026-09-30T19:30:00'), utc('2026-09-30T23:45:00'), { starts })).toBe('stale');
        // Same age without a game under way → amber.
        expect(freshnessState(utc('2026-09-30T19:30:00'), utc('2026-09-30T23:45:00'), { starts: [utc('2026-10-01T02:00:00')] })).toBe('late');
        // A run at 21:05 (under 3h before puck drop) is fine.
        expect(freshnessTone(freshnessState(utc('2026-09-30T21:05:00'), utc('2026-09-30T23:45:00'), { starts }))).not.toBe('stale');
    });

    it('is fine in the window when runs are on schedule', () => {
        expect(freshnessState(utc('2026-09-30T21:04:00'), utc('2026-09-30T21:40:00'))).toBe('fresh');
        expect(freshnessState(utc('2026-09-30T20:04:00'), utc('2026-09-30T21:50:00'))).toBe('ok');
        expect(freshnessTone('fresh')).toBe('ok');
        expect(freshnessTone('ok')).toBe('ok');
    });

    it('goes red after 26h no matter the time of day', () => {
        expect(freshnessState(utc('2026-09-29T02:00:00'), utc('2026-09-30T05:00:00'))).toBe('stale');
    });

    it('reports unknown without a timestamp', () => {
        expect(freshnessState(null, utc('2026-09-30T05:00:00'))).toBe('unknown');
    });
});

describe('parseDataTimestamp', () => {
    it('parses ISO UTC', () => {
        expect(parseDataTimestamp('2026-09-29T23:48:00Z')?.toISOString()).toBe('2026-09-29T23:48:00.000Z');
        expect(parseDataTimestamp('2026-09-29T23:48:00+00:00')?.toISOString()).toBe('2026-09-29T23:48:00.000Z');
    });

    it('parses the legacy Central-time format (CDT = UTC−5)', () => {
        expect(parseDataTimestamp('September 29, 2026, 06:48 PM')?.toISOString()).toBe('2026-09-29T23:48:00.000Z');
        expect(parseDataTimestamp('January 5, 2027, 12:15 AM')?.toISOString()).toBe('2027-01-05T06:15:00.000Z');
    });

    it('rejects junk', () => {
        expect(parseDataTimestamp('Unknown')).toBeNull();
        expect(parseDataTimestamp('')).toBeNull();
    });

    it('formats relative ages', () => {
        const now = utc('2026-09-30T10:00:00');
        expect(relativeAge(utc('2026-09-30T09:53:00'), now)).toBe('7m ago');
        expect(relativeAge(utc('2026-09-30T02:00:00'), now)).toBe('8h ago');
    });
});
