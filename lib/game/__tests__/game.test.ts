import { describe, expect, it } from 'vitest';
import { buildGame, parseSituation, strengthFor } from '../build';
import { clockOf, deployment, deservedSeries, gameScores, GS_PARTS, draws, FO_SPOTS, goalSwings, groupMatchups, hardMatches, lineGroups, matchups, teamOnIce, type PonyConstants, iceAt, periodAt, skaterRows, teamTotals, units, winModel, zoneStarts } from '../analytics';
import { mergeSeason } from '../season';
import { contrastRatio, legibleOn } from '@/components/ui/color';
import PONY from '@/public/data/pony_score.json';

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

    it('snapshots who is on the ice with box-score counts up to the moment', () => {
        const early = iceAt(m, 200)!;
        expect(early.skaters.home.find(r => r.player.id === 21)!.g).toBe(0);
        const later = iceAt(m, 1000)!;
        const scorer = later.skaters.home.find(r => r.player.id === 21)!;
        expect(scorer.g).toBe(1);
        expect(scorer.toi).toBe(1000);
        expect(scorer.shiftNo).toBe(1);
        expect(later.skaters.home.find(r => r.player.id === 22)!.a).toBe(1);
        expect(later.goalie.away!.ga).toBe(1);
        expect(later.goalie.away!.sa).toBe(1);
    });

    it('reads a whistle moment from the players on for it, not the faceoff group after', () => {
        // Home 21 is on until the goal at 5:00 and 25 jumps on for the faceoff after it.
        const p1 = shifts.data.filter(r => r.period !== 1 || (r.playerId !== 21 && r.playerId !== 25));
        const changed = { data: [...p1, { typeCode: 517, playerId: 21, period: 1, startTime: '00:00', endTime: '05:00' }, { typeCode: 517, playerId: 25, period: 1, startTime: '05:00', endTime: '20:00' }] };
        const g = buildGame({ pbp, shifts: changed }, xg, null);
        const snap = iceAt(g, 300)!;
        const scorer = snap.skaters.home.find(r => r.player.id === 21);
        expect(scorer?.shift).toBe(300);
        expect(scorer?.g).toBe(1);
        expect(snap.skaters.home.some(r => r.player.id === 25)).toBe(false);
    });

    it('splits a merged season\'s zone starts by each game\'s own period', () => {
        // Two games on one clock: each period's shift lands in its own column, not all after game 1 in "3rd+".
        const season = mergeSeason([m, { ...m, id: m.id + 1, date: '2026-10-12' }], 'AAA')!;
        expect(zoneStarts(season, 'away').get(11)!.fly).toEqual([2, 2, 2]);
    });

    it('credits goals and assists the shifts do not reach (a live report a shift behind)', () => {
        const g = buildGame({ pbp, shifts: { data: [] } }, xg, null);
        const home = skaterRows(g, 'home', 'all');
        expect(home.find(r => r.player.id === 21)?.g).toBe(1);
        expect(home.find(r => r.player.id === 22)?.a1).toBe(1);
    });

    it('counts unit results and stints per period', () => {
        const [line] = units(m, 'home', 'F');
        expect(line.gf).toBe(1);
        expect(line.stints).toBe(3);
        expect(units(m, 'home', 'F', 2)[0].gf).toBe(0);
    });

    it('cuts head to head at a moment and reads line against line', () => {
        const full = matchups(m);
        const half = matchups(m, 1800);
        expect(full.cells.get(11)!.get(21)!.toi).toBe(3600);
        expect(half.cells.get(11)!.get(21)!.toi).toBe(1800);
        expect(half.ice.get(21)!.toi).toBe(1800);
        const groups = { away: lineGroups(m, 'away'), home: lineGroups(m, 'home') };
        expect(groups.home.map(g => g.tag)).toEqual(['L1', 'D1']);
        const { cells, lift } = groupMatchups(m, groups.away.map(g => g.ids), groups.home.map(g => g.ids));
        expect(cells[0][0].toi).toBe(3600);
        expect(cells[0][0].g.home).toBe(full.cells.get(11)!.get(21)!.g.home);
        // Always on together is exactly what chance gives: no hard match.
        expect(lift[0][0]).toBe(1);
        expect(hardMatches(cells, lift).size).toBe(0);
    });

    it('tags each skater with his line or pair game by game', () => {
        const season = mergeSeason([m, { ...m, id: m.id + 1, date: '2026-10-12' }], 'AAA')!;
        const dep = deployment(season, 'away');
        expect(dep.n).toBe(2);
        expect(dep.tags.get(11)).toEqual(['L1', 'L1']);
        expect(dep.tags.get(14)).toEqual(['D1', 'D1']);
        expect(dep.games[0].map(g => g.tag)).toEqual(['L1', 'D1']);
    });

    it('puts each draw on its dot and keeps the wins that became shots', () => {
        const fo = (id: number, time: string, x: number, y: number, win: number, lose: number, owner: number) =>
            play(id, 1, time, 'faceoff', { xCoord: x, yCoord: y, winningPlayerId: win, losingPlayerId: lose, eventOwnerTeamId: owner, zoneCode: 'O' });
        const g = buildGame({ pbp: { ...pbp, plays: [fo(11, '00:30', -20, -22, 11, 21, 1), fo(10, '04:55', 68, 21, 21, 11, 2), ...pbp.plays] }, shifts }, xg, null);
        const [early, late] = draws(g).sort((a, b) => a.e.t - b.e.t);
        expect(FO_SPOTS[late.dot!]).toEqual([69, 22]);
        expect(late.win).toBe('home');
        expect(late.led?.type).toBe('goal');
        expect(FO_SPOTS[early.dot!]).toEqual([-20, -22]);
        expect(early.led).toBeNull();
    });

    it('builds the deserved line from shot xG and names any overtime', () => {
        const d = deservedSeries(m);
        expect(d[0][1]).toBe(0.5);
        expect(d[1][1]).toBeGreaterThan(0.5);
        expect(d[d.length - 1][1]).toBeGreaterThan(0);
        expect(periodAt(1800, 300)).toEqual({ period: 2, into: 600 });
        expect(clockOf(419.6)).toBe('7:00');
        expect(periodAt(3600 + 300 + 10, 300)).toEqual({ period: 5, into: 10 });
    });

    it('lifts a dark team colour to legible text contrast', () => {
        const c = legibleOn('#00875A', '#0a0e15');
        expect(contrastRatio(c, '#0a0e15')).toBeGreaterThanOrEqual(4.5);
        expect(legibleOn('#FFB81C', '#0a0e15')).toBe('#ffb81c');
    });

    it('scores a game (Pony Score): parts add up, the scorer leads, the goalie gets GSAx', () => {
        const C = PONY as unknown as PonyConstants;
        const { skaters, goalies } = gameScores(m, 'home', C);
        for (const r of skaters) expect(GS_PARTS.reduce((a, k) => a + r.parts[k], 0)).toBeCloseTo(r.total);
        const scorer = skaters.find(r => r.player.id === 21)!;
        expect(skaters[0].player.id).toBe(21);
        // Centred on the average forward's production per hour (he played the full 60:00).
        expect(scorer.parts.oProd).toBeCloseTo(C.k * 0.3 + C.assist.F.fin * (1 - C.k * 0.3) - (C.prod_mean60?.F.o ?? 0));
        expect(skaters.find(r => r.player.id === 22)!.raw.a1).toBe(1);
        expect(goalies[0].total).toBeCloseTo(C.k * goalies[0].xga - goalies[0].ga);
    });

    it('team totals count each shot once, not once per skater', () => {
        const t = teamOnIce(m, 'home', 'all');
        const r = skaterRows(m, 'home', 'all')[0];
        expect(t.cf).toBe(r.cf);
        expect(t.gf).toBe(1);
        expect(t.ga).toBe(1);
        expect(t.toi).toBeCloseTo(m.end);
    });
});
