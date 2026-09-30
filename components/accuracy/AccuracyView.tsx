'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { PageHeading } from '@/components/ui/page-heading';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { Crest } from '@/components/ui/crest';
import { GlossLink } from '@/components/ui/gloss-link';
import { shortDate } from '@/components/views/format';
import { cn } from '@/lib/utils';
import { teamTriFromName } from './names';
import { combineBlocks, reportLags, type AccuracyReport, type CallRow, type GameTypeKey, type ReportBlock } from './report';
import { ReliabilityChart, RollingChart, TierBars } from './charts';
import { GameList } from './GameList';
import { Ledger } from './Ledger';
import { blockVerdict, CI_MIN_N, compareLogLoss, deltaText, modelLabelOf, SIGNAL_N, type Verdict, type VerdictWord } from './verdict';
import type { BetFinal, LedgerData, SeasonTally } from './types';

export interface AccuracyViewProps {
    report: AccuracyReport;
    ledger: LedgerData;
    /** Season labels with data, newest first, e.g. ["2026-27", "2025-26"]. */
    seasons: string[];
    currentSeason: string;
    /** Record straight from the graded list, per season and game type (reconciles a stale report). */
    tallies?: Record<string, Partial<Record<GameTypeKey, SeasonTally>>>;
    /** Finals for ledger bets still listed as pending. */
    finals?: Record<number, BetFinal>;
}

const TYPE_OPTIONS: { value: GameTypeKey; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'regular', label: 'Regular' },
    { value: 'playoffs', label: 'Playoffs' },
];

const pct1 = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const dec3 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(3));
const dec4 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(4));
/** Calibration and confidence tiers need at least this many games to show anything but noise. */
const CHART_N = 30;

export function AccuracyView({ report, ledger, seasons, currentSeason, tallies = {}, finals = {} }: AccuracyViewProps) {
    const [season, setSeason] = React.useState<string>(currentSeason);
    const [type, setType] = React.useState<GameTypeKey>('all');

    // Honour /accuracy?season=2025-26 and #ledger deep links.
    React.useEffect(() => {
        try {
            const q = new URLSearchParams(window.location.search).get('season');
            if (q && (q === 'all' || seasons.includes(q))) setSeason(q);
        } catch {
            /* ignore */
        }
    }, [seasons]);

    const selectSeason = (s: string) => {
        setSeason(s);
        try {
            const url = new URL(window.location.href);
            if (s === currentSeason) url.searchParams.delete('season');
            else url.searchParams.set('season', s);
            window.history.replaceState(null, '', url);
        } catch {
            /* ignore */
        }
    };

    const block: ReportBlock | null = React.useMemo(() => {
        if (season === 'all') return combineBlocks(seasons.map(s => report.seasons[s]?.[type]).filter((b): b is ReportBlock => !!b && b.n > 0));
        return report.seasons[season]?.[type] ?? null;
    }, [report, season, seasons, type]);

    const seasonOptions = [...seasons.map(s => ({ value: s, label: s })), { value: 'all', label: 'All' }];
    const tally = season !== 'all' ? tallies[season]?.[type] : undefined;
    // The report file can lag the graded list by a refresh; never let it say "no games" over graded rows.
    const stale = reportLags(block?.n, tally);
    const empty = !stale && (!block || block.n === 0);
    const priorSeason = seasons.find(s => s !== currentSeason && (report.seasons[s]?.all?.n ?? 0) > 0);
    const seasonWord = season === 'all' ? 'all seasons' : season;

    const controls = (mobile: boolean) => (
        <>
            <Segmented label="Season" size="sm" block={mobile} options={seasonOptions} value={season} onChange={selectSeason} />
            <Segmented label="Game type" size="sm" block={mobile} options={TYPE_OPTIONS} value={type} onChange={setType} />
        </>
    );

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
                <PageHeading title="Accuracy" actions={<div className="hidden flex-wrap items-center gap-2 sm:flex">{controls(false)}</div>} />
                <div className="flex flex-col gap-2 sm:hidden">{controls(true)}</div>
            </div>

            <section aria-labelledby="report-card" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h2 id="report-card" className="heading-section">
                        Report card
                    </h2>
                    {!empty && !stale && block ? (
                        <p className="label">
                            Live picks · {shortDate(block.firstDate)}
                            {block.lastDate && block.lastDate !== block.firstDate ? `–${shortDate(block.lastDate)}` : ''}
                            {block.nRetro ? (
                                <>
                                    {' · '}
                                    <GlossLink term="back-filled" desc="Regenerated after the game, never counted in the report card">
                                        {block.nRetro.toLocaleString('en-US')} back-filled out
                                    </GlossLink>
                                </>
                            ) : null}
                        </p>
                    ) : null}
                </div>

                {stale && tally ? (
                    <ThroughSummary tally={tally} />
                ) : empty ? (
                    <EmptyState season={season} currentSeason={currentSeason} type={type} prior={priorSeason} onPrior={() => priorSeason && selectSeason(priorSeason)} />
                ) : (
                    <ReportCard block={block!} seasonWord={seasonWord} modelLabel={season === 'all' ? 'Site model' : season < currentSeason ? 'Prev. model' : 'Pony xG'} />
                )}
            </section>

            <section aria-labelledby="every-pick" className="flex flex-col gap-3">
                <h2 id="every-pick" className="heading-section">
                    Picks
                </h2>
                <GameList
                    season={season}
                    seasons={seasons}
                    type={type}
                    currentSeason={currentSeason}
                    expected={Math.max(block?.nPicks ?? 0, tally?.picks ?? 0)}
                    expectedNoLean={Math.max(block?.nNoLean ?? 0, tally ? tally.n - tally.picks : 0)}
                    excluded={season === 'all' ? [] : (tallies[season]?.[type]?.excluded ?? [])}
                />
            </section>

            <section id="ledger" aria-labelledby="ledger-title" className="flex scroll-mt-[calc(var(--appbar-h)+12px)] flex-col gap-3">
                <Ledger
                    ledger={ledger}
                    gate={report.gate}
                    season={season}
                    seasons={seasons}
                    currentSeason={currentSeason}
                    finals={finals}
                    title={
                        <h2 id="ledger-title" className="heading-section">
                            Bet ledger
                        </h2>
                    }
                />
            </section>
        </div>
    );
}

