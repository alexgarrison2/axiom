'use client';

import * as React from 'react';
import Link from 'next/link';
import { Segmented } from '@/components/ui/segmented';
import { legibleOn, readableTextOn } from '@/components/ui/color';
import { cn } from '@/lib/utils';
import {
    clockOf,
    deservedSeries,
    goalSwings,
    isUnblocked,
    matchTeamStrength,
    perMinute,
    periodAt,
    periodLabel,
    race,
    shortName,
    strengthStates,
    winModel,
    winSeries,
    type FlowMetric,
    type TeamStrength,
} from '@/lib/game/analytics';
import { SIDES, type GameEvent, type Side } from '@/lib/game/types';
import { useGame } from './GameContext';
import { OnIce, OnIceRail } from './OnIce';

type BarMetric = FlowMetric | 'share';

const BAR_METRICS: { value: BarMetric; label: string }[] = [
    { value: 'attempts', label: 'Att' },
    { value: 'unblocked', label: 'Unbl' },
    { value: 'sog', label: 'SOG' },
    { value: 'xg', label: 'xG' },
    { value: 'share', label: 'Share' },
];
const RACE_METRICS: { value: FlowMetric; label: string }[] = [
    { value: 'xg', label: 'xG' },
    { value: 'sog', label: 'SOG' },
    { value: 'attempts', label: 'Att' },
    { value: 'goals', label: 'G' },
];

/** Panel ground (surface-1), for text-contrast fixes on team colours. */
const PANEL = '#0a0e15';
/** A chance this good is drawn as a dot on its team's edge of the bar lane. */
const HIGH_DANGER = 0.2;
/** Rolling window for the Share view, in minutes. */
const SHARE_WINDOW = 5;

const pctText = (p: number) => `${Math.round(p * 100)}%`;
const fmt = (metric: FlowMetric, v: number) => (metric === 'xg' ? v.toFixed(2) : String(Math.round(v)));

/**
 * Win-lane scale: linear through the middle, stretched near 0 and 100% (a
 * blend with a clipped logit) so a blowout's 95 → 99% still moves instead
 * of pinning to the edge.
 */
