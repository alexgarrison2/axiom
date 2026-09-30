/**
 * Honest edge presentation: model vs de-vigged market, and bets only when
 * the pipeline's gate (market.gate) is open for that game.
 */
import type { Prediction, Side } from '../../types/prediction';

export interface ProbPair {
    away: number;
    home: number;
}

/** Round a probability pair for display so the two sides always sum to 100. */
export function displayPair(away: number | null, home: number | null): ProbPair | null {
    if (away == null && home == null) return null;
    let a = away ?? 100 - (home as number);
    let h = home ?? 100 - a;
    const sum = a + h;
    if (sum > 0 && Math.abs(sum - 100) > 0.05) {
        a = (a / sum) * 100;
        h = (h / sum) * 100;
    }
    const ar = Math.round(a);
    return { away: ar, home: 100 - ar };
}

export function hasPrediction(p: Prediction): boolean {
    return (p.status === 'pregame' || p.status === 'frozen') && p.home.winPct != null && p.away.winPct != null;
}

export function hasMarket(p: Prediction): boolean {
    return p.home.marketOdds != null && p.away.marketOdds != null && p.home.marketWinPct != null && p.away.marketWinPct != null;
}

/** Published (model blended with market) win % pair. */
export function modelPair(p: Prediction): ProbPair | null {
    return hasPrediction(p) ? displayPair(p.away.winPct, p.home.winPct) : null;
}

/** De-vigged market win % pair. */
export function marketPair(p: Prediction): ProbPair | null {
    return hasMarket(p) ? displayPair(p.away.marketWinPct, p.home.marketWinPct) : null;
}

export function favorite(p: Prediction): Side | null {
    if (!hasPrediction(p)) return null;
    return (p.home.winPct as number) >= (p.away.winPct as number) ? 'home' : 'away';
}

export interface Edge {
    side: Side;
    tri: string;
    /** EV in percent (4.1 = +4.1%). */
    evPct: number;
    /** Units, only when the data has them. */
    units: number | null;
}

/**
 * The edge chip: only when the gate is open for this game. Returns null
 * otherwise (EV is never shown as a bet while the gate is closed).
 */
export function gatedEdge(p: Prediction): Edge | null {
    if (!p.evGated || !hasPrediction(p) || !hasMarket(p)) return null;
    const side: Side | null = p.betSide ?? ((p.home.ev ?? -1) >= (p.away.ev ?? -1) ? 'home' : 'away');
    const ev = p[side].ev;
    if (ev == null || ev <= 0) return null;
    return {
        side,
        tri: p[side].team.triCode,
        evPct: Math.round(ev * 1000) / 10,
        units: p.units != null && p.units > 0 && p.betSide === side ? p.units : null,
    };
}

/** True when no game on the slate has an open gate (the "no bets" note). */
export function gateClosedSiteWide(preds: Prediction[]): boolean {
    const priced = preds.filter(p => hasPrediction(p));
    return priced.length > 0 && priced.every(p => !p.evGated);
}

/** The first gate reason on the slate, for the note's tooltip. */
export function slateGateReason(preds: Prediction[]): string | null {
    return preds.find(p => p.gateReason)?.gateReason ?? null;
}

/** Early season: the model still leans on preseason priors. */
export function onPriors(p: Prediction): boolean {
    return p.preseasonPrior || p.home.gp < 10 || p.away.gp < 10;
}

/** Pick-form summary: record and %, with the % gated at 3 picks. */
export function pickForm(entries: boolean[]): { w: number; l: number; pct: number | null } {
    const w = entries.filter(Boolean).length;
    const l = entries.length - w;
    return { w, l, pct: entries.length >= 3 ? Math.round((w / entries.length) * 100) : null };
}
