import * as React from 'react';
import Link from 'next/link';
import { InfoTip } from '@/components/ui/info-tip';
import { cn } from '@/lib/utils';
import { recordString } from '@/utils/team-stats/calculate';
import { ordinal, shortDate } from '@/utils/team-stats/format';
import { DIVISION_LABEL } from '@/utils/team-stats/teams';
import type { GoalieLine, KpiSet, TeamHero } from '@/utils/team-stats/team-types';
import type { TeamMeta, TeamStat } from '@/utils/team-stats/types';
import { LocalTime } from './LocalTime';

interface TeamHeaderProps {
    team: TeamMeta;
    seasonLabel: string;
    standing: TeamStat | null;
    kpis: KpiSet | null;
    /** Last season, for context while this season has no games. */
    prevLabel: string;
    prevStanding: TeamStat | null;
    prevKpis: KpiSet | null;
    hero: TeamHero;
    goalies: GoalieLine[];
}

const pctText = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}%`);

/**
 * The team page hero: identity and record first, then tonight's (or the next)
 * game with the model's number, KPI tiles with league ranks and sample size,
 * playoff odds, the goalie tandem and who is hurt. Server-rendered so it is
 * the page's first (LCP) content.
 */
export default function TeamHeader({ team, seasonLabel, standing, kpis, prevLabel, prevStanding, prevKpis, hero, goalies }: TeamHeaderProps) {
    const gp = standing?.gp ?? 0;
    const divRank = standing?.divRank && gp > 0 ? standing.divRank : null;
    const showPrev = gp === 0 && prevStanding;
    const tiles: { label: string; tip?: React.ComponentProps<typeof InfoTip>['term']; value: string; rank?: number; sub: string; prev?: string }[] = [
        {
            label: 'xGF%',
            tip: 'xg',
            value: kpis ? pctText(kpis.xgf_pct) : '—',
            rank: kpis?.ranked ? kpis.ranks.xgf_pct : undefined,
            sub: kpis ? `${gp} GP` : 'No games yet',
            prev: prevKpis ? `${pctText(prevKpis.xgf_pct)} (#${prevKpis.ranks.xgf_pct})` : undefined,
        },
        {
            label: 'Goals for / GP',
            value: kpis ? kpis.gf_pg.toFixed(2) : '—',
            rank: kpis?.ranked ? kpis.ranks.gf_pg : undefined,
            sub: kpis ? `${gp} GP` : 'No games yet',
            prev: prevKpis ? `${prevKpis.gf_pg.toFixed(2)} (#${prevKpis.ranks.gf_pg})` : undefined,
        },
        {
            label: 'Goals against / GP',
            value: kpis ? kpis.ga_pg.toFixed(2) : '—',
            rank: kpis?.ranked ? kpis.ranks.ga_pg : undefined,
            sub: kpis ? `${gp} GP` : 'No games yet',
            prev: prevKpis ? `${prevKpis.ga_pg.toFixed(2)} (#${prevKpis.ranks.ga_pg})` : undefined,
        },
        {
            label: 'Power play',
            tip: 'pp-pk',
            value: kpis ? pctText(kpis.pp_pct) : '—',
            rank: kpis?.ranked ? kpis.ranks.pp_pct : undefined,
            sub: kpis ? `${kpis.pp_opps} chances` : 'No games yet',
            prev: prevKpis ? `${pctText(prevKpis.pp_pct)} (#${prevKpis.ranks.pp_pct})` : undefined,
        },
        {
            label: 'Penalty kill',
            tip: 'pp-pk',
            value: kpis ? pctText(kpis.pk_pct) : '—',
            rank: kpis?.ranked ? kpis.ranks.pk_pct : undefined,
            sub: kpis ? `${kpis.pk_opps} times shorthanded` : 'No games yet',
            prev: prevKpis ? `${pctText(prevKpis.pk_pct)} (#${prevKpis.ranks.pk_pct})` : undefined,
        },
    ];
    const small = gp > 0 && gp < 5;
    const tandem = goalies
        .map(g => ({ g, starts: g.current?.gs ?? 0, lastStarts: g.last?.gs ?? 0 }))
        .sort((a, b) => b.starts - a.starts || b.lastStarts - a.lastStarts);

    return (
        <section aria-labelledby="team-title" className="relative isolate overflow-hidden rounded-card border border-line bg-surface-1 shadow-card">
            {/* team-colour wash */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-10"
                style={{
                    background: `radial-gradient(120% 90% at 0% 0%, ${team.color}38 0%, transparent 55%), radial-gradient(80% 70% at 100% 0%, ${team.color}14 0%, transparent 60%)`,
                }}
            />
            <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 -z-10 h-56 w-56 opacity-[0.07] md:h-80 md:w-80">
                {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo; next/image is a client component and ships ~6KB of JS for no optimisation */}
                <img src={`/logos/${team.tri}.svg`} alt="" className="absolute inset-0 h-full w-full object-contain" decoding="async" />
            </div>

            <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,380px)] md:gap-6 md:p-6">
                {/* identity + record */}
                <div className="min-w-0">
                    <div className="flex items-center gap-3 md:gap-4">
                        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo; next/image is a client component and ships ~6KB of JS for no optimisation */}
                        <img src={`/logos/${team.tri}.svg`} alt="" width={64} height={64} fetchPriority="high" className="h-12 w-12 shrink-0 object-contain md:h-16 md:w-16" />
                        <div className="min-w-0">
                            <h1 id="team-title" className="truncate text-h2 font-black tracking-tight text-fg-1 md:text-display">
                                {team.name}
                            </h1>
                            <p className="text-body-sm text-fg-2">
                                {DIVISION_LABEL[team.division]} Division · {team.conference} Conference
                            </p>
                        </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2">
                        <div>
                            <p className="hud-label">{seasonLabel} record</p>
                            <p className="text-hero font-black tabular-nums text-fg-1">
                                {standing ? recordString(standing) : '0-0-0'}
                            </p>
                        </div>
                        <div className="pb-1">
                            <p className="text-title font-bold tabular-nums text-fg-1">
                                {standing?.points ?? 0} <span className="text-body-sm font-semibold text-fg-2">PTS</span>
                            </p>
                            <p className="text-caption text-fg-2">
                                {divRank ? `${ordinal(divRank)} in the ${DIVISION_LABEL[team.division]}` : gp === 0 ? 'Season opener ahead' : ''}
                                {gp > 0 ? ` · ${gp} GP` : ''}
                            </p>
                        </div>
                        {hero.playoffOdds ? (
                            <div className="pb-1">
                                <p className="flex items-center gap-1 text-caption text-fg-2">
                                    Playoff odds <InfoTip term="playoff-odds" />
                                </p>
                                <p className="text-title font-bold tabular-nums text-brand">{hero.playoffOdds.pct.toFixed(0)}%</p>
                            </div>
                        ) : null}
                    </div>
                    {showPrev ? (
                        <p className="mt-2 text-caption text-fg-3">
                            <span className="mr-1 rounded-[3px] bg-fg-3/15 px-1 font-mono text-micro font-semibold text-fg-2">{prevLabel}</span>
                            Last season {recordString(prevStanding!)}, {prevStanding!.points} PTS
                            {prevStanding!.divRank ? `, ${ordinal(prevStanding!.divRank)} in the division` : ''}.
                        </p>
                    ) : null}
                    {small ? (
                        <p className="mt-2 inline-flex items-center gap-1 rounded-chip border border-dashed border-warn/50 px-2 py-0.5 text-caption text-fg-2">
                            Through {gp} {gp === 1 ? 'game' : 'games'}: small samples <InfoTip term="small-sample" />
                        </p>
                    ) : null}
                </div>

                {/* next game */}
                <NextGameCard team={team} hero={hero} />
            </div>

            {/* KPI tiles */}
            <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
                {tiles.map(t => (
                    <div key={t.label} className="flex min-w-0 flex-col gap-0.5 bg-surface-1 px-4 py-3">
                        <p className="flex min-h-6 items-center gap-1 text-caption text-fg-2 coarse:min-h-11">
                            {t.label}
                            {t.tip ? <InfoTip term={t.tip} /> : null}
                        </p>
                        <p className={cn('text-title font-bold tabular-nums', t.value === '—' ? 'text-fg-3' : 'text-fg-1')}>
                            {t.value}
                            {t.rank ? <span className="ml-1.5 text-caption font-semibold text-fg-2">#{t.rank}</span> : null}
                        </p>
                        {t.rank ? <RankBar rank={t.rank} /> : null}
                        <p className="text-micro text-fg-3">
                            {t.sub}
                            {small ? ' · small sample' : ''}
                        </p>
                        {gp === 0 && t.prev ? (
                            <p className="text-micro text-fg-3">
                                <span className="font-mono font-semibold text-fg-2">{prevLabel}</span> {t.prev}
                            </p>
                        ) : null}
                    </div>
                ))}
                {/* odd count filler on 2-col phones */}
                <div aria-hidden="true" className="bg-surface-1 sm:hidden" />
            </div>

            {/* goalies · injuries · roster moves */}
            <div className="grid gap-4 border-t border-line p-4 md:grid-cols-3 md:p-6">
                <div>
                    <h2 className="hud-label mb-2">Goalies</h2>
                    <ul className="space-y-1.5">
                        {tandem.length === 0 ? <li className="text-body-sm text-fg-3">No goalies listed.</li> : null}
                        {tandem.map(({ g }) => (
                            <li key={g.id} className="flex items-baseline justify-between gap-2 text-body-sm">
                                <span className="truncate text-fg-1">
                                    {g.name}
                                    {g.injury ? <span className="ml-1 text-caption text-neg">({g.injury.status})</span> : null}
                                </span>
                                <span className="shrink-0 text-caption tabular-nums text-fg-2">
                                    {g.current && g.current.gs > 0
                                        ? `${g.current.gs} GS`
                                        : g.last && g.last.gp > 0
                                          ? `${prevLabel}: ${g.last.gp} GP`
                                          : 'No NHL games last season'}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
                <div>
                    <h2 className="hud-label mb-2">Injuries</h2>
                    {hero.injuries.length === 0 ? (
                        <p className="text-body-sm text-fg-3">None reported.</p>
                    ) : (
                        <ul className="space-y-1.5">
                            {hero.injuries.slice(0, 6).map(i => (
                                <li key={i.name} className="flex items-baseline justify-between gap-2 text-body-sm">
                                    <span className="truncate text-fg-1">
                                        {i.name} <span className="text-caption text-fg-3">{i.pos}</span>
                                    </span>
                                    <span className="shrink-0 text-caption text-fg-2">
                                        {i.status}
                                        {i.returnDate ? ` · ~${shortDate(i.returnDate)}` : ''}
                                    </span>
                                </li>
                            ))}
                            {hero.injuries.length > 6 ? <li className="text-caption text-fg-3">+{hero.injuries.length - 6} more</li> : null}
                        </ul>
                    )}
                </div>
                <div>
                    <h2 className="hud-label mb-2">Offseason moves</h2>
                    {hero.rosterChanges && (hero.rosterChanges.added.length || hero.rosterChanges.lost.length) ? (
                        <dl className="space-y-1.5 text-body-sm">
                            <div>
                                <dt className="inline font-semibold text-pos">In </dt>
                                <dd className="inline text-fg-1">
                                    {hero.rosterChanges.added.length
                                        ? hero.rosterChanges.added
                                              .slice(0, 6)
                                              .map(p => `${p.name}${p.from ? ` (${p.from})` : ''}`)
                                              .join(', ')
                                        : 'None'}
                                    {hero.rosterChanges.added.length > 6 ? ` +${hero.rosterChanges.added.length - 6}` : ''}
                                </dd>
                            </div>
                            <div>
                                <dt className="inline font-semibold text-neg">Out </dt>
                                <dd className="inline text-fg-1">
                                    {hero.rosterChanges.lost.length
                                        ? hero.rosterChanges.lost
                                              .slice(0, 6)
                                              .map(p => `${p.name}${p.to ? ` (${p.to})` : ''}`)
                                              .join(', ')
                                        : 'None'}
                                    {hero.rosterChanges.lost.length > 6 ? ` +${hero.rosterChanges.lost.length - 6}` : ''}
                                </dd>
                            </div>
                        </dl>
                    ) : (
                        <p className="text-body-sm text-fg-3">No roster changes recorded.</p>
                    )}
                </div>
            </div>
        </section>
    );
}

function RankBar({ rank, of = 32 }: { rank: number; of?: number }) {
    const pct = Math.max(6, (1 - (rank - 1) / (of - 1)) * 100);
    return (
        <span aria-hidden="true" className="mt-0.5 block h-1 w-full max-w-[120px] overflow-hidden rounded-full bg-fg-3/20">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </span>
    );
}

function NextGameCard({ team, hero }: { team: TeamMeta; hero: TeamHero }) {
    const g = hero.nextGame;
    if (!g) {
        return (
            <div className="flex flex-col justify-center rounded-control border border-line bg-surface-2/60 p-4">
                <p className="hud-label">Next game</p>
                <p className="mt-1 text-body-sm text-fg-2">No upcoming game in the schedule feed.</p>
            </div>
        );
    }
    const pct = g.modelWinPct;
    return (
        <div className="flex flex-col gap-3 rounded-control border border-line-strong bg-surface-2/70 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-2">
                <p className="hud-label text-brand">Next game</p>
                {g.tv ? <span className="text-micro text-fg-3">{g.tv}</span> : null}
            </div>
            <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo; next/image is a client component and ships ~6KB of JS for no optimisation */}
                <img src={`/logos/${g.opp}.svg`} alt="" width={40} height={40} decoding="async" className="h-10 w-10 shrink-0 object-contain" />
                <div className="min-w-0">
                    <p className="text-title font-bold text-fg-1">
                        {g.home ? 'vs' : '@'} {g.opp}
                    </p>
                    <p className="text-caption text-fg-2">
                        {g.startTimeUTC ? <LocalTime utc={g.startTimeUTC} /> : shortDate(g.date)}
                    </p>
                </div>
                <div className="ml-auto text-right">
                    <p className="text-micro text-fg-3">Model win</p>
                    <p className={cn('text-title font-black tabular-nums', pct == null ? 'text-fg-3' : pct >= 50 ? 'text-pos' : 'text-fg-1')}>
                        {pct == null ? '—' : `${pct.toFixed(0)}%`}
                    </p>
                </div>
            </div>
            {pct != null ? (
                <div aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-fg-3/20">
                    <span className="block h-full" style={{ width: `${pct}%`, background: team.color }} />
                </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 text-caption">
                <span className="text-fg-2">
                    Goalie:{' '}
                    {g.goalie ? (
                        <>
                            <span className="text-fg-1">{g.goalie.name}</span>{' '}
                            <span className={cn(g.goalie.status.toLowerCase().includes('confirm') && !g.goalie.status.toLowerCase().includes('un') ? 'text-pos' : 'text-warn')}>
                                ({g.goalie.status})
                            </span>
                        </>
                    ) : (
                        <span className="text-fg-3">not announced</span>
                    )}
                </span>
                <Link href={g.href} className="inline-flex min-h-9 items-center gap-1 rounded-control px-2 font-semibold text-brand hover:underline coarse:min-h-11">
                    Matchup <span aria-hidden="true">→</span>
                </Link>
            </div>
        </div>
    );
}
