import { Team } from './data';
import { TeamStandings } from './simulation-engine';

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
        const response = await fetch('https://api-web.nhle.com/v1/schedule/now');
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
        const res = await fetch('https://api-web.nhle.com/v1/standings/now', { next: { revalidate: 3600 } });
        if (!res.ok) throw new Error("Failed to fetch standings");
        const data: NHLStandingsResponse = await res.json();

        return data.standings.map(t => ({
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
            rating: 50 + (t.goalDifferential * 0.5) // Simple rating based on GD
        }));
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
