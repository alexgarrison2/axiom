/**
 * FORM tab: a team's recent games, newest first, and the numbers that sum
 * them up. Pure, so the vitest suite checks what the panel shows.
 *
 * Games come from the same per-team rows as the MATCHUP tab, but only this
 * season's: form never reaches back into last season, so early on a team
 * simply has fewer games. Tonight's game is never part of the form, and a
 * game can only count if it was played before tonight's date.
 */
import { goalieMatchKey, sideValues, type MatchupGame } from './matchup-stats';
import { SEASON_ID, SEASON_START_DATE } from '../season';
import type { RecentGame } from '../../types/prediction';

export type Outcome = 'W' | 'L' | 'OTL';

export interface Result {
    outcome: Outcome;
    /** "OT" or "SO" when the game went past regulation. */
    extra: 'OT' | 'SO' | null;
}

const RESULTS: Record<string, Result> = {
    RW: { outcome: 'W', extra: null },
    OTW: { outcome: 'W', extra: 'OT' },
    SOW: { outcome: 'W', extra: 'SO' },
    RL: { outcome: 'L', extra: null },
    OTL: { outcome: 'OTL', extra: 'OT' },
    SOL: { outcome: 'OTL', extra: 'SO' },
};

export function resultOf(code: string): Result {
    return RESULTS[code] ?? { outcome: 'L', extra: null };
}

/** The team's games this season before tonight, newest first; at most `n` (all when omitted). */
export function recentGames(games: MatchupGame[], tonightId: string, tonightDate: string, n?: number): MatchupGame[] {
    const played = games.filter(g => g.row.season === SEASON_ID && g.row.id !== tonightId && g.row.date < tonightDate).sort((a, b) => b.row.date.localeCompare(a.row.date) || b.row.id.localeCompare(a.row.id));
    return n ? played.slice(0, n) : played;
}

export interface Record3 {
    w: number;
    l: number;
    otl: number;
}

export function recordOf(games: MatchupGame[]): Record3 {
    const r = { w: 0, l: 0, otl: 0 };
    for (const g of games) {
        const o = resultOf(g.row.result).outcome;
        if (o === 'W') r.w++;
        else if (o === 'OTL') r.otl++;
        else r.l++;
    }
    return r;
}

export const fmtRecord = (r: Record3) => `${r.w}-${r.l}-${r.otl}`;

/** The current run ("W3", "L2", "OTL1") from a newest-first list, or null with no games. */
export function streakOf(games: MatchupGame[]): { outcome: Outcome; n: number } | null {
    if (!games.length) return null;
    const first = resultOf(games[0].row.result).outcome;
    let n = 0;
    for (const g of games) {
        if (resultOf(g.row.result).outcome !== first) break;
        n++;
    }
    return { outcome: first, n };
}

/** True when the game's starter is tonight's projected goalie. */
export function startedBy(game: MatchupGame, goalie: string | null | undefined): boolean {
    const key = goalieMatchKey(goalie);
    return !!key && goalieMatchKey(game.row.starter) === key;
}

export type FormStatKey = 'gf_gp' | 'ga_gp' | 'xgf_pct' | 'cf_pct' | 'pp_pct' | 'pk_pct';

export const FORM_STATS: { key: FormStatKey; label: string; fmt: (v: number) => string }[] = [
    { key: 'gf_gp', label: 'GF/GM', fmt: v => v.toFixed(1) },
    { key: 'ga_gp', label: 'GA/GM', fmt: v => v.toFixed(1) },
    { key: 'xgf_pct', label: 'xGF%', fmt: v => v.toFixed(1) },
    { key: 'cf_pct', label: 'CF%', fmt: v => v.toFixed(1) },
    { key: 'pp_pct', label: 'PP%', fmt: v => v.toFixed(1) },
    { key: 'pk_pct', label: 'PK%', fmt: v => v.toFixed(1) },
];

/** Fewer current-season games than this and "season" is no baseline worth printing. */
export const BASELINE_MIN_GP = 8;

/** This season's regular-season games before tonight: the baseline the last-N numbers are read against. */
export function baselineGames(games: MatchupGame[], tonightId: string, tonightDate: string): MatchupGame[] {
    return recentGames(games, tonightId, tonightDate).filter(g => g.row.type === 2);
}

