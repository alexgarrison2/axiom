'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { KpiTile } from '@/components/ui/kpi-tile';
import { InfoTip } from '@/components/ui/info-tip';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { TeamLogo } from '@/components/views/TeamLogo';
import { plural, shortDate, signed } from '@/components/views/format';
import { teamTriFromName } from './names';
import { combineBlocks, reportLags, type AccuracyReport, type CallRow, type GameTypeKey, type ReportBlock } from './report';
import { ReliabilityChart, RollingChart, TierBars } from './charts';
import { GameList } from './GameList';
import { Ledger } from './Ledger';
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
    { value: 'all', label: 'All games' },
    { value: 'regular', label: 'Regular season' },
    { value: 'playoffs', label: 'Playoffs' },
];

const pct1 = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const dec4 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(4));

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

    return (
        <div className="flex flex-col gap-10">
            <div className="flex flex-wrap items-center gap-3">
                <Segmented label="Season" options={seasonOptions} value={season} onChange={selectSeason} />
                <Segmented label="Game type" options={TYPE_OPTIONS} value={type} onChange={setType} size="sm" />
            </div>

            <section aria-labelledby="report-card" className="flex flex-col gap-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 id="report-card" className="text-h2 font-black tracking-tight text-fg-1">
                        Report card
                    </h2>
                    {!empty && !stale && block ? (
                        <p className="text-caption text-fg-3">
                            Live pregame picks only · {shortDate(block.firstDate)} – {shortDate(block.lastDate)}
                            {block.nRetro ? ` · ${plural(block.nRetro, 'back-filled game')} excluded` : ''}
                        </p>
                    ) : null}
                </div>

                {stale && tally ? (
                    <ThroughSummary tally={tally} season={season} />
                ) : empty ? (
                    <EmptyState season={season} currentSeason={currentSeason} type={type} prior={priorSeason} onPrior={() => priorSeason && selectSeason(priorSeason)} />
                ) : (
                    <ReportCard block={block!} seasonWord={seasonWord} modelLabel={season === 'all' ? 'Site model (live)' : season < currentSeason ? 'Previous site model (live)' : 'Pony xG model'} />
                )}
            </section>

            <section aria-labelledby="every-pick" className="flex flex-col gap-4">
                <h2 id="every-pick" className="text-h2 font-black tracking-tight text-fg-1">
                    Every pick
                </h2>
                <GameList season={season} seasons={seasons} type={type} currentSeason={currentSeason} excluded={season === 'all' ? [] : (tallies[season]?.[type]?.excluded ?? [])} />
            </section>

            <section id="ledger" aria-labelledby="ledger-title" className="flex scroll-mt-[calc(var(--appbar-h)+12px)] flex-col gap-4">
                <h2 id="ledger-title" className="text-h2 font-black tracking-tight text-fg-1">
                    Bet ledger
                </h2>
                <Ledger ledger={ledger} gate={report.gate} season={season} seasons={seasons} finals={finals} />
            </section>
        </div>
    );
}

function EmptyState({ season, currentSeason, type, prior, onPrior }: { season: string; currentSeason: string; type: GameTypeKey; prior?: string; onPrior: () => void }) {
    const isCurrent = season === currentSeason;
    return (
        <div role="status" className="hud-panel flex flex-col items-start gap-3 border-dashed p-5 md:p-6">
            <p className="text-title font-bold text-fg-1">
                {isCurrent
                    ? `No ${season} ${type === 'playoffs' ? 'playoff ' : ''}games graded yet.`
                    : `No graded ${type === 'playoffs' ? 'playoff ' : type === 'regular' ? 'regular-season ' : ''}games for ${season === 'all' ? 'this selection' : season}.`}
                {isCurrent && type !== 'playoffs' ? ' First results after tonight.' : ''}
            </p>
            <p className="max-w-2xl text-body-sm text-fg-2">
                We only grade the picks we published before puck drop, so a new season starts from zero rather than carrying last season&apos;s record forward.
            </p>
            {isCurrent && prior ? (
                <button
                    type="button"
                    onClick={onPrior}
                    className="inline-flex min-h-10 items-center rounded-control bg-brand px-4 text-body-sm font-bold text-brand-ink transition-[filter] hover:brightness-110 coarse:min-h-11"
                >
                    See the {prior} record
                </button>
            ) : null}
        </div>
    );
}

