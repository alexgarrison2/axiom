'use client';

import * as React from 'react';
import Link from 'next/link';
import { Crest } from '@/components/ui/crest';
import { LocalTime } from '@/components/ui/local-time';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { cn } from '@/lib/utils';
import type { SlateGame } from '@/lib/game/fetch';
import { BreakClock, breakLength, clockSeconds, periodLength, ppLength, TimeBar, useCountdown } from './TimeBar';
import { otLengthOf } from '@/lib/game/clock';

const periodName = (p: number | null) => (p == null ? '' : p <= 3 ? `P${p}` : p === 4 ? 'OT' : `${p - 3}OT`);

/** A live game within a goal in the third period or later: worth a look. */
const tight = (g: SlateGame) => g.state === 'live' && (g.period ?? 0) >= 3 && Math.abs((g.away.score ?? 0) - (g.home.score ?? 0)) <= 1;

/** Live first (tight ones first), then the games still to start, then the finals. */
const rank = (g: SlateGame) => (g.state === 'live' ? (tight(g) ? 0 : 1) : g.state === 'pre' ? 2 : 3);

/** The break's hairline along a card's bottom edge, draining live. */
function CardBreakBar({ left }: { left: number | null }) {
    const now = useCountdown(left);
    return now != null ? <TimeBar left={now} total={breakLength(left ?? now)} className="text-pause" /> : null;
}

function Status({ g }: { g: SlateGame }) {
    if (g.state === 'final') return <span className="text-fg-3">Final{g.ended ? `/${g.ended}` : ''}</span>;
    if (g.state === 'pre') return g.startUtc ? <LocalTime iso={g.startUtc} className="text-fg-3" /> : <span className="text-fg-3">Today</span>;
    // An intermission: lavender, its break counting down (the card carries the bar).
    if (g.intermission) return <span className="text-pause"><BreakClock period={g.period ?? 1} left={clockSeconds(g.clock)} bar={false} /></span>;
    return (
        <span className="flex items-center gap-1 text-pos">
            <span className="h-1.5 w-1.5 rounded-full bg-pos motion-safe:animate-pulse" aria-hidden="true" />
            {g.intermission ? `End ${periodName(g.period)}` : `${periodName(g.period)} ${(g.clock ?? '').replace(/^0(?=\d)/, '')}`}
        </span>
    );
}

/** A power play or empty net in progress, beside the team that has it, with its time left as a hairline. */
function EdgeTag({ edge }: { edge: NonNullable<SlateGame['edge']> }) {
    const left = clockSeconds(edge.left);
    return (
        <span className="relative overflow-hidden whitespace-nowrap rounded-chip bg-warn/15 px-1 text-[11px] font-semibold uppercase leading-tight tracking-label text-warn">
            {edge.what}
            {edge.left ? ` ${edge.left.replace(/^0(?=\d)/, '')}` : ''}
            {edge.what.includes('PP') && left != null ? <TimeBar left={left} total={ppLength(left)} /> : null}
        </span>
    );
}

function Side({ tri, score, lead, dim, edge }: { tri: string; score: number | null; lead: boolean; dim: boolean; edge: SlateGame['edge'] }) {
    return (
        <span className="flex items-center gap-1.5">
            <Crest tri={tri} size={18} className="h-[18px] w-[18px] drop-shadow-none" />
            <span className={cn('w-8 text-micro font-bold uppercase tracking-label', dim ? 'text-fg-3' : 'text-fg-2')}>{tri}</span>
            {edge && edge.tri === tri ? <EdgeTag edge={edge} /> : null}
            {score != null ? <span className={cn('ml-auto font-bold tabular-nums', lead ? 'text-fg-1' : 'text-fg-3')}>{score}</span> : null}
        </span>
    );
}

/**
 * The night's other games across the top of a game page: score and state at a
 * glance (live clock, a power play or empty net as it happens, an amber edge
 * on a one-goal game in the third or later), each a link to its own page.
 */
export function Scoreboard({ games, current }: { games: SlateGame[]; current: number }) {
    const others = games.filter(g => g.id !== current).sort((a, b) => rank(a) - rank(b));
    if (!others.length) return null;
    return (
        <ScrollRegion label="Tonight's other games" className="-mx-1 px-1 scrollbar-hide">
            <ol className="flex gap-2 pb-1">
                {others.map(g => {
                    const a = g.away.score ?? 0;
                    const h = g.home.score ?? 0;
                    const done = g.state === 'final';
                    return (
                        <li key={g.id} className="shrink-0">
                            <Link
                                href={`/games/${g.id}`}
                                className={cn(
                                    'relative flex w-[9.5rem] flex-col gap-1 overflow-hidden rounded-control border bg-surface-1 px-2.5 py-1.5 text-caption transition-colors hover:border-line-strong hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand',
                                    tight(g) ? 'border-warn/60' : 'border-line',
                                )}
                            >
                                <Side tri={g.away.tri} score={g.away.score} lead={!done || a >= h} dim={done && a < h} edge={g.edge} />
                                <Side tri={g.home.tri} score={g.home.score} lead={!done || h >= a} dim={done && h < a} edge={g.edge} />
                                <span className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-label">
                                    <Status g={g} />
                                    {tight(g) ? (
                                        <span className="text-warn">Close</span>
                                    ) : null}
                                </span>
                                {/* The period's time left along the card's bottom edge. */}
                                {g.state === 'live' && !g.intermission ? (
                                    <TimeBar left={clockSeconds(g.clock)} total={periodLength(g.period, otLengthOf(g.id))} className="text-pos" />
                                ) : null}
                                {g.state === 'live' && g.intermission ? <CardBreakBar left={clockSeconds(g.clock)} /> : null}
                            </Link>
                        </li>
                    );
                })}
            </ol>
        </ScrollRegion>
    );
}
