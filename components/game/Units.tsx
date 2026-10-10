'use client';

import * as React from 'react';
import { Crest } from '@/components/ui/crest';
import { Segmented } from '@/components/ui/segmented';
import { HeaderCell, type SortDir } from '@/components/teams-table/HeaderCell';
import { CELL_BG, HEAD_CELL, STICKY_EDGE } from '@/components/teams-table/table-style';
import { cn } from '@/lib/utils';
import { clockOf, periodLabel, teamOnIce, units, type TeamOnIce, type Unit, type UnitKind } from '@/lib/game/analytics';
import type { Side } from '@/lib/game/types';
import { ControlRow } from './ControlRow';
import { GameSection, sideTeams, useGame } from './GameContext';
import { JerseyNumber } from './Jersey';
import { PIN_COL, PinnedTable } from './PinnedTable';
import { TeamToggle } from '@/components/ui/team-toggle';
import { fmtNum } from '@/components/views/format';

interface Col {
    key: string;
    label: string;
    title: string;
    value: (u: Unit) => number | null;
    fmt?: (v: number) => string;
    signed?: boolean;
    model?: boolean;
    /** The team row: the team's own numbers at this table's strength; shifts and zone starts stay blank. */
    total?: (t: TeamOnIce) => number | null;
}

const pct = (a: number, b: number) => (a + b ? a / (a + b) : null);
const f2 = (v: number) => v.toFixed(2);
const f1p = (v: number) => `${(v * 100).toFixed(1)}%`;
const sgn = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;

const COLS: Col[] = [
    { key: 'toi', label: 'TOI', title: 'Time on ice together', value: u => u.toi, fmt: clockOf, total: t => t.toi },
    { key: 'stints', label: 'SHF', title: 'Shifts: separate times this unit was on the ice together', value: u => u.stints },
    { key: 'cf', label: 'CF', title: 'Shot attempts for', value: u => u.cf, total: t => t.cf },
    { key: 'ca', label: 'CA', title: 'Shot attempts against', value: u => u.ca, total: t => t.ca },
    { key: 'cfp', label: 'CF%', title: 'Shot attempt share', value: u => pct(u.cf, u.ca), fmt: f1p, total: t => pct(t.cf, t.ca) },
    { key: 'sf', label: 'SF', title: 'Shots on goal for', value: u => u.sf, total: t => t.sf },
    { key: 'sa', label: 'SA', title: 'Shots on goal against', value: u => u.sa, total: t => t.sa },
    { key: 'gf', label: 'GF', title: 'Goals for', value: u => u.gf, total: t => t.gf },
    { key: 'ga', label: 'GA', title: 'Goals against', value: u => u.ga, total: t => t.ga },
    { key: 'xgf', label: 'xGF', title: 'pony xG for', value: u => u.xgf, fmt: f2, model: true, total: t => t.xgf },
    { key: 'xga', label: 'xGA', title: 'pony xG against', value: u => u.xga, fmt: f2, model: true, total: t => t.xga },
    { key: 'xgfp', label: 'xGF%', title: 'pony xG share', value: u => pct(u.xgf, u.xga), fmt: f1p, model: true, total: t => pct(t.xgf, t.xga) },
    { key: 'xgd', label: 'xG±', title: 'xGF − xGA', value: u => u.xgf - u.xga, fmt: sgn, signed: true, total: t => t.xgf - t.xga },
    { key: 'oz', label: 'OZ', title: 'Shifts started on an offensive-zone faceoff', value: u => u.oz },
    { key: 'dz', label: 'DZ', title: 'Shifts started on a defensive-zone faceoff', value: u => u.dz },
    { key: 'ozp', label: 'OZS%', title: 'Offensive-zone share of O and D faceoff starts', value: u => pct(u.oz, u.dz), fmt: v => `${Math.round(v * 100)}%` },
];

const KINDS: { value: UnitKind; label: string; strength: string }[] = [
    { value: 'F', label: 'Lines', strength: '5v5' },
    { value: 'D', label: 'Pairs', strength: '5v5' },
    { value: 'PP', label: 'PP units', strength: 'Power play' },
    { value: 'PK', label: 'PK units', strength: 'Penalty kill' },
];

