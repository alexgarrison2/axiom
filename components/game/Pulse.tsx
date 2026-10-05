'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { clockOf, perMinute, periodLabel, powerPlays, race, shortName, winModel, winSeries, type FlowMetric, type TeamStrength } from '@/lib/game/analytics';
import { SIDES, type GameEvent } from '@/lib/game/types';
import { useGame } from './GameContext';

const BAR_METRICS: { value: FlowMetric; label: string }[] = [
    { value: 'attempts', label: 'Att' },
    { value: 'unblocked', label: 'Unbl' },
    { value: 'sog', label: 'SOG' },
    { value: 'xg', label: 'xG' },
];
const RACE_METRICS: { value: FlowMetric; label: string }[] = [
    { value: 'xg', label: 'xG' },
    { value: 'sog', label: 'SOG' },
    { value: 'attempts', label: 'Att' },
    { value: 'goals', label: 'G' },
];

const pctText = (p: number) => `${Math.round(p * 100)}%`;
const fmt = (metric: FlowMetric, v: number) => (metric === 'xg' ? v.toFixed(2) : String(Math.round(v)));

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

export function Pulse() {
    const { m, colors, byId, selected, select, keyEvents } = useGame();
    const [barMetric, setBarMetric] = React.useState<FlowMetric>('attempts');
    const [raceMetric, setRaceMetric] = React.useState<FlowMetric>(m.xgPending && !m.events.some(e => e.xg != null) ? 'sog' : 'xg');
    const [strength, setStrength] = React.useState<TeamStrength>('all');
    const [hover, setHover] = React.useState<number | null>(null);
    const [wrapRef, width] = useWidth<HTMLDivElement>();
    const compact = width > 0 && width < 640;

    const domain = Math.max(3600, m.end);
    const W = Math.max(width, 320);
    const padL = compact ? 30 : 40;
    const padR = compact ? 30 : 44;
    const plot = W - padL - padR;
    const x = (t: number) => padL + (Math.min(t, domain) / domain) * plot;

    // Goal pins: greedy rows so collided headshots stack instead of hiding each other.
    const pinR = compact ? 12 : 17;
    const goalsAll = m.events.filter(e => e.type === 'goal');
    const pinRow = new Map<number, number>();
    const rowEnds: number[] = [];
    for (const g of goalsAll) {
        const gx = x(g.t);
        let r = rowEnds.findIndex(end => gx - end >= pinR * 2 + 2);
        if (r < 0) {
            r = Math.min(rowEnds.length, 2);
        }
        rowEnds[r] = gx;
        pinRow.set(g.id, r);
    }
    const rows = Math.max(1, rowEnds.length);
    const pinStep = pinR * 1.55;

    // Lanes, top to bottom.
    const pinH = pinR * 2 + 6 + (rows - 1) * pinStep;
    const winH = compact ? 70 : 96;
    const barH = compact ? 76 : 104;
    const raceH = compact ? 60 : 84;
    const gap = 22;
    const winTop = pinH;
    const barTop = winTop + winH + gap;
    const raceTop = barTop + barH + gap;
    const axisTop = raceTop + raceH + 6;
    const H = axisTop + 18;

    const win = React.useMemo(() => winSeries(m), [m]);
    const wm = React.useMemo(() => winModel(m), [m]);
    const bins = React.useMemo(() => perMinute(m, barMetric, strength), [m, barMetric, strength]);
    const races = React.useMemo(() => race(m, raceMetric, strength), [m, raceMetric, strength]);
    const pps = React.useMemo(() => powerPlays(m).filter(([a, b]) => b - a >= 10), [m]);
    const goals = goalsAll;

    const yWin = (p: number) => winTop + (1 - p) * winH;
    const binMax = Math.max(1, ...bins.away, ...bins.home);
    const half = barH / 2;
    const axisY = barTop + half;
    const raceMax = Math.max(raceMetric === 'xg' ? 1 : 3, races.away[races.away.length - 1][1], races.home[races.home.length - 1][1]);
    const yRace = (v: number) => raceTop + raceH - (v / raceMax) * raceH;

    const winPath = stepPath(win, x, yWin);
    const winArea = `${winPath}V${yWin(0.5)}H${x(0).toFixed(1)}Z`;
    const seams = [1200, 2400, 3600, ...(m.end > 3600 ? [3600 + m.otLength] : [])].filter(t => t < domain);
    const periods = [1, 2, 3, ...(m.end > 3600 ? [4] : [])];
    const pStart = (p: number) => (p <= 3 ? (p - 1) * 1200 : 3600);
    const pEnd = (p: number) => (p <= 3 ? p * 1200 : domain);

    // Score and race values at a moment.
    const at = (t: number) => {
        const sc = { away: 0, home: 0 };
        for (const g of goals) if (g.t <= t) sc[g.side] += 1;
        const rv = { away: 0, home: 0 };
        for (const s of SIDES) for (const [tt, v] of races[s]) if (tt <= t) rv[s] = v;
        const p = t >= m.end && m.state === 'final' ? (m.teams.home.score > m.teams.away.score ? 1 : 0) : wm.at(t, sc.home - sc.away);
        return { sc, rv, p };
    };

    const step = (dir: 1 | -1) => {
        if (!keyEvents.length) return;
        const i = keyEvents.findIndex(e => e.id === selected);
        const next = i < 0 ? (dir === 1 ? 0 : keyEvents.length - 1) : Math.min(keyEvents.length - 1, Math.max(0, i + dir));
        select(keyEvents[next].id);
    };
    const onKey = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            step(1);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            step(-1);
        } else if (e.key === 'Escape') select(null);
    };
    const onMove = (e: React.PointerEvent<SVGRectElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * plot;
        setHover(Math.max(0, Math.min(m.end || domain, (px / plot) * domain)));
    };

    const sel = selected != null ? m.events.find(e => e.id === selected) ?? null : null;
    const focusT = hover ?? sel?.t ?? null;
    const readout = focusT != null ? at(focusT) : null;
    const ri = sel ? keyEvents.findIndex(e => e.id === sel.id) : -1;

    const describe = (e: GameEvent) => {
        const p = e.player != null ? byId.get(e.player) : undefined;
        if (e.type === 'goal') return `Goal ${m.teams[e.side].tri} · ${shortName(p)}${e.strength !== 'ev' ? ` (${e.strength.toUpperCase()})` : ''}${e.emptyNet ? ' (EN)' : ''}`;
        return `${m.teams[e.side].tri} penalty · ${shortName(p)}${e.detail ? ` · ${e.detail.replace(/-/g, ' ')}` : ''}${e.minutes ? ` ${e.minutes}:00` : ''}`;
    };

    return (
        <div className="panel overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-card py-2">
                <Segmented label="Bars" size="sm" value={barMetric} onChange={setBarMetric} options={BAR_METRICS} optionClassName="px-2" />
                <Segmented label="Race" size="sm" value={raceMetric} onChange={setRaceMetric} options={RACE_METRICS} optionClassName="px-2" />
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
                        {ri >= 0 ? `${ri + 1} / ${keyEvents.length}` : `${goals.length} goals`}
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

            <div ref={wrapRef} className="relative min-w-0 px-0 pt-2 outline-none focus-visible:outline-offset-[-2px]" tabIndex={0} onKeyDown={onKey} aria-label="Game pulse. Left and right arrows step through goals and penalties.">
                {width ? (
                    <svg
                        viewBox={`0 0 ${W} ${H}`}
                        width="100%"
                        height={H}
                        role="img"
                        aria-label={`Win probability, ${barMetric} per minute and running ${raceMetric} for ${m.teams.away.tri} and ${m.teams.home.tri}, ${goals.length} goals.`}
                        className="block select-none font-mono tabular-nums"
                    >
                        <defs>
                            {/* Power plays: a neutral ink hatch (no team colour can collide with it), named by an amber PP tag. */}
                            <pattern id="pulse-pp" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                                <line x1={0} y1={0} x2={0} y2={6} className="stroke-fg-1" strokeWidth={1.2} strokeOpacity={0.16} />
                            </pattern>
                            <clipPath id="pulse-home">
                                <rect x={0} y={winTop} width={W} height={winH / 2} />
                            </clipPath>
                            <clipPath id="pulse-away">
                                <rect x={0} y={winTop + winH / 2} width={W} height={winH / 2} />
                            </clipPath>
                        </defs>

                        {/* Power plays: amber bands behind the bars, a team-coloured edge on the side with the extra skater. */}
                        {pps.map(([a, b, side], i) => (
                            <g key={i}>
                                <rect x={x(a)} y={barTop} width={Math.max(1, x(b) - x(a))} height={barH} fill="url(#pulse-pp)" />
                                {/* Amber cap on every window (any width), the PP tag where it fits. */}
                                <rect x={x(a)} y={barTop - 3} width={Math.max(2, x(b) - x(a))} height={2} className="fill-warn" />
                                {x(b) - x(a) >= 16 ? (
                                    <text x={(x(a) + x(b)) / 2} y={barTop - 7} textAnchor="middle" className="fill-warn text-micro font-bold">
                                        PP
                                    </text>
                                ) : null}
                                <rect x={x(a)} y={side === 'home' ? barTop : barTop + barH - 2} width={Math.max(1, x(b) - x(a))} height={2} fill={colors[side]} opacity={0.9} />
                            </g>
                        ))}

                        {/* Period seams and lane labels. */}
                        {seams.map(t => (
                            <line key={t} x1={x(t)} x2={x(t)} y1={winTop} y2={axisTop} className="stroke-line-strong" strokeWidth={1} />
                        ))}

                        {/* Win probability lane: home at the top, away at the bottom; the leader's half tinted. */}
                        <line x1={padL} x2={W - padR} y1={yWin(0.5)} y2={yWin(0.5)} className="stroke-line-strong" strokeDasharray="2 4" />
                        <path d={winArea} fill={colors.home} opacity={0.2} clipPath="url(#pulse-home)" />
                        <path d={winArea} fill={colors.away} opacity={0.2} clipPath="url(#pulse-away)" />
                        <path d={winPath} fill="none" className="stroke-model" strokeWidth={2} strokeLinejoin="round" />
                        <text x={padL - 6} y={winTop + 10} textAnchor="end" className="fill-fg-3 text-micro uppercase">
                            Win
                        </text>
                        <text x={padL + 4} y={winTop + 11} className="text-micro font-semibold uppercase" fill={colors.home} stroke="var(--surface-1)" strokeWidth={3} paintOrder="stroke">
                            {m.teams.home.tri}
                        </text>
                        <text x={padL + 4} y={winTop + winH - 3} className="text-micro font-semibold uppercase" fill={colors.away} stroke="var(--surface-1)" strokeWidth={3} paintOrder="stroke">
                            {m.teams.away.tri}
                        </text>
                        <text x={W - padR + 6} y={yWin(win[win.length - 1][1]) + 4} className="fill-model text-micro font-semibold">
                            {pctText(Math.max(win[win.length - 1][1], 1 - win[win.length - 1][1]))}
                        </text>

                        {/* Per-minute bars: home above the axis, away below. */}
                        {SIDES.map(side =>
                            bins[side].map((v, i) => {
                                if (!v) return null;
                                const h = (v / binMax) * (half - 2);
                                const bx = x(i * 60) + 0.5;
                                const bw = Math.max(1, x((i + 1) * 60) - x(i * 60) - 1);
                                return <rect key={`${side}${i}`} x={bx} y={side === 'home' ? axisY - h : axisY} width={bw} height={h} fill={colors[side]} opacity={0.85} />;
                            }),
                        )}
                        <line x1={padL} x2={W - padR} y1={axisY} y2={axisY} className="stroke-fg-3" strokeWidth={1} />
                        <text x={padL + 4} y={barTop + 11} className="text-micro font-semibold uppercase" fill={colors.home} stroke="var(--surface-1)" strokeWidth={3} paintOrder="stroke">
                            {m.teams.home.tri}
                        </text>
                        <text x={padL + 4} y={barTop + barH - 3} className="text-micro font-semibold uppercase" fill={colors.away} stroke="var(--surface-1)" strokeWidth={3} paintOrder="stroke">
                            {m.teams.away.tri}
                        </text>
                        <text x={padL - 6} y={barTop + 10} textAnchor="end" className="fill-fg-3 text-micro uppercase">
                            {BAR_METRICS.find(b => b.value === barMetric)?.label}
                        </text>

                        {/* Running totals. */}
                        <line x1={padL} x2={W - padR} y1={raceTop + raceH} y2={raceTop + raceH} className="stroke-line" />
                        {SIDES.map(side => (
                            <path key={side} d={stepPath(races[side], x, yRace)} fill="none" stroke={colors[side]} strokeWidth={2} strokeLinejoin="round" />
                        ))}
                        {SIDES.map(side => {
                            const last = races[side][races[side].length - 1];
                            const other = races[side === 'away' ? 'home' : 'away'];
                            const oy = yRace(other[other.length - 1][1]);
                            let ly = yRace(last[1]) + 4;
                            if (Math.abs(ly - 4 - oy) < 12 && side === 'away') ly += 12;
                            return (
                                <text key={side} x={W - padR + 6} y={ly} className="text-micro font-semibold" fill={colors[side]}>
                                    {fmt(raceMetric, last[1])}
                                </text>
                            );
                        })}
                        <text x={padL - 6} y={raceTop + 10} textAnchor="end" className="fill-fg-3 text-micro uppercase">
                            {RACE_METRICS.find(r => r.value === raceMetric)?.label}
                        </text>

                        {/* Period labels. */}
                        {periods.map(p => (
                            <text key={p} x={(x(pStart(p)) + x(Math.min(pEnd(p), domain))) / 2} y={H - 4} textAnchor="middle" className="fill-fg-3 text-micro uppercase">
                                {periodLabel(p)}
                            </text>
                        ))}

                        {/* Goal pins: a hairline through every lane, the scorer's face at the top. */}
                        {goals.map(g => {
                            const gx = x(g.t);
                            const p = g.player != null ? byId.get(g.player) : undefined;
                            const lit = g.id === selected;
                            const cy = pinR + 3 + (pinRow.get(g.id) ?? 0) * pinStep;
                            return (
                                <g key={g.id} onClick={() => select(lit ? null : g.id)} className="cursor-pointer">
                                    <title>{`${periodLabel(g.period)} ${g.clock} · ${m.teams[g.side].tri} · ${shortName(p)}`}</title>
                                    <line x1={gx} x2={gx} y1={cy + pinR} y2={raceTop + raceH} stroke={colors[g.side]} strokeOpacity={lit ? 1 : 0.55} strokeWidth={lit ? 2 : 1} />
                                    <clipPath id={`pin-${g.id}`}>
                                        <circle cx={gx} cy={cy} r={pinR - 2} />
                                    </clipPath>
                                    <circle cx={gx} cy={cy} r={pinR} className="fill-surface-2" stroke={lit ? 'var(--brand)' : colors[g.side]} strokeWidth={lit ? 2.5 : 2} />
                                    {p?.headshot ? (
                                        <image href={p.headshot} x={gx - pinR + 2} y={cy - pinR + 2} width={(pinR - 2) * 2} height={(pinR - 2) * 2} clipPath={`url(#pin-${g.id})`} preserveAspectRatio="xMidYMid slice" />
                                    ) : null}
                                </g>
                            );
                        })}

                        {/* The stop: a cyan flag on the selected event. */}
                        {sel ? (
                            <g pointerEvents="none">
                                <line x1={x(sel.t)} x2={x(sel.t)} y1={winTop} y2={axisTop} className="stroke-brand" strokeWidth={1.5} />
                                <path d={`M${x(sel.t)},${winTop} l7,4 l-7,4z`} className="fill-brand" />
                            </g>
                        ) : null}

                        {/* Playhead and pointer capture. */}
                        {hover != null ? <line x1={x(hover)} x2={x(hover)} y1={winTop} y2={axisTop} className="stroke-fg-1" strokeOpacity={0.35} pointerEvents="none" /> : null}
                        <rect
                            x={padL}
                            y={winTop}
                            width={plot}
                            height={axisTop - winTop}
                            fill="transparent"
                            onPointerMove={onMove}
                            onPointerLeave={() => setHover(null)}
                            onClick={() => {
                                if (hover == null || !keyEvents.length) return;
                                const near = keyEvents.reduce((b, e) => (Math.abs(e.t - hover) < Math.abs(b.t - hover) ? e : b));
                                if (Math.abs(x(near.t) - x(hover)) < 14) select(near.id);
                            }}
                        />
                    </svg>
                ) : (
                    <div className="h-[280px] md:h-[366px]" aria-hidden="true" />
                )}
            </div>

            {/* Readout: the hovered moment, else the stop, else the final line. */}
            <div className="grid min-h-[3.25rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-card py-2 text-caption tabular-nums" aria-live="polite">
                {readout && focusT != null ? (
                    <>
                        <p className="min-w-0 truncate">
                            <span className="text-fg-3">{focusT >= 3600 ? 'OT' : periodLabel(Math.floor(focusT / 1200) + 1)} </span>
                            <span className="text-fg-2">{clockOf(focusT >= 3600 ? focusT - 3600 : focusT % 1200)}</span>
                            {sel && hover == null ? <span className="ml-2 font-bold text-fg-1">{describe(sel)}</span> : null}
                        </p>
                        <p className="flex items-center gap-3 whitespace-nowrap">
                            <span className="font-bold text-fg-1">
                                {readout.sc.away}–{readout.sc.home}
                            </span>
                            <span className="text-model">
                                {m.teams.home.tri} {pctText(readout.p)}
                            </span>
                            <span className="hidden whitespace-nowrap sm:inline">
                                <span className="text-micro uppercase tracking-label text-fg-3">{RACE_METRICS.find(r => r.value === raceMetric)?.label} </span>
                                <span style={{ color: colors.away }}>{fmt(raceMetric, readout.rv.away)}</span>
                                <span className="text-fg-3">–</span>
                                <span style={{ color: colors.home }}>{fmt(raceMetric, readout.rv.home)}</span>
                            </span>
                        </p>
                    </>
                ) : (
                    <>
                        <p className="text-fg-3">
                            <span className="text-micro uppercase tracking-label">Win%</span> <span className="text-model">pony xG</span> ·{' '}
                            <span className="text-micro uppercase tracking-label">{BAR_METRICS.find(b => b.value === barMetric)?.label}/min</span> · running{' '}
                            {RACE_METRICS.find(r => r.value === raceMetric)?.label}
                        </p>
                        <p className={cn('text-micro uppercase tracking-label', m.xgPending ? 'text-warn' : 'text-fg-3')}>{m.xgPending ? 'xG after the nightly run' : ''}</p>
                    </>
                )}
            </div>
        </div>
    );
}
