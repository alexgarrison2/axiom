'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { ReliabilityBin, RollingPoint, Tier } from './report';

/* Neon on the dark grid: cyan = the model, white dashed = the market,
   magenta diamond = what the model expected. Text is 11px mono. */
const GRID = 'rgb(var(--line-rgb))';
const TICK = 'rgb(var(--text-3-rgb))';
const MODEL = 'rgb(var(--brand-rgb))';
const MARKET = 'rgb(var(--text-1-rgb))';
const FONT = { fontSize: 11, fontFamily: 'var(--font-body)', letterSpacing: '0.04em' } as const;

/** Render SVG charts at their real pixel width so 11px text stays 11px on phones. */
function useWidth(fallback = 480): [(el: HTMLDivElement | null) => void, number] {
    // A callback ref: the measured box can mount later (after an empty state).
    const [el, setEl] = React.useState<HTMLDivElement | null>(null);
    const [w, setW] = React.useState(fallback);
    React.useEffect(() => {
        if (!el) return;
        const set = () => setW(Math.max(280, Math.round(el.clientWidth)));
        set();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(set);
        ro.observe(el);
        return () => ro.disconnect();
    }, [el]);
    return [setEl, w];
}

/** Soft neon glow for model lines (id must be unique per chart). */
function Glow({ id, blur = 3 }: { id: string; blur?: number }) {
    return (
        <defs>
            <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation={blur} result="b" />
                <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                </feMerge>
            </filter>
        </defs>
    );
}

function Tip({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={cn('pointer-events-none absolute rounded-chip border border-line-strong bg-bg/95 px-2 py-1 text-micro text-fg-1', className)}>{children}</div>
    );
}

/* ── Reliability diagram ─────────────────────────────────────────────── */

