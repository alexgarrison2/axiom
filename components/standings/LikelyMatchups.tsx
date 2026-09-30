import * as React from 'react';
import { TEAM_NAMES } from '@/components/ui/team-color';
import { TeamLogo } from '@/components/views/TeamLogo';
import { fmtSimPct } from '@/components/views/format';
import { likelyMatchups, type Conference, type StandingsRow } from './model';

/**
 * Early season: the first-round series that came up most often across the
 * simulations (r1_matchups), instead of a bracket seeded from 0-0-0 standings.
 */
export function LikelyMatchups({ rows, totalSims }: { rows: StandingsRow[]; totalSims: number }) {
    const confs: Conference[] = ['East', 'West'];
    return (
        <div className="grid gap-4 md:grid-cols-2">
            {confs.map(conf => {
                const list = likelyMatchups(rows, conf, 6);
                const max = Math.max(0.0001, ...list.map(m => m.p));
                return (
                    <section key={conf} aria-labelledby={`likely-${conf}`} className="hud-panel p-4">
                        <h3 id={`likely-${conf}`} className="hud-label mb-3">
                            {conf === 'East' ? 'Eastern' : 'Western'} Conference
                        </h3>
                        {list.length === 0 ? (
                            <p className="text-body-sm text-fg-3">No simulated matchups yet.</p>
                        ) : (
                            <ol className="flex flex-col gap-2.5">
                                {list.map(m => {
                                    const pct = m.p * 100;
                                    return (
                                        <li key={`${m.a}-${m.b}`} className="flex items-center gap-3">
                                            <span className="flex w-[8.5rem] shrink-0 items-center gap-1.5 font-semibold text-fg-1">
                                                <TeamLogo tri={m.a} size={22} />
                                                <span>{m.a}</span>
                                                <span className="text-caption font-normal text-fg-3">vs</span>
                                                <TeamLogo tri={m.b} size={22} />
                                                <span>{m.b}</span>
                                                <span className="sr-only">
                                                    ({TEAM_NAMES[m.a]?.short} against {TEAM_NAMES[m.b]?.short})
                                                </span>
                                            </span>
                                            <span aria-hidden="true" className="relative h-2 flex-1 overflow-hidden rounded-full bg-fg-3/15">
                                                <span className="absolute inset-y-0 left-0 rounded-full bg-brand/70" style={{ width: `${(m.p / max) * 100}%` }} />
                                            </span>
                                            <span className="w-12 shrink-0 text-right text-body-sm font-bold tabular-nums text-fg-1">{fmtSimPct(pct)}</span>
                                        </li>
                                    );
                                })}
                            </ol>
                        )}
                    </section>
                );
            })}
            <p className="text-caption text-fg-3 md:col-span-2">
                Share of {totalSims ? totalSims.toLocaleString('en-US') : 'the'} simulated seasons in which each series happened. With 32 teams still bunched together,
                even the most likely pairing is far from certain.
            </p>
        </div>
    );
}

export default LikelyMatchups;
