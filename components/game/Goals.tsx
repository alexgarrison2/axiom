'use client';

import * as React from 'react';
import { FilterChip } from '@/components/ui/filter-chip';
import { cn } from '@/lib/utils';
import { goalSwings, periodLabel, playerName, shortName, type GoalSwing } from '@/lib/game/analytics';
import type { GameEvent, Side } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';
import { RinkMarkings } from './Rink';

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Situational tag (PP, SH, EN, 6v5): amber. */
function Tag({ children }: { children: React.ReactNode }) {
    return <span className="rounded-chip border border-warn/50 px-1 text-micro font-bold uppercase leading-4 text-warn">{children}</span>;
}

/** Per-player goal / assist totals so far in this game, in event order. */
function useRunningCounts(events: GameEvent[]) {
    return React.useMemo(() => {
        const g = new Map<number, number>();
        const a = new Map<number, number>();
        const out = new Map<number, { g: number; a: number[] }>();
        for (const e of events) {
            if (e.type !== 'goal') continue;
            const gs = e.player != null ? (g.get(e.player) ?? 0) + 1 : 0;
            if (e.player != null) g.set(e.player, gs);
            const as = e.assists.map(id => {
                const n = (a.get(id) ?? 0) + 1;
                a.set(id, n);
                return n;
            });
            out.set(e.id, { g: gs, a: as });
        }
        return out;
    }, [events]);
}

function GoalCard({ e, before, after }: { e: GameEvent; before: number; after: number }) {
    const { m, colors, byId, selected, select } = useGame();
    const counts = useRunningCounts(m.events).get(e.id);
    const p = e.player != null ? byId.get(e.player) : undefined;
    const side = e.side;
    const away = side === 'away';
    const lit = selected === e.id;
    // Swing toward the scoring side, in points of win probability.
    const mine = (v: number) => (side === 'home' ? v : 1 - v);
    const swing = (mine(after) - mine(before)) * 100;
    const scoreAfter = { ...e.score, [side]: e.score[side] + 1 } as Record<Side, number>;
    const lead = scoreAfter.home === scoreAfter.away ? 'Tied' : scoreAfter.home > scoreAfter.away ? m.teams.home.tri : m.teams.away.tri;

    return (
        <article
            className={cn(
                'relative flex min-w-0 gap-3 rounded-card border bg-surface-1 p-3 transition-colors md:p-4',
                away ? 'md:flex-row' : 'md:flex-row-reverse md:text-right',
                lit ? 'border-brand' : 'border-line hover:border-line-strong',
            )}
            onClick={() => select(lit ? null : e.id)}
        >
            <div className="relative shrink-0">
                <div className="h-14 w-14 overflow-hidden rounded-full border-2 bg-surface-2 md:h-16 md:w-16" style={{ borderColor: colors[side] }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- NHL headshots are pre-sized PNGs */}
                    {p?.headshot ? <img src={p.headshot} alt="" width={64} height={64} loading="lazy" className="h-full w-full object-cover" /> : null}
                </div>
            </div>
            <div className={cn('flex min-w-0 flex-1 flex-col gap-1', !away && 'md:items-end')}>
                <div className={cn('flex flex-wrap items-center gap-1.5', !away && 'md:flex-row-reverse')}>
                    <span className="font-bold text-fg-1">{playerName(p)}</span>
                    {counts?.g ? <span className="text-micro text-fg-3">({counts.g})</span> : null}
                    {e.strength === 'pp' ? <Tag>PP</Tag> : e.strength === 'sh' ? <Tag>SH</Tag> : null}
                    {e.emptyNet ? <Tag>EN</Tag> : null}
                    {!(side === 'away' ? e.situation.awayGoalie : e.situation.homeGoalie) ? (
                        <Tag>
                            {side === 'away' ? e.situation.away : e.situation.home}v{side === 'away' ? e.situation.home : e.situation.away}
                        </Tag>
                    ) : null}
                </div>
                <p className="truncate text-caption text-fg-2">
                    {e.assists.length
                        ? e.assists.map((id, i) => `${shortName(byId.get(id))} (${counts?.a[i] ?? 1})`).join(', ')
                        : 'Unassisted'}
                </p>
                <p className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-micro uppercase tracking-label text-fg-3', !away && 'md:justify-end')}>
                    {e.xg != null ? <span className="text-model">xG {e.xg.toFixed(2)}</span> : null}
                    {e.shotType ? <span>{e.shotType}</span> : null}
                    {e.clip ? (
                        <a
                            href={e.clip}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={ev => ev.stopPropagation()}
                            className="inline-flex min-h-6 items-center gap-1 text-brand hover:underline coarse:min-h-11"
                        >
                            Clip
                            <svg viewBox="0 0 8 8" className="h-2 w-2" aria-hidden="true">
                                <path d="M2 6 6 2M3 2h3v3" fill="none" stroke="currentColor" strokeWidth="1.2" />
                            </svg>
                            <span className="sr-only">(opens nhl.com)</span>
                        </a>
                    ) : null}
                </p>
            </div>
            <div className={cn('flex shrink-0 flex-col justify-center gap-1 tabular-nums', away ? 'items-end text-right' : 'items-end text-right md:items-start md:text-left')}>
                <span className="font-display text-title font-bold text-fg-1">
                    {scoreAfter.away}–{scoreAfter.home} <span className="text-micro font-medium uppercase text-fg-3">{lead}</span>
                </span>
                <span className="text-micro uppercase tracking-label text-fg-3">
                    {periodLabel(e.period)} {e.clock}
                </span>
                <span className={cn('text-caption font-bold', swing >= 0 ? 'text-pos' : 'text-neg')} title={`${m.teams[side].tri} win probability ${pct(mine(before))} to ${pct(mine(after))}`}>
                    {swing >= 0 ? '+' : '−'}
                    {Math.abs(swing).toFixed(1)}
                    <span className="ml-1 text-micro font-medium text-model">{pct(mine(after))}</span>
                </span>
            </div>
        </article>
    );
}

