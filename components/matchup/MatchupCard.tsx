'use client';

import { useCallback, useId, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Prediction } from '@/types/prediction';
import type { GameImplication } from '@/utils/implications';
import { WinBar } from '@/components/ui/win-bar';
import { clashSafePair } from '@/components/ui/team-color';
import { cardAnchor, finalLabel, hasScore, modelCorrect, phaseOf, type LiveGame, type Phase } from '@/lib/matchup/lifecycle';
import { forecastPair, hasMarket, hasPrediction, modelLean, recommendedBet } from '@/lib/matchup/edge';
import { finalSentence, fmtOdds, isCoinFlip } from '@/lib/matchup/format';
import { seriesChip, teamChip } from '@/lib/matchup/pills';
import { glossaryHref } from '@/lib/glossary';
import { cn } from '@/lib/utils';
import { StatusLine } from './StatusLine';
import { TeamSide, washVars } from './TeamSide';
import { ShareButton } from './ShareButton';
import { GoalsBar } from './GoalsBar';
import { fmtLine } from '@/lib/matchup/markets';
import { CHIP, OVER_TOGGLE } from './chip-styles';
import type { Tab } from './Details';

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
    highlighted?: boolean;
    seriesScore?: { away: number; home: number } | null;
    /** Rail + pane layout: always open, no toggle, no collapse button. */
    pinned?: boolean;
    /** The card is a second copy of a game (the pane): no element id, so anchors stay unique. */
    noAnchor?: boolean;
    detailTab?: Tab;
    onDetailTab?: (t: Tab) => void;
}

/** A final whose pregame forecast sat within 1 pt of 50: no lean, never graded. */
export function coinFlipFinal(p: Prediction, phase: Phase): boolean {
    return phase === 'final' && hasPrediction(p) && isCoinFlip(p.home.winPct);
}

/** Card: a glossary link drawn over the expand toggle. Rail (`compact`): an inert span inside the row button. */
function FlagLink({ compact, href, className, children, ...rest }: React.ComponentProps<'a'> & { compact: boolean }) {
    return compact ? (
        <span className={className} {...(rest as React.ComponentProps<'span'>)}>
            {children}
        </span>
    ) : (
        <a href={href} className={cn(OVER_TOGGLE, className)} {...rest}>
            {children}
        </a>
    );
}

/**
 * Centre of the footer: the result flag on finals, else the gated edge or the model lean.
 * `compact` (the game rail): smaller, and plain text rather than glossary links, because
 * the whole rail row is the button that opens the game.
 */
export function Flag({ p, phase, live, compact = false }: { p: Prediction; phase: Phase; live: LiveGame | null; compact?: boolean }) {
    const text = compact ? 'text-micro' : 'text-caption';
    if (phase === 'final') {
        if (coinFlipFinal(p, phase)) {
            return (
                <FlagLink
                    compact={compact}
                    href={glossaryHref('no-lean')}
                    className={cn(text, 'font-bold uppercase tracking-chip text-fg-3')}
                    title={`Pregame ${p.home.team.triCode} ${p.home.winPct?.toFixed(1)}%`}
                >
                    No lean
                </FlagLink>
            );
        }
        const ok = modelCorrect(p, live);
        if (ok == null) return null;
        return (
            <span className={cn(text, 'font-bold uppercase tracking-chip', ok ? 'text-pos' : 'text-neg')}>
                <span aria-hidden="true">{ok ? '✓' : '✕'} Pick</span>
                <span className="sr-only">{ok ? 'Model pick right' : 'Model pick wrong'}</span>
            </span>
        );
    }
    if (phase === 'live') {
        return hasMarket(p) ? (
            <span title="Pregame odds" className="inline-flex items-center rounded-[3px] border border-mute px-1 text-micro font-medium leading-[14px] text-fg-3">
                Pre<span className="sr-only">game odds</span>
            </span>
        ) : null;
    }
    if (phase !== 'pre') return null;
    const bet = recommendedBet(p);
    if (bet) {
        return (
            <FlagLink
                compact={compact}
                href="/methodology#edge"
                data-bet
                className={cn('px-0 font-bold uppercase', text, compact ? 'tracking-[0.04em]' : 'tracking-[0.1em]')}
                title={bet.official ? 'Expected value at the book price, quarter-Kelly stake' : `Unofficial: the betting gate is closed (${p.gateReason ?? 'model not yet proven against the market'})`}
            >
                {/* Tight pill: green EV half, black stake half in green type. */}
                <span
                    className={cn(
                        'inline-flex items-stretch overflow-hidden whitespace-nowrap border border-pos',
                        compact ? 'rounded-[3px] leading-[16px]' : 'rounded-[4px] shadow-[0_0_10px_rgb(var(--pos-rgb)/0.35)]',
                    )}
                >
                    <span className={cn('bg-pos text-black', compact ? 'px-1' : 'px-1.5 py-0.5')}>
                        +EV {bet.evPct.toFixed(1)}% {bet.tri}
                    </span>
                    {bet.units != null ? (
                        <span className={cn('bg-black text-pos', compact ? 'px-1' : 'px-1.5 py-0.5')}>
                            <span className="sr-only"> · </span>
                            {bet.units.toFixed(1)}u
                        </span>
                    ) : null}
                </span>
                {bet.official ? null : <span className="sr-only">, unofficial: the betting gate is closed</span>}
            </FlagLink>
        );
    }
    const lean = modelLean(p);
    if (lean) {
        return (
            <FlagLink
                compact={compact}
                href={glossaryHref('lean')}
                data-lean
                className={cn('glow-magenta font-bold uppercase', text, compact ? 'tracking-[0.06em]' : 'tracking-[0.12em]')}
                title={`Model ${lean.pct}% ${lean.tri}, ${lean.gap.toFixed(1)} pts off the market`}
            >
                <span aria-hidden="true">
                    ◆ {lean.pct} {lean.tri}
                </span>
                <span className="sr-only">
                    Model lean: {lean.tri} {lean.pct}%, {lean.gap.toFixed(1)} points off the market
                </span>
            </FlagLink>
        );
    }
    if (!hasMarket(p) && forecastPair(p)) return <span className="label text-fg-3">No line</span>;
    return null;
}

