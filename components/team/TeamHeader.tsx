import * as React from 'react';
import Link from 'next/link';
import { PlayerLink } from '@/components/players/PlayerLink';
import { Crest } from '@/components/ui/crest';
import { SeasonTag, shortSeasonTag } from '@/components/ui/stat-chip';
import { WinBar } from '@/components/ui/win-bar';
import { cn } from '@/lib/utils';
import { recordString } from '@/utils/team-stats/calculate';
import { injuryCode, oddsPct, ordinal, shortDate } from '@/utils/team-stats/format';
import { DIVISION_LABEL } from '@/utils/team-stats/teams';
import type { GoalieLine, KpiSet, NextGame as NextGameData, TeamHero, TeamInjury } from '@/utils/team-stats/team-types';
import type { TeamMeta, TeamStat } from '@/utils/team-stats/types';
import { GOALIE_NAME, goalieOut, goalieState, goalieStatLine, orderGoalies } from './goalie-line';
import { LocalTime } from './LocalTime';
import { UpcomingPick } from './UpcomingPick';

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
    /** This season's last regular-season games, oldest first (up to ten). */
    form: FormGame[];
}

export interface FormGame {
    id: string;
    date: string;
    opp: string;
    home: boolean;
    /** RW / OTW / SOW / RL / OTL / SOL */
    result: string;
    gf: number;
    ga: number;
    xgf: number;
    xga: number;
}

type KpiKey = 'xgf_pct' | 'gf_pg' | 'ga_pg' | 'pp_pct' | 'pk_pct';
/** `low`: lower is better (the spread is drawn reversed, so better always sits to the right). */
const KPIS: { key: KpiKey; label: string; fmt: (v: number) => string; low?: boolean; model?: boolean }[] = [
    { key: 'xgf_pct', label: 'xGF%', fmt: v => v.toFixed(1), model: true },
    { key: 'gf_pg', label: 'GF/GP', fmt: v => v.toFixed(2) },
    { key: 'ga_pg', label: 'GA/GP', fmt: v => v.toFixed(2), low: true },
    { key: 'pp_pct', label: 'PP%', fmt: v => v.toFixed(1) },
    { key: 'pk_pct', label: 'PK%', fmt: v => v.toFixed(1) },
];

const SMALL_SAMPLE = 5;

const lastName = (n: string) => n.split(' ').slice(-1)[0];

/**
 * The team page hero, read top to bottom as "where are they, how are they
 * playing, what's next": big crest on a team-colour wash, the name, the
 * record as a scoreboard number with points, division place and playoff
 * odds; the form strip (last ten games, goal differential mirrored around a
 * baseline); the next game as a mini matchup. A KPI band places each number
 * in the league's spread (better always to the right) with its rank from
 * the first game (the GP notch marks a thin sample); then goalies, injuries (most immediate first, with
 * the reason) and moves. Server-rendered: this is the page's LCP content.
 */
