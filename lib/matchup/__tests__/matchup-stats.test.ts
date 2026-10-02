import { describe, expect, it } from 'vitest';
import {
    advantage,
    buildReference,
    daysOff,
    filterGames,
    goalieMatchKey,
    ordinal,
    percentile,
    rankPercentile,
    refKey,
    restBucket,
    restBuckets,
    sideValues,
    tonightRest,
    unpackTeamGames,
    type MatchupGame,
} from '../matchup-stats';
import { packGames } from '../../../utils/team-stats/game-row';
import type { GameRow } from '../../../utils/team-stats/types';

const zq = [0, 0, 0, 0] as [number, number, number, number];
function row(o: Partial<GameRow>): GameRow {
    return {
        id: '2025020001', date: '2025-10-10', season: '20252026', type: 2, tri: 'STL', opp: 'DAL', home: true, result: 'RW', gn: 1,
        gf: 3, ga: 2, sf: 30, sa: 25, cf: 55, ca: 50, cf5: 40, ca5: 35, hdf: 0, hda: 0, xgf: 3, xga: 2, xgane: 2,
        ppg: 1, ppga: 0, ppo: 3, pko: 2, ppt: 0, pkt: 0, saves: 23,
        engf: 0, enga: 0, enppgf: 0, enppga: 0, enatt: 0, enattag: 0,
        tl: 0, tt: 0, tti: 0, ctrl: 1, sfirst: 0, bl1: 0, bl2: 0, bl3: 0, cw1: 0, cw2: 0, cw3: 0,
        starter: 'Jordan Binnington', oppStarter: 'Jake Oettinger',
        p: { gf: zq, ga: zq, sf: zq, sa: zq, cf: zq, ca: zq, hdf: zq, hda: zq, xgf: zq, xga: zq, tl: zq, tt: zq, tti: zq, ctrl: zq },
        ...o,
    };
}
const game = (o: Partial<GameRow>, rest: 0 | 1 | 2 | 3 = 3, x: Partial<MatchupGame> = {}): MatchupGame => ({ row: row(o), xgf5: 2, xga5: 2, toi5: 3000, rest, ...x });

describe('rest buckets', () => {
    it('counts days off between consecutive games: back-to-back = 0, 3+ caps', () => {
        expect(daysOff('2025-10-10', '2025-10-11')).toBe(0);
        expect(daysOff('2025-10-10', '2025-10-13')).toBe(2);
        expect(daysOff('2025-10-31', '2025-11-01')).toBe(0); // month edge
        expect([0, 1, 2, 3, 7, -1, null].map(restBucket)).toEqual([0, 1, 2, 3, 3, 0, 3]);
    });

    it('buckets each game from the previous game date, in any input order; the first game is 3+', () => {
        // newest first, as the rows arrive
        expect(restBuckets(['2025-10-15', '2025-10-14', '2025-10-12', '2025-10-08'])).toEqual([0, 1, 3, 3]);
        // across the season boundary: last April → opening night is 3+
        expect(restBuckets(['2026-10-01', '2026-04-15'])).toEqual([3, 3]);
    });

    it("tonight: the schedule's rest days win, else the last game before tonight (tonight's own row skipped)", () => {
        const gs = [game({ id: 'a', date: '2025-10-14' }), game({ id: 'b', date: '2025-10-12' }), game({ id: 'tonight', date: '2025-10-15' })];
        expect(tonightRest(gs, '2025-10-15')).toBe(0);
        expect(tonightRest(gs, '2025-10-15', 2)).toBe(2);
        expect(tonightRest(gs, '2025-10-17', null, 'tonight')).toBe(2);
        expect(tonightRest([], '2025-10-15')).toBe(3);
    });
});

describe('goalie name matching', () => {
    it('folds diacritics, initials, "Last, First", status suffixes and Jr.', () => {
        const k = goalieMatchKey('Lukas Dostal');
        expect(goalieMatchKey('Lukáš Dostál')).toBe(k);
        expect(goalieMatchKey('L. Dostal')).toBe(k);
        expect(goalieMatchKey('Dostal, Lukas')).toBe(k);
        expect(goalieMatchKey('Lukas Dostal (Confirmed)')).toBe(k);
        expect(goalieMatchKey('Ukko-Pekka Luukkonen')).toBe(goalieMatchKey('U. Luukkonen'));
        expect(goalieMatchKey('Jake Oettinger Jr.')).toBe(goalieMatchKey('Jake Oettinger'));
        expect(goalieMatchKey('Jake Allen')).not.toBe(goalieMatchKey('Jake Oettinger'));
        expect(goalieMatchKey(null)).toBe('');
    });
});

describe('filters (each team by its own situation)', () => {
    const gs = [
        game({ id: '1', home: true, starter: 'Jordan Binnington' }, 0),
        game({ id: '2', home: false, starter: 'Joel Hofer' }, 0),
        game({ id: '3', home: true, starter: 'Joel Hofer' }, 1),
        game({ id: '4', home: false, starter: 'Jordan Binnington' }, 3),
        game({ id: '5', home: true, starter: 'Jordan Binnington', type: 3 }, 0), // playoffs: never counted
        game({ id: 'tonight', home: true }, 0),
    ];
    const ids = (f: Parameters<typeof filterGames>[1]) => filterGames(gs, f, 'tonight').map(g => g.row.id);

    it('location: home side keeps home games, away side keeps road games; regular season only', () => {
        expect(ids({ location: 'all', rest: 'all', starter: null })).toEqual(['1', '2', '3', '4']);
        expect(ids({ location: 'home', rest: 'all', starter: null })).toEqual(['1', '3']);
        expect(ids({ location: 'road', rest: 'all', starter: null })).toEqual(['2', '4']);
    });

    it('rest and starter combine with location', () => {
        expect(ids({ location: 'all', rest: 0, starter: null })).toEqual(['1', '2']);
        expect(ids({ location: 'all', rest: 'all', starter: 'J. Binnington' })).toEqual(['1', '4']);
        expect(ids({ location: 'road', rest: 0, starter: 'Joel Hofer' })).toEqual(['2']);
        expect(ids({ location: 'home', rest: 3, starter: null })).toEqual([]);
    });
});

