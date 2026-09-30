'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { Slider } from '@/components/ui/slider';
import { formatTime } from '@/lib/format/time';
import { TEAM_CODES } from '@/components/ui/team-color';
import { TeamLogo } from '@/components/views/TeamLogo';
import { plural, shortDate } from '@/components/views/format';
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
        return <div aria-busy="true" className="h-40 rounded-card border border-line bg-surface-1/60" />;
    }
    const excludedShown = type === 'playoffs' ? [] : excluded;
    const excludedNote = excludedShown.length ? <ExcludedList games={excludedShown} /> : null;
    if (!base.length && !retroCount) {
        return (
            <div className="flex flex-col gap-3">
                <p className="text-body-sm text-fg-3">No graded games for this selection yet.</p>
                {excludedNote}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="hud-panel flex flex-col gap-4 p-4">
                <div className="flex flex-wrap items-end gap-3">
                    <div className="flex min-w-[10rem] flex-col gap-1">
                        <label htmlFor={teamId} className="hud-label">
                            Team
                        </label>
                        <select
                            id={teamId}
                            value={team}
                            onChange={e => {
                                setTeam(e.target.value);
                                setShown(PAGE);
                            }}
                            className="h-10 rounded-control border border-line-strong bg-surface-1 px-2.5 text-base text-fg-1 md:text-body-sm"
                        >
                            <option value="all">All teams</option>
                            {TEAM_CODES.map(t => (
                                <option key={t} value={t}>
                                    {t}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="hud-label" aria-hidden="true">
                            Result
                        </span>
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
                                { value: 'hit', label: '✓ Right' },
                                { value: 'miss', label: '✗ Wrong' },
                            ]}
                        />
                    </div>
                    {retroCount ? (
                        <button
                            type="button"
                            role="switch"
                            aria-checked={includeRetro}
                            onClick={() => setIncludeRetro(v => !v)}
                            className="inline-flex min-h-10 items-center gap-2 rounded-control px-1 text-body-sm font-semibold text-fg-1 coarse:min-h-11"
                        >
                            <span className={cn('relative inline-block h-5 w-9 rounded-full border transition-colors', includeRetro ? 'border-brand bg-brand/30' : 'border-line-strong bg-surface-2')}>
                                <span className={cn('absolute top-0.5 h-3.5 w-3.5 rounded-full transition-transform', includeRetro ? 'translate-x-[18px] bg-brand' : 'translate-x-0.5 bg-fg-2')} />
                            </span>
                            Include back-filled ({retroCount.toLocaleString('en-US')})
                        </button>
                    ) : null}
                </div>
                {dates.length > 2 ? (
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between text-caption text-fg-2">
                            <span className="hud-label" id="date-window">
                                Dates
                            </span>
                            <span className="tabular-nums">
                                {shortDate(dates[win[0]])} – {shortDate(dates[win[1]])}
                            </span>
                        </div>
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
                        />
                    </div>
                ) : null}
                <p className="text-body-sm text-fg-2" aria-live="polite">
                    {plural(rows.length, 'game')} · {hits}-{rows.length - hits}
                    {rows.length ? ` (${((hits / rows.length) * 100).toFixed(1)}%)` : ''}
                    {includeRetro ? <span className="text-warn"> · includes back-filled picks, not counted in the report card</span> : null}
                </p>
            </div>

            {rows.length === 0 ? (
                <p className="text-body-sm text-fg-3">No games match these filters.</p>
            ) : (
                <ul className="flex flex-col gap-1.5">
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
                    className="self-center rounded-control border border-line-strong px-5 py-2 text-body-sm font-semibold text-fg-1 transition-colors hover:bg-surface-2 coarse:min-h-11"
                >
                    Show more ({Math.min(PAGE, rows.length - shown)} of {(rows.length - shown).toLocaleString('en-US')} left)
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
        <li className={cn('rounded-control border bg-surface-1', open ? 'border-line-strong' : 'border-line')}>
            <div className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[1.5rem_3.5rem_minmax(0,1fr)_8.5rem_auto]">
                <span aria-hidden="true" className={cn('text-title font-black', ok ? 'text-pos' : 'text-neg')}>
                    {ok ? '✓' : '✗'}
                </span>
                <span className="hidden text-caption tabular-nums text-fg-3 sm:block">{shortDate(g.date)}</span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-body-sm tabular-nums">
                    <TeamLogo tri={g.away} size={20} />
                    <span className={cn(!homeWon ? 'font-bold text-fg-1' : 'text-fg-2')}>
                        {g.away} {g.awayScore}
                    </span>
                    <span className="text-fg-3">@</span>
                    <TeamLogo tri={g.home} size={20} />
                    <span className={cn(homeWon ? 'font-bold text-fg-1' : 'text-fg-2')}>
                        {g.home} {g.homeScore}
                    </span>
                    {g.decision !== 'REG' ? <span className="rounded-chip bg-surface-3 px-1 text-micro font-semibold text-fg-2">{g.decision}</span> : null}
                    {g.type === '03' ? <span className="rounded-chip bg-playoff/15 px-1 text-micro font-semibold text-playoff">PO</span> : null}
                    {g.retro ? <span className="rounded-chip border border-dashed border-warn/60 px-1 text-micro font-semibold text-warn">Back-filled</span> : null}
                    {showLegacy && g.legacy ? (
                        <span title="Published by the previous site model, before the current model went live" className="rounded-chip border border-line-strong px-1 text-micro font-semibold text-fg-2">
                            Legacy model
                        </span>
                    ) : null}
                    <span className="w-full text-caption text-fg-3 sm:hidden">{shortDate(g.date)}</span>
                </span>
                <span className="col-start-2 row-start-2 flex items-center gap-1.5 text-body-sm sm:col-start-auto sm:row-start-auto">
                    <span className="text-fg-3">Pick</span>
                    <TeamLogo tri={pick} size={18} />
                    <span className="font-semibold text-fg-1">{pick}</span>
                    <span className="rounded-full bg-surface-3 px-2 py-0.5 text-caption font-bold tabular-nums text-fg-1">{pickProb(g).toFixed(0)}%</span>
                    <span className="sr-only">{ok ? '— right' : '— wrong'}</span>
                </span>
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={detailId}
                    onClick={onToggle}
                    className="col-start-3 row-span-2 row-start-1 inline-flex h-9 w-9 items-center justify-center rounded-control text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg-1 sm:col-start-auto sm:row-span-1 sm:row-start-auto coarse:h-11 coarse:w-11"
                >
                    <span className="sr-only">
                        Details for {g.away} at {g.home}, {shortDate(g.date)}
                    </span>
                    <svg aria-hidden="true" viewBox="0 0 16 16" className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}>
                        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
            </div>
            {open ? (
                <dl id={detailId} className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line px-3 py-3 text-body-sm sm:grid-cols-4">
                    <Detail label={`Model ${g.home} win`} value={`${g.homeProb.toFixed(1)}%`} />
                    <Detail
                        label={`Market ${g.home} win`}
                        value={g.placeholderOdds ? 'Placeholder −110/−110 (not counted)' : g.marketProb != null ? `${g.marketProb.toFixed(1)}%` : '—'}
                    />
                    <Detail label="Projected goals" value={g.homeXg != null && g.awayXg != null ? `${g.away} ${g.awayXg.toFixed(2)} · ${g.home} ${g.homeXg.toFixed(2)}` : '—'} />
                    <Detail label="Brier · log loss" value={`${Number.isFinite(g.brier) ? g.brier.toFixed(3) : '—'} · ${Number.isFinite(g.logLoss) ? g.logLoss.toFixed(3) : '—'}`} />
                    <Detail
                        label="Source"
                        value={g.retro ? 'Back-filled after the game (not shown live)' : g.snapshotUtc ? `Pregame snapshot ${formatTime(g.snapshotUtc, 'datetime') ?? ''}`.trim() : 'Pregame snapshot'}
                        wide
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
        <div className="flex flex-col gap-2 rounded-card border border-dashed border-line-strong p-4">
            {[...groups.entries()].map(([reason, list]) => (
                <div key={reason} className="flex flex-col gap-1.5">
                    <p className="text-body-sm font-semibold text-fg-1">
                        Not graded: {reason.charAt(0).toLowerCase() + reason.slice(1)} ({plural(list.length, 'game')})
                    </p>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm tabular-nums text-fg-2">
                        {list.map(g => (
                            <li key={g.id} className="flex items-center gap-1.5">
                                <span className="text-fg-3">{shortDate(g.date)}</span>
                                <TeamLogo tri={g.away} size={16} />
                                {g.away} @ {g.home}
                                <TeamLogo tri={g.home} size={16} />
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
            <p className="text-caption text-fg-3">We only grade picks frozen before puck drop, so these games are left out rather than graded after the fact.</p>
        </div>
    );
}

function Detail({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
    return (
        <div className={cn('flex flex-col', wide && 'col-span-2')}>
            <dt className="text-micro uppercase tracking-[0.06em] text-fg-3">{label}</dt>
            <dd className="font-semibold tabular-nums text-fg-1">{value}</dd>
        </div>
    );
}
