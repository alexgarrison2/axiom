/**
 * The travel map's projection: Albers equal-area conic for North America,
 * then a camera tilt with perspective (the map lies on a table, north away
 * from the viewer), then a 2D fit. Arcs lift off the table along great
 * circles. Pure math; the component draws with SVG.
 */

export type LonLat = [number, number];

const R = Math.PI / 180;
// Conic parameters tuned for the NHL footprint (Florida to Edmonton).
const LON0 = -97 * R;
const LAT0 = 42 * R;
const P1 = 33 * R;
const P2 = 52 * R;
const N = (Math.sin(P1) + Math.sin(P2)) / 2;
const C = Math.cos(P1) ** 2 + 2 * N * Math.sin(P1);
const RHO0 = Math.sqrt(C - 2 * N * Math.sin(LAT0)) / N;

/** Albers conic, unit sphere; y grows north. */
export function albers([lon, lat]: LonLat): [number, number] {
    let dl = lon * R - LON0;
    if (dl > Math.PI) dl -= 2 * Math.PI;
    if (dl < -Math.PI) dl += 2 * Math.PI;
    const rho = Math.sqrt(Math.max(0, C - 2 * N * Math.sin(lat * R))) / N;
    const t = N * dl;
    return [rho * Math.sin(t), RHO0 - rho * Math.cos(t)];
}

export interface Tilt {
    /** Camera pitch, degrees (0 = flat map). */
    pitch: number;
    /** Camera distance in plane units (smaller = stronger perspective). */
    distance: number;
}

export const DEFAULT_TILT: Tilt = { pitch: 38, distance: 2.4 };

/** Plane point (+ height above the table, plane units) → camera space; y grows down. */
export function tilt([x, y]: [number, number], h: number, t: Tilt): [number, number] {
    const p = t.pitch * R;
    // Rotate the table away from the viewer about the east-west axis.
    const depth = y * Math.sin(p) - h * Math.cos(p);
    const up = y * Math.cos(p) + h * Math.sin(p);
    const s = t.distance / (t.distance + depth);
    return [x * s, -up * s];
}

/** Base (pre-fit) screen point for a lon/lat at a height above the table. */
export function toBase(ll: LonLat, h = 0, t: Tilt = DEFAULT_TILT): [number, number] {
    return tilt(albers(ll), h, t);
}

export interface Fit {
    k: number;
    tx: number;
    ty: number;
}

/** Scale and offset that fit base points into a w×h box with padding. */
export function fitBox(points: [number, number][], w: number, h: number, pad: { x: number; top: number; bottom: number }, minSpan = 0): Fit {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of points) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
    }
    if (!Number.isFinite(x0)) return { k: 1, tx: 0, ty: 0 };
    // Never zoom in past `minSpan` base units (a short trip stays in context).
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const sw = Math.max(x1 - x0, minSpan);
    const sh = Math.max(y1 - y0, minSpan * (h / Math.max(w, 1)));
    const aw = Math.max(1, w - 2 * pad.x);
    const ah = Math.max(1, h - pad.top - pad.bottom);
    const k = Math.min(aw / sw, ah / sh);
    return { k, tx: pad.x + aw / 2 - cx * k, ty: pad.top + ah / 2 - cy * k };
}

export const applyFit = ([x, y]: [number, number], f: Fit): [number, number] => [x * f.k + f.tx, y * f.k + f.ty];

/** Points along the great circle from a to b (inclusive), `n` segments. */
export function greatCircle(a: LonLat, b: LonLat, n = 24): LonLat[] {
    const toV = ([lon, lat]: LonLat) => [Math.cos(lat * R) * Math.cos(lon * R), Math.cos(lat * R) * Math.sin(lon * R), Math.sin(lat * R)];
    const va = toV(a);
    const vb = toV(b);
    const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
    const omega = Math.acos(dot);
    if (omega < 1e-9) return [a, b];
    const out: LonLat[] = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const s0 = Math.sin((1 - t) * omega) / Math.sin(omega);
        const s1 = Math.sin(t * omega) / Math.sin(omega);
        const v = [s0 * va[0] + s1 * vb[0], s0 * va[1] + s1 * vb[1], s0 * va[2] + s1 * vb[2]];
        out.push([Math.atan2(v[1], v[0]) / R, Math.asin(v[2]) / R]);
    }
    return out;
}

/**
 * A flight arc in base space: great circle on the table, lifted by
 * `lift × chord × sin(πt)` (chord in plane units), so long flights rise higher.
 */
export function arcPath(a: LonLat, b: LonLat, t: Tilt = DEFAULT_TILT, lift = 0.22): [number, number][] {
    const pa = albers(a);
    const pb = albers(b);
    const chord = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    const pts = greatCircle(a, b, Math.max(8, Math.min(40, Math.round(chord * 60))));
    return pts.map((ll, i) => tilt(albers(ll), lift * chord * Math.sin((Math.PI * i) / (pts.length - 1)), t));
}
