import React, { useMemo, useState } from 'react';
import { TeamStandings, SimResult } from '@/utils/simulation-engine';
import LogoDisplay from './LogoDisplay';
import PlayoffDetailModal from './PlayoffDetailModal';
import { Info } from 'lucide-react';
import MatchupMatrix from './MatchupMatrix';

interface PlayoffTableProps {
    currentStandings: TeamStandings[];
    simResults: Record<string, SimResult>;
    teams?: Record<string, any>;
}

const PlayoffTable: React.FC<PlayoffTableProps> = ({ currentStandings, simResults }) => {
    const [selectedTeamTricode, setSelectedTeamTricode] = useState<string | null>(null);

    const processedTeams = useMemo(() => {
        if (!currentStandings || currentStandings.length === 0 || !simResults) return { east: null, west: null };

        // 1. Map Data
        const mapped = currentStandings.map(team => {
            const sim = simResults[team.tricode] || { madePlayoffs: 0, totalSims: 1, totalPoints: 0, wonCup: 0, pointDist: new Map(), divRankDist: new Map(), roundExitDist: {} };
            const pace = team.gamesPlayed > 0 ? Math.round((team.points / team.gamesPlayed) * 82) : 0;
            const proj = Math.round(sim.totalPoints / sim.totalSims);
            const playoffOdds = (sim.madePlayoffs / sim.totalSims) * 100;
            const cupOdds = (sim.wonCup / sim.totalSims) * 100;

            return { ...team, pace, proj, playoffOdds, cupOdds };
        });

        // 2. Helper to get conference structure
        const getConferenceStructure = (confName: string, div1: string, div2: string) => {
            const confTeams = mapped.filter(t => t.conference.includes(confName));

            // Buckets
            const d1Teams: typeof mapped = [];
            const d2Teams: typeof mapped = [];

            // Assign to divisions
            confTeams.forEach(t => {
                const d = t.division;
                if (d === div1) d1Teams.push(t);
                else if (d === div2) d2Teams.push(t);
                else {
                    // Fallback 
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

    // Helper to find team data for modal
    const selectedTeamData = useMemo(() => {
        if (!selectedTeamTricode || !processedTeams.east) return null;
        // Search in all lists
        // Efficient enough for <40 items
        const all = [
            ...(processedTeams.east.div1.teams), ...(processedTeams.east.div2.teams), ...(processedTeams.east.wildcards.teams),
            ...(processedTeams.west.div1.teams), ...(processedTeams.west.div2.teams), ...(processedTeams.west.wildcards.teams)
        ];
        return all.find(t => t.tricode === selectedTeamTricode);
    }, [selectedTeamTricode, processedTeams]);

    return (
        <div className="w-full relative">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 pb-12">
                <TableSection
                    title="Western Conference"
                    groups={processedTeams.west}
                    onSelectTeam={setSelectedTeamTricode}
                />
                <TableSection
                    title="Eastern Conference"
                    groups={processedTeams.east}
                    onSelectTeam={setSelectedTeamTricode}
                />
            </div>

            {/* Matchup Matrices */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 pb-12">
                <MatchupMatrix
                    currentStandings={currentStandings}
                    simResults={simResults}
                    conference="West"
                />
                <MatchupMatrix
                    currentStandings={currentStandings}
                    simResults={simResults}
                    conference="East"
                />
            </div>

            {/* Render Modal if selected */}
            {selectedTeamTricode && selectedTeamData && simResults && (
                <PlayoffDetailModal
                    team={selectedTeamData}
                    simResult={simResults[selectedTeamTricode]}
                    onClose={() => setSelectedTeamTricode(null)}
                />
            )}
        </div>
    );
};

const TableSection = ({ title, groups, onSelectTeam }: { title: string, groups: any, onSelectTeam: (t: string) => void }) => {
    if (!groups) return null;
    return (
        <div className="bg-neutral-900/50 border border-white/5 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-sm h-full flex flex-col">
            <h3 className="text-center py-4 text-sm font-bold uppercase tracking-widest text-[#5382BD] border-b border-white/5 bg-white/[0.02] shrink-0">
                {title}
            </h3>

            {/* Unified Header Row */}
            <div className="flex text-neutral-500 font-mono text-[9px] uppercase tracking-wider border-b border-white/5 bg-white/[0.01]">
                <div className="w-16 px-3 py-2"></div> {/* Logo */}
                <div className="w-24 px-2 py-2 text-left">Team</div>
                <div className="w-16 px-2 py-2 text-center">PTS</div>
                <div className="w-16 px-2 py-2 text-center">Pace</div>
                <div className="w-16 px-2 py-2 text-center">Proj</div>
                <div className="w-16 px-2 py-2 text-center">PO%</div>
                <div className="w-16 px-2 py-2 text-center">Cup%</div>
                <div className="w-10 px-2 py-2"></div> {/* Details Action */}
            </div>

            <div className="flex-1 overflow-auto">
                {/* Division 1 */}
                <GroupSection group={groups.div1} onSelectTeam={onSelectTeam} />
                <div className="h-px bg-white/5 mx-4" />

                {/* Division 2 */}
                <GroupSection group={groups.div2} onSelectTeam={onSelectTeam} />
                <div className="h-px bg-white/5 mx-4" />

                {/* Wildcard */}
                <GroupSection group={groups.wildcards} isWildcard onSelectTeam={onSelectTeam} />
            </div>
        </div>
    );
};

const GroupSection = ({ group, isWildcard, onSelectTeam }: { group: { name: string, teams: any[] }, isWildcard?: boolean, onSelectTeam: (t: string) => void }) => (
    <div className="py-2">
        {/* Section Title */}
        <div className="px-4 py-2 flex items-center justify-between">
            <h4 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 opacity-60">
                {group.name}
            </h4>
        </div>

        {/* Table using Flex Rows for strict alignment matching the Header */}
        <div className="w-full text-xs">
            {group.teams.map((team: any, idx: number) => {
                // Granular 7-Step Color Scale (Red -> Blue) per User Guide
                let oddsColor = 'text-white';
                let bgOdds = 'bg-neutral-800';

                if (team.playoffOdds >= 90) {
                    oddsColor = 'text-white';
                    bgOdds = 'bg-blue-700'; // Dark Blue
                } else if (team.playoffOdds >= 80) {
                    oddsColor = 'text-white';
                    bgOdds = 'bg-blue-500'; // Medium Blue
                } else if (team.playoffOdds >= 65) {
                    oddsColor = 'text-neutral-900';
                    bgOdds = 'bg-sky-300'; // Light Blue
                } else if (team.playoffOdds >= 50) {
                    oddsColor = 'text-neutral-900';
                    bgOdds = 'bg-neutral-300'; // Grey
                } else if (team.playoffOdds >= 40) {
                    oddsColor = 'text-neutral-900';
                    bgOdds = 'bg-red-200'; // Pinkish
                } else if (team.playoffOdds >= 30) {
                    oddsColor = 'text-white';
                    bgOdds = 'bg-red-500'; // Orange-Red
                } else {
                    oddsColor = 'text-white';
                    bgOdds = 'bg-red-900'; // Dark Red (<30%)
                }

                return (
                    <div key={team.tricode} className="relative group hover:bg-white/[0.04] transition-colors flex items-center border-b border-white/[0.02]">
                        {/* Line separating WC2 and the rest */}
                        {isWildcard && idx === 1 && (
                            <div className="absolute bottom-0 left-0 right-0 border-b border-neutral-700/50 z-10 w-full pointer-events-none" />
                        )}

                        {/* Logo */}
                        <div className="w-16 px-3 py-1.5 flex justify-center">
                            <div className="w-9 h-9 relative opacity-90 group-hover:opacity-100 transition-opacity">
                                <LogoDisplay
                                    triCode={team.tricode}
                                    src=""
                                    alt={`${team.tricode} Logo`}
                                    className="w-full h-full"
                                    variant="standard"
                                />
                            </div>
                        </div>

                        {/* Team Name */}
                        <div className="w-24 px-2 py-1.5 font-bold text-white tracking-wide text-left flex items-center">
                            {team.tricode}
                            {/* REMOVED WC Labels as requested */}
                        </div>

                        {/* Current Points */}
                        <div className="w-16 px-2 py-1.5 text-center font-mono text-neutral-300 font-bold">
                            {team.points}
                        </div>

                        {/* Pace */}
                        <div className="w-16 px-2 py-1.5 text-center font-mono text-neutral-400 font-bold opacity-70">
                            {team.pace}
                        </div>

                        {/* Projected */}
                        <div className="w-16 px-2 py-1.5 text-center font-mono text-white text-base font-bold">
                            {team.proj}
                        </div>

                        {/* PO% */}
                        <div className="w-16 px-2 py-1.5 text-center flex justify-center">
                            <div className={`inline-block px-1.5 py-0.5 rounded ${bgOdds}`}>
                                <span className={`${oddsColor}`}>{team.playoffOdds.toFixed(0)}%</span>
                            </div>
                        </div>

                        {/* Cup% */}
                        <div className="w-16 px-2 py-1.5 text-center font-mono text-neutral-400">
                            {team.cupOdds > 0.1 ? `${team.cupOdds.toFixed(1)}%` : '-'}
                        </div>

                        {/* Details Action */}
                        <div className="w-10 px-2 py-1.5 flex justify-center">
                            <button
                                onClick={() => onSelectTeam(team.tricode)}
                                className="text-neutral-500 hover:text-white transition-colors p-1 rounded-full hover:bg-white/10"
                                aria-label="View Details"
                            >
                                <Info className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    </div>
);

export default PlayoffTable;
