/**
 * Slate days outside predictions_detailed.csv: past days (finals with the
 * frozen pregame pick graded) and future days (the schedule, before the
 * predictions post). Pure helpers; the server fetch lives in archive-server.
 */
import type { GameState } from '../../types/prediction';
import { TEAM_NAMES } from '../../components/ui/team-color';
import { isCoinFlip } from './format';

export interface ArchiveSide {
    tri: string;
    name: string;
    score: number | null;
}

export interface ArchivePick {
    /** Team the model picked. */
    tri: string;
    /** Its pregame win probability, 0-100. */
    pct: number;
    /** null while the game is not final. */
    correct: boolean | null;
}

export interface ArchiveGame {
    id: string;
    date: string;
    startTimeUtc: string;
    state: GameState;
    /** REG / OT / SO. */
    lastPeriodType: string | null;
    away: ArchiveSide;
    home: ArchiveSide;
    /** Frozen pregame pick, or null when none was made before puck drop. */
    pick: ArchivePick | null;
}

export interface ArchiveSlate {
    date: string;
    games: ArchiveGame[];
    /** False when the schedule could not be loaded (never claim "no games" then). */
    scheduleKnown: boolean;
}

/** One graded record from data/prediction_history.json. */
export interface HistoryRow {
    gameId?: number | string;
    date?: string;
    homeTeam?: string;
    awayTeam?: string;
    homeScore?: number | null;
    awayScore?: number | null;
    decision?: string | null;
    homeWinProb?: number | null;
    isCorrect?: boolean | null;
    retro?: boolean;
    startUtc?: string | null;
}

/** Trimmed NHL api-web /v1/score/{date} game. */
export interface NhlScoreGame {
    id?: number;
    gameDate?: string;
    startTimeUTC?: string;
    gameState?: string;
    gameScheduleState?: string;
    gameOutcome?: { lastPeriodType?: string };
    awayTeam?: { abbrev?: string; name?: { default?: string }; score?: number };
    homeTeam?: { abbrev?: string; name?: { default?: string }; score?: number };
}

const STATES = new Set<GameState>(['FUT', 'PRE', 'LIVE', 'CRIT', 'FINAL', 'OFF']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD that survives a round trip through Date (rejects 2026-02-30). */
export function validDate(s: string | null | undefined): s is string {
    if (!s || !DATE_RE.test(s)) return false;
    const t = Date.parse(`${s}T00:00:00Z`);
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Heading date: "Thu, Oct 1", with the year once the date is far from today ("Tue, Jan 1, 2030"). */
export function slateHeading(date: string, today: string): string {
    const [y, m, d] = date.split('-').map(Number);
    const far = Math.abs(Date.UTC(y, m - 1, d) - Date.parse(`${today}T00:00:00Z`)) > 150 * 86_400_000;
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        ...(far ? { year: 'numeric' as const } : {}),
        timeZone: 'UTC',
    });
}

/** Document title for a slate day: "NHL predictions for Thu, Oct 1 | Pony xG". */
export function slateTitle(date: string, today: string): string {
    return `NHL predictions for ${slateHeading(date, today)} | Pony xG`;
}

const BY_SHORT = new Map(Object.entries(TEAM_NAMES).map(([tri, t]) => [t.short.toLowerCase(), tri]));

export function triFromName(name: string | null | undefined): string | null {
    if (!name) return null;
    return BY_SHORT.get(name.toLowerCase()) ?? null;
}

const shortName = (tri: string, fallback?: string | null) => TEAM_NAMES[tri]?.short ?? fallback ?? tri;

/** Pregame pick from a graded history row (retro rows were not made before puck drop). */
export function pickFromHistory(h: HistoryRow, homeTri: string, awayTri: string): ArchivePick | null {
    if (h.retro || h.homeWinProb == null || !Number.isFinite(h.homeWinProb) || h.homeWinProb === 50) return null;
    const homePick = h.homeWinProb > 50;
    const raw = homePick ? h.homeWinProb : 100 - h.homeWinProb;
    return {
        tri: homePick ? homeTri : awayTri,
        // A coin flip keeps its decimal (50.3, 50.8) so isCoinFlip still sees it: rounding 50.8 up to 51 would grade it as a pick.
        pct: isCoinFlip(raw) ? Math.round(raw * 10) / 10 : Math.round(raw),
        correct: typeof h.isCorrect === 'boolean' ? h.isCorrect : null,
    };
}

