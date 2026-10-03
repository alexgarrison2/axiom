'use client';

import type { Prediction } from '@/types/prediction';
import { WinBar } from '@/components/ui/win-bar';
import { Crest } from '@/components/ui/crest';
import { clashSafePair } from '@/components/ui/team-color';
import { forecastPair, hasMarket, hasPrediction } from '@/lib/matchup/edge';
import { hasScore, liveClock, phaseOf, type LiveGame } from '@/lib/matchup/lifecycle';
import { fmtOdds, lastName } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';
import { Flag, coinFlipFinal } from './MatchupCard';
import { GOALIE_TONE, goalieStatus } from './TeamSide';
import { GoalieGlyph } from './GoalieGlyph';
import { useHydrated } from './GameTime';

/** Puck drop as "6:00p" in the viewer's zone (Eastern until hydrated). */
export function railTimeLabel(iso: string, hydrated: boolean): string | null {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: hydrated ? undefined : 'America/New_York' });
    return t.replace(/\s?([AP])M$/i, (_, x: string) => x.toLowerCase());
}

/** A team's projected starter, in the status colour the card uses (confirmed glows green, likely fades, projected is grey). */
function Starter({ p, side }: { p: Prediction; side: 'away' | 'home' }) {
    const s = p[side];
    if (!s.goalie) return <span className="text-micro uppercase tracking-wide text-fg-disabled">TBD</span>;
    const st = goalieStatus(s.goalieStatus);
    return (
        <span className={cn('min-w-0 truncate font-display text-micro font-bold uppercase tracking-[0.02em]', GOALIE_TONE[st.tone])} title={`${s.goalie} · ${st.label}`}>
            <GoalieGlyph tone={st.tone} />
            {lastName(s.goalie)}
            <span className="sr-only">
                , {s.team.commonName} goalie, {st.label.toLowerCase()} starter
            </span>
        </span>
    );
}

/** One end of a rail row: the book price and our projected goals, on that team's side. */
function End({ p, side, showOurs }: { p: Prediction; side: 'away' | 'home'; showOurs: boolean }) {
    const s = p[side];
    const home = side === 'home';
    const price = hasMarket(p) ? fmtOdds(s.marketOdds) : null;
    return (
        <span className={cn('flex min-w-0 items-baseline gap-1.5 whitespace-nowrap text-micro tabular-nums text-fg-3', home && 'flex-row-reverse')}>
            {price ? <span className="text-body font-bold text-fg-2">{price}</span> : null}
            {showOurs && s.xg != null ? (
                <span>
                    xG <b className="font-bold text-fg-1">{s.xg.toFixed(1)}</b>
                </span>
            ) : null}
        </span>
    );
}

/**
 * A game in the desktop rail: status and flag on top, the two crests flanking
 * the forecast bar, and book price + projected goals under each end. The
 * selected row is lit by the rail's sliding indicator; the row itself only
 * brightens.
 */
export function GameRailItem({ p, live, selected, onSelect }: { p: Prediction; live: LiveGame | null; selected: boolean; onSelect: () => void }) {
    const phase = phaseOf(p, live);
    const started = phase !== 'pre';
    const scored = started && hasScore(live);
    const a = p.away.team.triCode;
    const h = p.home.team.triCode;
    const colors = clashSafePair(a, h);
    const forecast = forecastPair(p);
    const sum = (p.away.marketWinPct ?? 0) + (p.home.marketWinPct ?? 0);
    const market = hasMarket(p) && sum > 0 ? (p.away.marketWinPct as number) / sum : null;
    const model = forecast && p.away.modelWinPct != null ? p.away.modelWinPct / 100 : null;
    const awayLost = phase === 'final' && scored && live.away.score < live.home.score;
    const homeLost = phase === 'final' && scored && live.home.score < live.away.score;
    const showOurs = phase !== 'final' && hasPrediction(p);
    // Eastern until hydrated, like every other clock: the server's own zone would not match the viewer's.
    const hydrated = useHydrated();
    return (
        <button
            type="button"
            data-rail-item
            aria-current={selected ? 'true' : undefined}
            onClick={onSelect}
            className={cn(
                'relative flex w-full min-w-0 flex-col gap-1.5 rounded-card px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
                selected ? 'text-fg-1' : 'hover:bg-surface-2/60',
            )}
        >
            {phase !== 'final' ? (
                <span className="flex items-center justify-between gap-2">
                    <Starter p={p} side="away" />
                    <Starter p={p} side="home" />
                </span>
            ) : null}
            <span className="grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] items-center gap-2">
                <Crest tri={a} size={56} className={cn('h-14 w-14', awayLost && 'opacity-50 grayscale-[40%]')} />
                <span className="flex min-w-0 flex-col gap-1">
                    {scored ? (
                        <span className="flex items-center justify-between font-display text-title font-bold text-fg-1">
                            <span className={awayLost ? 'text-fg-3' : undefined}>{live.away.score}</span>
                            <span aria-hidden="true" className="text-micro font-medium text-fg-disabled">
                                -
                            </span>
                            <span className={homeLost ? 'text-fg-3' : undefined}>{live.home.score}</span>
                        </span>
                    ) : null}
                    {forecast ? (
                        <span className="relative block">
                            <WinBar
                                away={a}
                                home={h}
                                pAway={forecast.away / 100}
                                market={market}
                                model={model}
                                awayColor={colors.away}
                                homeColor={colors.home}
                                size="sm"
                                animate={false}
                                dimmed={started}
                                digits={coinFlipFinal(p, phase) ? 1 : 0}
                                label={started ? 'Pregame win probability' : 'Our forecast win probability'}
                                className="pointer-events-none"
                            />
                        </span>
                    ) : (
                        <span className="flex h-7 items-center justify-center rounded-bar border border-dashed border-line bg-track text-micro uppercase tracking-wide text-fg-3">
                            {started ? 'No pick' : 'No forecast'}
                        </span>
                    )}
                </span>
                <Crest tri={h} size={56} className={cn('h-14 w-14', homeLost && 'opacity-50 grayscale-[40%]')} />
            </span>
            <span className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-2">
                <End p={p} side="away" showOurs={showOurs} />
                <span className="text-center">
                    {phase === 'live' ? (
                        <span className="text-micro font-bold uppercase tracking-wide text-pos">{liveClock(live)}</span>
                    ) : (
                        <Flag p={p} phase={phase} live={live} compact />
                    )}
                </span>
                <span className="flex justify-end">
                    <End p={p} side="home" showOurs={showOurs} />
                </span>
            </span>
            {phase === 'pre' ? (
                <span className="sr-only">
                    Puck drop <time dateTime={p.startTimeUtc}>{railTimeLabel(p.startTimeUtc, hydrated)}</time>
                </span>
            ) : null}
            <span className="sr-only">
                {p.away.team.commonName} at {p.home.team.commonName}
            </span>
        </button>
    );
}

export default GameRailItem;
