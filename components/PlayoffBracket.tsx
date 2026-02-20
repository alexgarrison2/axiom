"use client";

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TeamStandings, SimResult } from '@/utils/simulation-engine';
import PlayoffDetailModal from './PlayoffDetailModal';

const TeamLogo = ({ tricode, size = 24 }: { tricode: string; size?: number }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
        src={`/logos/${tricode}.svg`}
        alt={tricode}
        width={size}
        height={size}
        className="object-contain"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
    />
);

// ─── Types ─────────────────────────────────────────────────────────────────

interface PlayoffBracketProps {
    currentStandings: TeamStandings[];
    simResults: Record<string, SimResult>;
}

interface SeededTeam extends TeamStandings {
    seed: number;
    role: 'div1' | 'div2' | 'wc';
    cupOdds: number;        // % from Monte Carlo
    playoffOdds: number;    // % from Monte Carlo
    proj: number;           // avg projected points
}

interface Matchup {
    id: string;
    higher: SeededTeam | null;   // higher seed (home ice)
    lower: SeededTeam | null;    // lower seed
    winPct: number;              // % chance the higher seed wins the series
    r1SimCount?: number;         // how many times these two met in Monte Carlo R1
    totalSims?: number;
}

interface ConferenceBracket {
    name: string;
    matchups: {
        r1: [Matchup, Matchup, Matchup, Matchup];  // 4 first-round series
        r2: [Matchup, Matchup];                     // 2 second-round series (bracket-fixed)
        cf: Matchup;                                 // Conference final
    };
}

// ─── Seeding Logic ─────────────────────────────────────────────────────────

const DIVISION_MAP: Record<string, string> = {
    BOS: 'ATL', BUF: 'ATL', DET: 'ATL', FLA: 'ATL', MTL: 'ATL', OTT: 'ATL', TBL: 'ATL', TOR: 'ATL',
    CAR: 'MET', CBJ: 'MET', NJD: 'MET', NYI: 'MET', NYR: 'MET', PHI: 'MET', PIT: 'MET', WSH: 'MET',
    CHI: 'CEN', COL: 'CEN', DAL: 'CEN', MIN: 'CEN', NSH: 'CEN', STL: 'CEN', UTA: 'CEN', WPG: 'CEN',
    ANA: 'PAC', CGY: 'PAC', EDM: 'PAC', LAK: 'PAC', SEA: 'PAC', SJS: 'PAC', VAN: 'PAC', VGK: 'PAC',
};

const DIV_NAMES: Record<string, string> = { ATL: 'Atlantic', MET: 'Metro', CEN: 'Central', PAC: 'Pacific' };

function sortByStandings(a: TeamStandings, b: TeamStandings): number {
    if (b.points !== a.points) return b.points - a.points;
    if (b.rw !== a.rw) return b.rw - a.rw;
    if (b.row !== a.row) return b.row - a.row;
    return b.wins - a.wins;
}

/** Poisson win probability — extracted from simulation-engine logic */
function factorial(n: number): number {
    if (n <= 1) return 1;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
}
function poissonPmf(k: number, lambda: number): number {
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}
function calcGameWinProb(home: TeamStandings, away: TeamStandings, leagueAvg = 2.35): number {
    const HOME_ICE = 0.16;
    const h_5v5 = (home.xgf_5v5 * away.xga_5v5) / leagueAvg;
    const a_5v5 = (away.xgf_5v5 * home.xga_5v5) / leagueAvg;
    const h_opps = (home.pen_drawn_60 + away.pen_taken_60) / 2;
    const a_opps = (away.pen_drawn_60 + home.pen_taken_60) / 2;
    const ST = 0.18;
    const hXg = Math.max(0.1, h_5v5 + HOME_ICE + h_opps * ST * home.pp_eff * away.pk_eff - away.goalie_rating * 0.5);
    const aXg = Math.max(0.1, a_5v5 + a_opps * ST * away.pp_eff * home.pk_eff - home.goalie_rating * 0.5);

    let pWin = 0, pLoss = 0, pTie = 0;
    for (let h = 0; h < 12; h++) for (let a = 0; a < 12; a++) {
        const p = poissonPmf(h, hXg) * poissonPmf(a, aXg);
        if (h > a) pWin += p; else if (a > h) pLoss += p; else pTie += p;
    }
    const tot = pWin + pLoss + pTie;
    return (pWin / tot) + ((pTie / tot) * (hXg / (hXg + aXg)));
}

