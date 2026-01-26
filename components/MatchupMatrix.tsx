
import React, { useMemo } from 'react';
import { TeamStandings, SimResult } from '@/utils/simulation-engine';
import LogoDisplay from './LogoDisplay';

interface MatchupMatrixProps {
    currentStandings: TeamStandings[];
    simResults: Record<string, SimResult>;
    conference: 'East' | 'West';
}

const MatchupMatrix: React.FC<MatchupMatrixProps> = ({ currentStandings, simResults, conference }) => {

    // 1. Identify Top 8 Likely Playoff Teams in the Conference for Axis
    const teams = useMemo(() => {
        return currentStandings
            .filter(t => t.conference === conference)
            .map(t => ({
                ...t,
                playoffOdds: ((simResults[t.tricode]?.madePlayoffs || 0) / (simResults[t.tricode]?.totalSims || 1)) * 100
            }))
            .sort((a, b) => b.playoffOdds - a.playoffOdds)
            .filter(t => t.playoffOdds >= 1); // Show all teams with at least 1% chance
    }, [currentStandings, simResults, conference]);

    // 2. Build Matrix Data
    const matrix = useMemo(() => {
        const grid: { team: string, opponent: string, pct: number }[] = [];

        teams.forEach(rowTeam => {
            const res = simResults[rowTeam.tricode];
            if (!res) return;
            const total = res.totalSims;

            teams.forEach(colTeam => {
                if (rowTeam.tricode === colTeam.tricode) {
                    grid.push({ team: rowTeam.tricode, opponent: colTeam.tricode, pct: -1 }); // Self
                    return;
                }

                // Count matchups
                const count = res.r1Matchups[colTeam.tricode] || 0;
                grid.push({ team: rowTeam.tricode, opponent: colTeam.tricode, pct: (count / total) * 100 });
            });
        });

        return grid;
    }, [teams, simResults]);

    const getCellColor = (pct: number) => {
        if (pct < 0) return 'bg-neutral-900/50'; // Diagonal
        if (pct === 0) return 'bg-transparent text-neutral-800';
        if (pct < 5) return 'bg-blue-500/10 text-neutral-500';
        if (pct < 15) return 'bg-blue-500/20 text-blue-200';
        if (pct < 30) return 'bg-blue-500/40 text-white font-bold';
        if (pct < 50) return 'bg-blue-500/60 text-white font-bold';
        return 'bg-blue-500/80 text-white font-bold';
    };

    return (
        <div className="bg-neutral-900/50 border border-white/5 rounded-2xl p-6 backdrop-blur-sm">
            <h3 className="text-center pb-4 text-sm font-bold uppercase tracking-widest text-neutral-400">
                {conference}ern Conf. Matchup Probabilities
            </h3>

            <div className="overflow-x-auto">
                <table className="w-full text-center border-collapse">
                    <thead>
                        <tr>
                            <th className="p-2"></th>
                            {teams.map(t => (
                                <th key={t.tricode} className="p-2 min-w-[50px]">
                                    <div className="w-8 h-8 mx-auto opacity-80">
                                        <LogoDisplay triCode={t.tricode} src="" alt={t.tricode} className="w-full h-full" variant="standard" />
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {teams.map(rowTeam => (
                            <tr key={rowTeam.tricode}>
                                <td className="p-2">
                                    <div className="w-8 h-8 opacity-80">
                                        <LogoDisplay triCode={rowTeam.tricode} src="" alt={rowTeam.tricode} className="w-full h-full" variant="standard" />
                                    </div>
                                </td>
                                {teams.map(colTeam => {
                                    const cell = matrix.find(m => m.team === rowTeam.tricode && m.opponent === colTeam.tricode);
                                    if (!cell) return <td key={colTeam.tricode}></td>;

                                    const colorClass = getCellColor(cell.pct);

                                    // Hide lower triangle to reduce noise? OR keep full grid? User asked for "two matrices"
                                    // Let's keep full grid for clarity, or just one half. 
                                    // Full grid is symmetric but redundancy is fine for quick lookup.

                                    return (
                                        <td key={colTeam.tricode} className={`p-1 border border-white/5 ${colorClass} transition-colors hover:border-white/20`}>
                                            <div className="flex items-center justify-center h-10 w-10 mx-auto rounded text-xs">
                                                {cell.pct > 0 ? (cell.pct < 1 ? '<1' : cell.pct.toFixed(0)) : ''}
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="text-center mt-2 text-[10px] text-neutral-500 font-mono">
                    % chance of meeting in Round 1
                </div>
            </div>
        </div>
    );
};

export default MatchupMatrix;
