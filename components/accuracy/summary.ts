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