/** Where the header is a pinned copy (phones, short screens), the first column's body cells carry the header's widths. */
const PIN_FIRST = 'max-md:w-[10.5rem] max-md:min-w-[10.5rem] md:max-lg:min-w-[18rem] [@media(max-height:500px)]:max-md:w-[10.5rem] [@media(max-height:500px)]:max-md:min-w-[10.5rem] md:[@media(max-height:500px)]:min-w-[18rem]';

/** Under this the unit is a line change in passing, not a unit. */
const MIN_TOI = 30;
/** Most regular units a team can dress per kind; the cut is searched only up to here. */
const MAX_CORE: Record<UnitKind, number> = { F: 8, D: 6, PP: 4, PK: 4 };
/**
 * Units a team always dresses, so they stay regular however little they play: four forward lines
 * (a fourth line is a line, not a one-off) and three pairs.
 */
const MIN_CORE: Record<UnitKind, number> = { F: 4, D: 3, PP: 1, PK: 1 };
/** The time drop between neighbours (by TOI) must be at least this ratio to count as the fall-off. */
const DROP = 1.6;

/** How many units, by TOI, come before the steepest fall-off (all of them when nothing drops sharply). */
export function regularCount(tois: number[], maxCore: number): number {
    let best = tois.length;
    let bestR = DROP;
    for (let k = 2; k <= Math.min(tois.length - 1, maxCore); k++) {
        const r = tois[k - 1] / Math.max(1, tois[k]);
        if (r > bestR) {
            bestR = r;
            best = k;
        }
    }
    return best;
}

