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
    { label: 'xGoals For / GP', value: 'xgf', suffix: '', format: (v: number) => v.toFixed(2) },
    { label: 'xGoals Against / GP', value: 'xga', suffix: '', format: (v: number) => v.toFixed(2) },
    { label: 'Power Play %', value: 'pp', suffix: '%', format: (v: number) => v.toFixed(1) },
    { label: 'Penalty Kill %', value: 'pk', suffix: '%', format: (v: number) => v.toFixed(1) },
    { label: 'Save %', value: 'sv', suffix: '%', format: (v: number) => (v * 100).toFixed(1) },
    { label: 'Shooting %', value: 'sh', suffix: '%', format: (v: number) => v.toFixed(1) },
    { label: 'Shots For / GP', value: 'sf', suffix: '', format: (v: number) => v.toFixed(1) },
    { label: 'Shots Against / GP', value: 'sa', suffix: '', format: (v: number) => v.toFixed(1) },
    { label: 'Corsi For / GP', value: 'cf', suffix: '', format: (v: number) => v.toFixed(1) },
    { label: 'GSAx / GP', value: 'gsax', suffix: '', format: (v: number) => v.toFixed(2) }
];

const TeamChart: React.FC<TeamChartProps> = ({ games, primaryColor }) => {
    const [metric, setMetric] = useState(METRICS[0].value);
    const [mode, setMode] = useState<'cumulative' | 'rolling'>('cumulative');
    const [windowSize, setWindowSize] = useState([10]); // Default rolling window (array for Slider)

    // Prepare Data
    const chartData = useMemo(() => {
        // Sort Ascending (Game 1 -> Game N)
        const sorted = [...games].sort((a, b) => a.game_number - b.game_number);

        const dataPoints = [];

        // Running Totals for Cumulative
        let total_pts = 0, total_gp = 0;
        let total_gf = 0, total_ga = 0;
        let total_xgf = 0, total_xga = 0;
        let total_ppg = 0, total_ppo = 0;
        let total_pkg_ag = 0, total_pko = 0;
        let total_sf = 0, total_sa = 0;
        let total_cf = 0;
        let total_gsax = 0;

        for (let i = 0; i < sorted.length; i++) {
            const g = sorted[i];

            if (mode === 'cumulative') {
                total_gp++;
                total_pts += g.points;
                total_gf += g.gf;
                total_ga += g.ga;
                total_xgf += g.xgf;
                total_xga += g.xga;
                total_ppg += g.pp_goals;
                total_ppo += g.pp_opps;
                total_pkg_ag += g.pp_goals_against;
                total_pko += g.pk_opps;
                total_sf += g.sf;
                total_sa += g.sa;
                total_cf += g.cf;
                total_gsax += g.gsax;

                // Calculate Value
                let val = 0;
                if (metric === 'pts_pct') val = total_pts / (total_gp * 2);
                if (metric === 'gf') val = total_gf / total_gp;
                if (metric === 'ga') val = total_ga / total_gp;
                if (metric === 'xgf') val = total_xgf / total_gp;
                if (metric === 'xga') val = total_xga / total_gp;
                if (metric === 'pp') val = total_ppo > 0 ? (total_ppg / total_ppo) * 100 : 0;
                if (metric === 'pk') val = total_pko > 0 ? (100 - (total_pkg_ag / total_pko * 100)) : 100; // Correct logic: 100 - (GA/Opp * 100)
                if (metric === 'sf') val = total_sf / total_gp;
                if (metric === 'sa') val = total_sa / total_gp;
                if (metric === 'cf') val = total_cf / total_gp;
                if (metric === 'gsax') val = total_gsax / total_gp;
                // SV% = 1 - (GA / SA) (Approx)
                if (metric === 'sv') val = total_sa > 0 ? (1 - (total_ga / total_sa)) : 0; // Raw 0-1
                if (metric === 'sh') val = total_sf > 0 ? (total_gf / total_sf) * 100 : 0;

                dataPoints.push({
                    gameNumber: g.game_number,
                    value: val,
                    game: g // Store full game for tooltip
                });

            } else {
                // Rolling Window
                // Need previous N games (inclusive of current)
                // Slice [max(0, i - window + 1), i + 1]
                const wSize = windowSize[0];
                const startIdx = Math.max(0, i - wSize + 1);
                // Only show point if we have enough data? Or show partial?
                // User said: "If they chose 5 game rolling, it would show the team's PP% rolling over the last five games."
                // Usually partial is okay at start, or just noise.
                // Let's allow partial but maybe visualize it differently? No, keep simple.

                const slice = sorted.slice(startIdx, i + 1);
                const s_gp = slice.length;

                const s_pts = slice.reduce((a, x) => a + x.points, 0);
                const s_gf = slice.reduce((a, x) => a + x.gf, 0);
                const s_ga = slice.reduce((a, x) => a + x.ga, 0);
                const s_xgf = slice.reduce((a, x) => a + x.xgf, 0);
                const s_xga = slice.reduce((a, x) => a + x.xga, 0);
                const s_ppg = slice.reduce((a, x) => a + x.pp_goals, 0);
                const s_ppo = slice.reduce((a, x) => a + x.pp_opps, 0);
                const s_pkg = slice.reduce((a, x) => a + x.pp_goals_against, 0);
                const s_pko = slice.reduce((a, x) => a + x.pk_opps, 0);
                const s_sf = slice.reduce((a, x) => a + x.sf, 0);
                const s_sa = slice.reduce((a, x) => a + x.sa, 0);
                const s_cf = slice.reduce((a, x) => a + x.cf, 0);
                const s_gsax = slice.reduce((a, x) => a + x.gsax, 0);

                let val = 0;
                if (metric === 'pts_pct') val = s_pts / (s_gp * 2);
                if (metric === 'gf') val = s_gf / s_gp;
                if (metric === 'ga') val = s_ga / s_gp;
                if (metric === 'xgf') val = s_xgf / s_gp;
                if (metric === 'xga') val = s_xga / s_gp;
                if (metric === 'pp') val = s_ppo > 0 ? (s_ppg / s_ppo) * 100 : 0;
                if (metric === 'pk') val = s_pko > 0 ? (100 - (s_pkg / s_pko * 100)) : 100;
                if (metric === 'sf') val = s_sf / s_gp;
                if (metric === 'sa') val = s_sa / s_gp;
                if (metric === 'cf') val = s_cf / s_gp;
                if (metric === 'gsax') val = s_gsax / s_gp;
                if (metric === 'sv') val = s_sa > 0 ? (1 - (s_ga / s_sa)) : 0;
                if (metric === 'sh') val = s_sf > 0 ? (s_gf / s_sf) * 100 : 0;

                dataPoints.push({
                    gameNumber: g.game_number,
                    value: val,
                    game: g
                });
            }
        }
        return dataPoints;
    }, [games, metric, mode, windowSize]);

    const activeMetric = METRICS.find(m => m.value === metric) || METRICS[0];

    // Calculate domain for Y axis to make chart look dynamic
    const domainY = useMemo(() => {
        if (!chartData.length) return [0, 'auto'];
        // Exclude first 6 games for scaling to avoid early volatility outliers
        const scalingData = chartData.length > 6 ? chartData.slice(6) : chartData;
        const values = scalingData.map(d => d.value);

        const min = Math.min(...values);
        const max = Math.max(...values);

        // Add padding
        const padding = (max - min) * 0.1;

        // Check if percentage (0-100 or 0-1)
        if (['pp', 'pk', 'sh'].includes(metric)) {
            return [Math.max(0, min - padding), Math.min(100, max + padding)];
        }
        if (metric === 'sv') {
            // sv is 0-1 (e.g. 0.9) but displayed as %. Not stored as % here?
            // Wait, in my loop `val` for SV is 0-1 in logic: (1 - ga/sa).
            // But Format func expects multiplies 100.
            // LineChart data needs to be raw? Or consistent?
            // Let's multiply by 100 in the loop so the graph lines are easier (90 vs 0.9).
            // NO, logic above says: val is 0-1 for sv.
            return [Math.max(0, min - padding), Math.min(1, max + padding)];
        }

        return [Math.max(0, min - padding), max + padding];

    }, [chartData, metric]);

    // Fix SV Logic: 
    // In Data Prep: SV is 0-1 range.
    // In Rendering: If SV, we might want to scale to 0-100 for tooltip to match others?
    // Actually standard area charts with 0.9 vs 4.0 (GF) are fine if domain is specific.
    // But mixing percentages: PP/PK are 0-100 in my logic. SV is 0-1.
    // Let's normalize SV to 0-100 in data prep for consistency?
    // Metric config says: format (v) => (v * 100). So it expects 0-1 input for formatting. 
    // Data prep returns 0-1. Correct. 
    // PP/PK data prep returns 0-100. Metric config format just v.toFixed.
    // This is inconsistent. Let's fix loop to return 0-100 for SV too?
    // Let's stick to: All Percents are 0-100 in data for easier Y-Axis reading.

    // Re-check Loop for SV:
    // ... val = total_sa > 0 ? (1 - (total_ga / total_sa)) : 0; 
    // Let's change to * 100 so it aligns with PP/PK on Y Axis range (0-100) mostly.

    // Custom Tooltip
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            const g = data.game;
            // Value Formatting
            const fmt = activeMetric.format(data.value);
            const suffix = activeMetric.suffix;

            return (
                <div className="bg-black/90 border border-white/20 p-3 rounded-lg shadow-xl backdrop-blur-md min-w-[200px]">
                    <div className="text-[10px] text-gray-400 font-mono mb-1">{g.date} • Game {g.game_number}</div>
                    <div className="text-sm font-bold text-white mb-2 pb-2 border-b border-white/10 flex justify-between">
                        <span>{activeMetric.label}</span>
                        <span className="text-neon-blue">{fmt}{suffix}</span>
                    </div>

                    {/* Game Details */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-300">
                        <div className="col-span-2 font-bold text-white mb-1">
                            {g.home_away === 'Home' ? 'vs' : '@'} {g.opponent} ({g.result})
                        </div>
                        <div className="col-span-2 text-white font-mono text-xs mb-2">
                            {g.score}
                        </div>

                        <div className="text-gray-500">Starter:</div>
                        <div className="text-right text-white truncate">{g.starting_goalie.split(' ')[1]}</div>

                        <div className="text-gray-500">GF / GA:</div>
                        <div className="text-right text-white">{g.gf} / {g.ga}</div>

                        <div className="text-gray-500">xGF / xGA:</div>
                        <div className="text-right text-white">{g.xgf.toFixed(2)} / {g.xga.toFixed(2)}</div>
                    </div>
                </div>
            );
        }
        return null;
    };


    return (
        <Card className="w-full bg-black/40 border-white/10 backdrop-blur-md shadow-2xl animate-in fade-in duration-500">
            <CardHeader className="pb-4 border-b border-white/5">
                <CardTitle className="text-white tracking-wider uppercase text-sm font-bold">Team Performance Analysis</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6 pt-6">
                {/* Controls Bar */}
                <div className="flex flex-wrap items-end gap-6">

                    {/* Metric Selector */}
                    <div className="flex flex-col gap-2 min-w-[240px]">
                        <label className="text-[10px] uppercase text-gray-500 font-bold tracking-widest pl-1">Metric</label>
                        <Select value={metric} onValueChange={setMetric}>
                            <SelectTrigger className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10 transition-colors h-10 font-bold text-sm">
                                <SelectValue placeholder="Select Metric" />
                            </SelectTrigger>
                            <SelectContent className="bg-black/95 border-white/10 text-white backdrop-blur-xl">
                                {METRICS.map(m => (
                                    <SelectItem key={m.value} value={m.value} className="focus:bg-white/10 focus:text-white cursor-pointer">{m.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="w-px h-10 bg-white/10 mx-2 hidden md:block"></div>

                    {/* Mode Toggle */}
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] uppercase text-gray-500 font-bold tracking-widest pl-1">View Mode</label>
                        <Tabs value={mode} onValueChange={(val) => setMode(val as any)} className="w-[220px]">
                            <TabsList className="grid w-full grid-cols-2 bg-white/5 border border-white/5 h-10 p-1">
                                <TabsTrigger value="cumulative" className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-gray-400 text-xs font-bold uppercase">Cumulative</TabsTrigger>
                                <TabsTrigger value="rolling" className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-gray-400 text-xs font-bold uppercase">Rolling</TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>

                    {/* Rolling Slider */}
                    {mode === 'rolling' && (
                        <div className="flex flex-col gap-3 flex-1 min-w-[200px] animate-in slide-in-from-left-4 fade-in duration-300 pb-1">
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
                                className="w-full [&>.relative>.absolute]:bg-blue-500" // Custom handle color override if needed
                            />
                        </div>
                    )}
                </div>

                {/* Chart Area */}
                <div className="w-full h-[400px] md:h-[500px] bg-black/20 border border-white/5 rounded-xl p-4 md:p-6 relative shadow-inner overflow-hidden">
                    {/* Grid Background Effect */}
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>

                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 20, right: 10, left: -20, bottom: 0 }}>
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
                                interval="preserveStartEnd"
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
                                    if (!isLast) return null;

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
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
};

export default TeamChart;