/** One end of the footer: tricode + book moneyline, then our odds (xOdds) and projected goals (xG). */
function FooterSide({ p, side, phase }: { p: Prediction; side: 'away' | 'home'; phase: Phase }) {
    const s = p[side];
    const tri = s.team.triCode;
    const home = side === 'home';
    const priced = hasMarket(p);
    const ours = phase !== 'final' && hasPrediction(p);
    const xOdds = ours ? s.fairOdds : null;
    const xg = ours ? s.xg : null;
    return (
        <span className={cn('flex min-w-0 flex-col gap-0.5', home ? 'items-end' : 'items-start')}>
            <span className={cn('flex min-w-0 items-baseline gap-1.5 text-body font-bold tabular-nums text-fg-2 cq-md:text-[15px]', home && 'flex-row-reverse')}>
                <span data-tri aria-hidden={(home && priced) || undefined} className="text-micro font-medium tracking-wide text-fg-3">
                    {tri}
                </span>
                {priced ? (
                    <span>
                        <span className="sr-only">{home ? `${tri} moneyline ` : ' moneyline '}</span>
                        {fmtOdds(s.marketOdds)}
                    </span>
                ) : null}
            </span>
            {xOdds || xg != null ? (
                <span className="flex items-baseline gap-1.5 whitespace-nowrap text-micro tabular-nums text-fg-3">
                    {xOdds ? (
                        <span>
                            xOdds <b className="font-bold text-fg-1">{fmtOdds(xOdds)}</b>
                        </span>
                    ) : null}
                    {xOdds && xg != null ? <span aria-hidden="true">·</span> : null}
                    {xg != null ? (
                        <span>
                            xG <b className="font-bold text-fg-1">{xg.toFixed(1)}</b>
                        </span>
                    ) : null}
                </span>
            ) : null}
        </span>
    );
}

