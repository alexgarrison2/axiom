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
 * and quietly the 10th-90th percentile of points.
 */
export function ProjectedRecord({ p, range, className }: { p: RecordProjection; range?: [number, number] | null; className?: string }) {
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
                            <span className="ml-1.5 tabular-nums normal-case tracking-normal text-fg-3" title="10th to 90th percentile">
                                ({lo[0]}–{lo[1]})
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
        </p>
    );
}

export default ProjectedRecord;
