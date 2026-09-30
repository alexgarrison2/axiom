/**
 * Shared types for the Teams table (/teams) and team pages (/teams/[abbr]).
 *
 * One game row per team per game, parsed once on the server from
 * gamestats.csv (current season) or pipeline/nhl_historical_gamestats.csv
 * (past seasons). Everything here is plain data so it can cross the
 * server → client boundary and be tested without a DOM.
 */

export type ResultCode = 'RW' | 'OTW' | 'SOW' | 'RL' | 'OTL' | 'SOL';

/** NHL game type from digits 5-6 of the game id. */
export type GameType = 2 | 3;

export type PeriodFilter = 'All' | '1st' | '2nd' | '3rd' | 'OT';

/** Per-period values, index 0..3 = 1P, 2P, 3P, OT. */
export type Quad = [number, number, number, number];

export interface PeriodSplits {
    gf: Quad;
    ga: Quad;
    sf: Quad;
    sa: Quad;
    cf: Quad;
    ca: Quad;
    hdf: Quad;
    hda: Quad;
    xgf: Quad;
    xga: Quad;
    tl: Quad;
    tt: Quad;
    tti: Quad;
    ctrl: Quad;
}

export interface GameRow {
    id: string;
    date: string; // YYYY-MM-DD
    /** 8-digit season id, e.g. "20252026". */
    season: string;
    type: GameType;
    tri: string;
    opp: string;
    home: boolean;
    result: ResultCode;
    /** 1-based game number within (team, season, game type), oldest first. */
    gn: number;

    gf: number; // excludes the shootout-deciding goal (boxscore convention)
    ga: number;
    sf: number;
    sa: number;
    cf: number; // all-situation shot attempts
    ca: number;
    cf5: number; // 5v5 shot attempts
    ca5: number;
    hdf: number;
    hda: number;
    xgf: number;
    xga: number;
    /** xG against excluding empty-net shots (for GSAx); equals xga when the feed lacks it. */
    xgane: number;

    ppg: number;
    ppga: number;
    ppo: number;
    pko: number;
    ppt: number; // seconds
    pkt: number;
    saves: number;

    engf: number;
    enga: number;
    enppgf: number;
    enppga: number;
    enatt: number;
    enattag: number;

    tl: number; // seconds leading
    tt: number;
    tti: number;
    ctrl: number;
    sfirst: 0 | 1;
    bl1: number;
    bl2: number;
    bl3: number;
    cw1: number;
    cw2: number;
    cw3: number;

    starter: string;
    oppStarter: string;

    p: PeriodSplits;
}

export interface TeamMeta {
    tri: string;
    name: string; // "Edmonton Oilers"
    common: string; // "Oilers"
    division: Division;
    conference: 'Eastern' | 'Western';
    color: string;
}

export type Division = 'Atlantic' | 'Metro' | 'Central' | 'Pacific';

export interface TeamStat {
    tri: string;
    gp: number;
    wins: number;
    losses: number;
    otl: number;
    points: number;
    pt_pct: number;
    rw: number;
    row: number;
    ranking?: string;
    isPlayoff?: boolean;
    divRank?: number;
    clinch?: string | null;

    /** Standings convention: the shootout winner is credited one goal. */
    gf: number;
    ga: number;
    gf_per_game: number;
    ga_per_game: number;
    goal_diff: number;
    true_goal_diff: number;
    true_gf_per_game: number;
    true_ga_per_game: number;
    total_goals_per_game: number;

    pp_goals: number;
    pp_opps: number;
    pp_pct: number;
    pp_lev: number;
    pp_time_per_game: number; // seconds
    pp_time_per_goal: number | null; // seconds; null = no PP goals

    pk_goals_allowed: number;
    pk_opps: number;
    pk_pct: number;
    pk_lev: number;
    pk_time_per_game: number;
    pk_time_per_goal_allowed: number | null;

    sf_per_game: number;
    sa_per_game: number;
    cf_per_game: number;
    ca_per_game: number;
    hdf_per_game: number;
    hda_per_game: number;
    sh_pct: number;
    sv_pct: number;

    engf: number;
    enga: number;
    en_attempts: number;
    ens_pct: number;

    xgf_per_game: number;
    xga_per_game: number;
    xgf_pct: number;
    gsax: number;
    otml: number;

    time_leading_per_game: number;
    time_trailing_per_game: number;
    time_tied_per_game: number;
    control_score: number;

    nlw: number;
    ntw: number;
    ntl: number;
    bl: number;
    bl_3p: number;
    bl_2plus: number;
    bl_3plus: number;
    cw: number;
    cw_3p: number;
    cw_2plus: number;
    cw_3plus: number;

    magic_number?: number;
    tragic_number?: number;

    starterName?: string;
    starterStatus?: string;
}

export type TeamStatKey = keyof TeamStat;

/** Precomputed Ratings-view values for one team (current ratings only). */
export interface TeamRatingEntry {
    xgf_rating: number | null;
    xga_rating: number | null;
    xgf_rolling: number | null;
    xga_rolling: number | null;
    xgf_5v5: number | null;
    xga_5v5: number | null;
    lines: { f1: number; f2: number; f3: number; f4: number; d1: number; d2: number; d3: number };
    rapm: { f: number; d: number };
    goalie: number;
}

export interface Matchup {
    date: string; // YYYY-MM-DD (Central)
    home: string; // tricode
    away: string;
    homeStarter?: string;
    homeStarterStatus?: string;
    awayStarter?: string;
    awayStarterStatus?: string;
    homeVegasOdds?: number;
    awayVegasOdds?: number;
    homeModelOdds?: string;
    awayModelOdds?: string;
    homeEV?: number;
    awayEV?: number;
    homeXg?: number;
    awayXg?: number;
    recommendation?: string;
}

/** The /teams payload for one season (server-computed default view). */
export interface LeaguePayload {
    season: string;
    seasonLabel: string;
    isCurrent: boolean;
    teams: TeamMeta[];
    /** Regular-season standings with every column, default filters. */
    standings: TeamStat[];
    maxGp: number;
    minGp: number;
    hasPlayoffGames: boolean;
    /** Clinch indicators, only when the file matches this season. */
    clinch: Record<string, string> | null;
    /** Current season only. */
    ratings: Record<string, TeamRatingEntry> | null;
    ratingsSeasonLabel: string | null;
    matchups: Matchup[];
    /** First scheduled game date when the season has not started. */
    seasonStartsOn: string | null;
    generatedAt: string;
}

/** Columnar, compact form of GameRow[] for the lazily-fetched league games. */
export interface PackedGames {
    cols: string[];
    starters: string[];
    rows: (string | number)[][];
    /** False when the per-period splits were left out (they unpack as zeros). */
    periods: boolean;
}
