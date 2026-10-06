'use client';

import * as React from 'react';
import { legibleOn } from '@/components/ui/color';
import { cn } from '@/lib/utils';
import { clockOf, iceAt, shortName, type GoalieSnap, type SkaterSnap } from '@/lib/game/analytics';
import type { Side } from '@/lib/game/types';
import { useGame } from './GameContext';

const TH = 'px-1.5 py-1 text-right text-micro font-semibold uppercase tracking-label text-fg-3';
const TD = 'px-1.5 py-1 text-right tabular-nums';

function Face({ src, color }: { src: string | null; color: string }) {
    return (
        <span className="block h-7 w-7 shrink-0 overflow-hidden rounded-full border bg-surface-2" style={{ borderColor: color }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- NHL headshots are pre-sized PNGs */}
            {src ? <img src={src} alt="" width={28} height={28} loading="lazy" className="h-full w-full object-cover" /> : null}
        </span>
    );
}

const zero = (v: number) => (v ? 'text-fg-1' : 'text-fg-3');

function TeamIce({ side, skaters, goalie }: { side: Side; skaters: SkaterSnap[]; goalie: GoalieSnap | null }) {
    const { m, colors } = useGame();
    const color = legibleOn(colors[side], '#0a0e15');
    const n = skaters.length;
    return (
        <div className="min-w-0">
            <div className="flex items-center gap-2 px-1.5 pb-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- team logos are static SVGs */}
                <img src={`/logos/${m.teams[side].tri}.svg`} alt="" width={28} height={28} className="h-7 w-7" />
                <span className="font-bold" style={{ color }}>
                    {m.teams[side].tri}
                </span>
                <span className="text-micro uppercase tracking-label text-fg-3">
                    {n} skaters{goalie ? '' : ' · net empty'}
                </span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-caption">
                    <thead>
                        <tr className="border-b border-line">
                            <th className={cn(TH, 'text-left')} colSpan={2}>
                                Player
                            </th>
                            <th className={TH} title="Time into the current shift">Shift</th>
                            <th className={TH} title="Time on ice so far">TOI</th>
                            <th className={TH} title="Shift number">#Sh</th>
                            <th className={TH}>G</th>
                            <th className={TH}>A</th>
                            <th className={TH}>P</th>
                            <th className={TH}>SOG</th>
                            <th className={TH} title="Shot attempts">Att</th>
                            <th className={TH}>PIM</th>
                            <th className={TH}>Hit</th>
                            <th className={TH}>Blk</th>
                            <th className={TH} title="Faceoffs won-lost">FO</th>
                        </tr>
                    </thead>
                    <tbody>
                        {skaters.map(r => (
                            <tr key={r.player.id} className="border-b border-line/60">
                                <td className="w-8 py-1 pl-1.5">
                                    <Face src={r.player.headshot} color={color} />
                                </td>
                                <td className="whitespace-nowrap px-1.5 py-1">
                                    <span className="mr-1.5 inline-block w-5 text-right text-fg-3 tabular-nums">{r.player.num ?? ''}</span>
                                    <span className="font-semibold text-fg-1">{shortName(r.player)}</span>
                                    <span className="ml-1.5 text-micro text-fg-3">{r.player.pos}</span>
                                </td>
                                <td className={`${TD} text-fg-1`}>{clockOf(r.shift)}</td>
                                <td className={`${TD} text-fg-2`}>{clockOf(r.toi)}</td>
                                <td className={`${TD} text-fg-2`}>{r.shiftNo}</td>
                                <td className={`${TD} ${r.g ? 'font-bold text-pos' : 'text-fg-3'}`}>{r.g}</td>
                                <td className={`${TD} ${zero(r.a)}`}>{r.a}</td>
                                <td className={`${TD} ${zero(r.g + r.a)} font-semibold`}>{r.g + r.a}</td>
                                <td className={`${TD} ${zero(r.sog)}`}>{r.sog}</td>
                                <td className={`${TD} ${zero(r.att)}`}>{r.att}</td>
                                <td className={`${TD} ${zero(r.pim)}`}>{r.pim}</td>
                                <td className={`${TD} ${zero(r.hits)}`}>{r.hits}</td>
                                <td className={`${TD} ${zero(r.blk)}`}>{r.blk}</td>
                                <td className={`${TD} ${zero(r.fow + r.fol)}`}>{r.fow + r.fol ? `${r.fow}-${r.fol}` : '–'}</td>
                            </tr>
                        ))}
                        {goalie ? (
                            <tr>
                                <td className="w-8 py-1 pl-1.5">
                                    <Face src={goalie.player.headshot} color="var(--goalie)" />
                                </td>
                                <td className="whitespace-nowrap px-1.5 py-1">
                                    <span className="mr-1.5 inline-block w-5 text-right text-fg-3 tabular-nums">{goalie.player.num ?? ''}</span>
                                    <span className="font-semibold text-goalie">{shortName(goalie.player)}</span>
                                    <span className="ml-1.5 text-micro text-fg-3">G</span>
                                </td>
                                <td className={TD} />
                                <td className={`${TD} text-fg-2`}>{clockOf(goalie.toi)}</td>
                                <td colSpan={10} className="px-1.5 py-1 text-right tabular-nums">
                                    <span className="inline-flex flex-wrap justify-end gap-x-4">
                                        <Stat k="SA" v={String(goalie.sa)} />
                                        <Stat k="GA" v={String(goalie.ga)} />
                                        <Stat k="SV%" v={goalie.sa ? ((goalie.sa - goalie.ga) / goalie.sa).toFixed(3).replace(/^0/, '') : '–'} />
                                        <Stat k="xGA" v={goalie.xga.toFixed(2)} model />
                                        <Stat k="GSAx" v={`${goalie.xga - goalie.ga >= 0 ? '+' : '−'}${Math.abs(goalie.xga - goalie.ga).toFixed(2)}`} tone={goalie.xga - goalie.ga} />
                                    </span>
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function Stat({ k, v, model, tone }: { k: string; v: string; model?: boolean; tone?: number }) {
    const cls = model ? 'text-model' : tone == null ? 'text-fg-1' : tone > 0.005 ? 'text-pos' : tone < -0.005 ? 'text-neg' : 'text-fg-2';
    return (
        <span className="whitespace-nowrap">
            <span className="mr-1 text-micro uppercase tracking-label text-fg-3">{k}</span>
            <span className={cls}>{v}</span>
        </span>
    );
}

/** Players on the ice at game time t (the Pulse playhead), away then home like the readout. */
export function OnIce({ t, caption }: { t: number; caption: React.ReactNode }) {
    const { m } = useGame();
    const snap = React.useMemo(() => iceAt(m, t), [m, t]);
    if (!snap) return null;
    return (
        <div className="grid gap-4 border-t border-line px-card py-3">
            <p className="label">{caption}</p>
            {(['away', 'home'] as Side[]).map(side => (
                <TeamIce key={side} side={side} skaters={snap.skaters[side]} goalie={snap.goalie[side]} />
            ))}
        </div>
    );
}
