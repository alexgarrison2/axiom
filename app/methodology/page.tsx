import fs from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import Link from 'next/link';
import FullLogoAnimated from '@/components/FullLogoAnimated';
import { GLOSSARY, GLOSSARY_TERMS } from '@/lib/glossary';
import { SEASON_GAMES, SEASON_START_YEAR } from '@/lib/season';
import { loadExcludedGames, loadGradedGames, tallySeason } from '@/components/accuracy/data';
import { tidyReason } from '@/components/accuracy/ledger-data';
import { parseReport, type MetricRow, type SeasonSummary, type WalkForwardRow } from './report';

export const revalidate = 3600;

export const metadata: Metadata = {
    title: 'How it works',
    description:
        'How the Pony xG model turns expected goals into win probabilities, how we grade it against the betting market, what happens early in the season, and where the data comes from.',
    alternates: { canonical: '/methodology' },
};

function loadReport() {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/model_report.json'), 'utf8'));
        return { ...parseReport(raw), found: true };
    } catch {
        return { ...parseReport(null), found: false };
    }
}

const SECTIONS = [
    { id: 'the-model', label: 'The model' },
    { id: 'market', label: 'Model vs market' },
    { id: 'edge', label: 'Edges & bets' },
    { id: 'early-season', label: 'Early season' },
    { id: 'grading', label: 'How we grade it' },
    { id: 'validation', label: 'Validation' },
    { id: 'goalies', label: 'Goalies' },
    { id: 'context', label: 'Context chips' },
    { id: 'players', label: 'Players & standings' },
    { id: 'data-sources', label: 'Data sources' },
    { id: 'glossary', label: 'Glossary' },
];

const fmt = (v: number | undefined, digits: number, pct = false) =>
    v == null ? '—' : pct ? `${(v * (v <= 1 ? 100 : 1)).toFixed(1)}%` : v.toFixed(digits);

