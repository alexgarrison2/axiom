import { SimGame } from './schedule';

// Helper for Poisson distribution
const factorial = (n: number): number => {
    if (n === 0 || n === 1) return 1;
    let res = 1;
    for (let i = 2; i <= n; i++) res *= i;
    return res;
};

const poissonPmf = (k: number, lambda: number): number => {
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
};

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

export class SeasonSimulator {
    private baseStandings: Map<string, TeamStandings>;
    private remainingSchedule: SimGame[];
    private leagueAvgXg5v5: number;

    constructor(currentStandings: TeamStandings[], remainingSchedule: SimGame[], leagueAvgXg5v5: number = 2.35) {
        this.baseStandings = new Map(currentStandings.map(t => [t.tricode, t]));
        this.remainingSchedule = remainingSchedule;
        this.leagueAvgXg5v5 = leagueAvgXg5v5;
    }

    private calculateGameRates(home: TeamStandings, away: TeamStandings): { homeXg: number, awayXg: number } {
        // 1. Base 5v5 xG
        // Formula: (Offense * Defense) / LeagueAvg
        const h_5v5 = (home.xgf_5v5 * away.xga_5v5) / this.leagueAvgXg5v5;
        const a_5v5 = (away.xgf_5v5 * home.xga_5v5) / this.leagueAvgXg5v5;

        // 2. Home Ice Advantage
        const HOME_ICE = 0.16;
        const h_base = h_5v5 + HOME_ICE;
        const a_base = a_5v5;

        // 3. Special Teams
        // Coeffs from backend
        const ST_VAL_PP = 0.18;

        // Volume: Average of Drawn + Taken
        const h_opps = (home.pen_drawn_60 + away.pen_taken_60) / 2.0;
        const a_opps = (away.pen_drawn_60 + home.pen_taken_60) / 2.0;

        // Efficiency Factors (Already Normalized in loading step or here?)
        // Let's assume passed ratings are "Per 60" or "Pct".
        // Implementation plan says we load raw ratings.
        // Backend: pp_rating is ~20.0. We normalize by League Avg ~20.0 to get factor.
        // We will assume `pp_eff` in TeamStandings is ALREADY factor (e.g. 1.10).

        // PK Impact: If Opp PK is strong (factor > 1.0), it REDUCES goals.
        // So we divide? Or multiply by inverse? 
        // Backend: avg_pk_pct / team_pk_pct. 
        // We will assume `pk_eff` passed IS this ratio.

        const h_pp_xg = h_opps * ST_VAL_PP * home.pp_eff * away.pk_eff;
        const a_pp_xg = a_opps * ST_VAL_PP * away.pp_eff * home.pk_eff;

        // 4. Goaltending Impact (GSAx)
        // Backend: -(OppGSAx * 0.5)
        const GOALIE_FACTOR = 0.5;
        const h_goalie_adj = -(away.goalie_rating * GOALIE_FACTOR);
        const a_goalie_adj = -(home.goalie_rating * GOALIE_FACTOR);

        // Sum
        // Floor at 0.1 to prevent negative Poisson means
        const homeFinal = Math.max(0.1, h_base + h_pp_xg + h_goalie_adj);
        const awayFinal = Math.max(0.1, a_base + a_pp_xg + a_goalie_adj);

        return { homeXg: homeFinal, awayXg: awayFinal };
    }

    private solveGame(home: TeamStandings, away: TeamStandings): { winner: TeamStandings, loser: TeamStandings, isOT: boolean } {
        // Calculate Expected Goals
        const { homeXg, awayXg } = this.calculateGameRates(home, away);

        // Simulate Score using Poisson
        // Optimization: Pre-compute probabilities? No, Monte Carlo needs randomness in outcome OR random score generation.
        // Method A: Random Draw from Poisson (Correct for simulation)
        // Method B: Calculate Win Prob and coin flip (Faster, less variance?)
        // Hockeystats blog says: "Simulating Individual Games ... estimated whether that shot will become a goal"
        // Then: "Simulate remainder ... 1 million times."
        // We want Method A: Generate a score.

        const rPoisson = (lambda: number) => {
            const L = Math.exp(-lambda);
            let k = 0;
            let p = 1;
            do {
                k++;
                p *= Math.random();
            } while (p > L);
            return k - 1;
        };

        let hScore = rPoisson(homeXg);
        let aScore = rPoisson(awayXg);
        let isOT = false;

        // Regulation Tie -> OT
        if (hScore === aScore) {
            isOT = true;
            // 3v3 OT Logic (Random 50/50ish, or weighted by skill?)
            // Backend treats OT as separate sim or 50/50 if timeout.
            // Simplified: weighted coin flip based on ratings?
            // Let's use xGF ratio for OT weight
            const total = homeXg + awayXg;
            const hProb = total > 0 ? homeXg / total : 0.5;

            if (Math.random() < hProb) hScore++;
            else aScore++;
        }

        if (hScore > aScore) return { winner: home, loser: away, isOT };
        return { winner: away, loser: home, isOT };
    }

