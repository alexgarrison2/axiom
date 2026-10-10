'use client';

import * as React from 'react';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { clockOf, matchups, units, type Matchup } from '@/lib/game/analytics';
import type { Player, Side } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';
import { TipFace, useHoverTip } from './HoverTip';
import { useWidth } from './Pulse';

/** A gap before row/column `at`: between lines and pairs, or (strong) where forwards give way to defence. */
type Cut = { at: number; strong: boolean };

/** Skaters in line order: 5v5 forward lines, then D pairs, then anyone left, with a cut between each group. */
function ordered(m: ReturnType<typeof useGame>['m'], side: Side, byId: Map<number, Player>): { list: Player[]; cuts: Cut[] } {
    const seen = new Set<number>();
    const list: Player[] = [];
    const cuts: Cut[] = [];
    const groups = [
        ...units(m, side, 'F').slice(0, 4).map(u => ({ ids: u.ids, kind: 'F' })),
        ...units(m, side, 'D').slice(0, 3).map(u => ({ ids: u.ids, kind: 'D' })),
        { ids: m.players.filter(p => p.side === side && p.pos !== 'G' && m.shifts[p.id]).map(p => p.id), kind: 'X' },
    ];
    let prev: string | null = null;
    for (const g of groups) {
        const add = g.ids.map(id => byId.get(id)).filter((p): p is Player => !!p && !seen.has(p.id));
        if (!add.length) continue;
        if (prev) cuts.push({ at: list.length, strong: prev !== g.kind });
        prev = g.kind;
        for (const p of add) {
            seen.add(p.id);
            list.push(p);
        }
    }
    return { list, cuts };
}

/** Offset of row/column `i`: whole cells plus a gap for every cut at or before it. */
const offsetOf = (i: number, cell: number, gap: number, cuts: Cut[]) => i * cell + gap * cuts.filter(c => c.at <= i).length;

/** Area-true split: the upper-left part of an s-square covering `share` of it, cut along the anti-diagonal direction. */
function splitPath(x0: number, y0: number, s: number, share: number): string {
    if (share <= 0) return '';
    if (share >= 1) return `M${x0},${y0}h${s}v${s}h${-s}Z`;
    if (share <= 0.5) {
        const l = s * Math.sqrt(2 * share);
        return `M${x0},${y0}h${l}L${x0},${y0 + l}Z`;
    }
    const l = s * Math.sqrt(2 * (1 - share));
    return `M${x0},${y0}h${s}v${s - l}L${x0 + s - l},${y0 + s}H${x0}Z`;
}

/** Head-to-head card: both faces, 5v5 time, then attempts / xG / goals mirrored on each side. */
function MatchupTip({ a, h, c }: { a: Player; h: Player; c: Matchup }) {
    const { m, colors } = useGame();
    const tot = c.xg.away + c.xg.home;
    const share = tot > 0 ? c.xg.away / tot : 0.5;
    const row = (k: string, av: string, hv: string) => (
        <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-3">
            <span className="text-left font-semibold" style={{ color: colors.away }}>
                {av}
            </span>
            <span className="text-micro uppercase tracking-label text-fg-3">{k}</span>
            <span className="text-right font-semibold" style={{ color: colors.home }}>
                {hv}
            </span>
        </div>
    );
    return (
        <div className="flex w-60 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <TipFace p={a} color={colors.away} />
                    <span className="min-w-0 leading-tight">
                        <span className="block truncate font-bold text-fg-1">{a.last}</span>
                        <span className="text-micro text-fg-3">
                            {m.teams.away.tri} · {a.pos}
                        </span>
                    </span>
                </div>
                <div className="flex min-w-0 items-center gap-2 text-right">
                    <span className="min-w-0 leading-tight">
                        <span className="block truncate font-bold text-fg-1">{h.last}</span>
                        <span className="text-micro text-fg-3">
                            {h.pos} · {m.teams.home.tri}
                        </span>
                    </span>
                    <TipFace p={h} color={colors.home} />
                </div>
            </div>
            <p className="text-center text-micro uppercase tracking-label text-fg-3">
                <span className="text-body font-bold normal-case tracking-normal text-fg-1">{clockOf(c.toi)}</span> 5v5 together
            </p>
            {row('Att', String(c.att.away), String(c.att.home))}
            {row('xG', c.xg.away.toFixed(2), c.xg.home.toFixed(2))}
            {row('Goals', String(c.g.away), String(c.g.home))}
            <div className="flex h-1.5 overflow-hidden rounded-full" aria-hidden="true">
                <span style={{ width: `${share * 100}%`, background: colors.away }} />
                <span className="flex-1" style={{ background: colors.home }} />
            </div>
            <p className="text-center text-micro uppercase tracking-label text-fg-3">xG share {Math.round(share * 100)}–{Math.round((1 - share) * 100)}</p>
        </div>
    );
}

