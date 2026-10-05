'use client';

import * as React from 'react';
import { FilterChip } from '@/components/ui/filter-chip';
import { Input } from '@/components/ui/input';
import { LocalTime } from '@/components/ui/local-time';
import { PageHeading } from '@/components/ui/page-heading';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { Segmented } from '@/components/ui/segmented';
import { SortHeader } from '@/components/ui/sort-header';
import { TeamLogo } from '@/components/views/TeamLogo';
import { CELL_BG } from '@/components/teams-table/table-style';
import { cn } from '@/lib/utils';
import { HitTape } from './HitTape';
import {
    CATEGORIES,
    DEFAULT_FILTER,
    FIRST_DIR,
    american,
    buildRows,
    categoryOf,
    defaultSort,
    fairAmerican,
    filterRows,
    pct,
    shortName,
    sortRows,
    type Category,
    type CategoryKey,
    type Filter,
    type LineChoice,
    type PlayerDetail,
    type PropGame,
    type PropsDetailDoc,
    type PropsDoc,
    type Rate,
    type Row,
    type SortKey,
    type View,
} from './model';
import { PropDetail } from './PropDetail';

const PAGE = 50;

export interface PropsBoardProps {
    src: string;
    /** Opened-row detail (props_detail.json), fetched on the first open. */
    detailSrc: string;
    /** Server-read slate so the game rail paints before the full board loads. */
    games: PropGame[];
    slateDate: string | null;
    /** "26-27" / "25-26" */
    seasons: { cur: string; prev: string };
}

/** Hit-rate cell: the percentage on a cyan wash whose strength is the rate (one hue, no traffic light). */
function RateCell({ r, title, className }: { r: Rate; title: string; className?: string }) {
    const p = pct(r);
    if (p == null) return <td className={cn(CELL_BG, 'h-11 border-b border-line px-1 text-center text-fg-disabled', className)}>—</td>;
    const thin = r.n < 5;
    return (
        <td className={cn(CELL_BG, 'h-11 border-b border-line px-1 text-center', className)} title={`${title}: ${r.hits} of ${r.n}`}>
            <span
                className={cn(
                    'mx-auto flex h-8 w-11 flex-col items-center justify-center rounded-chip leading-none md:w-12',
                    thin ? 'text-fg-3' : p >= 0.6 ? 'font-semibold text-fg-1' : 'text-fg-2',
                )}
                style={thin ? undefined : { background: `rgb(var(--brand-rgb) / ${(0.04 + 0.34 * p).toFixed(3)})` }}
            >
                <span>{Math.round(p * 100)}%</span>
                <span className="text-micro text-fg-3">
                    {r.hits}/{r.n}
                </span>
            </span>
        </td>
    );
}

function EdgeValue({ e }: { e: number | null }) {
    if (e == null) return <span className="text-fg-disabled">—</span>;
    const v = Math.round(e * 1000) / 10;
    const strong = v >= 5;
    return (
        <span
            className={cn(
                'inline-flex min-w-[2.75rem] justify-end rounded-chip px-1 py-0.5 font-semibold md:min-w-[3.25rem] md:px-1.5',
                v > 0 ? 'text-pos' : v < 0 ? 'text-neg' : 'text-fg-2',
                strong && 'bg-pos/10 shadow-[0_0_12px_rgb(var(--pos-rgb)/0.25)]',
            )}
        >
            {v > 0 ? '+' : ''}
            {v.toFixed(1)}
        </span>
    );
}

function UnitChip({ unit, pp, move }: { unit: string | null; pp: number | null; move: 'up' | 'down' | null }) {
    if (!unit && !pp) return null;
    return (
        <span className="inline-flex shrink-0 items-center gap-1 text-micro uppercase">
            {unit ? (
                <span className={cn('inline-flex items-center gap-0.5 rounded-chip leading-4 md:border md:px-1', move === 'up' ? 'border-warn/60 text-warn' : 'border-line text-fg-3')}>
                    {unit}
                    {move ? (
                        <svg viewBox="0 0 8 8" className="h-2 w-2" aria-label={move === 'up' ? 'moved up the lineup' : 'moved down the lineup'}>
                            <path d={move === 'up' ? 'M4 1.5 7 6H1z' : 'M4 6.5 1 2h6z'} fill="currentColor" />
                        </svg>
                    ) : null}
                </span>
            ) : null}
            {pp ? <span className={cn('rounded-chip leading-4 md:border md:px-1', pp === 1 ? 'border-brand/50 text-brand' : 'border-line text-fg-3')}>PP{pp}</span> : null}
        </span>
    );
}

