/**
 * Client-safe types for the home slate (predictions data contract v2,
 * pipeline/CONTRACT.md). Every nullable field is `null` when the CSV cell is
 * empty: empty means "no data yet", never a neutral placeholder.
 */

export type Side = 'home' | 'away';

export type GameState = 'FUT' | 'PRE' | 'LIVE' | 'CRIT' | 'FINAL' | 'OFF';

export type PredictionStatus = 'pregame' | 'frozen' | 'no_pregame_prediction' | 'no_model';

export interface TeamRef {
    triCode: string;
    /** "Hurricanes" */
    commonName: string;
    /** "Carolina Hurricanes" */
    name: string;
    logoUrl: string;
}

export interface WpFactor {
    factor: string;
    /** Omitted in the page payload for factors the UI already names. */
    label?: string;
    /** Win-probability points toward the HOME team. */
    wp_delta_pts: number;
}

export interface RecentGame {
    /** "10/18" */
    date: string;
    /** "2026-10-18" (may be missing on legacy rows) */
    gameDate?: string;
    gameId?: number;
    gameType?: string;
    /** "G12" or "PO G3" */
    gameNumber?: string;
    opponent: string;
    isHome: boolean;
    score: string;
    result: string;
    starter?: string;
}

/** Everything that differs by side. */
export interface SideData {
    team: TeamRef;
    modelWinPct: number | null; // model-only (before market blend)
    winPct: number | null; // published
    fairOdds: string | null;
    marketOdds: number | null;
    marketWinPct: number | null; // de-vigged
    ev: number | null; // fraction
    xg: number | null;
    // season context
    gp: number;
    l7: string | null;
    l7N: number;
    l7Label: string | null;
    h2hRecord: string | null;
    h2hPrev: string | null;
    locRecord: string | null;
    locGp: number;
    ppRank: number | null;
    pkRank: number | null;
    ppPct: number | null;
    pkPct: number | null;
    ppOpps: number | null;
    pkOpps: number | null;
    ppRankPrev: number | null;
    pkRankPrev: number | null;
    restDays: number | null;
    isB2b: boolean;
    gamesInLast4: number | null;
    roadTripGameN: number | null;
    // goalies
    goalie: string | null;
    goalieStatus: string | null; // Confirmed / Likely / Unconfirmed / Probable (ESPN)
    goalieStatusSource: string | null;
    goalieStatusAt: string | null;
    goalieCur: string | null; // "(W-L-OTL) | .SV% | GAA"
    goaliePrev: string | null;
    goalieCurGp: number | null;
    goaliePo: string | null; // only game_type 03
    gsax: number | null;
    gsaxPct: number | null;
    vsOpp: { label: string; record: string; sv: number; gaa: number } | null;
    // lineup
    lineupScore: number | null;
    lineupMatched: number | null;
    // extended markets
    puckline: number | null;
    pucklineSpread: string | null;
    firstPeriodMl: number | null;
    threeWay: number | null;
    /** Current-season W-L-OTL (NHL standings, or derived early in the season). */
    record: string | null;
    /** Has non-goalie news (drives the news dot). */
    hasNews: boolean;
}

/**
 * One broadcaster to show on the card (pipeline fetch_upcoming.select_tv):
 * US national feeds (market N), else the away/home US regional feeds tagged
 * with their team, else (Canada-only games) the Canadian national feed.
 */
export interface TvBroadcast {
    network: string;
    /** N national, H home regional, A away regional. */
    market: 'N' | 'H' | 'A';
    /** Tri-code of the team whose regional feed this is; null for national or shared feeds. */
    team: string | null;
    country: 'US' | 'CA';
}

export interface Prediction {
    /** 10-digit NHL game id — the join key everywhere. */
    id: string;
    /** Legacy SiteHistory key "YYYY-MM-DD-Away-Home". */
    legacyId: string;
    seasonId: string;
    /**
     * Set by the slate (never parsed): every game on this day is a season
     * opener for both teams, so the opener chip carries no information.
     */
    slateAllOpeners?: boolean;
    gameType: string; // "02" / "03"
    date: string; // NHL (Eastern) game date
    startTimeUtc: string;
    gameState: GameState;
    status: PredictionStatus;
    contextSeason: string | null;
    predictedAt: string | null;
    modelVersion: string | null;
    preseasonPrior: boolean;
    blendWeight: number | null;
    evGated: boolean;
    betSide: Side | null;
    units: number | null;
    gateReason: string | null;
    marketSource: string | null;
    marketFetchedAt: string | null;
    expectedTotal: number | null;
    breakdown: WpFactor[];
    pickSummary: string | null;
    confidenceGrade: string | null;
    confidenceNote: string | null;
    h2hGp: number;
    h2hPrevGp: number | null;
    totalLine: string | null;
    totalOver: number | null;
    totalUnder: number | null;
    threeWayTie: number | null;
    /** First broadcaster's network (legacy single-string field; prefer tvBroadcasts). */
    tvNetwork: string | null;
    tvBroadcasts: TvBroadcast[];
    home: SideData;
    away: SideData;
    /** Game-simulator markets (contract v2.2); undefined on older rows. */
    markets?: SimMarkets;
}

