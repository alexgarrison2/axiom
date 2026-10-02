'use client';

import * as React from 'react';
import Link from 'next/link';
import { Segmented } from '@/components/ui/segmented';
import { Sparkline } from '@/components/ui/kpi-tile';
import { PageHeading } from '@/components/ui/page-heading';
import { Crest } from '@/components/ui/crest';
import { fmtSimPct, signed } from '@/components/views/format';
import { cn } from '@/lib/utils';
import { compareStandings, DIVISIONS_BY_CONF, type Conference, type StandingsRow } from './model';

type View = 'wildcard' | 'division' | 'league';

const VIEW_OPTIONS: { value: View; label: string }[] = [
    { value: 'wildcard', label: 'Wild card' },
    { value: 'division', label: 'Division' },
    { value: 'league', label: 'League' },
];

interface Group {
    key: string;
    /** Short label row above the group (null = no label row). */
    title: string | null;
    rows: StandingsRow[];
    /** Draw the playoff line after this many rows (null = none). */
    cutAfter: number | null;
}

interface Block {
    key: string;
    title: string;
    groups: Group[];
}

function blocksFor(view: View, rows: StandingsRow[]): Block[] {
    const sorted = [...rows].sort(compareStandings);
    if (view === 'league') return [{ key: 'league', title: 'League', groups: [{ key: 'league', title: null, rows: sorted, cutAfter: null }] }];
    const confs: Conference[] = ['East', 'West'];
    return confs.map(conf => {
        const [d1, d2] = DIVISIONS_BY_CONF[conf];
        if (view === 'division') {
            return {
                key: conf,
                title: conf,
                groups: [d1, d2].map(div => ({ key: div, title: div, rows: sorted.filter(r => r.division === div), cutAfter: 3 })),
            };
        }
        const top1 = sorted.filter(r => r.division === d1).slice(0, 3);
        const top2 = sorted.filter(r => r.division === d2).slice(0, 3);
        const inTop = new Set([...top1, ...top2].map(r => r.tri));
        const wc = sorted.filter(r => r.conference === conf && !inTop.has(r.tri));
        return {
            key: conf,
            title: conf,
            groups: [
                { key: `${conf}-${d1}`, title: d1, rows: top1, cutAfter: null },
                { key: `${conf}-${d2}`, title: d2, rows: top2, cutAfter: null },
                { key: `${conf}-wc`, title: 'Wild card', rows: wc, cutAfter: 2 },
            ],
        };
    });
}

export interface StandingsTableProps {
    rows: StandingsRow[];
    showProjections: boolean;
    /** Heading-row status labels (sim count, stamp). Phones: their own line under the heading. */
    meta?: React.ReactNode;
    /** Heading-row link chip, far right (the playoff archive). */
    link?: React.ReactNode;
}

export function StandingsTable({ rows, showProjections, meta, link }: StandingsTableProps) {
    const [view, setView] = React.useState<View>('wildcard');
    const blocks = React.useMemo(() => blocksFor(view, rows), [view, rows]);
    const full = view === 'league';
    // Movement columns appear once the history has at least one day of change.
    const cols = React.useMemo<MoveCols>(
        () => ({ d24: rows.some(r => r.delta24 != null), trend: rows.some(r => r.trend.length > 1) }),
        [rows],
    );

    // One shared points axis so the 80% bands compare across tables.
    const domain = React.useMemo<[number, number]>(() => {
        const lo = Math.min(...rows.map(r => r.proj?.p10 ?? Infinity));
        const hi = Math.max(...rows.map(r => r.proj?.p90 ?? -Infinity));
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [60, 120];
        return [Math.floor(lo / 5) * 5 - 2, Math.ceil(hi / 5) * 5 + 2];
    }, [rows]);

    return (
        <div className="flex flex-col gap-3">
            <PageHeading
                title="Standings"
                actions={
                    <>
                        <Segmented label="Standings view" size="sm" options={VIEW_OPTIONS} value={view} onChange={setView} className="hidden sm:inline-flex" />
                        {meta || link ? (
                            <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-right">
                                {meta ? <div className="hidden flex-wrap items-center justify-end gap-x-3 gap-y-1 sm:flex">{meta}</div> : null}
                                {link}
                            </div>
                        ) : null}
                    </>
                }
            />
            {meta ? <div className="-mt-1 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-right sm:hidden">{meta}</div> : null}
            <Segmented label="Standings view" size="sm" block options={VIEW_OPTIONS} value={view} onChange={setView} className="sm:hidden" />
            <div className={cn('grid gap-4', !full && 'xl:grid-cols-2')}>
                {blocks.map(b => (
                    <ConferenceTable key={b.key} block={b} showProjections={showProjections} domain={domain} full={full} cols={cols} />
                ))}
            </div>
        </div>
    );
}

