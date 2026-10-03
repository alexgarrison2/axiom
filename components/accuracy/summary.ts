import { isCorrect, isNoLean, pickProb, type GradedGame } from './types';

/** KPIs for a filtered span of graded games. */
export interface SpanSummary {
    /** Every graded game in the span (Brier and log loss use all of them). */
    n: number;
    /** Games with a lean (the pick record's games). */
    picks: number;
    hits: number;
    /** hits / picks, 0-1. */
    accuracy: number | null;
    /** Mean probability (0-100) the model gave its pick, over games with a lean. */
    avgConfidence: number | null;
    brier: number | null;
    logLoss: number | null;
    /** Games with a real market price, and the model vs market log loss on exactly those. */
    marketN: number;
    modelLogLossSame: number | null;
    marketLogLoss: number | null;
    /** Games with xG on both sides, and the mean absolute error of projected total goals. */
    scoreN: number;
    totalGoalsMae: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Log loss of a home-win probability (0-100) against the result. */
function llOf(homeProb: number, homeWon: boolean): number {
    const p = Math.min(Math.max(homeProb / 100, 1e-6), 1 - 1e-6);
    return -Math.log(homeWon ? p : 1 - p);
}

export function summarize(games: GradedGame[]): SpanSummary {
    const lean = games.filter(g => !isNoLean(g));
    const hits = lean.filter(isCorrect).length;
    const priced = games.filter(g => g.marketProb != null && !g.placeholderOdds);
    const scored = games.filter(g => g.homeXg != null && g.awayXg != null);
    const finite = (x: number) => Number.isFinite(x);
    return {
        n: games.length,
        picks: lean.length,
        hits,
        accuracy: lean.length ? hits / lean.length : null,
        avgConfidence: mean(lean.map(pickProb)),
        brier: mean(games.map(g => g.brier).filter(finite)),
        logLoss: mean(games.map(g => g.logLoss).filter(finite)),
        marketN: priced.length,
        modelLogLossSame: mean(priced.map(g => llOf(g.homeProb, g.homeScore > g.awayScore))),
        marketLogLoss: mean(priced.map(g => llOf(g.marketProb as number, g.homeScore > g.awayScore))),
        scoreN: scored.length,
        totalGoalsMae: mean(scored.map(g => Math.abs((g.homeXg as number) + (g.awayXg as number) - (g.homeScore + g.awayScore)))),
    };
}

/** One day of the pick list: the picks listed under it and the summary of every filtered game that day. */
export interface DayGroup {
    /** YYYY-MM-DD */
    date: string;
    /** Games with a lean (the rows listed under the day), in input order. */
    picks: GradedGame[];
    /** Summary over the day's filtered games (a no-lean game counts toward log loss, not the record). */
    summary: SpanSummary;
}

/**
 * Groups already-filtered graded games by date, newest day first. A day with
 * no pick (only coin flips) is dropped: it has no rows to show.
 */
export function groupByDay(games: GradedGame[]): DayGroup[] {
    const byDate = new Map<string, GradedGame[]>();
    for (const g of games) {
        const list = byDate.get(g.date);
        if (list) list.push(g);
        else byDate.set(g.date, [g]);
    }
    const out: DayGroup[] = [];
    for (const [date, list] of byDate) {
        const picks = list.filter(g => !isNoLean(g));
        if (picks.length) out.push({ date, picks, summary: summarize(list) });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Model minus market log loss on the span's priced games (negative: the model did better), or null with no price. */
export function vsMarket(s: SpanSummary): number | null {
    return s.marketN > 0 && s.modelLogLossSame != null && s.marketLogLoss != null ? s.modelLogLossSame - s.marketLogLoss : null;
}

/** Days with a pick, and picks on the newest of them: sizes the day list's loading placeholder. */
export interface DayShape {
    days: number;
    lastDay: number;
}

export function dayShape(games: GradedGame[]): DayShape {
    const days = groupByDay(games);
    return { days: days.length, lastDay: days[0]?.picks.length ?? 0 };
}
