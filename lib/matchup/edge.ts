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

/** Published forecast (model blended with the de-vigged market) win % pair. */
export function forecastPair(p: Prediction): ProbPair | null {
    return hasPrediction(p) ? displayPair(p.away.winPct, p.home.winPct) : null;
}

/**
 * @deprecated Name kept for callers that want the headline number: this is the
 * blended forecast, not the pure model. Use forecastPair / modelOnlyPair.
 */
export const modelPair = forecastPair;

/** The pure game model's win % pair, before the market blend. */
export function modelOnlyPair(p: Prediction): ProbPair | null {
    if (!hasPrediction(p)) return null;
    if (p.away.modelWinPct == null && p.home.modelWinPct == null) return null;
    return displayPair(p.away.modelWinPct, p.home.modelWinPct);
}

/** Weight on the model in the published blend (0.2 = 20% model, 80% market), or null. */
export function modelWeight(p: Prediction): number | null {
    const w = p.blendWeight;
    return w != null && w > 0 && w <= 1 ? w : null;
}

/** One-sentence blend disclosure for the forecast tip. */
export function blendNote(p: Prediction): string | null {
    const w = modelWeight(p);
    if (w == null) return null;
    if (w >= 0.999) return 'This forecast is the model alone (no market blend).';
    const mw = Math.round(w * 100);
    return `Our forecast is the model blended with the de-vigged market: model ${mw}%, market ${100 - mw}%${onPriors(p) ? ' while the season is young' : ''} (blend weight ${w.toFixed(2)}).`;
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
    /** True when the pipeline's proven-edge gate is open (the bet is logged in the public ledger). */
    official: boolean;
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
        official: true,
    };
}

/** The betting rule's EV floor (pipeline/market.py MIN_EV). */
export const REC_MIN_EV = 0.03;
/** Smallest stake worth recommending. */
export const REC_MIN_UNITS = 0.5;

/**
 * Quarter-Kelly stake in units (1u = 1% of bankroll, capped at 5u, rounded
 * to 0.1), mirroring pipeline/market.py kelly_units.
 */
export function kellyUnits(prob: number, american: number): number {
    if (!Number.isFinite(american) || american === 0 || !(prob > 0 && prob < 1)) return 0;
    const b = american > 0 ? american / 100 : 100 / Math.abs(american);
    const f = (b * prob - (1 - prob)) / b;
    if (f <= 0) return 0;
    return Math.round(Math.min(5, 100 * 0.25 * f) * 10) / 10;
}

/**
 * The bet to show: the gated edge when the pipeline's gate is open; otherwise
 * an unofficial one, only when the better side clears the betting rule's EV
 * floor (3%) and its quarter-Kelly stake is at least REC_MIN_UNITS.
 */
export function recommendedBet(p: Prediction): Edge | null {
    const gated = gatedEdge(p);
    if (gated) return gated;
    if (!hasPrediction(p) || !hasMarket(p)) return null;
    const a = p.away.ev;
    const h = p.home.ev;
    if (a == null && h == null) return null;
    const side: Side = (h ?? -Infinity) >= (a ?? -Infinity) ? 'home' : 'away';
    const ev = p[side].ev as number;
    if (ev < REC_MIN_EV) return null;
    const units = kellyUnits((p[side].winPct as number) / 100, p[side].marketOdds as number);
    if (units < REC_MIN_UNITS) return null;
    return { side, tri: p[side].team.triCode, evPct: Math.round(ev * 1000) / 10, units, official: false };
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

/** Points between the raw model and the de-vigged market before the card flags a lean. */
export const LEAN_MIN_PTS = 8;

export interface Lean {
    side: Side;
    tri: string;
    /** The raw model's win % for that side (rounded). */
    pct: number;
    /** Model minus market for that side, in points. */
    gap: number;
}

/**
 * The model lean ("◆ 61 NYI"): the raw model (before the market blend)
 * disagrees with the de-vigged market by LEAN_MIN_PTS or more. Names the
 * side the model rates higher than the market does.
 */
export function modelLean(p: Prediction, minPts = LEAN_MIN_PTS): Lean | null {
    if (!hasPrediction(p) || !hasMarket(p)) return null;
    const m = p.away.modelWinPct;
    const k = p.away.marketWinPct;
    if (m == null || k == null) return null;
    const gap = m - k;
    if (Math.abs(gap) < minPts) return null;
    const side: Side = gap > 0 ? 'away' : 'home';
    return { side, tri: p[side].team.triCode, pct: Math.round(side === 'away' ? m : 100 - m), gap: Math.round(Math.abs(gap) * 10) / 10 };
}
