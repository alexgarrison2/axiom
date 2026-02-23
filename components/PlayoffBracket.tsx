"use client";

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TeamStandings, SimResult } from '@/utils/simulation-engine';
import { getTeamColor } from '@/utils/team-colors';
import PlayoffDetailModal from './PlayoffDetailModal';

// ─── Logo helper ────────────────────────────────────────────────────────────

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

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlayoffBracketProps {
    currentStandings: TeamStandings[];
    simResults: Record<string, SimResult>;
}

interface SeededTeam extends TeamStandings {
    seed: number;
    role: 'div1' | 'div2' | 'wc';
    cupOdds: number;
    playoffOdds: number;
    proj: number;
}

interface Matchup {
    id: string;
    higher: SeededTeam | null;
    lower: SeededTeam | null;
    /** % chance higher seed wins series (from Poisson xG model) */
    winPct: number;
    r1SimCount?: number;
    totalSims?: number;
}

// ─── Division / Conf mapping ─────────────────────────────────────────────────

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

// ─── Probability math ────────────────────────────────────────────────────────

function factorial(n: number): number {
    if (n <= 1) return 1;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
}
function choose(n: number, k: number): number {
    return factorial(n) / (factorial(k) * factorial(n - k));
}
function poissonPmf(k: number, lambda: number): number {
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function calcGameWinProb(home: TeamStandings, away: TeamStandings, leagueAvg = 2.35): number {
    const HOME_ICE = 0.16;
    const h5 = (home.xgf_5v5 * away.xga_5v5) / leagueAvg;
    const a5 = (away.xgf_5v5 * home.xga_5v5) / leagueAvg;
    const h_opps = (home.pen_drawn_60 + away.pen_taken_60) / 2;
    const a_opps = (away.pen_drawn_60 + home.pen_taken_60) / 2;
    const ST = 0.18;
    const hXg = Math.max(0.1, h5 + HOME_ICE + h_opps * ST * home.pp_eff * away.pk_eff - away.goalie_rating * 0.5);
    const aXg = Math.max(0.1, a5 + a_opps * ST * away.pp_eff * home.pk_eff - home.goalie_rating * 0.5);

    let pWin = 0, pLoss = 0, pTie = 0;
    for (let h = 0; h < 12; h++) for (let a = 0; a < 12; a++) {
        const p = poissonPmf(h, hXg) * poissonPmf(a, aXg);
        if (h > a) pWin += p; else if (a > h) pLoss += p; else pTie += p;
    }
    const tot = pWin + pLoss + pTie;
    return (pWin / tot) + ((pTie / tot) * (hXg / (hXg + aXg)));
}

/**
 * Returns series win probability AND breakdown of wins-in-N probabilities
 * for both teams.
 *
 * Fix: losses = wins - 4 (not wins - 1). For a team to win in W games they
 * need exactly 4 wins, and W-4 losses before the final game.
 */
interface SeriesBreakdown {
    higherWinPct: number;
    lowerWinPct: number;
    bars: { label: string; pct: number; team: 'higher' | 'lower' }[];
}
function calcSeriesBreakdown(pGame: number): SeriesBreakdown {
    const results: { label: string; pct: number; team: 'higher' | 'lower' }[] = [];

    let higherTotal = 0;
    let lowerTotal = 0;

    for (let wins = 4; wins <= 7; wins++) {
        const losses = wins - 4;           // 0,1,2,3 for wins=4,5,6,7
        const ways = choose(wins - 1, 3);  // C(W-1, 3) — last game must be a win

        const pHigher = ways * Math.pow(pGame, 4) * Math.pow(1 - pGame, losses);
        const pLower = ways * Math.pow(1 - pGame, 4) * Math.pow(pGame, losses);

        higherTotal += pHigher;
        lowerTotal += pLower;

        results.push({ label: `in ${wins}`, pct: pHigher * 100, team: 'higher' });
        results.push({ label: `in ${wins}`, pct: pLower * 100, team: 'lower' });
    }

    return { higherWinPct: higherTotal * 100, lowerWinPct: lowerTotal * 100, bars: results };
}

// ─── Per-round advance probability from Monte Carlo ──────────────────────────
//   round_exit_dist: MISS | R1 | R2 | CF | F | CUP

// ─── Seeding ─────────────────────────────────────────────────────────────────

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

    return [
        enrich(top3d1[0], 1, 'div1'), enrich(top3d1[1], 2, 'div1'), enrich(top3d1[2], 3, 'div1'),
        enrich(top3d2[0], 4, 'div2'), enrich(top3d2[1], 5, 'div2'), enrich(top3d2[2], 6, 'div2'),
        ...(wc1 ? [enrich(wc1, 7, 'wc')] : []),
        ...(wc2 ? [enrich(wc2, 8, 'wc')] : []),
    ];
}

