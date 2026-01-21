"use client";

import React, { useState, useMemo } from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area,
    ReferenceLine
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
    { label: 'Penalty Kill %', value: 'pk', suffix: '%', format: (v: number) => v.toFixed(1) },
    { label: 'Save %', value: 'sv', suffix: '%', format: (v: number) => (v * 100).toFixed(1) },
    { label: 'Shooting %', value: 'sh', suffix: '%', format: (v: number) => v.toFixed(1) },
    { label: 'Shots For / GP', value: 'sf', suffix: '', format: (v: number) => v.toFixed(1) },
    { label: 'Shots Against / GP', value: 'sa', suffix: '', format: (v: number) => v.toFixed(1) },
    { label: 'Shot Diff', value: 'sd', suffix: '', format: (v: number) => (v > 0 ? '+' : '') + v.toFixed(1) },
    { label: 'Corsi For / GP', value: 'cf', suffix: '', format: (v: number) => v.toFixed(1) },
    { label: 'Corsi Diff', value: 'cd', suffix: '', format: (v: number) => (v > 0 ? '+' : '') + v.toFixed(1) },
    { label: 'GSAx / GP', value: 'gsax', suffix: '', format: (v: number) => v.toFixed(2) }
];

const TeamChart: React.FC<TeamChartProps> = ({ games, primaryColor }) => {
    const [metric, setMetric] = useState(METRICS[0].value);
    const [metric2, setMetric2] = useState<string>('none');
    const [mode, setMode] = useState<'cumulative' | 'rolling'>('cumulative');
    const [windowSize, setWindowSize] = useState([10]);
    const [location, setLocation] = useState<'All' | 'Home' | 'Away'>('All');
    const [goalie, setGoalie] = useState<string>('All');

    // Derive Unique Goalies for Filter (extracted from clean last names)
    const uniqueGoalies = useMemo(() => {
        const goalies = new Set<string>();
        games.forEach(g => {
            const name = g.starting_goalie.split(' ').pop() || g.starting_goalie;
            goalies.add(name);
        });
        return Array.from(goalies).sort();
    }, [games]);

    // Prepare Data
    const chartData = useMemo(() => {
        // 1. Filter Games First
        let filtered = games.filter(g => {
            if (location === 'Home' && g.home_away !== 'Home') return false;
            if (location === 'Away' && g.home_away !== 'Away') return false;
            if (goalie !== 'All') {
                const gName = g.starting_goalie.split(' ').pop() || g.starting_goalie;
                if (gName !== goalie) return false;
            }
            return true;
        });

        // 2. Sort Ascending (Game 1 -> Game N)
        const sorted = [...filtered].sort((a, b) => a.game_number - b.game_number);

        const dataPoints = [];

        // Running Totals for Cumulative
        // Note: For differentials (GD, SD, CD), we need underlying raw diffs.
        // GD = GF - GA. Cumulative: Sum(GF) - Sum(GA).
        // SD = SF - SA.
        // CD = CF - CA.
        let total = {
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
            if (m === 'sv') val = t.sa > 0 ? (1 - (t.ga / t.sa)) : 0;
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
    }, [games, metric, metric2, mode, windowSize, location, goalie]);

    const activeMetric = METRICS.find(m => m.value === metric) || METRICS[0];
    const secondaryMetric = METRICS.find(m => m.value === metric2);

    // Calculate Domain
    const domainY = useMemo(() => {
        if (!chartData.length) return [0, 'auto'];
        const scalingData = chartData.length > 6 ? chartData.slice(6) : chartData;

        const vals1 = scalingData.map(d => d.value);
        const vals2 = metric2 !== 'none' ? scalingData.map(d => d.value2 as number) : [];
        const allVals = [...vals1, ...vals2];

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


    // Custom Tooltip
    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            const g = data.game;
            const fmt1 = activeMetric.format(data.value);
            const fmt2 = secondaryMetric ? secondaryMetric.format(data.value2) : null;

            return (
                <div className="bg-black/90 border border-white/20 p-3 rounded-lg shadow-xl backdrop-blur-md min-w-[200px] font-sans">
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


    return (
        <Card className="w-full bg-black/40 border-white/10 backdrop-blur-md shadow-2xl animate-in fade-in duration-500 font-sans">
            <CardHeader className="pb-4 border-b border-white/5">
                <CardTitle className="text-white tracking-wider uppercase text-sm font-bold">Team Performance Analysis</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6 pt-6">
                {/* Controls Bar */}
                <div className="flex flex-wrap items-end gap-x-6 gap-y-4">

                    {/* Metric 1 */}
                    <div className="flex flex-col gap-2 min-w-[200px]">
                        <label className="text-[10px] uppercase text-gray-500 font-bold tracking-widest pl-1">Primary Metric</label>
                        <Select value={metric} onValueChange={setMetric}>
                            <SelectTrigger className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10 transition-colors h-9 font-bold text-sm font-sans">
                                <SelectValue placeholder="Select Metric" />
                            </SelectTrigger>
                            <SelectContent className="bg-black/95 border-white/10 text-white backdrop-blur-xl font-sans max-h-[300px]">
                                {METRICS.map(m => (
                                    <SelectItem key={m.value} value={m.value} className="focus:bg-white/10 focus:text-white cursor-pointer font-sans text-xs">{m.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Metric 2 */}
                    <div className="flex flex-col gap-2 min-w-[200px] border-l border-white/5 pl-6">
                        <label className="text-[10px] uppercase text-gray-500 font-bold tracking-widest pl-1">Secondary (Optional)</label>
                        <Select value={metric2} onValueChange={setMetric2}>
                            <SelectTrigger className="w-full bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 transition-colors h-9 font-bold text-sm font-sans">
                                <SelectValue placeholder="Compare..." />
                            </SelectTrigger>
                            <SelectContent className="bg-black/95 border-white/10 text-white backdrop-blur-xl font-sans max-h-[300px]">
                                <SelectItem value="none" className="text-gray-500 italic text-xs">None</SelectItem>
                                {METRICS.map(m => (
                                    <SelectItem key={m.value} value={m.value} className="focus:bg-white/10 focus:text-white cursor-pointer font-sans text-xs">{m.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="w-px h-10 bg-white/10 mx-2 hidden md:block"></div>

                    {/* Filters Row */}
                    <div className="flex gap-4">
                        {/* Location */}
                        <div className="flex flex-col gap-2 w-[100px]">
                            <label className="text-[10px] uppercase text-gray-500 font-bold tracking-widest pl-1">Loc</label>
                            <Select value={location} onValueChange={(v: any) => setLocation(v)}>
                                <SelectTrigger className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10 transition-colors h-9 font-bold text-xs font-sans">
                                    <SelectValue placeholder="Loc" />
                                </SelectTrigger>
                                <SelectContent className="bg-black/95 border-white/10 text-white backdrop-blur-xl font-sans">
                                    <SelectItem value="All" className="focus:bg-white/10 cursor-pointer text-xs">All</SelectItem>
                                    <SelectItem value="Home" className="focus:bg-white/10 cursor-pointer text-xs">Home</SelectItem>
                                    <SelectItem value="Away" className="focus:bg-white/10 cursor-pointer text-xs">Away</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Goalie */}
                        <div className="flex flex-col gap-2 w-[140px]">
                            <label className="text-[10px] uppercase text-gray-500 font-bold tracking-widest pl-1">Goalie</label>
                            <Select value={goalie} onValueChange={setGoalie}>
                                <SelectTrigger className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10 transition-colors h-9 font-bold text-xs font-sans">
                                    <SelectValue placeholder="All" />
                                </SelectTrigger>
                                <SelectContent className="bg-black/95 border-white/10 text-white backdrop-blur-xl font-sans">
                                    <SelectItem value="All" className="focus:bg-white/10 cursor-pointer text-xs">All Goalies</SelectItem>
                                    {uniqueGoalies.map(g => (
                                        <SelectItem key={g} value={g} className="focus:bg-white/10 cursor-pointer text-xs">{g}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="w-px h-10 bg-white/10 mx-2 hidden md:block"></div>

                    {/* Mode Toggle */}
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] uppercase text-gray-500 font-bold tracking-widest pl-1">View Mode</label>
                        <Tabs value={mode} onValueChange={(val) => setMode(val as any)} className="w-[180px]">
                            <TabsList className="grid w-full grid-cols-2 bg-white/5 border border-white/5 h-9 p-1">
                                <TabsTrigger value="cumulative" className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-gray-400 text-[10px] font-bold uppercase font-sans">Cumulative</TabsTrigger>
                                <TabsTrigger value="rolling" className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-gray-400 text-[10px] font-bold uppercase font-sans">Rolling</TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>

                    {/* Rolling Slider */}
                    {mode === 'rolling' && (
                        <div className="flex flex-col gap-3 flex-1 min-w-[150px] animate-in slide-in-from-left-4 fade-in duration-300 pb-1">
                            <div className="flex justify-between items-end">
                                <label className="text-[10px] uppercase text-gray-500 font-bold tracking-widest">Window</label>
                                <span className="text-xs font-mono text-neon-blue font-bold px-2 py-0.5 bg-blue-500/20 rounded border border-blue-500/30 text-blue-300">{windowSize[0]} Games</span>
                            </div>
                            <Slider
                                defaultValue={[10]}
                                max={25}
                                min={3}
                                step={1}
                                value={windowSize}
                                onValueChange={setWindowSize}
                                className="w-full [&>.relative>.absolute]:bg-blue-500"
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
                                domain={domainY as any}
                                dx={-10}
                            />
                            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1, strokeDasharray: '4 4' }} />

                            {/* Primary Metric */}
                            <Area
                                type="monotone"
                                dataKey="value"
                                stroke={primaryColor}
                                strokeWidth={3}
                                fillOpacity={1}
                                fill="url(#colorMetric)"
                                activeDot={{ r: 6, strokeWidth: 0, fill: '#fff', className: 'animate-pulse' }}
                                label={(props: any) => {
                                    const { x, y, index, value } = props;
                                    const isLast = index === chartData.length - 1;
                                    const showLabel = isLast || (index % labelInterval === 0);
                                    if (!showLabel) return null;

                                    const fmt = activeMetric.format(value);
                                    return (
                                        <g>
                                            <rect x={x - 20} y={y - 28} width="40" height="20" rx="4" fill={primaryColor} />
                                            <text x={x} y={y - 14} fill="#000" fontSize={10} fontWeight="bold" textAnchor="middle">
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
