import type { RecentGame, TeamRef } from '@/types/prediction';
import { SEASON_START_DATE } from '@/lib/season';
import { PREV_TAG, lastName, shortDate } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';

const RESULT: Record<string, { text: string; label: string; cls: string }> = {
    W: { text: 'W', label: 'Win', cls: 'border-pos/40 bg-pos/10 text-pos' },
    'W-OT': { text: 'W', label: 'Overtime win', cls: 'border-pos/40 bg-pos/10 text-pos' },
    'W-SO': { text: 'W', label: 'Shootout win', cls: 'border-pos/40 bg-pos/10 text-pos' },
    L: { text: 'L', label: 'Loss', cls: 'border-neg/40 bg-neg/10 text-neg' },
    O: { text: 'OT', label: 'Overtime/shootout loss', cls: 'border-warn/40 bg-warn/10 text-warn' },
    'L-OT': { text: 'L', label: 'Overtime loss', cls: 'border-neg/40 bg-neg/10 text-neg' },
};

function dateLabel(g: RecentGame): { text: string; prior: boolean } {
    if (g.gameDate && /^\d{4}-\d{2}-\d{2}$/.test(g.gameDate)) {
        return { text: shortDate(g.gameDate), prior: g.gameDate < SEASON_START_DATE };
    }
    return { text: g.date, prior: false };
}

/**
 * A team's most recent games this season, newest first, numbered with the
 * pipeline's own season game number (G12, PO G3). Titled "Last N games";
 * at 0 GP it says so instead of showing last season under an undated label.
 */
export default function RecentGamesList({ team, gp, games, starter }: { team: TeamRef; gp: number; games: RecentGame[]; starter?: string | null }) {
    const list = games.slice(0, 7);
    const starterKey = starter?.toLowerCase().trim();
    return (
        <section aria-label={`${team.commonName} recent games`} className="flex flex-col gap-1.5">
            <h3 className="flex items-center gap-2 text-caption font-bold text-fg-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={team.logoUrl} alt="" width={16} height={16} className="h-4 w-4" />
                {list.length ? `Last ${list.length} game${list.length === 1 ? '' : 's'}` : 'No games yet this season'}
                {list.length && gp > list.length ? <span className="font-normal text-fg-3">of {gp}</span> : null}
            </h3>
            {list.length ? (
                <ol className="flex flex-col">
                    {list.map((g, i) => {
                        const r = RESULT[g.result] ?? { text: g.result, label: g.result, cls: 'border-line text-fg-2' };
                        const d = dateLabel(g);
                        const started = starterKey && g.starter && g.starter.toLowerCase().trim() === starterKey;
                        return (
                            <li key={g.gameId ?? i} className="grid min-h-7 grid-cols-[2.75rem_3.25rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-line/60 text-caption last:border-0">
                                <span className="font-mono text-micro text-fg-3">{g.gameNumber ?? ''}</span>
                                <span className="tabular-nums text-fg-2">
                                    {d.prior ? <span className="mr-1 rounded-[3px] bg-fg-3/15 px-1 font-mono text-micro text-fg-2">{PREV_TAG}</span> : null}
                                    {d.text}
                                </span>
                                <span className="flex min-w-0 items-center gap-1.5 text-fg-1">
                                    <span className="w-3 text-fg-3">{g.isHome ? 'vs' : '@'}</span>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={`/logos/${g.opponent}.svg`} alt="" width={16} height={16} loading="lazy" className="h-4 w-4 shrink-0" />
                                    <span className="font-semibold">{g.opponent}</span>
                                    {started ? (
                                        <span className="truncate text-micro text-fg-3" title={`${g.starter} started`}>
                                            · {lastName(g.starter!)}
                                        </span>
                                    ) : null}
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <span title={r.label} className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-chip border px-1 text-micro font-bold', r.cls)}>
                                        {r.text}
                                        <span className="sr-only"> ({r.label})</span>
                                    </span>
                                    <span className="w-9 text-right font-mono font-semibold tabular-nums text-fg-1">{g.score}</span>
                                </span>
                            </li>
                        );
                    })}
                </ol>
            ) : null}
        </section>
    );
}
