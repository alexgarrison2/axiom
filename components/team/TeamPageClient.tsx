'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Segmented } from '@/components/ui/segmented';
import { FilterChip } from '@/components/ui/filter-chip';
import { FilterSheet } from '@/components/ui/filter-sheet';
import { fetchJsonCached, teamUrl } from '@/utils/team-stats/client-cache';
import { unpackGames } from '@/utils/team-stats/game-row';
import { seasonGames, seasonLabel } from '@/utils/team-stats/season';
import type { TeamPayload } from '@/utils/team-stats/team-types';
import GamesLogTable from './GamesLogTable';
import { signed } from '@/utils/team-stats/format';
import { DEFAULT_GAME_FILTERS, applyGameFilters, countGameFilters, totals, type TeamGameFilters } from './game-log-model';

const TeamChart = dynamic(() => import('@/components/TeamChart'), {
    ssr: false,
    loading: () => <div className="panel h-[340px] animate-pulse md:h-[480px]" role="status" aria-label="Loading chart" />,
});
const SkaterGrid = dynamic(() => import('./SkaterGrid'), {
    ssr: false,
    loading: () => (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" role="status" aria-label="Loading skaters">
            {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-44 animate-pulse rounded-card bg-surface-1" />
            ))}
        </div>
    ),
});

// Only needed once the sheet opens / the tab is picked.
const FilterControls = dynamic(() => import('./FilterControls'), { loading: () => <p className="label py-4">Loading</p> });
const GoaliesPanel = dynamic(() => import('./GoaliesPanel'), { loading: () => <div className="panel h-64 animate-pulse" role="status" aria-label="Loading goalies" /> });

const TABS = ['games', 'charts', 'skaters', 'goalies'] as const;
type Tab = (typeof TABS)[number];

interface TeamPageClientProps {
    initial: TeamPayload;
    /** Seasons offered by the switcher, newest first. */
    seasons: string[];
}

/**
 * Interactive part of a team page: season switcher, tabs (in the URL as
 * ?tab=), game-log filters in a sheet with quick chips, and the lazily
 * loaded Charts / Skaters tabs. The hero above it is server-rendered.
 */
