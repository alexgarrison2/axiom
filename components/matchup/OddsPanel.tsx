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
import { BrandMark } from '@/components/ui/brand-mark';
import { WinBar } from '@/components/ui/win-bar';
import { useHydrated } from './GameTime';
import { MarketsTable } from './MarketsTable';
import { hasInfoOnlyEv, marketRows } from '@/lib/matchup/markets';

const OddsHistoryModal = dynamic(() => import('@/components/OddsHistoryModal'));

export function oddsHistoryUrl(p: Prediction): string {
    const q = new URLSearchParams({ gameId: p.id, date: p.date, legacyId: p.legacyId });
    return `/api/odds-history?${q.toString()}`;
}

const pct1 = (n: number) => `${n.toFixed(1)}%`;

/** One line of the readout: each side's number and price on its own side, the label between. */
function ReadRow({
    label,
    mark,
    pair,
    odds,
    strong,
    magenta,
}: {
    label: React.ReactNode;
    mark?: React.ReactNode;
    pair: { away: number; home: number };
    odds: [string | null, string | null];
    strong?: boolean;
    magenta?: boolean;
}) {
    const side = (win: number, price: string | null, right?: boolean) => (
        <span className={cn('flex min-w-0 items-baseline gap-2 tabular-nums', right && 'flex-row-reverse')}>
            <span className={cn('font-display font-bold', strong ? 'text-title text-fg-1' : 'text-body text-fg-1')}>{pct1(win)}</span>
            <span className="text-micro text-fg-3">{price ?? '—'}</span>
        </span>
    );
    return (
        <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-3 py-1.5">
            {side(pair.away, odds[0])}
            <span className={cn('inline-flex items-center gap-1.5 text-micro font-medium uppercase tracking-wide', magenta ? 'text-magenta' : 'text-fg-3')}>
                {mark}
                {label}
            </span>
            {side(pair.home, odds[1], true)}
        </div>
    );
}

/** Where the pure model and the de-vigged market disagree, in points on the home side. */
function gapNote(model: { home: number } | null, market: { home: number } | null, a: string, h: string): { text: string; side: 'away' | 'home' | null } | null {
    if (!model || !market) return null;
    const d = model.home - market.home;
    if (Math.abs(d) < 0.5) return { text: 'Model agrees with market', side: null };
    return { text: `Model ${Math.abs(d).toFixed(1)} pts higher on ${d > 0 ? h : a}`, side: d > 0 ? 'home' : 'away' };
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
    const infoOnly = hasInfoOnlyEv(marketRows(p));

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

    const gap = gapNote(pure, market, a, h);
    const showBar = forecast != null;

    return (
        <div className="flex flex-col gap-3">
            {/* Wide card: the model-vs-market read on the left, the full market board beside it. */}
            <div className="grid grid-cols-1 gap-x-8 gap-y-3 cq-lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] cq-lg:items-start">
                <div className="flex min-w-0 flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {edge ? (
                            <span className="flex flex-wrap items-center gap-2">
                                <span className="rounded-chip border border-pos/40 bg-pos/10 px-2 py-0.5 text-micro font-bold uppercase tracking-chip text-pos">
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
                        ) : null}
                        {infoOnly ? (
                            <GlossLink term="sim-edge" desc={p.markets?.gateReason ?? undefined} className="label">
                                Info only
                            </GlossLink>
                        ) : null}
                        <span className="flex-1" />
                        {history && history.length > 1 ? <OddsHistoryModal entries={history} away={p.away.team} home={p.home.team} started={phase !== 'pre'} /> : null}
                    </div>

                    {showBar ? (
                        <div className="flex flex-col gap-1">
                            <WinBar
                                away={a}
                                home={h}
                                pAway={forecast.away / 100}
                                market={market ? market.away / 100 : null}
                                model={pure ? pure.away / 100 : null}
                                size="md"
                                digits={1}
                                showCodes
                                animate={false}
                                label="Forecast win probability"
                            />
                            {gap ? (
                                <span className={cn('text-center text-micro font-medium uppercase tracking-wide', gap.side ? 'text-magenta' : 'text-fg-3')} data-gap>
                                    {gap.text}
                                </span>
                            ) : null}
                        </div>
                    ) : null}

                    <div className="flex flex-col divide-y divide-line border-y border-line">
                        {forecast ? <ReadRow label={<GlossLink term="model-pct">Forecast</GlossLink>} pair={forecast} odds={[fmtOdds(p.away.fairOdds), fmtOdds(p.home.fairOdds)]} strong /> : null}
                        {pure ? (
                            <ReadRow
                                label={
                                    <GlossLink term="model-only">
                                        <BrandMark wordmarkOnly animate={false} className="h-8" />
                                        <span className="sr-only">Model</span>
                                    </GlossLink>
                                }
                                mark={<i aria-hidden="true" className="inline-block h-2 w-2 rotate-45 bg-magenta" />}
                                pair={pure}
                                odds={[fmtOdds(fairLine(pure.away)), fmtOdds(fairLine(pure.home))]}
                                magenta
                            />
                        ) : null}
                        {market ? (
                            <ReadRow
                                label={<GlossLink term="market-pct">Market</GlossLink>}
                                mark={<i aria-hidden="true" className="inline-block h-3 w-0.5 bg-white" />}
                                pair={market}
                                odds={[fmtOdds(p.away.marketOdds), fmtOdds(p.home.marketOdds)]}
                            />
                        ) : null}
                    </div>
                </div>
                <div className="min-w-0">
                    <MarketsTable p={p} />
                </div>
            </div>

            <p className="text-center text-micro uppercase tracking-label text-fg-3">
                {[src, at].filter(Boolean).join(' · ') || (priced ? 'Market' : 'No line')}
                {phase !== 'pre' && priced ? ' · pregame' : ''}
            </p>
        </div>
    );
}

export default OddsPanel;
