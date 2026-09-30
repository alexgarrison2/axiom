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
        label: 'Fair odds',
        title: 'Fair odds (forecast line)',
        short: "The moneyline that matches our published forecast, with no bookmaker margin. Formerly labelled \"xOdds\".",
        detail: 'A 60% forecast is a fair line of −150; 40% is +150. Compare it with the book line to see where we disagree with the market. The "Model only" line is the same conversion applied to the unblended model.',
        anchor: 'market',
        aliases: ['xOdds', 'model line', 'model odds'],
    },
    edge: {
        label: 'Edge',
        title: 'Edge / expected value (EV)',
        short: 'How much better the model thinks a bet is than the market price. Positive edge means the model rates the team higher than the odds do.',
        detail: 'EV = model probability × decimal odds − 1. Edges and stakes stay hidden until the model has proven it can beat the market over a meaningful sample of live games (the edge gate); the Accuracy page shows the gate’s status.',
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
        label: 'After N games',
        title: 'After N games',
        short: 'How many games this season a number is based on, e.g. "after 1 game". Fewer games means more noise.',
        detail: 'Shown instead of a bare n= so small samples are obvious. Once a team has played enough games the label goes away.',
        anchor: 'early-season',
        aliases: ['n=', 'games played', 'GP'],
    },
    units: {
        label: 'Units',
        title: 'Suggested stake (units)',
        short: 'A suggested bet size in units, where 1 unit is your standard stake. Shown only when the edge gate is open.',
        detail: 'Sized with a fractional Kelly formula and capped. Every suggestion is recorded in the public bet ledger on the Accuracy page.',
        anchor: 'edge',
        aliases: ['u', 'stake', 'kelly'],
    },
    'projected-goals': {
        label: 'Proj. goals',
        title: 'Projected goals (xG)',
        short: 'How many goals the model expects each team to score tonight.',
        detail: 'Expected goals (xG) weigh every shot by how often shots like it go in, based on location, type and situation. Projected goals combine each team’s xG for and against with goaltending and special teams.',
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
        aliases: ['confidence grade', 'tier'],
    },
    rest: {
        label: 'Rest / B2B',
        title: 'Rest days and back-to-backs',
        short: 'Days since each team last played. B2B means the second night of a back-to-back, which historically costs a team a little.',
        detail: 'Also flags compressed stretches such as 3 games in 4 nights (3in4). Computed from the full schedule, including tomorrow’s games.',
        anchor: 'context',
        aliases: ['B2B', 'back-to-back', 'rest days', '3in4', '4in6', 'fatigue'],
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
    'player-impact': {
        label: 'Impact',
        title: 'Player impact rating',
        short: 'A player’s estimated contribution to his team’s goal differential per 60 minutes, relative to an average player.',
        detail: 'Blends even-strength offence and defence with power-play and penalty-kill value, using a ridge-regression (RAPM-style) model that separates a player from his linemates.',
        anchor: 'players',
        aliases: ['impact', 'RAPM'],
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
