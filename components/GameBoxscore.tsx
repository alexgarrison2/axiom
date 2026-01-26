import React from 'react';

interface PlayerStat {
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
}

interface GameBoxscoreProps {
    gameId: string | number;
    teamAbbr: string; // The team we are viewing
    playerStats: PlayerStat[]; // Filtered for this game and this team (or both teams?)
}

const GameBoxscore: React.FC<GameBoxscoreProps> = ({ playerStats }) => {
    // Separate Skaters and Goalies
    // Sort by Points (desc), then Goals, then Time On Ice
    const skaters = playerStats.filter(p => p.is_goalie === 0).sort((a, b) => b.points - a.points || b.goals - a.goals);
    const goalies = playerStats.filter(p => p.is_goalie === 1);

    if (playerStats.length === 0) {
        return <div className="p-4 text-gray-400 italic text-center">No player stats available for this game.</div>;
    }

    return (
        <div className="bg-slate-900/50 p-4 rounded-lg border border-white/5 animate-in fade-in slide-in-from-top-2 duration-300">
            <h4 className="text-sm font-bold text-gray-300 mb-2 uppercase tracking-wide">Boxscore</h4>

            {/* Goalies First */}
            {goalies.length > 0 && (
                <div className="mb-4">
                    <h5 className="text-xs text-blue-400 font-bold uppercase mb-1">Goalies</h5>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left">
                            <thead className="text-gray-500 border-b border-white/10">
                                <tr>
                                    <th className="py-1 px-2">Player</th>
                                    <th className="py-1 px-2 text-right">SA</th>
                                    <th className="py-1 px-2 text-right">Saves</th>
                                    <th className="py-1 px-2 text-right">GA</th>
                                    <th className="py-1 px-2 text-right">SV%</th>
                                    <th className="py-1 px-2 text-right">TOI</th>
                                </tr>
                            </thead>
                            <tbody>
                                {goalies.map(p => (
                                    <tr key={p.player_id} className="border-b border-white/5 hover:bg-white/5">
                                        <td className="py-1 px-2 font-medium text-white">#{p.number} {p.name}</td>
                                        <td className="py-1 px-2 text-right text-gray-300">{p.shots_against}</td>
                                        <td className="py-1 px-2 text-right text-gray-300">{p.saves}</td>
                                        <td className="py-1 px-2 text-right text-gray-300">{p.goals_against}</td>
                                        <td className="py-1 px-2 text-right text-gray-300">{(p.save_pct || 0).toFixed(3)}</td>
                                        <td className="py-1 px-2 text-right text-gray-400">{p.toi}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Skaters */}
            <div>
                <h5 className="text-xs text-blue-400 font-bold uppercase mb-1">Skaters</h5>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                        <thead className="text-gray-500 border-b border-white/10">
                            <tr>
                                <th className="py-1 px-2">Player</th>
                                <th className="py-1 px-2 text-center">Pos</th>
                                <th className="py-1 px-2 text-right">TOI</th>
                                <th className="py-1 px-2 text-right">G</th>
                                <th className="py-1 px-2 text-right">A</th>
                                <th className="py-1 px-2 text-right font-bold text-white">P</th>
                                <th className="py-1 px-2 text-right">+/-</th>
                                <th className="py-1 px-2 text-right">S</th>
                                <th className="py-1 px-2 text-right">BLK</th>
                                <th className="py-1 px-2 text-right">HIT</th>
                                <th className="py-1 px-2 text-right text-gray-500">PPG</th>
                                <th className="py-1 px-2 text-right text-gray-500">SHG</th>
                            </tr>
                        </thead>
                        <tbody>
                            {skaters.map(p => (
                                <tr key={p.player_id} className="border-b border-white/5 hover:bg-white/5">
                                    <td className="py-1 px-2 font-medium text-white">#{p.number} {p.name}</td>
                                    <td className="py-1 px-2 text-center text-gray-500">{p.position}</td>
                                    <td className="py-1 px-2 text-right text-gray-400 font-mono">{p.toi}</td>
                                    <td className="py-1 px-2 text-right text-gray-300">{p.goals}</td>
                                    <td className="py-1 px-2 text-right text-gray-300">{p.assists}</td>
                                    <td className="py-1 px-2 text-right font-bold text-white">{p.points}</td>
                                    <td className={`py-1 px-2 text-right ${p.plus_minus > 0 ? 'text-green-400' : p.plus_minus < 0 ? 'text-red-400' : 'text-gray-500'}`}>{p.plus_minus > 0 ? '+' : ''}{p.plus_minus}</td>
                                    <td className="py-1 px-2 text-right text-gray-300">{p.shots}</td>
                                    <td className="py-1 px-2 text-right text-gray-400">{p.blocked_shots}</td>
                                    <td className="py-1 px-2 text-right text-gray-400">{p.hits}</td>
                                    <td className="py-1 px-2 text-right text-gray-500">{p.pp_goals || 0}</td>
                                    <td className="py-1 px-2 text-right text-gray-500">{p.sh_goals || 0}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};


export default GameBoxscore;