    // Replaces getHomeWinProb for internal sim
    // Not used in direct sim flow anymore, but useful for Playoff Series calc
    private calculateMatchupProb(home: TeamStandings, away: TeamStandings): number {
        const { homeXg, awayXg } = this.calculateGameRates(home, away);

        // Sum Poisson PMFs for Home Win
        let pHomeWin = 0;
        let pAwayWin = 0;
        let pTie = 0;

        // Truncate at 15 goals
        for (let h = 0; h < 12; h++) {
            for (let a = 0; a < 12; a++) {
                const p = poissonPmf(h, homeXg) * poissonPmf(a, awayXg);
                if (h > a) pHomeWin += p;
                else if (a > h) pAwayWin += p;
                else pTie += p;
            }
        }

        // Normalize (ignore >12 goals mass)
        const total = pHomeWin + pAwayWin + pTie;
        pHomeWin /= total;
        pTie /= total;

        // OT Win Prob (50/50 split of tie?)
        // Or weighted by xG
        return pHomeWin + (pTie * (homeXg / (homeXg + awayXg)));
    }

    public simulateSeason(): Map<string, TeamStandings> {
        const simStandings = new Map<string, TeamStandings>();
        this.baseStandings.forEach((val, key) => {
            simStandings.set(key, { ...val });
        });

        for (const game of this.remainingSchedule) {
            if (game.isFinished) continue;

            const home = simStandings.get(game.homeTeam);
            const away = simStandings.get(game.awayTeam);

            if (!home || !away) continue;

            const { winner, loser, isOT } = this.solveGame(home, away);

            winner.wins++;
            winner.points += 2;
            winner.gamesPlayed++;

            loser.losses++;
            loser.gamesPlayed++;

            if (isOT) {
                winner.row++; // OT Win counts for ROW
                loser.otl++;
                loser.points += 1;
            } else {
                winner.rw++;
                winner.row++;
            }
        }
        return simStandings;
    }

    // ... runMonteCarlo remains mostly same ...
    public runMonteCarlo(iterations: number): Map<string, SimResult> {
        const results = new Map<string, SimResult>();
        this.baseStandings.forEach((_, key) => {
            results.set(key, {
                madePlayoffs: 0, wonDivision: 0, wonCup: 0, totalSims: iterations, totalPoints: 0,
                pointDist: new Map(), divRankDist: new Map(), roundExitDist: { 'MISS': 0, 'R1': 0, 'R2': 0, 'CF': 0, 'F': 0, 'CUP': 0 },
                r1Matchups: {}
            });
        });

        for (let i = 0; i < iterations; i++) {
            const finalStandings = this.simulateSeason();
            const playoffTeams = this.determinePlayoffTeams(finalStandings);

            // ... Update distributions (same as before) ...
            const divSims: Record<string, TeamStandings[]> = { ATL: [], MET: [], CEN: [], PAC: [] };
            finalStandings.forEach(t => {
                const div = this.getDivision(t.tricode);
                if (divSims[div]) divSims[div].push(t);
            });
            Object.values(divSims).forEach(list => list.sort((a, b) => b.points - a.points)); // Simple sort for rank

            finalStandings.forEach((team, tricode) => {
                const res = results.get(tricode)!;
                res.totalPoints += team.points;
                res.pointDist.set(team.points, (res.pointDist.get(team.points) || 0) + 1);
                // Division Rank
                const div = this.getDivision(tricode);
                const rank = divSims[div].findIndex(t => t.tricode === tricode) + 1;
                res.divRankDist.set(rank, (res.divRankDist.get(rank) || 0) + 1);
            });

            playoffTeams.forEach(t => results.get(t)!.madePlayoffs++);

            // Simulate Playoffs and track matchups
            // We need to capture the matchups from simulatePlayoffsFull
            const { outcomes, matchups } = this.simulatePlayoffsFull(playoffTeams, finalStandings);

            outcomes.forEach((exit, t) => {
                if (exit === 'CUP') results.get(t)!.wonCup++;
                // Increment exit dist
                if (!results.get(t)!.roundExitDist[exit]) results.get(t)!.roundExitDist[exit] = 0;
                results.get(t)!.roundExitDist[exit]++;
            });

            // Track Matchups
            matchups.forEach((opp, team) => {
                const r = results.get(team)!;
                if (!r.r1Matchups[opp]) r.r1Matchups[opp] = 0;
                r.r1Matchups[opp]++;
            });
        }
        return results;
    }

