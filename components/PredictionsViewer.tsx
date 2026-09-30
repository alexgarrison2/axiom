'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Prediction } from '@/types/prediction';
import { biggestGames, findImplication, type GameImplicationsData } from '@/utils/implications';
import { MatchupCard } from '@/components/matchup/MatchupCard';
import { ArchiveCard } from '@/components/matchup/ArchiveCard';
import { BiggestGames, YourTeamStrip } from '@/components/matchup/SlateStrips';
import { useLiveScores } from '@/hooks/useLiveScores';
import { useFavorites } from '@/hooks/useFavorites';
import { cardAnchor, defaultDate, sortSlate } from '@/lib/matchup/lifecycle';
import { bothOpeners } from '@/lib/matchup/pills';
import { hasPrediction } from '@/lib/matchup/edge';
import { easternDate, railHeading, railLabel, weekdayDate } from '@/lib/matchup/format';
import { isFinalState, type ArchiveSlate } from '@/lib/matchup/archive';
import { WinBarLegend } from '@/components/ui/win-bar';
import { cn } from '@/lib/utils';
import styles from '@/components/matchup/slate.module.css';

export interface PredictionsViewerProps {
    predictions: Prediction[];
    implications: GameImplicationsData | null;
    playoffOdds: Record<string, number>;
    /** Eastern slate date when the page was rendered. */
    today: string;
    /** Date shown on first paint (from ?date= when valid, else the default slate). */
    initialDate: string | null;
    /** The URL named the date (don't re-derive "today" in the browser). */
    explicitDate?: boolean;
    /** Server-built slate for a date outside the prediction file (finals / schedule). */
    archive?: ArchiveSlate | null;
    /** Extra day chips (Yesterday while it has finals, or the requested off-file date). */
    extraDays?: { date: string; count: number }[];
    /** Playoff series scores keyed "AWAY|HOME" (postseason only). */
    series?: Record<string, { away: number; home: number }>;
}

const noopSubscribe = () => () => {};

