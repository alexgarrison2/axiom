'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Segmented } from '@/components/ui/segmented';
import { FilterChip } from '@/components/ui/filter-chip';
import { FilterSheet } from '@/components/ui/filter-sheet';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { InfoTip } from '@/components/ui/info-tip';
import { cn } from '@/lib/utils';
import { SEASON_ID } from '@/lib/season';
import { calculateTeamStats } from '@/utils/team-stats/calculate';
import { fetchJsonCached, leagueGamesUrl, leagueUrl, primeCache } from '@/utils/team-stats/client-cache';
import {
    DEFAULT_FILTERS, activeFilterCount, filterGames, groupByTeam, needsGameRows, sanitizeFilters,
    type Location, type Recent, type TableFilters, type TableView,
} from '@/utils/team-stats/filter';
import { signed, slateDate } from '@/utils/team-stats/format';
import { unpackGames } from '@/utils/team-stats/game-row';
import { seasonLabel, TEAM_SEASONS, seasonGames } from '@/utils/team-stats/season';
import { computeStandings } from '@/utils/team-stats/standings';
import { DIVISION_OF, DIVISIONS, DIVISION_LABEL, TEAM_TRICODES } from '@/utils/team-stats/teams';
import type { Division, GameRow, LeaguePayload, Matchup, PackedGames, PeriodFilter, TeamStat } from '@/utils/team-stats/types';
import { COLUMN_BY_KEY, SECTIONS, SECTION_KEYS, columnValue, heatColor, type StatColumn } from './columns';
import { ChipRow, Field, RangeFields, TriField } from './FilterFields';
import { HeaderCell, type SortDir } from './HeaderCell';
import { SeasonBanner } from './SeasonBanner';
import { useStickyHeader } from './useStickyHeader';

const STORAGE_KEY = 'ponyxg:teams-table:v2';

interface Persisted {
    filters?: unknown;
    section?: string;
    sort?: { key?: string; dir?: string };
}

function readPersisted(): Persisted {
    try {
        const raw = window.sessionStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as Persisted) : {};
    } catch {
        return {};
    }
}

interface TeamRow extends TeamStat {
    starterName?: string;
    starterStatus?: string;
    matchup?: Matchup;
    side?: 'home' | 'away';
}

const CLINCH_LABEL: Record<string, string> = {
    p: "Presidents' Trophy",
    z: 'Clinched division',
    y: 'Clinched conference',
    x: 'Clinched playoff spot',
    e: 'Eliminated',
};

/**
 * The league table on /teams. The server renders the default view (this
 * season, regular season, every team) so the table is the first paint;
 * game-level filters lazily load one compact games file per season and
 * recompute in the browser with the same pure functions.
 */
