import { describe, expect, it, vi } from 'vitest';
import type { GoalieGame, PonyGame, SkaterBox, SkaterGame } from '@/lib/pony/data';
import { bigSaves, goalieFoot, mmss, notable, recordOf, scoreLine, share, shutout, skaterFoot, svPct, takesDraws } from './gamelog';

vi.mock('server-only', () => ({}));

const parts = { oProd: 0, oDrive: 0, oSpecial: 0, oUsage: 0, dProd: 0, dDrive: 0, dSpecial: 0, dUsage: 0 };
const box = { ppp: 0, shp: 0, att: 0, gv: 0, tk: 0, foW: 0, foL: 0, shifts: 20, cf5: 10, ca5: 10, xgf5: 0.5, xga5: 0.5 };
const sk = (o: Omit<Partial<SkaterGame>, 'box'> & { box?: Partial<SkaterBox> | null } = {}): SkaterGame => ({
    game: 1,
    date: '2026-10-01',
    player: 9,
    team: 'COL',
    opp: 'DAL',
    home: true,
    result: 'W',
    rest: 1,
    toi: 1200,
    ps: 0,
    pos: 'F',
    parts,
    g: 0,
    a1: 0,
    a2: 0,
    sog: 0,
    ixg: 0,
    hit: 0,
    blk: 0,
    pim: 0,
    pm: 0,
    toiPp: 0,
    toiPk: 0,
    ...o,
    box: o.box === null ? null : { ...box, ...(o.box ?? {}) },
});
const gl = (o: Partial<GoalieGame> = {}): GoalieGame => ({
    game: 1,
    date: '2026-10-01',
    player: 1,
    team: 'NYR',
    opp: 'BOS',
    home: false,
    result: 'W',
    rest: 1,
    toi: 3600,
    ps: 0,
    sa: 30,
    ga: 2,
    xga: 2.5,
    box: { hdSa: 5, hdGa: 1, evSa: 24, evGa: 1, pkSa: 5, pkGa: 1, decision: 'W' },
    ...o,
});

describe('formatting', () => {
    it('reads clocks, shares and save rates', () => {
        expect(mmss(1259.6)).toBe('21:00');
        expect(mmss(59)).toBe('0:59');
        expect(share(3, 1)).toBe(75);
        expect(share(0, 0)).toBeNull();
        expect(svPct(30, 2)).toBe('.933');
        expect(svPct(9, 0)).toBe('1.000');
        expect(svPct(0, 0)).toBeNull();
    });
    it('gives the score from the player team side', () => {
        const g: PonyGame = { id: 1, date: '2026-10-01', away: 'BOS', home: 'NYR', awayScore: 2, homeScore: 5, outcome: 'REG' };
        expect(scoreLine(g, 'NYR')).toBe('5–2');
        expect(scoreLine(g, 'BOS')).toBe('2–5');
        expect(scoreLine(undefined, 'BOS')).toBeNull();
    });
});

describe('highlights', () => {
    it('marks standout nights only', () => {
        expect(notable('g', 2)).toBe(true);
        expect(notable('g', 1)).toBe(false);
        expect(notable('sog', 6)).toBe(true);
        expect(notable('ixg', 0.99)).toBe(false);
        expect(notable('shp', null)).toBe(false);
        expect(shutout(gl({ ga: 0 }))).toBe(true);
        expect(shutout(gl({ ga: 0, toi: 1500 }))).toBe(false);
        expect(bigSaves(gl({ sa: 40, ga: 2 }))).toBe(true);
        expect(bigSaves(gl({ sa: 20, ga: 0 }))).toBe(false);
    });
    it('shows faceoffs for players who take draws', () => {
        expect(takesDraws([sk({ box: { foW: 8, foL: 6 } }), sk({ box: { foW: 0, foL: 1 } })])).toBe(true);
        expect(takesDraws([sk({ box: { foW: 1, foL: 1 } }), sk({ box: { foW: 0, foL: 1 } })])).toBe(false);
        expect(takesDraws([])).toBe(false);
    });
});

