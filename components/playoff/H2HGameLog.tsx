import * as React from 'react';
import { TeamLogo } from '@/components/views/TeamLogo';
import { shortDate } from '@/components/views/format';
import { cn } from '@/lib/utils';
import type { H2HMeeting } from './types';

/** Regular-season meetings between two playoff opponents, with the season series tally. */
export default function H2HGameLog({ games, t1, t2, seasonLabel }: { games: H2HMeeting[]; t1: string; t2: string; seasonLabel: string }) {
    if (!games.length) return <p className="text-body-sm text-fg-3">They didn&apos;t meet in the {seasonLabel} regular season.</p>;
    const won = (g: H2HMeeting, tri: string) => (g.homeGoals > g.awayGoals ? g.home === tri : g.away === tri);
    const w1 = games.filter(g => won(g, t1)).length;
    const w2 = games.length - w1;
    return (
        <div className="flex flex-col gap-2">
            <p className="text-body-sm text-fg-2">
                Season series:{' '}
                <span className="font-bold text-fg-1">
                    {t1} {w1}–{w2} {t2}
                </span>
            </p>
            <ol className="flex flex-col gap-1">
                {games.map(g => {
                    const homeWon = g.homeGoals > g.awayGoals;
                    return (
                        <li key={`${g.date}-${g.home}`} className="grid grid-cols-[3.5rem_1fr_auto_1fr] items-center gap-2 rounded-chip bg-surface-2/60 px-2 py-1.5 text-body-sm">
                            <span className="tabular-nums text-fg-3">{shortDate(g.date)}</span>
                            <span className={cn('flex items-center justify-end gap-1.5', !homeWon ? 'font-bold text-fg-1' : 'text-fg-2')}>
                                {g.away}
                                <TeamLogo tri={g.away} size={18} />
                            </span>
                            <span className="whitespace-nowrap text-center font-bold tabular-nums text-fg-1">
                                {g.awayGoals}–{g.homeGoals}
                                {g.decision !== 'REG' ? <span className="ml-1 text-caption font-normal text-fg-3">{g.decision}</span> : null}
                            </span>
                            <span className={cn('flex items-center gap-1.5', homeWon ? 'font-bold text-fg-1' : 'text-fg-2')}>
                                <TeamLogo tri={g.home} size={18} />
                                {g.home}
                            </span>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
