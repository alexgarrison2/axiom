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
import { ScrollRegion } from '@/components/ui/scroll-region';
import { parseReport, type MarketBacktest, type MetricRow, type SeasonSummary, type WalkForwardRow } from './report';
import { MATINEE_HOUR, RETURN_HOME_REST, RIBBON_GAMES, ROAD_MI, STRETCH_GAMES } from '@/lib/schedule/metrics';

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
    { id: 'game-story', label: 'Game story' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'pony-score', label: 'Pony score' },
    { id: 'players', label: 'Players & standings' },
    { id: 'wowy', label: 'With or without' },
    { id: 'props', label: 'Player props' },
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
        <ScrollRegion label={`${summary.season} validation metrics`} className="panel">
            {/* Phones: labels and headers wrap and the badge sits over its number, so log loss stays on screen. */}
            <table className="table-dense min-w-[520px] max-sm:min-w-0 max-sm:[&_td]:!px-1.5 max-sm:[&_th]:!whitespace-normal max-sm:[&_th]:!px-1.5">
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
                                    {b === 'baseline' ? <span className="mr-2 text-micro uppercase tracking-[0.1em] text-neg max-sm:mr-0 max-sm:block max-sm:whitespace-normal max-sm:leading-[13px]">beats model</span> : null}
                                    {b === 'model' ? <span className="mr-2 text-micro uppercase tracking-[0.1em] text-pos max-sm:mr-0 max-sm:block max-sm:whitespace-normal max-sm:leading-[13px]">model better</span> : null}
                                    {fmt(r.logLoss, 4)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </ScrollRegion>
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
        <ScrollRegion label="Walk-forward backtest by season" className="panel">
            <table className="table-dense min-w-[520px] max-sm:min-w-0 max-sm:[&_td]:!px-1.5 max-sm:[&_th]:!whitespace-normal max-sm:[&_th]:!px-1.5">
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
        </ScrollRegion>
    );
}

function Section({ id, index, title, children }: { id: string; index: number; title: string; children: React.ReactNode }) {
    return (
        // Below lg the page's scroll-padding alone clears the app bar (the margin on top of it left a gap of a whole line).
        <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-[calc(var(--appbar-h)+16px)] border-t border-line pt-6 max-lg:scroll-mt-0">
            <h2 id={`${id}-h`} className="heading-section flex items-baseline gap-3">
                <span aria-hidden="true" className="font-sans text-caption font-bold tracking-[0.14em] text-brand">
                    {String(index).padStart(2, '0')}
                </span>
                {title}
            </h2>
            <div className="mt-3 max-w-[76ch] space-y-3 text-body-sm text-fg-2 max-md:text-body max-md:leading-[22px] [&_strong]:font-semibold [&_strong]:text-fg-1">{children}</div>
        </section>
    );
}

