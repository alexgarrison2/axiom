
import { SeasonSimulator, TeamStandings } from '../utils/simulation-engine';

// Mock Data representing a specific known matchup state
// Use values from a recent prediction output or known approximate values
// Example: FLA (Strong) vs SJS (Weak)
const mockStandings: TeamStandings[] = [
    {
        tricode: 'FLA', points: 100, rw: 40, row: 45, wins: 50, losses: 20, otl: 5, gamesPlayed: 75, division: 'ATL', conference: 'East',
        xgf_5v5: 2.8, xga_5v5: 2.1, pp_eff: 1.25, pk_eff: 0.9, pen_drawn_60: 3.5, pen_taken_60: 4.0, goalie_rating: 0.5
    },
    {
        tricode: 'SJS', points: 40, rw: 10, row: 12, wins: 15, losses: 50, otl: 10, gamesPlayed: 75, division: 'PAC', conference: 'West',
        xgf_5v5: 1.8, xga_5v5: 3.5, pp_eff: 0.8, pk_eff: 1.2, pen_drawn_60: 2.5, pen_taken_60: 3.0, goalie_rating: -0.5
    }
];

const sim = new SeasonSimulator(mockStandings, [], 2.35);

console.log("--- Debug Matchup: FLA (Home) vs SJS (Away) ---");
const debug = sim.debugGame('FLA', 'SJS');
console.log(JSON.stringify(debug, null, 2));

// Expected roughly:
// FLA 5v5: (2.8 * 3.5) / 2.35 = 4.17
// FLA Home Ice: + 0.16
// FLA PP: Opps(3.5+3.0)/2 = 3.25. Eff=1.25. OppPK=1.2 (Weak).
// Wait, PK Eff in my logic: "1.2" means weak?
// If pk_eff passed is "Ratio of Goals Allowed", then >1.0 is Bad.
// Code: `home.pp_eff * away.pk_eff`.
// If SJS pk_eff is 1.2 (Bad), then FLA XG goes UP. Correct.
// FLA PP xG = 3.25 * 0.18 * 1.25 * 1.2 = 0.8775.
// Goalie: SJS GSAx -0.5. Adj = -(-0.5 * 0.5) = +0.25.
// FLA Total xG should be ~ 4.17 + 0.16 + 0.88 + 0.25 = ~5.46

// SJS 5v5: (1.8 * 2.1) / 2.35 = 1.61
// SJS PP: Opps(2.5+4.0)/2 = 3.25. Eff=0.8. OppPK=0.9 (Strong).
// SJS PP xG = 3.25 * 0.18 * 0.8 * 0.9 = 0.42.
// Goalie: FLA GSAx 0.5. Adj = -(0.5 * 0.5) = -0.25.
// SJS Total xG should be ~ 1.61 + 0.42 - 0.25 = ~1.78

// Let's verify output.
