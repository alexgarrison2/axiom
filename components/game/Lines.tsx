'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { clockOf, skaterRows, units, type Unit } from '@/lib/game/analytics';
import { SIDES, type Side } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';

const sgn = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;

/** One unit: name blocks joined by a rail, 5v5 (or special-teams) time and what happened on the ice. */
function UnitRow({ u, side, kind }: { u: Unit; side: Side; kind: string }) {
    const { byId, colors, label } = useGame();
    const xgd = u.xgf - u.xga;
    return (
        <li className="grid grid-cols-1 items-center gap-x-3 gap-y-1.5 border-t border-line py-2 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative flex min-w-0 items-center gap-1.5">
                <span aria-hidden="true" className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2" style={{ background: colors[side], opacity: 0.45 }} />
                {u.ids.map(id => {
                    const p = byId.get(id);
                    return (
                        <span key={id} className="relative z-[1] min-w-0 flex-auto truncate rounded-chip border border-line bg-surface-2 px-1 py-1 text-center text-micro text-fg-1 sm:px-1.5 sm:text-caption" title={p ? `${p.first} ${p.last}` : undefined}>
                            {label(id)}
                        </span>
                    );
                })}
            </div>
            <div className="flex items-center gap-3 whitespace-nowrap text-caption tabular-nums max-sm:justify-end">
                <span className="w-11 text-right text-fg-2" title={`${kind} time together`}>
                    {clockOf(u.toi)}
                </span>
                <span className="w-12 text-right text-model" title="pony xG for − against">
                    {sgn(xgd)}
                </span>
                <span className="flex w-10 justify-end gap-0.5" aria-label={`${u.gf} goals for, ${u.ga} against`}>
                    {Array.from({ length: u.gf }, (_, i) => (
                        <span key={`f${i}`} className="h-2 w-2 rounded-full bg-pos" />
                    ))}
                    {Array.from({ length: u.ga }, (_, i) => (
                        <span key={`a${i}`} className="h-2 w-2 rounded-full bg-neg" />
                    ))}
                </span>
            </div>
        </li>
    );
}

function Group({ title, list, side, kind }: { title: string; list: Unit[]; side: Side; kind: string }) {
    if (!list.length) return null;
    return (
        <div>
            <p className="label mb-1">{title}</p>
            <ol>
                {list.map(u => (
                    <UnitRow key={u.ids.join('-')} u={u} side={side} kind={kind} />
                ))}
            </ol>
        </div>
    );
}

/** Minutes per skater: even strength, power play, penalty kill. */
function Minutes({ side }: { side: Side }) {
    const { m, label } = useGame();
    const rows = skaterRows(m, side, 'all');
    const max = Math.max(1, ...rows.map(r => r.toi));
    return (
        <ol className="flex flex-col gap-1">
            {rows.map(r => (
                <li key={r.player.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2.75rem] items-center gap-2 text-caption tabular-nums">
                    <span className="truncate text-fg-1">{label(r.player.id)}</span>
                    <span className="flex h-3 overflow-hidden rounded-[2px] bg-track" style={{ width: `${(r.toi / max) * 100}%` }} title={`EV ${clockOf(r.toiEv)} · PP ${clockOf(r.toiPp)} · PK ${clockOf(r.toiSh)}`}>
                        <span className="h-full bg-fg-2" style={{ width: `${(r.toiEv / r.toi) * 100}%` }} />
                        <span className="h-full bg-[var(--pp)]" style={{ width: `${(r.toiPp / r.toi) * 100}%` }} />
                        <span className="h-full bg-[var(--pk)]" style={{ width: `${(r.toiSh / r.toi) * 100}%` }} />
                    </span>
                    <span className="text-right text-fg-2">{clockOf(r.toi)}</span>
                </li>
            ))}
        </ol>
    );
}

export function Lines() {
    const { m, colors } = useGame();
    const [side, setSide] = React.useState<Side>('away');
    const data = React.useMemo(
        () =>
            Object.fromEntries(
                SIDES.map(s => [s, { F: units(m, s, 'F').slice(0, 4), D: units(m, s, 'D').slice(0, 3), PP: units(m, s, 'PP').slice(0, 2), PK: units(m, s, 'PK').slice(0, 2) }]),
            ) as Record<Side, Record<'F' | 'D' | 'PP' | 'PK', Unit[]>>,
        [m],
    );
    const panel = (s: Side) => (
        <div className="panel flex flex-col gap-4 p-card">
            <p className="font-bold uppercase tracking-label" style={{ color: colors[s] }}>
                {m.teams[s].tri}
            </p>
            <Group title="Forward lines · 5v5" list={data[s].F} side={s} kind="5v5" />
            <Group title="D pairs · 5v5" list={data[s].D} side={s} kind="5v5" />
            <Group title="Power play" list={data[s].PP} side={s} kind="Power-play" />
            <Group title="Penalty kill" list={data[s].PK} side={s} kind="Penalty-kill" />
            <div>
                <p className="label mb-1.5 flex flex-wrap items-center gap-3">
                    <span>Minutes</span>
                    <span className="flex items-center gap-1 normal-case tracking-normal text-fg-3">
                        <span className="h-2 w-2 rounded-[1px] bg-fg-2" />
                        EV
                        <span className="ml-1.5 h-2 w-2 rounded-[1px] bg-[var(--pp)]" />
                        PP
                        <span className="ml-1.5 h-2 w-2 rounded-[1px] bg-[var(--pk)]" />
                        PK
                    </span>
                </p>
                <Minutes side={s} />
            </div>
        </div>
    );
    return (
        <GameSection
            id="lines"
            title="Lines"
            aside={
                <span className="md:hidden">
                    <Segmented
                        label="Team"
                        size="sm"
                        value={side}
                        onChange={setSide}
                        optionClassName="px-2.5"
                        options={SIDES.map(s => ({ value: s, label: m.teams[s].tri }))}
                    />
                </span>
            }
        >
            <p className="mb-2 flex flex-wrap gap-x-4 text-micro uppercase tracking-label text-fg-3">
                <span>Time together</span>
                <span className="text-model">xG ±</span>
                <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-pos" /> GF
                    <span className="ml-1 h-2 w-2 rounded-full bg-neg" /> GA
                </span>
            </p>
            <div className="hidden gap-3 md:grid md:grid-cols-2">
                {panel('away')}
                {panel('home')}
            </div>
            <div className={cn('md:hidden')}>{panel(side)}</div>
        </GameSection>
    );
}