export default function TeamsTable({ initial }: { initial?: LeaguePayload }) {
    const [season, setSeason] = React.useState<string>(initial?.season ?? SEASON_ID);
    const [payloads, setPayloads] = React.useState<Record<string, LeaguePayload>>(() => (initial ? { [initial.season]: initial } : {}));
    const [filters, setFilters] = React.useState<TableFilters>(DEFAULT_FILTERS);
    const [section, setSection] = React.useState<string>('overview');
    const [sort, setSort] = React.useState<{ key: string; dir: SortDir }>({ key: 'points', dir: 'desc' });
    const [games, setGames] = React.useState<Record<string, GameRow[]>>({});
    const [loadError, setLoadError] = React.useState<string | null>(null);
    const [hydrated, setHydrated] = React.useState(false);
    const tableRef = React.useRef<HTMLTableElement>(null);

    if (initial) primeCache(leagueUrl(initial.season), initial);

    const payload = payloads[season];
    const allowPlayoffs = !!payload?.hasPlayoffGames;
    const allowBracket = !!payload?.isCurrent && !!payload?.hasPlayoffGames;

    // Restore the session's view (validated), and ?season= from the URL.
    React.useEffect(() => {
        const saved = readPersisted();
        const params = new URLSearchParams(window.location.search);
        const qs = params.get('season');
        if (qs && (TEAM_SEASONS as readonly string[]).includes(qs)) setSeason(qs);
        if (saved.section && SECTION_KEYS.includes(saved.section)) setSection(saved.section);
        if (saved.sort?.key && COLUMN_BY_KEY.has(saved.sort.key)) setSort({ key: saved.sort.key, dir: saved.sort.dir === 'asc' ? 'asc' : 'desc' });
        if (saved.filters) setFilters(sanitizeFilters(saved.filters, { playoffs: true, bracket: true }));
        setHydrated(true);
    }, []);

    // Re-validate filters whenever the season (and what it allows) changes.
    React.useEffect(() => {
        if (!payload) return;
        setFilters(f => {
            const next = sanitizeFilters(f, { playoffs: allowPlayoffs, bracket: allowBracket });
            return JSON.stringify(next) === JSON.stringify(f) ? f : next;
        });
    }, [payload, allowPlayoffs, allowBracket]);

    React.useEffect(() => {
        if (!hydrated) return;
        try {
            window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ filters, section, sort }));
        } catch {
            /* private mode */
        }
    }, [filters, section, sort, hydrated]);

    // Season payloads (the current one arrives with the page).
    React.useEffect(() => {
        if (payloads[season]) return;
        let live = true;
        fetchJsonCached<LeaguePayload>(leagueUrl(season))
            .then(p => live && setPayloads(prev => ({ ...prev, [season]: p })))
            .catch(() => live && setLoadError('Could not load that season.'));
        return () => {
            live = false;
        };
    }, [season, payloads]);

    const wantRows = needsGameRows(filters);
    const periods = filters.period !== 'All';
    const gamesKey = `${season}|${periods ? 'full' : 'core'}`;
    React.useEffect(() => {
        if (!wantRows || games[gamesKey]) return;
        let live = true;
        fetchJsonCached<PackedGames>(leagueGamesUrl(season, periods))
            .then(p => live && setGames(prev => ({ ...prev, [gamesKey]: unpackGames(p) })))
            .catch(() => live && setLoadError('Could not load game-level data for these filters.'));
        return () => {
            live = false;
        };
    }, [wantRows, gamesKey, season, periods, games]);

    const seasonRows = games[gamesKey] ?? (periods ? undefined : games[`${season}|full`]);
    const pending = wantRows && !seasonRows;

    // ── rows ────────────────────────────────────────────────────────────────
    const model = React.useMemo(() => {
        if (!payload) return null;
        const base = payload.standings;
        const info = new Map(base.map(r => [r.tri, r]));
        const byTeam = seasonRows ? groupByTeam(seasonRows) : null;
        const attach = (s: TeamStat): TeamRow => {
            const i = info.get(s.tri);
            return i
                ? { ...s, ranking: i.ranking, divRank: i.divRank, isPlayoff: i.isPlayoff, clinch: i.clinch, magic_number: i.magic_number, tragic_number: i.tragic_number }
                : s;
        };
        const statsFor = (tri: string, opts: { location?: Location; starter?: string; dow?: number } = {}): TeamRow => {
            if (!byTeam || (!wantRows && !opts.starter && opts.dow === undefined && (opts.location ?? 'All') === 'All')) return info.get(tri) ?? attach(calculateTeamStats(tri, []));
            const g = filterGames(byTeam.get(tri) ?? [], {
                ...filters,
                location: opts.location ?? filters.location,
                starter: opts.starter,
                dayOfWeek: opts.dow,
            });
            return attach(calculateTeamStats(tri, g, filters.period));
        };

        // League-wide rows under the current filters (colour ranges + "all" view).
        const league = TEAM_TRICODES.map(tri => statsFor(tri));

        let rows: TeamRow[];
        let paired = false;
        if (filters.view === 'today' || filters.view === 'tomorrow') {
            paired = true;
            const date = slateDate(filters.view === 'today' ? 0 : 1);
            const dow = filters.withDow ? new Date(`${date}T12:00:00`).getDay() : undefined;
            rows = payload.matchups
                .filter(m => m.date === date)
                .flatMap(m => {
                    const away = statsFor(m.away, {
                        location: filters.withLocation ? 'Away' : undefined,
                        starter: filters.withStarter ? m.awayStarter : undefined,
                        dow,
                    });
                    const home = statsFor(m.home, {
                        location: filters.withLocation ? 'Home' : undefined,
                        starter: filters.withStarter ? m.homeStarter : undefined,
                        dow,
                    });
                    return [
                        { ...away, matchup: m, side: 'away' as const, starterName: m.awayStarter, starterStatus: m.awayStarterStatus },
                        { ...home, matchup: m, side: 'home' as const, starterName: m.homeStarter, starterStatus: m.homeStarterStatus },
                    ];
                });
        } else if (filters.view === 'bracket') {
            paired = true;
            const { brackets } = computeStandings(base, [], seasonGames(season));
            const byTri = new Map(league.map(r => [r.tri, r]));
            rows = brackets.flatMap(b => b.matchups.flatMap(([hi, lo]) => [byTri.get(hi)!, byTri.get(lo)!]).filter(Boolean));
        } else {
            rows = league.filter(r => {
                if (filters.divisions.length && !filters.divisions.includes(DIVISION_OF[r.tri] as Division)) return false;
                if (filters.position === 'In' && !r.isPlayoff) return false;
                if (filters.position === 'Out' && r.isPlayoff) return false;
                return true;
            });
        }
        return { league, rows, paired };
    }, [payload, seasonRows, filters, wantRows, season]);

    const sectionDef = SECTIONS.find(s => s.key === section) ?? SECTIONS[0];
    const ratingsMissing = section === 'ratings' && !payload?.ratings;
    const columns: { col: StatColumn; groupEnd: boolean; group: string }[] = React.useMemo(
        () =>
            sectionDef.groups.flatMap(g =>
                g.cols
                    .map(k => COLUMN_BY_KEY.get(k))
                    .filter((c): c is StatColumn => !!c)
                    .map((col, i, arr) => ({ col, groupEnd: i === arr.length - 1, group: g.name })),
            ),
        [sectionDef],
    );

    const ranges = React.useMemo(() => {
        const out = new Map<string, [number, number]>();
        if (!model) return out;
        const played = model.league.filter(r => r.gp > 0);
        for (const { col } of columns) {
            const vals = played.map(r => columnValue(col, r, payload?.ratings ?? null)).filter(Number.isFinite);
            if (vals.length > 1) out.set(col.key, [Math.min(...vals), Math.max(...vals)]);
        }
        return out;
    }, [model, columns, payload]);

    const sorted = React.useMemo(() => {
        if (!model) return [];
        if (model.paired) return model.rows;
        const col = COLUMN_BY_KEY.get(sort.key);
        const order = [...payload!.standings]
            .sort((a, b) => b.points - a.points || b.pt_pct - a.pt_pct || b.rw - a.rw || a.tri.localeCompare(b.tri))
            .map(r => r.tri);
        const pos = new Map(order.map((t, i) => [t, i]));
        const val = (r: TeamRow) => {
            if (!col || col.key === 'ranking') return -(pos.get(r.tri) ?? 99);
            const v = columnValue(col, r, payload?.ratings ?? null);
            return Number.isFinite(v) ? v : null;
        };
        return [...model.rows].sort((a, b) => {
            const va = val(a);
            const vb = val(b);
            if (va === null && vb === null) return (pos.get(a.tri) ?? 0) - (pos.get(b.tri) ?? 0);
            if (va === null) return 1;
            if (vb === null) return -1;
            if (va !== vb) return sort.dir === 'desc' ? vb - va : va - vb;
            return (pos.get(a.tri) ?? 0) - (pos.get(b.tri) ?? 0);
        });
    }, [model, sort, payload]);

    useStickyHeader(tableRef, [section, season, sorted.length]);

    // ── handlers ────────────────────────────────────────────────────────────
    const setF = <K extends keyof TableFilters>(k: K, v: TableFilters[K]) => setFilters(f => ({ ...f, [k]: v }));
    const changeSeason = (s: string) => {
        setSeason(s);
        try {
            const url = new URL(window.location.href);
            if (s === SEASON_ID) url.searchParams.delete('season');
            else url.searchParams.set('season', s);
            window.history.replaceState(window.history.state, '', url);
        } catch {
            /* ignore */
        }
    };
    const onSort = (key: string) =>
        setSort(s => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'ranking' ? 'asc' : 'desc' }));

    const active = activeFilterCount(filters);
    const chips = activeChips(filters, setFilters);
    const prevSeason = TEAM_SEASONS.find(s => s !== season);

    if (!payload) {
        return (
            <div className="hud-panel p-6 text-body-sm text-fg-2" role="status">
                {loadError ?? 'Loading the table…'}
            </div>
        );
    }

    const scopeLabel = filters.scope === 'playoffs' ? 'playoffs' : 'regular season';
    const gpNote = payload.maxGp > 0 ? `through ${payload.maxGp} ${payload.maxGp === 1 ? 'game' : 'games'}` : 'no games yet';
    const viewNote =
        filters.view === 'today' ? "Teams playing today" : filters.view === 'tomorrow' ? 'Teams playing tomorrow' : filters.view === 'bracket' ? 'First-round bracket if the playoffs started today' : null;

    return (
        <section aria-label="League table" className="flex flex-col gap-3">
            {/* Toolbar: season · quick filters · all filters */}
            <div className="flex flex-wrap items-center gap-2">
                <Segmented
                    label="Season"
                    value={season}
                    onChange={changeSeason}
                    options={TEAM_SEASONS.map(s => ({ value: s, label: seasonLabel(s) }))}
                />
                <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-line sm:block" />
                <div className="flex flex-wrap items-center gap-2">
                    <FilterChip selected={filters.recent === 10} onSelectedChange={on => setF('recent', on ? 10 : 'All')}>
                        Last 10
                    </FilterChip>
                    <FilterChip selected={filters.location === 'Home'} onSelectedChange={on => setF('location', on ? 'Home' : 'All')}>
                        Home
                    </FilterChip>
                    <FilterChip selected={filters.location === 'Away'} onSelectedChange={on => setF('location', on ? 'Away' : 'All')}>
                        Away
                    </FilterChip>
                    <FilterSheet
                        activeCount={active}
                        triggerLabel="Filters"
                        title="Filter the table"
                        description="Filters apply to every team. Ranks and clinch codes always use the full season."
                        onReset={() => setFilters({ ...DEFAULT_FILTERS, ranges: {} })}
                        applyLabel="Show table"
                    >
                        <TableFilterFields filters={filters} setF={setF} setFilters={setFilters} allowPlayoffs={allowPlayoffs} allowBracket={allowBracket} />
                    </FilterSheet>
                </div>
            </div>

            <SeasonBanner
                seasonLabel={payload.seasonLabel}
                maxGp={payload.maxGp}
                isCurrent={payload.isCurrent}
                startsOn={payload.seasonStartsOn}
                previousLabel={prevSeason ? `${seasonLabel(prevSeason)} final standings` : undefined}
                onViewPrevious={payload.maxGp === 0 && prevSeason ? () => changeSeason(prevSeason) : undefined}
            />

            {chips.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
                    {chips.map(c => (
                        <FilterChip key={c.key} selected removable onClick={c.clear} aria-label={`Remove filter: ${c.label}`}>
                            {c.label}
                        </FilterChip>
                    ))}
                    <button type="button" onClick={() => setFilters({ ...DEFAULT_FILTERS, ranges: {} })} className="min-h-9 px-2 text-body-sm font-semibold text-fg-2 underline-offset-4 hover:text-fg-1 hover:underline coarse:min-h-11">
                        Clear all
                    </button>
                </div>
            ) : null}

            {/* Column sets */}
            <ScrollRegion label="Stat sections" className="-mx-4 px-4 pb-1 md:mx-0 md:px-0">
                <Segmented label="Stat section" size="sm" value={section} onChange={setSection} options={SECTIONS.map(s => ({ value: s.key, label: s.label }))} />
            </ScrollRegion>

            {ratingsMissing ? (
                <p className="text-body-sm text-fg-2">Ratings are published for the current season only.</p>
            ) : null}
            {loadError ? (
                <p role="alert" className="text-body-sm text-neg">
                    {loadError}
                </p>
            ) : null}

            <div className="relative">
                <ScrollRegion label={`${payload.seasonLabel} team table`} className="rounded-card border border-line bg-surface-1 shadow-card">
                    <table
                        ref={tableRef}
                        className="table-fixed border-separate border-spacing-0 text-body-sm [--team-col:64px] md:[--team-col:220px]"
                        style={{ width: `calc(var(--team-col) + ${columns.reduce((w, c) => w + colWidth(c.col), 0)}px)`, minWidth: '100%' }}
                        aria-busy={pending || undefined}
                    >
                        <caption className="px-3 pb-2 pt-3 text-left text-caption text-fg-2">
                            <span className="font-semibold text-fg-1">
                                {payload.seasonLabel} {scopeLabel}
                            </span>{' '}
                            · {gpNote}
                            {viewNote ? <> · {viewNote}</> : null}
                            {section === 'ratings' && payload.ratingsSeasonLabel ? <> · Ratings: {payload.ratingsSeasonLabel}</> : null}
                            {pending ? <span className="ml-2 text-brand">Updating…</span> : null}
                        </caption>
                        <colgroup>
                            <col style={{ width: 'var(--team-col)' }} />
                            {columns.map(({ col }) => (
                                <col key={col.key} style={{ width: colWidth(col) }} />
                            ))}
                        </colgroup>
                        <thead className="[--thead-y:0px]">
                            {section === 'all' ? (
                                <tr>
                                    <td className={cn(STICKY_HEAD, 'left-0 z-[4] border-b-0')} />
                                    {sectionDef.groups.map(g => (
                                        <th
                                            key={g.name}
                                            scope="colgroup"
                                            colSpan={g.cols.length}
                                            className={cn(HEAD_BASE, 'z-[3] border-b-0 border-r border-line px-2 pt-2 text-left')}
                                        >
                                            <span className="hud-label text-fg-3">{g.name}</span>
                                        </th>
                                    ))}
                                </tr>
                            ) : null}
                            <tr>
                                <th scope="col" className={cn(STICKY_HEAD, 'left-0 z-[4] px-1.5 text-left md:px-3')}>
                                    <span className="text-micro uppercase tracking-[0.04em] text-fg-2">Team</span>
                                </th>
                                {columns.map(({ col, groupEnd }) => (
                                    <HeaderCell
                                        key={col.key}
                                        label={col.label}
                                        title={col.title}
                                        tip={col.tip}
                                        direction={model?.paired ? undefined : sort.key === col.key ? sort.dir : null}
                                        onSort={model?.paired ? undefined : () => onSort(col.key)}
                                        className={cn(HEAD_BASE, 'z-[3]', groupEnd && 'border-r border-line')}
                                    />
                                ))}
                            </tr>
                        </thead>
                        <tbody className={cn(pending && 'opacity-60 transition-opacity')}>
                            {sorted.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.length + 1} className="px-4 py-8 text-center text-body-sm text-fg-2">
                                        {filters.view === 'today' || filters.view === 'tomorrow' ? 'No games on that slate.' : 'No teams match these filters.'}
                                    </td>
                                </tr>
                            ) : (
                                sorted.map((row, idx) => (
                                    <Row
                                        key={`${row.tri}-${idx}`}
                                        row={row}
                                        idx={idx}
                                        columns={columns}
                                        ranges={ranges}
                                        payload={payload}
                                        paired={!!model?.paired}
                                        period={filters.period}
                                        showStarter={filters.withStarter}
                                        pairEnd={!!model?.paired && idx % 2 === 1 && idx < sorted.length - 1}
                                    />
                                ))
                            )}
                        </tbody>
                    </table>
                </ScrollRegion>
            </div>

            <Legend payload={payload} />
        </section>
    );
}

