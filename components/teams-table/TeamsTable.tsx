'use client';

import * as React from 'react';
import Link from 'next/link';
import { Segmented } from '@/components/ui/segmented';
import { FilterChip } from '@/components/ui/filter-chip';
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
import {
    COLUMN_BY_KEY, COLUMN_GROUPS, DEFAULT_HIDDEN, SSR_GROUPS, HEAT_BAD, HEAT_FULL_GP, HEAT_GOOD, HEAT_MAX_ALPHA, PRESETS, columnValue, heatTint, leaguePercentile, sampleWeight,
    type StatColumn,
} from './columns';
import { RangeFields } from './FilterFields';
import { HeaderCell, type SortDir } from './HeaderCell';
import { CELL_BG, HEAD_CELL, STICKY_EDGE } from './table-style';
import { TableScroller } from './TableScroller';

/** Column groups left out of the server HTML; revealed one per idle task after hydration. */
const DEFERRED_GROUPS = COLUMN_GROUPS.filter(g => !SSR_GROUPS.includes(g.name));

const STORAGE_KEY = 'ponyxg:teams-table:v3';

interface Persisted {
    filters?: unknown;
    /** Column keys the user turned off (everything else shows). */
    hidden?: string[];
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
    const [hidden, setHidden] = React.useState<string[]>(DEFAULT_HIDDEN);
    // The server HTML carries only SSR_GROUPS; the other default columns are added once the page is idle.
    const [revealed, setRevealed] = React.useState(0);
    const hiddenRef = React.useRef(hidden);
    hiddenRef.current = hidden;
    const [perGameOpen, setPerGameOpen] = React.useState(false);
    const [sort, setSort] = React.useState<{ key: string; dir: SortDir }>({ key: 'points', dir: 'desc' });
    const [games, setGames] = React.useState<Record<string, GameRow[]>>({});
    const [loadError, setLoadError] = React.useState<string | null>(null);
    const [hydrated, setHydrated] = React.useState(false);
    const captionId = React.useId();

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
        if (Array.isArray(saved.hidden)) setHidden(saved.hidden.filter(k => COLUMN_BY_KEY.has(k)));
        if (saved.sort?.key && COLUMN_BY_KEY.has(saved.sort.key)) setSort({ key: saved.sort.key, dir: saved.sort.dir === 'asc' ? 'asc' : 'desc' });
        if (saved.filters) setFilters(sanitizeFilters(saved.filters, { playoffs: true, bracket: true }));
        setHydrated(true);
        // One column group per idle task, so no single render is a long task on a slow phone.
        let n = 0;
        let cancelled = false;
        const later = (cb: () => void) => {
            if ('requestIdleCallback' in window) {
                const id = window.requestIdleCallback(cb, { timeout: 300 });
                return () => window.cancelIdleCallback(id);
            }
            const id = globalThis.setTimeout(cb, 16);
            return () => globalThis.clearTimeout(id);
        };
        let cancel = () => {};
        const step = () => {
            if (cancelled) return;
            // Groups with every column off cost nothing to show, so skip them.
            while (n < DEFERRED_GROUPS.length && DEFERRED_GROUPS[n].cols.every(k => hiddenRef.current.includes(k))) n++;
            if (n >= DEFERRED_GROUPS.length) return setRevealed(DEFERRED_GROUPS.length);
            n++;
            setRevealed(n);
            cancel = later(step);
        };
        cancel = later(step);
        return () => {
            cancelled = true;
            cancel();
        };
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
            window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ filters, hidden, sort }));
        } catch {
            /* private mode */
        }
    }, [filters, hidden, sort, hydrated]);

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

    const hiddenSet = React.useMemo(() => new Set(hidden), [hidden]);
    const ratingsMissing = !payload?.ratings;
    // Every group in order; a column shows unless the user hid it (rating columns need the ratings file).
    const columns: { col: StatColumn; groupEnd: boolean; group: string }[] = React.useMemo(
        () =>
            COLUMN_GROUPS.filter(g => SSR_GROUPS.includes(g.name) || DEFERRED_GROUPS.indexOf(g) < revealed).flatMap(g => {
                const cols = g.cols
                    .map(k => COLUMN_BY_KEY.get(k))
                    .filter((c): c is StatColumn => !!c && !hiddenSet.has(c.key) && !(c.rating && ratingsMissing));
                return cols.map((col, i) => ({ col, groupEnd: i === cols.length - 1, group: g.name }));
            }),
        [hiddenSet, ratingsMissing, revealed],
    );
    const groupSpans = React.useMemo(() => {
        const out: { name: string; n: number }[] = [];
        for (const c of columns) {
            const last = out[out.length - 1];
            if (last && last.name === c.group) last.n++;
            else out.push({ name: c.group, n: 1 });
        }
        return out;
    }, [columns]);

    // Every team's value per column (ascending), for the rank-based cell tint.
    // Ratings are season-independent; everything else counts teams with a game.
    const dists = React.useMemo(() => {
        const out = new Map<string, number[]>();
        if (!model) return out;
        for (const { col } of columns) {
            if (col.better === 'none') continue;
            const vals = model.league
                .filter(r => col.rating || r.gp > 0)
                .map(r => columnValue(col, r, payload?.ratings ?? null))
                .filter(Number.isFinite)
                .sort((a, b) => a - b);
            if (vals.length > 1 && vals[0] !== vals[vals.length - 1]) out.set(col.key, vals);
        }
        return out;
    }, [model, columns, payload]);

    // A sort key from another section (sessions persist it) falls back to points.
    // Until the idle expansion the column set is partial, so a sort on a column that is only not rendered yet still holds.
    const sortable = columns.some(c => c.col.key === sort.key) || (revealed < DEFERRED_GROUPS.length && COLUMN_BY_KEY.has(sort.key) && !hiddenSet.has(sort.key));
    const activeSort = sortable ? sort : { key: 'points', dir: 'desc' as SortDir };

    const sorted = React.useMemo(() => {
        if (!model) return [];
        if (model.paired) return model.rows;
        const col = COLUMN_BY_KEY.get(activeSort.key);
        const order = [...payload!.standings]
            .sort((a, b) => compareOfficial(officialKeysOf(a), officialKeysOf(b)) || a.tri.localeCompare(b.tri))
            .map(r => r.tri);
        const pos = new Map(order.map((t, i) => [t, i]));
        // Rank sorts by official order: ascending is first place first.
        const val = (r: TeamRow) => {
            if (!col || col.key === 'ranking') return pos.get(r.tri) ?? 99;
            const v = columnValue(col, r, payload?.ratings ?? null);
            return Number.isFinite(v) ? v : null;
        };
        return [...model.rows].sort((a, b) => {
            const va = val(a);
            const vb = val(b);
            if (va === null && vb === null) return (pos.get(a.tri) ?? 0) - (pos.get(b.tri) ?? 0);
            if (va === null) return 1;
            if (vb === null) return -1;
            if (va !== vb) return activeSort.dir === 'desc' ? vb - va : va - vb;
            return (pos.get(a.tri) ?? 0) - (pos.get(b.tri) ?? 0);
        });
    }, [model, activeSort.key, activeSort.dir, payload]);

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
    const dot = (
        <span aria-hidden="true" className="text-fg-disabled">
            ·
        </span>
    );
    const captionParts = (
        <>
            <span className="text-fg-1">
                {payload.seasonLabel} {scopeLabel}
            </span>
            {dot}
            <span>
                <span className="text-fg-1">{payload.maxGp}</span> GP
            </span>
            {viewNote ? (
                <>
                    {dot}
                    <span className="text-brand">{viewNote}</span>
                </>
            ) : null}
            {pending ? <span className="live-dot ml-1" role="status" aria-label="Updating" /> : null}
        </>
    );
    // Team column: crest + tricode only; paired views add the starter and the moneyline.
    const paired = !!model?.paired;
    const teamColClass = !paired ? '[--team-col:76px] md:[--team-col:96px]' : filters.withStarter ? '[--team-col:132px] md:[--team-col:184px]' : '[--team-col:80px] md:[--team-col:128px]';

    return (
        <section aria-label="League table" className="flex flex-col gap-1.5">
            <PageHeading
                title="Teams"
                tag={isPrior ? shortSeasonTag(season) : undefined}
                actions={
                    <div className="flex items-center gap-3">
                        <span aria-hidden="true" className="hidden items-center gap-2 whitespace-nowrap text-micro font-medium uppercase tracking-label text-fg-3 md:flex">
                            {captionParts}
                        </span>
                        <Segmented label="Season" size="sm" value={season} onChange={changeSeason} options={TEAM_SEASONS.map(s => ({ value: s, label: seasonLabel(s) }))} />
                    </div>
                }
            />

            <FilterBar filters={filters} setF={setF} setFilters={setFilters} allowPlayoffs={allowPlayoffs} allowBracket={allowBracket} chips={chips} perGameOpen={perGameOpen} />
            <ColumnPicker
                hidden={hidden}
                setHidden={setHidden}
                ratingsMissing={ratingsMissing}
                extra={
                    <>
                        <FilterChip className={CHIP} selected={perGameOpen || hasPerGame(filters)} onSelectedChange={setPerGameOpen} aria-expanded={perGameOpen}>
                            Per game
                        </FilterChip>
                        {active > 0 ? (
                            <button type="button" onClick={() => setFilters({ ...DEFAULT_FILTERS, ranges: {} })} className="min-h-7 px-2 text-micro font-medium uppercase tracking-chip text-fg-3 hover:text-fg-1 coarse:min-h-9">
                                Clear {active}
                            </button>
                        ) : null}
                    </>
                }
            />

            {loadError ? (
                <p role="alert" className="text-micro uppercase tracking-label text-neg">
                    {loadError}
                </p>
            ) : null}

            {/* Bordered panel: the caption bar stays put, only the table scrolls (both axes). */}
            <div className="-mx-4 overflow-hidden border-y border-line bg-surface-1 md:mx-0 md:rounded-card md:border-x">
                <TableScroller label={`${payload.seasonLabel} team table`}>
                    <table
                        aria-labelledby={captionId}
                        className={cn('table-fixed border-separate border-spacing-0 text-caption tabular-nums', teamColClass)}
                        style={{ width: `calc(var(--team-col) + ${columns.reduce((w, c) => w + colWidth(c.col), 0)}px)`, minWidth: '100%' }}
                        aria-busy={pending || undefined}
                    >
                        <caption id={captionId} className="sr-only">
                            {captionParts}
                        </caption>
                        <colgroup>
                            <col style={{ width: 'var(--team-col)' }} />
                            {columns.map(({ col }) => (
                                <col key={col.key} style={{ width: colWidth(col) }} />
                            ))}
                        </colgroup>
                        <thead>
                            <tr>
                                <td className={cn(HEAD_CELL, STICKY_EDGE, 'z-[4] h-5 border-b-0')} />
                                {groupSpans.map(g => (
                                    <th key={g.name} scope="colgroup" colSpan={g.n} className={cn(HEAD_CELL, 'h-5 overflow-hidden border-b-0 border-r px-2 text-left')}>
                                        <span className="text-micro font-medium uppercase tracking-wide text-fg-2">{g.name}</span>
                                    </th>
                                ))}
                            </tr>
                            <tr>
                                <th scope="col" className={cn(HEAD_CELL, STICKY_EDGE, 'z-[4] h-6 px-2 text-left top-5')}>
                                    <span className="text-micro font-medium uppercase tracking-[0.1em] text-fg-3">Team</span>
                                </th>
                                {columns.map(({ col, groupEnd }) => (
                                    <HeaderCell
                                        key={col.key}
                                        label={col.label}
                                        title={col.title}
                                        direction={model?.paired ? undefined : activeSort.key === col.key ? activeSort.dir : null}
                                        onSort={model?.paired ? undefined : () => onSort(col.key)}
                                        className={cn(HEAD_CELL, 'top-5', groupEnd && 'border-r')}
                                    />
                                ))}
                            </tr>
                        </thead>
                        <tbody className={cn(pending && 'opacity-60 transition-opacity')}>
                            {sorted.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.length + 1} className="h-16 px-4 text-left text-micro uppercase tracking-label text-fg-3">
                                        <span className="sticky left-4">{filters.view === 'today' || filters.view === 'tomorrow' ? 'No games' : 'No teams'}</span>
                                    </td>
                                </tr>
                            ) : (
                                sorted.map((row, idx) => (
                                    <Row
                                        key={`${row.tri}-${idx}`}
                                        row={row}
                                        idx={idx}
                                        columns={columns}
                                        dists={dists}
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
                </TableScroller>
            </div>

            <Legend clinch={!!payload.clinch} />
        </section>
    );
}

/** Narrow columns: the label (or a 6-character value) plus 8px of padding, never under 44px. */
const colWidth = (c: StatColumn) => Math.max(44, Math.round(c.label.length * 7) + 14);

/** Record counts read 0 (not —) before a team's first game. */
const COUNTING = new Set(['gp', 'wins', 'losses', 'otl', 'points', 'rw', 'ranking']);

function Row({
    row, idx, columns, dists, payload, paired, period, showStarter, pairEnd,
}: {
    row: TeamRow;
    idx: number;
    columns: { col: StatColumn; groupEnd: boolean }[];
    dists: Map<string, number[]>;
    payload: LeaguePayload;
    paired: boolean;
    period: PeriodFilter;
    showStarter: boolean;
    pairEnd: boolean;
}) {
    const meta = payload.teams.find(t => t.tri === row.tri);
    const clinch = row.clinch ?? null;
    const odds = paired && row.matchup && row.side ? { ml: row.side === 'home' ? row.matchup.homeVegasOdds : row.matchup.awayVegasOdds } : null;
    const weight = sampleWeight(row.gp);
    return (
        <tr className={cn('group', pairEnd && '[&>*]:border-b-8 [&>*]:border-b-bg')}>
            <th scope="row" className={cn(STICKY_EDGE, CELL_BG, 'z-[2] h-6 shadow-[inset_0_-1px_0_var(--line)] pl-1 pr-1.5 text-left font-normal md:pl-2')}>
                <div className="flex h-6 items-center gap-1.5">
                    {!paired ? <span className="hidden w-4 shrink-0 text-right text-micro text-fg-3 md:inline">{idx + 1}</span> : null}
                    <Link href={`/teams/${row.tri}`} prefetch={false} title={meta?.name} className="flex h-6 min-w-0 items-center gap-1.5 hover:text-brand">
                        <Crest tri={row.tri} size={20} className="h-5 w-5 drop-shadow-none" />
                        <span className="font-bold text-fg-1 group-hover:text-inherit">{row.tri}</span>
                        {meta ? <span className="sr-only">, {meta.name}</span> : null}
                        {paired && showStarter && row.starterName ? (
                            <span className="truncate text-micro text-fg-2">
                                {row.starterName.split(' ').slice(-1)[0]}
                                <span className="sr-only"> ({row.starterStatus})</span>
                            </span>
                        ) : null}
                    </Link>
                    {clinch ? (
                        <span title={CLINCH_LABEL[clinch]} className={cn('-ml-1 self-start pt-1.5 text-micro font-bold uppercase leading-none', clinch === 'e' ? 'text-neg' : 'text-pos')}>
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
                const base = cn(CELL_BG, 'h-6 shadow-[inset_0_-1px_0_var(--line)] px-1 text-center', groupEnd && 'border-r');
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
                const dist = dists.get(col.key);
                // League-rank tint, faded by sample size (ratings are season-independent: full strength).
                const tint = dist && (col.rating || row.gp > 0) ? heatTint(leaguePercentile(v, dist), col.better, col.rating ? 1 : weight) : undefined;
                return (
                    <td
                        key={col.key}
                        className={cn(base, 'text-fg-1', col.key === 'points' && 'font-bold')}
                        style={tint ? { backgroundImage: `linear-gradient(${tint}, ${tint})` } : undefined}
                    >
                        {Number.isFinite(v) ? col.format(v) : <span className="text-fg-disabled">—</span>}
                    </td>
                );
            })}
        </tr>
    );
}

