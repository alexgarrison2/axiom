import { describe, expect, it } from 'vitest';
import fixture from './fixtures/standings-2026-04-17.json';
import { leagueStandings, loadSeasonGames } from '../server';
import { calculateTeamStats } from '../calculate';
import { filterGames, groupByTeam, sanitizeFilters, DEFAULT_FILTERS, needsGameRows, activeFilterCount } from '../filter';
import { packGames, unpackGames } from '../game-row';

const SEASON = '20252026';

describe('2025-26 standings match the NHL', () => {
    const { rows } = leagueStandings(SEASON);
    const byTri = new Map(rows.map(r => [r.tri, r]));

    it('has all 32 teams', () => {
        expect(rows).toHaveLength(32);
    });

    it.each(fixture.teams.map(t => [t.tri, t] as const))('%s GP, W-L-OT, PTS, RW, GF/GA', (tri, ref) => {
        const s = byTri.get(tri)!;
        expect(s, tri).toBeDefined();
        expect({ gp: s.gp, w: s.wins, l: s.losses, ot: s.otl, pts: s.points, rw: s.rw, gf: s.gf, ga: s.ga }).toEqual({
            gp: ref.gp, w: ref.w, l: ref.l, ot: ref.ot, pts: ref.pts, rw: ref.rw, gf: ref.gf, ga: ref.ga,
        });
    });

    it('CAR 82 GP, 53-22-7, 113 PTS; COL 121 PTS', () => {
        const car = byTri.get('CAR')!;
        expect([car.gp, car.wins, car.losses, car.otl, car.points]).toEqual([82, 53, 22, 7, 113]);
        expect(byTri.get('COL')!.points).toBe(121);
    });

    it('ranks COL first in the Central and gives 16 playoff spots', () => {
        expect(byTri.get('COL')!.ranking).toBe('C1');
        expect(rows.filter(r => r.isPlayoff)).toHaveLength(16);
    });
});

describe('game-type splits', () => {
    const games = loadSeasonGames(SEASON);
    const edm = groupByTeam(games).get('EDM')!;

    it('EDM regular season is 82 GP, 41-30-11, 93 PTS', () => {
        const reg = filterGames(edm, { ...DEFAULT_FILTERS, scope: 'regular' });
        const s = calculateTeamStats('EDM', reg);
        expect([s.gp, s.wins, s.losses, s.otl, s.points]).toEqual([82, 41, 30, 11, 93]);
    });

    it('playoff losses in overtime count as plain losses with no points', () => {
        const po = filterGames(edm, { ...DEFAULT_FILTERS, scope: 'playoffs' });
        expect(po.length).toBeGreaterThan(0);
        const s = calculateTeamStats('EDM', po);
        expect(s.otl).toBe(0);
        expect(s.wins + s.losses).toBe(s.gp);
        expect(s.points).toBe(s.wins * 2);
    });

    it('"Last 10" in the regular season never includes playoff games', () => {
        const l10 = filterGames(edm, { ...DEFAULT_FILTERS, recent: 10 });
        expect(l10).toHaveLength(10);
        expect(l10.every(g => g.type === 2)).toBe(true);
    });

    it('packs and unpacks (floats rounded to 3 dp)', () => {
        const packed = packGames(edm);
        const back = unpackGames(packed);
        expect(back.map(g => [g.id, g.result, g.gf, g.ga, g.starter, g.p.gf])).toEqual(edm.map(g => [g.id, g.result, g.gf, g.ga, g.starter, g.p.gf]));
        expect(packGames(back)).toEqual(packed);
        expect(Math.abs(back[0].xgf - edm[0].xgf)).toBeLessThan(0.001);
    });
});

describe('persisted filters', () => {
    it('drops stale presets (Olympics, Playoffs without playoff games, removed views)', () => {
        const f = sanitizeFilters({ recent: 'Olympics', scope: 'playoffs', view: 'PlayoffMatchup', period: '5th', divisions: ['Metro', 'Nope'] }, { playoffs: false, bracket: false });
        expect(f.recent).toBe('All');
        expect(f.scope).toBe('regular');
        expect(f.view).toBe('all');
        expect(f.period).toBe('All');
        expect(f.divisions).toEqual(['Metro']);
    });

    it('keeps valid values', () => {
        const f = sanitizeFilters({ recent: 10, location: 'Home', ranges: { gf: ['3', ''], bogus: ['1', '2'] } }, { playoffs: true, bracket: false });
        expect(f.recent).toBe(10);
        expect(f.location).toBe('Home');
        expect(f.ranges).toEqual({ gf: ['3', ''] });
        expect(needsGameRows(f)).toBe(true);
        expect(activeFilterCount(f)).toBe(3);
    });

    it('defaults need no game rows', () => {
        expect(needsGameRows(DEFAULT_FILTERS)).toBe(false);
        expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    });
});
