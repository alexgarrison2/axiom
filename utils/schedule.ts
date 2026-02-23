import fs from 'fs';
import path from 'path';
import { TeamStandings } from './simulation-engine';

// Interface for team_ratings.json
interface TeamRating {
    xgf_5v5_rating?: number;
    xga_5v5_rating?: number;
    pp_rating?: number;
    pk_rating?: number;
    penalties_drawn_per_60?: number;
    penalties_taken_per_60?: number;
}

// NHL API Types
interface NHLScheduleResponse {
    nextStartDate: string;
    previousStartDate: string;
    gameWeek: NHLGameWeek[];
}

interface NHLGameWeek {
    date: string;
    dayAbbrev: string;
    numberOfGames: number;
    games: NHLGame[];
}

interface NHLGame {
    id: number;
    season: number;
    gameType: number; // 2 = Regular Season
    gameState: string; // "FUT", "OFF", "FINAL"
    startTimeUTC: string;
    awayTeam: {
        id: number;
        abbrev: string;
        commonName: { default: string };
        score?: number;
    };
    homeTeam: {
        id: number;
        abbrev: string;
        commonName: { default: string };
        score?: number;
    };
}

export interface SimGame {
    id: string;
    date: string;
    homeTeam: string; // Tricode
    awayTeam: string; // Tricode
    isFinished: boolean;
    homeScore?: number;
    awayScore?: number;
    winner?: string; // Tricode
}

interface NHLStandingsResponse {
    standings: Array<{
        teamAbbrev: { default: string };
        teamCommonName: { default: string }; // Added for mapping
        points: number;
        wins: number;
        losses: number;
        otLosses: number;
        gamesPlayed: number;
        regulationWins: number;
        regulationPlusOtWins: number;
        divisionName: string;
        conferenceName: string;
        goalDifferential: number;
    }>;
}

export async function fetchFullSchedule(): Promise<SimGame[]> {
    try {
        const response = await fetch('https://api-web.nhle.com/v1/schedule/now', { next: { revalidate: 3600 } });
        if (!response.ok) {
            throw new Error(`Failed to fetch schedule: ${response.statusText}`);
        }
        const data: NHLScheduleResponse = await response.json();
        return parseSchedule(data);
    } catch (error) {
        console.error("Error fetching full schedule:", error);
        return [];
    }
}

function parseSchedule(data: NHLScheduleResponse): SimGame[] {
    const simGames: SimGame[] = [];

    if (!data.gameWeek) return [];

    for (const week of data.gameWeek) {
        for (const game of week.games) {
            // Only care about Regular Season (2)
            if (game.gameType !== 2) continue;

            const isFinished = game.gameState === 'OFF' || game.gameState === 'FINAL';

            let winner: string | undefined = undefined;
            if (isFinished && game.homeTeam.score !== undefined && game.awayTeam.score !== undefined) {
                if (game.homeTeam.score > game.awayTeam.score) winner = game.homeTeam.abbrev;
                else if (game.awayTeam.score > game.homeTeam.score) winner = game.awayTeam.abbrev;
            }

            simGames.push({
                id: game.id.toString(),
                date: week.date,
                homeTeam: game.homeTeam.abbrev,
                awayTeam: game.awayTeam.abbrev,
                isFinished,
                homeScore: game.homeTeam.score,
                awayScore: game.awayTeam.score,
                winner
            });
        }
    }
    return simGames;
}

// Helper to fetch *all* remaining games
export async function fetchRemainingSeason(): Promise<SimGame[]> {
    let allGames: SimGame[] = [];
    let currentDate = new Date().toISOString().split('T')[0]; // Today
    const SEASON_END = '2026-04-18'; // Approximate Regular Season End

    // Safety break to prevent infinite loops
    let loops = 0;
    while (currentDate < SEASON_END && loops < 25) {
        const url = `https://api-web.nhle.com/v1/schedule/${currentDate}`;
        try {
            const res = await fetch(url, { next: { revalidate: 3600 } }); // Cache for 1 hour
            if (!res.ok) break;

            const data: NHLScheduleResponse = await res.json();
            const weekGames = parseSchedule(data);
            allGames = [...allGames, ...weekGames];

            if (data.nextStartDate) {
                currentDate = data.nextStartDate;
            } else {
                break;
            }
        } catch (e) {
            console.error("Error fetching schedule segment:", e);
            break;
        }
        loops++;
    }

    // Deduplicate by ID just in case
    const uniqueGames = Array.from(new Map(allGames.map(g => [g.id, g])).values());
    console.log(`Fetched ${uniqueGames.length} remaining games in ${loops} loops.`);
    return uniqueGames;
}

