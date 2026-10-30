import { describe, expect, it } from 'vitest';
import { split, trend, type FormGame } from './form';

const game = (i: number, o: Partial<FormGame> = {}): FormGame => ({
    game: 2026020000 + i,
    date: `2026-10-${String(i).padStart(2, '0')}`,
    opp: 'CGY',
    home: true,
    result: 'W',
    gf: 3,
    ga: 2,
    g: 0,
    a: 0,
    sog: 2,
    ixg: 0.2,
    toi: 1200,
    toiPp: 120,
    toiPk: 0,
    ps: 0,
    xgf5: 1,
    xga5: 1,
    ...o,
});

describe('split', () => {
    it('averages per game over the last N, oldest first in', () => {
        const games = [game(1, { g: 3, sog: 8 }), game(2, { a: 1, sog: 4 }), game(3, { g: 1, a: 1, sog: 2 })];
        expect(split(games)).toMatchObject({ gp: 3, pts: 2, sog: 14 / 3 });
        expect(split(games, 2)).toMatchObject({ gp: 2, pts: 1.5, sog: 3 });
        expect(split(games, 10)?.gp).toBe(3); // a window longer than the log is the whole log
    });
    it('pools the 5v5 xG share and skips games stored without it', () => {
        const games = [game(1, { xgf5: 3, xga5: 1 }), game(2, { xgf5: null, xga5: null }), game(3, { xgf5: 1, xga5: 3 })];
        expect(split(games)?.xgPct).toBe(50);
        expect(split([game(1, { xgf5: null, xga5: null })])?.xgPct).toBeNull();
    });
    it('is null with no games', () => {
        expect(split([])).toBeNull();
    });
});

describe('trend', () => {
    const season = split([game(1, { g: 1 }), game(2), game(3), game(4)])!;
    it('reads up or down only past the band', () => {
        expect(trend(split([game(1, { g: 1 })])!, season, 'pts')).toBe('up');
        expect(trend(split([game(1)])!, season, 'pts')).toBeNull(); // 0 vs 0.25: inside the 0.3 band
        expect(trend(split([game(1, { toi: 1000 })])!, season, 'toi')).toBe('down');
    });
});
