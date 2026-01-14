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
    ot_loss: boolean;
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

    const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'games' | 'skaters' | 'goalies'>('games');
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
                        ot_loss: res === 'OTL' || res === 'SOL'
                    };
                }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

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

            {/* Team Navigation */}
            <div className="absolute top-4 left-4 right-4 z-20 flex flex-col md:flex-row justify-between items-start md:items-center">
                <Link href="/teams" className="text-gray-400 hover:text-white transition-colors mb-4 md:mb-0 flex items-center gap-2 text-sm font-medium">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    Back to Teams
                </Link>


                <div className="flex flex-wrap gap-2 justify-center md:justify-end bg-black/40 p-2 rounded-lg backdrop-blur-sm border border-white/5">
                    {allTeamsList.filter(t => t['Common Name']).sort((a, b) => a['Common Name'].localeCompare(b['Common Name'])).map((t: any) => {
                        const name = t['Common Name'].trim();
                        const tricode = t['Team Tricode'];
                        const url = t['Team Logo URL'];
                        const isSelected = name === teamInfo?.CommonName;

                        return (
                            <Link
                                key={name}
                                href={`/teams/${tricode}`}
                                className={`relative group ${isSelected ? '' : 'filter grayscale opacity-60 hover:grayscale-0 hover:opacity-100'} transition-all duration-300`}
                                title={name}
                            >
                                <img src={url} alt={name} className="w-8 h-8 md:w-10 md:h-10 object-contain drop-shadow-md" />
                            </Link>
                        );
                    })}
                </div>
            </div>

            <div className="w-full px-4 md:px-8 relative z-10 pt-32 md:pt-24">

                {teamInfo && (
                    <div className="flex flex-col items-center justify-center mb-12 animate-in fade-in zoom-in duration-500">
                        <img src={teamLogos[teamInfo.CommonName]} alt={teamInfo.TeamName} className="w-32 h-32 md:w-48 md:h-48 object-contain drop-shadow-[0_0_35px_rgba(255,255,255,0.15)] mb-4" />
                        <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tighter italic" style={{ fontFamily: 'var(--font-geist-mono)' }}>
                            {teamInfo.TeamName.split(' ').pop()}
                        </h1>
                        <div className="mt-2 flex items-center gap-4 text-xl font-mono text-gray-400">
                            <span>{record.w}-{record.l}-{record.otl}</span>
                            <span className={`font-bold px-3 py-0.5 rounded ${record.pts > 60 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-white'}`}>
                                {record.pts} PTS
                            </span>
                        </div>
                    </div>
                )}

                {rating && allTeamRatings && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-16 max-w-5xl mx-auto">
                        {(() => {
                            // Calculate Percentiles
                            const allRatings = Object.values(allTeamRatings);
                            const getPercentile = (val: number, key: string, inverted: boolean = false) => {
                                if (!allRatings.length) return 50;
                                // @ts-ignore
                                const sorted = allRatings.map((r: any) => r[key]).sort((a: number, b: number) => a - b);
                                const rank = sorted.findIndex((v: number) => v >= val);
                                const pct = (rank / sorted.length) * 100;
                                return inverted ? 100 - pct : pct;
                            };

                            const xgfPct = getPercentile(rating.xgf_rating, 'xgf_rating');
                            const xgaPct = getPercentile(rating.xga_rating, 'xga_rating', true); // Low is good
                            const ppPct = getPercentile(rating.pp_rating, 'pp_rating');
                            const pkPct = getPercentile(rating.pk_rating, 'pk_rating');
                            const xgf5v5Pct = getPercentile(rating.xgf_5v5_rating, 'xgf_5v5_rating');

                            return (
                                <>
                                    <StatRing value={rating.xgf_rating.toFixed(2)} progress={xgfPct} label="xGF/60" color={teamInfo?.HexColor1} />
                                    <StatRing value={rating.xga_rating.toFixed(2)} progress={xgaPct} label="xGA/60" color={teamInfo?.HexColor1} />
                                    <StatRing value={`${rating.pp_rating.toFixed(1)}%`} progress={ppPct} label="PP%" color={teamInfo?.HexColor1} />
                                    <StatRing value={`${rating.pk_rating.toFixed(1)}%`} progress={pkPct} label="PK%" color={teamInfo?.HexColor1} />
                                    <StatRing value={rating.xgf_5v5_rating.toFixed(2)} progress={xgf5v5Pct} label="5v5 xGF" color={teamInfo?.HexColor1} />
                                </>
                            );
                        })()}
                    </div>
                )}

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

                {/* Game Log Tab */}
                {activeTab === 'games' && (
                    <div className="overflow-x-auto border border-gray-800 rounded-lg bg-gray-900/50">
                        <table className="w-full text-xs text-left whitespace-nowrap">
                            <thead className="bg-gray-900/80 text-gray-400 font-bold uppercase tracking-wider border-b border-gray-700">
                                <tr>
                                    <th className="p-1 sticky left-0 bg-gray-900 z-20 w-8"></th>
                                    <th className="p-1 sticky left-8 bg-gray-900 z-20 w-24 text-center">Date</th>
                                    <th className="p-1 sticky left-32 bg-gray-900 z-20 w-10 text-center">Loc</th>
                                    <th className="p-1 sticky left-[10.5rem] bg-gray-900 z-20 w-12 text-center">Opp</th>
                                    <th className="p-1">Starter</th>
                                    <th className="p-1">Opp Starter</th>
                                    <th className="p-1 text-center">Res</th>
                                    <th className="p-1 text-center">GF</th>
                                    <th className="p-1 text-center">GA</th>
                                    <th className="p-1 text-center">GΔ</th>
                                    <th className="p-1 text-center">PPG</th>
                                    <th className="p-1 text-center">PP OPP</th>
                                    <th className="p-1 text-center">PP Time</th>
                                    <th className="p-1 text-center">PPGA</th>
                                    <th className="p-1 text-center">PK OPP</th>
                                    <th className="p-1 text-center">PK Time</th>
                                    <th className="p-1 text-center">SF</th>
                                    <th className="p-1 text-center">SA</th>
                                    <th className="p-1 text-center">CF</th>
                                    <th className="p-1 text-center">CA</th>
                                    <th className="p-1 text-center">SH%</th>
                                    <th className="p-1 text-center">SV%</th>
                                    <th className="p-1 text-center">GSAx</th>
                                    <th className="p-1 text-center">xGF</th>
                                    <th className="p-1 text-center">xGA</th>
                                    <th className="p-1 text-center">EN GF</th>
                                    <th className="p-1 text-center">EN Att</th>
                                    <th className="p-1 text-center">OTML</th>
                                    <th className="p-1 text-center">EN GA</th>
                                    <th className="p-1 text-center">EN Att Ag</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                                {games.length === 0 ?
                                    <tr><td colSpan={30} className="p-4 text-center text-gray-500">No games played.</td></tr>
                                    : games.map((game, idx) => {
                                        const isExpanded = expandedGameId === game.game_id;
                                        const gd = game.gf - game.ga;
                                        const sh_pct = game.sf > 0 ? (game.gf / game.sf * 100).toFixed(1) : "0.0";
                                        const sv_pct = (game.sv_pct * 100).toFixed(1);
                                        const gsax = (game.xga - game.ga).toFixed(2);
                                        const opponentName = game.opponent.trim();
                                        const logoUrl = teamLogos[opponentName] || teamLogos[opponentName.split(' ').pop() || ''] || '';

                                        return (
                                            <React.Fragment key={game.game_id}>
                                                <tr
                                                    onClick={() => setExpandedGameId(isExpanded ? null : game.game_id)}
                                                    className={`cursor-pointer transition-colors hover:bg-white/5 ${idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]'}`}
                                                >
                                                    <td className="p-1 sticky left-0 bg-gray-900/95 border-r border-gray-800 z-20 text-center text-gray-500">
                                                        <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-180 text-white' : ''}`}>▼</div>
                                                    </td>
                                                    <td className="p-1 sticky left-8 bg-gray-900/95 border-r border-gray-800 z-20 font-mono text-gray-300 w-24 text-center">{game.date}</td>
                                                    <td className={`p-1 sticky left-32 bg-gray-900/95 border-r border-gray-800 z-20 text-center font-bold text-[10px] w-10 ${game.home_away === 'Home' ? 'text-gray-500' : 'text-blue-400'}`}>
                                                        {game.home_away === 'Home' ? 'vs' : '@'}
                                                    </td>
                                                    <td className="p-1 sticky left-[10.5rem] bg-gray-900/95 border-r border-gray-800 z-20 justify-center w-12">
                                                        <div className="w-6 h-6 relative mx-auto" title={game.opponent}>
                                                            {logoUrl ? <img src={logoUrl} alt={game.opponent} className="w-6 h-6 object-contain" /> : <span className='text-[9px]'>{game.opponent.substring(0, 3)}</span>}
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
                                                    <td className="p-1 text-center font-mono text-white">{game.gf}</td>
                                                    <td className="p-1 text-center font-mono text-gray-400">{game.ga}</td>
                                                    <td className={`p-1 text-center font-bold font-mono ${gd > 0 ? 'text-green-400' : gd < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                                                        {gd > 0 ? '+' : ''}{gd}
                                                    </td>
                                                    <td className="p-1 text-center font-mono text-emerald-400">{game.pp_goals}</td>
                                                    <td className="p-1 text-center font-mono text-gray-500">{game.pp_opps}</td>
                                                    <td className="p-1 text-center font-mono text-gray-500">{game.pp_time}</td>
                                                    <td className="p-1 text-center font-mono text-red-400">{game.pp_goals_against}</td>
                                                    <td className="p-1 text-center font-mono text-gray-500">{game.pk_opps}</td>
                                                    <td className="p-1 text-center font-mono text-gray-500">{game.pk_time}</td>
                                                    <td className="p-1 text-center font-mono text-gray-300">{game.sf}</td>
                                                    <td className="p-1 text-center font-mono text-gray-300">{game.sa}</td>
                                                    <td className="p-1 text-center font-mono text-blue-300">{game.cf}</td>
                                                    <td className="p-1 text-center font-mono text-orange-300">{game.ca}</td>
                                                    <td className="p-1 text-center font-mono text-gray-400">{sh_pct}%</td>
                                                    <td className="p-1 text-center font-mono text-gray-400">{sv_pct}%</td>
                                                    <td className={`p-1 text-center font-mono font-bold ${parseFloat(gsax) > 0 ? 'text-green-400' : 'text-red-400'}`}>{gsax}</td>
                                                    <td className="p-1 text-center font-mono text-gray-300">{game.xgf.toFixed(2)}</td>
                                                    <td className="p-1 text-center font-mono text-gray-300">{game.xga.toFixed(2)}</td>
                                                    <td className="p-1 text-center font-mono text-gray-500">{game.en_gf}</td>
                                                    <td className="p-1 text-center font-mono text-gray-500">{game.en_att}</td>
                                                    <td className="p-1 text-center font-mono text-gray-500">{game.ot_loss ? 'Yes' : '-'}</td>
                                                    <td className="p-1 text-center font-mono text-gray-500">{game.en_ga}</td>
                                                    <td className="p-1 text-center font-mono text-gray-500">{game.en_att_ag}</td>
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
