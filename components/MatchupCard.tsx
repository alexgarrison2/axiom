import React, { useState } from 'react';
import { GamePrediction } from '@/utils/data';
import Image from 'next/image';

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
    } = prediction;

    // --- Helpers ---
    const formatPct = (n: number) => n.toFixed(1) + '%';
    const formatXg = (n: number) => n.toFixed(2);
    const formatEv = (n: number) => `+${Math.round(n)}%`;
    const formatOdds = (odds: string) => {
        if (!odds || odds === 'N/A') return null;
        if (odds.startsWith('+') || odds.startsWith('-')) return odds;
        return `+${odds}`;
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
        wager
    }: {
        team: any,
        isHome: boolean,
        starter: string,
        xg: number,
        ppRank?: number,
        pkRank?: number,
        l7?: string,
        ev: number | null,
        wager: string | null
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
                    <div className="relative w-16 h-16 md:w-20 md:h-20 drop-shadow-lg">
                        <Image src={team.logoUrl} alt={team.name} fill className="object-contain" />
                    </div>
                    <div className={`flex flex-col ${alignClass} items-center min-w-0 max-w-full justify-center gap-1`}>
                        <span className="text-[10px] md:text-xs text-gray-400 font-bold uppercase tracking-wide truncate max-w-full">{starterName}</span>
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
                            {formatXg(xg)}
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

    // --- State for Mobile Expansion ---
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <>
            {/* ========================================= */}
            {/* DESKTOP VIEW (md:flex) - The Original Card */}
            {/* ========================================= */}
            <div className={`hidden md:flex relative flex-col w-full max-w-4xl mx-auto rounded-3xl p-6 mb-6 transition-all duration-300 border backdrop-blur-xl group hover:shadow-[0_0_30px_rgba(0,243,255,0.15)] ${getGlowColor(homeWager, awayWager)}`}>

                {/* Background Glass Layer */}
                <div className="absolute inset-0 bg-[#0a0a0a]/80 rounded-3xl -z-10" />

                {/* High EV Border Pulse */}
                {isHighEv && (
                    <div className="absolute inset-0 rounded-3xl border border-neon-green/50 animate-pulse pointer-events-none"></div>
                )}

                {/* Decorative Background Gradients */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    <div className="absolute -left-20 -top-20 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] opacity-20 group-hover:opacity-30 transition-opacity"></div>
                    <div className="absolute -right-20 -bottom-20 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] opacity-20 group-hover:opacity-30 transition-opacity"></div>
                </div>

                <div className="flex flex-row items-stretch justify-between w-full relative z-10">

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
                        />
                    </div>
                </div>
            </div>


            {/* ========================================= */}
            {/* MOBILE VIEW (md:hidden) - Condensed + Expand */}
            {/* ========================================= */}
            <div
                className={`flex md:hidden flex-col w-full mx-auto rounded-3xl mb-1 text-white overflow-hidden transition-all duration-300 border backdrop-blur-xl ${getGlowColor(homeWager, awayWager)}`}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {/* Background Glass */}
                <div className="absolute inset-0 bg-[#0a0a0a]/90 -z-10" />

                {/* --- SUPER CONDENSED HEADER ROW --- */}
                <div className="flex flex-row items-center justify-between px-2 py-3 h-32 relative select-none cursor-pointer active:bg-white/5 transition-colors">

                    {/* LEFT: Away Team (Logo + xG/Wager) */}
                    <div className="flex items-start justify-between w-[35%] h-full pl-1">
                        {/* Logo Container - Bigger */}
                        <div className="relative w-20 h-20 shrink-0 filter drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">
                            <Image src={awayTeam.logoUrl} alt={awayTeam.name} fill className="object-contain" />
                        </div>

                        {/* Data Column */}
                        <div className="flex flex-col items-end h-full justify-between py-1 min-w-[50px] relative z-10">
                            {/* Top: xG */}
                            <div className="flex flex-col items-end -mr-1">
                                <span className="text-4xl font-black tracking-tighter drop-shadow-[0_0_10px_rgba(0,243,255,0.6)] leading-none text-white">
                                    {awayXg.toFixed(2)}
                                </span>
                                <span className="text-[9px] font-mono text-neutral-400 font-bold uppercase tracking-wider">xG</span>
                            </div>

                            {/* Bottom: Wager Pill */}
                            {awayWager ? (
                                <div className="mt-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-neon-green/10 border border-neon-green/30 text-neon-green text-[10px] font-bold shadow-[0_0_10px_rgba(16,185,129,0.1)] -mr-2">
                                    <span>+{Math.round(awayEv || 0)}%</span>
                                    <span className="opacity-90 border-l border-neon-green/30 pl-1.5">{awayWager}</span>
                                </div>
                            ) : <div className="h-6"></div>}
                        </div>
                    </div>

                    {/* CENTER: Time + Bar (Simplified) */}
                    <div className="flex flex-col items-center justify-center w-[30%] gap-2 px-1">
                        <span className="text-[10px] font-mono text-neutral-400 tracking-wider whitespace-nowrap">{formatTime(startTime || '')}</span>
                        {/* Mini Bar Mobile - Bigger */}
                        <div className="w-full h-4 bg-neutral-800/80 rounded-full overflow-hidden flex shadow-inner border border-white/5">
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

                    {/* RIGHT: Home Team (Logo + xG/Wager) */}
                    <div className="flex flex-row-reverse items-start justify-between w-[35%] h-full pr-1">
                        {/* Logo Container - Bigger */}
                        <div className="relative w-20 h-20 shrink-0 filter drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">
                            <Image src={homeTeam.logoUrl} alt={homeTeam.name} fill className="object-contain" />
                        </div>

                        {/* Data Column */}
                        <div className="flex flex-col items-start h-full justify-between py-1 min-w-[50px] relative z-10">
                            {/* Top: xG */}
                            <div className="flex flex-col items-start -ml-1">
                                <span className="text-4xl font-black tracking-tighter drop-shadow-[0_0_10px_rgba(0,243,255,0.6)] leading-none text-white">
                                    {homeXg.toFixed(2)}
                                </span>
                                <span className="text-[9px] font-mono text-neutral-400 font-bold uppercase tracking-wider">xG</span>
                            </div>

                            {/* Bottom: Wager Pill */}
                            {homeWager ? (
                                <div className="mt-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-neon-green/10 border border-neon-green/30 text-neon-green text-[10px] font-bold shadow-[0_0_10px_rgba(16,185,129,0.1)] -ml-2">
                                    <span>+{Math.round(homeEv || 0)}%</span>
                                    <span className="opacity-90 border-l border-neon-green/30 pl-1.5">{homeWager}</span>
                                </div>
                            ) : <div className="h-6"></div>}
                        </div>
                    </div>
                </div>

                {/* --- EXPANDED DETAILS BODY --- */}
                <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-[500px] opacity-100 border-t border-white/5' : 'max-h-0 opacity-0'}`}>
                    <div className="p-4 bg-black/20">
                        {/* Goalies Row */}
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex flex-col items-start w-[48%]">
                                <span className={`text-[10px] font-bold uppercase ${getGoalieStatusColor(awayStarter, prediction.id, 'away')}`}>
                                    {cleanStarterName(awayStarter)}
                                </span>
                                <span className="text-[9px] text-neutral-500 font-mono uppercase mt-0.5">
                                    {getGoalieStatusText(awayStarter, prediction.id, 'away')}
                                </span>
                            </div>
                            <div className="flex flex-col items-end w-[48%]">
                                <span className={`text-[10px] font-bold uppercase text-right ${getGoalieStatusColor(homeStarter, prediction.id, 'home')}`}>
                                    {cleanStarterName(homeStarter)}
                                </span>
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
                                <div className="flex flex-wrap gap-1.5">
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
                                <div className="flex flex-wrap gap-1.5">
                                    {prediction.home_pp_rank && prediction.home_pp_rank <= 5 && <Badge color="blue">#{prediction.home_pp_rank} PP</Badge>}
                                    {prediction.home_pp_rank && prediction.home_pp_rank >= 28 && <Badge color="red">#{prediction.home_pp_rank} PP</Badge>}
                                    {prediction.home_pk_rank && prediction.home_pk_rank <= 5 && <Badge color="blue">#{prediction.home_pk_rank} PK</Badge>}
                                    {prediction.home_pk_rank && prediction.home_pk_rank >= 28 && <Badge color="red">#{prediction.home_pk_rank} PK</Badge>}
                                    {prediction.home_l7 && <Badge color="gray">{prediction.home_l7}</Badge>}
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
            </div>
        </>
    );
};

export default MatchupCard;
