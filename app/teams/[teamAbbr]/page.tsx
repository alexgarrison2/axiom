"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { useParams } from 'next/navigation';
import Header from '@/components/Header';
import StatRing from '@/components/StatRing';
import GameBoxscore from '@/components/GameBoxscore';
import Link from 'next/link';

// --- Interfaces ---
interface TeamInfo {
    TeamName: string; // "Anaheim Ducks"
    CommonName: string; // "Ducks"
    TeamTricode: string; // "ANA"
    HexColor1: string;
    HexColor2: string;
    TeamLogoURL: string;
}

interface GameLog {
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
    raw: any; // Raw CSV row for dynamic parsing
}

interface PlayerBoxscoreRow {
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

interface TeamRating {
    xgf_rating: number;
    xga_rating: number;
    xgf_5v5_rating: number;
    xga_5v5_rating: number;
    pp_rating: number; // PP%
    pk_rating: number; // PK%
    def_rating: number; // xGA Rating (implies defensive strength if calculated)
}

const formatTime = (seconds: string | number) => {
    const s = parseInt(String(seconds));
    if (isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
};

export default function TeamDetailPage() {
    const params = useParams();
    const teamAbbr = (params.teamAbbr as string).toUpperCase();

    const [loading, setLoading] = useState(true);
    const [teamInfo, setTeamInfo] = useState<TeamInfo | null>(null);
    const [games, setGames] = useState<GameLog[]>([]);
    const [playerStats, setPlayerStats] = useState<PlayerBoxscoreRow[]>([]);
    const [rating, setRating] = useState<TeamRating | null>(null);
    const [record, setRecord] = useState({ w: 0, l: 0, otl: 0, pts: 0 });
    const [todaysGame, setTodaysGame] = useState<any>(null);

    const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'games' | 'skaters' | 'goalies'>('games');

    // Filters
    const [filters, setFilters] = useState({
        goalie: 'All',
        loc: 'All',
        period: 'All',
        last: 'All',
        result: 'All'
    });

    const [teamLogos, setTeamLogos] = useState<Record<string, string>>({});
    const [allTeamRatings, setAllTeamRatings] = useState<any>(null);
    const [allTeamsList, setAllTeamsList] = useState<any[]>([]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // 1. Fetch Team Info
                const teamRes = await fetch('/data/nhl_teams.csv');
                const teamText = await teamRes.text();
                const teamData = Papa.parse(teamText, { header: true, skipEmptyLines: true }).data as any[];

                // Build Logo Map
                const logos: Record<string, string> = {};
                teamData.forEach((t: any) => {
                    if (t['Common Name']) {
                        logos[t['Common Name'].trim()] = t['Team Logo URL'];
                    }
                });
                setTeamLogos(logos);

                // Fetch Upcoming Games for Today's Filter Logic
                try {
                    const upcomingRes = await fetch('/data/upcoming_games.json');
                    const upcomingData = await upcomingRes.json();

                    // Find today's game for this team
                    // We assume the file contains recent/current games. 
                    // To be safe, we look for a game matching today's date (or just the first one if listing "upcoming")
                    // But explicitly "Today" logic is safer.
                    const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
                    // Or use regex for robust matching if needed. "2026-01-16"

                    // Simple find
                    const todayGame = upcomingData.find((g: any) =>
                        (g.homeTeamAbbrev === teamAbbr || g.awayTeamAbbrev === teamAbbr) &&
                        g.gameDate === todayStr
                    );
                    setTodaysGame(todayGame || null);
                } catch (e) {
                    console.error("Failed to fetch upcoming games", e);
                }

                // Find CURRENT team info
                const info = teamData.find((t: any) => t['Team Tricode'] === teamAbbr || t['Team Tricode'] === 'UTA' && teamAbbr === 'UTA');

                if (info) {
                    setTeamInfo({
                        TeamName: info['Team Name'],
                        CommonName: info['Common Name'],
                        TeamTricode: info['Team Tricode'],
                        HexColor1: info['Hex Color 1'],
                        HexColor2: info['Hex Color 2'],
                        TeamLogoURL: info['Team Logo URL']
                    });
                }

                // 2. Fetch Gamestats for Game Log & Record
                const gamestatsRes = await fetch('/data/gamestats.csv');
                const gamestatsText = await gamestatsRes.text();
                const gamestats = Papa.parse(gamestatsText, { header: true, skipEmptyLines: true }).data as any[];

                // Filter for this team
                if (!info) return; // Can't proceed without team info

                const teamCommon = info['Common Name'];
                const teamGames = gamestats.filter((row: any) => row.team === teamCommon);

                // Process Stats
                let w = 0, l = 0, otl = 0;
                const processedGames = teamGames.map((row: any) => {
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
                        // Extended
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
                        gsax: parseFloat(row.xG_against) - parseFloat(row.goals_ag),
                        // Record Fix: Robust Parsing
                        otml: (['RL', 'OTL', 'SOL'].includes(row.result?.trim()) && parseInt(row.en_attempts_for) > 0) ? 'Yes' : '-',
                        game_number: 0, // Will be set after sorting
                        raw: row
                    };
                }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                // Assign Game Numbers (Total - Index)
                const totalGames = processedGames.length;
                processedGames.forEach((g: any, i: number) => g.game_number = totalGames - i);

                setGames(processedGames);
                setRecord({ w, l, otl, pts: (w * 2) + otl });

                // 3. Fetch Ratings
                const ratingsRes = await fetch('/data/team_ratings.json');
                const ratingsData = await ratingsRes.json();
                setAllTeamRatings(ratingsData);
                setAllTeamsList(teamData);

                if (ratingsData[teamCommon]) {
                    setRating(ratingsData[teamCommon]);
                }

                // 4. Fetch Player Stats
                const playersRes = await fetch('/data/nhl_season_2025_2026_player_stats.csv');
                const playersText = await playersRes.text();
                const players = Papa.parse(playersText, { header: true, skipEmptyLines: true, dynamicTyping: true }).data as PlayerBoxscoreRow[];

                const teamPlayerStats = players.filter(p => p.team === teamAbbr);
                setPlayerStats(teamPlayerStats);

            } catch (error) {
                console.error("Error fetching team data:", error);
            } finally {
                setLoading(false);
            }
        };

        if (teamAbbr) fetchData();
    }, [teamAbbr]);


    // -- Derived Stats --
    const getSkaterStats = useMemo(() => {
        const stats: Record<string, any> = {};
        playerStats.filter(p => p.is_goalie === 0).forEach(p => {
            if (!stats[p.player_id]) {
                stats[p.player_id] = { ...p, gp: 0, goals: 0, assists: 0, points: 0, shots: 0, hits: 0, blk: 0, pim: 0, plus_minus: 0 };
            }
            const s = stats[p.player_id];
            s.gp++;
            s.goals += p.goals;
            s.assists += p.assists;
            s.points += p.points;
            s.shots += p.shots;
            s.hits += p.hits;
            s.blk += p.blocked_shots;
            s.pim += p.pim;
            s.plus_minus += p.plus_minus;
            // TOI parsing needed if summing, simplified for now
        });
        return Object.values(stats).sort((a, b) => b.points - a.points);
    }, [playerStats]);

    // -- Filter Logic --
    const uniqueGoalies = useMemo(() => {
        const set = new Set(games.map(g => g.starting_goalie).filter(Boolean));
        return Array.from(set).sort();
    }, [games]);

    const filteredGames = useMemo(() => {
        let out = [...games];

        if (filters.goalie !== 'All') {
            out = out.filter(g => g.starting_goalie === filters.goalie);
        }
        if (filters.loc !== 'All') {
            out = out.filter(g => filters.loc === 'Home' ? g.home_away === 'Home' : g.home_away === 'Away');
        }
        if (filters.result !== 'All') {
            out = out.filter(g => {
                if (filters.result === 'W') return g.result_code.includes('W');
                if (filters.result === 'L') return g.result_code === 'RL' || g.result_code.includes('L'); // Includes OTL? usually separate, but generic L includes all losses? User asked W/L. Let's start strictly.
                // Re-reading user request: "Result (W/L)".
                // Usually people want simple W vs Not W (L/OTL).
                if (filters.result === 'W') return g.result.startsWith('W');
                if (filters.result === 'L') return g.result === 'L' || g.result === 'OTL' || g.result === 'SOL';
                return true;
            });
        }

        // Sorting is already Date Desc
        if (filters.last !== 'All') {
            if (filters.last === 'Season') {
                // Do nothing, return all games
            } else {
                const n = parseInt(filters.last);
                out = out.slice(0, n); // Slices top N (most recent)
            }
        }

        return out;
    }, [games, filters]);

    // Helper to get stats based on period
    const getStat = (game: GameLog, stat: 'gf' | 'ga' | 'sf' | 'sa' | 'cf' | 'ca' | 'xgf' | 'xga') => {
        if (filters.period === 'All') {
            return game[stat];
        }

        // For xG, we don't have period splits, return 0
        if (stat === 'xgf' || stat === 'xga') return 0;

        // Map to CSV columns: goals_for_1P, sog_for_1P, attempts_for_1P
        // Suffix: _1P, _2P, _3P, _OT
        const suffix = filters.period === '1st' ? '_1P' :
            filters.period === '2nd' ? '_2P' :
                filters.period === '3rd' ? '_3P' : '_OT';

        let prefix = '';
        if (stat === 'gf') prefix = 'goals_for';
        if (stat === 'ga') prefix = 'goals_ag';
        if (stat === 'sf') prefix = 'sog_for';
        if (stat === 'sa') prefix = 'sog_ag';
        if (stat === 'cf') prefix = 'attempts_for';
        if (stat === 'ca') prefix = 'attempts_ag';

        const val = parseInt(game.raw[prefix + suffix] || '0');
        return val;
    };



    // -- Totals Calculation --
    const totals = useMemo(() => {
        if (filteredGames.length === 0) return null;

        const count = filteredGames.length;
        let w = 0, l = 0, otl = 0;

        filteredGames.forEach(g => {
            // Use result_code to catch SOW/OTW which might be "W (SO)" in Result string
            const res = g.result_code ? g.result_code.toUpperCase().trim() : '';

            if (['RW', 'OTW', 'SOW', 'W'].includes(res)) {
                w++;
            }
            else if (['RL', 'L'].includes(res)) {
                l++;
            }
            else if (['OTL', 'SOL'].includes(res)) {
                otl++;
            }
        });

        const pts = (w * 2) + otl;
        const pt_pct = count > 0 ? (pts / (count * 2)).toFixed(3).replace(/^0+/, '') : '.000';
        const record = `${w}-${l}-${otl} ${pts}pts (${pt_pct}) ${count} GP`;

        const sum = (key: 'gf' | 'ga' | 'sf' | 'sa' | 'cf' | 'ca' | 'xgf' | 'xga') => filteredGames.reduce((acc, g) => acc + (getStat(g, key) as number), 0);

        const gf = sum('gf');
        const ga = sum('ga');
        const sf = sum('sf');
        const sa = sum('sa');
        const cf = sum('cf');
        const ca = sum('ca');
        const xgf = sum('xgf');
        const xga = sum('xga');

        // GSAx Total (Sum of individual game GSAx)
        const gsax = filteredGames.reduce((acc, g) => acc + (g.gsax || 0), 0);

        // EN Stats (Sums)
        const en_gf = filteredGames.reduce((acc, g) => acc + g.en_gf, 0);
        const en_att = filteredGames.reduce((acc, g) => acc + g.en_att, 0);
        const en_ga = filteredGames.reduce((acc, g) => acc + g.en_ga, 0);
        const en_att_ag = filteredGames.reduce((acc, g) => acc + g.en_att_ag, 0);

        const pp_goals = filteredGames.reduce((acc, g) => acc + g.pp_goals, 0);
        const pp_opps = filteredGames.reduce((acc, g) => acc + g.pp_opps, 0);
        const pk_goals_ag = filteredGames.reduce((acc, g) => acc + g.pp_goals_against, 0);
        const pk_opps = filteredGames.reduce((acc, g) => acc + g.pk_opps, 0);

        // SV% Calculation (Total Saves / Total SA)
        // Need Sum Saves
        const total_saves = filteredGames.reduce((acc, g) => acc + (getStat(g, 'sa') as number) - (getStat(g, 'ga') as number), 0); // Approx if saves not directly avail in specific period, but for Full Game it is.
        // Actually sv_pct in table row is calculated via (sa-ga)/sa. 
        // For period specific stats, 'saves' might not be in getStat directly? 
        // getStat handles 'sa' and 'ga'. So Saves = SA - GA.
        const tot_sv_pct = sa > 0 ? (total_saves / sa) : 0;

        return {
            record,
            gf: (gf / count).toFixed(1), // Average
            ga: (ga / count).toFixed(1), // Average
            gd: gf - ga, // Total Diff
            sf: (sf / count).toFixed(1),
            sa: (sa / count).toFixed(1),
            sd: (sf - sa), // Total Diff
            cf: (cf / count).toFixed(1),
            ca: (ca / count).toFixed(1),
            cd: (cf - ca), // Total Diff
            xgf: (xgf / count).toFixed(2),
            xga: (xga / count).toFixed(2),
            xgd: ((xgf - xga) / count).toFixed(2), // Average Diff or Total Diff? User said "xGF and xGA and xG Diff should be two decimal places". Usually Diff follows the inputs. Let's assume Average Diff if inputs are Average.
            // Wait, user said "Shot Diff Total should be the total Shot Diff". "Corsi Diff Total should be the total Corsi Diff".
            // But for xG? "xGF and xGA and xG Diff should be two decimal places". Didn't explicitly say "Total". 
            // Given xGF/xGA are averages, xG Diff likely Average too.
            // Let's stick to Average for xG Diff based on "two decimal places" context usually implying rate.

            gsax: gsax.toFixed(2), // Total GSAx

            en_gf, en_att, en_ga, en_att_ag,
            pp_goals, pp_opps,
            pk_goals_ag, pk_opps,
            pp_pct: pp_opps > 0 ? (pp_goals / pp_opps * 100).toFixed(1) : '0.0',
            pk_pct: pk_opps > 0 ? (100 - (pk_goals_ag / pk_opps * 100)).toFixed(1) : '0.0',
            sh_pct: sf > 0 ? (gf / sf * 100).toFixed(1) : '0.0',
            sv_pct: tot_sv_pct.toFixed(3).replace(/^0+/, '') // .901
        };
    }, [filteredGames, filters.period]);


    // Helper for Color Gradient (Red -> Grey -> Blue)
    const getGradientColor = (value: number, min: number, mid: number, max: number) => {
        // Clamp value
        const val = Math.max(min, Math.min(max, value));

        let r, g, b;

        if (val < mid) {
            // Red (248, 113, 113) to Grey (156, 163, 175)
            // Normalized position 0 to 1
            const ratio = (val - min) / (mid - min);
            r = Math.round(248 + (156 - 248) * ratio); // Start Red
            g = Math.round(113 + (163 - 113) * ratio);
            b = Math.round(113 + (175 - 113) * ratio);
        } else {
            // Grey (156, 163, 175) to Blue (96, 165, 250)
            const ratio = (val - mid) / (max - mid);
            r = Math.round(156 + (96 - 156) * ratio);
            g = Math.round(163 + (165 - 163) * ratio);
            b = Math.round(175 + (250 - 175) * ratio); // End Blue
        }

        return `rgb(${r}, ${g}, ${b})`;
    };

    // -- Render --
    if (loading) return <div className="min-h-screen bg-black text-white p-10">Loading...</div>;
    if (!teamInfo) return <div className="min-h-screen bg-black text-white p-10">Team Not Found</div>;

    const primaryColor = teamInfo.HexColor1;
    const secondaryColor = teamInfo.HexColor2 === '#000000' ? '#333' : teamInfo.HexColor2;

    return (
        <main className="min-h-screen bg-black text-white font-sans pb-20 overflow-x-hidden selection:bg-white/20">
            {/* Ambient Background */}
            <div
                className="fixed top-0 left-0 w-full h-[500px] opacity-40 blur-[150px] pointer-events-none z-0"
                style={{ background: `radial-gradient(circle at 50% 0%, ${primaryColor}, transparent)` }}
            ></div>

            {/* Team Navigation - Horizontal Logo Bar */}
            <div className="absolute top-0 left-0 right-0 z-30 bg-black/60 backdrop-blur-md border-b border-white/10">
                <div className="flex flex-wrap justify-center gap-1 p-2 max-w-[1800px] mx-auto px-4">
                    <Link href="/teams" className="text-gray-400 hover:text-white transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-wider mr-4 bg-black/80 z-10 py-1 pl-2 pr-4 border-r border-white/10 h-10 my-auto">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                        Teams
                    </Link>

                    {allTeamsList
                        .filter(t => t['Common Name'])
                        // Sort Alphabetically
                        .sort((a, b) => (a['Team Name'] || a['Common Name']).localeCompare(b['Team Name'] || b['Common Name']))
                        .map((t: any) => {
                            const name = t['Common Name'].trim();
                            const tricode = t['Team Tricode'];
                            const url = t['Team Logo URL'];
                            const isSelected = name === teamInfo?.CommonName;

                            // Color Overrides
                            const colorOverrides: Record<string, string> = {
                                'EDM': '#FF4C00', // Orange
                                'LAK': '#C0C0C0', // Silver
                                'UTA': '#69B3E7', // Light Blue
                            };

                            // Color Logic: use Scale/Secondary if Primary is too dark, else Primary
                            // Simplified: Just use primary for now, or Secondary if provided and primary is black
                            const c1 = t['Hex Color 1'] || '#FFFFFF';
                            const c2 = t['Hex Color 2'] || t['Hex Color 1'] || '#FFFFFF';

                            // Heuristic: If C1 is Black (#000000 or similar), try C2
                            const isBlack = c1.replace('#', '').toLowerCase() === '000000' || c1.toLowerCase() === 'black';
                            let glowColor = isBlack ? c2 : c1;

                            if (colorOverrides[tricode]) {
                                glowColor = colorOverrides[tricode];
                            }

                            return (
                                <Link
                                    key={name}
                                    href={`/teams/${tricode}`}
                                    className={`relative group transition-all duration-300 flex-shrink-0 ${isSelected ? 'opacity-100 scale-110 z-20' : 'opacity-40 grayscale hover:grayscale-0 hover:opacity-100'}`}
                                    title={t['Team Name']}
                                    style={isSelected ? { filter: `drop-shadow(0 0 10px ${glowColor})` } : {}}
                                >
                                    <img
                                        src={url}
                                        alt={name}
                                        className={`w-8 h-8 md:w-12 md:h-12 object-contain transition-transform ${isSelected ? 'scale-110' : ''}`}
                                    />
                                    {isSelected && (
                                        <div
                                            className="absolute inset-0 blur-xl rounded-full -z-10 opacity-40"
                                            style={{ backgroundColor: glowColor }}
                                        ></div>
                                    )}
                                </Link>
                            );
                        })}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="w-full px-4 md:px-8 relative z-10 pt-20">

                {/* Team Info Header REMOVED as per request */}


                {/* Tabs */}
                {/* Simplified Tabs - just simple buttons for now */}
                <div className="flex gap-4 border-b border-white/10 mb-6 sticky top-0 bg-black/80 backdrop-blur-md pt-4 pb-0 z-20">
                    {['games', 'skaters', 'goalies'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab as any)}
                            className={`pb-4 px-4 text-sm font-bold uppercase tracking-wider transition-colors ${activeTab === tab ? 'text-white border-b-2' : 'text-gray-500 hover:text-white'
                                }`}
                            style={{ borderColor: activeTab === tab ? primaryColor : 'transparent' }}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                {/* Filters (Button Groups) */}
                {activeTab === 'games' && (
                    <div className="flex flex-wrap gap-6 mb-6 p-4 bg-white/5 rounded-lg border border-white/10 items-center">
                        {/* Goalie */}
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Goalie</label>
                            <div className="flex flex-wrap gap-1">
                                <button
                                    onClick={() => setFilters({ ...filters, goalie: 'All' })}
                                    className={`px-3 py-1 rounded-full text-[10px] uppercase font-bold transition-all ${filters.goalie === 'All' ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'}`}
                                >
                                    All
                                </button>
                                {uniqueGoalies.map(g => {
                                    // Highlighting Logic
                                    let highlightClass = '';
                                    if (todaysGame) {
                                        // Check if this goalie is Home or Away confirmed
                                        const isHome = todaysGame.homeTeamAbbrev === teamAbbr;
                                        const confirmedName = isHome ? todaysGame.homeGoalieConfirmed : todaysGame.awayGoalieConfirmed;
                                        const status = isHome ? todaysGame.homeGoalieStatus : todaysGame.awayGoalieStatus;

                                        // Loose match Last Name
                                        if (confirmedName && confirmedName.includes(g)) {
                                            if (status === 'Confirmed') highlightClass = 'text-green-500 font-bold';
                                            else if (status === 'Likely') highlightClass = 'text-yellow-500 font-bold';
                                        }
                                    }

                                    return (
                                        <button
                                            key={g}
                                            onClick={() => setFilters({ ...filters, goalie: g })}
                                            className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${filters.goalie === g
                                                ? 'bg-white text-black'
                                                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                                                } ${filters.goalie !== g ? highlightClass : ''}`} // Apply color if NOT selected (selected is Black) or both? User said "font color". White/Black is background.
                                        // If selected, it's Black text on White bg. Green text on White bg might be hard.
                                        // Let's apply highlight only when NOT selected, or override?
                                        // If selected, keep Black. If not selected, use Green/Yellow instead of Gray.
                                        >
                                            {g.toUpperCase()}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Location Filter */}
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Location</label>
                            <div className="flex gap-1">
                                {['All', 'Home', 'Away'].map(loc => {
                                    const isTodayLoc = todaysGame && (
                                        (loc === 'Home' && todaysGame.homeTeamAbbrev === teamAbbr) ||
                                        (loc === 'Away' && todaysGame.awayTeamAbbrev === teamAbbr)
                                    );

                                    // Custom Blue for Location
                                    const locColor = '#83C7FF';

                                    return (
                                        <button
                                            key={loc}
                                            onClick={() => setFilters({ ...filters, loc: loc as any })}
                                            className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${filters.loc === loc
                                                ? 'bg-white text-black'
                                                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                                                }`}
                                            style={isTodayLoc && filters.loc !== loc ? { color: locColor } : {}}
                                        >
                                            {loc.toUpperCase()}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        {/* Period */}
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Period</label>
                            <div className="flex gap-1">
                                {['All', '1st', '2nd', '3rd', 'OT'].map(opt => (
                                    <button
                                        key={opt}
                                        onClick={() => setFilters({ ...filters, period: opt })}
                                        className={`px-3 py-1 rounded-full text-[10px] uppercase font-bold transition-all ${filters.period === opt ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'}`}
                                    >
                                        {opt === 'All' ? 'Full Game' : opt}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Last N */}
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Last</label>
                            <div className="flex gap-1">
                                {['All', '5', '10', '15', '20'].map(opt => (
                                    <button
                                        key={opt}
                                        onClick={() => setFilters({ ...filters, last: opt })}
                                        className={`px-3 py-1 rounded-full text-[10px] uppercase font-bold transition-all ${filters.last === opt ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'}`}
                                    >
                                        {opt === 'All' ? 'Season' : opt}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Result */}
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Result</label>
                            <div className="flex gap-1">
                                {['All', 'W', 'L'].map(opt => (
                                    <button
                                        key={opt}
                                        onClick={() => setFilters({ ...filters, result: opt })}
                                        className={`px-3 py-1 rounded-full text-[10px] uppercase font-bold transition-all ${filters.result === opt ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'}`}
                                    >
                                        {opt}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Game Log Tab */}
                {activeTab === 'games' && (
                    <div className="overflow-x-auto border border-gray-800 rounded-lg bg-gray-900/50">
                        <table className="w-full text-xs text-left whitespace-nowrap border-collapse">
                            <thead className="bg-gray-900/80 text-gray-400 font-bold uppercase tracking-wider border-b border-gray-700">
                                <tr>
                                    <th className="p-1 sticky left-0 bg-gray-900 z-30 min-w-[2rem] w-8 text-center text-gray-500">#</th>
                                    <th className="p-1 sticky left-8 bg-gray-900 z-30 min-w-[6rem] w-24 text-center border-r border-gray-700">Date</th>
                                    <th className="p-1 sticky left-32 bg-gray-900 z-30 min-w-[2rem] w-8 text-center border-r border-gray-700">Loc</th>
                                    <th className="p-1 sticky left-40 bg-gray-900 z-30 min-w-[3rem] w-12 text-center border-r border-gray-700">Opp</th>
                                    <th className="p-1">Starter</th>
                                    <th className="p-1">Opp Strt</th>
                                    <th className="p-1 text-center">Res</th>
                                    <th className="p-1 text-center">GF</th>
                                    <th className="p-1 text-center">GA</th>
                                    <th className="p-1 text-center">GΔ</th>
                                    {filters.period === 'All' && (
                                        <>
                                            <th className="p-1 text-center text-blue-300">Powerplay</th>
                                            <th className="p-1 text-center text-red-300">Penalty Kill</th>
                                        </>
                                    )}
                                    <th className="p-1 text-center">SF</th>
                                    <th className="p-1 text-center">SA</th>
                                    <th className="p-1 text-center">SΔ</th>
                                    <th className="p-1 text-center">CF</th>
                                    <th className="p-1 text-center">CA</th>
                                    <th className="p-1 text-center">CΔ</th>
                                    <th className="p-1 text-center">SH%</th>
                                    <th className="p-1 text-center">SV%</th>
                                    {filters.period === 'All' && <th className="p-1 text-center">GSAx</th>}
                                    {filters.period === 'All' && (
                                        <>
                                            <th className="p-1 text-center">xGF</th>
                                            <th className="p-1 text-center">xGA</th>
                                            <th className="p-1 text-center">xGΔ</th>
                                            <th className="p-1 text-center">EN GF</th>
                                            <th className="p-1 text-center">EN Att</th>
                                            <th className="p-1 text-center">OTML</th>
                                            <th className="p-1 text-center">EN GA</th>
                                            <th className="p-1 text-center">EN Att Ag</th>
                                        </>
                                    )}
                                </tr>
                                {/* Totals Row */}
                                {totals && (
                                    <tr className="bg-white/10 font-bold border-b border-white/20 text-white">
                                        <td className="p-1 sticky left-0 bg-[#1c1c1c] z-30 border-r border-gray-800 text-center min-w-[2rem] w-8"></td>
                                        <td className="p-1 sticky left-8 bg-[#1c1c1c] z-30 border-r border-gray-700 text-center min-w-[6rem] w-24">TOTALS</td>
                                        <td className="p-1 sticky left-32 bg-[#1c1c1c] z-30 border-r border-gray-800 text-center min-w-[2rem] w-8"></td>
                                        <td className="p-1 sticky left-40 bg-[#1c1c1c] z-30 border-r border-gray-800 text-center min-w-[3rem] w-12"></td>
                                        <td colSpan={3} className="p-1 text-center text-gray-400 text-[10px] tracking-wider uppercase">{totals.record}</td>
                                        <td className="p-1 text-center text-white">{totals.gf}</td>
                                        <td className="p-1 text-center text-white">{totals.ga}</td>
                                        <td className={`p-1 text-center ${totals.gd > 0 ? 'text-green-400' : totals.gd < 0 ? 'text-red-400' : 'text-gray-500'}`}>{totals.gd > 0 ? '+' : ''}{totals.gd}</td>
                                        {filters.period === 'All' && (
                                            <>
                                                <td className="p-1 text-center text-blue-300">{totals.pp_goals} / {totals.pp_opps} ({totals.pp_pct}%)</td>
                                                <td className="p-1 text-center text-red-300">{totals.pk_goals_ag} / {totals.pk_opps} ({totals.pk_pct}%)</td>
                                            </>
                                        )}
                                        <td className="p-1 text-center text-gray-300">{totals.sf}</td>
                                        <td className="p-1 text-center text-gray-300">{totals.sa}</td>
                                        <td className={`p-1 text-center ${totals.sd > 0 ? 'text-green-400' : totals.sd < 0 ? 'text-red-400' : 'text-gray-500'}`}>{totals.sd > 0 ? '+' : ''}{totals.sd}</td>
                                        <td className="p-1 text-center text-gray-300">{totals.cf}</td>
                                        <td className="p-1 text-center text-gray-300">{totals.ca}</td>
                                        <td className={`p-1 text-center ${totals.cd > 0 ? 'text-green-400' : totals.cd < 0 ? 'text-red-400' : 'text-gray-500'}`}>{totals.cd > 0 ? '+' : ''}{totals.cd}</td>
                                        <td className="p-1 text-center" style={{ color: getGradientColor(parseFloat(totals.sh_pct), 0, 10, 20) }}>{totals.sh_pct}%</td>
                                        <td className="p-1 text-center" style={{ color: getGradientColor(parseFloat(totals.sv_pct), 0.800, 0.900, 1.000) }}>{totals.sv_pct}</td>
                                        {filters.period === 'All' && <td className={`p-1 text-center ${parseFloat(totals.gsax) > 0 ? 'text-green-400' : 'text-red-400'}`}>{parseFloat(totals.gsax) > 0 ? '+' : ''}{totals.gsax}</td>}
                                        {filters.period === 'All' && (
                                            <>
                                                <td className="p-1 text-center text-gray-300">{totals.xgf}</td>
                                                <td className="p-1 text-center text-gray-300">{totals.xga}</td>
                                                <td className={`p-1 text-center ${parseFloat(totals.xgd) > 0 ? 'text-green-400' : parseFloat(totals.xgd) < 0 ? 'text-red-400' : 'text-gray-500'}`}>{parseFloat(totals.xgd) > 0 ? '+' : ''}{totals.xgd}</td>
                                                <td className="p-1 text-center text-gray-500">{totals.en_att > 0 ? totals.en_gf : '-'}</td>
                                                <td className="p-1 text-center text-gray-500">{totals.en_att > 0 ? totals.en_att : '-'}</td>
                                                <td></td>
                                                <td className="p-1 text-center text-gray-500">{totals.en_att_ag > 0 ? totals.en_ga : '-'}</td>
                                                <td className="p-1 text-center text-gray-500">{totals.en_att_ag > 0 ? totals.en_att_ag : '-'}</td>
                                            </>
                                        )}
                                    </tr>
                                )}
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                                {games.length === 0 ?
                                    <tr><td colSpan={30} className="p-4 text-center text-gray-500">No games played.</td></tr>
                                    : filteredGames.map((game, idx) => {
                                        const isExpanded = expandedGameId === game.game_id;

                                        // Dynamic Stats
                                        const gf = getStat(game, 'gf');
                                        const ga = getStat(game, 'ga');
                                        const sf = getStat(game, 'sf');
                                        const sa = getStat(game, 'sa');
                                        const cf = getStat(game, 'cf');
                                        const ca = getStat(game, 'ca');

                                        const gd = gf - ga;
                                        const sd = sf - sa;
                                        const cd = cf - ca;
                                        const xgd = game.xgf - game.xga;

                                        const sh_pct = sf > 0 ? (gf / sf * 100).toFixed(1) : "0.0";
                                        // SV% for period is tricky if using total sv_pct column. Better to calc from shots/goals
                                        const sv_pct_val = sa > 0 ? ((sa - ga) / sa).toFixed(3).replace(/^0+/, '') : ".000";

                                        const gsax = (game.xgf - game.xga - (game.gf - game.ga)).toFixed(2);
                                        const opponentName = game.opponent.trim();
                                        const logoUrl = teamLogos[opponentName] || teamLogos[opponentName.split(' ').pop() || ''] || '';

                                        return (
                                            <React.Fragment key={game.game_id}>
                                                <tr
                                                    onClick={() => setExpandedGameId(isExpanded ? null : game.game_id)}
                                                    className={`cursor-pointer transition-colors hover:bg-white/5 ${idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]'}`}
                                                >
                                                    <td className="p-1 sticky left-0 bg-gray-900 border-r border-gray-800 z-20 text-center font-mono text-gray-500 text-[10px] min-w-[2rem] w-8">{game.game_number}</td>
                                                    <td className="p-1 sticky left-8 bg-gray-900 border-r border-gray-700 z-20 font-mono text-gray-300 min-w-[6rem] w-24 text-center text-[11px]">{game.date}</td>
                                                    <td className={`p-1 sticky left-32 bg-gray-900 border-r border-gray-700 z-20 text-center font-bold text-[10px] min-w-[2rem] w-8 ${game.home_away === 'Home' ? 'text-gray-500' : 'text-blue-400'}`}>
                                                        {game.home_away === 'Home' ? 'vs' : '@'}
                                                    </td>
                                                    <td className="p-1 sticky left-40 bg-gray-900 border-r border-gray-700 z-20 justify-center min-w-[3rem] w-12 text-center">
                                                        <div className="w-5 h-5 relative mx-auto" title={game.opponent}>
                                                            {logoUrl ? <img src={logoUrl} alt={game.opponent} className="w-5 h-5 object-contain" /> : <span className='text-[9px]'>{game.opponent.substring(0, 3)}</span>}
                                                        </div>
                                                    </td>
                                                    <td className="p-1 text-gray-400 text-[10px] truncate max-w-[80px]" title={game.starting_goalie}>
                                                        {game.starting_goalie ? game.starting_goalie.split(' ').pop() : '-'}
                                                    </td>
                                                    <td className="p-1 text-gray-400 text-[10px] truncate max-w-[80px]" title={game.opponent_starter}>
                                                        {game.opponent_starter ? game.opponent_starter.split(' ').pop() : '-'}
                                                    </td>
                                                    <td className="p-1 text-center">
                                                        <span className={`px-1 py-0.5 rounded text-[10px] font-black ${game.result_code.includes('W') ? 'bg-green-900/40 text-green-400 border border-green-500/20' :
                                                            game.result_code.includes('OTL') ? 'bg-orange-900/40 text-orange-400 border border-orange-500/20' :
                                                                'bg-red-900/40 text-red-400 border border-red-500/20'
                                                            }`}>
                                                            {game.result}
                                                        </span>
                                                    </td>
                                                    <td className="p-1 text-center font-mono text-white">{gf}</td>
                                                    <td className="p-1 text-center font-mono text-white">{ga}</td>
                                                    <td className={`p-1 text-center font-bold font-mono ${gd > 0 ? 'text-green-400' : gd < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                                                        {gd > 0 ? '+' : ''}{gd}
                                                    </td>
                                                    {filters.period === 'All' && (
                                                        <>
                                                            <td className="p-1 text-center font-mono text-blue-300">
                                                                {game.pp_goals} / {game.pp_opps}
                                                            </td>
                                                            <td className="p-1 text-center font-mono text-red-300">
                                                                {game.pp_goals_against} / {game.pk_opps}
                                                            </td>
                                                        </>
                                                    )}
                                                    <td className="p-1 text-center font-mono text-gray-300">{sf}</td>
                                                    <td className="p-1 text-center font-mono text-gray-300">{sa}</td>
                                                    <td className={`p-1 text-center font-mono ${sd > 0 ? 'text-green-400/70' : sd < 0 ? 'text-red-400/70' : 'text-gray-500'}`}>
                                                        {sd > 0 ? '+' : ''}{sd}
                                                    </td>
                                                    <td className="p-1 text-center font-mono text-gray-300">{cf}</td>
                                                    <td className="p-1 text-center font-mono text-gray-300">{ca}</td>
                                                    <td className={`p-1 text-center font-mono ${cd > 0 ? 'text-green-400/70' : cd < 0 ? 'text-red-400/70' : 'text-gray-500'}`}>
                                                        {cd > 0 ? '+' : ''}{cd}
                                                    </td>
                                                    <td className="p-1 text-center font-mono" style={{ color: getGradientColor(parseFloat(sh_pct), 0, 10, 20) }}>{sh_pct}%</td>
                                                    <td className="p-1 text-center font-mono" style={{ color: getGradientColor(parseFloat(sv_pct_val), 0.800, 0.900, 1.000) }}>{sv_pct_val}</td>
                                                    {filters.period === 'All' && <td className={`p-1 text-center font-mono font-bold ${parseFloat(gsax) > 0 ? 'text-green-400' : 'text-red-400'}`}>{gsax}</td>}
                                                    {filters.period === 'All' && (
                                                        <>
                                                            <td className="p-1 text-center font-mono text-gray-300">{game.xgf.toFixed(2)}</td>
                                                            <td className="p-1 text-center font-mono text-gray-300">{game.xga.toFixed(2)}</td>
                                                            <td className={`p-1 text-center font-mono ${xgd > 0 ? 'text-green-400/70' : xgd < 0 ? 'text-red-400/70' : 'text-gray-500'}`}>
                                                                {xgd > 0 ? '+' : ''}{xgd.toFixed(2)}
                                                            </td>
                                                            <td className="p-1 text-center font-mono text-gray-500">{game.en_att > 0 ? game.en_gf : '-'}</td>
                                                            <td className="p-1 text-center font-mono text-gray-500">{game.en_att > 0 ? game.en_att : '-'}</td>
                                                            <td className={`p-1 text-center font-mono ${game.otml === 'Yes' ? 'text-red-400 font-bold' : 'text-gray-500'}`}>{game.otml}</td>
                                                            <td className="p-1 text-center font-mono text-gray-500">{game.en_att_ag > 0 ? game.en_ga : '-'}</td>
                                                            <td className="p-1 text-center font-mono text-gray-500">{game.en_att_ag > 0 ? game.en_att_ag : '-'}</td>
                                                        </>
                                                    )}
                                                </tr>
                                                {isExpanded && (
                                                    <tr>
                                                        <td colSpan={30} className="p-0 border-b border-gray-800 bg-gray-900/50">
                                                            <div className="p-4 border-l-4" style={{ borderColor: primaryColor }}>
                                                                <GameBoxscore
                                                                    gameId={parseInt(game.game_id)}
                                                                    teamAbbr={teamAbbr}
                                                                    // Robust filter: convert both to string to ensure matching
                                                                    playerStats={playerStats.filter(p => String(p.game_id) === String(game.game_id))}
                                                                />
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Skaters Tab */}
                {activeTab === 'skaters' && (
                    <div className="overflow-x-auto bg-white/5 rounded-lg p-4">
                        <table className="w-full text-sm text-left">
                            <thead className="text-gray-500 border-b border-white/10">
                                <tr>
                                    <th className="p-2">Player</th>
                                    <th className="p-2 text-center">Pos</th>
                                    <th className="p-2 text-center">GP</th>
                                    <th className="p-2 text-right text-white font-bold">PTS</th>
                                    <th className="p-2 text-right">G</th>
                                    <th className="p-2 text-right">A</th>
                                    <th className="p-2 text-right">+/-</th>
                                    <th className="p-2 text-right">S</th>
                                    <th className="p-2 text-right">HIT</th>
                                    <th className="p-2 text-right">BLK</th>
                                </tr>
                            </thead>
                            <tbody>
                                {getSkaterStats.map((p: any) => (
                                    <tr key={p.player_id} className="border-b border-white/5 hover:bg-white/5">
                                        <td className="p-2 font-medium">#{p.number} {p.name}</td>
                                        <td className="p-2 text-center text-gray-500">{p.position}</td>
                                        <td className="p-2 text-center text-gray-400">{p.gp}</td>
                                        <td className="p-2 text-right font-bold text-emerald-400">{p.points}</td>
                                        <td className="p-2 text-right text-white">{p.goals}</td>
                                        <td className="p-2 text-right text-gray-400">{p.assists}</td>
                                        <td className="p-2 text-right text-gray-400">{p.plus_minus}</td>
                                        <td className="p-2 text-right text-gray-500">{p.shots}</td>
                                        <td className="p-2 text-right text-gray-500">{p.hits}</td>
                                        <td className="p-2 text-right text-gray-500">{p.blk}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Goalies Tab - Placeholder for now */}
                {activeTab === 'goalies' && (
                    <div className="p-10 text-center text-gray-500 italic">
                        Goalie aggregates coming soon. View Game Logs for details.
                    </div>
                )}

            </div>
        </main>
    );
}
