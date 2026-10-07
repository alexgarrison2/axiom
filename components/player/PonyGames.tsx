'use client';

import * as React from 'react';
import Link from 'next/link';
import { Breakdown } from '@/components/pony/LeaderTable';
import { cn } from '@/lib/utils';
import type { GsPart } from '@/lib/game/analytics';
import { IDEAS, PARTS, signed } from '@/lib/pony/parts';
import { PonyTrend, rollingAverage, type TrendGame } from './PonyTrend';

/**
 * The season's Pony Scores beside the average night. Picking a game on the
 * chart (hover, tap or scrub) reads it out in place instead of in a card over
 * the bars: the chart's header line names the game with its score and the
 * five-game average, and the side panel turns from the average night into
 * that night's breakdown and stat line. Leaving the chart (or, on touch,
 * tapping elsewhere) brings the average back.
 */

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Widest one-sided stack, rounded up to an eighth: the breakdown bar's half-width. */
const reachOf = (rows: Record<GsPart, number>[]) =>
    Math.max(0.25, Math.ceil(Math.max(0, ...rows.flatMap(p => [0, 1].map(s => Object.values(p).filter(v => (s ? v < 0 : v > 0)).reduce((a, v) => a + Math.abs(v), 0)))) * 8) / 8);

export function PonyGames({
    trend,
    color,
    avgParts,
    avg,
    group,
    goalieSummary,
    footer,
}: {
    trend: TrendGame[];
    color: string;
    avgParts: Record<GsPart, number> | null;
    avg: number;
    group: 'F' | 'D' | 'G';
    goalieSummary: React.ReactNode;
    footer: React.ReactNode;
}) {
    const [pick, setPick] = React.useState<number | null>(null);
    const box = React.useRef<HTMLDivElement>(null);
    const roll = React.useMemo(() => rollingAverage(trend), [trend]);
    const g = pick != null ? trend[pick] : null;
    const goalie = group === 'G';

    // Touch: a tap outside the chart and its readouts lets the game go.
    const picked = pick != null;
    React.useEffect(() => {
        if (!picked) return;
        const off = (e: PointerEvent) => {
            if (e.pointerType !== 'mouse' && !box.current?.contains(e.target as Node)) setPick(null);
        };
        document.addEventListener('pointerdown', off);
        return () => document.removeEventListener('pointerdown', off);
    }, [picked]);

    // The breakdown bar fills its track for whatever it shows (the chart already compares the games).
    const parts = g ? g.parts : avgParts;
    const value = g ? g.ps : avg;
    const reach = goalie ? Math.max(0.5, Math.ceil(Math.max(...trend.map(t => Math.abs(t.ps))) * 2) / 2) : parts ? reachOf([parts]) : 1;

    return (
        <div ref={box} className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="panel p-card">
                <p className="mb-2 flex min-h-5 items-baseline justify-between gap-3 text-micro uppercase tracking-label text-fg-3" aria-live="polite">
                    {g ? (
                        <>
                            <span className="truncate text-fg-2">
                                {day(g.date)} · {g.home ? 'vs' : '@'} {g.opp} · <span className={g.result === 'W' ? 'text-fg-1' : undefined}>{g.result}</span>
                            </span>
                            <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
                                <span className={cn('font-display text-body font-bold normal-case tracking-normal', g.ps < 0 ? 'text-fg-2' : 'text-fg-1')}>{signed(g.ps)}</span>
                                <span className="text-model">
                                    <span className="max-sm:hidden">5-game </span>
                                    {signed(roll[pick!])}
                                </span>
                            </span>
                        </>
                    ) : (
                        <>
                            <span>Game by game</span>
                            <span className="flex items-center gap-1.5">
                                <span className="h-0.5 w-4 rounded-full bg-model" /> 5-game average
                            </span>
                        </>
                    )}
                </p>
                <PonyTrend games={trend} color={color} hover={pick} onHover={setPick} />
            </div>
            <div className="panel flex flex-col gap-3 p-card">
                <div className="flex min-h-5 items-baseline justify-between gap-3">
                    <p className="truncate text-micro uppercase tracking-label text-fg-3">
                        {g ? `${day(g.date)} ${g.home ? 'vs' : '@'} ${g.opp}` : goalie ? 'Goals saved above expected' : 'Average night'}
                    </p>
                    {g ? (
                        <Link href={`/games/${g.game}`} className="-my-3 -mr-2 inline-flex min-h-11 shrink-0 items-center px-2 text-micro uppercase tracking-label text-brand underline-offset-4 hover:underline">
                            Game ›
                        </Link>
                    ) : null}
                </div>
                {goalie ? (
                    g ? (
                        <>
                            <Breakdown row={{ parts: null, goalie: null, avg: value }} reach={reach} className="h-4" />
                            <p className="text-caption tabular-nums text-fg-2">
                                <span className="font-bold text-fg-1">{signed(g.ps)}</span> GSAx · {g.line}
                            </p>
                        </>
                    ) : (
                        goalieSummary
                    )
                ) : parts ? (
                    <>
                        <Breakdown row={{ parts, goalie: null, avg: value }} reach={reach} className="h-4" />
                        <p className="-mt-1 truncate text-micro tabular-nums text-fg-3">{g ? g.line : `${trend.length} games · ${signed(avg)} per game`}</p>
                        <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-caption tabular-nums">
                            {IDEAS.map(([o, d]) => (
                                <div key={o} className="contents">
                                    {[o, d].map(k => (
                                        <span key={k} className="flex items-center justify-between gap-2">
                                            <span className="flex items-center gap-1.5 text-fg-2">
                                                <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: PARTS[k].color }} />
                                                {PARTS[k].label}
                                            </span>
                                            <span className={Math.abs(parts[k]) < 0.005 ? 'text-fg-3' : 'text-fg-1'}>{signed(parts[k])}</span>
                                        </span>
                                    ))}
                                </div>
                            ))}
                        </div>
                        <p className="text-micro text-fg-3">Offence left column, defence right; goals {g ? 'that night' : 'per game'} above an average {group === 'D' ? 'defenceman' : 'forward'}.</p>
                    </>
                ) : null}
                {footer}
            </div>
        </div>
    );
}