function ThroughSummary({ tally: t, season }: { tally: SeasonTally; season: string }) {
    const record = `${t.correct}-${t.n - t.correct}`;
    return (
        <div role="status" className="flex flex-col gap-4">
            <p className="text-title font-bold text-fg-1">
                {`Through ${plural(t.n, 'game')}: ${record}`}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KpiTile label="Picks right" info={<InfoTip term="confidence" />} value={pct1(t.n ? t.correct / t.n : null)} sub={`${record} · n=${t.n}`} />
                <KpiTile
                    label="Log loss"
                    info={<InfoTip term="log-loss" />}
                    value={dec4(t.logLoss)}
                    sub={t.marketN ? `Same ${plural(t.marketN, 'game')}: model ${dec4(t.modelLogLossSame)} · market ${dec4(t.marketLogLoss)}` : 'No market prices yet'}
                />
                <KpiTile label="Brier score" info={<InfoTip term="brier" />} value={dec4(t.brier)} sub="coin flip 0.2500" />
                <KpiTile
                    label="Games graded"
                    value={t.n.toLocaleString('en-US')}
                    sub={
                        <>
                            {t.marketN ? `${t.marketN} with a real market price` : 'No market prices recorded'}
                            {t.placeholderN ? ` · ${t.placeholderN} placeholder line excluded from market` : ''}
                            {t.excluded.length ? ` · ${t.excluded.length} not graded` : ''}
                        </>
                    }
                />
            </div>
            <p className="max-w-3xl text-body-sm text-fg-2">
                Tiny sample, so read these as a starting line, not a verdict. The full {season} report (calibration, confidence tiers, baselines)
                updates after the nightly refresh.
                {t.legacyN
                    ? ` ${t.legacyN === t.n ? `All ${t.n}` : t.legacyN} of these picks came from the previous (legacy) site model, so they are graded here but do not count toward the bet gate.`
                    : ''}
            </p>
        </div>
    );
}

function ReportCard({ block: b, seasonWord, modelLabel }: { block: ReportBlock; seasonWord: string; modelLabel: string }) {
    const m = b.market;
    const sameLL = m.modelLogLossSame ?? b.logLoss;
    const sameAcc = m.modelAccuracySame ?? b.accuracy;
    const record = `${b.correct}-${b.n - b.correct}`;
    return (
        <div className="flex flex-col gap-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KpiTile
                    label="Picks right"
                    info={<InfoTip term="confidence" />}
                    value={pct1(b.accuracy)}
                    sub={
                        <>
                            {record} · n={b.n.toLocaleString('en-US')}
                            {b.accuracyCi ? ` · 95% CI ${(b.accuracyCi[0] * 100).toFixed(0)}–${(b.accuracyCi[1] * 100).toFixed(0)}%` : ''}
                        </>
                    }
                    delta={
                        sameAcc != null && m.accuracy != null && m.n
                            ? { value: (sameAcc - m.accuracy) * 100, baseline: 'market favourite', better: 'higher', format: v => `${signed(v, 1)} pts` }
                            : null
                    }
                />
                <KpiTile
                    label="Log loss"
                    info={<InfoTip term="log-loss" />}
                    value={dec4(b.logLoss)}
                    delta={sameLL != null && m.logLoss != null && m.n ? { value: sameLL - m.logLoss, baseline: 'market', better: 'lower', format: v => signed(v, 4) } : null}
                    sub={`Home-rate ${dec4(b.homeRate.logLoss)} · coin flip 0.6931`}
                />
                <KpiTile
                    label="Brier score"
                    info={<InfoTip term="brier" />}
                    value={dec4(b.brier)}
                    delta={b.brier != null && m.brier != null && m.n ? { value: b.brier - m.brier, baseline: 'market', better: 'lower', format: v => signed(v, 4) } : null}
                    sub={`Home-rate ${dec4(b.homeRate.brier)} · coin flip 0.2500`}
                />
                <KpiTile
                    label="Games graded"
                    value={b.n.toLocaleString('en-US')}
                    sub={
                        <>
                            {m.n ? `${m.n.toLocaleString('en-US')} with a market price` : 'No market prices recorded'}
                            {b.nRetro ? ` · ${b.nRetro.toLocaleString('en-US')} back-filled excluded` : ''}
                        </>
                    }
                />
            </div>

            <BaselineTable block={b} seasonWord={seasonWord} modelLabel={modelLabel} />

            <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Calibration" info={<InfoTip term="calibration" />}>
                    {b.reliability.some(r => r.n > 0) ? <ReliabilityChart bins={b.reliability} /> : <p className="text-body-sm text-fg-3">Not enough games.</p>}
                </Panel>
                <Panel title="Accuracy by confidence" info={<InfoTip term="confidence" />}>
                    {b.tiers.length ? <TierBars tiers={b.tiers} /> : <p className="text-body-sm text-fg-3">Not enough games.</p>}
                </Panel>
            </div>

            <Panel title="Rolling log loss vs the market" info={<InfoTip term="market-pct" />}>
                <RollingChart points={b.rolling} />
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Best calls">
                    <CallList rows={b.bestCalls} />
                </Panel>
                <Panel title="Worst misses">
                    <CallList rows={b.worstMisses} />
                </Panel>
            </div>
        </div>
    );
}

