import { SimGame } from './schedule';

export interface TeamStandings {
    tricode: string;
    points: number;
    rw: number; // Regulation Wins (Tiebreaker 1)
    row: number; // Regulation + OT Wins (Tiebreaker 2)
    wins: number;
    losses: number;
    otl: number;
    gamesPlayed: number;
    division: string;
    conference: string;
    rating: number; // Team Strength Rating (0-100 or Elo)
}

export interface SimResult {
    madePlayoffs: number; // Count
    wonDivision: number;
    wonCup: number;
    totalSims: number;
    totalPoints: number; // Sum of points across all sims

    // New Detailed Distributions
    pointDist: Map<number, number>; // Points -> Count
    divRankDist: Map<number, number>; // Rank (1-8) -> Count
    roundExitDist: Record<string, number>; // 'R1', 'R2', 'CF', 'F', 'CUP', 'MISS' -> Count
}

export class SeasonSimulator {
    private baseStandings: Map<string, TeamStandings>;
    private remainingSchedule: SimGame[];

    constructor(currentStandings: TeamStandings[], remainingSchedule: SimGame[]) {
        this.baseStandings = new Map(currentStandings.map(t => [t.tricode, t]));
        this.remainingSchedule = remainingSchedule;
    }

    // 0.5 = 50/50. >0.5 Favors Home.
    // Simple Elo-like formula: 1 / (1 + 10^((AwayRating - HomeRating)/400))
    // For now, we can use a simpler xG rating diff if available.
    private getHomeWinProb(home: TeamStandings, away: TeamStandings): number {
        const homeRating = home.rating + 5; // Home Ice Advantage
        const awayRating = away.rating;

        // Sigmoid function for probability
        // Assuming ratings are roughly 40-60 range (xGF%)? Or 1500 Elo?
        // Let's assume standard Elo for now, mapping our xGF% to it if needed.
        // If Rating is xGF% (e.g. 52.5), diff is 52.5 - 49.5 = 3.
        // Win prob ~= 0.5 + (diff * 0.02)

        const diff = homeRating - awayRating;
        let prob = 0.5 + (diff * 0.003); // Dampened even further from 0.006 to 0.003 for realism

        // Clamp
        if (prob > 0.85) prob = 0.85;
        if (prob < 0.15) prob = 0.15;

        return prob;
    }

    public simulateSeason(): Map<string, TeamStandings> {
        // Deep clone standings so we don't mutate state between runs
        const simStandings = new Map<string, TeamStandings>();
        this.baseStandings.forEach((val, key) => {
            simStandings.set(key, { ...val });
        });

        for (const game of this.remainingSchedule) {
            if (game.isFinished) continue; // Should be filtered out, but safety check

            const home = simStandings.get(game.homeTeam);
            const away = simStandings.get(game.awayTeam);

            if (!home || !away) continue;

            const pHomeWin = this.getHomeWinProb(home, away);
            const rand = Math.random();

            // 3-point game logic roughly:
            // ~20-25% of games go to OT.
            // We can simplify:
            // 60-70% Regulation Win chance if there is a winner?

            // Simplified Model:
            // 1. Determine Winner (Home vs Away)
            // 2. Determine Regulation vs OT (Flat 23% chance of OT?)

            let winner = null;
            let loser = null;

            if (rand < pHomeWin) {
                winner = home;
                loser = away;
            } else {
                winner = away;
                loser = home;
            }

            const isOT = Math.random() < 0.23;

            winner.wins++;
            winner.points += 2;
            winner.gamesPlayed++;

            loser.losses++; // This is effectively "Loss count" in standings, but OTL is separate
            loser.gamesPlayed++;

            if (isOT) {
                winner.row++;
                loser.otl++;
                loser.points += 1;
            } else {
                winner.rw++;
                winner.row++;
            }
        }

        return simStandings;
    }

