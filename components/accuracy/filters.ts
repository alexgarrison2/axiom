import { divisionOf } from '@/lib/pony/teams';
import { isNoLean, pickOf, type GradedGame } from './types';

/*
 * The pick list's game filters beyond the date window and result: who
 * (a team, a division, or games inside one division), the weekday, and three
 * situations (venue, the market's favourite or underdog, back-to-back). A
 * situation is about the chosen team when one team is chosen, else about the
 * model's pick; a coin flip has no pick, so a pick situation leaves it out.
 */

export interface PickFilter {
    /** 'all', a tricode, 'div:<Division>' (either side in it) or 'div:same' (both sides in one division). */
    who: string;
    /** 0 = Sunday … 6 = Saturday (the local game date); null = any day. */
    day: number | null;
    venue: 'home' | 'road' | null;
    /** The market's favourite or underdog (de-vigged price above or below 50%; needs a real price). */
    role: 'fav' | 'dog' | null;
    /** Played the day before. */
    b2b: boolean;
}

export const NO_FILTER: PickFilter = { who: 'all', day: null, venue: null, role: null, b2b: false };

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const TRI = /^[A-Z]{3}$/;

export const isFiltered = (f: PickFilter) => f.who !== 'all' || f.day != null || f.venue != null || f.role != null || f.b2b;

/** True when the situations describe one chosen team rather than the model's pick. */
export const teamSubject = (f: PickFilter) => TRI.test(f.who);

export const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

const dayBefore = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** "TEAM|date" for every game a team played, from the loaded rows (all graded games, back-filled included). */
export function playedIndex(games: GradedGame[]): Set<string> {
    const out = new Set<string>();
    for (const g of games) {
        out.add(`${g.home}|${g.date}`);
        out.add(`${g.away}|${g.date}`);
    }
    return out;
}

/** Does the game pass the filter? `played` is playedIndex over the loaded season(s), for back-to-backs. */
export function matches(g: GradedGame, f: PickFilter, played: Set<string>): boolean {
    if (f.who !== 'all') {
        if (TRI.test(f.who)) {
            if (g.home !== f.who && g.away !== f.who) return false;
        } else if (f.who === 'div:same') {
            const d = divisionOf(g.home);
            if (!d || d !== divisionOf(g.away)) return false;
        } else {
            const d = f.who.slice(4);
            if (divisionOf(g.home) !== d && divisionOf(g.away) !== d) return false;
        }
    }
    if (f.day != null && weekday(g.date) !== f.day) return false;
    if (f.venue == null && f.role == null && !f.b2b) return true;

    const team = teamSubject(f);
    if (!team && isNoLean(g)) return false;
    const side = team ? f.who : pickOf(g);
    const home = side === g.home;
    if (f.venue && (f.venue === 'home') !== home) return false;
    if (f.role) {
        if (g.marketProb == null || g.placeholderOdds) return false;
        const p = home ? g.marketProb : 100 - g.marketProb;
        if (f.role === 'fav' ? !(p > 50) : !(p < 50)) return false;
    }
    if (f.b2b && !played.has(`${side}|${dayBefore(g.date)}`)) return false;
    return true;
}