export function MatchupCard({ p, live, implication, playoffOdds, highlighted, seriesScore, pinned = false, noAnchor = false, detailTab, onDetailTab }: MatchupCardProps) {
    const [openState, setOpen] = useState(false);
    const open = pinned || openState;
    const ref = useRef<HTMLElement>(null);
    const toggleRef = useRef<HTMLButtonElement>(null);
    const uid = useId();
    const titleId = `${uid}-title`;
    const resultId = `${uid}-result`;
    const detailsId = `${uid}-details`;
    const phase = phaseOf(p, live);
    const started = phase !== 'pre';
    const scored = started && hasScore(live);
    const a = p.away.team.triCode;
    const h = p.home.team.triCode;
    const colors = clashSafePair(a, h);
    const anchor = cardAnchor(p);
    const title = `${p.away.team.commonName} at ${p.home.team.commonName}`;
    const forecast = forecastPair(p);
    const chip = seriesChip(p, seriesScore);
    const awayChip = phase === 'pre' ? teamChip(p, 'away') : null;
    const homeChip = phase === 'pre' ? teamChip(p, 'home') : null;
    const awayLost = phase === 'final' && scored && live.away.score < live.home.score;
    const homeLost = phase === 'final' && scored && live.home.score < live.away.score;

    // The Collapse button unmounts with the panel: hand focus back to the card toggle.
    const collapse = useCallback(() => {
        setOpen(false);
        toggleRef.current?.focus({ preventScroll: true });
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        requestAnimationFrame(() =>
            ref.current?.scrollIntoView({
                block: 'nearest',
                inline: 'nearest',
                behavior: reduce ? 'auto' : 'smooth',
            }),
        );
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
            id={noAnchor ? undefined : anchor}
            aria-labelledby={finalText ? `${titleId} ${resultId}` : titleId}
            data-phase={phase}
            className={cn(
                'panel team-wash panel-hover scroll-mt-[calc(var(--appbar-h)+12px)] transition-[box-shadow,border-color] duration-300 [container-type:inline-size]',
                highlighted && 'border-brand shadow-glow',
            )}
            style={washVars(colors.away, colors.home)}
        >
            <div className="relative flex flex-col gap-2.5 px-3 pb-3 pt-2.5 cq-md:gap-3 cq-md:px-4 cq-md:pb-3.5 cq-md:pt-3">
                <div className="flex min-h-6 items-center justify-between gap-2">
                    <StatusLine p={p} phase={phase} live={live} />
                    <div className="flex shrink-0 items-center gap-1">
                        {chip ? (
                            <span title={chip.title} className={CHIP}>
                                <span aria-hidden="true">{chip.label}</span>
                                <span className="sr-only">{chip.title}</span>
                            </span>
                        ) : null}
                        <ShareButton p={p} title={title} anchor={anchor} />
                        {pinned ? null : (
                            <svg aria-hidden="true" viewBox="0 0 16 16" className={cn('h-3.5 w-3.5 text-fg-3 transition-transform', open && 'rotate-180')}>
                                <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        )}
                    </div>
                </div>

                {/* Teams. The h2 is the matchup name only: it holds the expand toggle, whose hit area stretches over the card summary. */}
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 font-mono cq-sm:gap-2">
                    <TeamSide side="away" s={p.away} opp={h} faded={awayLost} showStats={!scored} chip={awayChip} />
                    {finalText ? (
                        <span id={resultId} className="sr-only">
                            {finalText}
                        </span>
                    ) : null}
                    <h2 className="flex justify-center">
                        {pinned ? (
                            <span className="min-h-6 min-w-4 px-0.5 text-center">
                                <span id={titleId} className="sr-only">
                                    {title}
                                </span>
                                {scored ? (
                                    <span aria-hidden="true" className="num-score flex items-center gap-1.5 text-[30px] leading-none cq-md:gap-2.5 cq-md:text-[40px]">
                                        <span className={awayLost ? 'text-fg-3' : 'text-fg-1'}>{live.away.score}</span>
                                        <span className="text-[0.7em] text-fg-disabled">-</span>
                                        <span className={homeLost ? 'text-fg-3' : 'text-fg-1'}>{live.home.score}</span>
                                    </span>
                                ) : (
                                    <span aria-hidden="true" className="text-body font-medium text-fg-disabled before:content-['@']" />
                                )}
                            </span>
                        ) : (
                            <button
                                ref={toggleRef}
                                type="button"
                                aria-expanded={open}
                                aria-controls={detailsId}
                                onClick={() => setOpen(o => !o)}
                                className="min-h-6 min-w-4 rounded-control px-0.5 text-center after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-card focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-brand"
                            >
                                <span id={titleId} className="sr-only">
                                    {title}
                                </span>
                                {scored ? (
                                    <span aria-hidden="true" className="num-score flex items-center gap-1.5 text-[30px] leading-none cq-md:gap-2.5 cq-md:text-[40px]">
                                        <span className={awayLost ? 'text-fg-3' : 'text-fg-1'}>{live.away.score}</span>
                                        <span className="text-[0.7em] text-fg-disabled">-</span>
                                        <span className={homeLost ? 'text-fg-3' : 'text-fg-1'}>{live.home.score}</span>
                                    </span>
                                ) : (
                                    // Drawn by CSS so the heading's text (and any name built from it) never holds "@".
                                    <span aria-hidden="true" className="text-body font-medium text-fg-disabled before:content-['@']" />
                                )}
                                <span className="sr-only">{open ? ', hide details' : ', show details'}</span>
                            </button>
                        )}
                    </h2>
                    <TeamSide side="home" s={p.home} opp={a} faded={homeLost} showStats={!scored} chip={homeChip} />
                </div>

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
                        digits={coinFlipFinal(p, phase) ? 1 : 0}
                        label={started ? 'Pregame win probability' : 'Our forecast win probability'}
                        className="pointer-events-none"
                    />
                ) : (
                    <div className="flex h-[50px] items-center justify-center rounded-bar border border-dashed border-line bg-track">
                        <span className="label">{started ? 'No pick' : 'No forecast'}</span>
                    </div>
                )}

                {/* Footer: tricode + book odds under each end of the bar, our odds and projected goals under them, the flag in the middle. */}
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                    <FooterSide p={p} side="away" phase={phase} />
                    <span className="text-center">
                        <Flag p={p} phase={phase} live={live} />
                    </span>
                    <FooterSide p={p} side="home" phase={phase} />
                </div>
                {open && phase !== 'final' && hasPrediction(p) && p.away.xg != null && p.home.xg != null ? (
                    <GoalsBar away={a} home={h} ax={p.away.xg} hx={p.home.xg} line={fmtLine(p.markets?.total?.line ?? p.totalLine)} colors={colors} />
                ) : null}
            </div>

            <div id={detailsId} hidden={!open}>
                {open ? <Details p={p} phase={phase} implication={implication} playoffOdds={playoffOdds} onCollapse={pinned ? undefined : collapse} tab={detailTab} onTab={onDetailTab} /> : null}
            </div>
        </article>
    );
}

export default MatchupCard;
