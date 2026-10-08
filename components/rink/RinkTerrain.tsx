'use client';

import * as React from 'react';
import { resample } from '@/lib/players/isolate-contour';
import { MAP_VIEW, OUTLINE, RinkIce, RinkMarks, rinkFrame, useWidth, type RinkFrame } from './Rink3D';

/**
 * An isolated-impact map as a shaded relief on the tilted rink. The impact grid
 * (5 ft cells, net at the top, the shooter's left on the left) is smoothed into
 * one continuous surface: "more shots" rises as orange hills, "fewer shots"
 * sinks as blue valleys that darken with depth. Each facet is lit from the
 * upper left, the map's contour levels lie on the surface as thin lines, and
 * colour fades in from zero so flat ice and its markings show through. Drawn
 * far to near on a canvas over the SVG rink, with the net at its own depth so
 * a hill in the slot stands in front of it.
 */

const UP = 6; // ft at the top contour level
const DOWN = 8;
const MORE_LO = [214, 124, 58];
const MORE_HI = [255, 178, 108];
const FEWER_LO = [64, 188, 222];
const FEWER_HI = [3, 26, 40];
// Light from the upper left, a little behind the camera.
const L = (() => {
    const v = [-0.55, -0.35, 0.76];
    const n = Math.hypot(...v);
    return v.map(x => x / n);
})();

const lerp = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);
/** The ice under the surface (--surface-2): facets are pre-blended onto it, so they can be opaque and seamless. */
const ICE = [15, 22, 34];
const pads = (W: number) => [Math.round(W * 0.07), Math.round(W * 0.05)] as const;

/** Box-blur a lattice in place (two passes): a smoother surface than the 5 ft cells. */
function smooth(v: Float64Array, nx: number, ny: number, passes = 2) {
    const tmp = new Float64Array(v.length);
    for (let p = 0; p < passes; p++) {
        for (let i = 0; i < nx; i++)
            for (let j = 0; j < ny; j++) {
                let s = 0;
                let n = 0;
                for (let di = -1; di <= 1; di++)
                    for (let dj = -1; dj <= 1; dj++) {
                        const a = i + di;
                        const b = j + dj;
                        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
                        s += v[a * ny + b];
                        n++;
                    }
                tmp[i * ny + j] = s / n;
            }
        v.set(tmp);
    }
}

type Proj = (i: number, j: number, h: number) => readonly number[];

/** The segment(s) where a facet crosses level `lv`, drawn at that level's height. */
function contour(ctx: CanvasRenderingContext2D, v4: number[], lv: number, i: number, j: number, P: Proj, h: number, up: boolean) {
    const corners: [number, number][] = [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]];
    const pts: [number, number][] = [];
    for (let k = 0; k < 4; k++) {
        const a = v4[k];
        const b = v4[(k + 1) % 4];
        if (a >= lv !== b >= lv) {
            const t = (lv - a) / (b - a);
            const [ai, aj] = corners[k];
            const [bi, bj] = corners[(k + 1) % 4];
            pts.push([ai + (bi - ai) * t, aj + (bj - aj) * t]);
        }
    }
    if (pts.length < 2) return;
    ctx.strokeStyle = up ? 'rgba(255,236,214,0.42)' : 'rgba(170,230,248,0.32)';
    ctx.lineWidth = 0.75;
    for (let k = 0; k + 1 < pts.length; k += 2) {
        const a = P(pts[k][0], pts[k][1], h);
        const b = P(pts[k + 1][0], pts[k + 1][1], h);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
    }
}

