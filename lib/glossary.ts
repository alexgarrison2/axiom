/**
 * The single source of truth for every term the site explains.
 *
 * Rendered by <InfoTip term="…"> (components/ui/info-tip.tsx) and listed in
 * full on /methodology#glossary. Add a term here before using it in an
 * InfoTip — a vitest check fails on any InfoTip whose term is missing.
 *
 * Copy rules: say what the number means for tonight's game in one or two
 * plain sentences, then (optionally) how it is computed. No jargon in the
 * first sentence.
 */

export interface GlossaryEntry {
    /** Display label, as it appears in the UI. */
    label: string;
    /** Longer name (for headings and screen readers). */
    title: string;
    /** Plain-language definition (1–2 sentences). */
    short: string;
    /** Optional detail: how it's computed, caveats. */
    detail?: string;
    /** Anchor on /methodology for "Learn more". */
    anchor?: string;
    /** Other names users might search for. */
    aliases?: string[];
    /**
     * Extra ids this entry answers to on /methodology (without the "term-"
     * prefix), for chips whose label differs from the entry key, e.g. B2B →
     * the rest entry. Every id resolves to #term-<id>.
     */
    anchors?: string[];
}

export const GLOSSARY = {
    'model-pct': {
        label: 'Our forecast',
        title: 'Our forecast (published win probability)',
        short: "Our published chance that this team wins the game, including overtime and the shootout. It blends the model with the de-vigged betting market.",
        detail: 'The model (team strength from expected goals, goaltending, rest and home ice) is blended with the de-vigged market price. Early in the season the market carries 80% of the weight (the model 20%), and the model’s share grows as teams play more games. "Model only" shows the unblended model.',
        anchor: 'the-model',
        aliases: ['Model %', 'win probability', 'win %', 'model probability', 'blend', 'blended forecast'],
    },
    'market-pct': {
        label: 'Market %',
        title: 'Market probability (de-vigged)',
        short: "The betting market's implied chance that this team wins, with the bookmaker's margin removed so both sides add up to 100%.",
        detail: 'Converted from the moneyline odds of both teams. The bookmaker’s margin (the "vig", about 4%) is removed with the power method, which takes a little more off longshots than favourites, so the two probabilities sum to 100%.',
        anchor: 'market',
        aliases: ['vegas %', 'implied probability', 'de-vigged', 'no-vig'],
    },
    'fair-odds': {
        label: 'xOdds',
        title: 'xOdds (fair odds of our forecast)',
        short: 'The moneyline that matches our published forecast, with no bookmaker margin.',
        detail: 'A 60% forecast is a fair line of −150; 40% is +150. Compare it with the book line to see where we disagree with the market. The odds under "Model" on the Odds tab are the same conversion applied to the unblended model.',
        anchor: 'market',
        aliases: ['fair odds', 'fair line', 'model line', 'model odds'],
    },
    edge: {
        label: 'Edge',
        title: 'Edge / expected value (EV)',
        short: 'Expected profit per unit staked at the book’s price. Positive means our forecast rates the team higher than the odds do.',
        detail: 'EV = forecast probability × decimal odds − 1, using the published (market-blended) forecast, not the model-only number. A bet shows only when one side clears +3% EV with a quarter-Kelly stake of 0.5u or more. Until the model has proven it can beat the market over a meaningful sample of live games (the bet gate), those bets are marked unofficial and stay out of the public ledger. The Accuracy page shows the gate’s status.',
        anchor: 'edge',
        aliases: ['EV', 'expected value', '+EV'],
    },
    'model-only': {
        label: 'Model only',
        title: 'Model-only probability',
        short: 'What our model says on its own, before it is blended with the betting market.',
        detail: 'The published forecast mixes this number with the de-vigged market (market 80% early in the season, less as games accumulate). Showing both lets you see where the model alone disagrees with the market.',
        anchor: 'the-model',
        aliases: ['pure model', 'unblended', 'raw model'],
    },
    priors: {
        label: 'Preseason ratings',
        title: 'Priors / preseason ratings',
        short: 'Each team’s starting strength before any games are played: last season’s rating, pulled part of the way back toward league average.',
        detail: 'Early in the season the model "leans on preseason ratings": this season’s few games move the numbers only a little until the sample grows.',
        anchor: 'early-season',
        aliases: ['priors', 'prior', 'preseason', 'model on priors', 'leans on preseason ratings'],
    },
    dfo: {
        label: 'DailyFaceoff',
        title: 'DailyFaceoff (DFO)',
        short: 'DailyFaceoff.com, a free public source for projected line combinations and starting goalies.',
        detail: 'We read its line and goalie pages each refresh. A goalie is "confirmed" only once DailyFaceoff or the team confirms the start.',
        anchor: 'context',
        aliases: ['DFO', 'Daily Faceoff', 'lines', 'starting goalies'],
    },
    'after-n': {
        label: 'n=',
        title: 'Sample size (n=)',
        short: 'How many games this season a number is based on, e.g. "L1 0-1-0 n=1". Fewer games means more noise.',
        detail: 'Small samples also get a dashed outline. Once a team has played enough games the n= and the outline go away.',
        anchor: 'early-season',
        aliases: ['After N games', 'games played', 'GP', 'sample size'],
        anchors: ['n'],
    },
    units: {
        label: 'Units',
        title: 'Suggested stake (units)',
        short: 'A suggested bet size in units, where 1 unit (1u) = 1% of bankroll. Shown only for +3% EV bets of 0.5u or more; marked unofficial while the bet gate is closed.',
        detail: 'Sized with quarter-Kelly and capped at 5u. Every suggestion is recorded in the public bet ledger on the Accuracy page, with its stake and result.',
        anchor: 'edge',
        aliases: ['u', 'stake', 'kelly'],
    },
    'projected-goals': {
        label: 'xG (projected)',
        title: 'Projected goals (xG)',
        short: 'How many goals each team is expected to score tonight, including the expected overtime goal.',
        detail: 'Derived from the published forecast: the goal totals are backed out of the win probability, so the team projected to score more is always the favourite.',
        anchor: 'the-model',
        aliases: ['xG', 'expected goals', 'projected xG'],
    },
    xg: {
        label: 'xG',
        title: 'Expected goals (xG)',
        short: 'The number of goals a team "should" have scored given the quality of its shots.',
        detail: 'Each shot gets a probability of becoming a goal from its distance, angle, shot type, rebound and game situation. Summing those probabilities gives xG.',
        anchor: 'the-model',
        aliases: ['expected goals', 'xGF', 'xGA', 'xG%'],
    },
    gsax: {
        label: 'GSAx',
        title: 'Goals saved above expected (GSAx)',
        short: 'How many goals a goalie has saved compared with an average goalie facing the same shots. Positive is good.',
        detail: 'GSAx = expected goals against − actual goals against. Shown per game and for the season; small samples are noisy, so early-season numbers are marked.',
        anchor: 'goalies',
        aliases: ['goals saved above expected', 'goalie rating'],
    },
    'pp-pk': {
        label: 'PP / PK',
        title: 'Power play / penalty kill',
        short: 'PP% is how often a team scores on the power play; PK% is how often it stops the opponent’s power play.',
        detail: 'Ranks (#1–#32) are hidden until a team has played enough games this season; before that we show last season’s rank, clearly labelled.',
        anchor: 'context',
        aliases: ['PP%', 'PK%', 'power play', 'penalty kill', 'special teams'],
    },
    'last-n': {
        label: 'L7',
        title: 'Last N games (L7, L5 …)',
        short: 'A team’s record over its most recent games this season, e.g. L7 = last 7 games.',
        detail: 'Only games from the current season count. Early in the season the window is shorter (L1–L6) and the chip says how many games it covers, e.g. "after 1 game".',
        anchor: 'context',
        aliases: ['L1', 'L5', 'last 7', 'recent form'],
    },
    h2h: {
        label: 'H2H',
        title: 'Head-to-head',
        short: 'This season’s results between these two teams.',
        detail: 'Resets every season. Last season’s series is shown only when labelled with its season.',
        anchor: 'context',
        aliases: ['head to head', 'season series'],
    },
    confidence: {
        label: 'Confidence',
        title: 'Confidence grade',
        short: 'How strongly the model favours one side: the further the win probability is from 50%, the higher the grade.',
        detail: 'Grades group picks into tiers (50–55%, 55–60%, 60–65%, 65%+). The Accuracy page shows how each tier has actually performed.',
        anchor: 'grading',
        aliases: ['confidence grade', 'tier', 'CONF'],
        anchors: ['conf'],
    },
    rest: {
        label: 'Rest / B2B',
        title: 'Rest days and back-to-backs',
        short: 'Days since each team last played. B2B means the second night of a back-to-back, which historically costs a team a little.',
        detail: 'Also flags compressed stretches such as 3 games in 4 nights (3in4). Computed from the full schedule, including tomorrow’s games.',
        anchor: 'context',
        aliases: ['B2B', 'back-to-back', 'rest days', '3in4', '4in6', 'fatigue'],
        anchors: ['b2b'],
    },
    'result-codes': {
        label: 'W / L / OTL / SOL',
        title: 'Result codes',
        short: 'W = win, L = regulation loss, OTL = overtime loss, SOL = shootout loss.',
        detail: 'Overtime and shootout losses still earn a team one standings point.',
        anchor: 'grading',
        aliases: ['W', 'L', 'OTL', 'SOL', 'OT', 'SO'],
    },
    'season-prior': {
        label: 'Prior season',
        title: 'Prior-season value',
        short: 'Last season’s number, shown because this season’s sample is still too small. Tagged with its season, e.g. 25-26.',
        detail: 'Faded and tagged so it never looks like this season’s data. It disappears once the team has played enough games.',
        anchor: 'early-season',
        aliases: ['last season', 'LY', '25-26'],
    },
    'small-sample': {
        label: 'Small sample',
        title: 'Small-sample value',
        short: 'This season’s number from only a few games (n = games played). Treat it as a hint, not a trend.',
        anchor: 'early-season',
        aliases: ['n=', 'sample size'],
    },
    'data-freshness': {
        label: 'Updated',
        title: 'Data freshness',
        short: 'When the data pipeline last finished. It runs hourly from late morning to late evening Eastern on game days.',
        detail: 'The dot turns red only if a scheduled run was actually missed.',
        anchor: 'data-sources',
        aliases: ['last updated', 'freshness'],
    },
    brier: {
        label: 'Brier',
        title: 'Brier score',
        short: 'Average squared error of the win probabilities. Lower is better; always guessing 50% scores 0.25.',
        anchor: 'grading',
        aliases: ['brier score'],
    },
    'log-loss': {
        label: 'Log loss',
        title: 'Log loss',
        short: 'Penalises confident wrong picks heavily. Lower is better; always guessing 50% scores 0.693.',
        anchor: 'grading',
        aliases: ['logloss', 'cross-entropy'],
    },
    calibration: {
        label: 'Calibration',
        title: 'Calibration',
        short: 'Whether a 60% pick wins about 60% of the time. A well-calibrated model’s dots sit on the diagonal.',
        anchor: 'grading',
        aliases: ['reliability', 'reliability diagram'],
    },
    'player-net': {
        label: 'NET',
        title: 'Net player rating (RAPM)',
        short: 'Expected goals per 60 minutes a skater adds at even strength, for minus against, compared with an average skater. +0.50 means his team out-chances opponents by half an expected goal per 60 more with him on the ice.',
        detail: 'NET = OFF + DEF. A ridge regression (RAPM) over every even-strength shift since 2010-11 separates each skater from his linemates, opponents, score state, zone starts and home ice; each season starts from last season’s estimate plus an aging step, rookies from the average of their position and draft tier, and this season’s games update it daily. Small samples stay close to average, so a hot week cannot top the list.',
        anchor: 'players',
        aliases: ['RAPM', 'net rating', 'player rating', 'impact', 'xG/60'],
    },
    'player-off': {
        label: 'OFF',
        title: 'Offensive rating',
        short: 'Expected goals for per 60 minutes at even strength with him on the ice, above an average skater. Higher is better.',
        anchor: 'players',
        aliases: ['offence', 'offense', 'xGF/60 impact'],
    },
    'player-fin': {
        label: 'FIN',
        title: 'Finishing rating',
        short: 'Goals above expected per 60 minutes at even strength on his own shots, pulled toward average on small samples. Higher is better. Not part of NET.',
        anchor: 'players',
        aliases: ['finishing', 'shooting talent', 'goals above expected', 'GAx/60'],
    },
    'player-off-fin': {
        label: 'OFF+FIN',
        title: 'Offence including finishing',
        short: 'OFF + FIN: the chances he creates on the ice plus how well he finishes his own. Higher is better.',
        anchor: 'players',
        aliases: ['total offence', 'off total'],
    },
    'player-def': {
        label: 'DEF',
        title: 'Defensive rating',
        short: 'Expected goals against per 60 minutes at even strength he prevents, compared with an average skater. Higher is better: +0.20 means 0.20 fewer xG allowed per 60 with him on the ice.',
        anchor: 'players',
        aliases: ['defence', 'defense', 'xGA/60 prevented', 'xGA/60 impact'],
    },
    'ev-min': {
        label: 'EV MIN',
        title: 'Rating sample (even-strength minutes)',
        short: 'Even-strength minutes behind a rating: the last three seasons plus this one. Ratings with under 250 minutes are not coloured.',
        anchor: 'players',
        aliases: ['sample', 'EV minutes', 'TOI'],
    },
    lean: {
        label: '◆ Lean',
        title: 'Model lean flag',
        short: 'Shown when the model on its own disagrees with the market by 8+ points: "◆ 61 NYI" means the model alone gives NYI 61%.',
        detail: 'The bar’s fill stays the published forecast; the flag only marks a big model-market gap. It is not a bet signal while the bet gate is closed.',
        anchor: 'reading',
        aliases: ['model lean', '◆', 'diamond'],
    },
    opener: {
        label: 'Opener',
        title: 'Season opener',
        short: 'The team has not played a game yet this season, so form, home/road and special-teams chips have nothing to show.',
        anchor: 'early-season',
        aliases: ['first game', 'OPENER', 'Opener · both'],
    },
    wt: {
        label: 'Wt',
        title: 'Model weight in the forecast',
        short: 'How much of the published forecast comes from the model; the market carries the rest. "Wt 20%" = model ×0.20, market ×0.80.',
        detail: 'The why-bars show model factors after this scaling, so a factor worth 7 points inside the model moves the forecast about 1.5 at Wt 20%. The weight grows as teams play more games.',
        anchor: 'market',
        aliases: ['weight', 'model weight', 'blend weight'],
    },
    po: {
        label: 'PO',
        title: 'Playoff',
        short: 'PO% is a team’s chance to make the playoffs across the season simulations. A PO chip on a graded pick marks a playoff game.',
        anchor: 'standings',
        aliases: ['PO%', 'playoff game'],
    },
    legacy: {
        label: 'LEGACY',
        title: 'Previous site model',
        short: 'A pick or bet published by the previous site model, before the current model went live. Graded, but not counted toward the bet gate.',
        anchor: 'grading',
        aliases: ['Prev. model', 'previous model', 'old model'],
    },
    'no-lean': {
        label: 'No lean',
        title: 'No lean (coin flip)',
        short: 'A forecast within 1 point of 50%. Neither side is favoured, so it is not graded as a pick right or wrong; Brier and log loss still count it.',
        anchor: 'grading',
        aliases: ['coin flip', 'NO LEAN', "pick'em"],
    },
    'back-filled': {
        label: 'BF',
        title: 'Back-filled',
        short: 'A forecast regenerated after the game, not one users saw before puck drop. Listed on request, never counted in the report card.',
        anchor: 'grading',
        aliases: ['back-filled out', 'retro', 'BF'],
    },
    'no-pick': {
        label: 'No pregame pick',
        title: 'No pregame pick',
        short: 'A final with no forecast frozen before puck drop, so it is left out of grading entirely.',
        anchor: 'grading',
        aliases: ['not graded', 'NO PREGAME PICK'],
    },
    disclaimer: {
        label: 'Info only',
        title: 'For information only',
        short: 'Nothing on this site is betting advice. Probabilities are estimates and can be wrong. 21+, 1-800-GAMBLER.',
        anchor: 'edge',
        aliases: ['INFO ONLY', 'responsible gambling', 'not advice'],
    },
    gate: {
        label: 'Gate',
        title: 'Bet gate',
        short: 'Edges and stakes stay hidden until the model has beaten the market over a meaningful sample of live games. The Accuracy page shows whether the gate is open or closed.',
        anchor: 'edge',
        aliases: ['GATE CLOSED', 'GATE OPEN', 'NO BET', 'bet gate'],
    },
    // ── Teams table columns ────────────────────────────────────────────────
    'points-pct': {
        label: 'P%',
        title: 'Points percentage',
        short: 'Standings points earned out of the maximum possible (2 per game). The fairest way to compare teams with different games played.',
        detail: 'P% = points ÷ (2 × games played). Regulation wins (RW) are the first tiebreaker.',
        aliases: ['points percentage', 'RW', 'regulation wins'],
    },
    'true-goals': {
        label: 'TruGF / TruGA',
        title: 'True goals (5-on-5 style scoring)',
        short: 'Goals per game with power-play and empty-net goals removed, so they show how a team scores and defends at even strength.',
        detail: 'TruGF = (goals − power-play goals − empty-net goals) ÷ games. TruGΔ is the season difference.',
        aliases: ['TruGF', 'TruGA', 'true goal differential'],
    },
    'pp-leverage': {
        label: 'PPLev / PKLev',
        title: 'Special-teams leverage',
        short: 'Share of a team’s goals scored on the power play (PPLev), or share of goals allowed while shorthanded (PKLev).',
        detail: 'A high PPLev means the offence leans on the power play, which tends to shrink in the playoffs.',
        aliases: ['PPLev', 'PKLev', 'leverage'],
    },
    'shot-attempts': {
        label: 'CF / CA',
        title: 'Shot attempts (Corsi)',
        short: 'All shot attempts for and against at 5-on-5 (on goal, missed and blocked) per game. A proxy for puck possession.',
        aliases: ['Corsi', 'CF', 'CA', 'attempts'],
    },
    'high-danger': {
        label: 'HDF / HDA',
        title: 'High-danger chances',
        short: 'Shots from the slot and crease area, where most goals are scored, per game for (HDF) and against (HDA).',
        aliases: ['HDF', 'HDA', 'high danger', 'slot shots'],
    },
    'control-score': {
        label: 'Control',
        title: 'Game-control score',
        short: 'How much of the game a team spent leading, weighted by the size of the lead. 1.000 is neutral; higher means more time in control.',
        detail: 'Weights per second: tied 1.0, up one 1.2, up two 1.5, up three+ 2.0, down one 0.8, down two 0.5, down three+ 0.',
        aliases: ['control', 'time leading', 'T↑', 'T↓'],
    },
    'lead-states': {
        label: 'NLW / NTW / NTL',
        title: 'Lead-state results',
        short: 'NLW = wins without ever leading in regulation, NTW = wins without ever trailing, NTL = losses without ever trailing.',
        aliases: ['NLW', 'NTW', 'NTL', 'no-lead wins'],
    },
    'blown-leads': {
        label: 'BL / CW',
        title: 'Blown leads and comebacks',
        short: 'BL counts games a team led and lost; CW counts games it trailed and won. (3P) = led or trailed after two periods; (2+)/(3+) = by that many goals.',
        aliases: ['BL', 'CW', 'blown lead', 'comeback'],
    },
    'empty-net': {
        label: 'Empty net',
        title: 'Empty-net play',
        short: 'EN GF/GA are empty-net goals. EN Att counts attempts at an empty net; ENS% is the share that scored. OtmL = losses where the team pulled its goalie and still lost.',
        aliases: ['EN', 'ENS%', 'OtmL', 'off the mat'],
    },
    'clinch-codes': {
        label: 'X / Y / Z / P / E',
        title: 'Clinch and elimination codes',
        short: 'From the NHL standings: X clinched a playoff spot, Y the conference, Z the division, P the Presidents’ Trophy; E is eliminated.',
        detail: 'Shown only for the season they belong to, so last spring’s codes never appear on opening night.',
        aliases: ['clinched', 'eliminated', 'X', 'Y', 'Z', 'E'],
    },
    'playoff-odds': {
        label: 'Playoff %',
        title: 'Playoff odds',
        short: 'How often a team made the playoffs across thousands of simulations of the rest of the season.',
        anchor: 'standings',
        aliases: ['playoff probability', 'projected points'],
    },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryTerm = keyof typeof GLOSSARY;

export const GLOSSARY_TERMS = Object.keys(GLOSSARY) as GlossaryTerm[];

export function isGlossaryTerm(term: string): term is GlossaryTerm {
    return Object.prototype.hasOwnProperty.call(GLOSSARY, term);
}

export function getGlossaryEntry(term: string): GlossaryEntry | undefined {
    return isGlossaryTerm(term) ? GLOSSARY[term] : undefined;
}

/** Every id a glossary entry answers to (its key plus any extra anchors). */
export function glossaryIds(term: GlossaryTerm): string[] {
    return [term, ...((GLOSSARY[term] as GlossaryEntry).anchors ?? [])];
}

/** Every #term-… anchor rendered on /methodology. */
export const GLOSSARY_ANCHORS: string[] = GLOSSARY_TERMS.flatMap(t => glossaryIds(t).map(id => `term-${id}`));

/** Link to a term on /methodology, e.g. glossaryHref('b2b') → "/methodology#term-b2b". */
export function glossaryHref(id: string): string {
    return `/methodology#term-${id}`;
}
