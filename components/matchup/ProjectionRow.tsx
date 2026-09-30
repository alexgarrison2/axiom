import { InfoTip } from '@/components/ui/info-tip';
import type { Prediction } from '@/types/prediction';
import { fmtOdds } from '@/lib/matchup/format';
import { gatedEdge, hasMarket, marketPair, modelPair } from '@/lib/matchup/edge';
import { cn } from '@/lib/utils';

function Row({ label, term, away, home, strong, muted }: { label: string; term?: Parameters<typeof InfoTip>[0]['term']; away: React.ReactNode; home: React.ReactNode; strong?: boolean; muted?: boolean }) {
    return (
        <div role="row" className="contents">
            <span role="rowheader" className="flex items-center gap-0.5 text-caption text-fg-2">
                {label}
                {term ? <InfoTip term={term} className="relative z-10 -my-1 text-fg-3" /> : null}
            </span>
            <span role="cell" className={cn('text-right tabular-nums', strong ? 'text-body-sm font-bold text-fg-1' : 'text-body-sm font-semibold', muted ? 'text-fg-2' : !strong && 'text-fg-1')}>
                {away}
            </span>
            <span role="cell" className={cn('text-right tabular-nums', strong ? 'text-body-sm font-bold text-fg-1' : 'text-body-sm font-semibold', muted ? 'text-fg-2' : !strong && 'text-fg-1')}>
                {home}
            </span>
        </div>
    );
}

/**
 * Model vs market for one pregame card: published win %, de-vigged market %,
 * fair odds vs the market line, projected goals, and the edge chip only when
 * the pipeline's gate is open for this game.
 */
export function ProjectionRow({ p }: { p: Prediction }) {
    const model = modelPair(p);
    if (!model) return null;
    const market = marketPair(p);
    const edge = gatedEdge(p);
    const a = p.away.team.triCode;
    const h = p.home.team.triCode;

    return (
        <div className="flex flex-col gap-2">
            <div role="table" aria-label={`Model and market, ${a} at ${h}`} className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-x-3 gap-y-1 rounded-control border border-line bg-bg/40 px-3 py-2">
                <div role="row" className="contents">
                    <span role="columnheader" className="flex items-center text-micro font-semibold uppercase tracking-wider text-fg-3">
                        <span className="sr-only">Measure</span>
                        <InfoTip term="market-pct" className="relative z-10 -ml-1 text-fg-3" />
                    </span>
                    <span role="columnheader" className="text-right text-micro font-semibold uppercase tracking-wider text-fg-3">{a}</span>
                    <span role="columnheader" className="text-right text-micro font-semibold uppercase tracking-wider text-fg-3">{h}</span>
                </div>
                <Row label="Model" away={`${model.away}%`} home={`${model.home}%`} strong />
                {market ? <Row label="Market" away={`${market.away}%`} home={`${market.home}%`} muted /> : null}
                <Row
                    label={hasMarket(p) ? 'Fair · line' : 'Fair odds'}
                    away={
                        <>
                            {fmtOdds(p.away.fairOdds) ?? '—'}
                            {hasMarket(p) ? <span className="font-normal text-fg-2"> · {fmtOdds(p.away.marketOdds)}</span> : null}
                        </>
                    }
                    home={
                        <>
                            {fmtOdds(p.home.fairOdds) ?? '—'}
                            {hasMarket(p) ? <span className="font-normal text-fg-2"> · {fmtOdds(p.home.marketOdds)}</span> : null}
                        </>
                    }
                    muted
                />
                {p.away.xg != null && p.home.xg != null ? (
                    <Row label="Proj. goals" away={p.away.xg.toFixed(2)} home={p.home.xg.toFixed(2)} muted />
                ) : null}
            </div>
            {!hasMarket(p) ? <p className="text-caption text-fg-3">No market line yet · model only</p> : null}
            {edge ? (
                <p className="relative z-10 flex flex-wrap items-center gap-2">
                    <span className="inline-flex min-h-7 items-center gap-1.5 rounded-chip border border-pos/40 bg-pos/10 px-2.5 text-body-sm font-bold text-pos">
                        Edge {edge.evPct > 0 ? '+' : ''}
                        {edge.evPct.toFixed(1)}% {edge.tri}
                    </span>
                    {edge.units != null ? (
                        <span className="inline-flex items-center gap-1 text-body-sm font-semibold text-fg-1">
                            {edge.units.toFixed(1)}u
                            <InfoTip term="units" />
                            <a href="/accuracy#ledger" className="text-caption font-semibold text-brand hover:underline">
                                Bet ledger
                            </a>
                        </span>
                    ) : null}
                </p>
            ) : null}
        </div>
    );
}

export default ProjectionRow;