function EmptyState({ season, currentSeason, type, prior, onPrior }: { season: string; currentSeason: string; type: GameTypeKey; prior?: string; onPrior: () => void }) {
    const isCurrent = season === currentSeason;
    return (
        <div role="status" className="panel flex flex-wrap items-center gap-3 border-dashed px-card py-3">
            <p className="label text-fg-2">
                0 graded{type === 'playoffs' ? ' playoff' : type === 'regular' ? ' regular-season' : ''} games{season === 'all' ? '' : ` · ${season}`}
            </p>
            {isCurrent && prior ? (
                <button
                    type="button"
                    onClick={onPrior}
                    className="ml-auto inline-flex min-h-8 items-center rounded-control border border-brand/50 px-3 text-micro font-medium uppercase tracking-[0.14em] text-brand transition-colors hover:bg-brand/10 coarse:min-h-11"
                >
                    {prior} →
                </button>
            ) : null}
        </div>
    );
}

/** The report file lags the graded list: show the running record from the graded rows. */
function ThroughSummary({ tally: t }: { tally: SeasonTally }) {
    const record = `${t.correct}-${t.picks - t.correct}`;
    const verdict: Verdict =
        t.n >= SIGNAL_N && t.marketN >= SIGNAL_N && t.modelLogLossSame != null && t.marketLogLoss != null
            ? { tooEarly: false, vsMarket: { word: compareLogLoss(t.modelLogLossSame, t.marketLogLoss), model: t.modelLogLossSame, other: t.marketLogLoss, n: t.marketN }, vsHome: null }
            : { tooEarly: true, vsMarket: null, vsHome: null };
    return (
        <div role="status" className="flex flex-col gap-2">
            <VerdictRow verdict={verdict} />
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <BigNum label="Picks right" value={pct1(t.picks ? t.correct / t.picks : null)} sub={record} />
                <BigNum
                    label="Log loss"
                    term="log-loss"
                    value={dec4(t.logLoss)}
                    delta={
                        t.marketN && t.modelLogLossSame != null && t.marketLogLoss != null
                            ? { value: t.modelLogLossSame - t.marketLogLoss, better: 'lower', digits: 4, n: t.marketN }
                            : null
                    }
                    sub={t.marketN ? `MKT ${dec4(t.marketLogLoss)}` : 'no mkt prices'}
                />
                <BigNum label="Brier" term="brier" value={dec4(t.brier)} sub="COIN 0.2500" />
                <BigNum
                    label="Graded"
                    value={t.n.toLocaleString('en-US')}
                    sub={[t.marketN ? `${t.marketN} MKT` : null, t.excluded.length ? `${t.excluded.length} no pick` : null].filter(Boolean).join(' · ') || undefined}
                />
            </div>
            {t.legacyN ? <p className="label">{t.legacyN === t.n ? 'All' : t.legacyN} from legacy model · not in bet gate</p> : null}
        </div>
    );
}

