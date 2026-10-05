'use client';

import * as React from 'react';
import { Crest } from '@/components/ui/crest';
import { Segmented } from '@/components/ui/segmented';
import { HeaderCell, type SortDir } from '@/components/teams-table/HeaderCell';
import { TableScroller } from '@/components/teams-table/TableScroller';
import { CELL_BG, HEAD_CELL, STICKY_EDGE } from '@/components/teams-table/table-style';
import { cn } from '@/lib/utils';
import { clockOf, periodLabel, units, type Unit, type UnitKind } from '@/lib/game/analytics';
import type { Side } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';

interface Col {
    key: string;
    label: string;
    title: string;
    value: (u: Unit) => number | null;
    fmt?: (v: number) => string;
    signed?: boolean;
    model?: boolean;
}

const pct = (a: number, b: number) => (a + b ? a / (a + b) : null);
const f2 = (v: number) => v.toFixed(2);
const f1p = (v: number) => `${(v * 100).toFixed(1)}%`;
const sgn = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;

const COLS: Col[] = [
    { key: 'toi', label: 'TOI', title: 'Time on ice together', value: u => u.toi, fmt: clockOf },
    { key: 'stints', label: 'STN', title: 'Stints: separate times on the ice together', value: u => u.stints },
    { key: 'cf', label: 'CF', title: 'Shot attempts for', value: u => u.cf },
    { key: 'ca', label: 'CA', title: 'Shot attempts against', value: u => u.ca },
    { key: 'cfp', label: 'CF%', title: 'Shot attempt share', value: u => pct(u.cf, u.ca), fmt: f1p },
    { key: 'sf', label: 'SF', title: 'Shots on goal for', value: u => u.sf },
    { key: 'sa', label: 'SA', title: 'Shots on goal against', value: u => u.sa },
    { key: 'gf', label: 'GF', title: 'Goals for', value: u => u.gf },
    { key: 'ga', label: 'GA', title: 'Goals against', value: u => u.ga },
    { key: 'xgf', label: 'xGF', title: 'pony xG for', value: u => u.xgf, fmt: f2, model: true },
    { key: 'xga', label: 'xGA', title: 'pony xG against', value: u => u.xga, fmt: f2, model: true },
    { key: 'xgfp', label: 'xGF%', title: 'pony xG share', value: u => pct(u.xgf, u.xga), fmt: f1p, model: true },
    { key: 'xgd', label: 'xG±', title: 'xGF − xGA', value: u => u.xgf - u.xga, fmt: sgn, signed: true },
    { key: 'oz', label: 'OZ', title: 'Stints started on an offensive-zone faceoff', value: u => u.oz },
    { key: 'dz', label: 'DZ', title: 'Stints started on a defensive-zone faceoff', value: u => u.dz },
    { key: 'ozp', label: 'OZS%', title: 'Offensive-zone share of O and D faceoff starts', value: u => pct(u.oz, u.dz), fmt: v => `${Math.round(v * 100)}%` },
];

const KINDS: { value: UnitKind; label: string; strength: string }[] = [
    { value: 'F', label: 'Lines', strength: '5v5' },
    { value: 'D', label: 'Pairs', strength: '5v5' },
    { value: 'PP', label: 'PP units', strength: 'Power play' },
    { value: 'PK', label: 'PK units', strength: 'Penalty kill' },
];

/** Under this the unit is a line change in passing, not a unit. */
const MIN_TOI = 30;

