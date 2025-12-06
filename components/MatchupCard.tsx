import React from 'react';
import { GamePrediction } from '@/utils/data';

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
        date, // Make sure date is available if needed, though mostly unused here
    } = prediction;

    // Handle missing Vegas odds
    const finalHomeVegas = homeVegasWinPct || (awayVegasWinPct ? 100 - awayVegasWinPct : 50);
    const finalAwayVegas = awayVegasWinPct || (homeVegasWinPct ? 100 - homeVegasWinPct : 50);

    const formatPct = (n: number) => n.toFixed(1) + '%';
    const formatXg = (n: number) => n.toFixed(2);
    const formatEv = (n: number) => `+${Math.round(n)}%`;
    const formatOdds = (odds: string) => {
        if (!odds || odds === 'N/A') return null;
        if (odds.startsWith('+') || odds.startsWith('-')) return odds;
        return `+${odds}`;
    };

    const formatStarter = (starter: string, color: string) => {
        const isConfirmed = starter.toLowerCase().includes('confirmed');
        // Stronger, multi-layered glow for prominence
        return isConfirmed ? {
            textShadow: `0 0 10px ${color}, 0 0 20px ${color}, 0 0 40px ${color}`,
            color: '#fff',
            opacity: 1,
            fontWeight: 700
        } : {
            opacity: 0.8
        };
    };

    const getStarterName = (starter: string) => {
        return starter.replace(/\s*\(Confirmed\)/i, '');
    };

    const homeEvBadge = homeEv > 0 ? formatEv(homeEv) : null;
    const awayEvBadge = awayEv > 0 ? formatEv(awayEv) : null;

    const homeColor = homeTeam.color1 || '#000';
    const awayColor = awayTeam.color1 || '#000';

    // Width calculations
    const widthPercentage = Math.min(100, (totalGoals / maxTotalGoals) * 100);

    const isHighEv = ((homeEv || 0) >= 20) || ((awayEv || 0) >= 20);

    // Check if we have valid odds for the Vegas bar
    const hasVegasOdds = (homeVegasOdds && homeVegasOdds !== 'N/A') || (awayVegasOdds && awayVegasOdds !== 'N/A');

    return (
        <div className="glass-panel glass-panel-hover p-3 md:p-5 rounded-3xl relative overflow-hidden group/card w-full mx-auto max-w-7xl">

            {/* High EV Rotating Glow Border */}
            {isHighEv && (
                <div className="high-ev-border-mask">
                    <div className="high-ev-spinner"></div>
                </div>
            )}

            {/* Background Decor - Gradient specific to match */}
            <div className="absolute inset-0 z-0 opacity-20 bg-gradient-to-r from-transparent via-white/5 to-transparent pointer-events-none group-hover/card:opacity-30 transition-opacity duration-500"></div>

            <div className="flex flex-col md:grid md:grid-cols-[1fr_minmax(300px,400px)_1fr] gap-4 md:gap-6 items-center relative z-10">

                {/* LEFT: Away Team */}
                <div className="relative flex items-center justify-start md:justify-end h-full">
                    {/* Background Logo */}
                    <div className="absolute left-0 md:right-0 top-1/2 -translate-y-1/2 z-0 pointer-events-none -translate-x-12 md:translate-x-12 opacity-20 group-hover/card:opacity-40 group-hover/card:scale-110 transition-all duration-700">
                        <img
                            src={awayTeam.logoUrl}
                            alt={awayTeam.name}
                            className="h-48 w-48 object-contain grayscale-[0.5] contrast-125"
                        />
                    </div>

                    {/* Content */}
                    <div className="text-left md:text-right relative z-10 flex flex-col items-start md:items-end pr-0 pl-2 md:pl-0 md:pr-4">
                        {/* Wager/EV Badge */}
                        {(awayEvBadge || awayWager) && (
                            <div className="mb-2 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neon-green/10 border border-neon-green/50 text-neon-green text-xs font-bold shadow-[0_0_15px_rgba(10,255,0,0.2)] animate-pulse-glow">
                                {awayEvBadge && <span>EV: {awayEvBadge}</span>}
                                {awayWager && <span className="opacity-90 border-l border-neon-green/30 pl-2">{awayWager}</span>}
                            </div>
                        )}

                        {/* xG Display (Moved here to avoid overlap) */}
                        <div className="flex flex-col items-start md:items-end -mt-1 mb-1">
                            <span className="text-4xl font-black text-white tabular-nums tracking-tighter drop-shadow-2xl leading-none">{formatXg(awayXg)}</span>
                            <span className="text-[10px] text-gray-400 font-mono tracking-widest uppercase opacity-60 mr-1">Expected Goals</span>
                        </div>

                        <div className="font-hand text-xl text-gray-400 -rotate-3 mb-2 transition-all duration-500"
                            style={formatStarter(awayStarter, awayColor)}
                        >
                            {getStarterName(awayStarter)}
                        </div>
                    </div>
                </div>

                {/* CENTER: Visualization */}
                <div className="relative w-full flex flex-col items-center justify-center pt-10 pb-2 h-full min-h-[140px]">

                    {/* Center Reference Line */}
                    <div className="absolute top-0 bottom-0 w-[1px] bg-white/10 z-0"></div>

                    {/* Game Start Time */}
                    {startTime && (
                        <div className="absolute top-4 z-30">
                            <span className="text-[10px] font-mono font-bold text-gray-400 tracking-widest bg-black/40 px-2 py-0.5 rounded backdrop-blur-sm border border-white/5 uppercase">
                                {startTime} CT
                            </span>
                        </div>
                    )}

                    {/* Total Goals Floating Badge */}
                    <div className="absolute top-0 z-30 -translate-y-1/2">
                        <div className="bg-black/80 backdrop-blur-md text-white font-mono font-bold text-xs px-3 py-1 rounded-full border border-white/20 shadow-xl tracking-wider">
                            TOTAL: {totalGoals.toFixed(1)}
                        </div>
                    </div>

                    {/* VISUALIZATION CONTAINER */}
                    <div className="w-full flex flex-col gap-4 relative z-10 mt-2">

                        {/* ROW 1: MODEL WIN % */}
                        <div className="flex items-center justify-center h-14 w-full">

                            {/* Away Bar (Left) */}
                            <div className="relative flex items-center justify-end h-full flex-1 group/bar">
                                <div
                                    className="h-full rounded-l-lg border-r border-black/50 transition-all duration-700 ease-out relative overflow-hidden backdrop-blur-sm shadow-[0_0_20px_rgba(0,0,0,0.3)] w-[var(--mobile-width)] md:w-[var(--desktop-width)]"
                                    style={{
                                        ['--mobile-width' as string]: `${awayModelWinPct}%`,
                                        ['--desktop-width' as string]: `${(awayModelWinPct / 100) * widthPercentage}%`,
                                    }}
                                >
                                    <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent pointer-events-none"></div>
                                    <div className="absolute inset-0 bg-black/10 group-hover/bar:bg-transparent transition-colors duration-300"></div>
                                    <div className="absolute inset-0" style={{ backgroundColor: awayColor, boxShadow: `inset 0 0 20px rgba(0,0,0,0.2), 0 0 15px ${awayColor}40` }}></div>
                                </div>
                                <div className="absolute inset-0 flex items-center justify-start pointer-events-none pl-3 z-20">
                                    <div className="flex flex-col items-start leading-none drop-shadow-md">
                                        <span className="text-lg font-black text-white mb-0.5">{formatPct(awayModelWinPct)}</span>
                                        {awayModelOdds && <span className="text-[11px] font-mono text-white/90 font-bold bg-black/20 px-1.5 py-0.5 rounded">{formatOdds(awayModelOdds)}</span>}
                                    </div>
                                </div>
                            </div>

                            {/* Home Bar (Right) */}
                            <div className="relative flex items-center justify-start h-full flex-1 group/bar">
                                <div
                                    className="h-full rounded-r-lg border-l border-black/50 transition-all duration-700 ease-out relative overflow-hidden backdrop-blur-sm shadow-[0_0_20px_rgba(0,0,0,0.3)] w-[var(--mobile-width)] md:w-[var(--desktop-width)]"
                                    style={{
                                        ['--mobile-width' as string]: `${homeModelWinPct}%`,
                                        ['--desktop-width' as string]: `${(homeModelWinPct / 100) * widthPercentage}%`,
                                    }}
                                >
                                    <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent pointer-events-none"></div>
                                    <div className="absolute inset-0 bg-black/10 group-hover/bar:bg-transparent transition-colors duration-300"></div>
                                    <div className="absolute inset-0" style={{ backgroundColor: homeColor, boxShadow: `inset 0 0 20px rgba(0,0,0,0.2), 0 0 15px ${homeColor}40` }}></div>
                                </div>
                                <div className="absolute inset-0 flex items-center justify-end pointer-events-none pr-3 z-20">
                                    <div className="flex flex-col items-end leading-none drop-shadow-md">
                                        <span className="text-lg font-black text-white mb-0.5">{formatPct(homeModelWinPct)}</span>
                                        {homeModelOdds && <span className="text-[11px] font-mono text-white/90 font-bold bg-black/20 px-1.5 py-0.5 rounded">{formatOdds(homeModelOdds)}</span>}
                                    </div>
                                </div>
                            </div>

                        </div>

                        {/* ROW 2: VEGAS WIN % (More subtle) OR TBD */}
                        {!hasVegasOdds ? (
                            <div className="flex items-center justify-center h-8 w-full">
                                <div className="w-full h-full bg-white/5 rounded border border-white/10 flex items-center justify-center text-[10px] font-mono text-gray-500 tracking-widest uppercase">
                                    Odds TBD
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-8 w-full opacity-80 hover:opacity-100 transition-opacity">
                                {/* Away Vegas */}
                                <div className="flex items-center justify-end h-full flex-1">
                                    <div
                                        className="h-full rounded-l-sm bg-slate-800 border-r border-black/50 shadow-inner flex items-center justify-start pl-2"
                                        style={{ width: `${(finalAwayVegas / 100) * widthPercentage}%` }}
                                    >
                                        <div className="flex items-baseline gap-2 whitespace-nowrap overflow-hidden">
                                            {/* Prioritize odds if bar is small (< 40%) */}
                                            {(!awayVegasOdds || finalAwayVegas >= 40) && (
                                                <span className="text-xs font-mono text-gray-300">{finalAwayVegas.toFixed(0)}%</span>
                                            )}
                                            {awayVegasOdds && <span className="text-[10px] text-gray-500 font-mono font-bold">{formatOdds(awayVegasOdds)}</span>}
                                        </div>
                                    </div>
                                </div>
                                {/* Home Vegas */}
                                <div className="flex items-center justify-start h-full flex-1">
                                    <div
                                        className="h-full rounded-r-sm bg-slate-700 border-l border-black/50 shadow-inner flex items-center justify-end pr-2"
                                        style={{ width: `${(finalHomeVegas / 100) * widthPercentage}%` }}
                                    >
                                        <div className="flex items-baseline gap-2 flex-row-reverse whitespace-nowrap overflow-hidden">
                                            {(!homeVegasOdds || finalHomeVegas >= 40) && (
                                                <span className="text-xs font-mono text-gray-300">{finalHomeVegas.toFixed(0)}%</span>
                                            )}
                                            {homeVegasOdds && <span className="text-[10px] text-gray-500 font-mono font-bold">{formatOdds(homeVegasOdds)}</span>}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT: Home Team */}
                <div className="relative flex items-center justify-end md:justify-start h-full">
                    {/* Background Logo */}
                    <div className="absolute right-0 md:left-0 top-1/2 -translate-y-1/2 z-0 pointer-events-none translate-x-12 md:-translate-x-12 opacity-20 group-hover/card:opacity-40 group-hover/card:scale-110 transition-all duration-700">
                        <img
                            src={homeTeam.logoUrl}
                            alt={homeTeam.name}
                            className="h-48 w-48 object-contain grayscale-[0.5] contrast-125"
                        />
                    </div>

                    {/* Content */}
                    <div className="text-right md:text-left relative z-10 flex flex-col items-end md:items-start pl-0 pr-2 md:pl-4 md:pr-0">
                        {/* Wager/EV Badge */}
                        {(homeEvBadge || homeWager) && (
                            <div className="mb-2 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neon-green/10 border border-neon-green/50 text-neon-green text-xs font-bold shadow-[0_0_15px_rgba(10,255,0,0.2)] animate-pulse-glow">
                                {homeEvBadge && <span>EV: {homeEvBadge}</span>}
                                {homeWager && <span className="opacity-90 border-l border-neon-green/30 pl-2">{homeWager}</span>}
                            </div>
                        )}

                        {/* xG Display (Moved here to avoid overlap) */}
                        <div className="flex flex-col items-end md:items-start -mt-1 mb-1">
                            <span className="text-4xl font-black text-white tabular-nums tracking-tighter drop-shadow-2xl leading-none">{formatXg(homeXg)}</span>
                            <span className="text-[10px] text-gray-400 font-mono tracking-widest uppercase opacity-60 ml-1">Expected Goals</span>
                        </div>

                        <div className="font-hand text-xl text-gray-400 -rotate-3 mb-2 transition-all duration-500"
                            style={formatStarter(homeStarter, homeColor)}
                        >
                            {getStarterName(homeStarter)}
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default MatchupCard;
