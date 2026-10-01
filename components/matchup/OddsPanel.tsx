'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Prediction } from '@/types/prediction';
import type { OddsEntry } from '@/app/api/odds-history/route';
import type { Phase } from '@/lib/matchup/lifecycle';
import { loadJson } from '@/lib/client-data';
import { fmtOdds, fmtTime, sourceLabel } from '@/lib/matchup/format';
import { fairLine } from '@/lib/matchup/parse';
import { hasMarket, hasPrediction, recommendedBet } from '@/lib/matchup/edge';
import { cn } from '@/lib/utils';
import { GlossLink } from '@/components/ui/gloss-link';
import { useHydrated } from './GameTime';

const OddsHistoryModal = dynamic(() => import('@/components/OddsHistoryModal'));

export function oddsHistoryUrl(p: Prediction): string {
    const q = new URLSearchParams({ gameId: p.id, date: p.date, legacyId: p.legacyId });
    return `/api/odds-history?${q.toString()}`;
}

/** Butterfly row: away value · label · home value. */
function Row({ label, away, home, strong, tone }: { label: React.ReactNode; away: React.ReactNode; home: React.ReactNode; strong?: boolean; tone?: string }) {
    const v = cn('py-1 tabular-nums', strong ? 'font-bold text-fg-1' : 'text-fg-1', tone);
    return (
        <tr className="border-t border-line first:border-t-0">
            <td className={cn(v, 'text-left')}>{away ?? '—'}</td>
            <th scope="row" className="px-2 py-1 text-center text-micro font-medium uppercase tracking-wide text-fg-3">
                {label}
            </th>
            <td className={cn(v, 'text-right')}>{home ?? '—'}</td>
        </tr>
    );
}

/** One side of a probability row: win % (one decimal) over its moneyline. */
function PctOdds({ pct, odds, home, tone }: { pct: number; odds: string | null; home?: boolean; tone?: string }) {
    return (
        <span className={cn('flex flex-col leading-tight', home ? 'items-end' : 'items-start')}>
            <span className={cn('font-display text-body font-bold tabular-nums cq-md:text-[17px]', tone ?? 'text-fg-1')}>{pct.toFixed(1)}%</span>
            <span className="text-micro tabular-nums text-fg-3">{odds ?? '—'}</span>
        </span>
    );
}

/** Double-height probability row: forecast, model or market. */
function PctRow({ label, pair, odds, tone }: { label: React.ReactNode; pair: { away: number; home: number }; odds: [string | null, string | null]; tone?: string }) {
    return (
        <tr className="border-t border-line first:border-t-0">
            <td className="py-1.5 text-left">
                <PctOdds pct={pair.away} odds={odds[0]} tone={tone} />
            </td>
            <th scope="row" className="px-2 py-1.5 text-center text-micro font-medium uppercase tracking-wide text-fg-3">
                {label}
            </th>
            <td className="py-1.5 text-right">
                <PctOdds pct={pair.home} odds={odds[1]} tone={tone} home />
            </td>
        </tr>
    );
}

/** One section of the TOTAL / xG row: small label over a value. */
function Cell({ label, children, align = 'center' }: { label: React.ReactNode; children: React.ReactNode; align?: 'left' | 'center' | 'right' }) {
    return (
        <div className={cn('flex min-w-0 flex-col gap-0.5', align === 'left' ? 'items-start' : align === 'right' ? 'items-end' : 'items-center')}>
            <span className="text-micro font-medium uppercase tracking-wide text-fg-3">{label}</span>
            <span className="whitespace-nowrap font-display text-body font-bold tabular-nums text-fg-1 cq-md:text-[17px]">{children}</span>
        </div>
    );
}

/** A probability pair to one decimal that sums to 100 (null when neither side is known). */
function pair1(away: number | null | undefined, home: number | null | undefined): { away: number; home: number } | null {
    if (away == null && home == null) return null;
    let a = away ?? 100 - (home as number);
    const h0 = home ?? 100 - a;
    const sum = a + h0;
    if (sum > 0) a = (a / sum) * 100;
    const ar = Math.round(a * 10) / 10;
    return { away: ar, home: Math.round((100 - ar) * 10) / 10 };
}

