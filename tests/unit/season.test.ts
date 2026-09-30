import { afterEach, describe, expect, it, vi } from 'vitest';

// lib/season.ts computes the season at import time, so each case pins the
// clock and re-imports the module.
async function seasonAt(iso: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
    vi.resetModules();
    return import('@/lib/season');
}

afterEach(() => {
    vi.useRealTimers();
});

describe('lib/season', () => {
    it('is 2026-27 on opening night (2026-09-29)', async () => {
        const s = await seasonAt('2026-09-29T23:00:00');
        expect(s.SEASON_START_YEAR).toBe(2026);
        expect(s.SEASON_ID).toBe('20262027');
        expect(s.SEASON_START_DATE).toBe('2026-09-01');
        expect(s.SEASON_GAMES).toBe(84);
    });

    it('stays on the old season through June 30 (Stanley Cup Final window)', async () => {
        const s = await seasonAt('2026-06-30T12:00:00');
        expect(s.SEASON_ID).toBe('20252026');
        expect(s.SEASON_GAMES).toBe(82);
    });

    it('rolls over on July 1, the start of the league year', async () => {
        const s = await seasonAt('2026-07-01T12:00:00');
        expect(s.SEASON_ID).toBe('20262027');
    });

    it('builds per-season file names', async () => {
        const s = await seasonAt('2026-09-29T12:00:00');
        expect(s.seasonFile('gamestats')).toBe('nhl_season_2026_2027_gamestats.csv');
        expect(s.seasonFile('player_stats', 2025)).toBe('nhl_season_2025_2026_player_stats.csv');
    });
});
