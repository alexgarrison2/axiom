import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { TeamInfo, GameLog, PlayerBoxscoreRow, TeamRating, TeamStatsResponse, TeamLineup } from '@/types';

// Helper to format time strings
const formatTime = (seconds: string | number) => {
    const s = parseInt(String(seconds));
    if (isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
};

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ teamAbbr: string }> }
) {
    const { teamAbbr } = await params;
    const teamAbbrUpper = teamAbbr.toUpperCase();

    try {
        // const dataDir = path.join(process.cwd(), 'public/data'); // Assuming public/data based on usage
        // Note: In Next.js, 'public' files are served statically. 
        // For server-side fs access, we might need to exact path or check 'data' folder at root if that's where python writes.
        // User's file listing showed 'data' dir at root AND 'public' dir.
        // Existing page fetched from '/data/...' which implies public/data.

        // Let's check both or assume root/public/data or root/data.
        // Based on file list:
        // /Users/alexgarrison/Downloads/HockeyData/nhl-predictions-app/data exists
        // /Users/alexgarrison/Downloads/HockeyData/nhl-predictions-app/public exists
        // Usually static fetch '/data/foo.csv' maps to 'public/data/foo.csv'.

        const readCsv = (filename: string) => {
            const filePath = path.join(process.cwd(), 'public/data', filename);
            // Fallback to just 'data' if public/data fails?
            if (!fs.existsSync(filePath)) {
                return fs.readFileSync(path.join(process.cwd(), 'data', filename), 'utf8');
            }
            return fs.readFileSync(filePath, 'utf8');
        };

        const readJson = (filename: string) => {
            const filePath = path.join(process.cwd(), 'public/data', filename);
            if (!fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', filename), 'utf8'));
            }
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        };

        // 1. Fetch Team Info
        const teamText = readCsv('nhl_teams.csv');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const teamData = Papa.parse(teamText, { header: true, skipEmptyLines: true }).data as any[];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const info = teamData.find((t: any) => t['Team Tricode'] === teamAbbrUpper || (t['Team Tricode'] === 'UTA' && teamAbbrUpper === 'UTA'));

        if (!info) {
            return NextResponse.json({ error: 'Team not found' }, { status: 404 });
        }

        const teamInfo: TeamInfo = {
            TeamName: info['Team Name'],
            CommonName: info['Common Name'],
            TeamTricode: info['Team Tricode'],
            HexColor1: info['Hex Color 1'],
            HexColor2: info['Hex Color 2'],
            TeamLogoURL: info['Team Logo URL']
        };

        // 2. Fetch Gamestats
        const gamestatsText = readCsv('gamestats.csv');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gamestats = Papa.parse(gamestatsText, { header: true, skipEmptyLines: true }).data as any[];

        const teamCommon = teamInfo.CommonName;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const teamGames = gamestats.filter((row: any) => row.team === teamCommon);

        // Process Games
        let w = 0, l = 0, otl = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const processedGames: GameLog[] = teamGames.map((row: any) => {
            const res = row.result;
            let result_display = '';

            if (res === 'RW' || res === 'OTW' || res === 'SOW') {
                w++;
                if (res === 'RW') result_display = 'W';
                if (res === 'OTW') result_display = 'W (OT)';
                if (res === 'SOW') result_display = 'W (SO)';
            }
            else if (res === 'OTL' || res === 'SOL') {
                otl++;
                if (res === 'OTL') result_display = 'OTL';
                if (res === 'SOL') result_display = 'SOL';
            }
            else if (res === 'RL') {
                l++;
                result_display = 'L';
            }

            return {
                game_id: row.game_id,
                date: row.game_date,
                opponent: row.opponent,
                result: result_display,
                result_code: res,
                home_away: row.home_away,
                gf: parseInt(row.goals_for),
                ga: parseInt(row.goals_ag),
                xgf: parseFloat(row.xG_for),
                xga: parseFloat(row.xG_against),
                starting_goalie: row.starting_goalie,
                opponent_starter: row.starting_goalie_opp,
                points: (res === 'RW' || res === 'OTW' || res === 'SOW') ? 2 : (res === 'OTL' || res === 'SOL') ? 1 : 0,

                pp_goals: parseInt(row.pp_goals),
                pp_opps: parseInt(row.pp_opportunities),
                pp_time: formatTime(row.pp_time),
                pp_goals_against: parseInt(row.pp_goals_against),
                pk_opps: parseInt(row.pk_opportunities),
                pk_time: formatTime(row.pk_time),
                sf: parseInt(row.sog_for),
                sa: parseInt(row.sog_ag),
                cf: parseInt(row.attempts_for),
                ca: parseInt(row.attempts_ag),
                sv_pct: parseFloat(row.save_percentage),
                en_gf: parseInt(row.emptynet_goalsfor),
                en_att: parseInt(row.en_attempts_for),
                en_ga: parseInt(row.emptynet_goalsagainst),
                en_att_ag: parseInt(row.en_attempts_against),
                gsax: parseFloat(row.xG_against) - (parseFloat(row.goals_ag) - parseFloat(row.emptynet_goalsagainst || '0')),

                otml: (['RL', 'OTL', 'SOL'].includes(row.result?.trim()) && parseInt(row.en_attempts_for) > 0) ? 'Yes' : '-',
                game_number: 0,
                raw: row
            };
        }).sort((a: GameLog, b: GameLog) => new Date(b.date).getTime() - new Date(a.date).getTime());

        // Assign Game Numbers
        const totalGames = processedGames.length;
        processedGames.forEach((g, i) => g.game_number = totalGames - i);

        // 3. Fetch Ratings
        let rating: TeamRating | null = null;
        try {
            const ratingsData = readJson('team_ratings.json');
            if (ratingsData[teamCommon]) {
                rating = ratingsData[teamCommon];
            }
        } catch { console.warn("Ratings not found"); }

        // 4. Fetch Player Stats (The Big One)
        // Only read and parse if necessary? No, we need it for the table.
        // But we FILTER it immediately.
        const playersText = readCsv('nhl_season_2025_2026_player_stats.csv');
        const players = Papa.parse(playersText, { header: true, skipEmptyLines: true, dynamicTyping: true }).data as PlayerBoxscoreRow[];
        // Include ALL rows for players currently on this team (not just rows while on this team)
        // so traded players' pre-trade games are visible in the availability strip
        const currentTeamPlayerIds = new Set(
            players.filter(p => p.team === teamAbbrUpper).map(p => String(p.player_id))
        );
        const teamPlayerStats = players.filter(p => currentTeamPlayerIds.has(String(p.player_id)));

        // 5. Fetch Upcoming (Today's Game)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let todaysGame: any = null;
        try {
            const upcomingData = readJson('upcoming_games.json');
            const todayStr = new Date().toLocaleDateString('en-CA');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            todaysGame = upcomingData.find((g: any) =>
                (g.homeTeamAbbrev === teamAbbrUpper || g.awayTeamAbbrev === teamAbbrUpper) &&
                g.gameDate === todayStr
            );

            // Logic to override goalie status from news
            if (todaysGame) {
                // Try to load player news if possible, else skip for now or do it
                // We can duplicate the logic here or rely on client to fetch news?
                // Let's do it here for completeness if simple
                try {
                    const newsData = readJson('player_news.json');
                    if (newsData) {
                        // ... (Override logic could go here)
                    }
                } catch { }
            }
        } catch {
            console.warn("Upcoming games fetch failed");
        }

        const leagueGames: GameLog[] = gamestats.map((row: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            const res = row.result;
            return {
                game_id: row.game_id,
                date: row.game_date,
                opponent: row.opponent,
                result: res,
                result_code: res,
                home_away: row.home_away,
                gf: parseInt(row.goals_for) || 0,
                ga: parseInt(row.goals_ag) || 0,
                xgf: parseFloat(row.xG_for) || 0,
                xga: parseFloat(row.xG_against) || 0,
                starting_goalie: row.starting_goalie || '',
                opponent_starter: row.starting_goalie_opp || '',
                points: (res === 'RW' || res === 'OTW' || res === 'SOW') ? 2 : (res === 'OTL' || res === 'SOL') ? 1 : 0,
                pp_goals: parseInt(row.pp_goals) || 0,
                pp_opps: parseInt(row.pp_opportunities) || 0,
                pp_time: formatTime(row.pp_time),
                pp_goals_against: parseInt(row.pp_goals_against) || 0,
                pk_opps: parseInt(row.pk_opportunities) || 0,
                pk_time: formatTime(row.pk_time),
                sf: parseInt(row.sog_for) || 0,
                sa: parseInt(row.sog_ag) || 0,
                cf: parseInt(row.attempts_for) || 0,
                ca: parseInt(row.attempts_ag) || 0,
                sv_pct: parseFloat(row.save_percentage) || 0,
                en_gf: parseInt(row.emptynet_goalsfor) || 0,
                en_att: 0,
                en_ga: parseInt(row.emptynet_goalsagainst) || 0,
                en_att_ag: 0,
                gsax: (parseFloat(row.xG_against) || 0) - ((parseInt(row.goals_ag) || 0) - (parseInt(row.emptynet_goalsagainst) || 0)),
                otml: '-',
                game_number: 0,
                raw: {}
            };
        });

        // 6. Extract current lineup from predictions_detailed.csv
        let lineup: TeamLineup | undefined;
        try {
            const predsText = readCsv('predictions_detailed.csv');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const preds = Papa.parse(predsText, { header: true, skipEmptyLines: true }).data as any[];
            // Find most recent prediction row featuring this team (by common name)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pred = preds.find((row: any) =>
                row.home_team === teamCommon || row.away_team === teamCommon
            );
            if (pred) {
                const lineupStr = pred.home_team === teamCommon ? pred.home_lineup : pred.away_lineup;
                if (lineupStr && lineupStr !== '{}' && lineupStr.trim()) {
                    lineup = JSON.parse(lineupStr) as TeamLineup;
                }
            }
        } catch { console.warn("Lineup fetch failed for", teamAbbrUpper); }

        const response: TeamStatsResponse = {
            teamInfo,
            games: processedGames,
            leagueGames,
            playerStats: teamPlayerStats,
            rating,
            record: { w, l, otl, pts: (w * 2) + otl },
            todaysGame,
            lineup,
        };

        return NextResponse.json(response);

    } catch (error) {
        console.error("API Error:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
