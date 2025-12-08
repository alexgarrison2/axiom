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
    } = prediction;

    const formatPct = (n: number) => n.toFixed(1) + '%';
    const formatXg = (n: number) => n.toFixed(2);
    const formatEv = (n: number) => `+${Math.round(n)}%`;
    const formatOdds = (odds: string) => {
        if (!odds || odds === 'N/A') return null;
        if (odds.startsWith('+') || odds.startsWith('-')) return odds;
        return `+${odds}`;
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
        // Extract status from parentheses, e.g. "Name (Confirmed)" or "Name (Likely)"
        const statusMatch = starter.match(/\((.*?)\)$/);
        const status = statusMatch ? statusMatch[1] : null;
        const starterName = starter.replace(/\s*\(.*?\)$/, '');

        return (
            <div className={`flex flex-col items-center py-4 relative z-10 w-full ${alignClass}`}>

                {/* Team Info Header */}
                <div className={`flex flex-col gap-1 mb-4 w-full ${isHome ? 'md:flex-row' : 'md:flex-row-reverse'} items-center md:items-start`}>
                    <img
                        src={team.logoUrl}
                        alt={team.name}
                        className="w-16 h-16 md:w-20 md:h-20 object-contain drop-shadow-lg"
                    />
                    <div className={`flex flex-col ${alignClass} items-center min-w-0 max-w-full justify-center gap-1`}>
                        <span className="text-[10px] md:text-xs text-gray-400 font-bold uppercase tracking-wide truncate max-w-full">{starterName}</span>
                        {status && (
                            <span className={`text-[9px] md:text-[10px] font-mono uppercase tracking-wider ${status.toUpperCase() === 'CONFIRMED' ? 'text-neon-green' :
                                status.toUpperCase() === 'LIKELY' ? 'text-yellow-400' : 'text-gray-500'
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

    return (
        <div className="glass-premium rounded-3xl relative overflow-hidden group/card w-full mx-auto max-w-7xl hover:border-white/20 transition-all duration-300">

            {/* High EV Border Pulse */}
            {isHighEv && (
                <div className="high-ev-border-mask">
                    <div className="high-ev-spinner"></div>
                </div>
            )}

            {/* Decorative Background Gradients */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute -left-20 -top-20 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] opacity-20 group-hover/card:opacity-30 transition-opacity"></div>
                <div className="absolute -right-20 -bottom-20 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] opacity-20 group-hover/card:opacity-30 transition-opacity"></div>
            </div>

            {/* Main Layout Grid */}
            <div className="relative z-10 grid grid-cols-1 md:grid-cols-[1fr_minmax(250px,320px)_1fr] gap-6 p-6 items-center">

                {/* Away Team */}
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

                {/* Center Visualization */}
                <div className="flex flex-col items-center justify-center w-full min-h-[160px] py-4 md:py-0 border-t md:border-t-0 md:border-l md:border-r border-white/5 md:px-4">

                    {/* Time & Total */}
                    <div className="flex flex-col items-center gap-2 mb-6">
                        {startTime && (
                            <span className="text-[10px] font-mono font-bold text-gray-500 tracking-[0.2em] uppercase">
                                {startTime} CT
                            </span>
                        )}
                        <div className="bg-white/5 backdrop-blur-md rounded-full px-4 py-1 border border-white/10">
                            <span className="text-sm font-bold text-gray-200 tracking-wider">TOTAL: {totalGoals.toFixed(1)}</span>
                        </div>
                    </div>

                    {/* Win Prob Bars */}
                    <div className="w-full flex flex-col gap-1 mb-6">
                        <div className="flex justify-between text-xs font-bold text-gray-400 mb-1 px-1">
                            <span>{awayModelWinPct.toFixed(1)}%</span>
                            <span className="text-gray-600 font-mono text-[10px] uppercase tracking-widest">Model Win %</span>
                            <span>{homeModelWinPct.toFixed(1)}%</span>
                        </div>
                        <div className="h-4 w-full flex rounded-full overflow-hidden bg-white/5 ring-1 ring-white/10">
                            {/* Away Model Bar */}
                            <div
                                className="h-full bg-gradient-to-r from-transparent to-current opacity-80"
                                style={{ width: `${awayModelWinPct}%`, color: awayColor }}
                            >
                                <div className="w-full h-full bg-current opacity-50" style={{ backgroundColor: awayColor }}></div>
                            </div>
                            {/* Home Model Bar */}
                            <div
                                className="h-full bg-gradient-to-l from-transparent to-current opacity-80"
                                style={{ width: `${homeModelWinPct}%`, color: homeColor }}
                            >
                                <div className="w-full h-full bg-current opacity-50" style={{ backgroundColor: homeColor }}></div>
                            </div>
                        </div>
                    </div>

                    {/* Odds Comparison Grid */}
                    <div className="grid grid-cols-2 gap-2 w-full">
                        {/* Away Odds */}
                        <div className="flex flex-col items-center p-2 rounded bg-black/20 border border-white/5">
                            <span className="text-[10px] text-gray-500 font-mono uppercase">Model</span>
                            <span className="text-sm font-bold text-white">{formatOdds(awayModelOdds || 'N/A')}</span>
                            <div className="h-[1px] w-8 bg-white/10 my-1"></div>
                            <span className="text-[10px] text-gray-500 font-mono uppercase">Vegas</span>
                            <span className="text-xs text-gray-400 font-mono">{formatOdds(awayVegasOdds || 'N/A')}</span>
                        </div>

                        {/* Home Odds */}
                        <div className="flex flex-col items-center p-2 rounded bg-black/20 border border-white/5">
                            <span className="text-[10px] text-gray-500 font-mono uppercase">Model</span>
                            <span className="text-sm font-bold text-white">{formatOdds(homeModelOdds || 'N/A')}</span>
                            <div className="h-[1px] w-8 bg-white/10 my-1"></div>
                            <span className="text-[10px] text-gray-500 font-mono uppercase">Vegas</span>
                            <span className="text-xs text-gray-400 font-mono">{formatOdds(homeVegasOdds || 'N/A')}</span>
                        </div>
                    </div>

                </div>

                {/* Home Team */}
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
    );
};

export default MatchupCard;
