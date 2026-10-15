'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Prediction, SideDetails } from '@/types/prediction';
import { DEPLOY, loadJson } from '@/lib/client-data';
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
    leagueRank,
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

export const leagueRefUrl = `/api/matchup-stats/league?v=${DEPLOY}`;
export const teamGamesUrl = (tri: string) => `/api/matchup-stats/team/${tri}?v=${DEPLOY}`;

interface Loaded {
    league: LeagueReference;
    games: Record<Side, MatchupGame[]>;
}

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: Loaded };

interface Cell {
    value: number | null;
    pct: number | null;
    /** League rank, 1 = best. */
    rank: number | null;
    outOf: number | null;
    gp?: number;
    minGp?: number;
}

interface RowModel {
    stat: StatDef;
    cells: Record<Side, Cell>;
    adv: Side | null;
}

type BarState = 'adv' | 'dim' | 'even';

function barState(row: RowModel, side: Side): BarState {
    if (!row.adv) return 'even';
    return row.adv === side ? 'adv' : 'dim';
}

/** Room on a track's outer end for the rank at the tip of a full-length bar. */
const RANK_ROOM = '1.875rem';

/**
 * A side's bar, growing outward from its value at the spine, with the team's
 * league rank at the tip: bar length is the league standing, so the rank
 * labels what the length already says. The track keeps room for the rank, so
 * nothing overflows the panel at any width.
 */
function Track({ side, cell, color, state }: { side: Side; cell: Cell; color: string; state: BarState }) {
    const away = side === 'away';
    if (cell.value == null || cell.pct == null) return <span />;
    const w = Math.max(cell.pct, 3);
    return (
        <span className="relative h-full min-w-0">
            <span className="absolute inset-y-0" style={away ? { left: RANK_ROOM, right: 0 } : { left: 0, right: RANK_ROOM }}>
                <span
                    data-bar={state}
                    className={cn('absolute top-1/2 h-3 -translate-y-1/2', away ? 'right-0 rounded-l-[3px]' : 'left-0 rounded-r-[3px]')}
                    style={{ width: `${w}%`, background: color, opacity: state === 'adv' ? 1 : state === 'even' ? 0.6 : 0.3 }}
                />
                {cell.rank != null ? (
                    <span
                        data-rank
                        className={cn('absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-micro leading-none tabular-nums', cell.rank <= 8 ? 'font-semibold text-fg-1' : 'text-fg-3')}
                        style={away ? { right: `calc(${w}% + 5px)` } : { left: `calc(${w}% + 5px)` }}
                    >
                        #{cell.rank}
                    </span>
                ) : null}
            </span>
        </span>
    );
}

/** A side's value beside the spine: bold ink with the edge, dim without it. */
function Value({ side, cell, state, fmt }: { side: Side; cell: Cell; state: BarState; fmt: (v: number) => string }) {
    const missing = cell.value == null;
    return (
        <span
            className={cn(
                'whitespace-nowrap text-caption tabular-nums',
                side === 'away' ? 'text-right' : 'text-left',
                missing || state === 'dim' ? 'text-fg-3' : state === 'adv' ? 'font-bold text-fg-1' : 'text-fg-2',
            )}
        >
            {missing ? '—' : fmt(cell.value!)}
        </span>
    );
}

/** Columns: away track, away value, stat label (the spine), home value, home track. */
const COLS = 'grid grid-cols-[minmax(0,1fr)_2.5rem_4.25rem_2.5rem_minmax(0,1fr)] gap-x-1.5 cq-md:grid-cols-[minmax(0,1fr)_3rem_5rem_3rem_minmax(0,1fr)] cq-md:gap-x-2';

function ChartRow({ row, colors }: { row: RowModel; colors: Record<Side, string> }) {
    return (
        <div className={cn(COLS, 'h-7 items-center')} data-stat={row.stat.key} data-adv={row.adv ?? 'none'}>
            <Track side="away" cell={row.cells.away} color={colors.away} state={barState(row, 'away')} />
            <Value side="away" cell={row.cells.away} state={barState(row, 'away')} fmt={row.stat.fmt} />
            <span className="whitespace-nowrap text-center text-micro font-bold uppercase tracking-wide text-fg-3">{row.stat.label}</span>
            <Value side="home" cell={row.cells.home} state={barState(row, 'home')} fmt={row.stat.fmt} />
            <Track side="home" cell={row.cells.home} color={colors.home} state={barState(row, 'home')} />
        </div>
    );
}

/** Centred group label on the spine ("5v5", "Ignores filters"). */
function GroupTag({ children, extra, first }: { children: React.ReactNode; extra?: React.ReactNode; first?: boolean }) {
    return (
        <div className={cn('flex items-center justify-center gap-1.5 pb-0.5', first ? 'pt-1.5' : 'mt-1.5 border-t border-dashed border-line pt-2')}>
            <span className="text-micro uppercase leading-[14px] tracking-label text-fg-3">{children}</span>
            {extra}
        </div>
    );
}

/**
 * A side's head over its half of the chart: crest flush at the outer edge, the
 * tri over a stroke of the colour its bars use, and the games counted. Under
 * the sample minimum the count is boxed amber-dashed (a small sample, marked
 * rather than hidden). Games played but not logged yet and filter tags follow.
 */
