export interface TeamInfo {
    TeamName: string; // "Anaheim Ducks"
    CommonName: string; // "Ducks"
    TeamTricode: string; // "ANA"
    HexColor1: string;
    HexColor2: string;
    TeamLogoURL: string;
}

export interface GameLog {
    game_id: string;
    date: string;
    opponent: string;
    result: string; // W 4-2
    result_code: string; // W, L, OTL
    home_away: string;
    gf: number;
    ga: number;
    xgf: number;
    xga: number;
    starting_goalie: string;
    opponent_starter: string;
    points: number;
    // Extended Stats
    pp_goals: number;
    pp_opps: number;
    pp_time: string; // "2:00"
    pp_goals_against: number;
    pk_opps: number;
    pk_time: string;
    sf: number;
    sa: number;
    cf: number;
    ca: number;
    sv_pct: number;
    en_gf: number;
    en_att: number;
    en_ga: number;
    en_att_ag: number;
    gsax: number;
    otml: string;
    game_number: number;
    time_leading: number; // seconds
    time_trailing: number; // seconds
    time_tied: number; // seconds
    control_score: number; // Weighted game control score
    raw: Record<string, unknown>; // Keeping raw for backward compatibility if needed, though strictly typed is better
}

export interface PlayerBoxscoreRow {
    game_id: string;
    date: string;
    team: string; // "ANA"
    team_id: number;
    player_id: number;
    name: string;
    number: number;
    position: string;
    goals: number;
    assists: number;
    points: number;
    plus_minus: number;
    toi: string;
    shots: number;
    hits: number;
    blocked_shots: number;
    pim: number;
    pp_goals?: number;
    sh_goals?: number;
    is_goalie: number;
    saves?: number;
    shots_against?: number;
    goals_against?: number;
    save_pct?: number;
    decision?: string;
}

export interface TeamRating {
    xgf_rating: number;
    xga_rating: number;
    xgf_5v5_rating: number;
    xga_5v5_rating: number;
    pp_rating: number; // PP%
    pk_rating: number; // PK%
    def_rating: number; // xGA Rating
}

// Lineup interfaces (mirrored from utils/data.ts for use in client components)
export interface LineupPlayer {
    id: number;
    name: string;
    number: number | null;
    pos: string; // 'lw' | 'c' | 'rw' | 'ld' | 'rd'
    ppUnit?: number;
    movement?: 'up' | 'down' | 'new';
}
export type TeamLineup = Record<string, LineupPlayer[]>; // f1, f2, f3, f4, d1, d2, d3, ir

// API Response Interface
export interface TeamStatsResponse {
    teamInfo: TeamInfo;
    games: GameLog[];
    leagueGames?: GameLog[];
    playerStats: PlayerBoxscoreRow[];
    rating: TeamRating | null;
    record: { w: number; l: number; otl: number; pts: number };
    todaysGame: unknown; // Keep permissive for now
    lineup?: TeamLineup;  // Current projected lineup from latest prediction
}
