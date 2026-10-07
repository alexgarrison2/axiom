'use client';

import * as React from 'react';
import Link from 'next/link';
import { useWidth } from '@/components/game/Pulse';
import { cn } from '@/lib/utils';
import { equalScale, minApart, placeLabels, rates, ticks, type Box, type LabelIn, type WowyMate, type WowyPlayer } from '@/lib/players/wowy';

/**
 * With or without you, after HockeyViz: for each of his most-used 5v5
 * teammates three points on raw rates (xGF/60 across, xGA/60 down with less
 * against at the top): together (cyan dot), him without the teammate (amber ring)
 * and the teammate without him (magenta diamond), each apart point joined to
 * the together point by a faint line in its colour; his overall mark is the
 * +. Faint diagonals are equal xG differential.
 * Hover or tap a teammate for the numbers; tap again or elsewhere to close.
 * On a phone the card sits under the chart, in flow.
 */

const R = 4.5;
const mins = (s: number) => Math.round(s / 60);
const f2 = (v: number) => v.toFixed(2);

/** Text width in px for the chart's font (canvas), with a condensed-face estimate as fallback. */
function useMeasure(el: React.RefObject<HTMLElement | null>) {
    const ctx = React.useRef<CanvasRenderingContext2D | null>(null);
    return React.useCallback(
        (text: string, px: number, weight = 500) => {
            if (typeof document !== 'undefined') {
                if (!ctx.current) ctx.current = document.createElement('canvas').getContext('2d');
                const c = ctx.current;
                if (c && el.current) {
                    c.font = `${weight} ${px}px ${getComputedStyle(el.current).fontFamily}`;
                    return Math.ceil(c.measureText(text).width);
                }
            }
            return Math.ceil(text.length * px * 0.5);
        },
        [el],
    );
}

function Glyph({ kind, x, y, r = R, className, strokeWidth = 1.5 }: { kind: 'with' | 'him' | 'mate'; x: number; y: number; r?: number; className?: string; strokeWidth?: number }) {
    if (kind === 'with') return <circle cx={x} cy={y} r={r} className={className} />;
    if (kind === 'him') return <circle cx={x} cy={y} r={r - 0.5} fill="none" strokeWidth={strokeWidth} className={className} />;
    const d = r + 0.5;
    return <path d={`M${x},${y - d}L${x + d},${y}L${x},${y + d}L${x - d},${y}Z`} fill="none" strokeWidth={strokeWidth} strokeLinejoin="round" className={className} />;
}

/** A 12px legend swatch of one point kind. */
function Swatch({ kind }: { kind: 'with' | 'him' | 'mate' }) {
    return (
        <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden="true" className="shrink-0">
            <Glyph kind={kind} x={6} y={6} r={4} className={kind === 'with' ? 'fill-brand' : kind === 'him' ? 'stroke-amber' : 'stroke-model'} />
        </svg>
    );
}