/** Forward lines, defence pairs and special-teams units: on-ice results while that exact group was out together. */
export function Units() {
    const { m, byId, colors } = useGame();
    const [side, setSide] = React.useState<Side>('away');
    const [kind, setKind] = React.useState<UnitKind>('F');
    const [period, setPeriod] = React.useState<string>('all');
    const [sort, setSort] = React.useState<{ key: string; dir: SortDir }>({ key: 'toi', dir: 'desc' });
    const per = period === 'all' ? 'all' : Number(period);
    // Regular vs occasional is a whole-game call, so a period view keeps the same lines up top.
    const regularKeys = React.useMemo(() => {
        const all = units(m, side, kind).filter(u => u.toi >= MIN_TOI);
        const core = all.slice(0, regularCount(all.map(u => u.toi), MAX_CORE[kind]));
        // Short of the minimum, the next most used units that share no player with those already in
        // (a real fourth line, not two lines' players mixed on a change).
        const used = new Set(core.flatMap(u => u.ids));
        for (const u of all) {
            if (core.length >= MIN_CORE[kind]) break;
            if (core.includes(u) || u.ids.some(id => used.has(id))) continue;
            core.push(u);
            u.ids.forEach(id => used.add(id));
        }
        return new Set(core.map(u => u.ids.join('-')));
    }, [m, side, kind]);
    const team = React.useMemo(() => teamOnIce(m, side, kind === 'PP' ? 'pp' : kind === 'PK' ? 'sh' : '5v5', per), [m, side, kind, per]);
    const all = React.useMemo(() => units(m, side, kind, per), [m, side, kind, per]);
    // A group on for a goal (either way) is listed however briefly it was together.
    const rows = React.useMemo(() => all.filter(u => u.toi >= MIN_TOI || u.gf || u.ga || regularKeys.has(u.ids.join('-'))), [all, regularKeys]);
    // Whatever the listed groups do not cover - groups together under MIN_TOI and time no one group was out for -
    // so the table adds up to the team row (a power play's goals often come off a quick change).
    const rest = React.useMemo(() => {
        const sum = (k: 'toi' | 'cf' | 'ca' | 'sf' | 'sa' | 'gf' | 'ga' | 'xgf' | 'xga') => Math.max(0, team[k] - rows.reduce((a, u) => a + u[k], 0));
        const r: TeamOnIce = { toi: sum('toi'), toiEv: 0, toiPp: 0, toiSh: 0, cf: sum('cf'), ca: sum('ca'), sf: sum('sf'), sa: sum('sa'), gf: sum('gf'), ga: sum('ga'), xgf: sum('xgf'), xga: sum('xga') };
        return r.toi >= 1 || r.cf || r.ca || r.gf || r.ga ? { r, n: all.length - rows.length } : null;
    }, [team, rows, all]);
    const periods = [...new Set(m.events.map(e => (e.period >= 4 ? 4 : e.period)))].sort();
    const col = COLS.find(c => c.key === sort.key) ?? COLS[0];
    const byToi = [...rows].sort((a, b) => b.toi - a.toi);
    const regular = new Set(byToi.filter(u => regularKeys.has(u.ids.join('-'))));
    const nRegular = regular.size;
    const cmp = (a: Unit, b: Unit) => {
        const va = col.value(a);
        const vb = col.value(b);
        if (va == null) return 1;
        if (vb == null) return -1;
        return sort.dir === 'desc' ? vb - va : va - vb;
    };
    // Regular units first, then the occasional ones (overlapping changes, one-off shifts), each sorted by the column.
    const sorted = [...byToi.filter(u => regular.has(u)).sort(cmp), ...byToi.filter(u => !regular.has(u)).sort(cmp)];
    // Forwards left to right C, L, R like a lineup card; D by number.
    const order = { C: 1, L: 0, R: 2, D: 3, G: 4 } as const;
    const kindLabel = KINDS.find(k => k.value === kind)!;
    // Name whose units are missing and why: a team with no power play (or penalty kill) yet, or none in the period.
    const tri = m.teams[side].tri;
    const live = m.state === 'live';
    const when = period === 'all' ? '' : ' this period';
    const emptyText =
        kind === 'PP'
            ? live ? `${tri} has not had a power play${when || ' yet'}` : `${tri} had no power play${when}`
            : kind === 'PK'
              ? live ? `${tri} has not killed a penalty${when || ' yet'}` : `${tri} took no penalty to kill${when}`
              : `No ${tri} ${kind === 'F' ? 'forward lines' : 'pairs'}${when || (live ? ' yet' : '')}`;

    return (
        <GameSection id="units" title="Units">
            <div className="panel overflow-hidden max-lg:overflow-clip [@media(max-height:500px)]:overflow-clip">
                <ControlRow label="Unit table controls">
                    <TeamToggle value={side} onChange={setSide} teams={sideTeams(m)} />
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
                </ControlRow>
                {sorted.length || rest ? (
                    <PinnedTable
                        label={`${m.teams[side].name} ${kindLabel.label.toLowerCase()}`}
                        head={
                                <tr>
                                    <th scope="col" className={cn(HEAD_CELL, STICKY_EDGE, 'z-[4] h-6 w-[10.5rem] min-w-[10.5rem] px-2 text-left md:w-auto md:min-w-[18rem]')}>
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
                        }
                    >
                            <tbody>
                                {sorted.map((u, i) => {
                                    const spot = !regular.has(u);
                                    const ps = u.ids
                                        .map(id => byId.get(id))
                                        .filter((p): p is NonNullable<typeof p> => p != null)
                                        .sort((a, b) => order[a.pos] - order[b.pos] || (a.num ?? 0) - (b.num ?? 0));
                                    return (
                                        <React.Fragment key={u.ids.join('-')}>
                                        {spot && i === nRegular && nRegular > 0 ? (
                                            <tr>
                                                <th scope="row" className={cn(STICKY_EDGE, CELL_BG, 'z-[2] h-9 px-2 pt-3 text-left align-bottom font-normal shadow-[inset_0_-1px_0_var(--line-strong)]', PIN_FIRST)}>
                                                    <span className="text-micro uppercase tracking-label text-fg-3">
                                                        Occasional · {byToi.length - nRegular} {byToi.length - nRegular === 1 ? 'group' : 'groups'}
                                                    </span>
                                                </th>
                                                <td colSpan={COLS.length} className={cn(CELL_BG, 'h-9 px-2 pt-3 shadow-[inset_0_-1px_0_var(--line-strong)]')}>
                                                </td>
                                            </tr>
                                        ) : null}
                                        <tr className="group">
                                            <th scope="row" className={cn(STICKY_EDGE, CELL_BG, 'z-[2] px-2 text-left font-normal shadow-[inset_0_-1px_0_var(--line)] max-md:py-1.5', PIN_FIRST, spot ? 'h-9' : 'h-11')}>
                                                {/* Phones: sweaters over the names (wrapped, small) so the pinned column stays narrow. */}
                                                <span className={cn('flex flex-col items-start gap-1 md:flex-row md:items-center md:gap-2.5', spot && 'opacity-50 transition-opacity group-hover:opacity-100')}>
                                                    <span className={cn('flex shrink-0 gap-1', spot ? 'max-md:[&>svg]:size-[22px]' : 'max-md:[&>svg]:size-[26px]')}>
                                                        {ps.map(p => (
                                                            <JerseyNumber key={p.id} tri={m.teams[side].tri} num={p.num} ring={colors[side]} size={spot ? 26 : 32} />
                                                        ))}
                                                    </span>
                                                    <span className="max-md:text-micro max-md:leading-tight md:truncate">
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
                                                            'px-1.5 text-center shadow-[inset_0_-1px_0_var(--line)]',
                                                            PIN_COL,
                                                            spot ? 'h-9' : 'h-11',
                                                            v == null || v === 0 ? 'text-fg-3' : c.signed ? (v > 0 ? 'text-pos' : 'text-neg') : c.model ? 'text-model' : 'text-fg-1',
                                                        )}
                                                    >
                                                        <span className={cn(spot && 'opacity-50 transition-opacity group-hover:opacity-100')}>{v == null ? '—' : c.fmt ? c.fmt(v) : fmtNum(v)}</span>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                        </React.Fragment>
                                    );
                                })}
                                {rest ? (
                                    <tr>
                                        <th scope="row" className={cn(STICKY_EDGE, CELL_BG, 'z-[2] h-9 px-2 text-left font-normal shadow-[inset_0_-1px_0_var(--line)]', PIN_FIRST)}>
                                            <span className="text-micro uppercase tracking-label text-fg-3" title={`Groups together under ${MIN_TOI} seconds with no goal, and time no single group was out for`}>
                                                {rest.n ? `Other ${rest.n} brief ${rest.n === 1 ? 'group' : 'groups'}` : 'Other time'}
                                            </span>
                                        </th>
                                        {COLS.map(c => {
                                            const v = c.total ? c.total(rest.r) : null;
                                            return (
                                                <td
                                                    key={c.key}
                                                    className={cn(
                                                        CELL_BG,
                                                        'h-9 px-1.5 text-center shadow-[inset_0_-1px_0_var(--line)]',
                                                        PIN_COL,
                                                        v == null || v === 0 ? 'text-fg-3' : c.signed ? (v > 0 ? 'text-pos' : 'text-neg') : c.model ? 'text-model' : 'text-fg-2',
                                                    )}
                                                >
                                                    {v == null ? '' : c.fmt ? c.fmt(v) : fmtNum(v)}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ) : null}
                            </tbody>
                            {/* Team row: the team's own numbers at this table's strength. */}
                            <tfoot>
                                <tr>
                                    <th scope="row" className={cn(STICKY_EDGE, CELL_BG, 'z-[2] h-9 px-2 text-left font-normal shadow-[inset_0_1px_0_var(--line-strong)]', PIN_FIRST)}>
                                        <span className="flex items-center gap-2">
                                            <Crest tri={m.teams[side].tri} size={18} className="ml-1 h-[18px] w-[18px]" />
                                            <span className="font-bold uppercase tracking-label text-fg-1">
                                                {m.teams[side].tri} {kind === 'PP' ? 'power play' : kind === 'PK' ? 'penalty kill' : '5v5'}
                                            </span>
                                        </span>
                                    </th>
                                    {COLS.map(c => {
                                        const v = c.total ? c.total(team) : null;
                                        return (
                                            <td
                                                key={c.key}
                                                className={cn(
                                                    CELL_BG,
                                                    'h-9 px-1.5 text-center font-semibold shadow-[inset_0_1px_0_var(--line-strong)]',
                                                    PIN_COL,
                                                    v == null ? 'text-fg-3' : c.signed ? (v > 0.0049 ? 'text-pos' : v < -0.0049 ? 'text-neg' : 'text-fg-2') : c.model ? 'text-model' : 'text-fg-1',
                                                )}
                                            >
                                                {v == null ? '' : c.fmt ? c.fmt(v) : fmtNum(v)}
                                            </td>
                                        );
                                    })}
                                </tr>
                            </tfoot>
                    </PinnedTable>
                ) : (
                    <p className="px-card py-6 text-center text-caption text-fg-3">{emptyText}</p>
                )}
            </div>
        </GameSection>
    );
}
