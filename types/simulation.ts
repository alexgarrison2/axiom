// Shared season-simulation types (standings input and per-team Monte Carlo
// output). The simulation itself runs in the Python pipeline
// (pipeline/season_simulator.py); the frontend only consumes its results.

export interface TeamStandings {
    tricode: string;
    points: number;
    rw: number;
    row: number;
    wins: number;
    losses: number;
    otl: number;
    gamesPlayed: number;
    division: string;
    conference: string;
    // Detailed Ratings (Loaded from team_ratings.json)
    xgf_5v5: number;
    xga_5v5: number;
    pp_eff: number; // Scaled relative to 1.0 (mean)
    pk_eff: number; // Scaled relative to 1.0 (mean)
    pen_drawn_60: number;
    pen_taken_60: number;
    goalie_rating: number; // GSAx per 60
}

export interface SimResult {
    madePlayoffs: number;
    wonDivision: number;
    wonCup: number;
    totalSims: number;
    totalPoints: number;
    pointDist: Map<number, number>;
    divRankDist: Map<number, number>;
    roundExitDist: Record<string, number>;
    r1Matchups: Record<string, number>; // Opponent Tricode -> Count
}