export function Wowy({ data, first, last, gp, prior, seasonTag }: { data: WowyPlayer; first: string; last: string; gp: number; prior: boolean; seasonTag: string }) {
    const [ref, width] = useWidth<HTMLDivElement>();
    const measure = useMeasure(ref);
    const [teamAt, setTeamAt] = React.useState(0);
    const [hover, setHover] = React.useState<number | null>(null);
    const [sel, setSel] = React.useState<number | null>(null);
    const [vh, setVh] = React.useState(900);
    const cardRef = React.useRef<HTMLDivElement>(null);
    const [cardH, setCardH] = React.useState(132);
    React.useEffect(() => {
        const on = () => setVh(window.innerHeight);
        on();
        window.addEventListener('resize', on);
        return () => window.removeEventListener('resize', on);
    }, []);

    const team = data.teams[Math.min(teamAt, data.teams.length - 1)];
    const W = Math.max(width, 280);
    const compact = W < 480;
    const mates = team.mates.slice(0, compact ? 6 : 8);
    const apartMin = minApart(data.minToi);
    const H = Math.round(Math.min(Math.max(W * (compact ? 0.86 : 0.62), 250), 470, Math.max(250, vh - 150)));
    const padL = 34;
    const padR = 10;
    const padT = 22;
    const padB = 30;
    const pw = W - padL - padR;
    const ph = H - padT - padB;

    const hub = rates(team.all);
    const pts = mates.map(m => ({ m, w: rates(m.together), h: rates(m.him, apartMin), o: rates(m.mate, apartMin) }));
    const all = [...(hub ? [hub] : []), ...pts.flatMap(p => [p.w, p.h, p.o].filter((v): v is { f: number; a: number } => v != null))];
    const s = equalScale(all.length ? all : [{ f: 2.5, a: 2.5 }], pw, ph);
    const X = (f: number) => padL + s.x(f);
    const Y = (a: number) => padT + s.y(a);
    const xt = ticks(s.f[0], s.f[1], s.kx);
    const yt = ticks(s.a[0], s.a[1], s.ky, 32);
    const step = xt.length > 1 ? xt[1] - xt[0] : 0.5;
    const yStep = yt.length > 1 ? yt[1] - yt[0] : 0.5;

    // Corner words and the axis titles are fixed text the labels must avoid.
    const CORNER_PX = 12;
    const corners: { t: string; x: number; y: number; anchor: 'start' | 'end' }[] = [
        { t: 'DULL', x: padL + 6, y: padT + 15, anchor: 'start' },
        { t: 'GOOD', x: W - padR - 6, y: padT + 15, anchor: 'end' },
        { t: 'BAD', x: padL + 6, y: padT + ph - 7, anchor: 'start' },
        { t: 'FUN', x: W - padR - 6, y: padT + ph - 7, anchor: 'end' },
    ];
    const cornerBoxes: Box[] = corners.map(c => {
        const w = measure(c.t, CORNER_PX) + 4;
        return { x: c.anchor === 'start' ? c.x - 2 : c.x - w + 2, y: c.y - 12, w, h: 16 };
    });

    // Labels: his own mark first, then teammates by time together.
    const LABEL_PX = 12;
    const lab = (t: string) => ({ w: measure(t, LABEL_PX) + 2, h: 15 });
    const labelItems: (LabelIn & { text: string })[] = [];
    if (hub) labelItems.push({ id: 0, x: X(hub.f), y: Y(hub.a), text: last, ...lab(last) });
    for (const p of pts) if (p.w) labelItems.push({ id: p.m.id, x: X(p.w.f), y: Y(p.w.a), text: p.m.last, ...lab(p.m.last) });
    const pointBoxes: Box[] = pts.flatMap(p => [p.h, p.o].filter((v): v is { f: number; a: number } => v != null).map(v => ({ x: X(v.f) - R - 1, y: Y(v.a) - R - 1, w: 2 * R + 2, h: 2 * R + 2 })));
    const placed = width ? placeLabels(labelItems, [...cornerBoxes, ...pointBoxes], { x: padL + 1, y: padT + 1, w: pw - 2, h: ph - 2 }) : [];
    const labelOf = new Map(labelItems.map((it, i) => [it.id, { it, out: placed[i] ?? null }]));

    const active = hover ?? sel;
    const act = active != null ? (pts.find(p => p.m.id === active) ?? null) : null;

    // Pointer picking: the nearest point or label of a teammate within reach.
    const pick = (cx: number, cy: number, reach: number): number | null => {
        let best: number | null = null;
        let bd = reach;
        for (const p of pts) {
            for (const v of [p.w, p.h, p.o]) {
                if (!v) continue;
                const d = Math.hypot(X(v.f) - cx, Y(v.a) - cy);
                if (d < bd) {
                    bd = d;
                    best = p.m.id;
                }
            }
            const l = labelOf.get(p.m.id)?.out;
            if (l && cx >= l.box.x - 3 && cx <= l.box.x + l.box.w + 3 && cy >= l.box.y - 3 && cy <= l.box.y + l.box.h + 3 && best == null) best = p.m.id;
        }
        return best;
    };
    const local = (e: React.PointerEvent | React.MouseEvent) => {
        const r = (e.currentTarget as SVGElement).ownerSVGElement?.getBoundingClientRect() ?? (e.currentTarget as Element).getBoundingClientRect();
        return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H] as const;
    };
    const touchRef = React.useRef(false);

    // A tap or click outside the chart (and its card) closes the card; Escape too.
    const showing = sel != null;
    React.useEffect(() => {
        if (!showing) return;
        const off = (e: PointerEvent) => {
            if (!ref.current?.contains(e.target as Node) && !cardRef.current?.contains(e.target as Node)) setSel(null);
        };
        const esc = (e: KeyboardEvent) => e.key === 'Escape' && setSel(null);
        document.addEventListener('pointerdown', off);
        document.addEventListener('keydown', esc);
        return () => {
            document.removeEventListener('pointerdown', off);
            document.removeEventListener('keydown', esc);
        };
    }, [showing, ref]);

    React.useLayoutEffect(() => {
        if (cardRef.current) setCardH(cardRef.current.offsetHeight);
    }, [active, compact]);

    // Floating card: beside the selected triple, on the side with room, never off the panel.
    const CARD_W = 272;
    let cardPos: React.CSSProperties | undefined;
    if (act && !compact) {
        const xs = [act.w, act.h, act.o].filter((v): v is { f: number; a: number } => v != null).map(v => X(v.f));
        const ys = [act.w, act.h, act.o].filter((v): v is { f: number; a: number } => v != null).map(v => Y(v.a));
        const x0 = Math.min(...xs) - 14;
        const x1 = Math.max(...xs) + 14;
        const left = x1 + CARD_W <= W ? x1 : x0 - CARD_W >= 0 ? x0 - CARD_W : W - x1 > x0 ? W - CARD_W : 0;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        cardPos = { left, top: Math.max(0, Math.min(H - cardH, cy - cardH / 2)), width: CARD_W };
    }

    const kindClass = (on: boolean, faded: boolean) => (on ? 'brand' : faded ? 'faded' : 'rest');
    const cls = {
        // Each kind keeps its own colour (together cyan, him apart amber, mate apart magenta); others fade to grey.
        with: { brand: 'fill-brand', rest: 'fill-brand', faded: 'fill-fg-3' },
        him: { brand: 'stroke-amber', rest: 'stroke-amber', faded: 'stroke-fg-3' },
        mate: { brand: 'stroke-model', rest: 'stroke-model', faded: 'stroke-fg-3' },
    };

    const card = act ? (
        <MateCard m={act.m} focusLast={last} apartMin={apartMin} compact={compact} />
    ) : null;

    return (
        <div className="panel p-card">
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-micro uppercase tracking-label text-fg-3">
                {data.teams.length > 1 ? (
                    <span className="flex gap-1" role="radiogroup" aria-label="Team">
                        {data.teams.map((t, i) => (
                            <button
                                key={t.team}
                                type="button"
                                role="radio"
                                aria-checked={i === teamAt}
                                onClick={() => {
                                    setTeamAt(i);
                                    setSel(null);
                                    setHover(null);
                                }}
                                className={cn('inline-flex h-7 items-center rounded-full border px-2.5 uppercase tracking-chip coarse:h-11', i === teamAt ? 'border-brand/60 text-brand' : 'border-line text-fg-3 hover:text-fg-1')}
                            >
                                {t.team}
                            </button>
                        ))}
                    </span>
                ) : null}
                <span className="flex items-center gap-1.5">
                    <Swatch kind="with" /> Together
                </span>
                <span className="flex items-center gap-1.5">
                    <Swatch kind="him" /> {last} apart
                </span>
                <span className="flex items-center gap-1.5">
                    <Swatch kind="mate" /> Mate apart
                </span>
                <span className="flex items-center gap-x-2">
                    <span>5v5 · {mins(data.minToi)}+ min</span>
                    {prior ? (
                        <span className="rounded-chip border border-dashed border-mute px-1.5 text-fg-2">{seasonTag}</span>
                    ) : gp < 20 ? (
                        <span className="rounded-chip border border-dashed border-warn/60 px-1.5 text-warn">{gp} GP</span>
                    ) : null}
                </span>
                <Link href="/methodology#wowy" className="ml-auto underline-offset-4 hover:text-fg-1 hover:underline coarse:-my-3 coarse:inline-flex coarse:min-h-11 coarse:items-center">
                    Method
                </Link>
            </div>
            <div ref={ref} className="relative">
                {width ? (
                    <svg
                        viewBox={`0 0 ${W} ${H}`}
                        width="100%"
                        height={H}
                        className="block select-none tabular-nums"
                        role="group"
                        aria-label={`${first} ${last} with and without his ${mates.length} most-used 5v5 teammates: xG for per 60 across, xG against per 60 down`}
                    >
                        <defs>
                            <clipPath id="wowy-plot">
                                <rect x={padL} y={padT} width={pw} height={ph} />
                            </clipPath>
                        </defs>
                        {/* Equal xG differential: faint diagonals, even a touch stronger. */}
                        <g clipPath="url(#wowy-plot)">
                            {(() => {
                                const out: React.ReactNode[] = [];
                                const lo = Math.floor((s.f[0] - s.a[1]) / step) * step;
                                const hi = Math.ceil((s.f[1] - s.a[0]) / step) * step;
                                for (let d = lo; d <= hi + 1e-9; d += step) {
                                    const even = Math.abs(d) < 1e-9;
                                    out.push(
                                        <line
                                            key={d.toFixed(2)}
                                            x1={X(s.a[0] + d)}
                                            y1={Y(s.a[0])}
                                            x2={X(s.a[1] + d)}
                                            y2={Y(s.a[1])}
                                            className={even ? 'stroke-line-strong' : 'stroke-line'}
                                            strokeWidth={1}
                                            strokeDasharray={even ? '4 4' : undefined}
                                        />,
                                    );
                                }
                                return out;
                            })()}
                        </g>
                        <rect x={padL} y={padT} width={pw} height={ph} fill="none" className="stroke-line" />
                        {xt.map(t => (
                            <text key={`x${t}`} x={X(t)} y={H - padB + 15} textAnchor="middle" className={cn('fill-fg-3 text-micro', X(t) > W - padR - 52 && 'hidden')}>
                                {t.toFixed(step < 0.5 ? 2 : 1)}
                            </text>
                        ))}
                        <text x={W - padR} y={H - padB + 15} textAnchor="end" className="fill-fg-3 text-micro tracking-label">
                            xGF/60
                        </text>
                        {yt.map(t => (
                            <text key={`y${t}`} x={padL - 5} y={Y(t) + 4} textAnchor="end" className={cn('fill-fg-3 text-micro', Y(t) < padT + 8 && 'hidden')}>
                                {t.toFixed(yStep < 0.5 ? 2 : 1)}
                            </text>
                        ))}
                        <text x={padL - 5} y={padT - 7} textAnchor="start" className="fill-fg-3 text-micro tracking-label">
                            xGA/60
                        </text>
                        {corners.map(c => (
                            <text key={c.t} x={c.x} y={c.y} textAnchor={c.anchor} className="fill-fg-3 text-micro tracking-label" opacity={0.6}>
                                {c.t}
                            </text>
                        ))}

                        {/* Connectors from the together point, each in the colour of the apart point it reaches. */}
                        {pts.map(p => {
                            const on = active === p.m.id;
                            const faded = active != null && !on;
                            if (!p.w) return null;
                            const seg = (to: { f: number; a: number } | null, cls: string) =>
                                to ? <line x1={X(p.w!.f)} y1={Y(p.w!.a)} x2={X(to.f)} y2={Y(to.a)} strokeWidth={on ? 1.5 : 1} className={faded ? 'stroke-fg-3' : cls} opacity={on ? 0.9 : faded ? 0.1 : 0.3} /> : null;
                            return (
                                <g key={`l${p.m.id}`}>
                                    {seg(p.h, 'stroke-amber')}
                                    {seg(p.o, 'stroke-model')}
                                </g>
                            );
                        })}
                        {hub ? (
                            <path d={`M${X(hub.f) - 6},${Y(hub.a)}H${X(hub.f) + 6}M${X(hub.f)},${Y(hub.a) - 6}V${Y(hub.a) + 6}`} className="stroke-fg-1" strokeWidth={2} strokeLinecap="round" />
                        ) : null}
                        {/* Points, the active triple drawn last so it sits on top. */}
                        {[...pts].sort((a, b) => Number(a.m.id === active) - Number(b.m.id === active)).map(p => {
                            const on = active === p.m.id;
                            const faded = active != null && !on;
                            const k = kindClass(on, faded);
                            return (
                                <g
                                    key={`p${p.m.id}`}
                                    tabIndex={0}
                                    role="button"
                                    aria-pressed={sel === p.m.id}
                                    aria-label={`${p.m.first} ${p.m.last}: ${mins(p.m.together.toi)} minutes together`}
                                    className="outline-none"
                                    onFocus={() => setSel(p.m.id)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            setSel(v => (v === p.m.id ? null : p.m.id));
                                        }
                                    }}
                                    opacity={faded ? 0.45 : 1}
                                >
                                    {p.o ? <Glyph kind="mate" x={X(p.o.f)} y={Y(p.o.a)} className={cls.mate[k]} /> : null}
                                    {p.h ? <Glyph kind="him" x={X(p.h.f)} y={Y(p.h.a)} className={cls.him[k]} /> : null}
                                    {p.w ? <Glyph kind="with" x={X(p.w.f)} y={Y(p.w.a)} r={on ? R + 1 : R} className={cls.with[k]} /> : null}
                                </g>
                            );
                        })}
                        {/* Labels: placed clear of each other; the active one always shows. */}
                        {labelItems.map(it => {
                            const out = labelOf.get(it.id)?.out ?? null;
                            const on = active === it.id;
                            const faded = active != null && !on && it.id !== 0;
                            let box = out?.box ?? null;
                            if (!box && on) {
                                const right = it.x + 8 + it.w <= padL + pw;
                                box = { x: right ? it.x + 8 : it.x - 8 - it.w, y: Math.max(padT, Math.min(padT + ph - it.h, it.y - it.h / 2)), w: it.w, h: it.h };
                            }
                            if (!box) return null;
                            const cx = Math.max(box.x, Math.min(box.x + box.w, it.x));
                            const cy = Math.max(box.y, Math.min(box.y + box.h, it.y));
                            return (
                                <g key={`t${it.id}`} opacity={faded ? 0.3 : 1} pointerEvents="none">
                                    {out?.lead || (!out && on) ? <line x1={it.x} y1={it.y} x2={cx} y2={cy} className="stroke-fg-2" strokeWidth={1} opacity={0.7} /> : null}
                                    {on ? <rect x={box.x - 2} y={box.y - 1} width={box.w + 4} height={box.h + 2} rx={3} className="fill-surface-1" opacity={0.9} /> : null}
                                    <text x={box.x + 1} y={box.y + 11.5} className={cn('text-micro', it.id === 0 ? 'fill-fg-1 font-bold' : on ? 'fill-brand font-semibold' : 'fill-fg-2')}>
                                        {it.text}
                                    </text>
                                </g>
                            );
                        })}
                        <rect
                            x={0}
                            y={0}
                            width={W}
                            height={H}
                            fill="transparent"
                            className={hover != null ? 'cursor-pointer' : undefined}
                            onPointerDown={e => {
                                touchRef.current = e.pointerType !== 'mouse';
                            }}
                            onPointerMove={e => {
                                if (e.pointerType !== 'mouse') return;
                                const [cx, cy] = local(e);
                                setHover(pick(cx, cy, 14));
                            }}
                            onPointerLeave={e => e.pointerType === 'mouse' && setHover(null)}
                            onClick={e => {
                                const [cx, cy] = local(e);
                                const id = pick(cx, cy, touchRef.current ? 24 : 14);
                                setSel(v => (id == null || v === id ? null : id));
                                if (touchRef.current) setHover(null);
                            }}
                        />
                    </svg>
                ) : (
                    <div style={{ height: H }} aria-hidden="true" />
                )}
                {card && !compact ? (
                    <div ref={cardRef} className="pointer-events-none absolute z-10 rounded-card border border-line-strong bg-surface-1/95 p-3 shadow-[0_12px_32px_rgb(0_0_0/0.55)] backdrop-blur-sm" style={cardPos}>
                        {card}
                    </div>
                ) : null}
            </div>
            {card && compact ? (
                <div ref={cardRef} className="mt-3 rounded-card border border-line-strong bg-surface-1/95 p-3">
                    {card}
                </div>
            ) : null}
        </div>
    );
}

