'use client';

import * as React from 'react';
import { KpiTile } from '@/components/ui/kpi-tile';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { Crest } from '@/components/ui/crest';
import { shortDate } from '@/components/views/format';
import { cn } from '@/lib/utils';
import { UnitsChart } from './charts';
import { cumulativeUnits, fmtAmerican, gradePending, parseLedgerBets, teamFirstScore, tidyReason } from './ledger-data';
import { teamTriFromName } from './names';
import type { GateInfo } from './report';
import type { BetFinal, LedgerBet, LedgerBucket, LedgerData, LedgerSummary } from './types';

const PAGE = 25;
/** Below this many graded bets ROI, its CI and the bucket tables are noise: record and units only. */
export const LEDGER_ROI_MIN = 20;
/** Below this many graded bets results stay uncoloured (the report card's rule). */
export const LEDGER_COLOR_MIN = 100;

let betsPromise: Promise<LedgerBet[]> | null = null;
function loadBets(): Promise<LedgerBet[]> {
    if (!betsPromise) {
        betsPromise = fetch('/data/bet_ledger.json')
            .then(r => (r.ok ? r.json() : null))
            .then(parseLedgerBets)
            .catch(() => {
                betsPromise = null;
                return [];
            });
    }
    return betsPromise;
}

const units = (v: number, digits = 2) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}u`;
const pctSigned = (v: number | null | undefined, digits = 1) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v * 100).toFixed(digits)}%`);

function mergeBuckets(lists: LedgerBucket[][]): LedgerBucket[] {
    const map = new Map<string, LedgerBucket>();
    for (const b of lists.flat()) {
        const c = map.get(b.bucket);
        if (!c) {
            map.set(b.bucket, { ...b });
            continue;
        }
        const [w1, l1] = c.record.split('-').map(Number);
        const [w2, l2] = b.record.split('-').map(Number);
        c.n += b.n;
        c.record = `${w1 + w2}-${l1 + l2}`;
        c.unitsStaked = (c.unitsStaked ?? 0) + (b.unitsStaked ?? 0);
        c.unitsProfit += b.unitsProfit;
        c.roi = c.unitsStaked ? c.unitsProfit / c.unitsStaked : null;
    }
    return [...map.values()];
}

function combine(list: LedgerSummary[]): LedgerSummary | null {
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    const wins = list.reduce((a, s) => a + Number(s.record.split('-')[0] || 0), 0);
    const losses = list.reduce((a, s) => a + Number(s.record.split('-')[1] || 0), 0);
    const staked = list.reduce((a, s) => a + s.unitsStaked, 0);
    const profit = list.reduce((a, s) => a + s.unitsProfit, 0);
    const clvN = list.reduce((a, s) => a + s.clvN, 0);
    return {
        nBets: list.reduce((a, s) => a + s.nBets, 0),
        nGraded: list.reduce((a, s) => a + s.nGraded, 0),
        nPending: list.reduce((a, s) => a + s.nPending, 0),
        record: `${wins}-${losses}`,
        unitsStaked: staked,
        unitsProfit: profit,
        roi: staked ? profit / staked : null,
        roiCi: null,
        clvMean: clvN ? list.reduce((a, s) => a + (s.clvMean ?? 0) * s.clvN, 0) / clvN : null,
        clvN,
        byEv: mergeBuckets(list.map(s => s.byEv)),
        byStake: mergeBuckets(list.map(s => s.byStake)),
    };
}

