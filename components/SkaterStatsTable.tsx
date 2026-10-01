'use client';

import * as React from 'react';
import Link from 'next/link';
import { FilterChip } from '@/components/ui/filter-chip';
import { Input } from '@/components/ui/input';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { Segmented } from '@/components/ui/segmented';
import { SortHeader } from '@/components/ui/sort-header';
import { TEAM_CODES } from '@/components/ui/team-color';
import { TeamLogo } from '@/components/views/TeamLogo';
import { cn } from '@/lib/utils';
import { scrollBehavior } from '@/lib/scroll';
import { glossaryHref } from '@/lib/glossary';
import { signed } from '@/lib/players/ratings';
import { CELL_BG } from '@/components/teams-table/table-style';
import {
    DEFAULT_FILTER,
    FIRST_DIR,
    MIN_EV_OPTIONS,
    STRONG,
    filterSkaters,
    ratingTone,
    sortSkaters,
    valueOf,
    type Skater,
    type SkaterFilter,
    type SortKey,
    type StatSeason,
} from './players/model';

const PAGE = 50;

/** Phone column sets (a wide screen shows every column). */
type ColumnSet = 'rating' | 'scoring';
const SET_LABELS: Record<ColumnSet, string> = { rating: 'Rating', scoring: 'Scoring' };

type Group = 'rating' | 'count';

interface Column {
    key: Exclude<SortKey, 'name'>;
    label: string;
    title: string;
    group: Group;
    sets: ColumnSet[];
    render: (p: Skater, season: StatSeason) => React.ReactNode;
}

