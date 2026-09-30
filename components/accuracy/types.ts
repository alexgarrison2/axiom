/** One graded pregame prediction, compacted for the browser. */
export interface GradedGame {
    id: number;
    /** Local game date, YYYY-MM-DD. */
    date: string;
    /** "2025-26" */
    season: string;
    type: '02' | '03';
    home: string;
    away: string;
    homeScore: number;
    awayScore: number;
    decision: 'REG' | 'OT' | 'SO';
    /** Published model home-win probability, 0–100. */
    homeProb: number;
    /** De-vigged market home-win probability at the snapshot, 0–100. */
    marketProb: number | null;
    homeXg: number | null;
    awayXg: number | null;
    brier: number;
    logLoss: number;
    /** Back-filled after the fact (not what users saw). */
    retro: boolean;
    /** When the frozen pregame snapshot was taken (UTC ISO). */
    snapshotUtc: string | null;
    /** Published by the pre-overhaul site model (no modelVersion recorded). */
    legacy?: boolean;
    /** Market price was a −110/−110 placeholder, not a real line; excluded from market comparisons. */
    placeholderOdds?: boolean;
}

/** A final game that was deliberately left out of grading. */
export interface ExcludedGame {
    id: number;
    date: string;
    home: string;
    away: string;
    reason: string;
    /** NHL game type ("02" regular, "03" playoffs). */
    type?: string;
}

/** Record computed straight from the graded list (never stale). */
export interface SeasonTally {
    n: number;
    correct: number;
    brier: number | null;
    logLoss: number | null;
    /** Games with a real (non-placeholder) market price. */
    marketN: number;
    marketLogLoss: number | null;
    modelLogLossSame: number | null;
    legacyN: number;
    placeholderN: number;
    excluded: ExcludedGame[];
}

/** Final score for a ledger bet that the ledger file still lists as pending. */
export interface BetFinal {
    homeScore: number;
    awayScore: number;
    decision: string;
}

export function pickOf(g: GradedGame): string {
    return g.homeProb >= 50 ? g.home : g.away;
}

export function winnerOf(g: GradedGame): string {
    return g.homeScore > g.awayScore ? g.home : g.away;
}

export function isCorrect(g: GradedGame): boolean {
    return pickOf(g) === winnerOf(g);
}

/** Probability (0–100) the model gave its pick. */
export function pickProb(g: GradedGame): number {
    return g.homeProb >= 50 ? g.homeProb : 100 - g.homeProb;
}

export interface LedgerBet {
    gameId: number;
    season: string;
    type: string;
    date: string;
    team: string;
    opponent: string;
    side: 'home' | 'away';
    stake: number;
    price: number;
    evAtBet: number | null;
    evBucket: string;
    stakeBucket: string;
    modelProb: number | null;
    result: 'win' | 'loss' | 'push' | 'pending' | string;
    profit: number;
    final: string | null;
    decision: string | null;
    clv: number | null;
    /** Suggested by the previous site model (no model version recorded). */
    legacy?: boolean;
}

export interface LedgerBucket {
    bucket: string;
    n: number;
    record: string;
    unitsStaked: number | null;
    unitsProfit: number;
    roi: number | null;
}

export interface LedgerSummary {
    nBets: number;
    nGraded: number;
    nPending: number;
    record: string;
    unitsStaked: number;
    unitsProfit: number;
    roi: number | null;
    roiCi: [number, number] | null;
    clvMean: number | null;
    clvN: number;
    byEv: LedgerBucket[];
    byStake: LedgerBucket[];
}

export interface LedgerData {
    unit: string | null;
    disclaimer: string | null;
    clvNote: string | null;
    source: string | null;
    gate: { open: boolean; reasons: string[] } | null;
    /** season label → summary */
    seasons: Record<string, LedgerSummary>;
    generatedAt: string | null;
}
