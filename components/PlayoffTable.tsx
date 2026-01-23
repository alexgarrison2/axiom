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
        if (!currentStandings || currentStandings.length === 0 || !simResults) return { east: null, west: null };

        // 1. Map Data
        const mapped = currentStandings.map(team => {
            const sim = simResults[team.tricode] || { madePlayoffs: 0, totalSims: 1, totalPoints: 0, wonCup: 0 };
            const pace = team.gamesPlayed > 0 ? Math.round((team.points / team.gamesPlayed) * 82) : 0;
            const proj = Math.round(sim.totalPoints / sim.totalSims);
            const playoffOdds = (sim.madePlayoffs / sim.totalSims) * 100;
            const cupOdds = (sim.wonCup / sim.totalSims) * 100;

            return { ...team, pace, proj, playoffOdds, cupOdds };
        });

        // 2. Helper to get conference structure
        const getConferenceStructure = (confName: string, div1: string, div2: string) => {
            const confTeams = mapped.filter(t => t.conference.includes(confName));

            // Sort by Projected Points for initial seeding logic if needed, 
            // but primarily we filter by division first.

            // Buckets
            const d1Teams: typeof mapped = [];
            const d2Teams: typeof mapped = [];

            // Assign to divisions
            confTeams.forEach(t => {
                // Check division name or map standard logic
                // API usually returns 'Atlantic', 'Metropolitan', 'Central', 'Pacific'
                // Our standings interface says `division` is a code like 'ATL'
                const d = t.division;
                if (d === div1) d1Teams.push(t);
                else if (d === div2) d2Teams.push(t);
                else {
                    // Fallback based on known mapping if division codes mismatch
                    // (Optional safety net)
                    if (['ATL', 'BOS', 'BUF', 'DET', 'FLA', 'MTL', 'OTT', 'TBL', 'TOR'].includes(t.tricode) && div1 === 'ATL') d1Teams.push(t);
                    else if (div1 === 'CEN' && ['ARI', 'UTA', 'CHI', 'COL', 'DAL', 'MIN', 'NSH', 'STL', 'WPG'].includes(t.tricode)) d1Teams.push(t);
                    else d2Teams.push(t);
                }
            });

            // Re-sort divisions by POINTS (Projected)
            d1Teams.sort((a, b) => b.proj - a.proj);
            d2Teams.sort((a, b) => b.proj - a.proj);

            // Extract Top 3
            const d1Top3 = d1Teams.slice(0, 3);
            const d2Top3 = d2Teams.slice(0, 3);

            // Wildcard Pool (Everyone else)
            // Get teams that ARE NOT in top 3
            const top3Ids = new Set([...d1Top3, ...d2Top3].map(t => t.tricode));
            const wildcards = confTeams.filter(t => !top3Ids.has(t.tricode)).sort((a, b) => b.proj - a.proj);

            return {
                div1: { name: div1 === 'ATL' ? 'Atlantic' : div1 === 'CEN' ? 'Central' : div1, teams: d1Top3 },
                div2: { name: div2 === 'MET' ? 'Metro' : div2 === 'PAC' ? 'Pacific' : div2, teams: d2Top3 },
                wildcards: { name: 'Wildcard Hunt', teams: wildcards }
            };
        };

        return {
            east: getConferenceStructure('East', 'ATL', 'MET'),
            west: getConferenceStructure('West', 'CEN', 'PAC')
        };
    }, [currentStandings, simResults]);

    return (
        <div className="w-full grid grid-cols-1 xl:grid-cols-2 gap-8 pb-12">
            <TableSection title="Western Conference" groups={processedTeams.west} />
            <TableSection title="Eastern Conference" groups={processedTeams.east} />
        </div>
    );
};

