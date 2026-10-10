'use client';

import * as React from 'react';
import Link from 'next/link';
import { Crest } from '@/components/ui/crest';
import { teamPalette } from '@/components/ui/team-color';
import { cn } from '@/lib/utils';
import { LAST_EVENTS, S, SHOT_TYPES, type ShotFile, type ShotRow } from '@/lib/shots';

/**
 * The 3D shot maps' shot card: it sits beside the rink (under it on a phone)
 * and tells the hovered or tapped shot's whole story, top to bottom: the game
 * it came in (opponent, date, how it ended), the moment (period, clock, score,
 * strength), the matchup (shooter against goalie, faces on), the shot (result,
 * xG, where from with distance and angle, type) and what led to it. With
 * nothing picked it shows the map's summary.
 */

export interface ShotPerson {
    name: string;
    href: string | null;
    headshot: string | null;
    team: string | null;
}

export interface ShotInfo {
    result: 'goal' | 'saved' | 'missed';
    xg: number;
    /** Feet, turned toward the net at x = +89; y across the ice. */
    x: number;
    y: number;
    type: string | null;
    rebound?: boolean;
    /** "5v4", "Power play", "Even". */
    strength: string | null;
    period: number | null;
    /** Seconds into the period, or the clock as the feed writes it ("11:46"). */
    clock: number | string | null;
    /** The shooting team's lead before the shot. */
    lead: number | null;
    /** What came just before: "giveaway", 3 (seconds). */
    before: { what: string; secs: number } | null;
    game: { href: string | null; date: string | null; opp: string | null; home: boolean | null; gf: number | null; ga: number | null; outcome: string | null } | null;
    shooter: ShotPerson | null;
    goalie: ShotPerson | null;
}

