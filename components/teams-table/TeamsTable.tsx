'use client';

import * as React from 'react';
import Link from 'next/link';
import { Segmented } from '@/components/ui/segmented';
import { FilterChip } from '@/components/ui/filter-chip';
import { FilterSheet } from '@/components/ui/filter-sheet';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { PageHeading } from '@/components/ui/page-heading';
import { Crest } from '@/components/ui/crest';
import { shortSeasonTag } from '@/components/ui/stat-chip';
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
import { compareOfficial, computeStandings, officialKeysOf } from '@/utils/team-stats/standings';
import { DIVISION_OF, DIVISIONS, DIVISION_LABEL, TEAM_TRICODES } from '@/utils/team-stats/teams';
import type { Division, GameRow, LeaguePayload, Matchup, PackedGames, PeriodFilter, TeamStat } from '@/utils/team-stats/types';
import { COLUMN_BY_KEY, SECTIONS, SECTION_KEYS, columnValue, heatColor, type StatColumn } from './columns';
import { ChipRow, Field, RangeFields, TriField } from './FilterFields';
import { HeaderCell, type SortDir } from './HeaderCell';
import { CELL_BG, HEAD_CELL, STICKY_EDGE } from './table-style';
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
            .catch(() => live && setLoadError('Season unavailable'));
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
            .catch(() => live && setLoadError('Game data unavailable'));
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
        const played = model.league.filter(r => r.gp >= HEAT_MIN_GP);
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
            .sort((a, b) => compareOfficial(officialKeysOf(a), officialKeysOf(b)) || a.tri.localeCompare(b.tri))
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

    if (!payload) {
        return (
            <div className="panel p-card text-micro uppercase tracking-label text-fg-3" role="status">
                {loadError ? <span className="text-neg">{loadError}</span> : 'Loading'}
            </div>
        );
    }

    const scopeLabel = filters.scope === 'playoffs' ? 'playoffs' : 'regular season';
    const viewNote = filters.view === 'today' ? 'today' : filters.view === 'tomorrow' ? 'tomorrow' : filters.view === 'bracket' ? 'bracket' : null;
    const isPrior = season !== SEASON_ID;

    return (
        <section aria-label="League table" className="flex flex-col gap-2.5">
            <PageHeading
                title="Teams"
                tag={isPrior ? shortSeasonTag(season) : undefined}
                actions={<Segmented label="Season" size="sm" value={season} onChange={changeSeason} options={TEAM_SEASONS.map(s => ({ value: s, label: seasonLabel(s) }))} />}
            />

            {/* Column sets · quick filters */}
            <div className="flex flex-wrap items-center gap-2">
                <ScrollRegion label="Stat sections" className="-mx-4 w-[calc(100%+2rem)] px-4 md:mx-0 md:w-auto md:px-0">
                    <Segmented label="Stat section" size="sm" value={section} onChange={setSection} options={SECTIONS.map(s => ({ value: s.key, label: s.label }))} />
                </ScrollRegion>
                <FilterChip selected={filters.recent === 10} onSelectedChange={on => setF('recent', on ? 10 : 'All')}>
                    L10
                </FilterChip>
                <FilterChip selected={filters.location === 'Home'} onSelectedChange={on => setF('location', on ? 'Home' : 'All')}>
                    Home
                </FilterChip>
                <FilterChip selected={filters.location === 'Away'} onSelectedChange={on => setF('location', on ? 'Away' : 'All')}>
                    Away
                </FilterChip>
                <FilterSheet activeCount={active} triggerLabel="Filters" title="Filters" onReset={() => setFilters({ ...DEFAULT_FILTERS, ranges: {} })} applyLabel="Done">
                    <TableFilterFields filters={filters} setF={setF} setFilters={setFilters} allowPlayoffs={allowPlayoffs} allowBracket={allowBracket} />
                </FilterSheet>
                {chips.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
                        {chips.map(c => (
                            <FilterChip key={c.key} selected removable onClick={c.clear} aria-label={`Remove filter: ${c.label}`}>
                                {c.label}
                            </FilterChip>
                        ))}
                        <button
                            type="button"
                            onClick={() => setFilters({ ...DEFAULT_FILTERS, ranges: {} })}
                            className="min-h-[34px] px-2 text-micro font-medium uppercase tracking-chip text-fg-3 hover:text-fg-1 coarse:min-h-11"
                        >
                            Clear
                        </button>
                    </div>
                ) : null}
            </div>

            {loadError ? (
                <p role="alert" className="text-micro uppercase tracking-label text-neg">
                    {loadError}
                </p>
            ) : null}

            <ScrollRegion label={`${payload.seasonLabel} team table`} className="-mx-4 border-y border-line bg-surface-1 md:mx-0 md:rounded-card md:border-x">
                <table
                    ref={tableRef}
                    className="table-fixed border-separate border-spacing-0 font-mono text-caption tabular-nums [--team-col:84px] md:[--team-col:208px]"
                    style={{ width: `calc(var(--team-col) + ${columns.reduce((w, c) => w + colWidth(c.col), 0)}px)`, minWidth: '100%' }}
                    aria-busy={pending || undefined}
                >
                    <caption className="h-8 px-3 text-left align-middle">
                        <span className="flex h-8 items-center gap-2 whitespace-nowrap text-micro font-medium uppercase tracking-label text-fg-3">
                            <span className="text-fg-1">
                                {payload.seasonLabel} {scopeLabel}
                            </span>
                            <span aria-hidden="true" className="text-fg-disabled">
                                ·
                            </span>
                            <span>
                                <span className="text-fg-1">{payload.maxGp}</span> GP
                            </span>
                            {viewNote ? (
                                <>
                                    <span aria-hidden="true" className="text-fg-disabled">
                                        ·
                                    </span>
                                    <span className="text-brand">{viewNote}</span>
                                </>
                            ) : null}
                            {section === 'ratings' ? (
                                <>
                                    <span aria-hidden="true" className="text-fg-disabled">
                                        ·
                                    </span>
                                    {ratingsMissing ? <span>No ratings</span> : payload.ratingsSeasonLabel ? <span>Rtg {shortSeasonTag(payload.ratingsSeasonLabel)}</span> : null}
                                </>
                            ) : null}
                            {pending ? <span className="live-dot ml-1" role="status" aria-label="Updating" /> : null}
                        </span>
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
                                <td className={cn(HEAD_CELL, STICKY_EDGE, 'z-[4] border-b-0')} />
                                {sectionDef.groups.map(g => (
                                    <th key={g.name} scope="colgroup" colSpan={g.cols.length} className={cn(HEAD_CELL, 'relative z-[3] h-7 border-b-0 border-r px-2 text-left')}>
                                        <span className="text-micro font-medium uppercase tracking-label text-fg-2">{g.name}</span>
                                    </th>
                                ))}
                            </tr>
                        ) : null}
                        <tr>
                            <th scope="col" className={cn(HEAD_CELL, STICKY_EDGE, 'z-[4] h-8 px-2 text-left md:px-3')}>
                                <span className="text-micro font-medium uppercase tracking-[0.1em] text-fg-3">Team</span>
                            </th>
                            {columns.map(({ col, groupEnd }) => (
                                <HeaderCell
                                    key={col.key}
                                    label={col.label}
                                    title={col.title}
                                    direction={model?.paired ? undefined : sort.key === col.key ? sort.dir : null}
                                    onSort={model?.paired ? undefined : () => onSort(col.key)}
                                    className={cn(HEAD_CELL, 'relative z-[3]', groupEnd && 'border-r')}
                                />
                            ))}
                        </tr>
                    </thead>
                    <tbody className={cn(pending && 'opacity-60 transition-opacity')}>
                        {sorted.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length + 1} className="h-16 px-4 text-center text-micro uppercase tracking-label text-fg-3">
                                    {filters.view === 'today' || filters.view === 'tomorrow' ? 'No games' : 'No teams'}
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

            <Legend clinch={!!payload.clinch} />
        </section>
    );
}