const TableSection = ({ title, groups }: { title: string, groups: any }) => {
    if (!groups) return null;
    return (
        <div className="bg-neutral-900/50 border border-white/5 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-sm h-full">
            <h3 className="text-center py-4 text-sm font-bold uppercase tracking-widest text-[#5382BD] border-b border-white/5 bg-white/[0.02]">
                {title}
            </h3>

            {/* Division 1 */}
            <GroupSection group={groups.div1} />
            <div className="h-px bg-white/5 mx-4" />

            {/* Division 2 */}
            <GroupSection group={groups.div2} />
            <div className="h-px bg-white/5 mx-4" />

            {/* Wildcard */}
            <GroupSection group={groups.wildcards} isWildcard />
        </div>
    );
};

const GroupSection = ({ group, isWildcard }: { group: { name: string, teams: any[] }, isWildcard?: boolean }) => (
    <div className="py-2">
        <h4 className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500 opacity-60">
            {group.name}
        </h4>
        <table className="w-full text-xs">
            {!isWildcard && (
                <thead className="sr-only">
                    <tr>
                        <th className="w-12"></th>
                        <th>Team</th>
                        <th>Pace</th>
                        <th>Proj</th>
                        <th>Playoff</th>
                        <th>Cup</th>
                    </tr>
                </thead>
            )}
            {isWildcard && (
                <thead>
                    <tr className="text-neutral-600 font-mono text-[9px] uppercase tracking-wider border-b border-white/5">
                        <th className="px-3 py-1 text-left w-12 opacity-0">.</th>
                        <th className="px-3 py-1 text-left"></th>
                        <th className="px-3 py-1 text-center">Pace</th>
                        <th className="px-3 py-1 text-center">Proj</th>
                        <th className="px-3 py-1 text-center">PO%</th>
                        <th className="px-3 py-1 text-center">Cup%</th>
                    </tr>
                </thead>
            )}

            <tbody className="divide-y divide-white/5">
                {group.teams.map((team, idx) => {
                    // Color coding for Odds
                    const oddsColor = team.playoffOdds >= 90 ? 'text-neon-green font-bold text-glow-green' :
                        team.playoffOdds >= 50 ? 'text-white font-bold' :
                            team.playoffOdds >= 10 ? 'text-neutral-300' : 'text-neutral-500';

                    const bgOdds = team.playoffOdds >= 90 ? 'bg-neon-green/10' :
                        team.playoffOdds <= 5 ? 'bg-red-500/10' : '';

                    return (
                        <tr key={team.tricode} className="group hover:bg-white/[0.02] transition-colors relative">
                            {/* Line separating WC2 and the rest */}
                            {isWildcard && idx === 1 && (
                                <td colSpan={6} className="absolute bottom-0 left-0 right-0 border-b border-neutral-700/50 z-10 w-full pointer-events-none"></td>
                            )}

                            <td className="px-3 py-1.5 text-center w-12">
                                <div className="w-9 h-9 relative mx-auto opacity-90 group-hover:opacity-100 transition-opacity">
                                    <LogoDisplay
                                        triCode={team.tricode}
                                        src=""
                                        alt={`${team.tricode} Logo`}
                                        className="w-full h-full"
                                        variant="standard"
                                    />
                                </div>
                            </td>
                            <td className="px-3 py-1.5 font-bold text-white tracking-wide">
                                {team.tricode}
                                {isWildcard && idx < 2 && <span className="ml-1.5 text-xs text-neutral-500 font-normal">WC{idx + 1}</span>}
                            </td>
                            <td className="px-3 py-1.5 text-center font-mono text-neutral-400 font-bold opacity-70">
                                {team.pace}
                            </td>
                            <td className="px-3 py-1.5 text-center font-mono text-white text-base font-bold">
                                {team.proj}
                            </td>
                            <td className={`px-3 py-1.5 text-center relative`}>
                                <div className={`inline-block px-1.5 py-0.5 rounded ${bgOdds}`}>
                                    <span className={`${oddsColor}`}>{team.playoffOdds.toFixed(0)}%</span>
                                </div>
                            </td>
                            <td className="px-3 py-1.5 text-center font-mono text-neutral-400">
                                {team.cupOdds > 0.1 ? `${team.cupOdds.toFixed(1)}%` : '-'}
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    </div>
);

export default PlayoffTable;
