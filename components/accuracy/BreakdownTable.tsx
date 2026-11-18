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
/** The view selector scrolls sideways inside its row, so the expand-all button never wraps under it. */
const BAR = 'flex items-center gap-2';
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
 * with the day rows' numbers. The goalie view nests each club's starters under it, collapsed until opened.
 */
export function Breakdown({ rows, view, onView }: { rows: BreakdownRow[]; view: BreakdownView; onView: (v: BreakdownView) => void }) {
    const [sort, setSort] = React.useState<{ key: BreakdownSort; dir: 'asc' | 'desc' } | null>(null);
    const [openRows, setOpenRows] = React.useState<ReadonlySet<string>>(() => new Set());
    const headId = React.useId();
    const viewLabel = BREAKDOWN_VIEWS.find(v => v.value === view)?.label ?? '';
    const shown = React.useMemo(() => (sort ? sortBreakdown(rows, sort.key, sort.dir) : rows), [rows, sort]);
    const nested = shown.some(r => r.children?.length);
    const allOpen = nested && shown.every(r => !r.children?.length || openRows.has(r.key));

    const sortBy = (key: BreakdownSort) => setSort(s => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: firstDirection(key) }));
    const toggle = (key: string) => {
        const next = new Set(openRows);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setOpenRows(next);
    };

    return (
        <section aria-labelledby={headId} className={WRAP}>
            <h3 id={headId} className="heading-sub">
                Breakdown
            </h3>
            <div className={BAR}>
                <Segmented
                    label="Group by"
                    size="sm"
                    options={BREAKDOWN_VIEWS}
                    value={view}
                    onChange={v => {
                        setOpenRows(new Set());
                        onView(v);
                    }}
                    className="min-w-0"
                />
                {nested ? (
                    <button
                        type="button"
                        aria-label={allOpen ? 'Collapse all teams' : 'Expand all teams'}
                        title={allOpen ? 'Collapse all' : 'Expand all'}
                        onClick={() => setOpenRows(allOpen ? new Set() : new Set(shown.map(r => r.key)))}
                        className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-line-strong text-fg-2 transition-colors hover:border-brand hover:text-brand coarse:h-11 coarse:w-11"
                    >
                        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4">
                            <path
                                d={allOpen ? 'M4 7l4-4 4 4M4 13l4-4 4 4' : 'M4 3l4 4 4-4M4 9l4 4 4-4'}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </button>
                ) : null}
            </div>
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
                            {shown.map(r => {
                                const open = openRows.has(r.key);
                                return (
                                    <React.Fragment key={r.key}>
                                        <Row row={r} open={r.children?.length ? open : undefined} onToggle={() => toggle(r.key)} />
                                        {open ? r.children?.map(c => <Row key={c.key} row={c} child />) : null}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </ScrollRegion>
            )}
        </section>
    );
}

function Row({ row, open, onToggle, child }: { row: BreakdownRow; open?: boolean; onToggle?: () => void; child?: boolean }) {
    const s = row.summary;
    const d = vsMarket(s);
    const shownD = d == null ? null : signed(d, 3);
    const units = s.units == null ? null : fmtUnits(s.units);
    const name = row.tri ? (
        <span className="inline-flex items-center gap-2 font-bold text-fg-1">
            <Crest tri={row.tri} size={28} className="drop-shadow-none" />
            {row.label}
        </span>
    ) : (
        // A starter sits under its club's tricode (28px crest + gap).
        <span className={child ? 'pl-9 font-medium text-fg-2' : 'font-bold text-fg-1'}>{row.label}</span>
    );
    return (
        <tr>
            <th scope="row" className={cn('text-left', ROW_H)}>
                {open === undefined ? (
                    name
                ) : (
                    <button type="button" aria-expanded={open} onClick={onToggle} className="-mx-2 flex h-full w-[calc(100%+1rem)] items-center gap-2 px-2 text-left">
                        {name}
                        <span className="sr-only">, starting goalies</span>
                        <svg aria-hidden="true" viewBox="0 0 16 16" className={cn('h-3.5 w-3.5 text-fg-2 transition-transform', open && 'rotate-180')}>
                            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                )}
            </th>
            <td className={cn('text-right text-fg-2', ROW_H, WIDE)}>{fmtInt(s.picks)}</td>
            <td className={cn('text-right font-bold', child ? 'text-fg-2' : 'text-fg-1', ROW_H)}>
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
            <div className={cn(BAR, 'invisible')}>
                <Segmented label="Group by" size="sm" options={BREAKDOWN_VIEWS} value="team" onChange={() => {}} className="min-w-0" />
            </div>
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
