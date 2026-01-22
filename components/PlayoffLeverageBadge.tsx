import React from 'react';

interface PlayoffLeverageBadgeProps {
    leverage: number | null; // Impact score 0-1 (e.g. 0.25 = 25% shift)
}

export const PlayoffLeverageBadge: React.FC<PlayoffLeverageBadgeProps> = ({ leverage }) => {
    if (leverage === null || leverage < 0.05) return null;

    let color = 'bg-gray-700 text-gray-300';
    let label = 'Low Stakes';
    let icon = '';

    if (leverage >= 0.15) {
        color = 'bg-orange-600/20 text-orange-400 border border-orange-500/30';
        label = 'CRITICAL MATCH';
        icon = '🔥';
    } else if (leverage >= 0.05) {
        color = 'bg-yellow-600/20 text-yellow-400 border border-yellow-500/30';
        label = 'Key Battle';
        icon = '⚠️';
    }

    return (
        <div className={`mt-2 flex items-center justify-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${color}`}>
            <span>{icon}</span>
            <span>{label}</span>
            {leverage > 0.05 && <span className="opacity-70">({(leverage * 100).toFixed(0)}% Swing)</span>}
        </div>
    );
};
