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
    /** A stretch of games picked by dragging the window's edges (indices into the season, inclusive). */
    onRange: (first: number, last: number) => void;
}

// Vertical layout (px).
const RIB_TOP = 6;
const RIB_H = 30;
const AXIS = 72;
/** Played games (and games with no forecast) are one fixed length. */
const MARK_H = 15;
/** Games ahead: length from the axis encodes the model's win %, around a 50% guide. */
const WIN_MID = 12;
const WIN_MAX = 26;
const WIN_PER_PT = 0.6; // px per percentage point: 40% → 6px, 50% → 12px, 70% → 24px
const MARK_MAX = WIN_MAX;
const TRIP_Y = AXIS + MARK_MAX + 9;
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

/** Win % on a diverging scale around the 50% guide. */
const winLength = (pct: number) => Math.min(WIN_MAX, Math.max(3, WIN_MID + (pct - 50) * WIN_PER_PT));

/**
 * Mark length: a game ahead by the model's win %, a played game by the win %
 * we published before puck drop; fixed when there is neither.
 */
export function markLength(g: Pick<SchedGame, 'result' | 'winPct' | 'state' | 'pregame'>): number {
    if (g.result) return g.pregame != null ? winLength(g.pregame) : MARK_H;
    if (g.state === 'live' || !g.winPct) return MARK_H;
    return winLength(g.winPct.pct);
}

function markFill(g: SchedGame): { fill: string; opacity: number; stroke?: string } {
    if (g.result) {
        if (g.result.code === 'W') return { fill: C.pos, opacity: 0.9 };
        if (g.result.code === 'OTL') return { fill: C.neg, opacity: 0.45 };
        return { fill: C.neg, opacity: 0.85 };
    }
    if (g.state === 'live') return { fill: 'transparent', opacity: 1, stroke: C.pos };
    if (g.winPct) return { fill: C.model, opacity: 0.8 };
    return { fill: 'transparent', opacity: 1, stroke: C.dim };
}

/**
 * The season on one day axis: home games above the line, road games below,
 * rest as spacing. A game ahead is a magenta bar whose length from the axis
 * is the model's win % (dotted guides mark 50%: favourites pass them,
 * underdogs fall short); a played game keeps that length from our frozen
 * pregame call in its result colour (fixed length when none was archived). Amber bands are 3-in-4 / 4-in-6 / 5-in-8 windows (they
 * stack, so denser reads stronger), an amber tie joins back-to-backs, the
 * ice-grey ribbon on top is rolling difficulty, and brackets under the road
 * marks are road trips. Hover (mouse) or tap a game; tap a bracket for its trip.
 */
