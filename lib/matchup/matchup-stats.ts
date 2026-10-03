/**
 * MATCHUP tab (tornado chart): pure logic shared by the static routes
 * (app/api/matchup-stats/*) and the browser.
 *
 * Window: last season + this season, regular season only (the label always
 * says so, e.g. "25-26 + 26-27"). Stat formulas come from the /teams table
 * (calculateTeamStats) except the three 5v5 xG rates, which need the
 * gamestats 5v5 xG / 5v5 TOI columns the shared game rows do not carry.
 *
 * Filters narrow EACH team by ITS OWN situation tonight:
 *   location — home team: home games only; away team: road games only
 *   rest     — games in the same rest bucket as tonight (B2B / 1 / 2 / 3+ days off)
 *   starter  — games started by tonight's projected starter
 *   last     — only the team's most recent N games (after location and rest, before starter)
 *
 * Percentiles ("better than X% of the league", so lower-is-better stats are
 * flipped and a longer bar is always better) rank a side's value against
 * every team's value over the same window under the same LOCATION side and
 * REST bucket. The starter filter has no league analog (it is one goalie),
 * so the reference ignores it; a home-only team is never ranked against
 * all-venue numbers, which would flatter it by home ice.
 */
import { calculateTeamStats } from '../../utils/team-stats/calculate';
import { unpackGames } from '../../utils/team-stats/game-row';
import type { GameRow, PackedGames } from '../../utils/team-stats/types';

// ── rest ─────────────────────────────────────────────────────────────────────

/** Days off before a game: 0 = back-to-back, 1, 2, 3 = three or more. */
export type RestBucket = 0 | 1 | 2 | 3;
export const REST_LABEL: Record<RestBucket, string> = { 0: 'B2B', 1: '1 DAY', 2: '2 DAYS', 3: '3+ DAYS' };

const dayNum = (ymd: string) => Math.round(Date.parse(`${ymd.slice(0, 10)}T12:00:00Z`) / 86_400_000);

/** Days off between two game dates (consecutive days = 0, a back-to-back). */
export function daysOff(prev: string, next: string): number {
    return dayNum(next) - dayNum(prev) - 1;
}

export function restBucket(off: number | null | undefined): RestBucket {
    if (off == null || !Number.isFinite(off) || off >= 3) return 3;
    return off <= 0 ? 0 : (off as 1 | 2);
}

/**
 * Rest bucket of each game, from the team's consecutive game dates (any game
 * type, so a playoff game counts as the previous game). The first game in the
 * window has no previous game: 3+.
 */
export function restBuckets(dates: string[]): RestBucket[] {
    const order = dates.map((d, i) => [d, i] as const).sort((a, b) => a[0].localeCompare(b[0]));
    const out = new Array<RestBucket>(dates.length).fill(3);
    for (let k = 1; k < order.length; k++) out[order[k][1]] = restBucket(daysOff(order[k - 1][0], order[k][0]));
    return out;
}

/**
 * Tonight's bucket. The pipeline's schedule-based rest_days (days off) wins:
 * the gamestats rows can lag a night behind the schedule. Otherwise the
 * team's last game in the rows before tonight; none at all = 3+.
 */
export function tonightRest(games: Pick<MatchupGame, 'row'>[], date: string, scheduleRestDays?: number | null, excludeId?: string): RestBucket {
    if (scheduleRestDays != null && Number.isFinite(scheduleRestDays)) return restBucket(scheduleRestDays);
    let last: string | null = null;
    for (const g of games) {
        if (g.row.id === excludeId || g.row.date >= date) continue;
        if (!last || g.row.date > last) last = g.row.date;
    }
    return last ? restBucket(daysOff(last, date)) : 3;
}

// ── goalie names ─────────────────────────────────────────────────────────────

/**
 * Match key for goalie names across feeds: "Dostál" / "Lukas Dostal" /
 * "L. Dostal" / "Dostal, Lukas" / "Lukas Dostal (Confirmed)" all become
 * "dostal|l". Surname + first initial, diacritics folded, suffixes dropped.
 */
