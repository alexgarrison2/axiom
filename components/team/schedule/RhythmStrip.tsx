'use client';

import * as React from 'react';
import type { SchedGame, TeamSchedule } from '@/lib/schedule/metrics';
import { dateOfDay, dayNumber } from '@/lib/schedule/time';
import { dayOf, inFocus, inLens, monthShort, type Focus, type Lens } from './schedule-ui';
import { useWidth } from './use-width';

interface RhythmStripProps {
    schedule: TeamSchedule;
    today: string;
    focus: Focus;
    lens: Lens;
    selectedId: number | null;
    hoverId: number | null;
    onHover: (id: number | null) => void;
    onSelect: (id: number) => void;
    onTrip: (id: number) => void;
}

// Vertical layout (px).
const RIB_TOP = 6;
const RIB_H = 30;
const AXIS = 66;
const MARK_H = 15;
const TRIP_Y = AXIS + MARK_H + 9;
const MONTH_Y = TRIP_Y + 31;
const HEIGHT = MONTH_Y + 3;
const PAD = 6;
// Difficulty scale for the ribbon (0-100 index; an average game is ~50).
const RIB_LO = 36;
const RIB_HI = 64;
const DENSITY_W = [0, 2, 3, 4.5, 6];

const C = {
    pos: 'rgb(var(--pos-rgb))',
    neg: 'rgb(var(--neg-rgb))',
    model: 'rgb(var(--model-rgb))',
    warn: 'rgb(var(--warn-rgb))',
    info: 'rgb(var(--info-rgb))',
    brand: 'rgb(var(--brand-rgb))',
    ink: 'rgb(var(--text-1-rgb))',
    dim: 'rgb(var(--text-3-rgb))',
    line: 'rgb(var(--line-rgb))',
    lineStrong: 'var(--line-strong)',
};

function markFill(g: SchedGame): { fill: string; opacity: number; stroke?: string } {
    if (g.result) {
        if (g.result.code === 'W') return { fill: C.pos, opacity: 0.9 };
        if (g.result.code === 'OTL') return { fill: C.neg, opacity: 0.45 };
        return { fill: C.neg, opacity: 0.85 };
    }
    if (g.state === 'live') return { fill: 'transparent', opacity: 1, stroke: C.pos };
    if (g.winPct) {
        const t = Math.min(1, Math.max(0, (g.winPct.pct - 30) / 40));
        return { fill: C.model, opacity: 0.16 + 0.7 * t };
    }
    return { fill: 'transparent', opacity: 1, stroke: C.dim };
}

/**
 * The season on one day axis: home games above the line, road games below,
 * rest as spacing. Amber bands are 3-in-4 / 4-in-6 / 5-in-8 windows (they
 * stack, so denser reads stronger), an amber tie joins back-to-backs, the
 * ice-grey ribbon on top is rolling difficulty, and brackets under the road
 * marks are road trips. Hover (mouse) or tap a game; tap a bracket for its trip.
 */