    public runMonteCarlo(iterations: number): Map<string, SimResult> {
        const results = new Map<string, SimResult>();

        // Init results
        this.baseStandings.forEach((_, key) => {
            results.set(key, {
                madePlayoffs: 0,
                wonDivision: 0,
                wonCup: 0,
                totalSims: iterations,
                totalPoints: 0,
                pointDist: new Map(),
                divRankDist: new Map(),
                roundExitDist: { 'MISS': 0, 'R1': 0, 'R2': 0, 'CF': 0, 'F': 0, 'CUP': 0 }
            });
        });

        for (let i = 0; i < iterations; i++) {
            const finalStandings = this.simulateSeason();
            const playoffTeams = this.determinePlayoffTeams(finalStandings);

            // 1. Track Points & Division Rank
            // Calculate Rank within Division
            const divSims: Record<string, TeamStandings[]> = { ATL: [], MET: [], CEN: [], PAC: [] };
            finalStandings.forEach(t => {
                const div = this.getDivision(t.tricode);
                if (divSims[div]) divSims[div].push(t);
            });
            // Sort divisions
            Object.values(divSims).forEach(list => list.sort((a, b) => b.points - a.points));

            // Update Distributions
            finalStandings.forEach((team, tricode) => {
                const res = results.get(tricode)!;
                res.totalPoints += team.points;

                // Point Distribution
                const currCount = res.pointDist.get(team.points) || 0;
                res.pointDist.set(team.points, currCount + 1);

                // Division Rank Distribution
                const div = this.getDivision(tricode);
                const rank = divSims[div].findIndex(t => t.tricode === tricode) + 1;
                const rCount = res.divRankDist.get(rank) || 0;
                res.divRankDist.set(rank, rCount + 1);
            });

            // 2. Track Playoffs Made
            playoffTeams.forEach(tricode => {
                results.get(tricode)!.madePlayoffs++;
            });

            // Track MISS for those who didn't format
            const playoffSet = new Set(playoffTeams);
            this.baseStandings.forEach((_, tricode) => {
                if (!playoffSet.has(tricode)) {
                    results.get(tricode)!.roundExitDist['MISS']++;
                }
            });

            // 3. Simulate Playoff Bracket & Exit rounds
            // We need simulatePlayoffs to return WHO exited when
            const exitResults = this.simulatePlayoffsFull(playoffTeams, finalStandings);

            // exitResults is Map<tricode, exitRound> e.g. 'R1', 'CUP'
            exitResults.forEach((exitRound, tricode) => {
                const res = results.get(tricode)!;
                if (exitRound === 'CUP') res.wonCup++;
                // Increment exit dist
                if (!res.roundExitDist[exitRound]) res.roundExitDist[exitRound] = 0;
                res.roundExitDist[exitRound]++;
            });
        }

        return results;
    }

    private simulatePlayoffsFull(qualifiers: string[], standings: Map<string, TeamStandings>): Map<string, string> {
        const outcomes = new Map<string, string>(); // Team -> Exit Round

        if (qualifiers.length !== 16) return outcomes;

        // Helper
        const simSeries = (teamA: string, teamB: string): string => {
            const a = standings.get(teamA);
            const b = standings.get(teamB);
            if (!a || !b) return teamA;

            const pWin = this.getHomeWinProb(a, b);

            let aWins = 0;
            let bWins = 0;
            while (aWins < 4 && bWins < 4) {
                if (Math.random() < pWin) aWins++;
                else bWins++;
            }
            return aWins === 4 ? teamA : teamB;
        };

        const seeded = qualifiers.sort((a, b) => (standings.get(b)?.points || 0) - (standings.get(a)?.points || 0));

        // R1
        const r1Winners: string[] = [];
        const r1Losers: string[] = [];

        for (let i = 0; i < 8; i++) {
            const w = simSeries(seeded[i], seeded[15 - i]);
            const l = w === seeded[i] ? seeded[15 - i] : seeded[i];
            r1Winners.push(w);
            r1Losers.push(l);
        }
        r1Losers.forEach(t => outcomes.set(t, 'R1'));

        // R2
        const r2Winners: string[] = [];
        const r2Losers: string[] = [];
        for (let i = 0; i < 4; i++) {
            const w = simSeries(r1Winners[i], r1Winners[7 - i]);
            const l = w === r1Winners[i] ? r1Winners[7 - i] : r1Winners[i];
            r2Winners.push(w);
            r2Losers.push(l);
        }
        r2Losers.forEach(t => outcomes.set(t, 'R2'));

        // CF (R3)
        const r3Winners: string[] = [];
        const r3Losers: string[] = [];
        for (let i = 0; i < 2; i++) {
            const w = simSeries(r2Winners[i], r2Winners[3 - i]);
            const l = w === r2Winners[i] ? r2Winners[3 - i] : r2Winners[i];
            r3Winners.push(w);
            r3Losers.push(l);
        }
        r3Losers.forEach(t => outcomes.set(t, 'CF'));

        // Finals
        const cupWinner = simSeries(r3Winners[0], r3Winners[1]);
        const cupLoser = cupWinner === r3Winners[0] ? r3Winners[1] : r3Winners[0];

        outcomes.set(cupLoser, 'F');
        outcomes.set(cupWinner, 'CUP');

        return outcomes;
    }

