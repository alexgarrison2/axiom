"use client";

import React, { useState, useMemo, useEffect } from 'react';
import Image from 'next/image';
import {
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area,
    ReferenceLine
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';

interface GameLog {
    game_id: string;
    game_number: number;
    date: string;
    opponent: string;
    result: string;
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
    time_leading: number;
    time_trailing: number;
    time_tied: number;
    control_score: number;
    hdf: number;
    hda: number;
}

interface TeamChartProps {
    games: GameLog[];
    leagueGames?: GameLog[];
    primaryColor: string;
    teamName?: string;
    teamLogoUrl?: string;
}

const METRICS = [
    { label: 'Points %',          value: 'pts_pct',         suffix: '',  format: (v: number) => v.toFixed(3).replace(/^0+/, '') },
    { label: 'Goals For / GP',    value: 'gf',              suffix: '',  format: (v: number) => v.toFixed(2) },
    { label: 'Goals Against / GP',value: 'ga',              suffix: '',  format: (v: number) => v.toFixed(2) },
    { label: 'Goal Diff',         value: 'gd',              suffix: '',  format: (v: number) => (v > 0 ? '+' : '') + v.toFixed(1) },
    { label: 'xGoals For / GP',   value: 'xgf',             suffix: '',  format: (v: number) => v.toFixed(2) },
    { label: 'xGoals Against / GP',value: 'xga',            suffix: '',  format: (v: number) => v.toFixed(2) },
    { label: 'xG Diff',           value: 'xgd',             suffix: '',  format: (v: number) => (v > 0 ? '+' : '') + v.toFixed(1) },
    { label: 'HDF / G',           value: 'hdf_pg',          suffix: '',  format: (v: number) => v.toFixed(2) },
    { label: 'HDA / G',           value: 'hda_pg',          suffix: '',  format: (v: number) => v.toFixed(2) },
    { label: 'HD Diff',           value: 'hd_diff',         suffix: '',  format: (v: number) => (v > 0 ? '+' : '') + v.toFixed(1) },
    { label: 'Control',           value: 'control',         suffix: '',  format: (v: number) => v.toFixed(3) },
    { label: 'Time Leading / G',  value: 'time_leading_pg', suffix: 'm', format: (v: number) => v.toFixed(1) },
    { label: 'Time Trailing / G', value: 'time_trailing_pg',suffix: 'm', format: (v: number) => v.toFixed(1) },
    { label: 'Time Tied / G',     value: 'time_tied_pg',    suffix: 'm', format: (v: number) => v.toFixed(1) },
    { label: 'Power Play %',      value: 'pp',              suffix: '%', format: (v: number) => v.toFixed(1) },
    { label: 'Penalty Kill %',    value: 'pk',              suffix: '%', format: (v: number) => v.toFixed(1) },
    { label: 'True GF / GP',      value: 'true_gf',         suffix: '',  format: (v: number) => v.toFixed(2) },
    { label: 'True GA / GP',      value: 'true_ga',         suffix: '',  format: (v: number) => v.toFixed(2) },
    { label: 'True Goal Diff',    value: 'true_gd',         suffix: '',  format: (v: number) => (v > 0 ? '+' : '') + v.toFixed(1) },
    { label: 'PP Leverage',       value: 'pp_lev',          suffix: '%', format: (v: number) => v.toFixed(1) },
    { label: 'PK Leverage',       value: 'pk_lev',          suffix: '%', format: (v: number) => v.toFixed(1) },
    { label: 'Save %',            value: 'sv',              suffix: '%', format: (v: number) => v.toFixed(1) },
    { label: 'Shooting %',        value: 'sh',              suffix: '%', format: (v: number) => v.toFixed(1) },
    { label: 'Shots For / GP',    value: 'sf',              suffix: '',  format: (v: number) => v.toFixed(1) },
    { label: 'Shots Against / GP',value: 'sa',              suffix: '',  format: (v: number) => v.toFixed(1) },
    { label: 'Shot Diff',         value: 'sd',              suffix: '',  format: (v: number) => (v > 0 ? '+' : '') + v.toFixed(1) },
    { label: 'Corsi For / GP',    value: 'cf',              suffix: '',  format: (v: number) => v.toFixed(1) },
    { label: 'Corsi Diff',        value: 'cd',              suffix: '',  format: (v: number) => (v > 0 ? '+' : '') + v.toFixed(1) },
    { label: 'GSAx / GP',         value: 'gsax',            suffix: '',  format: (v: number) => v.toFixed(2) },
];

// Metrics that can legitimately go below zero
const NEGATIVE_OK = new Set(['gd', 'xgd', 'sd', 'cd', 'true_gd', 'hd_diff', 'gsax']);

interface MetricType {
    label: string;
    value: string;
    suffix: string;
    format: (v: number) => string;
}

// ─── Data helpers (module-level, no hooks) ───────────────────────────────────

type Total = {
    gp: number; pts: number;
    gf: number; ga: number;
    xgf: number; xga: number;
    ppg: number; ppo: number; pkg: number; pko: number;
    sf: number; sa: number; cf: number; ca: number;
    gsax: number; en_gf: number; en_ga: number;
    hdf: number; hda: number;
    time_leading: number; time_trailing: number; time_tied: number;
    control_sum: number;
};

function buildTotal(slice: GameLog[]): Total {
    const t: Total = {
        gp: 0, pts: 0, gf: 0, ga: 0, xgf: 0, xga: 0,
        ppg: 0, ppo: 0, pkg: 0, pko: 0,
        sf: 0, sa: 0, cf: 0, ca: 0,
        gsax: 0, en_gf: 0, en_ga: 0,
        hdf: 0, hda: 0,
        time_leading: 0, time_trailing: 0, time_tied: 0,
        control_sum: 0,
    };
    for (const g of slice) {
        t.gp++;
        t.pts += g.points;
        t.gf += g.gf;          t.ga += g.ga;
        t.xgf += g.xgf;        t.xga += g.xga;
        t.ppg += g.pp_goals;   t.ppo += g.pp_opps;
        t.pkg += g.pp_goals_against; t.pko += g.pk_opps;
        t.sf += g.sf;          t.sa += g.sa;
        t.cf += g.cf;          t.ca += g.ca;
        t.gsax += g.gsax;
        t.en_gf += g.en_gf;   t.en_ga += g.en_ga;
        t.hdf += g.hdf;        t.hda += g.hda;
        t.time_leading  += g.time_leading  || 0;
        t.time_trailing += g.time_trailing || 0;
        t.time_tied     += g.time_tied     || 0;
        t.control_sum   += g.control_score || 0;
    }
    return t;
}

function calcVal(m: string, t: Total): number {
    const { gp } = t;
    if (gp === 0) return 0;
    if (m === 'pts_pct')          return t.pts / (gp * 2);
    if (m === 'gf')               return t.gf / gp;
    if (m === 'ga')               return t.ga / gp;
    if (m === 'gd')               return t.gf - t.ga;
    if (m === 'xgf')              return t.xgf / gp;
    if (m === 'xga')              return t.xga / gp;
    if (m === 'xgd')              return t.xgf - t.xga;
    if (m === 'pp')               return t.ppo > 0 ? (t.ppg / t.ppo) * 100 : 0;
    if (m === 'pk')               return t.pko > 0 ? 100 - (t.pkg / t.pko) * 100 : 100;
    if (m === 'sv')               return t.sa > 0 ? (1 - t.ga / t.sa) * 100 : 0;
    if (m === 'sh')               return t.sf > 0 ? (t.gf / t.sf) * 100 : 0;
    if (m === 'sf')               return t.sf / gp;
    if (m === 'sa')               return t.sa / gp;
    if (m === 'sd')               return t.sf - t.sa;
    if (m === 'cf')               return t.cf / gp;
    if (m === 'cd')               return t.cf - t.ca;
    if (m === 'gsax')             return t.gsax / gp;
    if (m === 'true_gf')          return (t.gf - t.ppg - t.en_gf) / gp;
    if (m === 'true_ga')          return (t.ga - t.pkg - t.en_ga) / gp;
    if (m === 'true_gd')          return (t.gf - t.ppg - t.en_gf) - (t.ga - t.pkg - t.en_ga);
    if (m === 'pp_lev')           return t.gf > 0 ? (t.ppg / t.gf) * 100 : 0;
    if (m === 'pk_lev')           return t.ga > 0 ? (t.pkg / t.ga) * 100 : 0;
    if (m === 'hdf_pg')           return t.hdf / gp;
    if (m === 'hda_pg')           return t.hda / gp;
    if (m === 'hd_diff')          return t.hdf - t.hda;
    if (m === 'control')          return t.control_sum / gp;
    if (m === 'time_leading_pg')  return (t.time_leading  / gp) / 60;
    if (m === 'time_trailing_pg') return (t.time_trailing / gp) / 60;
    if (m === 'time_tied_pg')     return (t.time_tied     / gp) / 60;
    return 0;
}

function seriesVal(
    metric: string,
    mode: 'cumulative' | 'rolling',
    windowSize: number,
    filteredSoFar: GameLog[],
): number {
    if (filteredSoFar.length === 0) return 0;
    const slice = mode === 'rolling' ? filteredSoFar.slice(-windowSize) : filteredSoFar;
    return calcVal(metric, buildTotal(slice));
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

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

                <div className="text-sm font-bold text-white mb-1 flex justify-between items-center">
                    <span style={{ color: primaryColor }}>● {activeMetric.label}</span>
                    <span className="text-white ml-4">{fmt1}{activeMetric.suffix}</span>
                </div>

                {secondaryMetric && (
                    <div className="text-sm font-bold text-gray-400 mb-2 pb-2 border-b border-white/10 flex justify-between items-center">
                        <span>○ {secondaryMetric.label}</span>
                        <span className="text-gray-300 ml-4">{fmt2}{secondaryMetric.suffix}</span>
                    </div>
                )}
                {!secondaryMetric && <div className="h-px bg-white/10 my-2"></div>}

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-300">
                    <div className="col-span-2 font-bold text-white mb-1">
                        {g.home_away === 'Home' ? 'vs' : '@'} {g.opponent} ({g.result})
                    </div>
                    <div className="text-gray-500">Score:</div>
                    <div className="text-right text-white font-mono">{g.score}</div>
                    <div className="text-gray-500">Goalie:</div>
                    <div className="text-right text-white truncate">{g.starting_goalie?.split(' ').pop()}</div>
                    <div className="text-gray-500">GF / GA:</div>
                    <div className="text-right text-white font-mono">{g.gf}-{g.ga}</div>
                </div>
            </div>
        );
    }
    return null;
};

