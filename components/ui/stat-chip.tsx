import * as React from 'react';
import { cn } from '../../lib/utils';
import { SEASON_START_YEAR } from '../../lib/season';

/** Last season as a short tag, e.g. "25-26" during 2026-27. */
export const PRIOR_SEASON_TAG = `${String(SEASON_START_YEAR - 1).slice(2)}-${String(SEASON_START_YEAR).slice(2)}`;

export type SampleState = 'current' | 'small' | 'prior';

export interface StatChipProps {
    label: React.ReactNode;
    value: React.ReactNode;
    /**
     * current — this season, enough games (normal chip)
     * small   — this season, few games: dashed outline + "n=2" tag
     * prior   — last season's value: ghost style + visible season tag ("25-26")
     */
    state?: SampleState;
    /** Season tag for prior values, e.g. "25-26". Required text for state="prior". */
    seasonTag?: string; // defaults to last season (PRIOR_SEASON_TAG)
    /** Sample size (games) — shown as an "n=2" tag for state="small". */
    n?: number;
    /** League rank bar, e.g. { rank: 4, of: 32 } (1 = best). */
    rankBar?: { rank: number; of: number };
    /** Signal tone for the value (current state only). */
    tone?: 'neutral' | 'pos' | 'neg' | 'warn' | 'info' | 'brand';
    /** Accessible description override. */
    title?: string;
    className?: string;
}

const toneClass: Record<NonNullable<StatChipProps['tone']>, string> = {
    neutral: 'text-fg-1',
    pos: 'text-pos',
    neg: 'text-neg',
    warn: 'text-warn',
    info: 'text-info',
    brand: 'text-brand',
};

/** "2025-26" / "20252026" / "25-26" → "25-26". */
export function shortSeasonTag(tag?: string): string | undefined {
    if (!tag) return undefined;
    const t = tag.trim();
    const eight = t.match(/^(\d{4})(\d{4})$/);
    if (eight) return `${eight[1].slice(2)}-${eight[2].slice(2)}`;
    const long = t.match(/^(\d{4})-(\d{2,4})$/);
    if (long) return `${long[1].slice(2)}-${long[2].slice(-2)}`;
    return t;
}

/**
 * A compact label + value chip with an explicit sample state, so last
 * season's numbers never look as authoritative as tonight's.
 */
export function StatChip({
    label,
    value,
    state = 'current',
    seasonTag,
    n,
    rankBar,
    tone = 'neutral',
    title,
    className,
}: StatChipProps) {
    const tag = shortSeasonTag(seasonTag) ?? (state === 'prior' ? PRIOR_SEASON_TAG : undefined);
    const srSuffix =
        state === 'prior' ? ` (${tag} season)` : state === 'small' && n != null ? ` (only ${n} ${n === 1 ? 'game' : 'games'})` : '';
    const pct = rankBar && rankBar.of > 1 ? 1 - (rankBar.rank - 1) / (rankBar.of - 1) : undefined;

    return (
        <span
            data-state={state}
            title={title}
            className={cn(
                'relative inline-flex min-h-6 items-center gap-1.5 whitespace-nowrap rounded-chip border px-2 py-0.5 text-caption',
                state === 'current' && 'border-line bg-surface-2',
                state === 'small' && 'border-dashed border-warn/50 bg-surface-2',
                state === 'prior' && 'is-stale',
                className,
            )}
        >
            {state === 'prior' ? (
                <span className="rounded-[3px] bg-fg-3/15 px-1 font-mono text-micro font-semibold text-fg-2">{tag}</span>
            ) : null}
            <span className={cn('font-medium', state === 'prior' ? 'text-fg-3' : 'text-fg-2')}>{label}</span>
            <span
                className={cn(
                    'font-semibold tabular-nums',
                    state === 'prior' ? 'text-fg-2' : state === 'small' ? 'text-fg-1' : toneClass[tone],
                )}
            >
                {value}
                {state === 'small' && n != null ? (
                    <span aria-hidden="true" className="ml-1 font-mono text-micro font-normal text-warn">
                        n={n}
                    </span>
                ) : null}
            </span>
            {srSuffix ? <span className="sr-only">{srSuffix}</span> : null}
            {pct != null && state !== 'prior' ? (
                <span aria-hidden="true" className="ml-0.5 inline-block h-1 w-6 overflow-hidden rounded-full bg-fg-3/25">
                    <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(8, pct * 100)}%` }} />
                </span>
            ) : null}
        </span>
    );
}

export default StatChip;
