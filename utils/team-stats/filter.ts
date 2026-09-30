import type { Division, GameRow, PeriodFilter } from './types';
import { DIVISIONS } from './teams';

export type Scope = 'regular' | 'playoffs';
export type Location = 'All' | 'Home' | 'Away';
export type Recent = 'All' | 5 | 10 | 20;
export type TriState = 'All' | 'Yes' | 'No';
export type TableView = 'all' | 'today' | 'tomorrow' | 'bracket';

/** Per-game numeric range filters (min/max), applied before aggregating. */
export const RANGE_FILTERS = [
    { key: 'gf', label: 'Goals for', step: 1, get: (g: GameRow) => g.gf },
    { key: 'ga', label: 'Goals against', step: 1, get: (g: GameRow) => g.ga },
    { key: 'sf', label: 'Shots for', step: 1, get: (g: GameRow) => g.sf },
    { key: 'sa', label: 'Shots against', step: 1, get: (g: GameRow) => g.sa },
    { key: 'sd', label: 'Shot differential', step: 1, get: (g: GameRow) => g.sf - g.sa },
    { key: 'hdf', label: 'High-danger for', step: 1, get: (g: GameRow) => g.hdf },
    { key: 'hda', label: 'High-danger against', step: 1, get: (g: GameRow) => g.hda },
    { key: 'cf', label: 'Shot attempts for', step: 1, get: (g: GameRow) => g.cf },
    { key: 'ca', label: 'Shot attempts against', step: 1, get: (g: GameRow) => g.ca },
    { key: 'cd', label: 'Attempt differential', step: 1, get: (g: GameRow) => g.cf - g.ca },
    { key: 'xgd', label: 'xG differential', step: 0.1, get: (g: GameRow) => g.xgf - g.xga },
    { key: 'ppo', label: 'Power plays', step: 1, get: (g: GameRow) => g.ppo },
    { key: 'pko', label: 'Times shorthanded', step: 1, get: (g: GameRow) => g.pko },
    { key: 'svp', label: 'Save % (0–1)', step: 0.001, get: (g: GameRow) => (g.sa > 0 ? g.saves / g.sa : 0) },
] as const;

export type RangeKey = (typeof RANGE_FILTERS)[number]['key'];
const RANGE_KEYS = new Set<string>(RANGE_FILTERS.map(r => r.key));

export interface GameLevelFilters {
    ppg: TriState;
    ppga: TriState;
    scoredFirst: TriState;
    ranges: Partial<Record<RangeKey, [string, string]>>;
}

export interface TableFilters extends GameLevelFilters {
    scope: Scope;
    view: TableView;
    withLocation: boolean;
    withStarter: boolean;
    withDow: boolean;
    location: Location;
    recent: Recent;
    period: PeriodFilter;
    divisions: Division[];
    position: 'All' | 'In' | 'Out';
}

export const DEFAULT_FILTERS: TableFilters = {
    scope: 'regular',
    view: 'all',
    withLocation: false,
    withStarter: false,
    withDow: false,
    location: 'All',
    recent: 'All',
    period: 'All',
    divisions: [],
    position: 'All',
    ppg: 'All',
    ppga: 'All',
    scoredFirst: 'All',
    ranges: {},
};

const PERIODS: PeriodFilter[] = ['All', '1st', '2nd', '3rd', 'OT'];
const RECENTS: Recent[] = ['All', 5, 10, 20];
const TRI: TriState[] = ['All', 'Yes', 'No'];

function oneOf<T>(v: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(v as T) ? (v as T) : fallback;
}

/**
 * Validate persisted (sessionStorage) filters against today's allowed set.
 * Anything stale or unknown — an old "Olympics" preset, a "Playoffs" scope
 * for a season without playoff games, a removed view — falls back to the
 * default instead of rendering an empty table.
 */
export function sanitizeFilters(raw: unknown, allow: { playoffs: boolean; bracket: boolean }): TableFilters {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_FILTERS, ranges: {} };
    const r = raw as Record<string, unknown>;
    const views: TableView[] = allow.bracket ? ['all', 'today', 'tomorrow', 'bracket'] : ['all', 'today', 'tomorrow'];
    const ranges: GameLevelFilters['ranges'] = {};
    if (r.ranges && typeof r.ranges === 'object') {
        for (const [k, v] of Object.entries(r.ranges as Record<string, unknown>)) {
            if (!RANGE_KEYS.has(k) || !Array.isArray(v) || v.length !== 2) continue;
            const [lo, hi] = v.map(x => (typeof x === 'string' && (x === '' || Number.isFinite(parseFloat(x))) ? x : ''));
            if (lo !== '' || hi !== '') ranges[k as RangeKey] = [lo, hi];
        }
    }
    return {
        scope: allow.playoffs ? oneOf(r.scope, ['regular', 'playoffs'] as Scope[], 'regular') : 'regular',
        view: oneOf(r.view, views, 'all'),
        withLocation: r.withLocation === true,
        withStarter: r.withStarter === true,
        withDow: r.withDow === true,
        location: oneOf(r.location, ['All', 'Home', 'Away'] as Location[], 'All'),
        recent: oneOf(r.recent, RECENTS, 'All'),
        period: oneOf(r.period, PERIODS, 'All'),
        divisions: Array.isArray(r.divisions) ? (r.divisions.filter(d => DIVISIONS.includes(d as Division)) as Division[]) : [],
        position: oneOf(r.position, ['All', 'In', 'Out'] as const, 'All'),
        ppg: oneOf(r.ppg, TRI, 'All'),
        ppga: oneOf(r.ppga, TRI, 'All'),
        scoredFirst: oneOf(r.scoredFirst, TRI, 'All'),
        ranges,
    };
}

