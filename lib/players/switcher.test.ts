import { describe, expect, it } from 'vitest';
import { decodeIndex, matchTier, normalizeName, playerHref, ROSTER_BIT, searchPlayers, teamRoster, type PlayersIndexDoc } from './switcher';

const R = ROSTER_BIT;
const doc: PlayersIndexDoc = {
    seasons: ['20262027', '20252026'],
    cur: '20262027',
    players: [
        [1, 'Tim', 'Stützle', 'OTT', 'C', 18, R | 3],
        [2, 'Kyle', 'Connor', 'WPG', 'L', 81, R | 3],
        [3, 'Connor', 'McDavid', 'EDM', 'C', 97, R | 3],
        [4, 'Connor', 'Bedard', 'CHI', 'C', 98, R | 3],
        [5, 'Oliver', 'Ekman-Larsson', 'TOR', 'D', 23, R | 3],
        [6, 'Ryan', "O'Reilly", 'NSH', 'C', 90, R | 3],
        [7, 'Alexis', 'Lafrenière', 'NYR', 'L', 13, R | 3],
        [8, 'Mitch', 'Marner', 'VGK', 'R', 93, R | 3],
        [9, 'Old', 'Connors', 'ARI', 'R', 10, 2],
        [10, 'Mats', 'Zuccarello', 'MIN', 'R', 36, R | 1],
        [11, 'Adin', 'Hill', 'VGK', 'G', 33, R | 3, 'https://example.test/hill.png'],
        [12, 'Noah', 'Hanifin', 'VGK', 'D', 15, R | 3],
        [13, 'Jack', 'Eichel', 'VGK', 'C', 9, R | 3],
        [14, 'Shea', 'Theodore', 'VGK', 'D', 27, 3],
        [15, 'Lasse', 'Ødegård', 'VAN', 'D', 4, R],
    ],
};
const players = decodeIndex(doc);
const ids = (q: string) => searchPlayers(players, q).map(p => p.id);

describe('normalizeName', () => {
    it('drops accents, apostrophes and periods, and folds letters NFD keeps', () => {
        expect(normalizeName('Stützle')).toBe('stutzle');
        expect(normalizeName('Lafrenière')).toBe('lafreniere');
        expect(normalizeName("O'Reilly")).toBe('oreilly');
        expect(normalizeName('O’Reilly')).toBe('oreilly');
        expect(normalizeName('J.J. Moser')).toBe('jj moser');
        expect(normalizeName('Ødegård')).toBe('odegard');
    });
    it('turns hyphens and runs of spaces into single spaces', () => {
        expect(normalizeName('  Ekman-Larsson ')).toBe('ekman larsson');
        expect(normalizeName('Pierre-Luc   Dubois')).toBe('pierre luc dubois');
    });
});

describe('decodeIndex', () => {
    it('reads season and roster flags and derives the headshot', () => {
        const zucc = players.find(p => p.id === 10)!;
        expect(zucc.seasons).toEqual(['20262027']);
        expect(zucc.rostered).toBe(true);
        expect(zucc.headshot).toBe('https://assets.nhle.com/mugs/nhl/20262027/MIN/10.png');
        const old = players.find(p => p.id === 9)!;
        expect(old.seasons).toEqual(['20252026']);
        expect(old.rostered).toBe(false);
        expect(old.headshot).toBe('https://assets.nhle.com/mugs/nhl/20252026/ARI/9.png');
        expect(players.find(p => p.id === 11)!.headshot).toBe('https://example.test/hill.png');
    });
});

describe('searchPlayers', () => {
    it('is accent-insensitive both ways', () => {
        expect(ids('stutz')).toEqual([1]);
        expect(ids('STÜTZ')).toEqual([1]);
        expect(ids('lafreniere')).toEqual([7]);
        expect(ids('oreil')).toEqual([6]);
        expect(ids("o'rei")).toEqual([6]);
        expect(ids('odeg')).toEqual([15]);
    });
    it('ranks last-name prefix over first-name prefix over substring', () => {
        // Last names (Connor, then the unrostered Connors) before the first-name Connors.
        expect(ids('connor')).toEqual([2, 9, 4, 3]);
        expect(matchTier(players.find(p => p.id === 2)!, 'connor')).toBe(0);
        expect(matchTier(players.find(p => p.id === 3)!, 'connor')).toBe(1);
        // "arn" is only inside Marner.
        expect(matchTier(players.find(p => p.id === 8)!, 'arn')).toBe(3);
    });
    it('keeps rostered players first within a tier', () => {
        const hits = searchPlayers(players, 'conn');
        expect(hits[0].id).toBe(2);
        expect(hits[1].id).toBe(9);
    });
    it('matches full names, either order, and words inside hyphenated names', () => {
        expect(ids('mitch mar')).toEqual([8]);
        expect(ids('marner mitch')).toEqual([8]);
        expect(ids('larsson')).toEqual([5]);
        expect(matchTier(players.find(p => p.id === 5)!, 'larsson')).toBe(2);
        expect(ids('ekmanlar')).toEqual([5]);
    });
    it('returns nothing for an empty or punctuation-only query and honours the limit', () => {
        expect(ids('')).toEqual([]);
        expect(ids(' - ')).toEqual([]);
        expect(searchPlayers(players, 'a', 3)).toHaveLength(3);
    });
});

describe('teamRoster', () => {
    it('groups rostered players by position, each by sweater number', () => {
        const g = teamRoster(players, 'VGK');
        expect(g.map(x => x.group)).toEqual(['F', 'D', 'G']);
        expect(g[0].players.map(p => p.id)).toEqual([13, 8]);
        // Theodore is not on the roster.
        expect(g[1].players.map(p => p.id)).toEqual([12]);
        expect(g[2].players.map(p => p.id)).toEqual([11]);
        expect(teamRoster(players, null)).toEqual([]);
    });
});

describe('playerHref', () => {
    it('keeps ?season= only when the target has games that season', () => {
        const zucc = players.find(p => p.id === 10)!;
        expect(playerHref(zucc, '20252026')).toBe('/players/10');
        expect(playerHref(zucc, '20262027')).toBe('/players/10?season=20262027');
        expect(playerHref(players.find(p => p.id === 8)!, '20252026')).toBe('/players/8?season=20252026');
        expect(playerHref(zucc, null)).toBe('/players/10');
    });
});