const colWidth = (c: StatColumn) => (c.tip ? 84 : c.label.length > 5 ? 76 : 64);

/** Record counts read 0 (not —) before a team's first game. */
const COUNTING = new Set(['gp', 'wins', 'losses', 'otl', 'points', 'rw']);

const HEAD_BASE = 'relative bg-surface-2 border-b border-line [transform:translateY(var(--thead-y))] will-change-transform';
const STICKY_HEAD = 'sticky bg-surface-2 border-b border-r border-line [transform:translateY(var(--thead-y))] shadow-[4px_0_8px_-6px_rgba(0,0,0,0.8)]';

function Row({
    row, idx, columns, ranges, payload, paired, period, showStarter, pairEnd,
}: {
    row: TeamRow;
    idx: number;
    columns: { col: StatColumn; groupEnd: boolean }[];
    ranges: Map<string, [number, number]>;
    payload: LeaguePayload;
    paired: boolean;
    period: PeriodFilter;
    showStarter: boolean;
    pairEnd: boolean;
}) {
    const meta = payload.teams.find(t => t.tri === row.tri);
    const clinch = row.clinch ?? null;
    const oddsOf = (m?: Matchup, side?: 'home' | 'away') => {
        if (!m || !side) return null;
        const ml = side === 'home' ? m.homeVegasOdds : m.awayVegasOdds;
        const ev = side === 'home' ? m.homeEV : m.awayEV;
        return { ml, ev };
    };
    const odds = paired ? oddsOf(row.matchup, row.side) : null;
    const zebra = idx % 2 === 1 ? 'bg-surface-2/40' : '';
    return (
        <tr className={cn('group', pairEnd && '[&>*]:border-b-8 [&>*]:border-b-bg')}>
            <th
                scope="row"
                className={cn(
                    'sticky left-0 z-[2] border-b border-r border-line bg-surface-1 px-1 py-0.5 text-left font-normal md:px-3 shadow-[4px_0_8px_-6px_rgba(0,0,0,0.8)] group-hover:bg-surface-2',
                )}
            >
                <div className="flex min-h-9 items-center gap-1 md:gap-2">
                    {!paired ? <span className="hidden w-5 shrink-0 text-right text-caption tabular-nums text-fg-3 md:inline">{idx + 1}</span> : null}
                    <Link href={`/teams/${row.tri}`} className="flex min-h-9 min-w-0 items-center gap-1 rounded-chip hover:text-brand md:gap-2">
                        <span className="relative shrink-0">
                            <Image src={`/logos/${row.tri}.svg`} alt="" width={28} height={28} unoptimized className="h-5 w-5 object-contain md:h-7 md:w-7" />
                            {clinch ? (
                                <span
                                    title={CLINCH_LABEL[clinch]}
                                    className={cn(
                                        'absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] px-0.5 text-micro font-bold uppercase leading-none ring-2 ring-surface-1 md:hidden',
                                        clinch === 'e' ? 'bg-neg text-bg' : 'bg-pos text-bg',
                                    )}
                                    aria-hidden="true"
                                >
                                    {clinch}
                                </span>
                            ) : null}
                        </span>
                        <span className="min-w-0">
                            <span className="block truncate text-caption font-semibold text-fg-1 md:hidden">{row.tri}</span>
                            <span className="hidden truncate font-semibold text-fg-1 md:block">{meta?.common ?? row.tri}</span>
                            {paired && showStarter && row.starterName ? (
                                <span className="block truncate text-micro normal-case text-fg-2">
                                    {row.starterName.split(' ').slice(-1)[0]}
                                    <span className="sr-only"> ({row.starterStatus})</span>
                                </span>
                            ) : null}
                        </span>
                    </Link>
                    {clinch ? (
                        <span
                            title={CLINCH_LABEL[clinch]}
                            className={cn(
                                'ml-auto hidden h-5 min-w-5 shrink-0 items-center justify-center rounded-chip px-1 text-micro font-bold uppercase md:inline-flex',
                                clinch === 'e' ? 'bg-neg/15 text-neg' : 'bg-pos/15 text-pos',
                            )}
                        >
                            {clinch}
                        </span>
                    ) : null}
                    {clinch ? <span className="sr-only"> ({CLINCH_LABEL[clinch]})</span> : null}
                    {paired && row.side ? (
                        <span className="ml-auto hidden shrink-0 text-right md:block">
                            <span className="block text-micro uppercase text-fg-3">{row.side === 'home' ? 'Home' : 'Away'}</span>
                            {odds?.ml != null ? (
                                <span className="block text-caption tabular-nums text-fg-2">
                                    {odds.ml > 0 ? `+${odds.ml}` : signed(odds.ml)}
                                    {odds.ev != null ? <span className={cn('ml-1', odds.ev >= 0 ? 'text-pos' : 'text-fg-3')}>EV {signed(odds.ev, 1)}%</span> : null}
                                </span>
                            ) : null}
                        </span>
                    ) : null}
                </div>
            </th>
            {columns.map(({ col, groupEnd }) => {
                const base = cn('border-b border-line px-1.5 py-0.5 text-center tabular-nums', zebra, groupEnd && 'border-r', 'group-hover:bg-surface-2');
                if (col.key === 'ranking') {
                    return (
                        <td key={col.key} className={cn(base, row.isPlayoff ? 'font-semibold text-fg-1' : 'text-fg-2')}>
                            {row.ranking && row.ranking !== '—' ? row.ranking : '—'}
                            {row.isPlayoff ? <span className="sr-only"> (playoff position)</span> : null}
                        </td>
                    );
                }
                const counting = COUNTING.has(col.key);
                const blank = row.gp === 0 && !col.rating && !counting ? true : period !== 'All' && col.fullGameOnly;
                const v = blank ? NaN : columnValue(col, row, payload.ratings);
                const r = ranges.get(col.key);
                const color = r && row.gp > 0 ? heatColor(v, r[0], r[1], col.better) : undefined;
                return (
                    <td key={col.key} className={cn(base, 'text-fg-1')} style={color ? { color } : undefined}>
                        {Number.isFinite(v) ? col.format(v) : <span className="text-fg-3">—</span>}
                    </td>
                );
            })}
        </tr>
    );
}

