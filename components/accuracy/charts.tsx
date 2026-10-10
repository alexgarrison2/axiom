'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { ReliabilityBin, RollingPoint, Tier } from './report';
import { fmtInt } from '@/components/views/format';

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
        const set = () => setW(Math.max(200, Math.round(el.clientWidth)));
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

/**
 * Readout state for a chart. A mouse hovers as before. A finger pins a readout with a tap (tap the
 * same spot again, anywhere else, or scroll the page to clear it) or scrubs once a sideways drag
 * has started; a vertical swipe that starts on the chart just scrolls.
 */
interface Gesture {
    /** Pointer down on the chart: remembers whether it is a finger and where a touch started. */
    down: (e: { pointerType: string; clientX: number; clientY: number }) => void;
    /** Pointer move: true when the readout should follow (a mouse, or a touch that has become a sideways scrub). */
    follows: (e: { pointerType: string; clientX: number; clientY: number }) => boolean;
    /** The browser took the touch (a scroll). */
    cancel: () => void;
    /** Click: true for a finger tap that was not the end of a scrub. */
    tapped: () => boolean;
}

function useReadout<T>() {
    const [value, set] = React.useState<T | null>(null);
    const box = React.useRef<SVGSVGElement>(null);
    const finger = React.useRef(false);
    const drag = React.useRef<{ x: number; y: number; scrub: boolean } | null>(null);
    React.useEffect(() => {
        if (value == null || !finger.current) return;
        const off = (e: PointerEvent) => {
            if (!box.current?.contains(e.target as Node)) set(null);
        };
        const scrolled = () => set(null);
        document.addEventListener('pointerdown', off);
        window.addEventListener('scroll', scrolled, { passive: true });
        return () => {
            document.removeEventListener('pointerdown', off);
            window.removeEventListener('scroll', scrolled);
        };
    }, [value]);
    const gesture = React.useMemo<Gesture>(
        () => ({
            down: e => {
                finger.current = e.pointerType !== 'mouse';
                drag.current = finger.current ? { x: e.clientX, y: e.clientY, scrub: false } : null;
            },
            follows: e => {
                if (e.pointerType === 'mouse') return true;
                const d = drag.current;
                if (!d) return false;
                if (!d.scrub) {
                    const dx = Math.abs(e.clientX - d.x);
                    if (dx < 8 || dx <= Math.abs(e.clientY - d.y)) return false;
                    d.scrub = true;
                }
                return true;
            },
            cancel: () => {
                drag.current = null;
            },
            tapped: () => {
                const scrubbed = drag.current?.scrub;
                drag.current = null;
                return finger.current && !scrubbed;
            },
        }),
        [],
    );
    return [value, set, box, gesture] as const;
}

