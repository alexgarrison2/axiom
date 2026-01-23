import React, { useMemo } from 'react';
import { SimResult, TeamStandings } from '@/utils/simulation-engine';
import LogoDisplay from './LogoDisplay';

interface PlayoffTooltipProps {
    team: TeamStandings & { proj: number, playoffOdds: number, cupOdds: number };
    simResult: SimResult;
    children: React.ReactNode;
}

const PlayoffTooltip: React.FC<PlayoffTooltipProps> = ({ team, simResult, children }) => {
    // 1. Process Point Distribution for Histogram
    const histogramData = useMemo(() => {
        if (!simResult?.pointDist) return { data: [], maxFreq: 0 };

        const points = Array.from(simResult.pointDist.keys()).sort((a, b) => a - b);
        if (points.length === 0) return { data: [], maxFreq: 0 };

        const minP = points[0];
        const maxP = points[points.length - 1];

        // Fill gaps
        const fullRange = [];
        let maxFreq = 0;

        for (let p = minP; p <= maxP; p++) {
            const count = simResult.pointDist.get(p) || 0;
            fullRange.push({ point: p, count, pct: (count / simResult.totalSims) * 100 });
            if (count > maxFreq) maxFreq = count;
        }

        return { data: fullRange, maxFreq };
    }, [simResult]);

    // 2. Process Round Exit Probabilities
    const roundProbs = useMemo(() => {
        if (!simResult?.roundExitDist) return null;
        const total = simResult.totalSims;

        return {
            miss: (simResult.roundExitDist['MISS'] || 0) / total * 100,
            r1: (simResult.roundExitDist['R1'] || 0) / total * 100,
            r2: (simResult.roundExitDist['R2'] || 0) / total * 100,
            cf: (simResult.roundExitDist['CF'] || 0) / total * 100,
            f: (simResult.roundExitDist['F'] || 0) / total * 100,
            cup: (simResult.roundExitDist['CUP'] || 0) / total * 100,
        };
    }, [simResult]);

    // 3. Process Division Rank Probabilities
    const divRankProbs = useMemo(() => {
        if (!simResult?.divRankDist) return [];
        const total = simResult.totalSims;
        const ranks = [];
        for (let i = 1; i <= 8; i++) {
            ranks.push({ rank: i, pct: (simResult.divRankDist.get(i) || 0) / total * 100 });
        }
        return ranks;
    }, [simResult]);


    const { data: histData, maxFreq } = histogramData;
    if (!histData || histData.length === 0) return <>{children}</>;

    return (
        <div className="relative group/tooltip">
            {children}

            {/* Tooltip Content */}
            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-[600px] bg-[#F5F5F0] text-black rounded-lg shadow-2xl opacity-0 group-hover/tooltip:opacity-100 pointer-events-none transition-opacity z-50 p-6 font-sans">
                {/* Header Section */}
                <div className="flex items-center justify-between pb-4 border-b border-neutral-300 mb-4">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 relative">
                            <LogoDisplay triCode={team.tricode} src="" alt={team.tricode} className="w-full h-full drop-shadow-lg" variant="standard" />
                        </div>
                        <div className="flex flex-col">
                            {/* Team Name could act as title? Or just logo is enough with stats */}
                        </div>
                    </div>

                    <div className="flex gap-8 text-center">
                        <div>
                            <div className="text-4xl font-extrabold text-neutral-800 tracking-tighter">{team.proj.toFixed(1)}</div>
                            <div className="text-xs font-bold uppercase text-neutral-500 tracking-wider">Points</div>
                            {/* Rank placeholder if we had it easily accessible: <div className="text-[10px] text-neutral-400">6th</div> */}
                        </div>
                        <div>
                            <div className="text-4xl font-extrabold text-neutral-800 tracking-tighter">{team.playoffOdds.toFixed(0)}%</div>
                            <div className="text-xs font-bold uppercase text-neutral-500 tracking-wider">Playoffs</div>
                        </div>
                        <div>
                            <div className="text-4xl font-extrabold text-neutral-800 tracking-tighter">{team.cupOdds.toFixed(1)}%</div>
                            <div className="text-xs font-bold uppercase text-neutral-500 tracking-wider">Stanley Cup</div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-5 gap-8">
                    {/* Histogram Column (Left) - Span 2 */}
                    <div className="col-span-2 flex flex-col justify-end h-64 border-l border-b border-neutral-300 relative pl-1">
                        {histData.map((d) => {
                            // Only label some y-axis points? Or x-axis?
                            // Mimic the chart: horizontal bars or vertical? 
                            // Wait, user image shows HORIZONTAL bars for points distribution on the LEFT.
                            // Wait, let me re-examine user image visual memory.
                            // Image 2: "103.3 Points", Histogram on left is Vertical list of points bins (120, 115, 110...) with horizontal green bars.
                            return null;
                        })}
                        {/* 
                           Correction: The image shows a Vertical List of Point ranges (y-axis labels) with Horizontal Bars expanding right.
                           Let's re-render this loop properly below.
                        */}
                        <div className="flex flex-col w-full h-full justify-between text-[10px] font-bold text-neutral-600">
                            {/* We will bucketize if too many points, or just show list if dense enough. 
                                Let's bucket by 5 or just list every 2-3? 
                                82 games -> ~40-120 points range. ~80 buckets is too tall.
                                We should bucket into bins of 5: e.g. 120-124, 115-119.
                            */}
                            <HistogramVertical buckets={createBuckets(histData)} />
                        </div>
                    </div>

                    {/* Stats Column (Right) - Span 3 */}
                    <div className="col-span-3 grid grid-cols-2 gap-x-8 gap-y-2">
                        {/* Division Finish */}
                        <div className="col-span-1 space-y-2">
                            <h4 className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest border-b border-neutral-300 pb-1 mb-2">Division Rank</h4>
                            {divRankProbs.map(d => (
                                <div key={d.rank} className="flex justify-between items-center text-xs font-bold text-neutral-700">
                                    <span>{d.rank}{getOrdinal(d.rank)}</span>
                                    <span className="text-neutral-900">{d.pct < 1 && d.pct > 0 ? '<1' : d.pct.toFixed(0)}%</span>
                                </div>
                            ))}
                        </div>

                        {/* Playoff Finish */}
                        <div className="col-span-1 space-y-2">
                            <h4 className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest border-b border-neutral-300 pb-1 mb-2">Playoff Result</h4>

                            <ResultRow label="Stanley Cup" pct={roundProbs?.cup} />
                            <ResultRow label="Finals" pct={roundProbs?.f} />
                            <ResultRow label="Conf. Finals" pct={roundProbs?.cf} />
                            <ResultRow label="2nd Round" pct={roundProbs?.r2} />
                            <ResultRow label="1st Round" pct={roundProbs?.r1} />
                            <ResultRow label="Miss Playoffs" pct={roundProbs?.miss} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Helpers
const getOrdinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
};

const ResultRow = ({ label, pct }: { label: string, pct?: number }) => (
    <div className="flex justify-between items-center text-xs font-bold text-neutral-700">
        <span>{label}</span>
        <span className="text-neutral-900">{pct !== undefined ? (pct < 1 && pct > 0 ? '<1' : pct.toFixed(0)) : '-'}%</span>
    </div>
);

const createBuckets = (data: { point: number, count: number, pct: number }[]) => {
    const buckets: Record<string, number> = {};
    const keys: number[] = [];

    // Find range
    // Bucket by 5s: 120, 115, 110, etc.
    // Key will be the 'floor' of the bucket (e.g., 100 represents 100-104)
    data.forEach(d => {
        const b = Math.floor(d.point / 5) * 5;
        if (!buckets[b]) {
            buckets[b] = 0;
            keys.push(b);
        }
        buckets[b] += d.pct;
    });

    return keys.sort((a, b) => b - a).map(k => ({ label: k, pct: buckets[k] }));
};

const HistogramVertical = ({ buckets }: { buckets: { label: number, pct: number }[] }) => {
    return (
        <div className="w-full flex flex-col gap-1">
            {buckets.map(b => (
                <div key={b.label} className="flex items-center h-5 gap-2">
                    <span className="w-6 text-right text-[10px] text-neutral-500 font-mono leading-none">{b.label}</span>
                    <div className="flex-1 h-full bg-neutral-200 rounded-sm overflow-hidden relative">
                        {/* Green Bar */}
                        <div
                            className="bg-[#008851] h-full absolute left-0 top-0"
                            style={{ width: `${Math.min(b.pct * 3, 100)}%` }} // *3 scaling provided pct is low, or just use raw if pct is high. Adjust scale. 
                        />
                        {/* Text inside bar? */}
                        {b.pct > 2 && (
                            <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[9px] font-bold text-white pl-1 drop-shadow-md z-10">
                                {b.pct.toFixed(0)}%
                            </span>
                        )}
                    </div>
                </div>
            ))}
        </div>
    )
};

export default PlayoffTooltip;