function Legend({ payload }: { payload: LeaguePayload }) {
    return (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-caption text-fg-3">
            <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="h-2 w-16 rounded-full bg-[linear-gradient(90deg,rgb(255_110_128),rgb(201_209_219),rgb(92_240_160))]" />
                Colour compares each team with the league under the current filters (red worse, green better).
            </span>
            {payload.clinch ? (
                <span className="inline-flex items-center gap-1">
                    Clinch codes <InfoTip term="clinch-codes" />
                </span>
            ) : null}
            <span>GF/GA credit the shootout winner with one goal, as NHL standings do.</span>
        </div>
    );
}

function TableFilterFields({
    filters, setF, setFilters, allowPlayoffs, allowBracket,
}: {
    filters: TableFilters;
    setF: <K extends keyof TableFilters>(k: K, v: TableFilters[K]) => void;
    setFilters: React.Dispatch<React.SetStateAction<TableFilters>>;
    allowPlayoffs: boolean;
    allowBracket: boolean;
}) {
    const views: { value: TableView; label: string }[] = [
        { value: 'all', label: 'All teams' },
        { value: 'today', label: 'Playing today' },
        { value: 'tomorrow', label: 'Tomorrow' },
        ...(allowBracket ? [{ value: 'bracket' as const, label: 'Playoff matchups' }] : []),
    ];
    const pairedView = filters.view === 'today' || filters.view === 'tomorrow';
    return (
        <div>
            {allowPlayoffs ? (
                <Field label="Games">
                    <Segmented
                        label="Games"
                        value={filters.scope}
                        onChange={v => setF('scope', v)}
                        options={[
                            { value: 'regular', label: 'Regular season' },
                            { value: 'playoffs', label: 'Playoffs' },
                        ]}
                    />
                </Field>
            ) : null}
            <Field label="View">
                <Segmented label="View" size="sm" value={filters.view} onChange={v => setF('view', v)} options={views} />
                {pairedView ? (
                    <ChipRow
                        label="Split each matchup by"
                        options={[
                            { value: 'withLocation', label: 'Home/away split' },
                            { value: 'withStarter', label: "Tonight's starter" },
                            { value: 'withDow', label: 'Same weekday' },
                        ]}
                        selected={(['withLocation', 'withStarter', 'withDow'] as const).filter(k => filters[k])}
                        onToggle={k => setFilters(f => ({ ...f, [k]: !f[k] }))}
                    />
                ) : null}
            </Field>
            <Field label="Location">
                <Segmented
                    label="Location"
                    size="sm"
                    value={filters.location}
                    onChange={v => setF('location', v)}
                    options={[
                        { value: 'All', label: 'All' },
                        { value: 'Home', label: 'Home' },
                        { value: 'Away', label: 'Away' },
                    ]}
                />
            </Field>
            <Field label="Recent form" hint="Most recent games of the selected type.">
                <Segmented
                    label="Recent form"
                    size="sm"
                    value={String(filters.recent)}
                    onChange={v => setF('recent', (v === 'All' ? 'All' : Number(v)) as Recent)}
                    options={[
                        { value: 'All', label: 'Season' },
                        { value: '5', label: 'Last 5' },
                        { value: '10', label: 'Last 10' },
                        { value: '20', label: 'Last 20' },
                    ]}
                />
            </Field>
            <Field label="Period" hint="Power play, penalty kill and empty-net columns are full-game only.">
                <Segmented
                    label="Period"
                    size="sm"
                    value={filters.period}
                    onChange={v => setF('period', v)}
                    options={(['All', '1st', '2nd', '3rd', 'OT'] as PeriodFilter[]).map(p => ({ value: p, label: p === 'All' ? 'Full game' : p }))}
                />
            </Field>
            <Field label="Division">
                <ChipRow
                    label="Division"
                    options={DIVISIONS.map(d => ({ value: d, label: DIVISION_LABEL[d] }))}
                    selected={filters.divisions}
                    onToggle={d => setF('divisions', filters.divisions.includes(d) ? filters.divisions.filter(x => x !== d) : [...filters.divisions, d])}
                />
            </Field>
            <Field label="Playoff position">
                <Segmented
                    label="Playoff position"
                    size="sm"
                    value={filters.position}
                    onChange={v => setF('position', v)}
                    options={[
                        { value: 'All', label: 'All' },
                        { value: 'In', label: 'In a spot' },
                        { value: 'Out', label: 'Outside' },
                    ]}
                />
            </Field>
            <details className="group border-b border-line py-2 last:border-b-0">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-body-sm font-semibold text-fg-1">
                    Per-game filters
                    <span aria-hidden="true" className="text-fg-3 transition-transform group-open:rotate-180">
                        ▾
                    </span>
                </summary>
                <p className="mb-2 text-caption text-fg-3">Keep only games that meet these conditions, then total them.</p>
                <TriField label="Scored a power-play goal" value={filters.ppg} onChange={v => setF('ppg', v)} />
                <TriField label="Allowed a power-play goal" value={filters.ppga} onChange={v => setF('ppga', v)} />
                <TriField label="Scored first" value={filters.scoredFirst} onChange={v => setF('scoredFirst', v)} labels={['Any', 'Scored first', 'Trailed first']} />
                <div className="py-4">
                    <RangeFields ranges={filters.ranges} onChange={(k, v) => setFilters(f => ({ ...f, ranges: { ...f.ranges, [k]: v } }))} />
                </div>
            </details>
        </div>
    );
}