const TONE = { pos: 'text-pos', neg: 'text-neg' } as const;
const dec = (v: number | null, d = 2) => (v == null ? '—' : v.toFixed(d));
const mmss = (sec: number | null) => {
    if (!sec) return '—';
    const m = Math.floor(sec / 60);
    return `${m}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
};
const thousands = (n: number) => n.toLocaleString('en-US');

function Rating({ v, p, strong, lowerBetter = false, bold = false }: { v: number; p: Skater; strong: number; lowerBetter?: boolean; bold?: boolean }) {
    const t = ratingTone(v, p, strong, lowerBetter);
    return (
        <span className={cn(t ? TONE[t] : p.rated ? 'text-fg-2' : 'text-fg-3', bold && 'font-bold')}>
            {signed(v)}
            {!p.rated ? <span className="sr-only"> (rookie prior)</span> : null}
        </span>
    );
}

const COLUMNS: Column[] = [
    { key: 'off', label: 'OFF', title: 'Offence: EV xG for per 60 above average', group: 'rating', sets: ['rating'], render: p => <Rating v={p.off} p={p} strong={STRONG.off} /> },
    { key: 'def', label: 'DEF', title: 'Defence: EV xG against per 60 above average (lower is better)', group: 'rating', sets: ['rating'], render: p => <Rating v={p.def} p={p} strong={STRONG.def} lowerBetter /> },
    { key: 'evMin', label: 'EV MIN', title: 'Even-strength minutes behind the rating (last three seasons + this one)', group: 'rating', sets: ['rating'], render: p => <span className={p.evMin < 250 ? 'text-fg-3' : undefined}>{thousands(p.evMin)}</span> },
    { key: 'gp', label: 'GP', title: 'Games played', group: 'count', sets: ['scoring'], render: (p, s) => valueOf(p, 'gp', s) ?? 0 },
    { key: 'g', label: 'G', title: 'Goals', group: 'count', sets: ['scoring'], render: (p, s) => valueOf(p, 'g', s) ?? '—' },
    { key: 'a', label: 'A', title: 'Assists', group: 'count', sets: ['scoring'], render: (p, s) => valueOf(p, 'a', s) ?? '—' },
    { key: 'pts', label: 'PTS', title: 'Points', group: 'count', sets: ['scoring'], render: (p, s) => <span className="font-semibold text-fg-1">{valueOf(p, 'pts', s) ?? '—'}</span> },
    { key: 'toi', label: 'TOI', title: 'Time on ice per game', group: 'count', sets: ['scoring'], render: (p, s) => mmss(valueOf(p, 'toi', s)) },
    { key: 'sogPg', label: 'SOG/GP', title: 'Shots on goal per game', group: 'count', sets: ['scoring'], render: (p, s) => dec(valueOf(p, 'sogPg', s)) },
];

export interface SkaterStatsTableProps {
    /** Server-rendered first page of the default view (NET, best first), so the table paints without every skater in the HTML. */
    preview?: { rows: Skater[]; total: number };
    /** URL of the full compact list, fetched after first paint. */
    src: string;
    /** "SEP 30": games through this date are in the ratings. */
    asOf?: string | null;
    /** Counting-stat season labels, e.g. { cur: '2026-27', prev: '2025-26' }. */
    seasons: Record<StatSeason, string>;
    defaultSeason?: StatSeason;
}

const short = (label: string) => label.replace(/^\d{2}(\d{2})-(\d{2})$/, '$1-$2');

export default function SkaterStatsTable({ preview, src, asOf, seasons, defaultSeason = 'cur' }: SkaterStatsTableProps) {
    const [players, setPlayers] = React.useState<Skater[] | null>(null);
    const [filter, setFilter] = React.useState<SkaterFilter>(DEFAULT_FILTER);
    const [sort, setSort] = React.useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'net', dir: 'desc' });
    const [season, setSeason] = React.useState<StatSeason>(defaultSeason);
    const [page, setPage] = React.useState(0);
    const [set, setSet] = React.useState<ColumnSet>('rating');
    const ids = { search: React.useId(), team: React.useId(), ev: React.useId(), cols: React.useId() };
    const tableTop = React.useRef<HTMLDivElement>(null);
    const filterBar = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        let alive = true;
        fetch(src)
            .then(r => r.json() as Promise<Skater[]>)
            .then(list => alive && setPlayers(list))
            .catch(() => alive && setPlayers(preview?.rows ?? []));
        return () => {
            alive = false;
        };
    }, [src, preview]);

    const rows = React.useMemo(() => sortSkaters(filterSkaters(players ?? preview?.rows ?? [], filter), sort.key, sort.dir, season), [players, preview, filter, sort, season]);
    const total = players ? rows.length : preview?.total ?? rows.length;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    const current = Math.min(page, pages - 1);
    const visible = rows.slice(current * PAGE, current * PAGE + PAGE);
    const seasonLabel = seasons[season];

    const update = (patch: Partial<SkaterFilter>) => {
        setFilter(f => ({ ...f, ...patch }));
        setPage(0);
    };
    const onSort = (key: SortKey) => {
        setSort(s => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: FIRST_DIR[key] ?? 'desc' }));
        setPage(0);
    };
    const goPage = (p: number) => {
        setPage(p);
        tableTop.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    };
    const colClass = (c: Column) => (c.sets.includes(set) ? 'table-cell' : 'hidden md:table-cell');
    /** Focusing the table region scrolls it under the sticky filter bar; nudge it so the header row shows. */
    const revealRegion = (e: React.FocusEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return;
        const region = e.currentTarget;
        requestAnimationFrame(() => {
            const bar = filterBar.current?.getBoundingClientRect().bottom ?? 0;
            const top = region.getBoundingClientRect().top;
            if (top < bar + 8) window.scrollBy({ top: top - bar - 8, behavior: 'auto' });
        });
    };

    const list = players ?? preview?.rows;
    if (!list) return <div aria-busy="true" className="h-96 rounded-card border border-line bg-surface-1/60" />;
    if (!list.length) return <p className="panel label p-card">No ratings</p>;

    const sortName = sort.key === 'name' ? 'name' : sort.key === 'net' ? 'NET' : (COLUMNS.find(c => c.key === sort.key)?.label ?? sort.key);
    const nRating = COLUMNS.filter(c => c.group === 'rating').length;
    const nCount = COLUMNS.filter(c => c.group === 'count').length;

    return (
        <div className="flex flex-col gap-3">
            <div ref={filterBar} className="sticky top-appbar z-20 -mx-4 flex flex-col gap-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur md:-mx-6 md:flex-row md:items-center md:px-6">
                <div className="flex items-end gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-1 md:w-72 md:flex-none">
                        <label htmlFor={ids.search} className="sr-only">
                            Search players
                        </label>
                        <Input id={ids.search} type="search" placeholder="SEARCH" value={filter.q} onChange={e => update({ q: e.target.value })} className="placeholder:tracking-label" />
                    </div>
                    <div className="flex flex-col gap-1 md:hidden">
                        <label htmlFor={ids.cols} className="sr-only">
                            Columns
                        </label>
                        <select
                            id={ids.cols}
                            value={set}
                            onChange={e => setSet(e.target.value as ColumnSet)}
                            className="h-10 rounded-control border border-line bg-well px-2 text-base uppercase text-fg-1"
                        >
                            {(Object.keys(SET_LABELS) as ColumnSet[]).map(k => (
                                <option key={k} value={k}>
                                    {SET_LABELS[k]}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
                <div role="group" aria-label="Filters" className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 scrollbar-hide md:mx-0 md:flex-wrap md:px-0">
                    {(['all', 'F', 'D'] as const).map(p => (
                        <FilterChip key={p} selected={filter.pos === p} onSelectedChange={() => update({ pos: p })}>
                            {p === 'all' ? 'All' : p}
                        </FilterChip>
                    ))}
                    <FilterChip selected={filter.rookies} onSelectedChange={v => update({ rookies: v })}>
                        Rookies
                    </FilterChip>
                    <label htmlFor={ids.team} className="sr-only">
                        Team
                    </label>
                    <select
                        id={ids.team}
                        value={filter.team}
                        onChange={e => update({ team: e.target.value })}
                        className={cn(
                            'h-[34px] shrink-0 rounded-full border bg-transparent px-3 text-base font-medium uppercase tracking-chip md:text-caption coarse:h-11',
                            filter.team !== 'all' ? 'border-brand/60 text-brand' : 'border-line text-fg-3',
                        )}
                    >
                        <option value="all">Team</option>
                        {TEAM_CODES.map(t => (
                            <option key={t} value={t}>
                                {t}
                            </option>
                        ))}
                    </select>
                    <label htmlFor={ids.ev} className="sr-only">
                        Minimum even-strength minutes
                    </label>
                    <select
                        id={ids.ev}
                        value={filter.minEv}
                        onChange={e => update({ minEv: Number(e.target.value) })}
                        className={cn(
                            'h-[34px] shrink-0 rounded-full border bg-transparent px-3 text-base font-medium uppercase tracking-chip md:text-caption coarse:h-11',
                            filter.minEv ? 'border-brand/60 text-brand' : 'border-line text-fg-3',
                        )}
                    >
                        {MIN_EV_OPTIONS.map(n => (
                            <option key={n} value={n}>
                                {n === 0 ? 'Any EV min' : `${thousands(n)}+ EV min`}
                            </option>
                        ))}
                    </select>
                    <Segmented
                        label="Counting stats season"
                        size="sm"
                        className="shrink-0 md:ml-auto"
                        value={season}
                        onChange={v => {
                            setSeason(v);
                            setPage(0);
                        }}
                        options={(['cur', 'prev'] as const).map(s => ({ value: s, label: short(seasons[s]), ariaLabel: `${seasons[s]} counting stats` }))}
                    />
                </div>
            </div>

            <div ref={tableTop} className="flex scroll-mt-[calc(var(--appbar-h)+120px)] flex-wrap items-center gap-x-3 gap-y-1 text-micro font-medium uppercase tracking-label text-fg-3">
                <p aria-live="polite">
                    <span className="text-fg-1">{total}</span> {total === 1 ? 'skater' : 'skaters'}
                    {total > PAGE ? ` · ${current * PAGE + 1}–${Math.min(total, current * PAGE + PAGE)}` : ''}
                </p>
                {asOf ? (
                    <p className="md:hidden">
                        Rtg <span className="text-fg-2">{asOf}</span>
                    </p>
                ) : null}
            </div>

            {rows.length === 0 ? (
                <p className="panel label p-card">No matches</p>
            ) : (
                <ScrollRegion label="Skater ratings table" onFocus={revealRegion} className="scroll-mt-filterbar rounded-card border border-line bg-surface-1">
                    <table className="w-full min-w-full font-mono text-caption tabular-nums md:min-w-[1040px]">
                        <caption className="sr-only">
                            Skaters sorted by {sortName}, {sort.dir === 'desc' ? 'highest first' : 'lowest first'}. Ratings as of {asOf ?? 'the latest refresh'}; counting stats {seasonLabel} regular season.
                        </caption>
                        <thead className="scroll-mt-filterbar bg-bg">
                            <tr className="hidden md:table-row">
                                <td className="sticky left-0 z-10 bg-bg" />
                                <th scope="colgroup" colSpan={1 + nRating} className="border-b border-line px-2 pb-0.5 pt-1.5 text-left text-micro font-medium uppercase tracking-label text-fg-3">
                                    <Link href={glossaryHref('player-net')} className="inline-flex min-h-6 items-center hover:text-brand focus-visible:text-brand">
                                        RAPM / 60{asOf ? <span className="text-fg-2"> · {asOf}</span> : null}
                                    </Link>
                                </th>
                                <th scope="colgroup" colSpan={nCount} className="border-b border-line px-2 pb-0.5 pt-1.5 text-right text-micro font-medium uppercase tracking-label text-fg-3">
                                    {seasonLabel}
                                </th>
                            </tr>
                            <tr>
                                <SortHeader
                                    direction={sort.key === 'name' ? sort.dir : null}
                                    onSort={() => onSort('name')}
                                    className="sticky left-0 z-10 w-[9rem] min-w-[9rem] border-b border-line bg-bg md:w-60"
                                >
                                    Player
                                </SortHeader>
                                <SortHeader
                                    direction={sort.key === 'net' ? sort.dir : null}
                                    onSort={() => onSort('net')}
                                    title="Net: OFF − DEF, EV xG per 60 above average"
                                    className="border-b border-line md:min-w-[9.5rem]"
                                >
                                    NET
                                </SortHeader>
                                {COLUMNS.map(c => (
                                    <SortHeader
                                        key={c.key}
                                        align="right"
                                        title={c.title}
                                        direction={sort.key === c.key ? sort.dir : null}
                                        onSort={() => onSort(c.key)}
                                        className={cn('whitespace-nowrap border-b border-line', c.key === 'gp' && 'md:border-l md:border-l-line', colClass(c))}
                                    >
                                        {c.label}
                                    </SortHeader>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map((p, i) => (
                                <tr key={p.id} className="group">
                                    <th scope="row" className={cn(CELL_BG, 'sticky left-0 z-10 h-8 w-[9rem] min-w-[9rem] border-b border-line px-2 text-left font-normal md:w-60')}>
                                        <span className="flex items-center gap-2">
                                            <span className="hidden w-7 shrink-0 text-right text-micro text-fg-3 md:inline">{current * PAGE + i + 1}</span>
                                            <TeamLogo tri={p.team} size={18} />
                                            <span className="flex min-w-0 items-baseline gap-2">
                                                <span className="truncate font-bold text-fg-1">
                                                    <span className="md:hidden">{shortName(p.name)}</span>
                                                    <span className="hidden md:inline">{p.name}</span>
                                                </span>
                                                <span className="shrink-0 text-micro uppercase text-fg-3">
                                                    <span className="hidden md:inline">{p.team} </span>
                                                    {p.pos}
                                                    {p.rookie ? <span className="text-warn"> R</span> : null}
                                                </span>
                                            </span>
                                        </span>
                                    </th>
                                    <td className={cn(CELL_BG, 'h-8 border-b border-line px-2')}>
                                        <NetBar p={p} />
                                    </td>
                                    {COLUMNS.map(c => (
                                        <td
                                            key={c.key}
                                            className={cn(CELL_BG, 'h-8 border-b border-line px-2 text-right text-fg-2', c.key === 'gp' && 'md:border-l md:border-l-line', colClass(c))}
                                        >
                                            {c.render(p, season)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </ScrollRegion>
            )}

            {pages > 1 ? (
                <nav aria-label="Pages" className="flex items-center justify-center gap-2">
                    <button
                        type="button"
                        disabled={current === 0}
                        onClick={() => goPage(current - 1)}
                        className="min-h-[34px] rounded-full border border-line px-3.5 text-micro font-medium uppercase tracking-chip text-fg-2 transition-colors hover:border-line-strong hover:text-fg-1 disabled:cursor-not-allowed disabled:text-fg-disabled coarse:min-h-11"
                    >
                        ← Prev
                    </button>
                    <span className="px-2 text-micro uppercase tracking-label tabular-nums text-fg-3">
                        <span className="text-fg-1">{current + 1}</span>/{pages}
                        <span className="sr-only"> pages</span>
                    </span>
                    <button
                        type="button"
                        disabled={current >= pages - 1}
                        onClick={() => goPage(current + 1)}
                        className="min-h-[34px] rounded-full border border-line px-3.5 text-micro font-medium uppercase tracking-chip text-fg-2 transition-colors hover:border-line-strong hover:text-fg-1 disabled:cursor-not-allowed disabled:text-fg-disabled coarse:min-h-11"
                    >
                        Next →
                    </button>
                </nav>
            ) : null}
        </div>
    );
}

function shortName(name: string): string {
    const parts = name.split(' ');
    return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name;
}

/** NET as a diverging bar around 0 (±0.75 xG/60 full scale), value to the right. */
const NET_SCALE = 0.75;
function NetBar({ p }: { p: Skater }) {
    const clamped = Math.max(-NET_SCALE, Math.min(NET_SCALE, p.net));
    const half = (Math.abs(clamped) / NET_SCALE) * 50;
    const t = ratingTone(p.net, p, STRONG.net);
    const fill = !p.rated || p.evMin < 250 ? 'bg-fg-3/50' : p.net >= 0 ? 'bg-pos/70' : 'bg-neg/70';
    return (
        <span className="flex items-center gap-2">
            <span aria-hidden="true" className="relative hidden h-2 w-20 shrink-0 rounded-full bg-line md:block">
                <span className="absolute inset-y-0 left-1/2 w-px bg-fg-3/60" />
                <span className={cn('absolute inset-y-0 rounded-full', fill)} style={p.net >= 0 ? { left: '50%', width: `${half}%` } : { right: '50%', width: `${half}%` }} />
            </span>
            <span className={cn('w-12 text-right font-bold', t ? TONE[t] : p.rated ? 'text-fg-1' : 'text-fg-3')}>
                {signed(p.net)}
                {!p.rated ? <span className="sr-only"> (rookie prior)</span> : null}
            </span>
        </span>
    );
}
