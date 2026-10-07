import { Fragment } from 'react';
import type { MarketOutcome, Prediction } from '@/types/prediction';
import { evTone, fmtEv, fmtFair, fmtModelPct, marketRows, type MarketRow, type SidesRow } from '@/lib/matchup/markets';
import { fmtOdds } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';
import { GlossLink } from '@/components/ui/gloss-link';
import { Crest } from '@/components/ui/crest';

const TONE = { pos: 'text-pos' } as const;
const CHIP = { pos: 'bg-pos/15 text-pos' } as const;
const DASH = <span className="text-fg-3">—</span>;

type Side = 'away' | 'home';

/** Only a positive edge earns a chip; negatives are silence. Derivative edges are info only (data-ev says which). */
function Ev({ o, gated }: { o: MarketOutcome | undefined; gated: boolean }) {
    const t = fmtEv(o?.ev);
    if (t == null || evTone(o?.ev) !== 'pos') return null;
    return (
        <span className={cn('rounded-chip px-1.5 py-px text-caption font-bold tabular-nums', TONE.pos, CHIP.pos)} data-ev={gated ? 'info-only' : 'ml'}>
            {t}
        </span>
    );
}

/**
 * Shared column template: outcome | book | Pony | win % | edge. Header and every row use it so the columns line up.
 * In a phone-width card the edge column and the touch gaps give a little back so the market labels keep their words whole.
 */
const GRID =
    'grid grid-cols-[minmax(4.25rem,7rem)_2.5rem_2.5rem_2.5rem_3.25rem] items-center gap-x-1.5 [@container(max-width:20.99rem)]:grid-cols-[minmax(3.75rem,7rem)_2.5rem_2.5rem_2.5rem_3.25rem] [@container(min-width:26rem)]:grid-cols-[minmax(4.25rem,7rem)_2.5rem_2.5rem_2.5rem_3.5rem] [@container(min-width:26rem)]:coarse:gap-x-2';

/** One outcome as one line: who, the book price, Pony's price, Pony's win %, and the edge when it is positive. */
function Outcome({ o, tag, gated, tri }: { o: MarketOutcome | undefined; tag: string; gated: boolean; tri?: string }) {
    const fair = fmtFair(o?.fair);
    const pct = fmtModelPct(o?.pct);
    return (
        <div className={cn(GRID, 'min-h-9 tabular-nums')}>
            <span className="flex min-w-0 items-center gap-1.5 text-micro font-bold uppercase tracking-wide text-fg-2">
                {tri ? <Crest tri={tri} size={28} className="drop-shadow-none" /> : null}
                {tri && tag.startsWith(`${tri} `) ? (
                    <>
                        <span className="sr-only">{tri} </span>
                        <span className="truncate">{tag.slice(tri.length + 1)}</span>
                    </>
                ) : (
                    <span className="truncate">{tag}</span>
                )}
            </span>
            <span className="text-right font-display text-body font-bold text-fg-1">{fmtOdds(o?.price) ?? DASH}</span>
            <span className="text-right text-caption text-fg-2">{fair ?? DASH}</span>
            <span className="text-right text-caption text-fg-3">
                {pct ?? DASH}
                <span className="sr-only">%</span>
                <span aria-hidden="true">%</span>
            </span>
            <span className="flex justify-end">
                <Ev o={o} gated={gated} />
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
    // Words wrap, never inside a word: "3-way" stays whole in a narrow column.
    // The total ("O 6.5 U") reads as one unit and stays on one line.
    const words = row.key === 'total' ? [row.label] : row.label.split(' ');
    const text = (
        <span>
            {words.map((w, i) => (
                <Fragment key={i}>
                    {i ? ' ' : null}
                    <span className="whitespace-nowrap">{w}</span>
                </Fragment>
            ))}
        </span>
    );
    return row.term ? <GlossLink term={row.term}>{text}</GlossLink> : <span className="inline-flex min-h-6 items-center">{text}</span>;
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
        <>
            {m?.status === 'poisson_fallback' ? (
                <GlossLink term="simulator" desc="Estimated by the goal model: the simulator's lineup inputs were unavailable for this game." className="self-start text-micro uppercase tracking-label text-amber">
                    Est
                </GlossLink>
            ) : null}
            {/* A card under ~336px has no room for the label column: each market's label sits on its own line above its prices. */}
            <table className="w-full max-w-[32rem] [@container(max-width:20.99rem)]:block" data-markets>
                <caption className="sr-only">
                    {a} at {h}: every market, book price, Pony price, model % and edge
                </caption>
                <thead className="[@container(max-width:20.99rem)]:block">
                    <tr className="[@container(max-width:20.99rem)]:block">
                        <th scope="col" className="w-12 coarse:w-14 [@container(max-width:20.99rem)]:block [@container(max-width:20.99rem)]:w-auto">
                            <span className="sr-only">Market</span>
                        </th>
                        <th scope="col" className="pb-1 font-medium [@container(max-width:20.99rem)]:block">
                            <div className={cn(GRID, 'text-micro uppercase tracking-label text-fg-3')}>
                                <span className="sr-only">Outcome</span>
                                <span />
                                <span className="text-right">Book</span>
                                <span className="text-right">
                                    <GlossLink term="fair-price">Pony</GlossLink>
                                </span>
                                <span className="text-right">Win</span>
                                <span className="text-right">Edge</span>
                            </div>
                        </th>
                    </tr>
                </thead>
                <tbody className="[@container(max-width:20.99rem)]:block">
                    {rows.map(r => (
                        <tr key={r.key} data-market={r.key} data-gated={r.gated || undefined} className="border-t border-line align-top [@container(max-width:20.99rem)]:block">
                            <th
                                scope="row"
                                className={cn(
                                    'w-12 whitespace-normal py-2 pr-2 text-left align-top text-micro font-medium uppercase tracking-wide text-fg-3 coarse:w-14 [@container(max-width:20.99rem)]:block [@container(max-width:20.99rem)]:w-auto [@container(max-width:20.99rem)]:pb-0',
                                    r.kind === 'sides' ? null : '[@container(max-width:20.99rem)]:p-0',
                                )}
                            >
                                {r.kind === 'sides' ? <Label row={r} /> : <span className="sr-only">{r.label}</span>}
                            </th>
                            <td className="py-1 [@container(max-width:20.99rem)]:block">
                                {r.kind === 'sides' ? (
                                    <>
                                        <Outcome o={r.away} tag={sideTag(r, 'away', a)} gated={r.gated} tri={r.key === 'total' ? undefined : a} />
                                        <Outcome o={r.home} tag={sideTag(r, 'home', h)} gated={r.gated} tri={r.key === 'total' ? undefined : h} />
                                    </>
                                ) : (
                                    <Outcome o={r.outcome} tag={r.label} gated={r.gated} />
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </>
    );
}

export default MarketsTable;
