import fs from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import Link from 'next/link';
import { GLOSSARY, GLOSSARY_TERMS } from '@/lib/glossary';
import { SEASON_GAMES, SEASON_START_YEAR } from '@/lib/season';
import { loadExcludedGames, loadGradedGames, tallySeason } from '@/components/accuracy/data';
import { reportLags } from '@/components/accuracy/report';
import { tidyReason } from '@/components/accuracy/ledger-data';
import { WinBar, WinBarLegend } from '@/components/ui/win-bar';
import { HashScroll } from '@/components/ui/hash-scroll';
import { SeasonTag, StatChip } from '@/components/ui/stat-chip';
import { parseReport, type MarketBacktest, type MetricRow, type SeasonSummary, type WalkForwardRow } from './report';

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
    { id: 'reading', label: 'Reading a card' },
    { id: 'the-model', label: 'The model' },
    { id: 'market', label: 'Model vs market' },
    { id: 'edge', label: 'Edges & bets' },
    { id: 'early-season', label: 'Early season' },
    { id: 'grading', label: 'Grading' },
    { id: 'validation', label: 'Validation' },
    { id: 'goalies', label: 'Goalies' },
    { id: 'context', label: 'Context chips' },
    { id: 'players', label: 'Players & standings' },
    { id: 'data-sources', label: 'Data sources' },
    { id: 'glossary', label: 'Glossary' },
];

/** "2026-03-06" → "2025-26" (seasons roll over on July 1). */
function seasonOfDate(d: string): string | undefined {
    const m = d.match(/^(\d{4})-(\d{2})/);
    if (!m) return undefined;
    const start = Number(m[2]) >= 7 ? Number(m[1]) : Number(m[1]) - 1;
    return `${start}-${String(start + 1).slice(2)}`;
}

const fmt = (v: number | undefined, digits: number, pct = false) =>
    v == null ? '—' : pct ? `${(v * (v <= 1 ? 100 : 1)).toFixed(1)}%` : v.toFixed(digits);

/** Below this many graded games a better/worse call is noise (the /accuracy rule): no badge. */
const SIGNAL_N = 100;