describe('footers', () => {
    it('counts records', () => {
        expect(recordOf(['W', 'L', 'OTL', 'W', null, 'O'])).toBe('2–1–2');
    });
    it('sums skater games and averages per game, box extras over the games that have them', () => {
        const rows = [
            sk({ result: 'W', g: 2, a1: 1, sog: 5, ixg: 0.8, toi: 1200, toiPp: 120, ps: 1, box: { ppp: 1, att: 9, foW: 10, foL: 5, cf5: 12, ca5: 8, xgf5: 0.6, xga5: 0.2, shifts: 22 } }),
            sk({ result: 'OTL', a2: 1, sog: 3, ixg: 0.2, toi: 1080, pm: -1, ps: -0.5, box: { att: 4, foW: 5, foL: 10, cf5: 8, ca5: 12, xgf5: 0.2, xga5: 0.6, shifts: 18 } }),
            sk({ result: 'L', toi: 960, box: null }),
        ];
        const f = skaterFoot(rows);
        expect(f.gp).toBe(3);
        expect(f.record).toBe('1–1–1');
        expect(f.sum).toMatchObject({ g: 2, a: 2, a1: 1, a2: 1, p: 4, ppp: 1, sog: 8, att: 13, foW: 15, foL: 15, pm: -1 });
        expect(f.sum.ixg).toBeCloseTo(1);
        expect(f.sum.ps).toBeCloseTo(0.5);
        expect(f.per.g).toBeCloseTo(2 / 3);
        expect(f.per.toi).toBe(1080);
        expect(f.per.toiPp).toBe(40);
        // Extras average over the two games that carry them.
        expect(f.per.att).toBe(6.5);
        expect(f.per.shifts).toBe(20);
        expect(f.shPct).toBe(25);
        expect(f.foPct).toBe(50);
        expect(f.cf5).toBe(50);
        expect(f.xgf5).toBeCloseTo(50);
    });
    it('aggregates goalie games', () => {
        const f = goalieFoot([gl(), gl({ sa: 20, ga: 4, xga: 1.5, toi: 1800, box: { hdSa: 3, hdGa: 2, evSa: 18, evGa: 3, pkSa: 2, pkGa: 1, decision: 'L' } }), gl({ box: null, ga: 0, sa: 10 })]);
        expect(f.record).toBe('1–1–0');
        expect(f).toMatchObject({ gp: 3, sa: 60, ga: 6, hdSa: 8, hdGa: 3, evSa: 42, evGa: 4, pkSa: 7, pkGa: 2, toi: 9000 });
        expect(f.xga).toBeCloseTo(6.5);
        expect(f.gaa).toBeCloseTo(2.4);
    });
});

describe('season file', () => {
    it('reads the box-score extras, and none from a row stored before them', async () => {
        const fs = await import('node:fs');
        const os = await import('node:os');
        const path = await import('node:path');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pony-'));
        fs.mkdirSync(path.join(dir, 'public', 'data', 'pony'), { recursive: true });
        const gp = ['oProd', 'oDrive', 'oSpecial', 'oUsage', 'dProd', 'dDrive', 'dSpecial', 'dUsage'];
        const base = ['game', 'player', 'team', 'opp', 'home', 'pos', 'toi', 'ps', ...gp, 'g', 'a1', 'a2', 'sog', 'ixg', 'hit', 'blk', 'pim', 'pm', 'toi_pp', 'toi_pk'];
        const row = [2026020001, 9, 'COL', 'DAL', 1, 'F', 1200, 0.5, ...gp.map(() => 0), 1, 0, 1, 4, 0.5, 2, 1, 0, 1, 120, 0];
        fs.writeFileSync(
            path.join(dir, 'public', 'data', 'pony', '20262027.json'),
            JSON.stringify({
                season: '20262027',
                built_at: 'x',
                games: { '2026020001': ['2026-10-01', 'DAL', 'COL', 2, 3, 'REG'], '2026020002': ['2026-10-03', 'COL', 'VGK', 1, 4, 'REG'] },
                players: { '9': ['A', 'B', 'C', 9, null, 'COL'], '1': ['G', 'H', 'G', 1, null, 'COL'] },
                skater_cols: [...base, 'ppp', 'shp', 'att', 'gv', 'tk', 'fow', 'fol', 'shf', 'cf5', 'ca5', 'xgf5', 'xga5'],
                skaters: [
                    [...row, 1, 0, 7, 1, 2, 9, 6, 24, 15, 10, 0.8, 0.4],
                    [2026020002, ...row.slice(1)],
                ],
                goalie_cols: ['game', 'player', 'team', 'opp', 'home', 'toi', 'sa', 'ga', 'xga', 'ps', 'hd_sa', 'hd_ga', 'ev_sa', 'ev_ga', 'pk_sa', 'pk_ga', 'dec'],
                goalies: [
                    [2026020001, 1, 'COL', 'DAL', 1, 3600, 30, 2, 2.5, 0.5, 4, 1, 25, 1, 4, 1, 'W'],
                    [2026020002, 1, 'COL', 'VGK', 0, 3600, 30, 4, 2.5, -1.5, 4, 1, 25, 1, 4, 1, ''],
                ],
            }),
        );
        const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir);
        const { loadPonySeason, playerGames } = await import('@/lib/pony/data');
        const data = loadPonySeason('20262027')!;
        const { skater, goalie } = playerGames(data, 9);
        expect(goalie).toEqual([]);
        expect(skater[0].box).toEqual({ ppp: 1, shp: 0, att: 7, gv: 1, tk: 2, foW: 9, foL: 6, shifts: 24, cf5: 15, ca5: 10, xgf5: 0.8, xga5: 0.4 });
        expect(skater[1].box).toBeNull();
        const g = playerGames(data, 1).goalie;
        expect(g[0].box).toEqual({ hdSa: 4, hdGa: 1, evSa: 25, evGa: 1, pkSa: 4, pkGa: 1, decision: 'W' });
        expect(g[1].box?.decision).toBeNull();
        cwd.mockRestore();
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
