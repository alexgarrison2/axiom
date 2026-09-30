'use client';

import { useCallback, useId, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Prediction } from '@/types/prediction';
import type { GameImplication } from '@/utils/implications';
import { WinBar } from '@/components/ui/win-bar';
import { clashSafePair } from '@/components/ui/team-color';
import { cardAnchor, finalLabel, hasScore, modelCorrect, phaseOf, type LiveGame, type Phase } from '@/lib/matchup/lifecycle';
import { forecastPair, gatedEdge, hasMarket, modelLean } from '@/lib/matchup/edge';
import { finalSentence, fmtOdds } from '@/lib/matchup/format';
import { situationChip } from '@/lib/matchup/pills';
import { cn } from '@/lib/utils';
import { StatusLine } from './StatusLine';
import { TeamSide, washVars } from './TeamSide';
import { ShareButton } from './ShareButton';

const Details = dynamic(() => import('./Details'), {
    loading: () => (
        <div className="flex flex-col gap-3 border-t border-dashed border-line px-3 pb-3 pt-3 cq-md:px-4" aria-busy="true">
            <div className="h-8 w-64 max-w-full animate-pulse rounded-[10px] bg-surface-2" />
            <div className="h-40 animate-pulse rounded-[10px] bg-surface-2" />
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

/** Centre of the footer: the result flag on finals, else the gated edge or the model lean. */
function Flag({ p, phase, live }: { p: Prediction; phase: Phase; live: LiveGame | null }) {
    if (phase === 'final') {
        const ok = modelCorrect(p, live);
        if (ok == null) return null;
        return (
            <span className={cn('text-caption font-bold uppercase tracking-chip', ok ? 'text-pos' : 'text-neg')}>
                <span aria-hidden="true">{ok ? '✓' : '✕'} Pick</span>
                <span className="sr-only">{ok ? 'Model pick right' : 'Model pick wrong'}</span>
            </span>
        );
    }
    if (phase !== 'pre') return null;
    const edge = gatedEdge(p);
    if (edge) {
        return (
            <span className="text-caption font-bold uppercase tracking-[0.1em] text-pos">
                Edge +{edge.evPct.toFixed(1)}% {edge.tri}
                {edge.units != null ? <span className="text-fg-2"> · {edge.units.toFixed(1)}u</span> : null}
            </span>
        );
    }
    const lean = modelLean(p);
    if (lean) {
        return (
            <span className="glow-magenta text-caption font-bold uppercase tracking-[0.12em]" title={`Model ${lean.pct}% ${lean.tri}, ${lean.gap.toFixed(1)} pts off the market`}>
                <span aria-hidden="true">◆ {lean.pct} {lean.tri}</span>
                <span className="sr-only">Model lean: {lean.tri} {lean.pct}%</span>
            </span>
        );
    }
    if (!hasMarket(p) && forecastPair(p)) return <span className="label text-fg-3">No line</span>;
    return null;
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
    const forecast = forecastPair(p);
    const chip = phase === 'pre' || seriesScore ? situationChip(p, seriesScore) : null;
    const awayLost = phase === 'final' && scored && live.away.score < live.home.score;
    const homeLost = phase === 'final' && scored && live.home.score < live.away.score;

    const collapse = useCallback(() => {
        setOpen(false);
        requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }, []);

    let finalText: string | null = null;
    if (phase === 'final' && scored) {
        const w = live.away.score > live.home.score ? p.away : p.home;
        finalText = finalSentence(w.team.commonName, Math.max(live.away.score, live.home.score), Math.min(live.away.score, live.home.score), finalLabel(live).split('/')[1] ?? null);
    }

    const sum = (p.away.marketWinPct ?? 0) + (p.home.marketWinPct ?? 0);
    const market = hasMarket(p) && sum > 0 ? (p.away.marketWinPct as number) / sum : null;
    const model = forecast && p.away.modelWinPct != null ? p.away.modelWinPct / 100 : null;

    return (
        <article
            ref={ref}
            id={anchor}
            aria-labelledby={titleId}
            data-phase={phase}
            className={cn(
                'panel team-wash panel-hover scroll-mt-[calc(var(--appbar-h)+12px)] transition-[box-shadow,border-color] duration-300 [container-type:inline-size]',
                highlighted && 'border-brand shadow-glow',
            )}
            style={{ ...washVars(colors.away, colors.home), ...(favColor && !highlighted ? { borderColor: `${favColor}99` } : {}) }}
        >
            <div className="relative flex flex-col gap-2.5 px-3 pb-3 pt-2.5 cq-md:gap-3 cq-md:px-4 cq-md:pb-3.5 cq-md:pt-3">
                <div className="flex min-h-6 items-center justify-between gap-2">
                    <StatusLine p={p} phase={phase} live={live} />
                    <div className="flex shrink-0 items-center gap-1">
                        {chip ? (
                            <span title={chip.title} className="rounded-chip border border-warn/45 px-2 py-0.5 text-micro font-bold uppercase tracking-chip text-warn">
                                <span aria-hidden="true">{chip.label}</span>
                                <span className="sr-only">{chip.title}</span>
                            </span>
                        ) : null}
                        <ShareButton p={p} title={title} anchor={anchor} />
                        <svg aria-hidden="true" viewBox="0 0 16 16" className={cn('h-3.5 w-3.5 text-fg-3 transition-transform', open && 'rotate-180')}>
                            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </div>
                </div>

                {/* Teams: the h2 holds the expand toggle; its hit area stretches over the card summary. */}
                <h2 className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 font-mono cq-sm:gap-2">
                    <TeamSide side="away" s={p.away} opp={h} faded={awayLost} showStats={!scored} favorite={favorites.includes(a)} onFavorite={() => onFavorite(a)} />
                    <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={detailsId}
                        onClick={() => setOpen(o => !o)}
                        className="min-h-6 min-w-4 rounded-control px-0.5 text-center after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-card focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-brand"
                    >
                        <span id={titleId} className="sr-only">
                            {title}
                            {finalText ? `. ${finalText}` : ''}
                        </span>
                        {scored ? (
                            <span aria-hidden="true" className="num-score flex items-center gap-1.5 text-[30px] leading-none cq-md:gap-2.5 cq-md:text-[40px]">
                                <span className={awayLost ? 'text-fg-3' : 'text-fg-1'}>{live.away.score}</span>
                                <span className="text-[0.7em] text-fg-disabled">-</span>
                                <span className={homeLost ? 'text-fg-3' : 'text-fg-1'}>{live.home.score}</span>
                            </span>
                        ) : (
                            <span aria-hidden="true" className="text-body font-medium text-fg-disabled">
                                @
                            </span>
                        )}
                        <span className="sr-only">{open ? ', hide details' : ', show details'}</span>
                    </button>
                    <TeamSide side="home" s={p.home} opp={a} faded={homeLost} showStats={!scored} favorite={favorites.includes(h)} onFavorite={() => onFavorite(h)} />
                </h2>

                {forecast ? (
                    <WinBar
                        away={a}
                        home={h}
                        pAway={forecast.away / 100}
                        market={market}
                        model={model}
                        awayColor={colors.away}
                        homeColor={colors.home}
                        size="lg"
                        dimmed={started}
                        label={started ? 'Pregame win probability' : 'Our forecast win probability'}
                        className="pointer-events-none"
                    />
                ) : (
                    <div className="flex h-[50px] items-center justify-center rounded-bar border border-dashed border-line bg-track">
                        <span className="label">{started ? 'No pick' : 'No forecast'}</span>
                    </div>
                )}

                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                    <span className="text-body font-bold tabular-nums text-fg-2 cq-md:text-[15px]">
                        {hasMarket(p) ? (
                            <>
                                <span className="sr-only">{a} moneyline </span>
                                {fmtOdds(p.away.marketOdds)}
                            </>
                        ) : null}
                    </span>
                    <span className="text-center">
                        <Flag p={p} phase={phase} live={live} />
                    </span>
                    <span className="text-right text-body font-bold tabular-nums text-fg-2 cq-md:text-[15px]">
                        {hasMarket(p) ? (
                            <>
                                <span className="sr-only">{h} moneyline </span>
                                {fmtOdds(p.home.marketOdds)}
                            </>
                        ) : null}
                    </span>
                </div>
            </div>

            <div id={detailsId} hidden={!open}>
                {open ? <Details p={p} phase={phase} implication={implication} playoffOdds={playoffOdds} onCollapse={collapse} /> : null}
            </div>
        </article>
    );
}

export default MatchupCard;
