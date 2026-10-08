'use client';

import * as React from 'react';
import { S, type ShotRow } from '@/lib/shots';

/**
 * The offensive half of a rink, tilted in 3D as if seen from above the blue
 * line: near ice large, far ice small, boards as low walls, the net a real
 * frame on the goal line. Coordinates are NHL feet with the net at x = +89
 * (u = across, v = toward the net, z = up).
 *
 *  shots: unblocked attempts are flat discs on the ice (saved = filled, missed
 *         = open ring, misses optional); goals rise as glowing posts whose
 *         height follows xG.
 *  zones: hexes on the ice coloured by goals above / below expected in each
 *         area (green = better for the player the map belongs to).
 */

export type RinkTone = 'pos' | 'neg';

/** Camera: pitch down from level (degrees), position along the rink (ft; the blue line is 25) and height (ft). */
export interface RinkView {
    pitch: number;
    at: number;
    height: number;
}
/** The broadcast-like view of the shot maps. */
export const SHOT_VIEW: RinkView = { pitch: 50, at: -8, height: 58 };
/** Steeper and higher, for surfaces (impact terrain), so the rink's shape stays readable under them. */
export const MAP_VIEW: RinkView = { pitch: 64, at: 6, height: 100 };
const VC = SHOT_VIEW.at;
const HC = SHOT_VIEW.height;
const BOARD = 3.5;

function project(u: number, v: number, z = 0, view: RinkView = SHOT_VIEW): [number, number, number] {
    const th = (view.pitch * Math.PI) / 180;
    const dv = v - view.at;
    const dz = z - view.height;
    const yc = dv * Math.sin(th) + dz * Math.cos(th);
    const zc = dv * Math.cos(th) - dz * Math.sin(th);
    return [u / zc, -yc / zc, zc];
}

// Boards: straight sides, 28ft corners behind the net.
export const OUTLINE: [number, number][] = (() => {
    const out: [number, number][] = [];
    const r = 28;
    for (let v = 25; v <= 72; v += 2) out.push([-42.5, v]);
    for (let a = 180; a >= 90; a -= 6) out.push([-14.5 + r * Math.cos((a * Math.PI) / 180), 72 + r * Math.sin((a * Math.PI) / 180)]);
    for (let a = 90; a >= 0; a -= 6) out.push([14.5 + r * Math.cos((a * Math.PI) / 180), 72 + r * Math.sin((a * Math.PI) / 180)]);
    for (let v = 72; v >= 25; v -= 2) out.push([42.5, v]);
    return out;
})();

const boundsCache = new Map<RinkView, { minX: number; maxX: number; minY: number; maxY: number }>();
function bounds(view: RinkView) {
    let b = boundsCache.get(view);
    if (!b) {
        const pts = [[-42.5, 25], [42.5, 25], [-42.5, 100], [42.5, 100]].flatMap(([u, v]) => [project(u, v, 0, view), project(u, v, BOARD, view)]);
        b = { minX: Math.min(...pts.map(p => p[0])), maxX: Math.max(...pts.map(p => p[0])), minY: Math.min(...pts.map(p => p[1])), maxY: Math.max(...pts.map(p => p[1])) };
        boundsCache.set(view, b);
    }
    return b;
}

/** Screen mapping for a rink drawn `W` px wide; `top` / `bottom` px of headroom for things above or below the ice. */
export function rinkFrame(W: number, top = 30, bottom = 10, view: RinkView = SHOT_VIEW) {
    const B = bounds(view);
    const scale = (W - 8) / (B.maxX - B.minX);
    const H = Math.round((B.maxY - B.minY) * scale + top + bottom);
    const T = (u: number, v: number, z = 0) => {
        const [x, y, zc] = project(u, v, z, view);
        return [4 + (x - B.minX) * scale, top + (y - B.minY) * scale, zc] as const;
    };
    const pt = (q: readonly number[]) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`;
    const poly = (pts: readonly (readonly [number, number])[], z = 0) => pts.map(([u, v]) => pt(T(u, v, z))).join(' ');
    return { W, H, scale, T, pt, poly };
}
export type RinkFrame = ReturnType<typeof rinkFrame>;

/** Element width, tracked. */
export function useWidth<T extends HTMLElement>() {
    const ref = React.useRef<T>(null);
    const [w, setW] = React.useState(0);
    React.useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, w] as const;
}

const circle = (cu: number, cv: number, r: number, n = 40) => [...Array(n + 1)].map((_, i) => [cu + r * Math.cos((i / n) * 2 * Math.PI), cv + r * Math.sin((i / n) * 2 * Math.PI)] as [number, number]);

/** Ice and boards (walls and top rail). */
export function RinkIce({ f, id }: { f: RinkFrame; id: string }) {
    const { T, pt, poly } = f;
    return (
        <>
            <defs>
                <linearGradient id={`ice${id}`} x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0" stopColor="var(--surface-2)" />
                    <stop offset="1" stopColor="var(--surface-1)" />
                </linearGradient>
            </defs>
            <polygon points={poly(OUTLINE)} fill={`url(#ice${id})`} />
            {OUTLINE.slice(0, -1).map((a, i) => {
                const b = OUTLINE[i + 1];
                return <polygon key={i} points={`${poly([a, b])} ${pt(T(b[0], b[1], BOARD))} ${pt(T(a[0], a[1], BOARD))}`} fill="rgb(35 64 95 / 0.22)" />;
            })}
            <polyline points={OUTLINE.map(([u, v]) => pt(T(u, v, BOARD))).join(' ')} fill="none" stroke="var(--line-strong)" strokeWidth={1.5} />
            <polyline points={poly(OUTLINE)} fill="none" stroke="rgb(35 64 95 / 0.6)" />
        </>
    );
}

