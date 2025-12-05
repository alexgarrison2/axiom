import React from 'react';
import { GamePrediction } from '@/utils/data';

interface MatchupCardProps {
    prediction: GamePrediction;
}

const MatchupCard: React.FC<MatchupCardProps> = ({ prediction }) => {
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
    } = prediction;

    // Handle missing Vegas odds (e.g. Detroit case)
    const finalHomeVegas = homeVegasWinPct || (awayVegasWinPct ? 100 - awayVegasWinPct : 50);
    const finalAwayVegas = awayVegasWinPct || (homeVegasWinPct ? 100 - homeVegasWinPct : 50);

    // Format numbers
    const formatPct = (n: number) => n.toFixed(1) + '%';
    const formatXg = (n: number) => n.toFixed(2);
    const formatEv = (n: number) => `+${Math.round(n)}%`;

    // Determine EV badges
    const homeEvBadge = homeEv > 0 ? formatEv(homeEv) : null;
    const awayEvBadge = awayEv > 0 ? formatEv(awayEv) : null;

    // Team Colors (fallback to defaults if missing)
    const homeColor = homeTeam.color1 || '#000';
    const awayColor = awayTeam.color1 || '#000';

    // Determine bar widths
    const homeModelWidth = `${homeModelWinPct}%`;
    const awayModelWidth = `${awayModelWinPct}%`;
    const homeVegasWidth = `${finalHomeVegas}%`;
    const awayVegasWidth = `${finalAwayVegas}%`;

    return (
        <div className="flex items-center justify-between py-6 border-b border-gray-800 relative">
            {/* Vertical Grid Lines (Background) - simplified, maybe add to parent */}

            {/* Left Side: Away Team */}
            <div className="flex items-center flex-1 justify-end gap-4 pr-4">
                <div className="text-right">
                    <div className="text-white font-medium text-lg">{awayStarter}</div>
                    <div className="text-gray-400 text-sm hidden">{awayTeam.commonName}</div>
                </div>
                <img src={awayTeam.logoUrl} alt={awayTeam.name} className="w-16 h-16 object-contain" />
            </div>

            {/* Center Visualization */}
            <div className="flex flex-col items-center w-[500px] shrink-0 relative">

                {/* xG Values and EV Badges - Absolute positioning or Flex */}
                <div className="absolute left-[-80px] top-1/2 -translate-y-1/2 flex items-center gap-2">
                    {/* Away xG */}
                    <span className="text-2xl font-bold text-white">{formatXg(awayXg)}</span>
                    {awayEvBadge && (
                        <span className="bg-green-500 text-black text-xs font-bold px-1.5 py-0.5 rounded shadow-[0_0_10px_rgba(34,197,94,0.6)]">
                            {awayEvBadge}
                        </span>
                    )}
                </div>

                <div className="absolute right-[-80px] top-1/2 -translate-y-1/2 flex items-center gap-2 flex-row-reverse">
                    {/* Home xG */}
                    <span className="text-2xl font-bold text-white">{formatXg(homeXg)}</span>
                    {homeEvBadge && (
                        <span className="bg-green-500 text-black text-xs font-bold px-1.5 py-0.5 rounded shadow-[0_0_10px_rgba(34,197,94,0.6)]">
                            {homeEvBadge}
                        </span>
                    )}
                </div>

                {/* Top Bar: Model Win % */}
                <div className="w-full h-10 flex rounded-t-lg overflow-hidden relative">
                    {/* Left: Away Model */}
                    <div
                        style={{ width: awayModelWidth, backgroundColor: awayColor }}
                        className="h-full flex items-center justify-start pl-2 relative transition-all"
                    >
                        <span className="bg-white/90 text-black text-xs font-bold px-1 rounded shadow-sm ml-1">
                            {formatPct(awayModelWinPct)}
                        </span>
                    </div>
                    {/* Right: Home Model */}
                    <div
                        style={{ width: homeModelWidth, backgroundColor: homeColor }}
                        className="h-full flex items-center justify-end pr-2 relative transition-all"
                    >
                        <span className="bg-white/90 text-black text-xs font-bold px-1 rounded shadow-sm mr-1">
                            {formatPct(homeModelWinPct)}
                        </span>
                    </div>

                    {/* Center Divider Line */}
                    <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white z-10"></div>
                </div>

                {/* Middle: Total Goals Box */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 bg-white text-black font-bold text-lg px-3 py-1 rounded shadow-lg border-2 border-gray-200 min-w-[60px] text-center">
                    {totalGoals.toFixed(2)}
                </div>

                {/* Bottom Bar: Vegas Win % */}
                <div className="w-full h-6 flex rounded-b-lg overflow-hidden mt-0.5 relative opacity-90">
                    {/* Left: Away Vegas */}
                    <div
                        className="h-full bg-gray-700 flex items-center justify-start pl-2 relative"
                        style={{ width: awayVegasWidth }}
                    >
                        <span className="text-white text-[10px] font-bold ml-1 drop-shadow-md">
                            {formatPct(finalAwayVegas)}
                        </span>
                    </div>
                    {/* Right: Home Vegas */}
                    <div
                        className="h-full bg-gray-600 flex items-center justify-end pr-2 relative"
                        style={{ width: homeVegasWidth }}
                    >
                        <span className="text-white text-[10px] font-bold mr-1 drop-shadow-md">
                            {formatPct(finalHomeVegas)}
                        </span>
                    </div>

                    {/* Center Divider Line */}
                    <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/50 z-10"></div>
                </div>

            </div>

            {/* Right Side: Home Team */}
            <div className="flex items-center flex-1 justify-start gap-4 pl-4">
                <img src={homeTeam.logoUrl} alt={homeTeam.name} className="w-16 h-16 object-contain" />
                <div className="text-left">
                    <div className="text-white font-medium text-lg">{homeStarter}</div>
                    <div className="text-gray-400 text-sm hidden">{homeTeam.commonName}</div>
                </div>
            </div>

        </div>
    );
};

export default MatchupCard;
