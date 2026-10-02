import type { MarketOutcome, Prediction } from '@/types/prediction';
import { evTone, fmtEv, fmtFair, fmtModelPct, marketRows, type MarketRow } from '@/lib/matchup/markets';
import { fmtOdds } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';
import { GlossLink } from '@/components/ui/gloss-link';

const TONE = { pos: 'text-pos', neg: 'text-neg' } as const;
const DASH = <span className="text-fg-3">—</span>;

/*
 * Each side has two cells: model % with the book price, and EV with the fair
 * price. On a narrow card they stack (% over book, EV over fair, like the
 * forecast rows above); from cq-sm they sit in one line, mirrored so the book
 * price is outermost and EV next to the label on both sides.
 */
const W = { book: 'cq-sm:min-w-[4.6ch]', pct: 'cq-sm:min-w-[3.8ch]', fair: 'cq-sm:min-w-[4.6ch]', ev: 'cq-sm:min-w-[5.8ch]' } as const;
const PAIR = 'flex flex-col leading-[15px] cq-sm:gap-1.5 cq-sm:text-right';
const PAIR_SIDE = { away: 'items-start cq-sm:flex-row-reverse cq-sm:items-center', home: 'items-end cq-sm:flex-row cq-sm:items-center' } as const;
const CELL = 'w-px whitespace-nowrap py-0.5 tabular-nums';
const CELL_SIDE = { away: 'pr-2 cq-sm:pr-1.5', home: 'pl-2 cq-sm:pl-1.5' } as const;

type Side = 'away' | 'home';

function Ev({ o, gated }: { o: MarketOutcome | undefined; gated: boolean }) {
    const t = fmtEv(o?.ev);
    if (t == null) return DASH;
    const tone = evTone(o?.ev);
    return (
        <span className={tone ? TONE[tone] : 'text-fg-2'} data-ev={gated ? 'info-only' : 'ml'}>
            {t}
        </span>
    );
}

/** Model % over (or beside) the book price. */
function PctBook({ o, side }: { o: MarketOutcome | undefined; side: Side }) {
    return (
        <span className={cn(PAIR, PAIR_SIDE[side])}>
            <span className={cn(W.pct, 'text-fg-1')}>
                {fmtModelPct(o?.pct) ?? DASH}
                <span className="sr-only">%</span>
            </span>
            <span className={cn(W.book, 'text-fg-2')}>{fmtOdds(o?.price) ?? DASH}</span>
        </span>
    );
}

/** EV over (or beside) the fair price. */
function EvFair({ o, side, gated }: { o: MarketOutcome | undefined; side: Side; gated: boolean }) {
    return (
        <span className={cn(PAIR, PAIR_SIDE[side])}>
            <span className={W.ev}>
                <Ev o={o} gated={gated} />
            </span>
            <span className={cn(W.fair, 'text-fg-2')}>{fmtFair(o?.fair) ?? DASH}</span>
        </span>
    );
}

/*
 * Header labels: the bottom one of each stacked pair is as tall as the Fair
 * link's tap target (min-h-6) so both columns end on one line; in one line
 * (cq-sm) every label is that tall.
 */
const HEAD_TOP = 'cq-sm:flex cq-sm:min-h-6 cq-sm:items-center cq-sm:justify-end';
const HEAD_BOTTOM = 'flex min-h-6 items-center cq-sm:justify-end';

function HeadPctBook({ side }: { side: Side }) {
    return (
        <span className={cn(PAIR, PAIR_SIDE[side])}>
            <span className={cn(W.pct, HEAD_TOP)} aria-label="Model %">
                %
            </span>
            <span className={cn(W.book, HEAD_BOTTOM)}>Book</span>
        </span>
    );
}

function HeadEvFair({ side }: { side: Side }) {
    return (
        <span className={cn(PAIR, PAIR_SIDE[side])}>
            <span className={cn(W.ev, HEAD_TOP)}>EV</span>
            <span className={W.fair}>
                <GlossLink term="fair-price">Fair</GlossLink>
            </span>
        </span>
    );
}

