'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { Slider } from '@/components/ui/slider';
import { formatTime } from '@/lib/format/time';
import { TEAM_CODES } from '@/components/ui/team-color';
import { Crest } from '@/components/ui/crest';
import { shortDate } from '@/components/views/format';
import { cn } from '@/lib/utils';
import { isCorrect, pickOf, pickProb, type ExcludedGame, type GradedGame } from './types';
import type { GameTypeKey } from './report';

const PAGE = 50;

const cache = new Map<string, Promise<GradedGame[]>>();
function loadSeason(label: string): Promise<GradedGame[]> {
    let p = cache.get(label);
    if (!p) {
        p = fetch(`/accuracy/games/${label}`).then(r => (r.ok ? (r.json() as Promise<GradedGame[]>) : []));
        p.catch(() => cache.delete(label));
        cache.set(label, p);
    }
    return p;
}

type ResultFilter = 'all' | 'hit' | 'miss';

export function GameList({
    season,
    seasons,
    type,
    currentSeason,
    excluded = [],
}: {
    season: string;
    seasons: string[];
    type: GameTypeKey;
    currentSeason?: string;
    /** Finals deliberately left out of grading, with a reason. */
    excluded?: ExcludedGame[];
}) {
    const [games, setGames] = React.useState<{ key: string; rows: GradedGame[] } | null>(null);
    const [team, setTeam] = React.useState('all');
    const [result, setResult] = React.useState<ResultFilter>('all');
    const [includeRetro, setIncludeRetro] = React.useState(false);
    const [shown, setShown] = React.useState(PAGE);
    const [range, setRange] = React.useState<[number, number] | null>(null);
    const [open, setOpen] = React.useState<number | null>(null);
    const teamId = React.useId();

    React.useEffect(() => {
        let alive = true;
        const labels = season === 'all' ? seasons : [season];
        Promise.all(labels.map(loadSeason))
            .then(lists => {
                if (alive) setGames({ key: season, rows: lists.flat().sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id) });
            })
            .catch(() => alive && setGames({ key: season, rows: [] }));
        return () => {
            alive = false;
        };
    }, [season, seasons]);

    // Reset paging and the date window when the selection changes.
    React.useEffect(() => {
        setShown(PAGE);
        setRange(null);
        setOpen(null);
    }, [season, type, includeRetro]);

    const loading = !games || games.key !== season;
    const base = React.useMemo(
        () => (games?.rows ?? []).filter(g => (type === 'all' || (type === 'regular' ? g.type === '02' : g.type === '03')) && (includeRetro || !g.retro)),
        [games, type, includeRetro],
    );
    const dates = React.useMemo(() => [...new Set(base.map(g => g.date))].sort(), [base]);
    const win = React.useMemo<[number, number]>(() => range ?? [0, Math.max(0, dates.length - 1)], [range, dates]);
    const retroCount = React.useMemo(() => (games?.rows ?? []).filter(g => g.retro && (type === 'all' || (type === 'regular' ? g.type === '02' : g.type === '03'))).length, [games, type]);

    const rows = React.useMemo(() => {
        const [a, b] = [dates[win[0]] ?? '', dates[win[1]] ?? '9999'];
        return base.filter(g => {
            if (g.date < a || g.date > b) return false;
            if (team !== 'all' && g.home !== team && g.away !== team) return false;
            if (result === 'hit' && !isCorrect(g)) return false;
            if (result === 'miss' && isCorrect(g)) return false;
            return true;
        });
    }, [base, dates, win, team, result]);

    const hits = rows.filter(isCorrect).length;

    if (loading) {
        return <div aria-busy="true" className="h-32 rounded-card border border-line bg-surface-1/60" />;
    }
    const excludedShown = type === 'playoffs' ? [] : excluded;
    const excludedNote = excludedShown.length ? <ExcludedList games={excludedShown} /> : null;
    if (!base.length && !retroCount) {
        return (
            <div className="flex flex-col gap-2">
                <p className="label">0 graded</p>
                {excludedNote}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="panel flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
                <label htmlFor={teamId} className="sr-only">
                    Team
                </label>
                <select
                    id={teamId}
                    value={team}
                    onChange={e => {
                        setTeam(e.target.value);
                        setShown(PAGE);
                    }}
                    className="h-8 rounded-control border border-line-strong bg-surface-1 px-2 text-base uppercase tracking-[0.08em] text-fg-1 md:text-caption coarse:h-11"
                >
                    <option value="all">All teams</option>
                    {TEAM_CODES.map(t => (
                        <option key={t} value={t}>
                            {t}
                        </option>
                    ))}
                </select>
                <Segmented
                    label="Result"
                    size="sm"
                    value={result}
                    onChange={v => {
                        setResult(v);
                        setShown(PAGE);
                    }}
                    options={[
                        { value: 'all', label: 'All' },
                        { value: 'hit', label: '✓', ariaLabel: 'Right' },
                        { value: 'miss', label: '✕', ariaLabel: 'Wrong' },
                    ]}
                />
                {retroCount ? (
                    <button
                        type="button"
                        role="switch"
                        aria-checked={includeRetro}
                        onClick={() => setIncludeRetro(v => !v)}
                        className="inline-flex min-h-8 items-center gap-2 rounded-control text-micro font-medium uppercase tracking-[0.12em] text-fg-2 coarse:min-h-11"
                    >
                        <span className={cn('relative inline-block h-4 w-7 rounded-full border transition-colors', includeRetro ? 'border-brand bg-brand/30' : 'border-line-strong bg-surface-2')}>
                            <span className={cn('absolute top-[1px] h-3 w-3 rounded-full transition-transform', includeRetro ? 'translate-x-[13px] bg-brand' : 'translate-x-[1px] bg-fg-2')} />
                        </span>
                        Back-filled {retroCount.toLocaleString('en-US')}
                    </button>
                ) : null}
                {dates.length > 2 ? (
                    <div className="flex min-w-[14rem] flex-1 items-center gap-3">
                        <span className="sr-only" id="date-window">
                            Dates
                        </span>
                        <Slider
                            aria-labelledby="date-window"
                            min={0}
                            max={dates.length - 1}
                            step={1}
                            value={win}
                            minStepsBetweenThumbs={0}
                            onValueChange={v => {
                                setRange([v[0], v[1]] as [number, number]);
                                setShown(PAGE);
                            }}
                            className="flex-1"
                        />
                        <span className="shrink-0 text-micro text-fg-2">
                            {shortDate(dates[win[0]])}–{shortDate(dates[win[1]])}
                        </span>
                    </div>
                ) : null}
                <p className="ml-auto text-caption font-bold text-fg-1" aria-live="polite">
                    {hits}-{rows.length - hits}
                    {rows.length ? <span className="ml-2 font-normal text-fg-2">{((hits / rows.length) * 100).toFixed(1)}%</span> : null}
                    <span className="ml-2 font-normal text-fg-3">n={rows.length}</span>
                    {includeRetro ? <span className="ml-2 font-normal uppercase tracking-[0.12em] text-warn">+BF</span> : null}
                </p>
            </div>

            {rows.length === 0 ? (
                <p className="label py-2">No matches</p>
            ) : (
                <ul className="panel grid items-start overflow-hidden xl:grid-cols-2 xl:gap-x-px xl:bg-line">
                    {rows.slice(0, shown).map(g => (
                        <GameRowItem
                            key={g.id}
                            game={g}
                            showLegacy={!!currentSeason && g.season >= currentSeason}
                            open={open === g.id}
                            onToggle={() => setOpen(o => (o === g.id ? null : g.id))}
                        />
                    ))}
                </ul>
            )}
            {rows.length > shown ? (
                <button
                    type="button"
                    onClick={() => setShown(s => s + PAGE)}
                    className="self-center rounded-control border border-line-strong px-4 py-1.5 text-micro font-medium uppercase tracking-[0.14em] text-fg-1 transition-colors hover:border-brand hover:text-brand coarse:min-h-11"
                >
                    More · {(rows.length - shown).toLocaleString('en-US')}
                </button>
            ) : null}
            {excludedNote}
        </div>
    );
}