/**
 * Merge the NHL schedule/score feed for one day with the graded history.
 * When the feed is unavailable (null), fall back to the history rows alone.
 */
export function buildArchive(date: string, feed: NhlScoreGame[] | null, history: HistoryRow[]): ArchiveSlate {
    const hist = history.filter(h => h.date === date);
    const byId = new Map(hist.map(h => [String(h.gameId), h]));
    if (feed) {
        const games: ArchiveGame[] = [];
        for (const g of feed) {
            const away = g.awayTeam?.abbrev;
            const home = g.homeTeam?.abbrev;
            if (!g.id || !away || !home || (g.gameDate && g.gameDate !== date)) continue;
            if (g.gameScheduleState && g.gameScheduleState !== 'OK') continue;
            const state = (STATES.has(g.gameState as GameState) ? g.gameState : 'FUT') as GameState;
            const started = state !== 'FUT' && state !== 'PRE';
            const h = byId.get(String(g.id));
            const pick = h ? pickFromHistory(h, home, away) : null;
            const final = state === 'OFF' || state === 'FINAL';
            games.push({
                id: String(g.id),
                date,
                startTimeUtc: g.startTimeUTC ?? h?.startUtc ?? `${date}T23:00:00Z`,
                state,
                lastPeriodType: g.gameOutcome?.lastPeriodType ?? (h?.decision && h.decision !== 'REG' ? h.decision : final ? 'REG' : null),
                away: { tri: away, name: shortName(away, g.awayTeam?.name?.default), score: started ? g.awayTeam?.score ?? null : null },
                home: { tri: home, name: shortName(home, g.homeTeam?.name?.default), score: started ? g.homeTeam?.score ?? null : null },
                pick: pick && !final ? { ...pick, correct: null } : pick,
            });
        }
        return { date, games: sortArchive(games), scheduleKnown: true };
    }
    const games: ArchiveGame[] = [];
    for (const h of hist) {
        const home = triFromName(h.homeTeam);
        const away = triFromName(h.awayTeam);
        if (!home || !away || h.gameId == null) continue;
        const final = h.homeScore != null && h.awayScore != null;
        games.push({
            id: String(h.gameId),
            date,
            startTimeUtc: h.startUtc ?? `${date}T23:00:00Z`,
            state: final ? 'OFF' : 'FUT',
            lastPeriodType: h.decision ?? null,
            away: { tri: away, name: shortName(away), score: h.awayScore ?? null },
            home: { tri: home, name: shortName(home), score: h.homeScore ?? null },
            pick: pickFromHistory(h, home, away),
        });
    }
    return { date, games: sortArchive(games), scheduleKnown: false };
}

function sortArchive(games: ArchiveGame[]): ArchiveGame[] {
    return games.sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc) || a.id.localeCompare(b.id));
}

export function isFinalState(s: GameState): boolean {
    return s === 'OFF' || s === 'FINAL';
}

/**
 * The slate header's pick record for one day: graded finals only, and coin
 * flips (isCoinFlip, within 1 pt of 50) left out because they carry no lean.
 * /accuracy and model_report.py apply the same rule, so the three agree.
 */
export function slateRecord(games: ArchiveGame[]): { right: number; graded: number } {
    const graded = games.filter(g => isFinalState(g.state) && g.pick?.correct != null && !isCoinFlip(g.pick.pct));
    return { right: graded.filter(g => g.pick?.correct).length, graded: graded.length };
}

/** "FINAL", "FINAL/OT", "FINAL/SO". */
export function archiveFinalLabel(g: ArchiveGame): string {
    return g.lastPeriodType === 'OT' ? 'FINAL/OT' : g.lastPeriodType === 'SO' ? 'FINAL/SO' : 'FINAL';
}