export function goalieMatchKey(name: string | null | undefined): string {
    if (!name) return '';
    let s = name
        .replace(/\s*\(.*?\)\s*/g, ' ')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
    if (s.includes(',')) {
        const [last, first] = s.split(',', 2).map(x => x.trim());
        s = `${first} ${last}`;
    }
    const parts = s
        .replace(/\./g, ' ')
        .split(/\s+/)
        .filter(p => p && !/^(jr|sr|ii|iii|iv)$/.test(p));
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    return `${parts[parts.length - 1].replace(/[^a-z]/g, '')}|${parts[0].charAt(0)}`;
}

// ── payloads ─────────────────────────────────────────────────────────────────

/** Regular season + playoff rows of one team over the window (static route). */
export interface TeamGamesPayload {
    tri: string;
    /** Season ids in the window, oldest first. */
    seasons: string[];
    games: PackedGames;
    /** Aligned with games.rows: 5v5 xG for / against and 5v5 TOI in seconds. */
    xgf5: number[];
    xga5: number[];
    toi5: number[];
    rest: RestBucket[];
}

export interface MatchupGame {
    row: GameRow;
    xgf5: number;
    xga5: number;
    toi5: number;
    rest: RestBucket;
}

export function unpackTeamGames(p: TeamGamesPayload): MatchupGame[] {
    return unpackGames(p.games).map((row, i) => ({
        row,
        xgf5: p.xgf5[i] ?? 0,
        xga5: p.xga5[i] ?? 0,
        toi5: p.toi5[i] ?? 0,
        rest: (p.rest[i] ?? 3) as RestBucket,
    }));
}

// ── filters ──────────────────────────────────────────────────────────────────

export type LocationKey = 'all' | 'home' | 'road';
export type RestKey = 'all' | RestBucket;
export type LastKey = 'all' | 5 | 10;

export interface SideFilter {
    location: LocationKey;
    rest: RestKey;
    /** Projected starter's name; null = any starter. */
    starter: string | null;
    /** Most recent N games after location and rest (and before starter); omitted = whole window. */
    last?: LastKey;
}

export const NO_FILTER: SideFilter = { location: 'all', rest: 'all', starter: null, last: 'all' };

/**
 * Regular-season games matching the filter (tonight's own game excluded). Order: location and
 * rest first, then the team's most recent N of those, then the starter filter. The league
 * reference has no starter analog, so "last N" has to be settled before it for a team's window
 * to be the same one the reference ranks.
 */
export function filterGames(games: MatchupGame[], f: SideFilter, excludeId?: string): MatchupGame[] {
    const key = f.starter ? goalieMatchKey(f.starter) : '';
    let picked = games.filter(
        g =>
            g.row.type === 2 &&
            g.row.id !== excludeId &&
            (f.location === 'all' || g.row.home === (f.location === 'home')) &&
            (f.rest === 'all' || g.rest === f.rest),
    );
    if (f.last && f.last !== 'all') picked = [...picked].sort((a, b) => a.row.date.localeCompare(b.row.date)).slice(-f.last);
    return key ? picked.filter(g => goalieMatchKey(g.row.starter) === key) : picked;
}

// ── stats ────────────────────────────────────────────────────────────────────

export type TeamStatKey = 'xgf_pct' | 'xgf60' | 'xga60' | 'cf_pct' | 'gf_gp' | 'ga_gp' | 'pp_pct' | 'pk_pct' | 'sv_pct' | 'sh_pct';
export type StatKey = TeamStatKey | 'lineup';

export interface StatDef {
    key: StatKey;
    label: string;
    /** Spoken name for the text equivalent. */
    name: string;
    /** Strength tag: rows with "5v5" are grouped under the chart's 5v5 heading. */
    sub?: string;
    higherBetter: boolean;
    fmt: (v: number) => string;
}