/** Blue line, faceoff circles, goal line and crease, on the ice. */
export function RinkMarks({ f }: { f: RinkFrame }) {
    const { T, poly } = f;
    return (
        <>
            <polygon points={poly([[-42.5, 24], [42.5, 24], [42.5, 26.5], [-42.5, 26.5]])} fill="rgb(var(--goalie-rgb) / 0.35)" />
            {[-22, 22].map(fu => (
                <g key={fu}>
                    <polyline points={poly(circle(fu, 69, 15))} fill="none" stroke="rgb(var(--neg-rgb) / 0.28)" />
                    <ellipse cx={T(fu, 69)[0]} cy={T(fu, 69)[1]} rx={2.6} ry={1.6} fill="rgb(var(--neg-rgb) / 0.55)" />
                </g>
            ))}
            <polyline points={poly([[-36.7, 89], [36.7, 89]])} fill="none" stroke="rgb(var(--neg-rgb) / 0.5)" strokeWidth={1.5} />
            <polygon
                points={poly([...Array(21)].map((_, i) => [6 * Math.cos((i / 20) * Math.PI), 89 - 6 * Math.sin((i / 20) * Math.PI)] as [number, number]))}
                fill="rgb(var(--goalie-rgb) / 0.16)"
                stroke="rgb(var(--goalie-rgb) / 0.55)"
            />
        </>
    );
}

/** The net: red posts and crossbar on the goal line, mesh behind. */
export function RinkNet({ f }: { f: RinkFrame }) {
    const { T, pt } = f;
    return (
        <g>
            <polygon points={`${pt(T(-3, 89, 4))} ${pt(T(3, 89, 4))} ${pt(T(2.4, 91.4, 1))} ${pt(T(-2.4, 91.4, 1))}`} fill="rgb(var(--text-1-rgb) / 0.07)" stroke="rgb(var(--text-1-rgb) / 0.35)" strokeWidth={0.8} />
            <polygon points={`${pt(T(-3, 89))} ${pt(T(-2.4, 91.4))} ${pt(T(2.4, 91.4))} ${pt(T(3, 89))}`} fill="rgb(var(--text-1-rgb) / 0.05)" />
            {[-3, 3].map(u => (
                <line key={u} x1={T(u, 89)[0]} y1={T(u, 89)[1]} x2={T(u, 89, 4)[0]} y2={T(u, 89, 4)[1]} stroke="var(--neg)" strokeWidth={2.2} />
            ))}
            <line x1={T(-3, 89, 4)[0]} y1={T(-3, 89, 4)[1]} x2={T(3, 89, 4)[0]} y2={T(3, 89, 4)[1]} stroke="var(--neg)" strokeWidth={2.2} />
        </g>
    );
}

const HEX_R = 4.2;
const HEX_MIN = 6;

