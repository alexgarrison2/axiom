'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { SortHeader } from '@/components/ui/sort-header';
import { Crest } from '@/components/ui/crest';
import { fmtInt, signed } from '@/components/views/format';
import { cn } from '@/lib/utils';
import { BREAKDOWN_VIEWS, firstDirection, sortBreakdown, type BreakdownRow, type BreakdownSort, type BreakdownView } from './breakdown';
import { fmtUnits } from './ledger-data';
import { vsMarket } from './summary';

/** One row height for every body row (44px on touch), shared with the loading placeholder so nothing shifts. */
const ROW_H = '!h-10 coarse:!h-11';
const HEAD_H = 'coarse:!h-11';
const WRAP = 'flex flex-col gap-2 pt-2';
/** Phones keep the record, hit rate and units, as the day rows do; the rest starts at sm. */
const WIDE = 'max-sm:hidden';

const COLUMNS: { key: BreakdownSort; label: string; title?: string; className?: string }[] = [
    { key: 'games', label: 'Games', className: WIDE },
    { key: 'right', label: 'Right' },
    { key: 'goals', label: 'Goals ±', title: 'Average miss on total goals', className: WIDE },
    { key: 'market', label: 'vs Mkt', title: 'Log loss, model minus market', className: WIDE },
    { key: 'confidence', label: 'Conf', title: 'Average confidence in the pick', className: WIDE },
    { key: 'units', label: 'Units' },
];

/**
 * The filtered games regrouped by a chosen view (team, weekday, goalie, …): one sortable row per group
 * with the day rows' numbers. Clubs and goalies carry their crest.
 */
export function Breakdown({ rows, view, onView }: { rows: BreakdownRow[]; view: BreakdownView; onView: (v: BreakdownView) => void }) {
    const [sort, setSort] = React.useState<{ key: BreakdownSort; dir: 'asc' | 'desc' } | null>(null);
    const headId = React.useId();
    const viewLabel = BREAKDOWN_VIEWS.find(v => v.value === view)?.label ?? '';
    const shown = React.useMemo(() => (sort ? sortBreakdown(rows, sort.key, sort.dir) : rows), [rows, sort]);

    const sortBy = (key: BreakdownSort) => setSort(s => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: firstDirection(key) }));

    return (
        <section aria-labelledby={headId} className={WRAP}>
            <h3 id={headId} className="heading-sub">
                Breakdown
            </h3>
            <Segmented label="Group by" size="sm" options={BREAKDOWN_VIEWS} value={view} onChange={onView} className="self-start" />
            {shown.length === 0 ? (
                <p className="label py-2">No matches</p>
            ) : (
                <ScrollRegion label="Breakdown table" className="panel">
                    <table className="table-dense">
                        <caption className="sr-only">The games shown, by {viewLabel.toLowerCase()}</caption>
                        <thead>
                            <tr>
                                {/* The first column puts the rows back in the view's own order. */}
                                <SortHeader direction={sort ? null : view === 'month' ? 'desc' : 'asc'} onSort={() => setSort(null)} className={HEAD_H}>
                                    {viewLabel}
                                </SortHeader>
                                {COLUMNS.map(c => (
                                    <React.Fragment key={c.key}>
                                        {c.key === 'right' ? (
                                            <th scope="col" className={cn('text-right', HEAD_H)}>
                                                Record
                                            </th>
                                        ) : null}
                                        <SortHeader align="right" title={c.title} direction={sort?.key === c.key ? sort.dir : null} onSort={() => sortBy(c.key)} className={cn(HEAD_H, c.className)}>
                                            {c.label}
                                        </SortHeader>
                                    </React.Fragment>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {shown.map(r => (
                                <Row key={r.key} row={r} />
                            ))}
                        </tbody>
                    </table>
                </ScrollRegion>
            )}
        </section>
    );
}

function Row({ row }: { row: BreakdownRow }) {
    const s = row.summary;
    const d = vsMarket(s);
    const shownD = d == null ? null : signed(d, 3);
    const units = s.units == null ? null : fmtUnits(s.units);
    return (
        <tr>
            <th scope="row" className={cn('text-left', ROW_H)}>
                <span className="inline-flex items-center gap-2 font-bold text-fg-1">
                    {row.tri ? <Crest tri={row.tri} size={28} alt={row.label === row.tri ? '' : row.tri} className="drop-shadow-none" /> : null}
                    {row.label}
                </span>
            </th>
            <td className={cn('text-right text-fg-2', ROW_H, WIDE)}>{fmtInt(s.picks)}</td>
            <td className={cn('text-right font-bold text-fg-1', ROW_H)}>
                {fmtInt(s.hits)}-{fmtInt(s.picks - s.hits)}
            </td>
            <td className={cn('text-right text-fg-1', ROW_H)}>{s.accuracy == null ? '—' : `${(s.accuracy * 100).toFixed(1)}%`}</td>
            <td className={cn('text-right text-fg-2', ROW_H, WIDE)}>{s.totalGoalsMae == null ? '—' : s.totalGoalsMae.toFixed(2)}</td>
            <td className={cn('text-right', d == null || shownD?.startsWith('±') ? 'text-fg-2' : d < 0 ? 'text-pos' : 'text-neg', ROW_H, WIDE)}>
                {shownD ?? '—'}
                {d == null ? null : <span className="sr-only">{d < 0 ? ', better than the market' : d > 0 ? ', worse than the market' : ''}</span>}
            </td>
            <td className={cn('text-right text-fg-2', ROW_H, WIDE)}>{s.avgConfidence == null ? '—' : `${s.avgConfidence.toFixed(1)}%`}</td>
            <td className={cn('text-right font-bold', units == null || units.startsWith('±') ? 'text-fg-2' : (s.units as number) > 0 ? 'text-pos' : 'text-neg', ROW_H)}>{units ?? '—'}</td>
        </tr>
    );
}

/** Loading placeholder with the table's own box model (toolbar, header, one row per expected group). */
export function BreakdownSkeleton({ rows }: { rows: number }) {
    if (!rows) return null;
    return (
        <div aria-hidden="true" className={cn(WRAP, 'pointer-events-none')}>
            <span className="heading-sub invisible">Breakdown</span>
            <Segmented label="Group by" size="sm" options={BREAKDOWN_VIEWS} value="team" onChange={() => {}} className="invisible self-start" />
            <div className="panel">
                <table className="table-dense">
                    <thead>
                        <tr>
                            <th className={HEAD_H} />
                        </tr>
                    </thead>
                    <tbody>
                        {Array.from({ length: rows }, (_, i) => (
                            <tr key={i}>
                                <td className={ROW_H} />
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
