import * as React from 'react';
import { SeasonTag, shortSeasonTag } from '@/components/ui/stat-chip';
import { cn } from '@/lib/utils';
import { injuryCode, shortDate, signed } from '@/utils/team-stats/format';
import type { GoalieLine, GoalieSeason } from '@/utils/team-stats/team-types';
import { GOALIE_NAME, gaa, goalieOut, goalieState, orderGoalies, svPct } from './goalie-line';

interface GoaliesPanelProps {
    goalies: GoalieLine[];
    currentLabel: string;
    prevLabel: string;
}

const gsaxPer = (s: GoalieSeason) => (s.gsax != null && s.gs > 0 ? signed(s.gsax / s.gs, 2) : '—');

/**
 * Roster goalies as dense cards in depth-chart order (next starter first,
 * injured last and dimmed): name (green when his next start is confirmed),
 * this season's and last season's lines side by side, the model's GSAx
 * rating and the last five starts.
 */
export default function GoaliesPanel({ goalies, currentLabel, prevLabel }: GoaliesPanelProps) {
    if (goalies.length === 0) return <p className="panel label p-card">No goalies</p>;
    return (
        <div className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
            {orderGoalies(goalies).map(g => {
                const state = g.next ? goalieState(g.next.status) : null;
                const out = goalieOut(g);
                // Confirmed / likely starters glow green; a projected starter stays full ink, never greyed below his backup.
                const nameTone = out ? 'text-fg-3' : state && state !== 'projected' ? GOALIE_NAME[state] : 'text-fg-1';
                const cell = (prior: boolean) => cn('px-1 text-right', out ? 'text-fg-3' : prior ? 'text-fg-2' : 'text-fg-1');
                return (
                    <article key={g.id} aria-labelledby={`goalie-${g.id}`} data-out={out ? '' : undefined} className="panel flex min-w-0 flex-col gap-2.5 p-card">
                        <header className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h3 id={`goalie-${g.id}`} className={cn('truncate font-display text-[20px] font-bold uppercase leading-6', nameTone)}>
                                    {g.name}
                                </h3>
                                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-micro uppercase tracking-wide text-fg-3">
                                    {g.number != null ? <span>#{g.number}</span> : null}
                                    {g.isNew ? <span className="font-bold text-brand">New</span> : null}
                                    {g.injury ? (
                                        <span className="font-bold text-neg" title={g.injury.status}>
                                            {injuryCode(g.injury.status)}
                                            <span className="sr-only"> ({g.injury.status})</span>
                                            {g.injury.returnDate ? ` · ${shortDate(g.injury.returnDate)}` : ''}
                                        </span>
                                    ) : null}
                                    {g.next ? (
                                        <span className={state && state !== 'projected' ? GOALIE_NAME[state] : 'text-fg-2'}>
                                            Next {shortDate(g.next.date)} {g.next.opp ? `· ${g.next.opp}` : ''}
                                            <span className="sr-only"> ({g.next.status})</span>
                                        </span>
                                    ) : null}
                                </p>
                            </div>
                            <div className="shrink-0 text-right">
                                <p className="label">GSAx/gm</p>
                                <Rating rating={g.rating} currentLabel={currentLabel} muted={out} />
                            </div>
                        </header>

                        <table className="w-full font-mono text-caption tabular-nums">
                            <caption className="sr-only">{g.name} regular-season lines</caption>
                            <thead>
                                <tr>
                                    {['Season', 'GP', 'W-L-OT', 'Sv%', 'GAA', 'GSAx/GS'].map(h => (
                                        <th key={h} scope="col" className={cn('h-6 px-1 text-micro font-medium uppercase tracking-[0.08em] text-fg-3', h === 'Season' ? 'text-left' : 'text-right')}>
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {(
                                    [
                                        [currentLabel, g.current, false],
                                        [prevLabel, g.last, true],
                                    ] as const
                                ).map(([label, s, prior]) => (
                                    <tr key={label} className="border-t border-line">
                                        <th scope="row" className="h-7 px-1 text-left font-normal">
                                            {prior ? <SeasonTag>{shortSeasonTag(label)}</SeasonTag> : <span className="text-micro font-bold text-fg-1">{shortSeasonTag(label)}</span>}
                                            <span className="sr-only"> ({label})</span>
                                        </th>
                                        {s && s.gp > 0 ? (
                                            <>
                                                <td className={cell(prior)}>{s.gp}</td>
                                                <td className={cell(prior)}>
                                                    {s.w}-{s.l}-{s.ot}
                                                </td>
                                                <td className={cell(prior)}>{svPct(s)}</td>
                                                <td className={cell(prior)}>{gaa(s)}</td>
                                                <td className={cell(prior)}>{gsaxPer(s)}</td>
                                            </>
                                        ) : (
                                            <td colSpan={5} className="px-1 text-right text-fg-3">
                                                0 GP
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <LastStarts g={g} prevLabel={prevLabel} />
                    </article>
                );
            })}
        </div>
    );
}

/**
 * The blended model rating. When it rests only on earlier seasons (no start
 * this season yet) it carries the muted tag of the latest season it draws on;
 * a zero rating stays neutral rather than green.
 */
function Rating({ rating, currentLabel, muted }: { rating: GoalieLine['rating']; currentLabel: string; muted?: boolean }) {
    if (!rating) return <p className="font-display text-[22px] font-bold leading-7 text-fg-3">—</p>;
    const end = rating.label.split(' to ').pop() ?? rating.label;
    const priorTag = end !== currentLabel ? shortSeasonTag(end) : undefined;
    const v = rating.gsaxPerGame;
    const tone = muted ? 'text-fg-3' : Math.abs(v) < 0.005 ? 'text-fg-1' : v > 0 ? 'text-pos' : 'text-neg';
    return (
        <p className="flex items-center justify-end gap-1.5" title={rating.label}>
            {priorTag ? <SeasonTag>{priorTag}</SeasonTag> : null}
            <span className={cn('font-display text-[22px] font-bold leading-7 tabular-nums', priorTag && 'opacity-80', tone)}>{signed(v, 2)}</span>
            <span className="sr-only"> ({rating.label})</span>
        </p>
    );
}

function LastStarts({ g, prevLabel }: { g: GoalieLine; prevLabel: string }) {
    const cur = g.current?.last5 ?? [];
    const src = cur.length ? cur : (g.last?.last5 ?? []);
    if (!src.length) return null;
    return (
        <div className="flex flex-wrap items-center gap-1">
            <span className="label mr-1">L{src.length}</span>
            {!cur.length ? <SeasonTag className="mr-1">{shortSeasonTag(prevLabel)}</SeasonTag> : null}
            <ol className="flex flex-wrap gap-1">
                {src.map(s => {
                    const win = s.result.endsWith('W');
                    const otl = s.result === 'OTL' || s.result === 'SOL';
                    return (
                        <li
                            key={s.date}
                            title={shortDate(s.date)}
                            className={cn('rounded-chip border px-1.5 py-0.5 text-micro tabular-nums', win ? 'border-pos/40 text-pos' : otl ? 'border-warn/40 text-warn' : 'border-neg/40 text-neg')}
                        >
                            <span className="text-fg-3">{s.home ? 'vs' : '@'}</span> {s.opp} {s.sa > 0 ? `${s.sa - s.ga}/${s.sa}` : `${s.ga} GA`}
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