/** Feet to the net the shooter attacked (normalized: home shoots at x = +89, away at x = -89). */
function geometry(e: GameEvent) {
    if (e.x == null || e.y == null) return null;
    const x = Math.abs(e.x);
    const y = e.side === 'home' ? e.y : -e.y;
    const dx = 89 - x;
    return { x, y, dist: Math.hypot(dx, y), angle: (Math.atan2(Math.abs(y), Math.abs(dx)) * 180) / Math.PI, behind: dx < 0 };
}

const EVENT_WORD: Partial<Record<GameEvent['type'], string>> = {
    faceoff: 'Faceoff won',
    shot: 'Shot saved',
    miss: 'Shot missed',
    block: 'Shot blocked',
    hit: 'Hit',
    giveaway: 'Giveaway',
    takeaway: 'Takeaway',
    penalty: 'Penalty',
};

/** The selected goal on half ice: where it came from, the angle to the net, and the plays just before it. */
function GoalShot({ e }: { e: GameEvent }) {
    const { m, colors, byId, label } = useGame();
    const g = geometry(e);
    const color = colors[e.side];
    const before = m.events.filter(x => x.period === e.period && x.t <= e.t && x.t >= e.t - 20 && x.id !== e.id && x.type !== 'goal').slice(-4);
    const rebound = before.some(x => x.side === e.side && (x.type === 'shot' || x.type === 'miss' || x.type === 'block') && e.t - x.t <= 3);
    const rush = (() => {
        const prev = [...before].reverse().find(x => x.t < e.t);
        return !!prev && e.t - prev.t <= 4 && prev.zone != null && (prev.side === e.side ? prev.zone !== 'O' : prev.zone !== 'D');
    })();
    const goalie = e.other != null ? byId.get(e.other) : undefined;
    const strengthLabel = `${e.side === 'away' ? e.situation.away : e.situation.home}v${e.side === 'away' ? e.situation.home : e.situation.away}`;
    return (
        <div className="panel grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:p-4" data-goal-shot>
            {g ? (
                <svg viewBox="20 -43.5 82 87" className="block max-h-[220px] w-full self-center" role="img" aria-label={`Shot from ${Math.round(g.dist)} feet at ${Math.round(g.angle)} degrees`}>
                    <RinkMarkings half />
                    {/* Angle: lines to both posts and the arc of the shooting window. */}
                    <path d={`M${g.x},${-g.y} L89,-3 L89,3 Z`} fill={color} opacity={0.18} />
                    <line x1={g.x} y1={-g.y} x2={89} y2={0} stroke={color} strokeWidth={0.6} strokeDasharray="1.5 1.2" />
                    <circle cx={g.x} cy={-g.y} r={2.6 + Math.sqrt(e.xg ?? 0.05) * 3} fill={color} stroke="var(--ink)" strokeWidth={0.6} />
                    <text x={(g.x + 89) / 2} y={-g.y / 2 - 2.5} textAnchor="middle" className="fill-fg-1" fontSize={3.6} fontWeight={700}>
                        {Math.round(g.dist)} ft
                    </text>
                </svg>
            ) : (
                <p className="label">No location</p>
            )}
            <div className="flex min-w-0 flex-col gap-2.5">
            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-caption tabular-nums">
                <div>
                    <dt className="label">Distance</dt>
                    <dd className="mt-0.5 font-bold text-fg-1">{g ? `${Math.round(g.dist)} ft` : '—'}</dd>
                </div>
                <div>
                    <dt className="label">Angle</dt>
                    <dd className="mt-0.5 font-bold text-fg-1">{g ? `${Math.round(g.angle)}°${g.behind ? ' (behind)' : ''}` : '—'}</dd>
                </div>
                <div>
                    <dt className="label">xG</dt>
                    <dd className="mt-0.5 font-bold text-model">{e.xg != null ? e.xg.toFixed(2) : 'Pending'}</dd>
                </div>
                <div>
                    <dt className="label">Shot</dt>
                    <dd className="mt-0.5 capitalize text-fg-1">{e.shotType ?? '—'}</dd>
                </div>
                <div>
                    <dt className="label">Strength</dt>
                    <dd className="mt-0.5 text-fg-1">{strengthLabel}</dd>
                </div>
                <div>
                    <dt className="label">Goalie</dt>
                    <dd className="mt-0.5 truncate text-goalie">{goalie ? label(goalie.id) : e.emptyNet ? 'Empty net' : '—'}</dd>
                </div>
            </dl>
            {rebound || rush ? (
                <p className="flex gap-2">
                    {rebound ? <span className="rounded-chip border border-warn/50 px-1.5 text-micro font-bold uppercase leading-5 text-warn">Rebound</span> : null}
                    {rush ? <span className="rounded-chip border border-warn/50 px-1.5 text-micro font-bold uppercase leading-5 text-warn">Rush</span> : null}
                </p>
            ) : null}
            {before.length ? (
                <ol className="flex flex-col gap-1 border-t border-line pt-2 text-caption" aria-label="Plays before the goal">
                    {before.map(x => (
                        <li key={x.id} className="flex items-baseline gap-2">
                            <span className="w-10 shrink-0 text-right text-micro tabular-nums text-fg-3">−{e.t - x.t}s</span>
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colors[x.side] }} aria-hidden="true" />
                            <span className="min-w-0 truncate text-fg-2">
                                {EVENT_WORD[x.type] ?? x.type} · {label(x.player)}
                            </span>
                        </li>
                    ))}
                </ol>
            ) : null}
            </div>
        </div>
    );
}

