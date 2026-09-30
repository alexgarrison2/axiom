'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Prediction } from '@/types/prediction';
import type { OddsEntry } from '@/app/api/odds-history/route';
import type { Phase } from '@/lib/matchup/lifecycle';
import { InfoTip } from '@/components/ui/info-tip';
import { loadJson } from '@/lib/client-data';
import { fmtClock, fmtOdds, sourceLabel } from '@/lib/matchup/format';
import { gatedEdge, hasMarket, marketPair } from '@/lib/matchup/edge';
import { useHydrated } from './GameTime';

const OddsHistoryModal = dynamic(() => import('@/components/OddsHistoryModal'));

export function oddsHistoryUrl(p: Prediction): string {
    const q = new URLSearchParams({ gameId: p.id, date: p.date, legacyId: p.legacyId });
    return `/api/odds-history?${q.toString()}`;
}

function Row({ label, away, mid, home }: { label: React.ReactNode; away: React.ReactNode; mid?: React.ReactNode; home: React.ReactNode }) {
    return (
        <tr className="border-t border-line">
            <th scope="row" className="py-1.5 pr-2 text-left text-caption font-semibold text-fg-2">
                {label}
            </th>
            <td className="py-1.5 text-right tabular-nums text-fg-1">{away ?? '—'}</td>
            <td className="px-2 py-1.5 text-center text-caption tabular-nums text-fg-2">{mid ?? ''}</td>
            <td className="py-1.5 text-right tabular-nums text-fg-1">{home ?? '—'}</td>
        </tr>
    );
}

/** Every market we have for the game, its source and fetch time, and the line move since open. */
export function OddsPanel({ p, phase }: { p: Prediction; phase: Phase }) {
    const hydrated = useHydrated();
    const [history, setHistory] = useState<OddsEntry[] | null>(null);
    const market = marketPair(p);
    const edge = phase === 'pre' ? gatedEdge(p) : null;

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

    if (!hasMarket(p) && !p.totalLine) {
        return <p className="py-4 text-center text-body-sm text-fg-2">No market odds for this game yet.</p>;
    }

    const src = sourceLabel(p.marketSource);
    const at = p.marketFetchedAt ? fmtClock(p.marketFetchedAt, hydrated ? undefined : 'America/New_York') : null;
    const a = p.away.team.triCode;
    const h = p.home.team.triCode;

    return (
        <div className="flex flex-col gap-3 py-1">
            <table className="w-full text-body-sm">
                <caption className="pb-1 text-left text-caption text-fg-2">
                    {[src, at].filter(Boolean).join(' · ') || 'Market odds'}
                    {phase !== 'pre' ? ' · pregame line' : ''}
                </caption>
                <thead>
                    <tr className="text-micro uppercase tracking-wider text-fg-3">
                        <th scope="col" className="pb-1 text-left font-semibold">
                            Market
                        </th>
                        <th scope="col" className="pb-1 text-right font-semibold">
                            {a}
                        </th>
                        <th scope="col" className="pb-1 text-center font-semibold">
                            <span className="sr-only">Line</span>
                        </th>
                        <th scope="col" className="pb-1 text-right font-semibold">
                            {h}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {hasMarket(p) ? <Row label="Moneyline" away={fmtOdds(p.away.marketOdds)} home={fmtOdds(p.home.marketOdds)} /> : null}
                    {market ? (
                        <Row
                            label={
                                <span className="inline-flex items-center gap-0.5">
                                    No-vig %<InfoTip term="market-pct" />
                                </span>
                            }
                            away={`${market.away}%`}
                            home={`${market.home}%`}
                        />
                    ) : null}
                    <Row label="Fair (model)" away={fmtOdds(p.away.fairOdds)} home={fmtOdds(p.home.fairOdds)} />
                    {p.away.puckline != null && p.home.puckline != null ? (
                        <Row label="Puck line" away={`${p.away.pucklineSpread ?? ''} ${fmtOdds(p.away.puckline)}`} home={`${p.home.pucklineSpread ?? ''} ${fmtOdds(p.home.puckline)}`} />
                    ) : null}
                    {p.away.firstPeriodMl != null && p.home.firstPeriodMl != null ? (
                        <Row label="1st period" away={fmtOdds(p.away.firstPeriodMl)} home={fmtOdds(p.home.firstPeriodMl)} />
                    ) : null}
                    {p.away.threeWay != null && p.home.threeWay != null ? (
                        <Row label="Regulation 3-way" away={fmtOdds(p.away.threeWay)} mid={p.threeWayTie != null ? `Tie ${fmtOdds(p.threeWayTie)}` : null} home={fmtOdds(p.home.threeWay)} />
                    ) : null}
                    {p.totalLine ? (
                        <Row
                            label={`Total ${p.totalLine}`}
                            away={p.totalOver != null ? `O ${fmtOdds(p.totalOver)}` : null}
                            mid={p.expectedTotal != null ? `Model ${p.expectedTotal.toFixed(1)}` : null}
                            home={p.totalUnder != null ? `U ${fmtOdds(p.totalUnder)}` : null}
                        />
                    ) : null}
                </tbody>
            </table>
            {p.totalLine ? <p className="-mt-1 text-micro text-fg-3">Total row: Over price left, Under price right.</p> : null}

            {phase === 'pre' && !edge && hasMarket(p) ? (
                <p className="flex items-center gap-1 text-caption text-fg-2">
                    No bet on this game{p.gateReason ? ' · the edge gate is closed' : ''}.
                    <InfoTip term="edge" />
                </p>
            ) : null}

            {history && history.length > 1 ? <OddsHistoryModal entries={history} away={p.away.team} home={p.home.team} /> : null}
        </div>
    );
}

export default OddsPanel;
