import * as React from 'react';
import Link from 'next/link';
import { Crest } from '@/components/ui/crest';
import { SeasonTag, shortSeasonTag } from '@/components/ui/stat-chip';
import { WinBar } from '@/components/ui/win-bar';
import { cn } from '@/lib/utils';
import { recordString } from '@/utils/team-stats/calculate';
import { ordinal, shortDate } from '@/utils/team-stats/format';
import { DIVISION_LABEL } from '@/utils/team-stats/teams';
import type { GoalieLine, KpiSet, TeamHero } from '@/utils/team-stats/team-types';
import type { TeamMeta, TeamStat } from '@/utils/team-stats/types';
import { GOALIE_NAME, goalieState, goalieStatLine } from './goalie-line';
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

type KpiKey = 'xgf_pct' | 'gf_pg' | 'ga_pg' | 'pp_pct' | 'pk_pct';
const KPIS: { key: KpiKey; label: string; fmt: (v: number) => string }[] = [
    { key: 'xgf_pct', label: 'xGF%', fmt: v => v.toFixed(1) },
    { key: 'gf_pg', label: 'GF/GP', fmt: v => v.toFixed(2) },
    { key: 'ga_pg', label: 'GA/GP', fmt: v => v.toFixed(2) },
    { key: 'pp_pct', label: 'PP%', fmt: v => v.toFixed(1) },
    { key: 'pk_pct', label: 'PK%', fmt: v => v.toFixed(1) },
];

const SMALL_SAMPLE = 5;

/** "Injured Reserve" → "IR" etc.; anything else uppercased as-is. */
function injuryCode(status: string): string {
    const s = status.toLowerCase();
    if (s.includes('long') && s.includes('reserve')) return 'LTIR';
    if (s.includes('reserve')) return 'IR';
    if (s.includes('day')) return 'DTD';
    if (s.includes('suspen')) return 'SUSP';
    return status.toUpperCase();
}

const lastName = (n: string) => n.split(' ').slice(-1)[0];

/**
 * The team page hero: big crest on a team-colour wash, the name, the record as
 * a scoreboard number, the next game as a mini matchup (win bar + goalies),
 * five KPI tiles with league rank, then goalies / injuries / moves as dense
 * lists. Server-rendered: this is the page's LCP content.
 */