    // Kept for compatibility if called elsewhere, but we strictly use Full now internally for MC
    private simulatePlayoffs(qualifiers: string[], standings: Map<string, TeamStandings>): string | null {
        const res = this.simulatePlayoffsFull(qualifiers, standings);
        // Find who has 'CUP'
        for (const [team, exit] of res.entries()) {
            if (exit === 'CUP') return team;
        }
        return null;
    }

    private determinePlayoffTeams(standings: Map<string, TeamStandings>): string[] {
        const qualifiedTeams: string[] = [];

        // Helper to sort teams: Points -> RW -> ROW -> Wins (Simplified)
        const sortFn = (a: TeamStandings, b: TeamStandings) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.rw !== a.rw) return b.rw - a.rw;
            if (b.row !== a.row) return b.row - a.row;
            return b.wins - a.wins;
        };

        // 1. Group by Division
        const divisions: Record<string, TeamStandings[]> = {
            ATL: [], MET: [], CEN: [], PAC: []
        };

        standings.forEach(team => {
            // Enforce division assignment if missing (Hardcoded fallback)
            const div = team.division || this.getDivision(team.tricode);
            if (divisions[div]) divisions[div].push(team);
        });

        // Sort each division
        Object.values(divisions).forEach(divList => divList.sort(sortFn));

        // 2. Select Top 3 from each Division
        const eastWildcardCandidates: TeamStandings[] = [];
        const westWildcardCandidates: TeamStandings[] = [];

        ['ATL', 'MET'].forEach(div => {
            const teams = divisions[div];
            // Top 3 clinch
            for (let i = 0; i < 3; i++) {
                if (teams[i]) qualifiedTeams.push(teams[i].tricode);
            }
            // Rest go to wildcard pool
            for (let i = 3; i < teams.length; i++) {
                if (teams[i]) eastWildcardCandidates.push(teams[i]);
            }
        });

        ['CEN', 'PAC'].forEach(div => {
            const teams = divisions[div];
            // Top 3 clinch
            for (let i = 0; i < 3; i++) {
                if (teams[i]) qualifiedTeams.push(teams[i].tricode);
            }
            // Rest go to wildcard pool
            for (let i = 3; i < teams.length; i++) {
                if (teams[i]) westWildcardCandidates.push(teams[i]);
            }
        });

        // 3. Select 2 Wildcards per Conference
        eastWildcardCandidates.sort(sortFn);
        westWildcardCandidates.sort(sortFn);

        if (eastWildcardCandidates[0]) qualifiedTeams.push(eastWildcardCandidates[0].tricode);
        if (eastWildcardCandidates[1]) qualifiedTeams.push(eastWildcardCandidates[1].tricode);

        if (westWildcardCandidates[0]) qualifiedTeams.push(westWildcardCandidates[0].tricode);
        if (westWildcardCandidates[1]) qualifiedTeams.push(westWildcardCandidates[1].tricode);

        return qualifiedTeams;
    }

    private getDivision(tricode: string): string {
        const mapping: Record<string, string> = {
            BOS: 'ATL', BUF: 'ATL', DET: 'ATL', FLA: 'ATL', MTL: 'ATL', OTT: 'ATL', TBL: 'ATL', TOR: 'ATL',
            CAR: 'MET', CBJ: 'MET', NJD: 'MET', NYI: 'MET', NYR: 'MET', PHI: 'MET', PIT: 'MET', WSH: 'MET',
            CHI: 'CEN', COL: 'CEN', DAL: 'CEN', MIN: 'CEN', NSH: 'CEN', STL: 'CEN', UTA: 'CEN', WPG: 'CEN',
            ANA: 'PAC', CGY: 'PAC', EDM: 'PAC', LAK: 'PAC', SEA: 'PAC', SJS: 'PAC', VAN: 'PAC', VGK: 'PAC'
        };
        return mapping[tricode] || 'ATL'; // Fallback
    }
}
