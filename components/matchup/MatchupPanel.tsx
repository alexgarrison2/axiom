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
    type LastKey,
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
    minGp?: number;
}

interface RowModel {
    stat: StatDef;
    cells: Record<Side, Cell>;
    adv: Side | null;
}

const HATCH = 'repeating-linear-gradient(135deg, rgb(var(--text-3-rgb) / 0.55) 0 2px, transparent 2px 5px)';

/**
 * One half of a row: the value sits in a fixed column at the outer edge and
 * the bar grows outward from the axis inside its own track, so nothing can
 * overflow the panel (no horizontal scroll at any width).
 */
function Bar({ side, cell, color, state, fmt }: { side: Side; cell: Cell; color: string; state: BarState; fmt: (v: number) => string }) {
    const away = side === 'away';
    const w = cell.pct == null ? 0 : Math.max(cell.pct, 2);
    const missing = cell.value == null || cell.pct == null;
    const value = (
        <span
            className={cn(
                'whitespace-nowrap text-caption tabular-nums',
                away ? 'text-left' : 'text-right',
                state === 'adv' ? 'font-bold text-fg-1' : state === 'small' || missing ? 'text-fg-3' : 'text-fg-2',
            )}
        >
            {missing ? '—' : fmt(cell.value!)}
        </span>
    );
    const track = (
        <div className="relative h-7">
            {missing ? null : (
                <div
                    data-bar={state}
                    className={cn('absolute top-1/2 h-2.5 -translate-y-1/2', away ? 'right-0 rounded-l-full' : 'left-0 rounded-r-full')}
                    style={{
                        width: `${w}%`,
                        background: state === 'small' ? HATCH : color,
                        opacity: state === 'adv' || state === 'small' ? 1 : state === 'even' ? 0.55 : 0.28,
                    }}
                />
            )}
        </div>
    );
    return (
        <>
            {away ? value : track}
            {away ? track : value}
        </>
    );
}

type BarState = 'adv' | 'dim' | 'even' | 'small';

function barState(row: RowModel, side: Side): BarState {
    if (smallSample(row.cells[side])) return 'small';
    if (!row.adv) return 'even';
    return row.adv === side ? 'adv' : 'dim';
}

/** White wedge between the stat label and the bar of the side with the advantage. */
function Wedge({ side }: { side: Side }) {
    return (
        <span
            aria-hidden="true"
            data-wedge={side}
            className={cn(
                'absolute top-1/2 h-0 w-0 -translate-y-1/2 border-y-[5px] border-y-transparent',
                side === 'away' ? 'left-1 border-r-[7px] border-r-white' : 'right-1 border-l-[7px] border-l-white',
            )}
        />
    );
}

function ChartRow({ row, colors }: { row: RowModel; colors: Record<Side, string> }) {
    return (
        <div
            className="grid grid-cols-[2.75rem_minmax(0,1fr)_5.25rem_minmax(0,1fr)_2.75rem] items-center gap-x-1.5 cq-md:grid-cols-[3.25rem_minmax(0,1fr)_6rem_minmax(0,1fr)_3.25rem]"
            data-stat={row.stat.key}
            data-adv={row.adv ?? 'none'}
        >
            <Bar side="away" cell={row.cells.away} color={colors.away} state={barState(row, 'away')} fmt={row.stat.fmt} />
            <span className="relative flex h-7 items-center justify-center whitespace-nowrap border-x border-line px-3 text-micro font-bold uppercase tracking-wide text-fg-2">
                {row.adv === 'away' ? <Wedge side="away" /> : null}
                {row.stat.label}
                {row.adv === 'home' ? <Wedge side="home" /> : null}
            </span>
            <Bar side="home" cell={row.cells.home} color={colors.home} state={barState(row, 'home')} fmt={row.stat.fmt} />
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
    const [last, setLast] = useState<LastKey>('all');

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
                last,
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
                    const ref = league.ref[refKey(filters[side].location, filters[side].rest, last)]?.[stat.key];
                    const v = values[side][stat.key];
                    cells[side] = { value: v, pct: percentile(v, ref, stat.higherBetter), gp: gp[side], minGp: last === 'all' ? undefined : last };
                }
            }
            return { stat, cells, adv: advantage(cells.away, cells.home) };
        });
        return { rows, gp, rest, filters, seasons: league.seasons };
    }, [load, state, useLoc, useRest, useStarter, last, p]);

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
        if (last !== 'all') t.push(`L${last}`);
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
                <FilterChip selected={last === 5} onSelectedChange={v => setLast(v ? 5 : 'all')} title="Each team's last 5 games (after the other filters)">
                    Last 5
                </FilterChip>
                <FilterChip selected={last === 10} onSelectedChange={v => setLast(v ? 10 : 'all')} title="Each team's last 10 games (after the other filters)">
                    Last 10
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
                        <ChartRow key={r.stat.key} row={r} colors={colors} />
                    ))}
                <GroupTag>All situations</GroupTag>
                {teamRows
                    .filter(r => !r.stat.sub)
                    .map(r => (
                        <ChartRow key={r.stat.key} row={r} colors={colors} />
                    ))}
                <GroupTag extra={lineupImpactSeason && lineupImpactSeason !== SEASON_ID ? <SeasonTag>{shortSeason(lineupImpactSeason)}</SeasonTag> : null}>
                    Ignores filters
                </GroupTag>
                <ChartRow row={lineupRow} colors={colors} />
            </div>

            <table className="sr-only">
                <caption>
                    {`League percentiles, ${windowLabel} regular season${useLoc || useRest || useStarter || last !== 'all' ? ', filtered to each team’s situation tonight' : ''}. ${tris.away} ${model.gp.away} games, ${tris.home} ${model.gp.home} games.`}
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
