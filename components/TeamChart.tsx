'use client';

import * as React from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Segmented } from '@/components/ui/segmented';
import { CHART_METRICS, buildTotals, metricValue, type ChartMetric } from '@/utils/team-stats/chart-metrics';
import { shortDate } from '@/utils/team-stats/format';
import type { GameRow } from '@/utils/team-stats/types';

interface TeamChartProps {
    /** This team's games (newest first), already filtered by the page. */
    games: GameRow[];
    /** League averages per metric for the same season (server-computed). */
    leagueAverages: Record<string, number>;
    primaryColor: string;
    teamName: string;
    seasonLabel: string;
}

type Loc = 'All' | 'Home' | 'Away';
type Mode = 'cumulative' | 'rolling';

const COMPARE_COLOR = 'rgb(var(--info-rgb))';
const selectCls = 'min-h-8 w-full rounded-control border border-line bg-well px-2 text-base text-fg-1 md:text-caption coarse:min-h-11';
const TICK = { fill: 'rgb(var(--text-3-rgb))', fontSize: 11, fontFamily: 'var(--font-body)' };

function series(games: GameRow[], metric: string, loc: Loc, mode: Mode, win: number) {
    const chrono = [...games].reverse();
    const buf: GameRow[] = [];
    return chrono.map((g, i) => {
        if (loc === 'All' || g.home === (loc === 'Home')) buf.push(g);
        const slice = mode === 'rolling' ? buf.slice(-win) : buf;
        const v = slice.length ? metricValue(metric, buildTotals(slice)) : NaN;
        return { i: i + 1, v: Number.isFinite(v) ? v : null, g };
    });
}

function readParam(key: string, fallback: string) {
    if (typeof window === 'undefined') return fallback;
    try {
        return new URLSearchParams(window.location.search).get(key) ?? fallback;
    } catch {
        return fallback;
    }
}

/**
 * Season trend chart for one team: any metric, cumulative or rolling, with an
 * optional comparison line and the league average. Bounded metrics keep
 * their natural axis (points % is always 0–1). Loaded with next/dynamic so
 * recharts never ships with the default Games tab.
 */
