/**
 * Shapes of the precomputed postseason files written by
 * pipeline/build_playoff_archive.py:
 *   public/data/playoffs/<endYear>/summary.json   → PlayoffArchive
 *   public/data/playoffs/<endYear>/<gameId>.json  → PlayoffGameAnalysis
 */

export type Decision = 'REG' | 'OT' | 'SO';

export interface ArchiveGame {
    id: number;
    n: number;
    /** Local (Eastern) date, YYYY-MM-DD. */
    date: string;
    start_utc?: string;
    home: string;
    away: string;
    home_score: number | null;
    away_score: number | null;
    decision: Decision | null;
    state: 'final' | 'live' | 'scheduled';
    /** A per-game analysis file exists. */
    analysis: boolean;
}

export interface SeriesTeamTotals {
    goals: number;
    xg: number;
    sog: number;
    attempts: number;
    ppGoals: number;
    ppOpps: number;
    hits: number;
}

export interface ArchiveSeries {
    letter: string;
    round: 1 | 2 | 3 | 4;
    roundLabel: string;
    conference: 'East' | 'West' | null;
    top: { tri: string; seed: string };
    bottom: { tri: string; seed: string };
    topWins: number;
    bottomWins: number;
    winner: string | null;
    status: 'final' | 'in_progress' | 'scheduled';
    games: ArchiveGame[];
    totals: Record<string, SeriesTeamTotals>;
}

export interface H2HMeeting {
    date: string;
    home: string;
    away: string;
    homeGoals: number;
    awayGoals: number;
    decision: Decision;
}

export interface PlayoffArchive {
    schemaVersion: number;
    seasonId: string;
    seasonLabel: string;
    year: number;
    generatedAt: string;
    status: 'complete' | 'in_progress';
    champion: string | null;
    runnerUp: string | null;
    teams: Record<string, { name: string; short: string }>;
    series: ArchiveSeries[];
    h2h: Record<string, H2HMeeting[]>;
    leaders: {
        points: { playerId: string; name: string; team: string; gp: number; g: number; a: number; pts: number }[];
        goals: { playerId: string; name: string; team: string; gp: number; g: number; ixg: number }[];
        goalies: { name: string; team: string; gp: number; gsax: number; svPct: number | null }[];
    };
}

/* ── Per-game analysis ─────────────────────────────────────────────── */

export interface PlayoffShotEvent {
    eventId: number;
    period: number;
    timeSeconds: number;
    elapsedSeconds: number;
    /** Set on series aggregates. */
    gameNumber?: number;
    gameId?: string;
    teamTriCode: string;
    playerId: string;
    playerName: string;
    shotType: string;
    x: number;
    y: number;
    distance: number;
    angle: number;
    strength: string;
    isGoal: boolean;
    eventType: string;
    xG: number;
}

export interface PlayoffPlayerGameStat {
    playerId: string;
    name: string;
    teamTriCode: string;
    position: string;
    number?: string;
    toiSeconds: number;
    goals: number;
    shots: number;
    attempts: number;
    ixG: number;
    xGFor: number;
    xGAgainst: number;
    goalsFor: number;
    goalsAgainst: number;
    assists?: number;
    pim?: number;
    hits?: number;
    blockedShots?: number;
    faceoffWins?: number;
    faceoffLosses?: number;
    ppToiSeconds?: number;
    pkToiSeconds?: number;
}

export interface PlayoffGoalieGameStat {
    name: string;
    teamTriCode: string;
    toiSeconds: number;
    shotsAgainst: number;
    fenwickAgainst: number;
    goalsAgainst: number;
    xGA: number;
    gsax: number;
    savePct: number;
    expectedSavePct: number;
    deltaSavePct: number;
}

export interface PlayoffGameTeamSummary {
    triCode: string;
    goals: number;
    shots: number;
    attempts: number;
    xG: number;
    xG5v5: number;
    ppGoals: number;
    ppOpps: number;
    hits: number;
}

export interface PlayoffGameAnalysis {
    gameId: string;
    gameNumber: number;
    date: string;
    homeTriCode: string;
    awayTriCode: string;
    homeScore: number;
    awayScore: number;
    decision?: Decision | null;
    homeSummary: PlayoffGameTeamSummary;
    awaySummary: PlayoffGameTeamSummary;
    shots: PlayoffShotEvent[];
    players: PlayoffPlayerGameStat[];
    goalies: PlayoffGoalieGameStat[];
    maxGameSeconds: number;
}

/** "20252026" → 2026 (the directory under public/data/playoffs). */
export function archiveYear(seasonId: string): number | null {
    return /^\d{8}$/.test(seasonId) && Number(seasonId.slice(4)) === Number(seasonId.slice(0, 4)) + 1 ? Number(seasonId.slice(4)) : null;
}

/** 'MIN wins 4-2' / 'CAR leads 3-1' / 'Tied 2-2'. */
export function seriesStatusText(s: ArchiveSeries): string {
    const hi = Math.max(s.topWins, s.bottomWins);
    const lo = Math.min(s.topWins, s.bottomWins);
    if (s.winner) return `${s.winner} wins ${hi}-${lo}`;
    if (s.topWins === s.bottomWins) return s.topWins === 0 ? 'Not started' : `Tied ${hi}-${lo}`;
    const leader = s.topWins > s.bottomWins ? s.top.tri : s.bottom.tri;
    return `${leader} leads ${hi}-${lo}`;
}
