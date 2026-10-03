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
    COLOR_MIN_EV,
    DEFAULT_FILTER,
    FIRST_DIR,
    MIN_EV_OPTIONS,
    SPECIAL_TEAMS_MIN_GP,
    STRONG,
    filterSkaters,
    headlineKey,
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
type ColumnSet = 'impact' | 'rates' | 'scoring';
const SET_LABELS: Record<ColumnSet, string> = { impact: 'Impact', rates: 'Rates', scoring: 'Scoring' };

/** impact: goals / 82 · rate: per 60 (+ the EV sample) · count: the season's counting stats. */
type Group = 'impact' | 'rate' | 'count';

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

/** A signed rating, toned past `strong` with a real sample; `muted` greys it (no role there). */
function Rating({ v, p, strong, digits = 2, muted = false }: { v: number | null | undefined; p: Skater; strong: number; digits?: number; muted?: boolean }) {
    if (v == null) return <span className="text-fg-3">—</span>;
    const t = muted ? null : ratingTone(v, p, strong);
    return (
        <span className={cn(t ? TONE[t] : p.rated && !muted ? 'text-fg-2' : 'text-fg-3')}>
            {signed(v, digits)}
            {!p.rated ? <span className="sr-only"> (rookie prior)</span> : null}
        </span>
    );
}

const lowPp = (p: Skater) => p.ppGp != null && p.ppGp < SPECIAL_TEAMS_MIN_GP;
const lowPk = (p: Skater) => p.pkGp != null && p.pkGp < SPECIAL_TEAMS_MIN_GP;

const COLUMNS: Column[] = [
    { key: 'prod', label: 'PROD', title: 'Production: Game Score per 82 games above his position average. Descriptive; IMPACT is the rating', group: 'impact', sets: ['scoring'], render: p => <Rating v={p.prod} p={p} strong={STRONG.prod} digits={0} /> },
    { key: 'offImp', label: 'OFF', title: 'Offence, goals per 82: EV and PP offence, finishing, penalties drawn', group: 'impact', sets: ['impact'], render: p => <Rating v={p.offImp} p={p} strong={STRONG.offImp} digits={1} /> },
    { key: 'defImp', label: 'DEF', title: 'Defence, goals per 82: EV and PK defence, minus penalties taken', group: 'impact', sets: ['impact'], render: p => <Rating v={p.defImp} p={p} strong={STRONG.defImp} digits={1} /> },
    { key: 'pen', label: 'PEN', title: 'Penalties, goals per 82: drawn minus taken (inside OFF and DEF)', group: 'impact', sets: ['impact'], render: p => <Rating v={p.pen} p={p} strong={STRONG.pen} digits={1} /> },
    { key: 'evOff', label: 'EV OFF', title: 'Even-strength xG for per 60 added, vs his position average', group: 'rate', sets: ['rates'], render: p => <Rating v={p.evOff} p={p} strong={STRONG.evOff} /> },
    { key: 'evDef', label: 'EV DEF', title: 'Even-strength xG against per 60 prevented, vs his position average', group: 'rate', sets: ['rates'], render: p => <Rating v={p.evDef} p={p} strong={STRONG.evDef} /> },
    { key: 'pp', label: 'PP', title: 'Power-play xG for per 60 added, vs his position average (grey: under 0:30 PP a game)', group: 'rate', sets: ['rates'], render: p => <Rating v={p.pp} p={p} strong={STRONG.pp} muted={lowPp(p)} /> },
    { key: 'pk', label: 'PK', title: 'Penalty-kill xG against per 60 prevented, vs his position average (grey: under 0:30 PK a game)', group: 'rate', sets: ['rates'], render: p => <Rating v={p.pk} p={p} strong={STRONG.pk} muted={lowPk(p)} /> },
    { key: 'fin', label: 'FIN', title: 'Finishing: EV goals above xG per 60 on his own shots, shrunk', group: 'rate', sets: ['rates'], render: p => <Rating v={p.fin} p={p} strong={STRONG.fin} /> },
    { key: 'evMin', label: 'EV MIN', title: 'Even-strength minutes behind the rating (last three seasons + this one)', group: 'rate', sets: ['rates'], render: p => <span className={p.evMin < COLOR_MIN_EV ? 'text-fg-3' : undefined}>{thousands(p.evMin)}</span> },
    { key: 'gp', label: 'GP', title: 'Games played', group: 'count', sets: ['scoring'], render: (p, s) => valueOf(p, 'gp', s) ?? 0 },
    { key: 'g', label: 'G', title: 'Goals', group: 'count', sets: ['scoring'], render: (p, s) => valueOf(p, 'g', s) ?? '—' },
    { key: 'a', label: 'A', title: 'Assists', group: 'count', sets: ['scoring'], render: (p, s) => valueOf(p, 'a', s) ?? '—' },
    { key: 'pts', label: 'PTS', title: 'Points', group: 'count', sets: ['scoring'], render: (p, s) => <span className="font-semibold text-fg-1">{valueOf(p, 'pts', s) ?? '—'}</span> },
    { key: 'toi', label: 'TOI', title: 'Time on ice per game', group: 'count', sets: ['scoring'], render: (p, s) => mmss(valueOf(p, 'toi', s)) },
    { key: 'sogPg', label: 'SOG/GP', title: 'Shots on goal per game', group: 'count', sets: ['scoring'], render: (p, s) => dec(valueOf(p, 'sogPg', s)) },
];