// ─── Metric control group (reusable UI block) ────────────────────────────────

interface MetricGroupProps {
    label: string;
    lineColor: string;
    lineDashed?: boolean;
    metricVal: string;
    onMetricChange: (v: string) => void;
    includeNone?: boolean;
    loc: string;
    onLocChange: (v: string) => void;
    mode: 'cumulative' | 'rolling';
    onModeChange: (v: 'cumulative' | 'rolling') => void;
    windowSize: number[];
    onWindowChange: (v: number[]) => void;
    showControls?: boolean; // hide LOC/mode when metric is 'none'
}

const MetricGroup: React.FC<MetricGroupProps> = ({
    label, lineColor, lineDashed, metricVal, onMetricChange,
    includeNone, loc, onLocChange, mode, onModeChange, windowSize, onWindowChange,
    showControls = true,
}) => (
    <div className="flex flex-col gap-1 min-w-[148px]">
        {/* Header label + line indicator */}
        <label className="text-[9px] uppercase text-gray-400 font-bold tracking-widest pl-1 flex items-center gap-1.5">
            {label}
            <svg width="24" height="6" className="inline-block">
                <line x1="0" y1="3" x2="24" y2="3"
                    stroke={lineColor} strokeWidth={lineDashed ? 2 : 2.5}
                    strokeDasharray={lineDashed ? '4 3' : undefined}
                    strokeLinecap="round" />
            </svg>
        </label>

        {/* Metric selector */}
        <Select value={metricVal} onValueChange={onMetricChange}>
            <SelectTrigger className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10 transition-colors h-7 text-[10px] font-bold font-mono">
                <SelectValue placeholder={label} />
            </SelectTrigger>
            <SelectContent className="bg-black/95 border-white/10 text-white backdrop-blur-xl font-mono max-h-[300px]">
                {includeNone && (
                    <SelectItem value="none" className="text-gray-500 italic text-[10px]">None</SelectItem>
                )}
                {METRICS.map(m => (
                    <SelectItem key={m.value} value={m.value} className="focus:bg-white/10 focus:text-white cursor-pointer text-[10px]">
                        {m.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>

        {/* LOC + Mode row (only when a metric is selected) */}
        {showControls && (
            <div className="flex gap-1 items-center">
                {/* LOC */}
                <Select value={loc} onValueChange={onLocChange}>
                    <SelectTrigger className="w-[60px] bg-white/5 border-white/10 text-white hover:bg-white/10 h-7 text-[10px] font-bold font-mono flex-shrink-0">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-black/95 border-white/10 text-white backdrop-blur-xl font-mono">
                        <SelectItem value="All"  className="focus:bg-white/10 cursor-pointer text-[10px]">All</SelectItem>
                        <SelectItem value="Home" className="focus:bg-white/10 cursor-pointer text-[10px]">Home</SelectItem>
                        <SelectItem value="Away" className="focus:bg-white/10 cursor-pointer text-[10px]">Away</SelectItem>
                    </SelectContent>
                </Select>

                {/* Mode toggle */}
                <Tabs value={mode} onValueChange={(v) => onModeChange(v as 'cumulative' | 'rolling')} className="flex-1">
                    <TabsList className="grid w-full grid-cols-2 bg-white/5 border border-white/5 h-7 p-0.5">
                        <TabsTrigger value="cumulative" className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-gray-500 text-[9px] font-bold uppercase font-mono">
                            Total
                        </TabsTrigger>
                        <TabsTrigger value="rolling" className="data-[state=active]:bg-white/20 data-[state=active]:text-white text-gray-500 text-[9px] font-bold uppercase font-mono">
                            Roll
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>
        )}

        {/* Rolling window slider */}
        {showControls && mode === 'rolling' && (
            <div className="flex flex-col gap-0.5 animate-in slide-in-from-top-2 fade-in duration-200">
                <label className="text-[9px] text-gray-500 font-mono">Games: {windowSize[0]}</label>
                <Slider
                    min={3} max={25} step={1}
                    value={windowSize}
                    onValueChange={onWindowChange}
                    className="w-full [&>.relative>.absolute]:bg-blue-500 h-4"
                />
            </div>
        )}
    </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

const TeamChart: React.FC<TeamChartProps> = ({ games, leagueGames, primaryColor, teamName, teamLogoUrl }) => {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    // Metric 1
    const [metric,  setMetric]  = useState(searchParams.get('metric')  || METRICS[0].value);
    const [loc1,    setLoc1]    = useState<'All' | 'Home' | 'Away'>((searchParams.get('loc')  as 'All' | 'Home' | 'Away')  || 'All');
    const [mode1,   setMode1]   = useState<'cumulative' | 'rolling'>((searchParams.get('mode') as 'cumulative' | 'rolling') || 'cumulative');
    const [window1, setWindow1] = useState([parseInt(searchParams.get('window') || '10')]);

    // Metric 2
    const [metric2, setMetric2] = useState(searchParams.get('metric2') || 'none');
    const [loc2,    setLoc2]    = useState<'All' | 'Home' | 'Away'>((searchParams.get('loc2') as 'All' | 'Home' | 'Away') || 'All');
    const [mode2,   setMode2]   = useState<'cumulative' | 'rolling'>((searchParams.get('mode2') as 'cumulative' | 'rolling') || 'cumulative');
    const [window2, setWindow2] = useState([parseInt(searchParams.get('window2') || '10')]);

    // Sync state → URL
    useEffect(() => {
        const params = new URLSearchParams(searchParams.toString());

        if (metric  !== METRICS[0].value) params.set('metric', metric);   else params.delete('metric');
        if (loc1    !== 'All')            params.set('loc',    loc1);     else params.delete('loc');
        if (mode1   !== 'cumulative')     params.set('mode',   mode1);    else params.delete('mode');
        if (window1[0] !== 10)            params.set('window', String(window1[0])); else params.delete('window');
        if (metric2 !== 'none')           params.set('metric2', metric2); else params.delete('metric2');
        if (loc2    !== 'All')            params.set('loc2',   loc2);     else params.delete('loc2');
        if (mode2   !== 'cumulative')     params.set('mode2',  mode2);    else params.delete('mode2');
        if (window2[0] !== 10)            params.set('window2', String(window2[0])); else params.delete('window2');

        const newSearch = params.toString();
        if (newSearch !== searchParams.toString()) {
            router.replace(`${pathname}?${newSearch}`, { scroll: false });
        }
    }, [metric, loc1, mode1, window1, metric2, loc2, mode2, window2, pathname, router, searchParams]);

    // ── Chart Data ──────────────────────────────────────────────────────────
    const chartData = useMemo(() => {
        const allSorted = [...games].sort((a, b) => a.game_number - b.game_number);

        const matchLoc = (g: GameLog, loc: string) =>
            loc === 'All' || g.home_away === loc;

        // Accumulate filtered-game lists incrementally (O(N) total)
        const buf1: GameLog[] = [];
        const buf2: GameLog[] = [];

        return allSorted.map(g => {
            if (matchLoc(g, loc1)) buf1.push(g);
            if (metric2 !== 'none' && matchLoc(g, loc2)) buf2.push(g);

            const val1 = seriesVal(metric,  mode1, window1[0], buf1);
            const val2 = metric2 !== 'none' ? seriesVal(metric2, mode2, window2[0], buf2) : null;

            return { gameNumber: g.game_number, value: val1, value2: val2, game: g };
        });
    }, [games, metric, loc1, mode1, window1, metric2, loc2, mode2, window2]);

    const activeMetric    = METRICS.find(m => m.value === metric)  || METRICS[0];
    const secondaryMetric = METRICS.find(m => m.value === metric2);

    // ── Y-axis domain ───────────────────────────────────────────────────────
    const domainY = useMemo(() => {
        if (!chartData.length) return [0, 'auto'] as [number, string];
        const scalingData = chartData.length > 8 ? chartData.slice(8) : chartData;

        const vals1 = scalingData.map(d => d.value);
        const vals2 = metric2 !== 'none' ? scalingData.map(d => d.value2 as number) : [];
        const allVals = [...vals1, ...vals2].filter(v => v !== null && !isNaN(v as number));
        if (!allVals.length) return [0, 'auto'] as [number, string];

        const min = Math.min(...allVals);
        const max = Math.max(...allVals);
        const range = max - min;
        const padding = Math.max(range * 0.15, 0.5);

        const canGoNeg = NEGATIVE_OK.has(metric) || (metric2 !== 'none' && NEGATIVE_OK.has(metric2));

        // Percentage metrics: constrain to [0, 100]
        const isPct = (m: string) => ['pp', 'pk', 'sh', 'sv'].includes(m);
        if (isPct(metric) && (metric2 === 'none' || isPct(metric2))) {
            return [Math.max(0, min - padding), Math.min(100, max + padding)] as [number, number];
        }

        const lo = canGoNeg ? min - padding : Math.max(0, min - padding);
        return [lo, max + padding] as [number, number];
    }, [chartData, metric, metric2]);

    // ── League Average Reference Line ───────────────────────────────────────
    const leagueAvg = useMemo(() => {
        if (!leagueGames?.length) return null;
        return calcVal(metric, buildTotal(leagueGames));
    }, [leagueGames, metric]);

    // ── Label density ───────────────────────────────────────────────────────
    const labelInterval  = useMemo(() => chartData.length <= 10 ? 1 : Math.floor(chartData.length / (chartData.length * 0.25)), [chartData.length]);
    const labelInterval2 = useMemo(() => chartData.length <= 10 ? 1 : Math.floor(chartData.length / (chartData.length * 0.10)), [chartData.length]);

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <Card className="w-full bg-black/40 border-white/10 backdrop-blur-md shadow-2xl animate-in fade-in duration-500 font-sans">
            <CardContent className="flex flex-col gap-6 pt-6 relative">

                {/* Controls Bar */}
                <div className="flex flex-wrap items-start gap-x-4 gap-y-3 bg-black/80 backdrop-blur-md p-3 rounded-xl border border-white/10 shadow-xl transition-all duration-300 hover:bg-black/90 mb-4">

                    {/* Team Logo + Name */}
                    <div className="flex items-center gap-3 mr-auto self-center">
                        {teamLogoUrl && (
                            <Image src={teamLogoUrl} alt={teamName || ''} width={48} height={48} className="w-12 h-12 object-contain" />
                        )}
                        <span className="text-white text-base md:text-lg font-bold tracking-wider uppercase whitespace-nowrap">
                            {teamName || ''}
                        </span>
                    </div>

                    {/* Metric 1 group */}
                    <MetricGroup
                        label="Metric"
                        lineColor={primaryColor}
                        metricVal={metric}
                        onMetricChange={setMetric}
                        loc={loc1}
                        onLocChange={(v) => setLoc1(v as 'All' | 'Home' | 'Away')}
                        mode={mode1}
                        onModeChange={setMode1}
                        windowSize={window1}
                        onWindowChange={setWindow1}
                    />

                    {/* Metric 2 group */}
                    <MetricGroup
                        label="Compare"
                        lineColor="#38bdf8"
                        lineDashed
                        metricVal={metric2}
                        onMetricChange={setMetric2}
                        includeNone
                        loc={loc2}
                        onLocChange={(v) => setLoc2(v as 'All' | 'Home' | 'Away')}
                        mode={mode2}
                        onModeChange={setMode2}
                        windowSize={window2}
                        onWindowChange={setWindow2}
                        showControls={metric2 !== 'none'}
                    />
                </div>

                {/* Chart */}
                <div className="w-full h-[450px] md:h-[550px] bg-black/20 border border-white/5 rounded-xl p-4 md:p-6 relative shadow-inner overflow-hidden">
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>

                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 20, right: 30, left: -10, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%"  stopColor={primaryColor} stopOpacity={0.4} />
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
                                interval={labelInterval}
                                dy={10}
                            />

                            <YAxis
                                stroke="#444"
                                tick={{ fill: '#666', fontSize: 10, fontWeight: 'bold' }}
                                tickLine={false}
                                axisLine={false}
                                domain={domainY}
                                dx={-10}
                                allowDataOverflow={false}
                                tickFormatter={(v: number) => {
                                    const fmt = activeMetric.format(v);
                                    return fmt.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
                                }}
                            />

                            <Tooltip
                                content={<CustomTooltip activeMetric={activeMetric} secondaryMetric={secondaryMetric} primaryColor={primaryColor} />}
                                cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1, strokeDasharray: '4 4' }}
                            />

                            {/* Primary metric */}
                            {(() => {
                                const shownX: number[] = [];
                                return (
                                    <Area
                                        type="monotone"
                                        dataKey="value"
                                        stroke={primaryColor}
                                        strokeWidth={3}
                                        fillOpacity={1}
                                        fill="url(#colorMetric)"
                                        activeDot={{ r: 6, strokeWidth: 0, fill: '#fff' }}
                                        animationDuration={1500}
                                        animationEasing="ease-in-out"
                                        label={(props) => {
                                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                            const { x, y, index, value } = props as any;
                                            const isLast = index === chartData.length - 1;
                                            if (!isLast && index % labelInterval !== 0) return null;
                                            if (!isLast && shownX.some(px => Math.abs(px - x) < 32)) return null;
                                            void shownX.push(x);
                                            return (
                                                <g>
                                                    <rect x={x - 20} y={y - 28} width="40" height="20" rx="4" fill={primaryColor} />
                                                    <text x={x} y={y - 14} fill="#fff" fontSize={10} fontWeight="bold" textAnchor="middle">
                                                        {activeMetric.format(value)}{activeMetric.suffix}
                                                    </text>
                                                </g>
                                            );
                                        }}
                                    />
                                );
                            })()}

                            {/* Secondary metric */}
                            {metric2 !== 'none' && (
                                <Area
                                    type="monotone"
                                    dataKey="value2"
                                    stroke="#38bdf8"
                                    strokeWidth={2}
                                    strokeDasharray="5 5"
                                    fill="none"
                                    activeDot={{ r: 4, strokeWidth: 0, fill: '#38bdf8' }}
                                    animationDuration={1500}
                                    animationEasing="ease-in-out"
                                    label={(props) => {
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        const { x, y, index, value } = props as any;
                                        const isLast = index === chartData.length - 1;
                                        if ((!isLast && index % labelInterval2 !== 0) || value === null) return null;
                                        return (
                                            <g>
                                                <rect x={x - 20} y={y - 28} width="40" height="20" rx="4" fill="#0369a1" />
                                                <text x={x} y={y - 14} fill="#fff" fontSize={10} fontWeight="bold" textAnchor="middle">
                                                    {secondaryMetric?.format(value)}{secondaryMetric?.suffix}
                                                </text>
                                            </g>
                                        );
                                    }}
                                />
                            )}

                            {/* League avg reference */}
                            {leagueAvg !== null && (
                                <ReferenceLine
                                    y={leagueAvg}
                                    stroke="rgba(255,255,255,0.2)"
                                    strokeDasharray="6 4"
                                    strokeWidth={1}
                                    label={{
                                        value: `LG AVG ${activeMetric.format(leagueAvg)}${activeMetric.suffix}`,
                                        position: 'insideTopRight',
                                        fill: 'rgba(255,255,255,0.35)',
                                        fontSize: 9,
                                        fontWeight: 'bold',
                                        fontFamily: 'monospace',
                                    }}
                                />
                            )}

                            {/* Zero reference line for diff/negative metrics */}
                            {(NEGATIVE_OK.has(metric) || (metric2 !== 'none' && NEGATIVE_OK.has(metric2))) && (
                                <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
                            )}

                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
};

export default TeamChart;