export function Ledger({
    ledger,
    gate,
    season,
    seasons,
    finals = {},
    title,
    currentSeason,
}: {
    ledger: LedgerData;
    gate: GateInfo | null;
    season: string;
    seasons: string[];
    /** Bets from this season on with no model version get a LEGACY tag. */
    currentSeason?: string;
    /** Finals for bets the ledger file still lists as pending. */
    finals?: Record<number, BetFinal>;
    /** Section heading, rendered on the gate status row. */
    title?: React.ReactNode;
}) {
    const labels = React.useMemo(() => (season === 'all' ? seasons : [season]), [season, seasons]);
    const summary = combine(labels.map(l => ledger.seasons[l]).filter((s): s is LedgerSummary => !!s));
    const [bets, setBets] = React.useState<LedgerBet[] | null>(null);
    const [query, setQuery] = React.useState('');
    const [shown, setShown] = React.useState(PAGE);
    const ref = React.useRef<HTMLDivElement>(null);
    const searchId = React.useId();

    // The full bet list (~170KB) loads only when the ledger scrolls into view.
    React.useEffect(() => {
        const el = ref.current;
        if (!el || bets) return;
        const go = () => loadBets().then(setBets);
        if (window.location.hash === '#ledger' || typeof IntersectionObserver === 'undefined') {
            go();
            return;
        }
        const io = new IntersectionObserver(
            entries => {
                if (entries.some(e => e.isIntersecting)) {
                    io.disconnect();
                    go();
                }
            },
            { rootMargin: '600px' },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [bets]);

    React.useEffect(() => setShown(PAGE), [season, query]);

    const inSeason = React.useMemo(() => (bets ?? []).filter(b => labels.includes(b.season)).map(b => gradePending(b, finals[b.gameId])), [bets, labels, finals]);
    const curve = React.useMemo(() => cumulativeUnits(inSeason), [inSeason]);
    const filtered = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = [...inSeason].reverse();
        if (!q) return list;
        return list.filter(b =>
            `${b.team} ${b.opponent} ${teamTriFromName(b.team) ?? ''} ${teamTriFromName(b.opponent) ?? ''} ${b.date}`.toLowerCase().includes(q),
        );
    }, [inSeason, query]);

    const gateOpen = gate?.open ?? ledger.gate?.open ?? false;
    const reasons = (gate?.reasons?.length ? gate.reasons : (ledger.gate?.reasons ?? [])).map(tidyReason);
    const gateWhy = [gate?.summary ? tidyReason(gate.summary) : null, ...reasons].filter(Boolean).join(' · ');
    const nGraded = summary?.nGraded ?? 0;
    const showRoi = nGraded >= LEDGER_ROI_MIN;
    const tone = (v: number) => (nGraded < LEDGER_COLOR_MIN ? 'text-fg-1' : v > 0 ? 'text-pos' : v < 0 ? 'text-neg' : 'text-fg-1');

    return (
        <div ref={ref} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {title}
                <p role="status" className={cn('label inline-flex items-center gap-2', gateOpen ? 'text-pos' : 'text-warn')}>
                    <span aria-hidden="true" className={cn('inline-block h-1.5 w-1.5 rounded-full', gateOpen ? 'bg-pos' : 'bg-warn')} />
                    <abbr title={gateWhy || undefined} className="no-underline">
                        {gateOpen ? 'Gate open' : 'Gate closed'}
                    </abbr>
                </p>
                <Link href="/methodology#edge" className="label text-brand hover:underline">
                    Why<span className="sr-only"> the bet gate is {gateOpen ? 'open' : 'closed'}</span> →
                </Link>
            </div>

            {!summary || summary.nGraded === 0 ? (
                <p className="panel label border-dashed px-3 py-3">
                    0 graded{season === 'all' ? '' : ` · ${season}`}
                    {summary?.nPending ? ` · ${summary.nPending} pending` : ''}
                </p>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                        <KpiTile label="Record" value={summary.record} sub={`n=${summary.nGraded}${summary.nPending ? ` · ${summary.nPending} pending` : ''}`} />
                        <KpiTile
                            label="Profit"
                            value={<span className={tone(summary.unitsProfit)}>{units(summary.unitsProfit)}</span>}
                            sub={`${summary.unitsStaked.toFixed(1)}u staked`}
                        />
                        <KpiTile
                            label="ROI"
                            value={showRoi ? pctSigned(summary.roi) : '—'}
                            empty={!showRoi}
                            sub={showRoi && summary.roiCi ? `CI ${pctSigned(summary.roiCi[0])} / ${pctSigned(summary.roiCi[1])}` : undefined}
                        />
                        <KpiTile
                            label="CLV"
                            value={summary.clvMean != null ? pctSigned(summary.clvMean) : '—'}
                            empty={summary.clvMean == null}
                            sub={summary.clvN ? `n=${summary.clvN}` : 'no closing prices'}
                        />
                    </div>

                    <div className={cn('grid items-start gap-3', (!bets || curve.length > 1) && 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')}>
                        {!bets || curve.length > 1 ? (
                            <section aria-label="Cumulative units" className="panel flex min-w-0 flex-col gap-2 px-3 py-2.5 md:px-4 md:py-3">
                                <h3 className="heading-sub">Units</h3>
                                {bets ? <UnitsChart points={curve} /> : <div aria-busy="true" className="h-44 rounded-control bg-surface-2/40" />}
                            </section>
                        ) : null}
                        {showRoi && (summary.byEv.some(b => b.n > 0) || summary.byStake.some(b => b.n > 0)) ? (
                            <div className={cn('grid min-w-0 gap-3', bets && curve.length < 2 && 'lg:grid-cols-2')}>
                                <BucketTable title="By edge" buckets={summary.byEv} tone={tone} />
                                <BucketTable title="By stake" buckets={summary.byStake} tone={tone} />
                            </div>
                        ) : null}
                    </div>
                </>
            )}

            {summary ? (
                <section aria-labelledby="bets-title" className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 id="bets-title" className="heading-sub">
                            Bets
                        </h3>
                        <div className="w-full sm:w-56">
                            <label htmlFor={searchId} className="sr-only">
                                Search team or date
                            </label>
                            <Input id={searchId} type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Team / date" className="h-8 coarse:h-11" />
                        </div>
                    </div>
                    {!bets ? (
                        <div aria-busy="true" className="h-40 rounded-card border border-line bg-surface-1/60" />
                    ) : (
                        <>
                            <ScrollRegion label="Bet ledger table" className="panel">
                                <table className="table-dense min-w-[600px]">
                                    <caption className="sr-only">Every graded bet, newest first</caption>
                                    <thead>
                                        <tr>
                                            <th scope="col" className="text-left">
                                                Date
                                            </th>
                                            <th scope="col" className="text-left">
                                                Bet
                                            </th>
                                            <th scope="col" className="text-right">
                                                Price
                                            </th>
                                            <th scope="col" className="text-right">
                                                Edge
                                            </th>
                                            <th scope="col" className="text-right">
                                                Stake
                                            </th>
                                            <th scope="col" className="text-left">
                                                Result
                                            </th>
                                            <th scope="col" className="text-right">
                                                Units
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filtered.slice(0, shown).map(b => {
                                            const tri = teamTriFromName(b.team) ?? b.team;
                                            const opp = teamTriFromName(b.opponent) ?? b.opponent;
                                            return (
                                                <tr key={`${b.gameId}-${b.team}`}>
                                                    <td className="text-fg-3">{shortDate(b.date)}</td>
                                                    <td>
                                                        <span className="flex items-center gap-1.5 font-bold text-fg-1">
                                                            <Crest tri={tri} size={16} className="drop-shadow-none" />
                                                            {tri}
                                                            <span className="font-normal text-fg-3">
                                                                {b.side === 'home' ? 'vs' : '@'} {opp}
                                                            </span>
                                                            {b.legacy && currentSeason && b.season >= currentSeason ? (
                                                                <abbr
                                                                    title="Published by the previous site model"
                                                                    className="rounded-chip border border-line-strong px-1 text-micro font-normal text-fg-2 no-underline"
                                                                >
                                                                    LEGACY
                                                                </abbr>
                                                            ) : null}
                                                        </span>
                                                    </td>
                                                    <td className="text-right text-fg-2">{fmtAmerican(b.price)}</td>
                                                    <td className="text-right text-fg-2">{b.evAtBet != null ? pctSigned(b.evAtBet, 0) : '—'}</td>
                                                    <td className="text-right text-fg-2">
                                                        {gateOpen || b.result !== 'pending' ? `${b.stake.toFixed(1)}u` : <span aria-label="hidden while the gate is closed">—</span>}
                                                    </td>
                                                    <td>
                                                        <span className={cn('font-bold', b.result === 'pending' ? 'text-fg-2' : tone(b.result === 'win' ? 1 : b.result === 'loss' ? -1 : 0))}>
                                                            <span aria-hidden="true">{b.result === 'win' ? '✓ ' : b.result === 'loss' ? '✕ ' : ''}</span>
                                                            {b.result === 'win' ? 'W' : b.result === 'loss' ? 'L' : b.result}
                                                        </span>
                                                        {b.final ? (
                                                            <span className="ml-1.5 text-fg-3">
                                                                {teamFirstScore(b.final, b.side)}
                                                                {b.decision && b.decision !== 'REG' ? ` ${b.decision}` : ''}
                                                            </span>
                                                        ) : null}
                                                    </td>
                                                    <td className={cn('text-right font-bold', tone(b.profit))}>{units(b.profit)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </ScrollRegion>
                            <div className="flex items-center justify-between gap-3">
                                <p className="label">
                                    {Math.min(shown, filtered.length)} / {filtered.length}
                                </p>
                                {filtered.length > shown ? (
                                    <button
                                        type="button"
                                        onClick={() => setShown(s => s + PAGE)}
                                        className="rounded-control border border-line-strong px-4 py-1.5 text-micro font-medium uppercase tracking-[0.14em] text-fg-1 transition-colors hover:border-brand hover:text-brand coarse:min-h-11"
                                    >
                                        More
                                    </button>
                                ) : null}
                            </div>
                        </>
                    )}
                </section>
            ) : null}

            <p className="label">
                <abbr title={[ledger.disclaimer, ledger.unit, ledger.source ? `Source: ${ledger.source}` : null].filter(Boolean).join(' · ') || undefined} className="no-underline">
                    Info only
                </abbr>{' '}
                · 21+ · 1-800-GAMBLER
            </p>
        </div>
    );
}

function BucketTable({ title, buckets, tone }: { title: string; buckets: LedgerBucket[]; tone: (v: number) => string }) {
    const rows = buckets.filter(b => b.n > 0);
    return (
        <section aria-label={title} className="panel overflow-hidden">
            <table className="table-dense">
                <caption className="border-b border-line px-3 py-1.5 text-left">
                    <span className="heading-sub">{title}</span>
                </caption>
                <thead>
                    <tr>
                        <th scope="col" className="text-left">
                            <span className="sr-only">Bucket</span>
                        </th>
                        <th scope="col" className="text-right">
                            n
                        </th>
                        <th scope="col" className="text-right">
                            W-L
                        </th>
                        <th scope="col" className="text-right">
                            Units
                        </th>
                        <th scope="col" className="text-right">
                            ROI
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(b => (
                        <tr key={b.bucket}>
                            <th scope="row" className="text-left font-semibold text-fg-1">
                                {b.bucket}
                            </th>
                            <td className="text-right text-fg-2">{b.n}</td>
                            <td className="text-right text-fg-2">{b.record}</td>
                            <td className={cn('text-right font-bold', tone(b.unitsProfit))}>{units(b.unitsProfit)}</td>
                            <td className="text-right text-fg-1">{pctSigned(b.roi)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </section>
    );
}
