'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Prediction, SideDetails } from '@/types/prediction';
import { loadJson } from '@/lib/client-data';
import { SEASON_ID } from '@/lib/season';
import { shortSeason } from '@/utils/team-stats/season';
import { Crest } from '@/components/ui/crest';
import { FilterChip } from '@/components/ui/filter-chip';
import { SeasonTag } from '@/components/ui/stat-chip';
import { clashSafePair } from '@/components/ui/team-color';
import { lastName } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';
import {
    MIN_GP,
    REST_LABEL,
    STATS,
    advantage,
    filterGames,
    ordinal,
    percentile,
    rankPercentile,
    refKey,
    sideValues,
    smallSample,
    tonightRest,
    unpackTeamGames,
    type LeagueReference,
    type MatchupGame,
    type SideFilter,
    type StatDef,
    type TeamGamesPayload,
} from '@/lib/matchup/matchup-stats';
import type { DetailsState } from './DetailsLoading';

type Side = 'away' | 'home';
const SIDES: Side[] = ['away', 'home'];

export const leagueRefUrl = '/api/matchup-stats/league';
export const teamGamesUrl = (tri: string) => `/api/matchup-stats/team/${tri}`;

interface Loaded {
    league: LeagueReference;
    games: Record<Side, MatchupGame[]>;
}

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: Loaded };

interface Cell {
    value: number | null;
    pct: number | null;
    gp?: number;
}

interface RowModel {
    stat: StatDef;
    cells: Record<Side, Cell>;
    adv: Side | null;
}

const HATCH = 'repeating-linear-gradient(135deg, rgb(var(--text-3-rgb) / 0.55) 0 2px, transparent 2px 5px)';

/**
 * One half of a row: the bar grows outward from the axis, the value sits at
 * its end, and the side with the advantage gets its crest beside the value.
 */
function Bar({ side, cell, color, state, fmt, tri }: { side: Side; cell: Cell; color: string; state: BarState; fmt: (v: number) => string; tri: string }) {
    const away = side === 'away';
    if (cell.value == null || cell.pct == null) {
        return <div className={cn('flex h-7 items-center px-1.5 text-caption text-fg-3', away ? 'justify-end' : 'justify-start')}>—</div>;
    }
    const w = Math.max(cell.pct, 2);
    return (
        <div className={cn('relative h-7', away ? 'ml-12' : 'mr-12')}>
            <div
                data-bar={state}
                className={cn('absolute top-1/2 h-2.5 -translate-y-1/2', away ? 'right-0 rounded-l-full' : 'left-0 rounded-r-full')}
                style={{
                    width: `${w}%`,
                    background: state === 'small' ? HATCH : color,
                    opacity: state === 'adv' || state === 'small' ? 1 : state === 'even' ? 0.55 : 0.28,
                }}
            />
            <span
                className={cn(
                    'absolute top-1/2 flex -translate-y-1/2 items-center gap-1 whitespace-nowrap text-caption tabular-nums',
                    away ? 'flex-row-reverse pr-1.5' : 'pl-1.5',
                    state === 'adv' ? 'font-bold text-fg-1' : state === 'small' ? 'text-fg-3' : 'text-fg-2',
                )}
                style={away ? { right: `${w}%` } : { left: `${w}%` }}
            >
                {fmt(cell.value)}
                {state === 'adv' ? <Crest tri={tri} size={22} className="h-[22px] w-[22px] drop-shadow-none" /> : null}
            </span>
        </div>
    );
}

type BarState = 'adv' | 'dim' | 'even' | 'small';

function barState(row: RowModel, side: Side): BarState {
    if (smallSample(row.cells[side])) return 'small';
    if (!row.adv) return 'even';
    return row.adv === side ? 'adv' : 'dim';
}

function ChartRow({ row, tris, colors }: { row: RowModel; tris: Record<Side, string>; colors: Record<Side, string> }) {
    return (
        <div
            className="grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-center cq-md:grid-cols-[minmax(0,1fr)_84px_minmax(0,1fr)]"
            data-stat={row.stat.key}
            data-adv={row.adv ?? 'none'}
        >
            <Bar side="away" tri={tris.away} cell={row.cells.away} color={colors.away} state={barState(row, 'away')} fmt={row.stat.fmt} />
            <span className="flex h-7 items-center justify-center whitespace-nowrap border-x border-line text-micro font-bold uppercase tracking-wide text-fg-2">
                {row.stat.label}
            </span>
            <Bar side="home" tri={tris.home} cell={row.cells.home} color={colors.home} state={barState(row, 'home')} fmt={row.stat.fmt} />
        </div>
    );
}

