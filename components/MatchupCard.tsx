"use client";

import React, { useState, useRef, useEffect } from 'react';
import { GamePrediction } from '@/utils/data';
import Image from 'next/image';
import Link from 'next/link';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { PlayoffLeverageBadge } from './PlayoffLeverageBadge';
import AnimatedNumber from './AnimatedNumber';
import LogoDisplay from './LogoDisplay';
import RecentGamesList from './RecentGamesList';
import PlayerNewsList from './PlayerNewsList';
import LineupGrid from './LineupGrid';

gsap.registerPlugin(useGSAP);

interface MatchupCardProps {
    prediction: GamePrediction;
    maxTotalGoals: number;
    isSocial?: boolean;
    isUltraCompact?: boolean;
    playoffLeverage?: number | null; // New Prop
}

const MatchupCard: React.FC<MatchupCardProps> = ({ prediction, maxTotalGoals, isSocial = false, isUltraCompact = false, playoffLeverage = null }) => {
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

        home_avg_speed,
        away_avg_speed,
        home_rr_rate,
        away_rr_rate,
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
                {breakdown && breakdown.length > 0 && !isSocial && (
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

    const EdgeBadge = ({ label, value, color = 'blue', suffix = '' }: { label: string, value?: number, color?: 'blue' | 'green' | 'red', suffix?: string }) => {
        if (value === undefined) return null;

        let colorClass = 'text-blue-400 bg-blue-400/10 border-blue-400/30';
        if (color === 'green') colorClass = 'text-neon-green bg-neon-green/10 border-neon-green/30';
        if (color === 'red') colorClass = 'text-red-500 bg-red-500/10 border-red-500/30';

        return (
            <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${colorClass}`}>
                <span className="opacity-70">{label}</span>
                <span>{value.toFixed(1)}{suffix}</span>
            </div>
        );
    };

    // --- xG Explanation Helper ---
    const ExplanationPopover = ({
        items,
        align = 'center',
        transparentTrigger = false,
        placement = 'top'  // 'top' means tooltip is ABOVE trigger (default), 'bottom' means BELOW
    }: {
        items?: string[],
        align?: 'left' | 'right' | 'center',
        transparentTrigger?: boolean,
        placement?: 'top' | 'bottom'
    }) => {
        const [isOpen, setIsOpen] = useState(false);

        if (!items || items.length === 0) return null;
        if (isSocial) return null; // No popovers/interactive elements in social/print view

        // Base tooltip classes
        let tooltipClasses = "absolute w-auto min-w-[12rem] whitespace-nowrap bg-zinc-950/95 border border-white/10 rounded-lg p-2 z-[70] shadow-xl backdrop-blur-md";

        // Vertical Placement
        if (placement === 'top') {
            tooltipClasses += " bottom-full mb-1";
        } else {
            tooltipClasses += " top-full mt-1";
        }

        // Visibility
        tooltipClasses += isOpen ? " block" : " hidden md:group-hover/info:block";

        // Horizontal Alignment
        if (align === 'left') {
            tooltipClasses += " left-0 origin-bottom-left";
        } else if (align === 'right') {
            tooltipClasses += " right-0 origin-bottom-right";
        } else {
            tooltipClasses += " left-1/2 -translate-x-1/2 origin-bottom";
        }

        const triggerClass = transparentTrigger
            ? "p-0.5 text-neutral-500 hover:text-white cursor-help transition-colors"
            : "p-1 rounded-full bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white cursor-help transition-colors";

        return (
            <div
                className={`group/info relative inline-flex ${transparentTrigger ? '' : 'ml-2'}`}
                onClick={(e) => {
                    e.stopPropagation();
                    setIsOpen(!isOpen);
                }}
            >
                <div className={triggerClass}>
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

    // --- Restored Helpers ---
    const formatEv = (n: number) => `+${Math.round(n)}%`;
    const formatOdds = (odds: string | number | null) => {
        if (!odds || odds === 'N/A') return null;
        let str = odds.toString();
        if (str.startsWith('+') || str.startsWith('-')) return str;
        return `+${str}`;
    };

    const getContrastTextClass = (hexColor: string): string => {
        if (!hexColor) return 'text-white';
        // Convert hex to RGB
        const r = parseInt(hexColor.substring(1, 3), 16);
        const g = parseInt(hexColor.substring(3, 5), 16);
        const b = parseInt(hexColor.substring(5, 7), 16);

        // Calculate brightness (rec 601)
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;

        // Threshold of 128 is standard, but let's go a bit higher for safety on mid-tones
        return brightness > 140 ? 'text-black' : 'text-white';
    };

    const formatGsax = (val: number) => {
        if (val >= 0) return `+${val.toFixed(1)}`;
        return `(${Math.abs(val).toFixed(1)})`;
    };

    const getGsaxColorValue = (percentile: number) => {
        let r, g, b;
        if (percentile <= 50) {
            const ratio = percentile / 50;
            r = Math.round(240 + (160 - 240) * ratio);
            g = Math.round(80 + (160 - 80) * ratio);
            b = Math.round(80 + (160 - 80) * ratio);
        } else {
            const ratio = (percentile - 50) / 50;
            r = Math.round(160 + (60 - 160) * ratio);
            g = Math.round(160 + (130 - 160) * ratio);
            b = Math.round(160 + (240 - 160) * ratio);
        }
        return `rgb(${r}, ${g}, ${b})`;
    };

    const formatTime = (time: string) => time;

    const getGlowColor = (homeWager: string | null, awayWager: string | null) => {
        if (isSocial) return 'border-white/10'; // Social: no hover glow
        if (homeWager || awayWager) {
            return 'border-white/10 shadow-[0_0_30px_-5px_rgba(0,243,255,0.15)] hover:shadow-[0_0_40px_-5px_rgba(0,243,255,0.25)]';
        }
        return 'border-white/5 hover:border-white/10';
    };

    const getUltraCompactGlow = (homeWager: string | null, awayWager: string | null) => {
        if (homeWager || awayWager) return 'border-[#00f3ff]/30 shadow-[0_0_15px_rgba(0,243,255,0.1)]';
        return 'border-white/10';
    };

    const cleanStarterName = (starter: string | null) => {
        if (!starter) return '';
        return starter.replace(/\s*\(.*?\)$/, '');
    };

    const formatGoalieName = (name: string) => {
        if (!name) return '';
        if (name.length > 12) {
            const parts = name.split(' ');
            if (parts.length > 1) {
                return `${parts[0].charAt(0)}. ${parts.slice(1).join(' ')}`;
            }
        }
        return name;
    };

    const getPillColors = (wagerStr: string | null | undefined, oddsVal: string | number | null | undefined) => {
        let units = 0;
        let odds = 1000;
        if (wagerStr) {
            const uMatch = wagerStr.match(/([\d\.]+)u/);
            if (uMatch) units = parseFloat(uMatch[1]);
        }
        if (oddsVal !== null && oddsVal !== undefined) {
            if (typeof oddsVal === 'number') odds = oddsVal;
            else if (typeof oddsVal === 'string') odds = parseInt(oddsVal, 10);
        }
        if (units < 0.3 && odds <= 110) {
            return "bg-neutral-800/80 border border-neutral-600 text-neutral-400 shadow-none hover:border-neutral-500";
        }
        return "bg-neon-green/10 border border-neon-green/30 text-neon-green shadow-[0_0_10px_rgba(16,185,129,0.1)] hover:shadow-[0_0_15px_rgba(16,185,129,0.2)]";
    };

    const Badge = ({ children, color = 'blue', size = 'sm' }: { children: React.ReactNode, color?: 'blue' | 'red' | 'gray', size?: 'xs' | 'sm' }) => {
        const colorClasses = {
            blue: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
            red: 'text-red-500 bg-red-500/10 border-red-500/30',
            gray: 'text-gray-400 bg-white/5 border-white/10'
        };
        const sizeClasses = {
            xs: 'text-[9px] px-1 py-0',
            sm: 'text-[10px] px-1.5 py-0.5'
        };
        return (
            <span className={`font-mono font-bold rounded border backdrop-blur-sm ${colorClasses[color]} ${sizeClasses[size]}`}>
                {children}
            </span>
        );
    };

    const VsOppStatsDisplay = ({ statsStr, oppTriCode, align = 'left' }: { statsStr: string | undefined, oppTriCode: string, align?: 'left' | 'right' }) => {
        if (!statsStr) return null;
        try {
            const vsOpp = JSON.parse(statsStr);
            return (
                <div className={`mt-0.5 text-[9px] font-mono tracking-wide text-neutral-400 whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
                    <span className="text-neutral-500">vs {oppTriCode}: </span>
                    <span className={`${vsOpp.win_pct >= 0.700 ? 'text-neon-green font-bold' : vsOpp.win_pct <= 0.300 ? 'text-red-400' : 'text-neutral-300'}`}>
                        {vsOpp.record}
                    </span>
                    <span className="text-neutral-600 mx-1">|</span>
                    <span className={`${vsOpp.sv >= 0.910 ? 'text-neon-green font-bold' : vsOpp.sv <= 0.890 ? 'text-red-400' : 'text-neutral-300'}`}>
                        {vsOpp.sv.toFixed(3).substring(1)}
                    </span>
                    <span className="text-neutral-600 mx-1">|</span>
                    <span>{vsOpp.gaa.toFixed(2)}</span>
                </div>
            );
        } catch (e) { return null; }
    };

    const Legend = ({ className = "" }: { className?: string }) => (
        <div className={`flex flex-wrap items-center justify-center gap-4 text-[9px] font-mono text-neutral-500 ${className}`}>
            <span className="uppercase tracking-widest opacity-50 hidden sm:inline">Legend:</span>
            <div className="flex items-center gap-1.5 bg-neutral-900/50 px-2 py-1 rounded border border-white/5">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_5px_rgba(168,85,247,0.6)]"></div>
                <span className="text-gray-300">Current Goalie Starts</span>
            </div>
            <div className="flex items-center gap-1.5 bg-neutral-900/50 px-2 py-1 rounded border border-white/5">
                <span className="font-bold text-[#5382BD]">PP1</span>
            </div>
            <div className="flex items-center gap-1.5 bg-neutral-900/50 px-2 py-1 rounded border border-white/5">
                <span className="text-white">PP2</span>
            </div>
            <div className="flex items-center bg-neutral-900/50 rounded border border-white/5 divide-x divide-white/10">
                <div className="px-2 py-1 bg-white/5">
                    <span className="text-neutral-400 font-bold">Goalie Status</span>
                </div>
                <div className="flex items-center gap-3 px-3 py-1">
                    <span className="text-neon-green font-bold">Confirmed</span>
                    <span className="text-yellow-400 font-bold">Likely</span>
                    <span className="text-gray-500 font-bold">Unconfirmed</span>
                </div>
            </div>
        </div>
    );

    const NewsIndicator = ({ hasNews, className = "absolute bottom-2 right-2" }: { hasNews: boolean, className?: string }) => {
        if (!hasNews) return null;
        if (isSocial) return null; // Hide in social mode
        return (
            <div className={`${className} z-50`} title="Player News Available">
                <div className="bg-yellow-500/10 border border-yellow-500/20 p-1.5 rounded-full animate-pulse shadow-[0_0_15px_rgba(234,179,8,0.4)] backdrop-blur-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EAB308" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
                        <path d="M18 14h-8" />
                        <path d="M15 18h-5" />
                        <path d="M10 6h8v4h-8V6Z" />
                    </svg>
                </div>
            </div>
        );
    };

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
        odds,

        isSocial,
        avgSpeed,
        rrRate
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
        odds?: string | number | null,
        isSocial?: boolean,
        avgSpeed?: number,
        rrRate?: number
    }) => {
        const alignClass = isHome ? 'md:items-start md:text-left' : 'md:items-end md:text-right';
        const evBadge = ev && ev > 0 ? formatEv(ev) : null;
        const safeStarter = starter || '';
        const statusMatch = safeStarter.match(/\((.*?)\)$/);
        const status = statusMatch ? statusMatch[1] : 'UNCONFIRMED';
        const starterName = safeStarter.replace(/\s*\(.*?\)$/, '');
        const isHighEv = (ev || 0) > 0.05;

        // Parse vsOppStats if available
        let vsOpp = null;
        if (vsOppStats) { try { vsOpp = JSON.parse(vsOppStats); } catch (e) { } }

        return (
            <div className={`flex flex-col items-center ${isSocial ? 'py-0.5' : 'py-4'} relative z-10 w-full h-full ${alignClass}`}>
                {/* Team Info Header */}
                <div className={`flex flex-col gap-1 ${isSocial ? 'mb-0.5' : 'mb-4'} w-full ${isHome ? 'md:flex-row' : 'md:flex-row-reverse'} items-center md:items-start`}>
                    <LogoDisplay
                        src={team.logoUrl}
                        alt={team.name}
                        triCode={team.triCode}
                        className={isSocial ? "w-14 h-14" : "w-20 h-20 md:w-28 md:h-28"}
                        primaryColor={team.color1}
                        variant="animated"
                    />
                    <div className={`flex flex-col ${alignClass} items-center min-w-0 max-w-full justify-center gap-0.5`}>
                        <div className="flex items-center gap-1.5 flex-nowrap justify-center md:justify-start">
                            <span className={`${isSocial ? 'text-[9px]' : 'text-[10px] md:text-xs'} font-bold uppercase tracking-wide truncate max-w-full ${(status?.toUpperCase()?.includes('UNCONFIRMED')) ? 'text-gray-500' :
                                (status?.toUpperCase()?.includes('CONFIRMED')) ? 'text-neon-green' :
                                    (status?.toUpperCase()?.includes('LIKELY')) ? 'text-yellow-400' : 'text-gray-500'
                                }`}>
                                {formatGoalieName(starterName)}
                            </span>
                            {gsaxTotal !== undefined && gsaxPct !== undefined && (
                                <span className="text-[9px] font-mono font-bold tracking-tight px-1 py-0.5 rounded bg-black/40 shadow-sm border border-white/5" style={{ color: getGsaxColorValue(gsaxPct) }}>
                                    {formatGsax(gsaxTotal)}
                                </span>
                            )}
                        </div>
                        {goalieStats && (
                            <div className="mt-0.5 text-[9px] text-neutral-500 font-mono tracking-wide">
                                {goalieStats}
                            </div>
                        )}
                        <VsOppStatsDisplay statsStr={vsOppStats} oppTriCode={opponentTriCode || ''} align="left" />
                    </div>
                </div>

                {/* Main Stats (xG) */}
                <div className={`flex flex-col ${alignClass} ${isSocial ? 'mb-0.5' : 'mb-4'} items-center`}>
                    <div className="flex items-baseline gap-2">
                        <span className={`${isSocial ? 'text-2xl' : 'text-4xl md:text-5xl'} font-black text-white tracking-tighter tabular-nums text-glow-blue`}>
                            <AnimatedNumber value={xg} toFixed={2} />
                        </span>
                        <span className="text-xs font-mono text-gray-500 font-bold uppercase">xG</span>
                        {/* Info Icon for Explanation: Hide in Social */}
                        {!isSocial && (isHome ?
                            <ExplanationPopover items={prediction.home_xg_explained} align="right" placement="top" /> :
                            <ExplanationPopover items={prediction.away_xg_explained} align="left" placement="top" />
                        )}
                    </div>
                </div>

                {/* Secondary Badges Row (Aligned immediately under xG) */}
                <div className={`flex flex-wrap gap-2 justify-center md:justify-start ${isSocial ? 'mb-0.5' : 'mb-4'}`}>
                    {ppRank && ppRank <= 5 && <Badge color="blue" size={isSocial ? "xs" : "sm"}>#{ppRank} PP</Badge>}
                    {ppRank && ppRank >= 28 && <Badge color="red" size={isSocial ? "xs" : "sm"}>#{ppRank} PP</Badge>}
                    {pkRank && pkRank <= 5 && <Badge color="blue" size={isSocial ? "xs" : "sm"}>#{pkRank} PK</Badge>}
                    {pkRank && pkRank >= 28 && <Badge color="red" size={isSocial ? "xs" : "sm"}>#{pkRank} PK</Badge>}
                    {l7 && <Badge color="gray">{l7} (L7)</Badge>}

                    {/* Edge Badges */}
                    {!isSocial && (
                        <>
                            {avgSpeed && avgSpeed > 0 && <EdgeBadge label="Speed" value={avgSpeed} color={avgSpeed > 9.0 ? 'green' : 'blue'} suffix=" mph" />}
                            {rrRate && rrRate > 0.5 && <EdgeBadge label="RR" value={rrRate * 100} color="green" suffix="%" />}
                        </>
                    )}

                    {/* Edge Badges */}
                    {!isSocial && (
                        <>
                            {/* Only show significant stats (e.g. speed > 9.0) */}
                            {isHome ? (
                                <>
                                    {prediction.home_avg_speed && prediction.home_avg_speed > 0 && <EdgeBadge label="Speed" value={prediction.home_avg_speed} color={prediction.home_avg_speed > 9.0 ? 'green' : 'blue'} suffix=" mph" />}
                                    {prediction.home_rr_rate && prediction.home_rr_rate > 0.5 && <EdgeBadge label="RR" value={prediction.home_rr_rate * 100} color="green" suffix="%" />}
                                </>
                            ) : (
                                <>
                                    {prediction.away_avg_speed && prediction.away_avg_speed > 0 && <EdgeBadge label="Speed" value={prediction.away_avg_speed} color={prediction.away_avg_speed > 9.0 ? 'green' : 'blue'} suffix=" mph" />}
                                    {prediction.away_rr_rate && prediction.away_rr_rate > 0.5 && <EdgeBadge label="RR" value={prediction.away_rr_rate * 100} color="green" suffix="%" />}
                                </>
                            )}
                        </>
                    )}

                    {!isSocial && <GasGauge gas={gas} breakdown={gasBreakdown} align={isHome ? 'left' : 'right'} />}
                </div>

                {/* Wager Callout (Pushed to bottom) */}
                {(evBadge || wager) && (
                    <div className={`mt-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-full transition-all text-xs font-bold ${getPillColors(wager, odds)} ${isHighEv && !isSocial ? 'animate-pulse-glow' : ''} ${isSocial ? 'scale-90 origin-right' : ''}`}>
                        {evBadge && <span>EV: {evBadge}</span>}
                        {wager && <span className={`opacity-90 border-l pl-2 ${wager && wager.includes('u') && parseFloat(wager) < 0.3 && odds && (typeof odds === 'string' ? parseInt(odds) : odds) <= 110 ? 'border-neutral-600' : 'border-neon-green/30'}`}>{wager}</span>}
                    </div>
                )}
            </div>
        );
    };

    const isHighEv = ((homeEv || 0) > 0.05) || ((awayEv || 0) > 0.05);

    if (isUltraCompact) {
        return (
            <div className={`w-[377px] h-[162px] bg-[#020617] rounded-2xl border ${getUltraCompactGlow(homeWager, awayWager)} relative overflow-hidden flex flex-col p-2 text-white font-sans select-none tracking-tight`}>
                {/* Sharp Corner Logos - Round 3: Small, 100% opacity, no blur */}
                <div className="absolute top-1 left-1 w-9 h-9 z-0">
                    <LogoDisplay src={awayTeam.logoUrl} alt={awayTeam.name} triCode={awayTeam.triCode} className="w-full h-full object-contain" primaryColor={awayTeam.color1} />
                </div>
                <div className="absolute top-1 right-1 w-9 h-9 z-0">
                    <LogoDisplay src={homeTeam.logoUrl} alt={homeTeam.name} triCode={homeTeam.triCode} className="w-full h-full object-contain" primaryColor={homeTeam.color1} />
                </div>

                {/* Top Row: xG and Time - Adjusted for corner logos */}
                <div className="relative z-10 flex justify-between items-start mb-0.5 px-10">
                    <div className="flex flex-col">
                        <div className="flex items-baseline gap-1">
                            <span className="text-3xl font-black tabular-nums text-glow-blue leading-none">
                                {awayXg.toFixed(2)}
                            </span>
                            <span className="text-[8px] font-bold text-neutral-500 uppercase">xG</span>
                        </div>
                    </div>

                    <div className="flex flex-col items-center">
                        <span className="text-[10px] font-mono text-neutral-400 font-bold uppercase tracking-widest leading-none mt-1">
                            {formatTime(startTime || '')}
                        </span>
                    </div>

                    <div className="flex flex-col items-end">
                        <div className="flex items-baseline gap-1">
                            <span className="text-[8px] font-bold text-neutral-500 uppercase">xG</span>
                            <span className="text-3xl font-black tabular-nums text-glow-blue leading-none">
                                {homeXg.toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Goalie Row - Expanded for Season + vs Opp stats */}
                <div className="relative z-10 flex justify-between items-start mb-0.5 px-1">
                    {/* Away Goalie */}
                    <div className="flex flex-col max-w-[48%]">
                        <div className="flex items-center gap-1 overflow-hidden">
                            <span className={`text-[11px] font-bold uppercase truncate whitespace-nowrap ${awayStarter?.includes('Confirmed') ? 'text-neon-green' : awayStarter?.includes('Likely') ? 'text-yellow-400' : 'text-neutral-400'}`}>
                                {formatGoalieName(cleanStarterName(awayStarter))}
                            </span>
                            {prediction.away_gsax_total !== undefined && (
                                <span className="text-[9px] font-mono font-bold" style={{ color: getGsaxColorValue(prediction.away_gsax_pct || 50) }}>
                                    {formatGsax(prediction.away_gsax_total)}
                                </span>
                            )}
                        </div>
                        <div className="flex flex-col leading-tight">
                            <div className="text-[8.5px] font-mono text-neutral-400">
                                {prediction.away_goalie_stats}
                            </div>
                            <div className="transform scale-[0.85] origin-left mt-0.5">
                                <VsOppStatsDisplay statsStr={prediction.awayGoalieVsOpp} oppTriCode={homeTeam.triCode} align="left" />
                            </div>
                        </div>
                    </div>

                    {/* Home Goalie */}
                    <div className="flex flex-col items-end text-right max-w-[48%]">
                        <div className="flex items-center gap-1 overflow-hidden justify-end">
                            {prediction.home_gsax_total !== undefined && (
                                <span className="text-[9px] font-mono font-bold" style={{ color: getGsaxColorValue(prediction.home_gsax_pct || 50) }}>
                                    {formatGsax(prediction.home_gsax_total)}
                                </span>
                            )}
                            <span className={`text-[11px] font-bold uppercase truncate whitespace-nowrap ${homeStarter?.includes('Confirmed') ? 'text-neon-green' : homeStarter?.includes('Likely') ? 'text-yellow-400' : 'text-neutral-400'}`}>
                                {formatGoalieName(cleanStarterName(homeStarter))}
                            </span>
                        </div>
                        <div className="flex flex-col items-end leading-tight">
                            <div className="text-[8.5px] font-mono text-neutral-400">
                                {prediction.home_goalie_stats}
                            </div>
                            <div className="transform scale-[0.85] origin-right mt-0.5">
                                <VsOppStatsDisplay statsStr={prediction.homeGoalieVsOpp} oppTriCode={awayTeam.triCode} align="right" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Spacer to push bars down */}
                <div className="flex-1"></div>

                {/* Win Prob Bar - Slide down to hug odds */}
                <div className="relative z-10 flex flex-col gap-1 mb-1 px-1">
                    <div className="w-full h-5 bg-neutral-900/50 rounded-md overflow-hidden flex relative border border-white/5 shadow-inner">
                        <div
                            className="h-full transition-all duration-1000 ease-out flex items-center justify-start pl-2"
                            style={{
                                width: `${awayModelWinPct}%`,
                                backgroundColor: awayBarColor
                            }}
                        >
                            <span className={`text-[10px] font-black ${getContrastTextClass(awayBarColor)} leading-none`}>
                                {Math.round(awayModelWinPct)}%
                            </span>
                        </div>
                        <div className="absolute left-1/2 -translate-x-1/2 h-full w-px bg-white/20 z-20"></div>
                        <div
                            className="h-full flex-1 transition-all duration-1000 ease-out flex items-center justify-end pr-2"
                            style={{
                                backgroundColor: homeBarColor
                            }}
                        >
                            <span className={`text-[10px] font-black ${getContrastTextClass(homeBarColor)} leading-none`}>
                                {Math.round(homeModelWinPct)}%
                            </span>
                        </div>
                    </div>
                </div>

                {/* Odds / EV Bottom Row - Fixed Width Grid Aligned */}
                <div className="relative z-10 flex justify-between items-end pb-1.5 px-2">
                    {/* Away Side (Left) */}
                    <div className="flex flex-col gap-1 w-[48%]">
                        {/* Headers Grid - Fixed widths */}
                        <div className="grid grid-cols-[45px_45px] gap-2 text-[7px] font-black uppercase">
                            <span className="text-blue-400">xOdds</span>
                            <span className="text-neutral-600">Odds</span>
                        </div>
                        {/* Values + Pill Row */}
                        <div className="flex items-center gap-2">
                            <div className="grid grid-cols-[45px_45px] gap-2 items-baseline">
                                <span className="text-[14px] font-black text-blue-400">{formatOdds(awayModelOdds)}</span>
                                <span className="text-[11px] font-mono text-neutral-500">{formatOdds(awayVegasOdds)}</span>
                            </div>
                            {awayWager && (
                                <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-black ${getPillColors(awayWager, awayVegasOdds)} shadow-sm whitespace-nowrap`}>
                                    <span>+{Math.round(awayEv || 0)}%</span>
                                    <span>{awayWager}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Home Side (Right) */}
                    <div className="flex flex-col gap-1 items-end w-[48%]">
                        {/* Headers Grid - Fixed widths */}
                        <div className="grid grid-cols-[45px_45px] gap-2 text-[7px] font-black uppercase">
                            <span className="text-blue-400">xOdds</span>
                            <span className="text-neutral-600">Odds</span>
                        </div>
                        {/* Values + Pill Row - Right Aligned with Row Reverse */}
                        <div className="flex flex-row-reverse items-center gap-2 w-full">
                            <div className="grid grid-cols-[45px_45px] gap-2 items-baseline text-right">
                                <span className="text-[14px] font-black text-blue-400">{formatOdds(homeModelOdds)}</span>
                                <span className="text-[11px] font-mono text-neutral-500">{formatOdds(homeVegasOdds)}</span>
                            </div>
                            {homeWager && (
                                <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-black ${getPillColors(homeWager, homeVegasOdds)} shadow-sm whitespace-nowrap`}>
                                    <span>+{Math.round(homeEv || 0)}%</span>
                                    <span>{homeWager}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
            <div
                className={`hidden md:flex relative flex-col w-full max-w-4xl mx-auto rounded-3xl ${isSocial ? 'mb-0' : 'mb-6'} transition-all duration-300 border backdrop-blur-xl group ${!isSocial && 'hover:shadow-[0_0_30px_rgba(0,243,255,0.15)] cursor-pointer'} ${getGlowColor(homeWager, awayWager)} ${isDesktopExpanded ? 'bg-white/[0.02]' : 'bg-transparent'}`}
                onClick={!isSocial ? toggleDesktopExpand : undefined}
                ref={desktopCardRef}
            >
                {/* ... (Background layers) ... */}
                <div className="absolute inset-0 bg-[#0a0a0a]/80 rounded-3xl -z-10" />
                {isHighEv && !isSocial && (
                    <div className="absolute inset-0 rounded-3xl border border-neon-green/50 animate-pulse pointer-events-none"></div>
                )}
                {/* Simplified Background for Social */}
                {isSocial ? (
                    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
                        {/* Static subtle gradients for Social */}
                        <div className="absolute -left-20 -top-20 w-96 h-96 bg-blue-500/5 rounded-full blur-[100px] opacity-20"></div>
                        <div className="absolute -right-20 -bottom-20 w-96 h-96 bg-purple-500/5 rounded-full blur-[100px] opacity-20"></div>
                    </div>
                ) : (
                    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
                        <div className="absolute -left-20 -top-20 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] opacity-20 group-hover:opacity-30 transition-opacity"></div>
                        <div className="absolute -right-20 -bottom-20 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] opacity-20 group-hover:opacity-30 transition-opacity"></div>
                    </div>
                )}

                <div className={`${isSocial ? 'p-2' : 'p-6'} flex flex-row items-stretch justify-between w-full relative z-10`}>

                    {/* AWAY TEAM (Left) */}
                    <div className="flex-1 min-w-0 relative z-20">
                        <TeamColumn
                            team={awayTeam}
                            isHome={false}
                            starter={awayStarter}
                            xg={awayXg}
                            ppRank={prediction.away_pp_rank}
                            pkRank={prediction.away_pk_rank}
                            l7={isSocial ? undefined : prediction.away_l7} // Hide L7 in social
                            ev={awayEv}
                            wager={awayWager}
                            gas={isSocial ? undefined : prediction.away_gas} // Hide gas in social
                            gasBreakdown={prediction.away_gas_breakdown}
                            gsaxTotal={prediction.away_gsax_total}
                            gsaxPct={prediction.away_gsax_pct}
                            goalieStats={prediction.away_goalie_stats}
                            vsOppStats={isSocial ? undefined : prediction.awayGoalieVsOpp} // Hide vsOpp in social
                            opponentTriCode={homeTeam.triCode}
                            odds={awayVegasOdds}
                            isSocial={isSocial}
                            avgSpeed={away_avg_speed}
                            rrRate={away_rr_rate}
                        />
                        <NewsIndicator
                            hasNews={prediction.away_news?.some(n => n.category !== 'Goalie Start') ?? false}
                            className="absolute bottom-2 left-2"
                        />
                    </div>

                    {/* CENTER INFO */}
                    <div className="flex flex-col items-center justify-center w-[30%] px-6 border-l border-r border-white/5 mx-4">
                        <div className="flex flex-col items-center mb-6">
                            <span className="text-xs font-mono text-neutral-400 tracking-[0.2em] mb-3">{formatTime(startTime || '')}</span>
                            <PlayoffLeverageBadge leverage={playoffLeverage} />
                            <div className="px-5 py-2 mt-2 rounded-full border border-neutral-700 bg-neutral-800/50 backdrop-blur-md min-w-[56px] text-center">
                                <span className="text-sm font-bold text-neutral-200 tracking-wider">TOTAL: {totalGoals.toFixed(1)}</span>
                            </div>
                        </div>

                        {/* Win Probability Bar */}
                        <div className="w-full flex justify-between text-[10px] font-bold text-neutral-500 tracking-widest mb-2 px-1">
                            <span>{Math.round(awayModelWinPct)}%</span>
                            <span>xOdds WIN %</span>
                            <span>{Math.round(homeModelWinPct)}%</span>
                        </div>
                        <div className="w-full h-3 bg-neutral-800 rounded-full overflow-hidden flex relative shadow-inner">
                            {/* Away Bar (Left) - Animated Width */}
                            <div
                                className="h-full shadow-[0_0_15px_rgba(255,b255,255,0.2)] z-10 transition-all duration-1000 ease-out flex justify-start items-center relative overflow-hidden"
                                style={{
                                    width: isMounted ? `${awayModelWinPct}%` : '50%',
                                    background: `linear-gradient(90deg, ${awayBarColor} 0%, ${awayBarColor}dd 100%)`,
                                    boxShadow: `0 0 15px ${awayBarColor}66`
                                }}
                            ></div>

                            {/* Center Separator - Moves with Layout */}
                            <div className="w-[2px] h-full bg-neutral-900/50 z-20"></div>

                            {/* Home Bar (Right) - Fills remaining space */}
                            <div
                                className="h-full flex-1 z-10 transition-all duration-1000 ease-out flex justify-end items-center relative overflow-hidden"
                                style={{
                                    background: `linear-gradient(90deg, ${homeBarColor}dd 0%, ${homeBarColor} 100%)`,
                                    boxShadow: `0 0 15px ${homeBarColor}66`
                                }}
                            ></div>
                        </div>

                        {/* Odds Comparison Box */}
                        <div className="flex flex-row justify-between w-full mt-6 px-2 gap-4">
                            {/* Away Odds */}
                            <div className="flex flex-col items-center flex-1">
                                <span className="text-[9px] text-neutral-500 font-bold tracking-widest mb-2">xOdds</span>
                                <span className="text-base font-bold text-white mb-1">{formatOdds(awayModelOdds)}</span>
                                <span className="text-[9px] text-neutral-500 font-bold tracking-widest mb-1 mt-1">Odds</span>
                                <span className="text-xs font-mono text-neutral-400">{formatOdds(awayVegasOdds)}</span>
                            </div>
                            {/* Divider */}
                            <div className="w-px bg-neutral-800 h-12 self-center"></div>
                            {/* Home Odds */}
                            <div className="flex flex-col items-center flex-1">
                                <span className="text-[9px] text-neutral-500 font-bold tracking-widest mb-2">xOdds</span>
                                <span className="text-base font-bold text-white mb-1">{formatOdds(homeModelOdds)}</span>
                                <span className="text-[9px] text-neutral-500 font-bold tracking-widest mb-1 mt-1">Odds</span>
                                <span className="text-xs font-mono text-neutral-400">{formatOdds(homeVegasOdds)}</span>
                            </div>
                        </div>
                    </div>

                    {/* HOME TEAM (Right) */}
                    <div className="flex-1 min-w-0 relative z-20">
                        <TeamColumn
                            team={homeTeam}
                            isHome={true}
                            starter={homeStarter}
                            xg={homeXg}
                            ppRank={prediction.home_pp_rank}
                            pkRank={prediction.home_pk_rank}
                            l7={isSocial ? undefined : prediction.home_l7}
                            ev={homeEv}
                            wager={homeWager}
                            gas={isSocial ? undefined : prediction.home_gas}
                            gasBreakdown={prediction.home_gas_breakdown}
                            gsaxTotal={prediction.home_gsax_total}
                            gsaxPct={prediction.home_gsax_pct}
                            goalieStats={prediction.home_goalie_stats}
                            vsOppStats={isSocial ? undefined : prediction.homeGoalieVsOpp}
                            opponentTriCode={awayTeam.triCode}
                            odds={homeVegasOdds}
                            isSocial={isSocial}
                            avgSpeed={home_avg_speed}
                            rrRate={home_rr_rate}
                        />
                        <NewsIndicator
                            hasNews={prediction.home_news?.some(n => n.category !== 'Goalie Start') ?? false}
                            className="absolute bottom-2 right-2"
                        />
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


            </div >

            {/* ========================================= */}
            {/* MOBILE VIEW (md:hidden) - Condensed + Expand */}
            {/* ========================================= */}
            <div
                className={`flex md:hidden relative flex-col w-full mx-auto mb-1 text-white transition-all duration-300 rounded-[2.5rem] ${getGlowColor(homeWager, awayWager)}`}
                onClick={toggleExpand}
                ref={cardRef}
            >
                {/* Background Mask (Inner) - Handles Order/Border/Radius */}
                <div className="absolute inset-0 overflow-hidden rounded-[2.5rem] border border-white/10 -z-10 pointer-events-none backdrop-blur-xl">
                    <div className="absolute inset-0 bg-[#0a0a0a]/90" />

                    {/* ABSOLUTE BACKGROUND LOGOS - Moved INSIDE mask to clip correctly */}
                    {/* Left: Away Logo (Oversized & Clipped) */}
                    <div className="absolute left-[-2rem] top-14 -translate-y-1/2 w-48 h-48 opacity-40 filter drop-shadow-[0_0_15px_rgba(0,0,0,0.5)] z-0 pointer-events-none">
                        <LogoDisplay
                            src={awayTeam.logoUrl}
                            alt={awayTeam.name}
                            triCode={awayTeam.triCode}
                            className="w-full h-full scale-110 object-contain"
                            primaryColor={awayTeam.color1}
                            variant="animated"
                        />
                    </div>
                    {/* Right: Home Logo (Oversized & Clipped) */}
                    <div className="absolute right-[-2rem] top-14 -translate-y-1/2 w-48 h-48 opacity-40 filter drop-shadow-[0_0_15px_rgba(0,0,0,0.5)] z-0 pointer-events-none">
                        <LogoDisplay
                            src={homeTeam.logoUrl}
                            alt={homeTeam.name}
                            triCode={homeTeam.triCode}
                            className="w-full h-full scale-110 object-contain"
                            primaryColor={homeTeam.color1}
                            variant="animated"
                        />
                    </div>
                </div>

                {/* --- SUPER CONDENSED HEADER ROW --- */}
                {/* --- SUPER CONDENSED HEADER ROW --- */}
                <div className="flex flex-row items-center justify-center relative select-none cursor-pointer active:bg-white/5 transition-colors h-28 overflow-visible px-2">

                    {/* Mobile Away News Indicator - Hoisted */}
                    <NewsIndicator
                        hasNews={prediction.away_news?.some(n => n.category !== 'Goalie Start') ?? false}
                        className="absolute bottom-3 left-7 md:hidden z-20"
                    />

                    {/* Mobile Home News Indicator - Hoisted */}
                    <NewsIndicator
                        hasNews={prediction.home_news?.some(n => n.category !== 'Goalie Start') ?? false}
                        className="absolute bottom-3 right-7 md:hidden z-20"
                    />

                    {/* CENTRAL CONTENT CONTAINER (Relative z-10) - Compact & Aligned */}
                    <div className="flex flex-row items-center justify-center w-[95%] gap-2 z-10 relative bg-black/40 backdrop-blur-sm rounded-2xl py-1 px-1 border border-white/5 shadow-xl">

                        {/* LEFT DATA (Away xG/Wager) */}
                        <div className="flex flex-col items-end justify-center w-[36%] gap-1 relative z-20">
                            {/* Top: xG - Inline Layout */}
                            <div className="flex flex-row items-center gap-1.5 relative">
                                <span className="text-3xl font-black tracking-tighter drop-shadow-[0_0_10px_rgba(0,243,255,0.6)] leading-none text-white">
                                    <AnimatedNumber value={awayXg} toFixed={2} />
                                </span>
                                <div className="flex flex-col items-center leading-none -mt-1">
                                    <ExplanationPopover items={prediction.away_xg_explained} align="left" transparentTrigger={true} />
                                    <span className="text-[10px] font-mono text-neutral-400 font-bold uppercase tracking-wider -mt-0.5">xG</span>
                                </div>
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
                            {/* Bar - Taller (h-5) & Animated */}
                            <div className="w-full h-5 bg-neutral-800/80 rounded-sm overflow-hidden flex relative shadow-inner border border-white/5">
                                {/* Away Bar (Left) - Animated Width */}
                                <div
                                    className="h-full shadow-[0_0_10px_rgba(255,255,255,0.2)] flex items-center justify-start pl-1 z-10 transition-all duration-1000 ease-out overflow-hidden whitespace-nowrap"
                                    style={{
                                        width: isMounted ? `${awayModelWinPct}%` : '50%',
                                        background: `linear-gradient(90deg, ${awayBarColor} 0%, ${awayBarColor}dd 100%)`,
                                        boxShadow: `0 0 10px ${awayBarColor}66`
                                    }}
                                >
                                    <span className={`text-[9px] font-bold drop-shadow-md whitespace-nowrap pl-1 ${getContrastTextClass(awayBarColor)}`}>{Math.round(awayModelWinPct)}%</span>
                                </div>

                                {/* Center Separator */}
                                <div className="w-[2px] h-full bg-neutral-900/50 z-20"></div>

                                {/* Home Bar (Right) - Fills remaining space */}
                                <div
                                    className="h-full flex-1 flex items-center justify-end pr-1 z-10 transition-all duration-1000 ease-out overflow-hidden whitespace-nowrap"
                                    style={{
                                        background: `linear-gradient(90deg, ${homeBarColor}dd 0%, ${homeBarColor} 100%)`,
                                        boxShadow: `0 0 10px ${homeBarColor}66`
                                    }}
                                >
                                    <span className={`text-[9px] font-bold drop-shadow-md whitespace-nowrap pr-1 ${getContrastTextClass(homeBarColor)}`}>{Math.round(homeModelWinPct)}%</span>
                                </div>
                            </div>
                        </div>

                        {/* RIGHT DATA (Home xG/Wager) */}
                        <div className="flex flex-col items-start justify-center w-[36%] gap-1 relative z-20">
                            {/* Top: xG - Inline Layout */}
                            <div className="flex flex-row items-center gap-1.5 relative">
                                <span className="text-3xl font-black tracking-tighter drop-shadow-[0_0_10px_rgba(0,243,255,0.6)] leading-none text-white order-last">
                                    <AnimatedNumber value={homeXg} toFixed={2} />
                                </span>
                                <div className="flex flex-col items-center leading-none -mt-1">
                                    <ExplanationPopover items={prediction.home_xg_explained} align="right" transparentTrigger={true} />
                                    <span className="text-[10px] font-mono text-neutral-400 font-bold uppercase tracking-wider -mt-0.5">xG</span>
                                </div>
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
                    <div className="p-4">
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
                                    <span className="text-neutral-500">xOdds</span>
                                    <span className="font-bold">{formatOdds(awayModelOdds)}</span>
                                </div>
                                <div className="flex justify-between text-[10px]">
                                    <span className="text-neutral-500">Odds</span>
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
                                    <span className="text-neutral-500">xOdds</span>
                                    <span className="font-bold">{formatOdds(homeModelOdds)}</span>
                                </div>
                                <div className="flex justify-between text-[10px]">
                                    <span className="text-neutral-500">Odds</span>
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
