import Link from 'next/link';
import { teamPalette } from '@/components/ui/team-color';
import { cn } from '@/lib/utils';
import type { LeaderRow } from '@/lib/pony/data';
import { PARTS, signed, stack } from '@/lib/pony/parts';

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

export function LeaderTable({ rows, start = 0, goalies }: { rows: LeaderRow[]; start?: number; goalies: boolean }) {
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
    const TD = 'px-2 text-right tabular-nums';
    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] md:min-w-[56rem] border-collapse text-caption">
                <thead>
                    <tr className="border-b border-line">
                        <th className={cn(TH, 'w-10')}>#</th>
                        <th className={cn(TH, 'text-left')}>Player</th>
                        <th className={cn(TH, 'text-fg-1')} title={goalies ? 'Goals saved above expected per game' : 'Pony Score per game, in goals'}>
                            {goalies ? 'GSAx/GP' : 'Pony/GP'}
                        </th>
                        <th className={TH}>GP</th>
                        {goalies ? (
                            <>
                                <th className={TH} title="Shots against">SA</th>
                                <th className={TH}>SV%</th>
                                <th className={TH} title="pony xG against, in goals">xGA</th>
                            </>
                        ) : (
                            <th className={TH} title="Time on ice per game">TOI</th>
                        )}
                        <th className={TH}>Total</th>
                        <th className={TH} title="Per 60 minutes">/60</th>
                        <th className={cn(TH, 'w-44 text-center')}>Breakdown</th>
                        <th className={cn(TH, 'text-center')}>Last 10</th>
                        <th className={cn(TH, 'text-left')}>Best</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => {
                        const ring = teamPalette(r.team).primary;
                        const sv = r.goalie && r.goalie.sa ? ((r.goalie.sa - r.goalie.ga) / r.goalie.sa).toFixed(3).replace(/^0/, '') : '—';
                        return (
                            <tr key={r.player.id} className="group border-b border-line/60 hover:bg-surface-2/60">
                                <td className={cn(TD, 'text-fg-3')}>{start + i + 1}</td>
                                <td className="py-1.5 pl-2 pr-3">
                                    <Link href={`/players/${r.player.id}`} className="flex min-w-0 items-center gap-2.5 rounded-control outline-none focus-visible:outline-2 focus-visible:outline-brand">
                                        <span className="relative block h-9 w-9 shrink-0 overflow-hidden rounded-full border-2 bg-surface-2" style={{ borderColor: ring }}>
                                            {/* eslint-disable-next-line @next/next/no-img-element -- NHL headshots are pre-sized PNGs */}
                                            {r.player.headshot ? <img src={r.player.headshot} alt="" width={36} height={36} loading="lazy" className="h-full w-full object-cover" /> : null}
                                        </span>
                                        <span className="min-w-0 leading-tight">
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
                                <td className={cn(TD, 'font-display text-body font-bold', r.avg < 0 ? 'text-fg-2' : 'text-fg-1')}>{signed(r.avg)}</td>
                                <td className={cn(TD, 'text-fg-2')}>{r.gp}</td>
                                {goalies ? (
                                    <>
                                        <td className={cn(TD, 'text-fg-2')}>{r.goalie?.sa ?? '—'}</td>
                                        <td className={cn(TD, 'text-fg-2')}>{sv}</td>
                                        <td className={cn(TD, 'text-model')}>{r.goalie ? r.goalie.xga.toFixed(1) : '—'}</td>
                                    </>
                                ) : (
                                    <td className={cn(TD, 'text-fg-2')}>{mmss(r.toi)}</td>
                                )}
                                <td className={cn(TD, 'text-fg-2')}>{signed(r.total, 1)}</td>
                                <td className={cn(TD, 'text-fg-2')}>{signed(r.per60)}</td>
                                <td className="px-2">
                                    <Breakdown row={r} reach={reach} />
                                </td>
                                <td className="px-2">
                                    <span className="flex justify-center">
                                        <Form values={r.form} />
                                    </span>
                                </td>
                                <td className="px-2 text-left">
                                    {r.best ? (
                                        <Link href={`/games/${r.best.game}`} className="whitespace-nowrap text-fg-2 underline-offset-4 hover:text-fg-1 hover:underline">
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
        </div>
    );
}
