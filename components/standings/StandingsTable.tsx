'use client';

import * as React from 'react';
import Link from 'next/link';
import { Segmented } from '@/components/ui/segmented';
import { Sparkline } from '@/components/ui/kpi-tile';
import { InfoTip } from '@/components/ui/info-tip';
import { TeamLogo } from '@/components/views/TeamLogo';
import { fmtSimPct, pctTone, signed } from '@/components/views/format';
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
    title: string;
    rows: StandingsRow[];
    /** Draw the playoff line after this many rows (null = none). */
    cutAfter: number | null;
    cutLabel?: string;
    /** Rank offset for the # column. */
    startRank?: number;
}

function groupsFor(view: View, rows: StandingsRow[]): { heading?: string; groups: Group[] }[] {
    const sorted = [...rows].sort(compareStandings);
    if (view === 'league') {
        return [{ groups: [{ key: 'league', title: 'League', rows: sorted, cutAfter: null }] }];
    }
    const confs: Conference[] = ['East', 'West'];
    if (view === 'division') {
        return confs.map(conf => ({
            heading: `${conf === 'East' ? 'Eastern' : 'Western'} Conference`,
            groups: DIVISIONS_BY_CONF[conf].map(div => ({
                key: div,
                title: div,
                rows: sorted.filter(r => r.division === div),
                cutAfter: 3,
                cutLabel: 'Top 3 qualify',
            })),
        }));
    }
    return confs.map(conf => {
        const [d1, d2] = DIVISIONS_BY_CONF[conf];
        const top1 = sorted.filter(r => r.division === d1).slice(0, 3);
        const top2 = sorted.filter(r => r.division === d2).slice(0, 3);
        const inTop = new Set([...top1, ...top2].map(r => r.tri));
        const wc = sorted.filter(r => r.conference === conf && !inTop.has(r.tri));
        return {
            heading: `${conf === 'East' ? 'Eastern' : 'Western'} Conference`,
            groups: [
                { key: `${conf}-${d1}`, title: d1, rows: top1, cutAfter: null },
                { key: `${conf}-${d2}`, title: d2, rows: top2, cutAfter: null },
                { key: `${conf}-wc`, title: 'Wild card', rows: wc, cutAfter: 2, cutLabel: 'Playoff line' },
            ],
        };
    });
}

export interface StandingsTableProps {
    rows: StandingsRow[];
    showProjections: boolean;
}

