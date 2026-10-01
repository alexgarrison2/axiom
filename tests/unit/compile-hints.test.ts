import { describe, expect, it } from 'vitest';
import { HINT, withHint } from '../../scripts/compile-hints.mjs';
import { dateFormatter, formatTime } from '../../lib/format/time';
import { railHeading, railLabel, shortDate, weekdayDate } from '../../lib/matchup/format';

describe('compile hints', () => {
    it('puts the V8 magic comment on the first line, once', () => {
        const src = '(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push([]);';
        const once = withHint(src);
        expect(once.startsWith('//# allFunctionsCalledOnLoad\n')).toBe(true);
        expect(once.slice(HINT.length)).toBe(src);
        expect(withHint(once)).toBe(once);
    });
});

describe('shared date formatters', () => {
    it('reuses one formatter per locale and options', () => {
        const a = dateFormatter('en-US', { hour: 'numeric', timeZone: 'UTC' });
        expect(dateFormatter('en-US', { hour: 'numeric', timeZone: 'UTC' })).toBe(a);
        expect(dateFormatter('en-US', { hour: 'numeric', timeZone: 'America/New_York' })).not.toBe(a);
    });

    it('formats exactly as a fresh Intl.DateTimeFormat / toLocaleDateString', () => {
        const iso = '2026-10-01T23:00:00Z';
        expect(formatTime(iso, 'time', 'America/New_York')).toBe(
            new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: 'America/New_York' }).format(new Date(iso)),
        );
        const utc = new Date(Date.UTC(2026, 9, 1));
        expect(shortDate('2026-10-01')).toBe(utc.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }));
        expect(weekdayDate('2026-10-01')).toBe('Thu, Oct 1');
        expect(railLabel('2026-10-03', '2026-10-01')).toBe('Sat');
        expect(railHeading('2026-10-01', '2026-10-01')).toBe('Thu · Oct 1');
    });

    it('keeps "Invalid Date" for a bad day instead of throwing', () => {
        expect(shortDate('not-a-date')).toBe('Invalid Date');
    });
});
