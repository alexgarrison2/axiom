import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { TeamStandings, SimResult } from '@/utils/simulation-engine';
import LogoDisplay from './LogoDisplay';
import PlayoffDetailModal from './PlayoffDetailModal';
import { Info } from 'lucide-react';
import MatchupMatrix from './MatchupMatrix';
import { SEASON_GAMES } from '@/lib/season';

interface PlayoffTableProps {
    currentStandings: TeamStandings[];
    simResults: Record<string, SimResult>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    teams?: Record<string, any>;
}

interface ProcessedTeam extends TeamStandings {
    pace: number;
    proj: number;
    playoffOdds: number;
    cupOdds: number;
    magic_number?: number;  // M#: playoff teams. 0 = clinched.
    tragic_number?: number; // E#: non-playoff teams. 0 = eliminated.
}

const SEASON_GP = SEASON_GAMES;

// Sort by current NHL standings tiebreakers (pts → RW → ROW → wins)
const standingsSort = (a: TeamStandings, b: TeamStandings) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.rw !== a.rw) return b.rw - a.rw;
    if (b.row !== a.row) return b.row - a.row;
    return b.wins - a.wins;
};

interface PlayoffGroup {
    name: string;
    teams: ProcessedTeam[];
}

interface ConferenceGroups {
    div1: PlayoffGroup;
    div2: PlayoffGroup;
    wildcards: PlayoffGroup;
}

interface Conferences {
    east: ConferenceGroups | null;
    west: ConferenceGroups | null;
}