const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);
const sv = (v: number) => (v / 100).toFixed(3).replace(/^0/, '');
const signed1 = (v: number) => (v > 0 ? `+${v.toFixed(1)}` : v < 0 ? `−${Math.abs(v).toFixed(1)}` : v.toFixed(1));

export const STATS: StatDef[] = [
    { key: 'xgf_pct', label: 'xGF%', name: '5v5 expected goals share', sub: '5v5', higherBetter: true, fmt: f1 },
    { key: 'xgf60', label: 'xGF/60', name: '5v5 expected goals for per 60', sub: '5v5', higherBetter: true, fmt: f2 },
    { key: 'xga60', label: 'xGA/60', name: '5v5 expected goals against per 60', sub: '5v5', higherBetter: false, fmt: f2 },
    { key: 'cf_pct', label: 'CF%', name: '5v5 shot attempt share', sub: '5v5', higherBetter: true, fmt: f1 },
    { key: 'gf_gp', label: 'GF/GP', name: 'Goals for per game', higherBetter: true, fmt: f2 },
    { key: 'ga_gp', label: 'GA/GP', name: 'Goals against per game', higherBetter: false, fmt: f2 },
    { key: 'pp_pct', label: 'PP%', name: 'Power play', higherBetter: true, fmt: f1 },
    { key: 'pk_pct', label: 'PK%', name: 'Penalty kill', higherBetter: true, fmt: f1 },
    { key: 'sv_pct', label: 'SV%', name: 'Team save percentage', higherBetter: true, fmt: sv },
    { key: 'sh_pct', label: 'SH%', name: 'Shooting percentage', higherBetter: true, fmt: f1 },
    { key: 'lineup', label: 'LINEUP', name: 'Projected lineup rating', higherBetter: true, fmt: signed1 },
];

export const TEAM_STAT_KEYS = STATS.filter(s => s.key !== 'lineup').map(s => s.key as TeamStatKey);
export const STAT_BY_KEY = new Map(STATS.map(s => [s.key, s]));

export type SideValues = Record<TeamStatKey, number | null>;

/**
 * One team's values over a set of games. Everything but the 5v5 xG rates
 * comes from calculateTeamStats (the /teams table's formulas): GF/GA per
 * game (standings convention), PP%, PK%, team SV% (empty-net goals out),
 * SH%, and CF% from 5v5 attempts.
 */
export function sideValues(tri: string, games: MatchupGame[]): SideValues {
    const out = Object.fromEntries(TEAM_STAT_KEYS.map(k => [k, null])) as SideValues;
    if (games.length === 0) return out;
    const s = calculateTeamStats(tri, games.map(g => g.row));
    let xf = 0, xa = 0, toi = 0;
    for (const g of games) {
        xf += g.xgf5;
        xa += g.xga5;
        toi += g.toi5;
    }
    out.xgf_pct = xf + xa > 0 ? (xf / (xf + xa)) * 100 : null;
    // 5v5 TOI is in every gamestats row (no zeros in 25-26), so per 60 is safe.
    out.xgf60 = toi > 0 ? (xf / toi) * 3600 : null;
    out.xga60 = toi > 0 ? (xa / toi) * 3600 : null;
    const cf = s.cf_per_game, ca = s.ca_per_game;
    out.cf_pct = cf + ca > 0 ? (cf / (cf + ca)) * 100 : null;
    out.gf_gp = s.gf_per_game;
    out.ga_gp = s.ga_per_game;
    out.pp_pct = s.pp_opps > 0 ? s.pp_pct : null;
    out.pk_pct = s.pk_opps > 0 ? s.pk_pct : null;
    out.sv_pct = s.sa_per_game > 0 ? s.sv_pct : null;
    out.sh_pct = s.sf_per_game > 0 ? s.sh_pct : null;
    return out;
}

// ── league reference ─────────────────────────────────────────────────────────

/** A team needs this many games in a slice to enter the league reference. */
export const REF_MIN_GP = 3;