export default function TeamChart({ games, leagueAverages, primaryColor, teamName, seasonLabel }: TeamChartProps) {
    const [metric, setMetric] = React.useState(() => readParam('metric', CHART_METRICS[0].value));
    const [metric2, setMetric2] = React.useState(() => readParam('metric2', 'none'));
    const [loc, setLoc] = React.useState<Loc>(() => (readParam('loc', 'All') as Loc) || 'All');
    const [mode, setMode] = React.useState<Mode>(() => (readParam('mode', 'cumulative') === 'rolling' ? 'rolling' : 'cumulative'));
    const [win, setWin] = React.useState(() => Math.min(25, Math.max(3, parseInt(readParam('window', '10'), 10) || 10)));

    React.useEffect(() => {
        try {
            const url = new URL(window.location.href);
            const set = (k: string, v: string, d: string) => (v === d ? url.searchParams.delete(k) : url.searchParams.set(k, v));
            set('metric', metric, CHART_METRICS[0].value);
            set('metric2', metric2, 'none');
            set('loc', loc, 'All');
            set('mode', mode, 'cumulative');
            set('window', String(win), '10');
            window.history.replaceState(window.history.state, '', url);
        } catch {
            /* ignore */
        }
    }, [metric, metric2, loc, mode, win]);

    const m1 = CHART_METRICS.find(m => m.value === metric) ?? CHART_METRICS[0];
    const m2 = CHART_METRICS.find(m => m.value === metric2);
    const data = React.useMemo(() => {
        const a = series(games, m1.value, loc, mode, win);
        const b = m2 ? series(games, m2.value, loc, mode, win) : null;
        return a.map((p, i) => ({ ...p, v2: b ? b[i].v : null }));
    }, [games, m1.value, m2, loc, mode, win]);

    const domain = React.useMemo<[number, number] | ['auto', 'auto']>(() => {
        if (m1.domain && (!m2 || m2.domain)) return m1.domain;
        const vals = data.slice(Math.min(8, Math.floor(data.length / 3))).flatMap(d => [d.v, d.v2]).filter((v): v is number => v != null);
        if (!vals.length) return ['auto', 'auto'];
        const lo = Math.min(...vals);
        const hi = Math.max(...vals);
        const pad = Math.max((hi - lo) * 0.15, 0.1);
        return [m1.signed ? lo - pad : Math.max(0, lo - pad), hi + pad];
    }, [data, m1, m2]);

    const avg = leagueAverages[m1.value];
    const last = [...data].reverse().find(d => d.v != null);

    if (games.length < 2) {
        return (
            <p className="panel p-card text-center">
                <span className="label">2+ GP</span>
                <span className="sr-only"> needed for {seasonLabel} charts</span>
            </p>
        );
    }

    return (
        <div className="panel flex flex-col gap-3 p-card">
            <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-[10rem] flex-1 flex-col gap-1 sm:max-w-[15rem]">
                    <span className="label flex items-center gap-2">
                        Metric <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ background: primaryColor }} />
                    </span>
                    <select className={selectCls} value={metric} onChange={e => setMetric(e.target.value)}>
                        {CHART_METRICS.map(m => (
                            <option key={m.value} value={m.value}>
                                {m.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex min-w-[10rem] flex-1 flex-col gap-1 sm:max-w-[15rem]">
                    <span className="label flex items-center gap-2">
                        Vs <span aria-hidden="true" className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: COMPARE_COLOR }} />
                    </span>
                    <select className={selectCls} value={metric2} onChange={e => setMetric2(e.target.value)} aria-label="Vs (compare with)">
                        <option value="none">None</option>
                        {CHART_METRICS.map(m => (
                            <option key={m.value} value={m.value}>
                                {m.label}
                            </option>
                        ))}
                    </select>
                </label>
                <Segmented label="Home or away games" size="sm" value={loc} onChange={setLoc} options={(['All', 'Home', 'Away'] as Loc[]).map(v => ({ value: v, label: v }))} />
                <Segmented
                    label="Cumulative or rolling"
                    size="sm"
                    value={mode}
                    onChange={setMode}
                    options={[
                        { value: 'cumulative', label: 'Season' },
                        { value: 'rolling', label: `Roll ${win}` },
                    ]}
                />
                {mode === 'rolling' ? (
                    <label className="flex min-h-8 items-center gap-2 text-micro uppercase tracking-label text-fg-3">
                        Window
                        <input type="range" min={3} max={25} value={win} onChange={e => setWin(Number(e.target.value))} className="w-32 accent-[rgb(var(--brand-rgb))]" aria-valuetext={`${win} games`} />
                        <span className="w-6 tabular-nums text-fg-1">{win}</span>
                    </label>
                ) : null}
            </div>

            <figure className="m-0">
                <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2 text-micro font-medium uppercase tracking-label text-fg-3">
                        <span className="text-fg-1">{m1.label}</span>
                        <span>{seasonLabel}</span>
                        {loc !== 'All' ? <span>{loc}</span> : null}
                        <span className="sr-only">{teamName}</span>
                    </span>
                    {last?.v != null ? (
                        <span className="font-display text-[26px] font-bold leading-none tabular-nums" style={{ color: primaryColor }}>
                            {m1.format(last.v)}
                            {m1.suffix}
                        </span>
                    ) : null}
                </figcaption>
                <div className="h-[280px] w-full md:h-[420px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
                            <defs>
                                <linearGradient id="team-area" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={primaryColor} stopOpacity={0.35} />
                                    <stop offset="100%" stopColor={primaryColor} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid stroke="var(--line)" vertical={false} />
                            <XAxis
                                dataKey="i"
                                tick={TICK}
                                tickLine={false}
                                axisLine={false}
                                interval="preserveStartEnd"
                                minTickGap={24}
                            />
                            <YAxis
                                tick={TICK}
                                tickLine={false}
                                axisLine={false}
                                domain={domain}
                                allowDataOverflow={!!m1.domain}
                                width={52}
                                tickFormatter={(v: number) => m1.format(v)}
                            />
                            <Tooltip content={<ChartTip m1={m1} m2={m2} color={primaryColor} />} cursor={{ stroke: 'var(--line-strong)', strokeDasharray: '4 4' }} />
                            {Number.isFinite(avg) ? (
                                <ReferenceLine
                                    y={avg}
                                    stroke="rgb(var(--text-3-rgb))"
                                    strokeDasharray="6 4"
                                    label={{ value: `LG ${m1.format(avg)}${m1.suffix}`, position: 'insideTopRight', fill: 'rgb(var(--text-3-rgb))', fontSize: 11, fontFamily: 'var(--font-body)' }}
                                />
                            ) : null}
                            {m1.signed ? <ReferenceLine y={0} stroke="var(--line-strong)" /> : null}
                            <Area type="monotone" dataKey="v" stroke={primaryColor} strokeWidth={2} fill="url(#team-area)" style={{ filter: `drop-shadow(0 0 6px ${primaryColor})` }} connectNulls isAnimationActive={false} activeDot={{ r: 5, strokeWidth: 0, fill: '#fff' }} />
                            {m2 ? <Area type="monotone" dataKey="v2" stroke={COMPARE_COLOR} strokeWidth={2} strokeDasharray="5 4" fill="none" connectNulls isAnimationActive={false} /> : null}
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </figure>
        </div>
    );
}

interface TipProps {
    active?: boolean;
    payload?: { payload: { i: number; v: number | null; v2: number | null; g: GameRow } }[];
    m1: ChartMetric;
    m2?: ChartMetric;
    color: string;
}

function ChartTip({ active, payload, m1, m2, color }: TipProps) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const g = d.g;
    return (
        <div className="min-w-[180px] rounded-control border border-line-strong bg-bg/95 px-2.5 py-2 font-mono text-caption">
            <p className="text-micro uppercase tracking-wide text-fg-3">
                GP {d.i} · {shortDate(g.date)} · {g.home ? 'vs' : '@'} {g.opp} · <span className="text-fg-1">{g.gf}–{g.ga}</span>
            </p>
            <p className="mt-1 flex justify-between gap-4 font-semibold">
                <span style={{ color }}>{m1.label}</span>
                <span className="tabular-nums text-fg-1">{d.v != null ? `${m1.format(d.v)}${m1.suffix}` : '—'}</span>
            </p>
            {m2 ? (
                <p className="flex justify-between gap-4">
                    <span style={{ color: COMPARE_COLOR }}>{m2.label}</span>
                    <span className="tabular-nums text-fg-1">{d.v2 != null ? `${m2.format(d.v2)}${m2.suffix}` : '—'}</span>
                </p>
            ) : null}
        </div>
    );
}