function MateCard({ m, focusLast, apartMin, compact }: { m: WowyMate; focusLast: string; apartMin: number; compact: boolean }) {
    const rows: { kind: 'with' | 'him' | 'mate'; label: string; s: WowyMate['together']; min: number }[] = [
        { kind: 'with', label: 'Together', s: m.together, min: 1 },
        { kind: 'him', label: `${focusLast} apart`, s: m.him, min: apartMin },
        { kind: 'mate', label: `${m.last} apart`, s: m.mate, min: apartMin },
    ];
    return (
        <div className="text-caption">
            <p className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-bold text-fg-1">
                    {m.first} {m.last} <span className="font-normal text-fg-3">{m.pos}</span>
                </span>
                {compact ? (
                    <Link href={`/players/${m.id}`} className="-my-3 -mr-2 inline-flex min-h-11 shrink-0 items-center px-2 text-micro uppercase tracking-label text-brand">
                        Player ›
                    </Link>
                ) : null}
            </p>
            <table className="mt-1.5 w-full border-collapse tabular-nums">
                <thead>
                    <tr className="text-micro uppercase tracking-label text-fg-3">
                        <th className="py-0.5 text-left font-normal" />
                        <th className="px-1.5 py-0.5 text-right font-normal">Min</th>
                        <th className="px-1.5 py-0.5 text-right font-normal">xGF/60</th>
                        <th className="py-0.5 pl-1.5 text-right font-normal">xGA/60</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(r => {
                        const v = rates(r.s, r.min);
                        return (
                            <tr key={r.kind}>
                                <td className="py-0.5 pr-1">
                                    <span className="flex items-center gap-1.5 whitespace-nowrap text-fg-2">
                                        <Swatch kind={r.kind} />
                                        {r.label}
                                    </span>
                                </td>
                                <td className="px-1.5 py-0.5 text-right text-fg-2">{mins(r.s.toi)}</td>
                                <td className={cn('px-1.5 py-0.5 text-right', v ? 'text-model' : 'text-fg-3')}>{v ? f2(v.f) : '—'}</td>
                                <td className={cn('py-0.5 pl-1.5 text-right', v ? 'text-model' : 'text-fg-3')}>{v ? f2(v.a) : '—'}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