const PERIOD = ['', '1st', '2nd', '3rd', 'OT'];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
export const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Distance (ft) and angle (degrees off the net's centre line) of a shot turned toward the net at +89. */
export function geometry(x: number, y: number) {
    const dx = 89 - x;
    return { dist: Math.hypot(dx, y), angle: (Math.atan2(Math.abs(y), dx) * 180) / Math.PI };
}

/** A name entry of a shot file as a person (older files hold a bare name). */
function personOf(file: ShotFile, id: number | null | undefined): ShotPerson | null {
    if (id == null) return null;
    const n = file.names?.[String(id)];
    if (!n) return null;
    const [name, headshot, team] = typeof n === 'string' ? [n, null, null] : n;
    return { name, href: `/players/${id}`, headshot, team };
}

/**
 * A row of a player's shot file as a card. `kind` says whose file it is (which end `other` names);
 * `self` is the page's own player, the other end of every shot.
 */
export function fileShotInfo(file: ShotFile, r: ShotRow, kind: 'skater' | 'goalie', self: ShotPerson): ShotInfo {
    const meta = file.meta?.[r[S.game]];
    const gid = file.games[r[S.game]];
    const other = personOf(file, r[S.other]);
    const st = r[S.strength];
    const strength = kind === 'skater' ? (['Even', 'Power play', 'Shorthanded', 'Empty net'][st] ?? null) : (['Even', 'Penalty kill', 'Power play'][st] ?? null);
    const last = r[S.last];
    const since = r[S.since];
    return {
        result: r[S.goal] ? 'goal' : r[S.onGoal] ? 'saved' : 'missed',
        xg: r[S.xg],
        x: r[S.x],
        y: r[S.y],
        type: SHOT_TYPES[r[S.type]] ?? null,
        rebound: !!r[S.rebound],
        strength,
        period: r[S.period] ?? null,
        clock: r[S.clock] ?? null,
        lead: r[S.score] ?? null,
        before: last != null && since != null && LAST_EVENTS[last] ? { what: LAST_EVENTS[last], secs: since } : null,
        game: gid
            ? {
                  href: `/games/${gid}`,
                  date: meta?.[0] ?? null,
                  opp: meta?.[1] ?? null,
                  home: meta?.[2] == null ? null : !!meta[2],
                  gf: meta?.[3] ?? null,
                  ga: meta?.[4] ?? null,
                  outcome: meta?.[5] ?? null,
              }
            : null,
        shooter: kind === 'skater' ? self : other,
        goalie: kind === 'skater' ? other : self,
    };
}

/** Top-down offensive zone, net at the top: the shot, its line to the net and the angle off centre. */
function WhereFrom({ x, y, color }: { x: number; y: number; color: string }) {
    const W = 85;
    const top = 95;
    const sx = (u: number) => u + 42.5;
    const sy = (v: number) => top - v;
    const H = top - 22;
    const px = sx(Math.max(-42, Math.min(42, y)));
    const py = sy(Math.max(23, Math.min(99, x)));
    const { angle } = geometry(x, y);
    const r = 9;
    const a0 = Math.PI / 2;
    const a1 = Math.atan2(py - sy(89), px - sx(0));
    const arc = `M${sx(0) + r * Math.cos(a0)},${sy(89) + r * Math.sin(a0)} A${r},${r} 0 0 ${a1 < a0 ? 0 : 1} ${sx(0) + r * Math.cos(a1)},${sy(89) + r * Math.sin(a1)}`;
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Where the shot came from">
            <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={10} fill="var(--surface-2)" stroke="var(--line-strong)" strokeWidth={0.6} />
            <line x1={2} x2={W - 2} y1={sy(89)} y2={sy(89)} stroke="rgb(var(--neg-rgb) / 0.55)" strokeWidth={0.5} />
            <path d={`M${sx(-4)},${sy(89)} A6,6 0 0 0 ${sx(4)},${sy(89)}`} fill="rgb(var(--brand-rgb) / 0.12)" stroke="rgb(var(--brand-rgb) / 0.4)" strokeWidth={0.4} />
            {[-22, 22].map(u => (
                <circle key={u} cx={sx(u)} cy={sy(69)} r={15} fill="none" stroke="rgb(var(--neg-rgb) / 0.3)" strokeWidth={0.4} />
            ))}
            <line x1={2} x2={W - 2} y1={sy(25)} y2={sy(25)} stroke="rgb(var(--brand-rgb) / 0.45)" strokeWidth={1} />
            <rect x={sx(-3)} y={sy(89) - 3} width={6} height={3} fill="none" stroke="var(--neg)" strokeWidth={0.6} />
            <line x1={sx(0)} x2={sx(0)} y1={sy(89)} y2={sy(40)} stroke="var(--line-strong)" strokeDasharray="1.5 1.5" strokeWidth={0.4} />
            {angle > 2 ? <path d={arc} fill="none" stroke="var(--text-3)" strokeWidth={0.5} /> : null}
            <line x1={px} y1={py} x2={sx(0)} y2={sy(89)} stroke={color} strokeWidth={0.7} strokeDasharray="2 1.2" />
            <circle cx={px} cy={py} r={2.2} fill={color} stroke="var(--bg)" strokeWidth={0.6} />
        </svg>
    );
}

/** A face in its team's ring, the crest tucked at the corner. */
function Face({ p, role, align }: { p: ShotPerson | null; role: string; align: 'left' | 'right' }) {
    const ring = p?.team ? teamPalette(p.team).primary : 'var(--line-strong)';
    const body = (
        <span className={cn('flex min-w-0 items-center gap-2', align === 'right' && 'flex-row-reverse text-right')}>
            <span className="relative shrink-0">
                <span className="block h-11 w-11 overflow-hidden rounded-full border-2 bg-surface-2" style={{ borderColor: ring }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- NHL headshot */}
                    {p?.headshot ? <img src={p.headshot} alt="" width={44} height={44} loading="lazy" className="headshot h-full w-full" /> : null}
                </span>
                {p?.team ? <Crest tri={p.team} size={18} className={cn('absolute -bottom-1 drop-shadow-none', align === 'right' ? '-left-1' : '-right-1')} /> : null}
            </span>
            <span className="min-w-0 leading-tight">
                <span className="block text-micro uppercase tracking-label text-fg-3">{role}</span>
                <span className={cn('block truncate text-caption font-bold', role === 'Goalie' ? 'text-goalie' : 'text-fg-1')}>{p?.name ?? 'Unknown'}</span>
            </span>
        </span>
    );
    return p?.href ? (
        <Link href={p.href} className="min-w-0 rounded-control hover:bg-surface-2/60">
            {body}
        </Link>
    ) : (
        <span className="min-w-0">{body}</span>
    );
}

