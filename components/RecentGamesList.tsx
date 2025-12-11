import React from 'react';
import { RecentGame } from '../utils/data';
import LogoDisplay from './LogoDisplay';

interface RecentGamesListProps {
    games: RecentGame[];
    teamTriCode: string;
    isMobile?: boolean;
    currentStarter?: string;
}

const RecentGamesList: React.FC<RecentGamesListProps> = ({ games, teamTriCode, isMobile = false, currentStarter }) => {
    if (!games || games.length === 0) return null;

    return (
        <div className="flex flex-col w-full">
            {/* Header */}
            <div className="text-[10px] uppercase text-neutral-500 font-bold mb-2 tracking-wider px-2">
                Last 5 Games
            </div>

            {/* List */}
            <div className="flex flex-col gap-1">
                {games.slice(0, 5).map((game, i) => {
                    // Check for historical starter match
                    const cleanCurrent = currentStarter?.split('(')[0].trim().toLowerCase();
                    const cleanGameStarter = game.starter?.trim().toLowerCase();
                    const isStarterMatch = cleanCurrent && cleanGameStarter && cleanCurrent === cleanGameStarter;
                    // Format Date (Already formatted "12/6" in backend, but let's be safe)
                    const formatDate = (dateStr: string) => {
                        const [m, d] = dateStr.split('/');
                        const month = parseInt(m);
                        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                        if (month >= 1 && month <= 12) {
                            return `${months[month - 1]}/${d}`;
                        }
                        return dateStr;
                    };

                    // Result Badge Styles
                    const getBadgeStyles = (res: string) => {
                        const base = "w-4 h-4 md:w-5 md:h-5 rounded-full flex items-center justify-center border shrink-0";

                        if (res === 'W') return `${base} text-neon-green border-neon-green/30 bg-neon-green/10`;

                        // OT Win: Green Text, Orange Border (Solid)
                        if (res === 'W-OT') return `${base} text-neon-green border-orange-400/50 bg-neon-green/10`;

                        // SO Win: Green Text, Orange Border (Dotted)
                        if (res === 'W-SO') return `${base} text-neon-green border-orange-400/50 border-dotted bg-neon-green/10`;

                        // Losses
                        if (res === 'L') return `${base} text-red-500 border-red-500/30 bg-red-500/10`;
                        if (res === 'O') return `${base} text-orange-400 border-orange-400/30 bg-orange-400/10`;

                        return `${base} text-neutral-500`;
                    };

                    const getDisplayText = (res: string) => {
                        // User wants to keep "W" green, implying single letter
                        if (res.startsWith('W')) return 'W';
                        return res;
                    };

                    return (
                        <div key={i} className="flex items-center justify-between p-2 rounded hover:bg-white/5 transition-colors border border-transparent hover:border-white/5">

                            {/* Left: Date & Opponent */}
                            <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
                                <span className={`text-[10px] md:text-xs text-neutral-400 font-mono ${isMobile ? 'w-auto' : 'w-10'} flex items-center gap-1.5`}>
                                    {isMobile ? formatDate(game.date) : game.date}
                                    {isStarterMatch && (
                                        <div className="w-2 h-2 min-w-[8px] rounded-full bg-purple-400 shadow-[0_0_8px_rgba(192,132,252,0.8)]" title={`Starter: ${game.starter}`} />
                                    )}
                                </span>

                                <span className="text-[10px] text-neutral-500 font-bold">
                                    {game.isHome ? 'vs' : '@'}
                                </span>

                                {/* Opponent Logo + Tricode */}
                                <div className="flex items-center gap-1.5 md:gap-2">
                                    <div className="w-5 h-5 md:w-6 md:h-6 relative shrink-0">
                                        <LogoDisplay
                                            src={game.opponentLogo}
                                            alt={game.opponent}
                                            triCode={game.opponent}
                                            className="w-full h-full object-contain"
                                            primaryColor={game.opponentColor}
                                        />
                                    </div>
                                    {!isMobile && <span className="text-xs font-bold text-neutral-300">{game.opponent}</span>}
                                </div>
                            </div>

                            {/* Right: Result & Score */}
                            <div className="flex items-center gap-2">
                                {/* Result Badge */}
                                <div className={getBadgeStyles(game.result)}>
                                    <span className="text-[9px] md:text-[10px] font-bold">{getDisplayText(game.result)}</span>
                                </div>

                                {/* Score */}
                                <span className={`text-[10px] md:text-xs font-mono font-bold text-white text-right ${isMobile ? 'w-auto' : 'w-12'}`}>
                                    {game.score}
                                </span>
                            </div>

                        </div>
                    );
                })}
            </div >
        </div >
    );
};

export default RecentGamesList;