export default function TeamHeader({ team, seasonLabel, standing, kpis, prevLabel, prevStanding, prevKpis, hero, goalies, form }: TeamHeaderProps) {
    const gp = standing?.gp ?? 0;
    const divRank = standing?.divRank && gp > 0 ? standing.divRank : null;
    const prevTag = shortSeasonTag(prevLabel);
    const small = gp > 0 && gp < SMALL_SAMPLE;
    const tandem = orderGoalies(goalies);
    const division = DIVISION_LABEL[team.division];
    const prior = gp === 0 && !!prevKpis;
    const set = gp > 0 ? kpis : prevKpis;

    return (
        <section
            aria-labelledby="team-title"
            className="panel team-wash overflow-hidden"
            style={{ '--ac': team.color, '--hc': 'transparent' } as React.CSSProperties}
        >
            <div className="grid gap-4 p-card md:grid-cols-[minmax(0,1fr)_auto] md:gap-6 md:p-5">
                {/* identity · standing · form */}
                {/* Phones: crest beside the name, the standing and form full width under them. */}
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 md:items-start md:gap-x-5">
                    <Crest tri={team.tri} size={128} priority className="h-[72px] w-[72px] shrink-0 md:row-span-2 md:h-32 md:w-32" />
                    <div>
                        <h1 id="team-title" className="text-balance break-words font-display text-[24px] font-bold uppercase leading-[1.02] tracking-[0.01em] text-fg-1 min-[400px]:text-[26px] md:text-[40px] md:leading-none">
                            {team.name}
                        </h1>
                        <p className="label mt-1.5">
                            {division} · {team.conference}
                        </p>
                    </div>
                    <div className="col-span-2 flex min-w-0 flex-col gap-2.5 md:col-span-1 md:col-start-2 md:gap-3">
                        <dl className="flex flex-wrap items-end gap-x-5 gap-y-2 md:gap-x-7">
                            <div>
                                <dt className="sr-only">{seasonLabel} record</dt>
                                <dd className="num-score text-[34px] leading-[0.9] text-fg-1 md:text-[52px]">{standing ? recordString(standing) : '0-0-0'}</dd>
                            </div>
                            <HeroStat value={standing?.points ?? 0} label="PTS" />
                            {divRank ? <HeroStat value={ordinal(divRank)} label={division.slice(0, 3)} /> : null}
                            {hero.playoffOdds ? <HeroStat value={oddsPct(hero.playoffOdds.pct)} label="Playoffs" tone="text-brand" /> : null}
                        </dl>
                        {gp === 0 && prevStanding ? (
                            <p className="flex items-center gap-1.5 text-micro uppercase tracking-wide text-fg-3">
                                <SeasonTag>{prevTag}</SeasonTag>
                                <span className="text-fg-2">{recordString(prevStanding)}</span>
                                <span>{prevStanding.points} PTS</span>
                                {prevStanding.divRank ? <span>{ordinal(prevStanding.divRank)}</span> : null}
                            </p>
                        ) : null}
                        {form.length ? <FormStrip games={form} tri={team.tri} /> : null}
                    </div>
                </div>

                <NextGame team={team} hero={hero} />
            </div>

            {/* KPI band: one row of numbers, each placed in the league's spread. A tiny sample, or last season's row
                before the opener, gets one muted notch on the band, not a tag on every number. */}
            <div className="relative border-t border-line">
                {small || prior ? (
                    <span data-small-sample={small ? '' : undefined} className="absolute right-card top-0 z-[1] flex -translate-y-1/2 md:right-5">
                        <SeasonTag className="bg-bg tabular-nums">
                            {small ? (
                                <>
                                    {gp} GP<span className="sr-only"> so far, small sample</span>
                                </>
                            ) : (
                                prevTag
                            )}
                        </SeasonTag>
                    </span>
                ) : null}
                <dl className="grid grid-cols-2 min-[480px]:grid-cols-3 md:grid-cols-5">
                    {KPIS.map((k, i) => {
                        const v = set ? set[k.key] : null;
                        const ranked = set ? set.ranks[k.key] : null;
                        return (
                            <div
                                key={k.key}
                                className={cn(
                                    'flex min-w-0 flex-col gap-1.5 border-line px-card py-3 md:px-5 md:py-4',
                                    // Hairlines between cells, wrapping cleanly at each breakpoint.
                                    'border-b md:border-b-0',
                                    i % 2 === 1 && 'border-l min-[480px]:border-l-0',
                                    i % 3 !== 0 && 'min-[480px]:border-l md:border-l-0',
                                    i > 0 && 'md:border-l',
                                    i === 4 && 'max-[479px]:col-span-2',
                                )}
                            >
                                <dt className="flex items-baseline justify-between gap-2 text-micro font-medium uppercase tracking-label text-fg-3">
                                    {k.label}
                                    {ranked ? (
                                        <span className={cn('tabular-nums tracking-normal', ranked <= 8 ? 'font-semibold text-fg-1' : 'text-fg-3')}>
                                            #{ranked}
                                            <span className="sr-only"> of {set?.league?.[k.key].length ?? 32}{prior ? `, ${prevLabel}` : ''}</span>
                                        </span>
                                    ) : null}
                                </dt>
                                <dd className={cn('font-display text-[24px] font-bold leading-none tabular-nums md:text-[30px]', v == null ? 'text-fg-3' : prior ? 'text-fg-2' : k.model ? 'text-model' : 'text-fg-1')}>
                                    {v != null ? k.fmt(v) : '—'}
                                    {prior ? <span className="sr-only"> ({prevLabel})</span> : null}
                                </dd>
                                {v != null && set?.league?.[k.key]?.length ? <Spread value={v} league={set.league[k.key]} low={k.low} color={team.color} fmt={k.fmt} dim={prior || small} /> : null}
                            </div>
                        );
                    })}
                </dl>
            </div>

            {/* goalies · injuries · moves */}
            <div className="grid gap-x-8 gap-y-4 border-t border-line p-card sm:grid-cols-2 md:p-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.5fr)_minmax(0,0.9fr)]">
                <div className="min-w-0">
                    <h2 className="label mb-2">Goalies</h2>
                    {tandem.length === 0 ? <p className="text-caption text-fg-3">—</p> : null}
                    <ul className="flex flex-col gap-2">
                        {tandem.map(g => {
                            const line = goalieStatLine(g.current, g.last);
                            const state = g.next ? goalieState(g.next.status) : null;
                            return (
                                <li key={g.id} className="min-w-0">
                                    <p className="flex items-baseline gap-2">
                                        <span className={cn('truncate font-display text-[15px] font-semibold uppercase leading-5', goalieOut(g) ? 'text-fg-3' : state ? GOALIE_NAME[state] : 'text-fg-2')}>
                                            <PlayerLink id={Number(g.id)}>{g.name}</PlayerLink>
                                        </span>
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

                <Injuries injuries={hero.injuries} />

                <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                    <h2 className="label mb-2">Moves</h2>
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

const WIN = new Set(['RW', 'OTW', 'SOW']);
const LATE = new Set(['OTW', 'SOW', 'OTL', 'SOL']);

/** "W2", "L1", "OT1": the current streak, overtime and shootout losses counted together. */
function streak(games: FormGame[]): string | null {
    const kind = (r: string) => (WIN.has(r) ? 'W' : r === 'RL' ? 'L' : 'OT');
    const last = games[games.length - 1];
    if (!last) return null;
    const k = kind(last.result);
    let n = 0;
    for (let i = games.length - 1; i >= 0 && kind(games[i].result) === k; i--) n++;
    return `${k}${n}`;
}

/**
 * The last ten games as a strip: a bar per game, up for a win and down for a loss, as tall as the goal margin
 * (an overtime or shootout result is a one-goal stub, drawn at half strength). Hover names the game.
 */
function FormStrip({ games, tri }: { games: FormGame[]; tri: string }) {
    const w = games.filter(g => WIN.has(g.result)).length;
    const otl = games.filter(g => g.result === 'OTL' || g.result === 'SOL').length;
    const s = streak(games);
    const max = Math.max(3, ...games.map(g => Math.abs(g.gf - g.ga)));
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <ol className="flex h-11 items-stretch gap-1 md:h-12" aria-label={`Last ${games.length} games`}>
                {games.map(g => {
                    const win = WIN.has(g.result);
                    const late = LATE.has(g.result);
                    const margin = late ? 1 : Math.max(1, Math.abs(g.gf - g.ga));
                    const h = `${Math.max(18, (margin / max) * 100)}%`;
                    const label = `${shortDate(g.date)} ${g.home ? 'vs' : 'at'} ${g.opp}: ${win ? 'W' : 'L'} ${g.gf}-${g.ga}${late ? (g.result.startsWith('SO') ? ' SO' : ' OT') : ''}, xG ${g.xgf.toFixed(1)}-${g.xga.toFixed(1)}`;
                    return (
                        <li key={g.id} className="group relative flex w-3 flex-col md:w-3.5">
                            <Link href={`/games/${g.id}`} aria-label={label} title={label} className="flex h-full w-full flex-col rounded-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                                <span className="flex flex-1 items-end">
                                    {win ? <span className={cn('w-full rounded-t-[2px] bg-pos transition-opacity group-hover:opacity-100', late ? 'opacity-50' : 'opacity-85')} style={{ height: h }} /> : null}
                                </span>
                                <span className="h-px w-full bg-line-strong" />
                                <span className="flex flex-1 items-start">
                                    {!win ? <span className={cn('w-full rounded-b-[2px] bg-neg transition-opacity group-hover:opacity-100', late ? 'opacity-50' : 'opacity-85')} style={{ height: h }} /> : null}
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ol>
            <p className="flex items-baseline gap-2 text-micro uppercase tracking-label text-fg-3">
                <span>L{games.length}</span>
                <span className="font-semibold tabular-nums tracking-normal text-fg-1">
                    {w}-{games.length - w - otl}-{otl}
                </span>
                {s ? (
                    <span className="tabular-nums tracking-normal">
                        · <span className={s.startsWith('W') ? 'text-pos' : 'text-fg-2'}>{s}</span>
                    </span>
                ) : null}
                <span className="sr-only">{tri} form</span>
            </p>
        </div>
    );
}

/**
 * Where a number sits among the league's: a hairline track with a tick per club, the league average as a
 * taller dim tick and this team as a team-colour pip; better always to the right.
 */
function Spread({ value, league, low, color, fmt, dim }: { value: number; league: number[]; low?: boolean; color: string; fmt: (v: number) => string; dim?: boolean }) {
    const lo = Math.min(value, ...league);
    const hi = Math.max(value, ...league);
    const span = hi - lo || 1;
    const x = (v: number) => {
        const t = (v - lo) / span;
        return `${(low ? 1 - t : t) * 100}%`;
    };
    const avg = league.reduce((a, v) => a + v, 0) / league.length;
    return (
        <div className="mt-0.5 flex flex-col gap-1">
            <div className={cn('relative h-3.5', dim && 'opacity-70')} aria-hidden="true">
                <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
                {league.map((v, i) => (
                    <span key={i} className="absolute top-1/2 h-1.5 w-px -translate-x-1/2 -translate-y-1/2 bg-fg-3/35" style={{ left: x(v) }} />
                ))}
                <span className="absolute top-0 h-full w-px -translate-x-1/2 bg-fg-2/70" style={{ left: x(avg) }} />
                <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg" style={{ left: x(value), background: color, boxShadow: '0 0 0 1px rgb(var(--text-1-rgb, 232 238 248) / 0.55)' }} />
            </div>
            <span className="text-micro tabular-nums text-fg-3">
                Lg {fmt(avg)}
                <span className="sr-only"> league average; better is {low ? 'lower' : 'higher'}</span>
            </span>
        </div>
    );
}

/**
 * Injuries, most immediate first (who dressed in the last two games, then by role): name and position, the
 * status and expected return, then why (body part, illness, personal) and the report's note.
 */
function Injuries({ injuries }: { injuries: TeamInjury[] }) {
    const shown = injuries.slice(0, 6);
    return (
        <div className="min-w-0">
            <h2 className="label mb-2">
                Injuries {injuries.length ? <span className="text-fg-2">{injuries.length}</span> : null}
            </h2>
            {injuries.length === 0 ? (
                <p className="text-caption text-fg-3">—</p>
            ) : (
                <ul className="flex flex-col divide-y divide-line/70">
                    {shown.map(i => (
                        <li key={i.name} className="flex min-w-0 flex-col gap-0.5 py-1.5 first:pt-0">
                            <p className="flex items-baseline justify-between gap-3 text-caption">
                                <span className="flex min-w-0 items-baseline gap-1.5">
                                    {i.recent ? (
                                        <span className="h-1.5 w-1.5 shrink-0 -translate-y-px self-center rounded-full bg-warn" title="Dressed in one of the last two games">
                                            <span className="sr-only">Recently in the lineup.</span>
                                        </span>
                                    ) : null}
                                    <span className="truncate text-fg-1">{i.id ? <PlayerLink id={i.id}>{i.name}</PlayerLink> : i.name}</span>
                                    <span className="shrink-0 text-fg-3">{i.pos}</span>
                                </span>
                                <span className="shrink-0 text-micro uppercase tabular-nums">
                                    <span className="font-bold text-neg" title={i.status}>
                                        {injuryCode(i.status)}
                                    </span>
                                    {i.returnDate ? <span className="ml-1.5 text-fg-3">{shortDate(i.returnDate)}</span> : null}
                                </span>
                            </p>
                            {i.type || i.note ? (
                                <p className="line-clamp-2 text-micro leading-4 text-fg-3" title={i.note ?? undefined}>
                                    {i.type ? <span className="font-semibold uppercase tracking-wide text-fg-2">{i.type}</span> : null}
                                    {i.type && i.note ? <span aria-hidden="true"> · </span> : null}
                                    {i.note}
                                </p>
                            ) : null}
                        </li>
                    ))}
                    {injuries.length > shown.length ? <li className="pt-1.5 text-micro text-fg-3">+{injuries.length - shown.length} more</li> : null}
                </ul>
            )}
        </div>
    );
}

function HeroStat({ value, label, tone = 'text-fg-1' }: { value: React.ReactNode; label: string; tone?: string }) {
    return (
        <div className="flex flex-col leading-none">
            <dt className="label order-2 mt-1.5">{label}</dt>
            <dd className={cn('order-1 font-display text-[22px] font-bold tabular-nums md:text-[28px]', tone)}>{value}</dd>
        </div>
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

/** The next game as a mini matchup (the browser skips games that are already over). */
function NextGame({ team, hero }: { team: TeamMeta; hero: TeamHero }) {
    const none = (
        <div className="tile flex min-w-0 items-center justify-between bg-bg/40 md:w-[400px] md:self-start">
            <span className="label">Next</span>
            <span className="text-caption text-fg-3">—</span>
        </div>
    );
    return (
        <UpcomingPick starts={hero.nextGames.map(g => g.startTimeUTC)} none={none}>
            {hero.nextGames.map(g => (
                <NextGameTile key={`${g.date}-${g.opp}`} team={team} g={g} />
            ))}
        </UpcomingPick>
    );
}

/** One game as a mini matchup: time, both crests with the named goalies, the forecast bar. */
function NextGameTile({ team, g }: { team: TeamMeta; g: NextGameData }) {
    const away = g.home ? g.opp : team.tri;
    const home = g.home ? team.tri : g.opp;
    const awayG = g.home ? g.oppGoalie : g.goalie;
    const homeG = g.home ? g.goalie : g.oppGoalie;
    const p = g.modelWinPct == null ? null : g.modelWinPct / 100;
    const pAway = p == null ? null : g.home ? 1 - p : p;
    return (
        <Link
            href={g.href}
            className="tile panel-hover flex min-w-0 flex-col justify-between gap-3 bg-bg/40 p-3.5 transition-colors hover:border-line-strong md:w-[400px] md:self-stretch md:p-4"
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
                <Crest tri={away} size={44} className="h-11 w-11" />
                <GoalieName side={awayG} tri={away} />
                <span className="text-micro text-fg-3">@</span>
                <GoalieName side={homeG} tri={home} right />
                <Crest tri={home} size={44} className="h-11 w-11" />
            </span>
            {pAway != null ? <WinBar away={away} home={home} pAway={pAway} size="md" label="Forecast" /> : null}
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