export function Goals() {
    const { m, byId, colors, selected } = useGame();
    const [showPen, setShowPen] = React.useState(false);
    const swings = React.useMemo(() => goalSwings(m), [m]);
    const penalties = m.events.filter(e => e.type === 'penalty');
    const items: { e: GameEvent; swing?: GoalSwing }[] = [...swings.map(s => ({ e: s.event, swing: s })), ...(showPen ? penalties.map(e => ({ e })) : [])].sort((a, b) => a.e.t - b.e.t);
    const periods = [...new Set(items.map(i => i.e.period))];

    return (
        <GameSection
            id="goals"
            title="Goals"
            aside={
                <FilterChip selected={showPen} onSelectedChange={setShowPen} count={penalties.length}>
                    Penalties
                </FilterChip>
            }
        >
            {items.length === 0 ? (
                <p className="label">{m.state === 'pre' ? 'Not started' : 'No goals yet'}</p>
            ) : (
                <ol className="relative flex flex-col gap-2">
                    {/* The spine. */}
                    <span aria-hidden="true" className="absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 bg-line-strong md:block" />
                    {periods.map(per => (
                        <React.Fragment key={per}>
                            <li className="relative z-[1] flex justify-center py-1">
                                <span className="rounded-chip border border-line bg-bg px-2 text-micro font-medium uppercase tracking-label text-fg-3">{periodLabel(per)}</span>
                            </li>
                            {items
                                .filter(i => i.e.period === per)
                                .map(({ e, swing }) => {
                                    const away = e.side === 'away';
                                    return (
                                        <li key={e.id} className="relative md:grid md:grid-cols-2 md:items-start md:gap-x-12">
                                            <span
                                                aria-hidden="true"
                                                className="absolute left-1/2 top-8 hidden h-2 w-2 -translate-x-1/2 rounded-full md:block"
                                                style={{ background: swing ? colors[e.side] : 'var(--warn)' }}
                                            />
                                            {swing ? (
                                                <>
                                                    <div className={cn('min-w-0 md:row-start-1', away ? 'md:col-start-1' : 'md:col-start-2')}>
                                                        <GoalCard e={e} before={swing.before} after={swing.after} />
                                                    </div>
                                                    {selected === e.id ? (
                                                        <div className={cn('mt-2 min-w-0 md:row-start-1 md:mt-0', away ? 'md:col-start-2' : 'md:col-start-1')}>
                                                            <GoalShot e={e} />
                                                        </div>
                                                    ) : null}
                                                </>
                                            ) : (
                                                <p className={cn('flex items-center gap-2 rounded-control border border-dashed border-line px-3 py-1.5 text-caption text-fg-2', away ? 'md:col-start-1' : 'md:col-start-2 md:flex-row-reverse md:text-right')}>
                                                    <span className="text-micro font-bold uppercase text-warn">{m.teams[e.side].tri}</span>
                                                    <span className="truncate">
                                                        {shortName(e.player != null ? byId.get(e.player) : undefined)} · {(e.detail ?? 'penalty').replace(/-/g, ' ')} {e.minutes ? `${e.minutes}:00` : ''}
                                                    </span>
                                                    <span className="ml-auto whitespace-nowrap text-micro uppercase tracking-label text-fg-3 md:ml-0">
                                                        {periodLabel(e.period)} {e.clock}
                                                    </span>
                                                </p>
                                            )}
                                        </li>
                                    );
                                })}
                        </React.Fragment>
                    ))}
                </ol>
            )}
            {m.shootout.length ? (
                <p className="mt-3 text-caption text-fg-2">
                    <span className="label mr-2">Shootout</span>
                    {m.shootout.map((s, i) => (
                        <span key={i} className={cn('mr-2', s.goal ? 'font-bold text-fg-1' : 'text-fg-3')}>
                            {m.teams[s.side].tri} {shortName(s.player != null ? byId.get(s.player) : undefined)} {s.goal ? 'G' : '–'}
                        </span>
                    ))}
                </p>
            ) : null}
        </GameSection>
    );
}