/** Forward lines, defence pairs and special-teams units: on-ice results while that exact group was out together. */
export function Units() {
    const { m, byId, colors } = useGame();
    const [side, setSide] = React.useState<Side>('away');
    const [kind, setKind] = React.useState<UnitKind>('F');
    const [period, setPeriod] = React.useState<string>('all');
    const [sort, setSort] = React.useState<{ key: string; dir: SortDir }>({ key: 'toi', dir: 'desc' });
    const per = period === 'all' ? 'all' : Number(period);
    const rows = React.useMemo(() => units(m, side, kind, per).filter(u => u.toi >= MIN_TOI), [m, side, kind, per]);
    const periods = [...new Set(m.events.map(e => (e.period >= 4 ? 4 : e.period)))].sort();
    const col = COLS.find(c => c.key === sort.key) ?? COLS[0];
    const sorted = [...rows].sort((a, b) => {
        const va = col.value(a);
        const vb = col.value(b);
        if (va == null) return 1;
        if (vb == null) return -1;
        return sort.dir === 'desc' ? vb - va : va - vb;
    });
    // Forwards left to right C, L, R like a lineup card; D by number.
    const order = { C: 1, L: 0, R: 2, D: 3, G: 4 } as const;
    const kindLabel = KINDS.find(k => k.value === kind)!;

    return (
        <GameSection id="units" title="Units">
            <div className="panel overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-card py-2">
                    <Segmented
                        label="Team"
                        size="sm"
                        value={side}
                        onChange={setSide}
                        optionClassName="gap-1.5 px-2.5"
                        options={(['away', 'home'] as Side[]).map(s => ({
                            value: s,
                            label: (
                                <span className="flex items-center gap-1.5">
                                    <Crest tri={m.teams[s].tri} size={18} className="h-[18px] w-[18px]" />
                                    {m.teams[s].tri}
                                </span>
                            ),
                            ariaLabel: m.teams[s].name,
                        }))}
                    />
                    <Segmented label="Unit" size="sm" value={kind} onChange={setKind} optionClassName="px-2.5" options={KINDS.map(k => ({ value: k.value, label: k.label }))} />
                    <Segmented
                        label="Period"
                        size="sm"
                        value={period}
                        onChange={setPeriod}
                        optionClassName="px-2"
                        options={[{ value: 'all', label: 'All' }, ...periods.map(p => ({ value: String(p), label: periodLabel(p) }))]}
                    />
                    <span className="ml-auto text-micro uppercase tracking-label text-fg-3">{kindLabel.strength}</span>
                </div>
                {sorted.length ? (
                    <TableScroller label={`${m.teams[side].name} ${kindLabel.label.toLowerCase()}`}>
                        <table className="w-full border-separate border-spacing-0 text-caption tabular-nums">
                            <thead>
                                <tr>
                                    <th scope="col" className={cn(HEAD_CELL, STICKY_EDGE, 'z-[4] h-6 min-w-[16rem] px-2 text-left')}>
                                        <span className="text-micro font-medium uppercase tracking-[0.1em] text-fg-3">{kindLabel.label}</span>
                                    </th>
                                    {COLS.map(c => (
                                        <HeaderCell
                                            key={c.key}
                                            label={c.label}
                                            title={c.title}
                                            dense
                                            direction={sort.key === c.key ? sort.dir : null}
                                            onSort={() => setSort(s => (s.key === c.key ? { key: c.key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: c.key, dir: 'desc' }))}
                                            className={cn(HEAD_CELL, 'min-w-[3.25rem]')}
                                        />
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map(u => {
                                    const ps = u.ids
                                        .map(id => byId.get(id))
                                        .filter((p): p is NonNullable<typeof p> => p != null)
                                        .sort((a, b) => order[a.pos] - order[b.pos] || (a.num ?? 0) - (b.num ?? 0));
                                    return (
                                        <tr key={u.ids.join('-')} className="group">
                                            <th scope="row" className={cn(STICKY_EDGE, CELL_BG, 'z-[2] h-9 px-2 text-left font-normal shadow-[inset_0_-1px_0_var(--line)]')}>
                                                <span className="flex items-center gap-2.5">
                                                    <span className="flex shrink-0 -space-x-2" aria-hidden="true">
                                                        {ps.map(p => (
                                                            <span key={p.id} className="block h-7 w-7 overflow-hidden rounded-full border-2 bg-surface-2" style={{ borderColor: colors[side] }}>
                                                                {/* eslint-disable-next-line @next/next/no-img-element -- NHL headshots are pre-sized PNGs */}
                                                                {p.headshot ? <img src={p.headshot} alt="" width={28} height={28} loading="lazy" className="h-full w-full object-cover" /> : null}
                                                            </span>
                                                        ))}
                                                    </span>
                                                    <span className="truncate">
                                                        {ps.map((p, i) => (
                                                            <React.Fragment key={p.id}>
                                                                {i ? <span className="px-1 text-fg-3">·</span> : null}
                                                                <span className="font-bold text-fg-1">{p.last}</span>
                                                            </React.Fragment>
                                                        ))}
                                                    </span>
                                                </span>
                                            </th>
                                            {COLS.map(c => {
                                                const v = c.value(u);
                                                return (
                                                    <td
                                                        key={c.key}
                                                        className={cn(
                                                            CELL_BG,
                                                            'h-9 px-1.5 text-center shadow-[inset_0_-1px_0_var(--line)]',
                                                            v == null || v === 0 ? 'text-fg-3' : c.signed ? (v > 0 ? 'text-pos' : 'text-neg') : c.model ? 'text-model' : 'text-fg-1',
                                                        )}
                                                    >
                                                        {v == null ? '—' : c.fmt ? c.fmt(v) : v}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </TableScroller>
                ) : (
                    <p className="px-card py-6 text-center text-caption text-fg-3">No {kindLabel.label.toLowerCase()} {period === 'all' ? 'in this game' : 'in this period'}</p>
                )}
            </div>
        </GameSection>
    );
}
