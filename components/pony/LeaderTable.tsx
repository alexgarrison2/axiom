import * as React from 'react';
import Link from 'next/link';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { teamPalette } from '@/components/ui/team-color';
import { cn } from '@/lib/utils';
import { SortLink } from '@/components/pony/SortLink';
import type { LeaderRow, SortKey } from '@/lib/pony/data';
import { IDEAS, PARTS, signed, stack } from '@/lib/pony/parts';
import type { GsPart } from '@/lib/game/analytics';

/**
 * Pony Score leaderboard rows: rank, player, games, minutes, the score per
 * game (the headline), total and per 60, the average breakdown as one signed
 * stack, the last ten games, and the best night. Goalies show GSAx.
 */

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function Breakdown({ row, reach, className }: { row: Pick<LeaderRow, 'parts' | 'goalie' | 'avg'>; reach: number; className?: string }) {
    const VB = 200;
    const x = (v: number) => VB / 2 + (v / reach) * (VB / 2 - 2);
    return (
        <svg viewBox={`0 0 ${VB} 14`} preserveAspectRatio="none" className={cn('block h-3.5 w-full', className)} aria-hidden="true">
            <rect x={0} y={0} width={VB} height={14} fill="var(--track)" />
            {row.parts ? (
                stack(row.parts, x).map(s => <rect key={s.k} x={s.x} y={2} width={Math.max(0, s.w - 0.6)} height={10} fill={PARTS[s.k].color} />)
            ) : (
                <rect x={Math.min(x(0), x(row.avg))} y={2} width={Math.abs(x(row.avg) - x(0))} height={10} fill="var(--goalie)" opacity={0.8} />
            )}
            <line x1={VB / 2} x2={VB / 2} y1={0} y2={14} className="stroke-fg-3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <line x1={x(row.avg)} x2={x(row.avg)} y1={0} y2={14} className="stroke-fg-1" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

/** Last ten games as signed bars around zero, newest on the right. */
export function Form({ values, reach = 1.5 }: { values: number[]; reach?: number }) {
    const W = 10 * 7;
    return (
        <svg viewBox={`0 0 ${W} 24`} className="block h-6 w-[4.4rem]" aria-label={`Last ${values.length}: ${values.map(v => signed(v)).join(', ')}`} role="img">
            <line x1={0} x2={W} y1={12} y2={12} className="stroke-line-strong" strokeWidth={1} />
            {values.map((v, i) => {
                const h = Math.min(11, (Math.abs(v) / reach) * 11);
                return <rect key={i} x={W - (values.length - i) * 7 + 1} y={v >= 0 ? 12 - h : 12} width={5} height={Math.max(1, h)} rx={1} className={v >= 0 ? 'fill-fg-1' : 'fill-fg-3'} opacity={v >= 0 ? 0.85 : 0.9} />;
            })}
        </svg>
    );
}

const TD = 'px-2 text-right tabular-nums';

const SHORT: Record<string, string> = { Production: 'Prod', 'Play driving': 'Drive', 'Special teams': 'ST', Usage: 'Use' };

/** One side's open columns: its sum, then the four parts, each headed by its bar colour. */
function PartHeads({ side, head }: { side: 'off' | 'def'; head: (key: SortKey, label: React.ReactNode, title?: string, className?: string) => React.ReactNode }) {
    return (
        <>
            {head(side, side === 'off' ? 'Off' : 'Def', side === 'off' ? 'Offence per game' : 'Defence per game', 'border-l border-line')}
            {IDEAS.map(pair => {
                const k: GsPart = pair[side === 'off' ? 0 : 1];
                return (
                    <React.Fragment key={k}>
                        {head(
                            k,
                            <span className="inline-flex items-center gap-1">
                                <span aria-hidden="true" className="h-2 w-2 rounded-[2px]" style={{ background: PARTS[k].color }} />
                                {SHORT[PARTS[k].label]}
                            </span>,
                            `${side === 'off' ? 'Offence' : 'Defence'}: ${PARTS[k].label.toLowerCase()} per game`,
                        )}
                    </React.Fragment>
                );
            })}
        </>
    );
}

type Metric = 'avg' | 'total' | 'per60' | 'off' | 'def';
const METRICS: Record<Metric, { label: string; goalie: string; title: string; value: (r: LeaderRow) => number; digits: number }> = {
    avg: { label: 'Pony/GP', goalie: 'GSAx/GP', title: 'Per game, in goals', value: r => r.avg, digits: 2 },
    total: { label: 'Total', goalie: 'GSAx', title: 'Season total, in goals', value: r => r.total, digits: 2 },
    per60: { label: '/60', goalie: '/60', title: 'Per 60 minutes', value: r => r.per60, digits: 2 },
    off: { label: 'Off/GP', goalie: 'Off/GP', title: 'Offence per game', value: r => r.off, digits: 2 },
    def: { label: 'Def/GP', goalie: 'Def/GP', title: 'Defence per game', value: r => r.def, digits: 2 },
};

/**
 * Per game leads (big, right after the name); ranking by offence or defence
 * puts that column ahead of it. Every number column sorts: a click ranks by
 * it, a second click flips the order (both through the URL, the server sorts).
 * Skaters: the Breakdown header opens the score's parts as columns, offence
 * and defence each with its sum, and closes them again.
 */
export function LeaderTable({
    rows,
    start = 0,
    goalies,
    sort = 'avg',
    dir = 'top',
    sortHref,
    expanded = false,
    expandHref,
}: {
    rows: LeaderRow[];
    start?: number;
    goalies: boolean;
    sort?: SortKey;
    dir?: 'top' | 'bottom';
    sortHref: (key: SortKey) => string;
    /** The parts are open as columns. */
    expanded?: boolean;
    /** Opens or closes them. */
    expandHref?: string;
}) {
    const open = expanded && !goalies;
    // Open parts carry their own Off and Def columns, so neither leads then.
    const split = !open && (sort === 'off' || sort === 'def') ? METRICS[sort] : null;
    const head = (key: SortKey, label: React.ReactNode, title?: string, className?: string) => (
        <SortLink href={sortHref(key)} direction={sort === key ? (dir === 'top' ? 'desc' : 'asc') : null} label={label} title={title} className={className} />
    );
    const num = (key: SortKey) => cn(TD, sort === key ? 'font-semibold text-fg-1' : 'text-fg-2');
    let reach = 0.5;
    for (const r of rows) {
        if (r.parts) {
            let pos = 0;
            let neg = 0;
            for (const v of Object.values(r.parts)) {
                if (v > 0) pos += v;
                else neg -= v;
            }
            reach = Math.max(reach, pos, neg);
        } else reach = Math.max(reach, Math.abs(r.avg));
    }
    reach = Math.ceil(reach * 4) / 4;
    const TH = 'px-2 py-2 text-right text-micro font-semibold uppercase tracking-label text-fg-3';
    // Below lg the table scrolls sideways under a pinned player column.
    const PIN = 'max-lg:sticky max-lg:left-0 max-lg:z-10 max-lg:bg-surface-1';
// The pinned cell's right hairline (a pseudo-element: collapsed table cells drop box-shadow).
const PIN_EDGE = "max-lg:after:pointer-events-none max-lg:after:absolute max-lg:after:inset-y-0 max-lg:after:right-0 max-lg:after:w-px max-lg:after:bg-line-strong max-lg:after:content-['']";
    const PIN_HOVER = 'max-lg:group-hover:bg-[color-mix(in_srgb,var(--surface-2)_60%,var(--surface-1))]';
    return (
        <ScrollRegion label="Pony Score leaders" stickyStart>
            <table className="w-full min-w-[40rem] md:min-w-[56rem] border-collapse text-caption">
                <thead>
                    {open ? (
                        <tr>
                            <th colSpan={(split ? 9 : 8)} aria-hidden="true" />
                            {(['Offence', 'Defence'] as const).map(g => (
                                <th key={g} colSpan={5} scope="colgroup" className="border-l border-line px-2 pt-2 text-left text-micro font-semibold uppercase tracking-label text-fg-2">
                                    {g}
                                </th>
                            ))}
                            <th colSpan={2} aria-hidden="true" />
                        </tr>
                    ) : null}
                    <tr className="border-b border-line">
                        <th className={cn(TH, 'w-10 max-sm:w-7 max-sm:px-1')}>#</th>
                        <th className={cn(TH, PIN, PIN_EDGE, 'text-left')}>Player</th>
                        {split ? head(sort, split.label, split.title) : null}
                        {head('avg', goalies ? METRICS.avg.goalie : METRICS.avg.label, METRICS.avg.title)}
                        {head('gp', 'GP', 'Games played')}
                        {goalies ? (
                            <>
                                {head('sa', 'SA', 'Shots against')}
                                {head('sv', 'SV%', 'Save percentage')}
                                {head('xga', 'xGA', 'pony xG against, in goals')}
                            </>
                        ) : (
                            head('toi', 'TOI', 'Time on ice per game')
                        )}
                        {head('total', goalies ? METRICS.total.goalie : METRICS.total.label, METRICS.total.title)}
                        {head('per60', METRICS.per60.label, METRICS.per60.title)}
                        <th className={cn(TH, 'w-44 p-0 text-center')}>
                            {expandHref && !goalies ? (
                                <Link
                                    href={expandHref}
                                    scroll={false}
                                    aria-expanded={open}
                                    title={open ? 'Hide the parts' : 'Show the parts as columns'}
                                    className="inline-flex min-h-8 w-full items-center justify-center gap-1.5 px-2 uppercase hover:text-fg-1 coarse:min-h-11"
                                >
                                    Breakdown
                                    <svg viewBox="0 0 8 8" className={cn('h-2 w-2 transition-transform', open && 'rotate-180')} aria-hidden="true">
                                        <path d="M2.5 1 6 4 2.5 7" fill="none" stroke="currentColor" strokeWidth="1.4" />
                                    </svg>
                                </Link>
                            ) : (
                                'Breakdown'
                            )}
                        </th>
                        {open
                            ? (['off', 'def'] as const).map(side => (
                                  <PartHeads key={side} side={side} head={head} />
                              ))
                            : null}
                        <th className={cn(TH, 'text-center')}>Last 10</th>
                        {head('best', 'Best', 'Best single game', '[&_button]:justify-start')}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => {
                        const ring = teamPalette(r.team).primary;
                        const sv = r.goalie && r.goalie.sa ? ((r.goalie.sa - r.goalie.ga) / r.goalie.sa).toFixed(3).replace(/^0/, '') : '—';
                        return (
                            <tr key={r.player.id} className="group border-b border-line/60 hover:bg-surface-2/60">
                                <td className={cn(TD, 'text-fg-3 max-sm:px-1')}>{start + i + 1}</td>
                                <td className={cn('py-1.5 pl-2 pr-3 max-sm:pr-2', PIN, PIN_EDGE, PIN_HOVER)}>
                                    <Link href={`/players/${r.player.id}`} className="flex min-w-0 items-center gap-2.5 rounded-control max-sm:gap-2 outline-none focus-visible:outline-2 focus-visible:outline-brand">
                                        <span className="relative block h-9 w-9 shrink-0 overflow-hidden rounded-full border-2 bg-surface-2" style={{ borderColor: ring }}>
                                            {/* eslint-disable-next-line @next/next/no-img-element -- NHL headshots are pre-sized PNGs */}
                                            {r.player.headshot ? <img src={r.player.headshot} alt="" width={36} height={36} loading="lazy" className="headshot h-full w-full" /> : null}
                                        </span>
                                        <span className="min-w-0 leading-tight max-lg:max-w-[8rem] max-sm:max-w-[7rem]">
                                            <span className="block truncate font-bold text-fg-1 group-hover:text-brand">
                                                {r.player.first} {r.player.last}
                                            </span>
                                            <span className="flex items-center gap-1 text-micro text-fg-3">
                                                {/* eslint-disable-next-line @next/next/no-img-element -- team logos are static SVGs */}
                                                <img src={`/logos/${r.team}.svg`} alt="" width={14} height={14} className="h-3.5 w-3.5" />
                                                {r.team} · {r.pos}
                                            </span>
                                        </span>
                                    </Link>
                                </td>
                                {split ? <td className={cn(TD, 'font-display text-body font-bold', split.value(r) < 0 ? 'text-fg-2' : 'text-fg-1')}>{signed(split.value(r), split.digits)}</td> : null}
                                <td className={cn(TD, 'font-display text-body font-bold', split ? 'text-fg-2' : r.avg < 0 ? 'text-fg-2' : 'text-fg-1')}>{signed(r.avg)}</td>
                                <td className={num('gp')}>{r.gp}</td>
                                {goalies ? (
                                    <>
                                        <td className={num('sa')}>{r.goalie?.sa ?? '—'}</td>
                                        <td className={num('sv')}>{sv}</td>
                                        <td className={cn(TD, 'text-model', sort === 'xga' && 'font-semibold')}>{r.goalie ? r.goalie.xga.toFixed(1) : '—'}</td>
                                    </>
                                ) : (
                                    <td className={num('toi')}>{mmss(r.toi)}</td>
                                )}
                                <td className={num('total')}>{signed(r.total)}</td>
                                <td className={num('per60')}>{signed(r.per60)}</td>
                                <td className="px-2">
                                    <Breakdown row={r} reach={reach} />
                                </td>
                                {open
                                    ? (['off', 'def'] as const).map(side => (
                                          <React.Fragment key={side}>
                                              <td className={cn(num(side), 'border-l border-line/60')}>{signed(side === 'off' ? r.off : r.def)}</td>
                                              {IDEAS.map(pair => {
                                                  const k = pair[side === 'off' ? 0 : 1];
                                                  return (
                                                      <td key={k} className={cn(num(k), sort !== k && r.parts && Math.abs(r.parts[k]) < 0.005 && 'text-fg-3')}>
                                                          {r.parts ? signed(r.parts[k]) : '—'}
                                                      </td>
                                                  );
                                              })}
                                          </React.Fragment>
                                      ))
                                    : null}
                                <td className="px-2">
                                    <span className="flex justify-center">
                                        <Form values={r.form} />
                                    </span>
                                </td>
                                <td className="px-2 text-left">
                                    {r.best ? (
                                        <Link href={`/games/${r.best.game}`} className="whitespace-nowrap text-fg-2 coarse:py-3 underline-offset-4 hover:text-fg-1 hover:underline">
                                            <span className="font-semibold text-fg-1">{signed(r.best.ps)}</span> vs {r.best.opp}
                                            <span className="ml-1 text-micro text-fg-3">{r.best.date.slice(5).replace('-', '/')}</span>
                                        </Link>
                                    ) : null}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </ScrollRegion>
    );
}