function buildMatchup(
    higher: SeededTeam | null,
    lower: SeededTeam | null,
    simResults: Record<string, SimResult>,
    totalSims: number,
    id: string
): Matchup {
    if (!higher || !lower) return { id, higher, lower, winPct: 50 };
    const pGame = calcGameWinProb(higher, lower);
    const { higherWinPct } = calcSeriesBreakdown(pGame);
    const r1SimCount = simResults[higher.tricode]?.r1Matchups?.[lower.tricode] || 0;
    return { id, higher, lower, winPct: higherWinPct, r1SimCount, totalSims };
}

// ─── Color helpers ───────────────────────────────────────────────────────────

function cupColorFor(pct: number): string {
    if (pct >= 15) return '#f59e0b';
    if (pct >= 8) return '#34d399';
    if (pct >= 3) return '#60a5fa';
    return '#9ca3af';
}
function roundOddsColor(pct: number): string {
    if (pct >= 68) return '#f59e0b';
    if (pct >= 55) return '#34d399';
    if (pct >= 45) return '#60a5fa';
    return '#9ca3af';
}

// ─── TeamSlot ────────────────────────────────────────────────────────────────

interface TeamSlotProps {
    team: SeededTeam | null;
    /** % this team wins THIS specific series (the counterpart slot gets 100 - this) */
    seriesWinPct?: number;
    showSeed?: boolean;
    isWinner?: boolean;
    onClick?: () => void;
}