const L995 = Math.log(0.995 / 0.005);
function winScale(p: number): number {
    const c = Math.min(0.995, Math.max(0.005, p));
    return 0.5 + 0.5 * (0.55 * (2 * p - 1) + 0.45 * (Math.log(c / (1 - c)) / L995));
}

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
    const ref = React.useRef<T>(null);
    const [w, setW] = React.useState(0);
    React.useEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(([entry]) => setW(Math.round(entry.contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, w];
}

/** Step path through [t, v] points (value holds until the next point). */
function stepPath(pts: [number, number][], x: (t: number) => number, y: (v: number) => number): string {
    let d = '';
    pts.forEach(([t, v], i) => {
        const px = x(t).toFixed(1);
        const py = y(v).toFixed(1);
        if (i === 0) d += `M${px},${py}`;
        else d += `H${px}V${py}`;
    });
    return d;
}

/** Value of a step series at t. */
function stepAt(pts: [number, number][], t: number): number {
    let v = pts[0]?.[1] ?? 0;
    for (const [tt, vv] of pts) {
        if (tt > t) break;
        v = vv;
    }
    return v;
}

function readStored<T extends string>(key: string, allowed: readonly T[]): T | null {
    try {
        const v = window.localStorage.getItem(key);
        return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
    } catch {
        return null;
    }
}
function store(key: string, v: string) {
    try {
        window.localStorage.setItem(key, v);
    } catch {
        /* private mode: the choice just isn't remembered */
    }
}

function Check({ ok }: { ok: boolean }) {
    return (
        <svg viewBox="0 0 12 12" className={cn('inline h-3 w-3 align-[-1px]', ok ? 'text-pos' : 'text-neg')} aria-hidden="true">
            {ok ? <path d="M2.5 6.5 5 9l4.5-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M3 3l6 6M9 3 3 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
        </svg>
    );
}

export function Pulse() {
    const { m, colors, byId, selected, select, keyEvents } = useGame();
    const [barMetric, setBarMetricState] = React.useState<BarMetric>('attempts');
    const [raceMetric, setRaceMetricState] = React.useState<FlowMetric>(m.xgPending && !m.events.some(e => e.xg != null) ? 'sog' : 'xg');
    const [strength, setStrength] = React.useState<TeamStrength>('all');
    /** The pointer's moment (mouse hover). */
    const [hover, setHover] = React.useState<number | null>(null);
    /** A moment held by click, tap, keyboard scrub or ?t= in the URL. */
    const [pinT, setPinT] = React.useState<number | null>(null);
    const [wrapRef, width] = useWidth<HTMLDivElement>();
    const compact = width > 0 && width < 640;
    const ink = React.useMemo(() => ({ away: legibleOn(colors.away, PANEL), home: legibleOn(colors.home, PANEL) }), [colors]);

    // Remembered metric choices and a shared moment (?t=seconds) load after hydration.
    React.useEffect(() => {
        const b = readStored('pony.pulse.bars', BAR_METRICS.map(o => o.value));
        const r = readStored('pony.pulse.race', RACE_METRICS.map(o => o.value));
        if (b) setBarMetricState(b);
        if (r && !(r === 'xg' && m.xgPending && !m.events.some(e => e.xg != null))) setRaceMetricState(r);
        const t = Number(new URLSearchParams(window.location.search).get('t'));
        if (Number.isFinite(t) && t > 0) setPinT(Math.min(t, m.end));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    React.useEffect(() => {
        const url = new URL(window.location.href);
        if (pinT == null) url.searchParams.delete('t');
        else url.searchParams.set('t', String(Math.round(pinT)));
        window.history.replaceState(window.history.state, '', url);
    }, [pinT]);
    const setBarMetric = (v: BarMetric) => {
        setBarMetricState(v);
        store('pony.pulse.bars', v);
    };
    const setRaceMetric = (v: FlowMetric) => {
        setRaceMetricState(v);
        store('pony.pulse.race', v);
    };

    const domain = Math.max(3600, m.end);
    const W = Math.max(width, 320);
    const padL = compact ? 30 : 40;
    const padR = compact ? 40 : 54;
    const plot = W - padL - padR;
    const x = (t: number) => padL + (Math.min(t, domain) / domain) * plot;

    // Goal pins: greedy rows so collided pins stack instead of hiding each other.
    const pinR = compact ? 13 : 19;
    const goals = m.events.filter(e => e.type === 'goal');
    const pinRow = new Map<number, number>();
    const rowEnds: number[] = [];
    for (const g of goals) {
        const gx = x(g.t);
        let r = rowEnds.findIndex(end => gx - end >= pinR * 2 + 2);
        if (r < 0) r = Math.min(rowEnds.length, 2);
        rowEnds[r] = gx;
        pinRow.set(g.id, r);
    }
    const rows = Math.max(1, rowEnds.length);
    const pinStep = pinR * 1.55;
    // A pin's xG sits under it unless another pin hangs there.
    const xgLabel = new Set(goals.filter(g => !goals.some(o => (pinRow.get(o.id) ?? 0) === (pinRow.get(g.id) ?? 0) + 1 && Math.abs(x(o.t) - x(g.t)) < pinR * 2.2)).map(g => g.id));

    // Lanes, top to bottom.
    const pinH = pinR * 2 + 6 + (rows - 1) * pinStep + 14;
    const winH = compact ? 84 : 120;
    const barH = compact ? 96 : 136;
    const raceH = compact ? 72 : 110;
    const gap = 18;
    const stripH = compact ? 16 : 20;
    const winTop = pinH;
    const stripTop = winTop + winH + 8;
    const barTop = stripTop + stripH + 10;
    const raceTop = barTop + barH + gap;
    const axisTop = raceTop + raceH + 6;
    const H = axisTop + 18;

    const win = React.useMemo(() => winSeries(m), [m]);
    const deserved = React.useMemo(() => deservedSeries(m), [m]);
    const wm = React.useMemo(() => winModel(m), [m]);
    const swings = React.useMemo(() => goalSwings(m), [m]);
    const flowMetric: FlowMetric = barMetric === 'share' ? 'xg' : barMetric;
    const bins = React.useMemo(() => perMinute(m, flowMetric, strength), [m, flowMetric, strength]);
    const races = React.useMemo(() => race(m, raceMetric, strength), [m, raceMetric, strength]);
    const states = React.useMemo(() => strengthStates(m).filter(w => w.b - w.a >= 10), [m]);
    const chances = m.events.filter(e => isUnblocked(e) && e.type !== 'goal' && (e.xg ?? 0) >= HIGH_DANGER && matchTeamStrength(e, strength));
    const penalties = m.events.filter(e => e.type === 'penalty');

    const yWin = (p: number) => winTop + (1 - winScale(p)) * winH;
    const binMax = Math.max(flowMetric === 'xg' ? 0.2 : 1, ...bins.away, ...bins.home);
    const half = barH / 2;
    const axisY = barTop + half;

    // Pregame pace: each side's projected goals (pony xG) reached at 60:00, drawn under the xG and goals races.
    const pg = m.pregame;
    const pace = (raceMetric === 'xg' || raceMetric === 'goals') && pg?.homeXg != null && pg?.awayXg != null ? { away: pg.awayXg, home: pg.homeXg } : null;
    const raceMax = Math.max(raceMetric === 'xg' ? 1 : 3, races.away[races.away.length - 1][1], races.home[races.home.length - 1][1], pace ? Math.max(pace.away, pace.home) : 0);
    const yRace = (v: number) => raceTop + raceH - (v / raceMax) * raceH;

    const winPath = stepPath(win, x, yWin);
    const winArea = `${winPath}V${yWin(0.5)}H${x(0).toFixed(1)}Z`;
    const deservedPath = stepPath(deserved, x, yWin);
    const nOT = m.end > 3600 ? Math.ceil((m.end - 3600) / m.otLength) : 0;
    const seams = [1200, 2400, 3600, ...Array.from({ length: Math.max(0, nOT - 1) }, (_, k) => 3600 + (k + 1) * m.otLength)].filter(t => t < domain);
    const periods = [1, 2, 3, ...Array.from({ length: nOT }, (_, k) => 4 + k)];
    const pStart = (p: number) => (p <= 3 ? (p - 1) * 1200 : 3600 + (p - 4) * m.otLength);
    const pEnd = (p: number) => (p <= 3 ? p * 1200 : Math.min(domain, 3600 + (p - 3) * m.otLength));
    const clockText = (t: number) => {
        const { period, into } = periodAt(t, m.otLength);
        return `${periodLabel(period)} ${clockOf(into)}`;
    };

    // Rolling xG share (Share view): one diverging line around 50%, home above.
    const sharePath = React.useMemo(() => {
        if (barMetric !== 'share') return null;
        const n = Math.ceil(Math.max(m.end, 60) / 60);
        let d = '';
        for (let i = 0; i < n; i++) {
            let a = 0;
            let h = 0;
            for (let k = Math.max(0, i - SHARE_WINDOW + 1); k <= i; k++) {
                a += bins.away[k] ?? 0;
                h += bins.home[k] ?? 0;
            }
            const share = a + h > 0.02 ? h / (a + h) : 0.5;
            const px = x(Math.min(m.end, i * 60 + 30)).toFixed(1);
            const py = (axisY - (share - 0.5) * 2 * (half - 4)).toFixed(1);
            d += `${i ? 'L' : 'M'}${px},${py}`;
        }
        return d;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [barMetric, bins, m.end, width, axisY, half]);

    // Score, race and win values at a moment.
    const at = (t: number) => {
        const sc = { away: 0, home: 0 };
        for (const g of goals) if (g.t <= t) sc[g.side] += 1;
        const rv = { away: stepAt(races.away, t), home: stepAt(races.home, t) };
        const p = t >= m.end && m.state === 'final' ? (m.teams.home.score > m.teams.away.score ? 1 : 0) : wm.at(t, sc.home - sc.away);
        return { sc, rv, p, xp: stepAt(deserved, t) };
    };

    const step = (dir: 1 | -1) => {
        if (!keyEvents.length) return;
        setPinT(null);
        const i = keyEvents.findIndex(e => e.id === selected);
        const next = i < 0 ? (dir === 1 ? 0 : keyEvents.length - 1) : Math.min(keyEvents.length - 1, Math.max(0, i + dir));
        select(keyEvents[next].id);
    };
    const sel = selected != null ? (m.events.find(e => e.id === selected) ?? null) : null;
    const focusT = hover ?? pinT ?? sel?.t ?? null;
    const scrub = (dt: number) => {
        const from = pinT ?? sel?.t ?? (dt > 0 ? 0 : m.end);
        select(null);
        setPinT(Math.max(0, Math.min(m.end, from + dt)));
    };
    const onKey = (e: React.KeyboardEvent) => {
        const k = e.key;
        if (k === 'ArrowRight' || k === 'ArrowLeft') {
            e.preventDefault();
            if (e.shiftKey) scrub(k === 'ArrowRight' ? 60 : -60);
            else step(k === 'ArrowRight' ? 1 : -1);
        } else if (k === 'Home' || k === 'End') {
            e.preventDefault();
            select(null);
            setPinT(k === 'Home' ? 0 : m.end);
        } else if (k === 'Escape') {
            select(null);
            setPinT(null);
        }
    };
    const tAt = (e: React.PointerEvent<SVGRectElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        return Math.max(0, Math.min(m.end || domain, ((e.clientX - r.left) / r.width) * domain));
    };
    const onMove = (e: React.PointerEvent<SVGRectElement>) => {
        if (e.pointerType === 'mouse') setHover(tAt(e));
        else if (e.buttons) setPinT(tAt(e));
    };
    const onDown = (e: React.PointerEvent<SVGRectElement>) => {
        // Touch and pen scrub by holding a moment (horizontal drags; vertical drags still scroll the page).
        if (e.pointerType !== 'mouse') {
            select(null);
            setPinT(tAt(e));
        }
    };
    const onClick = (e: React.MouseEvent<SVGRectElement>) => {
        if (hover == null) return;
        const near = keyEvents.length ? keyEvents.reduce((b, k) => (Math.abs(k.t - hover) < Math.abs(b.t - hover) ? k : b)) : null;
        if (near && Math.abs(x(near.t) - x(hover)) < 14) {
            setPinT(null);
            select(near.id);
        } else if (pinT != null && Math.abs(x(pinT) - x(hover)) < 8) setPinT(null);
        else {
            select(null);
            setPinT(hover);
        }
        e.preventDefault();
    };

    const readout = focusT != null ? at(focusT) : null;
    const ri = sel ? keyEvents.findIndex(e => e.id === sel.id) : -1;
    // At rest the on-ice panel holds the final horn (or the live moment), so it never pops in under the chart.
    const restT = m.state === 'pre' ? null : Math.max(0, m.end - 0.5);
    const iceT = focusT ?? restT;

    const describe = (e: GameEvent) => {
        const p = e.player != null ? byId.get(e.player) : undefined;
        if (e.type === 'goal') return `Goal ${m.teams[e.side].tri} · ${shortName(p)}${e.strength !== 'ev' ? ` (${e.strength.toUpperCase()})` : ''}${e.emptyNet ? ' (EN)' : ''}`;
        return `${m.teams[e.side].tri} penalty · ${shortName(p)}${e.detail ? ` · ${e.detail.replace(/-/g, ' ')}` : ''}${e.minutes ? ` · ${e.minutes} min` : ''}`;
    };

    // The verdict: how it ended against the pregame call and the market.
    const leader = (pHome: number): Side => (pHome >= 0.5 ? 'home' : 'away');
    const callSide = pg ? leader(pg.homeWin) : null;
    const mktSide = pg?.marketHome != null ? leader(pg.marketHome) : null;
    const big = swings.length ? swings.reduce((b, s) => (Math.abs(s.after - s.before) > Math.abs(b.after - b.before) ? s : b)) : null;
    const bigScorer = big?.event.player != null ? byId.get(big.event.player) : undefined;
    const bigPts = big ? Math.round(Math.abs(big.after - big.before) * 100) : 0;
    const finalDeserved = deserved[deserved.length - 1][1];
    const xgTot = { away: m.events.filter(e => e.side === 'away' && isUnblocked(e)).reduce((a, e) => a + (e.xg ?? 0), 0), home: m.events.filter(e => e.side === 'home' && isUnblocked(e)).reduce((a, e) => a + (e.xg ?? 0), 0) };
    const winner: Side | null = m.teams.home.score === m.teams.away.score ? null : m.teams.home.score > m.teams.away.score ? 'home' : 'away';

    const metricLabel = (v: string) => [...BAR_METRICS, ...RACE_METRICS].find(o => o.value === v)?.label ?? v;
    const chipLeft = focusT != null ? x(focusT) : 0;
    const flip = chipLeft > W * 0.58;
    const lastWin = win[win.length - 1][1];
    let deservedEndY = yWin(finalDeserved) + 4;
    if (Math.abs(deservedEndY - (yWin(lastWin) + 4)) < 13) deservedEndY += deservedEndY >= yWin(lastWin) + 4 ? 13 - (deservedEndY - yWin(lastWin) - 4) : -13;

    return (
        <div className="panel overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-card py-2">
                <div className="flex items-center gap-1.5">
                    <span className="label hidden sm:inline" aria-hidden="true">
                        Bars
                    </span>
                    <Segmented label="Bars" size="sm" value={barMetric} onChange={setBarMetric} options={BAR_METRICS} optionClassName="px-2" />
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="label hidden sm:inline" aria-hidden="true">
                        Race
                    </span>
                    <Segmented label="Race" size="sm" value={raceMetric} onChange={setRaceMetric} options={RACE_METRICS} optionClassName="px-2" />
                </div>
                <Segmented
                    label="Strength"
                    size="sm"
                    value={strength}
                    onChange={setStrength}
                    options={[
                        { value: 'all', label: 'All' },
                        { value: '5v5', label: '5v5' },
                    ]}
                    optionClassName="px-2"
                />
                <div className="ml-auto flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => step(-1)}
                        aria-label="Previous goal or penalty"
                        className="grid h-8 w-8 place-items-center rounded-control border border-line text-fg-2 hover:border-line-strong hover:text-fg-1 coarse:h-11 coarse:w-11"
                    >
                        <svg viewBox="0 0 8 8" className="h-2.5 w-2.5" aria-hidden="true">
                            <path d="M5.5 1 2 4l3.5 3" fill="none" stroke="currentColor" strokeWidth="1.4" />
                        </svg>
                    </button>
                    <span className="min-w-[4.5rem] text-center text-micro uppercase tracking-label text-fg-3 tabular-nums">
                        {ri >= 0 ? ri + 1 : '–'} / {keyEvents.length}
                    </span>
                    <button
                        type="button"
                        onClick={() => step(1)}
                        aria-label="Next goal or penalty"
                        className="grid h-8 w-8 place-items-center rounded-control border border-line text-fg-2 hover:border-line-strong hover:text-fg-1 coarse:h-11 coarse:w-11"
                    >
                        <svg viewBox="0 0 8 8" className="h-2.5 w-2.5" aria-hidden="true">
                            <path d="M2.5 1 6 4 2.5 7" fill="none" stroke="currentColor" strokeWidth="1.4" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Wide screens: the compact on-ice rail sits left of the chart so players follow the cursor. */}
            <div className="xl:grid xl:grid-cols-[18.5rem_minmax(0,1fr)]">
            {iceT != null ? (
                <aside className="hidden border-r border-line xl:block" aria-label="Players on the ice">
                    <OnIceRail t={iceT} caption={<>On ice · {focusT == null ? (m.state === 'final' ? 'final horn' : 'now') : clockText(iceT)}</>} />
                </aside>
            ) : (
                <div className="hidden xl:block" />
            )}
            <div
                ref={wrapRef}
                role="group"
                aria-label="Game story. Left and right arrows step through goals and penalties; Shift with an arrow moves a minute; Home and End jump to the ends."
                tabIndex={0}
                onKeyDown={onKey}
                className="relative min-w-0 pt-2 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
            >
                {width ? (
                    <svg
                        viewBox={`0 0 ${W} ${H}`}
                        width="100%"
                        height={H}
                        role="img"
                        aria-label={`Win probability, ${metricLabel(barMetric)} per minute and running ${metricLabel(raceMetric)} for ${m.teams.away.tri} at ${m.teams.home.tri}, ${goals.length} goals. A table of goals and penalties follows the chart.`}
                        className="block select-none font-mono tabular-nums"
                    >
                        <defs>
                            {/* Strength windows: a hatch in the advantaged team's colour over its half of the bars. */}
                            {SIDES.map(side => (
                                <pattern key={side} id={`pulse-hatch-${side}`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                                    <line x1={0} y1={0} x2={0} y2={6} stroke={colors[side]} strokeWidth={1.6} strokeOpacity={0.45} />
                                </pattern>
                            ))}
                            <clipPath id="pulse-home">
                                <rect x={0} y={winTop} width={W} height={yWin(0.5) - winTop} />
                            </clipPath>
                            <clipPath id="pulse-away">
                                <rect x={0} y={yWin(0.5)} width={W} height={winTop + winH - yWin(0.5)} />
                            </clipPath>
                            <clipPath id="pulse-above">
                                <rect x={0} y={barTop} width={W} height={half} />
                            </clipPath>
                            <clipPath id="pulse-below">
                                <rect x={0} y={axisY} width={W} height={half} />
                            </clipPath>
                        </defs>

                        {/* Strength states, coloured by the team with the extra skater: a faint band through every lane,
                            a hatch over that team's half of the bars, and a labelled block in the strip row
                            (4v4 / 3v3 stay neutral). */}
                        <text x={padL - 6} y={stripTop + stripH / 2 + 4} textAnchor="end" className="fill-fg-3 text-micro uppercase">
                            Str
                        </text>
                        <rect x={padL} y={stripTop + stripH / 2 - 0.5} width={plot} height={1} className="fill-line" />
                        {states.map((w, i) => {
                            const x0 = x(w.a);
                            const wd = Math.max(2, x(w.b) - x0);
                            const c = w.side ? colors[w.side] : 'var(--text-3)';
                            const tri = w.side ? m.teams[w.side].tri : '';
                            const tag = w.kind === 'reduced' ? w.label : `${tri} ${w.label}`;
                            const text = wd >= tag.length * 6 + 8 ? tag : wd >= w.label.length * 5.6 + 2 ? w.label : null;
                            return (
                                <g key={i}>
                                    <title>{`${w.kind === 'pp' ? `${tri} power play` : w.kind === 'extra' ? `${tri} extra attacker` : 'Reduced strength'} ${w.label} · ${clockOf(w.b - w.a)}`}</title>
                                    <rect x={x0} y={winTop} width={wd} height={raceTop + raceH - winTop} fill={c} opacity={w.kind === 'reduced' ? 0.05 : 0.09} />
                                    {w.side ? <rect x={x0} y={w.side === 'home' ? barTop : axisY} width={wd} height={half} fill={`url(#pulse-hatch-${w.side})`} /> : null}
                                    <rect x={x0} y={stripTop} width={wd} height={stripH} rx={2} fill={c} opacity={w.kind === 'reduced' ? 0.35 : 0.9} />
                                    {text ? (
                                        <text x={x0 + wd / 2} y={stripTop + stripH / 2 + 4} textAnchor="middle" fill={w.side ? readableTextOn(colors[w.side]) : 'var(--text-1)'} className="text-micro font-bold">
                                            {text}
                                        </text>
                                    ) : null}
                                </g>
                            );
                        })}
                        {/* Penalty calls: an amber tick on the strip row where the whistle went. */}
                        {penalties.map(p => (
                            <g key={p.id}>
                                <title>{`${clockText(p.t)} · ${describe(p)}`}</title>
                                <rect x={x(p.t) - 1} y={stripTop - 4} width={2} height={stripH + 8} rx={1} className="fill-warn" opacity={p.id === selected ? 1 : 0.8} />
                            </g>
                        ))}

                        {/* Period seams. */}
                        {seams.map(t => (
                            <line key={t} x1={x(t)} x2={x(t)} y1={winTop} y2={axisTop} className="stroke-line-strong" strokeWidth={1} />
                        ))}

                        {/* Win probability lane: home at the top, away at the bottom; the leader's half tinted.
                            Solid = the score model, dashed = deserved (from the shots' xG). */}
                        <line x1={padL} x2={W - padR} y1={yWin(0.5)} y2={yWin(0.5)} className="stroke-line-strong" strokeDasharray="2 4" />
                        <path d={winArea} fill={colors.home} opacity={0.2} clipPath="url(#pulse-home)" />
                        <path d={winArea} fill={colors.away} opacity={0.2} clipPath="url(#pulse-away)" />
                        {m.events.some(e => e.xg != null) ? <path d={deservedPath} fill="none" className="stroke-model" strokeWidth={1.25} strokeDasharray="3 3" opacity={0.75} /> : null}
                        <path d={winPath} fill="none" className="stroke-model" strokeWidth={2} strokeLinejoin="round" />
                        <text x={padL - 6} y={winTop + 10} textAnchor="end" className="fill-fg-3 text-micro uppercase">
                            Win
                        </text>
                        <text x={padL + 4} y={winTop + 11} className="text-micro font-semibold uppercase" fill={ink.home} stroke="var(--surface-1)" strokeWidth={3} paintOrder="stroke">
                            {m.teams.home.tri}
                        </text>
                        <text x={padL + 4} y={winTop + winH - 3} className="text-micro font-semibold uppercase" fill={ink.away} stroke="var(--surface-1)" strokeWidth={3} paintOrder="stroke">
                            {m.teams.away.tri}
                        </text>
                        {/* Puck-drop anchors: a dot where our pregame call starts the line and a tick at the de-vigged market;
                            their values ride the lane's top row so the line never runs through them. */}
                        {pg && callSide ? (
                            <g>
                                {pg.marketHome != null ? <line x1={padL} x2={padL + 16} y1={yWin(pg.marketHome)} y2={yWin(pg.marketHome)} className="stroke-fg-1" strokeWidth={2} /> : null}
                                <circle cx={x(0)} cy={yWin(pg.homeWin)} r={3.5} className="fill-model" stroke="var(--surface-1)" strokeWidth={1} />
                                <text x={padL + 40} y={winTop + 11} className="text-micro" stroke="var(--surface-1)" strokeWidth={3} paintOrder="stroke">
                                    <tspan className="fill-model font-semibold">PONY {m.teams[callSide].tri} {pctText(Math.max(pg.homeWin, 1 - pg.homeWin))}</tspan>
                                    {pg.marketHome != null && mktSide ? <tspan className="fill-fg-2"> · MKT {m.teams[mktSide].tri} {pctText(Math.max(pg.marketHome, 1 - pg.marketHome))}</tspan> : null}
                                </text>
                            </g>
                        ) : null}
                        <text x={W - padR + 6} y={yWin(lastWin) + 4} className="fill-model text-micro font-semibold">
                            {pctText(Math.max(lastWin, 1 - lastWin))}
                        </text>
                        {m.events.some(e => e.xg != null) ? (
                            <text x={W - padR + 6} y={deservedEndY} className="fill-model text-micro" opacity={0.8}>
                                xG {pctText(Math.max(finalDeserved, 1 - finalDeserved))}
                            </text>
                        ) : null}

                        {/* Bars lane: per-minute bars (home above the axis, away below), or the rolling xG share. */}
                        {barMetric === 'share' && sharePath ? (
                            <g>
                                <path d={`${sharePath}V${axisY}H${x(30)}Z`} fill={colors.home} opacity={0.5} clipPath="url(#pulse-above)" />
                                <path d={`${sharePath}V${axisY}H${x(30)}Z`} fill={colors.away} opacity={0.5} clipPath="url(#pulse-below)" />
                                <path d={sharePath} fill="none" className="stroke-fg-1" strokeWidth={1.25} opacity={0.7} />
                            </g>
                        ) : (
                            SIDES.map(side =>
                                bins[side].map((v, i) => {
                                    if (!v) return null;
                                    const h = (v / binMax) * (half - 2);
                                    const bx = x(i * 60) + 0.5;
                                    const bw = Math.max(1, x((i + 1) * 60) - x(i * 60) - 1);
                                    return <rect key={`${side}${i}`} x={bx} y={side === 'home' ? axisY - h : axisY} width={bw} height={h} fill={colors[side]} opacity={0.85} />;
                                }),
                            )
                        )}
                        {/* High-danger chances (not goals): a dot on the shooting team's edge of the lane. */}
                        {chances.map(e => (
                            <circle key={e.id} cx={x(e.t)} cy={e.side === 'home' ? barTop + 3 : barTop + barH - 3} r={2.75} fill={colors[e.side]} stroke="var(--surface-1)" strokeWidth={1}>
                                <title>{`${clockText(e.t)} · ${m.teams[e.side].tri} chance · xG ${(e.xg ?? 0).toFixed(2)}`}</title>
                            </circle>
                        ))}
                        <line x1={padL} x2={W - padR} y1={axisY} y2={axisY} className="stroke-fg-3" strokeWidth={1} />
                        <text x={padL + 4} y={barTop + 18} className="text-micro font-semibold uppercase" fill={ink.home} stroke="var(--surface-1)" strokeWidth={3} paintOrder="stroke">
                            {m.teams.home.tri}
                        </text>
                        <text x={padL + 4} y={barTop + barH - 10} className="text-micro font-semibold uppercase" fill={ink.away} stroke="var(--surface-1)" strokeWidth={3} paintOrder="stroke">
                            {m.teams.away.tri}
                        </text>
                        <text x={padL - 6} y={barTop + 10} textAnchor="end" className="fill-fg-3 text-micro uppercase">
                            {barMetric === 'share' ? 'xG%' : metricLabel(barMetric)}
                        </text>
                        <text x={padL - 6} y={barTop + 24} textAnchor="end" className="fill-fg-3 text-micro" opacity={0.75}>
                            {barMetric === 'share' ? '100%' : fmt(flowMetric, binMax)}
                        </text>

                        {/* Running totals, over the pregame pace (dashed: each side's projection reached at 60:00). */}
                        <line x1={padL} x2={W - padR} y1={raceTop + raceH} y2={raceTop + raceH} className="stroke-line" />
                        {pace
                            ? SIDES.map(side => (
                                  <line key={side} x1={x(0)} y1={yRace(0)} x2={x(3600)} y2={yRace(pace[side])} stroke={colors[side]} strokeWidth={1} strokeDasharray="2 4" opacity={0.6}>
                                      <title>{`${m.teams[side].tri} pregame projection ${pace[side].toFixed(2)}`}</title>
                                  </line>
                              ))
                            : null}
                        {SIDES.map(side => (
                            <path key={side} d={stepPath(races[side], x, yRace)} fill="none" stroke={colors[side]} strokeWidth={2} strokeLinejoin="round" />
                        ))}
                        {SIDES.map(side => {
                            const last = races[side][races[side].length - 1];
                            const other = races[side === 'away' ? 'home' : 'away'];
                            const oy = yRace(other[other.length - 1][1]);
                            let ly = yRace(last[1]) + 4;
                            if (Math.abs(ly - 4 - oy) < 12 && side === 'away') ly = ly - 4 >= oy ? ly + 12 - (ly - 4 - oy) : ly - 12;
                            return (
                                <text key={side} x={W - padR + 6} y={Math.min(ly, raceTop + raceH + 4)} className="text-micro font-semibold" fill={ink[side]}>
                                    {fmt(raceMetric, last[1])}
                                </text>
                            );
                        })}
                        <text x={padL - 6} y={raceTop + 10} textAnchor="end" className="fill-fg-3 text-micro uppercase">
                            {metricLabel(raceMetric)}
                        </text>

                        {/* Period labels. */}
                        {periods.map(p => (
                            <text key={p} x={(x(pStart(p)) + x(pEnd(p))) / 2} y={H - 4} textAnchor="middle" className="fill-fg-3 text-micro uppercase">
                                {periodLabel(p)}
                            </text>
                        ))}

                        {/* The stop: a cyan flag on the selected event. */}
                        {sel ? (
                            <g pointerEvents="none">
                                <line x1={x(sel.t)} x2={x(sel.t)} y1={winTop} y2={axisTop} className="stroke-brand" strokeWidth={1.5} />
                                <path d={`M${x(sel.t)},${winTop} l7,4 l-7,4z`} className="fill-brand" />
                            </g>
                        ) : null}
                        {/* A held moment (click, tap, keys, shared link). */}
                        {pinT != null && hover == null ? <line x1={x(pinT)} x2={x(pinT)} y1={winTop} y2={axisTop} className="stroke-fg-1" strokeOpacity={0.7} strokeDasharray="3 3" pointerEvents="none" /> : null}

                        {/* Playhead and pointer capture. */}
                        {hover != null ? <line x1={x(hover)} x2={x(hover)} y1={winTop} y2={axisTop} className="stroke-fg-1" strokeOpacity={0.4} pointerEvents="none" /> : null}
                        <rect
                            x={padL}
                            y={winTop}
                            width={plot}
                            height={axisTop - winTop}
                            fill="transparent"
                            style={{ touchAction: 'pan-y' }}
                            onPointerMove={onMove}
                            onPointerDown={onDown}
                            onPointerLeave={() => setHover(null)}
                            onClick={onClick}
                            className="cursor-crosshair"
                        />

                        {/* Goal pins (on top, so they take focus and clicks): the scoring team's crest, the goal's xG beneath. */}
                        {goals.map(g => {
                            const gx = x(g.t);
                            const p = g.player != null ? byId.get(g.player) : undefined;
                            const lit = g.id === selected;
                            const cy = pinR + 3 + (pinRow.get(g.id) ?? 0) * pinStep;
                            const sw = swings.find(s => s.event.id === g.id);
                            const name = `${clockText(g.t)}, ${m.teams[g.side].tri} goal, ${shortName(p)}${g.xg != null ? `, xG ${g.xg.toFixed(2)}` : ''}${sw ? `, ${m.teams.home.tri} win ${pctText(sw.before)} to ${pctText(sw.after)}` : ''}`;
                            const logo = pinR - 2.5;
                            return (
                                <g
                                    key={g.id}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={name}
                                    aria-pressed={lit}
                                    onClick={() => {
                                        setPinT(null);
                                        select(lit ? null : g.id);
                                    }}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setPinT(null);
                                            select(lit ? null : g.id);
                                        }
                                    }}
                                    className="cursor-pointer outline-none [&:focus-visible>circle.ring]:stroke-brand"
                                >
                                    <title>{name}</title>
                                    <line x1={gx} x2={gx} y1={cy + pinR} y2={raceTop + raceH} stroke={colors[g.side]} strokeOpacity={lit ? 1 : 0.55} strokeWidth={lit ? 2 : 1} pointerEvents="none" />
                                    <clipPath id={`pin-${g.id}`}>
                                        <circle cx={gx} cy={cy} r={pinR - 2} />
                                    </clipPath>
                                    <circle cx={gx} cy={cy} r={pinR} className="ring fill-surface-2" stroke={lit ? 'var(--brand)' : colors[g.side]} strokeWidth={lit ? 2.5 : 2} />
                                    <image href={`/logos/${m.teams[g.side].tri}.svg`} x={gx - logo} y={cy - logo} width={logo * 2} height={logo * 2} clipPath={`url(#pin-${g.id})`} preserveAspectRatio="xMidYMid meet" />
                                    {g.xg != null && xgLabel.has(g.id) ? (
                                        <text x={gx} y={cy + pinR + 12} textAnchor="middle" className="fill-model text-micro" stroke="var(--surface-1)" strokeWidth={3} paintOrder="stroke">
                                            {g.xg.toFixed(2)}
                                        </text>
                                    ) : null}
                                </g>
                            );
                        })}
                    </svg>
                ) : (
                    <div className="h-[340px] md:h-[470px]" aria-hidden="true" />
                )}

                {/* Playhead chip: the moment's clock, score and race values on each team's side, and the win read. */}
                {width && readout && focusT != null ? (
                    <div
                        className="pointer-events-none absolute z-10 w-max min-w-[11rem] rounded-card border border-line-strong bg-surface-1/95 px-2.5 py-1.5 text-caption tabular-nums shadow-[0_8px_24px_rgb(0_0_0/0.5)] backdrop-blur-sm"
                        style={{ top: winTop + 12, ...(flip ? { right: W - chipLeft + 10 } : { left: chipLeft + 10 }) }}
                    >
                        <p className="flex items-baseline justify-between gap-3">
                            <span className="text-fg-2">{clockText(focusT)}</span>
                            {sel && hover == null && pinT == null ? <span className="truncate font-bold text-fg-1">{describe(sel)}</span> : null}
                        </p>
                        <p className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                            <span className="flex items-center gap-1.5">
                                {/* eslint-disable-next-line @next/next/no-img-element -- team logos are static SVGs */}
                                <img src={`/logos/${m.teams.away.tri}.svg`} alt="" width={18} height={18} className="h-[18px] w-[18px]" />
                                <span className="text-body font-bold text-fg-1">{readout.sc.away}</span>
                                <span style={{ color: ink.away }}>{fmt(raceMetric, readout.rv.away)}</span>
                            </span>
                            <span className="text-micro uppercase tracking-label text-fg-3">{metricLabel(raceMetric)}</span>
                            <span className="flex items-center justify-end gap-1.5">
                                <span style={{ color: ink.home }}>{fmt(raceMetric, readout.rv.home)}</span>
                                <span className="text-body font-bold text-fg-1">{readout.sc.home}</span>
                                {/* eslint-disable-next-line @next/next/no-img-element -- team logos are static SVGs */}
                                <img src={`/logos/${m.teams.home.tri}.svg`} alt="" width={18} height={18} className="h-[18px] w-[18px]" />
                            </span>
                        </p>
                        <p className="mt-1 flex items-baseline justify-between gap-3">
                            <span>
                                <span className="font-semibold" style={{ color: ink[leader(readout.p)] }}>
                                    {m.teams[leader(readout.p)].tri}
                                </span>{' '}
                                <span className="text-model">{pctText(Math.max(readout.p, 1 - readout.p))}</span>
                            </span>
                            {m.events.some(e => e.xg != null) ? (
                                <span className="text-fg-3">
                                    <span className="text-micro uppercase tracking-label">xG </span>
                                    <span style={{ color: ink[leader(readout.xp)] }}>{m.teams[leader(readout.xp)].tri}</span>{' '}
                                    <span className="text-model opacity-80">{pctText(Math.max(readout.xp, 1 - readout.xp))}</span>
                                </span>
                            ) : null}
                        </p>
                    </div>
                ) : null}
            </div>

            </div>

            {/* Verdict: how it ended against our call and the market; links to how the lines are built. */}
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-line px-card py-2 text-caption tabular-nums">
                {m.state === 'final' && winner ? (
                    <span>
                        <span className="label">Result </span>
                        <span className="font-semibold" style={{ color: ink[winner] }}>
                            {m.teams[winner].tri}
                        </span>{' '}
                        <span className="text-fg-1">
                            {Math.max(m.teams.home.score, m.teams.away.score)}–{Math.min(m.teams.home.score, m.teams.away.score)}
                            {m.outcome && m.outcome !== 'REG' ? ` ${m.outcome}` : ''}
                        </span>
                    </span>
                ) : m.state === 'live' ? (
                    <span className="label text-pos">Live</span>
                ) : null}
                {pg && callSide ? (
                    <span>
                        <span className="label">Call </span>
                        {pg.lean ? (
                            <span className="text-fg-2">
                                No lean · {m.teams[callSide].tri} {pctText(Math.max(pg.homeWin, 1 - pg.homeWin))}
                            </span>
                        ) : (
                            <>
                                <span className="font-semibold" style={{ color: ink[callSide] }}>
                                    {m.teams[callSide].tri}
                                </span>{' '}
                                <span className="text-model">{pctText(Math.max(pg.homeWin, 1 - pg.homeWin))}</span>
                                {m.state === 'final' && winner ? (
                                    <>
                                        {' '}
                                        <Check ok={callSide === winner} />
                                        <span className="sr-only">{callSide === winner ? 'right' : 'wrong'}</span>
                                    </>
                                ) : null}
                            </>
                        )}
                    </span>
                ) : null}
                {pg?.marketHome != null && mktSide ? (
                    <span>
                        <span className="label">Market </span>
                        <span className="font-semibold" style={{ color: ink[mktSide] }}>
                            {m.teams[mktSide].tri}
                        </span>{' '}
                        <span className="text-fg-1">{pctText(Math.max(pg.marketHome, 1 - pg.marketHome))}</span>
                    </span>
                ) : null}
                {m.events.some(e => e.xg != null) ? (
                    <span>
                        <span className="label">xG </span>
                        <span style={{ color: ink.away }}>{xgTot.away.toFixed(2)}</span>
                        <span className="text-fg-3">–</span>
                        <span style={{ color: ink.home }}>{xgTot.home.toFixed(2)}</span>
                        <span className="text-fg-3"> · deserved </span>
                        <span className="font-semibold" style={{ color: ink[leader(finalDeserved)] }}>
                            {m.teams[leader(finalDeserved)].tri}
                        </span>{' '}
                        <span className="text-model">{pctText(Math.max(finalDeserved, 1 - finalDeserved))}</span>
                    </span>
                ) : m.xgPending ? (
                    <span className="label text-warn">xG after the nightly run</span>
                ) : null}
                {big && bigPts > 0 ? (
                    <span>
                        <span className="label">Swing </span>
                        <span className="text-fg-1">{bigScorer ? bigScorer.last : m.teams[big.event.side].tri}</span> <span className="text-model">+{bigPts}</span>
                        <span className="text-fg-3"> {clockText(big.event.t)}</span>
                    </span>
                ) : null}
                <Link href="/methodology#game-story" className="ml-auto text-micro uppercase tracking-label text-fg-3 underline-offset-4 hover:text-fg-1 hover:underline">
                    Method
                </Link>
            </div>

            {/* Screen readers: announce a step or a held moment, never every pointer move. */}
            <p className="sr-only" aria-live="polite">
                {sel && hover == null && pinT == null ? `${clockText(sel.t)}. ${describe(sel)}.` : pinT != null && readout ? `${clockText(pinT)}. ${m.teams.away.tri} ${readout.sc.away}, ${m.teams.home.tri} ${readout.sc.home}.` : ''}
            </p>
            <table className="sr-only">
                <caption>Goals and penalties with {m.teams.home.tri} win probability</caption>
                <thead>
                    <tr>
                        <th scope="col">Time</th>
                        <th scope="col">Event</th>
                        <th scope="col">{m.teams.home.tri} win before</th>
                        <th scope="col">{m.teams.home.tri} win after</th>
                    </tr>
                </thead>
                <tbody>
                    {keyEvents.map(e => {
                        const sw = swings.find(s => s.event.id === e.id);
                        return (
                            <tr key={e.id}>
                                <td>{clockText(e.t)}</td>
                                <td>{describe(e)}</td>
                                <td>{sw ? pctText(sw.before) : ''}</td>
                                <td>{sw ? pctText(sw.after) : ''}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            {iceT != null ? (
                <div className="xl:hidden">
                    <OnIce t={iceT} caption={<>On ice · {focusT == null ? (m.state === 'final' ? 'final horn' : 'now') : clockText(iceT)}</>} />
                </div>
            ) : null}
        </div>
    );
}
