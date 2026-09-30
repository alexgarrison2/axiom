'use client';

import { useCallback, useId, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Prediction } from '@/types/prediction';
import type { GameImplication } from '@/utils/implications';
import { WinBar } from '@/components/ui/win-bar';
import { clashSafePair } from '@/components/ui/team-color';
import { cardAnchor, finalLabel, hasScore, phaseOf, type LiveGame } from '@/lib/matchup/lifecycle';
import { hasPrediction, modelPair } from '@/lib/matchup/edge';
import { finalSentence } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';
import { StatusLine } from './StatusLine';
import { TeamSide } from './TeamSide';
import { ProjectionRow } from './ProjectionRow';
import { ContextChips } from './ContextChips';
import { ShareButton } from './ShareButton';

const Details = dynamic(() => import('./Details'), {
    loading: () => (
        <div className="flex flex-col gap-3 px-4 pb-4 pt-3" aria-busy="true">
            <div className="h-9 animate-pulse rounded-control bg-surface-2" />
            <div className="h-40 animate-pulse rounded-control bg-surface-2" />
        </div>
    ),
});

export interface MatchupCardProps {
    p: Prediction;
    live: LiveGame | null;
    implication: GameImplication | null;
    playoffOdds: Record<string, number>;
    favorites: string[];
    onFavorite: (tri: string) => void;
    highlighted?: boolean;
    seriesScore?: { away: number; home: number } | null;
}

/** "Pregame NYI 50% · TOR 50%" for a started game. */
function PregameLine({ p }: { p: Prediction }) {
    const m = modelPair(p);
    if (!m) {
        return <p className="text-caption text-fg-2">No pregame prediction · this game started before our first forecast of the season.</p>;
    }
    return (
        <p className="text-caption text-fg-2">
            Pregame {p.away.team.triCode} {m.away}% · {p.home.team.triCode} {m.home}%
        </p>
    );
}

export function MatchupCard({ p, live, implication, playoffOdds, favorites, onFavorite, highlighted, seriesScore }: MatchupCardProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLElement>(null);
    const uid = useId();
    const titleId = `${uid}-title`;
    const detailsId = `${uid}-details`;
    const phase = phaseOf(p, live);
    const started = phase !== 'pre';
    const scored = started && hasScore(live);
    const a = p.away.team.triCode;
    const h = p.home.team.triCode;
    const colors = clashSafePair(a, h);
    const fav = favorites.includes(a) ? a : favorites.includes(h) ? h : null;
    const favColor = fav ? (fav === a ? colors.away : colors.home) : null;
    const anchor = cardAnchor(p);
    const title = `${p.away.team.commonName} at ${p.home.team.commonName}`;
    const model = modelPair(p);

    const collapse = useCallback(() => {
        setOpen(false);
        requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }, []);

    let finalText: string | null = null;
    if (phase === 'final' && scored) {
        const awayWon = live.away.score > live.home.score;
        const w = awayWon ? p.away : p.home;
        const hi = Math.max(live.away.score, live.home.score);
        const lo = Math.min(live.away.score, live.home.score);
        finalText = finalSentence(w.team.commonName, hi, lo, finalLabel(live).split('/')[1] ?? null);
    }

    return (
        <article
            ref={ref}
            id={anchor}
            aria-labelledby={titleId}
            data-phase={phase}
            className={cn(
                'relative scroll-mt-[calc(var(--appbar-h)+12px)] overflow-hidden rounded-card border bg-surface-1 shadow-card transition-[box-shadow,border-color] duration-300 [container-type:inline-size]',
                highlighted ? 'border-brand shadow-glow' : 'border-line',
            )}
            style={{
                backgroundImage: `linear-gradient(100deg, ${colors.away}0f 0%, transparent 42%, transparent 58%, ${colors.home}0f 100%)`,
                ...(favColor && !highlighted ? { borderColor: `${favColor}99` } : {}),
            }}
        >
            <div className="relative flex flex-col gap-2.5 px-4 pb-3.5 pt-3 cq-md:gap-3 cq-md:px-5 cq-md:pb-4">
                {/* Meta row */}
                <div className="flex min-h-7 items-center justify-between gap-2">
                    <StatusLine p={p} phase={phase} live={live} />
                    <div className="flex items-center gap-1">
                        {seriesScore ? (
                            <span className="text-caption font-semibold text-playoff">
                                Series {a} {seriesScore.away}–{seriesScore.home} {h}
                            </span>
                        ) : null}
                        <ShareButton p={p} title={title} anchor={anchor} />
                        <svg aria-hidden="true" viewBox="0 0 16 16" className={cn('h-4 w-4 text-fg-3 transition-transform', open && 'rotate-180')}>
                            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </div>
                </div>

                {/* Teams: the h2 holds the expand toggle; its hit area stretches over the card summary. */}
                <h2 className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                    <TeamSide side="away" s={p.away} color={colors.away} score={scored ? live.away.score : null} faded={phase === 'final' && scored && live.away.score < live.home.score} favorite={favorites.includes(a)} onFavorite={() => onFavorite(a)} />
                    <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={detailsId}
                        onClick={() => setOpen(o => !o)}
                        className="min-h-6 min-w-6 rounded-control px-1 text-center after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-card focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-brand"
                    >
                        <span id={titleId} className="sr-only">
                            {title}
                        </span>
                        {scored ? (
                            <span aria-hidden="true" className="flex items-baseline gap-1.5 text-h2 font-black tabular-nums text-fg-1 cq-md:text-display">
                                <span className={cn(phase === 'final' && live.away.score < live.home.score && 'text-fg-3')}>{live.away.score}</span>
                                <span className="text-body text-fg-3">–</span>
                                <span className={cn(phase === 'final' && live.home.score < live.away.score && 'text-fg-3')}>{live.home.score}</span>
                            </span>
                        ) : (
                            <span aria-hidden="true" className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface-2/70 text-caption font-bold text-fg-2 cq-md:h-8 cq-md:w-8">
                                @
                            </span>
                        )}
                        <span className="sr-only">{open ? ', hide details' : ', show details'}</span>
                    </button>
                    <TeamSide side="home" s={p.home} color={colors.home} score={scored ? live.home.score : null} faded={phase === 'final' && scored && live.home.score < live.away.score} favorite={favorites.includes(h)} onFavorite={() => onFavorite(h)} />
                </h2>

                {finalText ? <p className="-mt-1 text-center text-body-sm font-semibold text-fg-1">{finalText}</p> : null}

                {/* Win probability */}
                {model && !started ? <WinBar away={a} home={h} pAway={model.away / 100} awayColor={colors.away} homeColor={colors.home} size="md" label="Our forecast win probability" className="pointer-events-none" /> : null}
                {model && started ? (
                    // Once the puck drops the pregame split becomes a thin, muted ribbon; the numbers are in the line below.
                    <div aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full opacity-60">
                        <span style={{ width: `${model.away}%`, backgroundColor: colors.away }} />
                        <span className="w-0.5 bg-bg" />
                        <span className="flex-1" style={{ backgroundColor: colors.home }} />
                    </div>
                ) : null}

                {started ? (
                    <PregameLine p={p} />
                ) : (
                    <>
                        <ProjectionRow p={p} />
                        {!hasPrediction(p) ? <p className="text-caption text-fg-2">No prediction for this game yet.</p> : null}
                    </>
                )}

                <ContextChips p={p} />
            </div>

            <div id={detailsId} hidden={!open}>
                {open ? <Details p={p} phase={phase} implication={implication} playoffOdds={playoffOdds} onCollapse={collapse} /> : null}
            </div>
        </article>
    );
}

export default MatchupCard;
