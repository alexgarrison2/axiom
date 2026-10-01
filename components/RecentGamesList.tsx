import type { RecentGame, TeamRef } from '@/types/prediction';
import { SEASON_START_DATE } from '@/lib/season';
import { PREV_TAG, lastName, shortDate } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';

const RESULT: Record<string, { text: string; label: string; cls: string }> = {
    W: { text: 'W', label: 'Win', cls: 'text-pos' },
    'W-OT': { text: 'W', label: 'Overtime win', cls: 'text-pos' },
    'W-SO': { text: 'W', label: 'Shootout win', cls: 'text-pos' },
    L: { text: 'L', label: 'Loss', cls: 'text-neg' },
    O: { text: 'OT', label: 'Overtime/shootout loss', cls: 'text-warn' },
    'L-OT': { text: 'L', label: 'Overtime loss', cls: 'text-neg' },
};

function dateLabel(g: RecentGame): { text: string; prior: boolean } {
    if (g.gameDate && /^\d{4}-\d{2}-\d{2}$/.test(g.gameDate)) {
        return { text: shortDate(g.gameDate), prior: g.gameDate < SEASON_START_DATE };
    }
    return { text: g.date, prior: false };
}

/**
 * A team's most recent games, newest first, numbered with the pipeline's
 * season game number (G12, PO G3). Last season's games carry a 25-26 tag;
 * at 0 GP it says so instead of showing last season under an undated label.
 */
export default function RecentGamesList({ team, gp, games, starter }: { team: TeamRef; gp: number; games: RecentGame[]; starter?: string | null }) {
    const list = games.slice(0, 5);
    const starterKey = starter?.toLowerCase().trim();
    return (
        <section aria-label={`${team.commonName} recent games`} className="flex min-w-0 flex-col gap-1">
            <h3 className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={team.logoUrl} alt="" width={22} height={22} className="h-[22px] w-[22px]" />
                <span className="text-caption font-bold text-fg-1">{team.triCode}</span>
                <span className="label">{list.length ? `Last ${list.length}` : `${gp} GP`}</span>
            </h3>
            {list.length ? (
                <ol className="flex flex-col">
                    {list.map((g, i) => {
                        const r = RESULT[g.result] ?? { text: g.result, label: g.result, cls: 'text-fg-2' };
                        const d = dateLabel(g);
                        const started = starterKey && g.starter && g.starter.toLowerCase().trim() === starterKey;
                        return (
                            <li key={g.gameId ?? i} className="grid min-h-7 grid-cols-[2.5rem_auto_minmax(0,1fr)_1.5rem_2.25rem] items-center gap-2 border-b border-line text-caption last:border-0">
                                <span className="text-micro text-fg-3">{g.gameNumber ?? ''}</span>
                                <span className="flex items-center gap-1 whitespace-nowrap tabular-nums text-fg-2">
                                    {d.prior ? <span className="rounded-[3px] border border-mute px-1 text-micro text-fg-3">{PREV_TAG}</span> : null}
                                    {d.text}
                                </span>
                                <span className="flex min-w-0 items-center gap-1.5 text-fg-1">
                                    <span className="w-3 text-fg-3">{g.isHome ? 'vs' : '@'}</span>
                                    <span className="font-bold">{g.opponent}</span>
                                    {started ? (
                                        <span className="truncate text-micro text-fg-3" title={`${g.starter} started`}>
                                            {lastName(g.starter!)}
                                        </span>
                                    ) : null}
                                </span>
                                <span className={cn('text-center font-bold', r.cls)} title={r.label}>
                                    {r.text}
                                    <span className="sr-only"> ({r.label})</span>
                                </span>
                                <span className="text-right font-bold tabular-nums text-fg-1">{g.score}</span>
                            </li>
                        );
                    })}
                </ol>
            ) : null}
        </section>
    );
}
