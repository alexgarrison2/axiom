import * as React from 'react';
import type { RecordProjection } from '@/lib/schedule/record';
import { recordText } from '@/lib/schedule/record';
import { cn } from '@/lib/utils';

const Dot = () => (
    <span aria-hidden="true" className="text-fg-disabled">
        ·
    </span>
);

/**
 * One line for the focused month / trip / season: the record so far, the
 * model's projected record and expected points of those possible (magenta),
 * quietly the likely range of points (10th-90th percentile), and the days
 * off in it.
 */
export function ProjectedRecord({ p, range, daysOff, className }: { p: RecordProjection; range?: [number, number] | null; daysOff?: number | null; className?: string }) {
    if (!p.games) return null;
    const projected = p.record && p.pts != null;
    const lo = range ?? p.range;
    return (
        <p className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-micro font-medium uppercase tracking-label text-fg-3 [&>span]:whitespace-nowrap', className)}>
            {p.played ? (
                <span>
                    <span className="font-bold tabular-nums text-fg-1">{recordText(p.actual)}</span> {projected ? 'so far' : null}
                </span>
            ) : null}
            {projected ? (
                <>
                    {p.played ? <Dot /> : null}
                    <span>
                        Proj <span className="font-bold tabular-nums text-model">{recordText(p.record!)}</span>
                    </span>
                    <Dot />
                    <span>
                        <span className="font-bold tabular-nums text-model">{Math.round(p.pts!)}</span> of {p.possible} pts
                        {lo && lo[1] > lo[0] ? (
                            <span className="ml-1.5 text-fg-3" title="Points in 8 of 10 simulated outcomes (10th to 90th percentile)">
                                likely <span className="tabular-nums normal-case tracking-normal">{lo[0]}–{lo[1]}</span>
                            </span>
                        ) : null}
                    </span>
                </>
            ) : p.played === p.games ? (
                <>
                    <Dot />
                    <span>
                        <span className="font-bold tabular-nums text-fg-1">{p.actualPts}</span> of {p.possible} pts
                    </span>
                </>
            ) : null}
            {daysOff != null ? (
                // On phones this item takes its own line, so its separator shows only where the line holds everything.
                <span className="max-md:basis-full">
                    {p.played || projected ? (
                        <span className="max-md:hidden">
                            <Dot />{' '}
                        </span>
                    ) : null}
                    <span className="font-bold tabular-nums text-fg-1">{daysOff}</span> {daysOff === 1 ? 'day' : 'days'} off
                </span>
            ) : null}
        </p>
    );
}

export default ProjectedRecord;