/** Pointer handlers for a scrub area over `count` evenly spaced points across the plot (`l`/`r` padding of a `w`-wide chart). */
function scrubHandlers(count: number, plot: { l: number; r: number; w: number }, value: number | null, set: (i: number | null) => void, g: Gesture) {
    const at = (e: React.PointerEvent<SVGRectElement> | React.MouseEvent<SVGRectElement>) => {
        const box = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
        const frac = (((e.clientX - box.left) / box.width) * plot.w - plot.l) / (plot.w - plot.l - plot.r);
        return Math.max(0, Math.min(count - 1, Math.round(frac * (count - 1))));
    };
    return {
        onPointerDown: (e: React.PointerEvent<SVGRectElement>) => g.down(e),
        onPointerMove: (e: React.PointerEvent<SVGRectElement>) => {
            if (g.follows(e)) set(at(e));
        },
        onPointerCancel: () => g.cancel(),
        onClick: (e: React.MouseEvent<SVGRectElement>) => {
            if (!g.tapped()) return;
            const i = at(e);
            set(i === value ? null : i);
        },
        onPointerLeave: (e: React.PointerEvent<SVGRectElement>) => {
            if (e.pointerType === 'mouse') set(null);
        },
    };
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
    const [hover, setHover, svgRef, gesture] = useReadout<ReliabilityBin>();
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.meanPred!).toFixed(1)},${y(p.actual!).toFixed(1)}`).join('');
    // A finger tap picks the nearest dot anywhere on the plot (the dots are small); tapping it again clears it.
    const onTap = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!gesture.tapped() || !pts.length) return;
        const r = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * w;
        const py = ((e.clientY - r.top) / r.height) * h;
        let best = pts[0];
        for (const p of pts) if (Math.hypot(x(p.meanPred!) - px, y(p.actual!) - py) < Math.hypot(x(best.meanPred!) - px, y(best.actual!) - py)) best = p;
        setHover(best === hover ? null : best);
    };
    return (
        <figure className="flex flex-col gap-1.5">
            <div className="relative" ref={boxRef}>
                <svg
                    ref={svgRef}
                    viewBox={`0 0 ${w} ${h}`}
                    width={w}
                    height={h}
                    className="block"
                    role="img"
                    aria-label="Calibration: predicted versus actual home win rate by probability bin"
                    onPointerDown={e => gesture.down(e)}
                    onPointerCancel={() => gesture.cancel()}
                    onClick={onTap}
                >
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
                            <g
                                key={p.lo}
                                onPointerEnter={e => e.pointerType === 'mouse' && setHover(p)}
                                onPointerLeave={e => e.pointerType === 'mouse' && setHover(null)}
                                className="cursor-crosshair"
                            >
                                <circle cx={x(p.meanPred!)} cy={y(p.actual!)} r={r + 8} fill="transparent" />
                                <circle cx={x(p.meanPred!)} cy={y(p.actual!)} r={r} fill={MODEL} fillOpacity="0.9" stroke="rgb(var(--bg-rgb))" strokeWidth="1.5" filter={`url(#${glow})`} />
                            </g>
                        );
                    })}
                </svg>
                {hover ? (
                    <Tip className="left-10 top-1">
                        {Math.round(hover.lo * 100)}–{Math.round(hover.hi * 100)} · pred {((hover.meanPred ?? 0) * 100).toFixed(1)} · won {((hover.actual ?? 0) * 100).toFixed(1)} · n={fmtInt(hover.n)}
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
                            <td>{fmtInt(p.n)}</td>
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
                                {fmtInt(t.n)}
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
    const [hover, setHover, svgRef, gesture] = useReadout<number>();
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
    return (
        <figure className="flex flex-col gap-1.5">
            <div className="relative" ref={boxRef}>
                <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="block touch-pan-y" role="img" aria-label={`Rolling 100-game log loss. Latest: model ${last.model.toFixed(3)}, market ${last.market.toFixed(3)}. Lower is better.`}>
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
                    {/* The hit area runs past both ends of the plot so the first and newest points are easy to reach. */}
                    <rect x={pad.l - 10} y={pad.t} width={w - pad.l + 10} height={h - pad.t - pad.b} fill="transparent" {...scrubHandlers(points.length, { l: pad.l, r: pad.r, w }, hover, setHover, gesture)} />
                </svg>
                {hp ? (
                    <Tip className={cn('right-2 top-1', hover! > (points.length - 1) / 2 && 'coarse:left-12 coarse:right-auto')}>
                        {hp.date}
                        <span className="coarse:hidden"> · </span>
                        <span className="coarse:block">
                            model {hp.model.toFixed(4)} · mkt {hp.market.toFixed(4)}
                        </span>
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
    const [hover, setHover, svgRef, gesture] = useReadout<number>();
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
                <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="block touch-pan-y" role="img" aria-label={`Cumulative units over ${fmtInt(points.length)} bets, ending at ${last.units >= 0 ? '+' : ''}${last.units.toFixed(2)} units`}>
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
                        x={pad.l - 10}
                        y={pad.t}
                        width={w - pad.l + 10}
                        height={h - pad.t - pad.b}
                        fill="transparent"
                        {...scrubHandlers(points.length, { l: pad.l, r: pad.r, w }, hover, setHover, gesture)}
                    />
                </svg>
                {hp ? (
                    <Tip className={cn('right-2 top-1', hover! > (points.length - 1) / 2 && 'coarse:left-10 coarse:right-auto')}>
                        #{hover! + 1} · {hp.date} · {hp.units >= 0 ? '+' : '−'}
                        {Math.abs(hp.units).toFixed(2)}u
                    </Tip>
                ) : null}
            </div>
        </figure>
    );
}
