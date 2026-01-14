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
}

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

    useEffect(() => {
        const fetchData = async () => {
            try {
                // 1. Fetch Team Info
                const teamRes = await fetch('/data/nhl_teams.csv');
                const teamText = await teamRes.text();
                const teamData = Papa.parse(teamText, { header: true, skipEmptyLines: true }).data as any[];

                // Map CSV headers which might be "Team Name", "Team Tricode" etc.
                // Assuming standard format from my knowledge of nhl_teams.csv
                const info = teamData.find((t: any) => t['Team Tricode'] === teamAbbr || t['Team Tricode'] === 'UTA' && teamAbbr === 'UTA'); // Handle inconsistencies if any

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
                // gamestats has 'team' column as Common Name usually (e.g. "Ducks")
                // We need to match Common Name.
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
                        if (res === 'OTL') result_display = 'OTL'; // Standard notation
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
                        points: (res === 'RW' || res === 'OTW' || res === 'SOW') ? 2 : (res === 'OTL' || res === 'SOL') ? 1 : 0
                    };
                }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // Descending

                setGames(processedGames);
                setRecord({ w, l, otl, pts: (w * 2) + otl });

                // 3. Fetch Ratings
                const ratingsRes = await fetch('/data/team_ratings.json');
                const ratingsData = await ratingsRes.json();
                if (ratingsData[teamCommon]) {
                    setRating(ratingsData[teamCommon]);
                }

                // 4. Fetch Player Stats
                const playersRes = await fetch('/data/nhl_season_2025_2026_player_stats.csv');
                const playersText = await playersRes.text();
                const players = Papa.parse(playersText, { header: true, skipEmptyLines: true, dynamicTyping: true }).data as PlayerBoxscoreRow[];

                // Filter by Team ID or Team Name? CSV has 'team' (Abbrev) usually
                // The backfill script saves 'team' as Abbrev (e.g. ANA).
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

            <div className="max-w-6xl mx-auto relative z-10 px-4 md:px-8">
                <Header compact />

                <div className="mt-6 mb-4">
                    <Link href="/teams" className="inline-flex items-center text-sm text-gray-400 hover:text-white transition-colors">
                        ← Back to Teams
                    </Link>
                </div>

                {/* Team Header */}
                <div className="flex flex-col md:flex-row items-center md:items-end justify-between mb-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <div className="flex items-center gap-6">
                        <img
                            src={teamInfo.TeamLogoURL}
                            alt={teamInfo.CommonName}
                            className="w-32 h-32 md:w-40 md:h-40 drop-shadow-[0_0_35px_rgba(255,255,255,0.15)]"
                        />
                        <div>
                            <h1 className="text-5xl md:text-7xl font-black tracking-tighter uppercase italic" style={{ color: 'white' }}>
                                {teamInfo.CommonName}
                            </h1>
                            <div className="text-xl md:text-2xl text-gray-300 font-mono mt-1 flex gap-4 items-center">
                                <span className="font-bold text-white">{record.w}-{record.l}-{record.otl}</span>
                                <span className="text-gray-500">|</span>
                                <span className="text-emerald-400 font-bold">{record.pts} PTS</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Stat Rings */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-12">
                    <StatRing value={rating ? parseFloat(rating.xgf_rating.toFixed(2)) : 0} max={4.5} label="xGF/60" color={primaryColor} />
                    <StatRing value={rating ? parseFloat(rating.xga_rating.toFixed(2)) : 0} max={4.5} label="xGA/60" color="#EF4444" />
                    <StatRing value={rating ? parseFloat(rating.pp_rating.toFixed(1)) : 0} max={30} label="PP%" color="#F59E0B" />
                    <StatRing value={rating ? parseFloat(rating.pk_rating.toFixed(1)) : 0} max={100} label="PK%" color="#3B82F6" />
                    <StatRing value={rating ? parseFloat(rating.xgf_5v5_rating.toFixed(2)) : 0} max={3.5} label="5v5 xGF" color="#10B981" />
                </div>

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
                    <div className="space-y-0.5">
                        {/* Table Header */}
                        <div className="grid grid-cols-12 gap-1 text-[10px] uppercase font-bold text-gray-500 bg-gray-900/50 p-2 rounded-t-lg border-b border-gray-800">
                            <div className="col-span-1">Date</div>
                            <div className="col-span-1">Time</div>
                            <div className="col-span-2">Opponent</div>
                            <div className="col-span-2 text-center">Result</div>
                            <div className="col-span-1 text-center">Score</div>
                            <div className="col-span-2 text-center">Goalies</div>
                            <div className="col-span-2 text-right pr-2">Analytics</div>
                            <div className="col-span-1"></div>
                        </div>

                        {games.length === 0 ? <div className="p-4 text-gray-500">No games played.</div> :
                            games.map((game, idx) => (
                                <div key={game.game_id} className="group">
                                    <button
                                        onClick={() => setExpandedGameId(expandedGameId === game.game_id ? null : game.game_id)}
                                        className={`w-full grid grid-cols-12 gap-1 p-2 items-center text-xs border-b border-gray-800/50 hover:bg-gray-800/50 transition-colors ${idx % 2 === 0 ? 'bg-transparent' : 'bg-gray-900/20'
                                            }`}
                                    >
                                        <div className="col-span-1 text-gray-400 font-mono text-[11px] whitespace-nowrap overflow-hidden text-ellipsis">{game.date}</div>
                                        <div className="col-span-1 text-gray-500 font-mono text-[10px]">-</div>

                                        <div className="col-span-2 flex items-center gap-1.5 overflow-hidden">
                                            <span className={`text-[10px] font-bold ${game.home_away === 'Home' ? 'text-gray-500' : 'text-blue-400'}`}>
                                                {game.home_away === 'Home' ? 'vs' : '@'}
                                            </span>
                                            <span className="font-bold text-white truncate">{game.opponent}</span>
                                        </div>

                                        <div className="col-span-2 flex justify-center">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-black w-14 text-center ${game.result.startsWith('W') ? 'bg-green-900/30 text-green-400 border border-green-500/20' :
                                                    game.result.startsWith('OTL') ? 'bg-orange-900/30 text-orange-400 border border-orange-500/20' :
                                                        'bg-red-900/30 text-red-400 border border-red-500/20'
                                                }`}>
                                                {game.result}
                                            </span>
                                        </div>

                                        <div className="col-span-1 text-center font-mono text-gray-300">
                                            {game.gf}-{game.ga}
                                        </div>

                                        <div className="col-span-2 flex flex-col text-[10px] text-gray-400 leading-tight items-center">
                                            <span title={game.starting_goalie} className="truncate w-full text-center">{game.starting_goalie ? game.starting_goalie.split(' ').pop() : '-'}</span>
                                            <span className="text-gray-600 text-[9px]">vs {game.opponent_starter ? game.opponent_starter.split(' ').pop() : '-'}</span>
                                        </div>

                                        <div className="col-span-2 text-right pr-2 text-[10px] font-mono text-gray-400 flex flex-col items-end">
                                            <div><span className="text-gray-600">xG:</span> <span className={game.xgf > game.xga ? 'text-green-400' : 'text-red-400'}>{game.xgf.toFixed(2)}</span></div>
                                            <div><span className="text-gray-600">vs:</span> {game.xga.toFixed(2)}</div>
                                        </div>

                                        <div className="col-span-1 flex justify-end pr-2 text-gray-600">
                                            <div className={`transition-transform duration-300 ${expandedGameId === game.game_id ? 'rotate-180 text-white' : ''}`}>
                                                ▼
                                            </div>
                                        </div>
                                    </button>

                                    {/* Expanded Boxscore */}
                                    {expandedGameId === game.game_id && (
                                        <div className="pl-0 md:pl-0 border-b border-gray-800 bg-gray-900/30" style={{ borderLeft: `2px solid ${primaryColor}` }}>
                                            <GameBoxscore
                                                gameId={parseInt(game.game_id)}
                                                teamAbbr={teamAbbr}
                                                playerStats={playerStats.filter(p => p.game_id == game.game_id)}
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}
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
