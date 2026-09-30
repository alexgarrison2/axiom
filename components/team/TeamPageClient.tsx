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
import FilterControls from './FilterControls';
import GamesLogTable from './GamesLogTable';
import GoaliesPanel from './GoaliesPanel';
import { DEFAULT_GAME_FILTERS, applyGameFilters, countGameFilters, type TeamGameFilters } from './game-log-model';

const TeamChart = dynamic(() => import('@/components/TeamChart'), {
    ssr: false,
    loading: () => <div className="hud-panel h-[360px] animate-pulse md:h-[520px]" role="status" aria-label="Loading chart" />,
});
const SkaterGrid = dynamic(() => import('./SkaterGrid'), {
    ssr: false,
    loading: () => (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" role="status" aria-label="Loading skaters">
            {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-72 animate-pulse rounded-card bg-surface-1" />
            ))}
        </div>
    ),
});

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
            .catch(() => live && setError(`Could not load ${seasonLabel(season)}.`));
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
            className="flex flex-col gap-4"
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <TabsList aria-label="Team sections">
                    <TabsTrigger value="games">Games</TabsTrigger>
                    <TabsTrigger value="charts">Charts</TabsTrigger>
                    <TabsTrigger value="skaters">Skaters</TabsTrigger>
                    <TabsTrigger value="goalies">Goalies</TabsTrigger>
                </TabsList>
                {tab !== 'skaters' ? (
                    <Segmented label="Season" value={season} onChange={changeSeason} options={seasons.map(s => ({ value: s, label: seasonLabel(s) }))} />
                ) : null}
            </div>
            {error ? (
                <p role="alert" className="text-body-sm text-neg">
                    {error}
                </p>
            ) : null}

            <TabsContent value="games" className="mt-0 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <FilterChip selected={filters.recent === 10} onSelectedChange={on => setFilters(f => ({ ...f, recent: on ? 10 : 'All' }))}>
                        Last 10
                    </FilterChip>
                    <FilterChip selected={filters.location === 'Home'} onSelectedChange={on => setFilters(f => ({ ...f, location: on ? 'Home' : 'All' }))}>
                        Home
                    </FilterChip>
                    <FilterChip selected={filters.location === 'Away'} onSelectedChange={on => setFilters(f => ({ ...f, location: on ? 'Away' : 'All' }))}>
                        Away
                    </FilterChip>
                    <FilterSheet
                        activeCount={active}
                        title="Filter games"
                        description={`${initial.team.common} · ${label}`}
                        onReset={() => setFilters({ ...DEFAULT_GAME_FILTERS, ranges: {} })}
                        applyLabel={`Show ${filtered.length} ${filtered.length === 1 ? 'game' : 'games'}`}
                    >
                        <FilterControls filters={filters} setFilters={setFilters} goalies={goalieNames} opponents={opponents} hasPlayoffs={hasPlayoffs} />
                    </FilterSheet>
                    {active > 0 ? (
                        <button type="button" onClick={() => setFilters({ ...DEFAULT_GAME_FILTERS, ranges: {} })} className="min-h-9 px-2 text-body-sm font-semibold text-fg-2 hover:text-fg-1 hover:underline coarse:min-h-11">
                            Clear filters
                        </button>
                    ) : null}
                    <span className="ml-auto text-caption text-fg-2">
                        <span className="font-mono font-semibold text-fg-1">{label}</span> {filters.scope === 'playoffs' ? 'playoffs' : 'regular season'} · {filtered.length} of {filters.scope === 'playoffs' ? games.length - regularCount : regularCount} games
                    </span>
                </div>

                {!payload ? (
                    <div className="hud-panel h-64 animate-pulse" role="status" aria-label="Loading games" />
                ) : games.length === 0 && payload.isCurrent ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-brand/30 bg-brand/[0.06] px-4 py-3" role="status">
                        <p className="text-body-sm text-fg-1">
                            No {label} games yet. <span className="text-fg-2">The log fills in the morning after each game.</span>
                        </p>
                        {prev ? (
                            <button type="button" onClick={() => changeSeason(prev)} className="inline-flex min-h-9 items-center gap-1 rounded-control border border-line-strong bg-surface-2 px-3 text-body-sm font-semibold text-fg-1 hover:bg-surface-3 coarse:min-h-11">
                                View {seasonLabel(prev)} game log <span aria-hidden="true">→</span>
                            </button>
                        ) : null}
                    </div>
                ) : (
                    <GamesLogTable games={filtered} period={filters.period} seasonLabel={label} teamColor={initial.team.color} loadBoxscores={loadBoxscores} />
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