    // Updated Playoff Sim to use calculateMatchupProb
    private simulatePlayoffsFull(qualifiers: string[], standings: Map<string, TeamStandings>): { outcomes: Map<string, string>, matchups: Map<string, string> } {
        const outcomes = new Map<string, string>();
        const matchups = new Map<string, string>();

        if (qualifiers.length !== 16) return { outcomes, matchups };

        const simSeries = (teamA: string, teamB: string): string => {
            const a = standings.get(teamA);
            const b = standings.get(teamB);
            if (!a || !b) return teamA;

            const pWin = this.calculateMatchupProb(a, b);
            // Note: Hockeystats uses "re-seed home ice advantage".
            // We assume Higher Seed (points) gets Home Ice? YES, seeded array is sorted by points.

            let aWins = 0; let bWins = 0;
            while (aWins < 4 && bWins < 4) {
                if (Math.random() < pWin) aWins++; else bWins++;
            }
            return aWins === 4 ? teamA : teamB;
        };

        // Same seeding / bracket logic ...
        const seeded = qualifiers.sort((a, b) => (standings.get(b)?.points || 0) - (standings.get(a)?.points || 0));

        const r1Winners: string[] = [];
        const r1Losers: string[] = [];
        for (let i = 0; i < 8; i++) {
            const higher = seeded[i]; const lower = seeded[15 - i];

            // Record Matchup
            matchups.set(higher, lower);
            matchups.set(lower, higher);

            const w = simSeries(higher, lower);
            r1Winners.push(w);
            r1Losers.push(w === higher ? lower : higher);
        }
        r1Losers.forEach(t => outcomes.set(t, 'R1'));

        // R2
        const r2Winners: string[] = [];
        const r2Losers: string[] = [];
        for (let i = 0; i < 4; i++) {
            const w = simSeries(r1Winners[i], r1Winners[7 - i]);
            r2Winners.push(w);
            r2Losers.push(w === r1Winners[i] ? r1Winners[7 - i] : r1Winners[i]);
        }
        r2Losers.forEach(t => outcomes.set(t, 'R2'));

        const r3Winners: string[] = [];
        const r3Losers: string[] = [];
        for (let i = 0; i < 2; i++) {
            const w = simSeries(r2Winners[i], r2Winners[3 - i]);
            r3Winners.push(w);
            r3Losers.push(w === r2Winners[i] ? r2Winners[3 - i] : r2Winners[i]);
        }
        r3Losers.forEach(t => outcomes.set(t, 'CF'));

        const cupWinner = simSeries(r3Winners[0], r3Winners[1]);
        outcomes.set(cupWinner === r3Winners[0] ? r3Winners[1] : r3Winners[0], 'F');
        outcomes.set(cupWinner, 'CUP');

        return { outcomes, matchups };
    }

