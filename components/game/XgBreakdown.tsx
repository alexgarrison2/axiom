'use client';

import * as React from 'react';
import { periodLabel, shortName } from '@/lib/game/analytics';
import { SIDES, type GameEvent, type Player, type Side } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';
import { TipFace, TipRow, useHoverTip } from './HoverTip';
import { useWidth } from './Pulse';

type Result = 'goal' | 'iron' | 'save' | 'miss';
type State = 'ev' | 'pp' | 'ea' | 'sh';

const RESULTS: { key: Result; label: string }[] = [
    { key: 'goal', label: 'Goal' },
    { key: 'iron', label: 'Iron' },
    { key: 'save', label: 'Save' },
    { key: 'miss', label: 'Miss' },
];
const STATES: { key: State; label: string; title: string }[] = [
    { key: 'ev', label: 'EV', title: 'Even strength' },
    { key: 'pp', label: 'PP', title: 'Power play' },
    { key: 'ea', label: 'EA', title: 'Extra attacker (own goalie pulled)' },
    { key: 'sh', label: 'SH', title: 'Shorthanded' },
];

const resultOf = (e: GameEvent): Result => (e.type === 'goal' ? 'goal' : e.type === 'shot' ? 'save' : /post|crossbar/.test(e.detail ?? '') ? 'iron' : 'miss');
const stateOf = (e: GameEvent): State => {
    const ownGoalie = e.side === 'away' ? e.situation.awayGoalie : e.situation.homeGoalie;
    if (!ownGoalie) return 'ea';
    return e.strength;
};

/** Result fill: goals in the full team colour, saves at half strength, iron in white, misses in grey. */
function fillFor(r: Result, color: string): { fill: string; opacity: number } {
    if (r === 'goal') return { fill: color, opacity: 1 };
    if (r === 'save') return { fill: color, opacity: 0.5 };
    if (r === 'iron') return { fill: 'var(--text-1)', opacity: 0.9 };
    return { fill: 'var(--text-3)', opacity: 0.4 };
}

type Rect<T> = { x: number; y: number; w: number; h: number; d: T };

/** Squarified treemap (Bruls et al.): tiles stay close to square so small shots stay visible. */
function squarify<T>(items: { v: number; d: T }[], x: number, y: number, w: number, h: number): Rect<T>[] {
    const out: Rect<T>[] = [];
    const total = items.reduce((a, i) => a + i.v, 0);
    if (total <= 0 || w <= 0 || h <= 0) return out;
    const k = (w * h) / total;
    let rest = items.map(i => ({ a: i.v * k, d: i.d })).sort((p, q) => q.a - p.a);
    const worst = (row: { a: number }[], side: number) => {
        const s = row.reduce((a, r) => a + r.a, 0);
        const mx = Math.max(...row.map(r => r.a));
        const mn = Math.min(...row.map(r => r.a));
        return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
    };
    while (rest.length) {
        const side = Math.min(w, h);
        const row = [rest[0]];
        let i = 1;
        while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) row.push(rest[i++]);
        rest = rest.slice(i);
        const s = row.reduce((a, r) => a + r.a, 0);
        if (w >= h) {
            const cw = s / h;
            let yy = y;
            for (const r of row) {
                const rh = r.a / cw;
                out.push({ x, y: yy, w: cw, h: rh, d: r.d });
                yy += rh;
            }
            x += cw;
            w -= cw;
        } else {
            const rh = s / w;
            let xx = x;
            for (const r of row) {
                const rw = r.a / rh;
                out.push({ x: xx, y, w: rw, h: rh, d: r.d });
                xx += rw;
            }
            y += rh;
            h -= rh;
        }
    }
    return out;
}

interface Row {
    key: string;
    label: string;
    player: Player | null;
    xg: number;
    shots: GameEvent[];
}

const MIN_ROW = 16;