function SideHead({ side, tri, color, gp, minGp, pending, tags }: { side: Side; tri: string; color: string; gp: number; minGp: number; pending: number; tags: string[] }) {
    const away = side === 'away';
    const small = gp < minGp;
    return (
        <div className={cn('flex min-w-0 items-center gap-2', !away && 'flex-row-reverse text-right')}>
            <Crest tri={tri} size={48} className="h-10 w-10 drop-shadow-none cq-md:h-12 cq-md:w-12" />
            <div className={cn('flex min-w-0 flex-col gap-1', away ? 'items-start' : 'items-end')}>
                <span className={cn('flex flex-col gap-1 font-display text-title font-bold uppercase leading-none text-fg-1', away ? 'items-start' : 'items-end')}>
                    {tri}
                    <span aria-hidden="true" className="h-[3px] w-6 rounded-full" style={{ background: color }} />
                </span>
                <span className={cn('flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-micro uppercase tracking-wide tabular-nums', !away && 'justify-end')}>
                    <span data-small-sample={small ? '' : undefined} className={cn('whitespace-nowrap', small ? 'rounded-[3px] border border-dashed border-warn/60 px-1 leading-[14px] text-warn' : 'text-fg-3')}>
                        GP <b className="font-bold">{gp}</b>
                        {small ? <span className="sr-only">, small sample</span> : null}
                    </span>
                    {pending > 0 ? (
                        <span className="whitespace-nowrap text-amber" title="Played, but not in these numbers yet: the game log updates after the nightly ingest.">
                            +{pending} pending
                        </span>
                    ) : null}
                    {tags.map(t => (
                        <span key={t} className="whitespace-nowrap text-brand">
                            {t}
                        </span>
                    ))}
                </span>
            </div>
        </div>
    );
}

const rankText = (c: Cell) => (c.rank == null ? 'no rank' : `ranked ${ordinal(c.rank)}${c.outOf ? ` of ${c.outOf}` : ''}`);

/**
 * The Tape: each team per stat, away left / home right, mirrored on a spine of
 * stat labels with the values beside it. Bars grow outward by league
 * percentile and carry the league rank at their tip; the side with the edge is
 * bold and full colour, the other dimmed. Filters narrow each team to its own
 * situation tonight.
 */
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
        const pending = {} as Record<Side, number>;
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
            // Games the schedule feed (hourly) says were played that the game log (daily) does not hold yet.
            const logged = games[side].filter(g => g.row.type === 2 && g.row.id !== p.id && g.row.date < p.date).length;
            pending[side] = Math.max(0, (p[side].gp ?? 0) - logged);
            values[side] = sideValues(t[side], sel);
        }
        const details: Record<Side, SideDetails | null> | null = state.status === 'ready' && state.data ? { away: state.data.away, home: state.data.home } : null;
        const rows: RowModel[] = STATS.map(stat => {
            const cells = {} as Record<Side, Cell>;
            for (const side of SIDES) {
                if (stat.key === 'lineup') {
                    const g = details?.[side]?.grade ?? null;
                    cells[side] = { value: g?.value ?? null, pct: g ? rankPercentile(g.rank, g.outOf) : null, rank: g?.rank ?? null, outOf: g?.outOf ?? null };
                } else {
                    const ref = league.ref[refKey(filters[side].location, filters[side].rest, last)]?.[stat.key];
                    const v = values[side][stat.key];
                    const r = leagueRank(v, ref, stat.higherBetter);
                    cells[side] = { value: v, pct: percentile(v, ref, stat.higherBetter), rank: r?.rank ?? null, outOf: r?.outOf ?? null, gp: gp[side], minGp: last === 'all' ? undefined : last };
                }
            }
            return { stat, cells, adv: advantage(cells.away, cells.home) };
        });
        return { rows, gp, pending, rest, filters, seasons: league.seasons };
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
    const minGp = last === 'all' ? MIN_GP : last;

    return (
        <div className="flex flex-col gap-3">
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

            <div className="flex flex-col">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-line pb-2">
                    <SideHead side="away" tri={tris.away} color={colors.away} gp={model.gp.away} minGp={minGp} pending={model.pending.away} tags={tags('away')} />
                    <span className="flex flex-col items-center gap-1 text-micro uppercase tracking-wide text-fg-3">
                        <SeasonTag>
                            {windowLabel}
                            <span className="sr-only"> regular season,</span>
                        </SeasonTag>
                        Rank
                    </span>
                    <SideHead side="home" tri={tris.home} color={colors.home} gp={model.gp.home} minGp={minGp} pending={model.pending.home} tags={tags('home')} />
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
            </div>

            <table className="sr-only">
                <caption>
                    {`League ranks, ${windowLabel} regular season${useLoc || useRest || useStarter || last !== 'all' ? ', filtered to each team’s situation tonight' : ''}. ${tris.away} ${model.gp.away} games, ${tris.home} ${model.gp.home} games.`}
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
                                    {r.cells[s].value == null ? 'no value' : `${r.stat.fmt(r.cells[s].value!)}, ${rankText(r.cells[s])}${smallSample(r.cells[s]) ? ', small sample' : ''}`}
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
