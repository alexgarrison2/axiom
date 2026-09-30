import * as React from 'react';
import { Crest } from '@/components/ui/crest';
import { shortDate } from '@/components/views/format';
import { cn } from '@/lib/utils';
import type { H2HMeeting } from './types';

/** Regular-season meetings between two playoff opponents, with the season series tally. */
export default function H2HGameLog({ games, t1, t2, seasonLabel }: { games: H2HMeeting[]; t1: string; t2: string; seasonLabel: string }) {
    if (!games.length)
        return (
            <p className="label">
                <span aria-hidden="true">—</span>
                <span className="sr-only">No {seasonLabel} regular-season meetings</span>
            </p>
        );
    const won = (g: H2HMeeting, tri: string) => (g.homeGoals > g.awayGoals ? g.home === tri : g.away === tri);
    const w1 = games.filter(g => won(g, t1)).length;
    const w2 = games.length - w1;
    return (
        <div className="flex flex-col gap-1.5">
            <p className="text-caption font-bold text-fg-1">
                <span className="sr-only">Season series: </span>
                {t1} {w1}–{w2} {t2}
            </p>
            <ol className="flex flex-col overflow-hidden rounded-[10px] border border-line">
                {games.map(g => {
                    const homeWon = g.homeGoals > g.awayGoals;
                    return (
                        <li key={`${g.date}-${g.home}`} className="grid h-8 grid-cols-[3.5rem_1fr_auto_1fr] items-center gap-2 border-t border-line/60 px-2.5 text-caption first:border-t-0 even:bg-line/35">
                            <span className="tabular-nums text-fg-3">{shortDate(g.date)}</span>
                            <span className={cn('flex items-center justify-end gap-1.5', !homeWon ? 'font-bold text-fg-1' : 'text-fg-2')}>
                                {g.away}
                                <Crest tri={g.away} size={16} className="drop-shadow-none" />
                            </span>
                            <span className="whitespace-nowrap text-center font-bold tabular-nums text-fg-1">
                                {g.awayGoals}–{g.homeGoals}
                                {g.decision !== 'REG' ? <span className="ml-1 text-micro font-normal text-fg-3">{g.decision}</span> : null}
                            </span>
                            <span className={cn('flex items-center gap-1.5', homeWon ? 'font-bold text-fg-1' : 'text-fg-2')}>
                                <Crest tri={g.home} size={16} className="drop-shadow-none" />
                                {g.home}
                            </span>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
