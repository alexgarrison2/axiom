'use client';

import * as React from 'react';
import { FilterChip } from '@/components/ui/filter-chip';
import { InfoTip } from '@/components/ui/info-tip';
import { Input } from '@/components/ui/input';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { SortHeader } from '@/components/ui/sort-header';
import { TEAM_CODES } from '@/components/ui/team-color';
import { TeamLogo } from '@/components/views/TeamLogo';
import { plural } from '@/components/views/format';
import { cn } from '@/lib/utils';
import { compactSkaters, filterSkaters, sortSkaters, type Skater, type SkaterFilter, type SortKey } from './players/model';

const PAGE = 50;

type ColumnSet = 'overview' | 'scoring' | 'impact' | 'rates';

interface Column {
    key: SortKey;
    label: string;
    title: string;
    sets: ColumnSet[];
    render: (p: Skater) => React.ReactNode;
}

const z = (v: number | null) => {
    if (v == null) return '—';
    const r = Number(v.toFixed(2));
    return r === 0 ? '0.00' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}`;
};
const dec = (v: number | null, d = 2) => (v == null ? '—' : v.toFixed(d));
const toi = (min: number | null) => {
    if (!min) return '—';
    const m = Math.floor(min);
    return `${m}:${String(Math.round((min - m) * 60)).padStart(2, '0')}`;
};

/** Signed value tone: contrast-safe on every surface (average stays --text-2). */
function tone(v: number | null, strong = 0.5): string {
    if (v == null) return 'text-fg-3';
    if (v >= strong) return 'text-brand';
    if (v <= -strong) return 'text-neg';
    return 'text-fg-2';
}

const COLUMNS: Column[] = [
    { key: 'pts', label: 'PTS', title: 'Points', sets: ['overview', 'scoring'], render: p => <span className="font-semibold text-fg-1">{p.pts}</span> },
    { key: 'gp', label: 'GP', title: 'Games played', sets: ['scoring'], render: p => p.gp },
    { key: 'g', label: 'G', title: 'Goals', sets: ['scoring'], render: p => p.g },
    { key: 'a', label: 'A', title: 'Assists', sets: ['scoring'], render: p => p.a },
    { key: 'toiPg', label: 'TOI', title: 'Time on ice per game', sets: ['scoring'], render: p => toi(p.toiPg) },
    { key: 'sogPg', label: 'SOG/GP', title: 'Shots on goal per game', sets: ['rates'], render: p => dec(p.sogPg) },
    { key: 'evOff', label: 'EV Off', title: 'Even-strength offence (z-score)', sets: ['impact'], render: p => <span className={tone(p.evOff)}>{z(p.evOff)}</span> },
    { key: 'evDef', label: 'EV Def', title: 'Even-strength defence (z-score)', sets: ['impact'], render: p => <span className={tone(p.evDef)}>{z(p.evDef)}</span> },
    { key: 'pp', label: 'PP', title: 'Power-play impact (z-score)', sets: ['impact'], render: p => <span className={tone(p.pp)}>{z(p.pp)}</span> },
    { key: 'pk', label: 'PK', title: 'Penalty-kill impact (z-score)', sets: ['impact'], render: p => <span className={tone(p.pk)}>{z(p.pk)}</span> },
    { key: 'rapm', label: 'RAPM', title: 'Isolated net impact per 60 (ridge regression)', sets: ['rates'], render: p => <span className={tone(p.rapm, 0.1)}>{z(p.rapm)}</span> },
    { key: 'ixg60', label: 'ixG/60', title: 'Individual expected goals per 60', sets: ['rates'], render: p => dec(p.ixg60) },
    { key: 'oixgf60', label: 'oixGF/60', title: 'On-ice expected goals for per 60 at 5v5', sets: ['rates'], render: p => dec(p.oixgf60) },
];

const SET_LABELS: Record<ColumnSet, string> = { overview: 'Impact + points', scoring: 'Scoring', impact: 'Impact split', rates: 'Rates' };

export interface SkaterStatsTableProps {
    /**
     * Server-rendered first page for the default view (impact, 20+ GP), so the
     * table paints without shipping every skater in the HTML.
     */
    preview?: { rows: Skater[]; total: number };
    /** URL of the full compact list (fetched after first paint). Without it, /data files are compacted in the browser. */
    src?: string;
    ratingsLabel?: string;
}

export default function SkaterStatsTable({ preview, src, ratingsLabel }: SkaterStatsTableProps) {
    const [players, setPlayers] = React.useState<Skater[] | null>(null);
    const [filter, setFilter] = React.useState<SkaterFilter>({ q: '', team: 'all', pos: 'all', minGp: 20, rookies: false, includeOffRoster: false });
    const [sort, setSort] = React.useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'impact', dir: 'desc' });
    const [page, setPage] = React.useState(0);
    const [set, setSet] = React.useState<ColumnSet>('overview');
    const ids = { search: React.useId(), team: React.useId(), gp: React.useId(), cols: React.useId() };
    const tableTop = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        let alive = true;
        const load = src
            ? fetch(src).then(r => r.json() as Promise<Skater[]>)
            : Promise.all([fetch('/data/player_impact.json').then(r => r.json()), fetch('/data/player_bio.json').then(r => r.json()).catch(() => ({}))]).then(
                  ([impact, bio]) => compactSkaters(impact, bio),
              );
        load.then(list => alive && setPlayers(list)).catch(() => alive && setPlayers(preview?.rows ?? []));
        return () => {
            alive = false;
        };
    }, [src, preview]);

    const rows = React.useMemo(() => sortSkaters(filterSkaters(players ?? preview?.rows ?? [], filter), sort.key, sort.dir), [players, preview, filter, sort]);
    const total = players ? rows.length : preview?.total ?? rows.length;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    const current = Math.min(page, pages - 1);
    const visible = rows.slice(current * PAGE, current * PAGE + PAGE);

    const update = (patch: Partial<SkaterFilter>) => {
        setFilter(f => ({ ...f, ...patch }));
        setPage(0);
    };
    const onSort = (key: SortKey) => {
        setSort(s => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
        setPage(0);
    };
    const goPage = (p: number) => {
        setPage(p);
        tableTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const colClass = (c: Column) => (c.sets.includes(set) ? 'table-cell' : 'hidden md:table-cell');

    const list = players ?? preview?.rows;
    if (!list) return <div aria-busy="true" className="h-96 rounded-card border border-line bg-surface-1/60" />;
    if (!list.length) return <p className="text-body-sm text-fg-3">Player ratings are unavailable right now.</p>;

    return (
        <div className="flex flex-col gap-4">
            <div className="sticky top-appbar z-20 -mx-4 flex flex-col gap-2 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
                <div className="flex items-end gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-1 md:max-w-md">
                        <label htmlFor={ids.search} className="sr-only">
                            Search players
                        </label>
                        <Input id={ids.search} type="search" placeholder="Search players" value={filter.q} onChange={e => update({ q: e.target.value })} />
                    </div>
                    <div className="flex flex-col gap-1 md:hidden">
                        <label htmlFor={ids.cols} className="sr-only">
                            Columns
                        </label>
                        <select
                            id={ids.cols}
                            value={set}
                            onChange={e => setSet(e.target.value as ColumnSet)}
                            className="h-10 rounded-control border border-line-strong bg-surface-1 px-2 text-base text-fg-1"
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
                            {p === 'all' ? 'All skaters' : p === 'F' ? 'Forwards' : 'Defense'}
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
                            'h-9 shrink-0 rounded-full border px-3 text-base font-semibold md:text-body-sm coarse:h-11',
                            filter.team !== 'all' ? 'border-transparent bg-surface-3 text-fg-1 shadow-[inset_0_0_0_1px_rgb(var(--brand-rgb))]' : 'border-line bg-surface-1 text-fg-2',
                        )}
                    >
                        <option value="all">All teams</option>
                        {TEAM_CODES.map(t => (
                            <option key={t} value={t}>
                                {t}
                            </option>
                        ))}
                    </select>
                    <label htmlFor={ids.gp} className="sr-only">
                        Minimum games played
                    </label>
                    <select
                        id={ids.gp}
                        value={filter.minGp}
                        onChange={e => update({ minGp: Number(e.target.value) })}
                        className="h-9 shrink-0 rounded-full border border-line bg-surface-1 px-3 text-base font-semibold text-fg-2 md:text-body-sm coarse:h-11"
                    >
                        {[1, 10, 20, 40, 60].map(n => (
                            <option key={n} value={n}>
                                {n === 1 ? 'Any GP' : `${n}+ GP`}
                            </option>
                        ))}
                    </select>
                    <FilterChip selected={filter.includeOffRoster} onSelectedChange={v => update({ includeOffRoster: v })}>
                        Unsigned too
                    </FilterChip>
                </div>
            </div>

            <div ref={tableTop} className="flex scroll-mt-[calc(var(--appbar-h)+120px)] flex-wrap items-center justify-between gap-2 text-body-sm text-fg-2">
                <p aria-live="polite">
                    {plural(total, 'skater')}
                    {total > PAGE ? ` · ${current * PAGE + 1}–${Math.min(total, current * PAGE + PAGE)} shown` : ''}
                </p>
                {ratingsLabel ? <p className="text-caption text-fg-3">Counting stats and ratings: {ratingsLabel}</p> : null}
            </div>

            {rows.length === 0 ? (
                <p className="hud-panel p-5 text-body-sm text-fg-2">No skaters match. Try fewer filters or a lower games-played minimum.</p>
            ) : (
                <ScrollRegion label="Skater ratings table" className="rounded-card border border-line bg-surface-1">
                    <table className="w-full min-w-full text-body-sm md:min-w-[1100px]">
                        <caption className="sr-only">Skaters sorted by {sort.key === 'impact' ? 'impact' : sort.key}, {sort.dir === 'desc' ? 'highest first' : 'lowest first'}</caption>
                        <thead className="scroll-mt-filterbar bg-surface-2">
                            <tr>
                                <SortHeader
                                    direction={sort.key === 'name' ? sort.dir : null}
                                    onSort={() => onSort('name')}
                                    className="sticky left-0 z-10 w-[9rem] min-w-[9rem] bg-surface-2 md:w-60"
                                >
                                    Player
                                </SortHeader>
                                <SortHeader direction={sort.key === 'impact' ? sort.dir : null} onSort={() => onSort('impact')} className="min-w-[8.5rem]">
                                    Impact
                                </SortHeader>
                                {COLUMNS.map(c => (
                                    <SortHeader key={c.key} align="right" title={c.title} direction={sort.key === c.key ? sort.dir : null} onSort={() => onSort(c.key)} className={colClass(c)}>
                                        {c.label}
                                    </SortHeader>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line tabular-nums">
                            {visible.map((p, i) => (
                                <tr key={p.id} className="hover:bg-surface-2/50">
                                    <th scope="row" className="sticky left-0 z-10 w-[9rem] min-w-[9rem] bg-surface-1 px-2 py-1.5 text-left font-normal md:w-60">
                                        <span className="flex items-center gap-2">
                                            <span className="hidden w-6 shrink-0 text-right text-caption text-fg-3 md:inline">{current * PAGE + i + 1}</span>
                                            <TeamLogo tri={p.team} size={20} />
                                            <span className="min-w-0">
                                                <span className="block truncate font-semibold text-fg-1">
                                                    <span className="md:hidden">{shortName(p.name)}</span>
                                                    <span className="hidden md:inline">{p.name}</span>
                                                </span>
                                                <span className="block truncate text-micro text-fg-3">
                                                    {p.team} · {p.pos}
                                                    {p.rookie ? ' · R' : ''}
                                                    {p.prevTeam ? <span className="text-warn"> · from {p.prevTeam}</span> : null}
                                                    {!p.onRoster ? ' · unsigned' : ''}
                                                </span>
                                            </span>
                                        </span>
                                    </th>
                                    <td className="px-2 py-1.5">
                                        <ImpactBar value={p.impact} />
                                    </td>
                                    {COLUMNS.map(c => (
                                        <td key={c.key} className={cn('px-2 py-1.5 text-right text-fg-2', colClass(c))}>
                                            {c.render(p)}
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
                        className="min-h-10 rounded-control border border-line-strong px-4 text-body-sm font-semibold text-fg-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-fg-disabled coarse:min-h-11"
                    >
                        ← Previous
                    </button>
                    <span className="px-2 text-body-sm tabular-nums text-fg-2">
                        Page {current + 1} of {pages}
                    </span>
                    <button
                        type="button"
                        disabled={current >= pages - 1}
                        onClick={() => goPage(current + 1)}
                        className="min-h-10 rounded-control border border-line-strong px-4 text-body-sm font-semibold text-fg-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-fg-disabled coarse:min-h-11"
                    >
                        Next →
                    </button>
                </nav>
            ) : null}
            <p className="flex items-center gap-1 text-caption text-fg-3">
                Impact is a z-score: 0 is an average skater at his position, +1 is about one standard deviation better. <InfoTip term="player-impact" />
            </p>
        </div>
    );
}

function shortName(name: string): string {
    const parts = name.split(' ');
    return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name;
}

/** Diverging bar around 0 (±2.5 z shown), value to the right. */
function ImpactBar({ value }: { value: number | null }) {
    if (value == null) return <span className="text-fg-3">—</span>;
    const clamped = Math.max(-2.5, Math.min(2.5, value));
    const half = (Math.abs(clamped) / 2.5) * 50;
    const pos = value >= 0;
    return (
        <span className="flex items-center gap-2">
            <span aria-hidden="true" className="relative h-2.5 w-16 shrink-0 rounded-full bg-fg-3/15 md:w-24">
                <span className="absolute inset-y-0 left-1/2 w-px bg-fg-3/60" />
                <span
                    className={cn('absolute inset-y-0 rounded-full', pos ? 'bg-brand/80' : 'bg-neg/80')}
                    style={pos ? { left: '50%', width: `${half}%` } : { right: '50%', width: `${half}%` }}
                />
            </span>
            <span className={cn('w-11 text-right font-bold', tone(value))}>{z(value)}</span>
        </span>
    );
}
