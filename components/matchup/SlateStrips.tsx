'use client';

import type { Prediction } from '@/types/prediction';
import type { GameSwing } from '@/utils/implications';
import { cardAnchor } from '@/lib/matchup/lifecycle';

/** A visual "@" that screen readers hear as "at". */
function At() {
    return (
        <>
            <span aria-hidden="true" className="before:content-['@']" />
            <span className="sr-only">at</span>
        </>
    );
}

export interface Jump {
    (date: string, anchor: string): void;
}

/** Playoff stakes: only when some team's playoff odds swing ≥3 pts on the result. */
export function BiggestGames({ swings, byId, onJump }: { swings: GameSwing[]; byId: Map<string, Prediction>; onJump: Jump }) {
    if (!swings.length) return null;
    return (
        <section aria-labelledby="biggest-games" className="flex min-w-0 max-w-full items-center gap-3">
            <h2 id="biggest-games" className="label shrink-0">
                Stakes
            </h2>
            <ol className="relative flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto scrollbar-hide">
                {swings.map(s => {
                    const p = byId.get(String(s.gameId));
                    const t = [s.home, s.away].filter(Boolean).sort((x, y) => (y?.swing ?? 0) - (x?.swing ?? 0))[0];
                    if (!p || !t) return null;
                    return (
                        <li key={s.gameId} className="snap-start">
                            <button
                                type="button"
                                onClick={() => onJump(p.date, cardAnchor(p))}
                                className="flex min-h-9 items-center gap-2 whitespace-nowrap rounded-full border border-line px-3 text-caption transition-colors hover:border-line-strong hover:bg-surface-2 coarse:min-h-11"
                            >
                                <span className="font-bold text-fg-1">
                                    {p.away.team.triCode} <At /> {p.home.team.triCode}
                                </span>
                                <span className="tabular-nums text-fg-3">
                                    {t.tri} {t.base.toFixed(0)}% <span className="text-pos">W {t.win.toFixed(0)}</span> <span className="text-neg">L {t.lose.toFixed(0)}</span>
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}