interface BigDelta {
    value: number;
    better: 'higher' | 'lower';
    /** Decimals shown; a delta that rounds to 0 reads "same". */
    digits: number;
    /** Display unit: 'pts' multiplies a 0-1 rate by 100. */
    unit?: 'pts';
    /** Games behind the comparison; under SIGNAL_N no delta is shown at all. */
    n: number;
}

/** A report-card number: label, big display value, delta vs the market (from SIGNAL_N games), tiny sub line. */
function BigNum({ label, term, value, delta: raw, sub }: { label: string; term?: string; value: string; delta?: BigDelta | null; sub?: string }) {
    const delta = raw && raw.n >= SIGNAL_N ? raw : null;
    const shown = delta ? deltaText(delta.value, delta.digits, delta.unit ? ` ${delta.unit}` : '', delta.unit ? 100 : 1) : null;
    const same = shown?.same ?? true;
    const good = delta ? (delta.better === 'higher' ? delta.value > 0 : delta.value < 0) : false;
    return (
        <div className="panel flex min-w-0 flex-col gap-1 px-3 py-2.5 md:px-4 md:py-3">
            {term ? (
                <GlossLink term={term} className="label self-start">
                    {label}
                </GlossLink>
            ) : (
                <span className="label">{label}</span>
            )}
            <span className="font-display text-[30px] font-bold leading-none text-fg-1 md:text-[40px]">{value}</span>
            <span className="flex flex-wrap items-baseline gap-x-2 text-micro">
                {delta && shown ? (
                    <span className={cn('font-bold uppercase', same ? 'text-fg-2' : good ? 'text-pos' : 'text-neg')}>
                        {shown.text}
                        <span className="ml-1 font-medium uppercase tracking-[0.12em] text-fg-3">vs mkt</span>
                        <span className="sr-only">{same ? '' : good ? ' (better)' : ' (worse)'}</span>
                    </span>
                ) : null}
                {sub ? <span className="text-fg-3">{sub}</span> : null}
            </span>
        </div>
    );
}

function ReportCard({ block: b, seasonWord, modelLabel: fallbackLabel }: { block: ReportBlock; seasonWord: string; modelLabel: string }) {
    const m = b.market;
    const sameLL = m.modelLogLossSame ?? (m.n === b.n ? b.logLoss : null);
    const sameAcc = m.modelAccuracySame ?? (m.n === b.n ? b.accuracy : null);
    const sameBrier = m.modelBrierSame ?? (m.n === b.n ? b.brier : null);
    const record = `${b.correct}-${b.nPicks - b.correct}`;
    const modelLabel = modelLabelOf(b, fallbackLabel);
    return (
        <div className="flex flex-col gap-3">
            <VerdictRow verdict={blockVerdict(b)} />
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <BigNum
                    label="Picks right"
                    value={pct1(b.accuracy)}
                    delta={sameAcc != null && m.accuracy != null && m.n ? { value: sameAcc - m.accuracy, better: 'higher', digits: 1, unit: 'pts', n: m.n } : null}
                    sub={`${record}${b.accuracyCi && b.n >= CI_MIN_N ? ` · CI ${(b.accuracyCi[0] * 100).toFixed(0)}–${(b.accuracyCi[1] * 100).toFixed(0)}` : ''}`}
                />
                <BigNum
                    label="Log loss"
                    term="log-loss"
                    value={dec4(b.logLoss)}
                    delta={sameLL != null && m.logLoss != null && m.n ? { value: sameLL - m.logLoss, better: 'lower', digits: 4, n: m.n } : null}
                    sub="COIN 0.6931"
                />
                <BigNum
                    label="Brier"
                    term="brier"
                    value={dec4(b.brier)}
                    delta={sameBrier != null && m.brier != null && m.n ? { value: sameBrier - m.brier, better: 'lower', digits: 4, n: m.n } : null}
                    sub="COIN 0.2500"
                />
                <BigNum label="Graded" value={b.n.toLocaleString('en-US')} sub={m.n ? `${m.n.toLocaleString('en-US')} MKT` : 'no mkt prices'} />
            </div>

            <div className="grid items-start gap-3 lg:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-3">
                    <BaselineTable block={b} seasonWord={seasonWord} modelLabel={modelLabel} />
                    {b.n >= CHART_N && b.tiers.length ? (
                        <Panel title="By confidence">
                            <TierBars tiers={b.tiers} />
                        </Panel>
                    ) : null}
                </div>
                {b.n >= CHART_N ? (
                    <div className="flex min-w-0 flex-col gap-3">
                        {b.reliability.some(r => r.n > 0) ? (
                            <Panel title="Calibration">
                                <ReliabilityChart bins={b.reliability} />
                            </Panel>
                        ) : null}
                        {b.rolling.length > 1 ? (
                            <Panel title="Rolling log loss">
                                <RollingChart points={b.rolling} />
                            </Panel>
                        ) : null}
                    </div>
                ) : (
                    <div className="grid min-w-0 content-start gap-3">
                        <Panel title="Best calls">
                            <CallList rows={b.bestCalls} />
                        </Panel>
                        <Panel title="Worst misses">
                            <CallList rows={b.worstMisses} />
                        </Panel>
                    </div>
                )}
            </div>

            {b.n >= CHART_N ? (
                <div className="grid items-start gap-3 lg:grid-cols-2">
                    <Panel title="Best calls">
                        <CallList rows={b.bestCalls} />
                    </Panel>
                    <Panel title="Worst misses">
                        <CallList rows={b.worstMisses} />
                    </Panel>
                </div>
            ) : null}
        </div>
    );
}

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
    return (
        <section aria-label={title} className={cn('panel flex min-w-0 flex-col gap-2 px-3 py-2.5 md:px-4 md:py-3', className)}>
            <h3 className="heading-sub">{title}</h3>
            {children}
        </section>
    );
}

