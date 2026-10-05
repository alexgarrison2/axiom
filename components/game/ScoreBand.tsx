'use client';

import Link from 'next/link';
import { Crest } from '@/components/ui/crest';
import { LocalTime } from '@/components/ui/local-time';
import { cn } from '@/lib/utils';
import { lineScore, shortName } from '@/lib/game/analytics';
import { other, SIDES, type Side } from '@/lib/game/types';
import { useGame } from './GameContext';

const pct = (p: number) => `${Math.round(p * 100)}%`;
const american = (o: number | null) => (o == null ? null : o > 0 ? `+${o}` : String(o));

function Team({ side }: { side: Side }) {
    const { m, colors } = useGame();
    const t = m.teams[side];
    const won = m.state === 'final' && t.score > m.teams[other(side)].score;
    const away = side === 'away';
    return (
        <div className={cn('flex min-w-0 items-center gap-3 md:gap-5', !away && 'flex-row-reverse text-right')}>
            <Link href={`/teams/${t.tri}`} className="shrink-0" aria-label={`${t.place} ${t.name}`}>
                <Crest tri={t.tri} size={128} priority className="h-14 w-14 md:h-28 md:w-28" />
            </Link>
            <div className={cn('flex min-w-0 flex-col', away ? 'items-start' : 'items-end')}>
                <span className="hidden text-micro font-medium uppercase tracking-label text-fg-3 md:block">{t.place}</span>
                <span className="font-display text-title font-bold uppercase tracking-wide text-fg-1 md:text-h2">
                    <span className="md:hidden">{t.tri}</span>
                    <span className="hidden md:inline">{t.name}</span>
                </span>
                <span className={cn('font-display text-[44px] font-bold leading-none tabular-nums md:text-[72px]', won || m.state !== 'final' ? 'text-fg-1' : 'text-fg-3')}>
                    {t.score}
                </span>
                <span className="mt-1 h-1 w-10 rounded-full" style={{ background: colors[side], opacity: won || m.state !== 'final' ? 1 : 0.4 }} aria-hidden="true" />
            </div>
        </div>
    );
}

export function ScoreBand() {
    const { m, byId } = useGame();
    const lines = lineScore(m);
    const status =
        m.state === 'final' ? (m.outcome === 'REG' ? 'Final' : `Final/${m.outcome}`) : m.state === 'live' ? (m.live?.intermission ? 'Intermission' : 'Live') : 'Pregame';
    const pg = m.pregame;
    const pick: Side | null = pg && !pg.lean ? (pg.homeWin >= 0.5 ? 'home' : 'away') : null;
    const pickP = pg ? (pick === 'away' ? 1 - pg.homeWin : pg.homeWin) : null;
    const market = pg?.marketHome != null && pick ? (pick === 'home' ? pg.marketHome : 1 - pg.marketHome) : null;

    return (
        <header className="panel overflow-hidden">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 p-card md:gap-8 md:px-8 md:py-6">
                <Team side="away" />
                <div className="flex flex-col items-center gap-2 text-center">
                    <span
                        className={cn(
                            'rounded-chip px-2 py-0.5 text-micro font-bold uppercase tracking-label',
                            m.state === 'live' ? 'bg-pos/10 text-pos shadow-glow' : m.state === 'final' ? 'bg-surface-3 text-fg-1' : 'text-fg-3',
                        )}
                    >
                        {status}
                        {m.live && !m.live.intermission ? ` · ${m.live.period <= 3 ? `P${m.live.period}` : 'OT'} ${m.live.remaining}` : ''}
                    </span>
                    <span className="text-micro uppercase tracking-label text-fg-3">
                        {m.state === 'pre' ? <LocalTime iso={m.startUtc} /> : m.date}
                    </span>
                    {/* Line score: goals by period, shots under. */}
                    <table className="hidden text-caption tabular-nums md:table" aria-label="Goals and shots by period">
                        <thead>
                            <tr className="text-micro uppercase text-fg-3">
                                <th scope="col" className="sr-only">
                                    Team
                                </th>
                                {lines.map(l => (
                                    <th key={l.period} scope="col" className="w-7 font-medium">
                                        {l.label}
                                    </th>
                                ))}
                                <th scope="col" className="w-9 font-medium">
                                    SOG
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {SIDES.map(s => (
                                <tr key={s}>
                                    <th scope="row" className="pr-2 text-left text-micro font-bold uppercase text-fg-2">
                                        {m.teams[s].tri}
                                    </th>
                                    {lines.map(l => (
                                        <td key={l.period} className={cn('text-center', l.goals[s] ? 'font-bold text-fg-1' : 'text-fg-3')}>
                                            {l.goals[s]}
                                        </td>
                                    ))}
                                    <td className="text-center text-fg-2">{lines.reduce((a, l) => a + l.sog[s], 0)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {m.venue ? <span className="hidden text-micro uppercase tracking-label text-fg-3 md:block">{m.venue}</span> : null}
                </div>
                <Team side="home" />
            </div>

            {pg || m.stars.length ? (
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line px-card py-2.5 text-caption md:px-8">
                    {pg ? (
                        <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1" data-call>
                            <span className="label">Call</span>
                            {pick ? (
                                <>
                                    <span className="font-bold text-fg-1">{m.teams[pick].tri}</span>
                                    <span className="font-bold text-model">{pct(pickP!)}</span>
                                    {market != null ? <span className="text-fg-3">mkt {pct(market)}</span> : null}
                                    {american(pick === 'home' ? pg.homeOdds : pg.awayOdds) ? (
                                        <span className="text-fg-3">{american(pick === 'home' ? pg.homeOdds : pg.awayOdds)}</span>
                                    ) : null}
                                </>
                            ) : (
                                <span className="text-fg-2">No lean · {pct(pg.homeWin)} {m.teams.home.tri}</span>
                            )}
                            {m.state === 'final' && pick ? (
                                <span className={cn('font-bold uppercase tracking-label', m.teams[pick].score > m.teams[other(pick)].score ? 'text-pos' : 'text-neg')}>
                                    {m.teams[pick].score > m.teams[other(pick)].score ? 'Hit' : 'Miss'}
                                </span>
                            ) : null}
                        </p>
                    ) : (
                        <span />
                    )}
                    {m.stars.length ? (
                        <ol className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Three stars">
                            {m.stars.map(s => (
                                <li key={s.star} className="flex items-center gap-1.5">
                                    <span className="flex items-center gap-0.5 text-micro font-bold tabular-nums text-warn">
                                        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
                                            <path d="M5 .6 6.3 3.4 9.4 3.7 7.1 5.8 7.8 8.9 5 7.3 2.2 8.9 2.9 5.8.6 3.7 3.7 3.4z" fill="currentColor" />
                                        </svg>
                                        <span className="sr-only">Star </span>
                                        {s.star}
                                    </span>
                                    <Crest tri={m.teams[s.side].tri} size={16} className="h-4 w-4" />
                                    <span className="text-fg-1">{shortName(byId.get(s.playerId))}</span>
                                    <span className="text-micro text-fg-3">{s.line}</span>
                                </li>
                            ))}
                        </ol>
                    ) : null}
                </div>
            ) : null}
        </header>
    );
}
