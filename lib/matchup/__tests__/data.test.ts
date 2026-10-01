import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { biggestGames, type GameImplication, type GameImplicationsData } from '../../../utils/implications';
import { buildIndex, leagueContext, lineupView } from '../lineup-impact';
import { parseRatings } from '../../players/ratings';
import { disambiguate } from '../format';
import { GET as oddsHistory } from '../../../app/api/odds-history/route';
import { trimGame } from '../../../app/api/scores/route';

function imp(id: number, home: string, away: string, h: [number, number, number], a: [number, number, number]): GameImplication {
    const sc = (hp: number, ap: number) => ({ home_playoff_pct: hp, away_playoff_pct: ap, home_avg_pts: null, away_avg_pts: null });
    return {
        game_id: id,
        date: '2027-03-12',
        home_abbrev: home,
        away_abbrev: away,
        home_current_playoff_pct: h[0],
        away_current_playoff_pct: a[0],
        home_current_avg_pts: null,
        away_current_avg_pts: null,
        scenarios: {
            home_reg_win: sc(h[1], a[2]),
            home_otw: sc(h[1], a[2]),
            away_otw: sc(h[2], a[1]),
            away_reg_win: sc(h[2], a[1]),
        },
    };
}

describe('biggest games strip (E11)', () => {
    it('is hidden in October when no swing reaches 3 pts', () => {
        const oct: GameImplicationsData = { generated_at: '', games: [{ ...imp(1, 'EDM', 'VAN', [55, 56.2, 54], [50, 51, 49]), date: '2026-10-20' }] };
        expect(biggestGames(oct, '2026-10-20')).toEqual([]);
        expect(biggestGames({ generated_at: '', games: [] }, '2026-10-20')).toEqual([]);
    });

    it('orders a March slate by total swing', () => {
        const march: GameImplicationsData = {
            generated_at: '',
            games: [
                imp(1, 'BOS', 'MTL', [90, 92, 88], [20, 22, 18]),
                imp(2, 'EDM', 'VAN', [71, 74, 68], [48, 55, 41]),
                imp(3, 'CAR', 'NYR', [60, 64, 55], [30, 32, 28]),
            ],
        };
        const out = biggestGames(march, '2027-03-12');
        expect(out.map(s => s.gameId)).toEqual([2, 3, 1]);
        expect(out[0].home).toMatchObject({ tri: 'EDM', base: 71, win: 74, lose: 68 });
    });
});

describe('lineup ratings by player id (E6, RAPM NET)', () => {
    const cols = ['id', 'name', 'team', 'pos', 'roster', 'rated', 'off', 'def', 'net', 'toi', 'gp', 'toi_cur', 'gp_cur'];
    const ratings = parseRatings({
        season: '20262027',
        columns: cols,
        rows: [
            [8480801, 'Brady Tkachuk', 'FLA', 'L', true, true, 0.73, 0.0, 0.72, 3000, 220, 0, 0],
            [8479314, 'Matthew Tkachuk', 'FLA', 'L', true, true, 0.57, -0.09, 0.66, 2800, 210, 0, 0],
            [8477493, 'Aleksander Barkov', 'FLA', 'C', true, true, 0.29, -0.26, 0.54, 2600, 185, 0, 0],
            [8470000, 'Some Tkachuk', 'OTT', 'C', true, true, -0.1, 0.1, -0.2, 500, 40, 0, 0],
            [8490000, 'New Kid', 'FLA', 'C', true, false, -0.01, 0.0, -0.01, 0, 0, 0, 0],
        ],
    });
    const lineup = {
        f1: [{ name: 'Brady Tkachuk' }, { name: 'Aleksander Barkov' }, { name: 'Matthew Tkachuk' }],
        f2: [{ name: 'New Kid' }],
    };

    it('shows first initials for colliding last names and gives each Tkachuk his own NET', () => {
        const ctx = leagueContext(buildIndex(ratings), { FLA: lineup });
        const v = lineupView(ctx, lineup, 'FLA')!;
        const [b, , m] = v.lines.f1;
        expect(b.display).toBe('B. Tkachuk');
        expect(m.display).toBe('M. Tkachuk');
        expect(b.playerId).toBe(8480801);
        expect(m.playerId).toBe(8479314);
        expect(b.impact).toBe(0.72);
        expect(m.impact).toBe(0.66);
        expect(v.lines.f1[1].display).toBe('Barkov');
        expect(v.lineImpacts.f1?.total).toBe(1.92);
        // A skater with no NHL sample is resolved but unrated: no value, no line total.
        expect(v.lines.f2[0].playerId).toBe(8490000);
        expect(v.lines.f2[0].impact).toBeNull();
        expect(v.lineImpacts.f2).toBeNull();
    });

    it('never falls back to a bare last name', () => {
        const idx = buildIndex(ratings);
        expect(idx.resolve('Kyle Tkachuk', 'FLA')).toBeNull();
        expect(idx.resolve('Brady Tkachuk', 'FLA')?.id).toBe(8480801);
        expect(disambiguate(['Sam Reinhart', 'Sam Bennett']).get('Sam Bennett')).toBe('Bennett');
    });
});

describe('odds-history API input validation (E9)', () => {
    const call = (qs: string) => oddsHistory(new NextRequest(`http://localhost/api/odds-history?${qs}`));

    it('rejects a traversal date with 400 before touching the filesystem', async () => {
        const t = performance.now();
        const res = await call('gameId=1&date=../../pipeline/nhl_historical_shots');
        expect(res.status).toBe(400);
        expect(performance.now() - t).toBeLessThan(20);
    });

    it('rejects a bad game id', async () => {
        expect((await call('gameId=abc&date=2026-09-29')).status).toBe(400);
        expect((await call('gameId=2026020001&date=2026-9-29')).status).toBe(400);
        expect((await call('gameId=2026020001&date=2026-09-29&legacyId=../../x')).status).toBe(400);
    });

    it('returns entries with a public s-maxage header for a valid request', async () => {
        const res = await call('gameId=2026020003&date=2026-09-29&legacyId=2026-09-29-Blackhawks-Golden%20Knights');
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toMatch(/public.*s-maxage=300/);
        const body = await res.json();
        expect(Array.isArray(body.entries)).toBe(true);
        expect(body.entries.length).toBeGreaterThan(0);
        expect(body.entries[0].isOpen).toBe(true);
    });
});

describe('score feed trimming (E1)', () => {
    it('keeps state, clock, period type, scores and SOG', () => {
        const g = trimGame({
            id: 2026020001,
            gameState: 'OFF',
            periodDescriptor: { number: 4, periodType: 'OT' },
            clock: { timeRemaining: '00:05', inIntermission: false },
            gameOutcome: { lastPeriodType: 'OT' },
            awayTeam: { abbrev: 'FLA', score: 1, sog: 20 },
            homeTeam: { abbrev: 'CAR', score: 0, sog: 15 },
        })!;
        expect(g).toMatchObject({ id: '2026020001', state: 'OFF', period: 4, lastPeriodType: 'OT', away: { score: 1, sog: 20 }, home: { score: 0, sog: 15 } });
        expect(trimGame({ id: 5, gameState: 'FUT', awayTeam: { score: 0 }, homeTeam: { score: 0 } })!.away.score).toBeNull();
    });
});
