'use client';

import * as React from 'react';
import { FilterChip } from '@/components/ui/filter-chip';
import { cn } from '@/lib/utils';
import { goalSwings, periodLabel, playerName, shortName, type GoalSwing } from '@/lib/game/analytics';
import type { GameEvent, Side } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';

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

export function Goals() {
    const { m, byId, colors } = useGame();
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
                                        <li key={e.id} className={cn('relative md:w-1/2', away ? 'md:self-start md:pr-6' : 'md:self-end md:pl-6')}>
                                            <span
                                                aria-hidden="true"
                                                className={cn('absolute top-1/2 hidden h-2 w-2 -translate-y-1/2 rounded-full md:block', away ? '-right-1' : '-left-1')}
                                                style={{ background: swing ? colors[e.side] : 'var(--warn)' }}
                                            />
                                            {swing ? (
                                                <GoalCard e={e} before={swing.before} after={swing.after} />
                                            ) : (
                                                <p className={cn('flex items-center gap-2 rounded-control border border-dashed border-line px-3 py-1.5 text-caption text-fg-2', !away && 'md:flex-row-reverse md:text-right')}>
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
