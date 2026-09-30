import type { ReportBlock } from './report';

/** Below this many graded games a better/worse call is noise: no verdict, delta, colour or "best" marker. */
export const SIGNAL_N = 100;
/** Below this many games a confidence interval is too wide to be worth printing. */
export const CI_MIN_N = 10;

export type VerdictWord = 'BETTER' | 'WORSE' | 'SAME';

export interface Verdict {
    /** The sample is too small to call. */
    tooEarly: boolean;
    vsMarket: { word: VerdictWord; model: number; other: number; n: number } | null;
    vsHome: { word: VerdictWord; model: number; other: number; n: number } | null;
}

/** Lower log loss is better; equal to 4 decimals is SAME. */
export function compareLogLoss(model: number, other: number): VerdictWord {
    const d = Math.round(model * 1e4) - Math.round(other * 1e4);
    return d === 0 ? 'SAME' : d < 0 ? 'BETTER' : 'WORSE';
}

/** Terse season verdict from log loss: model vs the de-vigged market (same games) and vs the home-rate constant. */
export function blockVerdict(b: ReportBlock | null | undefined): Verdict {
    if (!b || b.n < SIGNAL_N) return { tooEarly: true, vsMarket: null, vsHome: null };
    const m = b.market;
    const modelMkt = m.modelLogLossSame ?? (m.n === b.n ? b.logLoss : null);
    const vsMarket =
        m.n >= SIGNAL_N && modelMkt != null && m.logLoss != null ? { word: compareLogLoss(modelMkt, m.logLoss), model: modelMkt, other: m.logLoss, n: m.n } : null;
    const vsHome =
        b.logLoss != null && b.homeRate.logLoss != null
            ? { word: compareLogLoss(b.logLoss, b.homeRate.logLoss), model: b.logLoss, other: b.homeRate.logLoss, n: b.n }
            : null;
    return { tooEarly: !vsMarket && !vsHome, vsMarket, vsHome };
}

/**
 * Who made the picks in a block: "Pony xG" (current model), "Prev. model"
 * (all picks from the previous site model) or null when both contributed
 * (the table then splits the rows by model).
 */
export function modelLabelOf(b: ReportBlock, fallback: string): string | null {
    if (b.n > 0 && b.nLegacy >= b.n) return 'Prev. model';
    if (b.byModel) {
        if (b.byModel.legacy.n === 0) return 'Pony xG';
        if (b.byModel.current.n === 0) return 'Prev. model';
        return null;
    }
    return fallback;
}

/**
 * Signed delta text, or "same" when it rounds to zero at the shown precision.
 * `scale` converts the raw value to the displayed unit (100 for pts).
 */
export function deltaText(value: number, digits: number, suffix = '', scale = 1): { text: string; same: boolean } {
    const shown = Number((value * scale).toFixed(digits));
    if (shown === 0) return { text: 'same', same: true };
    const abs = Math.abs(shown).toFixed(digits);
    return { text: `${shown > 0 ? '+' : '−'}${abs}${suffix}`, same: false };
}