export function RhythmStrip({ schedule, today, focus, lens, selectedId, hoverId, onHover, onSelect, onTrip }: RhythmStripProps) {
    const [ref, width] = useWidth<HTMLDivElement>();
    const games = schedule.games;
    const d0 = games.length ? dayOf(games[0]) - 1 : 0;
    const d1 = games.length ? dayOf(games[games.length - 1]) + 1 : 1;
    const span = Math.max(1, d1 - d0 + 1);
    const W = Math.max(200, width);
    const dayW = (W - 2 * PAD) / span;
    const x = React.useCallback((day: number) => PAD + (day - d0 + 0.5) * dayW, [d0, dayW]);
    const markW = Math.min(7, Math.max(1.6, dayW * 0.72));

    const byIdx = games;
    const gx = (i: number) => x(dayOf(byIdx[i]));

    // Ribbon path.
    const ribY = (v: number) => RIB_TOP + RIB_H * (1 - Math.min(1, Math.max(0, (v - RIB_LO) / (RIB_HI - RIB_LO))));
    const ribbon = React.useMemo(() => {
        if (!games.length) return { area: '', line: '' };
        const pts = games.map(g => [x(dayOf(g)), ribY(g.ribbon)] as const);
        const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
        const base = RIB_TOP + RIB_H;
        const area = `${line}L${pts[pts.length - 1][0].toFixed(1)},${base}L${pts[0][0].toFixed(1)},${base}Z`;
        return { area, line };
    }, [games, x]);

    // Month ticks.
    const monthTicks = React.useMemo(() => {
        const out: { day: number; key: string }[] = [];
        for (let d = d0; d <= d1; d++) {
            const iso = dateOfDay(d);
            if (iso.endsWith('-01') || d === d0) out.push({ day: d, key: iso.slice(0, 7) });
        }
        // Drop a leading partial month label that would collide with the first full month,
        // and a trailing one with no room before the edge.
        return out.filter((m, i) => !(i === 0 && out[1] && (out[1].day - m.day) * dayW < 28) && !(i === out.length - 1 && (d1 - m.day + 1) * dayW < 30));
    }, [d0, d1, dayW]);

    // Per gap between game i and i+1: the densest window covering both (1 b2b … 4 5-in-8).
    const density = React.useMemo(() => {
        const lv = new Map<number, number>();
        const rank = { b2b: 1, '3in4': 2, '4in6': 3, '5in8': 4 } as const;
        for (const b of schedule.bands) for (let i = b.first; i < b.last; i++) lv.set(i, Math.max(lv.get(i) ?? 0, rank[b.kind]));
        return [...lv.entries()];
    }, [schedule.bands]);

    const todayDay = dayNumber(today);
    const showToday = todayDay > d0 && todayDay < d1 && games.some(g => g.state !== 'final');

    const nearest = (px: number): SchedGame | null => {
        let best: SchedGame | null = null;
        let bd = Infinity;
        for (const g of games) {
            const d = Math.abs(x(dayOf(g)) - px);
            if (d < bd) {
                bd = d;
                best = g;
            }
        }
        return bd <= Math.max(12, dayW * 2) ? best : null;
    };
    const localX = (e: React.PointerEvent | React.MouseEvent) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        return ((e.clientX - r.left) / r.width) * W;
    };

    const focusRange = React.useMemo(() => {
        if (focus.kind === 'season') return null;
        const fs = games.filter(g => inFocus(g, focus));
        if (!fs.length) return null;
        return [x(dayOf(fs[0])) - Math.max(dayW, 4), x(dayOf(fs[fs.length - 1])) + Math.max(dayW, 4)] as const;
    }, [focus, games, x, dayW]);

    const activeId = hoverId ?? selectedId;
    const onKey = (e: React.KeyboardEvent) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const i = games.findIndex(g => g.id === selectedId);
        const next = e.key === 'ArrowRight' ? Math.min(games.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
        if (games[next]) onSelect(games[next].id);
    };

    return (
        <div ref={ref} className="relative w-full select-none">
            {width > 0 ? (
                <svg
                    role="group"
                    aria-label="Season rhythm. Left and right arrows step through games."
                    tabIndex={0}
                    onKeyDown={onKey}
                    width={W}
                    height={HEIGHT}
                    viewBox={`0 0 ${W} ${HEIGHT}`}
                    className="block cursor-pointer touch-pan-y rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    onPointerMove={e => {
                        if (e.pointerType !== 'mouse') return;
                        onHover(nearest(localX(e))?.id ?? null);
                    }}
                    onPointerLeave={() => onHover(null)}
                    onClick={e => {
                        const g = nearest(localX(e));
                        if (g) onSelect(g.id);
                    }}
                >
                    {/* focus window */}
                    {focusRange ? <rect x={focusRange[0]} y={0} width={focusRange[1] - focusRange[0]} height={MONTH_Y - 10} rx={4} fill="rgb(var(--surface-3-rgb))" opacity={0.85} /> : null}

                    {/* difficulty ribbon */}
                    <path d={ribbon.area} fill={C.info} opacity={0.12} />
                    <path d={ribbon.line} fill="none" stroke={C.info} strokeOpacity={0.75} strokeWidth={1.25} strokeLinejoin="round" />
                    <line x1={PAD} x2={W - PAD} y1={ribY(50)} y2={ribY(50)} stroke={C.line} strokeDasharray="2 3" />

                    {/* axis */}
                    <line x1={PAD} x2={W - PAD} y1={AXIS} y2={AXIS} stroke={C.lineStrong} />

                    {/* density: the axis thickens between games inside a back-to-back, 3-in-4, 4-in-6, 5-in-8 */}
                    {density.map(([i, level]) => (
                        <line key={`d-${i}`} x1={gx(i)} x2={gx(i + 1)} y1={AXIS} y2={AXIS} stroke={C.warn} strokeOpacity={0.45 + level * 0.14} strokeWidth={DENSITY_W[level]} strokeLinecap="round" />
                    ))}

                    {/* breaks */}
                    {schedule.breaks
                        .filter(b => b.days >= 6)
                        .map(b => {
                            const a = gx(b.after);
                            const z = gx(b.after + 1);
                            if (z - a < 40) return null;
                            return (
                                <text key={`brk-${b.after}`} x={(a + z) / 2} y={AXIS + 4} textAnchor="middle" className="fill-fg-3 text-micro uppercase" style={{ letterSpacing: '0.12em' }}>
                                    Break
                                </text>
                            );
                        })}

                    {/* games */}
                    {games.map(g => {
                        const gxv = x(dayOf(g));
                        const y = g.home ? AXIS - 2.5 - MARK_H : AXIS + 2.5;
                        const f = markFill(g);
                        const dim = !inFocus(g, focus) || !inLens(g, lens);
                        const hot = g.id === activeId;
                        return (
                            <g key={g.id} opacity={dim ? 0.22 : 1}>
                                <rect
                                    x={gxv - markW / 2}
                                    y={y}
                                    width={markW}
                                    height={MARK_H}
                                    rx={Math.min(1.5, markW / 3)}
                                    fill={f.fill}
                                    fillOpacity={f.opacity}
                                    stroke={f.stroke}
                                    strokeWidth={f.stroke ? 1 : 0}
                                />
                                {g.event ? <circle cx={gxv} cy={g.home ? y - 5 : y + MARK_H + 5} r={2.2} fill={C.warn} /> : null}
                                {hot ? (
                                    <rect
                                        x={gxv - markW / 2 - 2.5}
                                        y={y - 2.5}
                                        width={markW + 5}
                                        height={MARK_H + 5}
                                        rx={2.5}
                                        fill="none"
                                        stroke={g.id === selectedId ? C.brand : C.ink}
                                        strokeOpacity={g.id === selectedId ? 1 : 0.6}
                                        strokeWidth={1.5}
                                    />
                                ) : null}
                            </g>
                        );
                    })}

                    {/* today */}
                    {showToday ? <line x1={x(todayDay)} x2={x(todayDay)} y1={AXIS - MARK_H - 8} y2={AXIS + MARK_H + 8} stroke={C.ink} strokeOpacity={0.55} strokeDasharray="2 2" /> : null}

                    {/* road trips */}
                    {schedule.trips.map(t => {
                        const a = gx(t.first) - markW / 2;
                        const z = gx(t.last) + markW / 2;
                        const on = focus.kind === 'trip' && focus.id === t.id;
                        const label = z - a >= 70 ? `${t.games} · ${(t.mi / 1000).toFixed(1)}k mi` : z - a >= 18 && t.games > 1 ? `${t.games}` : '';
                        return (
                            <g
                                key={`trip-${t.id}`}
                                className="cursor-pointer"
                                onClick={e => {
                                    e.stopPropagation();
                                    onTrip(t.id);
                                }}
                            >
                                <rect x={a - 2} y={TRIP_Y - 5} width={z - a + 4} height={20} fill="transparent" />
                                <path d={`M${a},${TRIP_Y - 3}V${TRIP_Y}H${z}V${TRIP_Y - 3}`} fill="none" stroke={on ? C.brand : C.dim} strokeOpacity={on ? 1 : 0.55} strokeWidth={on ? 1.5 : 1} />
                                {label ? (
                                    <text x={(a + z) / 2} y={TRIP_Y + 12} textAnchor="middle" className="text-micro tabular-nums" fill={on ? C.brand : C.dim}>
                                        {label}
                                    </text>
                                ) : null}
                            </g>
                        );
                    })}

                    {/* months */}
                    {monthTicks.map(m => (
                        <g key={m.key}>
                            <line x1={x(m.day) - dayW / 2} x2={x(m.day) - dayW / 2} y1={MONTH_Y - 12} y2={MONTH_Y - 4} stroke={C.lineStrong} />
                            <text x={x(m.day) - dayW / 2 + 4} y={MONTH_Y - 4} className="fill-fg-3 text-micro uppercase" style={{ letterSpacing: '0.12em' }}>
                                {monthShort(m.key)}
                            </text>
                        </g>
                    ))}
                </svg>
            ) : (
                <div style={{ height: HEIGHT }} />
            )}
        </div>
    );
}

export default RhythmStrip;
