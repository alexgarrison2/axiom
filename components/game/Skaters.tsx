'use client';

import * as React from 'react';
import { PlayerLink } from '@/components/players/PlayerLink';
import { Crest } from '@/components/ui/crest';
import { Segmented } from '@/components/ui/segmented';
import { HeaderCell, type SortDir } from '@/components/teams-table/HeaderCell';
import { CELL_BG, HEAD_CELL, STICKY_EDGE } from '@/components/teams-table/table-style';
import { cn } from '@/lib/utils';
import { clockOf, pairRows, periodLabel, playerName, shortName, skaterRows, teamOnIce, type PairRow, type PlayerStrength, type SkaterRow, type TeamOnIce } from '@/lib/game/analytics';
import type { Side } from '@/lib/game/types';
import { ControlRow } from './ControlRow';
import { GameSection, useGame } from './GameContext';
import { PIN_COL, PinnedTable } from './PinnedTable';

/** Where the header is a pinned copy (phones, short screens), body cells carry the header's min widths so the columns match. */
const PIN_FIRST = 'max-lg:min-w-[8.5rem] md:max-lg:min-w-[11rem] [@media(max-height:500px)]:min-w-[8.5rem] md:[@media(max-height:500px)]:min-w-[11rem]';

/** Full name, or initial and last name on phones so the pinned column leaves room for the numbers. */
function Name({ p }: { p: Parameters<typeof playerName>[0] }) {
    return (
        <>
            <span className="md:hidden">{shortName(p)}</span>
            <span className="hidden md:inline">{playerName(p)}</span>
        </>
    );
}

type View = 'ind' | 'ice' | 'use' | 'comp' | 'mates';

interface Col {
    key: string;
    label: string;
    title: string;
    value: (r: SkaterRow) => number | null;
    fmt?: (v: number) => string;
    /** Signed, coloured green/red. */
    signed?: boolean;
    /** Needs pony xG: blank (—) until the game has any. */
    model?: boolean;
    /** The team row: counting columns add up the skaters; on-ice columns are the team's own numbers; others stay blank. */
    total?: (rows: SkaterRow[], team: TeamOnIce) => number | null;
}

const sumOf = (f: (r: SkaterRow) => number) => (rows: SkaterRow[]) => rows.reduce((a, r) => a + f(r), 0);

