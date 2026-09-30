'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { ReliabilityBin, RollingPoint, Tier } from './report';

const AXIS = 'rgb(var(--text-3-rgb))';
const INK2 = 'rgb(var(--text-2-rgb))';
const BRAND = 'rgb(var(--brand-rgb))';
const MARKET = 'rgb(var(--warn-rgb))';

/** Render SVG charts at their real pixel width so 12px text stays 12px on phones. */
function useWidth(fallback = 640): [React.RefObject<HTMLDivElement | null>, number] {
    const ref = React.useRef<HTMLDivElement | null>(null);
    const [w, setW] = React.useState(fallback);
    React.useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const set = () => setW(Math.max(300, Math.round(el.clientWidth)));
        set();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(set);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, w];
}

/* ── Reliability diagram ─────────────────────────────────────────────── */

export function ReliabilityChart({ bins }: { bins: ReliabilityBin[] }) {
    const pts = bins.filter(b => b.n > 0 && b.meanPred != null && b.actual != null);
    const size = 280;
    const pad = { l: 40, r: 12, t: 12, b: 36 };
    const w = size + pad.l + pad.r;
    const h = size + pad.t + pad.b;
    const x = (v: number) => pad.l + v * size;
    const y = (v: number) => pad.t + (1 - v) * size;
    const maxN = Math.max(1, ...pts.map(p => p.n));
    const [hover, setHover] = React.useState<ReliabilityBin | null>(null);
    return (
        <figure className="flex flex-col gap-2">
            <div className="relative">
                <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-[22rem]" role="img" aria-label="Reliability diagram: predicted versus actual home win rate by probability bin">
                    {[0, 0.25, 0.5, 0.75, 1].map(v => (
                        <g key={v}>
                            <line x1={x(0)} x2={x(1)} y1={y(v)} y2={y(v)} stroke={AXIS} strokeOpacity="0.2" />
                            <line x1={x(v)} x2={x(v)} y1={y(0)} y2={y(1)} stroke={AXIS} strokeOpacity="0.2" />
                            <text x={x(0) - 8} y={y(v) + 4} textAnchor="end" fontSize="12" fill={INK2}>
                                {Math.round(v * 100)}
                            </text>
                            <text x={x(v)} y={y(0) + 18} textAnchor="middle" fontSize="12" fill={INK2}>
                                {Math.round(v * 100)}
                            </text>
                        </g>
                    ))}
                    <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke={AXIS} strokeDasharray="4 5" strokeWidth="1.5" />
                    <text x={x(0.97)} y={y(0.97) + 16} textAnchor="end" fontSize="11" fill={INK2}>
                        perfect calibration
                    </text>
                    {pts.map(p => {
                        const r = 4 + 8 * Math.sqrt(p.n / maxN);
                        return (
                            <g key={p.lo} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} className="cursor-crosshair">
                                <circle cx={x(p.meanPred!)} cy={y(p.actual!)} r={r + 8} fill="transparent" />
                                <circle cx={x(p.meanPred!)} cy={y(p.actual!)} r={r} fill={BRAND} fillOpacity="0.85" stroke="rgb(var(--surface-1-rgb))" strokeWidth="2" />
                            </g>
                        );
                    })}
                    <text x={x(0.5)} y={h - 2} textAnchor="middle" fontSize="12" fill={INK2}>
                        Predicted home win %
                    </text>
                    <text x={10} y={y(0.5)} textAnchor="middle" fontSize="12" fill={INK2} transform={`rotate(-90 10 ${y(0.5)})`}>
                        Actual %
                    </text>
                </svg>
                {hover ? (
                    <div className="pointer-events-none absolute left-12 top-2 rounded-control border border-line-strong bg-surface-3/95 px-2.5 py-1.5 text-caption text-fg-1 shadow-card">
                        {Math.round(hover.lo * 100)}–{Math.round(hover.hi * 100)}% bin · predicted {((hover.meanPred ?? 0) * 100).toFixed(1)}% · won{' '}
                        {((hover.actual ?? 0) * 100).toFixed(1)}% · n={hover.n}
                    </div>
                ) : null}
            </div>
            <figcaption className="text-caption text-fg-3">Dot size = games in the bin. Dots on the dashed line mean the probabilities are honest.</figcaption>
            <table className="sr-only">
                <caption>Reliability bins</caption>
                <thead>
                    <tr>
                        <th scope="col">Bin</th>
                        <th scope="col">Games</th>
                        <th scope="col">Predicted</th>
                        <th scope="col">Actual</th>
                    </tr>
                </thead>
                <tbody>
                    {pts.map(p => (
                        <tr key={p.lo}>
                            <td>
                                {Math.round(p.lo * 100)}–{Math.round(p.hi * 100)}%
                            </td>
                            <td>{p.n}</td>
                            <td>{((p.meanPred ?? 0) * 100).toFixed(1)}%</td>
                            <td>{((p.actual ?? 0) * 100).toFixed(1)}%</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </figure>
    );
}

/* ── Accuracy by confidence tier ─────────────────────────────────────── */

export function TierBars({ tiers }: { tiers: Tier[] }) {
    const lo = 0.3;
    const hi = 0.9;
    const x = (v: number) => `${((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100}%`;
    return (
        <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-3">
                {tiers.map(t => (
                    <li key={t.tier} className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
                        <span className="text-body-sm font-semibold text-fg-1">
                            {t.tier.endsWith('+') ? `${t.tier.slice(0, -1)}%+` : `${t.tier.replace('-', '–')}%`}<span className="block text-micro font-normal text-fg-3">n={t.n}</span>
                        </span>
                        <span className="flex flex-col gap-1">
                            <span className="relative h-3 rounded-full bg-fg-3/15" aria-hidden="true">
                                {t.accuracy != null ? <span className="absolute inset-y-0 left-0 rounded-full bg-brand/70" style={{ width: x(t.accuracy) }} /> : null}
                                {t.ci ? (
                                    <span className="absolute top-1/2 h-px -translate-y-1/2 bg-fg-1" style={{ left: x(t.ci[0]), width: `calc(${x(t.ci[1])} - ${x(t.ci[0])})` }} />
                                ) : null}
                                {t.meanConfidence != null ? (
                                    <span className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-warn" style={{ left: x(t.meanConfidence) }} />
                                ) : null}
                            </span>
                            <span className="text-caption text-fg-2">
                                Won <span className="font-semibold text-fg-1">{t.accuracy != null ? `${(t.accuracy * 100).toFixed(0)}%` : '—'}</span>
                                {t.meanConfidence != null ? <> · expected {(t.meanConfidence * 100).toFixed(0)}%</> : null}
                                {t.ci ? (
                                    <span className="text-fg-3">
                                        {' '}
                                        · 95% CI {(t.ci[0] * 100).toFixed(0)}–{(t.ci[1] * 100).toFixed(0)}%
                                    </span>
                                ) : null}
                            </span>
                        </span>
                    </li>
                ))}
            </ul>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-fg-3">
                <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2 w-4 rounded-full bg-brand/70" /> actual hit rate
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-3 w-0.5 rounded-full bg-warn" /> what the model expected
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-px w-4 bg-fg-1" /> 95% interval
                </span>
            </p>
        </div>
    );
}

/* ── Rolling log loss: model vs market ───────────────────────────────── */

export function RollingChart({ points }: { points: RollingPoint[] }) {
    const [boxRef, w] = useWidth();
    const h = 220;
    const pad = { l: 44, r: 64, t: 12, b: 28 };
    const [hover, setHover] = React.useState<number | null>(null);
    if (points.length < 2) return <p className="text-body-sm text-fg-3">Needs at least 100 live games with market prices.</p>;
    const vals = points.flatMap(p => [p.model, p.market]);
    const lo = Math.floor(Math.min(...vals) * 100) / 100 - 0.005;
    const hi = Math.ceil(Math.max(...vals) * 100) / 100 + 0.005;
    const x = (i: number) => pad.l + (i / (points.length - 1)) * (w - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
    const line = (k: 'model' | 'market') => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
    const ticks = [lo + 0.005, (lo + hi) / 2, hi - 0.005];
    const last = points[points.length - 1];
    const hp = hover != null ? points[hover] : null;
    const onMove = (e: React.PointerEvent<SVGRectElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const frac = (e.clientX - rect.left) / rect.width;
        setHover(Math.max(0, Math.min(points.length - 1, Math.round(frac * (points.length - 1)))));
    };
    return (
        <figure className="flex flex-col gap-2">
            <div className="relative" ref={boxRef}>
                <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="block" role="img" aria-label={`Rolling 100-game log loss. Latest: model ${last.model.toFixed(3)}, market ${last.market.toFixed(3)}. Lower is better.`}>
                    {ticks.map(t => (
                        <g key={t}>
                            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke={AXIS} strokeOpacity="0.2" />
                            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill={INK2}>
                                {t.toFixed(3)}
                            </text>
                        </g>
                    ))}
                    <path d={line('market')} fill="none" stroke={MARKET} strokeWidth="2" strokeDasharray="6 4" />
                    <path d={line('model')} fill="none" stroke={BRAND} strokeWidth="2" />
                    <text x={x(points.length - 1) + 6} y={y(last.model) + 4} fontSize="12" fill={INK2}>
                        Model
                    </text>
                    <text x={x(points.length - 1) + 6} y={y(last.market) + (last.market > last.model ? -6 : 14)} fontSize="12" fill={INK2}>
                        Market
                    </text>
                    <text x={pad.l} y={h - 6} fontSize="12" fill={INK2}>
                        {points[0].date}
                    </text>
                    <text x={w - pad.r} y={h - 6} fontSize="12" fill={INK2} textAnchor="end">
                        {last.date}
                    </text>
                    {hp ? (
                        <g>
                            <line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={h - pad.b} stroke={AXIS} strokeOpacity="0.6" />
                            <circle cx={x(hover!)} cy={y(hp.model)} r="4" fill={BRAND} stroke="rgb(var(--surface-1-rgb))" strokeWidth="2" />
                            <circle cx={x(hover!)} cy={y(hp.market)} r="4" fill={MARKET} stroke="rgb(var(--surface-1-rgb))" strokeWidth="2" />
                        </g>
                    ) : null}
                    <rect x={pad.l} y={pad.t} width={w - pad.l - pad.r} height={h - pad.t - pad.b} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
                </svg>
                {hp ? (
                    <div className="pointer-events-none absolute right-2 top-2 rounded-control border border-line-strong bg-surface-3/95 px-2.5 py-1.5 text-caption text-fg-1 shadow-card">
                        {hp.date} · model {hp.model.toFixed(4)} · market {hp.market.toFixed(4)}
                    </div>
                ) : null}
            </div>
            <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-fg-3">
                <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-5 bg-brand" /> Pony xG model
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-5 border-t-2 border-dashed border-warn" /> Betting market (de-vigged)
                </span>
                <span>Log loss over the previous 100 games. Lower is better.</span>
            </figcaption>
        </figure>
    );
}

/* ── Cumulative units ───────────────────────────────────────────────── */

export function UnitsChart({ points, className }: { points: { date: string; units: number }[]; className?: string }) {
    const [boxRef, w] = useWidth();
    const h = 200;
    const pad = { l: 44, r: 16, t: 12, b: 28 };
    const [hover, setHover] = React.useState<number | null>(null);
    if (points.length < 2) return null;
    const vals = [0, ...points.map(p => p.units)];
    const lo = Math.floor(Math.min(...vals)) - 1;
    const hi = Math.ceil(Math.max(...vals)) + 1;
    const x = (i: number) => pad.l + (i / (points.length - 1)) * (w - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.units).toFixed(1)}`).join('');
    const last = points[points.length - 1];
    const hp = hover != null ? points[hover] : null;
    const step = Math.max(1, Math.ceil((hi - lo) / 5));
    const ticks: number[] = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
    return (
        <figure className={cn('flex flex-col gap-2', className)}>
            <div className="relative" ref={boxRef}>
                <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="block" role="img" aria-label={`Cumulative units over ${points.length} bets, ending at ${last.units >= 0 ? '+' : ''}${last.units.toFixed(2)} units`}>
                    {ticks.map(t => (
                        <g key={t}>
                            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke={AXIS} strokeOpacity={t === 0 ? 0.7 : 0.18} />
                            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill={INK2}>
                                {t > 0 ? `+${t}` : t}
                            </text>
                        </g>
                    ))}
                    <path d={d} fill="none" stroke={BRAND} strokeWidth="2" strokeLinejoin="round" />
                    <text x={pad.l} y={h - 6} fontSize="12" fill={INK2}>
                        {points[0].date}
                    </text>
                    <text x={w - pad.r} y={h - 6} fontSize="12" fill={INK2} textAnchor="end">
                        {last.date}
                    </text>
                    {hp ? (
                        <g>
                            <line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={h - pad.b} stroke={AXIS} strokeOpacity="0.6" />
                            <circle cx={x(hover!)} cy={y(hp.units)} r="4" fill={BRAND} stroke="rgb(var(--surface-1-rgb))" strokeWidth="2" />
                        </g>
                    ) : null}
                    <rect
                        x={pad.l}
                        y={pad.t}
                        width={w - pad.l - pad.r}
                        height={h - pad.t - pad.b}
                        fill="transparent"
                        onPointerMove={e => {
                            const r = e.currentTarget.getBoundingClientRect();
                            setHover(Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left) / r.width) * (points.length - 1)))));
                        }}
                        onPointerLeave={() => setHover(null)}
                    />
                </svg>
                {hp ? (
                    <div className="pointer-events-none absolute right-2 top-2 rounded-control border border-line-strong bg-surface-3/95 px-2.5 py-1.5 text-caption text-fg-1 shadow-card">
                        Bet {hover! + 1} · {hp.date} · {hp.units >= 0 ? '+' : '−'}
                        {Math.abs(hp.units).toFixed(2)}u
                    </div>
                ) : null}
            </div>
        </figure>
    );
}