export default function TeamHeader({ team, seasonLabel, standing, kpis, prevLabel, prevStanding, prevKpis, hero, goalies }: TeamHeaderProps) {
    const gp = standing?.gp ?? 0;
    const divRank = standing?.divRank && gp > 0 ? standing.divRank : null;
    const prevTag = shortSeasonTag(prevLabel);
    const small = gp > 0 && gp < SMALL_SAMPLE;
    const tandem = goalies
        .map(g => ({ g, starts: g.current?.gs ?? 0, lastStarts: g.last?.gs ?? 0 }))
        .sort((a, b) => b.starts - a.starts || b.lastStarts - a.lastStarts)
        .map(t => t.g);
    const division = DIVISION_LABEL[team.division];

    return (
        <section
            aria-labelledby="team-title"
            className="panel team-wash overflow-hidden"
            style={{ '--ac': team.color, '--hc': 'transparent' } as React.CSSProperties}
        >
            <div className="flex flex-col gap-3 p-card md:flex-row md:items-stretch md:gap-5">
                {/* identity + record */}
                <div className="flex min-w-0 flex-1 items-center gap-3 md:gap-5">
                    <Crest tri={team.tri} size={96} priority className="h-16 w-16 md:h-24 md:w-24" />
                    <div className="min-w-0">
                        <h1 id="team-title" className="truncate font-display text-[24px] font-bold uppercase leading-none tracking-[0.01em] text-fg-1 md:text-[34px]">
                            {team.name}
                        </h1>
                        <p className="label mt-1.5">
                            {division} · {team.conference}
                        </p>
                        <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-1">
                            <p className="num-score text-[30px] leading-none text-fg-1 md:text-[40px]">
                                {standing ? recordString(standing) : '0-0-0'}
                                <span className="sr-only"> {seasonLabel} record</span>
                            </p>
                            <HeroStat value={standing?.points ?? 0} label="PTS" />
                            {divRank ? <HeroStat value={ordinal(divRank)} label={division.slice(0, 3)} /> : null}
                            {hero.playoffOdds ? <HeroStat value={`${hero.playoffOdds.pct.toFixed(0)}%`} label="Playoffs" tone="text-brand" /> : null}
                        </div>
                        {gp === 0 && prevStanding ? (
                            <p className="mt-1.5 flex items-center gap-1.5 text-micro uppercase tracking-wide text-fg-3">
                                <SeasonTag>{prevTag}</SeasonTag>
                                <span className="text-fg-2">{recordString(prevStanding)}</span>
                                <span>{prevStanding.points} PTS</span>
                                {prevStanding.divRank ? <span>{ordinal(prevStanding.divRank)}</span> : null}
                            </p>
                        ) : null}
                    </div>
                </div>

                <NextGame team={team} hero={hero} />
            </div>

            {/* KPI tiles */}
            <dl className="grid grid-cols-5 gap-1.5 px-card pb-card md:gap-2">
                {KPIS.map(k => {
                    const cur = kpis && gp > 0 ? kpis[k.key] : null;
                    const prev = gp === 0 && prevKpis ? prevKpis[k.key] : null;
                    const rank = cur != null ? (kpis?.ranked ? kpis.ranks[k.key] : null) : prev != null ? prevKpis!.ranks[k.key] : null;
                    return (
                        <div key={k.key} className={cn('tile min-w-0 bg-bg/40 px-2 py-1.5 md:px-3 md:py-2', small && 'border-dashed border-warn/45')}>
                            <dt className="flex items-center gap-1 truncate text-micro font-medium uppercase tracking-[0.1em] text-fg-3 md:tracking-label">
                                {k.label}
                                {prev != null ? <SeasonTag className="hidden md:inline-flex">{prevTag}</SeasonTag> : null}
                            </dt>
                            <dd className={cn('font-display text-[17px] font-bold leading-6 tabular-nums md:text-[22px] md:leading-7', cur != null ? 'text-fg-1' : 'text-fg-3')}>
                                {cur != null ? k.fmt(cur) : prev != null ? k.fmt(prev) : '—'}
                                {prev != null ? <span className="sr-only"> ({prevLabel})</span> : null}
                            </dd>
                            <dd className="truncate text-micro tabular-nums text-fg-3">
                                {small ? (
                                    <span className="text-warn">
                                        {gp} GP<span className="sr-only"> (small sample)</span>
                                    </span>
                                ) : rank ? (
                                    <>
                                        #{rank}
                                        {prev != null ? <span className="md:hidden"> {prevTag}</span> : null}
                                    </>
                                ) : (
                                    ' '
                                )}
                            </dd>
                        </div>
                    );
                })}
            </dl>

            {/* goalies · injuries · moves */}
            <div className="grid gap-x-6 gap-y-3 border-t border-line p-card sm:grid-cols-2 lg:grid-cols-3">
                <div className="min-w-0">
                    <h2 className="label mb-1.5">Goalies</h2>
                    {tandem.length === 0 ? <p className="text-caption text-fg-3">—</p> : null}
                    <ul className="flex flex-col gap-1">
                        {tandem.map(g => {
                            const line = goalieStatLine(g.current, g.last);
                            const state = g.next ? goalieState(g.next.status) : null;
                            return (
                                <li key={g.id} className="min-w-0">
                                    <p className="flex items-baseline gap-2">
                                        <span className={cn('truncate font-display text-[15px] font-semibold uppercase leading-5', state ? GOALIE_NAME[state] : 'text-fg-2')}>{g.name}</span>
                                        {g.number != null ? <span className="text-micro text-fg-3">#{g.number}</span> : null}
                                        {g.injury ? <span className="text-micro font-bold text-neg">{injuryCode(g.injury.status)}</span> : null}
                                        {g.next ? <span className="sr-only"> next start {g.next.status}</span> : null}
                                    </p>
                                    <p className="flex items-center gap-1.5 text-micro text-fg-3">
                                        {line ? (
                                            <>
                                                <span className="tabular-nums">{line.text}</span>
                                                {line.prior ? <SeasonTag>{prevTag}</SeasonTag> : null}
                                            </>
                                        ) : (
                                            <span>0 GP</span>
                                        )}
                                    </p>
                                </li>
                            );
                        })}
                    </ul>
                </div>

                <div className="min-w-0">
                    <h2 className="label mb-1.5">
                        Injuries {hero.injuries.length ? <span className="text-fg-2">{hero.injuries.length}</span> : null}
                    </h2>
                    {hero.injuries.length === 0 ? (
                        <p className="text-caption text-fg-3">—</p>
                    ) : (
                        <ul className="flex flex-wrap gap-x-3 gap-y-1 sm:flex-col sm:flex-nowrap sm:gap-0">
                            {hero.injuries.slice(0, 6).map(i => (
                                <li key={i.name} className="flex items-baseline gap-1.5 text-caption sm:h-5 sm:items-center sm:justify-between sm:gap-2">
                                    <span className="min-w-0 truncate text-fg-1">
                                        <span className="sm:hidden">{lastName(i.name)}</span>
                                        <span className="hidden sm:inline">{i.name}</span> <span className="text-fg-3">{i.pos}</span>
                                    </span>
                                    <span className="shrink-0 text-micro uppercase tabular-nums">
                                        <span className="font-bold text-neg">{injuryCode(i.status)}</span>
                                        {i.returnDate ? <span className="ml-1.5 text-fg-3">{shortDate(i.returnDate)}</span> : null}
                                    </span>
                                </li>
                            ))}
                            {hero.injuries.length > 6 ? <li className="text-micro text-fg-3">+{hero.injuries.length - 6}</li> : null}
                        </ul>
                    )}
                </div>

                <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                    <h2 className="label mb-1.5">Moves</h2>
                    {hero.rosterChanges && (hero.rosterChanges.added.length || hero.rosterChanges.lost.length) ? (
                        <dl className="flex flex-col gap-1.5 text-caption">
                            <MoveRow tone="text-pos" label="In" people={hero.rosterChanges.added.map(p => ({ name: p.name, team: p.from }))} />
                            <MoveRow tone="text-neg" label="Out" people={hero.rosterChanges.lost.map(p => ({ name: p.name, team: p.to }))} />
                        </dl>
                    ) : (
                        <p className="text-caption text-fg-3">—</p>
                    )}
                </div>
            </div>
        </section>
    );
}

function HeroStat({ value, label, tone = 'text-fg-1' }: { value: React.ReactNode; label: string; tone?: string }) {
    return (
        <p className="flex flex-col leading-none">
            <span className={cn('font-display text-[20px] font-bold tabular-nums md:text-[22px]', tone)}>{value}</span>
            <span className="label mt-1">{label}</span>
        </p>
    );
}

function MoveRow({ label, tone, people }: { label: string; tone: string; people: { name: string; team: string | null }[] }) {
    return (
        <div className="flex gap-2">
            <dt className={cn('w-7 shrink-0 text-micro font-bold uppercase leading-4 tracking-wide', tone)}>{label}</dt>
            <dd className="min-w-0 leading-4 text-fg-1">
                {people.length === 0 ? (
                    <span className="text-fg-3">—</span>
                ) : (
                    people.slice(0, 8).map((p, i) => (
                        <span key={`${p.name}-${i}`} className="mr-2.5 inline-block whitespace-nowrap">
                            {lastName(p.name)}
                            {p.team ? <span className="ml-1 text-micro text-fg-3">{p.team}</span> : null}
                        </span>
                    ))
                )}
                {people.length > 8 ? <span className="text-micro text-fg-3">+{people.length - 8}</span> : null}
            </dd>
        </div>
    );
}

/** The next game as a mini matchup: time, both crests with the named goalies, the forecast bar. */
function NextGame({ team, hero }: { team: TeamMeta; hero: TeamHero }) {
    const g = hero.nextGame;
    if (!g) {
        return (
            <div className="tile flex min-w-0 items-center justify-between bg-bg/40 md:w-[380px]">
                <span className="label">Next</span>
                <span className="text-caption text-fg-3">—</span>
            </div>
        );
    }
    const away = g.home ? g.opp : team.tri;
    const home = g.home ? team.tri : g.opp;
    const awayG = g.home ? g.oppGoalie : g.goalie;
    const homeG = g.home ? g.goalie : g.oppGoalie;
    const p = g.modelWinPct == null ? null : g.modelWinPct / 100;
    const pAway = p == null ? null : g.home ? 1 - p : p;
    return (
        <Link
            href={g.href}
            className="tile panel-hover flex min-w-0 flex-col gap-2 bg-bg/40 transition-colors hover:border-line-strong md:w-[380px]"
            aria-label={`Next game: ${g.home ? 'vs' : 'at'} ${g.opp}`}
        >
            <span className="flex items-center justify-between gap-2">
                <span className="label text-brand">Next</span>
                <span className="flex items-center gap-2 text-micro uppercase tracking-[0.14em] text-fg-1">
                    {g.startTimeUTC ? <LocalTime utc={g.startTimeUTC} /> : shortDate(g.date)}
                    {g.tv ? <span className="rounded-chip border border-line px-1.5 text-fg-3">{g.tv}</span> : null}
                </span>
            </span>
            <span className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2">
                <Crest tri={away} size={36} />
                <GoalieName side={awayG} tri={away} />
                <span className="text-micro text-fg-3">@</span>
                <GoalieName side={homeG} tri={home} right />
                <Crest tri={home} size={36} />
            </span>
            {pAway != null ? <WinBar away={away} home={home} pAway={pAway} size="sm" label="Forecast" /> : null}
        </Link>
    );
}

function GoalieName({ side, tri, right }: { side: { name: string; status: string } | null; tri: string; right?: boolean }) {
    return (
        <span className={cn('min-w-0 truncate font-display text-[14px] font-semibold uppercase', right && 'text-right')}>
            {side ? (
                <span className={GOALIE_NAME[goalieState(side.status)]}>
                    {lastName(side.name)}
                    <span className="sr-only"> ({side.status})</span>
                </span>
            ) : (
                <span className="text-fg-3">{tri}</span>
            )}
        </span>
    );
}