const cell = 'px-1.5 sm:px-2';
/** Responsive visibility per column, shared by the header, the rows and the group label rows. */
const GP_VIS = 'hidden sm:table-cell';
const recVis = (proj: boolean) => (proj ? 'hidden md:table-cell' : 'hidden sm:table-cell');
const WIDE_VIS = 'hidden lg:table-cell';
const D24_VIS = 'hidden md:table-cell';

/** Which movement columns have data (24H change, 30D sparkline). */
interface MoveCols {
    d24: boolean;
    trend: boolean;
}

function ConferenceTable({
    block,
    showProjections,
    domain,
    full,
    cols,
}: {
    block: Block;
    showProjections: boolean;
    domain: [number, number];
    full: boolean;
    cols: MoveCols;
}) {
    const rec = recVis(showProjections);
    return (
        <section aria-label={`${block.title} standings`} className="panel min-w-0 overflow-hidden">
            <table className="table-dense table-fixed">
                <caption className="border-b border-line px-3 py-2 text-left">
                    <span className="heading-sub">{block.title}</span>
                </caption>
                <thead>
                    <tr>
                        <th scope="col" className={cn(cell, 'w-7 text-right')}>
                            <abbr title="Rank" className="no-underline">#</abbr>
                        </th>
                        <th scope="col" className={cn(cell, 'w-[4.75rem] text-left sm:w-24', full && 'lg:w-44')}>Team</th>
                        <th scope="col" className={cn(cell, GP_VIS, 'w-9 text-right')}>
                            <abbr title="Games played" className="no-underline">GP</abbr>
                        </th>
                        <th scope="col" className={cn(cell, rec, 'w-[4.5rem] text-right')}>
                            <abbr title="Wins, losses, overtime losses" className="no-underline">W-L-O</abbr>
                        </th>
                        <th scope="col" className={cn(cell, 'w-10 text-right')}>
                            <abbr title="Points" className="no-underline">PTS</abbr>
                        </th>
                        {showProjections ? (
                            <>
                                <th scope="col" className={cn(cell, 'w-11 text-right sm:w-28 sm:text-left')}>
                                    <span className="sm:inline-block sm:w-7 sm:text-right">
                                        <abbr title="Projected points, with the 80% range of final points" className="no-underline">Proj</abbr>
                                    </span>
                                </th>
                                <th scope="col" className={cn(cell, 'w-[5.5rem] text-left sm:w-32')}>
                                    <span className="inline-block w-11 text-right">
                                        <abbr title="Makes the playoffs" className="no-underline">PO%</abbr>
                                    </span>
                                </th>
                                {cols.d24 ? (
                                    <th scope="col" className={cn(cell, D24_VIS, 'w-14 text-right')}>
                                        <abbr title="Playoff odds change since yesterday" className="no-underline">24H</abbr>
                                    </th>
                                ) : null}
                                {full && cols.trend ? (
                                    <th scope="col" className={cn(cell, WIDE_VIS, 'w-24 text-right')}>
                                        <abbr title="Playoff odds, last 30 days" className="no-underline">30D</abbr>
                                    </th>
                                ) : null}
                                {full ? (
                                    <th scope="col" className={cn(cell, WIDE_VIS, 'w-14 text-right')}>
                                        <abbr title="Wins the division" className="no-underline">Div</abbr>
                                    </th>
                                ) : null}
                                <th scope="col" className={cn(cell, 'w-12 text-right')}>
                                    <abbr title="Wins the Stanley Cup" className="no-underline">Cup</abbr>
                                </th>
                            </>
                        ) : null}
                    </tr>
                </thead>
                {block.groups.map(g => (
                        <tbody key={g.key}>
                            {g.title ? (
                                <tr className="[&>*]:!h-7 [&>*]:border-b [&>*]:border-line [&>*]:!bg-transparent">
                                    <th scope="colgroup" colSpan={2} className="px-3 text-left align-bottom">
                                        <span className="label">{g.title}</span>
                                    </th>
                                    <td className={GP_VIS} />
                                    <td className={rec} />
                                    <td />
                                    {showProjections ? (
                                        <>
                                            <td />
                                            <td />
                                            {cols.d24 ? <td className={D24_VIS} /> : null}
                                            {full && cols.trend ? <td className={WIDE_VIS} /> : null}
                                            {full ? <td className={WIDE_VIS} /> : null}
                                            <td />
                                        </>
                                    ) : null}
                                </tr>
                            ) : null}
                            {g.rows.map((r, i) => (
                                <Row
                                    key={r.tri}
                                    row={r}
                                    rank={i + 1}
                                    showProjections={showProjections}
                                    domain={domain}
                                    full={full}
                                    cols={cols}
                                    cut={g.cutAfter != null && i === g.cutAfter && i > 0}
                                />
                            ))}
                        </tbody>
                ))}
            </table>
        </section>
    );
}