function MetricsTable({ summary }: { summary: SeasonSummary }) {
    const model = summary.rows.find(r => r.isModel);
    const better = (r: MetricRow, k: 'brier' | 'logLoss') =>
        !r.isModel && model?.[k] != null && r[k] != null ? (model[k]! < r[k]! ? 'model' : model[k]! > r[k]! ? 'baseline' : 'tie') : null;
    return (
        <div className="overflow-x-auto rounded-card border border-line" role="region" aria-label={`${summary.season} validation metrics`} tabIndex={0}>
            <table className="w-full min-w-[520px] text-left text-body-sm">
                <caption className="sr-only">
                    {summary.season} {summary.gameType ?? ''} season: model versus baselines. Lower Brier and log loss are better.
                </caption>
                <thead className="bg-surface-2 text-fg-2">
                    <tr>
                        <th scope="col" className="px-4 py-2.5 font-semibold">Forecaster</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Games</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Accuracy</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Brier ↓</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Log loss ↓</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums">
                    {summary.rows.map(r => {
                        const b = better(r, 'logLoss');
                        return (
                            <tr key={r.label} className={r.isModel ? 'bg-brand/5' : undefined}>
                                <th scope="row" className={`px-4 py-2.5 font-semibold ${r.isModel ? 'text-brand' : 'text-fg-1'}`}>
                                    {r.label}
                                </th>
                                <td className="px-4 py-2.5 text-right text-fg-2">{r.n?.toLocaleString() ?? '—'}</td>
                                <td className="px-4 py-2.5 text-right text-fg-1">{fmt(r.accuracy, 1, true)}</td>
                                <td className="px-4 py-2.5 text-right text-fg-1">{fmt(r.brier, 4)}</td>
                                <td className="px-4 py-2.5 text-right text-fg-1">
                                    {fmt(r.logLoss, 4)}
                                    {b === 'baseline' ? <span className="ml-2 text-caption text-neg">beats model</span> : null}
                                    {b === 'model' ? <span className="ml-2 text-caption text-pos">model better</span> : null}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function WalkForwardTable({ rows }: { rows: WalkForwardRow[] }) {
    const hasLegacy = rows.some(r => r.legacyLogLoss != null);
    const hasHome = rows.some(r => r.homeRateLogLoss != null);
    return (
        <div className="overflow-x-auto rounded-card border border-line" role="region" aria-label="Walk-forward backtest by season" tabIndex={0}>
            <table className="w-full min-w-[520px] text-left text-body-sm">
                <caption className="sr-only">
                    Walk-forward backtest: the model is trained only on seasons before each test season. Lower log loss is better.
                </caption>
                <thead className="bg-surface-2 text-fg-2">
                    <tr>
                        <th scope="col" className="px-4 py-2.5 font-semibold">Test season</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Games</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Accuracy</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Log loss ↓</th>
                        {hasLegacy ? <th scope="col" className="px-4 py-2.5 text-right font-semibold">Previous model</th> : null}
                        {hasHome ? <th scope="col" className="px-4 py-2.5 text-right font-semibold">Home-rate</th> : null}
                    </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums">
                    {rows.map(r => (
                        <tr key={r.season}>
                            <th scope="row" className="px-4 py-2.5 font-semibold text-fg-1">
                                {r.season}
                            </th>
                            <td className="px-4 py-2.5 text-right text-fg-2">{r.n?.toLocaleString() ?? '—'}</td>
                            <td className="px-4 py-2.5 text-right text-fg-1">{fmt(r.accuracy, 1, true)}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-brand">{fmt(r.logLoss, 4)}</td>
                            {hasLegacy ? <td className="px-4 py-2.5 text-right text-fg-2">{fmt(r.legacyLogLoss, 4)}</td> : null}
                            {hasHome ? <td className="px-4 py-2.5 text-right text-fg-2">{fmt(r.homeRateLogLoss, 4)}</td> : null}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Section({ id, index, title, children }: { id: string; index: number; title: string; children: React.ReactNode }) {
    return (
        <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-t border-line pt-10">
            <p className="hud-label text-brand">{String(index).padStart(2, '0')}</p>
            <h2 id={`${id}-h`} className="mt-1 text-h2 font-black text-fg-1">
                {title}
            </h2>
            <div className="mt-4 space-y-4 text-body text-fg-2">{children}</div>
        </section>
    );
}

export default function MethodologyPage() {
    const { model, seasons, found } = loadReport();
    const prior = `${SEASON_START_YEAR - 1}-${String(SEASON_START_YEAR).slice(2)}`;
    const current = `${SEASON_START_YEAR}-${String(SEASON_START_YEAR + 1).slice(2)}`;
    const priorSummary = seasons.find(s => s.season === prior);
    const graded = loadGradedGames();
    const tally = tallySeason(graded, current, loadExcludedGames(current, graded));
    const reportN = seasons.find(s => s.season === current)?.rows.find(r => r.isModel)?.n ?? 0;
    // Same count as /accuracy: a report that lags the graded list is not shown as the current record.
    const currentSummary = tally.n > (reportN ?? 0) ? undefined : seasons.find(s => s.season === current);
    let i = 0;

    return (
        <main className="mx-auto max-w-[1200px] px-4 pb-10 pt-8 md:px-6 md:pt-12">
            <header className="grid items-center gap-8 md:grid-cols-[1fr_320px]">
                <div>
                    <p className="hud-label text-brand">Methodology · {current} season</p>
                    <h1 className="mt-2 text-display font-black tracking-tight text-fg-1 md:text-hero">How Pony xG works</h1>
                    <p className="mt-4 max-w-2xl text-title font-normal text-fg-2">
                        We estimate every NHL game from shot quality, goaltending and schedule, then show you where our numbers agree and disagree
                        with the betting market — and keep a public record of how that has gone.
                    </p>
                </div>
                <div className="hidden md:block" aria-hidden="true">
                    <FullLogoAnimated idPrefix="method-logo" />
                </div>
            </header>

            <div className="mt-12 grid gap-10 lg:grid-cols-[200px_1fr]">
                <nav aria-label="On this page" className="lg:sticky lg:top-[calc(var(--appbar-h)+24px)] lg:self-start">
                    <p className="hud-label mb-2">On this page</p>
                    <ol className="flex flex-wrap gap-2 lg:flex-col lg:gap-0">
                        {SECTIONS.map(s => (
                            <li key={s.id}>
                                <a
                                    href={`#${s.id}`}
                                    className="inline-flex min-h-9 items-center rounded-chip border border-line px-3 text-body-sm text-fg-2 hover:text-fg-1 lg:min-h-8 lg:border-0 lg:px-0"
                                >
                                    {s.label}
                                </a>
                            </li>
                        ))}
                    </ol>
                </nav>

                <div className="min-w-0 space-y-12">
                    <Section id="the-model" index={++i} title="The model">
                        <p>
                            Every shot in every game gets an <strong className="text-fg-1">expected-goals (xG)</strong> value: the chance that a shot
                            from that spot, of that type, in that situation becomes a goal. Summed over a game, xG measures how many goals a team
                            &ldquo;should&rdquo; have scored — a steadier signal of team quality than goals, which bounce around with luck and
                            goaltending.
                        </p>
                        <p>
                            For tonight&apos;s games, the model combines each team&apos;s xG for and against (recent and season-long, regressed
                            toward league average), the starting goalies&apos; goals saved above expected, special teams, rest and travel, and home
                            ice. It produces projected goals for each side and a win probability that includes overtime and the shootout.
                        </p>
                        {model.name || model.description ? (
                            <p className="rounded-control border border-line bg-surface-1 p-4 text-body-sm">
                                <span className="hud-label mr-2">Current model</span>
                                <span className="text-fg-1">{model.name}</span>
                                {model.description ? <> — {model.description}</> : null}
                            </p>
                        ) : null}
                        <p>
                            <span className="text-fg-1">Training seasons: </span>
                            {model.trainingSeasons?.length
                                ? model.trainingSeasons.join(', ')
                                : 'recent complete NHL seasons, regular season and playoffs'}
                            . Every change to the model is tested walk-forward (train on the past, predict the next season) and only goes live
                            if it beats the current model on log loss.
                        </p>
                    </Section>

                    <Section id="market" index={++i} title="Model vs market">
                        <p>
                            Each card shows <strong className="text-fg-1">Our forecast</strong> next to <strong className="text-fg-1">Market %</strong>.
                            Market % comes from the moneyline odds with the bookmaker&apos;s margin (the &ldquo;vig&rdquo;, about 4%) removed by
                            the power method, so the two sides add up to 100%. The published forecast is the model blended with that de-vigged
                            market: early in the season the market carries <strong className="text-fg-1">80%</strong> of the weight and the model
                            20%, and the model&apos;s share grows as teams play more games. <strong className="text-fg-1">Model only</strong> shows
                            the unblended model, so you can see where it disagrees. <strong className="text-fg-1">Fair odds</strong> (formerly
                            &ldquo;xOdds&rdquo;) is the moneyline that matches the published forecast exactly.
                        </p>
                        <p>
                            The betting market is a very good forecaster. We treat it as the benchmark to beat, not as noise — and we say so when
                            we haven&apos;t beaten it.
                        </p>
                    </Section>

                    <Section id="edge" index={++i} title="Edges & bets">
                        <p>
                            <strong className="text-fg-1">Edge</strong> is how much better the model rates a side than its price. Edges are only
                            highlighted, and <strong className="text-fg-1">units</strong> only suggested, when the model has shown over a meaningful
                            sample that its disagreements with the market carry real information. Until that gate opens, edges and stakes are hidden.
                        </p>
                        {model.gate ? (
                            <p className="rounded-control border border-line bg-surface-1 p-4 text-body-sm">
                                <span className={`mr-2 font-semibold ${model.gate.open ? 'text-pos' : 'text-warn'}`}>
                                    {model.gate.open ? 'Edge gate open.' : 'Edge gate closed.'}
                                </span>
                                {model.gate.reason ? tidyReason(model.gate.reason) : null}
                                {model.gate.reasons?.length ? (
                                    <span className="mt-2 block space-y-1 text-caption text-fg-3">
                                        {model.gate.reasons.map(r => (
                                            <span key={r} className="block">
                                                · {tidyReason(r)}
                                            </span>
                                        ))}
                                    </span>
                                ) : null}
                            </p>
                        ) : null}
                        <p>Nothing here is betting advice. Probabilities are estimates and can be wrong.</p>
                    </Section>

                    <Section id="early-season" index={++i} title="Early season">
                        <p>
                            On opening night nobody has played, so the model starts from a <strong className="text-fg-1">preseason prior</strong>:
                            last season&apos;s ratings, regressed toward league average to account for roster changes. As games are played this
                            season&apos;s data takes over; by roughly 20 games per team the prior matters little. The {current} season is{' '}
                            {SEASON_GAMES} games long.
                        </p>
                        <p>We label small samples instead of hiding them:</p>
                        <ul className="list-disc space-y-1 pl-5">
                            <li>
                                <span className="text-fg-1">Small-sample</span> chips (dashed outline, <span className="font-mono">n=2</span>) show
                                this season&apos;s number from only a few games.
                            </li>
                            <li>
                                <span className="text-fg-1">Prior-season</span> chips are faded and tagged with their season (e.g.{' '}
                                <span className="font-mono">{prior.slice(2)}</span>) so they never pass for this season&apos;s data.
                            </li>
                            <li>League ranks (#1–#32) stay hidden until every team has played enough games to rank.</li>
                        </ul>
                    </Section>

                    <Section id="grading" index={++i} title="How we grade it">
                        <p>
                            Every prediction is frozen before puck drop and graded after the final horn. We report three numbers, always next to
                            simple baselines:
                        </p>
                        <ul className="list-disc space-y-1 pl-5">
                            <li>
                                <span className="text-fg-1">Accuracy</span>: how often the side we favoured won. Useful, but it ignores confidence.
                            </li>
                            <li>
                                <span className="text-fg-1">Brier score</span>: average squared error of the probabilities. Lower is better; a coin
                                flip scores 0.250.
                            </li>
                            <li>
                                <span className="text-fg-1">Log loss</span>: punishes confident misses hardest. Lower is better; a coin flip scores
                                0.693.
                            </li>
                        </ul>
                        <p>
                            Only predictions that were actually published count. Results regenerated after the fact are kept out of the headline
                            numbers. Overtime and shootout games count as wins and losses like any other.
                        </p>
                    </Section>

                    <Section id="validation" index={++i} title="Validation">
                        {priorSummary ? (
                            <>
                                <p>
                                    <span className="text-fg-1">{prior} season</span>, live predictions only
                                    {priorSummary.gameType ? ` (${priorSummary.gameType.replace(/^0?2$/, 'regular season')})` : ''}.
                                    {priorSummary.note ? ` ${priorSummary.note}` : ''}
                                </p>
                                <MetricsTable summary={priorSummary} />
                            </>
                        ) : (
                            <p className="rounded-control border border-dashed border-line-strong bg-surface-1 p-4 text-body-sm">
                                {found
                                    ? `The ${prior} validation block is not in the current model report yet.`
                                    : 'The validation report publishes with the next pipeline run.'}{' '}
                                The <Link href="/accuracy" className="font-semibold text-brand underline underline-offset-4">Accuracy page</Link> shows the
                                graded record.
                            </p>
                        )}
                        {currentSummary ? (
                            <>
                                <p>
                                    <span className="text-fg-1">{current} so far.</span>
                                </p>
                                <MetricsTable summary={currentSummary} />
                            </>
                        ) : (
                            <p>
                                <span className="text-fg-1">{current}:</span>{' '}
                                {tally.n
                                    ? `through ${tally.n} ${tally.n === 1 ? 'game' : 'games'}: ${tally.correct}-${tally.n - tally.correct}. The full report updates after the nightly refresh.`
                                    : 'no games graded yet. The first results post after the first games go final.'}
                                {tally.excluded.length ? ` ${tally.excluded.length} ${tally.excluded.length === 1 ? 'game was' : 'games were'} not graded (no pregame snapshot before puck drop).` : ''}{' '}
                                See the <Link href="/accuracy" className="font-semibold text-brand underline underline-offset-4">Accuracy page</Link>.
                            </p>
                        )}
                        {model.walkForward?.length ? (
                            <>
                                <p>
                                    <span className="text-fg-1">Walk-forward backtest.</span> For each season below, the model was trained only on
                                    the seasons before it, then scored on every game of that season (regular season and playoffs)
                                    {model.walkForward.some(w => w.legacyLogLoss != null) ? ', next to the model it replaced' : ''}.
                                    {model.earlySeasonLogLoss != null
                                        ? ` In the first weeks of those seasons its log loss was ${model.earlySeasonLogLoss.toFixed(4)}.`
                                        : ''}
                                </p>
                                <WalkForwardTable rows={model.walkForward} />
                            </>
                        ) : null}
                        {model.notes ? <p className="text-body-sm">{model.notes}</p> : null}
                        {model.generatedAt ? (
                            <p className="text-caption text-fg-3">
                                Report generated {model.generatedAt.slice(0, 16).replace('T', ' ')} UTC
                                {model.name ? ` · model ${model.name}` : ''}.
                            </p>
                        ) : null}
                    </Section>

                    <Section id="goalies" index={++i} title="Goalies">
                        <p>
                            Goalie strength is measured by <strong className="text-fg-1">goals saved above expected (GSAx)</strong>: expected goals
                            against minus goals actually allowed. Starting goalies come from team and beat-reporter reports and are marked{' '}
                            <span className="text-pos">Confirmed</span>, <span className="text-warn">Likely</span> or Projected, with the time we
                            last checked.
                        </p>
                    </Section>

                    <Section id="context" index={++i} title="Context chips">
                        <p>
                            Chips under each game add context the model uses or that fans ask about: recent form (L7, or L1–L6 early in the season, labelled &ldquo;after N games&rdquo;), head-to-head this season,
                            power play and penalty kill, and rest (back-to-backs and compressed stretches). They follow the same sample rules as
                            above — this season first, clearly labelled prior-season values otherwise.
                        </p>
                    </Section>

                    <Section id="players" index={++i} title="Players & standings">
                        <p id="standings">
                            <strong className="text-fg-1">Player impact</strong> estimates each skater&apos;s contribution to goal differential per
                            60 minutes relative to an average player, separating him from his linemates with a ridge-regression (RAPM-style)
                            model. <strong className="text-fg-1">Playoff odds</strong> come from simulating the rest of the season thousands of
                            times with the same game model.
                        </p>
                    </Section>

                    <Section id="data-sources" index={++i} title="Data sources">
                        <ul className="space-y-2">
                            <li>
                                <span className="text-fg-1">NHL</span> (api-web.nhle.com, api.nhle.com): schedule, results, play-by-play, shift
                                charts, standings and betting lines from the NHL&apos;s public partner feed.
                            </li>
                            <li>
                                <span className="text-fg-1">
                                    <a href="https://moneypuck.com" className="text-brand underline underline-offset-4" rel="noopener noreferrer" target="_blank">
                                        MoneyPuck.com
                                    </a>
                                </span>
                                : skater and goalie data used in player ratings. Data courtesy of MoneyPuck.com.
                            </li>
                            <li>
                                <span className="text-fg-1">DailyFaceoff</span>: projected lines and starting-goalie confirmations.
                            </li>
                            <li>
                                <span className="text-fg-1">ESPN</span>: injury reports and probable goalies.
                            </li>
                        </ul>
                        <p>
                            The data pipeline runs hourly from late morning to late evening Eastern on game days. The dot in the top bar shows
                            when it last finished and turns red only if a scheduled run was missed.
                        </p>
                    </Section>

                    <section id="glossary" aria-labelledby="glossary-h" className="scroll-mt-24 border-t border-line pt-10">
                        <p className="hud-label text-brand">{String(++i).padStart(2, '0')}</p>
                        <h2 id="glossary-h" className="mt-1 text-h2 font-black text-fg-1">
                            Glossary
                        </h2>
                        <dl className="mt-6 grid gap-3 sm:grid-cols-2">
                            {GLOSSARY_TERMS.map(key => {
                                const e = GLOSSARY[key] as { label: string; title: string; short: string; detail?: string };
                                return (
                                    <div key={key} id={`term-${key}`} className="scroll-mt-24 rounded-control border border-line bg-surface-1 p-4">
                                        <dt className="flex items-baseline justify-between gap-3">
                                            <span className="text-title font-bold text-fg-1">{e.label}</span>
                                            {e.title !== e.label ? <span className="text-right text-caption text-fg-3">{e.title}</span> : null}
                                        </dt>
                                        <dd className="mt-1 text-body-sm text-fg-2">
                                            {e.short}
                                            {e.detail ? <span className="mt-1 block text-caption text-fg-3">{e.detail}</span> : null}
                                        </dd>
                                    </div>
                                );
                            })}
                        </dl>
                    </section>
                </div>
            </div>
        </main>
    );
}
