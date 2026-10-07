import { dateOfDay, dayNumber } from '@/lib/schedule/time';
import type { SchedGame, Tag, TeamSchedule } from '@/lib/schedule/metrics';

/** What the strip, map and calendar focus on together. */
export type Focus = { kind: 'season' } | { kind: 'month'; key: string } | { kind: 'trip'; id: number } | { kind: 'range'; first: number; last: number };

/** A lens lights the games that share one situation. */
export type Lens = 'b2b' | 'dense' | 'rest' | 'clock' | 'special' | null;

export const monthKey = (date: string) => date.slice(0, 7);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const monthShort = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1];
export const monthLong = (key: string) => MONTHS_LONG[Number(key.slice(5, 7)) - 1];

/** "Thu Oct 8". */
export function dayLabel(date: string): string {
    const d = new Date(`${date}T12:00:00Z`);
    return `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()].charAt(0)}${MONTHS[d.getUTCMonth()].slice(1).toLowerCase()} ${d.getUTCDate()}`;
}

/** "Oct 8". */
export function shortDate(date: string): string {
    const d = new Date(`${date}T12:00:00Z`);
    return `${MONTHS[d.getUTCMonth()].charAt(0)}${MONTHS[d.getUTCMonth()].slice(1).toLowerCase()} ${d.getUTCDate()}`;
}

/** "Oct 8 – 17" or "Oct 28 – Nov 4". */
export function dateRange(a: string, b: string): string {
    if (a === b) return shortDate(a);
    const sameMonth = a.slice(0, 7) === b.slice(0, 7);
    return `${shortDate(a)} – ${sameMonth ? Number(b.slice(8, 10)) : shortDate(b)}`;
}

export const dayRange = (a: number, b: number) => dateRange(dateOfDay(a), dateOfDay(b));

export const miles = (n: number) => `${Math.round(n).toLocaleString('en-US')} mi`;

export function months(games: SchedGame[]): string[] {
    return [...new Set(games.map(g => monthKey(g.date)))];
}

export function inFocus(g: SchedGame, focus: Focus): boolean {
    switch (focus.kind) {
        case 'season':
            return true;
        case 'month':
            return monthKey(g.date) === focus.key;
        case 'trip':
            return g.trip === focus.id;
        case 'range':
            return g.n - 1 >= focus.first && g.n - 1 <= focus.last;
    }
}

/**
 * Days without a game in the focus: a month counts its calendar days inside
 * the season (first to last game), a trip or stretch the days from its first
 * game to its last; minus the game days.
 */
export function daysOff(all: SchedGame[], focus: Focus): number | null {
    const gs = all.filter(g => inFocus(g, focus));
    if (!gs.length || !all.length) return null;
    const day = (d: string) => Date.parse(`${d}T12:00:00Z`) / 86_400_000;
    let from = day(gs[0].date);
    let to = day(gs[gs.length - 1].date);
    if (focus.kind === 'month' || focus.kind === 'season') {
        const y = Number((focus.kind === 'month' ? focus.key : gs[0].date).slice(0, 4));
        const m = Number((focus.kind === 'month' ? focus.key : gs[0].date).slice(5, 7));
        from = focus.kind === 'month' ? Math.max(day(all[0].date), Date.UTC(y, m - 1, 1, 12) / 86_400_000) : day(all[0].date);
        to = focus.kind === 'month' ? Math.min(day(all[all.length - 1].date), Date.UTC(y, m, 0, 12) / 86_400_000) : day(all[all.length - 1].date);
    }
    const gameDays = new Set(gs.map(g => g.date)).size;
    return Math.max(0, Math.round(to - from) + 1 - gameDays);
}

const DENSE: Tag[] = ['3IN4', '4IN6', '5IN8'];
export function inLens(g: SchedGame, lens: Lens): boolean {
    switch (lens) {
        case null:
            return true;
        case 'b2b':
            return g.b2b || g.dense.includes('b2b');
        case 'dense':
            return g.tags.some(t => DENSE.includes(t));
        case 'rest':
            return g.tags.includes('REST+') || g.tags.includes('REST-');
        case 'clock':
            return g.tags.includes('DAY') || g.tags.includes('LATE') || g.tags.includes('EARLY');
        case 'special':
            return !!g.event;
    }
}

/** Display names for tags (1-2 words). */
export function tagLabel(t: Tag, g: SchedGame): string {
    switch (t) {
        case '3IN4':
            return '3-in-4';
        case '4IN6':
            return '4-in-6';
        case '5IN8':
            return '5-in-8';
        case 'REST+':
            return 'Rest edge';
        case 'REST-':
            return 'Rest deficit';
        case 'DAY':
            return 'Day game';
        case 'LATE':
            return 'Late body';
        case 'EARLY':
            return 'Early body';
        case 'TZ':
            return `TZ ${g.tzShift > 0 ? '+' : '−'}${Math.abs(g.tzShift)}`;
        case 'OUTDOOR':
        case 'GLOBAL':
        case 'NEUTRAL':
            return g.event?.name ?? t;
        default:
            return t;
    }
}

/** The game that the focus is "about" when nothing is picked: next upcoming in focus, else the first. */
export function defaultGame(s: TeamSchedule, focus: Focus): SchedGame | null {
    const list = s.games.filter(g => inFocus(g, focus));
    return list.find(g => g.state !== 'final') ?? null;
}

export interface FocusTotals {
    gp: number;
    home: number;
    w: number;
    l: number;
    otl: number;
    played: number;
    mi: number;
    b2b: number;
}

export function focusTotals(s: TeamSchedule, focus: Focus): FocusTotals {
    const gs = s.games.filter(g => inFocus(g, focus));
    const ids = new Set(gs.map(g => g.n - 1));
    let mi = 0;
    for (const l of s.legs) {
        if (focus.kind === 'season') mi += l.mi;
        else if (focus.kind === 'trip') mi += l.trip === focus.id ? l.mi : 0;
        else if (l.toGame != null ? ids.has(l.toGame) : l.fromGame != null && ids.has(l.fromGame)) mi += l.mi;
    }
    return {
        gp: gs.length,
        home: gs.filter(g => !g.onRoad).length,
        w: gs.filter(g => g.result?.code === 'W').length,
        l: gs.filter(g => g.result?.code === 'L').length,
        otl: gs.filter(g => g.result?.code === 'OTL').length,
        played: gs.filter(g => g.result).length,
        mi,
        b2b: gs.filter(g => g.b2b).length,
    };
}

export const dayOf = (g: SchedGame) => dayNumber(g.date);

/** Prefers-reduced-motion, read once per call. */
export function reducedMotion(): boolean {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}
