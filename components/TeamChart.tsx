"use client";

import React, { useState, useMemo, useEffect } from 'react';
import {
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';

interface GameLog {
    game_id: string;
    game_number: number;
    date: string;
    opponent: string;
    result: string; // W 4-2
    result_code: string;
    home_away: string;
    gf: number;
    ga: number;
    xgf: number;
    xga: number;
    points: number;
    pp_goals: number;
    pp_opps: number;
    pp_goals_against: number;
    pk_opps: number;
    sf: number;
    sa: number;
    cf: number;
    ca: number;
    gsax: number;
    en_gf: number;
    en_ga: number;
    starting_goalie: string;
}

interface TeamChartProps {
    games: GameLog[];
    leagueGames?: GameLog[];
    primaryColor: string;
}

const METRICS = [
    { label: 'Points %', value: 'pts_pct', suffix: '', format: (v: number) => v.toFixed(3).replace(/^0+/, '') },
    { label: 'Goals For / GP', value: 'gf', suffix: '', format: (v: number) => v.toFixed(2) },
    { label: 'Goals Against / GP', value: 'ga', suffix: '', format: (v: number) => v.toFixed(2) },
    { label: 'Goal Diff', value: 'gd', suffix: '', format: (v: number) => (v > 0 ? '+' : '') + v.toFixed(1) },
    { label: 'xGoals For / GP', value: 'xgf', suffix: '', format: (v: number) => v.toFixed(2) },
    { label: 'xGoals Against / GP', value: 'xga', suffix: '', format: (v: number) => v.toFixed(2) },
    { label: 'Power Play %', value: 'pp', suffix: '%', format: (v: number) => v.toFixed(1) },
    { label: 'GSAx / GP', value: 'gsax', suffix: '', format: (v: number) => v.toFixed(2) }
];

interface MetricType {
    label: string;
    value: string;
    suffix: string;
    format: (v: number) => string;
}

interface CustomTooltipProps {
    active?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload?: any[];
    activeMetric: MetricType;
    secondaryMetric?: MetricType;
    primaryColor: string;
}

const CustomTooltip = ({ active, payload, activeMetric, secondaryMetric, primaryColor }: CustomTooltipProps) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        const g = data.game;
        const fmt1 = activeMetric.format(data.value);
        const fmt2 = secondaryMetric ? secondaryMetric.format(data.value2) : null;

        return (
            <div className="bg-black/90 border border-white/20 p-3 rounded-lg shadow-xl backdrop-blur-md min-w-[200px] font-mono">
                <div className="text-[10px] text-gray-400 font-mono mb-1">{g.date} • Game {g.game_number}</div>

                {/* Metric 1 */}
                <div className="text-sm font-bold text-white mb-1 flex justify-between items-center">
                    <span style={{ color: primaryColor }}>● {activeMetric.label}</span>
                    <span className="text-white ml-4">{fmt1}{activeMetric.suffix}</span>
                </div>

                {/* Metric 2 */}
                {secondaryMetric && (
                    <div className="text-sm font-bold text-gray-400 mb-2 pb-2 border-b border-white/10 flex justify-between items-center">
                        <span>○ {secondaryMetric.label}</span>
                        <span className="text-gray-300 ml-4">{fmt2}{secondaryMetric.suffix}</span>
                    </div>
                )}
                {!secondaryMetric && <div className="h-px bg-white/10 my-2"></div>}

                {/* Details */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-300">
                    <div className="col-span-2 font-bold text-white mb-1">
                        {g.home_away === 'Home' ? 'vs' : '@'} {g.opponent} ({g.result})
                    </div>
                    <div className="text-gray-500">Score:</div>
                    <div className="text-right text-white font-mono">{g.score}</div>

                    <div className="text-gray-500">Goalie:</div>
                    <div className="text-right text-white truncate">{g.starting_goalie.split(' ').pop()}</div>

                    <div className="text-gray-500">GF / GA:</div>
                    <div className="text-right text-white font-mono">{g.gf}-{g.ga}</div>
                </div>
            </div>
        );
    }
    return null;
};

