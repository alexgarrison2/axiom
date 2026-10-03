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

/** Shared column template: outcome | book | Pony | win % | edge. Header and every row use it so the columns line up. */
const GRID = 'grid grid-cols-[minmax(4.25rem,7rem)_2.5rem_2.5rem_2.5rem_3.5rem] items-center gap-x-1.5 coarse:gap-x-2';

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
        <>
            {m?.status === 'poisson_fallback' ? (
                <GlossLink term="simulator" desc="Estimated by the goal model: the simulator's lineup inputs were unavailable for this game." className="self-start text-micro uppercase tracking-label text-amber">
                    Est
                </GlossLink>
            ) : null}
            <table className="w-full max-w-[32rem]" data-markets>
                <caption className="sr-only">
                    {a} at {h}: every market, book price, Pony price, model % and edge
                </caption>
                <thead>
                    <tr>
                        <th scope="col" className="w-12 coarse:w-14">
                            <span className="sr-only">Market</span>
                        </th>
                        <th scope="col" className="pb-1 font-medium">
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
                <tbody>
                    {rows.map(r => (
                        <tr key={r.key} data-market={r.key} data-gated={r.gated || undefined} className="border-t border-line align-top">
                            <th scope="row" className="w-12 whitespace-normal break-words py-2 pr-2 text-left align-top text-micro font-medium uppercase tracking-wide text-fg-3 coarse:w-14">
                                {r.kind === 'sides' ? <Label row={r} /> : <span className="sr-only">{r.label}</span>}
                            </th>
                            <td className="py-1">
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
