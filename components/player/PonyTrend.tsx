'use client';

import * as React from 'react';
import Link from 'next/link';
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
 * hover. Click a bar to open the game. On touch the first tap (or a sideways
 * scrub) shows the card and a second tap on the same bar opens the game; on a
 * phone the card sits under the chart, in flow, with its own Game link.
 */
export function PonyTrend({ games, color }: { games: TrendGame[]; color: string }) {
    const [ref, width] = useWidth<HTMLDivElement>();
    const [hover, setHover] = React.useState<number | null>(null);
    const router = useRouter();
    // Touch: the bar whose card was already showing when this tap began (a second tap opens it).
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
    const roll = games.map((_, i) => {
        const s = games.slice(Math.max(0, i - 4), i + 1);
        return s.reduce((a, g) => a + g.ps, 0) / s.length;
    });
    const line = roll.map((v, i) => `${i ? 'L' : 'M'}${(padL + step * (i + 0.5)).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const ticks = [reach, reach / 2, 0, -reach / 2, -reach];
    const hg = hover != null ? games[hover] : null;
    const hx = hover != null ? padL + step * (hover + 0.5) : 0;

    // Too narrow for the card beside the bar (phones): it opens under the chart, covering nothing.
    const compact = W < 480;

    const at = (e: React.PointerEvent<SVGRectElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        return Math.max(0, Math.min(games.length - 1, Math.floor(((e.clientX - r.left) / r.width) * games.length)));
    };
    const onMove = (e: React.PointerEvent<SVGRectElement>) => {
        if (e.pointerType === 'mouse' || e.buttons) setHover(at(e));
    };
    const onDown = (e: React.PointerEvent<SVGRectElement>) => {
        touch.current = e.pointerType !== 'mouse';
        armed.current = hover;
        setHover(at(e));
    };
    const open = (g: TrendGame | null) => g && router.push(`/games/${g.game}`);

    // Touch: a tap anywhere outside the chart and its card dismisses the card.
    const showing = hover != null;
    React.useEffect(() => {
        if (!showing) return;
        const off = (e: PointerEvent) => {
            if (e.pointerType !== 'mouse' && !ref.current?.contains(e.target as Node)) setHover(null);
        };
        document.addEventListener('pointerdown', off);
        return () => document.removeEventListener('pointerdown', off);
    }, [showing, ref]);

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
                    {hover != null ? <line x1={hx} x2={hx} y1={4} y2={H - 4} className="stroke-fg-1" strokeOpacity={0.35} /> : null}
                    <rect
                        x={padL}
                        y={0}
                        width={plot}
                        height={H}
                        fill="transparent"
                        className="cursor-pointer"
                        onPointerMove={onMove}
                        onPointerDown={onDown}
                        onPointerLeave={e => e.pointerType === 'mouse' && setHover(null)}
                        onPointerCancel={() => setHover(null)}
                        onClick={() => {
                            if (!touch.current || (hover != null && armed.current === hover)) open(hg);
                        }}
                    />
                </svg>
            ) : (
                <div style={{ height: H }} aria-hidden="true" />
            )}
            {hg ? (
                <div
                    className={cn(
                        'rounded-card border border-line-strong bg-surface-1/95 p-3 text-caption',
                        compact ? 'mt-3' : 'pointer-events-none absolute top-1 z-10 w-[19rem] shadow-[0_12px_32px_rgb(0_0_0/0.55)] backdrop-blur-sm',
                    )}
                    style={compact ? undefined : hx > W * 0.6 ? { right: W - hx + 12 } : { left: hx + 12 }}
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
                    {compact ? (
                        <p className="mt-2 flex items-center justify-between gap-2 text-micro uppercase tracking-label text-fg-3">
                            5-game avg {signed(roll[hover!])}
                            <Link href={`/games/${hg.game}`} className="-my-3 -mr-2 inline-flex min-h-11 items-center px-2 text-brand">
                                Game ›
                            </Link>
                        </p>
                    ) : (
                        <p className="mt-2 text-micro uppercase tracking-label text-fg-3">
                            5-game avg {signed(roll[hover!])} · <span className="coarse:hidden">click for the game</span>
                            <span className="hidden coarse:inline">tap again for the game</span>
                        </p>
                    )}
                </div>
            ) : null}
        </div>
    );
}