function leadText(lead: number, team: string | null) {
    if (lead === 0) return 'Tied';
    return `${team ? `${team} ` : ''}${lead > 0 ? 'up' : 'down'} ${Math.abs(lead)}`;
}

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-3 border-t border-line/70 py-1.5 first:border-t-0">
            <dt className="text-micro uppercase tracking-label text-fg-3">{k}</dt>
            <dd className="min-w-0 text-right text-caption tabular-nums text-fg-1">{children}</dd>
        </div>
    );
}

/** The game the shot came in: opponent crest, venue and date, how it ended; opens the game page. */
function GameBand({ g }: { g: NonNullable<ShotInfo['game']> }) {
    const won = g.gf != null && g.ga != null ? g.gf > g.ga : null;
    const late = !!g.outcome && g.outcome !== 'REG';
    const body = (
        <span className="flex items-center gap-2.5">
            {g.opp ? <Crest tri={g.opp} size={40} className="drop-shadow-none" /> : null}
            <span className="min-w-0 flex-1 leading-tight">
                <span className="block font-display text-title font-bold uppercase text-fg-1">
                    {g.home == null ? '' : g.home ? 'vs ' : '@ '}
                    {g.opp ?? 'Game'}
                </span>
                {g.date ? <span className="block text-micro uppercase tracking-label text-fg-3">{shortDay(g.date)}</span> : null}
            </span>
            {won != null ? (
                <span className={cn('shrink-0 rounded-chip px-1.5 py-0.5 text-caption font-bold tabular-nums', won ? 'bg-pos/12 text-pos' : late ? 'bg-amber/10 text-amber' : 'bg-well text-fg-2')}>
                    {won ? 'W' : late ? 'OTL' : 'L'} {g.gf}-{g.ga}
                    {late && won ? <span className="text-micro font-normal"> {g.outcome}</span> : null}
                </span>
            ) : null}
        </span>
    );
    return g.href ? (
        <Link href={g.href} className="-m-1 rounded-control p-1 hover:bg-surface-2/60" title="Game page">
            {body}
        </Link>
    ) : (
        body
    );
}