export function Rink3D({
    shots,
    mode,
    tone,
    showMisses = true,
    label,
    maxWidth = 760,
}: {
    shots: ShotRow[];
    mode: 'shots' | 'zones';
    /** Goals for the player the map belongs to are good (pos, a shooter) or bad (neg, a goalie). */
    tone: RinkTone;
    showMisses?: boolean;
    label: string;
    maxWidth?: number;
}) {
    const [ref, w] = useWidth<HTMLDivElement>();
    const id = React.useId().replace(/:/g, '');
    const f = rinkFrame(Math.min(w, maxWidth));
    const { W, H, scale, T, poly } = f;
    const goal = tone === 'pos' ? 'var(--pos)' : 'var(--neg)';

    const content = React.useMemo(() => {
        if (!W) return null;
        const marks: { z: number; el: React.ReactNode }[] = [];
        if (mode === 'zones') {
            const hx = HEX_R * Math.sqrt(3);
            const bins = new Map<string, { row: number; col: number; n: number; xg: number; g: number }>();
            for (const s of shots) {
                const row = Math.round(s[S.x] / (HEX_R * 1.5));
                const col = Math.round((s[S.y] - (row % 2 ? hx / 2 : 0)) / hx);
                const k = `${row},${col}`;
                const b = bins.get(k) ?? { row, col, n: 0, xg: 0, g: 0 };
                b.n++;
                b.xg += s[S.xg];
                b.g += s[S.goal];
                bins.set(k, b);
            }
            for (const b of bins.values()) {
                if (b.n < HEX_MIN) continue;
                const cv = b.row * HEX_R * 1.5;
                const cu = b.col * hx + (b.row % 2 ? hx / 2 : 0);
                if (cv < 26 || cv > 98) continue;
                const d = (tone === 'pos' ? 1 : -1) * (b.g - b.xg);
                const a = Math.min(0.8, 0.14 + (Math.abs(d) / 3) * 0.6);
                const hex = [...Array(6)].map((_, i) => [cu + HEX_R * 0.93 * Math.sin((i * Math.PI) / 3), cv + HEX_R * 0.93 * Math.cos((i * Math.PI) / 3)] as [number, number]);
                marks.push({
                    z: T(cu, cv)[2],
                    el: (
                        <polygon key={`h${b.row},${b.col}`} points={poly(hex, 0.05)} fill={`rgb(var(${d >= 0 ? '--pos-rgb' : '--neg-rgb'}) / ${a.toFixed(2)})`} stroke="var(--bg)" strokeWidth={0.8}>
                            <title>{`${b.n} shots · ${b.xg.toFixed(1)} xG · ${b.g} goals`}</title>
                        </polygon>
                    ),
                });
            }
        } else {
            // Discs fade as the map fills: full strength up to ~300 attempts, about half at 1,300.
            const shown = showMisses ? shots.length : shots.filter(s => s[S.onGoal]).length;
            const dim = Math.min(1, Math.sqrt(300 / Math.max(1, shown)));
            const fill = `rgb(var(--text-2-rgb) / ${(0.3 * dim).toFixed(3)})`;
            const edge = `rgb(var(--text-1-rgb) / ${(0.55 * dim).toFixed(3)})`;
            const ring = `rgb(var(--text-1-rgb) / ${(0.4 * dim).toFixed(3)})`;
            shots.forEach((s, i) => {
                const [x, y, zc] = T(s[S.y], s[S.x]);
                const k = scale / zc;
                const fs = HC / Math.hypot(HC, s[S.x] - VC); // foreshortening of a flat disc
                if (s[S.goal]) {
                    // Capped so a penalty shot (xG near 1) does not tower over the rest.
                    const h = 2 + Math.min(s[S.xg], 0.4) * 30;
                    const top = T(s[S.y], s[S.x], h);
                    const rr = (1 + Math.sqrt(s[S.xg]) * 2.2) * k;
                    marks.push({
                        z: zc - 0.01,
                        el: (
                            <g key={i}>
                                <ellipse cx={x} cy={y} rx={rr * 1.6} ry={rr * 1.6 * fs} fill={`url(#rg${id})`} />
                                <line x1={x} y1={y} x2={top[0]} y2={top[1]} stroke={goal} strokeOpacity={0.75} strokeWidth={Math.max(1, 0.45 * k)} strokeLinecap="round" />
                                <circle cx={top[0]} cy={top[1]} r={Math.max(1.6, 0.55 * k)} fill={goal}>
                                    <title>{`Goal · ${s[S.xg].toFixed(2)} xG`}</title>
                                </circle>
                            </g>
                        ),
                    });
                } else if (s[S.onGoal] || showMisses) {
                    const rr = (0.35 + Math.sqrt(s[S.xg]) * 1.9) * k;
                    marks.push({
                        z: zc,
                        el: s[S.onGoal] ? (
                            <ellipse key={i} cx={x} cy={y} rx={rr} ry={rr * fs} fill={fill} stroke={edge} strokeWidth={0.75} />
                        ) : (
                            <ellipse key={i} cx={x} cy={y} rx={rr} ry={rr * fs} fill="none" stroke={ring} strokeWidth={0.75} />
                        ),
                    });
                }
            });
        }
        // The net sits among the marks by depth.
        marks.push({ z: T(0, 89)[2], el: <RinkNet key="net" f={f} /> });
        marks.sort((a, b) => b.z - a.z);
        return marks.map(m => m.el);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- T / poly depend only on W
    }, [shots, mode, tone, showMisses, W, id]);

    return (
        <div ref={ref} className="flex w-full justify-center">
            {W ? (
                <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block overflow-visible">
                    <defs>
                        <radialGradient id={`rg${id}`}>
                            <stop offset="0" stopColor={goal} stopOpacity={0.55} />
                            <stop offset="1" stopColor={goal} stopOpacity={0} />
                        </radialGradient>
                    </defs>
                    <RinkIce f={f} id={id} />
                    <RinkMarks f={f} />
                    {content}
                </svg>
            ) : (
                <div className="aspect-[16/9] w-full max-w-[760px]" />
            )}
        </div>
    );
}