const rgba = (c: readonly number[], a: number) => `rgb(${c.join(' ')} / ${a})`;

/** One label row: the rank tint scale and (when they exist) the clinch codes. */
function Legend({ clinch }: { clinch: boolean }) {
    return (
        <div aria-hidden="true" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-micro uppercase tracking-label text-fg-3">
            <span className="inline-flex items-center gap-1.5">
                <span>Worse</span>
                <span className="flex overflow-hidden rounded-[3px] border border-line bg-surface-1">
                    {[-1, -0.5, 0, 0.5, 1].map(d => (
                        <span
                            key={d}
                            className="h-3 w-4"
                            style={d === 0 ? undefined : { background: rgba(d > 0 ? HEAT_GOOD : HEAT_BAD, Math.abs(d) * (d > 0 ? HEAT_MAX_ALPHA.good : HEAT_MAX_ALPHA.bad)) }}
                        />
                    ))}
                </span>
                <span>Better</span>
            </span>
            <span>Faint &lt;{HEAT_FULL_GP} GP</span>
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

/** One filter control; its label is the accessible name (the options read for themselves). */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div role="group" aria-label={label} title={label} className="flex min-w-0 items-center">
            {children}
        </div>
    );
}

/** Any per-game filter set (the Per game chip lights up even while its panel is closed). */
const hasPerGame = (f: TableFilters) => f.ppg !== 'All' || f.ppga !== 'All' || f.scoredFirst !== 'All' || Object.values(f.ranges).some(v => v && (v[0] !== '' || v[1] !== ''));

