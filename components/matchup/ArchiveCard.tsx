import type { CSSProperties } from 'react';
import type { ArchiveGame, ArchiveSide } from '@/lib/matchup/archive';
import { archiveFinalLabel, isFinalState } from '@/lib/matchup/archive';
import { clashSafePair } from '@/components/ui/team-color';
import { cn } from '@/lib/utils';
import { GameTime } from './GameTime';

function Row({ s, won, final }: { s: ArchiveSide; won: boolean; final: boolean }) {
    return (
        <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/logos/${s.tri}.svg`} alt="" width={40} height={40} decoding="async" className="h-9 w-9 shrink-0 object-contain drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)] md:h-11 md:w-11" />
            <a href={`/teams/${s.tri}`} className={cn('min-w-0 flex-1 truncate text-body font-bold hover:underline', final && !won ? 'text-fg-2' : 'text-fg-1')}>
                {s.name}
            </a>
            {s.score != null ? (
                <span className={cn('font-mono text-h2 font-black tabular-nums', won ? 'text-fg-1' : 'text-fg-3')}>{s.score}</span>
            ) : null}
        </div>
    );
}

/**
 * A game outside the live prediction file: a final (score + the graded
 * pregame pick) or a scheduled game whose prediction hasn't posted yet.
 */
export function ArchiveCard({ g }: { g: ArchiveGame }) {
    const final = isFinalState(g.state);
    const live = g.state === 'LIVE' || g.state === 'CRIT';
    const hs = g.home.score ?? 0;
    const as = g.away.score ?? 0;
    const homeWon = final && hs > as;
    const awayWon = final && as > hs;
    const colors = clashSafePair(g.away.tri, g.home.tri);
    const wash = { '--wash-a': `${colors.away}26`, '--wash-h': `${colors.home}26` } as CSSProperties;
    const anchor = `${g.away.tri}-${g.home.tri}`.toLowerCase();
    const score = final || live ? `${g.away.tri} ${as}, ${g.home.tri} ${hs}` : null;

    return (
        <article
            id={anchor}
            aria-label={`${g.away.name} at ${g.home.name}${score ? `, ${final ? 'final' : 'live'} ${score}` : ''}`}
            className="relative overflow-hidden rounded-card border border-line bg-surface-1 p-4 [background-image:linear-gradient(100deg,var(--wash-a),transparent_38%,transparent_62%,var(--wash-h))]"
            style={wash}
        >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className={cn('hud-label', final ? 'text-fg-2' : live ? 'text-neg' : 'text-fg-2')}>
                    {final ? archiveFinalLabel(g) : live ? 'Live' : <GameTime iso={g.startTimeUtc} />}
                </span>
                {g.pick ? (
                    <span
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-caption font-semibold',
                            g.pick.correct === true && 'border-pos/40 bg-pos/10 text-pos',
                            g.pick.correct === false && 'border-neg/40 bg-neg/10 text-neg',
                            g.pick.correct == null && 'border-line text-fg-2',
                        )}
                    >
                        Model
                        {g.pick.correct != null ? (
                            <>
                                <span aria-hidden="true">{g.pick.correct ? '✓' : '✗'}</span>
                                <span className="sr-only">{g.pick.correct ? 'right' : 'wrong'}:</span>
                            </>
                        ) : null}
                        <span className="font-normal text-fg-2">
                            picked {g.pick.tri} {g.pick.pct}%
                        </span>
                    </span>
                ) : (
                    <span className="rounded-full border border-dashed border-line px-2.5 py-0.5 text-caption text-fg-2">
                        {final || live ? 'No pregame pick' : 'Pick posts game-day morning'}
                    </span>
                )}
            </div>
            <div className="flex flex-col gap-2">
                <Row s={g.away} won={awayWon} final={final} />
                <Row s={g.home} won={homeWon} final={final} />
            </div>
        </article>
    );
}

export default ArchiveCard;
