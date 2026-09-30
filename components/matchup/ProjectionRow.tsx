import { LazyInfoTip } from './LazyInfoTip';
import type { Prediction } from '@/types/prediction';
import { fmtOdds } from '@/lib/matchup/format';
import type { GlossaryTerm } from '@/lib/glossary';
import { blendNote, forecastPair, gatedEdge, hasMarket, marketPair, modelOnlyPair, onPriors } from '@/lib/matchup/edge';
import { cn } from '@/lib/utils';

/** One "butterfly" row: away value · label · home value, mirroring the win bar. */
function Row({
    label,
    away,
    home,
    strong,
    term,
    note,
}: {
    label: string;
    away: React.ReactNode;
    home: React.ReactNode;
    strong?: boolean;
    term?: GlossaryTerm;
    note?: string;
}) {
    const val = cn('tabular-nums', strong ? 'text-body-sm font-bold text-fg-1' : 'text-body-sm font-semibold text-fg-1');
    return (
        <div role="row" className="contents">
            <span role="cell" className={cn(val, 'text-left')}>
                {away}
            </span>
            <span role="rowheader" className="inline-flex items-center justify-center gap-0.5 text-center text-caption text-fg-2">
                {label}
                {term ? (
                    <LazyInfoTip
                        term={term}
                        note={note}
                        label={`What is ${label}?`}
                        className="relative z-10 -my-0.5 text-fg-3 coarse:min-h-6 coarse:min-w-6"
                    />
                ) : null}
            </span>
            <span role="cell" className={cn(val, 'text-right')}>
                {home}
            </span>
        </div>
    );
}

/**
 * Model vs market for one pregame card: published win %, de-vigged market %,
 * fair odds vs the market line and projected goals, laid out under the win
 * bar (away left, home right). The edge chip appears only when the
 * pipeline's gate is open for this game.
 */
export function ProjectionRow({ p }: { p: Prediction }) {
    const model = forecastPair(p);
    if (!model) return null;
    const pure = modelOnlyPair(p);
    const note = blendNote(p) ?? undefined;
    const market = marketPair(p);
    const edge = gatedEdge(p);
    const a = p.away.team.triCode;
    const h = p.home.team.triCode;
    const priced = hasMarket(p);

    return (
        <div className="flex flex-col gap-1.5">
            <div role="table" aria-label={`Forecast, model and market, ${a} at ${h}`} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-1">
                <div role="row" className="sr-only">
                    <span role="columnheader">{a}</span>
                    <span role="columnheader">Measure</span>
                    <span role="columnheader">{h}</span>
                </div>
                <Row label="Our forecast" term="model-pct" note={note} away={`${model.away}%`} home={`${model.home}%`} strong />
                {pure && (pure.away !== model.away || note) ? (
                    <Row
                        label="Model only"
                        term="model-pct"
                        note={
                            market && market.away === pure.away
                                ? 'The game model on its own, before it is blended with the betting market. Here it lands on the market\u2019s number by coincidence: it is built only from team, goalie and schedule factors and never reads the price.'
                                : 'The game model on its own, before it is blended with the betting market.'
                        }
                        away={`${pure.away}%`}
                        home={`${pure.home}%`}
                    />
                ) : null}
                {market ? <Row label="Market" term="market-pct" away={`${market.away}%`} home={`${market.home}%`} /> : null}
                <Row
                    label={priced ? 'Fair · Book' : 'Fair odds'}
                    term="fair-odds"
                    note={priced ? 'Fair is the no-margin line for our forecast; Book is the sportsbook moneyline.' : undefined}
                    away={
                        <>
                            {fmtOdds(p.away.fairOdds) ?? '—'}
                            {priced ? <span className="font-normal text-fg-2"> · {fmtOdds(p.away.marketOdds)}</span> : null}
                        </>
                    }
                    home={
                        <>
                            {fmtOdds(p.home.fairOdds) ?? '—'}
                            {priced ? <span className="font-normal text-fg-2"> · {fmtOdds(p.home.marketOdds)}</span> : null}
                        </>
                    }
                />
                {p.away.xg != null && p.home.xg != null ? <Row label="Proj. goals" term="projected-goals" away={p.away.xg.toFixed(2)} home={p.home.xg.toFixed(2)} /> : null}
            </div>

            <p className="relative z-10 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-2">
                {edge ? (
                    <span className="inline-flex min-h-7 items-center gap-1.5 rounded-chip border border-pos/40 bg-pos/10 px-2.5 text-body-sm font-bold text-pos">
                        Edge +{edge.evPct.toFixed(1)}% {edge.tri}
                    </span>
                ) : null}
                {edge?.units != null ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-fg-1">
                        {edge.units.toFixed(1)}u
                        <LazyInfoTip term="units" label="What is Suggested stake (units)?" />
                        <a href="/accuracy#ledger" className="font-semibold text-brand hover:underline">
                            Bet ledger
                        </a>
                    </span>
                ) : null}
                {onPriors(p) ? (
                    <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full border border-warn" />
                        Early season · leans on preseason ratings
                        <LazyInfoTip
                            term="season-prior"
                            label="What does early season mean here?"
                            note="Either team has fewer than 10 games, so the model still leans on preseason ratings and the market carries more weight."
                            className="-my-1 text-fg-3 coarse:-my-3.5"
                        />
                    </span>
                ) : null}
                {!priced ? <span>No market line yet · model only</span> : null}
            </p>
        </div>
    );
}

export default ProjectionRow;
