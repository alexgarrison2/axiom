'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { zoneStarts, type ZoneStarts } from '@/lib/game/analytics';
import { SIDES, type Side } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';

const sum = (a: [number, number, number]) => a[0] + a[1] + a[2];
const SHADES = [0.4, 0.68, 1];

/**
 * Diverging bar: defensive-zone starts left in the neutral ice grey, neutral
 * and on-the-fly in the middle in mute, offensive-zone starts right in the team
 * colour; three intensity steps by period.
 */
function Bar({ z, max, maxMid, color }: { z: ZoneStarts; max: number; maxMid: number; color: string }) {
    const mid: [number, number, number] = [z.N[0] + z.fly[0], z.N[1] + z.fly[1], z.N[2] + z.fly[2]];
    const seg = (arr: [number, number, number], fill: string, reverse = false) => {
        const parts = arr.map((n, i) => <span key={i} className="h-full" style={{ width: `${(n / max) * 100}%`, opacity: SHADES[i], background: fill }} />);
        return reverse ? parts.reverse() : parts;
    };
    return (
        <>
            <span className="flex h-4 justify-end" title={`DZ starts: ${sum(z.D)}`}>
                {seg(z.D, 'var(--info)', true)}
            </span>
            <span className="flex h-4 justify-center" title={`Neutral zone + on the fly: ${sum(mid)}`}>
                {mid.map((n, i) => (
                    <span key={i} className="h-full bg-mute" style={{ width: `${(n / Math.max(1, maxMid)) * 100}%`, opacity: SHADES[i] }} />
                ))}
            </span>
            <span className="flex h-4" title={`OZ starts: ${sum(z.O)}`}>
                {seg(z.O, color)}
            </span>
        </>
    );
}

export function Zones() {
    const { m, byId, colors, label } = useGame();
    const [side, setSide] = React.useState<Side>('away');
    const data = React.useMemo(() => Object.fromEntries(SIDES.map(s => [s, zoneStarts(m, s)])) as Record<Side, Map<number, ZoneStarts>>, [m]);
    const rows = [...data[side].entries()]
        .map(([id, z]) => ({ p: byId.get(id)!, z }))
        .filter(r => r.p)
        .sort((a, b) => (a.p.pos === 'D') === (b.p.pos === 'D') ? sum(b.z.O) - sum(b.z.D) - (sum(a.z.O) - sum(a.z.D)) : a.p.pos === 'D' ? -1 : 1);
    const max = Math.max(1, ...rows.flatMap(r => [sum(r.z.D), sum(r.z.O)]));
    const maxMid = Math.max(1, ...rows.map(r => sum(r.z.N) + sum(r.z.fly)));

    return (
        <GameSection
            id="zones"
            title="Zone starts"
            aside={<Segmented label="Team" size="sm" value={side} onChange={setSide} optionClassName="px-2.5" options={SIDES.map(s => ({ value: s, label: m.teams[s].tri }))} />}
        >
            <div className="panel p-card">
                <div className="mb-2 grid grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] gap-2 text-micro uppercase tracking-label text-fg-3">
                    <span />
                    <span className="text-right">D zone</span>
                    <span className="text-center">Neutral · fly</span>
                    <span>O zone</span>
                </div>
                <ol className="flex flex-col gap-1.5">
                    {rows.map(({ p, z }, i) => (
                        <li key={p.id} className={`grid grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-2 text-caption tabular-nums ${i > 0 && rows[i - 1].p.pos === 'D' && p.pos !== 'D' ? 'mt-3' : ''}`}>
                            <span className="flex min-w-0 items-baseline gap-1.5">
                                <span className="truncate text-fg-1">{label(p.id)}</span>
                                <span className="whitespace-nowrap text-micro text-fg-3">
                                    D{sum(z.D)} O{sum(z.O)}
                                </span>
                            </span>
                            <Bar z={z} max={max} maxMid={maxMid} color={colors[side]} />
                        </li>
                    ))}
                </ol>
                <p className="mt-3 text-micro uppercase tracking-label text-fg-3">Shift starts · darker = later period</p>
            </div>
        </GameSection>
    );
}