function Label({ row }: { row: MarketRow }) {
    const text = row.term ? <GlossLink term={row.term}>{row.label}</GlossLink> : <span className="inline-flex min-h-6 items-center">{row.label}</span>;
    if (row.kind === 'middle' || !row.tags) return text;
    return (
        <span className="inline-flex items-center gap-1">
            <span className="text-fg-2">{row.tags[0]}</span>
            {text}
            <span className="text-fg-2">{row.tags[1]}</span>
        </span>
    );
}

/**
 * Every market with a posted price or a model number: book price, model %,
 * fair price and EV per outcome, away on the left, home on the right, a tie
 * or push centred under its market. Derivative EVs are info only.
 */
export function MarketsTable({ p }: { p: Prediction }) {
    const rows = marketRows(p);
    if (!rows.length) return null;
    const m = p.markets;
    const a = p.away.team.triCode;
    const h = p.home.team.triCode;
    return (
        <table className="w-full text-micro" data-markets>
            <caption className="sr-only">
                {a} at {h}: every market, model %, book price, EV and fair price
            </caption>
            <thead>
                <tr className="text-micro uppercase tracking-label text-fg-3">
                    <th scope="col" className={cn(CELL, CELL_SIDE.away, 'pb-1 text-left align-bottom font-medium')}>
                        <HeadPctBook side="away" />
                    </th>
                    <th scope="col" className={cn(CELL, CELL_SIDE.away, 'pb-1 text-left align-bottom font-medium')}>
                        <HeadEvFair side="away" />
                    </th>
                    <th scope="col" className="px-1 pb-1 text-center align-bottom font-medium">
                        {m?.status === 'poisson_fallback' ? (
                            <GlossLink term="simulator" desc="Estimated by the goal model: the simulator's lineup inputs were unavailable for this game." className="px-1 text-amber">
                                Est
                            </GlossLink>
                        ) : (
                            <span className="sr-only">Market</span>
                        )}
                    </th>
                    <th scope="col" className={cn(CELL, CELL_SIDE.home, 'pb-1 text-right align-bottom font-medium')}>
                        <HeadEvFair side="home" />
                    </th>
                    <th scope="col" className={cn(CELL, CELL_SIDE.home, 'pb-1 text-right align-bottom font-medium')}>
                        <HeadPctBook side="home" />
                    </th>
                </tr>
            </thead>
            <tbody className="tabular-nums text-fg-1">
                {rows.map(r =>
                    r.kind === 'sides' ? (
                        <tr key={r.key} data-market={r.key} data-gated={r.gated || undefined} className="border-t border-line">
                            <td className={cn(CELL, CELL_SIDE.away)}>
                                <PctBook o={r.away} side="away" />
                            </td>
                            <td className={cn(CELL, CELL_SIDE.away)}>
                                <EvFair o={r.away} side="away" gated={r.gated} />
                            </td>
                            <th scope="row" className="whitespace-nowrap px-1 text-center font-medium uppercase text-fg-3">
                                <Label row={r} />
                            </th>
                            <td className={cn(CELL, CELL_SIDE.home)}>
                                <EvFair o={r.home} side="home" gated={r.gated} />
                            </td>
                            <td className={cn(CELL, CELL_SIDE.home)}>
                                <PctBook o={r.home} side="home" />
                            </td>
                        </tr>
                    ) : (
                        <tr key={r.key} data-market={r.key} data-gated={r.gated || undefined}>
                            <td colSpan={5} className="text-center">
                                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                                    <span className="font-medium uppercase text-fg-3">
                                        <Label row={r} />
                                    </span>
                                    {r.key !== 'total-push' ? <span className="text-fg-2">{fmtOdds(r.outcome.price) ?? DASH}</span> : null}
                                    <span>
                                        {fmtModelPct(r.outcome.pct) ?? '—'}
                                        <span className="sr-only">%</span>
                                    </span>
                                    {r.key !== 'total-push' ? (
                                        <>
                                            <span className="text-fg-2">{fmtFair(r.outcome.fair) ?? DASH}</span>
                                            <Ev o={r.outcome} gated={r.gated} />
                                        </>
                                    ) : null}
                                </span>
                            </td>
                        </tr>
                    ),
                )}
            </tbody>
        </table>
    );
}

export default MarketsTable;