export async function fetchCurrentStandings(): Promise<TeamStandings[]> {
    try {
        // Parallel Fetch API and Local Data
        const [standingsRes, teamRatingsFile] = await Promise.all([
            fetch('https://api-web.nhle.com/v1/standings/now', { next: { revalidate: 3600 } }),
            fs.promises.readFile(path.join(process.cwd(), 'public/data/team_ratings.json'), 'utf-8').catch(() => null)
            // Goalie ratings not strictly needed at Team Level unless we aggregate.
            // Simplified: Use Team Ratings which should already capture some essence? 
            // The simulation engine uses goalie_rating (GSAx). 
            // We need to fetch 'goalie_ratings.json' too if we want to attach a "default" goalie rating.
        ]);

        if (!standingsRes.ok) throw new Error("Failed to fetch standings");
        const standingsData: NHLStandingsResponse = await standingsRes.json();

        let teamRatings: Record<string, TeamRating> = {};
        if (teamRatingsFile) {
            try {
                teamRatings = JSON.parse(teamRatingsFile);
            } catch (e) {
                console.error("Error parsing team_ratings.json", e);
            }
        }

        // Calculate League Averages if needed (for normalization)
        // Backend says: League Avg xG = sum / 32?
        // Let's assume user wants raw values passed and Engine handles logic?
        // SimulationEngine expects `xgf_5v5` etc.
        // And it has `leagueAvgXg5v5` param in constructor.

        return standingsData.standings.map(t => {
            const commonName = t.teamCommonName.default;
            const key = commonName; // team_ratings.json keys are Common Names (e.g. "Panthers")
            const r = teamRatings[key] || {};

            // Fallbacks if data missing
            const xgf_5v5 = r.xgf_5v5_rating || 2.35;
            const xga_5v5 = r.xga_5v5_rating || 2.35;

            // Special Teams
            // Backend pp_rating is Efficiency (e.g. 25.0).
            // Backend pk_rating is Kill % (e.g. 80.0).

            // Normalized Efficiency (Eff / LeagueAvg)
            // League Avg PP ~ 20.0
            const pp_eff = (r.pp_rating || 20.0) / 20.0;

            // PK Efficiency (LeagueAvg / TeamPK) ? 
            // Logic in python: `h_pk_impact = avg_pk_pct / (h_ratings.get('pk_rating')/100)`
            // So if PK is 90% (0.9), impact is 0.8/0.9 = 0.88 (Lowers goals). Correct.
            // We pass the RAW ratio here.
            const pk_raw = (r.pk_rating || 80.0) / 100.0;
            const pk_eff = 0.8 / pk_raw; // 0.8 is approx league avg. 

            return {
                tricode: t.teamAbbrev.default,
                points: t.points,
                wins: t.wins,
                losses: t.losses,
                otl: t.otLosses,
                gamesPlayed: t.gamesPlayed,
                rw: t.regulationWins,
                row: t.regulationPlusOtWins,
                division: getDivCode(t.divisionName),
                conference: t.conferenceName === 'Eastern' ? 'East' : 'West',
                rating: 50 + (t.goalDifferential * 0.5), // Keep simplified rating as fallback/display?

                // Detailed
                xgf_5v5,
                xga_5v5,
                pp_eff,
                pk_eff,
                pen_drawn_60: r.penalties_drawn_per_60 || 3.0,
                pen_taken_60: r.penalties_taken_per_60 || 3.0,

                // Goalie Rating: Default to 0.0 (League Avg)
                // In simulation, we might load specific goalies if we know starters.
                // For Season Sim, we assume "Average Starter" performance?
                // Or simplistic: 0.0.
                // If we want to capture "Hellebuyck Factor", we should average their top goalie's GSAx?
                // For now, 0.0 is safe conservative baseline for season long sim.
                goalie_rating: 0.0
            };
        });
    } catch (e) {
        console.error("Error fetching standings:", e);
        return [];
    }
}

function getDivCode(name: string): string {
    if (name.includes('Atlantic')) return 'ATL';
    if (name.includes('Metro')) return 'MET';
    if (name.includes('Central')) return 'CEN';
    if (name.includes('Pacific')) return 'PAC';
    return 'ATL';
}
