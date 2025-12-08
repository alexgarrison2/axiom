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
        if (starter.toLowerCase().includes('confirmed')) return 'text-neon-green';
        if (starter.toLowerCase().includes('likely')) return 'text-yellow-400';
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
            return 'border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.2)]';
        }
        return 'border-white/10';
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
            <div className={`flex flex-col items-center py-4 relative z-10 w-full ${alignClass}`}>

                {/* Team Info Header */}
                <div className={`flex flex-col gap-1 mb-4 w-full ${isHome ? 'md:flex-row' : 'md:flex-row-reverse'} items-center md:items-start`}>
                    <div className="relative w-16 h-16 md:w-20 md:h-20 drop-shadow-lg">
                        <Image src={team.logoUrl} alt={team.name} fill className="object-contain" />
                    </div>
                    <div className={`flex flex-col ${alignClass} items-center min-w-0 max-w-full justify-center gap-1`}>
                        <span className="text-[10px] md:text-xs text-gray-400 font-bold uppercase tracking-wide truncate max-w-full">{starterName}</span>
                        {status && (
                            <span className={`text-[9px] md:text-[10px] font-mono uppercase tracking-wider ${(status.toUpperCase() === 'CONFIRMED' || status.toUpperCase().includes('CONFIRMED')) ? 'text-neon-green' :
                                    (status.toUpperCase() === 'LIKELY' || status.toUpperCase().includes('LIKELY')) ? 'text-yellow-400' : 'text-gray-500'
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

                {/* Wager Callout */}
                {(evBadge || wager) && (
                    <div className={`mb-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neon-green/10 border border-neon-green/30 text-neon-green text-xs font-bold shadow-[0_0_15px_rgba(10,255,0,0.1)] hover:shadow-[0_0_20px_rgba(10,255,0,0.3)] transition-all ${isHighEv ? 'animate-pulse-glow' : ''}`}>
                        {evBadge && <span>EV: {evBadge}</span>}
                        {wager && <span className="opacity-90 border-l border-neon-green/30 pl-2">{wager}</span>}
                    </div>
                )}

                {/* Secondary Badges Row */}
                <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                    {ppRank && ppRank <= 5 && <Badge color="blue">#{ppRank} PP</Badge>}
                    {ppRank && ppRank >= 28 && <Badge color="red">#{ppRank} PP</Badge>}
                    {pkRank && pkRank <= 5 && <Badge color="blue">#{pkRank} PK</Badge>}
                    {pkRank && pkRank >= 28 && <Badge color="red">#{pkRank} PK</Badge>}
                    {l7 && <Badge color="gray">{l7} (L7)</Badge>}
                </div>

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

                <div className="flex flex-row items-center justify-between w-full relative z-10">

                    {/* AWAY TEAM (Left) */}
                    <div className="w-1/3">
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

                    {/* CENTER INFO (Time, Total, Bar) */}
                    <div className="flex flex-col items-center justify-center w-1/3 px-4">
                        <div className="flex flex-col items-center mb-6">
                            <span className="text-xs font-mono text-neutral-400 tracking-[0.2em] mb-3">{formatTime(startTime || '')}</span>
                            <div className="px-5 py-2 rounded-full border border-neutral-700 bg-neutral-800/50 backdrop-blur-md min-w-[56px] text-center">
                                <span className="text-sm font-bold text-neutral-200 tracking-wider">TOTAL: {totalGoals.toFixed(1)}</span>
                            </div>
                        </div>

                        {/* Win Probability Bar */}
                        <div className="w-full flex justify-between text-[10px] font-bold text-neutral-500 tracking-widest mb-2 px-1">
                            <span>{Math.round(awayModelWinPct * 100)}%</span>
                            <span>MODEL WIN %</span>
                            <span>{Math.round(homeModelWinPct * 100)}%</span>
                        </div>
                        <div className="w-full h-3 bg-neutral-800 rounded-full overflow-hidden flex relative shadow-inner">
                            <div className="h-full bg-gradient-to-r from-blue-900 to-blue-600 shadow-[0_0_10px_rgba(37,99,235,0.4)]" style={{ width: `${awayModelWinPct * 100}%` }}></div>
                            <div className="h-full bg-neutral-700/30 flex-1"></div>
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
                    <div className="w-1/3">
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
                className={`flex md:hidden flex-col w-full mx-auto rounded-3xl mb-4 text-white overflow-hidden transition-all duration-300 border backdrop-blur-xl ${getGlowColor(homeWager, awayWager)}`}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {/* Background Glass */}
                <div className="absolute inset-0 bg-[#0a0a0a]/90 -z-10" />

                {/* --- SUPER CONDENSED HEADER ROW --- */}
                <div className="flex flex-row items-center justify-between p-4 h-24 relative select-none cursor-pointer active:bg-white/5 transition-colors">

                    {/* LEFT: Away Team (Logo + xG/Wager) */}
                    <div className="flex items-center gap-3 w-[42%]">
                        {/* Logo */}
                        <div className="relative w-16 h-16 shrink-0 filter drop-shadow-[0_0_5px_rgba(255,255,255,0.15)]">
                            <Image src={awayTeam.logoUrl} alt={awayTeam.name} fill className="object-contain" />
                        </div>
                        {/* Data */}
                        <div className="flex flex-col items-start gap-1">
                            <span className="text-3xl font-black tracking-tighter drop-shadow-[0_0_8px_rgba(0,243,255,0.5)] leading-none">
                                {awayXg.toFixed(2)}
                            </span>
                            {awayWager && (
                                <div className="flex flex-col items-start px-1.5 py-0.5 rounded bg-emerald-900/40 border border-emerald-500/40">
                                    <span className="text-[9px] font-bold text-emerald-400 leading-none">EV+{Math.round(awayEv || 0)}%</span>
                                    <span className="text-[9px] font-bold text-emerald-200 leading-none">{awayWager}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* CENTER: Time + Bar (Simplified) */}
                    <div className="flex flex-col items-center justify-center w-[16%]">
                        <span className="text-[9px] font-mono text-neutral-500 tracking-wider mb-1 whitespace-nowrap">{formatTime(startTime || '')}</span>
                        {/* Mini Bar */}
                        <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden flex">
                            <div className="h-full bg-blue-600" style={{ width: `${awayModelWinPct * 100}%` }}></div>
                        </div>
                    </div>

                    {/* RIGHT: Home Team (Logo + xG/Wager) */}
                    <div className="flex flex-row-reverse items-center gap-3 w-[42%]">
                        {/* Logo */}
                        <div className="relative w-16 h-16 shrink-0 filter drop-shadow-[0_0_5px_rgba(255,255,255,0.15)]">
                            <Image src={homeTeam.logoUrl} alt={homeTeam.name} fill className="object-contain" />
                        </div>
                        {/* Data */}
                        <div className="flex flex-col items-end gap-1">
                            <span className="text-3xl font-black tracking-tighter drop-shadow-[0_0_8px_rgba(0,243,255,0.5)] leading-none">
                                {homeXg.toFixed(2)}
                            </span>
                            {homeWager && (
                                <div className="flex flex-col items-end px-1.5 py-0.5 rounded bg-red-900/40 border border-red-500/40">
                                    <span className="text-[9px] font-bold text-red-400 leading-none">EV+{Math.round(homeEv || 0)}%</span>
                                    <span className="text-[9px] font-bold text-red-200 leading-none">{homeWager}</span>
                                </div>
                            )}
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
                                    {awayStarter}
                                </span>
                                <span className="text-[9px] text-neutral-500 font-mono uppercase">
                                    {getGoalieStatusText(awayStarter, prediction.id, 'away')}
                                </span>
                            </div>
                            <div className="flex flex-col items-end w-[48%]">
                                <span className={`text-[10px] font-bold uppercase text-right ${getGoalieStatusColor(homeStarter, prediction.id, 'home')}`}>
                                    {homeStarter}
                                </span>
                                <span className="text-[9px] text-neutral-500 font-mono uppercase text-right">
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
                                <div className="flex justify-between items-center">
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${getRankColor(prediction.away_pk_rank)}`}>#{prediction.away_pk_rank} PK</span>
                                    <span className="text-[9px] font-mono text-neutral-400">{prediction.away_l7} (L7)</span>
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
                                <div className="flex justify-between items-center">
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${getRankColor(prediction.home_pp_rank)}`}>#{prediction.home_pp_rank} PP</span>
                                    <span className="text-[9px] font-mono text-neutral-400">{prediction.home_l7} (L7)</span>
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
