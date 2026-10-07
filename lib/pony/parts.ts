import type { GsPart } from '@/lib/game/analytics';

/** Pony Score parts: offence in a cool family, defence in a warm one (DESIGN.md "Pony score bars"). */
export const PARTS: Record<GsPart, { label: string; color: string }> = {
    oProd: { label: 'Production', color: '#38c6e6' },
    oDrive: { label: 'Play driving', color: '#2b7ea6' },
    oSpecial: { label: 'Special teams', color: '#9fe3f2' },
    oUsage: { label: 'Usage', color: '#5d7289' },
    dProd: { label: 'Production', color: '#e2603f' },
    dDrive: { label: 'Play driving', color: '#f39143' },
    dSpecial: { label: 'Special teams', color: '#f4c552' },
    dUsage: { label: 'Usage', color: '#a08e7c' },
};
export const IDEAS: [GsPart, GsPart][] = [
    ['oProd', 'dProd'],
    ['oDrive', 'dDrive'],
    ['oSpecial', 'dSpecial'],
    ['oUsage', 'dUsage'],
];
export const ORDER: GsPart[] = ['oProd', 'oDrive', 'oSpecial', 'oUsage', 'dProd', 'dDrive', 'dSpecial', 'dUsage'];

/** Signed score text: +0.42 / −0.18 / 0.00. */
export const signed = (v: number, d = 2) => `${v > 0.004 ? '+' : v < -0.004 ? '−' : ''}${Math.abs(v).toFixed(d)}`;

/** Signed stack geometry: positive parts right of zero, negative left, in the fixed order. */
export function stack(parts: Record<GsPart, number>, x: (v: number) => number) {
    const out: { k: GsPart; x: number; w: number }[] = [];
    let pos = 0;
    let neg = 0;
    for (const k of ORDER) {
        const v = parts[k];
        if (Math.abs(v) < 0.0005) continue;
        if (v > 0) {
            out.push({ k, x: x(pos), w: x(pos + v) - x(pos) });
            pos += v;
        } else {
            out.push({ k, x: x(neg + v), w: x(neg) - x(neg + v) });
            neg += v;
        }
    }
    return out;
}