/** Centered group label on the axis ("5v5", "Ignores filters"). */
function GroupTag({ children, extra, first }: { children: React.ReactNode; extra?: React.ReactNode; first?: boolean }) {
    return (
        <div className={cn('flex items-center justify-center gap-1.5 pb-0.5', !first && 'mt-1 border-t border-dashed border-line pt-1.5')}>
            <span className="rounded-[3px] border border-mute px-1 text-micro uppercase leading-[14px] tracking-wide text-fg-3">{children}</span>
            {extra}
        </div>
    );
}

function TeamHead({ side, tri, gp, tags }: { side: Side; tri: string; gp: number; tags: string[] }) {
    const away = side === 'away';
    return (
        <div className={cn('flex min-w-0 items-center gap-2', !away && 'flex-row-reverse text-right')}>
            <Crest tri={tri} size={96} className="-my-1 h-20 w-20 cq-md:h-24 cq-md:w-24" />
            <div className={cn('flex min-w-0 flex-col', away ? 'items-start' : 'items-end')}>
                <span className="font-display text-h2 font-bold uppercase leading-none text-fg-1">{tri}</span>
                <span className={cn('mt-1 text-micro uppercase tracking-wide tabular-nums', gp < MIN_GP ? 'text-warn' : 'text-fg-3')}>
                    GP <span className="font-bold">{gp}</span>
                </span>
                {tags.length ? (
                    <span className="mt-0.5 flex flex-wrap gap-x-1.5 text-micro uppercase tracking-wide text-brand" data-situation>
                        {tags.map(t => (
                            <span key={t} className="whitespace-nowrap">
                                {t}
                            </span>
                        ))}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

const pctText = (c: Cell) => (c.pct == null ? 'no value' : `${ordinal(c.pct)} pct`);

/** Tornado chart: each team's league percentile per stat, away left / home right, with filters for tonight's situation. */
export function MatchupPanel({ p, state }: { p: Prediction; state: DetailsState }) {
    const tris: Record<Side, string> = { away: p.away.team.triCode, home: p.home.team.triCode };
    const [load, setLoad] = useState<LoadState>({ status: 'loading' });
    const [useLoc, setUseLoc] = useState(false);
    const [useRest, setUseRest] = useState(false);
    const [useStarter, setUseStarter] = useState(false);

    useEffect(() => {
        let live = true;
        Promise.all([loadJson<LeagueReference>(leagueRefUrl), loadJson<TeamGamesPayload>(teamGamesUrl(tris.away)), loadJson<TeamGamesPayload>(teamGamesUrl(tris.home))]).then(
            ([league, away, home]) => live && setLoad({ status: 'ready', data: { league, games: { away: unpackTeamGames(away), home: unpackTeamGames(home) } } }),
            () => live && setLoad({ status: 'error' }),
        );
        return () => {
            live = false;
        };
    }, [tris.away, tris.home]);

    const colors = useMemo(() => {
        const pair = clashSafePair(tris.away, tris.home);
        return { away: pair.away, home: pair.home };
    }, [tris.away, tris.home]);

    const goalie: Record<Side, string | null> = { away: p.away.goalie, home: p.home.goalie };
    const anyStarter = !!(goalie.away || goalie.home);

    const model = useMemo(() => {
        if (load.status !== 'ready') return null;
        const { league, games } = load.data;
        const t: Record<Side, string> = { away: p.away.team.triCode, home: p.home.team.triCode };
        const filters = {} as Record<Side, SideFilter>;
        const rest = {} as Record<Side, ReturnType<typeof tonightRest>>;
        const values = {} as Record<Side, ReturnType<typeof sideValues>>;
        const gp = {} as Record<Side, number>;
        for (const side of SIDES) {
            rest[side] = tonightRest(games[side], p.date, p[side].restDays, p.id);
            filters[side] = {
                location: useLoc ? (side === 'home' ? 'home' : 'road') : 'all',
                rest: useRest ? rest[side] : 'all',
                starter: useStarter ? p[side].goalie : null,
            };
            const sel = filterGames(games[side], filters[side], p.id);
            gp[side] = sel.length;
            values[side] = sideValues(t[side], sel);
        }
        const details: Record<Side, SideDetails | null> | null = state.status === 'ready' && state.data ? { away: state.data.away, home: state.data.home } : null;
        const rows: RowModel[] = STATS.map(stat => {
            const cells = {} as Record<Side, Cell>;
            for (const side of SIDES) {
                if (stat.key === 'lineup') {
                    const g = details?.[side]?.grade ?? null;
                    cells[side] = { value: g?.value ?? null, pct: g ? rankPercentile(g.rank, g.outOf) : null };
                } else {
                    const ref = league.ref[refKey(filters[side].location, filters[side].rest)]?.[stat.key];
                    const v = values[side][stat.key];
                    cells[side] = { value: v, pct: percentile(v, ref, stat.higherBetter), gp: gp[side] };
                }
            }
            return { stat, cells, adv: advantage(cells.away, cells.home) };
        });
        return { rows, gp, rest, filters, seasons: league.seasons };
    }, [load, state, useLoc, useRest, useStarter, p]);

    if (load.status === 'loading') {
        return (
            <div aria-busy="true" className="flex flex-col gap-2 py-1">
                <div className="h-16 animate-pulse rounded-[10px] bg-surface-2" />
                <div className="h-64 animate-pulse rounded-[10px] bg-surface-2" />
            </div>
        );
    }
    if (load.status === 'error' || !model) return <p className="label py-4 text-center">Unavailable</p>;

    const windowLabel = model.seasons.map(shortSeason).join(' + ');
    const lineupImpactSeason = state.status === 'ready' ? state.data?.impactSeason : null;
    const tags = (side: Side) => {
        const f = model.filters[side];
        const t: string[] = [];
        if (f.location !== 'all') t.push(f.location);
        if (f.rest !== 'all') t.push(REST_LABEL[f.rest]);
        if (useStarter) t.push(goalie[side] ? lastName(goalie[side]!) : 'Any G');
        return t;
    };
    const teamRows = model.rows.filter(r => r.stat.key !== 'lineup');
    const lineupRow = model.rows.find(r => r.stat.key === 'lineup')!;
    const name = (s: Side) => tris[s];

    return (
        <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
                <TeamHead side="away" tri={tris.away} gp={model.gp.away} tags={tags('away')} />
                <TeamHead side="home" tri={tris.home} gp={model.gp.home} tags={tags('home')} />
            </div>

            <div className="flex flex-wrap items-center justify-center gap-1.5" role="group" aria-label="Filter each team by its own situation tonight">
                <FilterChip selected={useLoc} onSelectedChange={setUseLoc} title={`${tris.away} road games, ${tris.home} home games`}>
                    Home/Road
                </FilterChip>
                <FilterChip
                    selected={useRest}
                    onSelectedChange={setUseRest}
                    title={`Games with the same rest as tonight: ${tris.away} ${REST_LABEL[model.rest.away]}, ${tris.home} ${REST_LABEL[model.rest.home]}`}
                >
                    Rest
                </FilterChip>
                <FilterChip
                    selected={useStarter && anyStarter}
                    onSelectedChange={setUseStarter}
                    disabled={!anyStarter}
                    className="disabled:cursor-not-allowed disabled:opacity-50"
                    title={anyStarter ? `Games started by ${goalie.away ?? 'any goalie'} / ${goalie.home ?? 'any goalie'}` : 'No projected starters yet'}
                >
                    Starter
                </FilterChip>
            </div>

            <div className="flex items-center justify-center gap-2 text-micro uppercase tracking-wide text-fg-3">
                <SeasonTag>
                    {windowLabel}
                    <span className="sr-only"> seasons, regular season</span>
                </SeasonTag>
                <span>League pct</span>
            </div>

            {/* Visual chart; the table below is its text equivalent. */}
            <div aria-hidden="true" className="flex flex-col">
                <GroupTag first>5v5</GroupTag>
                {teamRows
                    .filter(r => r.stat.sub)
                    .map(r => (
                        <ChartRow key={r.stat.key} row={r} tris={tris} colors={colors} />
                    ))}
                <GroupTag>All situations</GroupTag>
                {teamRows
                    .filter(r => !r.stat.sub)
                    .map(r => (
                        <ChartRow key={r.stat.key} row={r} tris={tris} colors={colors} />
                    ))}
                <GroupTag extra={lineupImpactSeason && lineupImpactSeason !== SEASON_ID ? <SeasonTag>{shortSeason(lineupImpactSeason)}</SeasonTag> : null}>
                    Ignores filters
                </GroupTag>
                <ChartRow row={lineupRow} tris={tris} colors={colors} />
            </div>

            <table className="sr-only">
                <caption>
                    {`League percentiles, ${windowLabel} regular season${useLoc || useRest || useStarter ? ', filtered to each team’s situation tonight' : ''}. ${tris.away} ${model.gp.away} games, ${tris.home} ${model.gp.home} games.`}
                </caption>
                <thead>
                    <tr>
                        <th scope="col">Stat</th>
                        <th scope="col">{tris.away}</th>
                        <th scope="col">{tris.home}</th>
                        <th scope="col">Advantage</th>
                    </tr>
                </thead>
                <tbody>
                    {model.rows.map(r => (
                        <tr key={r.stat.key}>
                            <th scope="row">{r.stat.key === 'lineup' ? `${r.stat.name} (ignores filters)` : r.stat.name}</th>
                            {SIDES.map(s => (
                                <td key={s}>
                                    {r.cells[s].value == null ? 'no value' : `${r.stat.fmt(r.cells[s].value!)}, ${pctText(r.cells[s])}${smallSample(r.cells[s]) ? ', small sample' : ''}`}
                                </td>
                            ))}
                            <td>{r.adv ? name(r.adv) : 'None'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default MatchupPanel;