export function StandingsTable({ rows, showProjections }: StandingsTableProps) {
    const [view, setView] = React.useState<View>('wildcard');
    const sections = React.useMemo(() => groupsFor(view, rows), [view, rows]);

    // One shared points axis so the 80% bands compare across tables.
    const domain = React.useMemo<[number, number]>(() => {
        const lo = Math.min(...rows.map(r => r.proj?.p10 ?? Infinity));
        const hi = Math.max(...rows.map(r => r.proj?.p90 ?? -Infinity));
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [60, 120];
        return [Math.floor(lo / 5) * 5 - 2, Math.ceil(hi / 5) * 5 + 2];
    }, [rows]);

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented label="Standings view" options={VIEW_OPTIONS} value={view} onChange={setView} />
                {showProjections ? (
                    <p className="flex items-center gap-2 text-caption text-fg-3">
                        <span className="inline-flex items-center gap-1.5">
                            <span aria-hidden="true" className="inline-block h-2 w-5 rounded-full bg-brand/25 ring-1 ring-inset ring-brand/50" />
                            80% range of final points
                        </span>
                        <InfoTip term="playoff-odds" />
                    </p>
                ) : null}
            </div>

            {sections.map(section => (
                <section key={section.heading ?? 'league'} aria-label={section.heading ?? 'League standings'} className="flex flex-col gap-3">
                    {section.heading ? <h2 className="text-title font-bold text-fg-1">{section.heading}</h2> : null}
                    <div className={cn('grid gap-4', view === 'division' && 'xl:grid-cols-2')}>
                        {section.groups.map(g => (
                            <GroupTable key={g.key} group={g} showProjections={showProjections} domain={domain} />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

function GroupTable({ group, showProjections, domain }: { group: Group; showProjections: boolean; domain: [number, number] }) {
    return (
        <div className="hud-panel overflow-hidden">
            <table className="w-full table-fixed border-collapse text-left text-body-sm">
                <caption className="border-b border-line px-3 py-2 text-left">
                    <span className="hud-label text-fg-2">{group.title}</span>
                </caption>
                <thead>
                    <tr className="text-micro uppercase tracking-[0.06em] text-fg-3">
                        <th scope="col" className="w-8 py-2 pl-3 pr-1 font-semibold">
                            <span className="sr-only">Rank</span>#
                        </th>
                        <th scope="col" className="px-2 py-2 font-semibold">Team</th>
                        <th scope="col" className={cn('w-10 px-1 py-2 text-right font-semibold', showProjections && 'hidden sm:table-cell')}>
                            <abbr title="Games played" className="no-underline">GP</abbr>
                        </th>
                        <th scope="col" className={cn('w-[5.5rem] px-2 py-2 text-right font-semibold', showProjections && 'hidden md:table-cell')}>W-L-OT</th>
                        <th scope="col" className="w-11 px-2 py-2 text-right font-semibold">
                            <abbr title="Points" className="no-underline">PTS</abbr>
                        </th>
                        {showProjections ? (
                            <>
                                <th scope="col" className="w-[3.25rem] px-2 py-2 text-right font-semibold sm:w-32 sm:text-left">
                                    Proj<span className="hidden sm:inline"> pts</span>
                                </th>
                                <th scope="col" className="w-[4.5rem] px-2 py-2 font-semibold sm:w-36">Playoffs</th>
                                <th scope="col" className="hidden w-14 px-2 py-2 text-right font-semibold lg:table-cell">
                                    <abbr title="Wins the division" className="no-underline">Div</abbr>
                                </th>
                                <th scope="col" className="hidden w-14 px-2 py-2 text-right font-semibold md:table-cell">
                                    <abbr title="Wins the Stanley Cup" className="no-underline">Cup</abbr>
                                </th>
                                <th scope="col" className="hidden w-16 px-2 py-2 text-right font-semibold md:table-cell">
                                    <abbr title="Playoff odds change since yesterday" className="no-underline">24h</abbr>
                                </th>
                                <th scope="col" className="hidden w-24 py-2 pl-2 pr-3 text-right font-semibold lg:table-cell">30 days</th>
                            </>
                        ) : null}
                    </tr>
                </thead>
                <tbody>
                    {group.rows.map((r, i) => (
                        <Row
                            key={r.tri}
                            row={r}
                            rank={(group.startRank ?? 0) + i + 1}
                            showProjections={showProjections}
                            domain={domain}
                            cutLabel={group.cutAfter != null && i === group.cutAfter && i > 0 ? group.cutLabel ?? 'Playoff line' : undefined}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Row({
    row: r,
    rank,
    showProjections,
    domain,
    cutLabel,
}: {
    row: StandingsRow;
    rank: number;
    showProjections: boolean;
    domain: [number, number];
    /** Draw the playoff line above this row. */
    cutLabel?: string;
}) {
    const p = r.proj;
    return (
        <tr
            className={cn(
                'relative transition-colors hover:bg-surface-2/60',
                cutLabel ? 'border-t border-dashed border-t-brand/70' : 'border-t border-line/60',
            )}
        >
            <td className="py-2 pl-3 pr-1 text-caption tabular-nums text-fg-3">
                {rank}
                {cutLabel ? (
                    <span className="pointer-events-none absolute right-3 top-0 -translate-y-1/2 rounded-full bg-surface-1 px-2 text-micro font-semibold uppercase tracking-[0.06em] text-brand">
                        {cutLabel}
                    </span>
                ) : null}
            </td>
            <th scope="row" className="px-2 py-1.5 font-normal">
                <Link
                    href={`/teams/${r.tri}`}
                    prefetch={false}
                    className="group -mx-1 flex min-h-9 items-center gap-2 rounded-chip px-1 coarse:min-h-11"
                >
                    <TeamLogo tri={r.tri} size={24} />
                    <span className="min-w-0 truncate font-semibold text-fg-1 group-hover:text-brand">
                        <span className="sm:hidden">{r.tri}</span>
                        <span className="hidden sm:inline">{r.short}</span>
                    </span>
                </Link>
            </th>
            <td className={cn('px-1 py-2 text-right tabular-nums text-fg-2', showProjections && 'hidden sm:table-cell')}>{r.gp}</td>
            <td className={cn('px-2 py-2 text-right tabular-nums text-fg-2', showProjections && 'hidden md:table-cell')}>
                {r.w}-{r.l}-{r.otl}
            </td>
            <td className="px-2 py-2 text-right font-bold tabular-nums text-fg-1">{r.pts}</td>
            {showProjections ? (
                <>
                    <td className="px-2 py-2">{p ? <ProjCell avg={p.avgPoints} lo={p.p10} hi={p.p90} domain={domain} /> : <Dash />}</td>
                    <td className="px-2 py-2">{p ? <PctBar pct={p.playoffPct} /> : <Dash />}</td>
                    <td className="hidden px-2 py-2 text-right tabular-nums text-fg-2 lg:table-cell">{p ? fmtSimPct(p.divisionPct) : <Dash />}</td>
                    <td className="hidden px-2 py-2 text-right tabular-nums text-fg-2 md:table-cell">{p ? fmtSimPct(p.cupPct) : <Dash />}</td>
                    <td className="hidden px-2 py-2 text-right md:table-cell">
                        <Delta value={r.delta24} />
                    </td>
                    <td className="hidden py-2 pl-2 pr-3 lg:table-cell">
                        <div className="flex justify-end">
                            {r.trend.length > 1 ? (
                                <>
                                    <Sparkline values={r.trend} width={64} height={20} />
                                    <span className="sr-only">
                                        Playoff odds over the last {r.trend.length} days: from {fmtSimPct(r.trend[0])} to {fmtSimPct(r.trend[r.trend.length - 1])}
                                    </span>
                                </>
                            ) : (
                                <span className="text-caption text-fg-3">
                                    <span aria-hidden="true">—</span>
                                    <span className="sr-only">No history yet</span>
                                </span>
                            )}
                        </div>
                    </td>
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
            <span className="font-semibold tabular-nums text-fg-1">{Math.round(avg)}</span>
            <span className="relative hidden h-2.5 flex-1 sm:block" aria-hidden="true">
                <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-fg-3/30" />
                <span
                    className="absolute inset-y-0 rounded-full bg-brand/25 ring-1 ring-inset ring-brand/50"
                    style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }}
                />
                <span className="absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand" style={{ left: x(avg) }} />
            </span>
            <span className="sr-only">
                , 80% range {Math.round(lo)} to {Math.round(hi)} points
            </span>
        </div>
    );
}

function PctBar({ pct }: { pct: number }) {
    const tone = pctTone(pct);
    return (
        <div className="flex items-center gap-2">
            <span className="w-[3.25rem] shrink-0 text-right font-bold tabular-nums" style={{ color: tone }}>
                {fmtSimPct(pct)}
            </span>
            <span aria-hidden="true" className="relative hidden h-1.5 flex-1 overflow-hidden rounded-full bg-fg-3/20 sm:block">
                <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, backgroundColor: tone }} />
            </span>
        </div>
    );
}

function Delta({ value }: { value: number | null }) {
    if (value == null) return <Dash />;
    const r = Number(value.toFixed(1));
    if (r === 0) return <span className="text-caption tabular-nums text-fg-3">±0.0</span>;
    const up = r > 0;
    return (
        <span className={cn('inline-flex items-center gap-0.5 text-caption font-semibold tabular-nums', up ? 'text-pos' : 'text-neg')}>
            <span aria-hidden="true">{up ? '▲' : '▼'}</span>
            <span className="sr-only">{up ? 'up' : 'down'} </span>
            {signed(r, 1).replace(/^[+−]/, '')}
        </span>
    );
}

export default StandingsTable;
