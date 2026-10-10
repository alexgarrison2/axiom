'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { S, SHOT_TYPES, type ShotFile, type ShotRow } from '@/lib/shots';

/**
 * The 3D shot maps' detail panel: it sits beside the rink (under it on a
 * phone) and reads out the hovered or tapped shot: result and xG, where it came
 * from on a small top-down view of the zone (distance and angle to the net),
 * type, situation, when, the game and the goalie or shooter on the other end.
 * With nothing picked it shows the map's summary.
 */

export interface ShotInfo {
    result: 'goal' | 'saved' | 'missed';
    xg: number;
    /** Feet, turned toward the net at x = +89; y across the ice. */
    x: number;
    y: number;
    type: string | null;
    rebound?: boolean;
    situation: string | null;
    period: number | null;
    /** Seconds into the period, or the clock as the feed writes it ("11:46"). */
    clock: number | string | null;
    /** "Oct 8 · @ TOR", linked to the game. */
    game: { label: string; href: string | null } | null;
    /** The shooter on a goalie's or a team's map. */
    shooter?: { name: string; href: string | null } | null;
    /** The goalie in net on a skater's or a team's map. */
    goalie?: { name: string; href: string | null } | null;
}

const PERIOD = ['', '1st', '2nd', '3rd', 'OT'];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Distance (ft) and angle (degrees off the net's centre line) of a shot turned toward the net at +89. */
export function geometry(x: number, y: number) {
    const dx = 89 - x;
    return { dist: Math.hypot(dx, y), angle: (Math.atan2(Math.abs(y), dx) * 180) / Math.PI };
}

/** A row of a player's shot file as a detail. `kind` says whose file it is (which end `other` names). */
export function fileShotInfo(file: ShotFile, r: ShotRow, kind: 'skater' | 'goalie'): ShotInfo {
    const meta = file.meta?.[r[S.game]];
    const gid = file.games[r[S.game]];
    const other = r[S.other];
    const name = other != null ? file.names?.[String(other)] : undefined;
    const person = name ? { name, href: `/players/${other}` } : null;
    const st = r[S.strength];
    const situation = kind === 'skater' ? (['Even', 'Power play', 'Shorthanded', 'Empty net'][st] ?? null) : (['Even', 'Shorthanded', 'Power play'][st] ?? null);
    return {
        result: r[S.goal] ? 'goal' : r[S.onGoal] ? 'saved' : 'missed',
        xg: r[S.xg],
        x: r[S.x],
        y: r[S.y],
        type: SHOT_TYPES[r[S.type]] ?? null,
        rebound: !!r[S.rebound],
        situation,
        period: r[S.period] ?? null,
        clock: r[S.clock] ?? null,
        game: meta?.[0] ? { label: `${shortDate(meta[0])} · ${meta[2] ? 'vs' : '@'} ${meta[1]}`, href: gid ? `/games/${gid}` : null } : gid ? { label: `Game`, href: `/games/${gid}` } : null,
        shooter: kind === 'goalie' ? person : undefined,
        goalie: kind === 'skater' ? person : undefined,
    };
}

/** Top-down offensive zone, net at the top: the shot, its line to the net and the angle off centre. */
function WhereFrom({ x, y, color }: { x: number; y: number; color: string }) {
    // View box in feet: across the ice -42.5..42.5, from the net (y = 89 at the top) down to the blue line (25).
    const W = 85;
    const top = 95;
    const sx = (u: number) => u + 42.5;
    const sy = (v: number) => top - v;
    const H = top - 22;
    const px = sx(Math.max(-42, Math.min(42, y)));
    const py = sy(Math.max(23, Math.min(99, x)));
    const { angle } = geometry(x, y);
    const r = 9;
    const a0 = Math.PI / 2; // straight down from the net
    const a1 = Math.atan2(py - sy(89), px - sx(0));
    const arc = `M${sx(0) + r * Math.cos(a0)},${sy(89) + r * Math.sin(a0)} A${r},${r} 0 0 ${a1 < a0 ? 0 : 1} ${sx(0) + r * Math.cos(a1)},${sy(89) + r * Math.sin(a1)}`;
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Where the shot came from">
            <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={10} fill="var(--surface-2)" stroke="var(--line-strong)" strokeWidth={0.6} />
            {/* goal line, crease, faceoff circles, blue line */}
            <line x1={2} x2={W - 2} y1={sy(89)} y2={sy(89)} stroke="rgb(var(--neg-rgb) / 0.55)" strokeWidth={0.5} />
            <path d={`M${sx(-4)},${sy(89)} A6,6 0 0 0 ${sx(4)},${sy(89)}`} fill="rgb(var(--brand-rgb) / 0.12)" stroke="rgb(var(--brand-rgb) / 0.4)" strokeWidth={0.4} />
            {[-22, 22].map(u => (
                <circle key={u} cx={sx(u)} cy={sy(69)} r={15} fill="none" stroke="rgb(var(--neg-rgb) / 0.3)" strokeWidth={0.4} />
            ))}
            <line x1={2} x2={W - 2} y1={sy(25)} y2={sy(25)} stroke="rgb(var(--brand-rgb) / 0.45)" strokeWidth={1} />
            {/* net */}
            <rect x={sx(-3)} y={sy(89) - 3} width={6} height={3} fill="none" stroke="var(--neg)" strokeWidth={0.6} />
            {/* centre line of the net, the angle and the shot's line */}
            <line x1={sx(0)} x2={sx(0)} y1={sy(89)} y2={sy(40)} stroke="var(--line-strong)" strokeDasharray="1.5 1.5" strokeWidth={0.4} />
            {angle > 2 ? <path d={arc} fill="none" stroke="var(--text-3)" strokeWidth={0.5} /> : null}
            <line x1={px} y1={py} x2={sx(0)} y2={sy(89)} stroke={color} strokeWidth={0.7} strokeDasharray="2 1.2" />
            <circle cx={px} cy={py} r={2.2} fill={color} stroke="var(--bg)" strokeWidth={0.6} />
        </svg>
    );
}

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-3 border-t border-line/70 py-1.5 first:border-t-0">
            <dt className="text-micro uppercase tracking-label text-fg-3">{k}</dt>
            <dd className="min-w-0 truncate text-right text-caption tabular-nums text-fg-1">{children}</dd>
        </div>
    );
}