function Panel({ title, info, children }: { title: string; info?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section aria-label={title} className="hud-panel flex flex-col gap-4 p-4 md:p-5">
            <h3 className="flex items-center gap-1 text-title font-bold text-fg-1">
                {title}
                {info}
            </h3>
            {children}
        </section>
    );
}

function BaselineTable({ block: b, seasonWord, modelLabel }: { block: ReportBlock; seasonWord: string; modelLabel: string }) {
    const m = b.market;
    const rows: { label: string; n: number | null; acc: number | null; brier: number | null; ll: number | null; model?: boolean; note?: string }[] = [
        { label: modelLabel, n: b.n, acc: b.accuracy, brier: b.brier, ll: b.logLoss, model: true },
    ];
    if (m.n) {
        rows.push({ label: `${modelLabel}, same games`, n: m.n, acc: m.modelAccuracySame ?? null, brier: null, ll: m.modelLogLossSame ?? null, model: true, note: 'games with a market price' });
        rows.push({ label: 'Betting market (de-vigged)', n: m.n, acc: m.accuracy, brier: m.brier, ll: m.logLoss });
    }
    rows.push({
        label: 'Always the home-win rate',
        n: b.homeRate.n,
        acc: b.homeRate.accuracy,
        brier: b.homeRate.brier,
        ll: b.homeRate.logLoss,
        note: b.homeRate.rate != null ? `${(b.homeRate.rate * 100).toFixed(1)}% home` : undefined,
    });
    rows.push({ label: 'Coin flip', n: null, acc: null, brier: 0.25, ll: Math.LN2 });
    const bestLL = Math.min(...rows.map(r => r.ll ?? Infinity));
    return (
        <ScrollRegion label={`Model versus baselines, ${seasonWord}`} className="rounded-card border border-line">
            <table className="w-full min-w-[560px] text-left text-body-sm">
                <caption className="sr-only">Model versus baselines for {seasonWord}. Lower Brier and log loss are better.</caption>
                <thead className="bg-surface-2 text-micro uppercase tracking-[0.06em] text-fg-2">
                    <tr>
                        <th scope="col" className="px-4 py-2.5 font-semibold">
                            Forecaster
                        </th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                            Games
                        </th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                            Accuracy
                        </th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                            Brier ↓
                        </th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                            Log loss ↓
                        </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums">
                    {rows.map(r => (
                        <tr key={r.label} className={r.model ? 'bg-brand/5' : undefined}>
                            <th scope="row" className="px-4 py-2.5 font-semibold">
                                <span className={r.model ? 'text-brand' : 'text-fg-1'}>{r.label}</span>
                                {r.note ? <span className="block text-caption font-normal text-fg-3">{r.note}</span> : null}
                            </th>
                            <td className="px-4 py-2.5 text-right text-fg-2">{r.n != null ? r.n.toLocaleString('en-US') : '—'}</td>
                            <td className="px-4 py-2.5 text-right text-fg-1">{pct1(r.acc)}</td>
                            <td className="px-4 py-2.5 text-right text-fg-1">{dec4(r.brier)}</td>
                            <td className="px-4 py-2.5 text-right text-fg-1">
                                {dec4(r.ll)}
                                {r.ll === bestLL ? (
                                    <span className="ml-1.5 rounded-chip bg-pos/15 px-1.5 text-micro font-semibold text-pos">best</span>
                                ) : null}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </ScrollRegion>
    );
}

function CallList({ rows }: { rows: CallRow[] }) {
    if (!rows.length) return <p className="text-body-sm text-fg-3">None yet.</p>;
    return (
        <ol className="flex flex-col gap-1.5">
            {rows.map(c => {
                const home = teamTriFromName(c.homeTeam) ?? c.homeTeam;
                const away = teamTriFromName(c.awayTeam) ?? c.awayTeam;
                const pick = teamTriFromName(c.pick) ?? c.pick;
                return (
                    <li key={c.gameId} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control bg-surface-2/60 px-3 py-2 text-body-sm">
                        <span aria-hidden="true" className={c.correct ? 'font-bold text-pos' : 'font-bold text-neg'}>
                            {c.correct ? '✓' : '✗'}
                        </span>
                        <span className="w-14 text-fg-3">{shortDate(c.date)}</span>
                        <span className="flex items-center gap-1.5 tabular-nums text-fg-1">
                            <TeamLogo tri={away} size={18} />
                            {away} {c.awayScore} @ {home} {c.homeScore}
                            <TeamLogo tri={home} size={18} />
                            {c.decision !== 'REG' ? <span className="text-caption text-fg-3">{c.decision}</span> : null}
                        </span>
                        <span className="ml-auto text-fg-2">
                            Picked <span className="font-semibold text-fg-1">{pick}</span> at <span className="font-semibold tabular-nums text-fg-1">{c.confidence.toFixed(0)}%</span>
                            <span className="sr-only">{c.correct ? ', correct' : ', wrong'}</span>
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}

export default AccuracyView;
