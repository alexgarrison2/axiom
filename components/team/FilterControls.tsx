import React from 'react';

export interface GameFilters {
    goalie: string;
    loc: string;
    period: string;
    last: string;
    result: string;
    ppg: string;
    ppga: string;
    scoringFirst: string;
    opponent: string;
    minGf: string;
    maxGf: string;
    minGa: string;
    maxGa: string;
    minSf: string;
    maxSf: string;
    minSa: string;
    maxSa: string;
    // New filters
    minHdf: string;
    maxHdf: string;
    minHda: string;
    maxHda: string;
    minPpOpps: string;
    maxPpOpps: string;
    minPkOpps: string;
    maxPkOpps: string;
    minSvPct: string;
    maxSvPct: string;
    minShotDiff: string;
    maxShotDiff: string;
    minXgDiff: string;
    maxXgDiff: string;
    minCf: string;
    maxCf: string;
    minCa: string;
    maxCa: string;
    minCorsiDiff: string;
    maxCorsiDiff: string;
}

interface FilterControlsProps {
    filters: GameFilters;
    setFilters: React.Dispatch<React.SetStateAction<GameFilters>>;
    uniqueGoalies: string[];
    uniqueOpponents: string[];
}

const btn = (active: boolean) =>
    `px-3 py-1 rounded-sm text-[10px] uppercase font-bold transition-all ${
        active ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'
    }`;

/** Reusable Min/Max number input pair */
const RangeInputs: React.FC<{
    minKey: keyof GameFilters;
    maxKey: keyof GameFilters;
    minVal: string;
    maxVal: string;
    step?: string;
    set: (key: string, val: string) => void;
}> = ({ minKey, maxKey, minVal, maxVal, step = '1', set }) => (
    <div className="flex items-center gap-1">
        <div className="flex items-center gap-1 px-2 py-1 bg-black/40 rounded-sm border border-white/10">
            <span className="text-[9px] text-gray-600 uppercase">Min</span>
            <input
                type="number" step={step} placeholder="—" value={minVal}
                onChange={e => set(minKey as string, e.target.value)}
                className="w-10 bg-transparent text-[10px] font-bold text-center text-white placeholder:text-gray-600 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            {minVal !== '' && <button onClick={() => set(minKey as string, '')} className="text-gray-600 hover:text-white text-[9px] leading-none">✕</button>}
        </div>
        <div className="flex items-center gap-1 px-2 py-1 bg-black/40 rounded-sm border border-white/10">
            <span className="text-[9px] text-gray-600 uppercase">Max</span>
            <input
                type="number" step={step} placeholder="—" value={maxVal}
                onChange={e => set(maxKey as string, e.target.value)}
                className="w-10 bg-transparent text-[10px] font-bold text-center text-white placeholder:text-gray-600 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            {maxVal !== '' && <button onClick={() => set(maxKey as string, '')} className="text-gray-600 hover:text-white text-[9px] leading-none">✕</button>}
        </div>
    </div>
);

const FilterControls: React.FC<FilterControlsProps> = ({ filters, setFilters, uniqueGoalies, uniqueOpponents }) => {
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

            {/* GF */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">GF</label>
                <RangeInputs minKey="minGf" maxKey="maxGf" minVal={filters.minGf} maxVal={filters.maxGf} set={set} />
            </div>

            {/* GA */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">GA</label>
                <RangeInputs minKey="minGa" maxKey="maxGa" minVal={filters.minGa} maxVal={filters.maxGa} set={set} />
            </div>

            {/* Opponent */}
            {uniqueOpponents.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Opponent</label>
                    <div className="flex flex-wrap gap-1">
                        <button onClick={() => set('opponent', 'All')} className={btn(filters.opponent === 'All')}>All</button>
                        {uniqueOpponents.map(opp => (
                            <button key={opp} onClick={() => set('opponent', opp)} className={btn(filters.opponent === opp)}>
                                {opp.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>
            )}

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
                    {['All', 'Reg', 'Playoffs', '5', '10', '15', '20'].map(opt => (
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

            {/* Shots For */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Shots For</label>
                <RangeInputs minKey="minSf" maxKey="maxSf" minVal={filters.minSf} maxVal={filters.maxSf} set={set} />
            </div>

            {/* Shots Against */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Shots Against</label>
                <RangeInputs minKey="minSa" maxKey="maxSa" minVal={filters.minSa} maxVal={filters.maxSa} set={set} />
            </div>

            {/* Shot Differential */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Shot Diff</label>
                <RangeInputs minKey="minShotDiff" maxKey="maxShotDiff" minVal={filters.minShotDiff} maxVal={filters.maxShotDiff} set={set} />
            </div>

            {/* High Danger For */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">HD For</label>
                <RangeInputs minKey="minHdf" maxKey="maxHdf" minVal={filters.minHdf} maxVal={filters.maxHdf} set={set} />
            </div>

            {/* High Danger Against */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">HD Against</label>
                <RangeInputs minKey="minHda" maxKey="maxHda" minVal={filters.minHda} maxVal={filters.maxHda} set={set} />
            </div>

            {/* Corsi For */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">CF</label>
                <RangeInputs minKey="minCf" maxKey="maxCf" minVal={filters.minCf} maxVal={filters.maxCf} set={set} />
            </div>

            {/* Corsi Against */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">CA</label>
                <RangeInputs minKey="minCa" maxKey="maxCa" minVal={filters.minCa} maxVal={filters.maxCa} set={set} />
            </div>

            {/* Corsi Diff */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Corsi Diff</label>
                <RangeInputs minKey="minCorsiDiff" maxKey="maxCorsiDiff" minVal={filters.minCorsiDiff} maxVal={filters.maxCorsiDiff} set={set} />
            </div>

            {/* xG Differential */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">xG Diff</label>
                <RangeInputs minKey="minXgDiff" maxKey="maxXgDiff" minVal={filters.minXgDiff} maxVal={filters.maxXgDiff} step="0.01" set={set} />
            </div>

            {/* PP Opps */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">PP Opps</label>
                <RangeInputs minKey="minPpOpps" maxKey="maxPpOpps" minVal={filters.minPpOpps} maxVal={filters.maxPpOpps} set={set} />
            </div>

            {/* PK Opps */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">PK Opps</label>
                <RangeInputs minKey="minPkOpps" maxKey="maxPkOpps" minVal={filters.minPkOpps} maxVal={filters.maxPkOpps} set={set} />
            </div>

            {/* Save % */}
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Save %</label>
                <RangeInputs minKey="minSvPct" maxKey="maxSvPct" minVal={filters.minSvPct} maxVal={filters.maxSvPct} step="0.001" set={set} />
            </div>

        </div>
    );
};

export default FilterControls;
