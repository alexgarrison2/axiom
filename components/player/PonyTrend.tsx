'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useWidth } from '@/components/game/Pulse';
import type { GsPart } from '@/lib/game/analytics';
import { signed } from '@/lib/pony/parts';

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

/** Five-game rolling average, one value per game. */
export function rollingAverage(games: TrendGame[]): number[] {
    return games.map((_, i) => {
        const s = games.slice(Math.max(0, i - 4), i + 1);
        return s.reduce((a, g) => a + g.ps, 0) / s.length;
    });
}

/**
 * A season of Pony Scores: one signed bar per game in the team colour (dim
 * below zero) and the five-game rolling average as a magenta line. Nothing
 * floats over the bars: the picked game (`hover`, owned by the parent) is read
 * out in the panels around the chart. A mouse hovers and clicks a bar to open
 * the game; on touch the first tap (or a sideways scrub) picks a game and a
 * second tap on the same bar opens it.
 */
export function PonyTrend({ games, color, hover, onHover }: { games: TrendGame[]; color: string; hover: number | null; onHover: (i: number | null) => void }) {
    const [ref, width] = useWidth<HTMLDivElement>();
    const router = useRouter();
    // Touch: the bar that was already picked when this tap began (a second tap opens it).
    const armed = React.useRef<number | null>(null);
    const touch = React.useRef(false);
    const W = Math.max(width, 280);
    const H = 180;
    const padL = 34;
    const padR = 8;
    const reach = Math.max(1, Math.ceil(Math.max(...games.map(g => Math.abs(g.ps))) * 2) / 2);
    const plot = W - padL - padR;
    const step = plot / Math.max(1, games.length);
    const bw = Math.max(2, Math.min(18, step - 2));
    const y = (v: number) => H / 2 - (v / reach) * (H / 2 - 10);
    const roll = rollingAverage(games);
    const line = roll.map((v, i) => `${i ? 'L' : 'M'}${(padL + step * (i + 0.5)).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const ticks = [reach, reach / 2, 0, -reach / 2, -reach];
    const hx = hover != null ? padL + step * (hover + 0.5) : 0;

    const at = (e: React.PointerEvent<SVGRectElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        return Math.max(0, Math.min(games.length - 1, Math.floor(((e.clientX - r.left) / r.width) * games.length)));
    };
    const onMove = (e: React.PointerEvent<SVGRectElement>) => {
        if (e.pointerType === 'mouse' || e.buttons) onHover(at(e));
    };
    const onDown = (e: React.PointerEvent<SVGRectElement>) => {
        touch.current = e.pointerType !== 'mouse';
        armed.current = hover;
        onHover(at(e));
    };

    return (
        // Sideways drags scrub the bars; vertical swipes still scroll the page.
        <div ref={ref} className="relative touch-pan-y">
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
                    {hover != null ? (
                        <>
                            <line x1={hx} x2={hx} y1={4} y2={H - 4} className="stroke-fg-1" strokeOpacity={0.35} />
                            <circle cx={hx} cy={y(roll[hover])} r={3.5} className="fill-model stroke-surface-1" strokeWidth={1.5} />
                        </>
                    ) : null}
                    <rect
                        x={padL}
                        y={0}
                        width={plot}
                        height={H}
                        fill="transparent"
                        className="cursor-pointer"
                        onPointerMove={onMove}
                        onPointerDown={onDown}
                        onPointerLeave={e => e.pointerType === 'mouse' && onHover(null)}
                        onPointerCancel={() => onHover(null)}
                        onClick={() => {
                            const g = hover != null ? games[hover] : null;
                            if (g && (!touch.current || armed.current === hover)) router.push(`/games/${g.game}`);
                        }}
                    />
                </svg>
            ) : (
                <div style={{ height: H }} aria-hidden="true" />
            )}
        </div>
    );
}
