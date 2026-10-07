'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useWidth } from '@/components/game/Pulse';
import { cn } from '@/lib/utils';
import type { GsPart } from '@/lib/game/analytics';
import { ORDER, PARTS, signed } from '@/lib/pony/parts';

export interface TrendGame {
    game: number;
    date: string;
    opp: string;
    home: boolean;
    result: string;
    ps: number;
    toi: number;
    parts: Record<GsPart, number> | null;
    line: string;
}

/**
 * A season of Pony Scores: one signed bar per game in the team colour (dim
 * below zero), the five-game rolling average as a magenta line, and a card on
 * hover. Click a bar to open the game.
 */
export function PonyTrend({ games, color }: { games: TrendGame[]; color: string }) {
    const [ref, width] = useWidth<HTMLDivElement>();
    const [hover, setHover] = React.useState<number | null>(null);
    const router = useRouter();
    const W = Math.max(width, 280);
    const H = 180;
    const padL = 34;
    const padR = 8;
    const reach = Math.max(1, Math.ceil(Math.max(...games.map(g => Math.abs(g.ps))) * 2) / 2);
    const plot = W - padL - padR;
    const step = plot / Math.max(1, games.length);
    const bw = Math.max(2, Math.min(18, step - 2));
    const y = (v: number) => H / 2 - (v / reach) * (H / 2 - 10);
    const roll = games.map((_, i) => {
        const s = games.slice(Math.max(0, i - 4), i + 1);
        return s.reduce((a, g) => a + g.ps, 0) / s.length;
    });
    const line = roll.map((v, i) => `${i ? 'L' : 'M'}${(padL + step * (i + 0.5)).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const ticks = [reach, reach / 2, 0, -reach / 2, -reach];
    const hg = hover != null ? games[hover] : null;
    const hx = hover != null ? padL + step * (hover + 0.5) : 0;

    const onMove = (e: React.PointerEvent<SVGRectElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        const i = Math.floor(((e.clientX - r.left) / r.width) * games.length);
        setHover(Math.max(0, Math.min(games.length - 1, i)));
    };

    return (
        <div ref={ref} className="relative">
            {width ? (
                <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="block select-none tabular-nums" role="img" aria-label={`Pony Score in ${games.length} games, five-game average ${signed(roll[roll.length - 1] ?? 0)}`}>
                    {ticks.map(t => (
                        <g key={t}>
                            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-fg-3' : 'stroke-line'} strokeWidth={1} strokeDasharray={t === 0 ? undefined : '2 4'} />
                            <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="fill-fg-3 text-micro">
                                {t === 0 ? '0' : signed(t, 1)}
                            </text>
                        </g>
                    ))}
                    {games.map((g, i) => {
                        const x0 = padL + step * (i + 0.5) - bw / 2;
                        return (
                            <rect
                                key={g.game}
                                x={x0}
                                y={g.ps >= 0 ? y(g.ps) : y(0)}
                                width={bw}
                                height={Math.max(1.5, Math.abs(y(g.ps) - y(0)))}
                                rx={Math.min(2, bw / 3)}
                                fill={g.ps >= 0 ? color : 'var(--text-3)'}
                                opacity={hover == null || hover === i ? (g.ps >= 0 ? 0.9 : 0.55) : 0.3}
                            />
                        );
                    })}
                    <path d={line} fill="none" className="stroke-model" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    {hover != null ? <line x1={hx} x2={hx} y1={4} y2={H - 4} className="stroke-fg-1" strokeOpacity={0.35} /> : null}
                    <rect
                        x={padL}
                        y={0}
                        width={plot}
                        height={H}
                        fill="transparent"
                        className="cursor-pointer"
                        onPointerMove={onMove}
                        onPointerDown={onMove}
                        onPointerLeave={() => setHover(null)}
                        onClick={() => hg && router.push(`/games/${hg.game}`)}
                    />
                </svg>
            ) : (
                <div style={{ height: H }} aria-hidden="true" />
            )}
            {hg ? (
                <div
                    className="pointer-events-none absolute top-1 z-10 w-[19rem] rounded-card border border-line-strong bg-surface-1/95 p-3 text-caption shadow-[0_12px_32px_rgb(0_0_0/0.55)] backdrop-blur-sm"
                    style={hx > W * 0.6 ? { right: W - hx + 12 } : { left: hx + 12 }}
                >
                    <p className="flex items-baseline justify-between gap-2">
                        <span className="text-fg-2">
                            {hg.date} · {hg.home ? 'vs' : '@'} {hg.opp} · <span className={cn(hg.result === 'W' ? 'text-fg-1' : 'text-fg-3')}>{hg.result}</span>
                        </span>
                        <span className={cn('font-display text-title font-bold tabular-nums', hg.ps < 0 ? 'text-fg-2' : 'text-fg-1')}>{signed(hg.ps)}</span>
                    </p>
                    <p className="mt-1 text-micro text-fg-3">{hg.line}</p>
                    {hg.parts ? (
                        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 whitespace-nowrap">
                            {ORDER.map(k => (
                                <span key={k} className="flex items-center justify-between gap-2 tabular-nums">
                                    <span className="flex items-center gap-1.5 text-micro text-fg-3">
                                        <span className="h-2 w-2 rounded-[2px]" style={{ background: PARTS[k].color }} />
                                        {PARTS[k].label}
                                    </span>
                                    <span className={Math.abs(hg.parts![k]) < 0.005 ? 'text-fg-3' : 'text-fg-1'}>{signed(hg.parts![k])}</span>
                                </span>
                            ))}
                        </div>
                    ) : null}
                    <p className="mt-2 text-micro uppercase tracking-label text-fg-3">5-game avg {signed(roll[hover!])} · click for the game</p>
                </div>
            ) : null}
        </div>
    );
}