const CHIP = 'min-h-7 px-2.5 tracking-wide coarse:min-h-9';

/**
 * Every filter, always on screen: no drawer, no extra taps. Per-game filters
 * (PP goal, first goal, ranges) open inline under the bar.
 */
function FilterBar({
    filters, setF, setFilters, allowPlayoffs, allowBracket, chips, perGameOpen,
}: {
    filters: TableFilters;
    setF: <K extends keyof TableFilters>(k: K, v: TableFilters[K]) => void;
    setFilters: React.Dispatch<React.SetStateAction<TableFilters>>;
    allowPlayoffs: boolean;
    allowBracket: boolean;
    chips: { key: string; label: string; clear: () => void }[];
    perGameOpen: boolean;
}) {
    const more = perGameOpen;
    const views: { value: TableView; label: string }[] = [
        { value: 'all', label: 'All' },
        { value: 'today', label: 'Today' },
        { value: 'tomorrow', label: 'Tomorrow' },
        ...(allowBracket ? [{ value: 'bracket' as const, label: 'Bracket' }] : []),
    ];
    const pairedView = filters.view === 'today' || filters.view === 'tomorrow';
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {allowPlayoffs ? (
                    <Group label="Games">
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
                    </Group>
                ) : null}
                <Group label="Teams">
                    <Segmented label="Teams" size="sm" value={filters.view} onChange={v => setF('view', v)} options={views} />
                </Group>
                <Group label="Location">
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
                </Group>
                <Group label="Recent">
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
                </Group>
                <Group label="Period">
                    <Segmented
                        label="Period"
                        size="sm"
                        value={filters.period}
                        onChange={v => setF('period', v)}
                        options={(['All', '1st', '2nd', '3rd', 'OT'] as PeriodFilter[]).map(p => ({ value: p, label: p === 'All' ? 'Game' : p }))}
                    />
                </Group>
                <Group label="Playoff spot">
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
                </Group>
                <Group label="Division">
                    <div role="group" aria-label="Division" className="flex flex-wrap gap-1">
                        {DIVISIONS.map(d => (
                            <FilterChip
                                key={d}
                                className={CHIP}
                                selected={filters.divisions.includes(d)}
                                onSelectedChange={() => setF('divisions', filters.divisions.includes(d) ? filters.divisions.filter(x => x !== d) : [...filters.divisions, d])}
                            >
                                <span title={DIVISION_LABEL[d]}>{DIVISION_LABEL[d].slice(0, 3)}</span>
                            </FilterChip>
                        ))}
                    </div>
                </Group>
                {pairedView ? (
                    <Group label="Split by">
                        <div role="group" aria-label="Split by" className="flex flex-wrap gap-1.5">
                            {([['withLocation', 'Home/Away'], ['withStarter', 'Starter'], ['withDow', 'Weekday']] as const).map(([k, label]) => (
                                <FilterChip key={k} className={CHIP} selected={filters[k]} onSelectedChange={() => setFilters(f => ({ ...f, [k]: !f[k] }))}>
                                    {label}
                                </FilterChip>
                            ))}
                        </div>
                    </Group>
                ) : null}
            </div>
            {more ? (
                <div className="panel flex flex-col gap-3 px-3 py-3">
                    <div className="flex flex-wrap gap-x-5 gap-y-2.5">
                        {([['ppg', 'PP goal', ['Any', 'Yes', 'No']], ['ppga', 'PP goal against', ['Any', 'Yes', 'No']], ['scoredFirst', 'First goal', ['Any', 'For', 'Against']]] as const).map(([k, label, names]) => (
                            <Group key={k} label={label}>
                                <Segmented
                                    label={label}
                                    size="sm"
                                    value={filters[k]}
                                    onChange={v => setF(k, v)}
                                    options={(['All', 'Yes', 'No'] as const).map((value, i) => ({ value, label: names[i] }))}
                                />
                            </Group>
                        ))}
                    </div>
                    <RangeFields ranges={filters.ranges} onChange={(k, v) => setFilters(f => ({ ...f, ranges: { ...f.ranges, [k]: v } }))} />
                </div>
            ) : null}
            {chips.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
                    {chips.map(c => (
                        <FilterChip key={c.key} className={CHIP} selected removable onClick={c.clear} aria-label={`Remove filter: ${c.label}`}>
                            {c.label}
                        </FilterChip>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

/** Every column starts on. Presets narrow to one topic; chips below hide or show single columns. */
function ColumnPicker({ hidden, setHidden, ratingsMissing, extra }: { hidden: string[]; setHidden: React.Dispatch<React.SetStateAction<string[]>>; ratingsMissing: boolean; extra?: React.ReactNode }) {
    const [open, setOpen] = React.useState(false);
    const hiddenSet = new Set(hidden);
    const allKeys = COLUMN_GROUPS.flatMap(g => g.cols).filter(k => !(ratingsMissing && COLUMN_BY_KEY.get(k)?.rating));
    const shown = allKeys.filter(k => !hiddenSet.has(k)).length;
    const toggle = (k: string) => setHidden(h => (h.includes(k) ? h.filter(x => x !== k) : [...h, k]));
    const setGroup = (cols: string[], on: boolean) => setHidden(h => (on ? h.filter(k => !cols.includes(k)) : [...new Set([...h, ...cols])]));
    const preset = (cols: string[]) => setHidden(allKeys.filter(k => !cols.includes(k)));
    const isPreset = (cols: string[]) => allKeys.every(k => cols.includes(k) === !hiddenSet.has(k));
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-micro uppercase tracking-wide text-fg-3">Columns</span>
                <FilterChip className={CHIP} selected={isPreset(allKeys.filter(k => !DEFAULT_HIDDEN.includes(k)))} onSelectedChange={() => setHidden(DEFAULT_HIDDEN)}>
                    Default
                </FilterChip>
                <FilterChip className={CHIP} selected={hidden.length === 0} onSelectedChange={() => setHidden([])}>
                    All
                </FilterChip>
                {PRESETS.map(pr => (
                    <FilterChip key={pr.key} className={CHIP} selected={isPreset(pr.cols)} onSelectedChange={() => preset(pr.cols)}>
                        {pr.label}
                    </FilterChip>
                ))}
                <span className="ml-auto flex items-center gap-1">
                    {extra}
                    <FilterChip className={CHIP} selected={open} onSelectedChange={setOpen} aria-expanded={open} count={shown}>
                        Customize
                    </FilterChip>
                </span>
            </div>
            {open ? (
                <div className="panel grid gap-x-6 gap-y-3 px-3 py-3 md:grid-cols-2 xl:grid-cols-3">
                    {COLUMN_GROUPS.map(g => {
                        const cols = g.cols.filter(k => !(ratingsMissing && COLUMN_BY_KEY.get(k)?.rating));
                        if (!cols.length) return null;
                        const on = cols.every(k => !hiddenSet.has(k));
                        return (
                            <div key={g.name} role="group" aria-label={g.name} className="flex flex-col gap-1.5">
                                <button type="button" onClick={() => setGroup(cols, !on)} className="self-start text-micro font-medium uppercase tracking-wide text-fg-2 hover:text-fg-1">
                                    {g.name} <span className="text-fg-3">{on ? '· hide all' : '· show all'}</span>
                                </button>
                                <div className="flex flex-wrap gap-1">
                                    {cols.map(k => {
                                        const c = COLUMN_BY_KEY.get(k)!;
                                        return (
                                            <FilterChip key={k} className="min-h-6 px-2 !tracking-wide" selected={!hiddenSet.has(k)} onSelectedChange={() => toggle(k)} title={c.title}>
                                                {c.label}
                                            </FilterChip>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : null}
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
