'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { clockOf, goalieRows, playerName } from '@/lib/game/analytics';
import { SIDES } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';

const svp = (sa: number, ga: number) => {
    if (!sa) return '—';
    const v = Math.round(((sa - ga) / sa) * 1000);
    return v >= 1000 ? '1.000' : `.${String(v).padStart(3, '0')}`;
};
const sgn = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;

export function Goalies() {
    const { m, colors } = useGame();
    return (
        <GameSection id="goalies" title="Goalies">
            <div className="grid gap-3 md:grid-cols-2">
                {SIDES.map(side => {
                    const rows = goalieRows(m, side);
                    return (
                        <div key={side} className={cn('flex flex-col gap-3', side === 'home' && 'md:items-stretch')}>
                            {rows.length === 0 ? <p className="panel p-card label">No goalie data</p> : null}
                            {rows.map(g => {
                                const gsax = g.xga - g.ga;
                                return (
                                    <article key={g.player.id} className="panel flex flex-col gap-3 p-card">
                                        <header className={cn('flex items-center gap-3', side === 'home' && 'flex-row-reverse text-right')}>
                                            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full border-2 bg-surface-2" style={{ borderColor: colors[side] }}>
                                                {/* eslint-disable-next-line @next/next/no-img-element -- NHL headshots are pre-sized PNGs */}
                                                {g.player.headshot ? <img src={g.player.headshot} alt="" width={56} height={56} loading="lazy" className="h-full w-full object-cover" /> : null}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="truncate font-bold text-goalie">{playerName(g.player)}</p>
                                                <p className="text-micro uppercase tracking-label text-fg-3">
                                                    {m.teams[side].tri} · {clockOf(g.toi)}
                                                </p>
                                            </div>
                                        </header>
                                        <dl className="grid grid-cols-4 gap-2 text-center tabular-nums">
                                            {[
                                                ['Saves', `${g.sa - g.ga}/${g.sa}`, 'text-fg-1'],
                                                ['SV%', svp(g.sa, g.ga), 'text-fg-1'],
                                                ['xGA', g.xga.toFixed(2), 'text-model'],
                                                ['GSAx', sgn(gsax), gsax > 0.05 ? 'text-pos' : gsax < -0.05 ? 'text-neg' : 'text-fg-2'],
                                            ].map(([k, v, c]) => (
                                                <div key={k}>
                                                    <dt className="label">{k}</dt>
                                                    <dd className={cn('mt-0.5 font-display text-title font-bold', c)}>{v}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                        <table className="w-full text-caption tabular-nums">
                                            <thead>
                                                <tr className="text-micro uppercase text-fg-3">
                                                    <th scope="col" className="py-1 text-left font-medium">
                                                        Facing
                                                    </th>
                                                    <th scope="col" className="py-1 text-right font-medium">
                                                        Saves
                                                    </th>
                                                    <th scope="col" className="py-1 text-right font-medium">
                                                        SV%
                                                    </th>
                                                    <th scope="col" className="py-1 text-right font-medium">
                                                        xGA
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(
                                                    [
                                                        ['Even', g.byStrength.ev],
                                                        ['Power play', g.byStrength.sh],
                                                        ['Shorthanded', g.byStrength.pp],
                                                    ] as const
                                                ).map(([k, s]) => (
                                                    <tr key={k} className="border-t border-line">
                                                        <th scope="row" className="py-1.5 text-left font-normal text-fg-2">
                                                            {k}
                                                        </th>
                                                        <td className="py-1.5 text-right text-fg-1">
                                                            {s.sa - s.ga}/{s.sa}
                                                        </td>
                                                        <td className="py-1.5 text-right text-fg-1">{svp(s.sa, s.ga)}</td>
                                                        <td className="py-1.5 text-right text-model">{s.xga.toFixed(2)}</td>
                                                    </tr>
                                                ))}
                                                <tr className="border-t border-line">
                                                    <th scope="row" className="py-1.5 text-left font-normal text-fg-2">
                                                        High danger
                                                    </th>
                                                    <td className="py-1.5 text-right text-fg-1">
                                                        {g.hdSa - g.hdGa}/{g.hdSa}
                                                    </td>
                                                    <td className="py-1.5 text-right text-fg-1">{svp(g.hdSa, g.hdGa)}</td>
                                                    <td className="py-1.5 text-right text-fg-3" />
                                                </tr>
                                            </tbody>
                                        </table>
                                    </article>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </GameSection>
    );
}