function activeChips(f: TableFilters, set: React.Dispatch<React.SetStateAction<TableFilters>>) {
    const out: { key: string; label: string; clear: () => void }[] = [];
    const reset = <K extends keyof TableFilters>(k: K) => () => set(prev => ({ ...prev, [k]: DEFAULT_FILTERS[k] }));
    if (f.scope !== 'regular') out.push({ key: 'scope', label: 'Playoffs', clear: reset('scope') });
    if (f.view !== 'all') out.push({ key: 'view', label: f.view === 'today' ? 'Playing today' : f.view === 'tomorrow' ? 'Playing tomorrow' : 'Playoff matchups', clear: reset('view') });
    if (f.location !== 'All') out.push({ key: 'location', label: f.location, clear: reset('location') });
    if (f.recent !== 'All') out.push({ key: 'recent', label: `Last ${f.recent}`, clear: reset('recent') });
    if (f.period !== 'All') out.push({ key: 'period', label: `${f.period} period`, clear: reset('period') });
    if (f.divisions.length) out.push({ key: 'divisions', label: f.divisions.map(d => DIVISION_LABEL[d]).join(' + '), clear: () => set(prev => ({ ...prev, divisions: [] })) });
    if (f.position !== 'All') out.push({ key: 'position', label: f.position === 'In' ? 'In a playoff spot' : 'Outside the playoffs', clear: reset('position') });
    if (f.ppg !== 'All') out.push({ key: 'ppg', label: f.ppg === 'Yes' ? 'Scored a PPG' : 'No PPG', clear: reset('ppg') });
    if (f.ppga !== 'All') out.push({ key: 'ppga', label: f.ppga === 'Yes' ? 'Allowed a PPG' : 'No PPG allowed', clear: reset('ppga') });
    if (f.scoredFirst !== 'All') out.push({ key: 'sfirst', label: f.scoredFirst === 'Yes' ? 'Scored first' : 'Trailed first', clear: reset('scoredFirst') });
    for (const [k, v] of Object.entries(f.ranges)) {
        if (!v || (v[0] === '' && v[1] === '')) continue;
        const label = `${k.toUpperCase()} ${v[0] !== '' ? `≥ ${v[0]}` : ''}${v[0] !== '' && v[1] !== '' ? ', ' : ''}${v[1] !== '' ? `≤ ${v[1]}` : ''}`;
        out.push({
            key: `r-${k}`,
            label,
            clear: () =>
                set(prev => {
                    const ranges = { ...prev.ranges };
                    delete ranges[k as keyof typeof ranges];
                    return { ...prev, ranges };
                }),
        });
    }
    return out;
}