const colWidth = (c: StatColumn) => (c.label.length > 5 ? 72 : c.label.length > 3 ? 62 : 52);

/** Record counts read 0 (not —) before a team's first game. */
const COUNTING = new Set(['gp', 'wins', 'losses', 'otl', 'points', 'rw', 'ranking']);
/** Heat colouring starts once a team has this many games. */
const HEAT_MIN_GP = 5;

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
    const odds = paired && row.matchup && row.side ? { ml: row.side === 'home' ? row.matchup.homeVegasOdds : row.matchup.awayVegasOdds } : null;
    return (
        <tr className={cn('group', pairEnd && '[&>*]:border-b-8 [&>*]:border-b-bg')}>
            <th scope="row" className={cn(STICKY_EDGE, CELL_BG, 'z-[2] h-8 border-b border-line px-2 text-left font-normal md:px-3')}>
                <div className="flex h-8 items-center gap-2">
                    {!paired ? <span className="hidden w-5 shrink-0 text-right text-micro text-fg-3 md:inline">{idx + 1}</span> : null}
                    <Link href={`/teams/${row.tri}`} prefetch={false} className="flex h-8 min-w-0 items-center gap-2 hover:text-brand">
                        <Crest tri={row.tri} size={20} className="drop-shadow-none" />
                        <span className="font-bold text-fg-1 group-hover:text-inherit">{row.tri}</span>
                        <span className="hidden truncate text-fg-3 md:inline">{meta?.common}</span>
                        {paired && showStarter && row.starterName ? (
                            <span className="truncate text-micro text-fg-2">
                                {row.starterName.split(' ').slice(-1)[0]}
                                <span className="sr-only"> ({row.starterStatus})</span>
                            </span>
                        ) : null}
                    </Link>
                    {clinch ? (
                        <span
                            title={CLINCH_LABEL[clinch]}
                            className={cn('ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[3px] px-0.5 text-micro font-bold uppercase leading-none', clinch === 'e' ? 'text-neg' : 'text-pos')}
                        >
                            {clinch}
                            <span className="sr-only"> ({CLINCH_LABEL[clinch]})</span>
                        </span>
                    ) : null}
                    {odds?.ml != null ? (
                        <span className="ml-auto hidden shrink-0 text-micro text-fg-2 md:inline">
                            <span className="sr-only">{row.side === 'home' ? 'Home' : 'Away'} moneyline </span>
                            {odds.ml > 0 ? `+${odds.ml}` : signed(odds.ml)}
                        </span>
                    ) : null}
                </div>
            </th>
            {columns.map(({ col, groupEnd }) => {
                const base = cn(CELL_BG, 'h-8 border-b border-line px-1.5 text-center', groupEnd && 'border-r');
                if (col.key === 'ranking') {
                    return (
                        <td key={col.key} className={cn(base, row.isPlayoff ? 'font-bold text-fg-1' : 'text-fg-3')}>
                            {row.ranking && row.ranking !== '—' ? row.ranking : '—'}
                            {row.isPlayoff ? <span className="sr-only"> (playoff position)</span> : null}
                        </td>
                    );
                }
                const counting = COUNTING.has(col.key);
                const blank = row.gp === 0 && !col.rating && !counting ? true : period !== 'All' && col.fullGameOnly;
                const v = blank ? NaN : columnValue(col, row, payload.ratings);
                const r = ranges.get(col.key);
                // No heat on counting stats, and none until a team has 5+ games (1-GP percentages are noise).
                const color = r && !counting && row.gp >= HEAT_MIN_GP ? heatColor(v, r[0], r[1], col.better) : undefined;
                return (
                    <td key={col.key} className={cn(base, col.key === 'points' ? 'font-bold text-fg-1' : 'text-fg-1')} style={color ? { color } : undefined}>
                        {Number.isFinite(v) ? col.format(v) : <span className="text-fg-disabled">—</span>}
                    </td>
                );
            })}
        </tr>
    );
}