const TeamSlot: React.FC<TeamSlotProps> = ({ team, seriesWinPct, showSeed = true, isWinner, onClick }) => {
    if (!team) {
        return (
            <div className="flex items-center gap-2 px-3 py-2 h-[46px] bg-white/3 rounded-lg border border-white/5">
                <div className="w-5 h-5 rounded bg-white/5 shrink-0" />
                <span className="text-xs text-gray-600 font-mono uppercase tracking-wider">TBD</span>
            </div>
        );
    }

    const displayPct = seriesWinPct ?? 50;
    const color = roundOddsColor(displayPct);

    return (
        <motion.div
            whileHover={{ scale: 1.02, x: 2 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            onClick={onClick}
            className={`flex items-center gap-2 px-2.5 py-1.5 h-[46px] rounded-lg border cursor-pointer transition-all duration-200 relative overflow-hidden ${isWinner
                ? 'border-white/25 bg-white/8 shadow-lg'
                : 'border-white/8 bg-white/4 hover:border-white/20 hover:bg-white/6'
                }`}
        >
            <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg" style={{ backgroundColor: color }} />

            {showSeed && (
                <span className="text-[9px] font-black text-gray-500 font-mono w-3 text-center shrink-0 ml-1">
                    {team.seed}
                </span>
            )}

            <div className="w-5 h-5 shrink-0">
                <TeamLogo tricode={team.tricode} size={20} />
            </div>

            <span className={`text-xs font-bold tracking-wide truncate flex-1 ${isWinner ? 'text-white' : 'text-gray-300'}`}>
                {team.tricode}
            </span>

            <span
                className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded-full shrink-0"
                style={{ color, backgroundColor: `${color}20` }}
            >
                {displayPct >= 10 ? displayPct.toFixed(0) : displayPct.toFixed(1)}%
            </span>
        </motion.div>
    );
};

// ─── Team color for dark backgrounds ─────────────────────────────────────────

const DARK_TEAM_OVERRIDES: Record<string, string> = {
    PIT: '#FCB514', LAK: '#A2AAAD', SEA: '#99D9D9', EDM: '#FF4C00',
    TBL: '#60a5fa', WPG: '#4a8fe7', TOR: '#5a8fd4', BUF: '#FCB514',
    CBJ: '#CE1126', VAN: '#00843D', STL: '#5a8fd4', WSH: '#C8102E',
};

function getVisibleTeamColor(tricode: string): string {
    return DARK_TEAM_OVERRIDES[tricode] || getTeamColor(tricode);
}

// ─── SeriesBox ───────────────────────────────────────────────────────────────

interface SeriesBoxProps {
    matchup: Matchup;
    round: 'R1' | 'R2' | 'CF' | 'F';
    onSelectTeam: (t: string) => void;
    winner?: SeededTeam | null;
    tooltipSide?: 'right' | 'left';
}

const SeriesBox: React.FC<SeriesBoxProps> = ({ matchup, round, onSelectTeam, winner, tooltipSide = 'right' }) => {
    const [hovered, setHovered] = useState(false);
    const { higher, lower, r1SimCount, totalSims } = matchup;

    const breakdown = useMemo(() => {
        if (!higher || !lower) return null;
        const pGame = calcGameWinProb(higher, lower);
        return calcSeriesBreakdown(pGame);
    }, [higher, lower]);

    const simFreq = r1SimCount && totalSims && round === 'R1'
        ? ((r1SimCount / totalSims) * 100).toFixed(0)
        : null;

    const tooltipClass = tooltipSide === 'right'
        ? 'left-full ml-2'
        : 'right-full mr-2';

    return (
        <div
            className="relative"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <div className="flex flex-col gap-0.5">
                <TeamSlot
                    team={higher}
                    seriesWinPct={breakdown?.higherWinPct}
                    isWinner={winner?.tricode === higher?.tricode}
                    onClick={() => higher && onSelectTeam(higher.tricode)}
                />
                <TeamSlot
                    team={lower}
                    seriesWinPct={breakdown?.lowerWinPct}
                    isWinner={winner?.tricode === lower?.tricode}
                    onClick={() => lower && onSelectTeam(lower.tricode)}
                />
            </div>

            <AnimatePresence>
                {hovered && higher && lower && breakdown && (() => {
                    const hColor = getVisibleTeamColor(higher.tricode);
                    const lColor = getVisibleTeamColor(lower.tricode);
                    return (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.12 }}
                            className={`absolute z-50 ${tooltipClass} top-0 bg-[#0d0f14] border border-white/15 rounded-xl p-4 shadow-2xl backdrop-blur-xl w-[260px] pointer-events-none`}
                        >
                            {/* Header: Logos + Names */}
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-1.5">
                                    <TeamLogo tricode={higher.tricode} size={18} />
                                    <span className="text-[11px] font-black text-white">{higher.tricode}</span>
                                </div>
                                <span className="text-[9px] text-gray-500 uppercase tracking-widest font-bold">{round} Series</span>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-black text-white">{lower.tricode}</span>
                                    <TeamLogo tricode={lower.tricode} size={18} />
                                </div>
                            </div>

                            {/* Split bar */}
                            <div className="mb-1">
                                <div className="flex h-8 rounded-lg overflow-hidden">
                                    <div
                                        className="flex items-center justify-center transition-all"
                                        style={{ width: `${breakdown.higherWinPct}%`, backgroundColor: hColor }}
                                    >
                                        <span className="text-sm font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                                            {breakdown.higherWinPct.toFixed(0)}%
                                        </span>
                                    </div>
                                    <div
                                        className="flex items-center justify-center transition-all"
                                        style={{ width: `${breakdown.lowerWinPct}%`, backgroundColor: lColor }}
                                    >
                                        <span className="text-sm font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                                            {breakdown.lowerWinPct.toFixed(0)}%
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Games table */}
                            <div className="mt-3 pt-3 border-t border-white/8">
                                {[4, 5, 6, 7].map(n => {
                                    const hBar = breakdown.bars.find(b => b.team === 'higher' && b.label === `in ${n}`);
                                    const lBar = breakdown.bars.find(b => b.team === 'lower' && b.label === `in ${n}`);
                                    const hPct = hBar?.pct ?? 0;
                                    const lPct = lBar?.pct ?? 0;
                                    return (
                                        <div key={n} className="flex items-center justify-between py-1">
                                            <span className="text-[10px] font-bold font-mono w-10 text-right" style={{ color: hColor }}>
                                                {hPct >= 1 ? hPct.toFixed(0) : hPct.toFixed(1)}%
                                            </span>
                                            <span className="text-[9px] text-gray-500 font-mono">{n} Games</span>
                                            <span className="text-[10px] font-bold font-mono w-10" style={{ color: lColor }}>
                                                {lPct >= 1 ? lPct.toFixed(0) : lPct.toFixed(1)}%
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>

                            {simFreq && (
                                <div className="mt-2 pt-2 border-t border-white/8 text-[9px] text-gray-600 font-mono text-center">
                                    Matched in {simFreq}% of sims · {higher.tricode} has home ice
                                </div>
                            )}
                        </motion.div>
                    );
                })()}
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
    /** 'ltr' = West (R1 → R2 → CF toward center), 'rtl' = East (CF ← R2 ← R1) */
    dir?: 'ltr' | 'rtl';
    onSelectTeam: (t: string) => void;
}

const BracketConnector: React.FC = () => (
    <div className="flex flex-col items-center self-stretch justify-around opacity-20 py-4 w-4 shrink-0">
        <div className="flex flex-col items-center">
            <div className="w-px bg-white/40" style={{ height: '50px' }} />
            <div className="w-3 h-px bg-white/40" />
            <div className="w-px bg-white/40" style={{ height: '50px' }} />
        </div>
        <div className="flex flex-col items-center">
            <div className="w-px bg-white/40" style={{ height: '50px' }} />
            <div className="w-3 h-px bg-white/40" />
            <div className="w-px bg-white/40" style={{ height: '50px' }} />
        </div>
    </div>
);

const ConferenceColumn: React.FC<ConferenceColProps> = ({ name, seeded, simResults, totalSims, dir = 'ltr', onSelectTeam }) => {
    const [s1, s2, s3, s4, s5, s6, s7, s8] = seeded;

    const div1Name = s1 ? (DIV_NAMES[DIVISION_MAP[s1.tricode]] || 'Div 1') : 'Div 1';
    const div2Name = s4 ? (DIV_NAMES[DIVISION_MAP[s4.tricode]] || 'Div 2') : 'Div 2';

    // R1 matchups per NHL bracket rules
    const mA = buildMatchup(s1, s8, simResults, totalSims, `${name}-A`); // best div #1 vs WC2
    const mC = buildMatchup(s2, s3, simResults, totalSims, `${name}-C`); // div1 #2 vs #3
    const mB = buildMatchup(s4, s7, simResults, totalSims, `${name}-B`); // other div #1 vs WC1
    const mD = buildMatchup(s5, s6, simResults, totalSims, `${name}-D`); // div2 #2 vs #3

    // R2 placeholders (show current top seeds as projections)
    const mR2_1 = buildMatchup(s1, s2, simResults, totalSims, `${name}-R2-1`);
    const mR2_2 = buildMatchup(s4, s5, simResults, totalSims, `${name}-R2-2`);

    // CF placeholder
    const mCF = buildMatchup(s1, s4, simResults, totalSims, `${name}-CF`);

    const tooltipSide = dir === 'ltr' ? 'right' : 'left';

    const confColor = name === 'Western' ? '#f59e0b' : '#60a5fa';
    const div1Color = '#f59e0b';
    const div2Color = '#60a5fa';

    const R1Col = (
        <div className="flex flex-col gap-3 w-[155px] min-w-[155px]">
            <div>
                <div className="text-[8px] uppercase tracking-widest font-black mb-1.5 px-1" style={{ color: div1Color }}>
                    {div1Name} bracket
                </div>
                <div className="flex flex-col gap-1">
                    <SeriesBox matchup={mA} round="R1" onSelectTeam={onSelectTeam} tooltipSide={tooltipSide} />
                    <SeriesBox matchup={mC} round="R1" onSelectTeam={onSelectTeam} tooltipSide={tooltipSide} />
                </div>
            </div>
            <div>
                <div className="text-[8px] uppercase tracking-widest font-black mb-1.5 px-1" style={{ color: div2Color }}>
                    {div2Name} bracket
                </div>
                <div className="flex flex-col gap-1">
                    <SeriesBox matchup={mB} round="R1" onSelectTeam={onSelectTeam} tooltipSide={tooltipSide} />
                    <SeriesBox matchup={mD} round="R1" onSelectTeam={onSelectTeam} tooltipSide={tooltipSide} />
                </div>
            </div>
        </div>
    );

    const R2Col = (
        <div className="flex flex-col gap-8 w-[155px] min-w-[155px] justify-around self-stretch py-12">
            <SeriesBox matchup={mR2_1} round="R2" onSelectTeam={onSelectTeam} tooltipSide={tooltipSide} />
            <SeriesBox matchup={mR2_2} round="R2" onSelectTeam={onSelectTeam} tooltipSide={tooltipSide} />
        </div>
    );

    const CFCol = (
        <div className="flex flex-col justify-center self-stretch w-[155px] min-w-[155px]">
            <div className="text-[8px] uppercase tracking-widest font-black text-rose-400/70 mb-1.5 px-1">Conf. Final</div>
            <SeriesBox matchup={mCF} round="CF" onSelectTeam={onSelectTeam} tooltipSide={tooltipSide} />
        </div>
    );

    // Order: West = R1 → conn → R2 → conn → CF (flows right toward center)
    //        East = CF → conn → R2 → conn → R1 (flows left toward center) — then reversed with flex-row-reverse
    const cols = dir === 'ltr'
        ? <>{R1Col}<BracketConnector />{R2Col}<BracketConnector />{CFCol}</>
        : <>{CFCol}<BracketConnector />{R2Col}<BracketConnector />{R1Col}</>;

    return (
        <div className="flex flex-col gap-2">
            <div
                className="text-center text-sm font-black uppercase tracking-[0.2em] py-2 px-4 rounded-xl border"
                style={{ color: confColor, borderColor: `${confColor}30`, background: `${confColor}08` }}
            >
                {name} Conference
            </div>
            <div className="flex items-center">
                {cols}
            </div>
        </div>
    );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const PlayoffBracket: React.FC<PlayoffBracketProps> = ({ currentStandings, simResults }) => {
    const [selectedTeamTricode, setSelectedTeamTricode] = useState<string | null>(null);
    const [cupFinalHovered, setCupFinalHovered] = useState(false);

    const totalSims = useMemo(() => {
        const first = Object.values(simResults)[0];
        return first?.totalSims || 2000;
    }, [simResults]);

    const { westSeeded, eastSeeded } = useMemo(() => {
        if (!currentStandings || currentStandings.length === 0) return { westSeeded: [], eastSeeded: [] };
        const east = currentStandings.filter(t => ['ATL', 'MET'].includes(DIVISION_MAP[t.tricode] || ''));
        const west = currentStandings.filter(t => ['CEN', 'PAC'].includes(DIVISION_MAP[t.tricode] || ''));
        return {
            westSeeded: seedConference(west, 'CEN', 'PAC', simResults, totalSims),
            eastSeeded: seedConference(east, 'ATL', 'MET', simResults, totalSims),
        };
    }, [currentStandings, simResults, totalSims]);

    const topContenders = useMemo(() => (
        [...westSeeded, ...eastSeeded]
            .filter(t => t.cupOdds > 0)
            .sort((a, b) => b.cupOdds - a.cupOdds)
            .slice(0, 6)
    ), [westSeeded, eastSeeded]);

    const selectedTeamData = useMemo(() => {
        if (!selectedTeamTricode) return null;
        return [...westSeeded, ...eastSeeded].find(t => t.tricode === selectedTeamTricode) || null;
    }, [selectedTeamTricode, westSeeded, eastSeeded]);

    const cupFinalBreakdown = useMemo(() => {
        const west = westSeeded[0];
        const east = eastSeeded[0];
        if (!west || !east) return null;
        const pGame = calcGameWinProb(west, east);
        return calcSeriesBreakdown(pGame);
    }, [westSeeded, eastSeeded]);

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
            <div className="flex flex-wrap items-center justify-center gap-4 mb-5">
                <span className="text-[9px] text-gray-600 uppercase tracking-widest font-bold">Round advance odds →</span>
                {([['≥75%', '#f59e0b', 'Favorite'], ['≥55%', '#34d399', 'Strong'], ['≥35%', '#60a5fa', 'Live'], ['<35%', '#9ca3af', 'Underdog']] as const).map(([label, color, desc]) => (
                    <div key={label} className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                        <span className="text-[9px] font-bold font-mono" style={{ color }}>{label}</span>
                        <span className="text-[9px] text-gray-600">{desc}</span>
                    </div>
                ))}
            </div>

            {/* Top Cup Favorites */}
            {topContenders.length > 0 && (
                <div className="flex items-center justify-center gap-2 mb-7 flex-wrap">
                    <span className="text-[9px] uppercase tracking-widest text-gray-500 font-bold mr-1">Cup favorites:</span>
                    {topContenders.map(t => (
                        <motion.button
                            key={t.tricode}
                            whileHover={{ scale: 1.05 }}
                            onClick={() => setSelectedTeamTricode(t.tricode)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold"
                            style={{ borderColor: `${cupColorFor(t.cupOdds)}40`, color: cupColorFor(t.cupOdds), backgroundColor: `${cupColorFor(t.cupOdds)}10` }}
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
                <div className="flex gap-2 items-center justify-center min-w-[900px] px-4">

                    {/* West (L→R) */}
                    {westSeeded.length >= 6 && (
                        <ConferenceColumn
                            name="Western"
                            seeded={westSeeded}
                            simResults={simResults}
                            totalSims={totalSims}
                            dir="ltr"
                            onSelectTeam={setSelectedTeamTricode}
                        />
                    )}

                    {/* Cup Final Center */}
                    <div className="flex flex-col items-center gap-3 px-4 shrink-0 min-w-[150px]">
                        <div className="text-[10px] uppercase tracking-widest font-black text-amber-400/80">Stanley Cup Final</div>
                        <div
                            className="relative flex flex-col gap-1 w-[140px]"
                            onMouseEnter={() => setCupFinalHovered(true)}
                            onMouseLeave={() => setCupFinalHovered(false)}
                        >
                            <TeamSlot
                                team={westSeeded[0] ?? null}
                                seriesWinPct={cupFinalBreakdown?.higherWinPct}
                                showSeed={false}
                                onClick={() => westSeeded[0] && setSelectedTeamTricode(westSeeded[0].tricode)}
                            />
                            <div className="text-center text-[8px] text-gray-600 py-0.5 font-mono">vs</div>
                            <TeamSlot
                                team={eastSeeded[0] ?? null}
                                seriesWinPct={cupFinalBreakdown?.lowerWinPct}
                                showSeed={false}
                                onClick={() => eastSeeded[0] && setSelectedTeamTricode(eastSeeded[0].tricode)}
                            />

                            <AnimatePresence>
                                {cupFinalHovered && westSeeded[0] && eastSeeded[0] && cupFinalBreakdown && (() => {
                                    const higher = westSeeded[0];
                                    const lower = eastSeeded[0];
                                    const hColor = getVisibleTeamColor(higher.tricode);
                                    const lColor = getVisibleTeamColor(lower.tricode);
                                    return (
                                        <motion.div
                                            initial={{ opacity: 0, scale: 0.95 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.95 }}
                                            transition={{ duration: 0.12 }}
                                            className="absolute z-50 top-full mt-2 left-1/2 -translate-x-1/2 bg-[#0d0f14] border border-amber-400/20 rounded-xl p-4 shadow-2xl backdrop-blur-xl w-[260px] pointer-events-none"
                                        >
                                            {/* Header */}
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-1.5">
                                                    <TeamLogo tricode={higher.tricode} size={18} />
                                                    <span className="text-[11px] font-black text-white">{higher.tricode}</span>
                                                </div>
                                                <span className="text-[9px] text-amber-400/70 uppercase tracking-widest font-bold">🏆 Final</span>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[11px] font-black text-white">{lower.tricode}</span>
                                                    <TeamLogo tricode={lower.tricode} size={18} />
                                                </div>
                                            </div>

                                            {/* Split bar */}
                                            <div className="flex h-8 rounded-lg overflow-hidden mb-3">
                                                <div
                                                    className="flex items-center justify-center"
                                                    style={{ width: `${cupFinalBreakdown.higherWinPct}%`, backgroundColor: hColor }}
                                                >
                                                    <span className="text-sm font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                                                        {cupFinalBreakdown.higherWinPct.toFixed(0)}%
                                                    </span>
                                                </div>
                                                <div
                                                    className="flex items-center justify-center"
                                                    style={{ width: `${cupFinalBreakdown.lowerWinPct}%`, backgroundColor: lColor }}
                                                >
                                                    <span className="text-sm font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                                                        {cupFinalBreakdown.lowerWinPct.toFixed(0)}%
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Games table */}
                                            <div className="border-t border-white/8 pt-2">
                                                {[4, 5, 6, 7].map(n => {
                                                    const hBar = cupFinalBreakdown.bars.find(b => b.team === 'higher' && b.label === `in ${n}`);
                                                    const lBar = cupFinalBreakdown.bars.find(b => b.team === 'lower' && b.label === `in ${n}`);
                                                    const hPct = hBar?.pct ?? 0;
                                                    const lPct = lBar?.pct ?? 0;
                                                    return (
                                                        <div key={n} className="flex items-center justify-between py-1">
                                                            <span className="text-[10px] font-bold font-mono w-10 text-right" style={{ color: hColor }}>
                                                                {hPct >= 1 ? hPct.toFixed(0) : hPct.toFixed(1)}%
                                                            </span>
                                                            <span className="text-[9px] text-gray-500 font-mono">{n} Games</span>
                                                            <span className="text-[10px] font-bold font-mono w-10" style={{ color: lColor }}>
                                                                {lPct >= 1 ? lPct.toFixed(0) : lPct.toFixed(1)}%
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </motion.div>
                                    );
                                })()}
                            </AnimatePresence>
                        </div>
                        <div className="w-px h-6 bg-amber-400/20" />
                        <div className="flex flex-col items-center gap-1.5">
                            <div className="w-10 h-10 rounded-full bg-amber-400/10 border border-amber-400/30 flex items-center justify-center">
                                <span className="text-amber-400 text-base">🏆</span>
                            </div>
                            <span className="text-[9px] text-amber-400/60 uppercase tracking-widest font-bold">Champion</span>
                        </div>
                    </div>

                    {/* East (R→L, mirrored) */}
                    {eastSeeded.length >= 6 && (
                        <ConferenceColumn
                            name="Eastern"
                            seeded={eastSeeded}
                            simResults={simResults}
                            totalSims={totalSims}
                            dir="rtl"
                            onSelectTeam={setSelectedTeamTricode}
                        />
                    )}
                </div>
            </div>

            <p className="text-center text-[10px] text-gray-600 font-mono mt-2">
                % shown = probability team advances from that round · Hover any matchup for full series breakdown · Click team for detail modal
            </p>

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
