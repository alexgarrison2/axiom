'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Prediction } from '@/types/prediction';
import type { OddsEntry } from '@/app/api/odds-history/route';
import type { Phase } from '@/lib/matchup/lifecycle';
import { loadJson } from '@/lib/client-data';
import { fmtOdds, fmtTime, sourceLabel } from '@/lib/matchup/format';
import { forecastPair, gatedEdge, hasMarket, marketPair, modelOnlyPair } from '@/lib/matchup/edge';
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

const pct = (v: number | undefined) => (v == null ? null : `${v}%`);

/** Model vs market, every line we have for the game, its source and time, and the line move. */
export function OddsPanel({ p, phase }: { p: Prediction; phase: Phase }) {
    const hydrated = useHydrated();
    const [history, setHistory] = useState<OddsEntry[] | null>(null);
    const market = marketPair(p);
    const forecast = forecastPair(p);
    const pure = modelOnlyPair(p);
    const edge = phase === 'pre' ? gatedEdge(p) : null;
    const priced = hasMarket(p);

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
                    {forecast ? <Row label={<GlossLink term="model-pct">Forecast</GlossLink>} away={pct(forecast.away)} home={pct(forecast.home)} strong /> : null}
                    {pure ? <Row label={<GlossLink term="model-only">Model</GlossLink>} away={pct(pure.away)} home={pct(pure.home)} tone="text-magenta" /> : null}
                    {market ? <Row label={<GlossLink term="market-pct">Market</GlossLink>} away={pct(market.away)} home={pct(market.home)} /> : null}
                    {priced ? <Row label="Book ML" away={fmtOdds(p.away.marketOdds)} home={fmtOdds(p.home.marketOdds)} strong /> : null}
                    {forecast ? <Row label={<GlossLink term="fair-odds">Fair</GlossLink>} away={fmtOdds(p.away.fairOdds)} home={fmtOdds(p.home.fairOdds)} /> : null}
                    {p.away.puckline != null && p.home.puckline != null ? (
                        <Row label="Puck line" away={`${p.away.pucklineSpread ?? ''} ${fmtOdds(p.away.puckline)}`} home={`${p.home.pucklineSpread ?? ''} ${fmtOdds(p.home.puckline)}`} />
                    ) : null}
                    {p.away.firstPeriodMl != null && p.home.firstPeriodMl != null ? <Row label="1st per" away={fmtOdds(p.away.firstPeriodMl)} home={fmtOdds(p.home.firstPeriodMl)} /> : null}
                    {p.away.threeWay != null && p.home.threeWay != null ? (
                        <Row label={p.threeWayTie != null ? `3-way · tie ${fmtOdds(p.threeWayTie)}` : '3-way'} away={fmtOdds(p.away.threeWay)} home={fmtOdds(p.home.threeWay)} />
                    ) : null}
                    {p.totalLine ? (
                        <Row
                            label={`Total ${p.totalLine}${p.expectedTotal != null ? ` · mdl ${p.expectedTotal.toFixed(1)}` : ''}`}
                            away={p.totalOver != null ? `O ${fmtOdds(p.totalOver)}` : null}
                            home={p.totalUnder != null ? `U ${fmtOdds(p.totalUnder)}` : null}
                        />
                    ) : null}
                    {p.away.xg != null && p.home.xg != null ? <Row label={<GlossLink term="projected-goals">Proj goals</GlossLink>} away={p.away.xg.toFixed(2)} home={p.home.xg.toFixed(2)} /> : null}
                </tbody>
            </table>

            <div className="flex flex-wrap items-center justify-between gap-2">
                {edge ? (
                    <span className="rounded-chip border border-pos/40 px-2 py-0.5 text-micro font-bold uppercase tracking-chip text-pos">
                        Edge +{edge.evPct.toFixed(1)}% {edge.tri}
                        {edge.units != null ? ` · ${edge.units.toFixed(1)}u` : ''}
                    </span>
                ) : phase === 'pre' && priced ? (
                    <GlossLink href="/methodology#edge" desc={p.gateReason ?? undefined} className="label">
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
