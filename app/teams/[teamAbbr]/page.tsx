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

// Removed TeamRating interface as unused.

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
                // let w = 0, l = 0, otl = 0; // Unused
                const processedGames = teamGames.map((row: any) => {
                    const res = row.result;
                    let result_display = '';

                    if (res === 'RW' || res === 'OTW' || res === 'SOW') {
                        // w++;
                        if (res === 'RW') result_display = 'W';
                        if (res === 'OTW') result_display = 'W (OT)';
                        if (res === 'SOW') result_display = 'W (SO)';
                    }
                    else if (res === 'OTL' || res === 'SOL') {
                        // otl++;
                        if (res === 'OTL') result_display = 'OTL';
                        if (res === 'SOL') result_display = 'SOL';
                    }
                    else if (res === 'RL') {
                        // l++;
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
                // setRecord({ w, l, otl, pts: (w * 2) + otl }); // Unused

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


    // -- Derived Stats --
    // getSkaterStats removed as unused.

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
                if (filters.result === 'W') return g.result.startsWith('W');
                if (filters.result === 'L') return g.result === 'L' || g.result === 'OTL' || g.result === 'SOL';
                return true;
            });
        }
        return out;
    }, [games, filters.goalie, filters.loc, filters.result]);

    // Slice for Display (Table)
    const displayGames = filteredGames; // No pagination yet

    if (loading) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center font-mono">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                    <p className="text-gray-500 animate-pulse text-xs tracking-widest">LOADING TEAM DATA...</p>
                </div>
            </div>
        );
    }

    if (!teamInfo) {
        return <div className="min-h-screen bg-black text-white p-8">Team not found</div>;
    }

    const { TeamName, CommonName, HexColor1, TeamLogoURL, HexColor2 } = teamInfo;
    const primaryColor = HexColor1;
    // const secondaryColor = HexColor2; // Unused

    return (
        <div className="min-h-screen bg-[#09090b] text-white font-sans selection:bg-white/20">

            {/* Ambient Background */}
            <div
                className="fixed top-0 left-0 w-full h-[500px] opacity-40 blur-[150px] pointer-events-none z-0"
                style={{ background: `radial-gradient(circle at 50% 0%, ${primaryColor}, transparent)` }}
            ></div>

            {/* Navbar / Breadcrumbs Area */}
            <div className="fixed top-0 left-0 right-0 z-40 bg-black/80 backdrop-blur-xl border-b border-white/5 h-20">
                <div className="max-w-[1800px] mx-auto px-4 md:px-8 h-full flex items-center justify-between">

                    {/* Left: Breadcrumbs & Selector */}
                    <div className="flex items-center gap-6">
                        {/* Home Link */}
                        <Link href="/" className="group flex items-center gap-2 text-gray-500 hover:text-white transition-colors">
                            <div className="p-2 rounded-lg bg-white/5 group-hover:bg-white/10 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
                            </div>
                            <span className="text-xs font-bold uppercase tracking-wider hidden md:block">Home</span>
                        </Link>

                        <div className="h-8 w-px bg-white/10"></div>

                        {/* Team Selector */}
                        <TeamSelector teams={allTeamsList} currentTeam={teamInfo} />
                    </div>

                    {/* Right: Actions/Date (Placeholder or keep empty for now) */}
                    <div className="flex items-center gap-4">
                        <Link href="/teams" className="text-xs font-bold text-gray-500 hover:text-white uppercase tracking-wider transition-colors">
                            View All Teams
                        </Link>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="w-full px-4 md:px-8 relative z-10 pt-24 md:pt-28">


                <Tabs value={activeTab} onValueChange={(val) => handleTabChange(val as any)} className="w-full">
                    {/* Tabs */}
                    <div className="sticky top-20 bg-black/95 backdrop-blur-xl pt-4 pb-2 z-40 border-b border-border/10 mb-2">
                        <TabsList className="bg-muted/20">
                            <TabsTrigger value="games">Games</TabsTrigger>
                            <TabsTrigger value="charts">Charts</TabsTrigger>
                            <TabsTrigger value="skaters">Skaters</TabsTrigger>
                            <TabsTrigger value="goalies">Goalies</TabsTrigger>
                        </TabsList>
                    </div>

                    <TabsContent value="games" className="m-0 focus-visible:outline-none">

                        {/* Filters (Button Groups) */}
                        <div className="flex flex-wrap gap-6 mb-6 p-4 bg-white/5 rounded-lg border border-white/10 items-center">
                            {/* Goalie */}
                            <div className="flex flex-col gap-2">
                                <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Goalie</label>
                                <div className="flex flex-wrap gap-1">
                                    <button
                                        onClick={() => setFilters({ ...filters, goalie: 'All' })}
                                        className={`px-3 py-1 rounded-full text-[10px] uppercase font-bold transition-all ${filters.goalie === 'All' ? 'bg-white text-black' : 'bg-white/10 text-gray-300 hover:bg-white/20 hover:text-white'}`}
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
                                            if (confirmedName && confirmedName.include(g)) {
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
                                                    : 'bg-white/10 text-gray-300 hover:bg-white/20 hover:text-white'
                                                    } ${filters.goalie !== g ? highlightClass : ''}`}
                                            >
                                                {g.toUpperCase()}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Location Filter */}
                            <div className="flex flex-col gap-2">
                                <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Location</label>
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
                                                onClick={() => setFilters({ ...filters, loc })}
                                                className={`px-3 py-1 rounded-full text-[10px] uppercase font-bold transition-all ${filters.loc === loc
                                                    ? 'bg-[#83C7FF] text-black'
                                                    : 'bg-white/10 text-gray-300 hover:bg-white/20 hover:text-white'
                                                    }`}
                                                style={isTodayLoc && filters.loc !== loc ? { border: `1px solid ${locColor}`, color: locColor } : {}}
                                            >
                                                {loc}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Result Filter */}
                            <div className="flex flex-col gap-2">
                                <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Result</label>
                                <div className="flex gap-1">
                                    {['All', 'W', 'L'].map(res => (
                                        <button
                                            key={res}
                                            onClick={() => setFilters({ ...filters, result: res })}
                                            className={`px-3 py-1 rounded-full text-[10px] uppercase font-bold transition-all ${filters.result === res
                                                ? 'bg-white text-black'
                                                : 'bg-white/10 text-gray-300 hover:bg-white/20 hover:text-white'
                                                }`}
                                        >
                                            {res}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Recent Results Grid */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                            {/* Main Game Log Table */}
                            <div className="lg:col-span-12 space-y-2">
                                {/* Header */}
                                <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr_1fr_1fr_1fr_auto] gap-4 px-4 py-2 border-b border-white/10 text-[10px] uppercase font-bold text-gray-500 tracking-wider">
                                    <div className="w-8">#</div>
                                    <div>Date / Opponent</div>
                                    <div className="text-center">Score</div>
                                    <div className="text-center">xG</div>
                                    <div className="text-center">Goalie</div>
                                    <div className="text-center">PP / PK</div>
                                    <div className="text-center">SOG</div>
                                    <div className="text-center">Diff</div>
                                    <div className="w-8"></div>
                                </div>

                                {/* Rows */}
                                {displayGames.map((game) => {
                                    const isWin = game.result.includes('W');
                                    const isOT = game.result.includes('OT') || game.result.includes('SO');
                                    const xgDiff = game.xgf - game.xga;
                                    const xgColor = xgDiff > 0.5 ? 'text-green-400' : xgDiff < -0.5 ? 'text-red-400' : 'text-gray-400';
                                    const sd = game.sf - game.sa; // Shot diff
                                    const sf = game.sf;
                                    const sa = game.sa;

                                    const isExpanded = expandedGameId === game.game_id;

                                    return (
                                        <div key={game.game_id} className="group flex flex-col bg-white/5 border border-white/5 rounded-lg overflow-hidden transition-all hover:bg-white/10 hover:border-white/10">

                                            {/* Summary Row */}
                                            <div
                                                className="grid grid-cols-[auto_1fr_1fr_1fr_1fr_1fr_1fr_1fr_auto] gap-4 px-4 py-3 items-center cursor-pointer"
                                                onClick={() => setExpandedGameId(isExpanded ? null : game.game_id)}
                                            >
                                                {/* Number */}
                                                <div className="w-8 text-xs font-mono text-gray-500">{game.game_number}</div>

                                                {/* Date & Opp */}
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-bold text-white flex items-center gap-2">
                                                        <span className={game.home_away === 'Home' ? 'text-[#83C7FF]' : 'text-gray-400'}>{game.home_away === 'Home' ? 'vs' : '@'}</span>
                                                        {game.opponent}
                                                    </span>
                                                    <span className="text-[10px] font-mono text-gray-500">{game.date}</span>
                                                </div>

                                                {/* Result */}
                                                <div className="flex flex-col items-center">
                                                    <span className={`text-sm font-bold font-mono ${isWin ? 'text-green-400' : game.result_code.includes('OT') ? 'text-yellow-500' : 'text-red-500'}`}>
                                                        {game.result}
                                                    </span>
                                                    <span className="text-[10px] font-mono text-gray-400">{game.gf} - {game.ga}</span>
                                                </div>

                                                {/* xG */}
                                                <div className="flex flex-col items-center">
                                                    <span className={`text-xs font-mono font-bold ${xgColor}`}>
                                                        {game.xgf.toFixed(2)} - {game.xga.toFixed(2)}
                                                    </span>
                                                    <span className="text-[10px] text-gray-600 font-mono">
                                                        {(game.xgf / (game.xgf + game.xga) * 100).toFixed(0)}%
                                                    </span>
                                                </div>

                                                {/* Goalie */}
                                                <div className="flex flex-col items-center">
                                                    <span className="text-xs font-bold text-gray-300">{game.starting_goalie}</span>
                                                    <span className={`text-[10px] font-mono ${game.gsax > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                        {game.gsax > 0 ? '+' : ''}{game.gsax.toFixed(2)} GSAx
                                                    </span>
                                                </div>

                                                {/* Special Teams */}
                                                <div className="flex flex-col items-center">
                                                    <div className="flex items-center gap-1 text-[10px] font-mono">
                                                        <span className="text-gray-500">PP</span>
                                                        <span className={game.pp_goals > 0 ? 'text-green-400 font-bold' : 'text-gray-400'}>{game.pp_goals}/{game.pp_opps}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 text-[10px] font-mono">
                                                        <span className="text-gray-500">PK</span>
                                                        <span className={game.pp_goals_against === 0 ? 'text-green-400 font-bold' : 'text-red-400'}>{game.pk_opps - game.pp_goals_against}/{game.pk_opps}</span>
                                                    </div>
                                                </div>

                                                {/* SOG */}
                                                <div className="flex flex-col items-center">
                                                    <span className="text-xs font-mono text-gray-300">{sf} - {sa}</span>
                                                    <span className={`text-[10px] font-mono ${sd > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                        {sd > 0 ? '+' : ''}{sd}
                                                    </span>
                                                </div>

                                                {/* Diff (Empty for now/Shot Diff used in SOG) */}
                                                <div className="flex flex-col items-center">
                                                    {game.en_gf > 0 && <span className="text-[10px] text-green-500 font-bold">EN GOAL</span>}
                                                    {game.en_ga > 0 && <span className="text-[10px] text-red-500 font-bold">EN AGAINST</span>}
                                                    {game.otml === 'Yes' && <span className="text-[10px] text-yellow-500 font-bold">OT LOSS (EN)</span>}
                                                </div>

                                                {/* Expand Arrow */}
                                                <div className={`p-2 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500"><path d="m6 9 6 6 6-6" /></svg>
                                                </div>

                                            </div>

                                            {/* Expanded Content */}
                                            {isExpanded && (
                                                <div className="border-t border-white/10 px-4 py-4 bg-black/20">
                                                    <GameBoxscore gameId={Number(game.game_id)} teamAbbr={teamAbbr} playerStats={playerStats} />
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>

                        </div>

                    </TabsContent>

                    <TabsContent value="charts" className="m-0 focus-visible:outline-none">
                        <div className="p-4 bg-white/5 rounded-lg border border-white/10 min-h-[500px]">
                            <h2 className="text-xl font-bold mb-6">Performance Charts</h2>
                            <TeamChart games={games} primaryColor={primaryColor} />
                        </div>
                    </TabsContent>

                    <TabsContent value="skaters" className="m-0 focus-visible:outline-none">
                        <div className="p-4 bg-white/5 rounded-lg border border-white/10 overflow-x-auto">
                            <h2 className="text-xl font-bold mb-4">Skater Statistics</h2>
                            <table className="w-full text-xs text-left">
                                <thead className="text-[10px] uppercase font-bold text-gray-500 border-b border-white/10">
                                    <tr>
                                        <th className="p-2">Player</th>
                                        <th className="p-2 text-center">GP</th>
                                        <th className="p-2 text-center">G</th>
                                        <th className="p-2 text-center">A</th>
                                        <th className="p-2 text-center">P</th>
                                        <th className="p-2 text-center">+/-</th>
                                        <th className="p-2 text-center">S</th>
                                        <th className="p-2 text-center">BLK</th>
                                        <th className="p-2 text-center">HIT</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {playerStats.filter(p => !p.is_goalie).slice(0, 25).map(p => (
                                        <tr key={p.player_id} className="border-b border-white/5 hover:bg-white/5">
                                            <td className="p-2 font-bold text-white">{p.name}</td>
                                            <td className="p-2 text-center text-gray-400">{1}</td>
                                            <td className="p-2 text-center text-white">{p.goals}</td>
                                            <td className="p-2 text-center text-gray-400">{p.assists}</td>
                                            <td className="p-2 text-center font-bold text-yellow-400">{p.points}</td>
                                            <td className="p-2 text-center text-gray-400">{p.plus_minus}</td>
                                            <td className="p-2 text-center text-gray-400">{p.shots}</td>
                                            <td className="p-2 text-center text-gray-400">{p.blocked_shots}</td>
                                            <td className="p-2 text-center text-gray-400">{p.hits}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className="mt-4 text-xs text-gray-500 italic">Showing recent game stats. Full season aggregation coming soon.</p>
                        </div>
                    </TabsContent>

                    <TabsContent value="goalies" className="m-0 focus-visible:outline-none">
                        <div className="p-4 bg-white/5 rounded-lg border border-white/10">
                            <h2 className="text-xl font-bold mb-4">Goalie Statistics</h2>
                            {/* Simple list for now */}
                            <div className="grid gap-4">
                                {uniqueGoalies.map(gName => {
                                    const gGames = games.filter(g => g.starting_goalie === gName);
                                    const gWins = gGames.filter(g => g.result.includes('W')).length;
                                    const gLosses = gGames.filter(g => g.result === 'L').length;
                                    const gOT = gGames.filter(g => g.result.includes('OT') || g.result.includes('SO')).length; // Loose logic, simplistic
                                    const totalGSAx = gGames.reduce((acc, curr) => acc + curr.gsax, 0);

                                    return (
                                        <div key={gName} className="flex items-center justify-between p-4 bg-black/40 rounded border border-white/5">
                                            <div>
                                                <h3 className="text-lg font-bold">{gName}</h3>
                                                <p className="text-xs text-gray-400">{gGames.length} Starts</p>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-sm font-mono font-bold text-white">{gWins}-{gLosses}-{gOT}</div>
                                                <div className={`text-xs font-mono ${totalGSAx > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                    {totalGSAx > 0 ? '+' : ''}{totalGSAx.toFixed(2)} GSAx
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </TabsContent>

                </Tabs>

            </div>
        </div>
    );
}

// Helper for loose string match if needed, typically standard Includes is fine
declare global {
    interface String {
        include(s: string): boolean;
    }
}
String.prototype.include = function (s) {
    return this.toLowerCase().includes(s.toLowerCase());
};
