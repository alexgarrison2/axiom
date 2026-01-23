import React, { useMemo } from 'react';
import { TeamStandings, SimResult } from '@/utils/simulation-engine';
import LogoDisplay from './LogoDisplay';

interface PlayoffTableProps {
    currentStandings: TeamStandings[];
    simResults: Record<string, SimResult>;
    teams?: Record<string, any>; // Optional for logos if not in standings (but usually we have tricode)
}

const PlayoffTable: React.FC<PlayoffTableProps> = ({ currentStandings, simResults }) => {

    const processedTeams = useMemo(() => {
        if (!currentStandings || currentStandings.length === 0 || !simResults) return { east: [], west: [] };

        const mapped = currentStandings.map(team => {
            const sim = simResults[team.tricode] || { madePlayoffs: 0, totalSims: 1, totalPoints: 0, wonCup: 0 };

            // Pace Calculation
            const pace = team.gamesPlayed > 0 ? Math.round((team.points / team.gamesPlayed) * 82) : 0;

            // Projected Calculation (Average of all sims)
            const proj = Math.round(sim.totalPoints / sim.totalSims);

            // Odds
            const playoffOdds = (sim.madePlayoffs / sim.totalSims) * 100;
            const cupOdds = (sim.wonCup / sim.totalSims) * 100; // Placeholder until cup logic is real

            return {
                ...team,
                pace,
                proj,
                playoffOdds,
                cupOdds
            };
        });

        // Sort by Projected Points Descending
        mapped.sort((a, b) => b.proj - a.proj);

        // Split by Conference
        // Assuming 'conference' field is 'East' or 'West' or 'Eastern'/'Western'
        const east = mapped.filter(t => t.conference.includes('East') || ['ATL', 'MET'].includes(t.division));
        const west = mapped.filter(t => t.conference.includes('West') || ['CEN', 'PAC'].includes(t.division));

        return { east, west };
    }, [currentStandings, simResults]);


    return (
        <div className="w-full grid grid-cols-1 xl:grid-cols-2 gap-8 pb-12">
            <TableSection title="Western Conference" teams={processedTeams.west} />
            <TableSection title="Eastern Conference" teams={processedTeams.east} />
        </div>
    );
};

const TableSection = ({ title, teams }: { title: string, teams: any[] }) => (
    <div className="bg-neutral-900/50 border border-white/5 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-sm">
        <h3 className="text-center py-4 text-sm font-bold uppercase tracking-widest text-[#5382BD] border-b border-white/5 bg-white/[0.02]">
            {title}
        </h3>
        <table className="w-full text-xs">
            <thead>
                <tr className="border-b border-white/5 text-neutral-500 font-mono">
                    <th className="p-3 text-left w-12"></th> {/* Logo */}
                    <th className="p-3 text-left">Team</th>
                    <th className="p-3 text-center">Points<br /><span className="text-[9px] opacity-60">(Pace)</span></th>
                    <th className="p-3 text-center">Points<br /><span className="text-[9px] opacity-60">(Proj.)</span></th>
                    <th className="p-3 text-center">Playoff<br />Odds</th>
                    <th className="p-3 text-center">Stanley<br />Cup Odds</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
                {teams.map((team, idx) => {
                    // Color coding for Odds
                    const oddsColor = team.playoffOdds >= 90 ? 'text-neon-green font-bold text-glow-green' :
                        team.playoffOdds >= 50 ? 'text-white font-bold' :
                            team.playoffOdds >= 10 ? 'text-neutral-300' : 'text-neutral-500';

                    const bgOdds = team.playoffOdds >= 90 ? 'bg-neon-green/10' :
                        team.playoffOdds <= 5 ? 'bg-red-500/10' : '';

                    return (
                        <tr key={team.tricode} className="group hover:bg-white/[0.02] transition-colors">
                            <td className="p-3 text-center">
                                <div className="w-8 h-8 relative mx-auto opacity-90 group-hover:opacity-100 transition-opacity">
                                    <LogoDisplay
                                        triCode={team.tricode}
                                        src=""
                                        alt={`${team.tricode} Logo`}
                                        className="w-full h-full"
                                        variant="standard"
                                    />
                                </div>
                            </td>
                            <td className="p-3 font-bold text-white tracking-wide">
                                {team.tricode}
                            </td>
                            <td className="p-3 text-center font-mono text-neutral-400 font-bold">
                                {team.pace}
                            </td>
                            <td className="p-3 text-center font-mono text-white text-lg font-bold">
                                {team.proj}
                            </td>
                            <td className={`p-3 text-center relative`}>
                                <div className={`inline-block px-2 py-1 rounded ${bgOdds}`}>
                                    <span className={`${oddsColor}`}>{team.playoffOdds.toFixed(0)}%</span>
                                </div>
                            </td>
                            <td className="p-3 text-center font-mono text-neutral-400">
                                {team.cupOdds > 0.1 ? `${team.cupOdds.toFixed(1)}%` : '<0.1%'}
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    </div>
);

export default PlayoffTable;
