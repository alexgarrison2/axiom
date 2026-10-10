'use client';

import * as React from 'react';
import { Crest } from '@/components/ui/crest';
import { cn } from '@/lib/utils';
import { DRAW_WINDOW, draws, FO_SPOTS, periodLabel, type Draw } from '@/lib/game/analytics';
import { other, type Side } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';
import { useHoverTip } from './HoverTip';
import { JerseyNumber } from './Jersey';
import { RinkMarkings } from './Rink';

/**
 * The draw board: the rink's nine faceoff dots carry the game's faceoffs. Each
 * draw is a bead on a ring around its dot, clockwise from twelve o'clock in game
 * order, in the winner's colour; a spark leaves a bead whose win became a shot
 * attempt within DRAW_WINDOW seconds. The takers sit at the ends their team
 * attacks; picking one threads him to every dot he took a draw on and on to
 * the men he took them against.
 */

const WIDE = '(min-width: 1024px)';
const onWide = (cb: () => void) => {
    const q = window.matchMedia(WIDE);
    q.addEventListener('change', cb);
    return () => q.removeEventListener('change', cb);
};

/** Rink frame in feet, a little past the boards. */
const VB = { x: -101, y: -44, w: 202, h: 88 };
const BEAD = 2.1;
const STEP = 2 * BEAD + 0.9;
/** Painted circles (ends, centre) are 15 ft; the neutral dots get a smaller ring of their own. */
const isNeutral = (k: number) => k === 2 || k === 3 || k === 5 || k === 6;
const ringOf = (k: number) => (isNeutral(k) ? 9 : 15);

type Zone = 'O' | 'N' | 'D';
interface Taker {
    id: number;
    side: Side;
    w: number;
    l: number;
    /** Won-lost by zone from his own side's view. */
    zone: Record<Zone, [number, number]>;
    /** Wins that became a shot attempt. */
    led: number;
}

/** Bead centres for n draws on a ring of radius r: from twelve o'clock clockwise, a second ring outside when the first is full. */
function beadSpots(n: number, r: number): { x: number; y: number; a: number }[] {
    const out: { x: number; y: number; a: number }[] = [];
    let ring = r;
    let used = 0;
    for (let i = 0; i < n; i++) {
        if (used * STEP > 2 * Math.PI * ring - STEP) {
            ring += STEP;
            used = 0;
        }
        const a = -Math.PI / 2 + (used * STEP) / ring;
        out.push({ x: ring * Math.cos(a), y: ring * Math.sin(a), a });
        used += 1;
    }
    return out;
}

const flip = (z: Zone): Zone => (z === 'O' ? 'D' : z === 'D' ? 'O' : 'N');

function takersOf(list: Draw[], byId: Map<number, { side: Side }>): Taker[] {
    const map = new Map<number, Taker>();
    const get = (id: number) => {
        let t = map.get(id);
        if (!t) {
            const side = byId.get(id)?.side ?? 'away';
            map.set(id, (t = { id, side, w: 0, l: 0, zone: { O: [0, 0], N: [0, 0], D: [0, 0] }, led: 0 }));
        }
        return t;
    };
    for (const d of list) {
        const z = d.e.zone;
        if (d.winner != null) {
            const t = get(d.winner);
            t.w += 1;
            if (z) t.zone[z][0] += 1;
            if (d.led) t.led += 1;
        }
        if (d.loser != null) {
            const t = get(d.loser);
            t.l += 1;
            if (z) t.zone[flip(z)][1] += 1;
        }
    }
    return [...map.values()].sort((a, b) => b.w + b.l - (a.w + a.l) || b.w - a.w);
}

/** A short tick leaving the bead: the win became a shot attempt (longer for a goal). */
function Spark({ x, y, a, goal }: { x: number; y: number; a: number; goal: boolean }) {
    const r0 = BEAD + 0.5;
    const r1 = BEAD + (goal ? 4.2 : 3);
    return (
        <line
            x1={x + r0 * Math.cos(a)}
            y1={y + r0 * Math.sin(a)}
            x2={x + r1 * Math.cos(a)}
            y2={y + r1 * Math.sin(a)}
            className="stroke-fg-1"
            strokeWidth={goal ? 0.9 : 0.6}
            strokeLinecap="round"
        />
    );
}