/** A legend row: the visual on the left, what it means on the right (phones: the visual over its text, which gets the full measure). */
function Key({ sample, children }: { sample: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-3 border-t border-line/60 py-2 first:border-t-0 max-sm:grid-cols-1 max-sm:gap-1.5 max-sm:py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
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
                                            <span className="whitespace-nowrap text-pos">✓ PICK</span> <span className="whitespace-nowrap text-neg">✕ PICK</span>
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
                                        <span className="flex flex-wrap items-center gap-x-2 font-display text-caption font-semibold uppercase">
                                            <span className="glow-blue">Conf</span>
                                            <span className="text-pos/60">Likely</span>
                                            <span className="text-fg-2">Proj</span>
                                        </span>
                                    }
                                >
                                    Goalie names by status: <span className="text-goalie">blue</span> confirmed, <span className="text-goalie/85">faded blue</span>{' '}
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
                                de-vigged market: the model carries <strong>80%</strong> of the weight and the market 20%, every game. The <strong>model diamond</strong> shows the unblended model, so you can
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
                                carries the status — blue confirmed, faded blue likely, grey projected — with no extra words on the card.
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

                        <Section id="game-story" index={++i} title="Game story">
                            <p>
                                Every finished or live game has a page with a <strong>story</strong> chart. The solid magenta line is the home
                                team&apos;s win probability from the <strong>score and the clock</strong>: it starts at our frozen pregame call and moves
                                only when a goal goes in, so it stays flat through a power play or a run of shots. The dashed magenta line is the
                                <strong> deserved</strong> win probability: every unblocked shot so far counted as a chance to score at its pony xG, with a
                                level game split evenly. Where the two lines part, finishing and goaltending made the difference. The scale stretches
                                near 0% and 100% so late movement in a lopsided game stays visible.
                            </p>
                            <p>
                                At puck drop the chart marks our call (PONY) and the de-vigged closing market (MKT). The coloured blocks in the strength
                                row belong to the team with the extra skater (5v4, 5v3, 6v5 with the goalie pulled); amber ticks mark penalty calls. Dots
                                at the edges of the bar lane are chances worth at least 0.20 xG that did not go in. The
                                Share view replaces the bars with a rolling five-minute xG share.
                            </p>
                        </Section>

                        <Section id="schedule" index={++i} title="Schedule">
                            <p>
                                A team page&apos;s <strong>Schedule</strong> tab reads the NHL&apos;s full schedule with venues. The strip puts every game
                                on one day axis (home above the line, road below), so rest shows as spacing. <strong>Rest</strong> is whole days off
                                between game dates, for both teams; a <strong>back-to-back</strong> is no day off. The amber axis thickens inside
                                denser windows: 3 games in 4 days, 4 in 6, 5 in 8. A <strong>rest edge</strong> is a game where the opponent is on
                                the second night of a back-to-back and the team is not (a deficit is the reverse).
                            </p>
                            <p>
                                <strong>Travel</strong> is great-circle miles between arenas (a static table of the 32 rinks plus outdoor and Global
                                Series venues). A team flies venue to venue on a road trip and home between home games; with {RETURN_HOME_REST} or
                                more days off between two road games it flies home and starts a new trip. A venue more than {ROAD_MI} miles from
                                the home arena counts as the road, so a Winter Classic across town is a home game and a &ldquo;home&rdquo; game in
                                Stockholm is a trip. Real charter routes differ a little; the ranking between teams is what to read.
                            </p>
                            <p>
                                <strong>Body clock</strong> is the puck drop on the team&apos;s home clock: 7 PM in Vancouver is 10 PM for a team
                                from the East. We tag a <strong>late</strong> body clock from 9:30 PM, an
                                <strong> early</strong> one before 12:30 PM, and a <strong>day game</strong> when local puck drop is before{' '}
                                {MATINEE_HOUR - 12} PM.
                            </p>
                            <p>
                                <strong>Difficulty</strong> (0-100) is how hard a game is for an average team: the opponent&apos;s strength (this
                                season&apos;s team ratings; a finished season uses its xG share and points %), home ice, and either side being on a
                                back-to-back, through a logistic curve where 50 is an even game. The grey ribbon is its {RIBBON_GAMES}-game rolling
                                mean; the toughest stretch is the hardest {STRETCH_GAMES} games in a row. A <strong>trap</strong> is a game against a
                                bottom-third team on a back-to-back, at the end of a road trip of four or more, or right before a top-five opponent.
                                Win % on games ahead is our model (the day&apos;s published prediction, else the season simulation).
                            </p>
                        </Section>

                        <Section id="pony-score" index={++i} title="Pony score">
                            <p>
                                The <strong>Pony Score</strong> is a skater&apos;s game in <strong>goals</strong>, on the same footing as IMPACT (one
                                is a single night, the other a rating). Every weight comes from our own data (three regular seasons, refit with{' '}
                                <code>pipeline/tools/pony_score_calibrate.py</code>); the only fixed choice is that an on-ice chance is shared
                                evenly by the five skaters on the ice.
                            </p>
                            <ul className="list-disc space-y-1 pl-5">
                                <li>
                                    <strong>Production</strong>: the pony xG of his own shots, plus finishing (goals minus that xG) and primary and
                                    secondary assists at the weights a fit of every skater&apos;s IMPACT offence on those rates gives (forwards: an
                                    assist is worth 0.56 of a goal of his own xG, finishing 0.70; defencemen 0.36 and 0.51); penalties drawn and taken
                                    at what a power play is worth in net goals (0.18); faceoffs at the pony xG a win in an end zone or at centre
                                    produces in the next 20 seconds; and on defence, each blocked attempt at the pony xG of an attempt from that
                                    distance.
                                </li>
                                <li>
                                    <strong>Play driving</strong>: at 5-on-5, a fifth of his linemates&apos; score-adjusted pony xG for (his own
                                    shots are already in production) and of the pony xG against while he was on, each against the league rate over
                                    his minutes.
                                </li>
                                <li>
                                    <strong>Special teams</strong>: the same on the power play (linemates&apos; xG for) and the penalty kill (xG
                                    against), against the league&apos;s 5-on-4 rate.
                                </li>
                                <li>
                                    <strong>Usage</strong>: who he shared the ice with, from their IMPACT ratings. Facing strong defenders or
                                    attackers adds a little; playing beside strong linemates takes a little off.
                                </li>
                            </ul>
                            <p>
                                Goalies score goals saved above expected. One game is a small sample: the score describes the night, it does not
                                rate the player.
                            </p>
                        </Section>

                        <Section id="players" index={++i} title="Players & standings">
                            <p>
                                <strong>IMPACT</strong> is the goals a skater adds over 82 games compared with an average forward or defenceman:
                                even strength, power play, penalty kill, finishing and penalties, each scaled by his expected ice time.{' '}
                                <strong>IMPACT</strong> = OFF + DEF, all higher = better: <strong>OFF</strong> (goals/82) is even-strength and power-play
                                chances created, finishing and penalties drawn; <strong>DEF</strong> (goals/82) is even-strength and penalty-kill chances
                                prevented, minus penalties taken; <strong>PEN</strong> is the penalty part of both.
                            </p>
                            <p>
                                <strong>PROD</strong>: production score, a recency-weighted Game Score (goals, assists, shots, on-ice 5v5 shots and goals,
                                penalties, faceoffs, blocks) per 82 games above his position&apos;s average. Descriptive, like The Athletic&apos;s;{' '}
                                <strong>IMPACT</strong> is the predictive rating.
                            </p>
                            <p>
                                The per-60 rates behind it, against his position&apos;s average: <strong>EV OFF</strong> and <strong>EV DEF</strong> (xG for
                                created, xG against prevented at even strength), <strong>PP</strong> and <strong>PK</strong> (the same on special teams,
                                grey under 30 seconds a game) and <strong>FIN</strong> (goals above xG on his own shots, shrunk). A ridge regression (RAPM)
                                separates each skater from his linemates, opponents, score, zone starts and home ice; a box-score prior steadies small
                                samples and rookies start from a prior for their position. Recent games weigh most (90-game half-life) and nothing older
                                than about three seasons counts; the date beside the ratings is the last game day in, and <strong>EV MIN</strong> shows the
                                sample. The same ratings feed the team tables (as even-strength <strong>NET</strong> = EV OFF + EV DEF), the Lines tab and
                                the game model&apos;s lineup term.
                            </p>
                            <p id="standings" className="scroll-mt-[calc(var(--appbar-h)+16px)] max-lg:scroll-mt-0">
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

                        <Section id="wowy" index={++i} title="With or without">
                            <p>
                                A skater&apos;s 5-on-5 minutes (five skaters and a goalie a side, regular season) split three ways for each of his
                                most-used teammates, after HockeyViz: <strong>together</strong> (filled dot), <strong>him apart</strong>, on the ice
                                without that teammate (ring), and the <strong>mate apart</strong>, the teammate without him (diamond). Each point is a
                                raw rate, pony xG for per 60 across and xG against per 60 down with fewer against at the top, never a share, so a
                                pairing that slows both ends of the game looks different from one that speeds both up. Faint diagonals mark equal xG
                                differential; the corners read GOOD (more for, less against), BAD, FUN (lots of both) and DULL (little of either).
                            </p>
                            <p>
                                The line through each teammate&apos;s three points passes through the <strong>+</strong>, the player&apos;s own 5-on-5
                                rates, because his minutes with and without that teammate average to it. A teammate is listed with 100 minutes
                                together over a full season, scaled down with the share of the season played and never below 10 minutes; an apart
                                sample under 10 minutes (or a quarter of that bar) gets no point. A traded player has one chart per team. Rates
                                describe who he played with; they do not separate his effect from his linemates&apos; (IMPACT does).
                            </p>
                        </Section>

                        <Section id="isolated-impact" index={++i} title="Isolated impact">
                            <p>
                                Where on the ice a skater changes the shots, after HockeyViz&apos;s isolated impact. Every 5-on-5 stretch with no
                                line change gives two rows, one per attacking team: the unblocked shots of that stretch, binned on the offensive half
                                of the rink, per hour. One ridge regression fits all the cells at once, with an offence column for each attacking
                                skater, a defence column for each defender, and the score, home ice, a third-period shell and the faceoff zone that
                                started the shift as controls. A player&apos;s map is the difference his presence makes, cell by cell, against an
                                average skater in his place with the same teammates and opponents, smoothed with a 10-foot kernel.
                                <strong> Orange</strong> means more shots than average come from there, <strong>blue</strong> fewer: on offence
                                orange is good, on defence blue is. The net is at the top and the shooter&apos;s left is on the left. The
                                defence map is the opponents&apos; shots in his own zone while he is on the ice. Each map type (5-on-5 offence,
                                defence, power play, penalty kill) is drawn on its own scale: the bands are quantiles of that type&apos;s cells
                                across the league&apos;s regulars, the faintest from the median cell up, the same for every player, so two
                                defence maps compare directly. Defence effects are smaller and less repeatable than offence ones, so read a
                                defence map&apos;s faint bands as tendency, not certainty.
                            </p>
                            <p>
                                The number on each map is the same regression on pony xG instead of shot counts: xG for (or against) per 60 he adds
                                and the share of the league rate. The power play (5-on-4) and the penalty kill have their own regression. A
                                season&apos;s maps use that season and the two before it, each game weighted down by half per year of age, so a map is
                                stable in October and still moves with every game. Under 500 5-on-5 minutes the sample is thin and marked.
                            </p>
                            <p>
                                The total is <strong>goals over a standard season</strong>: 1,000 minutes at 5-on-5, 125 on the power play and 125
                                on the penalty kill with average teammates and opponents, so players with very different roles compare on one
                                scale. Its parts: the four xG impacts; <strong>finishing</strong>, goals above xG on his own shots shrunk toward
                                average (60 xG of prior), times his shot volume; <strong>drawing</strong> and <strong>taking</strong>, minor
                                penalties per 60 against his position&apos;s average (shrunk with 600 minutes), at the league&apos;s net power-play
                                xG per minor. Passing (&ldquo;setting&rdquo;) is left out: without pass data, the best proxy, how often teammates&apos;
                                shots beat their own finishing with him on the ice, showed no out-of-sample signal.
                            </p>
                            <p>
                                Beside the parts, <strong>goal threat</strong> and <strong>penalties</strong> show where he sits among the
                                regulars at his position (forwards or defence, 500+ minutes): the league as a mirrored density with a line at its
                                median, his dot, and his percentile, with fewer penalties taken ranking higher. Goal threat is finishing (goals per
                                xG) and <strong>shooting</strong>, his own 5-on-5 xG per 60, shrunk with 300 minutes; shooting is shown, not
                                added to the total, because his own shots already count in his 5-on-5 offence.
                            </p>
                            <p>
                                From one season to the next the 5-on-5 offence impact repeats at r = 0.50-0.55, defence 0.36-0.40, the power play
                                0.31-0.53, the penalty kill 0.13-0.18, finishing 0.12-0.25, shooting 0.65-0.75, penalties drawn 0.58-0.64 and taken
                                0.69-0.71; the
                                offence maps&apos; shape repeats (0.25 per player, about 0 for two random players), defence less (0.11). The 5-on-5
                                impacts agree with IMPACT&apos;s even-strength ratings at r = 0.90 (offence) and 0.93 (defence).
                            </p>
                        </Section>
                        <Section id="props" index={++i} title="Player props">
                            <p>
                                The Props page takes one stat at a time (shots on goal, goals, points, assists, power-play points). Each row is a skater
                                on tonight&apos;s slate, on the line and power-play unit DailyFaceoff lists for him.
                            </p>
                            <dl>
                                <Key
                                    sample={
                                        <span aria-hidden="true" className="relative flex h-6 w-24 items-end gap-[2px]">
                                            {[1, 3, 0, 2, 4, 1, 2, 3].map((v, n) => (
                                                <span key={n} className={v >= 2 ? 'w-[5px] bg-brand' : 'w-[5px] bg-[var(--mute)]'} style={{ height: `${Math.max(2, v * 5)}px`, opacity: n < 3 ? 0.5 : 1 }} />
                                            ))}
                                            <span className="absolute inset-x-0 bottom-[7px] border-t border-fg-1/70" />
                                        </span>
                                    }
                                >
                                    <strong>The tape</strong>: his last 20 games, oldest to newest, one bar per game. The rule is the line; a bar that
                                    crosses it cashed the over and is lit. Early in a season the tape reaches back into last season&apos;s games, drawn faded
                                    behind a seam.
                                </Key>
                                <Key sample={<span className="label text-fg-1">L5 · L10 · L20</span>}>
                                    Share of his last 5, 10 and 20 games over the line, then this season; last season&apos;s rate is in the opened row.{' '}
                                    <strong>Heating up</strong>: his last five at least 25 points above that baseline.
                                </Key>
                                <Key sample={<span className="label text-model">Fair</span>}>
                                    The pony xG chance of the over. His shots, goals, assists, points and power-play points per minute, recent games weighted
                                    (60-game half-life), are shrunk toward his position&apos;s league rate, multiplied by his expected minutes (last few
                                    games weighted) and adjusted for the matchup: the opponent&apos;s shots allowed for shots on goal, the game model&apos;s
                                    expected goals for his team for the scoring props. Shots on goal use a negative binomial, the rest a Poisson count.
                                </Key>
                                <Key sample={<span className="label text-model">Proj</span>}>
                                    His expected count tonight (shots on goal, goals, points, assists or power-play points): the mean the fair chance is
                                    built from. For shots on goal the number under it is the projection minus the line.
                                </Key>
                                <Key sample={<span className="label text-fg-1">Book</span>}>
                                    Bovada&apos;s posted over price and its implied chance. Two-way lines (shots on goal) have the vig removed; one-way prices
                                    (anytime goal, points, assists, power-play points, marked *) still include it, so their edge reads low.
                                </Key>
                                <Key sample={<span className="label text-pos">Edge</span>}>
                                    Fair minus book, in percentage points.
                                </Key>
                                <Key sample={<span className="label text-warn">Elite linemate</span>}>
                                    A plus-money point scorer on the same forward line or power-play unit as a teammate priced -200 or shorter to record a
                                    point.
                                </Key>
                                <Key sample={<span className="label text-fg-1">Att/G</span>}>
                                    Shot attempts per game: on net, missed and blocked (NHL stats feed). Opening a row draws them as a hollow column
                                    behind each shots-on-goal bar, so a skater firing often but missing the net stands out. <strong>On net</strong> is the share
                                    that reached the goalie.
                                </Key>
                                <Key sample={<span className="label text-model">ixG</span>}>
                                    Individual expected goals: the pony xG shot model summed over his unblocked attempts in a game. Goals against ixG over
                                    his last 20 games shows whether he is finishing above or below his chances.
                                </Key>
                                <Key sample={<span className="label text-fg-1">Opened row</span>}>
                                    Also shows time on ice and power-play time against his last 20, his rate on the line at home and on the road over two
                                    seasons, his last 10 games against tonight&apos;s opponent (back to 2022-23), the opposing goalie&apos;s pony xG
                                    goals saved above expected per game, and each team&apos;s days of rest.
                                </Key>
                            </dl>
                            <p>
                                <strong>Validation.</strong> Replayed over the 2025-26 season from mid-November (35,261 skater games, each priced from
                                earlier games only), the fair chances beat both the league base rate and the skater&apos;s own last-10 hit rate on every
                                prop by log loss: shots on goal o1.5 0.612 against 0.684 for the base rate and 0.786 for last-10, anytime goal 0.401
                                against 0.431 and 0.500, 1+ point 0.600 against 0.649 and 0.734. Predicted and observed rates agree within about a point
                                in every 10% bin. A raw last-10 hit rate predicts worse than the league average: the tape shows form, the fair price is
                                the number to bet against.
                            </p>
                        </Section>

                        <Section id="data-sources" index={++i} title="Data sources">
                            <dl>
                                <Key sample={<span className="label text-fg-1">NHL</span>}>
                                    api-web.nhle.com and api.nhle.com: schedule, results, play-by-play, shift charts, standings and betting lines from the
                                    NHL&apos;s public partner feed.
                                </Key>
                                <Key
                                    sample={
                                        <a href="https://moneypuck.com" className="label text-brand underline underline-offset-4 coarse:-my-3 coarse:inline-block coarse:py-3" rel="noopener noreferrer" target="_blank">
                                            MoneyPuck
                                        </a>
                                    }
                                >
                                    Skater and goalie data used in player ratings. Data courtesy of MoneyPuck.com.
                                </Key>
                                <Key sample={<span className="label text-fg-1">DailyFaceoff</span>}>Projected lines, starting-goalie confirmations and player news.</Key>
                                <Key sample={<span className="label text-fg-1">ESPN</span>}>Injury reports and probable goalies.</Key>
                                <Key sample={<span className="label text-fg-1">Bovada</span>}>Player prop prices, refreshed hourly before puck drop.</Key>
                            </dl>
                            <p>
                                The data pipeline runs hourly from late morning to late evening Eastern on game days. The dot in the top bar shows when it
                                last finished and turns red only if a scheduled run was missed. Times show in your time zone.
                            </p>
                        </Section>

                        <section id="glossary" aria-labelledby="glossary-h" className="scroll-mt-[calc(var(--appbar-h)+16px)] border-t border-line pt-6 max-lg:scroll-mt-0">
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
                                            className="scroll-mt-[calc(var(--appbar-h)+16px)] border-t border-line/60 py-2 max-lg:scroll-mt-0 target:pl-2 target:shadow-[inset_2px_0_0_var(--brand)] has-[:target]:pl-2 has-[:target]:shadow-[inset_2px_0_0_var(--brand)]"
                                        >
                                            <dt className="flex items-baseline justify-between gap-3">
                                                {e.anchors?.map(a => (
                                                    // Out of the flow so justify-between pairs the label with its title (in flow it centred the label).
                                                    <span key={a} id={`term-${a}`} aria-hidden="true" className="absolute w-0 scroll-mt-[calc(var(--appbar-h)+24px)] max-lg:scroll-mt-2" />
                                                ))}
                                                <span className="font-display text-body font-semibold text-fg-1 max-lg:shrink-0">{e.label}</span>
                                                {e.title !== e.label ? <span className="text-right text-micro uppercase tracking-[0.1em] text-fg-3">{e.title}</span> : null}
                                            </dt>
                                            <dd className="mt-0.5 text-caption text-fg-2 max-md:text-body-sm max-md:leading-5">
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