/** One label row: the heat ramp and (when they exist) the clinch codes. */
function Legend({ clinch }: { clinch: boolean }) {
    return (
        <div aria-hidden="true" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-micro uppercase tracking-label text-fg-3">
            <span className="inline-flex items-center gap-2">
                <span className="text-neg">−</span>
                <span className="h-1.5 w-12 rounded-full bg-[linear-gradient(90deg,rgb(var(--neg-rgb)),rgb(201_209_219),rgb(var(--pos-rgb)))]" />
                <span className="text-pos">+</span>
                <span>5+ GP</span>
            </span>
            {clinch
                ? (['x', 'y', 'z', 'p', 'e'] as const).map(c => (
                      <span key={c} className="inline-flex items-center gap-1">
                          <b className={c === 'e' ? 'text-neg' : 'text-pos'}>{c}</b>
                          {CLINCH_SHORT[c]}
                      </span>
                  ))
                : null}
        </div>
    );
}

const CLINCH_SHORT: Record<string, string> = { x: 'Playoffs', y: 'Conf', z: 'Div', p: 'Pres', e: 'Out' };

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
        { value: 'all', label: 'All' },
        { value: 'today', label: 'Today' },
        { value: 'tomorrow', label: 'Tomorrow' },
        ...(allowBracket ? [{ value: 'bracket' as const, label: 'Bracket' }] : []),
    ];
    const pairedView = filters.view === 'today' || filters.view === 'tomorrow';
    return (
        <div>
            {allowPlayoffs ? (
                <Field label="Games">
                    <Segmented
                        label="Games"
                        size="sm"
                        value={filters.scope}
                        onChange={v => setF('scope', v)}
                        options={[
                            { value: 'regular', label: 'Regular' },
                            { value: 'playoffs', label: 'Playoffs' },
                        ]}
                    />
                </Field>
            ) : null}
            <Field label="Teams">
                <Segmented label="Teams" size="sm" value={filters.view} onChange={v => setF('view', v)} options={views} />
                {pairedView ? (
                    <ChipRow
                        label="Split by"
                        options={[
                            { value: 'withLocation', label: 'Home/Away' },
                            { value: 'withStarter', label: 'Starter' },
                            { value: 'withDow', label: 'Weekday' },
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
            <Field label="Recent">
                <Segmented
                    label="Recent"
                    size="sm"
                    value={String(filters.recent)}
                    onChange={v => setF('recent', (v === 'All' ? 'All' : Number(v)) as Recent)}
                    options={[
                        { value: 'All', label: 'Season' },
                        { value: '5', label: 'L5' },
                        { value: '10', label: 'L10' },
                        { value: '20', label: 'L20' },
                    ]}
                />
            </Field>
            <Field label="Period">
                <Segmented
                    label="Period"
                    size="sm"
                    value={filters.period}
                    onChange={v => setF('period', v)}
                    options={(['All', '1st', '2nd', '3rd', 'OT'] as PeriodFilter[]).map(p => ({ value: p, label: p === 'All' ? 'Game' : p }))}
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
            <Field label="Playoff spot">
                <Segmented
                    label="Playoff spot"
                    size="sm"
                    value={filters.position}
                    onChange={v => setF('position', v)}
                    options={[
                        { value: 'All', label: 'All' },
                        { value: 'In', label: 'In' },
                        { value: 'Out', label: 'Out' },
                    ]}
                />
            </Field>
            <details className="group border-b border-line py-1 last:border-b-0">
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-micro font-medium uppercase tracking-label text-fg-2 coarse:min-h-11">
                    Per game
                    <span aria-hidden="true" className="text-fg-3 transition-transform group-open:rotate-180">
                        ▾
                    </span>
                </summary>
                <TriField label="PP goal" value={filters.ppg} onChange={v => setF('ppg', v)} />
                <TriField label="PP goal against" value={filters.ppga} onChange={v => setF('ppga', v)} />
                <TriField label="First goal" value={filters.scoredFirst} onChange={v => setF('scoredFirst', v)} labels={['Any', 'For', 'Against']} />
                <div className="py-3">
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
    if (f.view !== 'all') out.push({ key: 'view', label: f.view === 'today' ? 'Today' : f.view === 'tomorrow' ? 'Tomorrow' : 'Bracket', clear: reset('view') });
    if (f.recent !== 'All' && f.recent !== 10) out.push({ key: 'recent', label: `L${f.recent}`, clear: reset('recent') });
    if (f.period !== 'All') out.push({ key: 'period', label: f.period, clear: reset('period') });
    if (f.divisions.length) out.push({ key: 'divisions', label: f.divisions.map(d => DIVISION_LABEL[d]).join('+'), clear: () => set(prev => ({ ...prev, divisions: [] })) });
    if (f.position !== 'All') out.push({ key: 'position', label: f.position === 'In' ? 'In spot' : 'Out of spot', clear: reset('position') });
    if (f.ppg !== 'All') out.push({ key: 'ppg', label: f.ppg === 'Yes' ? 'PPG' : 'No PPG', clear: reset('ppg') });
    if (f.ppga !== 'All') out.push({ key: 'ppga', label: f.ppga === 'Yes' ? 'PPGA' : 'No PPGA', clear: reset('ppga') });
    if (f.scoredFirst !== 'All') out.push({ key: 'sfirst', label: f.scoredFirst === 'Yes' ? 'Scored 1st' : 'Trailed 1st', clear: reset('scoredFirst') });
    for (const [k, v] of Object.entries(f.ranges)) {
        if (!v || (v[0] === '' && v[1] === '')) continue;
        const label = `${k.toUpperCase()} ${v[0] !== '' ? `≥${v[0]}` : ''}${v[0] !== '' && v[1] !== '' ? ' ' : ''}${v[1] !== '' ? `≤${v[1]}` : ''}`;
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