export default function PredictionsViewer({
    predictions,
    implications,
    playoffOdds,
    today: serverToday,
    initialDate,
    explicitDate = false,
    archive = null,
    extraDays = [],
    series,
}: PredictionsViewerProps) {
    const router = useRouter();
    // A cached page may have been rendered on an earlier day: "today" is re-derived in the browser.
    const today = useSyncExternalStore(noopSubscribe, easternDate, () => serverToday);
    const [picked, setDate] = useState<string | null>(null);
    const [target, setTarget] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();
    const { favorites, toggle } = useFavorites();

    const dates = useMemo(() => [...new Set(predictions.map(p => p.date))].sort(), [predictions]);
    const date = picked ?? (explicitDate || today === serverToday ? initialDate : defaultDate(dates, today));
    const byId = useMemo(() => new Map(predictions.map(p => [p.id, p])), [predictions]);
    const dayGames = useMemo(() => {
        const games = predictions.filter(p => p.date === date);
        // Opening week: when every game is both teams' opener the chip says nothing.
        const allOpeners = games.length > 1 && games.every(bothOpeners);
        return allOpeners ? games.map(p => ({ ...p, slateAllOpeners: true })) : games;
    }, [predictions, date]);
    const live = useLiveScores(date, dayGames);
    const slate = useMemo(() => sortSlate(dayGames, live, favorites), [dayGames, live, favorites]);
    const swings = useMemo(() => (date ? biggestGames(implications, date) : []), [implications, date]);
    const offFile = archive && archive.date === date ? archive : null;

    const chips = useMemo(() => {
        const m = new Map<string, number>(dates.map(d => [d, predictions.filter(p => p.date === d).length]));
        for (const x of extraDays) if (!m.has(x.date)) m.set(x.date, x.count);
        return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
    }, [dates, predictions, extraDays]);

    // User navigation pushes history (Back returns to the previous day); a
    // day already in the prediction file paints at once, others wait for the server.
    const pick = useCallback(
        (d: string) => {
            if (dates.includes(d)) setDate(d);
            startTransition(() => router.push(`/?date=${d}`, { scroll: false }));
        },
        [router, dates],
    );

    // Deep link to a card: /#van-edm or /?date=…#van-edm scrolls to and highlights it.
    const jump = useCallback(
        (d: string, anchor: string) => {
            setDate(d);
            setTarget(anchor);
            if (window.location.hash !== `#${anchor}`) router.replace(`/?date=${d}#${anchor}`, { scroll: false });
        },
        [router],
    );

    useEffect(() => {
        const onHash = () => {
            const a = window.location.hash.slice(1).toLowerCase();
            if (!/^[a-z]{3}-[a-z]{3}$/.test(a)) return;
            const p = predictions.find(x => cardAnchor(x) === a && (!window.location.search.includes('date=') || x.date === new URLSearchParams(window.location.search).get('date')));
            if (p) {
                setDate(p.date);
                setTarget(a);
            } else if (document.getElementById(a)) {
                setTarget(a);
            }
        };
        onHash();
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, [predictions]);

    useEffect(() => {
        if (!target) return;
        const el = document.getElementById(target);
        if (!el) return;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
        const t = window.setTimeout(() => setTarget(null), 2400);
        return () => window.clearTimeout(t);
    }, [target, date]);

    const next = date ? chips.map(([d]) => d).find(d => d > date && dates.includes(d)) : null;
    const nextCount = next ? predictions.filter(p => p.date === next).length : 0;
    const headDate = date ?? today;
    const finals = offFile ? offFile.games.filter(g => isFinalState(g.state)) : [];
    const graded = finals.filter(g => g.pick?.correct != null);
    const right = graded.filter(g => g.pick?.correct).length;
    const legend = !offFile && slate.some(p => hasPrediction(p));

    return (
        <div className="flex flex-col gap-4">
            {/* Date rail: heading · day chips · legend. Phones: heading + legend, chips on their own row. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 md:gap-x-5">
                <h1 className="heading-page order-1 whitespace-nowrap">
                    <span className="sr-only">NHL predictions for </span>
                    {railHeading(headDate, today)}
                </h1>
                <nav aria-label="Game day" className="order-3 -mx-1 w-[calc(100%+0.5rem)] min-w-0 overflow-x-auto px-1 py-1 scrollbar-hide md:order-2 md:w-auto">
                    <ul className="flex items-center gap-2">
                        {chips.map(([d, n]) => {
                            const on = d === date;
                            return (
                                <li key={d}>
                                    <a
                                        href={`/?date=${d}`}
                                        aria-current={on ? 'date' : undefined}
                                        onClick={e => {
                                            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                                            e.preventDefault();
                                            if (!on) pick(d);
                                        }}
                                        className={cn(
                                            'flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-caption font-medium uppercase tracking-[0.1em] transition-colors coarse:min-h-10 md:gap-2 md:px-3.5 md:tracking-chip',
                                            on
                                                ? 'border-brand/60 text-brand shadow-[inset_0_0_12px_rgba(41,231,255,.12),0_0_16px_rgba(41,231,255,.18)]'
                                                : 'border-line text-fg-3 hover:border-line-strong hover:text-fg-1',
                                        )}
                                    >
                                        {railLabel(d, today)}
                                        <b className={cn('font-bold tabular-nums', on ? 'text-brand' : 'text-fg-3')}>{n}</b>
                                    </a>
                                </li>
                            );
                        })}
                    </ul>
                </nav>
                <div className="order-2 ml-auto flex items-center gap-4 md:order-3">
                    {graded.length ? (
                        <span className="text-micro uppercase tracking-wide text-fg-3">
                            Picks{' '}
                            <b className="font-bold tabular-nums text-fg-1">
                                {right}-{graded.length - right}
                            </b>
                        </span>
                    ) : null}
                    {legend ? <WinBarLegend className="gap-3 md:gap-4" /> : null}
                </div>
            </div>

            <div className={cn('flex flex-col gap-4 transition-opacity', pending && 'opacity-60')} aria-busy={pending || undefined}>
                <YourTeamStrip favorites={favorites} predictions={predictions} live={live} today={today} playoffOdds={playoffOdds} onJump={jump} />
                {offFile ? null : <BiggestGames swings={swings} byId={byId} onJump={jump} />}

                {offFile && offFile.games.length ? (
                    <ul className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 md:gap-4" aria-label={`Games, ${weekdayDate(headDate)}`}>
                        {offFile.games.map((g, i) => (
                            <li key={g.id} className={styles.rise} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                                <ArchiveCard g={g} />
                            </li>
                        ))}
                    </ul>
                ) : slate.length ? (
                    <ul className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2 lg:gap-4" aria-label={`Games, ${weekdayDate(headDate)}`}>
                        {slate.map((p, i) => (
                            <li key={p.id} className={styles.rise} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                                <MatchupCard
                                    p={p}
                                    live={live[p.id] ?? null}
                                    implication={findImplication(implications, p.home.team.triCode, p.away.team.triCode)}
                                    playoffOdds={playoffOdds}
                                    favorites={favorites}
                                    onFavorite={toggle}
                                    highlighted={target === cardAnchor(p)}
                                    seriesScore={series?.[`${p.away.team.triCode}|${p.home.team.triCode}`] ?? null}
                                />
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="panel flex flex-col items-center gap-2 border-dashed px-6 py-10 text-center">
                        <p className="heading-section">{offFile && !offFile.scheduleKnown ? 'Schedule unavailable' : 'No games'}</p>
                        {next ? (
                            <a
                                href={`/?date=${next}`}
                                onClick={e => {
                                    e.preventDefault();
                                    pick(next);
                                }}
                                className="mt-1 inline-flex min-h-8 items-center gap-2 rounded-full border border-line px-3.5 text-caption font-medium uppercase tracking-chip text-brand hover:border-brand/60"
                            >
                                Next · {weekdayDate(next)} · {nextCount} <span aria-hidden="true">→</span>
                            </a>
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );
}
