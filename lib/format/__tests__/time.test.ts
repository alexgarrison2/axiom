import { describe, expect, it } from 'vitest';
import { formatTime, formatTimeET } from '../time';

// Fixed instants (not tied to today's date): one in EDT, one in EST.
const FALL = '2026-09-29T23:30:00Z';
const WINTER = '2027-01-15T00:00:00Z';

describe('formatTime', () => {
    it('always carries a zone abbreviation', () => {
        expect(formatTimeET(FALL)).toBe('7:30 PM EDT');
        expect(formatTimeET(WINTER)).toBe('7:00 PM EST');
        expect(formatTime(FALL, 'time', 'America/Chicago')).toBe('6:30 PM CDT');
        expect(formatTime(FALL, 'time', 'America/Los_Angeles')).toBe('4:30 PM PDT');
    });

    it('has one shape per style', () => {
        expect(formatTimeET(FALL, 'datetime')).toBe('Sep 29, 7:30 PM EDT');
        expect(formatTimeET(FALL, 'weekday')).toBe('Tue, Sep 29, 7:30 PM EDT');
    });

    it('local zone output still includes an abbreviation', () => {
        expect(formatTime(FALL)).toMatch(/\d{1,2}:\d{2} [AP]M \S+$/);
    });

    it('returns null for missing or bad input', () => {
        expect(formatTimeET(null)).toBeNull();
        expect(formatTimeET('')).toBeNull();
        expect(formatTimeET('not a date')).toBeNull();
    });
});