/** Best-of-7 series win probability given per-game win prob */
function seriesWinProb(pGame: number): number {
    // P(win series) = sum over (win in k games, k=4..7)
    let p = 0;
    for (let wins = 4; wins <= 7; wins++) {
        const losses = wins - 1; // series doesn't end before 4 wins
        // Negative binomial: C(wins-1, 3) * p^4 * (1-p)^losses
        const ways = factorial(wins - 1) / (factorial(3) * factorial(losses));
        p += ways * Math.pow(pGame, 4) * Math.pow(1 - pGame, losses);
    }
    return p;
}

// ─── Conference Seeding ─────────────────────────────────────────────────────

function seedConference(
    teams: TeamStandings[],
    div1Code: string,
    div2Code: string,
    simResults: Record<string, SimResult>,
    totalSims: number
): SeededTeam[] {
    const d1 = teams.filter(t => DIVISION_MAP[t.tricode] === div1Code).sort(sortByStandings);
    const d2 = teams.filter(t => DIVISION_MAP[t.tricode] === div2Code).sort(sortByStandings);

    const top3d1 = d1.slice(0, 3);
    const top3d2 = d2.slice(0, 3);

    const wcPool = [...d1.slice(3), ...d2.slice(3)].sort(sortByStandings);
    const wc1 = wcPool[0];
    const wc2 = wcPool[1];

    const enrich = (t: TeamStandings, seed: number, role: SeededTeam['role']): SeededTeam => {
        const sim = simResults[t.tricode];
        return {
            ...t,
            seed,
            role,
            cupOdds: sim ? (sim.wonCup / sim.totalSims) * 100 : 0,
            playoffOdds: sim ? (sim.madePlayoffs / sim.totalSims) * 100 : 0,
            proj: sim ? Math.round(sim.totalPoints / sim.totalSims) : 0,
        };
    };

    // Seeds: div1 #1=1, div1 #2=2, div1 #3=3, div2 #1=4, div2 #2=5, div2 #3=6, WC1=7, WC2=8
    return [
        enrich(top3d1[0], 1, 'div1'),
        enrich(top3d1[1], 2, 'div1'),
        enrich(top3d1[2], 3, 'div1'),
        enrich(top3d2[0], 4, 'div2'),
        enrich(top3d2[1], 5, 'div2'),
        enrich(top3d2[2], 6, 'div2'),
        ...(wc1 ? [enrich(wc1, 7, 'wc')] : []),
        ...(wc2 ? [enrich(wc2, 8, 'wc')] : []),
    ];
}