export const refKey = (location: LocationKey, rest: RestKey, last: LastKey = 'all') => (last === 'all' ? `${location}|${rest}` : `${location}|${rest}|L${last}`);

export interface LeagueReference {
    seasons: string[];
    /** refKey → stat → every qualifying team's value, ascending. */
    ref: Record<string, Partial<Record<TeamStatKey, number[]>>>;
}

const LOCS: LocationKey[] = ['all', 'home', 'road'];
const RESTS: RestKey[] = ['all', 0, 1, 2, 3];
const LASTS: LastKey[] = ['all', 5, 10];

/** Per-team values for every location × rest slice (server side, at build). */
export function buildReference(byTeam: Map<string, MatchupGame[]>): LeagueReference['ref'] {
    const ref: LeagueReference['ref'] = {};
    for (const location of LOCS) {
        for (const rest of RESTS) {
            for (const last of LASTS) {
                const slice: Partial<Record<TeamStatKey, number[]>> = {};
                for (const [tri, games] of byTeam) {
                    const sel = filterGames(games, { location, rest, starter: null, last });
                    if (sel.length < REF_MIN_GP) continue;
                    const v = sideValues(tri, sel);
                    for (const k of TEAM_STAT_KEYS) {
                        const x = v[k];
                        if (x != null && Number.isFinite(x)) (slice[k] ??= []).push(Math.round(x * 1000) / 1000);
                    }
                }
                for (const k of TEAM_STAT_KEYS) slice[k]?.sort((a, b) => a - b);
                ref[refKey(location, rest, last)] = slice;
            }
        }
    }
    return ref;
}

/**
 * Percentile as "better than X% of the reference", 0-100, mid-rank for ties:
 * (worse + ½·equal) / n. Lower-is-better stats are flipped, so a higher
 * percentile is always better.
 */
export function percentile(v: number | null | undefined, ref: number[] | undefined, higherBetter: boolean): number | null {
    if (v == null || !Number.isFinite(v) || !ref?.length) return null;
    const eps = 1e-6;
    let worse = 0, equal = 0;
    for (const x of ref) {
        if (Math.abs(x - v) <= eps) equal++;
        else if (higherBetter ? x < v : x > v) worse++;
    }
    const n = ref.length;
    return Math.max(0, Math.min(100, ((worse + 0.5 * equal) / n) * 100));
}

/** Percentile from a 1-based rank (1 = best) among `outOf`, same mid-rank rule. */
export function rankPercentile(rank: number | null | undefined, outOf: number): number | null {
    if (rank == null || !(outOf > 0) || rank < 1) return null;
    return Math.max(0, Math.min(100, ((outOf - rank + 0.5) / outOf) * 100));
}

/** Below this many games a side's bar is hatched and it never shows an advantage. */
export const MIN_GP = 10;
/** Percentile gap under which neither side gets the advantage. */
export const TIE_PCT = 5;

export interface SideScore {
    pct: number | null;
    /** Games behind the value; omit for values without a sample (lineup). */
    gp?: number;
    /** Sample needed before the value is trusted; defaults to MIN_GP (a "last N" window is full at N). */
    minGp?: number;
}

export const smallSample = (s: SideScore) => s.gp != null && s.gp < (s.minGp ?? MIN_GP);

/** Which side is better, or null for a near-tie, a missing value or a small-sample winner. */
export function advantage(away: SideScore, home: SideScore): 'away' | 'home' | null {
    if (away.pct == null || home.pct == null) return null;
    const d = away.pct - home.pct;
    if (Math.abs(d) < TIE_PCT) return null;
    const side = d > 0 ? 'away' : 'home';
    return smallSample(side === 'away' ? away : home) ? null : side;
}

/** "68th" */
export function ordinal(n: number): string {
    const r = Math.round(n);
    const t = r % 100;
    const s = t >= 11 && t <= 13 ? 'th' : r % 10 === 1 ? 'st' : r % 10 === 2 ? 'nd' : r % 10 === 3 ? 'rd' : 'th';
    return `${r}${s}`;
}