/** Model vs market, every line we have for the game, its source and time, and the line move. */
export function OddsPanel({ p, phase }: { p: Prediction; phase: Phase }) {
    const hydrated = useHydrated();
    const [history, setHistory] = useState<OddsEntry[] | null>(null);
    const priced0 = hasMarket(p);
    const forecast = hasPrediction(p) ? pair1(p.away.winPct, p.home.winPct) : null;
    const pure = hasPrediction(p) && (p.away.modelWinPct != null || p.home.modelWinPct != null) ? pair1(p.away.modelWinPct, p.home.modelWinPct) : null;
    const market = priced0 ? pair1(p.away.marketWinPct, p.home.marketWinPct) : null;
    const edge = phase === 'pre' ? recommendedBet(p) : null;
    const priced = priced0;

    useEffect(() => {
        let live = true;
        loadJson<{ entries?: OddsEntry[] }>(oddsHistoryUrl(p)).then(
            d => live && setHistory(d.entries ?? []),
            () => live && setHistory([]),
        );
        return () => {
            live = false;
        };
    }, [p]);

    const src = sourceLabel(p.marketSource);
    const atTime = p.marketFetchedAt ? fmtTime(p.marketFetchedAt, hydrated ? undefined : 'America/New_York') : null;
    const fetched = p.marketFetchedAt ? new Date(p.marketFetchedAt) : null;
    const notToday = hydrated && fetched && !Number.isNaN(fetched.getTime()) && fetched.toDateString() !== new Date().toDateString();
    const at = atTime && notToday && fetched ? `${fetched.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${atTime}` : atTime;
    const a = p.away.team.triCode;
    const h = p.home.team.triCode;

    return (
        <div className="flex flex-col gap-2.5">
            <table className="w-full text-caption">
                <caption className="sr-only">
                    {a} at {h}: forecast, model and market
                </caption>
                <thead>
                    <tr className="text-micro uppercase tracking-label text-fg-3">
                        <th scope="col" className="pb-1 text-left font-bold text-fg-1">
                            {a}
                        </th>
                        <th scope="col" className="pb-1 text-center font-medium">
                            {[src, at].filter(Boolean).join(' · ') || (priced ? 'Market' : 'No line')}
                            {phase !== 'pre' && priced ? ' · pregame' : ''}
                        </th>
                        <th scope="col" className="pb-1 text-right font-bold text-fg-1">
                            {h}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {forecast ? (
                        <PctRow label={<GlossLink term="model-pct">Forecast</GlossLink>} pair={forecast} odds={[fmtOdds(p.away.fairOdds), fmtOdds(p.home.fairOdds)]} />
                    ) : null}
                    {pure ? (
                        <PctRow
                            label={<GlossLink term="model-only">Model</GlossLink>}
                            pair={pure}
                            odds={[fmtOdds(fairLine(pure.away)), fmtOdds(fairLine(pure.home))]}
                            tone="text-magenta"
                        />
                    ) : null}
                    {market ? <PctRow label={<GlossLink term="market-pct">Market</GlossLink>} pair={market} odds={[fmtOdds(p.away.marketOdds), fmtOdds(p.home.marketOdds)]} /> : null}
                    {p.totalLine || (p.away.xg != null && p.home.xg != null) ? (
                        <tr className="border-t border-line">
                            <td colSpan={3} className="py-2">
                                <div className="grid grid-cols-3 items-center gap-2">
                                    <Cell label="Total" align="left">
                                        {p.totalLine ?? '—'}
                                    </Cell>
                                    <Cell label="O / U">
                                        {p.totalOver != null || p.totalUnder != null ? `${fmtOdds(p.totalOver) ?? '—'} / ${fmtOdds(p.totalUnder) ?? '—'}` : '—'}
                                    </Cell>
                                    <Cell label={<GlossLink term="projected-goals">xG</GlossLink>} align="right">
                                        {p.away.xg != null && p.home.xg != null ? (
                                            <>
                                                {p.away.xg.toFixed(2)} <span className="text-fg-3">–</span> {p.home.xg.toFixed(2)}
                                                <span className="sr-only">
                                                    {' '}
                                                    projected goals, {a} then {h}
                                                </span>
                                            </>
                                        ) : (
                                            '—'
                                        )}
                                    </Cell>
                                </div>
                            </td>
                        </tr>
                    ) : null}
                </tbody>
                <tbody className="border-t-[3px] border-double border-line-strong">
                    {p.away.puckline != null && p.home.puckline != null ? (
                        <Row label="Puck line" away={`${p.away.pucklineSpread ?? ''} ${fmtOdds(p.away.puckline)}`} home={`${p.home.pucklineSpread ?? ''} ${fmtOdds(p.home.puckline)}`} />
                    ) : null}
                    {p.away.threeWay != null && p.home.threeWay != null ? (
                        <Row label={p.threeWayTie != null ? `3-way · tie ${fmtOdds(p.threeWayTie)}` : '3-way'} away={fmtOdds(p.away.threeWay)} home={fmtOdds(p.home.threeWay)} />
                    ) : null}
                    {p.away.firstPeriodMl != null && p.home.firstPeriodMl != null ? <Row label="1st per" away={fmtOdds(p.away.firstPeriodMl)} home={fmtOdds(p.home.firstPeriodMl)} /> : null}
                </tbody>
            </table>

            <div className="flex flex-wrap items-center justify-between gap-2">
                {edge ? (
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="rounded-chip border border-pos/40 px-2 py-0.5 text-micro font-bold uppercase tracking-chip text-pos">
                            +EV {edge.evPct.toFixed(1)}% {edge.tri}
                            {edge.units != null ? ` · ${edge.units.toFixed(1)}u` : ''}
                        </span>
                        {edge.official ? null : (
                            <GlossLink href="/methodology#edge" desc={p.gateReason ?? undefined} className="label">
                                Unofficial · gate closed
                            </GlossLink>
                        )}
                    </span>
                ) : phase === 'pre' && priced ? (
                    <GlossLink href="/methodology#edge" desc="No side clears +3% EV with a stake of 0.5u or more." className="label">
                        No bet
                    </GlossLink>
                ) : (
                    <span />
                )}
                {history && history.length > 1 ? <OddsHistoryModal entries={history} away={p.away.team} home={p.home.team} started={phase !== 'pre'} /> : null}
            </div>
        </div>
    );
}

export default OddsPanel;