function ShotTip({ e }: { e: GameEvent }) {
    const { byId, colors, m } = useGame();
    const p = e.player != null ? byId.get(e.player) : undefined;
    const g = e.other != null ? byId.get(e.other) : undefined;
    const r = resultOf(e);
    const st = stateOf(e);
    const dist = e.x != null && e.y != null ? Math.round(Math.hypot(89 - Math.abs(e.x), e.y)) : null;
    return (
        <div className="flex w-56 flex-col gap-1.5">
            <div className="flex items-center gap-2">
                <TipFace p={p} color={colors[e.side]} />
                <span className="min-w-0 leading-tight">
                    <span className="block truncate font-bold text-fg-1">{p ? `${p.first} ${p.last}` : m.teams[e.side].tri}</span>
                    <span className="text-micro text-fg-3">
                        {periodLabel(e.period)} {e.clock} · {m.teams[e.side].tri}
                    </span>
                </span>
                <span className="ml-auto font-display text-title font-bold text-model">{(e.xg ?? 0).toFixed(2)}</span>
            </div>
            <TipRow k="Result">{RESULTS.find(x => x.key === r)!.label}{r === 'iron' || r === 'miss' ? <span className="text-fg-3"> · {(e.detail ?? '').replace(/-/g, ' ')}</span> : null}</TipRow>
            <TipRow k="Strength">{STATES.find(x => x.key === st)!.title}</TipRow>
            {e.shotType ? <TipRow k="Shot">{e.shotType.replace(/-/g, ' ')}</TipRow> : null}
            {dist != null ? <TipRow k="Distance">{dist} ft</TipRow> : null}
            {g && r !== 'miss' && r !== 'iron' ? <TipRow k="Goalie">{shortName(g)}</TipRow> : null}
        </div>
    );
}

function Swatch({ r, s, color }: { r: Result; s: State; color: string }) {
    const f = fillFor(r, color);
    return (
        <svg viewBox="0 0 28 14" className="h-3.5 w-7" aria-hidden="true">
            <rect width={28} height={14} fill={f.fill} opacity={f.opacity} />
            {s !== 'ev' ? <rect width={28} height={14} fill={`url(#xgb-${s})`} /> : null}
        </svg>
    );
}

/**
 * Every unblocked attempt as a tile sized by its pony xG, grouped into one row
 * per shooter (biggest at the bottom) and one column per team scaled to the
 * team's total. Fill is the result, texture the strength state.
 */
