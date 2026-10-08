'use client';

import * as React from 'react';
import { isoRings, resample, type Pt } from '@/lib/players/isolate-contour';
import { OUTLINE, RinkIce, RinkMarks, RinkNet, rinkFrame, useWidth } from './Rink3D';

/**
 * An isolated-impact map as terrain on the tilted rink. Each contour level is a
 * terrace: "more shots" (orange) rises a step per level as translucent
 * plateaus, so the net and markings show through; "fewer shots" (blue) sinks
 * a step per level as basins that darken with depth. The grid is the impact
 * file's 5 ft cells (net at the top, the shooter's left on the left).
 */

const MORE = [243, 145, 67] as const;
const FEWER = [56, 198, 230] as const;
const PANEL = [10, 14, 21] as const;
/** Height of one level: plateaus rise, basins sink (ft). */
const RISE = 2;
const SINK = 2;
/** Drawing size of the impact grid (ft): 85 across, 80 from the end boards toward centre. */
const GW = 85;
const GH = 80;

const mix = (c: readonly number[], a: number) => `rgb(${c.map((x, i) => Math.round(x * a + PANEL[i] * (1 - a))).join(',')})`;
const rgba = (c: readonly number[], a: number) => `rgb(${c.join(' ')} / ${a})`;

export function RinkTerrain({ codes, nx, ny, levels, thin, label }: { codes: number[] | null; nx: number; ny: number; levels: number[]; thin?: boolean; label: string }) {
    const [ref, w] = useWidth<HTMLDivElement>();
    const id = React.useId().replace(/:/g, '');
    const f = rinkFrame(w, Math.round(w * 0.13), Math.round(w * 0.07));
    const { W, H, T, pt, poly } = f;

    // Contour rings per level, in rink feet ([across, toward the net], net at v = 89).
    const rings = React.useMemo(() => {
        if (!codes) return null;
        const lat = resample(codes, nx, ny, 4);
        const neg = { ...lat, v: lat.v.map(x => -x) };
        const cell = 5 * lat.step;
        const toFt = ([i, j]: Pt): [number, number] => [GW - j * cell - 42.5, 100 - (GH - i * cell)];
        return {
            more: levels.map(t => isoRings(lat, t).map(r => r.map(toFt))),
            fewer: levels.map(t => isoRings(neg, t).map(r => r.map(toFt))),
        };
    }, [codes, nx, ny, levels]);

    const face = (rs: [number, number][][], z: number) => rs.map(r => `M${r.map(([u, v]) => pt(T(u, v, z))).join('L')}Z`).join('');
    const walls = (rs: [number, number][][], z0: number, z1: number) =>
        rs
            .map(r =>
                r
                    .map((a, k) => {
                        const b = r[(k + 1) % r.length];
                        return `M${pt(T(a[0], a[1], z0))}L${pt(T(b[0], b[1], z0))}L${pt(T(b[0], b[1], z1))}L${pt(T(a[0], a[1], z1))}Z`;
                    })
                    .join(''),
            )
            .join('');
    const n = levels.length;

    return (
        <div ref={ref} className="w-full">
            {W ? (
                <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block select-none overflow-visible">
                    <defs>
                        {[...Array(n + 1)].map((_, k) => (
                            <React.Fragment key={k}>
                                <clipPath id={`up${id}-${k}`}>
                                    <polygon points={poly(OUTLINE, k * RISE)} />
                                </clipPath>
                                {k === 0 ? (
                                    <clipPath id={`dn${id}-0`}>
                                        <polygon points={poly(OUTLINE)} />
                                    </clipPath>
                                ) : null}
                            </React.Fragment>
                        ))}
                        {/* Each basin level is seen only through its own opening (its ring at the level's top). */}
                        {rings?.fewer.map((rs, k) => (
                            <clipPath key={`o${k}`} id={`op${id}-${k}`}>
                                <path d={face(rs, -k * SINK)} clipRule="evenodd" />
                            </clipPath>
                        ))}
                    </defs>
                    <RinkIce f={f} id={id} />
                    <RinkMarks f={f} />
                    {rings ? (
                        <g opacity={thin ? 0.6 : 1}>
                            {/* Basins, shallow to deep: each level's wall, then its darker floor. */}
                            {rings.fewer.map((rs, k) =>
                                rs.length ? (
                                    <g key={`f${k}`} clipPath={`url(#dn${id}-0)`}>
                                        <g clipPath={`url(#op${id}-${k})`}>
                                            <path d={walls(rs, -k * SINK, -(k + 1) * SINK)} fill={mix(FEWER, 0.14)} />
                                            <path d={face(rs, -(k + 1) * SINK)} fill={mix(FEWER, 0.62 - (0.36 * k) / Math.max(1, n - 1))} fillRule="evenodd" />
                                        </g>
                                    </g>
                                ) : null,
                            )}
                            {/* The opening's lip on the ice. */}
                            {rings.fewer[0]?.length ? <path d={face(rings.fewer[0], 0)} fill="none" stroke={rgba(FEWER, 0.45)} strokeWidth={0.8} clipPath={`url(#dn${id}-0)`} /> : null}
                        </g>
                    ) : null}
                    <RinkNet f={f} />
                    {rings ? (
                        <g opacity={thin ? 0.6 : 1}>
                            {/* Plateaus, low to high: translucent walls and tops, so the net shows through. */}
                            {rings.more.map((rs, k) =>
                                rs.length ? (
                                    <g key={`m${k}`} clipPath={`url(#up${id}-${k + 1})`}>
                                        <path d={walls(rs, k * RISE, (k + 1) * RISE)} fill={rgba([184, 100, 42], 0.34)} />
                                        <path d={face(rs, (k + 1) * RISE)} fill={rgba(MORE, 0.2 + (0.1 * k) / Math.max(1, n - 1))} stroke={rgba(MORE, 0.5)} strokeWidth={0.6} fillRule="evenodd" />
                                    </g>
                                ) : null,
                            )}
                        </g>
                    ) : null}
                    {!codes ? (
                        <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-fg-3 text-micro uppercase tracking-label">
                            No time
                        </text>
                    ) : null}
                </svg>
            ) : (
                <div className="aspect-[4/3] w-full" />
            )}
        </div>
    );
}
