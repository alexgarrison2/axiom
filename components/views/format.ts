/**
 * Number formatting shared by the secondary views (standings, accuracy,
 * players, news). Pure functions — safe on the server, the client and in tests.
 */

export const MINUS = '−';

/**
 * A simulation percentage (0–100) for display. Never prints a hard 0% or
 * 100%: a Monte Carlo run of N seasons can't prove certainty, so the tails
 * read "<0.1%" / ">99.9%". Mid-range values are whole numbers; values near
 * the tails keep one decimal so 99.6 doesn't round up to "100%".
 */
export function fmtSimPct(p: number | null | undefined): string {
    if (p == null || !Number.isFinite(p)) return '—';
    if (p < 0.05) return '<0.1%';
    if (p > 99.95) return '>99.9%';
    if (p < 1 || p > 99) return `${p.toFixed(1)}%`;
    return `${Math.round(p)}%`;
}

/** A 0–1 probability as a whole percent ("63%"). */
export function fmtProb(p: number | null | undefined, digits = 0): string {
    if (p == null || !Number.isFinite(p)) return '—';
    return `${(p * 100).toFixed(digits)}%`;
}

/** Signed number with a real minus sign ("+3.2", "−1.1", "±0.0"). */
export function signed(v: number, digits = 1): string {
    const r = Number(v.toFixed(digits));
    if (r === 0) return `±${(0).toFixed(digits)}`;
    return `${r > 0 ? '+' : MINUS}${Math.abs(r).toFixed(digits)}`;
}

/** "1 game" / "3 games". */
export function plural(n: number, one: string, many = `${one}s`): string {
    return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/*
 * Diverging percentage colour in OKLCH: --neg (0%) → neutral (50%) → --pos
 * (100%). Every stop keeps L ≥ 0.68 so text in this colour stays ≥4.5:1 on
 * the dark surfaces (checked in format.test.ts).
 */
const NEG = { l: 0.7, c: 0.2, h: 15 }; // ≈ --neg #ff4d6a
const MID = { l: 0.78, c: 0.02, h: 250 }; // ≈ --text-2 #a9b4c2
const POS = { l: 0.86, c: 0.2, h: 152 }; // ≈ --pos #3cff8f

function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}

/** OKLCH components for a 0–100 percentage. */
export function pctToneLch(pct: number): { l: number; c: number; h: number } {
    const p = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 50));
    if (p <= 50) {
        const t = p / 50;
        // Hue jumps at the neutral end, where chroma is ~0 so the jump is invisible.
        return { l: lerp(NEG.l, MID.l, t), c: lerp(NEG.c, MID.c, t), h: t < 0.85 ? NEG.h : MID.h };
    }
    const t = (p - 50) / 50;
    return { l: lerp(MID.l, POS.l, t), c: lerp(MID.c, POS.c, t), h: t < 0.15 ? MID.h : POS.h };
}

export function pctTone(pct: number): string {
    const { l, c, h } = pctToneLch(pct);
    return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h})`;
}

/** Short date "Oct 4" from an ISO date or timestamp (UTC-safe for plain dates). */
export function shortDate(iso: string | null | undefined): string {
    if (!iso) return '';
    const plain = /^\d{4}-\d{2}-\d{2}$/.test(iso);
    const d = new Date(plain ? `${iso}T12:00:00Z` : iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: plain ? 'UTC' : undefined });
}