export default function TeamPageClient({ initial, seasons }: TeamPageClientProps) {
    const tri = initial.team.tri;
    const [tab, setTab] = React.useState<Tab>('games');
    const [season, setSeason] = React.useState(initial.season);
    const [payloads, setPayloads] = React.useState<Record<string, TeamPayload>>({ [initial.season]: initial });
    const [filters, setFilters] = React.useState<TeamGameFilters>(DEFAULT_GAME_FILTERS);
    const [error, setError] = React.useState<string | null>(null);

    // Deep links: ?tab=goalies and ?season=20252026.
    React.useEffect(() => {
        try {
            const p = new URLSearchParams(window.location.search);
            const t = p.get('tab');
            if (t && (TABS as readonly string[]).includes(t)) setTab(t as Tab);
            const s = p.get('season');
            if (s && seasons.includes(s)) setSeason(s);
        } catch {
            /* ignore */
        }
    }, [seasons]);

    const writeUrl = (key: string, value: string | null) => {
        try {
            const url = new URL(window.location.href);
            if (value) url.searchParams.set(key, value);
            else url.searchParams.delete(key);
            window.history.replaceState(window.history.state, '', url);
        } catch {
            /* ignore */
        }
    };

    React.useEffect(() => {
        if (payloads[season]) return;
        let live = true;
        fetchJsonCached<TeamPayload>(teamUrl(tri, season))
            .then(p => live && setPayloads(prev => ({ ...prev, [season]: p })))
            .catch(() => live && setError(`${seasonLabel(season)} unavailable`));
        return () => {
            live = false;
        };
    }, [season, payloads, tri]);

    const payload = payloads[season] ?? null;
    const games = React.useMemo(() => (payload ? unpackGames(payload.games) : []), [payload]);
    const hasPlayoffs = games.some(g => g.type === 3);
    React.useEffect(() => {
        if (!hasPlayoffs && filters.scope === 'playoffs') setFilters(f => ({ ...f, scope: 'regular' }));
    }, [hasPlayoffs, filters.scope]);

    const filtered = React.useMemo(() => applyGameFilters(games, filters), [games, filters]);
    const goalieNames = React.useMemo(() => [...new Set(games.map(g => g.starter).filter(Boolean))].sort(), [games]);
    const opponents = React.useMemo(() => [...new Set(games.map(g => g.opp))].sort(), [games]);
    const active = countGameFilters(filters);
    // Unfiltered current season = the hero's numbers; the log then skips the
    // tiles that would repeat them and shows only what the hero lacks (GSAx).
    const heroView = season === seasons[0] && active === 0;
    const gsax = React.useMemo(() => {
        if (!heroView) return null;
        const t = totals(filtered, filters.period);
        return t.gp ? signed(t.gsax, 1) : null;
    }, [heroView, filtered, filters.period]);

    const loadBoxscores = React.useCallback(async () => {
        const full = await fetchJsonCached<TeamPayload>(teamUrl(tri, season));
        return full.boxscores;
    }, [tri, season]);

    const current = payloads[seasons[0]] ?? initial;
    const regularCount = games.filter(g => g.type === 2).length;
    const label = seasonLabel(season);
    const prev = seasons.find(s => s !== seasons[0]);

    const changeSeason = (s: string) => {
        setSeason(s);
        setError(null);
        writeUrl('season', s === seasons[0] ? null : s);
    };

    return (
        <Tabs
            value={tab}
            onValueChange={v => {
                setTab(v as Tab);
                writeUrl('tab', v === 'games' ? null : v);
            }}
            className="flex flex-col gap-2.5"
        >
            <div className="flex flex-wrap items-center gap-2">
                <TabsList aria-label="Team sections">
                    <TabsTrigger value="games">Games</TabsTrigger>
                    <TabsTrigger value="charts">Charts</TabsTrigger>
                    <TabsTrigger value="skaters">Skaters</TabsTrigger>
                    <TabsTrigger value="goalies">Goalies</TabsTrigger>
                </TabsList>
                {/* One row on phones: season + quick chips scroll sideways instead of wrapping. */}
                {tab === 'games' || tab === 'charts' ? (
                    <div className="-mx-4 flex w-[calc(100%+2rem)] min-w-0 flex-nowrap items-center gap-2 overflow-x-auto px-4 scrollbar-hide sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0 [&>*]:shrink-0">
                        <Segmented label="Season" size="sm" value={season} onChange={changeSeason} options={seasons.map(s => ({ value: s, label: seasonLabel(s) }))} />
                        {tab === 'games' ? (
                            <>
                                <FilterChip selected={filters.recent === 10} onSelectedChange={on => setFilters(f => ({ ...f, recent: on ? 10 : 'All' }))}>
                                    L10
                                </FilterChip>
                                <FilterChip selected={filters.location === 'Home'} onSelectedChange={on => setFilters(f => ({ ...f, location: on ? 'Home' : 'All' }))}>
                                    Home
                                </FilterChip>
                                <FilterChip selected={filters.location === 'Away'} onSelectedChange={on => setFilters(f => ({ ...f, location: on ? 'Away' : 'All' }))}>
                                    Away
                                </FilterChip>
                                <FilterSheet
                                    activeCount={active}
                                    title="Filters"
                                    onReset={() => setFilters({ ...DEFAULT_GAME_FILTERS, ranges: {} })}
                                    applyLabel={`${filtered.length} GP`}
                                >
                                    <FilterControls filters={filters} setFilters={setFilters} goalies={goalieNames} opponents={opponents} hasPlayoffs={hasPlayoffs} />
                                </FilterSheet>
                                {active > 0 ? (
                                    <button
                                        type="button"
                                        onClick={() => setFilters({ ...DEFAULT_GAME_FILTERS, ranges: {} })}
                                        className="min-h-[34px] px-2 text-micro font-medium uppercase tracking-chip text-fg-3 hover:text-fg-1 coarse:min-h-11"
                                    >
                                        Clear
                                    </button>
                                ) : null}
                            </>
                        ) : null}
                    </div>
                ) : null}
            </div>
            {error ? (
                <p role="alert" className="text-micro uppercase tracking-label text-neg">
                    {error}
                </p>
            ) : null}

            <TabsContent value="games" className="mt-0 flex flex-col gap-2">
                <p className="flex items-center gap-2 text-micro font-medium uppercase tracking-label text-fg-3">
                    <span className="text-fg-1">
                        {label} {filters.scope === 'playoffs' ? 'playoffs' : 'regular season'}
                    </span>
                    <span aria-hidden="true" className="text-fg-disabled">
                        ·
                    </span>
                    <span>
                        <span className="text-fg-1">{filtered.length}</span>/{filters.scope === 'playoffs' ? games.length - regularCount : regularCount} GP
                    </span>
                    {gsax ? (
                        <>
                            <span aria-hidden="true" className="text-fg-disabled">
                                ·
                            </span>
                            <span>
                                GSAx <span className="text-fg-1">{gsax}</span>
                            </span>
                        </>
                    ) : null}
                </p>

                {!payload ? (
                    <div className="panel h-64 animate-pulse" role="status" aria-label="Loading games" />
                ) : games.length === 0 && payload.isCurrent ? (
                    <div className="panel flex items-center justify-between gap-3 p-card" role="status">
                        <span className="label">No games</span>
                        {prev ? (
                            <button
                                type="button"
                                onClick={() => changeSeason(prev)}
                                aria-label={`Show the ${seasonLabel(prev)} game log`}
                                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full border border-line px-3.5 text-micro font-medium uppercase tracking-chip text-fg-2 hover:border-line-strong hover:text-fg-1 coarse:min-h-11"
                            >
                                {seasonLabel(prev)} <span aria-hidden="true">→</span>
                            </button>
                        ) : null}
                    </div>
                ) : (
                    <GamesLogTable games={filtered} showSummary={!heroView} period={filters.period} seasonLabel={label} teamColor={initial.team.color} loadBoxscores={loadBoxscores} />
                )}
            </TabsContent>

            <TabsContent value="charts" className="mt-0">
                {payload ? (
                    <TeamChart games={filtered} leagueAverages={payload.leagueAverages} primaryColor={initial.team.color} teamName={initial.team.name} seasonLabel={label} />
                ) : null}
            </TabsContent>

            <TabsContent value="skaters" className="mt-0">
                <SkaterGrid
                    skaters={current.skaters}
                    lineup={current.lineup}
                    team={tri}
                    teamColor={initial.team.color}
                    currentLabel={seasonLabel(seasons[0])}
                    prevLabel={prev ? seasonLabel(prev) : ''}
                    ratingsLabel={current.ratingsSeasonLabel}
                    currentSeasonGames={seasonGames(seasons[0])}
                    prevSeasonGames={prev ? seasonGames(prev) : 82}
                />
            </TabsContent>

            <TabsContent value="goalies" className="mt-0">
                <GoaliesPanel goalies={current.goalies} currentLabel={seasonLabel(seasons[0])} prevLabel={prev ? seasonLabel(prev) : ''} />
            </TabsContent>
        </Tabs>
    );
}
