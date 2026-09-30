'use client';

import type { Prediction } from '@/types/prediction';
import type { GameSwing } from '@/utils/implications';
import { cardAnchor, hasScore, phaseOf, type LiveMap } from '@/lib/matchup/lifecycle';
import { modelPair } from '@/lib/matchup/edge';
import { dayLabel } from '@/lib/matchup/format';
import { teamColor } from '@/components/ui/team-color';
import { GameTime } from './GameTime';

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

/** "Your team": each followed team's next game, win % and playoff odds, as one-line chips. */
export function YourTeamStrip({
    favorites,
    predictions,
    live,
    today,
    playoffOdds,
    onJump,
}: {
    favorites: string[];
    predictions: Prediction[];
    live: LiveMap;
    today: string;
    playoffOdds: Record<string, number>;
    onJump: Jump;
}) {
    const items = favorites
        .map(tri => {
            const games = predictions
                .filter(p => p.home.team.triCode === tri || p.away.team.triCode === tri)
                .filter(p => !(phaseOf(p, live[p.id]) === 'final' && p.date < today))
                .sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc));
            const g = games.find(p => phaseOf(p, live[p.id]) !== 'final') ?? games[0];
            return g ? { tri, g } : null;
        })
        .filter((x): x is { tri: string; g: Prediction } => x !== null);
    if (!items.length) return null;

    return (
        <section aria-labelledby="your-team" className="flex min-w-0 max-w-full items-center gap-3">
            <h2 id="your-team" className="label shrink-0">
                Your team{items.length > 1 ? 's' : ''}
            </h2>
            <ul className="relative flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto scrollbar-hide">
                {items.map(({ tri, g }) => {
                    const side = g.home.team.triCode === tri ? 'home' : 'away';
                    const opp = g[side === 'home' ? 'away' : 'home'];
                    const m = modelPair(g);
                    const lv = live[g.id];
                    const ph = phaseOf(g, lv);
                    const odds = playoffOdds[tri];
                    return (
                        <li key={tri} className="snap-start">
                            <button
                                type="button"
                                onClick={() => onJump(g.date, cardAnchor(g))}
                                className="flex min-h-9 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-caption transition-colors hover:bg-surface-2 coarse:min-h-11"
                                style={{ borderColor: `${teamColor(tri)}80` }}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={`/logos/${tri}.svg`} alt="" width={20} height={20} className="h-5 w-5" />
                                <span className="font-bold text-fg-1">
                                    {tri} {side === 'home' ? 'vs' : <At />} {opp.team.triCode}
                                </span>
                                <span className="uppercase tracking-wide text-fg-3">
                                    {ph === 'live' ? (
                                        <span className="font-bold text-pos">Live {hasScore(lv) ? `${lv.away.score}-${lv.home.score}` : ''}</span>
                                    ) : ph === 'final' ? (
                                        <span>Final {hasScore(lv) ? `${lv.away.score}-${lv.home.score}` : ''}</span>
                                    ) : (
                                        <>
                                            {g.date === today ? '' : `${dayLabel(g.date, today)} · `}
                                            <GameTime iso={g.startTimeUtc} />
                                        </>
                                    )}
                                </span>
                                {m && ph === 'pre' ? <span className="font-bold tabular-nums text-fg-1">{side === 'home' ? m.home : m.away}%</span> : null}
                                {odds != null ? (
                                    <span className="tabular-nums text-fg-3" title="Playoff odds">
                                        Playoffs <span className="text-fg-1">{odds.toFixed(0)}%</span>
                                    </span>
                                ) : null}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
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
