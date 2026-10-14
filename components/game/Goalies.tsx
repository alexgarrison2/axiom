'use client';

import * as React from 'react';
import { PlayerLink } from '@/components/players/PlayerLink';
import { cn } from '@/lib/utils';
import { clockOf, gamesPlayed, goalieRows, playerName } from '@/lib/game/analytics';
import { OPP_GOALIE } from '@/lib/game/season';
import { SIDES, type GameModel, type Side } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';
import { fmtInt } from '@/components/views/format';

const svp = (sa: number, ga: number) => {
    if (!sa) return '—';
    const v = Math.round(((sa - ga) / sa) * 1000);
    return v >= 1000 ? '1.000' : `.${String(v).padStart(3, '0')}`;
};
const sgn = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;

/**
 * A merged season's W-L-OT: the team's goalies from the credited decisions, the pooled
 * opponents' goalies as the mirror of the team's results. Null for a single game.
 */
function record(m: GameModel, side: Side, id: number): string | null {
    if (!m.games?.length) return null;
    if (id === OPP_GOALIE) {
        const w = m.games.filter(g => g.ga > g.gf).length;
        const otl = m.games.filter(g => g.gf > g.ga && g.outcome != null && g.outcome !== 'REG').length;
        return `${w}-${m.games.filter(g => g.gf > g.ga).length - otl}-${otl}`;
    }
    if (side !== 'away' || !m.games.some(g => g.decision)) return null;
    const mine = m.games.filter(g => g.decision?.goalie === id);
    const n = (r: 'W' | 'L' | 'O') => mine.filter(g => g.decision!.result === r).length;
    return `${n('W')}-${n('L')}-${n('O')}`;
}

const tone = (v: number) => (v > 0.05 ? 'text-pos' : v < -0.05 ? 'text-neg' : 'text-fg-2');
const Gsax = ({ v }: { v: number | null }) => <td className={cn('py-1.5 text-right', v == null ? 'text-fg-3' : tone(v))}>{v == null ? '—' : sgn(v)}</td>;

export function Goalies() {
    const { m, colors } = useGame();
    // No shot scored yet (xG comes after the nightly run): blank, not GSAx = −GA.
    const hasXg = m.events.some(e => e.xg != null);
    const xg = (v: number) => (hasXg ? v.toFixed(2) : '—');
    return (
        <GameSection id="goalies" title="Goalies">
            <div className="grid gap-3 md:grid-cols-2">
                {SIDES.map(side => {
                    const rows = goalieRows(m, side);
                    return (
                        <div key={side} className={cn('flex flex-col gap-3', side === 'home' && 'md:items-stretch')}>
                            {rows.length === 0 ? <p className="panel p-card label">No goalie data</p> : null}
                            {rows.map(g => {
                                const gsax = hasXg ? g.xga - g.ga : null;
                                const rec = record(m, side, g.player.id);
                                const gp = m.games?.length ? (g.player.id === OPP_GOALIE ? m.games.length : gamesPlayed(m, g.player.id)) : 0;
                                const stats: [string, string, string][] = [
                                    ['Saves', `${fmtInt(g.sa - g.ga)}/${fmtInt(g.sa)}`, 'text-fg-1'],
                                    ['SV%', svp(g.sa, g.ga), 'text-fg-1'],
                                    ['GAA', g.toi ? ((g.ga * 3600) / g.toi).toFixed(2) : '—', 'text-fg-1'],
                                    ['xGA', xg(g.xga), hasXg ? 'text-model' : 'text-fg-3'],
                                    ['GSAx', gsax == null ? '—' : sgn(gsax), gsax == null ? 'text-fg-3' : tone(gsax)],
                                ];
                                return (
                                    <article key={g.player.id} className="panel flex flex-col gap-3 p-card">
                                        <header className={cn('flex items-center gap-3', side === 'home' && 'flex-row-reverse text-right')}>
                                            {/* No headshot (a season's merged opponents): phones drop the empty ring. */}
                                            <div className={cn('h-14 w-14 shrink-0 overflow-hidden rounded-full border-2 bg-surface-2', !g.player.headshot && 'max-md:hidden')} style={{ borderColor: colors[side] }}>
                                                {/* eslint-disable-next-line @next/next/no-img-element -- NHL headshots are pre-sized PNGs */}
                                                {g.player.headshot ? <img src={g.player.headshot} alt="" width={56} height={56} loading="lazy" className="headshot h-full w-full" /> : null}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="truncate font-bold text-goalie">
                                                    {g.player.id === OPP_GOALIE ? playerName(g.player) : <PlayerLink id={g.player.id}>{playerName(g.player)}</PlayerLink>}
                                                </p>
                                                <p className="text-micro uppercase tracking-label text-fg-3 tabular-nums">
                                                    {rec ? <span className="mr-2 font-bold text-fg-1">{rec}</span> : null}
                                                    {m.teams[side].tri} · {gp ? `${gp} GP · ` : ''}
                                                    {clockOf(g.toi)}
                                                </p>
                                            </div>
                                        </header>
                                        <dl className="grid grid-cols-5 gap-2 text-center tabular-nums">
                                            {stats.map(([k, v, c]) => (
                                                <div key={k}>
                                                    <dt className="label max-sm:tracking-[0.08em]">{k}</dt>
                                                    <dd className={cn('mt-0.5 font-display text-[15px] font-bold sm:text-title', c)}>{v}</dd>
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
                                                    <th scope="col" className="py-1 text-right font-medium">
                                                        GSAx
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
                                                            {fmtInt(s.sa - s.ga)}/{fmtInt(s.sa)}
                                                        </td>
                                                        <td className="py-1.5 text-right text-fg-1">{svp(s.sa, s.ga)}</td>
                                                        <td className="py-1.5 text-right text-model">{xg(s.xga)}</td>
                                                        <Gsax v={hasXg ? s.xga - s.ga : null} />
                                                    </tr>
                                                ))}
                                                <tr className="border-t border-line">
                                                    <th scope="row" className="py-1.5 text-left font-normal text-fg-2">
                                                        High danger
                                                    </th>
                                                    <td className="py-1.5 text-right text-fg-1">
                                                        {fmtInt(g.hdSa - g.hdGa)}/{fmtInt(g.hdSa)}
                                                    </td>
                                                    <td className="py-1.5 text-right text-fg-1">{svp(g.hdSa, g.hdGa)}</td>
                                                    <td className="py-1.5 text-right text-model">{xg(g.hdXga)}</td>
                                                    <Gsax v={hasXg ? g.hdXga - g.hdGa : null} />
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
