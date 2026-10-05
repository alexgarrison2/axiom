/**
 * The /games/[id] model: one NHL game normalized from the NHL feeds
 * (play-by-play, shift charts, boxscore, landing) plus pony xG per shot.
 * Built on the server (lib/game/build.ts), analysed on either side
 * (lib/game/analytics.ts).
 *
 * Time is game seconds from puck drop (period 1 = 0..1200). Rink
 * coordinates are feet from centre ice with every attack normalized: the
 * away team shoots at the left net (x < 0), the home team at the right
 * (x > 0), whatever end they defended in each period.
 */

export type Side = 'away' | 'home';
export const SIDES: Side[] = ['away', 'home'];
export const other = (s: Side): Side => (s === 'away' ? 'home' : 'away');

export interface TeamInfo {
    side: Side;
    id: number;
    tri: string;
    /** "Panthers" */
    name: string;
    /** "Florida" */
    place: string;
    score: number;
    sog: number;
}

export type Pos = 'C' | 'L' | 'R' | 'D' | 'G';

export interface Player {
    id: number;
    side: Side;
    first: string;
    last: string;
    num: number | null;
    pos: Pos;
    headshot: string | null;
}

export type EventType = 'goal' | 'shot' | 'miss' | 'block' | 'faceoff' | 'hit' | 'giveaway' | 'takeaway' | 'penalty';

/** Skaters and goalies on the ice for each side (from the NHL situation code). */
export interface Situation {
    away: number;
    home: number;
    awayGoalie: boolean;
    homeGoalie: boolean;
}

/** From the acting side's point of view. */
export type Strength = 'ev' | 'pp' | 'sh';

export interface GameEvent {
    id: number;
    t: number;
    period: number;
    /** Elapsed in the period, "16:18". */
    clock: string;
    type: EventType;
    /** The acting side: shooter's team, faceoff winner, hitter, player who gave/took the puck, penalised team. */
    side: Side;
    /** Shooter, faceoff winner, hitter, puck carrier, penalised player. */
    player: number | null;
    /** Goalie in net (shots), faceoff loser, hittee, blocker (blocked shots), player who drew the penalty. */
    other: number | null;
    assists: number[];
    x: number | null;
    y: number | null;
    shotType: string | null;
    /** pony xG; null for blocked attempts and shots our model has not scored yet. */
    xg: number | null;
    situation: Situation;
    strength: Strength;
    /** 5 skaters + goalie a side. */
    fiveOnFive: boolean;
    /** The defending net was empty. */
    emptyNet: boolean;
    /** Score before the event. */
    score: { away: number; home: number };
    /** Zone from the acting side's view (O / N / D). */
    zone: 'O' | 'N' | 'D' | null;
    /** Missed-shot reason, penalty description. */
    detail: string | null;
    /** Penalty minutes. */
    minutes: number | null;
    /** NHL highlight clip (goals). */
    clip: string | null;
}

/** [start, end) in game seconds. */
export type Shift = [number, number];

export interface Pregame {
    /** pony xG home win probability, 0..1. */
    homeWin: number;
    homeXg: number | null;
    awayXg: number | null;
    /** De-vigged market home probability, 0..1. */
    marketHome: number | null;
    homeOdds: number | null;
    awayOdds: number | null;
    /** No pick: the model saw a coin flip. */
    lean: boolean;
    /** Graded result (finished games). */
    correct: boolean | null;
}

/** Closing lines (Bovada / DraftKings, odds_closing.json), American odds per side. */
export interface GameOdds {
    source: string | null;
    ml: Record<Side, number | null>;
    puckline: Record<Side, { spread: number; price: number | null } | null>;
    total: { line: number; over: number | null; under: number | null } | null;
    firstPeriod: Record<Side, number | null>;
    /** Regulation result: away / tie / home. */
    threeWay: { away: number | null; tie: number | null; home: number | null } | null;
    /** First-period 3-way. */
    firstPeriodThreeWay: { away: number | null; tie: number | null; home: number | null } | null;
}

/** pony xG season simulation, per team: playoff and Cup chances before and after this game. */
export interface SeasonOdds {
    before: Record<Side, { playoffs: number; cup: number } | null>;
    after: Record<Side, { playoffs: number; cup: number } | null>;
    beforeAt: string | null;
    afterAt: string | null;
}

export interface Star {
    star: number;
    playerId: number;
    side: Side;
    line: string;
}

export type GameState = 'pre' | 'live' | 'final';

export interface GameModel {
    id: number;
    season: string;
    gameType: number;
    date: string;
    startUtc: string;
    venue: string | null;
    state: GameState;
    /** OT / SO when the game went past regulation. */
    outcome: 'REG' | 'OT' | 'SO' | null;
    /** Live clock: current period and time remaining in it. */
    live: { period: number; remaining: string; intermission: boolean } | null;
    /** Seconds of regulation per period (1200) and OT length (300 regular season, 1200 playoffs). */
    otLength: number;
    /** Last second of play. */
    end: number;
    teams: Record<Side, TeamInfo>;
    players: Player[];
    events: GameEvent[];
    shifts: Record<number, Shift[]>;
    /** Boxscore extras the play-by-play does not carry. */
    box: Record<number, { pim: number; plusMinus: number; shifts: number; foPct: number | null }>;
    /** Shootout attempts (not on the clock). */
    shootout: { side: Side; player: number | null; goal: boolean }[];
    stars: Star[];
    pregame: Pregame | null;
    odds: GameOdds | null;
    /** Playoff and Cup chances before / after the game. */
    outlook: SeasonOdds | null;
    /** Official NHL figures where ours are only an estimate (power play "goals/opportunities"). */
    official: { pp: Record<Side, string> } | null;
    /** Shots that should carry pony xG but do not yet (live games, last night before the nightly run). */
    xgPending: boolean;
}