function SparkIcon() {
    return (
        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
            <circle cx={4} cy={8} r={3} fill="currentColor" opacity={0.55} />
            <path d="M7 5l3.5-3.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
        </svg>
    );
}

export function Faceoffs() {
    const { m, colors, byId, label } = useGame();
    const list = React.useMemo(() => draws(m), [m]);
    const takers = React.useMemo(() => takersOf(list, byId), [list, byId]);
    const [pinned, setPinned] = React.useState<number | null>(null);
    const [hover, setHover] = React.useState<number | null>(null);
    const active = hover ?? pinned;
    const activeSide = active != null ? (byId.get(active)?.side ?? null) : null;
    const { bind, tip } = useHoverTip();

    // Ends are named for whose net they hold: the left net is the home team's (the away team attacks left).
    const endName = (k: number) => {
        const [x, y] = FO_SPOTS[k];
        const half = y < 0 ? 'top' : 'bottom';
        if (x === 0) return 'Centre ice';
        const owner = x < 0 ? m.teams.home.tri : m.teams.away.tri;
        return isNeutral(k) ? `Neutral, ${owner} side · ${half}` : `${owner} zone · ${half}`;
    };

    const byDot = React.useMemo(() => FO_SPOTS.map((_, k) => list.filter(d => d.dot === k)), [list]);
    const involved = (d: Draw) => active == null || d.winner === active || d.loser === active;
    // Head to head against the picked taker: wins and losses of each opponent against him.
    const h2h = React.useMemo(() => {
        const out = new Map<number, [number, number]>();
        if (active == null) return out;
        for (const d of list) {
            if (d.winner === active && d.loser != null) out.set(d.loser, [(out.get(d.loser)?.[0] ?? 0), (out.get(d.loser)?.[1] ?? 0) + 1]);
            if (d.loser === active && d.winner != null) out.set(d.winner, [(out.get(d.winner)?.[0] ?? 0) + 1, out.get(d.winner)?.[1] ?? 0]);
        }
        return out;
    }, [active, list]);

    // Threads (wide screens): the picked taker's row to each dot he drew on, and on to each opponent there.
    const boardRef = React.useRef<HTMLDivElement>(null);
    const rinkRef = React.useRef<SVGSVGElement>(null);
    const rowRefs = React.useRef(new Map<number, HTMLElement>());
    const [threads, setThreads] = React.useState<{ d: string; color: string; w: number }[]>([]);
    const [boardW, setBoardW] = React.useState(0);
    React.useLayoutEffect(() => {
        const el = boardRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([e]) => setBoardW(Math.round(e.contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    // Threads only where the rails sit beside the rink.
    const wide = React.useSyncExternalStore(onWide, () => window.matchMedia(WIDE).matches, () => false);
    React.useLayoutEffect(() => {
        const board = boardRef.current;
        const rink = rinkRef.current;
        if (!wide || active == null || activeSide == null || !board || !rink) {
            setThreads([]);
            return;
        }
        const B = board.getBoundingClientRect();
        const R = rink.getBoundingClientRect();
        const toPx = (x: number, y: number) => [R.left - B.left + ((x - VB.x) / VB.w) * R.width, R.top - B.top + ((y - VB.y) / VB.h) * R.height] as const;
        const anchor = (id: number, side: Side) => {
            const r = rowRefs.current.get(id)?.getBoundingClientRect();
            if (!r) return null;
            return [side === 'away' ? r.right - B.left : r.left - B.left, r.top - B.top + r.height / 2] as const;
        };
        const curve = (a: readonly [number, number], b: readonly [number, number]) => {
            const dx = (b[0] - a[0]) * 0.5;
            return `M${a[0].toFixed(1)},${a[1].toFixed(1)} C${(a[0] + dx).toFixed(1)},${a[1].toFixed(1)} ${(b[0] - dx).toFixed(1)},${b[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`;
        };
        const me = anchor(active, activeSide);
        if (!me) {
            setThreads([]);
            return;
        }
        const out: { d: string; color: string; w: number }[] = [];
        const opp = other(activeSide);
        // Toward the taker's own rail on one side of the ring, toward the opponents' on the other.
        const edge = (k: number, toward: Side) => {
            const [x, y] = FO_SPOTS[k];
            const r = ringOf(k) + STEP;
            return toPx(x + (toward === 'away' ? -r : r), y);
        };
        byDot.forEach((ds, k) => {
            const mine = ds.filter(d => d.winner === active || d.loser === active);
            if (!mine.length) return;
            out.push({ d: curve(me, edge(k, activeSide)), color: colors[activeSide], w: 1 + mine.length * 0.9 });
            const vs = new Map<number, number>();
            for (const d of mine) {
                const o = d.winner === active ? d.loser : d.winner;
                if (o != null) vs.set(o, (vs.get(o) ?? 0) + 1);
            }
            for (const [o, n] of vs) {
                const a = anchor(o, opp);
                if (a) out.push({ d: curve(edge(k, opp), a), color: colors[opp], w: 1 + n * 0.9 });
            }
        });
        setThreads(out);
    }, [wide, active, activeSide, byDot, colors, boardW]);

    // Dot tallies stay at least ~11.5px on a small rink (feet per pixel grow as it shrinks).
    const tallyFs = Math.max(6.2, 11.5 / ((boardW || 800) / VB.w));
    const total = (s: Side) => list.filter(d => d.win === s).length;
    const ledBy = (s: Side) => list.filter(d => d.win === s && d.led).length;
    const n = list.length;

    const zoneTally = (lo: number, hi: number) => {
        const ds = list.filter(d => d.dot != null && FO_SPOTS[d.dot][0] >= lo && FO_SPOTS[d.dot][0] <= hi);
        return { away: ds.filter(d => d.win === 'away').length, home: ds.filter(d => d.win === 'home').length };
    };
    const thirds = [
        { name: `${m.teams.home.tri} zone`, ...zoneTally(-100, -25) },
        { name: 'Neutral', ...zoneTally(-24, 24) },
        { name: `${m.teams.away.tri} zone`, ...zoneTally(25, 100) },
    ];

    const dotTip = (k: number) => {
        const ds = byDot[k];
        return (
            <div className="flex w-72 flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                    <span className="font-bold text-fg-1">{endName(k)}</span>
                    <span className="text-micro uppercase tracking-label text-fg-3">
                        <span style={{ color: colors.away }}>{ds.filter(d => d.win === 'away').length}</span>
                        {' – '}
                        <span style={{ color: colors.home }}>{ds.filter(d => d.win === 'home').length}</span>
                    </span>
                </div>
                <ol className="flex flex-col gap-1 text-caption">
                    {ds.map(d => (
                        <li key={d.e.id} className="grid grid-cols-[3.75rem_1fr_auto] items-baseline gap-2">
                            <span className="text-micro tabular-nums text-fg-3">
                                {periodLabel(d.e.period)} {d.e.clock}
                            </span>
                            <span className="min-w-0 truncate">
                                <span className="font-semibold" style={{ color: colors[d.win] }}>
                                    {label(d.winner)}
                                </span>
                                <span className="text-fg-3"> over </span>
                                <span className="text-fg-2">{label(d.loser)}</span>
                            </span>
                            <span className="text-micro uppercase tracking-label text-fg-2">
                                {d.led ? (d.led.type === 'goal' ? `Goal ${Math.round(d.led.t - d.e.t)}s` : `Shot ${Math.round(d.led.t - d.e.t)}s`) : ''}
                            </span>
                        </li>
                    ))}
                </ol>
            </div>
        );
    };

    const rail = (side: Side) => {
        const rows = takers.filter(t => t.side === side);
        const w = total(side);
        const l = n - w;
        return (
            <div className="flex min-w-0 flex-col gap-1.5">
                <div className={cn('flex items-center gap-3', side === 'home' && 'lg:flex-row-reverse lg:text-right')}>
                    <Crest tri={m.teams[side].tri} size={44} className="h-11 w-11 shrink-0" />
                    <div className="min-w-0 leading-tight">
                        <div className={cn('flex items-baseline gap-2', side === 'home' && 'lg:justify-end')}>
                            <span className="text-h3 font-bold tabular-nums text-fg-1">
                                {w}–{l}
                            </span>
                            <span className="text-caption tabular-nums" style={{ color: colors[side] }}>
                                {n ? Math.round((w / n) * 100) : 0}%
                            </span>
                        </div>
                        <span className={cn('flex items-center gap-1 text-micro uppercase tracking-label text-fg-3', side === 'home' && 'lg:justify-end')}>
                            <SparkIcon /> {ledBy(side)} won into a shot
                        </span>
                    </div>
                </div>
                <ul className="flex flex-col">
                    {rows.map(t => {
                        const isActive = t.id === active;
                        const rec = h2h.get(t.id);
                        const faded = active != null && !isActive && (activeSide === side || !rec);
                        const p = byId.get(t.id);
                        return (
                            <li key={t.id}>
                                <button
                                    type="button"
                                    ref={el => {
                                        if (el) rowRefs.current.set(t.id, el);
                                        else rowRefs.current.delete(t.id);
                                    }}
                                    aria-pressed={pinned === t.id}
                                    onPointerEnter={e => e.pointerType === 'mouse' && setHover(t.id)}
                                    onPointerLeave={e => e.pointerType === 'mouse' && setHover(null)}
                                    onClick={() => setPinned(cur => (cur === t.id ? null : t.id))}
                                    className={cn(
                                        'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 rounded-control border px-2 py-1.5 text-left transition-[opacity,background-color,border-color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand',
                                        isActive ? 'border-brand/60 bg-surface-2' : 'border-transparent hover:bg-surface-2/60',
                                        faded && 'opacity-35',
                                    )}
                                >
                                    <JerseyNumber tri={m.teams[side].tri} num={p?.num ?? null} ring={colors[side]} size={24} />
                                    <span className="min-w-0">
                                        <span className="block truncate text-caption font-semibold text-fg-1">{label(t.id)}</span>
                                        <span className="flex items-center gap-2 text-micro tabular-nums text-fg-3">
                                            {(['D', 'N', 'O'] as Zone[]).map(z =>
                                                t.zone[z][0] + t.zone[z][1] ? (
                                                    <span key={z}>
                                                        {z} {t.zone[z][0]}–{t.zone[z][1]}
                                                    </span>
                                                ) : null,
                                            )}
                                            {t.led ? (
                                                <span className="flex items-center gap-0.5 text-fg-2">
                                                    <SparkIcon />
                                                    {t.led}
                                                </span>
                                            ) : null}
                                        </span>
                                    </span>
                                    {rec && !isActive ? (
                                        <span className="text-right leading-none">
                                            <span className="block text-micro uppercase tracking-label text-fg-3">vs</span>
                                            <span className="text-body font-bold tabular-nums text-brand">
                                                {rec[0]}–{rec[1]}
                                            </span>
                                        </span>
                                    ) : (
                                        <span className="text-body font-bold tabular-nums text-fg-1">
                                            {t.w}–{t.l}
                                        </span>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        );
    };

    if (!n)
        return (
            <GameSection id="faceoffs" title="Faceoffs">
                <p className="panel p-card label">No faceoffs yet</p>
            </GameSection>
        );

    return (
        <GameSection id="faceoffs" title="Faceoffs">
            <div className="panel overflow-hidden">
                <div ref={boardRef} className="relative grid gap-5 p-card sm:grid-cols-2 lg:grid-cols-[13.5rem_minmax(0,1fr)_13.5rem] lg:items-start">
                    <div className="order-2 lg:order-1">{rail('away')}</div>
                    <div className="order-1 flex min-w-0 flex-col gap-2 sm:col-span-2 lg:order-2 lg:col-span-1">
                        <svg
                            ref={rinkRef}
                            viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
                            className="block h-auto w-full"
                            role="img"
                            aria-label={`${n} faceoffs: ${m.teams.away.tri} won ${total('away')}, ${m.teams.home.tri} won ${total('home')}`}
                            onPointerLeave={() => setHover(null)}
                        >
                            <RinkMarkings />
                            {FO_SPOTS.map(([cx, cy], k) => {
                                const ds = byDot[k];
                                const r = ringOf(k);
                                const spots = beadSpots(ds.length, r);
                                const mine = active == null ? ds : ds.filter(involved);
                                const aw = mine.filter(d => d.win === 'away').length;
                                const hw = mine.filter(d => d.win === 'home').length;
                                return (
                                    <g key={k} transform={`translate(${cx},${cy})`}>
                                        {isNeutral(k) ? <circle r={r} fill="none" stroke="var(--line-strong)" strokeWidth={0.3} strokeDasharray="1 1.2" /> : null}
                                        {ds.map((d, i) => {
                                            const s = spots[i];
                                            const on = involved(d);
                                            return (
                                                <g key={d.e.id} style={{ opacity: on ? 1 : 0.12, transition: 'opacity 140ms' }}>
                                                    <circle cx={s.x} cy={s.y} r={BEAD} fill={colors[d.win]} stroke="var(--bg)" strokeWidth={0.45} />
                                                    {d.led ? <Spark x={s.x} y={s.y} a={s.a} goal={d.led.type === 'goal'} /> : null}
                                                </g>
                                            );
                                        })}
                                        {/* The dot's tally: away wins left, home wins right (only the picked taker's when one is picked). */}
                                        {ds.length ? (
                                            <text y={tallyFs / 3} textAnchor="middle" fontSize={tallyFs} fontWeight={700} className="tabular-nums" style={{ opacity: mine.length ? 1 : 0.25 }}>
                                                <tspan fill={colors.away}>{aw}</tspan>
                                                <tspan className="fill-fg-3" fontWeight={400}>
                                                    {' · '}
                                                </tspan>
                                                <tspan fill={colors.home}>{hw}</tspan>
                                            </text>
                                        ) : null}
                                        {ds.length ? <circle r={r + STEP + 1} fill="transparent" className="cursor-crosshair" {...bind(dotTip(k))} /> : null}
                                    </g>
                                );
                            })}
                        </svg>
                        <div className="grid grid-cols-[75fr_50fr_75fr] text-center text-micro uppercase tracking-label text-fg-3">
                            {thirds.map(z => (
                                <span key={z.name} className="flex flex-col items-center gap-0.5">
                                    <span>{z.name}</span>
                                    <span className="text-caption font-bold normal-case tracking-normal tabular-nums">
                                        <span style={{ color: colors.away }}>{z.away}</span>
                                        <span className="px-1 font-normal text-fg-3">·</span>
                                        <span style={{ color: colors.home }}>{z.home}</span>
                                    </span>
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="order-3">{rail('home')}</div>
                    {threads.length ? (
                        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
                            {threads.map((t, i) => (
                                <path key={i} d={t.d} fill="none" stroke={t.color} strokeWidth={t.w} strokeOpacity={0.5} strokeLinecap="round" />
                            ))}
                        </svg>
                    ) : null}
                </div>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-card py-2 text-micro uppercase tracking-label text-fg-3">
                    <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors.away }} />
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors.home }} />
                        Bead = draw, winner&apos;s colour
                    </span>
                    <span>Clockwise from the top in game order</span>
                    <span className="flex items-center gap-1.5">
                        <SparkIcon /> Shot attempt within {DRAW_WINDOW}s
                    </span>
                    <span>Pick a taker to thread his draws</span>
                </p>
                {tip}
            </div>
        </GameSection>
    );
}

