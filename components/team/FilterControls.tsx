import React from 'react';

interface FilterControlsProps {
    filters: {
        goalie: string;
        loc: string;
        period: string;
        last: string;
        result: string;
        ppg: string;
        ppga: string;
        scoringFirst: string;
        minSf: string;
        minSa: string;
    };
    setFilters: React.Dispatch<React.SetStateAction<{
        goalie: string;
        loc: string;
        period: string;
        last: string;
        result: string;
        ppg: string;
        ppga: string;
        scoringFirst: string;
        minSf: string;
        minSa: string;
    }>>;
    uniqueGoalies: string[];
}

const btn = (active: boolean) =>
    `px-3 py-1 rounded-sm text-[10px] uppercase font-bold transition-all ${
        active ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'
    }`;

const FilterControls: React.FC<FilterControlsProps> = ({ filters, setFilters, uniqueGoalies }) => {
    const set = (key: string, val: string) => setFilters(f => ({ ...f, [key]: val }));

    return (
        <div className="flex flex-wrap gap-x-8 gap-y-4 mb-4 p-4 bg-white/5 rounded-lg border border-white/10 items-center">

            {/* Goalie */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Goalie</label>
                <div className="flex flex-wrap gap-1">
                    <button onClick={() => set('goalie', 'All')} className={btn(filters.goalie === 'All')}>All</button>
                    {uniqueGoalies.map(g => (
                        <button key={g} onClick={() => set('goalie', g)} className={btn(filters.goalie === g)}>
                            {g.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>

            {/* Location */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Location</label>
                <div className="flex gap-1">
                    {['All', 'Home', 'Away'].map(loc => (
                        <button key={loc} onClick={() => set('loc', loc)} className={btn(filters.loc === loc)}>{loc}</button>
                    ))}
                </div>
            </div>

            {/* Period */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Period</label>
                <div className="flex gap-1">
                    {['All', '1st', '2nd', '3rd', 'OT'].map(p => (
                        <button key={p} onClick={() => set('period', p)} className={btn(filters.period === p)}>
                            {p === 'All' ? 'Full Game' : p}
                        </button>
                    ))}
                </div>
            </div>

            {/* Last N */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Last</label>
                <div className="flex gap-1">
                    {['All', '5', '10', '15', '20'].map(opt => (
                        <button key={opt} onClick={() => set('last', opt)} className={btn(filters.last === opt)}>
                            {opt === 'All' ? 'Season' : opt}
                        </button>
                    ))}
                </div>
            </div>

            {/* Result */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Result</label>
                <div className="flex gap-1">
                    {['All', 'W', 'L'].map(res => (
                        <button key={res} onClick={() => set('result', res)} className={btn(filters.result === res)}>{res}</button>
                    ))}
                </div>
            </div>

            {/* PP Goals Scored */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Scoring 1+ PPG</label>
                <div className="flex gap-1">
                    {['All', 'Yes', 'No'].map(v => (
                        <button key={v} onClick={() => set('ppg', v)} className={btn(filters.ppg === v)}>{v}</button>
                    ))}
                </div>
            </div>

            {/* PP Goals Allowed */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Allowing 1+ PPGA</label>
                <div className="flex gap-1">
                    {['All', 'Yes', 'No'].map(v => (
                        <button key={v} onClick={() => set('ppga', v)} className={btn(filters.ppga === v)}>{v}</button>
                    ))}
                </div>
            </div>

            {/* Scoring / Trailing First */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Scored First</label>
                <div className="flex gap-1">
                    <button onClick={() => set('scoringFirst', 'All')}    className={btn(filters.scoringFirst === 'All')}>All</button>
                    <button onClick={() => set('scoringFirst', 'Yes')}    className={btn(filters.scoringFirst === 'Yes')}>Yes</button>
                    <button onClick={() => set('scoringFirst', 'No')}     className={btn(filters.scoringFirst === 'No')}>Trailed First</button>
                </div>
            </div>

            {/* Min Shots For */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Shots For ≥</label>
                <div className="flex items-center gap-1 px-2 py-1 bg-black/40 rounded-sm border border-white/10">
                    <input
                        type="number"
                        min={0}
                        placeholder="—"
                        value={filters.minSf}
                        onChange={e => set('minSf', e.target.value)}
                        className="w-12 bg-transparent text-[10px] font-bold text-center text-white placeholder:text-gray-600 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    {filters.minSf !== '' && (
                        <button onClick={() => set('minSf', '')} className="text-gray-600 hover:text-white text-[10px] leading-none">✕</button>
                    )}
                </div>
            </div>

            {/* Min Shots Against */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Shots Against ≥</label>
                <div className="flex items-center gap-1 px-2 py-1 bg-black/40 rounded-sm border border-white/10">
                    <input
                        type="number"
                        min={0}
                        placeholder="—"
                        value={filters.minSa}
                        onChange={e => set('minSa', e.target.value)}
                        className="w-12 bg-transparent text-[10px] font-bold text-center text-white placeholder:text-gray-600 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    {filters.minSa !== '' && (
                        <button onClick={() => set('minSa', '')} className="text-gray-600 hover:text-white text-[10px] leading-none">✕</button>
                    )}
                </div>
            </div>

        </div>
    );
};

export default FilterControls;
