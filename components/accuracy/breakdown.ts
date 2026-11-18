import { CONFERENCE, DIVISIONS, divisionOf } from '@/lib/pony/teams';
import { DAYS, dayBefore, weekday } from './filters';
import { summarize, vsMarket, type SpanSummary } from './summary';
import { isNoLean, pickOf, pickProb, type GradedGame } from './types';

/*
 * The breakdown table under the pick list: the same filtered games, regrouped.
 * Team, goalie and division rows hold every game that side played in (a game
 * counts once for each club), so those rows overlap. Home/road, fav/dog,
 * confidence and rest describe the model's pick, so a coin flip is in none of them.
 */

export type BreakdownView = 'team' | 'weekday' | 'venue' | 'division' | 'goalie' | 'role' | 'confidence' | 'rest' | 'month' | 'decision' | 'matchup';

export const BREAKDOWN_VIEWS: { value: BreakdownView; label: string }[] = [
    { value: 'team', label: 'Team' },
    { value: 'weekday', label: 'Weekday' },
    { value: 'venue', label: 'Home/Road' },
    { value: 'division', label: 'Division' },
    { value: 'goalie', label: 'Goalie' },
    { value: 'role', label: 'Fav/Dog' },
    { value: 'confidence', label: 'Confidence' },
    { value: 'rest', label: 'Rest' },
    { value: 'month', label: 'Month' },
    { value: 'decision', label: 'Finish' },
    { value: 'matchup', label: 'Matchup' },
];

export interface BreakdownRow {
    key: string;
    label: string;
    /** Tricode, when the row is a club. */
    tri?: string;
    summary: SpanSummary;
    /** Goalie view: the club's starters, most starts first. */
    children?: BreakdownRow[];
}