const PlayoffTable: React.FC<PlayoffTableProps> = ({ currentStandings, simResults }) => {
    const [selectedTeamTricode, setSelectedTeamTricode] = useState<string | null>(null);

    const processedTeams: Conferences = useMemo(() => {
        if (!currentStandings || currentStandings.length === 0 || !simResults) return { east: null, west: null };

        // 1. Map Data
        const mapped = currentStandings.map(team => {
            const sim = simResults[team.tricode] || { madePlayoffs: 0, totalSims: 1, totalPoints: 0, wonCup: 0, pointDist: new Map(), divRankDist: new Map(), roundExitDist: {} };
            const pace = team.gamesPlayed > 0 ? Math.round((team.points / team.gamesPlayed) * SEASON_GP) : 0;
            const proj = Math.round(sim.totalPoints / sim.totalSims);
            const playoffOdds = (sim.madePlayoffs / sim.totalSims) * 100;
            const cupOdds = (sim.wonCup / sim.totalSims) * 100;

            return { ...team, pace, proj, playoffOdds, cupOdds };
        });

        // 2. Compute M# / E# per conference from current standings
        const magicTragicMap: Record<string, { magic_number?: number; tragic_number?: number }> = {};
        (['East', 'West'] as const).forEach(conf => {
            const confDivs = conf === 'East' ? ['ATL', 'MET'] : ['CEN', 'PAC'];
            const allConfTeams = currentStandings
                .filter(t => confDivs.includes(t.division))
                .slice() // don't mutate original
                .sort(standingsSort);

            // Build playoff set: top 3 per division + top 2 wild cards
            const confPlayoffSet = new Set<string>();
            confDivs.forEach(div => {
                allConfTeams.filter(t => t.division === div).slice(0, 3).forEach(t => confPlayoffSet.add(t.tricode));
            });
            allConfTeams.filter(t => !confPlayoffSet.has(t.tricode)).slice(0, 2).forEach(t => confPlayoffSet.add(t.tricode));

            const playoffSorted    = allConfTeams.filter(t =>  confPlayoffSet.has(t.tricode));
            const nonPlayoffSorted = allConfTeams.filter(t => !confPlayoffSet.has(t.tricode));
            const seed8 = playoffSorted[playoffSorted.length - 1];
            const seed9 = nonPlayoffSorted[0];
            if (!seed8 || !seed9) return;

            const maxPts8 = seed8.points + (SEASON_GP - seed8.gamesPlayed) * 2;
            const maxPts9 = seed9.points + (SEASON_GP - seed9.gamesPlayed) * 2;

            allConfTeams.forEach(t => {
                const maxPtsMe = t.points + (SEASON_GP - t.gamesPlayed) * 2;
                if (confPlayoffSet.has(t.tricode)) {
                    // Playoff team: M# = clinch over 9th, Tragic# = fall out below 9th
                    magicTragicMap[t.tricode] = {
                        magic_number:  Math.max(0, maxPts9 - t.points + 1),
                        tragic_number: Math.max(0, maxPtsMe - seed9.points + 1),
                    };
                } else {
                    // Non-playoff team: M# = overtake 8th, Tragic# = can't catch 8th
                    magicTragicMap[t.tricode] = {
                        magic_number:  Math.max(0, maxPts8 - t.points + 1),
                        tragic_number: Math.max(0, maxPtsMe - seed8.points + 1),
                    };
                }
            });
        });

        // Merge M#/E# into mapped
        const mappedWithMT = mapped.map(t => ({ ...t, ...magicTragicMap[t.tricode] }));

        // 3. Helper to get conference structure
        const getConferenceStructure = (confName: string, div1: string, div2: string) => {
            const confTeams = mappedWithMT.filter(t => t.conference.includes(confName));

            // Buckets
            const d1Teams: ProcessedTeam[] = [];
            const d2Teams: ProcessedTeam[] = [];

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
        if (!selectedTeamTricode || !processedTeams.east || !processedTeams.west) return null;

        const all = [
            ...(processedTeams.east.div1.teams), ...(processedTeams.east.div2.teams), ...(processedTeams.east.wildcards.teams),
            ...(processedTeams.west.div1.teams), ...(processedTeams.west.div2.teams), ...(processedTeams.west.wildcards.teams)
        ];
        return all.find(t => t.tricode === selectedTeamTricode);
    }, [selectedTeamTricode, processedTeams]);

    return (
        <div className="w-full relative">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 pb-2">
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
            {processedTeams.west && processedTeams.east && (
                <div className="grid grid-cols-1 gap-3 pb-2">
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
            )}

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

const TableSection = ({ title, groups, onSelectTeam }: { title: string, groups: ConferenceGroups | null, onSelectTeam: (t: string) => void }) => {
    if (!groups) return null;
    return (
        <div className="bg-neutral-900/50 border border-white/5 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-sm h-full flex flex-col">
            <h3 className="text-center py-2 text-sm font-bold uppercase tracking-widest text-[#5382BD] border-b border-white/5 bg-white/[0.02] shrink-0">
                {title}
            </h3>

            {/* Unified Header Row */}
            <div className="flex text-neutral-500 font-mono text-[9px] uppercase tracking-wider border-b border-white/5 bg-white/[0.01]">
                <div className="w-5 shrink-0"></div> {/* Div abbr */}
                <div className="w-16 px-3 py-2"></div> {/* Logo */}
                <div className="w-24 px-2 py-2 text-left">Team</div>
                <div className="w-12 px-2 py-2 text-center" title="Games Remaining">GR</div>
                <div className="w-16 px-2 py-2 text-center">PTS</div>
                <div className="w-12 px-2 py-2 text-center" title="Magic Number — games until playoff spot is clinched">M#</div>
                <div className="w-12 px-2 py-2 text-center" title="Elimination Number — games until playoff elimination">E#</div>
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

const GroupSection = ({ group, isWildcard, onSelectTeam }: { group: PlayoffGroup, isWildcard?: boolean, onSelectTeam: (t: string) => void }) => (
    <div className="py-1">
        {/* Section Title */}
        <div className="px-3 py-1 flex items-center justify-between">
            <h4 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 opacity-60">
                {group.name}
            </h4>
        </div>

        {/* Table using Flex Rows for strict alignment matching the Header */}
        <div className="w-full text-xs">
            {group.teams.map((team, idx) => {
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

                // Clinch / Elimination badges
                const isClinched = team.playoffOdds >= 99.5;
                const isEliminated = team.playoffOdds <= 0.5;

                return (
                    <motion.div
                        key={team.tricode}
                        initial={{ opacity: 0, y: 8 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, amount: 0.5 }}
                        transition={{ duration: 0.3, delay: idx * 0.04 }}
                        className="relative group hover:bg-white/[0.04] transition-colors flex items-center border-b border-white/[0.02]"
                    >
                        {/* Line separating WC2 and the rest */}
                        {isWildcard && idx === 1 && (
                            <div className="absolute bottom-0 left-0 right-0 border-b border-neutral-700/50 z-10 w-full pointer-events-none" />
                        )}

                        {/* Division abbreviation */}
                        {(() => {
                            const divAbbr = team.division === 'CEN' ? 'C' : team.division === 'MET' ? 'M' : team.division === 'PAC' ? 'P' : 'A';
                            const divColor = (team.division === 'CEN' || team.division === 'MET') ? '#9ABA2F' : '#EB6BC6';
                            return (
                                <div className="w-5 flex justify-center items-center shrink-0">
                                    <span className="font-mono text-[9px] font-bold" style={{ color: divColor }}>{divAbbr}</span>
                                </div>
                            );
                        })()}

                        {/* Logo */}
                        <div className="w-16 px-3 py-1.5 flex justify-center">
                            <div className="w-9 h-9 relative opacity-90 group-hover:opacity-100 group-hover:scale-110 transition-all duration-200">
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
                        <div className="w-24 px-2 py-1.5 font-bold text-white tracking-wide text-left flex items-center gap-1.5">
                            {team.tricode}
                            {isClinched && (
                                <span className="text-[8px] font-mono text-emerald-400 opacity-70" title="Clinched Playoff Spot">x</span>
                            )}
                            {isEliminated && (
                                <span className="text-[8px] font-mono text-red-400 opacity-70" title="Eliminated">e</span>
                            )}
                        </div>

                        {/* Games Remaining */}
                        <div className="w-12 px-2 py-1.5 text-center font-mono text-neutral-400 text-xs">
                            {SEASON_GP - team.gamesPlayed}
                        </div>

                        {/* Current Points */}
                        <div className="w-16 px-2 py-1.5 text-center font-mono text-white text-base font-bold">
                            {team.points}
                        </div>

                        {/* M# */}
                        <div className="w-12 px-2 py-1.5 text-center font-mono text-xs">
                            {team.tragic_number === 0 ? (
                                <span className="text-neutral-600">—</span>
                            ) : team.magic_number !== undefined ? (
                                team.magic_number === 0
                                    ? <span className="text-emerald-400" title="Clinched playoff spot">✓</span>
                                    : <span className="text-blue-400">{team.magic_number}</span>
                            ) : (
                                <span className="text-neutral-600">—</span>
                            )}
                        </div>

                        {/* E# */}
                        <div className="w-12 px-2 py-1.5 text-center font-mono text-xs">
                            {team.magic_number === 0 ? (
                                <span className="text-neutral-600">—</span>
                            ) : team.tragic_number !== undefined ? (
                                team.tragic_number === 0
                                    ? <span className="text-neutral-500" title="Eliminated">✗</span>
                                    : <span className="text-red-400">{team.tragic_number}</span>
                            ) : (
                                <span className="text-neutral-600">—</span>
                            )}
                        </div>

                        {/* Pace */}
                        <div className="w-16 px-2 py-1.5 text-center font-mono text-neutral-400 font-bold opacity-70">
                            {team.pace}
                        </div>

                        {/* Projected */}
                        <div className="w-16 px-2 py-1.5 text-center font-mono text-base font-bold" style={{ color: '#FDFFD5' }}>
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
                    </motion.div>
                );
            })}
        </div>
    </div>
);

export default PlayoffTable;
