'use client';

import * as React from 'react';
import Link from 'next/link';
import { Segmented } from '@/components/ui/segmented';
import { FilterChip } from '@/components/ui/filter-chip';
import { TEAM_PALETTE } from '@/components/ui/team-color';
import { legibleOn } from '@/components/ui/color';
import { scheduleUrl, type SchedulePayload } from '@/lib/schedule/payload';
import { cn } from '@/lib/utils';
import { fetchJsonCached } from '@/utils/team-stats/client-cache';
import { seasonLabel } from '@/utils/team-stats/season';
import { FocusSummary, GameDetail } from './GameDetail';
import { Lenses } from './Lenses';
import { MonthCalendar } from './MonthCalendar';
import { RhythmStrip } from './RhythmStrip';
import { TravelMap, type NaGeo } from './TravelMap';
import { dateRange, defaultGame, focusTotals, miles, monthKey, monthLong, monthShort, months as monthsOf, type Focus, type Lens } from './schedule-ui';

const GEO_URL = '/data/geo/north-america.json';

interface ScheduleTabProps {
    tri: string;
    season: string;
}

function Swatch({ kind }: { kind: 'home' | 'road' | 'w' | 'l' | 'model' | 'dense' | 'diff' | 'trip' }) {
    const box = 'h-3 w-4 shrink-0';
    switch (kind) {
        case 'home':
        case 'road':
            return (
                <svg aria-hidden="true" viewBox="0 0 16 12" className={box}>
                    <line x1="0" x2="16" y1="6" y2="6" stroke="var(--line-strong)" />
                    <rect x="6" y={kind === 'home' ? 0 : 7} width="4" height="5" rx="1" fill="rgb(var(--text-2-rgb))" />
                </svg>
            );
        case 'w':
        case 'l':
        case 'model':
            return (
                <svg aria-hidden="true" viewBox="0 0 16 12" className={box}>
                    <rect x="5" y="1" width="5" height="10" rx="1" fill={kind === 'w' ? 'rgb(var(--pos-rgb))' : kind === 'l' ? 'rgb(var(--neg-rgb))' : 'rgb(var(--model-rgb))'} />
                </svg>
            );
        case 'dense':
            return (
                <svg aria-hidden="true" viewBox="0 0 16 12" className={box}>
                    <line x1="2" x2="14" y1="6" y2="6" stroke="rgb(var(--warn-rgb))" strokeWidth="4" strokeLinecap="round" />
                </svg>
            );
        case 'diff':
            return (
                <svg aria-hidden="true" viewBox="0 0 16 12" className={box}>
                    <path d="M0 9 L4 5 L8 7 L12 2 L16 4 L16 12 L0 12Z" fill="rgb(var(--info-rgb))" fillOpacity="0.18" />
                    <path d="M0 9 L4 5 L8 7 L12 2 L16 4" fill="none" stroke="rgb(var(--info-rgb))" strokeOpacity="0.7" />
                </svg>
            );
        case 'trip':
            return (
                <svg aria-hidden="true" viewBox="0 0 16 12" className={box}>
                    <path d="M1 3V7H15V3" fill="none" stroke="rgb(var(--text-3-rgb))" />
                </svg>
            );
    }
}

const LEGEND: [Parameters<typeof Swatch>[0]['kind'], string][] = [
    ['home', 'Home'],
    ['road', 'Road'],
    ['w', 'Win'],
    ['l', 'Loss'],
    ['model', 'Pony %'],
    ['dense', 'Density'],
    ['diff', 'Difficulty'],
    ['trip', 'Trip'],
];

/**
 * The Schedule tab: season facts as lenses, the season rhythm strip, the
 * travel map and a month calendar, all focused together (season, a month, a
 * trip or a stretch). Any game opens a card: inline on desktop, a sheet on phones.
 */