export function ReliabilityChart({ bins }: { bins: ReliabilityBin[] }) {
    const [boxRef, w] = useWidth(360);
    const glow = React.useId().replace(/:/g, '');
    const pts = bins.filter(b => b.n > 0 && b.meanPred != null && b.actual != null).sort((a, b) => a.meanPred! - b.meanPred!);
    const h = 220;
    const pad = { l: 30, r: 10, t: 8, b: 24 };
    const x = (v: number) => pad.l + v * (w - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - v) * (h - pad.t - pad.b);
    const maxN = Math.max(1, ...pts.map(p => p.n));
    const [hover, setHover] = React.useState<ReliabilityBin | null>(null);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.meanPred!).toFixed(1)},${y(p.actual!).toFixed(1)}`).join('');
    return (
        <figure className="flex flex-col gap-1.5">
            <div className="relative" ref={boxRef}>
                <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="block" role="img" aria-label="Calibration: predicted versus actual home win rate by probability bin">
                    <Glow id={glow} />
                    {[0, 0.25, 0.5, 0.75, 1].map(v => (
                        <g key={v}>
                            <line x1={x(0)} x2={x(1)} y1={y(v)} y2={y(v)} stroke={GRID} />
                            <line x1={x(v)} x2={x(v)} y1={y(0)} y2={y(1)} stroke={GRID} />
                            <text x={x(0) - 6} y={y(v) + 4} textAnchor="end" fill={TICK} {...FONT}>
                                {Math.round(v * 100)}
                            </text>
                            <text x={x(v)} y={y(0) + 16} textAnchor={v === 0 ? 'start' : v === 1 ? 'end' : 'middle'} fill={TICK} {...FONT}>
                                {Math.round(v * 100)}
                            </text>
                        </g>
                    ))}
                    <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke={TICK} strokeOpacity="0.6" strokeDasharray="3 5" />
                    {pts.length > 1 ? <path d={d} fill="none" stroke={MODEL} strokeWidth="1.5" strokeOpacity="0.8" filter={`url(#${glow})`} /> : null}
                    {pts.map(p => {
                        const r = 3 + 6 * Math.sqrt(p.n / maxN);
                        return (
                            <g key={p.lo} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} className="cursor-crosshair">
                                <circle cx={x(p.meanPred!)} cy={y(p.actual!)} r={r + 8} fill="transparent" />
                                <circle cx={x(p.meanPred!)} cy={y(p.actual!)} r={r} fill={MODEL} fillOpacity="0.9" stroke="rgb(var(--bg-rgb))" strokeWidth="1.5" filter={`url(#${glow})`} />
                            </g>
                        );
                    })}
                </svg>
                {hover ? (
                    <Tip className="left-10 top-1">
                        {Math.round(hover.lo * 100)}–{Math.round(hover.hi * 100)} · pred {((hover.meanPred ?? 0) * 100).toFixed(1)} · won {((hover.actual ?? 0) * 100).toFixed(1)} · n={hover.n}
                    </Tip>
                ) : null}
            </div>
            <figcaption className="flex justify-between text-micro uppercase tracking-[0.12em] text-fg-3">
                <span>↑ Won %</span>
                <span>Predicted % →</span>
            </figcaption>
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
        <div className="flex flex-col gap-1.5">
            <ul className="flex flex-col">
                {tiers.map(t => (
                    <li key={t.tier} className="grid h-8 grid-cols-[4.25rem_minmax(0,1fr)_5.5rem] items-center gap-3 border-t border-line/60 text-caption first:border-t-0">
                        <span className="font-semibold text-fg-1">
                            {t.tier.endsWith('+') ? `${t.tier.slice(0, -1)}+` : t.tier.replace('-', '–')}
                            <span className="ml-1.5 font-normal text-fg-3">
                                <span className="sr-only">games: </span>
                                {t.n}
                            </span>
                        </span>
                        <span className="relative h-2 rounded-full bg-track" aria-hidden="true">
                            {t.accuracy != null ? <span className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand/35 to-brand" style={{ width: x(t.accuracy) }} /> : null}
                            {t.ci ? <span className="absolute top-1/2 h-px -translate-y-1/2 bg-fg-1/70" style={{ left: x(t.ci[0]), width: `calc(${x(t.ci[1])} - ${x(t.ci[0])})` }} /> : null}
                            {t.meanConfidence != null ? (
                                <span className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-model shadow-[0_0_8px_rgb(var(--model-rgb)/0.6)]" style={{ left: x(t.meanConfidence) }} />
                            ) : null}
                        </span>
                        <span className="text-right">
                            <span className="font-bold text-fg-1">{t.accuracy != null ? `${(t.accuracy * 100).toFixed(0)}%` : '—'}</span>
                            {t.meanConfidence != null ? (
                                <span className="ml-2 text-model">
                                    <span aria-hidden="true">◆</span>
                                    <span className="sr-only">expected </span>
                                    {(t.meanConfidence * 100).toFixed(0)}
                                </span>
                            ) : null}
                            {t.ci ? (
                                <span className="sr-only">
                                    , 95% interval {(t.ci[0] * 100).toFixed(0)} to {(t.ci[1] * 100).toFixed(0)}%
                                </span>
                            ) : null}
                        </span>
                    </li>
                ))}
            </ul>
            <p aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1 text-micro uppercase tracking-[0.12em] text-fg-3">
                <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-4 rounded-full bg-brand" /> Won
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="text-model">◆</span> Model
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-px w-4 bg-fg-1/70" /> 95% CI
                </span>
            </p>
        </div>
    );
}

/* ── Rolling log loss: model vs market ───────────────────────────────── */

