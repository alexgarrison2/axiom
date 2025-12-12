import React, { useState, useRef } from 'react';
import { GamePrediction } from '@/utils/data';
import Image from 'next/image';
import Link from 'next/link';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import AnimatedNumber from './AnimatedNumber';
import LogoDisplay from './LogoDisplay';
import RecentGamesList from './RecentGamesList';
import PlayerNewsList from './PlayerNewsList';
import LineupGrid from './LineupGrid';

gsap.registerPlugin(useGSAP);

interface MatchupCardProps {
    prediction: GamePrediction;
    maxTotalGoals: number;
}

const MatchupCard: React.FC<MatchupCardProps> = ({ prediction, maxTotalGoals }) => {
    const {
        homeTeam,
        awayTeam,
        homeStarter,
        awayStarter,
        homeXg,
        awayXg,
        homeModelWinPct,
        awayModelWinPct,
        homeVegasWinPct,
        awayVegasWinPct,
        homeEv,
        awayEv,
        totalGoals,
        homeWager,
        awayWager,
        homeModelOdds,
        awayModelOdds,
        homeVegasOdds,
        awayVegasOdds,
        startTime,
        home_gas,
        away_gas,
        home_gas_breakdown,
        away_gas_breakdown,
        home_recent_games,
        away_recent_games
    } = prediction;

    const cardRef = useRef<HTMLDivElement>(null);
    const desktopCardRef = useRef<HTMLDivElement>(null); // Ref for desktop card
    const [isExpanded, setIsExpanded] = useState(false);
    const [isDesktopExpanded, setIsDesktopExpanded] = useState(false); // New state for desktop

    const toggleExpand = () => {
        setIsExpanded(!isExpanded);
    };

    // Desktop Toggle (Simple height/opacity transition)
    const toggleDesktopExpand = () => {
        setIsDesktopExpanded(!isDesktopExpanded);
    };

    // --- Helpers ---
    const getGasColor = (gas: number | undefined) => {
        if (gas === undefined) return 'text-neutral-500 bg-neutral-500/10 border-neutral-500/20';
        if (gas >= 75) return 'text-neon-green bg-neon-green/10 border-neon-green/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]';
        if (gas >= 60) return 'text-green-400 bg-green-400/10 border-green-400/20 shadow-[0_0_10px_rgba(74,222,128,0.2)]';
        if (gas > 35) return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
        return 'text-red-500 bg-red-500/10 border-red-500/20';
    };

    const GasGauge = ({ gas, breakdown, align = 'center' }: { gas?: number, breakdown?: string[], align?: 'left' | 'right' | 'center' }) => {
        const [isOpen, setIsOpen] = useState(false);
        // Base classes
        let tooltipClasses = "absolute bottom-full mb-2 w-40 bg-zinc-950/85 border border-white/10 rounded-lg p-2 z-50 shadow-xl backdrop-blur-md";

        // Toggle visibility: standard hover for desktop + isOpen state for mobile click
        // We use 'hidden group-hover/gas:block' for desktop hover
        // BUT if isOpen is true, we force 'block'
        tooltipClasses += isOpen ? " block" : " hidden group-hover/gas:block";

        if (align === 'left') {
            tooltipClasses += " left-0 origin-bottom-left";
        } else if (align === 'right') {
            tooltipClasses += " right-0 origin-bottom-right";
        } else {
            tooltipClasses += " left-1/2 -translate-x-1/2 origin-bottom";
        }

        return (
            <div
                className={`group/gas relative flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider cursor-help ${getGasColor(gas)}`}
                onClick={(e) => {
                    e.stopPropagation(); // Prevent card collapse on mobile
                    setIsOpen(!isOpen);
                }}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-80"><path d="M3 22v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8" /><line x1="12" x2="12" y1="16" y2="22" /><rect width="18" height="8" x="3" y="2" rx="2" /><path d="M14 10V2H6v8" /></svg>
                <span>{gas !== undefined ? `${gas}% GAS` : 'N/A'}</span>

                {/* Tooltip */}
                {breakdown && breakdown.length > 0 && (
                    <div className={tooltipClasses}>
                        <div className="text-[10px] text-zinc-400 mb-1 border-b border-white/5 pb-1">Gas Analysis</div>
                        <div className="flex flex-col gap-0.5">
                            {breakdown.map((item, i) => {
                                const isPos = item.includes('+');
                                const isNeg = item.includes('-');
                                return (
                                    <div key={i} className={`text-[9px] flex justify-between ${isPos ? 'text-green-400' : isNeg ? 'text-red-400' : 'text-zinc-300'}`}>
                                        <span>{item.split(':')[0]}</span>
                                        <span className="font-mono">{item.split(':')[1] || ''}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // --- xG Explanation Helper ---
    const ExplanationPopover = ({ items, align = 'center' }: { items?: string[], align?: 'left' | 'right' | 'center' }) => {
        const [isOpen, setIsOpen] = useState(false);

        if (!items || items.length === 0) return null;

        let tooltipClasses = "absolute bottom-full mb-2 w-48 bg-zinc-950/95 border border-white/10 rounded-lg p-2 z-50 shadow-xl backdrop-blur-md";
        tooltipClasses += isOpen ? " block" : " hidden group-hover/info:block";

        if (align === 'left') {
            tooltipClasses += " left-0 origin-bottom-left";
        } else if (align === 'right') {
            tooltipClasses += " right-0 origin-bottom-right";
        } else {
            tooltipClasses += " left-1/2 -translate-x-1/2 origin-bottom";
        }

        return (
            <div
                className="group/info relative ml-2 inline-flex"
                onClick={(e) => {
                    e.stopPropagation();
                    setIsOpen(!isOpen);
                }}
            >
                <div className="p-1 rounded-full bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white cursor-help transition-colors">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
                    </svg>
                </div>

                <div className={tooltipClasses}>
                    <div className="text-[10px] font-bold text-zinc-300 mb-1.5 border-b border-white/10 pb-1">Model Adjustments</div>
                    <div className="flex flex-col gap-1">
                        {items.map((item, i) => {
                            const parts = item.split(':');
                            const label = parts[0];
                            const valStr = parts[1] || '';
                            const val = parseFloat(valStr);

                            // Color logic
                            let valColor = 'text-zinc-400';
                            if (!isNaN(val)) {
                                if (val > 0) valColor = 'text-neon-green';
                                else if (val < 0) valColor = 'text-red-400';
                            }
                            // Base model is neutral
                            if (label.includes('Base')) valColor = 'text-zinc-100 font-bold';

                            return (
                                <div key={i} className="flex justify-between items-baseline text-[9px] leading-tight">
                                    <span className="text-zinc-500">{label}</span>
                                    <span className={`font-mono ${valColor}`}>{valStr}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    const getBarColor = (team: any) => {
        // Teams with very dark/black primary colors that blend into the background
        const darkTeams = ['PIT', 'LAK', 'UTA', 'SEA', 'TBL', 'BOS', 'ANA'];
        if (darkTeams.includes(team.triCode)) {
            // Use secondary color if available and distinct
            if (team.color2 && team.color2 !== '#000000' && team.color2 !== '#FFFFFF') return team.color2;
            // Fallback for teams like LAK where color2 might be silver/grey (ok) or white
            return team.color2 || '#FFFFFF';
        }
        return team.color1;
    };

    const homeBarColor = getBarColor(homeTeam);
    const awayBarColor = getBarColor(awayTeam);

    // Animation State
    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => setIsMounted(true), 100);
        return () => clearTimeout(timer);
    }, []);

    const TeamColumn = ({
        team,
        isHome,
        starter,
        xg,
        ppRank,
        pkRank,
        l7,
        ev,
        wager,
        gas,
        gasBreakdown,
        gsaxTotal,
        gsaxPct,
        goalieStats,
        vsOppStats,
        opponentTriCode,
        odds
    }: {
        team: any,
        isHome: boolean,
        starter: string,
        xg: number,
        ppRank?: number,
        pkRank?: number,
        l7?: string,
        ev: number | null,
        wager: string | null,
        gas?: number,
        gasBreakdown?: string[],
        gsaxTotal?: number,
        gsaxPct?: number,
        goalieStats?: string,
        vsOppStats?: string,
        opponentTriCode?: string,
        odds?: string | number | null
    }) => {
        const alignClass = isHome ? 'md:items-start md:text-left' : 'md:items-end md:text-right';
        const evBadge = ev && ev > 0 ? formatEv(ev) : null;
        const safeStarter = starter || '';
        // Extract status from parentheses, e.g. "Name (Confirmed)" or "Name (Likely)"
        const statusMatch = safeStarter.match(/\((.*?)\)$/);
        const status = statusMatch ? statusMatch[1] : 'UNCONFIRMED';
        const starterName = safeStarter.replace(/\s*\(.*?\)$/, '');

        // Parse vsOppStats if available
        let vsOpp = null;
        if (vsOppStats) {
            try {
                vsOpp = JSON.parse(vsOppStats);
            } catch (e) { }
        }

        const isHighEv = ev && ev > 0.05;

        return (
            <div className={`flex flex-col items-center py-4 relative z-10 w-full h-full ${alignClass}`}>
                {/* Team Info Header */}
                <div className={`flex flex-col gap-1 mb-4 w-full ${isHome ? 'md:flex-row' : 'md:flex-row-reverse'} items-center md:items-start`}>
                    <LogoDisplay
                        src={team.logoUrl}
                        alt={team.name}
                        triCode={team.triCode}
                        className="w-20 h-20 md:w-28 md:h-28"
                        primaryColor={team.color1}
                        variant="animated"
                    />
                    <div className={`flex flex-col ${alignClass} items-center min-w-0 max-w-full justify-center gap-1`}>
                        <div className="flex items-center gap-1.5 flex-nowrap justify-center md:justify-start">
                            <span className={`text-[10px] md:text-xs font-bold uppercase tracking-wide truncate max-w-full ${(status?.toUpperCase()?.includes('UNCONFIRMED')) ? 'text-gray-500' :
                                (status?.toUpperCase()?.includes('CONFIRMED')) ? 'text-neon-green' :
                                    (status?.toUpperCase()?.includes('LIKELY')) ? 'text-yellow-400' : 'text-gray-500'
                                }`}>
                                {formatGoalieName(starterName)}
                            </span>
                            {gsaxTotal !== undefined && gsaxPct !== undefined && (
                                <span
                                    className="text-[9px] font-mono font-bold tracking-tight px-1 py-0.5 rounded bg-black/40 shadow-sm border border-white/5"
                                    style={{ color: getGsaxColorValue(gsaxPct) }}
                                >
                                    {formatGsax(gsaxTotal)}
                                </span>
                            )}
                        </div>
                        {goalieStats && (
                            <div className="mt-0.5 text-[9px] text-neutral-500 font-mono tracking-wide">
                                {goalieStats}
                            </div>
                        )}
                        <div
                            className={`hidden md:flex relative flex-col w-full max-w-4xl mx-auto rounded-3xl mb-6 transition-all duration-300 border backdrop-blur-xl group hover:shadow-[0_0_30px_rgba(0,243,255,0.15)] cursor-pointer ${getGlowColor(homeWager, awayWager)} ${isDesktopExpanded ? 'bg-white/[0.02]' : 'bg-transparent'}`}
                            onClick={toggleDesktopExpand}
                            ref={desktopCardRef}
                        >
                            {/* ... (Background layers) ... */}
                            <div className="absolute inset-0 bg-[#0a0a0a]/80 rounded-3xl -z-10" />
                            {isHighEv && (
                                <div className="absolute inset-0 rounded-3xl border border-neon-green/50 animate-pulse pointer-events-none"></div>
                            )}
                            <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
                                <div className="absolute -left-20 -top-20 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] opacity-20 group-hover:opacity-30 transition-opacity"></div>
                                <div className="absolute -right-20 -bottom-20 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] opacity-20 group-hover:opacity-30 transition-opacity"></div>
                            </div>

                            <div className="p-6 flex flex-row items-stretch justify-between w-full relative z-10">

                                {/* AWAY TEAM (Left) */}
                                <div className="flex-1 min-w-0 relative">
                                    <TeamColumn
                                        team={awayTeam}
                                        isHome={false}
                                        starter={awayStarter}
                                        xg={awayXg}
                                        ppRank={prediction.away_pp_rank}
                                        pkRank={prediction.away_pk_rank}
                                        l7={prediction.away_l7}
                                        ev={awayEv}
                                        wager={awayWager}
                                        gas={prediction.away_gas}
                                        gasBreakdown={prediction.away_gas_breakdown}
                                        gsaxTotal={prediction.away_gsax_total}
                                        gsaxPct={prediction.away_gsax_pct}
                                        goalieStats={prediction.away_goalie_stats}
                                        vsOppStats={prediction.awayGoalieVsOpp}
                                        opponentTriCode={homeTeam.triCode}
                                        odds={awayVegasOdds}
                                    />
                                    <NewsIndicator
                                        hasNews={!!(prediction.away_news && prediction.away_news.length > 0)}
                                        className="absolute bottom-2 left-2"
                                    />
                                </div>

                                {/* CENTER INFO */}
                                <div className="flex flex-col items-center justify-center w-[30%] px-6 border-l border-r border-white/5 mx-4">
                                    <div className="flex flex-col items-center mb-6">
                                        <span className="text-xs font-mono text-neutral-400 tracking-[0.2em] mb-3">{formatTime(startTime || '')}</span>
                                        <div className="px-5 py-2 rounded-full border border-neutral-700 bg-neutral-800/50 backdrop-blur-md min-w-[56px] text-center">
                                            <span className="text-sm font-bold text-neutral-200 tracking-wider">TOTAL: {totalGoals.toFixed(1)}</span>
                                        </div>
                                    </div>

                                    {/* Win Probability Bar */}
                                    <div className="w-full flex justify-between text-[10px] font-bold text-neutral-500 tracking-widest mb-2 px-1">
                                        <span>{Math.round(awayModelWinPct)}%</span>
                                        <span>MODEL WIN %</span>
                                        <span>{Math.round(homeModelWinPct)}%</span>
                                    </div>
                                    <div className="w-full h-3 bg-neutral-800 rounded-full overflow-hidden flex relative shadow-inner">
                                        <div
                                            className="h-full shadow-[0_0_15px_rgba(255,255,255,0.2)] relative z-10"
                                            style={{
                                                width: `${awayModelWinPct}%`,
                                                background: `linear-gradient(90deg, ${awayBarColor} 0%, ${awayBarColor}dd 100%)`,
                                                boxShadow: `0 0 15px ${awayBarColor}66`
                                            }}
                                        ></div>
                                        {/* Separator Line */}
                                        <div className="w-[2px] h-full bg-neutral-900/50 z-20"></div>
                                        <div
                                            className="h-full flex-1 relative"
                                            style={{
                                                background: `linear-gradient(90deg, ${homeBarColor}dd 0%, ${homeBarColor} 100%)`, // Home Color for the rest
                                                boxShadow: `0 0 15px ${homeBarColor}66`
                                            }}
                                        ></div>
                                    </div>

                                    {/* Odds Comparison Box */}
                                    <div className="flex flex-row justify-between w-full mt-6 px-2 gap-4">
                                        {/* Away Odds */}
                                        <div className="flex flex-col items-center flex-1">
                                            <span className="text-[9px] text-neutral-500 font-bold tracking-widest mb-2">MODEL</span>
                                            <span className="text-base font-bold text-white mb-1">{formatOdds(awayModelOdds)}</span>
                                            <span className="text-[9px] text-neutral-500 font-bold tracking-widest mb-1 mt-1">VEGAS</span>
                                            <span className="text-xs font-mono text-neutral-400">{formatOdds(awayVegasOdds)}</span>
                                        </div>
                                        {/* Divider */}
                                        <div className="w-px bg-neutral-800 h-12 self-center"></div>
                                        {/* Home Odds */}
                                        <div className="flex flex-col items-center flex-1">
                                            <span className="text-[9px] text-neutral-500 font-bold tracking-widest mb-2">MODEL</span>
                                            <span className="text-base font-bold text-white mb-1">{formatOdds(homeModelOdds)}</span>
                                            <span className="text-[9px] text-neutral-500 font-bold tracking-widest mb-1 mt-1">VEGAS</span>
                                            <span className="text-xs font-mono text-neutral-400">{formatOdds(homeVegasOdds)}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* HOME TEAM (Right) */}
                                <div className="flex-1 min-w-0 relative">
                                    <TeamColumn
                                        team={homeTeam}
                                        isHome={true}
                                        starter={homeStarter}
                                        xg={homeXg}
                                        ppRank={prediction.home_pp_rank}
                                        pkRank={prediction.home_pk_rank}
                                        l7={prediction.home_l7}
                                        ev={homeEv}
                                        wager={homeWager}
                                        gas={prediction.home_gas}
                                        gasBreakdown={prediction.home_gas_breakdown}
                                        gsaxTotal={prediction.home_gsax_total}
                                        gsaxPct={prediction.home_gsax_pct}
                                        goalieStats={prediction.home_goalie_stats}
                                        vsOppStats={prediction.homeGoalieVsOpp}
                                        opponentTriCode={awayTeam.triCode}
                                        odds={homeVegasOdds}
                                    />
                                    <NewsIndicator hasNews={!!(prediction.home_news && prediction.home_news.length > 0)} />
                                </div>
                            </div>

                            {/* --- DESKTOP EXPANDED: Recent Games --- */}
                            <div className={`overflow-hidden transition-all duration-300 ${isDesktopExpanded ? 'max-h-[800px] border-t border-white/5 opacity-100' : 'max-h-0 opacity-0'}`}>
                                <div className="p-6 flex flex-row bg-black/20">
                                    {/* Away Team Recent Games */}
                                    <div className="flex-1 pr-6 flex flex-col gap-6">
                                        <RecentGamesList games={away_recent_games || []} teamTriCode={awayTeam.triCode} currentStarter={awayStarter} />
                                        <LineupGrid lineup={prediction.away_lineup} triCode={awayTeam.triCode} />
                                        <PlayerNewsList news={prediction.away_news || []} teamTriCode={awayTeam.triCode} />
                                    </div>

                                    {/* Vertical Divider */}
                                    <div className="w-px bg-white/10 self-stretch"></div>

                                    {/* Home Team Recent Games */}
                                    <div className="flex-1 pl-6 flex flex-col gap-6">
                                        <RecentGamesList games={home_recent_games || []} teamTriCode={homeTeam.triCode} currentStarter={homeStarter} />
                                        <LineupGrid lineup={prediction.home_lineup} triCode={homeTeam.triCode} />
                                        <PlayerNewsList news={prediction.home_news || []} teamTriCode={homeTeam.triCode} />
                                    </div>
                                </div>
                                {/* Legend Footer */}
                                <div className="w-full bg-black/40 border-t border-white/5 py-3 flex justify-center">
                                    <Legend />
                                </div>
                            </div>

                            {/* Expand Hint */}
                            <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 text-neutral-600 transition-opacity duration-300 ${isDesktopExpanded ? 'opacity-0' : 'opacity-100'}`}>
                                <svg className="w-4 h-4 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>

                            </div>


                        </div>

                        {/* ========================================= */}
                        {/* MOBILE VIEW (md:hidden) - Condensed + Expand */}
                        {/* ========================================= */}
                        <div
                            className={`flex md:hidden relative flex-col w-full mx-auto rounded-[2.5rem] mb-1 text-white overflow-hidden transition-all duration-300 border backdrop-blur-xl ${getGlowColor(homeWager, awayWager)}`}
                            onClick={toggleExpand}
                            ref={cardRef}
                        >
                            {/* Background Glass */}
                            <div className="absolute inset-0 bg-[#0a0a0a]/90 -z-10" />

                            {/* --- SUPER CONDENSED HEADER ROW --- */}
                            {/* --- SUPER CONDENSED HEADER ROW --- */}
                            <div className="flex flex-row items-center justify-center relative select-none cursor-pointer active:bg-white/5 transition-colors h-28 overflow-visible px-2">

                                {/* ABSOLUTE BACKGROUND LOGOS */}
                                {/* Left: Away Logo (Oversized & Clipped) */}
                                <div className="absolute left-[-2rem] top-1/2 -translate-y-1/2 w-48 h-48 opacity-40 filter drop-shadow-[0_0_15px_rgba(0,0,0,0.5)] z-0 pointer-events-none">
                                    <LogoDisplay
                                        src={awayTeam.logoUrl}
                                        alt={awayTeam.name}
                                        triCode={awayTeam.triCode}
                                        className="w-full h-full scale-110 object-contain"
                                        primaryColor={awayTeam.color1}
                                        variant="animated"
                                    />
                                </div>
                                {/* Mobile Away News Indicator - Hoisted */}
                                <NewsIndicator
                                    hasNews={!!(prediction.away_news && prediction.away_news.length > 0)}
                                    className="absolute bottom-3 left-7 md:hidden z-20"
                                />

                                {/* Right: Home Logo (Oversized & Clipped) */}
                                <div className="absolute right-[-2rem] top-1/2 -translate-y-1/2 w-48 h-48 opacity-40 filter drop-shadow-[0_0_15px_rgba(0,0,0,0.5)] z-0 pointer-events-none">
                                    <LogoDisplay
                                        src={homeTeam.logoUrl}
                                        alt={homeTeam.name}
                                        triCode={homeTeam.triCode}
                                        className="w-full h-full scale-110 object-contain"
                                        primaryColor={homeTeam.color1}
                                        variant="animated"
                                    />
                                </div>
                                {/* Mobile Home News Indicator - Hoisted */}
                                <NewsIndicator
                                    hasNews={!!(prediction.home_news && prediction.home_news.length > 0)}
                                    className="absolute bottom-3 right-7 md:hidden z-20"
                                />

                                {/* CENTRAL CONTENT CONTAINER (Relative z-10) - Compact & Aligned */}
                                <div className="flex flex-row items-center justify-center w-full max-w-[80%] gap-2 z-10 relative bg-black/40 backdrop-blur-sm rounded-2xl py-1 px-1 border border-white/5 shadow-xl">

                                    {/* LEFT DATA (Away xG/Wager) */}
                                    <div className="flex flex-col items-end justify-center w-[30%] gap-1">
                                        {/* Top: xG - Inline Layout */}
                                        <div className="flex flex-row items-baseline gap-1">
                                            <span className="text-3xl font-black tracking-tighter drop-shadow-[0_0_10px_rgba(0,243,255,0.6)] leading-none text-white">
                                                <AnimatedNumber value={awayXg} toFixed={2} />
                                            </span>
                                            <span className="text-[10px] font-mono text-neutral-400 font-bold uppercase tracking-wider">xG</span>
                                        </div>

                                        {/* Bottom: Wager Pill - Aligned with Bar */}
                                        <div className="h-5 flex items-center">
                                            {awayWager ? (
                                                <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold ${getPillColors(awayWager, awayVegasOdds)}`}>
                                                    <span>+{Math.round(awayEv || 0)}%</span>
                                                    <span className={`opacity-90 border-l pl-1 ${awayWager && awayWager.includes('u') && parseFloat(awayWager) < 0.3 && awayVegasOdds && (typeof awayVegasOdds === 'string' ? parseInt(awayVegasOdds) : awayVegasOdds) <= 110 ? 'border-neutral-600' : 'border-neon-green/30'}`}>{awayWager}</span>
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>

                                    {/* CENTER (Time + Bar) */}
                                    <div className="flex flex-col items-center justify-center flex-1 gap-1">
                                        <span className="text-[10px] font-mono text-neutral-400 tracking-wider whitespace-nowrap mb-0.5">{formatTime(startTime || '')}</span>
                                        {/* Bar - Taller (h-5) & Wider */}
                                        <div className="w-full h-5 bg-neutral-800/80 rounded-sm overflow-hidden flex shadow-inner border border-white/5 relative">
                                            <div
                                                className="h-full shadow-[0_0_10px_rgba(255,255,255,0.2)] flex items-center justify-start pl-1"
                                                style={{
                                                    width: `${awayModelWinPct}%`,
                                                    background: `linear-gradient(90deg, ${awayColor} 0%, ${awayColor}dd 100%)`,
                                                    boxShadow: `0 0 10px ${awayColor}66`
                                                }}
                                            >
                                                <span className="text-[9px] font-bold text-white drop-shadow-md z-10">{Math.round(awayModelWinPct)}%</span>
                                            </div>
                                            <div
                                                className="h-full flex-1 flex items-center justify-end pr-1"
                                                style={{
                                                    background: `linear-gradient(90deg, ${homeColor}dd 0%, ${homeColor} 100%)`,
                                                    boxShadow: `0 0 10px ${homeColor}66`
                                                }}
                                            >
                                                <span className="text-[9px] font-bold text-white drop-shadow-md z-10">{Math.round(homeModelWinPct)}%</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* RIGHT DATA (Home xG/Wager) */}
                                    <div className="flex flex-col items-start justify-center w-[30%] gap-1">
                                        {/* Top: xG - Inline Layout */}
                                        <div className="flex flex-row items-baseline gap-1">
                                            <span className="text-3xl font-black tracking-tighter drop-shadow-[0_0_10px_rgba(0,243,255,0.6)] leading-none text-white">
                                                <AnimatedNumber value={homeXg} toFixed={2} />
                                            </span>
                                            <span className="text-[10px] font-mono text-neutral-400 font-bold uppercase tracking-wider">xG</span>
                                        </div>

                                        {/* Bottom: Wager Pill - Aligned with Bar */}
                                        <div className="h-5 flex items-center">
                                            {homeWager ? (
                                                <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold ${getPillColors(homeWager, homeVegasOdds)}`}>
                                                    <span>+{Math.round(homeEv || 0)}%</span>
                                                    <span className={`opacity-90 border-l pl-1 ${homeWager && homeWager.includes('u') && parseFloat(homeWager) < 0.3 && homeVegasOdds && (typeof homeVegasOdds === 'string' ? parseInt(homeVegasOdds) : homeVegasOdds) <= 110 ? 'border-neutral-600' : 'border-neon-green/30'}`}>{homeWager}</span>
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>

                                </div>
                            </div>

                            {/* Mobile Expand Hint */}
                            <div className={`absolute bottom-3 left-1/2 -translate-x-1/2 text-neutral-500/70 transition-opacity duration-300 pointer-events-none z-20 ${isExpanded ? 'opacity-0' : 'opacity-100'}`}>
                                <svg className="w-4 h-4 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                                </svg>
                            </div>

                            {/* --- EXPANDED DETAILS BODY --- */}
                            <div className={`relative z-20 overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-[1200px] opacity-100 border-t border-white/5' : 'max-h-0 opacity-0'}`}>
                                <div className="p-4 bg-black/80 backdrop-blur-md">
                                    {/* Goalies Row */}
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex flex-col items-start w-[48%]">
                                            <div className="flex items-center gap-1 flex-nowrap">
                                                <span className={`text-[10px] font-bold uppercase ${(awayStarter?.toUpperCase()?.includes('UNCONFIRMED') || !awayStarter) ? 'text-gray-500' :
                                                    (awayStarter?.toUpperCase()?.includes('CONFIRMED')) ? 'text-neon-green' :
                                                        (awayStarter?.toUpperCase()?.includes('LIKELY')) ? 'text-yellow-400' : 'text-gray-500'
                                                    }`}>
                                                    {formatGoalieName(cleanStarterName(awayStarter))}
                                                </span>
                                                {prediction.away_gsax_total !== undefined && prediction.away_gsax_pct !== undefined && (
                                                    <span
                                                        className="text-[9px] font-mono font-bold tracking-tight px-1 py-0.5 rounded bg-black/40 shadow-sm border border-white/5"
                                                        style={{ color: getGsaxColorValue(prediction.away_gsax_pct) }}
                                                    >
                                                        {formatGsax(prediction.away_gsax_total)}
                                                    </span>
                                                )}
                                            </div>
                                            {/* Removed Status Label */}
                                            {prediction.away_goalie_stats && (
                                                <span className="text-[9px] text-neutral-500 font-mono tracking-wide mt-0.5">
                                                    {prediction.away_goalie_stats}
                                                </span>
                                            )}
                                            <VsOppStatsDisplay
                                                statsStr={prediction.awayGoalieVsOpp}
                                                oppTriCode={homeTeam.triCode}
                                                align="left"
                                            />
                                        </div>
                                        <div className="flex flex-col items-end w-[48%]">
                                            <div className="flex items-center gap-1 flex-nowrap justify-end">
                                                {prediction.home_gsax_total !== undefined && prediction.home_gsax_pct !== undefined && (
                                                    <span
                                                        className="text-[9px] font-mono font-bold tracking-tight px-1 py-0.5 rounded bg-black/40 shadow-sm border border-white/5"
                                                        style={{ color: getGsaxColorValue(prediction.home_gsax_pct) }}
                                                    >
                                                        {formatGsax(prediction.home_gsax_total)}
                                                    </span>
                                                )}
                                                <span className={`text-[10px] font-bold uppercase text-right ${(homeStarter?.toUpperCase()?.includes('UNCONFIRMED') || !homeStarter) ? 'text-gray-500' :
                                                    (homeStarter?.toUpperCase()?.includes('CONFIRMED')) ? 'text-neon-green' :
                                                        (homeStarter?.toUpperCase()?.includes('LIKELY')) ? 'text-yellow-400' : 'text-gray-500'
                                                    }`}>
                                                    {formatGoalieName(cleanStarterName(homeStarter))}
                                                </span>
                                            </div>
                                            {/* Removed Status Label */}
                                            {prediction.home_goalie_stats && (
                                                <span className="text-[9px] text-neutral-500 font-mono tracking-wide text-right mt-0.5">
                                                    {prediction.home_goalie_stats}
                                                </span>
                                            )}
                                            <VsOppStatsDisplay
                                                statsStr={prediction.homeGoalieVsOpp}
                                                oppTriCode={awayTeam.triCode}
                                                align="right"
                                            />
                                        </div>
                                    </div>

                                    {/* Odds & Stats Grid */}
                                    <div className="grid grid-cols-2 gap-4">
                                        {/* Away Details */}
                                        <div className="flex flex-col gap-2 p-2 rounded bg-white/5">
                                            <div className="flex justify-between text-[10px]">
                                                <span className="text-neutral-500">Model</span>
                                                <span className="font-bold">{formatOdds(awayModelOdds)}</span>
                                            </div>
                                            <div className="flex justify-between text-[10px]">
                                                <span className="text-neutral-500">Vegas</span>
                                                <span className="font-mono">{formatOdds(awayVegasOdds)}</span>
                                            </div>
                                            <div className="h-px bg-white/10 my-1"></div>
                                            {/* Badges & Gas */}
                                            <div className="flex flex-wrap gap-1 mb-2">
                                                <GasGauge gas={away_gas} breakdown={away_gas_breakdown} align="left" />
                                                {prediction.away_pp_rank && prediction.away_pp_rank <= 5 && <Badge color="blue">#{prediction.away_pp_rank} PP</Badge>}
                                                {prediction.away_pp_rank && prediction.away_pp_rank >= 28 && <Badge color="red">#{prediction.away_pp_rank} PP</Badge>}
                                                {prediction.away_pk_rank && prediction.away_pk_rank <= 5 && <Badge color="blue">#{prediction.away_pk_rank} PK</Badge>}
                                                {prediction.away_pk_rank && prediction.away_pk_rank >= 28 && <Badge color="red">#{prediction.away_pk_rank} PK</Badge>}
                                                {prediction.away_l7 && <Badge color="gray">{prediction.away_l7}</Badge>}
                                            </div>
                                        </div>

                                        {/* Home Details */}
                                        <div className="flex flex-col gap-2 p-2 rounded bg-white/5">
                                            <div className="flex justify-between text-[10px]">
                                                <span className="text-neutral-500">Model</span>
                                                <span className="font-bold">{formatOdds(homeModelOdds)}</span>
                                            </div>
                                            <div className="flex justify-between text-[10px]">
                                                <span className="text-neutral-500">Vegas</span>
                                                <span className="font-mono">{formatOdds(homeVegasOdds)}</span>
                                            </div>
                                            <div className="h-px bg-white/10 my-1"></div>
                                            {/* Badges & Gas */}
                                            <div className="flex flex-wrap gap-1 mb-2 justify-end">
                                                <GasGauge gas={home_gas} breakdown={home_gas_breakdown} align="right" />
                                                {prediction.home_pp_rank && prediction.home_pp_rank <= 5 && <Badge color="blue">#{prediction.home_pp_rank} PP</Badge>}
                                                {prediction.home_pp_rank && prediction.home_pp_rank >= 28 && <Badge color="red">#{prediction.home_pp_rank} PP</Badge>}
                                                {prediction.home_pk_rank && prediction.home_pk_rank <= 5 && <Badge color="blue">#{prediction.home_pk_rank} PK</Badge>}
                                                {prediction.home_pk_rank && prediction.home_pk_rank >= 28 && <Badge color="red">#{prediction.home_pk_rank} PK</Badge>}
                                                {prediction.home_l7 && <Badge color="gray">{prediction.home_l7}</Badge>}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Recent Games Lists (Side-by-Side on Mobile) */}
                                    <div className="flex flex-row gap-2 mt-4 relative">
                                        <div className="flex-1 min-w-0">
                                            {/* Recent Games & Lineups & News */}
                                            <div className="mt-4 flex flex-col gap-4">
                                                <RecentGamesList games={away_recent_games || []} teamTriCode={awayTeam.triCode} isMobile={true} currentStarter={awayStarter} />
                                                <LineupGrid lineup={prediction.away_lineup} triCode={awayTeam.triCode} />
                                                <PlayerNewsList news={prediction.away_news || []} teamTriCode={awayTeam.triCode} />
                                            </div>
                                        </div>
                                        {/* Vertical Divider */}
                                        <div className="w-px bg-white/10 self-stretch mx-1"></div>
                                        <div className="flex-1 min-w-0">
                                            {/* Recent Games & Lineups & News */}
                                            <div className="mt-4 flex flex-col gap-4">
                                                <RecentGamesList games={home_recent_games || []} teamTriCode={homeTeam.triCode} isMobile={true} currentStarter={homeStarter} />
                                                <LineupGrid lineup={prediction.home_lineup} triCode={homeTeam.triCode} />
                                                <PlayerNewsList news={prediction.home_news || []} teamTriCode={homeTeam.triCode} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Total Display in Center */}
                                    <div className="flex justify-center mt-4">
                                        <div className="px-4 py-1 rounded-full border border-neutral-800 bg-neutral-900">
                                            <span className="text-xs font-bold text-neutral-300">TOTAL: {totalGoals.toFixed(1)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            {/* Mobile Legend */}
                            {isExpanded && (
                                <div className="relative z-20 bg-black/90 pb-4 pt-2 px-4 flex justify-center border-t border-white/5">
                                    <Legend />
                                </div>
                            )}
                        </div>
                    </>
                    );
};

                    export default MatchupCard;