    // ... Playoff Seeding / Divisions logic ...
    // (Include the determinePlayoffTeams and getDivision helper methods)
    private determinePlayoffTeams(standings: Map<string, TeamStandings>): string[] {
        const qualifiedTeams: string[] = [];
        const sortFn = (a: TeamStandings, b: TeamStandings) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.rw !== a.rw) return b.rw - a.rw;
            if (b.row !== a.row) return b.row - a.row;
            return b.wins - a.wins;
        };
        const divisions: Record<string, TeamStandings[]> = { ATL: [], MET: [], CEN: [], PAC: [] };
        standings.forEach(team => {
            const div = team.division || this.getDivision(team.tricode);
            if (divisions[div]) divisions[div].push(team);
        });
        Object.values(divisions).forEach(divList => divList.sort(sortFn));

        const eastWildcardCandidates: TeamStandings[] = [];
        const westWildcardCandidates: TeamStandings[] = [];

        ['ATL', 'MET'].forEach(div => {
            const teams = divisions[div];
            for (let i = 0; i < 3; i++) if (teams[i]) qualifiedTeams.push(teams[i].tricode);
            for (let i = 3; i < teams.length; i++) if (teams[i]) eastWildcardCandidates.push(teams[i]);
        });
        ['CEN', 'PAC'].forEach(div => {
            const teams = divisions[div];
            for (let i = 0; i < 3; i++) if (teams[i]) qualifiedTeams.push(teams[i].tricode);
            for (let i = 3; i < teams.length; i++) if (teams[i]) westWildcardCandidates.push(teams[i]);
        });

        eastWildcardCandidates.sort(sortFn);
        westWildcardCandidates.sort(sortFn);

        if (eastWildcardCandidates[0]) qualifiedTeams.push(eastWildcardCandidates[0].tricode);
        if (eastWildcardCandidates[1]) qualifiedTeams.push(eastWildcardCandidates[1].tricode);
        if (westWildcardCandidates[0]) qualifiedTeams.push(westWildcardCandidates[0].tricode);
        if (westWildcardCandidates[1]) qualifiedTeams.push(westWildcardCandidates[1].tricode);

        return qualifiedTeams;
    }

    public debugGame(homeTri: string, awayTri: string): { homeTeam: string, awayTeam: string, homeXgFinal: number, awayXgFinal: number, breakdown: any } | string {
        const home = this.baseStandings.get(homeTri);
        const away = this.baseStandings.get(awayTri);
        if (!home || !away) return "Teams not found";

        const { homeXg, awayXg } = this.calculateGameRates(home, away);

        // Detailed breakdown reproduction
        const h_5v5 = (home.xgf_5v5 * away.xga_5v5) / this.leagueAvgXg5v5;
        const a_5v5 = (away.xgf_5v5 * home.xga_5v5) / this.leagueAvgXg5v5;

        // Recalc components for display
        const HOME_ICE = 0.16;
        const ST_VAL_PP = 0.18;
        const h_opps = (home.pen_drawn_60 + away.pen_taken_60) / 2.0;
        const a_opps = (away.pen_drawn_60 + home.pen_taken_60) / 2.0;
        const h_pp_xg = h_opps * ST_VAL_PP * home.pp_eff * away.pk_eff;
        const a_pp_xg = a_opps * ST_VAL_PP * away.pp_eff * home.pk_eff;
        const GOALIE_FACTOR = 0.5;
        const h_goalie_adj = -(away.goalie_rating * GOALIE_FACTOR);
        const a_goalie_adj = -(home.goalie_rating * GOALIE_FACTOR);

        return {
            homeTeam: homeTri,
            awayTeam: awayTri,
            homeXgFinal: homeXg,
            awayXgFinal: awayXg,
            breakdown: {
                home: {
                    base5v5: h_5v5,
                    homeIce: HOME_ICE,
                    ppXg: h_pp_xg,
                    goalieImpact: h_goalie_adj
                },
                away: {
                    base5v5: a_5v5,
                    ppXg: a_pp_xg,
                    goalieImpact: a_goalie_adj
                }
            }
        };
    }

    private getDivision(tricode: string): string {
        const mapping: Record<string, string> = {
            BOS: 'ATL', BUF: 'ATL', DET: 'ATL', FLA: 'ATL', MTL: 'ATL', OTT: 'ATL', TBL: 'ATL', TOR: 'ATL',
            CAR: 'MET', CBJ: 'MET', NJD: 'MET', NYI: 'MET', NYR: 'MET', PHI: 'MET', PIT: 'MET', WSH: 'MET',
            CHI: 'CEN', COL: 'CEN', DAL: 'CEN', MIN: 'CEN', NSH: 'CEN', STL: 'CEN', UTA: 'CEN', WPG: 'CEN',
            ANA: 'PAC', CGY: 'PAC', EDM: 'PAC', LAK: 'PAC', SEA: 'PAC', SJS: 'PAC', VAN: 'PAC', VGK: 'PAC'
        };
        return mapping[tricode] || 'ATL';
    }
}