/** True when the per-game rows are needed (anything but the default aggregate). */
export function needsGameRows(f: TableFilters): boolean {
    return (
        f.scope !== 'regular' ||
        f.location !== 'All' ||
        f.recent !== 'All' ||
        f.period !== 'All' ||
        f.withLocation ||
        f.withStarter ||
        f.withDow ||
        hasGameLevelFilters(f)
    );
}

export function hasGameLevelFilters(f: GameLevelFilters): boolean {
    return f.ppg !== 'All' || f.ppga !== 'All' || f.scoredFirst !== 'All' || Object.values(f.ranges).some(v => v && (v[0] !== '' || v[1] !== ''));
}

/** Number of active (non-default) filters, for the "Filters (n)" badge. */
export function activeFilterCount(f: TableFilters): number {
    let n = 0;
    if (f.scope !== 'regular') n++;
    if (f.location !== 'All') n++;
    if (f.recent !== 'All') n++;
    if (f.period !== 'All') n++;
    if (f.divisions.length) n++;
    if (f.position !== 'All') n++;
    if (f.ppg !== 'All') n++;
    if (f.ppga !== 'All') n++;
    if (f.scoredFirst !== 'All') n++;
    n += Object.values(f.ranges).filter(v => v && (v[0] !== '' || v[1] !== '')).length;
    return n;
}

/** Last name + first initial, so "Sam Montembeault" matches "Samuel Montembeault". */
export function goalieKey(name: string): string {
    const clean = name.replace(/\s*\(.*?\)\s*/g, '').trim();
    const parts = clean.split(/\s+/);
    if (parts.length < 2) return clean.toLowerCase();
    return `${parts[parts.length - 1].toLowerCase()},${parts[0][0]?.toLowerCase() ?? ''}`;
}

export interface GameFilterOptions extends GameLevelFilters {
    scope: Scope;
    location: Location;
    recent: Recent;
    starter?: string;
    /** 0 = Sunday … 6 = Saturday. */
    dayOfWeek?: number;
}

/**
 * Filter one team's games (newest first). Game type is applied first, so
 * "Last 10" in the regular season never reaches back into the playoffs.
 */
export function filterGames(games: GameRow[], o: GameFilterOptions): GameRow[] {
    const type = o.scope === 'playoffs' ? 3 : 2;
    let out = games.filter(g => g.type === type);
    if (o.location !== 'All') out = out.filter(g => g.home === (o.location === 'Home'));
    if (o.starter) {
        const key = goalieKey(o.starter);
        out = out.filter(g => g.starter && goalieKey(g.starter) === key);
    }
    if (o.dayOfWeek !== undefined) out = out.filter(g => new Date(`${g.date}T12:00:00`).getDay() === o.dayOfWeek);
    if (o.ppg !== 'All') out = out.filter(g => (g.ppg >= 1) === (o.ppg === 'Yes'));
    if (o.ppga !== 'All') out = out.filter(g => (g.ppga >= 1) === (o.ppga === 'Yes'));
    if (o.scoredFirst !== 'All') out = out.filter(g => (g.sfirst === 1) === (o.scoredFirst === 'Yes'));
    for (const rf of RANGE_FILTERS) {
        const v = o.ranges[rf.key];
        if (!v) continue;
        const lo = v[0] === '' ? NaN : parseFloat(v[0]);
        const hi = v[1] === '' ? NaN : parseFloat(v[1]);
        if (Number.isFinite(lo)) out = out.filter(g => rf.get(g) >= lo);
        if (Number.isFinite(hi)) out = out.filter(g => rf.get(g) <= hi);
    }
    if (o.recent !== 'All') out = out.slice(0, o.recent);
    return out;
}

/** Group newest-first rows by team. */
export function groupByTeam(rows: GameRow[]): Map<string, GameRow[]> {
    const m = new Map<string, GameRow[]>();
    for (const r of rows) {
        const list = m.get(r.tri);
        if (list) list.push(r);
        else m.set(r.tri, [r]);
    }
    return m;
}
