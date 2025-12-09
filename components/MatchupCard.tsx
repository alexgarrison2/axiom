import React, { useState, useRef } from 'react';
import { GamePrediction } from '@/utils/data';
import Image from 'next/image';
import Link from 'next/link';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Flip } from 'gsap/Flip';
import AnimatedNumber from './AnimatedNumber';
import LogoDisplay from './LogoDisplay';
import RecentGamesList from './RecentGamesList';

gsap.registerPlugin(useGSAP, Flip);

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

    // FLIP Animation Context
    const { contextSafe } = useGSAP({ scope: cardRef });

    const toggleExpand = contextSafe(() => {
        const state = Flip.getState(cardRef.current);

        // Update State (triggers render)
        setIsExpanded(!isExpanded);

        // Animate from previous state after DOM update
        // We use a small timeout to allow React to render the class change
        // Or better, use flushSync? Or just rely on GSAP's tick?
        // Actually, in React, we need useEffect to catch the post-render state.
        // But for simplicity in this "event" driven flow:

        // Wait for next tick to let React render the class change
        requestAnimationFrame(() => {
            Flip.from(state, {
                duration: 0.6,
                ease: "power3.inOut",
                absolute: true, // Use absolute positioning for smoother reflow
                onEnter: elements => gsap.fromTo(elements, { opacity: 0 }, { opacity: 1, duration: 0.3 }),
                onLeave: elements => gsap.to(elements, { opacity: 0, duration: 0.3 }),
                // Targets the card itself resizing
                targets: cardRef.current
            });
        });
    });

    // Desktop Toggle (Simple height/opacity transition)
    const toggleDesktopExpand = () => {
        setIsDesktopExpanded(!isDesktopExpanded);
    };

    // --- Helpers ---
    const getGasColor = (gas: number | undefined) => {
        if (gas === undefined) return 'text-neutral-500 bg-neutral-500/10 border-neutral-500/20';
        if (gas >= 90) return 'text-neon-green bg-neon-green/10 border-neon-green/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]';
        if (gas >= 75) return 'text-blue-400 bg-blue-400/10 border-blue-400/20 shadow-[0_0_10px_rgba(96,165,250,0.2)]';
        if (gas >= 50) return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
        return 'text-red-500 bg-red-500/10 border-red-500/20';
    };

    const GasGauge = ({ gas, breakdown, align = 'center' }: { gas?: number, breakdown?: string[], align?: 'left' | 'right' | 'center' }) => {
        let tooltipClasses = "absolute bottom-full mb-2 hidden group-hover/gas:block w-40 bg-zinc-950 border border-white/10 rounded-lg p-2 z-50 shadow-xl backdrop-blur-md";

        if (align === 'left') {
            tooltipClasses += " left-0 origin-bottom-left";
        } else if (align === 'right') {
            tooltipClasses += " right-0 origin-bottom-right";
        } else {
            tooltipClasses += " left-1/2 -translate-x-1/2 origin-bottom";
        }

        return (
            <div className={`group/gas relative flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider cursor-help ${getGasColor(gas)}`}>
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
    const formatPct = (n: number) => n.toFixed(1) + '%';
    const formatXg = (n: number) => n.toFixed(2);
    const formatEv = (n: number) => `+${Math.round(n)}%`;
    const formatOdds = (odds: string) => {
        if (!odds || odds === 'N/A') return null;
        if (odds.startsWith('+') || odds.startsWith('-')) return odds;
        return `+${odds}`;
    };

    const formatGsax = (val: number) => {
        if (val >= 0) return `+${val.toFixed(1)}`;
        return `(${Math.abs(val).toFixed(1)})`;
    };

    const getGsaxColorValue = (percentile: number) => {
        // Red (0) -> Grey (50) -> Blue (100)
        // Red: rgb(240, 80, 80)
        // Grey: rgb(160, 160, 160)
        // Blue: rgb(60, 130, 240)

        let r, g, b;
        if (percentile <= 50) {
            // Red to Grey
            const ratio = percentile / 50;
            r = Math.round(240 + (160 - 240) * ratio);
            g = Math.round(80 + (160 - 80) * ratio);
            b = Math.round(80 + (160 - 80) * ratio);
        } else {
            // Grey to Blue
            const ratio = (percentile - 50) / 50;
            r = Math.round(160 + (60 - 160) * ratio);
            g = Math.round(160 + (130 - 160) * ratio);
            b = Math.round(160 + (240 - 160) * ratio);
        }
        return `rgb(${r}, ${g}, ${b})`;
    };

    // New Helpers for Mobile
    const formatTime = (time: string) => time; // Simplified

    const getGoalieStatusColor = (starter: string | null, gameId: string, team: 'home' | 'away') => {
        if (!starter) return 'text-neutral-500';
        const lower = starter.toLowerCase();
        // Explicitly check for unconfirmed first
        if (lower.includes('unconfirmed')) return 'text-neutral-500';
        if (lower.includes('confirmed')) return 'text-neon-green';
        if (lower.includes('likely')) return 'text-yellow-400';
        return 'text-neutral-500';
    };

    const getGoalieStatusText = (starter: string | null, gameId: string, team: 'home' | 'away') => {
        if (!starter) return 'Unconfirmed';
        const match = starter.match(/\((.*?)\)$/);
        return match ? match[1] : 'Unconfirmed';
    };

    const getRankColor = (rank: number | undefined) => {
        if (rank === undefined) return 'border-neutral-700 bg-neutral-900/50 text-neutral-400';
        if (rank <= 5) return 'border-blue-500 bg-blue-900/30 text-blue-400';
        if (rank >= 28) return 'border-red-500 bg-red-900/30 text-red-400';
        return 'border-neutral-700 bg-neutral-900/50 text-neutral-400';
    };

    const getGlowColor = (homeWager: string | null, awayWager: string | null) => {
        if (homeWager || awayWager) {
            // "Nebula" Glow: Soft green glow, but GREY physical border
            return 'border-white/10 shadow-[0_0_30px_-5px_rgba(16,185,129,0.3)] hover:shadow-[0_0_40px_-5px_rgba(16,185,129,0.4)]';
        }
        return 'border-white/5 hover:border-white/10';
    };

    const cleanStarterName = (starter: string | null) => {
        if (!starter) return '';
        return starter.replace(/\s*\(.*?\)$/, '');
    };


    const homeColor = homeTeam.color1 || '#000';
    const awayColor = awayTeam.color1 || '#000';

    // Width calculations
    const widthPercentage = Math.min(100, (totalGoals / maxTotalGoals) * 100);
    const isHighEv = ((homeEv || 0) >= 20) || ((awayEv || 0) >= 20);

    // Helper for Badges
    const Badge = ({ children, color = 'blue' }: { children: React.ReactNode, color?: 'blue' | 'red' | 'gray' }) => {
        const colorClasses = {
            blue: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
            red: 'text-red-500 bg-red-500/10 border-red-500/30',
            gray: 'text-gray-400 bg-white/5 border-white/10'
        };
        return (
            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border backdrop-blur-sm ${colorClasses[color]}`}>
                {children}
            </span>
        );
    };

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
        gsaxPct
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
        gsaxPct?: number
    }) => {
        const alignClass = isHome ? 'md:items-start md:text-left' : 'md:items-end md:text-right';
        const evBadge = ev && ev > 0 ? formatEv(ev) : null;
        const safeStarter = starter || '';
        // Extract status from parentheses, e.g. "Name (Confirmed)" or "Name (Likely)"
        const statusMatch = safeStarter.match(/\((.*?)\)$/);
        const status = statusMatch ? statusMatch[1] : null;
        const starterName = safeStarter.replace(/\s*\(.*?\)$/, '');

        return (
            <div className={`flex flex-col items-center py-4 relative z-10 w-full h-full ${alignClass}`}>

                {/* Team Info Header */}
                <div className={`flex flex-col gap-1 mb-4 w-full ${isHome ? 'md:flex-row' : 'md:flex-row-reverse'} items-center md:items-start`}>
                    <LogoDisplay
                        src={team.logoUrl}
                        alt={team.name}
                        triCode={team.triCode}
                        className="w-16 h-16 md:w-20 md:h-20"
                    />
                    <div className={`flex flex-col ${alignClass} items-center min-w-0 max-w-full justify-center gap-1`}>
                        <div className="flex items-center gap-1.5 flex-wrap justify-center md:justify-start">
                            <span className="text-[10px] md:text-xs text-gray-400 font-bold uppercase tracking-wide truncate max-w-full">{starterName}</span>
                            {gsaxTotal !== undefined && gsaxPct !== undefined && (
                                <span
                                    className="text-[9px] font-mono font-bold tracking-tight px-1 py-0.5 rounded bg-black/40 shadow-sm border border-white/5"
                                    style={{ color: getGsaxColorValue(gsaxPct) }}
                                >
                                    {formatGsax(gsaxTotal)}
                                </span>
                            )}
                        </div>
                        {status && (
                            <span className={`text-[9px] md:text-[10px] font-mono uppercase tracking-wider ${(status.toUpperCase().includes('UNCONFIRMED')) ? 'text-gray-500' :
                                (status.toUpperCase().includes('CONFIRMED')) ? 'text-neon-green' :
                                    (status.toUpperCase().includes('LIKELY')) ? 'text-yellow-400' : 'text-gray-500'
                                }`}>
                                {status}
                            </span>
                        )}
                    </div>
                </div>

                {/* Main Stats (xG) */}
                <div className={`flex flex-col ${alignClass} mb-4 items-center`}>
                    <div className="flex items-baseline gap-2">
                        <span className="text-4xl md:text-5xl font-black text-white tracking-tighter tabular-nums text-glow-blue">
                            <AnimatedNumber value={xg} toFixed={2} />
                        </span>
                        <span className="text-xs font-mono text-gray-500 font-bold uppercase">xG</span>
                    </div>
                </div>

                {/* Secondary Badges Row (Aligned immediately under xG) */}
                <div className="flex flex-wrap gap-2 justify-center md:justify-start mb-4">
                    {ppRank && ppRank <= 5 && <Badge color="blue">#{ppRank} PP</Badge>}
                    {ppRank && ppRank >= 28 && <Badge color="red">#{ppRank} PP</Badge>}
                    {pkRank && pkRank <= 5 && <Badge color="blue">#{pkRank} PK</Badge>}
                    {pkRank && pkRank >= 28 && <Badge color="red">#{pkRank} PK</Badge>}
                    {l7 && <Badge color="gray">{l7} (L7)</Badge>}
                    <GasGauge gas={gas} breakdown={gasBreakdown} align={isHome ? 'left' : 'right'} />
                </div>

                {/* Wager Callout (Pushed to bottom) */}
                {(evBadge || wager) && (
                    <div className={`mt-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neon-green/10 border border-neon-green/30 text-neon-green text-xs font-bold shadow-[0_0_15px_rgba(10,255,0,0.1)] hover:shadow-[0_0_20px_rgba(10,255,0,0.3)] transition-all ${isHighEv ? 'animate-pulse-glow' : ''}`}>
                        {evBadge && <span>EV: {evBadge}</span>}
                        {wager && <span className="opacity-90 border-l border-neon-green/30 pl-2">{wager}</span>}
                    </div>
                )}

            </div>
        );
    };


    return (
        <>
            {/* ========================================= */}
            {/* DESKTOP VIEW (md:flex) - The Original Card */}
            {/* ========================================= */}
            <div
                className={`hidden md:flex relative flex-col w-full max-w-4xl mx-auto rounded-3xl mb-6 transition-all duration-300 border backdrop-blur-xl group hover:shadow-[0_0_30px_rgba(0,243,255,0.15)] cursor-pointer ${getGlowColor(homeWager, awayWager)} ${isDesktopExpanded ? 'bg-white/[0.02]' : 'bg-transparent'}`}
                onClick={toggleDesktopExpand}
                ref={desktopCardRef}
            >

                {/* Background Glass Layer */}
                <div className="absolute inset-0 bg-[#0a0a0a]/80 rounded-3xl -z-10" />

                {/* High EV Border Pulse */}
                {isHighEv && (
                    <div className="absolute inset-0 rounded-3xl border border-neon-green/50 animate-pulse pointer-events-none"></div>
                )}

                {/* Decorative Background Gradients */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
                    <div className="absolute -left-20 -top-20 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] opacity-20 group-hover:opacity-30 transition-opacity"></div>
                    <div className="absolute -right-20 -bottom-20 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] opacity-20 group-hover:opacity-30 transition-opacity"></div>
                </div>

                <div className="p-6 flex flex-row items-stretch justify-between w-full relative z-10">

                    {/* AWAY TEAM (Left) - Flex-1 to push to edge */}
                    <div className="flex-1 min-w-0">
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
                        />
                    </div>

                    {/* CENTER INFO (Time, Total, Bar) - Bracketed by dividers */}
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
                                    background: `linear-gradient(90deg, ${awayColor} 0%, ${awayColor}dd 100%)`,
                                    boxShadow: `0 0 15px ${awayColor}66`
                                }}
                            ></div>
                            <div
                                className="h-full flex-1 relative"
                                style={{
                                    background: `linear-gradient(90deg, ${homeColor}dd 0%, ${homeColor} 100%)`, // Home Color for the rest
                                    boxShadow: `0 0 15px ${homeColor}66`
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


                    {/* HOME TEAM (Right) - Flex-1 to push to edge */}
                    <div className="flex-1 min-w-0">
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
                        />
                    </div>
                </div>

                {/* --- DESKTOP EXPANDED: Recent Games --- */}
                <div className={`overflow-hidden transition-all duration-300 ${isDesktopExpanded ? 'max-h-[800px] border-t border-white/5 opacity-100' : 'max-h-0 opacity-0'}`}>
                    <div className="p-6 flex flex-row bg-black/20">
                        {/* Away Team Recent Games */}
                        <div className="flex-1 pr-6">
                            <RecentGamesList games={away_recent_games || []} teamTriCode={awayTeam.triCode} />
                        </div>

                        {/* Vertical Divider */}
                        <div className="w-px bg-white/10 self-stretch"></div>

                        {/* Home Team Recent Games */}
                        <div className="flex-1 pl-6">
                            <RecentGamesList games={home_recent_games || []} teamTriCode={homeTeam.triCode} />
                        </div>
                    </div>
                </div>

                {/* Expand Hint */}
                <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 text-neutral-600 transition-opacity duration-300 ${isDesktopExpanded ? 'opacity-0' : 'opacity-100'}`}>
                    <svg className="w-4 h-4 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>

                </div>


                {/* ========================================= */}
                {/* MOBILE VIEW (md:hidden) - Condensed + Expand */}
                {/* ========================================= */}
                <div
                    className={`flex md:hidden flex-col w-full mx-auto rounded-[2.5rem] mb-1 text-white overflow-hidden transition-all duration-300 border backdrop-blur-xl ${getGlowColor(homeWager, awayWager)}`}
                    onClick={toggleExpand}
                    ref={cardRef}
                >
                    {/* Background Glass */}
                    <div className="absolute inset-0 bg-[#0a0a0a]/90 -z-10" />

                    {/* --- SUPER CONDENSED HEADER ROW --- */}
                    <div className="flex flex-row items-center justify-center relative select-none cursor-pointer active:bg-white/5 transition-colors h-32 overflow-hidden px-4">

                        {/* ABSOLUTE BACKGROUND LOGOS */}
                        {/* Left: Away Logo (Oversized & Clipped) */}
                        <div className="absolute left-[-2rem] top-1/2 -translate-y-1/2 w-48 h-48 opacity-40 filter drop-shadow-[0_0_15px_rgba(0,0,0,0.5)] z-0 pointer-events-none">
                            <LogoDisplay src={awayTeam.logoUrl} alt={awayTeam.name} triCode={awayTeam.triCode} className="w-full h-full scale-110 object-contain" />
                        </div>
                        {/* Right: Home Logo (Oversized & Clipped) */}
                        <div className="absolute right-[-2rem] top-1/2 -translate-y-1/2 w-48 h-48 opacity-40 filter drop-shadow-[0_0_15px_rgba(0,0,0,0.5)] z-0 pointer-events-none">
                            <LogoDisplay src={homeTeam.logoUrl} alt={homeTeam.name} triCode={homeTeam.triCode} className="w-full h-full scale-110 object-contain" />
                        </div>

                        {/* CENTRAL CONTENT CONTAINER (Relative z-10) */}
                        <div className="flex flex-row items-center justify-center w-full max-w-[80%] gap-3 z-10 relative bg-black/40 backdrop-blur-sm rounded-2xl py-2 px-1 border border-white/5 shadow-xl">

                            {/* LEFT DATA (Away xG/Wager) */}
                            <div className="flex flex-col items-end gap-1">
                                {/* Top: xG */}
                                <div className="flex flex-col items-end -mr-1">
                                    <span className="text-3xl font-black tracking-tighter drop-shadow-[0_0_10px_rgba(0,243,255,0.6)] leading-none text-white">
                                        <AnimatedNumber value={awayXg} toFixed={2} />
                                    </span>
                                    <span className="text-[8px] font-mono text-neutral-400 font-bold uppercase tracking-wider">xG</span>
                                </div>
                                {/* Bottom: Wager Pill */}
                                {awayWager ? (
                                    <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-neon-green/10 border border-neon-green/30 text-neon-green text-[9px] font-bold shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                                        <span>+{Math.round(awayEv || 0)}%</span>
                                        <span className="opacity-90 border-l border-neon-green/30 pl-1">{awayWager}</span>
                                    </div>
                                ) : <div className="h-5"></div>}
                            </div>

                            {/* CENTER (Time + Bar) */}
                            <div className="flex flex-col items-center justify-center w-[35%] gap-1.5">
                                <span className="text-[9px] font-mono text-neutral-400 tracking-wider whitespace-nowrap">{formatTime(startTime || '')}</span>
                                {/* Bar */}
                                <div className="w-full h-3 bg-neutral-800/80 rounded-full overflow-hidden flex shadow-inner border border-white/5">
                                    <div
                                        className="h-full shadow-[0_0_10px_rgba(255,255,255,0.2)]"
                                        style={{
                                            width: `${awayModelWinPct}%`,
                                            background: `linear-gradient(90deg, ${awayColor} 0%, ${awayColor}dd 100%)`,
                                            boxShadow: `0 0 10px ${awayColor}66`
                                        }}
                                    ></div>
                                    <div
                                        className="h-full flex-1"
                                        style={{
                                            background: `linear-gradient(90deg, ${homeColor}dd 0%, ${homeColor} 100%)`,
                                            boxShadow: `0 0 10px ${homeColor}66`
                                        }}
                                    ></div>
                                </div>
                            </div>

                            {/* RIGHT DATA (Home xG/Wager) */}
                            <div className="flex flex-col items-start gap-1">
                                {/* Top: xG */}
                                <div className="flex flex-col items-start -ml-1">
                                    <span className="text-3xl font-black tracking-tighter drop-shadow-[0_0_10px_rgba(0,243,255,0.6)] leading-none text-white">
                                        <AnimatedNumber value={homeXg} toFixed={2} />
                                    </span>
                                    <span className="text-[8px] font-mono text-neutral-400 font-bold uppercase tracking-wider">xG</span>
                                </div>
                                {/* Bottom: Wager Pill */}
                                {homeWager ? (
                                    <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-neon-green/10 border border-neon-green/30 text-neon-green text-[9px] font-bold shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                                        <span>+{Math.round(homeEv || 0)}%</span>
                                        <span className="opacity-90 border-l border-neon-green/30 pl-1">{homeWager}</span>
                                    </div>
                                ) : <div className="h-5"></div>}
                            </div>

                        </div>
                    </div>

                    {/* --- EXPANDED DETAILS BODY --- */}
                    <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-[1200px] opacity-100 border-t border-white/5' : 'max-h-0 opacity-0'}`}>
                        <div className="p-4 bg-black/20">
                            {/* Goalies Row */}
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex flex-col items-start w-[48%]">
                                    <div className="flex items-center gap-1 flex-wrap">
                                        <span className={`text-[10px] font-bold uppercase ${getGoalieStatusColor(awayStarter, prediction.id, 'away')}`}>
                                            {cleanStarterName(awayStarter)}
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
                                    <span className="text-[9px] text-neutral-500 font-mono uppercase mt-0.5">
                                        {getGoalieStatusText(awayStarter, prediction.id, 'away')}
                                    </span>
                                </div>
                                <div className="flex flex-col items-end w-[48%]">
                                    <div className="flex items-center gap-1 flex-wrap justify-end">
                                        {prediction.home_gsax_total !== undefined && prediction.home_gsax_pct !== undefined && (
                                            <span
                                                className="text-[9px] font-mono font-bold tracking-tight px-1 py-0.5 rounded bg-black/40 shadow-sm border border-white/5"
                                                style={{ color: getGsaxColorValue(prediction.home_gsax_pct) }}
                                            >
                                                {formatGsax(prediction.home_gsax_total)}
                                            </span>
                                        )}
                                        <span className={`text-[10px] font-bold uppercase text-right ${getGoalieStatusColor(homeStarter, prediction.id, 'home')}`}>
                                            {cleanStarterName(homeStarter)}
                                        </span>
                                    </div>
                                    <span className="text-[9px] text-neutral-500 font-mono uppercase text-right mt-0.5">
                                        {getGoalieStatusText(homeStarter, prediction.id, 'home')}
                                    </span>
                                </div>
                            </div>

                            {/* Odds & Stats Grid */}
                            <div className="grid grid-cols-2 gap-4">
                                {/* Away Details */}
                                <div className="flex flex-col gap-2 p-2 rounded bg-white/5">
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-neutral-500">Model</span>
                                        <span className="font-bold">{awayModelOdds}</span>
                                    </div>
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-neutral-500">Vegas</span>
                                        <span className="font-mono">{awayVegasOdds}</span>
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
                                        <span className="font-bold">{homeModelOdds}</span>
                                    </div>
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-neutral-500">Vegas</span>
                                        <span className="font-mono">{homeVegasOdds}</span>
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
                                    <RecentGamesList games={away_recent_games || []} teamTriCode={awayTeam.triCode} isMobile={true} />
                                </div>
                                {/* Vertical Divider */}
                                <div className="w-px bg-white/10 self-stretch mx-1"></div>
                                <div className="flex-1 min-w-0">
                                    <RecentGamesList games={home_recent_games || []} teamTriCode={homeTeam.triCode} isMobile={true} />
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
                </div>
            </div>
        </>
    );
};

export default MatchupCard;
