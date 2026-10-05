'use client';

import * as React from 'react';
import { FilterChip } from '@/components/ui/filter-chip';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { inPeriod, isUnblocked, matchTeamStrength, periodLabel, shortName, type TeamStrength } from '@/lib/game/analytics';
import { SIDES, type GameEvent, type Side } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';
import { RinkMarkings } from './Rink';

type Kind = 'goal' | 'shot' | 'miss' | 'block';
const KINDS: { kind: Kind; label: string }[] = [
    { kind: 'goal', label: 'Goals' },
    { kind: 'shot', label: 'Saved' },
    { kind: 'miss', label: 'Missed' },
    { kind: 'block', label: 'Blocked' },
];

const radius = (e: GameEvent) => 1.4 + Math.sqrt(e.xg ?? 0.02) * 5.2;

function Mark({ e, color, lit }: { e: GameEvent; color: string; lit: boolean }) {
    const x = e.x!;
    const y = -e.y!;
    const r = radius(e);
    return (
        <g>
            {e.type === 'block' ? (
                <path d={`M${x - 1.3},${y - 1.3}l2.6,2.6m0,-2.6l-2.6,2.6`} stroke={color} strokeOpacity={0.7} strokeWidth={0.5} />
            ) : e.type === 'miss' ? (
                <circle cx={x} cy={y} r={r} fill="none" stroke={color} strokeOpacity={0.85} strokeWidth={0.45} />
            ) : (
                <circle cx={x} cy={y} r={r} fill={color} fillOpacity={e.type === 'goal' ? 1 : 0.5} stroke={e.type === 'goal' ? 'var(--ink)' : 'none'} strokeWidth={0.7} />
            )}
            {lit ? <circle cx={x} cy={y} r={r + 2} fill="none" className="stroke-brand" strokeWidth={0.8} /> : null}
        </g>
    );
}

