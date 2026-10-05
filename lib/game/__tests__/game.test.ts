import { describe, expect, it } from 'vitest';
import { buildGame, parseSituation, strengthFor } from '../build';
import { goalSwings, skaterRows, teamTotals, winModel } from '../analytics';

const team = (id: number, abbrev: string) => ({ id, abbrev, commonName: { default: abbrev }, placeName: { default: abbrev }, score: 0, sog: 0 });
const spot = (playerId: number, teamId: number, pos: string) => ({ playerId, teamId, positionCode: pos, firstName: { default: 'P' }, lastName: { default: String(playerId) }, sweaterNumber: playerId % 100 });

// Away 1 (skaters 11-15, goalie 19), home 2 (skaters 21-25, goalie 29).
const roster = [11, 12, 13, 14, 15].map(i => spot(i, 1, i > 13 ? 'D' : 'C')).concat([spot(19, 1, 'G')], [21, 22, 23, 24, 25].map(i => spot(i, 2, i > 23 ? 'D' : 'C')), [spot(29, 2, 'G')]);

const play = (eventId: number, period: number, time: string, typeDescKey: string, details: object, situationCode = '1551', homeTeamDefendingSide = 'left') => ({
    eventId,
    periodDescriptor: { number: period, periodType: period > 3 ? 'OT' : 'REG' },
    timeInPeriod: time,
    situationCode,
    homeTeamDefendingSide,
    typeDescKey,
    details,
});

const pbp = {
    id: 2026020999,
    season: 20262027,
    gameType: 2,
    gameDate: '2026-10-10',
    startTimeUTC: '2026-10-10T23:00:00Z',
    gameState: 'OFF',
    gameOutcome: { lastPeriodType: 'REG' },
    periodDescriptor: { number: 3 },
    awayTeam: { ...team(1, 'AAA'), score: 1 },
    homeTeam: { ...team(2, 'BBB'), score: 1 },
    rosterSpots: roster,
    plays: [
        // Home shoots in period 1 at x = 80 (home defends left, attacks right): stays at +80.
        play(1, 1, '05:00', 'goal', { xCoord: 80, yCoord: 10, scoringPlayerId: 21, assist1PlayerId: 22, eventOwnerTeamId: 2, goalieInNetId: 19 }),
        // Away shoots in period 2 with sides swapped (home defends right): raw +80 is the right net, normalized to the left.
        play(2, 2, '10:00', 'shot-on-goal', { xCoord: 80, yCoord: -5, shootingPlayerId: 11, eventOwnerTeamId: 1, goalieInNetId: 29 }, '1551', 'right'),
        // Away goal with the goalie pulled: 6 on 5, not a power play.
        play(3, 3, '19:00', 'goal', { xCoord: -80, yCoord: 0, scoringPlayerId: 12, eventOwnerTeamId: 1 }, '0651'),
    ],
};

const fullShifts = (ids: number[]) => ids.flatMap(id => [1, 2, 3].map(period => ({ typeCode: 517, playerId: id, period, startTime: '00:00', endTime: '20:00' })));
const shifts = { data: fullShifts([11, 12, 13, 14, 15, 19, 21, 22, 23, 24, 25, 29]) };

const xg = new Map([
    [1, 0.3],
    [2, 0.1],
    [3, 0.2],
]);

describe('game model', () => {
    const m = buildGame({ pbp, shifts }, xg, { homeWin: 0.6, homeXg: 3.2, awayXg: 2.7, marketHome: 0.58, homeOdds: -140, awayOdds: 120, lean: false, correct: null });

    it('reads situation codes and keeps an extra attacker out of the power play', () => {
        expect(parseSituation('1451')).toEqual({ awayGoalie: true, away: 4, home: 5, homeGoalie: true });
        expect(strengthFor('home', parseSituation('1451'))).toBe('pp');
        expect(strengthFor('away', parseSituation('0651'))).toBe('ev');
        const pulled = m.events.find(e => e.id === 3)!;
        expect(pulled.strength).toBe('ev');
        expect(teamTotals(m.events, 'awayPP', 'all').away.goals).toBe(0);
    });

    it('normalizes every attack: home shoots right, away shoots left, whatever end they defend', () => {
        expect(m.events.find(e => e.id === 1)!.x).toBe(80);
        expect(m.events.find(e => e.id === 2)!.x).toBe(-80);
        expect(m.events.find(e => e.id === 2)!.t).toBe(1800);
    });

    it('counts time on ice from shifts and credits goals, assists and xG', () => {
        const home = skaterRows(m, 'home', 'all');
        const scorer = home.find(r => r.player.id === 21)!;
        expect(scorer.toi).toBe(3600);
        expect(scorer.g).toBe(1);
        expect(scorer.ixg).toBeCloseTo(0.3);
        expect(home.find(r => r.player.id === 22)!.a1).toBe(1);
        expect(scorer.gf).toBe(1);
        expect(scorer.ga).toBe(1);
    });

    it('anchors win probability on the pregame call and moves it toward the scorer', () => {
        const wm = winModel(m);
        expect(wm.at(0, 0)).toBeCloseTo(0.6, 2);
        expect(wm.at(3000, 1)).toBeGreaterThan(wm.at(1000, 1));
        expect(wm.at(3600, 1)).toBe(1);
        const [first] = goalSwings(m);
        expect(first.after).toBeGreaterThan(first.before);
    });
});
