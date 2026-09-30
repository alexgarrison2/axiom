/**
 * Small, dependency-free colour math used by the design system:
 * WCAG relative luminance / contrast and CIELAB ΔE (CIE76).
 * Pure functions — safe on the server, the client and in tests.
 */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
    let h = hex.trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function srgbToLinear(c: number): number {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
    const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colours (1 … 21). */
export function contrastRatio(a: string, b: string): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
}

export const INK_DARK = '#05070B';
export const INK_LIGHT = '#FFFFFF';

/** Text colour (near-black or white) with the higher WCAG contrast on `bg`. */
export function readableTextOn(bg: string): string {
    return contrastRatio(bg, INK_DARK) >= contrastRatio(bg, INK_LIGHT) ? INK_DARK : INK_LIGHT;
}

/** sRGB hex → CIELAB (D65). */
export function hexToLab(hex: string): [number, number, number] {
    const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
    // linear sRGB → XYZ (D65)
    const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
    const y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) / 1.0;
    const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference. ~2.3 is a just-noticeable difference; <25 reads as "same colour family" in a bar. */
export function deltaE(a: string, b: string): number {
    const [l1, a1, b1] = hexToLab(a);
    const [l2, a2, b2] = hexToLab(b);
    return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