export default function ScheduleTab({ tri, season }: ScheduleTabProps) {
    const [payload, setPayload] = React.useState<SchedulePayload | null>(null);
    const [geo, setGeo] = React.useState<NaGeo | null>(null);
    const [error, setError] = React.useState(false);
    const [focus, setFocus] = React.useState<Focus>({ kind: 'season' });
    const [lens, setLens] = React.useState<Lens>(null);
    const [selectedId, setSelectedId] = React.useState<number | null>(null);
    const [hoverId, setHoverId] = React.useState<number | null>(null);
    const [calMonth, setCalMonth] = React.useState<string | null>(null);

    React.useEffect(() => {
        let live = true;
        setPayload(null);
        setError(false);
        setSelectedId(null);
        setLens(null);
        fetchJsonCached<SchedulePayload>(scheduleUrl(tri, season))
            .then(p => {
                if (!live) return;
                setPayload(p);
                // A season with games ahead opens on the month of the next one.
                const next = p.schedule.games.find(g => g.state !== 'final');
                setFocus(next ? { kind: 'month', key: monthKey(next.date) } : { kind: 'season' });
                setCalMonth(next ? monthKey(next.date) : p.schedule.games[0] ? monthKey(p.schedule.games[0].date) : null);
            })
            .catch(() => live && setError(true));
        return () => {
            live = false;
        };
    }, [tri, season]);

    React.useEffect(() => {
        let live = true;
        fetchJsonCached<NaGeo>(GEO_URL)
            .then(g => live && setGeo(g))
            .catch(() => undefined);
        return () => {
            live = false;
        };
    }, []);

    const schedule = payload?.schedule ?? null;
    const games = React.useMemo(() => schedule?.games ?? [], [schedule]);
    const months = React.useMemo(() => monthsOf(games), [games]);
    const teamColor = TEAM_PALETTE[tri]?.primary ?? '#29e7ff';
    // Flight lines lifted until they read on the dark land (3:1, graphics).
    const routeColor = React.useMemo(() => legibleOn(teamColor, '#101a29', 3), [teamColor]);
    const byId = React.useMemo(() => new Map(games.map(g => [g.id, g])), [games]);

    const selectGame = React.useCallback(
        (id: number) => {
            setSelectedId(cur => (cur === id ? null : id));
            const g = byId.get(id);
            if (g) setCalMonth(monthKey(g.date));
        },
        [byId],
    );
    // From a lens: pick the game and focus its month (no toggle).
    const pickGame = React.useCallback(
        (id: number) => {
            const g = byId.get(id);
            setSelectedId(id);
            if (g) {
                setFocus({ kind: 'month', key: monthKey(g.date) });
                setCalMonth(monthKey(g.date));
            }
        },
        [byId],
    );
    const focusTo = React.useCallback(
        (f: Focus) => {
            setFocus(f);
            if (!schedule) return;
            if (f.kind === 'month') setCalMonth(f.key);
            if (f.kind === 'trip') {
                const t = schedule.trips.find(x => x.id === f.id);
                if (t) setCalMonth(monthKey(schedule.games[t.first].date));
            }
            if (f.kind === 'range') setCalMonth(monthKey(schedule.games[f.first].date));
        },
        [schedule],
    );

    // Esc closes the phone sheet / clears the pick.
    React.useEffect(() => {
        if (selectedId == null) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelectedId(null);
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selectedId]);

    if (error)
        return (
            <p role="alert" className="text-micro uppercase tracking-label text-neg">
                {seasonLabel(season)} schedule unavailable
            </p>
        );
    if (!payload || !schedule)
        return (
            <div className="flex flex-col gap-3" role="status" aria-label="Loading the schedule">
                <div className="h-16 animate-pulse rounded-[10px] bg-surface-1" />
                <div className="panel h-[170px] animate-pulse" />
                <div className="grid gap-3 lg:grid-cols-12">
                    <div className="panel h-[300px] animate-pulse lg:col-span-7 lg:h-[460px]" />
                    <div className="panel h-[300px] animate-pulse lg:col-span-5 lg:h-[460px]" />
                </div>
            </div>
        );

    const shown = (hoverId != null ? byId.get(hoverId) : undefined) ?? (selectedId != null ? byId.get(selectedId) : undefined) ?? defaultGame(schedule, focus);
    const picked = selectedId != null ? byId.get(selectedId) : undefined;
    const month = calMonth ?? months[0];
    const totals = focusTotals(schedule, focus);
    const trip = focus.kind === 'trip' ? schedule.trips.find(t => t.id === focus.id) : undefined;
    const focusTitle =
        focus.kind === 'season'
            ? seasonLabel(season)
            : focus.kind === 'month'
              ? monthLong(focus.key)
              : focus.kind === 'trip'
                ? `Road trip · ${trip?.games ?? 0} GP`
                : `Stretch · ${focus.last - focus.first + 1} GP`;
    const focusChip =
        focus.kind === 'trip' && trip
            ? `Trip · ${dateRange(trip.from, trip.to)}`
            : focus.kind === 'range'
              ? `Stretch · ${dateRange(games[focus.first].date, games[focus.last].date)}`
              : null;
    const caption = (
        <span>
            <span className="text-fg-1">{focus.kind === 'month' ? monthShort(focus.key) : focus.kind === 'season' ? 'Season' : focus.kind === 'trip' ? 'Trip' : 'Stretch'}</span>
            <span className="text-fg-3"> · </span>
            {miles(totals.mi)}
        </span>
    );

    return (
        <div className="flex flex-col gap-3">
            <Lenses payload={payload} focus={focus} lens={lens} onFocus={focusTo} onLens={setLens} onGame={pickGame} />

            <section aria-label="Season rhythm" className="panel px-3 pb-2 pt-3 md:px-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Segmented
                        label="Focus"
                        size="sm"
                        value={focus.kind === 'season' ? 'season' : focus.kind === 'month' ? focus.key : ''}
                        onChange={v => focusTo(v === 'season' ? { kind: 'season' } : { kind: 'month', key: v })}
                        options={[{ value: 'season', label: 'Season' }, ...months.map(k => ({ value: k, label: monthShort(k), ariaLabel: monthLong(k) }))]}
                        className="max-w-full"
                    />
                    {focusChip ? (
                        <FilterChip selected removable onClick={() => focusTo({ kind: 'season' })} aria-label={`Clear ${focusChip}`}>
                            {focusChip}
                        </FilterChip>
                    ) : null}
                </div>
                <RhythmStrip
                    schedule={schedule}
                    today={payload.today}
                    focus={focus}
                    lens={lens}
                    selectedId={selectedId}
                    hoverId={hoverId}
                    onHover={setHoverId}
                    onSelect={selectGame}
                    onTrip={id => focusTo(focus.kind === 'trip' && focus.id === id ? { kind: 'season' } : { kind: 'trip', id })}
                />
                <div className="mt-1 flex items-start justify-between gap-3">
                    <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Key">
                        {LEGEND.filter(([k]) => k !== 'model' || games.some(g => g.winPct)).map(([k, label]) => (
                            <li key={k} className="flex items-center gap-1 text-micro uppercase tracking-label text-fg-3">
                                <Swatch kind={k} />
                                {label}
                            </li>
                        ))}
                    </ul>
                    <Link href="/methodology#schedule" className="-my-2 inline-flex min-h-9 shrink-0 items-center text-micro font-medium uppercase tracking-chip text-brand hover:underline coarse:min-h-11">
                        Method
                    </Link>
                </div>
            </section>

            <div className="grid gap-3 lg:grid-cols-12">
                <div className="flex min-w-0 flex-col gap-3 lg:col-span-7">
                    <section aria-label="Travel" className="panel overflow-hidden">
                        <TravelMap tri={tri} schedule={schedule} geo={geo} focus={focus} teamColor={routeColor} selectedId={picked?.id ?? null} onSelect={selectGame} caption={caption} />
                    </section>
                    <FocusSummary title={focusTitle} totals={totals} focus={focus} schedule={schedule} className="max-lg:hidden" />
                </div>
                <div className="flex min-w-0 flex-col gap-3 lg:col-span-5">
                    <section aria-label="Calendar" className="panel p-3">
                        {month ? (
                            <MonthCalendar
                                month={month}
                                months={months}
                                games={games}
                                focus={focus}
                                lens={lens}
                                today={payload.today}
                                teamColor={teamColor}
                                selectedId={selectedId}
                                onSelect={selectGame}
                                onHover={setHoverId}
                                onMonth={k => focusTo({ kind: 'month', key: k })}
                            />
                        ) : null}
                    </section>
                    {/* Desktop: the card lives here. Phones: the focus summary here, the card in a sheet. */}
                    {shown ? <GameDetail tri={tri} schedule={schedule} game={shown} onTrip={id => focusTo({ kind: 'trip', id })} className="max-lg:hidden" /> : null}
                    <FocusSummary title={focusTitle} totals={totals} focus={focus} schedule={schedule} className="lg:hidden" />
                </div>
            </div>

            {picked ? (
                <div
                    className={cn(
                        'fixed inset-x-0 z-40 px-3 lg:hidden',
                        'bottom-[calc(56px+env(safe-area-inset-bottom)+8px)] md:bottom-[calc(env(safe-area-inset-bottom)+12px)]',
                    )}
                >
                    <div className="mx-auto max-h-[62vh] max-w-md overflow-y-auto overscroll-contain rounded-card shadow-[0_12px_40px_rgba(0,0,0,.7)]">
                        <GameDetail tri={tri} schedule={schedule} game={picked} onTrip={id => focusTo({ kind: 'trip', id })} onClose={() => setSelectedId(null)} className="bg-surface-1" />
                    </div>
                </div>
            ) : null}
        </div>
    );
}