export function RollingChart({ points }: { points: RollingPoint[] }) {
    const [boxRef, w] = useWidth();
    const glow = React.useId().replace(/:/g, '');
    const h = 200;
    const pad = { l: 44, r: 10, t: 8, b: 22 };
    const [hover, setHover] = React.useState<number | null>(null);
    if (points.length < 2) return <p className="label">Needs 100 games</p>;
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
        <figure className="flex flex-col gap-1.5">
            <div className="relative" ref={boxRef}>
                <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="block" role="img" aria-label={`Rolling 100-game log loss. Latest: model ${last.model.toFixed(3)}, market ${last.market.toFixed(3)}. Lower is better.`}>
                    <Glow id={glow} blur={1.5} />
                    {ticks.map(t => (
                        <g key={t}>
                            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} />
                            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fill={TICK} {...FONT}>
                                {t.toFixed(3)}
                            </text>
                        </g>
                    ))}
                    <path d={line('market')} fill="none" stroke={MARKET} strokeOpacity="0.7" strokeWidth="1.25" strokeDasharray="4 4" />
                    <path d={line('model')} fill="none" stroke={MODEL} strokeWidth="2" filter={`url(#${glow})`} />
                    <text x={pad.l} y={h - 5} fill={TICK} {...FONT}>
                        {points[0].date}
                    </text>
                    <text x={w - pad.r} y={h - 5} fill={TICK} textAnchor="end" {...FONT}>
                        {last.date}
                    </text>
                    {hp ? (
                        <g>
                            <line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={h - pad.b} stroke={TICK} strokeOpacity="0.6" />
                            <circle cx={x(hover!)} cy={y(hp.model)} r="3.5" fill={MODEL} />
                            <circle cx={x(hover!)} cy={y(hp.market)} r="3.5" fill={MARKET} />
                        </g>
                    ) : null}
                    <rect x={pad.l} y={pad.t} width={w - pad.l - pad.r} height={h - pad.t - pad.b} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
                </svg>
                {hp ? (
                    <Tip className="right-2 top-1">
                        {hp.date} · model {hp.model.toFixed(4)} · mkt {hp.market.toFixed(4)}
                    </Tip>
                ) : null}
            </div>
            <figcaption aria-hidden="true" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-micro uppercase tracking-[0.12em] text-fg-3">
                <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-4 bg-brand" /> Model
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-4 border-t border-dashed border-fg-1" /> Market
                </span>
                <span>100-game · ↓ better</span>
            </figcaption>
        </figure>
    );
}

/* ── Cumulative units ───────────────────────────────────────────────── */

export function UnitsChart({ points, className }: { points: { date: string; units: number }[]; className?: string }) {
    const [boxRef, w] = useWidth();
    const glow = React.useId().replace(/:/g, '');
    const grad = `${glow}-g`;
    const h = 180;
    const pad = { l: 36, r: 10, t: 8, b: 22 };
    const [hover, setHover] = React.useState<number | null>(null);
    if (points.length < 2) return null;
    const vals = [0, ...points.map(p => p.units)];
    const lo = Math.floor(Math.min(...vals)) - 1;
    const hi = Math.ceil(Math.max(...vals)) + 1;
    const x = (i: number) => pad.l + (i / (points.length - 1)) * (w - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.units).toFixed(1)}`).join('');
    const area = `${d}L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
    const last = points[points.length - 1];
    const hp = hover != null ? points[hover] : null;
    const step = Math.max(1, Math.ceil((hi - lo) / 5));
    const ticks: number[] = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
    return (
        <figure className={cn('flex flex-col gap-2', className)}>
            <div className="relative" ref={boxRef}>
                <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="block" role="img" aria-label={`Cumulative units over ${points.length} bets, ending at ${last.units >= 0 ? '+' : ''}${last.units.toFixed(2)} units`}>
                    <Glow id={glow} blur={1.5} />
                    <defs>
                        <linearGradient id={grad} x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor={MODEL} stopOpacity="0.22" />
                            <stop offset="100%" stopColor={MODEL} stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    {ticks.map(t => (
                        <g key={t}>
                            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? TICK : GRID} strokeOpacity={t === 0 ? 0.6 : 1} />
                            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fill={TICK} {...FONT}>
                                {t > 0 ? `+${t}` : t}
                            </text>
                        </g>
                    ))}
                    <path d={area} fill={`url(#${grad})`} />
                    <path d={d} fill="none" stroke={MODEL} strokeWidth="2" strokeLinejoin="round" filter={`url(#${glow})`} />
                    <text x={pad.l} y={h - 5} fill={TICK} {...FONT}>
                        {points[0].date}
                    </text>
                    <text x={w - pad.r} y={h - 5} fill={TICK} textAnchor="end" {...FONT}>
                        {last.date}
                    </text>
                    {hp ? (
                        <g>
                            <line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={h - pad.b} stroke={TICK} strokeOpacity="0.6" />
                            <circle cx={x(hover!)} cy={y(hp.units)} r="3.5" fill={MODEL} />
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
                    <Tip className="right-2 top-1">
                        #{hover! + 1} · {hp.date} · {hp.units >= 0 ? '+' : '−'}
                        {Math.abs(hp.units).toFixed(2)}u
                    </Tip>
                ) : null}
            </div>
        </figure>
    );
}