function GameRowItem({ game: g, open, onToggle, showLegacy }: { game: GradedGame; open: boolean; onToggle: () => void; showLegacy?: boolean }) {
    const pick = pickOf(g);
    const ok = isCorrect(g);
    const homeWon = g.homeScore > g.awayScore;
    const detailId = `pick-${g.id}`;
    return (
        <li className={cn('border-t border-line/60 bg-surface-1 first:border-t-0 xl:[&:nth-child(2)]:border-t-0', open && '!bg-surface-2')}>
            <button
                type="button"
                aria-expanded={open}
                aria-controls={detailId}
                onClick={onToggle}
                className="grid min-h-8 w-full grid-cols-[1rem_minmax(0,1fr)_auto_1rem] items-center gap-x-2.5 px-3 py-1 text-left text-caption transition-colors hover:bg-line/80 sm:grid-cols-[1rem_3.25rem_minmax(0,1fr)_auto_1rem] coarse:min-h-11"
            >
                <span aria-hidden="true" className={cn('font-bold', ok ? 'text-pos' : 'text-neg')}>
                    {ok ? '✓' : '✕'}
                </span>
                <span className="hidden text-fg-3 sm:block">{shortDate(g.date)}</span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                    <Crest tri={g.away} size={16} className="drop-shadow-none" />
                    <span className={cn(!homeWon ? 'font-bold text-fg-1' : 'text-fg-2')}>
                        {g.away} {g.awayScore}
                    </span>
                    <span className="text-fg-3">@</span>
                    <Crest tri={g.home} size={16} className="drop-shadow-none" />
                    <span className={cn(homeWon ? 'font-bold text-fg-1' : 'text-fg-2')}>
                        {g.home} {g.homeScore}
                    </span>
                    {g.decision !== 'REG' ? <span className="text-micro text-fg-3">{g.decision}</span> : null}
                    {g.type === '03' ? <span className="rounded-chip border border-playoff/50 px-1 text-micro text-playoff">PO</span> : null}
                    {g.retro ? (
                        <abbr title="Back-filled after the game, not in the report card" className="rounded-chip border border-dashed border-warn/60 px-1 text-micro text-warn no-underline">
                            BF
                        </abbr>
                    ) : null}
                    {showLegacy && g.legacy ? (
                        <abbr title="Published by the previous site model" className="rounded-chip border border-line-strong px-1 text-micro text-fg-2 no-underline">
                            LEGACY
                        </abbr>
                    ) : null}
                    <span className="text-micro text-fg-3 sm:hidden">{shortDate(g.date)}</span>
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="sr-only">Pick</span>
                    <Crest tri={pick} size={16} className="drop-shadow-none" />
                    <span className="font-bold text-fg-1">{pick}</span>
                    <span className="w-8 text-right font-bold text-fg-2">{pickProb(g).toFixed(0)}%</span>
                    <span className="sr-only">{ok ? '— right' : '— wrong'}. Details for {g.away} at {g.home}, {shortDate(g.date)}</span>
                </span>
                <svg aria-hidden="true" viewBox="0 0 16 16" className={cn('h-3.5 w-3.5 text-fg-3 transition-transform', open && 'rotate-180')}>
                    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>
            {open ? (
                <dl id={detailId} className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-line px-3 py-2 text-caption sm:grid-cols-5">
                    <Detail label={`Model ${g.home}`} value={`${g.homeProb.toFixed(1)}%`} />
                    <Detail label={`Mkt ${g.home}`} value={g.placeholderOdds ? 'Placeholder' : g.marketProb != null ? `${g.marketProb.toFixed(1)}%` : '—'} />
                    <Detail label="xG" value={g.homeXg != null && g.awayXg != null ? `${g.away} ${g.awayXg.toFixed(2)} · ${g.home} ${g.homeXg.toFixed(2)}` : '—'} />
                    <Detail label="Brier · LL" value={`${Number.isFinite(g.brier) ? g.brier.toFixed(3) : '—'} · ${Number.isFinite(g.logLoss) ? g.logLoss.toFixed(3) : '—'}`} />
                    <Detail
                        label="Frozen"
                        value={g.retro ? 'Back-filled' : g.snapshotUtc ? (formatTime(g.snapshotUtc, 'datetime') ?? 'Pregame') : 'Pregame'}
                    />
                </dl>
            ) : (
                <div id={detailId} hidden />
            )}
        </li>
    );
}

function ExcludedList({ games }: { games: ExcludedGame[] }) {
    const groups = new Map<string, ExcludedGame[]>();
    for (const g of games) groups.set(g.reason, [...(groups.get(g.reason) ?? []), g]);
    return (
        <div className="flex flex-col gap-1.5 rounded-card border border-dashed border-line-strong px-3 py-2">
            {[...groups.entries()].map(([reason, list]) => (
                <div key={reason} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <p className="label">
                        <abbr title={reason} className="no-underline">
                            Not graded
                        </abbr>{' '}
                        · {list.length}
                    </p>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-fg-2">
                        {list.map(g => (
                            <li key={g.id} className="flex items-center gap-1.5">
                                <span className="text-fg-3">{shortDate(g.date)}</span>
                                <Crest tri={g.away} size={16} className="drop-shadow-none" />
                                {g.away} @ {g.home}
                                <Crest tri={g.home} size={16} className="drop-shadow-none" />
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}

function Detail({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex min-w-0 flex-col">
            <dt className="text-micro uppercase tracking-[0.12em] text-fg-3">{label}</dt>
            <dd className="truncate font-semibold text-fg-1">{value}</dd>
        </div>
    );
}
