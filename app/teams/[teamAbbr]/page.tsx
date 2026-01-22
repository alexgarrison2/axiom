"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"

import Papa from 'papaparse';
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation';
import GameBoxscore from '@/components/GameBoxscore';
import TeamChart from '@/components/TeamChart';
import TeamSelector from '@/components/TeamSelector';

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
    raw: Record<string, string>; // Raw CSV row for dynamic parsing
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

const formatTime = (seconds: string | number) => {
    const s = parseInt(String(seconds));
    if (isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
};

export default function TeamDetailPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const teamAbbr = (params.teamAbbr as string).toUpperCase();

    const [loading, setLoading] = useState(true);
    const [teamInfo, setTeamInfo] = useState<TeamInfo | null>(null);
    const [games, setGames] = useState<GameLog[]>([]);
    const [playerStats, setPlayerStats] = useState<PlayerBoxscoreRow[]>([]);
    const [todaysGame, setTodaysGame] = useState<any>(null); // Kept as any for flexibility with JSON

    const [expandedGameId, setExpandedGameId] = useState<string | null>(null);

    // Initialize activeTab from URL or default to 'games'
    const activeTab = searchParams.get('tab') as 'games' | 'charts' | 'skaters' | 'goalies' || 'games';

    // Handler to update URL when tab changes
    const handleTabChange = (val: string) => {
        const newParams = new URLSearchParams(searchParams.toString());
        newParams.set('tab', val);
        router.replace(`${pathname}?${newParams.toString()}`, { scroll: false });
    };

    // Filters
    const [filters, setFilters] = useState({
        goalie: 'All',
        loc: 'All',
        period: 'All',
        last: 'All',
        result: 'All'
    });

    const [teamLogos, setTeamLogos] = useState<Record<string, string>>({});
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
                let todayGame: any = null;
                try {
                    const upcomingRes = await fetch('/data/upcoming_games.json');
                    const upcomingData = await upcomingRes.json();

                    // Find today's game for this team
                    const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

                    // Simple find
                    todayGame = upcomingData.find((g: any) =>
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

                // 3. Fetch Player News for Overrides
                let newsData: any = {};
                try {
                    const newsRes = await fetch('/data/player_news.json');
                    if (newsRes.ok) {
                        newsData = await newsRes.json();
                    }
                } catch (e) {
                    console.warn("Could not load player news:", e);
                }

                // Check for Goalie Overrides in Today's Game
                // Logic: If status is Unconfirmed, but News says "Goalie Start", force Confirmed.
                if (todayGame && newsData && todayGame.homeTeamAbbrev && todayGame.awayTeamAbbrev) {
                    const checkOverride = (teamAbbr: string, currentStatus: string, expectedStarter: string) => {
                        if (currentStatus !== 'Unconfirmed') return currentStatus;

                        const teamNews = newsData[teamAbbr] || [];
                        const starterNews = teamNews.find((n: any) =>
                            n.category === 'Goalie Start' &&
                            (n.player.includes(expectedStarter) || expectedStarter.includes(n.player))
                        );

                        return starterNews ? 'Confirmed' : currentStatus;
                    };

                    const newHomeStatus = checkOverride(todayGame.homeTeamAbbrev, todayGame.homeGoalieStatus, todayGame.homeGoalieConfirmed);
                    const newAwayStatus = checkOverride(todayGame.awayTeamAbbrev, todayGame.awayGoalieStatus, todayGame.awayGoalieConfirmed);

                    if (newHomeStatus !== todayGame.homeGoalieStatus || newAwayStatus !== todayGame.awayGoalieStatus) {
                        setTodaysGame({
                            ...todayGame,
                            homeGoalieStatus: newHomeStatus,
                            awayGoalieStatus: newAwayStatus
                        });
                    }
                }


                // 2. Fetch Gamestats for Game Log & Record
                const gamestatsRes = await fetch('/data/gamestats.csv');
                const gamestatsText = await gamestatsRes.text();
                const gamestats = Papa.parse(gamestatsText, { header: true, skipEmptyLines: true }).data as any[];

                // Filter for this team
                if (!info) {
                    console.error("Team info not found for abbr:", teamAbbr);
                    return;
                }

                const teamCommon = info['Common Name'];
                console.log("Filtering games for:", teamCommon, "gamestats total:", gamestats.length);



                const teamGames = gamestats.filter((row: any) => row.team === teamCommon);
                console.log("Found games:", teamGames.length);

                // Process Stats
                const processedGames = teamGames.map((row: any) => {
                    const res = row.result;
                    let result_display = '';

                    if (res === 'RW' || res === 'OTW' || res === 'SOW') {
                        if (res === 'RW') result_display = 'W';
                        if (res === 'OTW') result_display = 'W (OT)';
                        if (res === 'SOW') result_display = 'W (SO)';
                    }
                    else if (res === 'OTL' || res === 'SOL') {
                        if (res === 'OTL') result_display = 'OTL';
                        if (res === 'SOL') result_display = 'SOL';
                    }
                    else if (res === 'RL') {
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
                        gsax: parseFloat(row.xG_against) - (parseFloat(row.goals_ag) - parseFloat(row.emptynet_goalsagainst || '0')),
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

                // 3. Fetch Ratings (Removed unused calls)
                setAllTeamsList(teamData);

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
        if (filters.period !== 'All') {
            // Logic for period filtering or just UI? 
            // Assuming simplified filter: if ALL, show totals. If Period, user likely wants split stats which we don't have row data for easily here?
            // Actually, the previous implementation hid columns based on filters.period === 'All'. 
            // We will respect that column hiding.
        }
        // "Last N Games" filter logic
        if (filters.last !== 'All' && filters.last !== 'Season') {
            const n = parseInt(filters.last);
            if (!isNaN(n)) {
                out = out.slice(0, n);
            }
        }
        if (filters.result !== 'All') {
            out = out.filter(g => {
                if (filters.result === 'W') return g.result.startsWith('W');
                if (filters.result === 'L') return g.result === 'L' || g.result === 'OTL' || g.result === 'SOL';
                return true;
            });
        }
        return out;
    }, [games, filters]);

    // Slice for Display (Table)
    const displayedGames = filteredGames; // No pagination yet

    const getStat = (game: GameLog, stat: keyof GameLog) => {
        return game[stat];
    };

    // Calculate Totals Row
    const totals = useMemo(() => {
        if (displayedGames.length === 0) return null;

        const count = displayedGames.length;
        // Simple Sums
        let w = 0, l = 0, otl = 0;
        displayedGames.forEach(g => {
            if (g.result.includes('W')) w++;
            else if (g.result.includes('OT') || g.result.includes('SO')) otl++;
            else l++;
        });

        const record = \`\${w}-\${l}-\${otl}\`;

        const gf = displayedGames.reduce((acc, g) => acc + g.gf, 0);
        const ga = displayedGames.reduce((acc, g) => acc + g.ga, 0);
        const sf = displayedGames.reduce((acc, g) => acc + g.sf, 0);
        const sa = displayedGames.reduce((acc, g) => acc + g.sa, 0);
        const cf = displayedGames.reduce((acc, g) => acc + g.cf, 0);
        const ca = displayedGames.reduce((acc, g) => acc + g.ca, 0);
        const xgf = displayedGames.reduce((acc, g) => acc + (g.xgf || 0), 0);
        const xga = displayedGames.reduce((acc, g) => acc + (g.xga || 0), 0);
        const gsax = displayedGames.reduce((acc, g) => acc + (g.gsax || 0), 0);

        const en_gf = displayedGames.reduce((acc, g) => acc + g.en_gf, 0);
        const en_att = displayedGames.reduce((acc, g) => acc + g.en_att, 0);
        const en_ga = displayedGames.reduce((acc, g) => acc + g.en_ga, 0);
        const en_att_ag = displayedGames.reduce((acc, g) => acc + g.en_att_ag, 0);
        
        const pp_goals = displayedGames.reduce((acc, g) => acc + g.pp_goals, 0);
        const pp_opps = displayedGames.reduce((acc, g) => acc + g.pp_opps, 0);
        const pk_goals_ag = displayedGames.reduce((acc, g) => acc + g.pp_goals_against, 0);
        const pk_opps = displayedGames.reduce((acc, g) => acc + g.pk_opps, 0);

        // SV% Calculation (Total Saves / Total SA)
        // Need Sum Saves
        const total_saves = displayedGames.reduce((acc, g) => acc + (getStat(g, 'sa') as number) - (getStat(g, 'ga') as number), 0);
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
            xgd: (xgf - xga).toFixed(2), // Total Diff

            gsax: gsax.toFixed(2), // Total GSAx

            en_gf, en_att, en_ga, en_att_ag,
            pp_goals, pp_opps,
            pk_goals_ag, pk_opps,
            pp_pct: pp_opps > 0 ? (pp_goals / pp_opps * 100).toFixed(1) : '0.0',
            pk_pct: pk_opps > 0 ? (100 - (pk_goals_ag / pk_opps * 100)).toFixed(1) : '0.0',
            sh_pct: sf > 0 ? (gf / sf * 100).toFixed(1) : '0.0',
            sv_pct: tot_sv_pct.toFixed(3).replace(/^0+/, '') // .901
        };
    }, [displayedGames, filters.period]);


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

        return \`rgb(\${r}, \${g}, \${b})\`;
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
                style={{ background: \`radial-gradient(circle at 50% 0%, \${primaryColor}, transparent)\` }}
            ></div>

            {/* Navbar / Breadcrumbs Area (New Team Selector Integrated) */}
            <div className="fixed top-0 left-0 right-0 z-40 bg-black/80 backdrop-blur-xl border-b border-white/5 h-16 flex items-center">
                <div className="max-w-[1800px] mx-auto px-4 md:px-8 w-full flex items-center justify-between">
                     <div className="flex items-center gap-6">
                         <Link href="/" className="group flex items-center gap-2 text-gray-500 hover:text-white transition-colors">
                            <span className="text-xs font-bold uppercase tracking-wider block">Home</span>
                        </Link>
                         <div className="h-6 w-px bg-white/10"></div>
                         <TeamSelector teams={allTeamsList} currentTeam={teamInfo} />
                     </div>
                </div>
            </div>

            {/* Padding for fixed navbar */}
            <div className="pt-20"></div>

            {/* Main Content */}
            <div className="max-w-[1900px] mx-auto z-10 relative">

                <Tabs value={activeTab} onValueChange={(val) => handleTabChange(val as any)} className="w-full">
                    {/* Tabs List */}
                    <div className="px-8 border-b border-white/10 mb-4">
                        <TabsList className="bg-transparent h-auto p-0 gap-8">
                            {['games', 'charts', 'skaters', 'goalies'].map(t => (
                                <TabsTrigger 
                                    key={t}
                                    value={t} 
                                    className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-white rounded-none px-0 py-3 text-sm font-bold uppercase tracking-widest text-gray-500 data-[state=active]:text-white transition-all"
                                >
                                    {t}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </div>

                    <TabsContent value="games" className="m-0 focus-visible:outline-none px-4 md:px-8">

                        {/* Filters Container */}
                        <div className="flex flex-wrap gap-x-8 gap-y-4 mb-4 p-4 bg-white/5 rounded-lg border border-white/10 items-center">
                            
                            {/* Goalie Filter */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Goalie</label>
                                <div className="flex flex-wrap gap-1">
                                    <button
                                        onClick={() => setFilters({ ...filters, goalie: 'All' })}
                                        className={`px - 3 py - 1 rounded - sm text - [10px] uppercase font - bold transition - all ${ filters.goalie === 'All' ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white' } `}
                                    >
                                        All
                                    </button>
                                    {uniqueGoalies.map(g => (
                                        <button
                                            key={g}
                                            onClick={() => setFilters({ ...filters, goalie: g })}
                                            className={`px - 3 py - 1 rounded - sm text - [10px] uppercase font - bold transition - all ${ filters.goalie === g ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white' } `} 
                                        >
                                            {g.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Location Filter */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Location</label>
                                <div className="flex gap-1">
                                    {['All', 'Home', 'Away'].map(loc => (
                                        <button
                                            key={loc}
                                            onClick={() => setFilters({ ...filters, loc })}
                                            className={`px - 3 py - 1 rounded - sm text - [10px] uppercase font - bold transition - all ${ filters.loc === loc ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white' } `}
                                        >
                                            {loc}
                                        </button>
                                    ))}
                                </div>
                            </div>

                             {/* Period Filter */}
                             <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Period</label>
                                <div className="flex gap-1">
                                    {['All', '1st', '2nd', '3rd', 'OT'].map(p => (
                                        <button
                                            key={p}
                                            onClick={() => setFilters({ ...filters, period: p })} // Note: Logic for period display is in Render
                                            className={`px - 3 py - 1 rounded - sm text - [10px] uppercase font - bold transition - all ${ filters.period === p ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white' } `}
                                        >
                                            {p === 'All' ? 'Full Game' : p}
                                        </button>
                                    ))}
                                </div>
                            </div>

                             {/* Last N Filter */}
                             <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Last</label>
                                <div className="flex gap-1">
                                    {['Season', '5', '10', '15', '20'].map(opt => (
                                        <button
                                            key={opt}
                                            onClick={() => setFilters({ ...filters, last: opt })}
                                            className={`px - 3 py - 1 rounded - sm text - [10px] uppercase font - bold transition - all ${ filters.last === opt ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white' } `}
                                        >
                                            {opt}
                                        </button>
                                    ))}
                                </div>
                            </div>

                             {/* Result Filter */}
                             <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Result</label>
                                <div className="flex gap-1">
                                    {['All', 'W', 'L'].map(res => (
                                        <button
                                            key={res}
                                            onClick={() => setFilters({ ...filters, result: res })}
                                            className={`px - 3 py - 1 rounded - sm text - [10px] uppercase font - bold transition - all ${ filters.result === res ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white' } `}
                                        >
                                            {res}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* --- Classic Table Layout --- */}
                        <div className="overflow-x-auto rounded-lg border border-white/5 bg-black/40 backdrop-blur-sm">
                            <table className="w-full text-[10px] md:text-xs">
                                <thead>
                                    <tr className="border-b border-white/10 bg-white/5 text-gray-400 uppercase tracking-wider font-bold">
                                        <th className="p-2 text-left w-20">Date</th>
                                        <th className="p-2 text-left">Opponent</th>
                                        <th className="p-2 text-center">Score</th>
                                        <th className="p-2 text-center border-l border-white/5">GF</th>
                                        <th className="p-2 text-center">GA</th>
                                        <th className="p-2 text-center font-bold text-white border-r border-white/5">Diff</th>
                                        
                                        {/* Dynamic Columns based on Period Filter - Logic from original file */}
                                        {filters.period === 'All' && (
                                            <>
                                                <th className="p-2 text-center text-blue-300">PP</th>
                                                <th className="p-2 text-center text-red-300 border-r border-white/5">PK</th>
                                            </>
                                        )}

                                        <th className="p-2 text-center text-gray-300">SF</th>
                                        <th className="p-2 text-center text-gray-300">SA</th>
                                        <th className="p-2 text-center font-bold text-white border-r border-white/5">S Diff</th>

                                        <th className="p-2 text-center text-gray-400">CF</th>
                                        <th className="p-2 text-center text-gray-400">CA</th>
                                        <th className="p-2 text-center font-bold text-white border-r border-white/5">C Diff</th>

                                        <th className="p-2 text-center">SH%</th>
                                        <th className="p-2 text-center border-r border-white/5">SV%</th>

                                        {filters.period === 'All' && <th className="p-2 text-center font-bold text-white border-r border-white/5">GSAx</th>}
                                        
                                        {filters.period === 'All' && (
                                            <>
                                                <th className="p-2 text-center text-gray-400">xGF</th>
                                                <th className="p-2 text-center text-gray-400">xGA</th>
                                                <th className="p-2 text-center font-bold text-white border-r border-white/5">xG Diff</th>
                                                <th className="p-2 text-center text-gray-500">EN F</th>
                                                <th className="p-2 text-center text-gray-500 border-r border-white/5">Att</th>
                                                <th className="p-2 text-center text-gray-500">OT/EN</th>
                                                 <th className="p-2 text-center text-gray-500">EN A</th>
                                                <th className="p-2 text-center text-gray-500">Att</th>
                                            </>
                                        )}
                                    </tr>
                                    {/* Total Row */}
                                    {totals && (
                                        <tr className="bg-white/10 font-bold border-b-2 border-white/20 text-white shadow-lg sticky top-0 z-10">
                                            <td className="p-2 text-left text-yellow-400">TOTAL</td>
                                            <td className="p-2 text-left">{totals.record}</td>
                                            <td className="p-2 text-center">-</td>
                                            <td className="p-2 text-center border-l border-white/10">{totals.gf}</td>
                                            <td className="p-2 text-center">{totals.ga}</td>
                                            <td className={`p - 2 text - center ${ totals.gd > 0 ? 'text-green-400' : 'text-red-400' } border - r border - white / 10`}>{totals.gd > 0 ? '+' : ''}{totals.gd.toFixed(1)}</td>
                                            
                                            {filters.period === 'All' && (
                                                <>
                                                    <td className="p-2 text-center text-blue-300">{totals.pp_pct}%</td>
                                                    <td className="p-2 text-center text-red-300 border-r border-white/10">{totals.pk_pct}%</td>
                                                </>
                                            )}

                                            <td className="p-2 text-center text-gray-300">{totals.sf}</td>
                                            <td className="p-2 text-center text-gray-300">{totals.sa}</td>
                                            <td className={`p - 2 text - center ${ totals.sd > 0 ? 'text-green-400' : 'text-red-400' } border - r border - white / 10`}>{totals.sd > 0 ? '+' : ''}{totals.sd.toFixed(1)}</td>
                                            
                                            <td className="p-2 text-center text-gray-400">{totals.cf}</td>
                                            <td className="p-2 text-center text-gray-400">{totals.ca}</td>
                                            <td className={`p - 2 text - center ${ totals.cd > 0 ? 'text-green-400' : 'text-red-400' } border - r border - white / 10`}>{totals.cd > 0 ? '+' : ''}{totals.cd.toFixed(1)}</td>

                                            <td className="p-2 text-center">{totals.sh_pct}%</td>
                                            <td className="p-2 text-center border-r border-white/10">{totals.sv_pct}</td>

                                            {filters.period === 'All' && <td className={`p - 2 text - center ${ parseFloat(totals.gsax) > 0 ? 'text-green-400' : 'text-red-400' } border - r border - white / 10`}>{totals.gsax}</td> }

                                            {filters.period === 'All' && (
                                                <>
                                                 <td className="p-2 text-center text-gray-400">{totals.xgf}</td>
                                                 <td className="p-2 text-center text-gray-400">{totals.xga}</td>
                                                 <td className={`p - 2 text - center ${ parseFloat(totals.xgd) > 0 ? 'text-green-400' : 'text-red-400' } border - r border - white / 10`}>{totals.xgd}</td>
                                                 <td className="p-2 text-center text-gray-500">{totals.en_gf}</td>
                                                 <td className="p-2 text-center text-gray-500 border-r border-white/10">{totals.en_att}</td>
                                                 <td className="p-2 text-center text-gray-500">-</td>
                                                 <td className="p-2 text-center text-gray-500">{totals.en_ga}</td>
                                                 <td className="p-2 text-center text-gray-500">{totals.en_att_ag}</td>
                                                </>
                                            )}
                                        </tr>
                                    )}
                                </thead>
                                <tbody>
                                        {displayedGames.map(game => {
                                            const isExpanded = expandedGameId === game.game_id;
                                            // Stats matching the old table logic
                                            const gf = game.gf;
                                            const ga = game.ga;
                                            const gd = gf - ga;
                                            const sf = game.sf;
                                            const sa = game.sa;
                                            const sd = sf - sa;
                                            const cf = game.cf;
                                            const ca = game.ca;
                                            const cd = cf - ca;
                                            const xgf = game.xgf ;
                                            const xga = game.xga;
                                            const xgd = xgf - xga;
                                            const sh_pct = sf > 0 ? (gf / sf * 100).toFixed(1) : '0';
                                            const sv_pct_val = game.sv_pct.toFixed(3).replace(/^0+/, ''); 
                                            const gsax = game.gsax.toFixed(2);

                                            return (
                                                <React.Fragment key={game.game_id}>
                                                    <tr 
                                                        onClick={() => setExpandedGameId(isExpanded ? null : game.game_id)}
                                                        className={`border - b border - white / 5 hover: bg - white / 5 transition - colors cursor - pointer ${ isExpanded ? 'bg-white/5' : '' } `}
                                                    >
                                                        <td className="p-1 text-left font-mono text-gray-400">{game.date}</td>
                                                        <td className="p-1 text-left text-white flex items-center gap-2">
                                                            <span className={game.home_away === 'Home' ? 'text-blue-300' : 'text-gray-500'}>{game.home_away === 'Home' ? 'vs' : '@'}</span>
                                                            {game.opponent}
                                                        </td>
                                                        <td className="p-1 text-center">
                                                            <span className={`px - 1.5 py - 0.5 rounded text - [10px] font - bold ${
            game.result.includes('W') ? 'bg-green-900/40 text-green-400 border border-green-500/20' :
                game.result_code.includes('OTL') || game.result_code.includes('SOL') ? 'bg-orange-900/40 text-orange-400 border border-orange-500/20' :
                    'bg-red-900/40 text-red-400 border border-red-500/20'
        } `}>
                                                                {game.result}
                                                            </span>
                                                        </td>
                                                        <td className="p-1 text-center font-mono text-white border-l border-white/5">{gf}</td>
                                                        <td className="p-1 text-center font-mono text-white">{ga}</td>
                                                        <td className={`p - 1 text - center font - bold font - mono ${ gd > 0 ? 'text-green-400' : gd < 0 ? 'text-red-400' : 'text-gray-500' } border - r border - white / 5`}>
                                                            {gd > 0 ? '+' : ''}{gd}
                                                        </td>
                                                        {filters.period === 'All' && (
                                                            <>
                                                                <td className="p-1 text-center font-mono text-blue-300">
                                                                    {game.pp_goals} / {game.pp_opps}
                                                                </td>
                                                                <td className="p-1 text-center font-mono text-red-300 border-r border-white/5">
                                                                    {game.pp_goals_against} / {game.pk_opps}
                                                                </td>
                                                            </>
                                                        )}
                                                        <td className="p-1 text-center font-mono text-gray-300">{sf}</td>
                                                        <td className="p-1 text-center font-mono text-gray-300">{sa}</td>
                                                        <td className={`p - 1 text - center font - mono ${ sd > 0 ? 'text-green-400/70' : sd < 0 ? 'text-red-400/70' : 'text-gray-500' } border - r border - white / 5`}>
                                                            {sd > 0 ? '+' : ''}{sd}
                                                        </td>
                                                        <td className="p-1 text-center font-mono text-gray-300">{cf}</td>
                                                        <td className="p-1 text-center font-mono text-gray-300">{ca}</td>
                                                        <td className={`p - 1 text - center font - mono ${ cd > 0 ? 'text-green-400/70' : cd < 0 ? 'text-red-400/70' : 'text-gray-500' } border - r border - white / 5`}>
                                                            {cd > 0 ? '+' : ''}{cd}
                                                        </td>
                                                        <td className="p-1 text-center font-mono" style={{ color: getGradientColor(parseFloat(sh_pct), 0, 10, 20) }}>{sh_pct}%</td>
                                                        <td className="p-1 text-center font-mono border-r border-white/5" style={{ color: getGradientColor(parseFloat(sv_pct_val), 0.800, 0.885, 0.945) }}>{sv_pct_val}</td>
                                                        {filters.period === 'All' && <td className={`p - 1 text - center font - mono font - bold ${ parseFloat(gsax) > 0 ? 'text-green-400' : 'text-red-400' } border - r border - white / 5`}>{gsax}</td>}
                                                        {filters.period === 'All' && (
                                                            <>
                                                                <td className="p-1 text-center font-mono text-gray-300">{game.xgf.toFixed(2)}</td>
                                                                <td className="p-1 text-center font-mono text-gray-300">{game.xga.toFixed(2)}</td>
                                                                <td className={`p - 1 text - center font - mono ${ xgd > 0 ? 'text-green-400/70' : xgd < 0 ? 'text-red-400/70' : 'text-gray-500' } border - r border - white / 5`}>
                                                                    {xgd > 0 ? '+' : ''}{xgd.toFixed(2)}
                                                                </td>
                                                                <td className="p-1 text-center font-mono text-gray-500">{game.en_att > 0 ? game.en_gf : '-'}</td>
                                                                <td className="p-1 text-center font-mono text-gray-500 border-r border-white/5">{game.en_att > 0 ? game.en_att : '-'}</td>
                                                                <td className={`p - 1 text - center font - mono ${ game.otml === 'Yes' ? 'text-red-400 font-bold' : 'text-gray-500' } `}>{game.otml}</td>
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



                    </TabsContent>

                    <TabsContent value="charts" className="m-0 focus-visible:outline-none px-4 md:px-8">
                        <div className="w-full">
                            <TeamChart games={displayedGames} primaryColor={primaryColor} />
                        </div>
                    </TabsContent>

                    <TabsContent value="skaters" className="m-0 focus-visible:outline-none px-4 md:px-8">
                        <div className="p-8 text-center text-muted-foreground font-mono">Skater stats coming soon...</div>
                    </TabsContent>

                    <TabsContent value="goalies" className="m-0 focus-visible:outline-none px-4 md:px-8">
                         {/* Reverted Content - Just a placeholder or simple list if originally so */}
                         <div className="p-8 text-center text-muted-foreground font-mono">Goalie stats coming soon...</div>
                    </TabsContent>
                </Tabs>
            </div>
        </main>
    );
}
