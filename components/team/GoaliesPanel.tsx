import * as React from 'react';
import { InfoTip } from '@/components/ui/info-tip';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { cn } from '@/lib/utils';
import { pct3, shortDate, signed } from '@/utils/team-stats/format';
import type { GoalieLine, GoalieSeason } from '@/utils/team-stats/team-types';

interface GoaliesPanelProps {
    goalies: GoalieLine[];
    currentLabel: string;
    prevLabel: string;
}

const svPct = (s: GoalieSeason) => (s.sa > 0 ? pct3(s.sv / s.sa) : '—');
const gaa = (s: GoalieSeason) => (s.toi > 0 ? ((s.ga * 3600) / s.toi).toFixed(2) : '—');
const gsaxPer = (s: GoalieSeason) => (s.gsax != null && s.gs > 0 ? signed(s.gsax / s.gs, 2) : '—');

/**
 * Team goalies from the current roster: this season's and last season's
 * lines side by side (each labelled with its season), the model's blended
 * GSAx rating, the last five starts and whether the next start is confirmed.
 */
export default function GoaliesPanel({ goalies, currentLabel, prevLabel }: GoaliesPanelProps) {
    if (goalies.length === 0) return <p className="text-body-sm text-fg-2">No goalies on the current roster feed.</p>;
    return (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {goalies.map(g => (
                <article key={g.id} aria-labelledby={`goalie-${g.id}`} className="hud-panel flex flex-col gap-3 p-4">
                    <header className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h3 id={`goalie-${g.id}`} className="truncate text-title font-bold text-fg-1">
                                {g.number != null ? <span className="mr-1.5 text-body-sm font-semibold text-fg-3">#{g.number}</span> : null}
                                {g.name}
                            </h3>
                            <p className="flex flex-wrap gap-x-2 text-caption text-fg-2">
                                {g.isNew ? <span className="font-semibold text-brand">New to team</span> : null}
                                {g.injury ? (
                                    <span className="text-neg">
                                        {g.injury.status}
                                        {g.injury.returnDate ? ` · ~${shortDate(g.injury.returnDate)}` : ''}
                                    </span>
                                ) : null}
                            </p>
                        </div>
                        {g.next ? (
                            <span
                                className={cn(
                                    'shrink-0 rounded-chip px-2 py-1 text-caption font-semibold',
                                    /confirm/i.test(g.next.status) && !/unconfirm/i.test(g.next.status) ? 'bg-pos/15 text-pos' : 'bg-warn/15 text-warn',
                                )}
                            >
                                Next start {shortDate(g.next.date)}: {g.next.status}
                            </span>
                        ) : null}
                    </header>

                    <ScrollRegion label={`${g.name} season lines`}>
                        <table className="w-full min-w-[360px] text-body-sm">
                            <caption className="sr-only">{g.name} regular-season lines</caption>
                            <thead>
                                <tr className="text-micro text-fg-3">
                                    {['Season', 'GP', 'W-L-OT', 'Sv%', 'GAA', 'GSAx/GS'].map(h => (
                                        <th key={h} scope="col" className={cn('px-1.5 py-1 font-semibold', h === 'Season' ? 'text-left' : 'text-right')}>
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {[
                                    [currentLabel, g.current],
                                    [prevLabel, g.last],
                                ].map(([label, s]) => (
                                    <tr key={label as string} className="border-t border-line">
                                        <th scope="row" className="px-1.5 py-1.5 text-left font-mono text-caption font-semibold text-fg-2">
                                            {label as string}
                                        </th>
                                        {s ? (
                                            <>
                                                <td className="px-1.5 py-1.5 text-right tabular-nums text-fg-1">{(s as GoalieSeason).gp}</td>
                                                <td className="px-1.5 py-1.5 text-right tabular-nums text-fg-1">
                                                    {(s as GoalieSeason).w}-{(s as GoalieSeason).l}-{(s as GoalieSeason).ot}
                                                </td>
                                                <td className="px-1.5 py-1.5 text-right tabular-nums text-fg-1">{svPct(s as GoalieSeason)}</td>
                                                <td className="px-1.5 py-1.5 text-right tabular-nums text-fg-1">{gaa(s as GoalieSeason)}</td>
                                                <td className="px-1.5 py-1.5 text-right tabular-nums text-fg-1">{gsaxPer(s as GoalieSeason)}</td>
                                            </>
                                        ) : (
                                            <td colSpan={5} className="px-1.5 py-1.5 text-right text-caption text-fg-3">
                                                {label === currentLabel ? 'No games yet' : 'No NHL games'}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </ScrollRegion>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-caption">
                        <span className="flex items-center gap-1 text-fg-2">
                            Model rating
                            <InfoTip term="gsax" />
                        </span>
                        {g.rating ? (
                            <span className="tabular-nums text-fg-1">
                                <span className={cn('font-semibold', g.rating.gsaxPerGame >= 0 ? 'text-pos' : 'text-neg')}>{signed(g.rating.gsaxPerGame, 2)}</span> GSAx/gm
                                <span className="ml-1 text-fg-3">({g.rating.label})</span>
                            </span>
                        ) : (
                            <span className="text-fg-3">Not rated yet</span>
                        )}
                    </div>

                    <LastStarts g={g} currentLabel={currentLabel} prevLabel={prevLabel} />
                </article>
            ))}
        </div>
    );
}

function LastStarts({ g, currentLabel, prevLabel }: { g: GoalieLine; currentLabel: string; prevLabel: string }) {
    const cur = g.current?.last5 ?? [];
    const src = cur.length ? cur : (g.last?.last5 ?? []);
    const label = cur.length ? currentLabel : prevLabel;
    if (!src.length) return <p className="text-caption text-fg-3">No recent starts.</p>;
    return (
        <div>
            <p className="mb-1 text-micro text-fg-3">
                Last {src.length} starts · <span className="font-mono font-semibold text-fg-2">{label}</span>
            </p>
            <ol className="flex flex-wrap gap-1.5">
                {src.map(s => {
                    const win = s.result.endsWith('W');
                    const otl = (s.result === 'OTL' || s.result === 'SOL');
                    return (
                        <li
                            key={s.date}
                            className={cn('rounded-chip border px-2 py-1 text-caption tabular-nums', win ? 'border-pos/40 text-pos' : otl ? 'border-warn/40 text-warn' : 'border-neg/40 text-neg')}
                        >
                            <span className="text-fg-2">{shortDate(s.date)}</span> {s.home ? 'vs' : '@'} {s.opp} ·{' '}
                            {s.sa > 0 ? `${s.sa - s.ga}/${s.sa}` : `${s.ga} GA`}
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
