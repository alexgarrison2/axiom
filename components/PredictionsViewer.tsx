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
import { gateClosedSiteWide, slateGateReason } from '@/lib/matchup/edge';
import { dayLabel, easternDate, shortDate, weekdayDate } from '@/lib/matchup/format';
import { isFinalState, type ArchiveSlate } from '@/lib/matchup/archive';
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

/** Heading word for a slate day relative to today. */
function dayWord(d: string, today: string): string {
    const l = dayLabel(d, today);
    if (l === 'Today') return 'Tonight';
    return l === 'Tomorrow' || l === 'Yesterday' ? l : d < today ? 'Results' : 'Upcoming';
}

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
    const gateClosed = gateClosedSiteWide(dayGames);
    const gateReason = slateGateReason(dayGames);
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
    const count = offFile ? offFile.games.length : slate.length;
    const finals = offFile ? offFile.games.filter(g => isFinalState(g.state)) : [];
    const graded = finals.filter(g => g.pick?.correct != null);
    const right = graded.filter(g => g.pick?.correct).length;
    const upcomingOnly = offFile && offFile.games.length > 0 && !finals.length && offFile.games.every(g => g.state === 'FUT' || g.state === 'PRE');

    let meta: string;
    if (offFile) {
        if (!offFile.games.length) meta = offFile.scheduleKnown ? 'No games' : 'Schedule unavailable';
        else if (upcomingOnly) meta = `${count} game${count === 1 ? '' : 's'} scheduled · predictions post the morning of`;
        else meta = `${count} game${count === 1 ? '' : 's'}${graded.length ? ` · model ${right}-${graded.length - right} on graded picks` : ''}`;
    } else {
        meta = count ? `${count} game${count === 1 ? '' : 's'}` : 'No games';
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Page header: what the site is, and which night this is. */}
            <header className="flex flex-col gap-1">
                <p className="hud-label text-brand">
                    {dayWord(headDate, today)} <span aria-hidden="true">·</span> <span className="text-fg-2">{meta}</span>
                </p>
                <h1 className="text-h2 font-black tracking-tight text-fg-1 md:text-display">
                    <span className="sr-only">NHL predictions for </span>
                    {weekdayDate(headDate)}
                </h1>
                <p className="max-w-3xl text-body-sm text-fg-2 md:text-body">
                    Free NHL win probabilities from an expected-goals model, checked against the betting market.{' '}
                    <a href="/methodology" className="whitespace-nowrap font-semibold text-brand hover:underline">
                        How it works <span aria-hidden="true">→</span>
                    </a>
                </p>
            </header>

            {/* Slate bar: day switcher + slate notes */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <nav aria-label="Game day" className="-mx-1 max-w-full overflow-x-auto px-1 [scrollbar-width:none]">
                    <ul className="flex items-center gap-1">
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
                                            'flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-body-sm font-semibold transition-colors coarse:min-h-11',
                                            on ? 'border-brand/60 bg-brand/10 text-fg-1 shadow-[inset_0_0_0_1px_rgb(var(--brand-rgb)/0.25)]' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg-1',
                                        )}
                                    >
                                        {dayLabel(d, today)}
                                        <span className={cn('text-caption tabular-nums', on ? 'text-brand' : 'text-fg-3')}>{n}</span>
                                    </a>
                                </li>
                            );
                        })}
                    </ul>
                </nav>
                {gateClosed && !offFile ? (
                    <p className="text-caption text-fg-2" title={gateReason ?? undefined}>
                        Picks only, no bets: our model hasn&apos;t beaten the market yet (see{' '}
                        <a href="/accuracy" className="font-semibold text-brand hover:underline">
                            Accuracy
                        </a>
                        )
                    </p>
                ) : null}
            </div>

            <div className={cn('flex flex-col gap-4 transition-opacity', pending && 'opacity-60')} aria-busy={pending || undefined}>
                <YourTeamStrip favorites={favorites} predictions={predictions} live={live} today={today} playoffOdds={playoffOdds} onJump={jump} />
                {offFile ? null : <BiggestGames swings={swings} byId={byId} onJump={jump} />}

                {offFile && offFile.games.length ? (
                    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label={`Games, ${weekdayDate(headDate)}`}>
                        {offFile.games.map((g, i) => (
                            <li key={g.id} className={styles.rise} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                                <ArchiveCard g={g} />
                            </li>
                        ))}
                    </ul>
                ) : slate.length ? (
                    <ul className="grid grid-cols-1 gap-4 xl:grid-cols-2" aria-label={`Games, ${weekdayDate(headDate)}`}>
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
                    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line-strong px-6 py-12 text-center">
                        <p className="text-title font-bold text-fg-1">
                            {!date ? 'No games scheduled' : offFile && !offFile.scheduleKnown ? `No predictions for ${shortDate(date)}` : `No games on ${shortDate(date)}`}
                        </p>
                        {offFile && !offFile.scheduleKnown ? <p className="text-body-sm text-fg-2">We couldn&apos;t reach the NHL schedule. Try again in a minute.</p> : null}
                        {next ? (
                            <a
                                href={`/?date=${next}`}
                                onClick={e => {
                                    e.preventDefault();
                                    pick(next);
                                }}
                                className="text-body font-semibold text-brand hover:underline"
                            >
                                Next: {shortDate(next)} ({nextCount} game{nextCount === 1 ? '' : 's'}) →
                            </a>
                        ) : (
                            <p className="text-body-sm text-fg-2">New predictions appear here each morning.</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
