'use client';

import { useId } from 'react';
import { StatChip } from '@/components/ui/stat-chip';
import type { GlossaryTerm } from '@/lib/glossary';
import { getGamePills, getTeamPills, pillText, type Pill } from '@/lib/matchup/pills';
import type { Prediction } from '@/types/prediction';
import { cn } from '@/lib/utils';

/** Which glossary entry explains a chip (by pill key). */
function termFor(pill: Pill): GlossaryTerm {
    const k = pill.key.toLowerCase();
    if (k === 'form') return 'last-n';
    if (k === 'b2b' || k === '3in4' || k === 'trip') return 'rest';
    if (k === 'opener' || pill.state === 'prior') return 'season-prior';
    if (k.startsWith('pp') || k.startsWith('pk')) return 'pp-pk';
    if (pill.state === 'small' || k === 'h2h' || k === 'loc') return 'small-sample';
    return 'small-sample';
}

const games = (n: number) => `${n} game${n === 1 ? '' : 's'}`;

/**
 * A context chip that explains itself on tap: a native popover (no JS
 * bundle, top layer, light dismiss). The button sits above the card's
 * stretched toggle, so tapping a chip never expands the card.
 */
function Chip({ pill }: { pill: Pill }) {
    const id = useId();
    const term = termFor(pill);
    const sample = pill.n != null ? `After ${games(pill.n)} this season, so treat it as a small sample.` : null;
    return (
        <>
            <button
                type="button"
                popoverTarget={id}
                aria-label={`${pillText(pill)}: explain`}
                className="pointer-events-auto rounded-chip text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
                onClick={e => e.stopPropagation()}
            >
                <StatChip
                    label={pill.label}
                    value={pill.value ?? ''}
                    state={pill.state}
                    seasonTag={pill.seasonTag}
                    tone={pill.tone === 'info' ? 'info' : pill.tone}
                    className={cn(
                        'cursor-help',
                        !pill.value && 'gap-0',
                        pill.tone === 'info' && pill.state === 'current' && 'border-info/30 text-info',
                    )}
                />
            </button>
            <div
                id={id}
                popover="auto"
                role="dialog"
                aria-label={pillText(pill)}
                className="pointer-events-auto fixed inset-x-3 bottom-4 top-auto m-0 mx-auto w-auto max-w-sm rounded-control border border-line-strong bg-surface-2 p-3 text-left text-fg-1 shadow-card backdrop:bg-black/30"
            >
                <p className="text-body-sm font-semibold text-fg-1">{pillText(pill)}</p>
                <p className="mt-1 text-body-sm text-fg-2">{pill.title}</p>
                {sample ? <p className="mt-1 text-caption text-fg-3">{sample}</p> : null}
                <div className="mt-2 flex items-center justify-between gap-3">
                    <a href={`/methodology#term-${term}`} className="inline-flex min-h-6 items-center text-caption font-semibold text-brand hover:underline">
                        Glossary →
                    </a>
                    <button type="button" popoverTarget={id} popoverTargetAction="hide" className="inline-flex min-h-6 min-w-6 items-center rounded-chip px-2 text-caption text-fg-2 hover:text-fg-1">
                        Close
                    </button>
                </div>
            </div>
        </>
    );
}

/**
 * Season-aware context chips: one column per team (away left, home right)
 * and the season series underneath. Every chip comes from lib/matchup/pills.
 */
export function ContextChips({ p }: { p: Prediction }) {
    const away = getTeamPills(p, 'away');
    const home = getTeamPills(p, 'home');
    const game = getGamePills(p);
    if (!away.length && !home.length && !game.length) return null;
    return (
        <div className="pointer-events-none relative z-10 flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-2">
                <ul aria-label={`${p.away.team.commonName} context`} className="flex flex-wrap content-start gap-1">
                    {away.map(pill => (
                        <li key={pill.key}>
                            <Chip pill={pill} />
                        </li>
                    ))}
                </ul>
                <ul aria-label={`${p.home.team.commonName} context`} className="flex flex-wrap content-start justify-end gap-1">
                    {home.map(pill => (
                        <li key={pill.key}>
                            <Chip pill={pill} />
                        </li>
                    ))}
                </ul>
            </div>
            {game.length ? (
                <ul aria-label="Season series" className="flex flex-wrap justify-center gap-1">
                    {game.map(pill => (
                        <li key={pill.key}>
                            <Chip pill={pill} />
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}

export { pillText };
export default ContextChips;