const Who = ({ p, className }: { p: { name: string; href: string | null }; className?: string }) =>
    p.href ? (
        <Link href={p.href} className={cn('underline-offset-4 hover:underline', className)}>
            {p.name}
        </Link>
    ) : (
        <span className={className}>{p.name}</span>
    );

export function ShotDetail({ info, summary, accent, className }: { info: ShotInfo | null; summary: React.ReactNode; accent: string; className?: string }) {
    const label = info?.result === 'goal' ? 'Goal' : info?.result === 'saved' ? 'Saved' : 'Missed';
    const g = info ? geometry(info.x, info.y) : null;
    return (
        <aside aria-live="polite" className={cn('flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface-1/60 p-3', className)}>
            {info && g ? (
                <>
                    <div className="flex items-baseline justify-between gap-2">
                        <span className="font-display text-title font-bold uppercase" style={{ color: info.result === 'goal' ? accent : undefined }}>
                            <span className={info.result === 'goal' ? undefined : 'text-fg-2'}>{label}</span>
                        </span>
                        <span className="tabular-nums">
                            <span className="font-display text-title font-bold text-model">{info.xg.toFixed(2)}</span> <span className="text-micro uppercase tracking-label text-fg-3">xG</span>
                        </span>
                    </div>
                    {info.shooter ? (
                        <p className="-mt-2 truncate text-caption text-fg-2">
                            <Who p={info.shooter} className="font-bold text-fg-1" />
                        </p>
                    ) : null}
                    <WhereFrom x={info.x} y={info.y} color={info.result === 'goal' ? accent : 'var(--text-1)'} />
                    <div className="grid grid-cols-2 gap-2 text-center tabular-nums">
                        <div className="rounded-control bg-well py-1.5">
                            <p className="font-display text-title font-bold text-fg-1">
                                {Math.round(g.dist)}
                                <span className="text-micro font-normal text-fg-3"> ft</span>
                            </p>
                            <p className="text-micro uppercase tracking-label text-fg-3">Distance</p>
                        </div>
                        <div className="rounded-control bg-well py-1.5">
                            <p className="font-display text-title font-bold text-fg-1">
                                {Math.round(g.angle)}
                                <span className="text-micro font-normal text-fg-3">°</span>
                            </p>
                            <p className="text-micro uppercase tracking-label text-fg-3">{info.x > 89 ? 'Behind net' : 'Angle'}</p>
                        </div>
                    </div>
                    <dl className="flex flex-col">
                        {info.type ? (
                            <Fact k="Type">
                                <span className="capitalize">{info.type}</span>
                                {info.rebound ? <span className="text-amber"> · rebound</span> : null}
                            </Fact>
                        ) : null}
                        {info.situation ? <Fact k="Situation">{info.situation}</Fact> : null}
                        {info.period ? (
                            <Fact k="When">
                                {PERIOD[Math.min(4, info.period)]}
                                {info.clock != null ? ` ${typeof info.clock === 'number' ? mmss(info.clock) : info.clock}` : ''}
                            </Fact>
                        ) : null}
                        {info.game ? (
                            <Fact k="Game">{info.game.href ? <Link href={info.game.href} className="underline-offset-4 hover:text-brand hover:underline">{info.game.label}</Link> : info.game.label}</Fact>
                        ) : null}
                        {info.goalie ? (
                            <Fact k="Goalie">
                                <Who p={info.goalie} className="text-goalie" />
                            </Fact>
                        ) : null}
                    </dl>
                </>
            ) : (
                <>
                    {summary}
                    <p className="mt-auto text-micro uppercase tracking-label text-fg-3">Hover or tap a shot for its details</p>
                </>
            )}
        </aside>
    );
}

/** The map and its detail panel: the panel beside the rink from lg, under it on smaller screens. */
export function ShotMapFrame({ map, detail }: { map: React.ReactNode; detail: React.ReactNode }) {
    return (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-stretch">
            <div className="min-w-0 self-center">{map}</div>
            {detail}
        </div>
    );
}

/** A plain summary block for the panel's resting state. */
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
