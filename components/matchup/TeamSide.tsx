'use client';

import type { Side, SideData } from '@/types/prediction';
import { lastName } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';

const STATUS: Record<string, { dot: string; label: string; short: string }> = {
    Confirmed: { dot: 'bg-pos', label: 'Confirmed', short: 'Conf.' },
    Likely: { dot: 'bg-warn', label: 'Likely', short: 'Likely' },
    'Probable (ESPN)': { dot: 'bg-warn', label: 'Probable', short: 'Prob.' },
    Unconfirmed: { dot: 'bg-fg-3', label: 'Unconfirmed', short: 'Unconf.' },
};

export function goalieStatus(s: string | null) {
    return STATUS[s ?? ''] ?? STATUS.Unconfirmed;
}

function Star({ on, team, onToggle }: { on: boolean; team: string; onToggle: () => void }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-pressed={on}
            aria-label={on ? `Unfollow the ${team}` : `Follow the ${team}`}
            title={on ? 'Following · pinned to the top' : 'Follow this team (pins its games first)'}
            className={cn(
                'relative z-10 -m-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors coarse:-m-2.5 coarse:h-11 coarse:w-11',
                on ? 'text-warn' : 'text-fg-3 hover:text-fg-1',
            )}
        >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5">
                <path
                    d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
                    fill={on ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                />
            </svg>
        </button>
    );
}

/**
 * One team in the card header: the crest (36px on a narrow card, 52px from
 * the cq-md container width) on a soft team-colour glow, linking to the team
 * page; the name, this season's record and the projected starter with a
 * status dot. Narrow cards stack the crest above the name so long names like
 * "Maple Leafs" never truncate. `score` swaps the record line for a score.
 */
export function TeamSide({
    side,
    s,
    score,
    faded,
    favorite,
    onFavorite,
    color,
}: {
    side: Side;
    s: SideData;
    score: number | null;
    faded?: boolean;
    favorite: boolean;
    onFavorite: () => void;
    /** Team colour for the crest glow (hex). */
    color?: string;
}) {
    const home = side === 'home';
    const st = goalieStatus(s.goalieStatus);
    return (
        <div className={cn('flex min-w-0 flex-col gap-1.5 cq-md:flex-row cq-md:items-center cq-md:gap-3.5', home ? 'items-end text-right cq-md:flex-row-reverse' : 'items-start')}>
            <a
                href={`/teams/${s.team.triCode}`}
                aria-label={`${s.team.name} team page`}
                className="group/crest relative z-10 -m-1 shrink-0 rounded-full p-1 coarse:-m-1 coarse:p-1"
            >
                {/* Team-colour glow behind the crest: lifts dark crests (LAK, CHI) off the card. */}
                <span
                    aria-hidden="true"
                    className={cn('pointer-events-none absolute inset-0 rounded-full transition-opacity duration-300 group-hover/crest:opacity-100', faded ? 'opacity-30' : 'opacity-80')}
                    style={{ background: `radial-gradient(closest-side, ${color ?? '#7dd3fc'}66, ${color ?? '#7dd3fc'}1f 60%, transparent)` }}
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={s.team.logoUrl}
                    alt=""
                    width={52}
                    height={52}
                    decoding="async"
                    className={cn(
                        'relative h-9 w-9 object-contain drop-shadow-[0_2px_3px_rgb(0_0_0/0.55)] transition-transform duration-300 ease-out group-hover/crest:-translate-y-0.5 group-hover/crest:scale-105 motion-reduce:transition-none cq-md:h-[52px] cq-md:w-[52px]',
                        faded && 'opacity-60 grayscale-[35%]',
                    )}
                />
            </a>
            <div className={cn('flex min-w-0 max-w-full flex-col', home && 'items-end')}>
                <span className={cn('flex max-w-full items-center gap-1', home && 'flex-row-reverse')}>
                    <span className={cn('truncate text-body font-bold leading-tight text-fg-1 cq-md:text-title', faded && 'text-fg-2')}>{s.team.commonName}</span>
                    <Star on={favorite} team={s.team.commonName} onToggle={onFavorite} />
                </span>
                <span className={cn('flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0 text-caption text-fg-2', home && 'justify-end')}>
                    {score == null ? (
                        <span className="shrink-0 whitespace-nowrap tabular-nums">{s.record ?? (s.gp === 0 ? '0-0-0' : '')}</span>
                    ) : null}
                    {s.goalie ? (
                        <span className="inline-flex max-w-full items-center gap-1">
                            {score == null ? <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', st.dot)} /> : null}
                            <span className="truncate">{lastName(s.goalie)}</span>
                            {score == null ? (
                                <>
                                    <span aria-hidden="true" className="shrink-0 text-micro text-fg-3">
                                        {st.short}
                                    </span>
                                    <span className="sr-only">
                                        , starter {st.label.toLowerCase()}
                                        {s.goalieStatusSource ? ` (source: ${s.goalieStatusSource === 'DFO' ? 'DailyFaceoff' : s.goalieStatusSource})` : ''}
                                    </span>
                                </>
                            ) : (
                                <span className="sr-only">, in goal</span>
                            )}
                        </span>
                    ) : null}
                </span>
            </div>
        </div>
    );
}

export default TeamSide;