/** Shot density over one offensive zone: a 2ft grid, Gaussian kernel, six alpha steps of the team colour. */
function Heat({ side, events, color }: { side: Side; events: GameEvent[]; color: string }) {
    const pts = events.filter(e => e.side === side && isUnblocked(e) && e.x != null).map(e => [Math.abs(e.x!), side === 'home' ? -e.y! : e.y!] as const);
    const cells = React.useMemo(() => {
        const out: { x: number; y: number; v: number }[] = [];
        if (!pts.length) return out;
        const sigma = 7;
        let max = 0;
        for (let x = 25; x < 100; x += 2) {
            for (let y = -42; y < 42.5; y += 2) {
                let v = 0;
                for (const [px, py] of pts) {
                    const d2 = (x + 1 - px) ** 2 + (y + 1 - py) ** 2;
                    v += Math.exp(-d2 / (2 * sigma * sigma));
                }
                max = Math.max(max, v);
                out.push({ x, y, v });
            }
        }
        return out.map(c => ({ ...c, v: c.v / max }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [events, side]);
    const xg = events.filter(e => e.side === side && isUnblocked(e)).reduce((a, e) => a + (e.xg ?? 0), 0);
    const n = events.filter(e => e.side === side && isUnblocked(e)).length;
    const blocked = events.filter(e => e.side === side && e.type === 'block').length;
    return (
        <figure className="min-w-0">
            <svg viewBox="0 -42.5 100 85" className="block w-full" role="img" aria-label={`Shot density for ${side}`}>
                <clipPath id={`heat-clip-${side}`}>
                    <path d="M0,-42.5 H72 A28,28 0 0 1 100,-14.5 V14.5 A28,28 0 0 1 72,42.5 H0 Z" />
                </clipPath>
                <RinkMarkings half />
                <g clipPath={`url(#heat-clip-${side})`}>
                    {cells.map((c, i) => {
                        const step = Math.floor(c.v * 6) / 6;
                        if (step < 1 / 6) return null;
                        return <rect key={i} x={c.x} y={c.y} width={2.05} height={2.05} fill={color} opacity={0.12 + step * 0.6} />;
                    })}
                </g>
            </svg>
            <figcaption className="mt-1 text-center text-micro uppercase tracking-label text-fg-3 tabular-nums">
                <span className="text-model">{xg.toFixed(2)} xG</span> · {n} unblocked · {blocked} blocked
            </figcaption>
        </figure>
    );
}

export function Shots() {
    const { m, colors, byId, selected, select } = useGame();
    const [strength, setStrength] = React.useState<TeamStrength>('all');
    const [period, setPeriod] = React.useState<string>('all');
    const [kinds, setKinds] = React.useState<Set<Kind>>(new Set(['goal', 'shot', 'miss']));
    const [player, setPlayer] = React.useState<string>('all');
    const [view, setView] = React.useState<'map' | 'heat'>('map');

    const per = period === 'all' ? 'all' : Number(period);
    const base = m.events.filter(e => (e.type === 'goal' || e.type === 'shot' || e.type === 'miss' || e.type === 'block') && e.x != null && matchTeamStrength(e, strength) && inPeriod(e, per));
    const shown = base.filter(e => kinds.has(e.type as Kind) && (player === 'all' || String(e.player) === player));
    const shooters = [...new Set(base.map(e => e.player).filter((p): p is number => p != null))]
        .map(id => byId.get(id))
        .filter(Boolean)
        .sort((a, b) => (a!.side === b!.side ? a!.last.localeCompare(b!.last) : a!.side === 'away' ? -1 : 1));
    const periods = [...new Set(m.events.map(e => (e.period >= 4 ? 4 : e.period)))].sort();
    const toggle = (k: Kind) => setKinds(s => {
        const n = new Set(s);
        if (n.has(k)) n.delete(k);
        else n.add(k);
        return n;
    });
    const hovered = shown.find(e => e.id === selected);

    return (
        <GameSection
            id="shots"
            title="Shots"
            aside={<Segmented label="Shot view" size="sm" value={view} onChange={setView} options={[{ value: 'map', label: 'Map' }, { value: 'heat', label: 'Density' }]} optionClassName="px-2.5" />}
        >
            <div className="panel overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-card py-2">
                    <Segmented
                        label="Strength"
                        size="sm"
                        value={strength}
                        onChange={setStrength}
                        optionClassName="px-2"
                        options={[
                            { value: 'all', label: 'All' },
                            { value: '5v5', label: '5v5' },
                            { value: 'awayPP', label: `${m.teams.away.tri} PP` },
                            { value: 'homePP', label: `${m.teams.home.tri} PP` },
                        ]}
                    />
                    <Segmented
                        label="Period"
                        size="sm"
                        value={period}
                        onChange={setPeriod}
                        optionClassName="px-2"
                        options={[{ value: 'all', label: 'All' }, ...periods.map(p => ({ value: String(p), label: periodLabel(p) }))]}
                    />
                    {view === 'map' ? (
                        <>
                            <div role="group" aria-label="Shot results" className="flex flex-wrap gap-1.5">
                                {KINDS.map(k => (
                                    <FilterChip key={k.kind} selected={kinds.has(k.kind)} onSelectedChange={() => toggle(k.kind)} className="min-h-8">
                                        {k.label}
                                    </FilterChip>
                                ))}
                            </div>
                            <label className="sr-only" htmlFor="shot-player">
                                Shooter
                            </label>
                            <select
                                id="shot-player"
                                value={player}
                                onChange={e => setPlayer(e.target.value)}
                                className="h-8 min-w-0 max-w-[12rem] rounded-control border border-line bg-surface-1 px-2 text-caption uppercase tracking-wide text-fg-1 hover:border-line-strong coarse:h-11 md:ml-auto"
                            >
                                <option value="all">All shooters</option>
                                {shooters.map(p => (
                                    <option key={p!.id} value={p!.id}>
                                        {m.teams[p!.side].tri} {shortName(p)}
                                    </option>
                                ))}
                            </select>
                        </>
                    ) : null}
                </div>

                {view === 'map' ? (
                    <div className="p-card">
                        <svg viewBox="-101 -43.5 202 87" className="block w-full" role="img" aria-label={`${shown.length} shot attempts. ${m.teams.away.tri} shoot left, ${m.teams.home.tri} shoot right.`}>
                            <RinkMarkings />
                            <text x={-96} y={2} className="fill-fg-3" fontSize={4} fontWeight={700} textAnchor="start" opacity={0.6}>
                                {m.teams.away.tri}
                            </text>
                            <text x={96} y={2} className="fill-fg-3" fontSize={4} fontWeight={700} textAnchor="end" opacity={0.6}>
                                {m.teams.home.tri}
                            </text>
                            {/* Goals drawn last so they sit on top. */}
                            {[...shown]
                                .sort((a, b) => Number(a.type === 'goal') - Number(b.type === 'goal'))
                                .map(e => (
                                    <g key={e.id} onClick={() => select(selected === e.id ? null : e.id)} className="cursor-pointer">
                                        <title>{`${periodLabel(e.period)} ${e.clock} · ${m.teams[e.side].tri} ${shortName(e.player != null ? byId.get(e.player) : undefined)} · ${e.type}${e.xg != null ? ` · xG ${e.xg.toFixed(2)}` : ''}${e.shotType ? ` · ${e.shotType}` : ''}`}</title>
                                        <Mark e={e} color={colors[e.side]} lit={selected === e.id} />
                                    </g>
                                ))}
                        </svg>
                        <div className="mt-2 grid grid-cols-2 gap-4 text-caption tabular-nums">
                            {SIDES.map(side => {
                                const evs = base.filter(e => e.side === side);
                                const unb = evs.filter(isUnblocked);
                                return (
                                    <p key={side} className={cn('flex flex-wrap items-baseline gap-x-2', side === 'home' && 'justify-end text-right')}>
                                        <span className="font-bold" style={{ color: colors[side] }}>
                                            {m.teams[side].tri}
                                        </span>
                                        <span className="text-model">{unb.reduce((a, e) => a + (e.xg ?? 0), 0).toFixed(2)} xG</span>
                                        <span className="text-fg-2">
                                            {unb.length} unblocked · {evs.filter(e => e.type === 'block').length} blocked
                                        </span>
                                    </p>
                                );
                            })}
                        </div>
                        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-micro uppercase tracking-label text-fg-3">
                            <span className="flex items-center gap-1.5">
                                <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
                                    <circle cx={5} cy={5} r={4} className="fill-fg-2" stroke="var(--ink)" strokeWidth={1.2} />
                                </svg>
                                Goal
                            </span>
                            <span className="flex items-center gap-1.5">
                                <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
                                    <circle cx={5} cy={5} r={4} className="fill-fg-2" opacity={0.5} />
                                </svg>
                                Saved
                            </span>
                            <span className="flex items-center gap-1.5">
                                <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
                                    <circle cx={5} cy={5} r={4} fill="none" className="stroke-fg-2" />
                                </svg>
                                Missed
                            </span>
                            <span className="flex items-center gap-1.5">
                                <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
                                    <path d="M2 2 8 8M8 2 2 8" className="stroke-fg-2" strokeWidth={1.2} />
                                </svg>
                                Blocked
                            </span>
                            <span>Size = xG</span>
                            {hovered ? (
                                <span className="ml-auto normal-case tracking-normal text-fg-1">
                                    {periodLabel(hovered.period)} {hovered.clock} · {shortName(hovered.player != null ? byId.get(hovered.player) : undefined)}
                                    {hovered.xg != null ? <span className="ml-1 text-model">xG {hovered.xg.toFixed(2)}</span> : null}
                                </span>
                            ) : null}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 p-card sm:grid-cols-2">
                        {SIDES.map(side => (
                            <div key={side}>
                                <p className="mb-1 text-micro font-bold uppercase tracking-label" style={{ color: colors[side] }}>
                                    {m.teams[side].tri}
                                </p>
                                <Heat side={side} events={base} color={colors[side]} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </GameSection>
    );
}
