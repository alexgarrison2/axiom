'use client';

import { Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Prediction } from '@/types/prediction';
import { biggestGames, findImplication, type GameImplicationsData } from '@/utils/implications';
import { PageHeading } from '@/components/ui/page-heading';
import { MatchupCard } from '@/components/matchup/MatchupCard';
import { BiggestGames, YourTeamStrip } from '@/components/matchup/SlateStrips';
import { useLiveScores } from '@/hooks/useLiveScores';
import { useFavorites } from '@/hooks/useFavorites';
import { cardAnchor, defaultDate, sortSlate } from '@/lib/matchup/lifecycle';
import { gateClosedSiteWide, slateGateReason } from '@/lib/matchup/edge';
import { dayLabel, easternDate, shortDate, weekdayDate } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';
import styles from '@/components/matchup/slate.module.css';

export interface PredictionsViewerProps {
    predictions: Prediction[];
    implications: GameImplicationsData | null;
    playoffOdds: Record<string, number>;
    /** Eastern slate date when the page was rendered. */
    today: string;
    /** Date shown on first paint. */
    initialDate: string | null;
    /** Playoff series scores keyed "AWAY|HOME" (postseason only). */
    series?: Record<string, { away: number; home: number }>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const noopSubscribe = () => () => {};

/** Reads ?date= after hydration (inside <Suspense>, so the slate itself stays static). */
function DateParam({ onDate }: { onDate: (d: string) => void }) {
    const sp = useSearchParams();
    const d = sp?.get('date');
    useEffect(() => {
        if (d && DATE_RE.test(d)) onDate(d);
    }, [d, onDate]);
    return null;
}

export default function PredictionsViewer({ predictions, implications, playoffOdds, today: serverToday, initialDate, series }: PredictionsViewerProps) {
    const router = useRouter();
    // The page may have been rendered on an earlier day: "today" is re-derived in the browser.
    const today = useSyncExternalStore(noopSubscribe, easternDate, () => serverToday);
    const [picked, setDate] = useState<string | null>(null);
    const [target, setTarget] = useState<string | null>(null);
    const { favorites, toggle } = useFavorites();

    const dates = useMemo(() => [...new Set(predictions.map(p => p.date))].sort(), [predictions]);
    const date = picked ?? (today === serverToday ? initialDate : defaultDate(dates, today));
    const byId = useMemo(() => new Map(predictions.map(p => [p.id, p])), [predictions]);
    const dayGames = useMemo(() => predictions.filter(p => p.date === date), [predictions, date]);
    const live = useLiveScores(date, dayGames);
    const slate = useMemo(() => sortSlate(dayGames, live, favorites), [dayGames, live, favorites]);
    const gateClosed = gateClosedSiteWide(dayGames);
    const gateReason = slateGateReason(dayGames);
    const swings = useMemo(() => (date ? biggestGames(implications, date) : []), [implications, date]);

    const pick = useCallback(
        (d: string) => {
            setDate(d);
            router.replace(`/?date=${d}${window.location.hash}`, { scroll: false });
        },
        [router],
    );

    const fromUrl = useCallback((d: string) => setDate(d), []);

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

    const next = date ? dates.find(d => d > date) : null;
    const nextCount = next ? predictions.filter(p => p.date === next).length : 0;
    const headingDate = date ? weekdayDate(date) : weekdayDate(today);

    return (
        <div className="flex flex-col gap-3">
            <PageHeading visuallyHidden title={`NHL predictions for ${headingDate}`} />
            <Suspense fallback={null}>
                <DateParam onDate={fromUrl} />
            </Suspense>

            {/* Slate bar: day switcher + slate notes */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <nav aria-label="Game day" className="-mx-1 max-w-full overflow-x-auto px-1 [scrollbar-width:none]">
                    <ul className="flex items-center gap-1">
                        {dates.map(d => {
                            const on = d === date;
                            const n = predictions.filter(p => p.date === d).length;
                            return (
                                <li key={d}>
                                    <a
                                        href={`/?date=${d}`}
                                        aria-current={on ? 'date' : undefined}
                                        onClick={e => {
                                            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                                            e.preventDefault();
                                            pick(d);
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
                {gateClosed ? (
                    <p className="text-caption text-fg-2" title={gateReason ?? undefined}>
                        No bets: model hasn&apos;t beaten the market yet (see{' '}
                        <a href="/accuracy" className="font-semibold text-brand hover:underline">
                            Accuracy
                        </a>
                        )
                    </p>
                ) : null}
            </div>

            <YourTeamStrip favorites={favorites} predictions={predictions} live={live} today={today} playoffOdds={playoffOdds} onJump={jump} />
            <BiggestGames swings={swings} byId={byId} onJump={jump} />

            {slate.length ? (
                <ul className="grid grid-cols-1 gap-4 xl:grid-cols-2" aria-label={`Games, ${headingDate}`}>
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
                    <p className="text-title font-bold text-fg-1">{date ? `No games on ${shortDate(date)}` : 'No games scheduled'}</p>
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
    );
}