/**
 * One outcome of a simulated market. Every field is optional: undefined
 * means the CSV cell is empty or the column is absent (older rows).
 */
export interface MarketOutcome {
    /** Posted American price, when the row carries it. */
    price?: number;
    /** Model probability, % to one decimal. */
    pct?: number;
    /** Fair American price of `pct` ("+124"; a push excluded). */
    fair?: string;
    /** EV at the posted price, fraction of the stake (-0.0457 = -4.57%). */
    ev?: number;
}

export interface TwoWayMarket {
    away?: MarketOutcome;
    home?: MarketOutcome;
}

export interface ThreeWayMarket extends TwoWayMarket {
    tie?: MarketOutcome;
}

/**
 * Derivative markets from the game simulator (pipeline/CONTRACT.md, "Game
 * simulator"). Posted prices that predate v2.2 (puck line, total, regulation
 * 3-way, 1st-period moneyline) stay on Prediction / SideData; only the
 * 1st-period 3-way prices are carried here.
 */
export interface SimMarkets {
    /** sim: simulated; poisson_fallback: an estimate from the goal model. */
    status?: 'sim' | 'poisson_fallback';
    /** sim_ev_gated: true only once the derivative edges' gate opens (always false today). */
    evGated?: boolean;
    gateReason?: string;
    /** Regulation 3-way (after 60 minutes). */
    reg?: ThreeWayMarket;
    /** Puck line; `spread` is the home side's ("-1.5"), the away side's is its negative. */
    pl?: TwoWayMarket & { spread?: string };
    /** Game total at `line`; pushPct is P(total = line), 0 on half lines. */
    total?: { line?: string; over?: MarketOutcome; under?: MarketOutcome; pushPct?: number };
    /** 1st-period 3-way. */
    p1?: ThreeWayMarket;
    /** 1st-period 2-way, ties refunded. */
    p1TwoWay?: TwoWayMarket;
}

/** Heavy per-game data, loaded on first expand (app/api/matchup-details). */
export interface LineupPlayerView {
    /** NHL player id when resolved, else null. */
    playerId: number | null;
    name: string;
    /** "Tkachuk", or "B. Tkachuk" when two players in the lineup share a last name. */
    display: string;
    pos: string;
    ppUnit: number | null;
    movement: 'up' | 'down' | 'new' | null;
    /** RAPM NET, EV xG/60 above average (player_ratings.json), keyed by NHL id; null = no NHL sample yet. */
    impact: number | null;
}

export interface LineImpact {
    total: number;
    rank: number;
    outOf: number;
    pct: number;
}

export interface InjuryView {
    name: string;
    display: string;
    pos: string;
    status: string;
    /** Injury type, short: "LB", "UB", "Knee". */
    detail: string | null;
    /** "Oct 13" */
    returnLabel: string | null;
}

export interface GoalieView {
    name: string;
    starter: boolean;
    cur: { w: number; l: number; ot: number; svpct: number; gaa: number; gp: number } | null;
    prev: { w: number; l: number; ot: number; svpct: number; gaa: number; gp: number } | null;
    gsaxPerGame: number | null;
    /** Season window of the regressed GSAx rating ("2024-25 to 2026-27"). */
    gsaxSeason: string | null;
    /** GSAx per start this season (empty-net goals excluded, as on the team page); null before his first start. */
    gsaxCur?: number | null;
    /** Starts behind gsaxCur. */
    gsaxCurGp?: number;
    /** Injury tag when the goalie is on IR / out ("IR", "Dec 30"). */
    injury?: { status: string; returnLabel: string | null } | null;
}

export interface SideDetails {
    lines: Record<string, LineupPlayerView[]>; // f1..f4, d1..d3
    lineImpacts: Record<string, LineImpact | null>;
    grade: { value: number; rank: number | null; outOf: number } | null;
    lineupSource: string | null;
    lineupUpdatedAt: string | null;
    injuries: InjuryView[];
    goalies: GoalieView[];
    recent: RecentGame[];
    news: { player: string; news: string; category: string; date: string; timestamp?: string }[];
}

export interface MatchupDetails {
    home: SideDetails;
    away: SideDetails;
    /** Season id of the player ratings behind the lineup NET values (the RAPM file: this season). */
    impactSeason?: string | null;
}

export interface MatchupDetailsPayload {
    generatedAt: string;
    games: Record<string, MatchupDetails>;
    /** This season's graded picks per team on the slate. */
    picks: PickSummaries;
}

/** Server-computed, current season, last 10 graded picks per team. */
export interface PickSummary {
    /** Newest last. true = pick was correct. */
    pickedWin: boolean[];
    pickedLose: boolean[];
}

export type PickSummaries = Record<string, PickSummary>;
