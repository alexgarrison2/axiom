/*
 * Filled contours for the isolated-impact maps: a coarse cell grid is resampled
 * bilinearly onto a fine lattice, then marching squares traces the closed
 * boundary rings of {value >= t} for each level. Rings are closed because the
 * lattice is padded with -Infinity, so a region touching the edge is closed
 * along it (the rink clip trims it to the boards). Fill a level's rings with
 * fill-rule evenodd so holes stay holes; draw levels low to high.
 */

export type Pt = [number, number];

export interface Lattice {
    /** Values, row-major: v[i * ny + j], i along x (rows), j along y (columns). */
    v: Float64Array;
    nx: number;
    ny: number;
    /** Lattice spacing in cell units (a lattice point i sits at i * step cells from the grid's edge). */
    step: number;
}

/**
 * Sample a cell grid (values at cell centres, row-major nx x ny) on a lattice
 * that spans the grid's outer edges, `f` points per cell. Values beyond the
 * outermost centres are clamped to the edge (no fade at the boards).
 */
export function resample(cells: ArrayLike<number>, nx: number, ny: number, f = 4): Lattice {
    const NX = nx * f + 1;
    const NY = ny * f + 1;
    const v = new Float64Array(NX * NY);
    const at = (i: number, j: number) => cells[i * ny + j];
    for (let I = 0; I < NX; I++) {
        // position in cell-centre coordinates
        const x = Math.min(nx - 1, Math.max(0, I / f - 0.5));
        const i0 = Math.min(nx - 2, Math.floor(x));
        const tx = nx > 1 ? x - i0 : 0;
        for (let J = 0; J < NY; J++) {
            const y = Math.min(ny - 1, Math.max(0, J / f - 0.5));
            const j0 = Math.min(ny - 2, Math.floor(y));
            const ty = ny > 1 ? y - j0 : 0;
            const i1 = nx > 1 ? i0 + 1 : i0;
            const j1 = ny > 1 ? j0 + 1 : j0;
            const a = at(Math.max(0, i0), Math.max(0, j0));
            const b = at(i1, Math.max(0, j0));
            const c = at(Math.max(0, i0), j1);
            const d = at(i1, j1);
            v[I * NY + J] = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
        }
    }
    return { v, nx: NX, ny: NY, step: 1 / f };
}

/**
 * Closed rings bounding {v >= t}, in lattice coordinates [i, j] (fractional).
 * Saddles are resolved by the cell's centre average.
 */
export function isoRings(lat: Lattice, t: number): Pt[][] {
    // padded lattice: one ring of -Infinity around the data
    const NX = lat.nx + 2;
    const NY = lat.ny + 2;
    const val = (i: number, j: number) => (i <= 0 || j <= 0 || i >= NX - 1 || j >= NY - 1 ? -Infinity : lat.v[(i - 1) * lat.ny + (j - 1)]);
    // edge ids: horizontal edge (i,j)-(i+1,j) -> 2*(i*NY+j); vertical (i,j)-(i,j+1) -> 2*(i*NY+j)+1
    const point = new Map<number, Pt>();
    const cross = (i0: number, j0: number, i1: number, j1: number): number => {
        const id = i1 > i0 ? 2 * (i0 * NY + j0) : 2 * (i0 * NY + j0) + 1;
        if (!point.has(id)) {
            const a = val(i0, j0);
            const b = val(i1, j1);
            // fraction from (i0, j0) toward (i1, j1); an infinite end puts the crossing at the finite point
            let s = 0.5;
            if (!Number.isFinite(a)) s = 1;
            else if (!Number.isFinite(b)) s = 0;
            else if (b !== a) s = Math.min(1, Math.max(0, (t - a) / (b - a)));
            point.set(id, [i0 - 1 + (i1 - i0) * s, j0 - 1 + (j1 - j0) * s]);
        }
        return id;
    };
    // adjacency: each crossing point links to the (at most two) others it shares a segment with
    const next = new Map<number, number[]>();
    const link = (a: number, b: number) => {
        (next.get(a) ?? next.set(a, []).get(a)!).push(b);
        (next.get(b) ?? next.set(b, []).get(b)!).push(a);
    };
    for (let i = 0; i < NX - 1; i++) {
        for (let j = 0; j < NY - 1; j++) {
            const a = val(i, j) >= t ? 1 : 0; // (i, j)
            const b = val(i + 1, j) >= t ? 1 : 0; // (i+1, j)
            const c = val(i + 1, j + 1) >= t ? 1 : 0; // (i+1, j+1)
            const d = val(i, j + 1) >= t ? 1 : 0; // (i, j+1)
            const code = a | (b << 1) | (c << 2) | (d << 3);
            if (code === 0 || code === 15) continue;
            const eAB = () => cross(i, j, i + 1, j);
            const eBC = () => cross(i + 1, j, i + 1, j + 1);
            const eDC = () => cross(i, j + 1, i + 1, j + 1);
            const eAD = () => cross(i, j, i, j + 1);
            switch (code) {
                case 1: case 14: link(eAB(), eAD()); break;
                case 2: case 13: link(eAB(), eBC()); break;
                case 3: case 12: link(eAD(), eBC()); break;
                case 4: case 11: link(eBC(), eDC()); break;
                case 6: case 9: link(eAB(), eDC()); break;
                case 7: case 8: link(eAD(), eDC()); break;
                case 5: case 10: {
                    const vals = [val(i, j), val(i + 1, j), val(i + 1, j + 1), val(i, j + 1)];
                    const centre = vals.every(Number.isFinite) ? vals.reduce((s, x) => s + x, 0) / 4 : -Infinity;
                    const joined = centre >= t;
                    // code 5: a and c inside; code 10: b and d inside
                    if ((code === 5) === joined) {
                        link(eAB(), eBC());
                        link(eAD(), eDC());
                    } else {
                        link(eAB(), eAD());
                        link(eBC(), eDC());
                    }
                    break;
                }
            }
        }
    }
    const rings: Pt[][] = [];
    const seen = new Set<number>();
    for (const start of next.keys()) {
        if (seen.has(start)) continue;
        const ring: Pt[] = [];
        let prev = -1;
        let cur = start;
        while (!seen.has(cur)) {
            seen.add(cur);
            ring.push(point.get(cur)!);
            const nb = next.get(cur) ?? [];
            const go = nb[0] !== prev ? nb[0] : nb[1];
            if (go == null) break;
            prev = cur;
            cur = go;
        }
        if (ring.length >= 3) rings.push(ring);
    }
    return rings;
}

/** Shoelace area of a ring (absolute, lattice units). */
export function ringArea(r: Pt[]): number {
    let s = 0;
    for (let k = 0; k < r.length; k++) {
        const [x0, y0] = r[k];
        const [x1, y1] = r[(k + 1) % r.length];
        s += x0 * y1 - x1 * y0;
    }
    return Math.abs(s) / 2;
}

/** SVG path data for rings mapped through `to` (lattice point -> drawing coordinates). */
export function ringsPath(rings: Pt[][], to: (p: Pt) => Pt, digits = 2): string {
    return rings
        .map(r =>
            r
                .map((p, k) => {
                    const [x, y] = to(p);
                    return `${k ? 'L' : 'M'}${x.toFixed(digits)},${y.toFixed(digits)}`;
                })
                .join('') + 'Z',
        )
        .join('');
}

/** Contour levels: `n` evenly spaced thresholds from `top / n` to `top`. */
export function levels(top: number, n: number): number[] {
    return Array.from({ length: n }, (_, k) => (top * (k + 1)) / n);
}
