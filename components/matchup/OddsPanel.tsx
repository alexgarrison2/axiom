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
import { clashSafePair } from '@/components/ui/team-color';
import { readableTextOn } from '@/components/ui/color';
import { useHydrated } from './GameTime';
import { MarketsTable } from './MarketsTable';
import { hasInfoOnlyEv, marketRows } from '@/lib/matchup/markets';

const OddsHistoryModal = dynamic(() => import('@/components/OddsHistoryModal'));

export function oddsHistoryUrl(p: Prediction): string {
    const q = new URLSearchParams({ gameId: p.id, date: p.date, legacyId: p.legacyId });
    return `/api/odds-history?${q.toString()}`;
}

/** One view of the win probability as a split bar: each team's share and its moneyline on its own side. */
function ProbRow({
    label,
    pair,
    odds,
    colors,
    a,
    h,
    magenta,
}: {
    label: React.ReactNode;
    pair: { away: number; home: number };
    odds: [string | null, string | null];
    colors: { away: string; home: string };
    a: string;
    h: string;
    magenta?: boolean;
}) {
    const seg = (side: 'away' | 'home') => {
        const win = pair[side];
        const fill = colors[side];
        return (
            <div
                className={cn('flex h-11 min-w-0 items-center px-2.5', side === 'away' ? 'justify-start' : 'justify-end text-right')}
                style={{ width: `${win}%`, background: fill, color: readableTextOn(fill), opacity: win >= 50 ? 1 : 0.62 }}
            >
                <span className="flex flex-col leading-tight">
                    <span className="font-display text-title font-bold tabular-nums">{win.toFixed(1)}%</span>
                    <span className="text-micro tabular-nums opacity-80">{odds[side === 'away' ? 0 : 1] ?? '—'}</span>
                </span>
            </div>
        );
    };
    return (
        <div className="flex flex-col gap-1" role="group" aria-label={`${a} ${pair.away.toFixed(1)}%, ${h} ${pair.home.toFixed(1)}%`}>
            <span className={cn('text-micro font-medium uppercase tracking-wide', magenta ? 'text-magenta' : 'text-fg-3')}>{label}</span>
            <div className="flex overflow-hidden rounded-control">
                {seg('away')}
                {seg('home')}
            </div>
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
    const colors = clashSafePair(a, h);

    return (
        <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-2 text-micro uppercase tracking-label text-fg-3">
                <span className="font-bold text-fg-1">{a}</span>
                <span className="text-center font-medium">
                    {[src, at].filter(Boolean).join(' · ') || (priced ? 'Market' : 'No line')}
                    {phase !== 'pre' && priced ? ' · pregame' : ''}
                </span>
                <span className="font-bold text-fg-1">{h}</span>
            </div>
            <div className="flex flex-col gap-2.5">
                {forecast ? (
                    <ProbRow label={<GlossLink term="model-pct">Forecast</GlossLink>} pair={forecast} odds={[fmtOdds(p.away.fairOdds), fmtOdds(p.home.fairOdds)]} colors={colors} a={a} h={h} />
                ) : null}
                {pure ? (
                    <ProbRow
                        label={<GlossLink term="model-only">Model</GlossLink>}
                        pair={pure}
                        odds={[fmtOdds(fairLine(pure.away)), fmtOdds(fairLine(pure.home))]}
                        colors={colors}
                        a={a}
                        h={h}
                        magenta
                    />
                ) : null}
                {market ? (
                    <ProbRow label={<GlossLink term="market-pct">Market</GlossLink>} pair={market} odds={[fmtOdds(p.away.marketOdds), fmtOdds(p.home.marketOdds)]} colors={colors} a={a} h={h} />
                ) : null}
                {p.away.xg != null && p.home.xg != null ? (
                    <div className="flex items-baseline justify-between gap-2 border-t border-line pt-2 tabular-nums">
                        <span className="font-display text-title font-bold text-fg-1">{p.away.xg.toFixed(2)}</span>
                        <span className="text-micro font-medium uppercase tracking-wide text-fg-3">
                            <GlossLink term="projected-goals">xG</GlossLink>
                        </span>
                        <span className="font-display text-title font-bold text-fg-1">{p.home.xg.toFixed(2)}</span>
                    </div>
                ) : null}
            </div>

            <MarketsTable p={p} />

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
                ) : null}
                {infoOnly ? (
                    <GlossLink term="sim-edge" desc={p.markets?.gateReason ?? undefined} className="label">
                        Info only
                    </GlossLink>
                ) : null}
                <span className="flex-1" />
                {history && history.length > 1 ? <OddsHistoryModal entries={history} away={p.away.team} home={p.home.team} started={phase !== 'pre'} /> : null}
            </div>
        </div>
    );
}

export default OddsPanel;