describe('side values', () => {
    it('5v5 xG rates from the 5v5 columns; the rest via calculateTeamStats', () => {
        const v = sideValues('STL', [game({}, 3, { xgf5: 3, xga5: 1, toi5: 3600 }), game({ id: '2', gf: 1, ga: 4, ppg: 0, ppga: 2 }, 3, { xgf5: 1, xga5: 3, toi5: 3600 })]);
        expect(v.xgf_pct).toBeCloseTo(50);
        expect(v.xgf60).toBeCloseTo(2);
        expect(v.xga60).toBeCloseTo(2);
        expect(v.cf_pct).toBeCloseTo((40 / 75) * 100);
        expect(v.gf_gp).toBeCloseTo(2);
        expect(v.ga_gp).toBeCloseTo(3);
        expect(v.pp_pct).toBeCloseTo((1 / 6) * 100);
        expect(v.pk_pct).toBeCloseTo((2 / 4) * 100);
        expect(sideValues('STL', []).gf_gp).toBeNull();
    });

    it('packs and unpacks with the /teams columns plus the 5v5 extras', () => {
        const gs = [game({ id: '1' }, 0, { xgf5: 1.234, xga5: 2, toi5: 2900 })];
        const back = unpackTeamGames({ tri: 'STL', seasons: ['20252026', '20262027'], games: packGames(gs.map(g => g.row), { periods: false }), xgf5: [1.234], xga5: [2], toi5: [2900], rest: [0] });
        expect(back[0]).toMatchObject({ xgf5: 1.234, xga5: 2, toi5: 2900, rest: 0 });
        expect(back[0].row.starter).toBe('Jordan Binnington');
        expect(back[0].row.home).toBe(true);
    });
});

describe('percentiles and advantage', () => {
    const ref = [1, 2, 3, 4];

    it('mid-rank "better than" percentile; lower-is-better flips', () => {
        expect(percentile(3, ref, true)).toBe(62.5); // 2 worse + half of itself
        expect(percentile(3, ref, false)).toBe(37.5);
        expect(percentile(5, ref, true)).toBe(100);
        expect(percentile(0, ref, true)).toBe(0);
        expect(percentile(null, ref, true)).toBeNull();
        expect(percentile(2, [], true)).toBeNull();
        expect(rankPercentile(1, 32)).toBeCloseTo(98.4375);
        expect(rankPercentile(32, 32)).toBeCloseTo(1.5625);
        expect(rankPercentile(null, 32)).toBeNull();
    });

    it('near-ties (< 5 pts) and missing values show no advantage', () => {
        expect(advantage({ pct: 70, gp: 40 }, { pct: 40, gp: 40 })).toBe('away');
        expect(advantage({ pct: 40, gp: 40 }, { pct: 70, gp: 40 })).toBe('home');
        expect(advantage({ pct: 52, gp: 40 }, { pct: 48, gp: 40 })).toBeNull();
        expect(advantage({ pct: null, gp: 40 }, { pct: 48, gp: 40 })).toBeNull();
    });

    it('a small-sample side (< 10 GP) never gets the advantage; the other side still can', () => {
        expect(advantage({ pct: 90, gp: 6 }, { pct: 40, gp: 40 })).toBeNull();
        expect(advantage({ pct: 20, gp: 6 }, { pct: 60, gp: 40 })).toBe('home');
        // values without a sample (lineup) are never small
        expect(advantage({ pct: 90 }, { pct: 20 })).toBe('away');
    });

    it('ordinals', () => {
        expect([1, 2, 3, 4, 11, 12, 13, 21, 68.4, 98.6].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '68th', '99th']);
    });
});

describe('last N filter', () => {
    it('keeps each team\'s most recent N games after the other filters', () => {
        const gs = [1, 2, 3, 4, 5, 6].map(i => game({ id: `g${i}`, date: `2026-10-0${i}` } as never, 0));
        const ids = (last: 'all' | 5 | 10) => filterGames(gs, { location: 'all', rest: 'all', starter: null, last }).map(g => g.row.id);
        expect(ids('all')).toHaveLength(6);
        expect(ids(5)).toEqual(['g2', 'g3', 'g4', 'g5', 'g6']);
        expect(ids(10)).toHaveLength(6);
    });
});

describe('league reference', () => {
    it('ranks each slice (location × rest) separately and skips teams under the minimum', () => {
        const byTeam = new Map<string, MatchupGame[]>([
            ['STL', [1, 2, 3, 4].map(i => game({ id: `s${i}`, home: i % 2 === 0, gf: i }, 0))],
            ['DAL', [1, 2].map(i => game({ id: `d${i}`, tri: 'DAL', home: true }, 1))],
        ]);
        const ref = buildReference(byTeam);
        expect(ref[refKey('all', 'all')].gf_gp).toEqual([2.5]); // DAL has 2 games < 3
        expect(ref[refKey('home', 'all')].gf_gp).toBeUndefined();
        expect(ref[refKey('all', 0)].gf_gp).toEqual([2.5]);
        expect(Object.keys(ref)).toHaveLength(45);
    });
});
