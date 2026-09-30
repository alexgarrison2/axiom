import * as React from 'react';
import { cn } from '@/lib/utils';
import { shortDate } from '@/utils/team-stats/format';

interface SeasonBannerProps {
    seasonLabel: string;
    /** Most games any team has played this season. */
    maxGp: number;
    isCurrent: boolean;
    /** First scheduled game date, only when it is still in the future. */
    startsOn?: string | null;
    /** Label + action for "see last season". */
    previousLabel?: string;
    onViewPrevious?: () => void;
    className?: string;
}

/**
 * Early-season honesty: before any game, say so and point to last season;
 * under five games, warn that every number is a small sample.
 */
export function SeasonBanner({ seasonLabel, maxGp, isCurrent, startsOn, previousLabel, onViewPrevious, className }: SeasonBannerProps) {
    if (!isCurrent || maxGp >= 5) return null;
    const empty = maxGp === 0;
    return (
        <div
            role="status"
            className={cn(
                'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-control border px-4 py-3',
                empty ? 'border-brand/30 bg-brand/[0.06]' : 'border-dashed border-warn/50 bg-warn/[0.06]',
                className,
            )}
        >
            <div className="min-w-[16rem] flex-1">
                {empty ? (
                    <>
                        <p className="text-body-sm font-semibold text-fg-1">
                            {startsOn ? `Season starts ${shortDate(startsOn)}` : `${seasonLabel} is just getting started`}
                        </p>
                        <p className="text-caption text-fg-2">
                            No {seasonLabel} results in our data yet, so every team reads 0-0-0. Results post the morning after each game.
                        </p>
                    </>
                ) : (
                    <>
                        <p className="text-body-sm font-semibold text-fg-1">
                            Through {maxGp} {maxGp === 1 ? 'game' : 'games'}: small samples
                        </p>
                        <p className="text-caption text-fg-2">Early-season rates swing a lot from night to night. Treat them as hints, not trends.</p>
                    </>
                )}
            </div>
            {onViewPrevious && previousLabel ? (
                <button
                    type="button"
                    onClick={onViewPrevious}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-line-strong bg-surface-2 px-3 text-body-sm font-semibold text-fg-1 transition-colors hover:bg-surface-3 coarse:min-h-11"
                >
                    View {previousLabel}
                    <span aria-hidden="true">→</span>
                </button>
            ) : null}
        </div>
    );
}

export default SeasonBanner;