/** The first column of each group after the headline gets a divider on wide screens (PROD, a separate measure, sits between two). */
const GROUP_START = new Set<SortKey>(['prod', 'offImp', 'evOff', 'gp']);

export interface SkaterStatsTableProps {
    /** Server-rendered first page of the default view (headline, best first), so the table paints without every skater in the HTML. */
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
    const firstHeadline = headlineKey(preview?.rows ?? []);
    const [sort, setSort] = React.useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: firstHeadline, dir: 'desc' });
    const [season, setSeason] = React.useState<StatSeason>(defaultSeason);
    const [page, setPage] = React.useState(0);
    const [chosenSet, setSet] = React.useState<ColumnSet>(firstHeadline === 'impact' ? 'impact' : 'rates');
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

    const list = players ?? preview?.rows;
    const headline = headlineKey(list ?? []);
    // A v2 file (no impact column) opens on NET per 60; the impact-only columns are hidden.
    const sortKey: SortKey = sort.key === 'impact' && headline === 'net' ? 'net' : sort.key;
    const columns = React.useMemo(() => COLUMNS.filter(c => c.group === 'count' || (list ?? []).some(p => valueOf(p, c.key, 'cur') != null)), [list]);
    const setOptions = (Object.keys(SET_LABELS) as ColumnSet[]).filter(s => s !== 'impact' || columns.some(c => c.sets.includes('impact')));
    const set: ColumnSet = setOptions.includes(chosenSet) ? chosenSet : setOptions[0];

    const rows = React.useMemo(() => sortSkaters(filterSkaters(list ?? [], filter), sortKey, sort.dir, season), [list, filter, sortKey, sort.dir, season]);
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
        setSort(s => ((s.key === 'impact' && headline === 'net' ? 'net' : s.key) === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: FIRST_DIR[key] ?? 'desc' }));
        setPage(0);
    };
    const goPage = (p: number) => {
        setPage(p);
        tableTop.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    };
    const colClass = (c: Column) => cn(c.sets.includes(set) ? 'table-cell' : 'hidden md:table-cell', GROUP_START.has(c.key) && 'md:border-l md:border-l-line');
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

    if (!list) return <div aria-busy="true" className="h-96 rounded-card border border-line bg-surface-1/60" />;
    if (!list.length) return <p className="panel label p-card">No ratings</p>;

    const headLabel = headline === 'impact' ? 'IMPACT' : 'NET';
    const sortName = sortKey === 'name' ? 'name' : sortKey === headline ? headLabel : (COLUMNS.find(c => c.key === sortKey)?.label ?? sortKey);
    const nImpact = columns.filter(c => c.group === 'impact').length;
    const nRate = columns.filter(c => c.group === 'rate').length;
    const nCount = columns.filter(c => c.group === 'count').length;
    /** Units of the headline group: goals per 82 (v3+; per 82 once PROD, Game Score, sits in it) or EV xG per 60 (v2). */
    const hasProd = columns.some(c => c.key === 'prod');
    const headUnit = headline === 'impact' ? (hasProd ? 'PER 82' : 'GOALS / 82') : 'EV / 60';
    const phoneUnit = set === 'rates' ? 'Per 60' : headline === 'impact' ? (hasProd && set === 'scoring' ? 'Per 82' : 'Goals / 82') : 'EV / 60';

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
                            {setOptions.map(k => (
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
                <p className="md:hidden">
                    {phoneUnit}
                    {asOf ? <span className="text-fg-2"> · {asOf}</span> : null}
                </p>
            </div>

            {rows.length === 0 ? (
                <p className="panel label p-card">No matches</p>
            ) : (
                <ScrollRegion label="Skater ratings table" onFocus={revealRegion} className="scroll-mt-filterbar rounded-card border border-line bg-surface-1">
                    <table className="w-full min-w-full font-mono text-caption tabular-nums md:min-w-[1040px]">
                        <caption className="sr-only">
                            Skaters sorted by {sortName}, {sort.dir === 'desc' ? 'highest first' : 'lowest first'}. Ratings as of {asOf ?? 'the latest refresh'}
                            {headline === 'impact' ? ': impact, offence, defence and penalties in goals per 82 games' : ''}
                            {headline === 'impact' && hasProd ? ', production in Game Score per 82 games' : ''}
                            {headline === 'impact' ? ', rates per 60 minutes' : ''}; counting stats {seasonLabel} regular
                            season.
                        </caption>
                        <thead className="scroll-mt-filterbar bg-bg">
                            <tr className="hidden md:table-row">
                                <td className="sticky left-0 z-10 bg-bg" />
                                <th scope="colgroup" colSpan={1 + nImpact} className="border-b border-line px-2 pb-0.5 pt-1.5 text-left text-micro font-medium uppercase tracking-label text-fg-3">
                                    <Link
                                        href={glossaryHref(headline === 'impact' ? 'player-impact' : 'player-net')}
                                        className="inline-flex min-h-6 items-center hover:text-brand focus-visible:text-brand"
                                    >
                                        {headUnit}
                                        {asOf ? <span className="text-fg-2">&nbsp;· {asOf}</span> : null}
                                    </Link>
                                </th>
                                {nRate ? (
                                    <th scope="colgroup" colSpan={nRate} className="border-b border-l border-line px-2 pb-0.5 pt-1.5 text-left text-micro font-medium uppercase tracking-label text-fg-3">
                                        <Link href={glossaryHref('player-rates')} className="inline-flex min-h-6 items-center hover:text-brand focus-visible:text-brand">
                                            PER 60
                                        </Link>
                                    </th>
                                ) : null}
                                <th scope="colgroup" colSpan={nCount} className="border-b border-l border-line px-2 pb-0.5 pt-1.5 text-right text-micro font-medium uppercase tracking-label text-fg-3">
                                    {seasonLabel}
                                </th>
                            </tr>
                            <tr>
                                <SortHeader
                                    direction={sortKey === 'name' ? sort.dir : null}
                                    onSort={() => onSort('name')}
                                    className="sticky left-0 z-10 w-[9rem] min-w-[9rem] border-b border-line bg-bg md:w-64"
                                >
                                    Player
                                </SortHeader>
                                <SortHeader
                                    direction={sortKey === headline ? sort.dir : null}
                                    onSort={() => onSort(headline)}
                                    align="right"
                                    title={
                                        headline === 'impact'
                                            ? 'Impact: goals per 82 games above his position average. Bar: OFF (cyan) then DEF (magenta); white tick = IMPACT'
                                            : 'Net: EV OFF (cyan) + EV DEF (magenta), EV xG per 60 above average. White tick = NET'
                                    }
                                    className="border-b border-line md:min-w-[9.5rem]"
                                >
                                    {headLabel}
                                </SortHeader>
                                {columns.map(c => (
                                    <SortHeader
                                        key={c.key}
                                        align="right"
                                        title={c.title}
                                        direction={sortKey === c.key ? sort.dir : null}
                                        onSort={() => onSort(c.key)}
                                        className={cn('whitespace-nowrap border-b border-line', colClass(c))}
                                    >
                                        {c.label}
                                    </SortHeader>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map((p, i) => (
                                <tr key={p.id} className="group">
                                    <th scope="row" className={cn(CELL_BG, 'sticky left-0 z-10 h-8 w-[9rem] min-w-[9rem] border-b border-line px-2 text-left font-normal md:w-64')}>
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
                                        {headline === 'impact' ? <ImpactBar p={p} /> : <NetBar p={p} />}
                                    </td>
                                    {columns.map(c => (
                                        <td key={c.key} className={cn(CELL_BG, 'h-8 whitespace-nowrap border-b border-line px-2 text-right text-fg-2', colClass(c))}>
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

/**
 * A headline as a waterfall around 0: OFF runs out from zero, DEF continues
 * from where OFF ended, and the white tick is where that lands (the total).
 * `scale` is the full-scale value either side of zero.
 */
function Waterfall({ off, def, total, scale, dim, title }: { off: number; def: number; total: number; scale: number; dim: boolean; title: string }) {
    const pct = (v: number) => 50 + (Math.max(-scale, Math.min(scale, v)) / scale) * 50;
    const seg = (from: number, to: number) => {
        const a = pct(Math.min(from, to));
        const b = pct(Math.max(from, to));
        return { left: `${a}%`, width: `${Math.max(b - a, 1.5)}%` };
    };
    return (
        <span aria-hidden="true" className="relative hidden h-5 w-32 shrink-0 md:block" title={title}>
            <span className="absolute inset-x-0 top-[6px] h-2 rounded-full bg-line" />
            <span className="absolute inset-y-0 left-1/2 w-px bg-fg-3/50" />
            <span className={cn('absolute inset-0 transition-opacity', dim && 'opacity-50')}>
                <span className="absolute inset-x-0 top-[6px] h-2">
                    <span className="absolute inset-y-0 rounded-full bg-brand" style={seg(0, off)} />
                    <span className="absolute inset-y-[1px] rounded-full bg-magenta" style={seg(off, off + def)} />
                </span>
                <span className="absolute top-[2px] h-[16px] w-[2px] -translate-x-1/2 rounded-full bg-fg-1" style={{ left: `${pct(total)}%` }} />
            </span>
        </span>
    );
}

function Headline({ v, p, strong, digits }: { v: number | null; p: Skater; strong: number; digits: number }) {
    const t = v == null ? null : ratingTone(v, p, strong);
    return (
        <span className={cn('w-12 text-right font-bold', t ? TONE[t] : p.rated ? 'text-fg-1' : 'text-fg-3')}>
            {v == null ? '—' : signed(v, digits)}
            {!p.rated ? <span className="sr-only"> (rookie prior)</span> : null}
        </span>
    );
}

/** IMPACT (goals / 82): OFF + DEF, ±20 goals full scale. */
function ImpactBar({ p }: { p: Skater }) {
    const dim = !p.rated || p.evMin < COLOR_MIN_EV;
    const off = p.offImp ?? 0;
    const def = p.defImp ?? 0;
    const total = p.impact ?? off + def;
    const sd = p.sd != null ? ` ± ${p.sd.toFixed(1)}` : '';
    return (
        <span className="flex items-center justify-end gap-2">
            <Waterfall off={off} def={def} total={total} scale={20} dim={dim} title={`OFF ${signed(off, 1)} + DEF ${signed(def, 1)} = IMPACT ${signed(total, 1)}${sd}`} />
            <Headline v={p.impact} p={p} strong={STRONG.impact} digits={1} />
        </span>
    );
}

/** NET (EV xG / 60, v2 files): EV OFF + EV DEF, ±1.0 full scale. */
function NetBar({ p }: { p: Skater }) {
    const dim = !p.rated || p.evMin < COLOR_MIN_EV;
    return (
        <span className="flex items-center justify-end gap-2">
            <Waterfall off={p.evOff} def={p.evDef} total={p.net} scale={1} dim={dim} title={`EV OFF ${signed(p.evOff)} + EV DEF ${signed(p.evDef)} = NET ${signed(p.net)}`} />
            <Headline v={p.net} p={p} strong={STRONG.net} digits={2} />
        </span>
    );
}
