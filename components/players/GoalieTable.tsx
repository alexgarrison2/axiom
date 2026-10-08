'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Crest } from '@/components/ui/crest';
import { Segmented } from '@/components/ui/segmented';
import { HeaderCell, type SortDir } from '@/components/teams-table/HeaderCell';
import { emphasisMap, type Better } from '@/components/teams-table/columns';
import { HEAD_CELL, STICKY_EDGE } from '@/components/teams-table/table-style';
import { cn } from '@/lib/utils';
import type { GoalieRow } from '@/lib/goalies';

/**
 * The Goalies table: results (record, SV%, GAA, high-danger SV%), goals saved
 * above expected with a last-10 tape, consistency (quality and really bad
 * starts) and the model rating. Bold / dim mark the top and bottom five among
 * the qualified goalies; rows open the goalie's page.
 */

const sg = (v: number, d = 2) => {
    const r = Number(v.toFixed(d));
    return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(d)}`;
};
const p3 = (v: number) => v.toFixed(3).replace(/^0/, '');

interface Col {
    key: string;
    label: string;
    title: string;
    group: string;
    better: Better;
    value: (r: GoalieRow) => number;
    cell?: (r: GoalieRow) => React.ReactNode;
    format?: (v: number) => string;
    width: number;
    left?: boolean;
    sign?: number;
}

const COLS: Col[] = [
    { key: 'rk', label: 'Rk', title: 'Model rank', group: '', better: 'none', value: () => NaN, width: 48, left: true },
    { key: 'gp', label: 'GP', title: 'Games played', group: 'Record', better: 'none', value: r => r.gp, format: v => String(v), width: 52 },
    { key: 'rec', label: 'W–L–OT', title: 'Wins – regulation losses – OT/SO losses', group: 'Record', better: 'none', value: r => r.w, cell: r => `${r.w}–${r.l}–${r.o}`, width: 84 },
    { key: 'sv', label: 'SV%', title: 'Save percentage', group: 'Results', better: 'high', value: r => (r.sa ? (r.sa - r.ga) / r.sa : NaN), format: p3, width: 64 },
    { key: 'gaa', label: 'GAA', title: 'Goals against per 60 minutes', group: 'Results', better: 'low', value: r => r.gaa ?? NaN, format: v => v.toFixed(2), width: 60 },
    { key: 'hd', label: 'HD SV%', title: 'High-danger save percentage', group: 'Results', better: 'high', value: r => (r.hdSa ? (r.hdSa - r.hdGa) / r.hdSa : NaN), format: p3, width: 72 },
    { key: 'gsax', label: 'GSAx', title: 'Goals saved above expected', group: 'Saved above expected', better: 'high', value: r => r.gsax, format: v => sg(v, 1), width: 64, sign: 0.5 },
    { key: 'pg', label: 'Per game', title: 'GSAx per game', group: 'Saved above expected', better: 'high', value: r => r.gsax / r.gp, format: v => sg(v, 2), width: 76 },
    { key: 'l10', label: 'Last 10', title: 'GSAx each of his last 10 games', group: 'Saved above expected', better: 'none', value: () => NaN, cell: r => <Tape vals={r.trend} />, width: 100, left: true },
    { key: 'qs', label: 'Quality starts', title: 'Share of starts with SV% ≥ .903 (or ≥ .885 on 20 shots or fewer)', group: 'Consistency', better: 'high', value: r => (r.starts ? r.qs / r.starts : NaN), cell: r => (r.starts ? <QsBar v={r.qs / r.starts} /> : null), width: 120, left: true },
    { key: 'rbs', label: 'Bad starts', title: 'Starts with SV% under .850', group: 'Consistency', better: 'low', value: r => r.rbs, format: v => String(v), width: 84 },
    { key: 'model', label: 'GSAx / game', title: 'Model rating: GSAx per game, shrunk across seasons', group: 'Model', better: 'high', value: r => r.model ?? NaN, cell: r => (r.model != null ? <ModelBar v={r.model} /> : null), width: 140, left: true },
];

function Tape({ vals }: { vals: number[] }) {
    const w = vals.length * 8;
    return (
        <svg width={w} height={24} viewBox={`0 0 ${w} 24`} className="inline-block align-middle" aria-label={vals.map(v => sg(v)).join(', ')} role="img">
            <line x1={0} x2={w} y1={12.5} y2={12.5} className="stroke-line-strong" />
            {vals.map((v, i) => {
                const h = Math.max(2, Math.min(12, Math.abs(v) * 5));
                return <rect key={i} x={i * 8} y={v >= 0 ? 12 - h : 13} width={6} height={h} rx={1} className={v >= 0 ? 'fill-pos/80' : 'fill-neg/80'} />;
            })}
        </svg>
    );
}

function QsBar({ v }: { v: number }) {
    return (
        <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="relative block h-1.5 w-14 overflow-hidden rounded-[2px] bg-line">
                <span className="absolute inset-y-0 left-0 bg-fg-1/55" style={{ width: `${v * 100}%` }} />
            </span>
            {Math.round(v * 100)}%
        </span>
    );
}

function ModelBar({ v }: { v: number }) {
    const w = Math.min(1, Math.abs(v) / 0.4) * 50;
    return (
        <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="relative block h-1.5 w-20 rounded-[2px] bg-line">
                <span className="absolute -inset-y-[3px] left-1/2 w-px bg-fg-3" />
                <span className="absolute inset-y-0 rounded-[2px] bg-model" style={v >= 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }} />
            </span>
            <b className="min-w-[5ch] text-right font-bold text-model">{sg(v)}</b>
        </span>
    );
}

export function GoalieTable({ rows: all, defaultMin }: { rows: GoalieRow[]; defaultMin: number }) {
    const router = useRouter();
    const [minGp, setMinGp] = React.useState<'q' | 'all'>(defaultMin > 1 ? 'q' : 'all');
    const [sort, setSort] = React.useState<{ key: string; dir: SortDir }>({ key: 'model', dir: 'desc' });
    const rows = React.useMemo(() => all.filter(r => minGp === 'all' || r.gp >= defaultMin), [all, minGp, defaultMin]);
    const rank = React.useMemo(() => {
        const m = new Map<number, number>();
        [...rows].filter(r => r.model != null).sort((a, b) => b.model! - a.model!).forEach((r, i) => m.set(r.id, i + 1));
        return m;
    }, [rows]);
    const emph = React.useMemo(() => new Map(COLS.map(c => [c.key, emphasisMap(rows.map(r => [String(r.id), c.value(r)] as const), c.better)])), [rows]);
    const col = COLS.find(c => c.key === sort.key) ?? COLS[COLS.length - 1];
    const val = (r: GoalieRow) => (col.key === 'rk' ? (rank.get(r.id) ?? NaN) : col.value(r));
    const sorted = [...rows].sort((a, b) => {
        const va = val(a);
        const vb = val(b);
        if (!Number.isFinite(va)) return 1;
        if (!Number.isFinite(vb)) return -1;
        return sort.dir === 'desc' ? vb - va : va - vb;
    });
    const groups: { name: string; n: number }[] = [];
    for (const c of COLS) {
        const last = groups[groups.length - 1];
        if (last && last.name === c.group) last.n++;
        else groups.push({ name: c.group, n: 1 });
    }
    const groupEnd = (i: number) => i === COLS.length - 1 || COLS[i + 1].group !== COLS[i].group;
    const onSort = (c: Col) =>
        setSort(s => (s.key === c.key ? { key: c.key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: c.key, dir: c.better === 'low' || c.key === 'rk' ? 'asc' : 'desc' }));

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-micro text-fg-3">
                <span>
                    <b className="font-semibold text-fg-1">Bold</b> top 5 · dim bottom 5
                </span>
                <span>{rows.length} goalies</span>
                <span className="ml-auto">
                    <Segmented
                        label="Games played"
                        size="sm"
                        value={minGp}
                        onChange={setMinGp}
                        options={[
                            { value: 'q', label: `${defaultMin}+ GP` },
                            { value: 'all', label: 'All' },
                        ]}
                    />
                </span>
            </div>
            <div className="-mx-4 overflow-x-auto border-y border-line bg-surface-1 md:mx-0 md:rounded-card md:border-x">
                <table className="w-full border-separate border-spacing-0 text-caption tabular-nums [--team-col:200px] max-md:[--team-col:156px]">
                    <colgroup>
                        <col style={{ width: COLS[0].width }} />
                        <col style={{ width: 'var(--team-col)' }} />
                        {COLS.slice(1).map(c => (
                            <col key={c.key} style={{ width: c.width }} />
                        ))}
                    </colgroup>
                    <thead>
                        <tr>
                            <td className={cn(HEAD_CELL, 'h-6')} />
                            <td className={cn(HEAD_CELL, STICKY_EDGE, 'z-[4] h-6')} />
                            {groups.slice(1).map(g => (
                                <th key={g.name} scope="colgroup" colSpan={g.n} className={cn(HEAD_CELL, 'h-6 border-r border-r-line-strong px-2.5 text-left')}>
                                    <span className="whitespace-nowrap text-micro font-semibold uppercase tracking-label text-fg-2">{g.name}</span>
                                </th>
                            ))}
                        </tr>
                        <tr>
                            <HeaderCell label="Rk" title="Model rank" align="left" caseless direction={sort.key === 'rk' ? sort.dir : null} onSort={() => onSort(COLS[0])} className={cn(HEAD_CELL, 'top-6 border-b-line-strong')} />
                            <th scope="col" className={cn(HEAD_CELL, STICKY_EDGE, 'top-6 z-[4] h-8 border-b-line-strong px-2.5 text-left')}>
                                <span className="text-micro font-medium tracking-[0.04em] text-fg-3">Goalie</span>
                            </th>
                            {COLS.slice(1).map((c, j) => (
                                <HeaderCell
                                    key={c.key}
                                    label={c.label}
                                    title={c.title}
                                    caseless
                                    align={c.left ? 'left' : 'right'}
                                    direction={c.key === 'l10' ? undefined : sort.key === c.key ? sort.dir : null}
                                    onSort={c.key === 'l10' ? undefined : () => onSort(c)}
                                    className={cn(HEAD_CELL, 'top-6 border-b-line-strong', groupEnd(j + 1) && 'border-r border-r-line-strong', sort.key === c.key && 'shadow-[inset_0_-2px_0_rgb(var(--brand-rgb))]')}
                                />
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map(r => (
                            <tr
                                key={r.id}
                                className="group cursor-pointer"
                                onClick={e => {
                                    if (!(e.target as HTMLElement).closest('a')) router.push(`/players/${r.id}`);
                                }}
                            >
                                <td className="lt-cell h-11 text-left text-body font-bold text-fg-1">{rank.get(r.id) ?? '—'}</td>
                                <th scope="row" className={cn('lt-cell h-11 text-left font-normal', STICKY_EDGE, 'z-[2]')}>
                                    <Link href={`/players/${r.id}`} prefetch={false} className="flex items-center gap-2.5 group-hover:text-brand">
                                        <span className="block h-8 w-8 shrink-0 overflow-hidden rounded-full border border-line-strong bg-surface-2">
                                            {/* eslint-disable-next-line @next/next/no-img-element -- NHL headshots are pre-sized PNGs */}
                                            {r.headshot ? <img src={r.headshot} alt="" width={32} height={32} loading="lazy" className="headshot h-full w-full" /> : null}
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block truncate text-body font-semibold text-fg-1 group-hover:text-inherit">{r.name}</span>
                                            <span className="flex items-center gap-1 text-micro text-fg-3">
                                                <Crest tri={r.team} size={16} className="h-4 w-4 drop-shadow-none" />
                                                {r.team}
                                            </span>
                                        </span>
                                    </Link>
                                </th>
                                {COLS.slice(1).map((c, j) => {
                                    const v = c.value(r);
                                    const e = emph.get(c.key)?.get(String(r.id));
                                    const body = c.cell ? c.cell(r) : Number.isFinite(v) && c.format ? c.format(v) : null;
                                    return (
                                        <td
                                            key={c.key}
                                            className={cn(
                                                'lt-cell h-11',
                                                c.left ? 'text-left' : 'text-right',
                                                groupEnd(j + 1) && 'border-r border-r-line-strong',
                                                e === 'hi' && 'font-semibold text-fg-1',
                                                e === 'lo' && 'text-fg-3',
                                                c.sign != null && Number.isFinite(v) && (v > c.sign ? 'text-pos' : v < -c.sign ? 'text-neg' : ''),
                                            )}
                                        >
                                            {body ?? <span className="text-fg-disabled">—</span>}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