function Row({
    row: r,
    rank,
    showProjections,
    domain,
    full,
    cols,
    cut,
}: {
    row: StandingsRow;
    rank: number;
    showProjections: boolean;
    domain: [number, number];
    full: boolean;
    cols: MoveCols;
    /** Draw the playoff line above this row. */
    cut: boolean;
}) {
    const p = r.proj;
    return (
        <tr className={cn(cut && '[&>*]:border-t [&>*]:border-dashed [&>*]:border-t-brand/70')}>
            <td className={cn(cell, 'text-right text-fg-3')}>
                {cut ? <span className="sr-only">Playoff line. </span> : null}
                {rank}
            </td>
            <th scope="row" className={cn(cell, 'text-left font-normal')}>
                <Link href={`/teams/${r.tri}`} prefetch={false} className="group inline-flex min-h-8 items-center gap-2 coarse:min-h-11">
                    <Crest tri={r.tri} size={26} className="drop-shadow-none" />
                    <span className="font-bold text-fg-1 group-hover:text-brand">{r.tri}</span>
                    {full ? <span className="hidden truncate text-fg-3 lg:inline">{r.short}</span> : null}
                </Link>
            </th>
            <td className={cn(cell, GP_VIS, 'text-right text-fg-2')}>{r.gp}</td>
            <td className={cn(cell, recVis(showProjections), 'text-right text-fg-2')}>
                {r.w}-{r.l}-{r.otl}
            </td>
            <td className={cn(cell, 'text-right font-bold text-fg-1')}>{r.pts}</td>
            {showProjections ? (
                <>
                    <td className={cell}>{p ? <ProjCell avg={p.avgPoints} lo={p.p10} hi={p.p90} domain={domain} /> : <Dash />}</td>
                    <td className={cell}>{p ? <OddsBar pct={p.playoffPct} /> : <Dash />}</td>
                    {cols.d24 ? (
                        <td className={cn(cell, D24_VIS, 'text-right')}>
                            <Delta value={r.delta24} />
                        </td>
                    ) : null}
                    {full && cols.trend ? (
                        <td className={cn(cell, WIDE_VIS)}>
                            <div className="flex justify-end">
                                {r.trend.length > 1 ? (
                                    <>
                                        <Sparkline values={r.trend} width={64} height={18} />
                                        <span className="sr-only">
                                            Playoff odds over the last {r.trend.length} days: from {fmtSimPct(r.trend[0])} to {fmtSimPct(r.trend[r.trend.length - 1])}
                                        </span>
                                    </>
                                ) : (
                                    <Dash />
                                )}
                            </div>
                        </td>
                    ) : null}
                    {full ? <td className={cn(cell, WIDE_VIS, 'text-right text-fg-2')}>{p ? fmtSimPct(p.divisionPct) : <Dash />}</td> : null}
                    <td className={cn(cell, 'text-right text-fg-2')}>{p ? fmtSimPct(p.cupPct) : <Dash />}</td>
                </>
            ) : null}
        </tr>
    );
}

function Dash() {
    return (
        <span className="text-fg-3">
            <span aria-hidden="true">—</span>
            <span className="sr-only">Not available</span>
        </span>
    );
}

function ProjCell({ avg, lo, hi, domain }: { avg: number; lo: number; hi: number; domain: [number, number] }) {
    const [d0, d1] = domain;
    const x = (v: number) => `${Math.min(100, Math.max(0, ((v - d0) / (d1 - d0)) * 100))}%`;
    return (
        <div className="flex items-center justify-end gap-2 sm:justify-start">
            <span className="w-7 shrink-0 text-right font-semibold text-fg-1">{Math.round(avg)}</span>
            <span className="relative hidden h-2 flex-1 sm:block" aria-hidden="true">
                <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
                <span className="absolute inset-y-0 rounded-[2px] bg-brand/20 ring-1 ring-inset ring-brand/45" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />
                <span className="absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-brand" style={{ left: x(avg) }} />
            </span>
            <span className="sr-only">
                , 80% range {Math.round(lo)} to {Math.round(hi)} points
            </span>
        </div>
    );
}

/** Playoff odds: mono % + a thin neon bar (full = 100%). */
export function OddsBar({ pct }: { pct: number }) {
    const w = Math.max(0, Math.min(100, pct));
    return (
        <div className="flex items-center gap-2">
            <span className="w-11 shrink-0 text-right font-bold text-fg-1">{fmtSimPct(pct)}</span>
            <span aria-hidden="true" className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-track">
                <span
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand/35 to-brand"
                    style={{ width: `${Math.max(2, w)}%` }}
                />
            </span>
        </div>
    );
}

function Delta({ value }: { value: number | null }) {
    if (value == null) return <Dash />;
    const r = Number(value.toFixed(1));
    if (r === 0) return <span className="text-fg-3">±0.0</span>;
    const up = r > 0;
    return (
        <span className={cn('inline-flex items-center gap-0.5 font-semibold', up ? 'text-pos' : 'text-neg')}>
            <span aria-hidden="true">{up ? '▲' : '▼'}</span>
            <span className="sr-only">{up ? 'up' : 'down'} </span>
            {signed(r, 1).replace(/^[+−]/, '')}
        </span>
    );
}

export default StandingsTable;
