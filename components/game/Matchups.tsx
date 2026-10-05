'use client';

import * as React from 'react';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { clockOf, matchups, units } from '@/lib/game/analytics';
import type { Player, Side } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';
import { useWidth } from './Pulse';

/** Skaters in line order: 5v5 forward lines, then D pairs, then anyone left. */
function ordered(m: ReturnType<typeof useGame>['m'], side: Side, byId: Map<number, Player>): Player[] {
    const seen = new Set<number>();
    const out: Player[] = [];
    for (const u of [...units(m, side, 'F').slice(0, 4), ...units(m, side, 'D').slice(0, 3)]) {
        for (const id of u.ids) {
            if (seen.has(id)) continue;
            const p = byId.get(id);
            if (p) {
                seen.add(id);
                out.push(p);
            }
        }
    }
    for (const p of m.players) if (p.side === side && p.pos !== 'G' && m.shifts[p.id] && !seen.has(p.id)) out.push(p);
    return out;
}

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

export function Matchups() {
    const { m, colors, byId, label } = useGame();
    const grid = React.useMemo(() => matchups(m), [m]);
    const away = React.useMemo(() => ordered(m, 'away', byId), [m, byId]);
    const home = React.useMemo(() => ordered(m, 'home', byId), [m, byId]);
    const [hover, setHover] = React.useState<{ a: Player; h: Player } | null>(null);
    const [boxRef, boxW] = useWidth<HTMLDivElement>();
    let max = 1;
    for (const row of grid.values()) for (const c of row.values()) max = Math.max(max, c.toi);
    const gutter = 120;
    // Fill the panel: cells grow with the width, 22px floor (the grid scrolls sideways on phones), 44px ceiling.
    const CELL = Math.max(22, Math.min(44, Math.floor(((boxW || 600) - gutter - 8) / Math.max(1, home.length))));
    const W = gutter + home.length * CELL;
    const H = 96 + away.length * CELL;
    const cur = hover ? grid.get(hover.a.id)?.get(hover.h.id) : null;

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
                    <span className="ml-auto normal-case tracking-normal text-fg-1" aria-live="polite">
                        {hover && cur ? (
                            <>
                                {label(hover.a.id)} vs {label(hover.h.id)} · {clockOf(cur.toi)} ·{' '}
                                <span style={{ color: colors.away }}>{cur.xg.away.toFixed(2)}</span>–<span style={{ color: colors.home }}>{cur.xg.home.toFixed(2)}</span> xG
                            </>
                        ) : null}
                    </span>
                </p>
                <div ref={boxRef} className="min-w-0 px-card">
                <ScrollRegion label="5v5 matchup grid" className="py-card">
                    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`5v5 time and xG for every ${m.teams.away.tri} skater against every ${m.teams.home.tri} skater`} className="block font-mono">
                        {home.map((p, j) => (
                            <text key={p.id} transform={`translate(${gutter + j * CELL + CELL / 2 - 4},90) rotate(-60)`} className="text-micro" fill={colors.home}>
                                {label(p.id)}
                            </text>
                        ))}
                        {away.map((a, i) => (
                            <g key={a.id} transform={`translate(0,${96 + i * CELL})`}>
                                <text x={gutter - 8} y={CELL / 2 + 4} textAnchor="end" className="text-micro" fill={colors.away}>
                                    {label(a.id)}
                                </text>
                                {home.map((h, j) => {
                                    const c = grid.get(a.id)?.get(h.id);
                                    const cx = gutter + j * CELL;
                                    if (!c || c.toi < 5) return <rect key={h.id} x={cx + CELL / 2 - 1} y={CELL / 2 - 1} width={2} height={2} className="fill-line-strong" />;
                                    const s = Math.max(6, Math.sqrt(c.toi / max) * (CELL - 3));
                                    const x0 = cx + (CELL - s) / 2;
                                    const y0 = (CELL - s) / 2;
                                    const tot = c.xg.away + c.xg.home;
                                    const share = tot > 0 ? c.xg.away / tot : null;
                                    return (
                                        <g key={h.id} onPointerEnter={() => setHover({ a, h })} onPointerLeave={() => setHover(null)}>
                                            <title>{`${label(a.id)} vs ${label(h.id)}: ${clockOf(c.toi)}, xG ${c.xg.away.toFixed(2)}–${c.xg.home.toFixed(2)}`}</title>
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
                </ScrollRegion>
                </div>
            </div>
        </GameSection>
    );
}
