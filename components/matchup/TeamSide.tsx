'use client';

import type { Side, SideData } from '@/types/prediction';
import { lastName } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';

const STATUS: Record<string, { dot: string; label: string }> = {
    Confirmed: { dot: 'bg-pos', label: 'Confirmed' },
    Likely: { dot: 'bg-warn', label: 'Likely' },
    'Probable (ESPN)': { dot: 'bg-warn', label: 'Probable' },
    Unconfirmed: { dot: 'bg-fg-3', label: 'Unconfirmed' },
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
 * One team in the card header: a 24px logo that links to the team page, the
 * name, this season's record and the projected starter with a status dot.
 * `score` switches the record line for a live/final score.
 */
export function TeamSide({
    side,
    s,
    score,
    faded,
    favorite,
    onFavorite,
}: {
    side: Side;
    s: SideData;
    score: number | null;
    faded?: boolean;
    favorite: boolean;
    onFavorite: () => void;
}) {
    const home = side === 'home';
    const st = goalieStatus(s.goalieStatus);
    return (
        <div className={cn('flex min-w-0 items-center gap-2.5', home && 'flex-row-reverse text-right')}>
            <a
                href={`/teams/${s.team.triCode}`}
                aria-label={`${s.team.name} team page`}
                className="relative z-10 -m-1.5 shrink-0 rounded-control p-1.5 transition-transform hover:scale-105 coarse:-m-2.5 coarse:p-2.5"
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.team.logoUrl} alt="" width={32} height={32} decoding="async" className="h-6 w-6 object-contain cq-md:h-8 cq-md:w-8" />
            </a>
            <div className={cn('flex min-w-0 flex-col', home && 'items-end')}>
                <span className={cn('flex max-w-full items-center gap-1', home && 'flex-row-reverse')}>
                    <span className={cn('truncate text-body font-bold leading-tight text-fg-1 cq-md:text-title', faded && 'text-fg-2')}>{s.team.commonName}</span>
                    <Star on={favorite} team={s.team.commonName} onToggle={onFavorite} />
                </span>
                <span className={cn('flex max-w-full items-center gap-1.5 text-caption text-fg-2', home && 'justify-end')}>
                    {score == null ? (
                        <span className="shrink-0 whitespace-nowrap tabular-nums">{s.record ?? (s.gp === 0 ? '0-0-0' : '')}</span>
                    ) : null}
                    {s.goalie ? (
                        <span className="inline-flex min-w-0 items-center gap-1" title={`${s.goalie} · ${st.label}${s.goalieStatusSource ? ` (${s.goalieStatusSource})` : ''}`}>
                            {score == null ? <span aria-hidden="true" className="text-fg-3">·</span> : null}
                            <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', st.dot)} />
                            <span className="truncate">{lastName(s.goalie)}</span>
                            <span className="sr-only">, starter {st.label.toLowerCase()}</span>
                        </span>
                    ) : null}
                </span>
            </div>
        </div>
    );
}

export default TeamSide;
