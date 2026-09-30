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
     * '1' played for this team, 'o' played for another team that day, '0' missed.
     */
    avail: string;
}

export interface Pctl {
    v: number;
    /** Percentile among forwards or defence (0–100, higher = better). */
    p: number;
}

export interface SkaterImpact {
    season: string; // ratings season label, e.g. "2025-26"
    team: string | null; // team the rating was earned with
    gp: number;
    score: Pctl;
    evOff: number;
    evDef: number;
    pp: number;
    pk: number;
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
    impact: SkaterImpact | null;
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
    /** gameId → player rows (API payload only; omitted from the page). */
    boxscores?: Record<string, BoxRow[]>;
    generatedAt: string;
}

/** [player_id, name, number, pos, g, a, pts, plusMinus, toi, shots, hits, blocks, pim, isGoalie, sa, sv, ga] */
export type BoxRow = [string, string, number, string, number, number, number, number, string, number, number, number, number, 0 | 1, number, number, number];