function net(ctx: CanvasRenderingContext2D, f: RinkFrame, red: string) {
    const { T } = f;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ([[-3, 89, 4], [3, 89, 4], [2.4, 91.4, 1], [-2.4, 91.4, 1]] as const).forEach(([u, v, h], k) => {
        const q = T(u, v, h);
        if (k === 0) ctx.moveTo(q[0], q[1]);
        else ctx.lineTo(q[0], q[1]);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(232,238,248,0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,238,248,0.4)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.strokeStyle = red;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ([[-3, 89, 0], [-3, 89, 4], [3, 89, 4], [3, 89, 0]] as const).forEach(([u, v, h], k) => {
        const q = T(u, v, h);
        if (k === 0) ctx.moveTo(q[0], q[1]);
        else ctx.lineTo(q[0], q[1]);
    });
    ctx.stroke();
    ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, f: RinkFrame, codes: number[], nx: number, ny: number, levels: number[], thin: boolean, red: string) {
    const lat = resample(codes, nx, ny, 4);
    const NX = lat.nx;
    const NY = lat.ny;
    const val = new Float64Array(lat.v);
    smooth(val, NX, NY);
    const top = levels[levels.length - 1] || 1;
    const cell = 5 * lat.step;
    const U = (j: number) => 42.5 - j * cell;
    const V = (i: number) => 20 + i * cell;
    const H = (x: number) => (x >= 0 ? (Math.min(x, top * 1.4) / top) * UP : (Math.max(x, -top * 1.4) / top) * DOWN);
    const z = new Float64Array(val.length);
    for (let k = 0; k < val.length; k++) z[k] = H(val[k]);
    const at = (i: number, j: number) => z[Math.max(0, Math.min(NX - 1, i)) * NY + Math.max(0, Math.min(NY - 1, j))];
    const P: Proj = (i, j, h) => f.T(U(j), V(i), h);

    ctx.globalAlpha = thin ? 0.6 : 1;
    ctx.lineJoin = 'round';
    // Clip to the rink: the ice plus the board walls above it (two subpaths, nonzero = their union).
    ctx.save();
    ctx.beginPath();
    for (const h of [0, 3.5]) {
        OUTLINE.forEach(([u, v], k) => {
            const q = f.T(u, v, h);
            if (k === 0) ctx.moveTo(q[0], q[1]);
            else ctx.lineTo(q[0], q[1]);
        });
        ctx.closePath();
    }
    ctx.clip('nonzero');
    for (let i = NX - 2; i >= 0; i--) {
        for (let j = 0; j < NY - 1; j++) {
            if (V(i + 1) < 24 || V(i) > 101) continue;
            const v4 = [val[i * NY + j], val[i * NY + j + 1], val[(i + 1) * NY + j + 1], val[(i + 1) * NY + j]];
            const m = (v4[0] + v4[1] + v4[2] + v4[3]) / 4;
            const t = Math.min(1, Math.abs(m) / top);
            // Lambert shading from the surface normal (u falls as j grows, v grows with i).
            const dzdu = (at(i, j - 1) - at(i, j + 2)) / (3 * cell);
            const dzdv = (at(i + 2, j) - at(i - 1, j)) / (3 * cell);
            const nl = Math.hypot(dzdu, dzdv, 1);
            const lit = (-dzdu * L[0] - dzdv * L[1] + L[2]) / nl / L[2];
            const shade = Math.max(0.42, Math.min(1.3, lit));
            const base = m >= 0 ? lerp(MORE_LO, MORE_HI, t) : lerp(FEWER_LO, FEWER_HI, t);
            // Colour fades to the ice at zero from both sides, so the surface is continuous through it.
            const alpha = Math.min(0.94, Math.pow(t, 0.75) * 1.05);
            const c = base.map((x, k) => Math.round(Math.max(0, Math.min(255, x * shade * alpha + ICE[k] * (1 - alpha)))));
            const q = [P(i, j, at(i, j)), P(i, j + 1, at(i, j + 1)), P(i + 1, j + 1, at(i + 1, j + 1)), P(i + 1, j, at(i + 1, j))];
            ctx.beginPath();
            ctx.moveTo(q[0][0], q[0][1]);
            for (let k = 1; k < 4; k++) ctx.lineTo(q[k][0], q[k][1]);
            ctx.closePath();
            ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
            ctx.fill();
            // Opaque hairline in the facet's own colour closes the seams between neighbours.
            ctx.strokeStyle = ctx.fillStyle;
            ctx.lineWidth = 0.7;
            ctx.stroke();
            for (const lv of levels) {
                contour(ctx, v4, lv, i, j, P, H(lv), true);
                contour(ctx, v4, -lv, i, j, P, H(-lv), false);
            }
        }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    // Markings draped over the terrain, then the net, which always shows.
    const zAt = (u: number, v: number) => {
        const fi = (v - 20) / cell;
        const fj = (42.5 - u) / cell;
        const i0 = Math.max(0, Math.min(NX - 2, Math.floor(fi)));
        const j0 = Math.max(0, Math.min(NY - 2, Math.floor(fj)));
        const ti = Math.max(0, Math.min(1, fi - i0));
        const tj = Math.max(0, Math.min(1, fj - j0));
        const a = at(i0, j0) * (1 - tj) + at(i0, j0 + 1) * tj;
        const b = at(i0 + 1, j0) * (1 - tj) + at(i0 + 1, j0 + 1) * tj;
        return a * (1 - ti) + b * ti;
    };
    const drape = (pts: [number, number][], stroke: string, width: number) => {
        ctx.beginPath();
        pts.forEach(([u, v], k) => {
            const q = f.T(u, v, Math.max(0, zAt(u, v)) + 0.05);
            if (k === 0) ctx.moveTo(q[0], q[1]);
            else ctx.lineTo(q[0], q[1]);
        });
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.stroke();
    };
    const arc = (cu: number, cv: number, r: number, a0: number, a1: number, n = 48) => [...Array(n + 1)].map((_, k) => {
        const a = a0 + ((a1 - a0) * k) / n;
        return [cu + r * Math.cos(a), cv + r * Math.sin(a)] as [number, number];
    });
    for (const fu of [-22, 22]) drape(arc(fu, 69, 15, 0, 2 * Math.PI), 'rgba(255,84,112,0.3)', 1);
    drape([...Array(41)].map((_, k) => [-36.7 + (73.4 * k) / 40, 89] as [number, number]), 'rgba(255,84,112,0.55)', 1.5);
    drape(arc(0, 89, 6, Math.PI, 2 * Math.PI, 20), 'rgba(77,159,255,0.6)', 1);
    net(ctx, f, red);
}

export function RinkTerrain({ codes, nx, ny, levels, thin, label }: { codes: number[] | null; nx: number; ny: number; levels: number[]; thin?: boolean; label: string }) {
    const [ref, w] = useWidth<HTMLDivElement>();
    const id = React.useId().replace(/:/g, '');
    const canvas = React.useRef<HTMLCanvasElement>(null);
    const [top, bottom] = pads(w);
    const f = rinkFrame(w, top, bottom, MAP_VIEW);
    const { W, H } = f;

    React.useEffect(() => {
        const cv = canvas.current;
        if (!cv || !W) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
        const ctx = cv.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        const red = getComputedStyle(document.documentElement).getPropertyValue('--neg').trim() || '#ff5470';
        const fr = rinkFrame(W, ...pads(W), MAP_VIEW);
        if (codes) draw(ctx, fr, codes, nx, ny, levels, !!thin, red);
        else net(ctx, fr, red);
    }, [W, H, codes, nx, ny, levels, thin]);

    return (
        <div ref={ref} className="relative w-full">
            {W ? (
                <>
                    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="block select-none overflow-visible">
                        <RinkIce f={f} id={id} />
                        <RinkMarks f={f} />
                        {!codes ? (
                            <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-fg-3 text-micro uppercase tracking-label">
                                No time
                            </text>
                        ) : null}
                    </svg>
                    <canvas ref={canvas} role="img" aria-label={label} className="pointer-events-none absolute left-0 top-0" style={{ width: W, height: H }} />
                    {/* The board rail on top, so hills at the boards stay inside the rink. */}
                    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 overflow-visible">
                        {/* Opaque walls hide where the surface meets the boards. */}
                        <path
                            d={OUTLINE.slice(0, -1)
                                .map((a, k) => {
                                    const b = OUTLINE[k + 1];
                                    if (a[1] > 72 || b[1] > 72) return '';
                                    return `M${f.pt(f.T(a[0], a[1], -0.4))}L${f.pt(f.T(b[0], b[1], -0.4))}L${f.pt(f.T(b[0], b[1], 3.5))}L${f.pt(f.T(a[0], a[1], 3.5))}Z`;
                                })
                                .join('')}
                            fill="var(--surface-1)"
                        />
                        <polyline points={OUTLINE.map(([u, v]) => f.pt(f.T(u, v, 0))).join(' ')} fill="none" stroke="rgb(35 64 95 / 0.6)" />
                        <polyline points={OUTLINE.map(([u, v]) => f.pt(f.T(u, v, 3.5))).join(' ')} fill="none" stroke="var(--line-strong)" strokeWidth={1.5} />
                    </svg>
                </>
            ) : (
                <div className="aspect-[4/3] w-full" />
            )}
        </div>
    );
}