export function XgBreakdown() {
    const { m, byId, colors } = useGame();
    const [ref, width] = useWidth<HTMLDivElement>();
    const { bind, tip } = useHoverTip();
    const compact = width > 0 && width < 640;

    const data = React.useMemo(() => {
        const out = {} as Record<Side, { total: number; goals: number; rows: Row[] }>;
        for (const side of SIDES) {
            const shots = m.events.filter(e => e.side === side && (e.type === 'goal' || e.type === 'shot' || e.type === 'miss') && e.xg != null && e.xg > 0);
            const by = new Map<number, GameEvent[]>();
            for (const e of shots) {
                const k = e.player ?? -1;
                by.set(k, [...(by.get(k) ?? []), e]);
            }
            const rows: Row[] = [...by.entries()].map(([id, list]) => {
                const p = byId.get(id) ?? null;
                return { key: String(id), label: p ? p.last : 'Unknown', player: p, xg: list.reduce((a, e) => a + (e.xg ?? 0), 0), shots: list };
            });
            out[side] = { total: shots.reduce((a, e) => a + (e.xg ?? 0), 0), goals: shots.filter(e => e.type === 'goal').length, rows };
        }
        return out;
    }, [m, byId]);

    const maxTotal = Math.max(data.away.total, data.home.total);
    if (!maxTotal) {
        return (
            <GameSection id="xg" title="xG breakdown">
                <p className="panel p-card label">{m.xgPending ? 'xG after the nightly run' : 'No shots yet'}</p>
            </GameSection>
        );
    }

    const W = Math.max(width, 320);
    const gutter = compact ? 104 : 150;
    const gap = compact ? 0 : 28;
    const colW = compact ? W - gutter - 4 : (W - 2 * gutter - gap) / 2;
    const scale = (compact ? 380 : 540) / maxTotal;
    const head = 34;

    // Shooters too small to read get folded into "All others" at the top of the column.
    const layout = (side: Side) => {
        const d = data[side];
        const big = d.rows.filter(r => r.xg * scale >= MIN_ROW).sort((a, b) => a.xg - b.xg);
        const small = d.rows.filter(r => r.xg * scale < MIN_ROW);
        const rows = small.length ? [{ key: 'others', label: 'All others', player: null, xg: small.reduce((a, r) => a + r.xg, 0), shots: small.flatMap(r => r.shots) }, ...big] : big;
        return { rows, h: d.total * scale };
    };
    const L = { away: layout('away'), home: layout('home') };
    const colH = Math.max(L.away.h, L.home.h);
    const blockH = head + colH;
    const H = compact ? blockH * 2 + 24 : blockH;

    const column = (side: Side, x0: number, top: number) => {
        const { rows, h } = L[side];
        const color = colors[side];
        const mirror = !compact && side === 'home';
        let y = top + head + (colH - h);
        return (
            <g key={side}>
                {/* Team chip above the column. */}
                <g transform={`translate(${x0 + colW / 2},${top + head + (colH - h) - 12})`}>
                    <text textAnchor="middle" className="text-caption font-bold" fill={color}>
                        {m.teams[side].tri} {data[side].total.toFixed(2)} xG
                        <tspan className="fill-fg-3 font-normal"> · {data[side].goals} G</tspan>
                    </text>
                </g>
                {rows.map(r => {
                    const rh = r.xg * scale;
                    const tiles = squarify(r.shots.map(e => ({ v: e.xg ?? 0, d: e })), x0, y, colW, rh);
                    const ly = y + rh / 2 + 4;
                    const el = (
                        <g key={r.key}>
                            {tiles.map(t => {
                                const res = resultOf(t.d);
                                const st = stateOf(t.d);
                                const f = fillFor(res, color);
                                return (
                                    <g key={t.d.id} {...bind(<ShotTip e={t.d} />)} className="cursor-crosshair">
                                        <rect x={t.x} y={t.y} width={t.w} height={t.h} fill={f.fill} opacity={f.opacity} />
                                        {st !== 'ev' ? <rect x={t.x} y={t.y} width={t.w} height={t.h} fill={`url(#xgb-${st})`} /> : null}
                                        <rect x={t.x} y={t.y} width={t.w} height={t.h} fill="none" stroke="var(--surface-1)" strokeWidth={1} className="hover:stroke-fg-1" />
                                    </g>
                                );
                            })}
                            <rect x={x0} y={y} width={colW} height={rh} fill="none" stroke="var(--surface-1)" strokeWidth={2} pointerEvents="none" />
                            <text x={mirror ? x0 + colW + 10 : x0 - 10} y={ly} textAnchor={mirror ? 'start' : 'end'} className="text-caption">
                                {mirror ? (
                                    <>
                                        <tspan className={r.player ? 'fill-fg-1' : 'fill-fg-3'}>{r.label}</tspan>
                                        <tspan className="fill-model"> {r.xg.toFixed(2)}</tspan>
                                    </>
                                ) : (
                                    <>
                                        <tspan className="fill-model">{r.xg.toFixed(2)} </tspan>
                                        <tspan className={r.player ? 'fill-fg-1' : 'fill-fg-3'}>{r.label}</tspan>
                                    </>
                                )}
                            </text>
                        </g>
                    );
                    y += rh;
                    return el;
                })}
            </g>
        );
    };

    return (
        <GameSection id="xg" title="xG breakdown">
            <div className="panel overflow-hidden">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-card py-2 text-micro uppercase tracking-label text-fg-3">
                    {RESULTS.map(r => (
                        <span key={r.key} className="flex items-center gap-1.5">
                            <Swatch r={r.key} s="ev" color={colors.away} />
                            {r.label}
                        </span>
                    ))}
                    <span className="hidden h-4 w-px bg-line sm:block" aria-hidden="true" />
                    {STATES.map(s => (
                        <span key={s.key} className="flex items-center gap-1.5" title={s.title}>
                            <Swatch r="save" s={s.key} color="var(--text-2)" />
                            {s.label}
                        </span>
                    ))}
                    <span className="ml-auto normal-case tracking-normal">Size = pony xG · blocked attempts carry none</span>
                </div>
                <div ref={ref} className="p-card">
                    {width ? (
                        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`pony xG by shooter: ${m.teams.away.tri} ${data.away.total.toFixed(2)}, ${m.teams.home.tri} ${data.home.total.toFixed(2)}`} className="block font-mono tabular-nums">
                            <defs>
                                <pattern id="xgb-pp" width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                                    <line x1={0} y1={0} x2={0} y2={7} stroke="var(--bg)" strokeWidth={1.6} strokeOpacity={0.7} />
                                </pattern>
                                <pattern id="xgb-ea" width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                                    <line x1={0} y1={0} x2={0} y2={7} stroke="var(--bg)" strokeWidth={1.4} strokeOpacity={0.7} />
                                    <line x1={0} y1={0} x2={7} y2={0} stroke="var(--bg)" strokeWidth={1.4} strokeOpacity={0.7} />
                                </pattern>
                                <pattern id="xgb-sh" width={7} height={7} patternUnits="userSpaceOnUse">
                                    <circle cx={3.5} cy={3.5} r={1.2} fill="var(--bg)" fillOpacity={0.75} />
                                </pattern>
                            </defs>
                            {compact ? (
                                <>
                                    {column('away', gutter, 0)}
                                    {column('home', gutter, blockH + 24)}
                                </>
                            ) : (
                                <>
                                    {column('away', gutter, 0)}
                                    {column('home', gutter + colW + gap, 0)}
                                </>
                            )}
                        </svg>
                    ) : (
                        <div className="h-[420px] md:h-[580px]" aria-hidden="true" />
                    )}
                    {tip}
                </div>
            </div>
        </GameSection>
    );
}