function gameLabel(g: PropGame) {
    return `${g.away} @ ${g.home}`;
}

export default function PropsBoard({ src, detailSrc, games: serverGames, slateDate, seasons }: PropsBoardProps) {
    const [doc, setDoc] = React.useState<PropsDoc | null>(null);
    const [failed, setFailed] = React.useState(false);
    const hasSlate = serverGames.length > 0;
    const [view, setView] = React.useState<View>(hasSlate ? 'tonight' : 'league');
    const [catKey, setCatKey] = React.useState<CategoryKey>('sog');
    const [choice, setChoice] = React.useState<LineChoice>('book');
    const [filter, setFilter] = React.useState<Filter>(DEFAULT_FILTER);
    const [sort, setSort] = React.useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
    const [shown, setShown] = React.useState(PAGE);
    const [open, setOpen] = React.useState<number | null>(null);
    // undefined = not loaded yet, null = failed.
    const [detail, setDetail] = React.useState<PropsDetailDoc | null | undefined>(undefined);
    const detailRequested = React.useRef(false);
    const searchId = React.useId();
    const rootRef = React.useRef<HTMLDivElement>(null);
    const barRef = React.useRef<HTMLDivElement>(null);

    // The column labels pin under the sticky control bar on wide screens; track its height.
    React.useEffect(() => {
        const bar = barRef.current;
        const root = rootRef.current;
        if (!bar || !root || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => root.style.setProperty('--props-bar-h', `${bar.offsetHeight}px`));
        ro.observe(bar);
        return () => ro.disconnect();
    }, []);

    React.useEffect(() => {
        let alive = true;
        fetch(src)
            .then(r => (r.ok ? (r.json() as Promise<PropsDoc>) : Promise.reject(new Error(String(r.status)))))
            .then(d => alive && setDoc(d))
            .catch(() => alive && setFailed(true));
        return () => {
            alive = false;
        };
    }, [src]);

    React.useEffect(() => {
        if (open == null || detailRequested.current) return;
        detailRequested.current = true;
        fetch(detailSrc)
            .then(r => (r.ok ? (r.json() as Promise<PropsDetailDoc>) : Promise.reject(new Error(String(r.status)))))
            .then(d => setDetail(d))
            .catch(() => setDetail(null));
    }, [open, detailSrc]);

    const cat = categoryOf(catKey);
    const games = doc?.games ?? serverGames;
    const allRows = React.useMemo(() => (doc ? buildRows(doc, view, cat, choice) : []), [doc, view, cat, choice]);
    const sortKey = sort?.key ?? defaultSort(allRows);
    const sortDir = sort?.dir ?? 'desc';
    const rows = React.useMemo(() => sortRows(filterRows(allRows, filter), sortKey, sortDir), [allRows, filter, sortKey, sortDir]);
    const visible = rows.slice(0, shown);
    const priced = view === 'tonight' && allRows.some(r => r.imp != null);
    const boostCount = allRows.filter(r => r.boost).length;

    const update = (patch: Partial<Filter>) => {
        setFilter(f => ({ ...f, ...patch }));
        setShown(PAGE);
    };
    const pickCategory = (k: CategoryKey) => {
        setCatKey(k);
        setChoice(k === 'sog' ? 'book' : categoryOf(k).lines[0].key);
        if (k !== 'pts' && k !== 'a' && filter.boost) update({ boost: false });
        setOpen(null);
        setShown(PAGE);
    };
    const onSort = (key: SortKey) => {
        setSort(s => (s?.key === key || (!s && sortKey === key) ? { key, dir: sortDir === 'desc' ? 'asc' : 'desc' } : { key, dir: FIRST_DIR[key] ?? 'desc' }));
        setShown(PAGE);
    };
    const toggleGame = (id: number) => update({ games: filter.games.includes(id) ? filter.games.filter(g => g !== id) : [...filter.games, id] });

    const lineOptions: { value: LineChoice; label: string; ariaLabel?: string }[] = [
        // Only SOG posts different lines per skater; the other categories have fixed thresholds.
        ...(cat.key === 'sog' && view === 'tonight' ? [{ value: 'book', label: 'Book', ariaLabel: "Each skater's posted line" }] : []),
        ...cat.lines.map(l => ({ value: l.key, label: l.label })),
    ];
    const lineValue = lineOptions.some(o => o.value === choice) ? choice : lineOptions[0].value;
    const head = (key: SortKey, label: string, title: string, className?: string, align: 'left' | 'right' | 'center' = 'center') => (
        <SortHeader
            align={align}
            title={title}
            direction={sortKey === key ? sortDir : null}
            onSort={() => onSort(key)}
            className={cn('whitespace-nowrap border-b border-line', className)}
        >
            {label}
        </SortHeader>
    );
    const showAtt = cat.key === 'sog';
    const colCount = 7 + (view === 'tonight' ? 3 : 0) + (showAtt ? 1 : 0) + (priced ? 3 : 0);
    const toggleOpen = React.useCallback((id: number) => setOpen(o => (o === id ? null : id)), []);

    return (
        <div ref={rootRef} className="flex flex-col gap-4">
            <PageHeading
                title="Props"
                actions={
                    hasSlate ? (
                        <Segmented
                            label="Players shown"
                            size="sm"
                            className="ml-auto"
                            optionClassName="px-2 md:px-3"
                            value={view}
                            onChange={v => {
                                setView(v);
                                setSort(null);
                                setOpen(null);
                                update({ games: [] });
                            }}
                            options={[
                                { value: 'tonight', label: 'Tonight' },
                                { value: 'league', label: 'League' },
                            ]}
                        />
                    ) : null
                }
            />
            {view === 'tonight' && games.length ? (
                    <div role="group" aria-label="Games" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 scrollbar-hide md:mx-0 md:flex-wrap md:px-0">
                        <FilterChip selected={filter.games.length === 0} onSelectedChange={() => update({ games: [] })}>
                            All {games.length}
                        </FilterChip>
                        {games.map(g => (
                            <FilterChip
                                key={g.id}
                                selected={filter.games.includes(g.id)}
                                onSelectedChange={() => toggleGame(g.id)}
                                aria-label={`${gameLabel(g)}${g.priced ? '' : ', no props posted'}`}
                                title={gameLabel(g)}
                                className={cn('gap-2 pl-1.5 pr-3', !g.priced && 'opacity-60')}
                                leading={
                                    <span className="flex items-center gap-0.5">
                                        <TeamLogo tri={g.away} size={24} />
                                        <TeamLogo tri={g.home} size={24} />
                                    </span>
                                }
                            >
                                <LocalTime iso={g.start} className="text-fg-3" />
                            </FilterChip>
                        ))}
                    </div>
                ) : null}

            <label htmlFor={searchId} className="sr-only">
                Search skaters or teams
            </label>
            <Input
                id={searchId}
                type="search"
                placeholder="SEARCH"
                value={filter.q}
                onChange={e => update({ q: e.target.value })}
                className="placeholder:tracking-label md:hidden"
            />

            {/* Sticky: the stat and line always stay named while the table scrolls. */}
            <div ref={barRef} className="sticky top-appbar z-20 -mx-4 flex flex-col gap-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur md:-mx-6 md:px-6">
                <div className="flex flex-wrap items-center gap-2">
                    <Segmented
                        label="Category"
                        value={catKey}
                        onChange={pickCategory}
                        options={CATEGORIES.map(c => ({ value: c.key, label: c.label }))}
                        className="w-full md:w-auto"
                        optionClassName="flex-1 px-2 md:flex-none md:min-h-10 md:px-4 md:text-base md:tracking-[0.08em]"
                    />
                    {lineOptions.length > 1 ? (
                        <Segmented label={`${cat.label} line`} size="sm" value={lineValue} onChange={v => setChoice(v)} options={lineOptions} optionClassName="px-2 md:px-3" />
                    ) : (
                        <span className="px-2 text-micro font-medium uppercase tracking-label text-fg-3">{cat.lines[0].label}</span>
                    )}
                    <label htmlFor={`${searchId}-md`} className="sr-only">
                        Search skaters or teams
                    </label>
                    <Input
                        id={`${searchId}-md`}
                        type="search"
                        placeholder="SEARCH"
                        value={filter.q}
                        onChange={e => update({ q: e.target.value })}
                        className="hidden placeholder:tracking-label md:ml-auto md:block md:w-56"
                    />
                </div>
                <div role="group" aria-label="Filters" className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 scrollbar-hide md:mx-0 md:flex-wrap md:px-0">
                    {(['all', 'F', 'D'] as const).map(p => (
                        <FilterChip key={p} selected={filter.pos === p} onSelectedChange={() => update({ pos: p })}>
                            {p === 'all' ? 'All' : p}
                        </FilterChip>
                    ))}
                    <FilterChip selected={filter.role === 'top6'} onSelectedChange={v => update({ role: v ? 'top6' : 'all' })} title="Top-six forwards and top-four defence on tonight's lines">
                        Top 6
                    </FilterChip>
                    <FilterChip selected={filter.role === 'pp1'} onSelectedChange={v => update({ role: v ? 'pp1' : 'all' })}>
                        PP1
                    </FilterChip>
                    <FilterChip selected={filter.hot} onSelectedChange={v => update({ hot: v })} title="Last 5 games at least 25 points above his season (or last season) rate">
                        Heating up
                    </FilterChip>
                    {priced ? (
                        <FilterChip selected={filter.priced} onSelectedChange={v => update({ priced: v })}>
                            Priced
                        </FilterChip>
                    ) : null}
                    {(catKey === 'pts' || catKey === 'a') && view === 'tonight' ? (
                        <FilterChip
                            selected={filter.boost}
                            onSelectedChange={v => update({ boost: v })}
                            count={boostCount}
                            title="Plus money to record a point, skating with a linemate priced -200 or shorter"
                            className={cn(!filter.boost && boostCount > 0 && 'border-warn/50 text-warn')}
                        >
                            Elite linemate
                        </FilterChip>
                    ) : null}
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-micro font-medium uppercase tracking-label text-fg-3">
                <p aria-live="polite">
                    <span className="text-fg-1">{doc ? rows.length : '…'}</span> {rows.length === 1 ? 'skater' : 'skaters'}
                    {view === 'tonight' && slateDate ? <span> · slate {slateDate}</span> : null}
                </p>
                <p className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-1.5 rounded-[1px] bg-brand" aria-hidden="true" /> over
                    <span className="ml-2 inline-block h-2.5 w-1.5 rounded-[1px] bg-[var(--mute)]" aria-hidden="true" /> under
                    <span className="ml-2 inline-block h-2.5 w-1.5 rounded-[1px] bg-brand opacity-40" aria-hidden="true" /> {seasons.prev}
                </p>
                {doc?.book_fetched_at && priced ? (
                    <p className="md:ml-auto">
                        Lines {doc.book_source} · <LocalTime iso={doc.book_fetched_at} />
                    </p>
                ) : null}
            </div>

            {failed ? (
                <p className="panel label p-card">Props unavailable. Try again after the next hourly update.</p>
            ) : !doc ? (
                <div aria-busy="true" className="h-[32rem] animate-pulse rounded-card border border-line bg-surface-1/60" />
            ) : rows.length === 0 ? (
                <div className="panel flex flex-col items-start gap-3 p-card">
                    <p className="label">No skaters match</p>
                    <button
                        type="button"
                        onClick={() => update(DEFAULT_FILTER)}
                        className="min-h-[34px] rounded-full border border-line px-3.5 text-micro font-medium uppercase tracking-chip text-fg-2 hover:border-line-strong hover:text-fg-1"
                    >
                        Clear filters
                    </button>
                </div>
            ) : (
                <ScrollRegion label={`${cat.label} props table`} className="rounded-card border border-line bg-surface-1 xl:overflow-visible">
                    <table className="w-full font-mono text-caption tabular-nums lg:min-w-[1080px]">
                        <caption className="sr-only">
                            {cat.label} props, {view === 'tonight' ? "tonight's slate" : 'all skaters'}, sorted by {sortKey} {sortDir === 'desc' ? 'highest first' : 'lowest first'}. Hit rates count games over the
                            line; recent windows include {seasons.prev} games early in the season.
                        </caption>
                        <thead className="bg-bg xl:sticky xl:top-[calc(var(--appbar-h)+var(--props-bar-h,0px))] xl:z-[15]">
                            <tr>
                                {head('name', 'Player', 'Skater, tonight’s line and power-play unit', 'sticky left-0 z-10 w-[9.5rem] min-w-[9.5rem] bg-bg md:w-64', 'left')}
                                {view === 'tonight' ? head('opp', 'Opp', `Opponent and its rank in ${cat.oppRank === 'sa_rank' ? 'shots' : 'goals'} allowed per game (1 = most)`, 'hidden md:table-cell', 'left') : null}
                                {view === 'tonight' ? head('toi', 'TOI', 'Expected minutes (recent games weighted)', 'hidden lg:table-cell', 'right') : null}
                                {view === 'tonight' ? head('proj', 'Proj', `pony xG projected ${cat.stat} tonight (the mean behind the fair price)`, 'hidden md:table-cell', 'right') : null}
                                {showAtt ? head('att', 'Att/G', 'Shot attempts per game, last 10: on net, missed and blocked', 'hidden lg:table-cell', 'right') : null}
                                <th scope="col" className="border-b border-line px-2 text-left text-micro font-medium uppercase tracking-[0.06em] text-fg-3">
                                    <span className="hidden md:inline">Last 20</span>
                                    <span className="md:hidden">Games</span>
                                </th>
                                {head('l5', 'L5', 'Over in the last 5 games', 'hidden md:table-cell')}
                                {head('l10', 'L10', 'Over in the last 10 games')}
                                {head('l20', 'L20', 'Over in the last 20 games', 'hidden lg:table-cell')}
                                {head('szn', seasons.cur, 'Over this season (last season lives in the row detail)', 'hidden md:table-cell')}
                                {head('streak', 'Strk', 'Games in a row over the line', 'hidden xl:table-cell')}
                                {priced ? head('imp', 'Book', 'Posted over price; implied chance (two-way lines de-vigged, one-way prices include the vig)', 'hidden lg:table-cell', 'right') : null}
                                {priced ? head('fair', 'Fair', 'pony xG fair price for the over, and its chance', 'hidden lg:table-cell', 'right') : null}
                                {priced ? head('edge', 'Edge', 'pony xG minus book implied, in percentage points', 'md:min-w-[5rem]', 'right') : null}
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map(r => (
                                <PropRow
                                    key={r.p.id}
                                    r={r}
                                    cat={cat}
                                    choice={choice}
                                    view={view}
                                    priced={priced}
                                    open={open === r.p.id}
                                    showAtt={showAtt}
                                    detail={open !== r.p.id || detail === undefined ? undefined : (detail?.players[String(r.p.id)] ?? null)}
                                    onToggle={toggleOpen}
                                    doc={doc}
                                    colCount={colCount}
                                    seasons={seasons}
                                />
                            ))}
                        </tbody>
                    </table>
                </ScrollRegion>
            )}

            {doc && rows.length > shown ? (
                <button
                    type="button"
                    onClick={() => setShown(n => n + PAGE)}
                    className="mx-auto min-h-[34px] rounded-full border border-line px-4 text-micro font-medium uppercase tracking-chip text-fg-2 transition-colors hover:border-line-strong hover:text-fg-1 coarse:min-h-11"
                >
                    Show {Math.min(PAGE, rows.length - shown)} more · {rows.length - shown} left
                </button>
            ) : null}
        </div>
    );
}

