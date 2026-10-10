import type { GameEvent, GameModel, Player, Shift, Side } from './types';

/**
 * A team's season as one game model, so every game-page view (skaters,
 * units, lines, zones, shots, xG, Pony Score…) can show the season with no
 * code of its own. Each game is turned so the team is always 'away' (left,
 * attacking the left net) and every opponent becomes one 'home' side, "OPP";
 * the games then run one after another on a single clock with a gap between
 * them (no shift spans it, so no on-ice stretch crosses games). `starts`
 * keeps each game's start, so period filters stay per game.
 */

const GAP = 600;
/** The pooled opponents' goalie (no NHL player id is this small). */
export const OPP_GOALIE = 1;

const flipSide = (s: Side): Side => (s === 'away' ? 'home' : 'away');

export function mergeSeason(games: GameModel[], tri: string): GameModel | null {
    const mine = games.filter(g => g.teams.away.tri === tri || g.teams.home.tri === tri).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    if (!mine.length) return null;
    const first = mine[0];
    const teamSide0: Side = first.teams.away.tri === tri ? 'away' : 'home';

    const events: GameEvent[] = [];
    const players = new Map<number, Player>();
    const shifts: Record<number, Shift[]> = {};
    const box: GameModel['box'] = {};
    const ratings: GameModel['ratings'] = {};
    const starts: number[] = [];
    const list: { id: number; date: string; opp: string; home: boolean }[] = [];
    let offset = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;
    let sogFor = 0;
    let sogAgainst = 0;

    for (const [gi, g] of mine.entries()) {
        const flip = g.teams.home.tri === tri;
        const side = (s: Side): Side => (flip ? flipSide(s) : s);
        // Every opposing goalie is one 'Opponent goalies' player, so the season shows one OPP goalie line.
        const oppGoalies = new Set(g.players.filter(p => p.pos === 'G' && side(p.side) === 'home').map(p => p.id));
        const pid = (id: number | null) => (id != null && oppGoalies.has(id) ? OPP_GOALIE : id);
        starts.push(offset);
        list.push({ id: g.id, date: g.date, opp: flip ? g.teams.away.tri : g.teams.home.tri, home: flip });
        for (const p of g.players) {
            if (oppGoalies.has(p.id)) continue;
            players.set(p.id, { ...p, side: side(p.side) });
        }
        if (oppGoalies.size) players.set(OPP_GOALIE, { id: OPP_GOALIE, side: 'home', first: 'Opponent', last: 'goalies', num: null, pos: 'G', headshot: null });
        for (const [idStr, list] of Object.entries(g.shifts)) {
            const k = pid(Number(idStr))!;
            shifts[k] = [...(shifts[k] ?? []), ...list.map(([a, b]) => [a + offset, b + offset] as Shift)];
        }
        for (const [id, b] of Object.entries(g.box)) {
            const k = pid(Number(id))!;
            const prev = box[k];
            box[k] = prev ? { pim: prev.pim + b.pim, plusMinus: prev.plusMinus + b.plusMinus, shifts: prev.shifts + b.shifts, foPct: null } : { ...b };
        }
        Object.assign(ratings, g.ratings);
        for (const e of g.events) {
            events.push({
                ...e,
                id: gi * 100_000 + e.id,
                player: pid(e.player),
                other: pid(e.other),
                t: e.t + offset,
                side: side(e.side),
                x: e.x == null ? null : flip ? -e.x : e.x,
                y: e.y == null ? null : flip ? -e.y : e.y,
                situation: flip ? { away: e.situation.home, home: e.situation.away, awayGoalie: e.situation.homeGoalie, homeGoalie: e.situation.awayGoalie } : e.situation,
                score: flip ? { away: e.score.home, home: e.score.away } : e.score,
            });
        }
        const us = flip ? g.teams.home : g.teams.away;
        const them = flip ? g.teams.away : g.teams.home;
        goalsFor += us.score;
        goalsAgainst += them.score;
        sogFor += us.sog;
        sogAgainst += them.sog;
        offset += Math.max(g.end, 3600) + GAP;
    }

    const team = first.teams[teamSide0];
    return {
        ...first,
        id: 0,
        date: mine[mine.length - 1].date,
        state: 'final',
        outcome: null,
        live: null,
        end: offset - GAP,
        teams: {
            away: { ...team, side: 'away', score: goalsFor, sog: sogFor },
            home: { side: 'home', id: 0, tri: 'OPP', name: 'Opponents', place: '', score: goalsAgainst, sog: sogAgainst },
        },
        players: [...players.values()],
        events,
        shifts,
        box,
        shootout: [],
        stars: [],
        pregame: null,
        odds: null,
        outlook: null,
        official: null,
        xgPending: mine.some(g => g.xgPending),
        ratings,
        starts,
        games: list,
    };
}
