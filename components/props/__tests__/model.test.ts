import { describe, expect, it } from 'vitest';
import { attemptsPer, boostFor, buildRows, extFor, seasonLabel, summarize, vsLog, categoryOf, fairAmerican, filterRows, lastN, lineFor, sortRows, streak, DEFAULT_FILTER, type LogRow, type PropPlayer, type PropsDoc } from '../model';

// [date, opp, home, toi, g, a, sog, ppp, prev]
const log = (sog: number[], prevFrom = 0): LogRow[] => sog.map((s, i) => [`2026-10-${String(i + 1).padStart(2, '0')}`, 'BOS', 1, 18, s >= 4 ? 1 : 0, 0, s, 0, i < prevFrom ? 1 : 0]);

const player = (over: Partial<PropPlayer>): PropPlayer => ({
    id: 1, name: 'Test Skater', team: 'EDM', pos: 'C', unit: 'F1', pp: 1, move: null, mates: [], gp: 3, gp_prev: 82,
    cur: {}, prev: {}, log: log([1, 2, 3, 4, 5]), game: 1, opp: 'SEA', home: 1, toi: 20, fair: {}, book: {}, ...over,
});

const doc = (players: PropPlayer[]): PropsDoc => ({
    generated_at: '', season: '20262027', prev_season: '20252026', slate_date: '2026-10-03', log_games: 20,
    games: [], teams: { SEA: { sa: 30, ga: 3, sa_rank: 3, ga_rank: 9 } }, players, book_source: 'bovada', book_fetched_at: null,
});

const sog = categoryOf('sog');

describe('props model', () => {
    it('grades on the posted SOG line, the one priced closest to even when there are several', () => {
        const p = player({ book: { sog25: { over: -110, under: -110, imp: 0.5, devig: true }, sog35: { over: 200, under: -250, imp: 0.3, devig: true } } });
        expect(lineFor(p, sog, 'book').key).toBe('sog25');
        expect(lineFor(player({}), sog, 'book').key).toBe('sog15');
        expect(lineFor(p, sog, 'sog35').key).toBe('sog35');
    });

    it('counts windows and streaks against the line', () => {
        const p = player({});
        const o25 = sog.lines[1];
        expect(lastN(p, sog, o25, 3)).toEqual({ hits: 3, n: 3 });
        expect(lastN(p, sog, o25, 10)).toEqual({ hits: 3, n: 5 });
        expect(streak(p, sog, o25)).toBe(3);
    });

    it('flags a plus-money point scorer whose linemate is -200 or shorter', () => {
        const star = player({ id: 2, name: 'Star', book: { p1: { over: -250, imp: 0.714, devig: false } } });
        const wing = player({ id: 3, name: 'Wing', mates: [2], book: { p1: { over: 110, imp: 0.476, devig: false } } });
        const fav = player({ id: 4, name: 'Fav', mates: [2], book: { p1: { over: -130, imp: 0.565, devig: false } } });
        const byId = new Map([star, wing, fav].map(p => [p.id, p]));
        expect(boostFor(wing, byId)?.mate.name).toBe('Star');
        expect(boostFor(fav, byId)).toBeNull();
    });

    it('sorts missing values last and filters hot form', () => {
        const hot = player({ id: 5, name: 'Hot', log: log([0, 0, 0, 0, 0, 3, 3, 3, 3, 3], 5), gp: 0, prev: { sog25: 10 }, gp_prev: 80, fair: { sog15: 0.7 }, book: { sog15: { over: -150, under: 120, imp: 0.58, devig: true } } });
        const cold = player({ id: 6, name: 'Cold', log: log([0, 0, 0, 0, 0]), fair: { sog15: 0.4 } });
        const rows = buildRows(doc([hot, cold]), 'tonight', sog, 'book');
        expect(sortRows(rows, 'edge', 'desc').map(r => r.p.name)).toEqual(['Hot', 'Cold']);
        expect(sortRows(rows, 'edge', 'asc').map(r => r.p.name)).toEqual(['Hot', 'Cold']);
        expect(filterRows(rows, { ...DEFAULT_FILTER, hot: true }).map(r => r.p.name)).toEqual(['Hot']);
        expect(rows.find(r => r.p.name === 'Hot')?.oppRank).toBe(3);
    });

    it('prints fair American prices', () => {
        expect(fairAmerican(0.6)).toBe('-150');
        expect(fairAmerican(0.4)).toBe('+150');
        expect(fairAmerican(0.5)).toBe('EVEN');
        expect(fairAmerican(null)).toBe('—');
    });

    it('averages shot attempts and the share on net over games that carry attempts', () => {
        const p = player({ log: [['2026-10-01', 'BOS', 1, 18, 0, 0, 2, 0, 0, 5], ['2026-10-02', 'BOS', 1, 18, 0, 0, 4, 0, 0, 7], ['2026-10-03', 'BOS', 1, 18, 0, 0, 1, 0, 0]] });
        expect(attemptsPer(p, 10)).toEqual({ avg: 6, onNet: 0.5, n: 2 });
        expect(attemptsPer(player({}), 5).avg).toBeNull();
    });

    it('matches detail rows to the log by date and grades games against the opponent', () => {
        const p = player({});
        const ext = extFor(p, { x: [['2026-10-02', 1, 0, 15, 2, 0.3]], ha: { h: { n: 0 }, a: { n: 0 } } });
        expect(ext.map(x => x?.[5] ?? null)).toEqual([null, 0.3, null, null, null]);
        const vs = vsLog(p, { x: [], ha: { h: { n: 0 }, a: { n: 0 } }, vs: [['2025-01-10', 1, 17, 0, 1, 3, 0, 6], ['2026-10-02', 0, 19, 1, 0, 1, 0, 2]] }, 2026);
        expect(vs.map(r => [r[1], r[8], r[9]])).toEqual([['SEA', 1, 6], ['SEA', 0, 2]]);
        expect(summarize(vs, sog, sog.lines[0])).toEqual({ hits: 1, n: 2, avg: 2 });
        expect(seasonLabel('2025-01-10')).toBe('24-25');
    });
});
