'use client';

import * as React from 'react';
import Link from 'next/link';
import { Crest } from '@/components/ui/crest';
import { LocalTime } from '@/components/ui/local-time';
import { cn } from '@/lib/utils';
import { lineScore, marketResults, shortName, type Hit } from '@/lib/game/analytics';
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

/** Settled-bet mark: a check in a circle (hit), a P (push); nothing on a miss. */
function HitMark({ h }: { h: Hit | null | undefined }) {
    if (h === 'hit')
        return (
            <svg viewBox="0 0 12 12" className="h-3.5 w-3.5 shrink-0 text-pos" role="img" aria-label="hit">
                <circle cx={6} cy={6} r={5.3} fill="none" stroke="currentColor" strokeWidth={1.2} />
                <path d="M3.4 6.2 5.2 8 8.7 4.3" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    if (h === 'push')
        return (
            <svg viewBox="0 0 12 12" className="h-3.5 w-3.5 shrink-0 text-fg-3" role="img" aria-label="push">
                <circle cx={6} cy={6} r={5.3} fill="none" stroke="currentColor" strokeWidth={1.2} />
                <path d="M4.6 9V3.2h1.9a1.6 1.6 0 0 1 0 3.2H4.6" fill="none" stroke="currentColor" strokeWidth={1.3} />
            </svg>
        );
    return <span className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
}

/** Feed id -> book name ("nhl_partner_draftkings" -> "DraftKings"). */
const bookName = (src: string) => (/draftkings/i.test(src) ? 'DraftKings' : /bovada/i.test(src) ? 'Bovada' : /fanduel/i.test(src) ? 'FanDuel' : src.replace(/_/g, ' '));

const odd = (o: number | null | undefined) => (o == null ? '—' : o > 0 ? `+${o}` : String(o));
const pctPt = (p: number) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;

/** One mirrored row: away value left, market centre, home value right; each value with its settled mark. */
function MarketRow({ label, away, home, center, hits }: { label: string; away: React.ReactNode; home: React.ReactNode; center?: React.ReactNode; hits?: { away?: Hit | null; home?: Hit | null } }) {
    return (
        <>
            <span className="flex items-center justify-end gap-1.5 text-fg-1">
                {away}
                <HitMark h={hits?.away} />
            </span>
            <span className="flex flex-col items-center text-center">
                <span className="text-micro font-bold uppercase tracking-wide text-fg-2">{label}</span>
                {center}
            </span>
            <span className="flex items-center gap-1.5 text-fg-1">
                <HitMark h={hits?.home} />
                {home}
            </span>
        </>
    );
}

/** Closing odds for every market, settled. */
function Markets() {
    const { m } = useGame();
    const o = m.odds;
    if (!o) return null;
    const r = marketResults(m);
    const pl = (side: Side) => {
        const p = o.puckline[side];
        return p ? (
            <span>
                <span className="text-fg-3">{p.spread > 0 ? `+${p.spread}` : p.spread}</span> {odd(p.price)}
            </span>
        ) : (
            '—'
        );
    };
    return (
        <div className="min-w-0">
            <p className="label mb-2">Closing lines{o.source ? <span className="ml-2 normal-case tracking-normal text-fg-3">{bookName(o.source)}</span> : null}</p>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 text-caption tabular-nums">
                <MarketRow label="Moneyline" away={odd(o.ml.away)} home={odd(o.ml.home)} hits={r ? r.ml : undefined} />
                <MarketRow label="Puck line" away={pl('away')} home={pl('home')} hits={r ? { away: r.puckline.away, home: r.puckline.home } : undefined} />
                {o.total ? (
                    <MarketRow
                        label={`Total ${o.total.line}`}
                        away={
                            <span>
                                <span className="text-fg-3">O</span> {odd(o.total.over)}
                            </span>
                        }
                        home={
                            <span>
                                <span className="text-fg-3">U</span> {odd(o.total.under)}
                            </span>
                        }
                        hits={r ? { away: r.over, home: r.under } : undefined}
                    />
                ) : null}
                {o.threeWay ? (
                    <MarketRow
                        label="Regulation"
                        away={odd(o.threeWay.away)}
                        home={odd(o.threeWay.home)}
                        center={
                            <span className="flex items-center gap-1 text-micro text-fg-2">
                                Tie {odd(o.threeWay.tie)} <HitMark h={r?.threeWay.tie} />
                            </span>
                        }
                        hits={r ? { away: r.threeWay.away, home: r.threeWay.home } : undefined}
                    />
                ) : null}
                {o.firstPeriod.away != null || o.firstPeriod.home != null ? (
                    <MarketRow label="1st period" away={odd(o.firstPeriod.away)} home={odd(o.firstPeriod.home)} hits={r ? r.firstPeriod : undefined} />
                ) : null}
                {o.firstPeriodThreeWay ? (
                    <MarketRow
                        label="1st · 3-way"
                        away={odd(o.firstPeriodThreeWay.away)}
                        home={odd(o.firstPeriodThreeWay.home)}
                        center={
                            <span className="flex items-center gap-1 text-micro text-fg-2">
                                Tie {odd(o.firstPeriodThreeWay.tie)} <HitMark h={r?.firstPeriodThreeWay.tie} />
                            </span>
                        }
                        hits={r ? { away: r.firstPeriodThreeWay.away, home: r.firstPeriodThreeWay.home } : undefined}
                    />
                ) : null}
            </div>
        </div>
    );
}

/** Playoff and Cup chances before and after the game, from the daily season simulation. */
function Outlook() {
    const { m } = useGame();
    const o = m.outlook;
    if (!o) return null;
    const cell = (side: Side, key: 'playoffs' | 'cup') => {
        const b = o.before[side]?.[key];
        const a = o.after[side]?.[key];
        if (b == null && a == null) return <span className="text-fg-3">—</span>;
        const d = a != null && b != null ? (a - b) * 100 : null;
        return (
            <span className={cn('flex items-baseline gap-1.5', side === 'away' ? 'justify-end' : 'justify-start')}>
                <span className="text-fg-3">{b != null ? pctPt(b) : '—'}</span>
                <span className="text-fg-3" aria-hidden="true">
                    ›
                </span>
                <span className="font-bold text-model">{a != null ? pctPt(a) : '…'}</span>
                {d != null ? (
                    <span className={cn('text-micro font-bold', Math.abs(d) < 0.05 ? 'text-fg-3' : d > 0 ? 'text-pos' : 'text-neg')}>
                        {d > 0 ? '+' : d < 0 ? '−' : '±'}
                        {Math.abs(d).toFixed(1)}
                    </span>
                ) : null}
            </span>
        );
    };
    return (
        <div className="min-w-0">
            <p className="label mb-2">
                Season odds{!o.afterAt ? <span className="ml-2 normal-case tracking-normal text-fg-3">after: next morning&apos;s run</span> : null}
            </p>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 text-caption tabular-nums">
                {(['playoffs', 'cup'] as const).map(k => (
                    <React.Fragment key={k}>
                        {cell('away', k)}
                        <span className="text-center text-micro font-bold uppercase tracking-wide text-fg-2">{k === 'playoffs' ? 'Playoffs' : 'Cup'}</span>
                        {cell('home', k)}
                    </React.Fragment>
                ))}
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

            {m.odds || m.outlook ? (
                <div className="grid gap-6 border-t border-line px-card py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:gap-10 md:px-8">
                    <Markets />
                    <Outlook />
                </div>
            ) : null}
        </header>
    );
}