interface PropRowProps {
    r: Row;
    cat: Category;
    choice: LineChoice;
    view: View;
    priced: boolean;
    open: boolean;
    showAtt: boolean;
    detail: PlayerDetail | null | undefined;
    onToggle: (id: number) => void;
    doc: PropsDoc;
    colCount: number;
    seasons: { cur: string; prev: string };
}

const PropRow = React.memo(function PropRow({ r, cat, choice, view, priced, open, showAtt, detail, onToggle, doc, colCount, seasons }: PropRowProps) {
    const { p, line } = r;
    const book = p.book?.[line.key];
    const detailId = `prop-detail-${p.id}`;
    return (
        <>
            <tr className="group">
                <th scope="row" className={cn(CELL_BG, 'sticky left-0 z-10 h-11 w-[9.5rem] min-w-[9.5rem] border-b border-line px-2 text-left font-normal md:w-64')}>
                    <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={detailId}
                        onClick={() => onToggle(p.id)}
                        className="flex w-full items-center gap-2 text-left focus-visible:outline-offset-[-2px]"
                    >
                        <TeamLogo tri={p.team} size={22} />
                        <span className="flex min-w-0 flex-col">
                            <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate font-bold text-fg-1 group-hover:text-brand">
                                    <span className="md:hidden">{shortName(p.name)}</span>
                                    <span className="hidden md:inline">{p.name}</span>
                                </span>
                                <span className="shrink-0 text-micro uppercase text-fg-3">{p.pos}</span>
                                {r.hot ? (
                                    <span className="shrink-0 rounded-chip bg-warn/10 px-1 text-micro font-semibold uppercase leading-4 text-warn" title="Last 5 well above his baseline">
                                        Hot
                                    </span>
                                ) : null}
                            </span>
                            <span className="flex min-w-0 items-center gap-1.5 text-micro text-fg-3">
                                <UnitChip unit={p.unit} pp={p.pp} move={p.move} />
                                {view === 'tonight' && p.opp ? (
                                    <span className="uppercase md:hidden">
                                        {p.home ? 'vs' : '@'} {p.opp}
                                    </span>
                                ) : null}
                                {view === 'tonight' && cat.key === 'sog' && choice === 'book' ? <span className="uppercase text-fg-2">{line.label}</span> : null}
                                {r.boost ? (
                                    <span className="truncate text-warn" title={`Skates with ${r.boost.mate.name}, ${Math.round(r.boost.imp * 100)}% to record a point`}>
                                        w/ {r.boost.mate.name.split(' ').slice(-1)[0]}
                                    </span>
                                ) : null}
                            </span>
                        </span>
                    </button>
                </th>
                {view === 'tonight' ? (
                    <td className={cn(CELL_BG, 'hidden h-11 whitespace-nowrap border-b border-line px-2 md:table-cell')}>
                        {p.opp ? (
                            <span className="flex items-center gap-1.5">
                                <span className="text-fg-3">{p.home ? 'vs' : '@'}</span>
                                <TeamLogo tri={p.opp} size={18} />
                                <span className="text-fg-2">{p.opp}</span>
                                {r.oppRank != null ? (
                                    <span className={cn('text-micro', r.oppRank <= 8 ? 'font-semibold text-warn' : 'text-fg-3')} title={r.oppRank <= 8 ? 'Top-8 in allowed: soft matchup' : undefined}>#{r.oppRank}</span>
                                ) : null}
                            </span>
                        ) : null}
                    </td>
                ) : null}
                {view === 'tonight' ? (
                    <td className={cn(CELL_BG, 'hidden h-11 whitespace-nowrap border-b border-line px-2 text-right text-fg-2 lg:table-cell')}>{p.toi?.toFixed(1) ?? '—'}</td>
                ) : null}
                {view === 'tonight' ? (
                    <td className={cn(CELL_BG, 'hidden h-11 whitespace-nowrap border-b border-line px-2 text-right md:table-cell')}>
                        {r.proj != null ? (
                            <span className="flex flex-col items-end leading-tight">
                                <span className="text-model">{r.proj.toFixed(cat.key === 'sog' ? 1 : 2)}</span>
                                {cat.key === 'sog' ? (
                                    <span className="text-micro text-fg-3" title={`Projection minus the ${line.label} line`}>
                                        {r.proj - (line.k - 0.5) >= 0 ? '+' : '−'}
                                        {Math.abs(r.proj - (line.k - 0.5)).toFixed(1)}
                                    </span>
                                ) : null}
                            </span>
                        ) : (
                            <span className="text-fg-disabled">—</span>
                        )}
                    </td>
                ) : null}
                {showAtt ? (
                    <td className={cn(CELL_BG, 'hidden h-11 whitespace-nowrap border-b border-line px-2 text-right lg:table-cell', r.att == null ? 'text-fg-disabled' : 'text-fg-1')}>
                        {r.att?.toFixed(1) ?? '—'}
                    </td>
                ) : null}
                <td className={cn(CELL_BG, 'h-11 border-b border-line px-1.5 md:px-2')}>
                    <HitTape log={p.log} cat={cat} line={line} className="hidden md:block" />
                    <HitTape log={p.log} cat={cat} line={line} games={10} size="compact" className="md:hidden" />
                </td>
                <RateCell r={r.l5} title="Last 5" className="hidden md:table-cell" />
                <RateCell r={r.l10} title="Last 10" />
                <RateCell r={r.l20} title="Last 20" className="hidden lg:table-cell" />
                <RateCell r={r.szn} title={seasons.cur} className="hidden md:table-cell" />
                <td className={cn(CELL_BG, 'hidden h-11 border-b border-line px-2 text-center text-fg-2 xl:table-cell')}>{r.streak || <span className="text-fg-disabled">0</span>}</td>
                {priced ? (
                    <td className={cn(CELL_BG, 'hidden h-11 whitespace-nowrap border-b border-line px-2 text-right lg:table-cell')}>
                        {book ? (
                            <span className="flex flex-col items-end leading-tight">
                                <span className="text-fg-1">{american(book.over)}</span>
                                <span className="text-micro text-fg-3">
                                    {book.imp != null ? `${Math.round(book.imp * 100)}%` : ''}
                                    {book.devig ? '' : '*'}
                                </span>
                            </span>
                        ) : (
                            <span className="text-fg-disabled">—</span>
                        )}
                    </td>
                ) : null}
                {priced ? (
                    <td className={cn(CELL_BG, 'hidden h-11 whitespace-nowrap border-b border-line px-2 text-right lg:table-cell')}>
                        {r.fair != null ? (
                            <span className="flex flex-col items-end leading-tight">
                                <span className="text-model">{fairAmerican(r.fair)}</span>
                                <span className="text-micro text-fg-3">{Math.round(r.fair * 100)}%</span>
                            </span>
                        ) : (
                            <span className="text-fg-disabled">—</span>
                        )}
                    </td>
                ) : null}
                {priced ? (
                    <td className={cn(CELL_BG, 'h-11 border-b border-line pl-1 pr-2 text-right md:px-2')}>
                        <span className="flex items-center justify-end gap-2">
                            <span className="flex flex-col items-end leading-tight">
                                <EdgeValue e={r.edge} />
                                {r.fair != null ? (
                                    <span className="flex flex-col items-end whitespace-nowrap pr-1 text-micro leading-[14px] lg:hidden">
                                        <span className="text-model">{fairAmerican(r.fair)}</span>
                                        {book ? <span className="text-fg-2">{american(book.over)}</span> : null}
                                    </span>
                                ) : null}
                            </span>
                        </span>
                    </td>
                ) : null}
            </tr>
            {open ? (
                <tr id={detailId}>
                    <td colSpan={colCount} className="border-b border-line bg-surface-2 p-0">
                        <PropDetail r={r} cat={cat} doc={doc} detail={detail} seasons={seasons} />
                    </td>
                </tr>
            ) : null}
        </>
    );
});