export interface FormSummary {
    gp: number;
    values: ReturnType<typeof sideValues>;
    /** Per-stat season value, or null while the season is too young to print one. */
    baseline: Partial<Record<FormStatKey, number | null>>;
}

export function summarize(tri: string, last: MatchupGame[], season: MatchupGame[]): FormSummary {
    const values = sideValues(tri, last);
    const base = season.length >= BASELINE_MIN_GP ? sideValues(tri, season) : null;
    const baseline: FormSummary['baseline'] = {};
    for (const s of FORM_STATS) baseline[s.key] = base ? base[s.key] : null;
    return { gp: last.length, values, baseline };
}

// ── entries: the game log plus games the log has not caught up with ─────────

/** One game on the FORM list: from the full game log, or (metrics missing) from the slate's own recent-games list. */
export interface FormEntry {
    key: string;
    date: string;
    opp: string;
    home: boolean;
    outcome: Outcome;
    extra: 'OT' | 'SO' | null;
    gf: number;
    ga: number;
    starter: string;
    /** The full game-log row, when the log has this game (xG, shots and the rest). */
    game: MatchupGame | null;
}

const RECENT_RESULTS: Record<string, Result> = {
    W: { outcome: 'W', extra: null },
    'W-OT': { outcome: 'W', extra: 'OT' },
    'W-SO': { outcome: 'W', extra: 'SO' },
    L: { outcome: 'L', extra: null },
    O: { outcome: 'OTL', extra: 'OT' },
    'L-OT': { outcome: 'OTL', extra: 'OT' },
};

const parseScore = (score: string): [number, number] | null => {
    const m = score.match(/^(\d+)\s*[-–]\s*(\d+)/);
    return m ? [Number(m[1]), Number(m[2])] : null;
};

/**
 * This season's games before tonight, newest first. The game log is rebuilt
 * once a day, so a game played last night can be missing from it while the
 * slate's recent-games list (refreshed hourly) already has it: those games
 * are added with just their result and score rather than shown as "no games".
 */
export function buildEntries(games: MatchupGame[], recent: RecentGame[], tonightId: string, tonightDate: string, n: number): FormEntry[] {
    const logged: FormEntry[] = recentGames(games, tonightId, tonightDate).map(g => {
        const r = resultOf(g.row.result);
        return { key: g.row.id, date: g.row.date, opp: g.row.opp, home: g.row.home, outcome: r.outcome, extra: r.extra, gf: g.row.gf, ga: g.row.ga, starter: g.row.starter, game: g };
    });
    const have = new Set(logged.map(e => `${e.date}|${e.opp}`));
    const ids = new Set(logged.map(e => e.key));
    const extra: FormEntry[] = [];
    for (const r of recent) {
        const date = r.gameDate;
        if (!date || date >= tonightDate || date < SEASON_START_DATE) continue;
        if ((r.gameId != null && ids.has(String(r.gameId))) || have.has(`${date}|${r.opponent}`)) continue;
        const res = RECENT_RESULTS[r.result];
        const score = parseScore(r.score);
        if (!res || !score) continue;
        extra.push({ key: String(r.gameId ?? `${date}|${r.opponent}`), date, opp: r.opponent, home: r.isHome, outcome: res.outcome, extra: res.extra, gf: score[0], ga: score[1], starter: r.starter ?? '', game: null });
    }
    return [...logged, ...extra].sort((a, b) => b.date.localeCompare(a.date) || b.key.localeCompare(a.key)).slice(0, n);
}

export function recordOfEntries(entries: FormEntry[]): Record3 {
    const r = { w: 0, l: 0, otl: 0 };
    for (const e of entries) {
        if (e.outcome === 'W') r.w++;
        else if (e.outcome === 'OTL') r.otl++;
        else r.l++;
    }
    return r;
}

export function streakOfEntries(entries: FormEntry[]): { outcome: Outcome; n: number } | null {
    if (!entries.length) return null;
    const first = entries[0].outcome;
    let n = 0;
    for (const e of entries) {
        if (e.outcome !== first) break;
        n++;
    }
    return { outcome: first, n };
}

export function entryStartedBy(e: FormEntry, goalie: string | null | undefined): boolean {
    const key = goalieMatchKey(goalie);
    return !!key && goalieMatchKey(e.starter) === key;
}
