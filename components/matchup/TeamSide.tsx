'use client';

import type { CSSProperties } from 'react';
import type { Side, SideData } from '@/types/prediction';
import { fmtSv, goalieSeasonLine, lastName } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';
import styles from './slate.module.css';
import { GoalieGlyph } from './GoalieGlyph';

export type GoalieTone = 'conf' | 'likely' | 'proj';

const STATUS: Record<string, { tone: GoalieTone; label: string }> = {
    Confirmed: { tone: 'conf', label: 'Confirmed' },
    Likely: { tone: 'likely', label: 'Likely' },
    'Probable (ESPN)': { tone: 'likely', label: 'Probable' },
    Unconfirmed: { tone: 'proj', label: 'Projected' },
};

/** Starter status: tone drives the name colour (green / faded green / grey). */
export function goalieStatus(s: string | null | undefined) {
    return STATUS[s ?? ''] ?? STATUS.Unconfirmed;
}

/** Goalie-name colour by status. Only a confirmed starter glows. */
export const GOALIE_TONE: Record<GoalieTone, string> = {
    conf: 'glow-green',
    likely: 'text-pos/75',
    proj: 'text-fg-2',
};

function Star({ on, team, onToggle, home }: { on: boolean; team: string; onToggle: () => void; home: boolean }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-pressed={on}
            aria-label={on ? `Unfollow the ${team}` : `Follow the ${team}`}
            className={cn(
                'absolute top-0 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors coarse:h-9 coarse:w-9',
                home ? '-right-1.5 coarse:-right-3' : '-left-1.5 coarse:-left-3',
                '-mt-1.5 coarse:-mt-3',
                on ? 'text-warn' : 'text-fg-3 hover:text-fg-1 focus-visible:text-fg-1',
            )}
        >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3">
                <path d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
        </button>
    );
}

/** "25-26 19-12-8 .888 3.07" / "vs PHI 3-1-1 .941": tiny mono lines under the name. */
function StatLines({ s, opp, home }: { s: SideData; opp: string; home: boolean }) {
    const line = goalieSeasonLine(s);
    const vs = s.vsOpp;
    if (!line && !vs) return null;
    return (
        <span className={cn(styles.stats, styles.gstat, home ? 'items-end' : 'items-start')}>
            {line ? (
                <span className={cn('flex max-w-full flex-wrap items-center gap-x-[0.4em] gap-y-0.5 whitespace-nowrap', home && 'flex-row-reverse')}>
                    <span aria-hidden="true" className="flex gap-x-[0.4em]">
                        <span>{line.record}</span>
                        <span>{line.sv}</span>
                        <span>{line.gaa}</span>
                    </span>
                    {line.tag ? (
                        <span aria-hidden="true" className={styles.tag}>
                            {line.tag}
                        </span>
                    ) : null}
                    <span className="sr-only">
                        {line.tag ? `${line.tag} season` : 'This season'}: {line.record}, {line.sv} save percentage, {line.gaa} goals against average.
                    </span>
                </span>
            ) : null}
            {vs ? (
                <span className="whitespace-nowrap text-fg-3">
                    <span aria-hidden="true">
                        vs {opp} {vs.record} {fmtSv(vs.sv)}
                    </span>
                    <span className="sr-only">
                        Career versus {opp}: {vs.record}, {fmtSv(vs.sv)} save percentage.
                    </span>
                </span>
            ) : null}
        </span>
    );
}

/**
 * One side of the card: big crest on a team-colour wash (links to the team
 * page), the starter's name in Chakra Petch coloured by status, and the tiny
 * season / vs-opponent lines. `faded` = the loser of a final.
 */
export function TeamSide({
    side,
    s,
    opp,
    faded,
    favorite,
    onFavorite,
    showStats = true,
}: {
    side: Side;
    s: SideData;
    opp: string;
    faded?: boolean;
    favorite: boolean;
    onFavorite: () => void;
    showStats?: boolean;
}) {
    const home = side === 'home';
    const st = goalieStatus(s.goalieStatus);
    const src = s.goalieStatusSource === 'DFO' ? 'DailyFaceoff' : s.goalieStatusSource;
    return (
        <div className={cn(styles.side, home && styles.home)}>
            <span className={styles.crestSlot}>
                <a href={`/teams/${s.team.triCode}`} aria-label={`${s.team.name} team page`} className={cn(styles.crest, 'relative z-10 block rounded-full')}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={s.team.logoUrl}
                        alt=""
                        width={84}
                        height={84}
                        decoding="async"
                        className={cn('h-full w-full object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,.65)] transition-transform duration-300 ease-out hover:scale-105 motion-reduce:transition-none', faded && 'opacity-50 grayscale-[40%]')}
                    />
                </a>
                <Star on={favorite} team={s.team.commonName} onToggle={onFavorite} home={home} />
            </span>
            <span
                className={cn(
                    styles.name,
                    'truncate font-display text-[15px] font-bold uppercase leading-5 tracking-[0.02em] cq-md:text-[18px] cq-md:leading-6',
                    s.goalie ? GOALIE_TONE[st.tone] : 'text-fg-2',
                    faded && 'opacity-60',
                )}
                title={s.goalie ? `${s.goalie} · ${st.label}${src ? ` (${src})` : ''}` : undefined}
            >
                {s.goalie ? <GoalieGlyph tone={st.tone} /> : null}
                {s.goalie ? lastName(s.goalie) : s.team.commonName}
                <span className="sr-only">{s.goalie ? `, ${s.team.commonName} goalie, ${st.label.toLowerCase()} starter` : ', starter not announced'}</span>
            </span>
            {showStats && s.goalie ? <StatLines s={s} opp={opp} home={home} /> : null}
        </div>
    );
}

/** Inline style for the card's crest wash: away / home team colours. */
export function washVars(away: string, home: string): CSSProperties {
    return { '--ac': away, '--hc': home } as CSSProperties;
}

export default TeamSide;
