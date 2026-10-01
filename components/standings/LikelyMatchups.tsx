import * as React from 'react';
import { TEAM_NAMES } from '@/components/ui/team-color';
import { Crest } from '@/components/ui/crest';
import { fmtSimPct } from '@/components/views/format';
import { likelyMatchups, type Conference, type StandingsRow } from './model';

/**
 * Early season: the first-round series that came up most often across the
 * simulations (r1_matchups), instead of a bracket seeded from 0-0-0 standings.
 */
export function LikelyMatchups({ rows, totalSims }: { rows: StandingsRow[]; totalSims: number }) {
    const confs: Conference[] = ['East', 'West'];
    return (
        <div className="grid gap-3 md:grid-cols-2">
            {confs.map(conf => {
                const list = likelyMatchups(rows, conf, 6);
                return (
                    <section key={conf} aria-labelledby={`likely-${conf}`} className="panel px-3 py-2.5">
                        <h3 id={`likely-${conf}`} className="heading-sub mb-1">
                            {conf}
                            <span className="sr-only">
                                : share of {totalSims ? totalSims.toLocaleString('en-US') : 'the'} simulated seasons with each first-round series
                            </span>
                        </h3>
                        {list.length === 0 ? (
                            <p className="label py-2">—</p>
                        ) : (
                            <ol className="flex flex-col">
                                {list.map(m => (
                                    <li key={`${m.a}-${m.b}`} className="flex h-8 items-center gap-3 border-t border-line/60 first:border-t-0">
                                        <span className="flex w-[8.25rem] shrink-0 items-center gap-1.5 font-bold text-fg-1">
                                            <Crest tri={m.a} size={26} className="drop-shadow-none" />
                                            <span>{m.a}</span>
                                            <span className="font-normal text-fg-3">v</span>
                                            <Crest tri={m.b} size={26} className="drop-shadow-none" />
                                            <span>{m.b}</span>
                                            <span className="sr-only">
                                                ({TEAM_NAMES[m.a]?.short} against {TEAM_NAMES[m.b]?.short})
                                            </span>
                                        </span>
                                        {/* Full track = 100%: an 11% pairing fills 11%. */}
                                        <span aria-hidden="true" className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-track">
                                            <span
                                                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand/35 to-brand"
                                                style={{ width: `${Math.max(0, Math.min(1, m.p)) * 100}%` }}
                                            />
                                        </span>
                                        <span className="w-11 shrink-0 text-right font-bold text-fg-1">{fmtSimPct(m.p * 100)}</span>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </section>
                );
            })}
        </div>
    );
}

export default LikelyMatchups;
