'use client';

import * as React from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import type { SchedGame, TeamSchedule } from '@/lib/schedule/metrics';
import { cn } from '@/lib/utils';
import { dateRange, dayLabel, miles, tagLabel, type Focus, type FocusTotals } from './schedule-ui';

const restText = (r: number | null) => (r == null ? '—' : r === 0 ? 'B2B' : `${r}d`);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-3 border-t border-line/70 py-1.5 first:border-t-0">
            <span className="label shrink-0">{label}</span>
            <span className="min-w-0 text-right text-caption tabular-nums text-fg-1">{children}</span>
        </div>
    );
}

interface GameDetailProps {
    tri: string;
    schedule: TeamSchedule;
    game: SchedGame;
    onTrip: (id: number) => void;
    onClose?: () => void;
    className?: string;
}

/**
 * One game: crests away left / home right with each side's rest under its
 * crest, then the start on three clocks (venue, ET, the team's body clock),
 * travel in, opponent rank and difficulty, the trip it belongs to, amber
 * situational chips, and the result or the model's win %.
 */
export function GameDetail({ tri, schedule, game: g, onTrip, onClose, className }: GameDetailProps) {
    const away = g.home ? g.opp : tri;
    const home = g.home ? tri : g.opp;
    const awayRest = g.home ? g.oppRest : g.rest;
    const homeRest = g.home ? g.rest : g.oppRest;
    const trip = g.trip != null ? schedule.trips.find(t => t.id === g.trip) : undefined;
    const prev = schedule.games[g.n - 2];
    const res = g.result;
    const situational = g.tags;

    return (
        <section aria-label={`${dayLabel(g.date)}: ${away} at ${home}`} className={cn('panel p-card', className)}>
            <div className="flex items-start justify-between gap-2">
                <p className="label">
                    <span className="text-fg-1">{dayLabel(g.date)}</span> · GM {g.n}
                </p>
                {onClose ? (
                    <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-2 inline-flex h-9 w-9 items-center justify-center rounded-control text-fg-3 hover:text-fg-1 coarse:h-11 coarse:w-11">
                        <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                ) : null}
            </div>

            <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div className="flex flex-col items-start gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- static SVG crest */}
                    <img src={`/logos/${away}.svg`} alt={away} width={52} height={52} className="h-12 w-12 object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,.6)] md:h-[52px] md:w-[52px]" />
                    <span className="text-micro uppercase tracking-label text-fg-3">
                        Rest <span className={cn('font-bold', awayRest === 0 ? 'text-warn' : 'text-fg-1')}>{restText(awayRest)}</span>
                    </span>
                </div>
                <div className="flex flex-col items-center gap-0.5 text-center">
                    {res ? (
                        <>
                            <span className={cn('font-display text-[26px] font-bold leading-none tabular-nums', res.code === 'W' ? 'text-pos' : 'text-neg')}>
                                {g.home ? `${res.ga}-${res.gf}` : `${res.gf}-${res.ga}`}
                            </span>
                            <span className="label">{res.code === 'W' ? 'Win' : res.code === 'OTL' ? (res.ot === 'SO' ? 'SO loss' : 'OT loss') : 'Loss'}{res.code === 'W' && res.ot ? ` · ${res.ot}` : ''}</span>
                        </>
                    ) : g.winPct ? (
                        <>
                            <span className="num-pct text-[26px] leading-none text-model">{Math.round(g.winPct.pct)}%</span>
                            <span className="label">{tri} win</span>
                        </>
                    ) : (
                        <span className="label">@</span>
                    )}
                </div>
                <div className="flex flex-col items-end gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- static SVG crest */}
                    <img src={`/logos/${home}.svg`} alt={home} width={52} height={52} className="h-12 w-12 object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,.6)] md:h-[52px] md:w-[52px]" />
                    <span className="text-micro uppercase tracking-label text-fg-3">
                        Rest <span className={cn('font-bold', homeRest === 0 ? 'text-warn' : 'text-fg-1')}>{restText(homeRest)}</span>
                    </span>
                </div>
            </div>

            {situational.length ? (
                <ul className="mt-3 flex flex-wrap gap-1" aria-label="Situation">
                    {situational.map(t => (
                        <li key={t} className="rounded-chip border border-warn/50 px-1.5 py-0.5 text-micro font-medium uppercase tracking-chip text-warn">
                            {tagLabel(t, g)}
                        </li>
                    ))}
                </ul>
            ) : null}

            <div className="mt-2">
                <Row label="Local">
                    {g.local} {g.localTz}
                    <span className="text-fg-3"> · {g.city}</span>
                </Row>
                <Row label="ET">{g.et}</Row>
                <Row label="Body">
                    <span className={cn(g.tags.includes('LATE') || g.tags.includes('EARLY') ? 'text-warn' : undefined)}>{g.body}</span>
                    {g.tzDelta ? <span className="text-fg-3"> · {g.tzDelta > 0 ? '+' : '−'}{Math.abs(g.tzDelta)}h</span> : null}
                </Row>
                <Row label="Travel">
                    {g.mi ? (
                        <>
                            {miles(g.mi)}
                            {prev ? <span className="text-fg-3"> · from {prev.city}</span> : null}
                        </>
                    ) : (
                        <span className="text-fg-3">None</span>
                    )}
                </Row>
                <Row label="Opponent">
                    #{g.oppRank} <span className="text-fg-3">of 32</span>
                    <span className="text-fg-3"> · diff </span>
                    <span className="text-info">{Math.round(g.diff)}</span>
                </Row>
                {trip ? (
                    <Row label="Trip">
                        <button type="button" onClick={() => onTrip(trip.id)} className="text-brand underline-offset-2 hover:underline coarse:py-2">
                            {g.n - trip.first} of {trip.games} · {miles(trip.mi)}
                        </button>
                    </Row>
                ) : null}
            </div>

            <div className="mt-2 flex justify-end">
                <Link href={`/games/${g.id}`} className="inline-flex min-h-9 items-center gap-1 text-micro font-medium uppercase tracking-chip text-brand hover:underline coarse:min-h-11">
                    Game <span aria-hidden="true">→</span>
                </Link>
            </div>
        </section>
    );
}

interface FocusSummaryProps {
    title: string;
    totals: FocusTotals;
    focus: Focus;
    schedule: TeamSchedule;
    className?: string;
}

/** What the card shows when no game is picked: the focus in numbers. */
export function FocusSummary({ title, totals: t, focus, schedule, className }: FocusSummaryProps) {
    const trip = focus.kind === 'trip' ? schedule.trips.find(x => x.id === focus.id) : undefined;
    return (
        <section aria-label={title} className={cn('panel p-card', className)}>
            <p className="label text-fg-1">{title}</p>
            {trip ? <p className="mt-0.5 text-micro uppercase tracking-label text-fg-3">{dateRange(trip.from, trip.to)}</p> : null}
            <div className="mt-2">
                <Row label="Games">
                    {t.gp} <span className="text-fg-3">· {t.home} home · {t.gp - t.home} road</span>
                </Row>
                {t.played ? (
                    <Row label="Record">
                        {t.w}-{t.l}-{t.otl}
                    </Row>
                ) : null}
                <Row label="Travel">{miles(t.mi)}</Row>
                <Row label="B2B">{t.b2b}</Row>
            </div>
        </section>
    );
}