const TeamChart: React.FC<TeamChartProps> = ({ games, primaryColor }) => {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const [metric, setMetric] = useState(searchParams.get('metric') || METRICS[0].value);
    const [metric2, setMetric2] = useState<string>(searchParams.get('metric2') || 'none');
    const [mode, setMode] = useState<'cumulative' | 'rolling'>((searchParams.get('mode') as 'cumulative' | 'rolling') || 'cumulative');
    const [windowSize, setWindowSize] = useState([parseInt(searchParams.get('window') || '10')]);
    const [locFilter, setLocFilter] = useState<'All' | 'Home' | 'Away'>((searchParams.get('loc') as 'All' | 'Home' | 'Away') || 'All');


    // Sync State to URL
    useEffect(() => {
        const params = new URLSearchParams(searchParams.toString());

        if (metric !== METRICS[0].value) params.set('metric', metric); else params.delete('metric');
        if (metric2 !== 'none') params.set('metric2', metric2); else params.delete('metric2');
        if (mode !== 'cumulative') params.set('mode', mode); else params.delete('mode');
        if (windowSize[0] !== 10) params.set('window', windowSize[0].toString()); else params.delete('window');
        if (locFilter !== 'All') params.set('loc', locFilter); else params.delete('loc');
        if (goalie !== 'All') params.set('goalie', goalie); else params.delete('goalie');

        const newSearch = params.toString();
        // Only replace if changed materially (ignoring order or defaults logic if mismatched)
        // But searchParams is immutable from hook, so we compare strings
        if (newSearch !== searchParams.toString()) {
            // Use replace to avoid history stack spam
            router.replace(`${pathname}?${newSearch}`, { scroll: false });
        }
    }, [metric, metric2, mode, windowSize, locFilter, pathname, router, searchParams]);

    // Derive Unique Goalies for Filter (extracted from clean last names)


    // Prepare Data
    const chartData = useMemo(() => {
        // 1. Filter Games First
        const filtered = games.filter(g => {
            if (locFilter === 'Home' && g.home_away !== 'Home') return false;
            if (locFilter === 'Away' && g.home_away !== 'Away') return false;
            return true;
        });

        // 2. Sort Ascending (Game 1 -> Game N)
        const sorted = [...filtered].sort((a, b) => a.game_number - b.game_number);

        const dataPoints = [];

        // Running Totals for Cumulative
        const total = {
            gp: 0, pts: 0,
            gf: 0, ga: 0,
            xgf: 0, xga: 0,
            ppg: 0, ppo: 0, pkg: 0, pko: 0,
            sf: 0, sa: 0,
            cf: 0, ca: 0,
            gsax: 0
        };

        const calcVal = (m: string, t: typeof total) => {
            let val = 0;
            const gp = t.gp;
            if (gp === 0) return 0;

            if (m === 'pts_pct') val = t.pts / (gp * 2);
            if (m === 'gf') val = t.gf / gp;
            if (m === 'ga') val = t.ga / gp;
            if (m === 'gd') val = t.gf - t.ga; // Total Diff
            if (m === 'xgf') val = t.xgf / gp;
            if (m === 'xga') val = t.xga / gp;
            if (m === 'pp') val = t.ppo > 0 ? (t.ppg / t.ppo) * 100 : 0;
            if (m === 'pk') val = t.pko > 0 ? (100 - (t.pkg / t.pko * 100)) : 100;
            if (m === 'sv') val = t.sa > 0 ? (1 - (t.ga / t.sa)) * 100 : 0;
            if (m === 'sh') val = t.sf > 0 ? (t.gf / t.sf) * 100 : 0;
            if (m === 'sf') val = t.sf / gp;
            if (m === 'sa') val = t.sa / gp;
            if (m === 'sd') val = t.sf - t.sa; // Total Diff
            if (m === 'cf') val = t.cf / gp;
            if (m === 'cd') val = t.cf - t.ca; // Total Diff
            if (m === 'gsax') val = t.gsax / gp; // Per Game Rate as before

            return val;
        };

        for (let i = 0; i < sorted.length; i++) {
            const g = sorted[i];

            if (mode === 'cumulative') {
                total.gp++;
                total.pts += g.points;
                total.gf += g.gf;
                total.ga += g.ga;
                total.xgf += g.xgf;
                total.xga += g.xga;
                total.ppg += g.pp_goals;
                total.ppo += g.pp_opps;
                total.pkg += g.pp_goals_against;
                total.pko += g.pk_opps;
                total.sf += g.sf;
                total.sa += g.sa;
                total.cf += g.cf;
                total.ca += g.ca;
                total.gsax += g.gsax;

                const val1 = calcVal(metric, total);
                const val2 = metric2 !== 'none' ? calcVal(metric2, total) : null;

                dataPoints.push({
                    gameNumber: g.game_number,
                    value: val1,
                    value2: val2,
                    game: g
                });

            } else {
                // Rolling Window
                const wSize = windowSize[0];
                const startIdx = Math.max(0, i - wSize + 1);
                const slice = sorted.slice(startIdx, i + 1);

                // Temp Total for Slice
                const st = {
                    gp: slice.length,
                    pts: slice.reduce((a, x) => a + x.points, 0),
                    gf: slice.reduce((a, x) => a + x.gf, 0),
                    ga: slice.reduce((a, x) => a + x.ga, 0),
                    xgf: slice.reduce((a, x) => a + x.xgf, 0),
                    xga: slice.reduce((a, x) => a + x.xga, 0),
                    ppg: slice.reduce((a, x) => a + x.pp_goals, 0),
                    ppo: slice.reduce((a, x) => a + x.pp_opps, 0),
                    pkg: slice.reduce((a, x) => a + x.pp_goals_against, 0),
                    pko: slice.reduce((a, x) => a + x.pk_opps, 0),
                    sf: slice.reduce((a, x) => a + x.sf, 0),
                    sa: slice.reduce((a, x) => a + x.sa, 0),
                    cf: slice.reduce((a, x) => a + x.cf, 0),
                    ca: slice.reduce((a, x) => a + x.ca, 0),
                    gsax: slice.reduce((a, x) => a + x.gsax, 0),
                };

                const val1 = calcVal(metric, st);
                const val2 = metric2 !== 'none' ? calcVal(metric2, st) : null;

                dataPoints.push({
                    gameNumber: g.game_number,
                    value: val1,
                    value2: val2,
                    game: g
                });
            }
        }
        return dataPoints;


    }, [games, metric, metric2, mode, windowSize, locFilter]);




    const activeMetric = METRICS.find(m => m.value === metric) || METRICS[0];
    const secondaryMetric = METRICS.find(m => m.value === metric2);

    // Calculate Domain
    const domainY = useMemo(() => {
        if (!chartData.length) return [0, 'auto'];
        // Exclude first 8 games for scaling to avoid early volatility outliers
        const scalingData = chartData.length > 8 ? chartData.slice(8) : chartData;

        const vals1 = scalingData.map(d => d.value);
        const vals2 = metric2 !== 'none' ? scalingData.map(d => d.value2 as number) : [];
        const allVals = [...vals1, ...vals2];

        // Handle case where allVals might be empty or invalid (though length check guards this mostly)
        if (allVals.length === 0) return [0, 'auto'];

        const min = Math.min(...allVals);
        const max = Math.max(...allVals);
        const padding = (max - min) * 0.1;

        // Force Percentages 0-100 handling logic
        const isPct1 = ['pp', 'pk', 'sh'].includes(metric);
        const isPct2 = metric2 !== 'none' && ['pp', 'pk', 'sh'].includes(metric2);

        if (isPct1 && (isPct2 || metric2 === 'none')) {
            return [Math.max(0, min - padding), Math.min(100, max + padding)];
        }

        return [Math.max(0, min - padding), max + padding];
    }, [chartData, metric, metric2]);

    // Smart Label Density
    const labelInterval = useMemo(() => {
        if (chartData.length <= 10) return 1;
        // Target ~20-25% density
        return Math.floor(chartData.length / (chartData.length * 0.25));
    }, [chartData.length]);

    // Smart Label Density (Secondary) - ~10%
    const labelInterval2 = useMemo(() => {
        if (chartData.length <= 10) return 1;
        return Math.floor(chartData.length / (chartData.length * 0.10));
    }, [chartData.length]);





    return (
        <Card className="w-full bg-black/40 border-white/10 backdrop-blur-md shadow-2xl animate-in fade-in duration-500 font-sans">
            <CardHeader className="pb-4 border-b border-white/5">
                <CardTitle className="text-white tracking-wider uppercase text-sm font-bold">Team Performance Analysis</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6 pt-6 relative">
                {/* Floating Controls Bar */}
                <div className="absolute top-4 right-4 z-20 flex flex-wrap items-end gap-x-4 gap-y-2 bg-black/80 backdrop-blur-md p-3 rounded-xl border border-white/10 shadow-xl max-w-[90%] justify-end transition-all duration-300 hover:bg-black/90">

                    {/* Metric 1 */}
                    <div className="flex flex-col gap-1 min-w-[140px]">
                        <label className="text-[9px] uppercase text-gray-400 font-bold tracking-widest pl-1">Metric</label>
                        <Select value={metric} onValueChange={setMetric}>
                            <SelectTrigger className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10 transition-colors h-7 text-[10px] font-bold font-mono">
                                <SelectValue placeholder="Metric" />
                            </SelectTrigger>
                            <SelectContent className="bg-black/95 border-white/10 text-white backdrop-blur-xl font-mono max-h-[300px]">
                                {METRICS.map(m => (
                                    <SelectItem key={m.value} value={m.value} className="focus:bg-white/10 focus:text-white cursor-pointer text-[10px]">{m.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Metric 2 */}
                    <div className="flex flex-col gap-1 min-w-[140px]">
                        <label className="text-[9px] uppercase text-gray-400 font-bold tracking-widest pl-1">Compare</label>
                        <Select value={metric2} onValueChange={setMetric2}>
                            <SelectTrigger className="w-full bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 transition-colors h-7 text-[10px] font-bold font-mono">
                                <SelectValue placeholder="Compare..." />
                            </SelectTrigger>
                            <SelectContent className="bg-black/95 border-white/10 text-white backdrop-blur-xl font-mono max-h-[300px]">
                                <SelectItem value="none" className="text-gray-500 italic text-[10px]">None</SelectItem>
                                {METRICS.map(m => (
                                    <SelectItem key={m.value} value={m.value} className="focus:bg-white/10 focus:text-white cursor-pointer text-[10px]">{m.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Filters Row Compact */}
                    <div className="flex gap-2">
                        {/* Location */}
                        <div className="flex flex-col gap-1 w-[80px]">
                            <label className="text-[9px] uppercase text-gray-400 font-bold tracking-widest pl-1">Loc</label>
                            <Select value={locFilter} onValueChange={(v: 'All' | 'Home' | 'Away') => setLocFilter(v)}>
                                <SelectTrigger className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10 transition-colors h-7 text-[10px] font-bold font-mono">
                                    <SelectValue placeholder="Loc" />
                                </SelectTrigger>
                                <SelectContent className="bg-black/95 border-white/10 text-white backdrop-blur-xl font-mono">
                                    <SelectItem value="All" className="focus:bg-white/10 cursor-pointer text-[10px]">All</SelectItem>
                                    <SelectItem value="Home" className="focus:bg-white/10 cursor-pointer text-[10px]">Home</SelectItem>
                                    <SelectItem value="Away" className="focus:bg-white/10 cursor-pointer text-[10px]">Away</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Mode Toggle Compact */}
                    <div className="flex flex-col gap-1">
                        <label className="text-[9px] uppercase text-gray-400 font-bold tracking-widest pl-1">Mode</label>
                        <Tabs value={mode} onValueChange={(val) => setMode(val as 'cumulative' | 'rolling')} className="w-[140px]">
                            <TabsList className="grid w-full grid-cols-2 bg-white/5 border border-white/5 h-7 p-0.5">
                                <TabsTrigger value="cumulative" className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-gray-500 text-[9px] font-bold uppercase font-mono">Total</TabsTrigger>
                                <TabsTrigger value="rolling" className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-gray-500 text-[9px] font-bold uppercase font-mono">Roll</TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>

                    {/* Rolling Slider Compact */}
                    {mode === 'rolling' && (
                        <div className="flex flex-col gap-1 w-[100px] animate-in slide-in-from-right-4 fade-in duration-300">
                            <div className="flex justify-between items-end">
                                <label className="text-[9px] uppercase text-gray-400 font-bold tracking-widest">Win: {windowSize[0]}</label>
                            </div>
                            <Slider
                                defaultValue={[10]}
                                max={25}
                                min={3}
                                step={1}
                                value={windowSize}
                                onValueChange={setWindowSize}
                                className="w-full [&>.relative>.absolute]:bg-blue-500 h-4"
                            />
                        </div>
                    )}
                </div>

                {/* Chart Area */}
                <div className="w-full h-[450px] md:h-[550px] bg-black/20 border border-white/5 rounded-xl p-4 md:p-6 relative shadow-inner overflow-hidden">
                    {/* Grid Background Effect */}
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>

                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 20, right: 30, left: -10, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={primaryColor} stopOpacity={0.4} />
                                    <stop offset="95%" stopColor={primaryColor} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                            <XAxis
                                dataKey="gameNumber"
                                stroke="#444"
                                tick={{ fill: '#666', fontSize: 10, fontWeight: 'bold' }}
                                tickLine={false}
                                axisLine={false}
                                interval={labelInterval} // Smart Density
                                dy={10}
                            />
                            <YAxis
                                stroke="#444"
                                tick={{ fill: '#666', fontSize: 10, fontWeight: 'bold' }}
                                tickLine={false}
                                axisLine={false}
                                domain={domainY as [number, number]}
                                dx={-10}
                                allowDataOverflow={true} // Force clipping of outliers
                            />
                            <Tooltip content={<CustomTooltip activeMetric={activeMetric} secondaryMetric={secondaryMetric} primaryColor={primaryColor} />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1, strokeDasharray: '4 4' }} />

                            {/* Primary Metric */}
                            <Area
                                type="monotone"
                                dataKey="value"
                                stroke={primaryColor}
                                strokeWidth={3}
                                fillOpacity={1}
                                fill="url(#colorMetric)"
                                activeDot={{ r: 6, strokeWidth: 0, fill: '#fff', className: 'animate-pulse' }}
                                animationDuration={2000}
                                animationEasing="ease-in-out"
                                label={(props) => {
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    const { x, y, index, value } = props as any;
                                    const isLast = index === chartData.length - 1;
                                    const showLabel = isLast || (index % labelInterval === 0);
                                    if (!showLabel) return null;

                                    const fmt = activeMetric.format(value);
                                    return (
                                        <g>
                                            <rect x={x - 20} y={y - 28} width="40" height="20" rx="4" fill={primaryColor} />
                                            {/* Changed text fill to #fff for better contrast on dark pill */}
                                            <text x={x} y={y - 14} fill="#fff" fontSize={10} fontWeight="bold" textAnchor="middle">
                                                {fmt}{activeMetric.suffix}
                                            </text>
                                        </g>
                                    );
                                }}
                            />

                            {/* Secondary Metric (if selected) */}
                            {metric2 !== 'none' && (
                                <Area
                                    type="monotone"
                                    dataKey="value2"
                                    stroke="#a1a1aa" // Zinc 400 (Bright Grey)
                                    strokeWidth={2}
                                    strokeDasharray="5 5"
                                    fill="none"
                                    activeDot={{ r: 4, strokeWidth: 0, fill: '#a1a1aa' }}
                                    label={(props) => {
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        const { x, y, index, value } = props as any;
                                        const isLast = index === chartData.length - 1;
                                        // Show secondary label at restricted logic (10% density)
                                        const showLabel = isLast || (index % labelInterval2 === 0);
                                        if (!showLabel || value === null) return null;

                                        const fmt = secondaryMetric ? secondaryMetric.format(value) : value;
                                        return (
                                            <g>
                                                <rect x={x - 20} y={y - 28} width="40" height="20" rx="4" fill="#52525b" />
                                                <text x={x} y={y - 14} fill="#fff" fontSize={10} fontWeight="bold" textAnchor="middle">
                                                    {fmt}{secondaryMetric?.suffix}
                                                </text>
                                            </g>
                                        );
                                    }}
                                />
                            )}



                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
};

export default TeamChart;
