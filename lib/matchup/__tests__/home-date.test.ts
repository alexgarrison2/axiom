import { describe, expect, it } from 'vitest';
import { homeDate } from '../lifecycle';
import { railLabel, slateDate } from '../format';

// The overnight refresh (05:04 UTC) rewrites the prediction file to the coming days only,
// while the slate date stays on the night that just ended until 3am ET.
describe('home slate around the 3am ET rollover', () => {
    const file = ['2026-10-07', '2026-10-08'];

    it('opens on the night that just ended between midnight and 3am ET', () => {
        const today = slateDate(new Date('2026-10-07T05:15:00Z')); // 01:15 EDT
        expect(today).toBe('2026-10-06');
        expect(homeDate(file, today, 9)).toBe('2026-10-06');
        expect(railLabel('2026-10-06', today)).toBe('Tonight');
        expect(railLabel('2026-10-05', today)).toBe('Yesterday');
        expect(railLabel('2026-10-07', today)).toBe('Wed');
    });

    it('moves to the new day at 3am ET, the ended night becoming Yesterday', () => {
        const today = slateDate(new Date('2026-10-07T07:05:00Z')); // 03:05 EDT
        expect(today).toBe('2026-10-07');
        expect(homeDate(file, today, 0)).toBe('2026-10-07');
        expect(railLabel('2026-10-06', today)).toBe('Yesterday');
        expect(railLabel('2026-10-07', today)).toBe('Tonight');
    });

    it('keeps the daytime default when today is in the file', () => {
        expect(homeDate(['2026-10-06', '2026-10-07'], '2026-10-06', 0)).toBe('2026-10-06');
        expect(homeDate(['2026-10-06', '2026-10-07'], '2026-10-06', 9)).toBe('2026-10-06');
    });

    it('skips a day without games to the next slate', () => {
        expect(homeDate(file, '2026-10-06', 0)).toBe('2026-10-07');
    });
});