export function Matchups() {
    const { m, colors, byId, label } = useGame();
    const grid = React.useMemo(() => matchups(m), [m]);
    const rows = React.useMemo(() => ordered(m, 'away', byId), [m, byId]);
    const cols = React.useMemo(() => ordered(m, 'home', byId), [m, byId]);
    const away = rows.list;
    const home = cols.list;
    const { bind, tip } = useHoverTip();
    const [boxRef, boxW] = useWidth<HTMLDivElement>();
    let max = 1;
    for (const row of grid.values()) for (const c of row.values()) max = Math.max(max, c.toi);
    const gutter = 120;
    // Fill the panel: cells grow with the width, 22px floor (the grid scrolls sideways on phones), 44px ceiling.
    const GAP = (boxW || 600) < 640 ? 4 : 6;
    const CELL = Math.max(22, Math.min(44, Math.floor(((boxW || 600) - gutter - 8 - GAP * cols.cuts.length) / Math.max(1, home.length))));
    const X = (j: number) => gutter + offsetOf(j, CELL, GAP, cols.cuts);
    const W = X(home.length);
    // Room for the slanted column names: 96px on wide screens; phones trim it to the longest name.
    const longest = Math.max(0, ...home.map(p => label(p.id).length));
    const head = boxW > 0 && boxW < 640 ? Math.min(96, Math.ceil(longest * 6.4 * 0.87) + 14) : 96;
    const Y = (i: number) => head + offsetOf(i, CELL, GAP, rows.cuts);
    const H = Y(away.length);

    return (
        <GameSection id="matchups" title="Matchups">
            <div className="panel overflow-hidden">
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-card py-2 text-micro uppercase tracking-label text-fg-3">
                    <span>5v5</span>
                    <span>Size = time head to head</span>
                    <span className="flex items-center gap-1.5">
                        Split = xG share
                        <span className="h-2.5 w-2.5" style={{ background: colors.away }} />
                        {m.teams.away.tri}
                        <span className="h-2.5 w-2.5" style={{ background: colors.home }} />
                        {m.teams.home.tri}
                    </span>
                </p>
                <div ref={boxRef} className="min-w-0 px-card">
                <ScrollRegion label="5v5 matchup grid" className="py-card">
                    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`5v5 time and xG for every ${m.teams.away.tri} skater against every ${m.teams.home.tri} skater`} className="block font-mono">
                        {home.map((p, j) => (
                            <text key={p.id} transform={`translate(${X(j) + CELL / 2 - 4},${head - 6}) rotate(-60)`} className="text-micro" fill={colors.home}>
                                {label(p.id)}
                            </text>
                        ))}
                        {/* Hairlines in the gaps: faint between lines and pairs, firmer where forwards meet defence. */}
                        {cols.cuts.map(c => (
                            <line key={`c${c.at}`} x1={X(c.at) - GAP / 2} x2={X(c.at) - GAP / 2} y1={head} y2={H} className={c.strong ? 'stroke-line-strong' : 'stroke-line'} />
                        ))}
                        {rows.cuts.map(c => (
                            <line key={`r${c.at}`} y1={Y(c.at) - GAP / 2} y2={Y(c.at) - GAP / 2} x1={gutter - 4} x2={W} className={c.strong ? 'stroke-line-strong' : 'stroke-line'} />
                        ))}
                        {away.map((a, i) => (
                            <g key={a.id} transform={`translate(0,${Y(i)})`}>
                                <text x={gutter - 8} y={CELL / 2 + 4} textAnchor="end" className="text-micro" fill={colors.away}>
                                    {label(a.id)}
                                </text>
                                {home.map((h, j) => {
                                    const c = grid.get(a.id)?.get(h.id);
                                    const cx = X(j);
                                    if (!c || c.toi < 5) return <rect key={h.id} x={cx + CELL / 2 - 1} y={CELL / 2 - 1} width={2} height={2} className="fill-line-strong" />;
                                    const s = Math.max(6, Math.sqrt(c.toi / max) * (CELL - 3));
                                    const x0 = cx + (CELL - s) / 2;
                                    const y0 = (CELL - s) / 2;
                                    const tot = c.xg.away + c.xg.home;
                                    const share = tot > 0 ? c.xg.away / tot : null;
                                    return (
                                        <g key={h.id} {...bind(<MatchupTip a={a} h={h} c={c} />)} className="cursor-crosshair">
                                            <rect x={cx} y={0} width={CELL} height={CELL} fill="transparent" />
                                            {share == null ? (
                                                <rect x={x0} y={y0} width={s} height={s} className="fill-mute" />
                                            ) : (
                                                <>
                                                    <rect x={x0} y={y0} width={s} height={s} fill={colors.home} />
                                                    {/* The away share as area: a corner triangle up to half, the square less the opposite corner above it. */}
                                                    <path d={splitPath(x0, y0, s, share)} fill={colors.away} />
                                                </>
                                            )}
                                        </g>
                                    );
                                })}
                            </g>
                        ))}
                    </svg>
                    {tip}
                </ScrollRegion>
                </div>
            </div>
        </GameSection>
    );
}