interface Spec {
    /** Groups the game belongs to (none: left out of this view). */
    keys: (g: GradedGame, played: Set<string>) => string[];
    /** Fixed row order, or how to order the keys found. */
    order: readonly string[] | 'asc' | 'desc';
    label: (key: string) => string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pickKey = (f: (g: GradedGame, played: Set<string>) => string | null) => (g: GradedGame, played: Set<string>) => {
    if (isNoLean(g)) return [];
    const k = f(g, played);
    return k == null ? [] : [k];
};
const named = (names: Record<string, string>) => (k: string) => names[k] ?? k;
const teams: Spec = { keys: g => [g.home, g.away], order: 'asc', label: k => k };

const SPECS: Record<BreakdownView, Spec> = {
    team: teams,
    goalie: teams,
    weekday: { keys: g => [String(weekday(g.date))], order: ['1', '2', '3', '4', '5', '6', '0'], label: k => DAYS[Number(k)] },
    venue: {
        keys: pickKey(g => (pickOf(g) === g.home ? 'home' : 'road')),
        order: ['home', 'road'],
        label: named({ home: 'Home pick', road: 'Road pick' }),
    },
    division: {
        keys: g => [...new Set([divisionOf(g.home), divisionOf(g.away)].filter((d): d is string => !!d))],
        order: Object.keys(DIVISIONS),
        label: k => k,
    },
    role: {
        // The market's favourite or underdog: needs a real price off 50.
        keys: pickKey(g => {
            if (g.marketProb == null || g.placeholderOdds) return null;
            const p = pickOf(g) === g.home ? g.marketProb : 100 - g.marketProb;
            return p > 50 ? 'fav' : p < 50 ? 'dog' : null;
        }),
        order: ['fav', 'dog'],
        label: named({ fav: 'Fav pick', dog: 'Dog pick' }),
    },
    confidence: {
        // The report card's tiers.
        keys: pickKey(g => {
            const p = pickProb(g);
            return p < 55 ? '50-55' : p < 60 ? '55-60' : p < 65 ? '60-65' : '65+';
        }),
        order: ['50-55', '55-60', '60-65', '65+'],
        label: k => `${k.replace('-', '–')}%`,
    },
    rest: {
        keys: pickKey((g, played) => {
            const pick = pickOf(g);
            const before = dayBefore(g.date);
            const mine = played.has(`${pick}|${before}`);
            const theirs = played.has(`${pick === g.home ? g.away : g.home}|${before}`);
            return mine ? (theirs ? 'both' : 'pick') : theirs ? 'opp' : 'none';
        }),
        order: ['pick', 'opp', 'both', 'none'],
        label: named({ pick: 'Pick B2B', opp: 'Opp B2B', both: 'Both B2B', none: 'Rested' }),
    },
    month: { keys: g => [g.date.slice(0, 7)], order: 'desc', label: k => `${MONTHS[Number(k.slice(5, 7)) - 1] ?? ''} ${k.slice(0, 4)}`.trim() },
    decision: { keys: g => [g.decision], order: ['REG', 'OT', 'SO'], label: named({ REG: 'Regulation', OT: 'Overtime', SO: 'Shootout' }) },
    matchup: {
        keys: g => {
            const [h, a] = [divisionOf(g.home), divisionOf(g.away)];
            if (!h || !a) return [];
            return [h === a ? 'div' : CONFERENCE[h] === CONFERENCE[a] ? 'conf' : 'inter'];
        },
        order: ['div', 'conf', 'inter'],
        label: named({ div: 'Division', conf: 'Conference', inter: 'Inter-conference' }),
    },
};

function group(games: GradedGame[], keys: (g: GradedGame) => string[]): Map<string, GradedGame[]> {
    const out = new Map<string, GradedGame[]>();
    for (const g of games) {
        for (const k of keys(g)) {
            const list = out.get(k);
            if (list) list.push(g);
            else out.set(k, [g]);
        }
    }
    return out;
}

/** A club's starters over its games, most starts first. */
function goalieRows(tri: string, games: GradedGame[]): BreakdownRow[] {
    const by = group(games, g => {
        const name = g.home === tri ? g.homeGoalie : g.awayGoalie;
        return name ? [name] : [];
    });
    return [...by]
        .map(([name, list]) => ({ key: `${tri}|${name}`, label: name, summary: summarize(list) }))
        .filter(r => r.summary.picks > 0)
        .sort((a, b) => b.summary.picks - a.summary.picks || a.label.localeCompare(b.label));
}

/**
 * Already-filtered graded games regrouped for one view, in the view's own order.
 * A group with no pick (only coin flips) is dropped, as a day is in the pick list.
 * `played` is playedIndex over the loaded season(s), for back-to-backs.
 */
export function breakdown(games: GradedGame[], view: BreakdownView, played: Set<string>): BreakdownRow[] {
    const spec = SPECS[view];
    const by = group(games, g => spec.keys(g, played));
    const keys = typeof spec.order === 'string' ? [...by.keys()].sort() : spec.order.filter(k => by.has(k));
    if (spec.order === 'desc') keys.reverse();
    const club = view === 'team' || view === 'goalie';
    const rows: BreakdownRow[] = [];
    for (const key of keys) {
        const list = by.get(key) as GradedGame[];
        const summary = summarize(list);
        if (!summary.picks) continue;
        rows.push({ key, label: spec.label(key), summary, ...(club ? { tri: key } : {}), ...(view === 'goalie' ? { children: goalieRows(key, list) } : {}) });
    }
    return rows;
}

export type BreakdownSort = 'games' | 'right' | 'goals' | 'market' | 'confidence' | 'units';

const METRIC: Record<BreakdownSort, (s: SpanSummary) => number | null> = {
    games: s => s.picks,
    right: s => s.accuracy,
    goals: s => s.totalGoalsMae,
    market: vsMarket,
    confidence: s => s.avgConfidence,
    units: s => s.units,
};

/** Lower is better for the goals error and the log loss vs the market: a first click sorts those ascending. */
export const firstDirection = (key: BreakdownSort): 'asc' | 'desc' => (key === 'goals' || key === 'market' ? 'asc' : 'desc');

/** Rows (and each row's children) by one column; a row with no value goes last either way, ties keep the view's order. */
export function sortBreakdown(rows: BreakdownRow[], key: BreakdownSort, dir: 'asc' | 'desc'): BreakdownRow[] {
    const metric = METRIC[key];
    const sign = dir === 'asc' ? 1 : -1;
    const sorted = (list: BreakdownRow[]): BreakdownRow[] =>
        list
            .map(r => (r.children ? { ...r, children: sorted(r.children) } : r))
            .sort((a, b) => {
                const [x, y] = [metric(a.summary), metric(b.summary)];
                if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
                return (x - y) * sign;
            });
    return sorted(rows);
}