export function ShotDetail({ info, summary, accent, className }: { info: ShotInfo | null; summary: React.ReactNode; accent: string; className?: string }) {
    const g = info ? geometry(info.x, info.y) : null;
    const label = info?.result === 'goal' ? 'Goal' : info?.result === 'saved' ? 'Saved' : 'Missed';
    const evenStrength = info?.strength ? info.strength === 'Even' || /^(\d)v\1/.test(info.strength) : true;
    return (
        <aside aria-live="polite" className={cn('flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface-1/60 p-3', className)}>
            {info && g ? (
                <>
                    {info.game ? <GameBand g={info.game} /> : null}

                    {/* The moment. */}
                    <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 border-y border-line/70 py-1.5 text-micro uppercase tracking-label text-fg-3">
                        {info.period ? (
                            <span className="text-fg-1">
                                {PERIOD[Math.min(4, info.period)]}
                                {info.clock != null ? ` ${typeof info.clock === 'number' ? mmss(info.clock) : info.clock}` : ''}
                            </span>
                        ) : null}
                        {info.lead != null ? <span>{leadText(info.lead, info.shooter?.team ?? null)}</span> : null}
                        {info.strength ? <span className={evenStrength ? undefined : 'text-amber'}>{info.strength}</span> : null}
                    </p>

                    {/* The matchup. */}
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
                        <Face p={info.shooter} role="Shooter" align="left" />
                        <svg viewBox="0 0 16 8" className="h-2 w-4 text-fg-3" aria-hidden="true">
                            <path d="M0 4h13M10 1l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.3" />
                        </svg>
                        <Face p={info.goalie} role="Goalie" align="right" />
                    </div>

                    {/* The shot. */}
                    <div className="flex items-baseline justify-between gap-2">
                        <span className={cn('font-display text-[22px] font-bold uppercase leading-none', info.result !== 'goal' && 'text-fg-2')} style={info.result === 'goal' ? { color: accent } : undefined}>
                            {label}
                        </span>
                        <span className="tabular-nums">
                            <span className="font-display text-[22px] font-bold leading-none text-model">{info.xg.toFixed(2)}</span> <span className="text-micro uppercase tracking-label text-fg-3">xG</span>
                        </span>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_4.75rem] items-stretch gap-2">
                        <WhereFrom x={info.x} y={info.y} color={info.result === 'goal' ? accent : 'var(--text-1)'} />
                        <div className="flex flex-col gap-2 tabular-nums">
                            <div className="flex flex-1 flex-col justify-center rounded-control bg-well text-center">
                                <p className="font-display text-title font-bold text-fg-1">
                                    {Math.round(g.dist)}
                                    <span className="text-micro font-normal text-fg-3"> ft</span>
                                </p>
                                <p className="text-micro uppercase tracking-label text-fg-3">Dist</p>
                            </div>
                            <div className="flex flex-1 flex-col justify-center rounded-control bg-well text-center">
                                <p className="font-display text-title font-bold text-fg-1">
                                    {Math.round(g.angle)}
                                    <span className="text-micro font-normal text-fg-3">°</span>
                                </p>
                                <p className="text-micro uppercase tracking-label text-fg-3">{info.x > 89 ? 'Behind' : 'Angle'}</p>
                            </div>
                        </div>
                    </div>
                    <dl className="flex flex-col">
                        {info.type ? (
                            <Fact k="Type">
                                <span className="capitalize">{info.type}</span>
                                {info.rebound ? <span className="ml-1.5 rounded-chip border border-amber/50 px-1 text-micro uppercase tracking-wide text-amber">Rebound</span> : null}
                            </Fact>
                        ) : null}
                        {info.before ? (
                            <Fact k="Off a">
                                <span className="capitalize">{info.before.what}</span>
                                <span className="text-fg-3"> · {info.before.secs}s before</span>
                            </Fact>
                        ) : null}
                    </dl>
                </>
            ) : (
                <>
                    {summary}
                    <p className="mt-auto text-micro uppercase tracking-label text-fg-3">Hover or tap a shot for its story</p>
                </>
            )}
        </aside>
    );
}

/** The map and its shot card: the card beside the rink from lg, under it on smaller screens. */
export function ShotMapFrame({ map, detail }: { map: React.ReactNode; detail: React.ReactNode }) {
    return (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18.5rem] lg:items-stretch">
            <div className="min-w-0 self-center">{map}</div>
            {detail}
        </div>
    );
}

/** A plain summary block for the card's resting state. */
export function ShotSummary({ rows }: { rows: [string, React.ReactNode][] }) {
    return (
        <dl className="flex flex-col">
            {rows.map(([k, v]) => (
                <Fact key={k} k={k}>
                    {v}
                </Fact>
            ))}
        </dl>
    );
}

/**
 * Hover previews a shot; a click or tap pins it (again, or open ice, lets go). Indices into `set`;
 * a new set (a filter changed) clears both.
 */
export function useShotPick<T>(set: readonly T[]) {
    const [hover, setHover] = React.useState<number | null>(null);
    const [pin, setPin] = React.useState<number | null>(null);
    const [seen, setSeen] = React.useState(set);
    if (seen !== set) {
        setSeen(set);
        setHover(null);
        setPin(null);
    }
    const lit = hover ?? pin;
    return {
        lit,
        picked: lit != null ? (set[lit] ?? null) : null,
        onHover: setHover,
        onTap: (i: number | null) => setPin(p => (i == null || p === i ? null : i)),
    };
}
