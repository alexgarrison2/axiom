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



                    return (
                        <div key={i} className="flex items-center justify-between p-2 rounded hover:bg-white/5 transition-colors border border-transparent hover:border-white/5">

                            {/* Left: Date & Opponent */}
                            <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
                                <span className={`text-[10px] md:text-xs text-neutral-400 font-mono ${isMobile ? 'w-auto' : 'w-14'} flex items-center gap-2`}>
                                    {isStarterMatch && (
                                        <div className="w-2 h-2 min-w-[8px] rounded-full bg-purple-400 shadow-[0_0_8px_rgba(192,132,252,0.8)]" title={`Starter: ${game.starter}`} />
                                    )}
                                    {isMobile ? formatDate(game.date) : game.date}
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
                            <div className="flex items-center gap-3">
                                {/* Result Badge */}
                                {(() => {
                                    let prefix = null;
                                    let mainText = game.result;
                                    let colorClass = "text-neutral-500 border-neutral-500";

                                    if (game.result === 'W') {
                                        mainText = 'W';
                                        colorClass = 'text-green-500 border-green-500';
                                    } else if (game.result === 'L') {
                                        mainText = 'L';
                                        colorClass = 'text-red-500 border-red-500';
                                    } else if (game.result === 'O') {
                                        mainText = 'O';
                                        colorClass = 'text-orange-500 border-orange-500';
                                    } else if (game.result === 'W-OT') {
                                        prefix = 'OT';
                                        mainText = 'W';
                                        colorClass = 'text-green-500 border-green-500';
                                    } else if (game.result === 'W-SO') {
                                        prefix = 'SO';
                                        mainText = 'W'; // Although image shows W inside box, verifying if user wants W or just W check
                                        colorClass = 'text-green-500 border-green-500';
                                    }

                                    return (
                                        <div className="flex items-center gap-1.5 justify-end w-[4.5rem]">
                                            {prefix && (
                                                <span className="text-orange-500 text-[10px] font-bold tracking-tighter">{prefix}</span>
                                            )}
                                            <div className={`w-6 h-6 md:w-7 md:h-7 rounded-md border-2 flex items-center justify-center shrink-0 bg-black/40 ${colorClass}`}>
                                                <span className="text-xs md:text-sm font-bold">{mainText}</span>
                                            </div>
                                        </div>
                                    );
                                })()}

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
