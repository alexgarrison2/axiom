import * as React from 'react';
import { TEAM_NAMES } from '@/components/ui/team-color';
import { TeamLogo } from '@/components/views/TeamLogo';
import { fmtSimPct } from '@/components/views/format';
import { likelyMatchups, type Conference, type StandingsRow } from './model';

/**
 * Early season: the first-round series that came up most often across the
 * simulations (r1_matchups), instead of a bracket seeded from 0-0-0 standings.
 */
/** Bars run on a fixed 0-25% axis. */
const AXIS_MAX = 0.25;

export function LikelyMatchups({ rows, totalSims }: { rows: StandingsRow[]; totalSims: number }) {
    const confs: Conference[] = ['East', 'West'];
    return (
        <div className="grid gap-4 md:grid-cols-2">
            {confs.map(conf => {
                const list = likelyMatchups(rows, conf, 6);
                // Fixed axis (0-25%, widened in 5-point steps only if a pairing exceeds it),
                // so an 11% chance reads as 11%, not as a full bar.
                const top = Math.max(0, ...list.map(m => m.p));
                const max = Math.max(AXIS_MAX, Math.ceil(top * 20) / 20);
                return (
                    <section key={conf} aria-labelledby={`likely-${conf}`} className="hud-panel p-4">
                        <div className="mb-3 flex items-baseline justify-between gap-3">
                            <h3 id={`likely-${conf}`} className="hud-label">
                                {conf === 'East' ? 'Eastern' : 'Western'} Conference
                            </h3>
                            <span className="text-caption tabular-nums text-fg-3">Bar scale 0–{Math.round(max * 100)}%</span>
                        </div>
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
                                                <span className="absolute inset-y-0 left-0 rounded-full bg-brand/70" style={{ width: `${Math.min(1, m.p / max) * 100}%` }} />
                                                {[0.1, 0.2].map(g => (
                                                    <span key={g} className="absolute inset-y-0 w-px bg-fg-3/40" style={{ left: `${(g / max) * 100}%` }} />
                                                ))}
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
