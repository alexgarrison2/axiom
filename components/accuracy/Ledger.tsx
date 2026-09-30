'use client';

import * as React from 'react';
import { KpiTile } from '@/components/ui/kpi-tile';
import { InfoTip } from '@/components/ui/info-tip';
import { Input } from '@/components/ui/input';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { TeamLogo } from '@/components/views/TeamLogo';
import { plural, shortDate } from '@/components/views/format';
import { cn } from '@/lib/utils';
import { UnitsChart } from './charts';
import { cumulativeUnits, fmtAmerican, gradePending, parseLedgerBets, teamFirstScore, tidyReason } from './ledger-data';
import { teamTriFromName } from './names';
import type { GateInfo } from './report';
import type { BetFinal, LedgerBet, LedgerBucket, LedgerData, LedgerSummary } from './types';

const PAGE = 25;

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
}: {
    ledger: LedgerData;
    gate: GateInfo | null;
    season: string;
    seasons: string[];
    /** Finals for bets the ledger file still lists as pending. */
    finals?: Record<number, BetFinal>;
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

    return (
        <div ref={ref} className="flex flex-col gap-5">
            <div
                role="status"
                className={cn('flex flex-col gap-2 rounded-card border p-4 md:p-5', gateOpen ? 'border-pos/40 bg-pos/5' : 'border-warn/50 bg-warn/5')}
            >
                <p className="flex items-center gap-2 text-title font-bold text-fg-1">
                    <span aria-hidden="true" className={gateOpen ? 'text-pos' : 'text-warn'}>
                        {gateOpen ? '●' : '⏸'}
                    </span>
                    {gateOpen ? 'Bet gate open: suggested stakes are shown' : 'Bet gate closed: no stakes are suggested'}
                    <InfoTip term="units" />
                </p>
                {gate?.summary ? <p className="text-body-sm text-fg-2">{tidyReason(gate.summary)}</p> : null}
                {reasons.length ? (
                    <ul className="list-disc pl-5 text-body-sm text-fg-2">
                        {reasons.map(r => (
                            <li key={r}>{r}</li>
                        ))}
                    </ul>
                ) : null}
                <p className="text-caption text-fg-3">
                    The ledger below grades every stake the site ever suggested, including the ones made before the gate existed.
                </p>
            </div>

            {!summary ? (
                <p className="hud-panel border-dashed p-5 text-body-sm text-fg-2">
                    No bets graded {season === 'all' ? 'yet' : `in ${season}`}.{' '}
                    {gateOpen ? '' : 'While the gate is closed the site suggests no stakes, so this stays empty.'}
                </p>
            ) : (
                <>
                    {summary.nGraded === 0 ? (
                        <p className="hud-panel border-dashed p-5 text-body-sm text-fg-2">
                            No bets graded {season === 'all' ? 'yet' : `in ${season} yet`}
                            {summary.nPending ? ` (${plural(summary.nPending, 'bet')} waiting on a result)` : ''}.
                        </p>
                    ) : (
                        <>
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                <KpiTile
                                    label="Record"
                                    value={summary.record}
                                    sub={`${plural(summary.nGraded, 'graded bet')}${summary.nPending ? ` · ${summary.nPending} pending` : ''}`}
                                />
                                <KpiTile
                                    label="Profit"
                                    value={
                                        <span className={summary.unitsProfit > 0 ? 'text-pos' : summary.unitsProfit < 0 ? 'text-neg' : 'text-fg-1'}>
                                            {units(summary.unitsProfit)}
                                        </span>
                                    }
                                    sub={gateOpen ? `on ${summary.unitsStaked.toFixed(1)}u staked` : 'on past suggested stakes (sizes hidden while the gate is closed)'}
                                />
                                <KpiTile
                                    label="ROI"
                                    value={pctSigned(summary.roi)}
                                    sub={
                                        summary.roiCi ? `95% CI ${pctSigned(summary.roiCi[0])} to ${pctSigned(summary.roiCi[1])}` : 'Interval shown per season'
                                    }
                                />
                                <KpiTile
                                    label="Avg closing-line value"
                                    value={summary.clvMean != null ? pctSigned(summary.clvMean) : '—'}
                                    empty={summary.clvMean == null}
                                    sub={summary.clvN ? `${plural(summary.clvN, 'bet')} with a closing price` : (ledger.clvNote ?? 'No closing prices recorded')}
                                />
                            </div>

                            <section aria-label="Cumulative units" className="hud-panel flex flex-col gap-3 p-4 md:p-5">
                                <h3 className="text-title font-bold text-fg-1">Cumulative units</h3>
                                {bets ? (
                                    curve.length > 1 ? (
                                        <UnitsChart points={curve} />
                                    ) : (
                                        <p className="text-body-sm text-fg-3">Not enough bets to chart.</p>
                                    )
                                ) : (
                                    <div aria-busy="true" className="h-48 rounded-control bg-surface-2/40" />
                                )}
                            </section>

                            {summary.byEv.some(b => b.n > 0) || summary.byStake.some(b => b.n > 0) ? (
                                <div className="grid gap-4 lg:grid-cols-2">
                                    <BucketTable title="By edge at bet time" buckets={summary.byEv} />
                                    <BucketTable title="By stake size" buckets={summary.byStake} />
                                </div>
                            ) : null}
                        </>
                    )}

                    <section aria-labelledby="bets-title" className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-end justify-between gap-3">
                            <h3 id="bets-title" className="text-title font-bold text-fg-1">
                                Every bet
                            </h3>
                            <div className="flex w-full flex-col gap-1 sm:w-64">
                                <label htmlFor={searchId} className="hud-label">
                                    Search team or date
                                </label>
                                <Input
                                    id={searchId}
                                    type="search"
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    placeholder="e.g. Oilers, EDM, 2026-04"
                                />
                            </div>
                        </div>
                        {!bets ? (
                            <div aria-busy="true" className="h-40 rounded-card border border-line bg-surface-1/60" />
                        ) : (
                            <>
                                <ScrollRegion label="Bet ledger table" className="rounded-card border border-line">
                                    <table className="w-full min-w-[640px] text-left text-body-sm">
                                        <caption className="sr-only">Every graded bet, newest first</caption>
                                        <thead className="bg-surface-2 text-micro uppercase tracking-[0.06em] text-fg-2">
                                            <tr>
                                                <th scope="col" className="px-3 py-2 font-semibold">
                                                    Date
                                                </th>
                                                <th scope="col" className="px-3 py-2 font-semibold">
                                                    Bet
                                                </th>
                                                <th scope="col" className="px-3 py-2 text-right font-semibold">
                                                    Price
                                                </th>
                                                <th scope="col" className="px-3 py-2 text-right font-semibold">
                                                    Edge
                                                </th>
                                                <th scope="col" className="px-3 py-2 text-right font-semibold">
                                                    Stake
                                                </th>
                                                <th scope="col" className="px-3 py-2 font-semibold">
                                                    Result
                                                </th>
                                                <th scope="col" className="px-3 py-2 text-right font-semibold">
                                                    Units
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-line tabular-nums">
                                            {filtered.slice(0, shown).map(b => {
                                                const tri = teamTriFromName(b.team) ?? b.team;
                                                const opp = teamTriFromName(b.opponent) ?? b.opponent;
                                                return (
                                                    <tr key={`${b.gameId}-${b.team}`}>
                                                        <td className="whitespace-nowrap px-3 py-2 text-fg-3">{shortDate(b.date)}</td>
                                                        <td className="px-3 py-2">
                                                            <span className="flex items-center gap-1.5 font-semibold text-fg-1">
                                                                <TeamLogo tri={tri} size={18} />
                                                                {tri}
                                                                <span className="font-normal text-fg-3">
                                                                    {b.side === 'home' ? 'vs' : '@'} {opp}
                                                                </span>
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2 text-right text-fg-2">{fmtAmerican(b.price)}</td>
                                                        <td className="px-3 py-2 text-right text-fg-2">{b.evAtBet != null ? pctSigned(b.evAtBet, 0) : '—'}</td>
                                                        <td className="px-3 py-2 text-right text-fg-2">
                                                            {gateOpen ? `${b.stake.toFixed(1)}u` : <span aria-label="hidden while the gate is closed">—</span>}
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <span
                                                                className={cn(
                                                                    'inline-flex items-center gap-1 font-semibold',
                                                                    b.result === 'win' ? 'text-pos' : b.result === 'loss' ? 'text-neg' : 'text-fg-2',
                                                                )}
                                                            >
                                                                <span aria-hidden="true">{b.result === 'win' ? '✓' : b.result === 'loss' ? '✗' : '·'}</span>
                                                                {b.result === 'win' ? 'Won' : b.result === 'loss' ? 'Lost' : b.result}
                                                            </span>
                                                            {b.final ? (
                                                                <span className="ml-1.5 text-caption text-fg-3">
                                                                    {teamFirstScore(b.final, b.side)}
                                                                    {b.decision && b.decision !== 'REG' ? ` ${b.decision}` : ''}
                                                                </span>
                                                            ) : null}
                                                        </td>
                                                        <td
                                                            className={cn(
                                                                'px-3 py-2 text-right font-semibold',
                                                                b.profit > 0 ? 'text-pos' : b.profit < 0 ? 'text-neg' : 'text-fg-2',
                                                            )}
                                                        >
                                                            {units(b.profit)}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </ScrollRegion>
                                <p className="text-caption text-fg-3">
                                    Showing {Math.min(shown, filtered.length)} of {plural(filtered.length, 'bet')}.
                                </p>
                                {filtered.length > shown ? (
                                    <button
                                        type="button"
                                        onClick={() => setShown(s => s + PAGE)}
                                        className="self-center rounded-control border border-line-strong px-5 py-2 text-body-sm font-semibold text-fg-1 transition-colors hover:bg-surface-2 coarse:min-h-11"
                                    >
                                        Show more
                                    </button>
                                ) : null}
                            </>
                        )}
                    </section>
                </>
            )}

            <p className="max-w-3xl text-caption text-fg-3">
                {ledger.disclaimer ?? 'For information and entertainment only. Past results do not predict future results.'}{' '}
                {ledger.unit ? `${ledger.unit}.` : ''} {ledger.source ? `Source: ${ledger.source}.` : ''} If you bet, bet responsibly (21+, 1-800-GAMBLER).
            </p>
        </div>
    );
}

function BucketTable({ title, buckets }: { title: string; buckets: LedgerBucket[] }) {
    const rows = buckets.filter(b => b.n > 0);
    return (
        <section aria-label={title} className="hud-panel flex flex-col gap-3 p-4">
            <h3 className="text-title font-bold text-fg-1">{title}</h3>
            <table className="w-full text-left text-body-sm">
                <caption className="sr-only">{title}</caption>
                <thead className="text-micro uppercase tracking-[0.06em] text-fg-2">
                    <tr>
                        <th scope="col" className="py-1.5 pr-2 font-semibold">
                            Bucket
                        </th>
                        <th scope="col" className="px-2 py-1.5 text-right font-semibold">
                            Bets
                        </th>
                        <th scope="col" className="px-2 py-1.5 text-right font-semibold">
                            W-L
                        </th>
                        <th scope="col" className="px-2 py-1.5 text-right font-semibold">
                            Units
                        </th>
                        <th scope="col" className="py-1.5 pl-2 text-right font-semibold">
                            ROI
                        </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums">
                    {rows.map(b => (
                        <tr key={b.bucket}>
                            <th scope="row" className="py-1.5 pr-2 font-semibold text-fg-1">
                                {b.bucket}
                            </th>
                            <td className="px-2 py-1.5 text-right text-fg-2">{b.n}</td>
                            <td className="px-2 py-1.5 text-right text-fg-2">{b.record}</td>
                            <td
                                className={cn(
                                    'px-2 py-1.5 text-right font-semibold',
                                    b.unitsProfit > 0 ? 'text-pos' : b.unitsProfit < 0 ? 'text-neg' : 'text-fg-2',
                                )}
                            >
                                {units(b.unitsProfit)}
                            </td>
                            <td className="py-1.5 pl-2 text-right text-fg-1">{pctSigned(b.roi)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </section>
    );
}
