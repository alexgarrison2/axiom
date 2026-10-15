'use client';

import { Crest } from '@/components/ui/crest';
import { PlayerLink } from '@/components/players/PlayerLink';
import { teamColor } from '@/components/ui/team-color';
import { describe, needUnit, type Milestone, type MilestonesDoc } from '@/lib/milestones';
import { LedNumber } from './LedNumber';
import { DayLabel, GameChip, HofTag, Meter, OutTag } from './parts';

const ledValue = (m: Milestone) => (m.stat === 'ixg' ? m.need.toFixed(2) : String(m.need));

/**
 * The opening panel: everyone who can reach a milestone in his next game, on
 * the earliest night that has one. One LED panel split into columns, each a
 * countdown with the club's crest flush in its corner.
 */
export function NextGameBoard({ doc, date, items, total, sinceTag }: {
    doc: Pick<MilestonesDoc, 'players' | 'next'>;
    date: string;
    items: Milestone[];
    total: number;
    sinceTag: string | null;
}) {
    return (
        <section aria-labelledby="ms-next" className="flex flex-col gap-2">
            <h2 id="ms-next" className="flex items-baseline gap-3">
                <DayLabel date={date} className="heading-section" />
                <span className="label">{total > items.length ? `${items.length} of ${total}` : `${items.length}`} in one game</span>
            </h2>
            <ul className="-mx-4 flex snap-x snap-mandatory gap-px overflow-x-auto scrollbar-hide md:mx-0 md:grid md:snap-none md:grid-cols-[repeat(auto-fill,minmax(232px,1fr))] md:overflow-hidden md:rounded-card md:border md:border-line md:bg-surface-1">
                {items.map((m, i) => {
                    // The rarest leads at double width once there is a row to share.
                    const lead = i === 0 && items.length >= 3;
                    const p = doc.players[String(m.p)];
                    if (!p) return null;
                    const [first, last, pos, team, out] = p;
                    const c = describe(m, sinceTag);
                    return (
                        <li
                            key={`${m.p}-${m.kind}-${m.stat}-${m.target}`}
                            className={`ms-tile relative isolate flex w-[78vw]${lead ? ' md:col-span-2' : ''} max-w-[300px] shrink-0 snap-start flex-col gap-3 overflow-hidden bg-surface-1 p-card first:ml-4 last:mr-4 max-md:rounded-card max-md:border max-md:border-line md:w-auto md:max-w-none md:shadow-[1px_0_0_var(--line),0_1px_0_var(--line)] md:first:ml-0 md:last:mr-0`}
                            style={{ '--tc': teamColor(team) } as React.CSSProperties}
                        >
                            <div className="flex items-start gap-3">
                                <Crest tri={team} size={56} alt={team} className="-ml-card -mt-card h-[68px] w-[68px] md:h-[76px] md:w-[76px]" />
                                <div className="min-w-0 pt-0.5">
                                    <p className="truncate text-body font-bold text-fg-1">
                                        <PlayerLink id={m.p}>{first.charAt(0)}. {last}</PlayerLink>
                                    </p>
                                    <p className="flex items-center gap-1.5 whitespace-nowrap text-micro uppercase tracking-label text-fg-3">
                                        {pos} · {team} <OutTag tag={out} />
                                    </p>
                                </div>
                            </div>
                            <div className={lead ? 'flex flex-col gap-3 md:flex-row md:items-end md:gap-8' : 'flex flex-col gap-3'}>
                                <div className="flex shrink-0 flex-col gap-3">
                                    <div className="flex items-end gap-3">
                                        <LedNumber value={ledValue(m)} className={lead ? 'h-14 md:h-28' : 'h-14 md:h-16'} />
                                        <span className="label pb-1 text-fg-2">{needUnit(m)}</span>
                                        <span className="sr-only">{ledValue(m)} {needUnit(m)} to go:</span>
                                    </div>
                                    {lead ? <Meter m={m} className="max-md:hidden" /> : null}
                                </div>
                                <div className="flex min-w-0 flex-1 flex-col gap-3">
                                    <Meter m={m} className={lead ? 'md:hidden' : undefined} />
                                    <div className="min-w-0">
                                        <p className={lead ? 'text-title font-bold text-fg-1 md:text-h2' : 'text-title font-bold text-fg-1'}>
                                            {c.title}
                                            {c.hof ? <HofTag /> : null}
                                        </p>
                                        <p className="truncate text-caption text-fg-3">{c.context}</p>
                                    </div>
                                </div>
                            </div>
                            <GameChip game={doc.next[team]} className="mt-auto border-t border-line pt-3 text-caption" />
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
