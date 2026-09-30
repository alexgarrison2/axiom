'use client';

import type { Prediction } from '@/types/prediction';
import type { GameSwing } from '@/utils/implications';
import { cardAnchor, hasScore, phaseOf, type LiveMap } from '@/lib/matchup/lifecycle';
import { modelPair } from '@/lib/matchup/edge';
import { dayLabel } from '@/lib/matchup/format';
import { teamColor } from '@/components/ui/team-color';
import { GameTime } from './GameTime';

export interface Jump {
    (date: string, anchor: string): void;
}

/** "Your team": each followed team's next game, win %, record and playoff odds. */
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
        <section aria-labelledby="your-team" className="flex flex-col gap-2">
            <h2 id="your-team" className="hud-label text-fg-2">
                Your team{items.length > 1 ? 's' : ''}
            </h2>
            <ul className="flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
                {items.map(({ tri, g }) => {
                    const side = g.home.team.triCode === tri ? 'home' : 'away';
                    const me = g[side];
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
                                className="flex min-h-11 min-w-[16rem] items-center gap-3 rounded-control border bg-surface-1 px-3 py-2 text-left transition-colors hover:bg-surface-2"
                                style={{ borderColor: `${teamColor(tri)}80` }}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={me.team.logoUrl} alt="" width={28} height={28} className="h-7 w-7" />
                                <span className="flex min-w-0 flex-col">
                                    <span className="text-body-sm font-bold text-fg-1">
                                        {me.team.commonName} {side === 'home' ? 'vs' : '@'} {opp.team.triCode}
                                        {me.record ? <span className="ml-1.5 font-normal tabular-nums text-fg-2">{me.record}</span> : null}
                                    </span>
                                    <span className="text-caption text-fg-2">
                                        {ph === 'live' ? (
                                            <span className="font-semibold text-neg">Live {hasScore(lv) ? `${lv.away.score}-${lv.home.score}` : ''}</span>
                                        ) : ph === 'final' ? (
                                            <span>Final {hasScore(lv) ? `${lv.away.score}-${lv.home.score}` : ''}</span>
                                        ) : (
                                            <>
                                                {dayLabel(g.date, today)} · <GameTime iso={g.startTimeUtc} />
                                            </>
                                        )}
                                        {m && ph === 'pre' ? <span className="font-semibold text-fg-1"> · {side === 'home' ? m.home : m.away}% to win</span> : null}
                                        {odds != null ? <span> · Playoffs {odds.toFixed(0)}%</span> : null}
                                    </span>
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

/** "Biggest games tonight": only when some team's playoff odds swing ≥3 pts on the result. */
export function BiggestGames({ swings, byId, onJump }: { swings: GameSwing[]; byId: Map<string, Prediction>; onJump: Jump }) {
    if (!swings.length) return null;
    return (
        <section aria-labelledby="biggest-games" className="flex flex-col gap-2">
            <h2 id="biggest-games" className="hud-label text-fg-2">
                Biggest games tonight · playoff odds at stake
            </h2>
            <ol className="flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
                {swings.map(s => {
                    const p = byId.get(String(s.gameId));
                    const t = [s.home, s.away].filter(Boolean).sort((x, y) => (y?.swing ?? 0) - (x?.swing ?? 0))[0];
                    if (!p || !t) return null;
                    return (
                        <li key={s.gameId} className="snap-start">
                            <button
                                type="button"
                                onClick={() => onJump(p.date, cardAnchor(p))}
                                className="flex min-h-11 flex-col rounded-control border border-line bg-surface-1 px-3 py-2 text-left transition-colors hover:border-line-strong hover:bg-surface-2"
                            >
                                <span className="text-body-sm font-bold text-fg-1">
                                    {p.away.team.triCode} @ {p.home.team.triCode}
                                </span>
                                <span className="text-caption tabular-nums text-fg-2">
                                    {t.tri} {t.base.toFixed(0)}% → <span className="text-pos">{t.win.toFixed(0)}% W</span> / <span className="text-neg">{t.lose.toFixed(0)}% L</span>
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}