export function RhythmStrip({ schedule, today, focus, lens, selectedId, hoverId, onHover, onSelect, onTrip, onRange }: RhythmStripProps) {
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
    const firstScaled = games.find(g => (g.result ? g.pregame != null : !!g.winPct));
    const guideFrom = firstScaled ? x(dayOf(firstScaled)) - markW : null;
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

    // The focus as a window of games: the season is the whole strip.
    const win = React.useMemo(() => {
        if (!games.length) return null;
        if (focus.kind === 'season') return { first: 0, last: games.length - 1 };
        let first = -1;
        let last = -1;
        games.forEach((g, i) => {
            if (!inFocus(g, focus)) return;
            if (first < 0) first = i;
            last = i;
        });
        return first < 0 ? null : { first, last };
    }, [focus, games]);
    const edgePad = Math.max(dayW, 4);
    const focusRange = win && focus.kind !== 'season' ? ([gx(win.first) - edgePad, gx(win.last) + edgePad] as const) : null;

    // Dragging an edge: the window snaps to games, live, and the other edge stays put.
    const svgRef = React.useRef<SVGSVGElement>(null);
    const drag = React.useRef<{ edge: 'first' | 'last'; first: number; last: number } | null>(null);
    const [dragging, setDragging] = React.useState<'first' | 'last' | null>(null);
    const indexAt = (clientX: number) => {
        const r = svgRef.current?.getBoundingClientRect();
        if (!r) return 0;
        const px = ((clientX - r.left) / r.width) * W;
        let best = 0;
        let bd = Infinity;
        games.forEach((g, i) => {
            const d = Math.abs(x(dayOf(g)) - px);
            if (d < bd) {
                bd = d;
                best = i;
            }
        });
        return best;
    };
    const moveEdge = (edge: 'first' | 'last', i: number, from: { first: number; last: number }) => {
        const next = edge === 'first' ? { first: Math.min(i, from.last), last: from.last } : { first: from.first, last: Math.max(i, from.first) };
        if (next.first !== from.first || next.last !== from.last || focus.kind !== 'range') onRange(next.first, next.last);
        return next;
    };

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
                    ref={svgRef}
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

                    {/* 50% guides for the games ahead, home side and road side */}
                    {guideFrom != null ? (
                        <g stroke={C.model} strokeOpacity={0.35} strokeDasharray="1 3">
                            <line x1={guideFrom} x2={W - PAD} y1={AXIS - 2.5 - WIN_MID} y2={AXIS - 2.5 - WIN_MID} />
                            <line x1={guideFrom} x2={W - PAD} y1={AXIS + 2.5 + WIN_MID} y2={AXIS + 2.5 + WIN_MID} />
                        </g>
                    ) : null}

                    {/* games */}
                    {games.map(g => {
                        const gxv = x(dayOf(g));
                        const h = markLength(g);
                        const y = g.home ? AXIS - 2.5 - h : AXIS + 2.5;
                        const f = markFill(g);
                        const dim = !inFocus(g, focus) || !inLens(g, lens);
                        const hot = g.id === activeId;
                        return (
                            <g key={g.id} opacity={dim ? 0.22 : 1}>
                                <rect
                                    x={gxv - markW / 2}
                                    y={y}
                                    width={markW}
                                    height={h}
                                    rx={Math.min(1.5, markW / 3)}
                                    fill={f.fill}
                                    fillOpacity={f.opacity}
                                    stroke={f.stroke}
                                    strokeWidth={f.stroke ? 1 : 0}
                                />
                                {g.event ? <circle cx={gxv} cy={g.home ? y - 5 : y + h + 5} r={2.2} fill={C.warn} /> : null}
                                {hot ? (
                                    <rect
                                        x={gxv - markW / 2 - 2.5}
                                        y={y - 2.5}
                                        width={markW + 5}
                                        height={h + 5}
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
                    {showToday ? <line x1={x(todayDay)} x2={x(todayDay)} y1={AXIS - MARK_MAX - 6} y2={AXIS + MARK_MAX + 6} stroke={C.ink} strokeOpacity={0.55} strokeDasharray="2 2" /> : null}

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

                    {/* range handles: drag either edge of the window (the whole season when nothing is focused) */}
                    {win
                        ? (['first', 'last'] as const).map(edge => {
                              const hx = edge === 'first' ? gx(win.first) - edgePad : gx(win.last) + edgePad;
                              const active = dragging === edge;
                              const quiet = focus.kind === 'season' && !active;
                              const g = games[win[edge]];
                              return (
                                  <g
                                      key={edge}
                                      role="slider"
                                      tabIndex={0}
                                      aria-label={edge === 'first' ? 'Start of the stretch' : 'End of the stretch'}
                                      aria-valuemin={1}
                                      aria-valuemax={games.length}
                                      aria-valuenow={win[edge] + 1}
                                      aria-valuetext={`Game ${win[edge] + 1}, ${g.date}`}
                                      className="group/edge cursor-ew-resize outline-none"
                                      style={{ touchAction: 'none' }}
                                      onPointerDown={e => {
                                          e.stopPropagation();
                                          (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
                                          drag.current = { edge, first: win.first, last: win.last };
                                          setDragging(edge);
                                      }}
                                      onPointerMove={e => {
                                          const d = drag.current;
                                          if (!d) return;
                                          e.stopPropagation();
                                          const next = moveEdge(d.edge, indexAt(e.clientX), d);
                                          drag.current = { ...d, ...next };
                                      }}
                                      onPointerUp={() => {
                                          drag.current = null;
                                          setDragging(null);
                                      }}
                                      onPointerCancel={() => {
                                          drag.current = null;
                                          setDragging(null);
                                      }}
                                      onClick={e => e.stopPropagation()}
                                      onKeyDown={e => {
                                          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                                          e.preventDefault();
                                          e.stopPropagation();
                                          moveEdge(edge, Math.min(games.length - 1, Math.max(0, win[edge] + (e.key === 'ArrowRight' ? 1 : -1))), win);
                                      }}
                                  >
                                      <rect x={hx - 14} y={0} width={28} height={MONTH_Y - 10} fill="transparent" />
                                      <line
                                          x1={hx}
                                          x2={hx}
                                          y1={2}
                                          y2={MONTH_Y - 12}
                                          stroke={C.brand}
                                          strokeOpacity={quiet ? 0.25 : active ? 1 : 0.7}
                                          strokeWidth={active ? 2 : 1.5}
                                          className="transition-[stroke-opacity] group-hover/edge:[stroke-opacity:1] group-focus-visible/edge:[stroke-opacity:1]"
                                      />
                                      <rect
                                          x={hx - 4.5}
                                          y={AXIS - 13}
                                          width={9}
                                          height={26}
                                          rx={4.5}
                                          fill="var(--surface-1)"
                                          stroke={C.brand}
                                          strokeOpacity={quiet ? 0.4 : 1}
                                          strokeWidth={1.25}
                                          className="transition-[stroke-opacity] group-hover/edge:[stroke-opacity:1] group-focus-visible/edge:[stroke-opacity:1]"
                                      />
                                      <g stroke={C.brand} strokeOpacity={quiet ? 0.5 : 1} strokeWidth={1} strokeLinecap="round">
                                          <line x1={hx - 1.5} x2={hx - 1.5} y1={AXIS - 5} y2={AXIS + 5} />
                                          <line x1={hx + 1.5} x2={hx + 1.5} y1={AXIS - 5} y2={AXIS + 5} />
                                      </g>
                                      {active || focus.kind === 'range' ? (
                                          <text
                                              x={edge === 'first' ? hx + 7 : hx - 7}
                                              y={10}
                                              textAnchor={edge === 'first' ? 'start' : 'end'}
                                              className="text-micro font-medium uppercase tabular-nums"
                                              fill={C.brand}
                                              style={{ letterSpacing: '0.08em', paintOrder: 'stroke', stroke: 'var(--surface-1)', strokeWidth: 3 }}
                                          >
                                              {g.date.slice(5).replace('-', '/')}
                                          </text>
                                      ) : null}
                                  </g>
                              );
                          })
                        : null}

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