function buildMatchup(
    higher: SeededTeam | null,
    lower: SeededTeam | null,
    simResults: Record<string, SimResult>,
    totalSims: number,
    idPrefix: string
): Matchup {
    if (!higher || !lower) {
        return { id: idPrefix, higher, lower, winPct: 0 };
    }
    const pGame = calcGameWinProb(higher, lower);
    const sp = seriesWinProb(pGame);

    // Check Monte Carlo R1 matchup count
    const r1Sims = simResults[higher.tricode]?.r1Matchups?.[lower.tricode] || 0;

    return {
        id: idPrefix,
        higher,
        lower,
        winPct: sp * 100,
        r1SimCount: r1Sims,
        totalSims,
    };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const CUP_COLORS: Record<number, string> = {
    0: '#6b7280', // gray — bubble/miss
};
function cupColorFor(pct: number): string {
    if (pct >= 15) return '#f59e0b'; // gold
    if (pct >= 8) return '#34d399';  // green
    if (pct >= 3) return '#60a5fa';  // blue
    return '#9ca3af';                // gray
}

interface TeamSlotProps {
    team: SeededTeam | null;
    isWinner?: boolean;
    showSeed?: boolean;
    onClick?: () => void;
}
const TeamSlot: React.FC<TeamSlotProps> = ({ team, isWinner, showSeed = true, onClick }) => {
    if (!team) {
        return (
            <div className="flex items-center gap-2 px-3 py-2 h-[48px] bg-white/3 rounded-lg border border-white/5">
                <div className="w-6 h-6 rounded bg-white/5 shrink-0" />
                <span className="text-xs text-gray-600 font-mono uppercase tracking-wider">TBD</span>
            </div>
        );
    }

    const color = cupColorFor(team.cupOdds);

    return (
        <motion.div
            whileHover={{ scale: 1.02, x: 2 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            onClick={onClick}
            className={`flex items-center gap-2 px-2.5 py-1.5 h-[48px] rounded-lg border cursor-pointer transition-all duration-200 relative overflow-hidden ${isWinner
                ? 'border-white/25 bg-white/8 shadow-lg'
                : 'border-white/8 bg-white/4 hover:border-white/20 hover:bg-white/6'
                }`}
        >
            {/* Cup odds glow bar on left */}
            <div
                className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg opacity-80"
                style={{ backgroundColor: color }}
            />

            {/* Seed badge */}
            {showSeed && (
                <span className="text-[9px] font-black text-gray-500 font-mono w-3 text-center shrink-0 ml-1">
                    {team.seed}
                </span>
            )}

            {/* Logo */}
            <div className="w-6 h-6 shrink-0">
                <TeamLogo tricode={team.tricode} size={24} />
            </div>

            {/* Name */}
            <span className={`text-xs font-bold tracking-wide truncate flex-1 ${isWinner ? 'text-white' : 'text-gray-300'}`}>
                {team.tricode}
            </span>

            {/* Cup odds pill */}
            <span
                className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded-full shrink-0"
                style={{ color, backgroundColor: `${color}20` }}
            >
                {team.cupOdds >= 1 ? team.cupOdds.toFixed(1) : team.cupOdds.toFixed(2)}%
            </span>
        </motion.div>
    );
};

interface SeriesBoxProps {
    matchup: Matchup;
    round: string;
    onSelectTeam: (tricode: string) => void;
    winner?: SeededTeam | null;
}
const SeriesBox: React.FC<SeriesBoxProps> = ({ matchup, round, onSelectTeam, winner }) => {
    const [hovered, setHovered] = useState(false);
    const { higher, lower, winPct, r1SimCount, totalSims } = matchup;

    const simFreq = r1SimCount && totalSims ? ((r1SimCount / totalSims) * 100).toFixed(0) : null;

    return (
        <div
            className="relative"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <div className="flex flex-col gap-0.5">
                <TeamSlot
                    team={higher}
                    isWinner={winner?.tricode === higher?.tricode}
                    onClick={() => higher && onSelectTeam(higher.tricode)}
                />
                <TeamSlot
                    team={lower}
                    isWinner={winner?.tricode === lower?.tricode}
                    onClick={() => lower && onSelectTeam(lower.tricode)}
                />
            </div>

            {/* Hover tooltip */}
            <AnimatePresence>
                {hovered && higher && lower && (
                    <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-50 left-full ml-2 top-0 bg-black/95 border border-white/15 rounded-xl p-3 shadow-2xl backdrop-blur-xl min-w-[200px] pointer-events-none"
                    >
                        <div className="text-[9px] text-gray-500 uppercase tracking-widest mb-2 font-bold">{round} Series</div>
                        <div className="flex flex-col gap-1.5">
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-white font-bold">{higher.tricode}</span>
                                <div className="flex items-center gap-1">
                                    <div className="h-1.5 rounded-full bg-white/30" style={{ width: `${Math.round(winPct)}px`, maxWidth: '80px', minWidth: '8px' }} />
                                    <span className="text-xs font-black text-white">{winPct.toFixed(0)}%</span>
                                </div>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-400 font-bold">{lower.tricode}</span>
                                <div className="flex items-center gap-1">
                                    <div className="h-1.5 rounded-full bg-white/15" style={{ width: `${Math.round(100 - winPct)}px`, maxWidth: '80px', minWidth: '8px' }} />
                                    <span className="text-xs font-black text-gray-400">{(100 - winPct).toFixed(0)}%</span>
                                </div>
                            </div>
                        </div>
                        {simFreq && (
                            <div className="mt-2 pt-2 border-t border-white/8 text-[9px] text-gray-500 font-mono">
                                Matched in {simFreq}% of simulations
                            </div>
                        )}
                        <div className="mt-1 text-[9px] text-gray-600 font-mono">
                            Series: best of 7 · {higher.tricode} has home ice
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// ─── Conference Column ────────────────────────────────────────────────────────

interface ConferenceColProps {
    name: string;
    seeded: SeededTeam[];
    simResults: Record<string, SimResult>;
    totalSims: number;
    flip?: boolean;  // East side flips layout (right-to-left)
    onSelectTeam: (t: string) => void;
}

interface BracketState {
    r1Winners: (SeededTeam | null)[];
    r2Winners: (SeededTeam | null)[];
    cfWinner: SeededTeam | null;
}

const ConferenceColumn: React.FC<ConferenceColProps> = ({ name, seeded, simResults, totalSims, flip, onSelectTeam }) => {
    const [state, setState] = useState<BracketState>({ r1Winners: [null, null, null, null], r2Winners: [null, null], cfWinner: null });

    // Build seedings
    // Div1: seeds 1, 2, 3  (first 3)
    // Div2: seeds 4, 5, 6  (next 3)
    // WC1: 7, WC2: 8
    const [s1, s2, s3, s4, s5, s6, s7, s8] = seeded;

    // Determine which div winner is conference leader
    const [bestDiv, otherDiv] =
        (s1?.points || 0) >= (s4?.points || 0) ? ['div1', 'div2'] : ['div2', 'div1'];

    // R1 matchups: (best div winner vs WC2), (other div winner vs WC1), (div1 #2 vs #3), (div2 #2 vs #3)
    const matchupA = buildMatchup(s1, s8, simResults, totalSims, `${name}-A`); // best div #1 vs WC2
    const matchupC = buildMatchup(s2, s3, simResults, totalSims, `${name}-C`); // div1 #2 vs #3
    const matchupB = buildMatchup(s4, s7, simResults, totalSims, `${name}-B`); // other div #1 vs WC1
    const matchupD = buildMatchup(s5, s6, simResults, totalSims, `${name}-D`); // div2 #2 vs #3

    // R2: winner(A) vs winner(C); winner(B) vs winner(D)
    const r2MatchupAC = buildMatchup(
        state.r1Winners[0] || s1,
        state.r1Winners[2] || s2,
        simResults, totalSims, `${name}-R2-AC`
    );
    const r2MatchupBD = buildMatchup(
        state.r1Winners[1] || s4,
        state.r1Winners[3] || s5,
        simResults, totalSims, `${name}-R2-BD`
    );

    // CF
    const cfMatchup = buildMatchup(
        state.r2Winners[0] || state.r1Winners[0] || s1,
        state.r2Winners[1] || state.r1Winners[1] || s4,
        simResults, totalSims, `${name}-CF`
    );

    const divColor1 = bestDiv === 'div1' ? '#f59e0b' : '#60a5fa';
    const divColor2 = bestDiv === 'div1' ? '#60a5fa' : '#f59e0b';

    // Resolve actual division names from the seeded team tricodes
    const div1Name = s1 ? (DIV_NAMES[DIVISION_MAP[s1.tricode]] || 'Div 1') : 'Div 1';
    const div2Name = s4 ? (DIV_NAMES[DIVISION_MAP[s4.tricode]] || 'Div 2') : 'Div 2';

    const col = (
        <div className="flex gap-3 items-center">
            {/* Round 1 */}
            <div className="flex flex-col gap-3 w-[160px] min-w-[160px]">
                <div>
                    <div className="text-[8px] uppercase tracking-widest font-black mb-1.5 px-1" style={{ color: divColor1 }}>
                        {div1Name} bracket
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <SeriesBox matchup={matchupA} round="R1" onSelectTeam={onSelectTeam} winner={state.r1Winners[0]} />
                        <SeriesBox matchup={matchupC} round="R1" onSelectTeam={onSelectTeam} winner={state.r1Winners[2]} />
                    </div>
                </div>
                <div>
                    <div className="text-[8px] uppercase tracking-widest font-black mb-1.5 px-1" style={{ color: divColor2 }}>
                        {div2Name} bracket
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <SeriesBox matchup={matchupB} round="R1" onSelectTeam={onSelectTeam} winner={state.r1Winners[1]} />
                        <SeriesBox matchup={matchupD} round="R1" onSelectTeam={onSelectTeam} winner={state.r1Winners[3]} />
                    </div>
                </div>
            </div>

            {/* Connector line R1→R2 */}
            <div className="flex flex-col gap-4 items-center self-stretch justify-around opacity-20 py-6">
                <div className="flex flex-col gap-0 items-center">
                    <div className="w-px flex-1 bg-white/40" style={{ height: '60px' }} />
                    <div className="w-3 h-px bg-white/40" />
                    <div className="w-px flex-1 bg-white/40" style={{ height: '60px' }} />
                </div>
                <div className="flex flex-col gap-0 items-center">
                    <div className="w-px flex-1 bg-white/40" style={{ height: '60px' }} />
                    <div className="w-3 h-px bg-white/40" />
                    <div className="w-px flex-1 bg-white/40" style={{ height: '60px' }} />
                </div>
            </div>

            {/* Round 2 */}
            <div className="flex flex-col gap-8 w-[160px] min-w-[160px] justify-around self-stretch py-12">
                <SeriesBox matchup={r2MatchupAC} round="R2" onSelectTeam={onSelectTeam} winner={state.r2Winners[0]} />
                <SeriesBox matchup={r2MatchupBD} round="R2" onSelectTeam={onSelectTeam} winner={state.r2Winners[1]} />
            </div>

            {/* Connector R2→CF */}
            <div className="flex flex-col gap-4 items-center self-stretch justify-center opacity-20">
                <div className="w-3 h-px bg-white/40" />
            </div>

            {/* Conference Final */}
            <div className="flex flex-col justify-center self-stretch w-[160px] min-w-[160px]">
                <div className="text-[8px] uppercase tracking-widest font-black text-rose-400/70 mb-1.5 px-1">Conf. Final</div>
                <SeriesBox matchup={cfMatchup} round="CF" onSelectTeam={onSelectTeam} winner={state.cfWinner} />
            </div>
        </div>
    );

    return (
        <div className="flex flex-col gap-3">
            <div
                className="text-center text-sm font-black uppercase tracking-[0.2em] py-2 px-4 rounded-xl border"
                style={{
                    color: name === 'Western' ? '#f59e0b' : '#60a5fa',
                    borderColor: name === 'Western' ? '#f59e0b30' : '#60a5fa30',
                    background: name === 'Western' ? '#f59e0b08' : '#60a5fa08',
                }}
            >
                {name} Conference
            </div>
            <div className={flip ? 'flex flex-row-reverse' : 'flex flex-row'}>
                {col}
            </div>
        </div>
    );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const PlayoffBracket: React.FC<PlayoffBracketProps> = ({ currentStandings, simResults }) => {
    const [selectedTeamTricode, setSelectedTeamTricode] = useState<string | null>(null);

    const totalSims = useMemo(() => {
        const first = Object.values(simResults)[0];
        return first?.totalSims || 2000;
    }, [simResults]);

    // Build conference seedings from CURRENT standings
    const { westSeeded, eastSeeded } = useMemo(() => {
        if (!currentStandings || currentStandings.length === 0) return { westSeeded: [], eastSeeded: [] };

        const east = currentStandings.filter(t => t.conference?.includes('East') || ['ATL', 'MET'].includes(DIVISION_MAP[t.tricode] || ''));
        const west = currentStandings.filter(t => t.conference?.includes('West') || ['CEN', 'PAC'].includes(DIVISION_MAP[t.tricode] || ''));

        return {
            westSeeded: seedConference(west, 'CEN', 'PAC', simResults, totalSims),
            eastSeeded: seedConference(east, 'ATL', 'MET', simResults, totalSims),
        };
    }, [currentStandings, simResults, totalSims]);

    // Derive current #1 cup favorites from sim results
    const topContenders = useMemo(() => {
        return [...westSeeded, ...eastSeeded]
            .filter(t => t.cupOdds > 0)
            .sort((a, b) => b.cupOdds - a.cupOdds)
            .slice(0, 5);
    }, [westSeeded, eastSeeded]);

    // Find selected team data for modal
    const selectedTeamData = useMemo(() => {
        if (!selectedTeamTricode) return null;
        return [...westSeeded, ...eastSeeded].find(t => t.tricode === selectedTeamTricode) || null;
    }, [selectedTeamTricode, westSeeded, eastSeeded]);

    if (currentStandings.length === 0 || Object.keys(simResults).length === 0) {
        return (
            <div className="flex justify-center items-center py-24">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-rose-500" />
            </div>
        );
    }

    return (
        <div className="w-full">
            {/* Legend */}
            <div className="flex flex-wrap items-center justify-center gap-4 mb-8">
                <div className="text-[9px] text-gray-500 uppercase tracking-widest font-bold mr-2">Cup odds →</div>
                {[['≥15%', '#f59e0b', 'Top contender'], ['≥8%', '#34d399', 'Strong chance'], ['≥3%', '#60a5fa', 'Live shot'], ['<3%', '#9ca3af', 'Long shot']].map(([label, color, desc]) => (
                    <div key={label} className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color as string }} />
                        <span className="text-[9px] font-bold font-mono" style={{ color: color as string }}>{label}</span>
                        <span className="text-[9px] text-gray-600">{desc}</span>
                    </div>
                ))}
            </div>

            {/* Top Cup Favorites Bar */}
            {topContenders.length > 0 && (
                <div className="flex items-center justify-center gap-3 mb-8 flex-wrap">
                    <span className="text-[9px] uppercase tracking-widest text-gray-500 font-bold">Top Cup Favorites:</span>
                    {topContenders.map((t, i) => (
                        <motion.button
                            key={t.tricode}
                            whileHover={{ scale: 1.05 }}
                            onClick={() => setSelectedTeamTricode(t.tricode)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold"
                            style={{
                                borderColor: `${cupColorFor(t.cupOdds)}40`,
                                color: cupColorFor(t.cupOdds),
                                backgroundColor: `${cupColorFor(t.cupOdds)}10`,
                            }}
                        >
                            <TeamLogo tricode={t.tricode} size={16} />
                            <span>{t.tricode}</span>
                            <span className="font-black">{t.cupOdds.toFixed(1)}%</span>
                        </motion.button>
                    ))}
                </div>
            )}

            {/* Bracket */}
            <div className="overflow-x-auto pb-8">
                <div className="flex gap-4 items-center justify-center min-w-[800px] px-4">
                    {/* West bracket */}
                    {westSeeded.length >= 6 && (
                        <ConferenceColumn
                            name="Western"
                            seeded={westSeeded}
                            simResults={simResults}
                            totalSims={totalSims}
                            onSelectTeam={setSelectedTeamTricode}
                        />
                    )}

                    {/* Cup Final Center */}
                    <div className="flex flex-col items-center gap-4 px-4 shrink-0">
                        <div className="text-[10px] uppercase tracking-widest font-black text-amber-400/70">Stanley Cup Final</div>
                        <div className="flex flex-col gap-0.5 w-[140px]">
                            <TeamSlot
                                team={westSeeded[0] ?? null}
                                showSeed={false}
                                onClick={() => westSeeded[0] && setSelectedTeamTricode(westSeeded[0].tricode)}
                            />
                            <div className="text-center text-[8px] text-gray-600 py-1 font-mono">vs</div>
                            <TeamSlot
                                team={eastSeeded[0] ?? null}
                                showSeed={false}
                                onClick={() => eastSeeded[0] && setSelectedTeamTricode(eastSeeded[0].tricode)}
                            />
                        </div>
                        <div className="w-px h-8 bg-amber-400/20" />
                        {/* Champion placeholder */}
                        <div className="flex flex-col items-center gap-2">
                            <div className="w-12 h-12 rounded-full bg-amber-400/10 border border-amber-400/30 flex items-center justify-center">
                                <span className="text-amber-400 text-lg">🏆</span>
                            </div>
                            <span className="text-[9px] text-amber-400/60 uppercase tracking-widest font-bold">Champion</span>
                        </div>
                    </div>

                    {/* East bracket (flipped) */}
                    {eastSeeded.length >= 6 && (
                        <ConferenceColumn
                            name="Eastern"
                            seeded={eastSeeded}
                            simResults={simResults}
                            totalSims={totalSims}
                            flip
                            onSelectTeam={setSelectedTeamTricode}
                        />
                    )}
                </div>
            </div>

            {/* Footnote */}
            <p className="text-center text-[10px] text-gray-600 font-mono mt-4">
                Seedings based on current standings · Series odds from Poisson xG model · Cup % from Monte Carlo · Hover matchups for details
            </p>

            {/* Detail Modal */}
            {selectedTeamTricode && selectedTeamData && simResults[selectedTeamTricode] && (
                <PlayoffDetailModal
                    team={selectedTeamData}
                    simResult={simResults[selectedTeamTricode]}
                    onClose={() => setSelectedTeamTricode(null)}
                />
            )}
        </div>
    );
};

export default PlayoffBracket;
