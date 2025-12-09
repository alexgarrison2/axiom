import React from 'react';
import { RecentGame } from '../utils/data';
import LogoDisplay from './LogoDisplay';

interface RecentGamesListProps {
    games: RecentGame[];
    teamTriCode: string;
}

const RecentGamesList: React.FC<RecentGamesListProps> = ({ games, teamTriCode }) => {
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
                    // Format Date (Already formatted "12/6" in backend, but let's be safe)

                    // Result Badge Color
                    const getBadgeColor = (res: string) => {
                        if (res === 'W') return 'text-neon-green border-neon-green/30 bg-neon-green/10';
                        if (res === 'L') return 'text-red-500 border-red-500/30 bg-red-500/10';
                        if (res === 'O') return 'text-orange-400 border-orange-400/30 bg-orange-400/10';
                        return 'text-neutral-500';
                    };

                    // Result Symbol (W, L, O)
                    // User requested "Orange 'O' inside an orange circle if the game was lost in OT/SO"
                    // We use a circle badge for all.

                    return (
                        <div key={i} className="flex items-center justify-between p-2 rounded hover:bg-white/5 transition-colors border border-transparent hover:border-white/5">

                            {/* Left: Date & Opponent */}
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-neutral-400 font-mono w-10">{game.date}</span>

                                <span className="text-[10px] text-neutral-500 font-bold">
                                    {game.isHome ? 'vs' : '@'}
                                </span>

                                {/* Opponent Logo + Tricode */}
                                <div className="flex items-center gap-2 w-16">
                                    <div className="w-6 h-6 relative shrink-0">
                                        <LogoDisplay
                                            src={game.opponentLogo}
                                            alt={game.opponent}
                                            triCode={game.opponent}
                                            className="w-full h-full object-contain"
                                        />
                                    </div>
                                    <span className="text-xs font-bold text-neutral-300">{game.opponent}</span>
                                </div>
                            </div>

                            {/* Right: Result & Score */}
                            <div className="flex items-center gap-3">
                                {/* Result Circle Badge */}
                                <div className={`w-5 h-5 rounded-full flex items-center justify-center border ${getBadgeColor(game.result)}`}>
                                    <span className="text-[10px] font-bold">{game.result}</span>
                                </div>

                                {/* Score */}
                                <span className="text-xs font-mono font-bold text-white w-12 text-right">
                                    {game.score}
                                </span>
                            </div>

                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default RecentGamesList;