const pct = (a: number, b: number) => (a + b ? a / (a + b) : null);
const f2 = (v: number) => v.toFixed(2);
const f1p = (v: number) => `${(v * 100).toFixed(1)}%`;
const sgn = (v: number, d = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;
/** A model column's value, or null while no shot of the game has pony xG (0.00 would read as a real number). */
const cell = <R,>(hasXg: boolean, c: { value: (r: R) => number | null; model?: boolean }, r: R) => (c.model && !hasXg ? null : c.value(r));

/** Columns for one skater against an opponent / with a teammate ("for" is the chosen skater's team). */
const PAIR_COLS: { key: string; label: string; title: string; value: (r: PairRow) => number | null; fmt?: (v: number) => string; signed?: boolean; model?: boolean }[] = [
    { key: 'toi', label: 'TOI', title: 'Time on ice together', value: r => r.toi, fmt: clockOf },
    { key: 'cf', label: 'CF', title: 'Shot attempts for', value: r => r.cf },
    { key: 'ca', label: 'CA', title: 'Shot attempts against', value: r => r.ca },
    { key: 'cfp', label: 'CF%', title: 'Shot attempt share', value: r => pct(r.cf, r.ca), fmt: f1p },
    { key: 'xgf', label: 'xGF', title: 'pony xG for', value: r => r.xgf, fmt: f2, model: true },
    { key: 'xga', label: 'xGA', title: 'pony xG against', value: r => r.xga, fmt: f2, model: true },
    { key: 'xgfp', label: 'xGF%', title: 'pony xG share', value: r => pct(r.xgf, r.xga), fmt: f1p, model: true },
    { key: 'gf', label: 'GF', title: 'Goals for', value: r => r.gf },
    { key: 'ga', label: 'GA', title: 'Goals against', value: r => r.ga },
];

const COLS: Record<'ind' | 'ice' | 'use', Col[]> = {
    ind: [
        { key: 'toi', label: 'TOI', title: 'Time on ice', value: r => r.toi, fmt: clockOf },
        { key: 'g', label: 'G', title: 'Goals', value: r => r.g, total: sumOf(r => r.g) },
        { key: 'a', label: 'A', title: 'Assists', value: r => r.a1 + r.a2, total: sumOf(r => r.a1 + r.a2) },
        { key: 'p', label: 'P', title: 'Points', value: r => r.g + r.a1 + r.a2, total: sumOf(r => r.g + r.a1 + r.a2) },
        { key: 'sog', label: 'SOG', title: 'Shots on goal', value: r => r.sog, total: sumOf(r => r.sog) },
        { key: 'icf', label: 'iCF', title: 'Shot attempts', value: r => r.iCF, total: sumOf(r => r.iCF) },
        { key: 'ixg', label: 'ixG', title: 'Individual pony xG', value: r => r.ixg, fmt: f2, model: true, total: sumOf(r => r.ixg) },
        { key: 'gax', label: 'GAx', title: 'Goals above expected (G − ixG)', value: r => r.g - r.ixg, fmt: v => sgn(v), signed: true, model: true, total: sumOf(r => r.g - r.ixg) },
        { key: 'hit', label: 'HIT', title: 'Hits', value: r => r.hits, total: sumOf(r => r.hits) },
        { key: 'blk', label: 'BLK', title: 'Shots blocked', value: r => r.blocks, total: sumOf(r => r.blocks) },
        { key: 'tk', label: 'TK', title: 'Takeaways', value: r => r.takeaways, total: sumOf(r => r.takeaways) },
        { key: 'gv', label: 'GV', title: 'Giveaways', value: r => r.giveaways, total: sumOf(r => r.giveaways) },
        { key: 'fo', label: 'FO%', title: 'Faceoffs won', value: r => pct(r.foW, r.foL), fmt: v => `${Math.round(v * 100)}%`, total: rs => pct(sumOf(r => r.foW)(rs), sumOf(r => r.foL)(rs)) },
        { key: 'pim', label: 'PIM', title: 'Penalty minutes (whole game)', value: r => r.pim, total: sumOf(r => r.pim) },
        { key: 'pm', label: '+/−', title: 'Plus-minus (whole game)', value: r => r.plusMinus, fmt: v => (v > 0 ? `+${v}` : String(v)), signed: true },
    ],
    ice: [
        { key: 'toi', label: 'TOI', title: 'Time on ice', value: r => r.toi, fmt: clockOf, total: (_, t) => t.toi },
        { key: 'cf', label: 'CF', title: 'Shot attempts for, on ice', value: r => r.cf, total: (_, t) => t.cf },
        { key: 'ca', label: 'CA', title: 'Shot attempts against, on ice', value: r => r.ca, total: (_, t) => t.ca },
        { key: 'cfp', label: 'CF%', title: 'Shot attempt share', value: r => pct(r.cf, r.ca), fmt: f1p, total: (_, t) => pct(t.cf, t.ca) },
        { key: 'sf', label: 'SF', title: 'Shots on goal for', value: r => r.sf, total: (_, t) => t.sf },
        { key: 'sa', label: 'SA', title: 'Shots on goal against', value: r => r.sa, total: (_, t) => t.sa },
        { key: 'gf', label: 'GF', title: 'Goals for', value: r => r.gf, total: (_, t) => t.gf },
        { key: 'ga', label: 'GA', title: 'Goals against', value: r => r.ga, total: (_, t) => t.ga },
        { key: 'xgf', label: 'xGF', title: 'pony xG for', value: r => r.xgf, fmt: f2, model: true, total: (_, t) => t.xgf },
        { key: 'xga', label: 'xGA', title: 'pony xG against', value: r => r.xga, fmt: f2, model: true, total: (_, t) => t.xga },
        { key: 'xgfp', label: 'xGF%', title: 'pony xG share', value: r => pct(r.xgf, r.xga), fmt: f1p, model: true, total: (_, t) => pct(t.xgf, t.xga) },
        { key: 'xgd', label: 'xG±', title: 'xGF − xGA', value: r => r.xgf - r.xga, fmt: v => sgn(v), signed: true, total: (_, t) => t.xgf - t.xga },
    ],
    use: [
        { key: 'toi', label: 'TOI', title: 'Time on ice', value: r => r.toi, fmt: clockOf, total: (_, t) => t.toi },
        { key: 'toip', label: 'TOI%', title: 'Share of the game clock', value: r => r.toiPct, fmt: f1p },
        { key: 'ev', label: 'EV', title: 'Even-strength time', value: r => r.toiEv, fmt: clockOf, total: (_, t) => t.toiEv },
        { key: 'pp', label: 'PP', title: 'Power-play time', value: r => r.toiPp, fmt: clockOf, total: (_, t) => t.toiPp },
        { key: 'sh', label: 'SH', title: 'Shorthanded time', value: r => r.toiSh, fmt: clockOf, total: (_, t) => t.toiSh },
        { key: 'shf', label: 'SHF', title: 'Shifts', value: r => r.shifts },
        { key: 'qoc', label: 'QoC', title: 'Quality of competition: opponents’ average TOI share, weighted by time faced', value: r => r.qoc, fmt: f1p },
        { key: 'qot', label: 'QoT', title: 'Quality of teammates: linemates’ average TOI share, weighted by time together', value: r => r.qot, fmt: f1p },
    ],
};

function PairTable({ rows, title }: { rows: PairRow[]; title: string }) {
    const { m } = useGame();
    const hasXg = m.events.some(e => e.xg != null);
    return (
        <PinnedTable
            label={`${title} table`}
            head={
                    <tr>
                        <th scope="col" className={cn(HEAD_CELL, STICKY_EDGE, 'z-[4] h-6 min-w-[8.5rem] px-2 text-left md:min-w-[11rem]')}>
                            <span className="text-micro font-medium uppercase tracking-[0.1em] text-fg-3">{title}</span>
                        </th>
                        {PAIR_COLS.map(c => (
                            <HeaderCell key={c.key} label={c.label} title={c.title} dense className={cn(HEAD_CELL, 'min-w-[3.25rem]')} />
                        ))}
                    </tr>
            }
        >
                <tbody>
                    {rows.map(r => (
                        <tr key={r.player.id} className="group">
                            <th scope="row" className={cn(STICKY_EDGE, CELL_BG, 'z-[2] h-7 px-2 text-left font-normal shadow-[inset_0_-1px_0_var(--line)]', PIN_FIRST)}>
                                <span className="flex items-center gap-2">
                                    <Crest tri={m.teams[r.player.side].tri} size={16} className="h-4 w-4" />
                                    <PlayerLink id={r.player.id} className="truncate font-bold text-fg-1">
                                        <Name p={r.player} />
                                    </PlayerLink>
                                    <span className="text-micro text-fg-3">{r.player.pos}</span>
                                </span>
                            </th>
                            {PAIR_COLS.map(c => {
                                const v = cell(hasXg, c, r);
                                return (
                                    <td
                                        key={c.key}
                                        className={cn(CELL_BG, 'h-7 px-1.5 text-center shadow-[inset_0_-1px_0_var(--line)]', PIN_COL, v == null || v === 0 ? 'text-fg-3' : c.model ? 'text-model' : 'text-fg-1')}
                                    >
                                        {v == null ? '—' : c.fmt ? c.fmt(v) : v}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
        </PinnedTable>
    );
}

export function Skaters() {
    const { m } = useGame();
    const hasXg = m.events.some(e => e.xg != null);
    const [side, setSide] = React.useState<Side>('away');
    const [view, setView] = React.useState<View>('ind');
    const [strength, setStrength] = React.useState<PlayerStrength>('all');
    const [period, setPeriod] = React.useState<string>('all');
    const [sort, setSort] = React.useState<{ key: string; dir: SortDir }>({ key: 'toi', dir: 'desc' });
    const per = period === 'all' ? 'all' : Number(period);
    const rows = React.useMemo(() => skaterRows(m, side, strength, per), [m, side, strength, per]);
    const team = React.useMemo(() => teamOnIce(m, side, strength, per), [m, side, strength, per]);
    const pairView = view === 'comp' || view === 'mates';
    const [focus, setFocus] = React.useState<number | null>(null);
    const focusId = focus != null && rows.some(r => r.player.id === focus) ? focus : (rows[0]?.player.id ?? null);
    const pairs = React.useMemo(() => (pairView && focusId != null ? pairRows(m, focusId, strength, per) : null), [m, pairView, focusId, strength, per]);
    const cols = pairView ? COLS.ind : COLS[view];
    const periods = [...new Set(m.events.map(e => (e.period >= 4 ? 4 : e.period)))].sort();
    const col = cols.find(c => c.key === sort.key) ?? cols[0];
    const sorted = [...rows].sort((a, b) => {
        const va = cell(hasXg, col, a);
        const vb = cell(hasXg, col, b);
        if (va == null) return 1;
        if (vb == null) return -1;
        return sort.dir === 'desc' ? vb - va : va - vb;
    });

    const pairSelect = (id: string, className?: string) => (
        <select
            id={id}
            value={focusId ?? ''}
            onChange={e => setFocus(Number(e.target.value))}
            className={cn('h-8 min-w-0 max-w-[13rem] rounded-control border border-line bg-surface-1 px-2 text-caption uppercase tracking-wide text-fg-1 hover:border-line-strong coarse:h-11', className)}
        >
            {rows.map(r => (
                <option key={r.player.id} value={r.player.id}>
                    {playerName(r.player)}
                </option>
            ))}
        </select>
    );

    return (
        <GameSection id="skaters" title="Skaters">
            <div className="panel overflow-hidden max-lg:overflow-clip [@media(max-height:500px)]:overflow-clip">
                <ControlRow label="Skater table controls">
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
                    <Segmented
                        label="View"
                        size="sm"
                        value={view}
                        onChange={v => {
                            setView(v);
                            setSort({ key: 'toi', dir: 'desc' });
                        }}
                        optionClassName="px-2.5"
                        options={[
                            { value: 'ind', label: 'Individual' },
                            { value: 'ice', label: 'On ice' },
                            { value: 'use', label: 'Usage' },
                            { value: 'comp', label: 'Competition' },
                            { value: 'mates', label: 'Teammates' },
                        ]}
                    />
                    {pairView ? (
                        <>
                            <label className="sr-only" htmlFor="pair-player">
                                Skater
                            </label>
                            {pairSelect('pair-player', 'max-sm:hidden')}
                        </>
                    ) : null}
                    <Segmented
                        label="Strength"
                        size="sm"
                        value={strength}
                        onChange={setStrength}
                        optionClassName="px-2"
                        options={[
                            { value: 'all', label: 'All' },
                            { value: '5v5', label: '5v5' },
                            { value: 'ev', label: 'EV' },
                            { value: 'pp', label: 'PP' },
                            { value: 'sh', label: 'SH' },
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
                </ControlRow>
                {/* Phones: whose opponents / teammates these are, on its own line under the scrolling controls. */}
                {pairView ? (
                    <div className="border-b border-line px-card py-2 sm:hidden">
                        <label className="sr-only" htmlFor="pair-player-m">
                            Skater
                        </label>
                        {pairSelect('pair-player-m', 'w-full max-w-none')}
                    </div>
                ) : null}
                {pairView && pairs ? (
                    <PairTable rows={view === 'comp' ? pairs.opp : pairs.mates} title={view === 'comp' ? 'Opponent' : 'Teammate'} />
                ) : (
                <PinnedTable
                    label={`${m.teams[side].name} skaters`}
                    head={
                            <tr>
                                <th scope="col" className={cn(HEAD_CELL, STICKY_EDGE, 'z-[4] h-6 min-w-[8.5rem] px-2 text-left md:min-w-[11rem]')}>
                                    <span className="text-micro font-medium uppercase tracking-[0.1em] text-fg-3">Player</span>
                                </th>
                                {cols.map(c => (
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
                    }
                >
                        <tbody>
                            {sorted.map(r => (
                                <tr key={r.player.id} className="group">
                                    <th scope="row" className={cn(STICKY_EDGE, CELL_BG, 'z-[2] h-7 px-2 text-left font-normal shadow-[inset_0_-1px_0_var(--line)]', PIN_FIRST)}>
                                        <span className="flex items-center gap-2">
                                            <span className="w-6 text-right text-micro text-fg-3">{r.player.num ?? ''}</span>
                                            <PlayerLink id={r.player.id} className="truncate font-bold text-fg-1">
                                                <Name p={r.player} />
                                            </PlayerLink>
                                            <span className="text-micro text-fg-3">{r.player.pos}</span>
                                        </span>
                                    </th>
                                    {cols.map(c => {
                                        const v = cell(hasXg, c, r);
                                        return (
                                            <td
                                                key={c.key}
                                                className={cn(
                                                    CELL_BG,
                                                    'h-7 px-1.5 text-center shadow-[inset_0_-1px_0_var(--line)]', PIN_COL,
                                                    v == null || v === 0 ? 'text-fg-3' : c.signed ? (v > 0 ? 'text-pos' : 'text-neg') : c.model ? 'text-model' : 'text-fg-1',
                                                )}
                                            >
                                                {v == null ? '—' : c.fmt ? c.fmt(v) : v}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                        {/* Team row: sums where they add up, the team's own on-ice numbers, blank where a total means nothing. */}
                        <tfoot>
                            <tr>
                                <th scope="row" className={cn(STICKY_EDGE, CELL_BG, 'z-[2] h-8 px-2 text-left font-normal shadow-[inset_0_1px_0_var(--line-strong)]', PIN_FIRST)}>
                                    <span className="flex items-center gap-2">
                                        <Crest tri={m.teams[side].tri} size={18} className="ml-1 h-[18px] w-[18px]" />
                                        <span className="font-bold uppercase tracking-label text-fg-1">{m.teams[side].tri} total</span>
                                    </span>
                                </th>
                                {cols.map(c => {
                                    const v = c.total && !(c.model && !hasXg) ? c.total(rows, team) : null;
                                    return (
                                        <td
                                            key={c.key}
                                            className={cn(
                                                CELL_BG,
                                                'h-8 px-1.5 text-center font-semibold shadow-[inset_0_1px_0_var(--line-strong)]', PIN_COL,
                                                v == null ? 'text-fg-3' : c.signed ? (v > 0.0049 ? 'text-pos' : v < -0.0049 ? 'text-neg' : 'text-fg-2') : c.model ? 'text-model' : 'text-fg-1',
                                            )}
                                        >
                                            {v == null ? '' : c.fmt ? c.fmt(v) : Number.isInteger(v) ? v : v.toFixed(2)}
                                        </td>
                                    );
                                })}
                            </tr>
                        </tfoot>
                </PinnedTable>
                )}
            </div>
        </GameSection>
    );
}