type BaselineRow = { label: string; n: number | null; acc: number | null; brier: number | null; ll: number | null; model?: boolean; note?: string };

function BaselineTable({ block: b, seasonWord, modelLabel }: { block: ReportBlock; seasonWord: string; modelLabel: string | null }) {
    const m = b.market;
    const rows: BaselineRow[] =
        modelLabel == null && b.byModel
            ? // Both models made picks: one row per model.
              [
                  { label: 'Pony xG', ...versionRow(b.byModel.current) },
                  { label: 'Prev. model', ...versionRow(b.byModel.legacy) },
              ]
            : // Acc here is on the baselines' basis (every game, a coin flip as half a pick), not the pick record above.
              [{ label: modelLabel ?? 'Site model', n: b.n, acc: b.accuracyAll ?? b.accuracy, brier: b.brier, ll: b.logLoss, model: true }];
    if (m.n) {
        // The model on the market's games; merged into the row above when they are the same games.
        if (m.n !== b.n || rows.length > 1)
            rows.push({
                label: `${modelLabel ?? 'Site model'} · MKT`,
                n: m.n,
                acc: m.modelAccuracySame ?? null,
                brier: m.modelBrierSame ?? null,
                ll: m.modelLogLossSame ?? null,
                model: true,
            });
        rows.push({ label: 'Market (no vig)', n: m.n, acc: m.accuracy, brier: m.brier, ll: m.logLoss });
    }
    rows.push({
        label: 'Home rate',
        n: b.homeRate.n,
        acc: b.homeRate.accuracy,
        brier: b.homeRate.brier,
        ll: b.homeRate.logLoss,
        note: b.homeRate.rate != null ? `${(b.homeRate.rate * 100).toFixed(1)}%` : undefined,
    });
    rows.push({ label: 'Coin flip', n: null, acc: null, brier: 0.25, ll: Math.LN2 });
    // Mark the best log loss only once the sample can tell the rows apart.
    const bestLL = b.n >= SIGNAL_N ? Math.min(...rows.map(r => r.ll ?? Infinity)) : NaN;
    return (
        <ScrollRegion label={`Model versus baselines, ${seasonWord}`} className="panel">
            <table className="table-dense min-w-[340px]">
                <caption className="sr-only">Model versus baselines for {seasonWord}. Lower Brier and log loss are better.</caption>
                <thead>
                    <tr>
                        <th scope="col" className="text-left">
                            vs
                        </th>
                        <th scope="col" className="hidden text-right sm:table-cell">
                            n
                        </th>
                        <th scope="col" className="text-right">
                            Acc
                        </th>
                        <th scope="col" className="text-right">
                            <GlossLink term="brier" desc="lower is better">
                                Brier
                            </GlossLink>
                            <span aria-hidden="true"> ↓</span>
                        </th>
                        <th scope="col" className="text-right">
                            <GlossLink term="log-loss" desc="lower is better">
                                <abbr title="Log loss" className="no-underline">
                                    LL
                                </abbr>
                            </GlossLink>
                            <span aria-hidden="true"> ↓</span>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(r => (
                        <tr key={r.label}>
                            <th scope="row" className="text-left font-semibold">
                                <span className={r.model ? 'text-brand' : 'text-fg-1'}>{r.label}</span>
                                {r.note ? <span className="ml-2 font-normal text-fg-3">{r.note}</span> : null}
                            </th>
                            <td className="hidden text-right text-fg-2 sm:table-cell">{r.n != null ? r.n.toLocaleString('en-US') : '—'}</td>
                            <td className="text-right text-fg-1">{pct1(r.acc)}</td>
                            <td className="text-right text-fg-1">{dec3(r.brier)}</td>
                            <td className={cn('text-right', r.ll === bestLL ? 'font-bold text-pos' : 'text-fg-1')}>
                                {r.ll === bestLL ? (
                                    <span aria-hidden="true" className="mr-1">
                                        ●
                                    </span>
                                ) : null}
                                {dec4(r.ll)}
                                {r.ll === bestLL ? <span className="sr-only"> (best)</span> : null}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </ScrollRegion>
    );
}

function versionRow(v: { n: number; accuracy: number | null; accuracyAll?: number | null; brier: number | null; logLoss: number | null }): Omit<BaselineRow, 'label'> {
    return { n: v.n, acc: v.accuracyAll ?? v.accuracy, brier: v.brier, ll: v.logLoss, model: true };
}

const WORD_TONE: Record<VerdictWord, string> = { BETTER: 'text-pos', WORSE: 'text-neg', SAME: 'text-fg-1' };

/** One mono line per season: VS MARKET WORSE · VS HOME BETTER (log loss), or TOO EARLY below SIGNAL_N games. */
function VerdictRow({ verdict: v }: { verdict: Verdict }) {
    const part = (label: string, c: NonNullable<Verdict['vsMarket']>) => (
        <span className="inline-flex items-baseline gap-2" title={`Log loss ${c.model.toFixed(4)} vs ${c.other.toFixed(4)} · n=${c.n.toLocaleString('en-US')}`}>
            <span className="text-fg-3">{label}</span>
            <span className={cn('font-bold', WORD_TONE[c.word])}>{c.word}</span>
        </span>
    );
    return (
        <p data-testid="accuracy-verdict" className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-caption uppercase tracking-[0.14em]">
            {v.tooEarly ? (
                <span className="font-bold text-fg-2">Too early</span>
            ) : (
                <>
                    {v.vsMarket ? part('Vs market', v.vsMarket) : null}
                    {v.vsMarket && v.vsHome ? (
                        <span aria-hidden="true" className="text-fg-3">
                            ·
                        </span>
                    ) : null}
                    {v.vsHome ? part('Vs home', v.vsHome) : null}
                </>
            )}
        </p>
    );
}

function CallList({ rows }: { rows: CallRow[] }) {
    if (!rows.length) return <p className="label">—</p>;
    return (
        <ol className="flex flex-col">
            {rows.map(c => {
                const home = teamTriFromName(c.homeTeam) ?? c.homeTeam;
                const away = teamTriFromName(c.awayTeam) ?? c.awayTeam;
                const pick = teamTriFromName(c.pick) ?? c.pick;
                return (
                    <li key={c.gameId} className="flex h-8 items-center gap-2.5 border-t border-line/60 text-caption first:border-t-0">
                        <span aria-hidden="true" className={cn('w-3 font-bold', c.correct ? 'text-pos' : 'text-neg')}>
                            {c.correct ? '✓' : '✕'}
                        </span>
                        <span className="w-12 shrink-0 text-fg-3">{shortDate(c.date)}</span>
                        <span className="flex min-w-0 items-center gap-1.5 text-fg-1">
                            <Crest tri={away} size={16} className="drop-shadow-none" />
                            {away} {c.awayScore}
                            <span className="text-fg-3">@</span>
                            <Crest tri={home} size={16} className="drop-shadow-none" />
                            {home} {c.homeScore}
                            {c.decision !== 'REG' ? <span className="text-fg-3">{c.decision}</span> : null}
                        </span>
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                            <span className="sr-only">Picked</span>
                            <span className="font-bold text-fg-1">{pick}</span>
                            <span className="font-bold text-fg-2">{c.confidence.toFixed(0)}%</span>
                            <span className="sr-only">{c.correct ? ', correct' : ', wrong'}</span>
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}

export default AccuracyView;
