import type { PackedGames, TeamMeta, TeamStat } from './types';

export interface SeasonLine {
    gp: number;
    g: number;
    a: number;
    pts: number;
    sog: number;
    /** Seconds per game. */
    toi: number;
    /**
     * One char per team regular-season game, oldest first:
     * '1' played for this team, 'o' played for another team that day,
     * '0' missed, '-' not with the team yet.
     */
    avail: string;
}

export interface Pctl {
    v: number;
    /** Percentile among forwards or defence (0–100, higher = better). */
    p: number;
}

/** The player rating (RAPM v2, public/data/player_ratings.json): EV xG per 60 above average. */
export interface SkaterRating {
    net: number;
    off: number;
    /** Lower is better. */
    def: number;
    /** NET percentile among rated forwards or defencemen on current rosters (null when not rated). */
    pct: number | null;
    /** False: no NHL sample yet (rookie prior). */
    rated: boolean;
    /** EV minutes behind the rating (last three seasons + this one). */
    evMin: number;
}

/** Descriptive on-ice rates from the player model's season (player_impact.json), with league percentiles. */
export interface SkaterRates {
    season: string; // season label of the rates, e.g. "2025-26"
    team: string | null; // team the rates were earned with
    gp: number;
    xgf60: Pctl;
    xga60: Pctl;
    xgPct: Pctl;
    ixg60: Pctl;
    rel: Pctl;
    pen: Pctl;
    ppPct: number | null;
    pkPct: number | null;
    evToi: number;
    ppToi: number;
    pkToi: number;
}

export interface SkaterCardData {
    id: string;
    name: string;
    pos: 'C' | 'L' | 'R' | 'D';
    number: number | null;
    isNew: boolean;
    from: string | null;
    age: number | null;
    height: string | null;
    weight: number | null;
    shoots: string | null;
    capHit: number | null;
    expiry: string | null;
    injury: { status: string; returnDate: string | null } | null;
    rating: SkaterRating | null;
    rates: SkaterRates | null;
    current: SeasonLine | null;
    last: SeasonLine | null;
}

export interface GoalieStart {
    date: string;
    opp: string;
    home: boolean;
    result: string;
    ga: number;
    sa: number;
}

export interface GoalieSeason {
    gp: number;
    gs: number;
    w: number;
    l: number;
    ot: number;
    sa: number;
    sv: number;
    ga: number;
    toi: number; // seconds
    /** Goals saved above expected from the starts (team xGA − GA). */
    gsax: number | null;
    last5: GoalieStart[];
}

export interface GoalieLine {
    id: string;
    name: string;
    number: number | null;
    isNew: boolean;
    injury: { status: string; returnDate: string | null } | null;
    current: GoalieSeason | null;
    last: GoalieSeason | null;
    /** Blended rating (goalie_ratings.json). */
    rating: { gsaxPerGame: number; label: string } | null;
    next: { date: string; status: string; opp: string } | null;
}

export interface KpiSet {
    xgf_pct: number;
    gf_pg: number;
    ga_pg: number;
    pp_pct: number;
    pk_pct: number;
    pp_opps: number;
    pk_opps: number;
    pt_pct: number;
    ranks: { xgf_pct: number; gf_pg: number; ga_pg: number; pp_pct: number; pk_pct: number; pt_pct: number };
    /** Every team has 10+ GP, so league ranks mean something (show #N badges only then). */
    ranked?: boolean;
}

export interface NextGame {
    date: string;
    startTimeUTC: string | null;
    opp: string;
    home: boolean;
    modelWinPct: number | null;
    goalie: { name: string; status: string } | null;
    oppGoalie: { name: string; status: string } | null;
    href: string;
    tv: string | null;
}

export interface TeamHero {
    nextGame: NextGame | null;
    playoffOdds: { pct: number; division: number | null; cup: number | null; avgPoints: number | null; sims: number | null } | null;
    injuries: { name: string; pos: string; status: string; type: string | null; returnDate: string | null }[];
    rosterChanges: { added: { name: string; from: string | null }[]; lost: { name: string; to: string | null }[] } | null;
}

export interface TeamPayload {
    season: string;
    seasonLabel: string;
    isCurrent: boolean;
    team: TeamMeta;
    games: PackedGames;
    standing: TeamStat | null;
    kpis: KpiSet | null;
    leagueAverages: Record<string, number>;
    skaters: SkaterCardData[];
    lineup: Record<string, string[]> | null;
    goalies: GoalieLine[];
    rosterSource: 'nhl' | 'fallback';
    ratingsSeasonLabel: string;
    /** Per-game player rows (API payload only; omitted from the page). */
    boxscores?: Boxscores;
    generatedAt: string;
}

/** [player_id, g, a, pts, plusMinus, toi, shots, isGoalie, shotsAgainst, saves] */
export type BoxRow = [string, number, number, number, number, string, number, 0 | 1, number, number];

export interface Boxscores {
    /** player_id → [name, number, position] */
    players: Record<string, [string, number, string]>;
    games: Record<string, BoxRow[]>;
}