function MetricsTable({ summary }: { summary: SeasonSummary }) {
    const model = summary.rows.find(r => r.isModel);
    // Compare on the same games: the market row carries the model's log loss on its games.
    const better = (r: MetricRow) => {
        const mine = r.modelLogLossSame ?? model?.logLoss;
        if (r.isModel || mine == null || r.logLoss == null || (model?.n ?? 0) < SIGNAL_N || (r.n ?? model?.n ?? 0) < SIGNAL_N) return null;
        const d = Math.round(mine * 1e4) - Math.round(r.logLoss * 1e4);
        return d < 0 ? 'model' : d > 0 ? 'baseline' : 'tie';
    };
    return (
        <div className="panel overflow-x-auto" role="region" aria-label={`${summary.season} validation metrics`} tabIndex={0}>
            <table className="table-dense min-w-[520px]">
                <caption className="sr-only">
                    {summary.season} {summary.gameType ?? ''} season: model versus baselines. Lower Brier and log loss are better.
                </caption>
                <thead>
                    <tr>
                        <th scope="col" className="text-left">Forecaster</th>
                        <th scope="col" className="text-right">n</th>
                        <th scope="col" className="text-right">Acc</th>
                        <th scope="col" className="text-right">Brier ↓</th>
                        <th scope="col" className="text-right">Log loss ↓</th>
                    </tr>
                </thead>
                <tbody>
                    {summary.rows.map(r => {
                        const b = better(r);
                        return (
                            <tr key={r.label}>
                                <th scope="row" className={`text-left font-semibold ${r.isModel ? 'text-brand' : 'text-fg-1'}`}>
                                    {r.label}
                                </th>
                                <td className="text-right text-fg-2">{r.n?.toLocaleString() ?? '—'}</td>
                                <td className="text-right text-fg-1">{fmt(r.accuracy, 1, true)}</td>
                                <td className="text-right text-fg-1">{fmt(r.brier, 4)}</td>
                                <td className="text-right text-fg-1">
                                    {b === 'baseline' ? <span className="mr-2 text-micro uppercase tracking-[0.1em] text-neg">beats model</span> : null}
                                    {b === 'model' ? <span className="mr-2 text-micro uppercase tracking-[0.1em] text-pos">model better</span> : null}
                                    {fmt(r.logLoss, 4)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function WalkForwardTable({ rows: wf, market }: { rows: WalkForwardRow[]; market?: MarketBacktest }) {
    // Full-season folds have no market prices; the market backtest adds the games that do.
    const btSeason = market?.first ? seasonOfDate(market.first) : undefined;
    const rows: (WalkForwardRow & { key: string; label: string; mkt?: boolean })[] = [
        ...wf.map(r => ({ ...r, key: r.season, label: r.season })),
        ...(market?.modelLogLoss != null && market.marketLogLoss != null
            ? [
                  {
                      key: 'mkt',
                      label: `${btSeason ?? ''} · MKT`.replace(/^ · /, ''),
                      season: btSeason ?? '',
                      n: market.n,
                      logLoss: market.modelLogLoss,
                      legacyLogLoss: market.prevLogLoss,
                      marketLogLoss: market.marketLogLoss,
                      mkt: true,
                  },
              ]
            : []),
    ];
    const hasLegacy = rows.some(r => r.legacyLogLoss != null);
    const hasHome = rows.some(r => r.homeRateLogLoss != null);
    return (
        <div className="panel overflow-x-auto" role="region" aria-label="Walk-forward backtest by season" tabIndex={0}>
            <table className="table-dense min-w-[520px]">
                <caption className="sr-only">Walk-forward backtest: the model is trained only on seasons before each test season. Lower log loss is better.</caption>
                <thead>
                    <tr>
                        <th scope="col" className="text-left">Test season</th>
                        <th scope="col" className="text-right">n</th>
                        <th scope="col" className="text-right">Acc</th>
                        <th scope="col" className="text-right">Log loss ↓</th>
                        {hasLegacy ? <th scope="col" className="text-right">Prev. model</th> : null}
                        {hasHome ? <th scope="col" className="text-right">Home rate</th> : null}
                        <th scope="col" className="text-right">
                            Market
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(r => (
                        <tr key={r.key}>
                            <th scope="row" className="text-left font-semibold text-fg-1">
                                {r.mkt ? (
                                    <abbr
                                        title={`Games with a real pregame market price${market?.first && market.last ? `, ${market.first} to ${market.last}` : ''}; model trained only on earlier games`}
                                        className="no-underline"
                                    >
                                        {r.label}
                                    </abbr>
                                ) : (
                                    r.label
                                )}
                            </th>
                            <td className="text-right text-fg-2">{r.n?.toLocaleString() ?? '—'}</td>
                            <td className="text-right text-fg-1">{fmt(r.accuracy, 1, true)}</td>
                            <td className="text-right font-bold text-brand">{fmt(r.logLoss, 4)}</td>
                            {hasLegacy ? <td className="text-right text-fg-2">{fmt(r.legacyLogLoss, 4)}</td> : null}
                            {hasHome ? <td className="text-right text-fg-2">{fmt(r.homeRateLogLoss, 4)}</td> : null}
                            <td className="text-right text-fg-2">{fmt(r.marketLogLoss, 4)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Section({ id, index, title, children }: { id: string; index: number; title: string; children: React.ReactNode }) {
    return (
        <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-[calc(var(--appbar-h)+16px)] border-t border-line pt-6">
            <h2 id={`${id}-h`} className="heading-section flex items-baseline gap-3">
                <span aria-hidden="true" className="font-sans text-caption font-bold tracking-[0.14em] text-brand">
                    {String(index).padStart(2, '0')}
                </span>
                {title}
            </h2>
            <div className="mt-3 max-w-[76ch] space-y-3 text-body-sm text-fg-2 [&_strong]:font-semibold [&_strong]:text-fg-1">{children}</div>
        </section>
    );
}

/** A legend row: the visual on the left, what it means on the right. */
function Key({ sample, children }: { sample: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-3 border-t border-line/60 py-2 first:border-t-0 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="flex min-h-5 items-center">{sample}</dt>
            <dd>{children}</dd>
        </div>
    );
}

export default function MethodologyPage() {
    const { model, seasons, found } = loadReport();
    const prior = `${SEASON_START_YEAR - 1}-${String(SEASON_START_YEAR).slice(2)}`;
    const current = `${SEASON_START_YEAR}-${String(SEASON_START_YEAR + 1).slice(2)}`;
    // Past seasons were graded on the site model of the day, not the current one.
    // A season's model row is named for the model that made its picks: every pick from
    // the previous site model (or any past season) reads "Previous site model (live)".
    const labelled = (s: SeasonSummary | undefined, past: boolean): SeasonSummary | undefined =>
        s && {
            ...s,
            rows: s.rows.map(r =>
                r.isModel && (past || (r.n != null && r.n > 0 && (r.legacyN ?? 0) >= r.n)) ? { ...r, label: r.label.replace('Pony xG model', 'Previous site model (live)') } : r,
            ),
        };
    const priorSummary = labelled(
        seasons.find(s => s.season === prior),
        true,
    );
    const graded = loadGradedGames();
    const tally = tallySeason(graded, current, loadExcludedGames(current, graded));
    const reportN = seasons.find(s => s.season === current)?.rows.find(r => r.isModel)?.n ?? 0;
    // Same count as /accuracy: a report that lags the graded list (or has no games yet) is not shown as the current record.
    const currentSummary = reportN === 0 || reportLags(reportN, tally) ? undefined : labelled(seasons.find(s => s.season === current), false);
    let i = 0;

    return (
        <main className="pb-tabbar">
            <HashScroll />
            <div className="page py-5 md:py-7">
                <h1 className="heading-page">Methodology</h1>

                <div className="mt-5 grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-10">
                    <nav aria-label="On this page" className="min-w-0 lg:sticky lg:top-[calc(var(--appbar-h)+20px)] lg:self-start">
                        <ol className="edge-fade-right -mx-4 flex gap-1.5 overflow-x-auto px-4 scrollbar-hide lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0 lg:[-webkit-mask-image:none] lg:[mask-image:none]">
                            {SECTIONS.map((s, n) => (
                                <li key={s.id} className="shrink-0">
                                    <a
                                        href={`#${s.id}`}
                                        className="group inline-flex min-h-8 items-center gap-2 whitespace-nowrap rounded-chip border border-line px-2 text-micro font-medium uppercase tracking-[0.12em] text-fg-2 hover:text-brand coarse:min-h-11 lg:border-0 lg:px-0"
                                    >
                                        <span aria-hidden="true" className="hidden text-fg-3 group-hover:text-brand lg:inline">
                                            {String(n + 1).padStart(2, '0')}
                                        </span>
                                        {s.label}
                                    </a>
                                </li>
                            ))}
                        </ol>
                    </nav>

                    <div className="min-w-0 space-y-8">
                        <Section id="reading" index={++i} title="Reading a card">
                            <div className="panel max-w-[34rem] p-card">
                                <WinBar away="NYI" home="TOR" pAway={0.48} market={0.46} model={0.61} animate={false} label="Example forecast" />
                                <div className="mt-2 flex items-center justify-between text-caption text-fg-2">
                                    <span>+112</span>
                                    <span className="glow-magenta text-micro font-bold tracking-[0.12em]">◆ 61 NYI</span>
                                    <span>−133</span>
                                </div>
                                <WinBarLegend className="mt-2" />
                            </div>
                            <dl>
                                <Key sample={<span className="num-pct font-display text-title text-fg-1">48%</span>}>
                                    The <strong>fill</strong> is the published forecast: each team&apos;s chance to win, overtime and shootout included. The
                                    favourite&apos;s side glows; the underdog&apos;s is desaturated.
                                </Key>
                                <Key sample={<i aria-hidden="true" className="inline-block h-4 w-0.5 bg-white" />}>
                                    The white <strong>market tick</strong> is the betting market&apos;s probability with the bookmaker&apos;s margin removed.
                                </Key>
                                <Key sample={<i aria-hidden="true" className="inline-block h-2.5 w-2.5 rotate-45 bg-magenta" />}>
                                    The magenta <strong>model diamond</strong> is the raw model before it is blended with the market (see Model vs market).
                                </Key>
                                <Key sample={<span className="glow-magenta text-micro font-bold tracking-[0.12em]">◆ 61 NYI</span>}>
                                    The <strong>model lean</strong> flag appears only when the raw model and the market disagree by a lot: the model gives NYI
                                    61%.
                                </Key>
                                <Key sample={<span className="text-caption text-fg-2">+112 · −133</span>}>
                                    The book&apos;s moneylines, away on the left, home on the right.
                                </Key>
                                <Key
                                    sample={
                                        <span className="text-micro font-bold tracking-[0.12em]">
                                            <span className="text-pos">✓ PICK</span> <span className="text-neg">✕ PICK</span>
                                        </span>
                                    }
                                >
                                    On finals the bar dims and the footer grades our pick: right or wrong.
                                </Key>
                                <Key sample={<span className="rounded-chip border border-warn/50 px-1.5 text-micro tracking-[0.12em] text-warn">B2B</span>}>
                                    At most one <strong>situational chip</strong> per card, top right: back-to-back, long road trip and similar schedule spots.
                                </Key>
                                <Key
                                    sample={
                                        <span className="flex items-center gap-2 font-display text-caption font-semibold uppercase">
                                            <span className="glow-green">Conf</span>
                                            <span className="text-pos/60">Likely</span>
                                            <span className="text-fg-2">Proj</span>
                                        </span>
                                    }
                                >
                                    Goalie names by status: <span className="text-pos">green</span> confirmed, <span className="text-pos/70">faded green</span>{' '}
                                    likely, grey projected. The tiny line under a name is this season&apos;s W-L-OTL · SV% · GAA, and head-to-head against
                                    tonight&apos;s opponent when there is one.
                                </Key>
                                <Key sample={<SeasonTag />}>
                                    A <strong>season tag</strong> marks last season&apos;s numbers, shown until this season has a sample. They never pass for
                                    this season&apos;s data.
                                </Key>
                            </dl>
                        </Section>

                        <Section id="the-model" index={++i} title="The model">
                            <p>
                                Every shot in every game gets an <strong>expected-goals (xG)</strong> value: the chance that a shot from that spot, of that
                                type, in that situation becomes a goal. Summed over a game, xG measures how many goals a team &ldquo;should&rdquo; have
                                scored — a steadier signal of team quality than goals, which bounce around with luck and goaltending.
                            </p>
                            <p>
                                For tonight&apos;s games, the model combines each team&apos;s xG share (5-on-5 and all situations, regressed toward league
                                average), Elo rating, points percentage, the starting goalies&apos; goals saved above expected, rest and back-to-backs, and
                                home ice. It produces a win probability that includes overtime and the shootout. Projected goals are derived from the
                                published forecast, not a separate goal model.
                            </p>
                            {model.name || model.description ? (
                                <p className="panel px-3 py-2 text-caption">
                                    <span className="label mr-2">Current model</span>
                                    <span className="text-fg-1">{model.name}</span>
                                    {model.description ? <> — {model.description}</> : null}
                                </p>
                            ) : null}
                            <p>
                                <strong>Training seasons: </strong>
                                {model.trainingSeasons?.length ? model.trainingSeasons.join(', ') : 'recent complete NHL seasons, regular season and playoffs'}.
                                Every change to the model is tested walk-forward (train on the past, predict the next season) and only goes live if it beats
                                the current model on log loss.
                            </p>
                        </Section>

                        <Section id="market" index={++i} title="Model vs market">
                            <p>
                                The market probability comes from the moneyline odds with the bookmaker&apos;s margin (the &ldquo;vig&rdquo;, about 4%)
                                removed, so the two sides add up to 100%. The published forecast (the bar&apos;s fill) is the model blended with that
                                de-vigged market: early in the season the market carries <strong>80%</strong> of the weight and the model 20%, and the
                                model&apos;s share grows as teams play more games. The <strong>model diamond</strong> shows the unblended model, so you can
                                see where it disagrees. <strong>Fair odds</strong> is the moneyline that matches the published forecast exactly.
                            </p>
                            <p>
                                The betting market is a very good forecaster. We treat it as the benchmark to beat, not as noise — and we say so when we
                                haven&apos;t beaten it.
                            </p>
                        </Section>

                        <Section id="edge" index={++i} title="Edges & bets">
                            <p>
                                <strong>Edge</strong> (EV) is the expected profit per unit staked: <strong>EV = forecast probability × decimal odds − 1</strong>,
                                using the published, market-blended forecast. Edges are only highlighted, and <strong>units</strong> only suggested, when the
                                model has shown over a meaningful sample that its disagreements with the market carry real information. Until that{' '}
                                <strong>bet gate</strong> opens, new edges and stakes are hidden; the ledger on the Accuracy page still grades every stake the
                                site ever suggested.
                            </p>
                            <p>
                                <strong>1 unit (1u) = 1% of bankroll.</strong> Stakes are quarter-Kelly, capped at 5u.
                            </p>
                            {model.gate ? (
                                <div className="panel px-3 py-2 text-caption">
                                    <p className={`label ${model.gate.open ? 'text-pos' : 'text-warn'}`}>{model.gate.open ? 'Gate open' : 'Gate closed'}</p>
                                    {model.gate.reason ? <p className="mt-1 text-fg-2">{tidyReason(model.gate.reason)}</p> : null}
                                    {model.gate.reasons?.length ? (
                                        <ul className="mt-1 space-y-0.5 text-fg-3">
                                            {model.gate.reasons.map(r => (
                                                <li key={r}>· {tidyReason(r)}</li>
                                            ))}
                                        </ul>
                                    ) : null}
                                </div>
                            ) : null}
                            <p>Nothing here is betting advice. Probabilities are estimates and can be wrong. 21+, 1-800-GAMBLER.</p>
                        </Section>

                        <Section id="early-season" index={++i} title="Early season">
                            <p>
                                On opening night nobody has played, so the model starts from a <strong>preseason prior</strong>: last season&apos;s ratings,
                                regressed toward league average to account for roster changes. As games are played this season&apos;s data takes over; by
                                roughly 20 games per team the prior matters little. The {current} season is {SEASON_GAMES} games long.
                            </p>
                            <dl>
                                <Key sample={<StatChip label="SV%" value=".917" state="small" n={2} />}>
                                    <strong>Small sample</strong>: this season&apos;s number from only a few games (dashed outline, game count).
                                </Key>
                                <Key sample={<StatChip label="SV%" value=".905" state="prior" />}>
                                    <strong>Prior season</strong>: faded and tagged with its season ({prior.slice(2)}).
                                </Key>
                            </dl>
                            <p>League ranks (#1–#32) stay hidden until every team has played enough games to rank.</p>
                        </Section>

                        <Section id="grading" index={++i} title="How we grade it">
                            <p>Every prediction is frozen before puck drop and graded after the final horn. We report three numbers, always next to simple baselines:</p>
                            <dl>
                                <Key sample={<span className="label text-fg-1">Accuracy</span>}>How often the side we favoured won. Useful, but it ignores confidence.</Key>
                                <Key sample={<span className="label text-fg-1">Brier</span>}>Average squared error of the probabilities. Lower is better; a coin flip scores 0.250.</Key>
                                <Key sample={<span className="label text-fg-1">Log loss</span>}>Punishes confident misses hardest. Lower is better; a coin flip scores 0.693.</Key>
                                <Key sample={<span className="label text-fg-1">Calibration</span>}>
                                    Predicted versus actual win rate by probability bin. Dots on the dashed diagonal mean the probabilities are honest.
                                </Key>
                                <Key sample={<span className="text-model">◆ 62</span>}>
                                    In &ldquo;By confidence&rdquo;, the bar is how often picks in that band won; the diamond is what the model expected.
                                </Key>
                                <Key sample={<span className="rounded-chip border border-dashed border-warn/60 px-1 text-micro text-warn">BF</span>}>
                                    <strong>Back-filled</strong>: regenerated after the game. Listed on request, never counted in the report card.
                                </Key>
                                <Key sample={<span className="rounded-chip border border-line-strong px-1 text-micro text-fg-2">LEGACY</span>}>
                                    Published by the previous site model: graded, but not counted toward the bet gate.
                                </Key>
                            </dl>
                            <p>Overtime and shootout games count as wins and losses like any other.</p>
                        </Section>

                        <Section id="validation" index={++i} title="Validation">
                            {priorSummary ? (
                                <>
                                    <p>
                                        <strong>{prior} season</strong>, live predictions only
                                        {priorSummary.gameType ? ` (${priorSummary.gameType.replace(/^0?2$/, 'regular season')})` : ''}.
                                        {priorSummary.note ? ` ${priorSummary.note}` : ''}
                                    </p>
                                    <MetricsTable summary={priorSummary} />
                                </>
                            ) : (
                                <p className="panel border-dashed px-3 py-2 text-caption">
                                    {found ? `The ${prior} validation block is not in the current model report yet.` : 'The validation report publishes with the next pipeline run.'}{' '}
                                    The <Link href="/accuracy" className="font-semibold text-brand underline underline-offset-4">Accuracy page</Link> shows the graded record.
                                </p>
                            )}
                            {currentSummary ? (
                                <>
                                    <p>
                                        <strong>{current} so far.</strong>
                                    </p>
                                    <MetricsTable summary={currentSummary} />
                                </>
                            ) : (
                                <p>
                                    <strong>{current}:</strong>{' '}
                                    {tally.n
                                        ? `through ${tally.n} ${tally.n === 1 ? 'game' : 'games'}: ${tally.correct}-${tally.picks - tally.correct}${tally.n > tally.picks ? `, ${tally.n - tally.picks} no lean` : ''}${tally.legacyN ? ` (${tally.legacyN === tally.n ? 'all' : tally.legacyN} from the previous site model)` : ''}. The full report updates after the nightly refresh.`
                                        : 'no games graded yet. The first results post after the first games go final.'}
                                    {tally.excluded.length ? ` ${tally.excluded.length} ${tally.excluded.length === 1 ? 'game was' : 'games were'} not graded (no pregame snapshot before puck drop).` : ''}{' '}
                                    See the <Link href="/accuracy" className="font-semibold text-brand underline underline-offset-4">Accuracy page</Link>.
                                </p>
                            )}
                            {model.walkForward?.length ? (
                                <>
                                    <p>
                                        <strong>Walk-forward backtest.</strong> For each season below, the model was trained only on the seasons before it, then
                                        scored on every game of that season (regular season and playoffs)
                                        {model.walkForward.some(w => w.legacyLogLoss != null) ? ', next to the model it replaced' : ''}.
                                        {model.earlySeasonLogLoss != null ? ` In the first weeks of those seasons its log loss was ${model.earlySeasonLogLoss.toFixed(4)}.` : ''}
                                        {model.marketBacktest?.marketLogLoss != null
                                            ? ' Full seasons have no stored market prices; the MKT row compares the model with the de-vigged market on the games that do.'
                                            : ''}
                                    </p>
                                    <WalkForwardTable rows={model.walkForward} market={model.marketBacktest} />
                                </>
                            ) : null}
                            {model.notes ? <p>{model.notes}</p> : null}
                            {model.generatedAt ? (
                                <p className="label">
                                    Report {model.generatedAt.slice(0, 16).replace('T', ' ')} UTC
                                    {model.name ? ` · ${model.name}` : ''}
                                </p>
                            ) : null}
                        </Section>

                        <Section id="goalies" index={++i} title="Goalies">
                            <p>
                                Goalie strength is measured by <strong>goals saved above expected (GSAx)</strong>: expected goals against minus goals
                                actually allowed. Starting goalies come from team and beat-reporter reports (DailyFaceoff, ESPN). The name&apos;s colour
                                carries the status — green confirmed, faded green likely, grey projected — with no extra words on the card.
                            </p>
                        </Section>

                        <Section id="context" index={++i} title="Context chips">
                            <p>
                                The open panel under a game adds context the model uses or that fans ask about: recent form (L7, or L1–L6 early in the
                                season), head-to-head this season, power play and penalty kill, and rest (back-to-backs and compressed stretches). The
                                &ldquo;Why&rdquo; bars show how much each factor pushes the forecast toward one team, diverging from the centre in team
                                colours. They follow the same sample rules as above — this season first, prior-season values tagged.
                            </p>
                        </Section>

                        <Section id="players" index={++i} title="Players & standings">
                            <p>
                                <strong>Player ratings</strong> are expected goals per 60 minutes at even strength, compared with an average skater:{' '}
                                <strong>OFF</strong> (xG for), <strong>DEF</strong> (xG against prevented) and <strong>NET</strong> = OFF + DEF,
                                all higher = better. A ridge regression (RAPM) over every even-strength shift since 2010-11 separates each
                                skater from his linemates, opponents, score, zone starts and home ice. Each season starts from the previous estimate plus
                                an aging step and is updated daily with this season&apos;s games (the date beside the ratings is the last game day in),
                                so early in a season they are mostly built on the last three seasons; <strong>EV MIN</strong> shows that sample. The same
                                ratings drive the lineup term of the game model and the Lines tab. <strong>FIN</strong> (finishing) is goals above xG per 60
                                on his own even-strength shots, shrunk toward average; <strong>OFF+FIN</strong> = OFF + FIN. FIN is not part of NET.
                            </p>
                            <p id="standings" className="scroll-mt-[calc(var(--appbar-h)+16px)]">
                                <strong>Playoff odds</strong> come from simulating the rest of the season thousands of times with the same game model. On
                                Standings:
                            </p>
                            <dl>
                                <Key
                                    sample={
                                        <span aria-hidden="true" className="relative block h-2 w-24">
                                            <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
                                            <span className="absolute inset-y-0 left-[25%] w-[45%] rounded-[2px] bg-brand/20 ring-1 ring-inset ring-brand/45" />
                                            <span className="absolute left-[48%] top-1/2 h-2.5 w-0.5 -translate-y-1/2 bg-brand" />
                                        </span>
                                    }
                                >
                                    <strong>PROJ</strong>: average final points, with the band covering 80% of simulated seasons.
                                </Key>
                                <Key
                                    sample={
                                        <span aria-hidden="true" className="relative block h-1.5 w-24 overflow-hidden rounded-full bg-track">
                                            <span className="absolute inset-y-0 left-0 w-[64%] rounded-full bg-gradient-to-r from-brand/35 to-brand" />
                                        </span>
                                    }
                                >
                                    <strong>PO%</strong>: share of simulations in which the team makes the playoffs. DIV and CUP: wins the division, wins the
                                    Stanley Cup. 24H and 30D: change since yesterday and the last 30 days.
                                </Key>
                                <Key sample={<span aria-hidden="true" className="block w-24 border-t border-dashed border-brand/70" />}>
                                    The playoff line: teams above it are in on today&apos;s standings.
                                </Key>
                                <Key sample={<span className="rounded-chip border border-brand/45 px-1.5 text-micro tracking-[0.14em] text-brand">PROJ</span>}>
                                    Until every team has played about 20 games, the bracket is seeded from projected points and &ldquo;First round&rdquo; lists
                                    the series the simulations produced most often.
                                </Key>
                            </dl>
                        </Section>

                        <Section id="data-sources" index={++i} title="Data sources">
                            <dl>
                                <Key sample={<span className="label text-fg-1">NHL</span>}>
                                    api-web.nhle.com and api.nhle.com: schedule, results, play-by-play, shift charts, standings and betting lines from the
                                    NHL&apos;s public partner feed.
                                </Key>
                                <Key
                                    sample={
                                        <a href="https://moneypuck.com" className="label text-brand underline underline-offset-4" rel="noopener noreferrer" target="_blank">
                                            MoneyPuck
                                        </a>
                                    }
                                >
                                    Skater and goalie data used in player ratings. Data courtesy of MoneyPuck.com.
                                </Key>
                                <Key sample={<span className="label text-fg-1">DailyFaceoff</span>}>Projected lines, starting-goalie confirmations and player news.</Key>
                                <Key sample={<span className="label text-fg-1">ESPN</span>}>Injury reports and probable goalies.</Key>
                            </dl>
                            <p>
                                The data pipeline runs hourly from late morning to late evening Eastern on game days. The dot in the top bar shows when it
                                last finished and turns red only if a scheduled run was missed. Times show in your time zone.
                            </p>
                        </Section>

                        <section id="glossary" aria-labelledby="glossary-h" className="scroll-mt-[calc(var(--appbar-h)+16px)] border-t border-line pt-6">
                            <h2 id="glossary-h" className="heading-section flex items-baseline gap-3">
                                <span aria-hidden="true" className="font-sans text-caption font-bold tracking-[0.14em] text-brand">
                                    {String(++i).padStart(2, '0')}
                                </span>
                                Glossary
                            </h2>
                            <dl className="mt-3 grid gap-x-6 sm:grid-cols-2">
                                {GLOSSARY_TERMS.map(key => {
                                    const e = GLOSSARY[key] as { label: string; title: string; short: string; detail?: string; anchors?: string[] };
                                    return (
                                        <div
                                            key={key}
                                            id={`term-${key}`}
                                            className="scroll-mt-[calc(var(--appbar-h)+16px)] border-t border-line/60 py-2 target:pl-2 target:shadow-[inset_2px_0_0_var(--brand)] has-[:target]:pl-2 has-[:target]:shadow-[inset_2px_0_0_var(--brand)]"
                                        >
                                            <dt className="flex items-baseline justify-between gap-3">
                                                {e.anchors?.map(a => (
                                                    <span key={a} id={`term-${a}`} aria-hidden="true" className="w-0 scroll-mt-[calc(var(--appbar-h)+24px)]" />
                                                ))}
                                                <span className="font-display text-body font-semibold text-fg-1">{e.label}</span>
                                                {e.title !== e.label ? <span className="text-right text-micro uppercase tracking-[0.1em] text-fg-3">{e.title}</span> : null}
                                            </dt>
                                            <dd className="mt-0.5 text-caption text-fg-2">
                                                {e.short}
                                                {e.detail ? <span className="mt-0.5 block text-fg-3">{e.detail}</span> : null}
                                            </dd>
                                        </div>
                                    );
                                })}
                            </dl>
                        </section>
                    </div>
                </div>
            </div>
        </main>
    );
}
