import type { MarketOutcome, Prediction } from '@/types/prediction';
import { evTone, fmtEv, fmtFair, fmtModelPct, marketRows, type MarketRow, type SidesRow } from '@/lib/matchup/markets';
import { fmtOdds } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';
import { GlossLink } from '@/components/ui/gloss-link';

const TONE = { pos: 'text-pos', neg: 'text-neg' } as const;
const CHIP = { pos: 'bg-pos/15 text-pos', neg: 'bg-neg/10 text-neg' } as const;
const DASH = <span className="text-fg-3">—</span>;

type Side = 'away' | 'home';

/** EV as a small signed chip, toned by sign. Derivative edges are info only (data-ev says which). */
function Ev({ o, gated }: { o: MarketOutcome | undefined; gated: boolean }) {
    const t = fmtEv(o?.ev);
    if (t == null) return null;
    const tone = evTone(o?.ev);
    return (
        <span className={cn('rounded-chip px-1.5 py-px text-caption font-bold tabular-nums', tone ? [TONE[tone], CHIP[tone]] : 'text-fg-2')} data-ev={gated ? 'info-only' : 'ml'}>
            {t}
        </span>
    );
}

/**
 * One outcome: the book price big, then Pony's own price and model % under
 * it, with the edge on the first line. Reads top to bottom, no column lookup.
 */
function Outcome({ o, tag, gated, align }: { o: MarketOutcome | undefined; tag?: string | null; gated: boolean; align: Side }) {
    const fair = fmtFair(o?.fair);
    const pct = fmtModelPct(o?.pct);
    return (
        <div className={cn('flex min-w-0 flex-col gap-1', align === 'home' && 'items-end text-right')}>
            <div className={cn('flex min-h-6 w-full items-center gap-2', align === 'home' ? 'flex-row-reverse' : 'justify-between')}>
                {tag ? <span className="text-micro font-bold uppercase tracking-wide text-fg-2">{tag}</span> : <span />}
                <Ev o={o} gated={gated} />
            </div>
            <span className="font-display text-title font-bold leading-5 tabular-nums text-fg-1">{fmtOdds(o?.price) ?? DASH}</span>
            <span className="flex flex-wrap items-baseline gap-x-2 text-micro tabular-nums text-fg-3">
                <span>
                    <GlossLink term="fair-price">Pony</GlossLink> <span className="font-bold text-fg-1">{fair ?? DASH}</span>
                </span>
                <span>
                    {pct ? <span className="text-fg-2">{pct}</span> : DASH}
                    <span className="sr-only">%</span>
                    <span aria-hidden="true">%</span>
                </span>
            </span>
        </div>
    );
}

/** What each side of a market is called: the team, the spread, or over / under. */
function sideTag(row: SidesRow, side: Side, tri: string): string {
    if (row.key === 'total') return side === 'away' ? 'Over' : 'Under';
    if (row.key === 'pl' && row.tags) return `${tri} ${row.tags[side === 'away' ? 0 : 1]}`;
    return tri;
}

function Label({ row }: { row: MarketRow }) {
    return row.term ? <GlossLink term={row.term}>{row.label}</GlossLink> : <span className="inline-flex min-h-6 items-center">{row.label}</span>;
}

/**
 * Every market with a posted price or a model number: for each outcome the
 * book price, Pony's price and model %, and the edge. Away on the left, home
 * on the right; a tie or push gets a line of its own. Derivative EVs are info
 * only.
 */
export function MarketsTable({ p }: { p: Prediction }) {
    const rows = marketRows(p);
    if (!rows.length) return null;
    const m = p.markets;
    const a = p.away.team.triCode;
    const h = p.home.team.triCode;
    return (
        <table className="w-full text-caption" data-markets>
            <caption className="sr-only">
                {a} at {h}: every market, book price, Pony price, model % and edge
            </caption>
            <thead>
                <tr className="text-micro uppercase tracking-label text-fg-3">
                    <th scope="col" className="w-[5rem] pb-1 text-left align-bottom font-medium">
                        {m?.status === 'poisson_fallback' ? (
                            <GlossLink term="simulator" desc="Estimated by the goal model: the simulator's lineup inputs were unavailable for this game." className="text-amber">
                                Est
                            </GlossLink>
                        ) : (
                            <span className="sr-only">Market</span>
                        )}
                    </th>
                    <th scope="col" className="pb-1 text-left align-bottom font-bold text-fg-1">
                        {a}
                    </th>
                    <th scope="col" className="pb-1 text-right align-bottom font-bold text-fg-1">
                        {h}
                    </th>
                </tr>
            </thead>
            <tbody>
                {rows.map(r =>
                    r.kind === 'sides' ? (
                        <tr key={r.key} data-market={r.key} data-gated={r.gated || undefined} className="border-t border-line align-top">
                            <th scope="row" className="w-[5rem] whitespace-nowrap py-2.5 pr-2 text-left align-top text-micro font-medium uppercase tracking-wide text-fg-3">
                                <Label row={r} />
                            </th>
                            <td className="w-1/2 py-2.5 pr-3">
                                <Outcome o={r.away} tag={sideTag(r, 'away', a)} gated={r.gated} align="away" />
                            </td>
                            <td className="w-1/2 py-2.5">
                                <Outcome o={r.home} tag={sideTag(r, 'home', h)} gated={r.gated} align="home" />
                            </td>
                        </tr>
                    ) : (
                        <tr key={r.key} data-market={r.key} data-gated={r.gated || undefined} className="align-middle">
                            <th scope="row" className="w-[5rem] whitespace-nowrap pb-2.5 pr-2 text-left text-micro font-medium uppercase tracking-wide text-fg-3">
                                <Label row={r} />
                            </th>
                            <td colSpan={2} className="pb-2.5">
                                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 tabular-nums">
                                    {r.key !== 'total-push' ? <span className="font-display text-title font-bold text-fg-1">{fmtOdds(r.outcome.price) ?? DASH}</span> : null}
                                    {r.key !== 'total-push' ? (
                                        <span className="text-micro text-fg-3">
                                            <GlossLink term="fair-price">Pony</GlossLink> <span className="font-bold text-fg-1">{fmtFair(r.outcome.fair) ?? DASH}</span>
                                        </span>
                                    ) : null}
                                    <span className="text-micro text-fg-2">
                                        {fmtModelPct(r.outcome.pct) ?? '—'}
                                        <span className="sr-only">%</span>
                                        <span aria-hidden="true">%</span>
                                    </span>
                                    {r.key !== 'total-push' ? <Ev o={r.outcome} gated={r.gated} /> : null}
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
