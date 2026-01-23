import React from 'react';

interface FilterControlsProps {
    filters: {
        goalie: string;
        loc: string;
        period: string;
        last: string;
        result: string;
        strength: string;
    };
    setFilters: React.Dispatch<React.SetStateAction<{
        goalie: string;
        loc: string;
        period: string;
        last: string;
        result: string;
        strength: string;
    }>>;
    uniqueGoalies: string[];
}

const FilterControls: React.FC<FilterControlsProps> = ({ filters, setFilters, uniqueGoalies }) => {
    return (
        <div className="flex flex-wrap gap-x-8 gap-y-4 mb-4 p-4 bg-white/5 rounded-lg border border-white/10 items-center">
            {/* Goalie Filter */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Goalie</label>
                <div className="flex flex-wrap gap-1">
                    <button
                        onClick={() => setFilters({ ...filters, goalie: 'All' })}
                        className={`px-3 py-1 rounded-sm text-[10px] uppercase font-bold transition-all ${filters.goalie === 'All' ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'}`}
                    >
                        All
                    </button>
                    {uniqueGoalies.map(g => (
                        <button
                            key={g}
                            onClick={() => setFilters({ ...filters, goalie: g })}
                            className={`px-3 py-1 rounded-sm text-[10px] uppercase font-bold transition-all ${filters.goalie === g ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'}`}
                        >
                            {g.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>

            {/* Location Filter */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Location</label>
                <div className="flex gap-1">
                    {['All', 'Home', 'Away'].map(loc => (
                        <button
                            key={loc}
                            onClick={() => setFilters({ ...filters, loc })}
                            className={`px-3 py-1 rounded-sm text-[10px] uppercase font-bold transition-all ${filters.loc === loc ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'}`}
                        >
                            {loc}
                        </button>
                    ))}
                </div>
            </div>

            {/* Period Filter */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Period</label>
                <div className="flex gap-1">
                    {['All', '1st', '2nd', '3rd', 'OT'].map(p => (
                        <button
                            key={p}
                            onClick={() => setFilters({ ...filters, period: p })}
                            className={`px-3 py-1 rounded-sm text-[10px] uppercase font-bold transition-all ${filters.period === p ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'}`}
                        >
                            {p === 'All' ? 'Full Game' : p}
                        </button>
                    ))}
                </div>
            </div>

            {/* Strength Filter */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Strength</label>
                <div className="flex gap-1">
                    {['All', '5v5', 'EV', 'PP', 'SH'].map(s => (
                        <button
                            key={s}
                            onClick={() => setFilters({ ...filters, strength: s })}
                            className={`px-3 py-1 rounded-sm text-[10px] uppercase font-bold transition-all ${filters.strength === s ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'}`}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            {/* Last N Filter */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Last</label>
                <div className="flex gap-1">
                    {['All', '5', '10', '15', '20'].map(opt => (
                        <button
                            key={opt}
                            onClick={() => setFilters({ ...filters, last: opt })}
                            className={`px-3 py-1 rounded-sm text-[10px] uppercase font-bold transition-all ${filters.last === opt ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'}`}
                        >
                            {opt === 'All' ? 'Season' : opt}
                        </button>
                    ))}
                </div>
            </div>

            {/* Result Filter */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Result</label>
                <div className="flex gap-1">
                    {['All', 'W', 'L'].map(res => (
                        <button
                            key={res}
                            onClick={() => setFilters({ ...filters, result: res })}
                            className={`px-3 py-1 rounded-sm text-[10px] uppercase font-bold transition-all ${filters.result === res ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'}`}
                        >
                            {res}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default FilterControls;
