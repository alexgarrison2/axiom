import type { ArchiveGame, ArchiveSide } from '@/lib/matchup/archive';
import { archiveFinalLabel, isFinalState } from '@/lib/matchup/archive';
import { clashSafePair } from '@/components/ui/team-color';
import { finalWords, isCoinFlip } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';
import { WinBar } from '@/components/ui/win-bar';
import { GameTime } from './GameTime';
import { washVars } from './TeamSide';

function Side({ s, lost, home }: { s: ArchiveSide; lost: boolean; home?: boolean }) {
    return (
        <a href={`/teams/${s.tri}`} className={cn('flex min-w-0 items-center gap-2.5 rounded-control', home && 'flex-row-reverse text-right')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={`/logos/${s.tri}.svg`}
                alt=""
                width={56}
                height={56}
                decoding="async"
                className={cn('h-14 w-14 shrink-0 object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,.65)] md:h-16 md:w-16', lost && 'opacity-50 grayscale-[40%]')}
            />
            <span className={cn('truncate font-display text-title font-bold uppercase tracking-[0.02em]', lost ? 'text-fg-3' : 'text-fg-1')}>
                {s.tri}
                <span className="sr-only"> {s.name}</span>
            </span>
        </a>
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
    const colors = clashSafePair(g.away.tri, g.home.tri);
    const anchor = `${g.away.tri}-${g.home.tri}`.toLowerCase();
    const scored = (final || live) && g.home.score != null && g.away.score != null;
    const score = scored ? `${g.away.tri} ${as}, ${g.home.tri} ${hs}` : null;
    // The frozen pregame pick as a (dimmed, on finals) win bar: pct is the picked side's probability.
    const pAway = g.pick && Number.isFinite(g.pick.pct) ? (g.pick.tri === g.away.tri ? g.pick.pct : 100 - g.pick.pct) / 100 : null;
    // Within 1 pt of 50 the model had no lean: one decimal on the bar, and no ✓ / ✕.
    const coin = !!g.pick && isCoinFlip(g.pick.pct);

    return (
        <article
            id={anchor}
            aria-label={`${g.away.name} at ${g.home.name}${score ? `, ${final ? 'final' : 'live'} ${score}` : ''}`}
            className="panel team-wash flex flex-col gap-2.5 px-3 py-2.5 md:px-4 md:py-3"
            style={washVars(colors.away, colors.home)}
        >
            <div className="flex min-h-6 items-center justify-between gap-2">
                {final ? (
                    <span className="text-body-sm font-bold uppercase tracking-[0.24em] text-fg-3">{finalWords(archiveFinalLabel(g))}</span>
                ) : live ? (
                    <span className="flex items-center gap-2 text-body-sm font-bold uppercase tracking-[0.2em] text-pos">
                        <span aria-hidden="true" className="live-dot" />
                        Live
                    </span>
                ) : (
                    <GameTime iso={g.startTimeUtc} className="text-body-sm font-bold uppercase tracking-[0.2em] text-fg-1" />
                )}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <Side s={g.away} lost={final && as < hs} />
                {scored ? (
                    <span aria-hidden="true" className="num-score flex items-center gap-2 text-[30px] leading-none md:text-[36px]">
                        <span className={final && as < hs ? 'text-fg-3' : 'text-fg-1'}>{as}</span>
                        <span className="text-[0.7em] text-fg-disabled">-</span>
                        <span className={final && hs < as ? 'text-fg-3' : 'text-fg-1'}>{hs}</span>
                    </span>
                ) : (
                    <span aria-hidden="true" className="text-body text-fg-disabled">
                        @
                    </span>
                )}
                <Side s={g.home} lost={final && hs < as} home />
            </div>
            {pAway != null ? (
                <WinBar
                    away={g.away.tri}
                    home={g.home.tri}
                    pAway={pAway}
                    awayColor={colors.away}
                    homeColor={colors.home}
                    size="lg"
                    dimmed={final || live}
                    digits={coin ? 1 : 0}
                    label={final || live ? 'Pregame win probability' : 'Our forecast win probability'}
                    className="pointer-events-none"
                />
            ) : null}
            <div className="flex min-h-5 items-center justify-center">
                {g.pick && coin ? (
                    <span className="text-caption font-bold uppercase tracking-chip text-fg-3" title={`Pregame ${g.pick.tri} ${g.pick.pct}%`}>
                        No lean
                    </span>
                ) : g.pick ? (
                    <span
                        className={cn(
                            'text-caption font-bold uppercase tracking-chip',
                            g.pick.correct === true ? 'text-pos' : g.pick.correct === false ? 'text-neg' : 'text-fg-2',
                        )}
                    >
                        {g.pick.correct != null ? <span aria-hidden="true">{g.pick.correct ? '✓' : '✕'} </span> : null}
                        <span className="sr-only">{g.pick.correct == null ? 'Model pick: ' : g.pick.correct ? 'Model pick right: ' : 'Model pick wrong: '}</span>
                        Pick {g.pick.tri}
                        <span className="sr-only"> {g.pick.pct}%</span>
                    </span>
                ) : (
                    <span className="label">{final || live ? 'No pick' : 'No pick yet'}</span>
                )}
            </div>
        </article>
    );
}

export default ArchiveCard;
