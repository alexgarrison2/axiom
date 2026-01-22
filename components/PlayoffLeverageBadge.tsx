import React from 'react';

interface PlayoffLeverageBadgeProps {
    leverage: number | null; // Impact score 0-1 (e.g. 0.25 = 25% shift)
}

const PlayoffLeverageBadge: React.FC<PlayoffLeverageBadgeProps> = ({ leverage }) => {
    if (leverage === null || leverage < 0.10) return null; // Increased threshold to reduce noise

    let color = 'bg-gray-700/50 text-gray-400 border-gray-600/30';
    let label = 'Impact';
    let icon = '';

    if (leverage >= 0.20) {
        color = 'bg-orange-500/10 text-orange-400 border-orange-500/20'; // Much subtler background
        label = 'High Stakes';
        icon = '🔥';
    } else if (leverage >= 0.10) {
        color = 'bg-blue-500/10 text-blue-400 border-blue-500/20';
        label = 'Key Match';
        icon = '⚡';
    }

    return (
        <div className={`mt-2 inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold ${color}`}>
            <span>{icon}</span>
            <span>{label}</span>
            <span className="opacity-60 ml-0.5 border-l border-white/10 pl-1.5">{(leverage * 100).toFixed(0)}% Impact</span>
        </div>
    );
};

export { PlayoffLeverageBadge };
