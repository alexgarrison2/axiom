'use client';

import * as React from 'react';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { Segmented } from '@/components/ui/segmented';
import { Slider } from '@/components/ui/slider';
import { clockOf, groupMatchups, hardMatches, lineGroups, matchups, periodAt, periodLabel, type Matchup } from '@/lib/game/analytics';
import type { GameModel, Player, Side } from '@/lib/game/types';
import { ControlRow } from './ControlRow';
import { GameSection, useGame } from './GameContext';
import { TipFace, useHoverTip } from './HoverTip';
import { useWidth } from './Pulse';

type Kind = 'F' | 'D' | 'X';
/** A run of rows (or columns) for one line or pair; X is anyone outside the lines. */
interface Group {
    tag: string | null;
    kind: Kind;
    ids: number[];
    start: number;
    n: number;
}
/** A gap before row/column `at`: between lines and pairs, or (strong) where forwards give way to defence. */
type Cut = { at: number; strong: boolean };
interface Axis {
    players: Player[];
    groups: Group[];
    cuts: Cut[];
}
type View = 'players' | 'lines';
type Focus = { r: number | null; c: number | null } | null;

/** Edge bars: 10px off the grid, up to 42px long. */
const EDGE = 56;
const BAR = 42;
/** Screen height the grid leaves to the app bar, section rail, controls, legend and padding. */
const CHROME = 242;
/** Replay: the whole game in this many milliseconds. */
const REPLAY_MS = 10000;

const onResize = (cb: () => void) => {
    window.addEventListener('resize', cb);
    return () => window.removeEventListener('resize', cb);
};

const cutsOf = (items: { at: number; kind: Kind }[]): Cut[] => items.slice(1).map((g, k) => ({ at: g.at, strong: g.kind !== items[k].kind }));

/** Skaters in line order: forward lines, then D pairs, then anyone left, with a cut between each group. */
function axisOf(m: GameModel, side: Side, byId: Map<number, Player>): Axis {
    const seen = new Set<number>();
    const players: Player[] = [];
    const groups: Group[] = [];
    const rest = m.players.filter(p => p.side === side && p.pos !== 'G' && m.shifts[p.id]).map(p => p.id);
    for (const g of [...lineGroups(m, side), { kind: 'X' as const, tag: null, ids: rest }]) {
        const add = g.ids.map(id => byId.get(id)).filter((p): p is Player => !!p && !seen.has(p.id));
        if (!add.length) continue;
        groups.push({ tag: g.tag, kind: g.kind, ids: g.ids, start: players.length, n: add.length });
        for (const p of add) {
            seen.add(p.id);
            players.push(p);
        }
    }
    return { players, groups, cuts: cutsOf(groups.map(g => ({ at: g.start, kind: g.kind }))) };
}

/** Offset of row/column `i`: whole cells plus a gap for every cut at or before it. */
const offsetOf = (i: number, cell: number, gap: number, cuts: Cut[]) => i * cell + gap * cuts.filter(c => c.at <= i).length;

/** Area-true split: the upper-left part of an s-square covering `share` of it, cut along the anti-diagonal direction. */
function splitPath(x0: number, y0: number, s: number, share: number): string {
    if (share <= 0) return '';
    if (share >= 1) return `M${x0},${y0}h${s}v${s}h${-s}Z`;
    if (share <= 0.5) {
        const l = s * Math.sqrt(2 * share);
        return `M${x0},${y0}h${l}L${x0},${y0 + l}Z`;
    }
    const l = s * Math.sqrt(2 * (1 - share));
    return `M${x0},${y0}h${s}v${s - l}L${x0 + s - l},${y0 + s}H${x0}Z`;
}

/** Goals while both were on: away pips in the away (upper-left) corner, home pips in the lower-right. */
function Pips({ x0, y0, s, g }: { x0: number; y0: number; s: number; g: Record<Side, number> }) {
    if (!g.away && !g.home) return null;
    const r = s >= 30 ? 2.25 : 1.75;
    const step = r * 2 + 1.5;
    const pad = r + 2;
    return (
        <g className="fill-fg-1" stroke="var(--bg)" strokeWidth={0.75} pointerEvents="none">
            {Array.from({ length: g.away }, (_, k) => (
                <circle key={`a${k}`} cx={x0 + pad + k * step} cy={y0 + pad} r={r} />
            ))}
            {Array.from({ length: g.home }, (_, k) => (
                <circle key={`h${k}`} cx={x0 + s - pad - k * step} cy={y0 + s - pad} r={r} />
            ))}
        </g>
    );
}

const xgShare = (c: Matchup) => {
    const tot = c.xg.away + c.xg.home;
    return tot > 0 ? c.xg.away / tot : null;
};

/** One side of a tip header: a skater's face and name, or a line's tag and names. Home mirrors away. */
function TipHead({ side, face, title, sub }: { side: Side; face: React.ReactNode; title: React.ReactNode; sub: React.ReactNode }) {
    const text = (
        <span className="min-w-0 leading-tight">
            <span className="block truncate font-bold text-fg-1">{title}</span>
            <span className="block text-micro text-fg-3">{sub}</span>
        </span>
    );
    return (
        <div className={side === 'home' ? 'flex min-w-0 items-center gap-2 text-right' : 'flex min-w-0 items-center gap-2'}>
            {side === 'away' ? face : null}
            {text}
            {side === 'home' ? face : null}
        </div>
    );
}

/** Head-to-head card: both sides, 5v5 time, then attempts / xG / goals mirrored, and an optional line note. */
function MatchupTip({ away, home, c, note }: { away: React.ReactNode; home: React.ReactNode; c: Matchup; note?: React.ReactNode }) {
    const { colors } = useGame();
    const share = xgShare(c) ?? 0.5;
    const row = (k: string, av: string, hv: string) => (
        <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-3">
            <span className="text-left font-semibold" style={{ color: colors.away }}>
                {av}
            </span>
            <span className="text-micro uppercase tracking-label text-fg-3">{k}</span>
            <span className="text-right font-semibold" style={{ color: colors.home }}>
                {hv}
            </span>
        </div>
    );
    return (
        <div className="flex w-64 flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
                {away}
                {home}
            </div>
            <p className="text-center text-micro uppercase tracking-label text-fg-3">
                <span className="text-body font-bold normal-case tracking-normal text-fg-1">{clockOf(c.toi)}</span> 5v5 together
            </p>
            {row('Att', String(c.att.away), String(c.att.home))}
            {row('xG', c.xg.away.toFixed(2), c.xg.home.toFixed(2))}
            {row('Goals', String(c.g.away), String(c.g.home))}
            <div className="flex h-1.5 overflow-hidden rounded-full" aria-hidden="true">
                <span style={{ width: `${share * 100}%`, background: colors.away }} />
                <span className="flex-1" style={{ background: colors.home }} />
            </div>
            <p className="text-center text-micro uppercase tracking-label text-fg-3">
                xG share {Math.round(share * 100)}–{Math.round((1 - share) * 100)}
            </p>
            {note}
        </div>
    );
}

/** One skater's or line's own 5v5 totals over the same time. */
function OwnTip({ head, c }: { head: React.ReactNode; c: Matchup }) {
    const { colors } = useGame();
    const share = xgShare(c);
    return (
        <div className="flex w-52 flex-col gap-2">
            {head}
            <p className="text-micro uppercase tracking-label text-fg-3">
                <span className="text-body font-bold normal-case tracking-normal text-fg-1">{clockOf(c.toi)}</span> 5v5
            </p>
            <div className="flex justify-between text-micro uppercase tracking-label text-fg-3">
                <span>
                    xG <span style={{ color: colors.away }}>{c.xg.away.toFixed(2)}</span>–<span style={{ color: colors.home }}>{c.xg.home.toFixed(2)}</span>
                </span>
                <span>
                    Goals <span style={{ color: colors.away }}>{c.g.away}</span>–<span style={{ color: colors.home }}>{c.g.home}</span>
                </span>
            </div>
            {share != null ? (
                <div className="flex h-1.5 overflow-hidden rounded-full" aria-hidden="true">
                    <span style={{ width: `${share * 100}%`, background: colors.away }} />
                    <span className="flex-1" style={{ background: colors.home }} />
                </div>
            ) : null}
        </div>
    );
}

function PlayIcon({ playing }: { playing: boolean }) {
    return (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
            {playing ? <path d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z" fill="currentColor" /> : <path d="M5 2.75v10.5L13.25 8z" fill="currentColor" />}
        </svg>
    );
}

export function Matchups() {
    const { m, colors, byId, label } = useGame();
    const [view, setView] = React.useState<View>('players');
    const [upTo, setUpTo] = React.useState<number | null>(null);
    const [playing, setPlaying] = React.useState(false);
    const [focus, setFocus] = React.useState<Focus>(null);
    const clock = React.useRef(0);
    const rows = React.useMemo(() => axisOf(m, 'away', byId), [m, byId]);
    const cols = React.useMemo(() => axisOf(m, 'home', byId), [m, byId]);
    const lines = React.useMemo(() => ({ away: rows.groups.filter(g => g.kind !== 'X'), home: cols.groups.filter(g => g.kind !== 'X') }), [rows, cols]);
    const t = upTo ?? Infinity;
    const grid = React.useMemo(() => matchups(m, t), [m, t]);
    const blocks = React.useMemo(() => groupMatchups(m, lines.away.map(g => g.ids), lines.home.map(g => g.ids), t), [m, lines, t]);
    const hard = React.useMemo(() => hardMatches(blocks.cells, blocks.lift), [blocks]);
    // Sizes keep the whole game's scale, so a replay grows into it.
    const scale = React.useMemo(() => {
        const full = matchups(m);
        const fb = groupMatchups(m, lines.away.map(g => g.ids), lines.home.map(g => g.ids));
        const top = (cs: Iterable<Matchup>) => Math.max(1, ...[...cs].map(c => c.toi));
        return {
            cell: top([...full.cells.values()].flatMap(r => [...r.values()])),
            ice: top(full.ice.values()),
            block: top(fb.cells.flat()),
            own: top([...fb.own.away, ...fb.own.home]),
        };
    }, [m, lines]);

    React.useEffect(() => {
        if (!playing) return;
        let raf = 0;
        let last = performance.now();
        const step = (now: number) => {
            clock.current = Math.min(m.end, clock.current + ((now - last) / REPLAY_MS) * m.end);
            last = now;
            if (clock.current >= m.end) {
                setPlaying(false);
                setUpTo(null);
                return;
            }
            setUpTo(clock.current);
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [playing, m.end]);
    const togglePlay = () => {
        if (playing) {
            setPlaying(false);
            return;
        }
        clock.current = upTo ?? 0;
        setUpTo(clock.current);
        setPlaying(true);
    };

    const { bind, tip } = useHoverTip();
    const [boxRef, boxW] = useWidth<HTMLDivElement>();
    const box = boxW || 600;
    const vh = React.useSyncExternalStore(onResize, () => window.innerHeight, () => 0);
    const narrow = boxW > 0 && boxW < 640;
    const players = view === 'players';

    // Geometry: players are one row/column each with gaps between lines; lines are one row/column per line or pair.
    const nR = players ? rows.players.length : lines.away.length;
    const nC = players ? cols.players.length : lines.home.length;
    const rowCuts = players ? rows.cuts : cutsOf(lines.away.map((g, k) => ({ at: k, kind: g.kind }))).filter(c => c.strong);
    const colCuts = players ? cols.cuts : cutsOf(lines.home.map((g, k) => ({ at: k, kind: g.kind }))).filter(c => c.strong);
    const gutter = players ? 120 : 136;
    const GAP = narrow ? 4 : 6;
    // Players: slanted names (96px, phones trim to the longest) over an 18px band of line tags. Lines: tag and names stacked.
    const longest = Math.max(0, ...cols.players.map(p => label(p.id).length));
    const slant = narrow ? Math.min(96, Math.ceil(longest * 6.4 * 0.87) + 14) : 96;
    const top = players ? slant + 18 : 62;
    const [lo, hi] = players ? [20, 44] : [52, 80];
    // Cells grow with the panel's width and shrink to keep the whole grid in one screen (less the app bar, section rail,
    // controls and legend), between a floor (the grid scrolls on phones) and a ceiling.
    const fitW = Math.floor((box - gutter - EDGE - 8 - GAP * colCuts.length) / Math.max(1, nC));
    const fitH = vh ? Math.floor((vh - CHROME - top - EDGE - GAP * rowCuts.length) / Math.max(1, nR)) : hi;
    const CELL = Math.max(lo, Math.min(hi, fitW, fitH));
    const X = (j: number) => gutter + offsetOf(j, CELL, GAP, colCuts);
    const Y = (i: number) => top + offsetOf(i, CELL, GAP, rowCuts);
    const right = X(nC);
    const bottom = Y(nR);
    const W = right + EDGE;
    const H = bottom + EDGE;

    const isDim = (i: number | null, j: number | null) => {
        if (!focus) return false;
        return !((i != null && focus.r === i) || (j != null && focus.c === j));
    };
    const fade = (dim: boolean): React.CSSProperties => ({ opacity: dim ? 0.18 : 1, transition: 'opacity 120ms' });
    const labelFade = (dim: boolean): React.CSSProperties => ({ opacity: dim ? 0.35 : 1, transition: 'opacity 120ms' });
    // Names light their row or column; a tap toggles it on touch screens.
    const nameHover = (f: { r: number | null; c: number | null }) => ({
        onPointerEnter: (e: React.PointerEvent) => e.pointerType === 'mouse' && setFocus(f),
        onPointerLeave: (e: React.PointerEvent) => e.pointerType === 'mouse' && setFocus(null),
        onClick: () => setFocus(cur => (cur && cur.r === f.r && cur.c === f.c ? null : f)),
    });

    const playerHead = (p: Player, side: Side) => (
        <TipHead side={side} face={<TipFace p={p} color={colors[side]} />} title={p.last} sub={side === 'away' ? `${m.teams.away.tri} · ${p.pos}` : `${p.pos} · ${m.teams.home.tri}`} />
    );
    const lineHead = (g: Group, side: Side) => (
        <TipHead
            side={side}
            face={
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 bg-surface-2 text-caption font-bold text-fg-1" style={{ borderColor: colors[side] }}>
                    {g.tag}
                </span>
            }
            title={m.teams[side].tri}
            sub={g.ids.map(id => byId.get(id)?.last ?? '').join(' · ')}
        />
    );
    // Which line each player row/column belongs to, for the line note in a player tip.
    const lineOf = (axis: Axis, idx: number) => {
        const g = axis.groups.find(x => idx >= x.start && idx < x.start + x.n);
        return g && g.kind !== 'X' ? (axis === rows ? lines.away : lines.home).indexOf(g) : -1;
    };
    const lineNote = (li: number, lj: number) => {
        if (li < 0 || lj < 0) return null;
        const lift = blocks.lift[li][lj];
        if (lift == null || blocks.cells[li][lj].toi < 5) return null;
        const isHard = hard.has(`${li}-${lj}`);
        return (
            <p className="border-t border-line pt-2 text-center text-micro uppercase tracking-label text-fg-3">
                {lines.away[li].tag} vs {lines.home[lj].tag}: {lift.toFixed(1)}× chance
                {isHard ? <span className="text-brand"> · hard match</span> : null}
            </p>
        );
    };

    const cell = (i: number, j: number, c: Matchup | undefined, max: number, tipNode: React.ReactNode) => {
        const cx = X(j);
        const cy = Y(i);
        const style = fade(isDim(i, j));
        if (!c || c.toi < 5) return <rect key={`${i}-${j}`} x={cx + CELL / 2 - 1} y={cy + CELL / 2 - 1} width={2} height={2} className="fill-line-strong" style={style} />;
        const s = Math.max(6, Math.sqrt(c.toi / max) * (CELL - 3));
        const x0 = cx + (CELL - s) / 2;
        const y0 = cy + (CELL - s) / 2;
        const share = xgShare(c);
        return (
            <g key={`${i}-${j}`} {...bind(tipNode, { enter: () => setFocus({ r: i, c: j }), leave: () => setFocus(null) })} className="cursor-crosshair" style={style}>
                <rect x={cx} y={cy} width={CELL} height={CELL} fill="transparent" />
                <rect x={x0} y={y0} width={s} height={s} fill={share == null ? 'var(--mute)' : colors.home} />
                {/* The away share as area: a corner triangle up to half, the square less the opposite corner above it. */}
                {share != null ? <path d={splitPath(x0, y0, s, share)} fill={colors.away} /> : null}
                <Pips x0={x0} y0={y0} s={s} g={c.g} />
            </g>
        );
    };

    /** A skater's or line's own 5v5 total at the row end (across) or column foot (down): length = time, split = xG share. */
    const edge = (dir: 'row' | 'col', k: number, c: Matchup | undefined, max: number, tipNode: React.ReactNode) => {
        if (!c || c.toi < 5) return null;
        const len = Math.max(2, (c.toi / max) * BAR);
        const share = xgShare(c);
        const th = 6;
        const awayLen = share == null ? 0 : len * share;
        const f = dir === 'row' ? { r: k, c: null } : { r: null, c: k };
        const box =
            dir === 'row'
                ? { x: right + 10, y: Y(k) + CELL / 2 - th / 2, w: len, h: th, hit: { x: right + 4, y: Y(k), w: EDGE - 4, h: CELL } }
                : { x: X(k) + CELL / 2 - th / 2, y: bottom + 10, w: th, h: len, hit: { x: X(k), y: bottom + 4, w: CELL, h: EDGE - 4 } };
        return (
            <g key={`${dir}${k}`} {...bind(tipNode, { enter: () => setFocus(f), leave: () => setFocus(null) })} style={fade(focus != null && (dir === 'row' ? focus.r !== k : focus.c !== k))}>
                <rect x={box.hit.x} y={box.hit.y} width={box.hit.w} height={box.hit.h} fill="transparent" />
                <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={1} fill={share == null ? 'var(--mute)' : colors.home} />
                {awayLen > 0 ? <rect x={box.x} y={box.y} width={dir === 'row' ? awayLen : th} height={dir === 'row' ? th : awayLen} rx={1} fill={colors.away} /> : null}
            </g>
        );
    };

    // Hard matches outline the whole block of the two lines (players) or the one cell (lines).
    const outlines = [...hard].map(key => {
        const [li, lj] = key.split('-').map(Number);
        const ga = lines.away[li];
        const gh = lines.home[lj];
        const [x, y, w, h] = players ? [X(gh.start), Y(ga.start), gh.n * CELL, ga.n * CELL] : [X(lj), Y(li), CELL, CELL];
        return <rect key={key} x={x - 2} y={y - 2} width={w + 4} height={h + 4} rx={3} fill="none" className="stroke-brand" strokeWidth={1.25} strokeDasharray="4 3" pointerEvents="none" />;
    });

    const end = m.end;
    const at = upTo == null ? null : periodAt(upTo, m.otLength);
    const readout = at ? `${periodLabel(at.period)} ${clockOf(at.into)}` : m.state === 'live' ? 'Now' : 'Full game';
    const ticks = [1200, 2400, 3600].filter(x => x < end);

    return (
        <GameSection id="matchups" title="Matchups">
            <div className="panel overflow-hidden">
                <ControlRow label="Matchup controls">
                    <Segmented
                        label="View"
                        size="sm"
                        value={view}
                        onChange={v => {
                            setView(v);
                            setFocus(null);
                        }}
                        optionClassName="px-2.5"
                        options={[
                            { value: 'players', label: 'Players' },
                            { value: 'lines', label: 'Lines' },
                        ]}
                    />
                    <button
                        type="button"
                        onClick={togglePlay}
                        aria-label={playing ? 'Pause the replay' : 'Replay the game'}
                        aria-pressed={playing}
                        className="ml-2 grid h-8 w-8 place-items-center rounded-control border border-line text-fg-2 hover:border-line-strong hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand coarse:h-11 coarse:w-11"
                    >
                        <PlayIcon playing={playing} />
                    </button>
                    <div className="relative w-36 sm:w-56">
                        <Slider
                            aria-label="Game time"
                            min={0}
                            max={end}
                            step={10}
                            value={[upTo ?? end]}
                            onValueChange={([v]) => {
                                setPlaying(false);
                                setUpTo(v >= end ? null : v);
                            }}
                            className="h-8 coarse:h-11"
                        />
                        {/* Period breaks on the track. */}
                        {ticks.map(x => (
                            <span key={x} aria-hidden="true" className="pointer-events-none absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-line-strong" style={{ left: `${(x / end) * 100}%` }} />
                        ))}
                    </div>
                    <span className="min-w-[4.5rem] text-micro uppercase tracking-label text-fg-2 tabular-nums" aria-live="off">
                        {readout}
                    </span>
                </ControlRow>
                <div ref={boxRef} className="min-w-0 px-card">
                    <ScrollRegion label="5v5 matchup grid" className="py-card">
                        <svg
                            viewBox={`0 0 ${W} ${H}`}
                            width={W}
                            height={H}
                            role="img"
                            aria-label={`5v5 time and xG for every ${m.teams.away.tri} ${players ? 'skater' : 'line and pair'} against every ${m.teams.home.tri} ${players ? 'skater' : 'line and pair'}`}
                            className="block font-mono"
                            onPointerLeave={() => setFocus(null)}
                        >
                            {/* Hairlines in the gaps: faint between lines and pairs, firmer where forwards meet defence. */}
                            {colCuts.map(c => (
                                <line key={`c${c.at}`} x1={X(c.at) - GAP / 2} x2={X(c.at) - GAP / 2} y1={top} y2={bottom} className={c.strong ? 'stroke-line-strong' : 'stroke-line'} />
                            ))}
                            {rowCuts.map(c => (
                                <line key={`r${c.at}`} y1={Y(c.at) - GAP / 2} y2={Y(c.at) - GAP / 2} x1={players ? 30 : gutter - 4} x2={right} className={c.strong ? 'stroke-line-strong' : 'stroke-line'} />
                            ))}

                            {players ? (
                                <>
                                    {/* Line tags: a bracket over each group of columns, a rule beside each group of rows. */}
                                    {cols.groups.map(g =>
                                        g.tag ? (
                                            <g key={g.tag} style={labelFade(focus?.c != null && (focus.c < g.start || focus.c >= g.start + g.n))}>
                                                <text x={X(g.start) + (g.n * CELL) / 2} y={top - 8} textAnchor="middle" className="fill-fg-3 text-micro">
                                                    {g.tag}
                                                </text>
                                                <line x1={X(g.start) + 3} x2={X(g.start) + g.n * CELL - 3} y1={top - 4} y2={top - 4} className="stroke-line-strong" />
                                            </g>
                                        ) : null,
                                    )}
                                    {rows.groups.map(g =>
                                        g.tag ? (
                                            <g key={g.tag} style={labelFade(focus?.r != null && (focus.r < g.start || focus.r >= g.start + g.n))}>
                                                <text x={0} y={Y(g.start) + (g.n * CELL) / 2 + 4} className="fill-fg-3 text-micro">
                                                    {g.tag}
                                                </text>
                                                <line x1={24} x2={24} y1={Y(g.start) + 3} y2={Y(g.start) + g.n * CELL - 3} className="stroke-line-strong" />
                                            </g>
                                        ) : null,
                                    )}
                                    {cols.players.map((p, j) => (
                                        <text
                                            key={p.id}
                                            transform={`translate(${X(j) + CELL / 2 - 4},${slant - 6}) rotate(-60)`}
                                            className="cursor-pointer text-micro"
                                            fill={colors.home}
                                            style={labelFade(focus?.c != null && focus.c !== j)}
                                            {...nameHover({ r: null, c: j })}
                                        >
                                            {label(p.id)}
                                        </text>
                                    ))}
                                    {rows.players.map((a, i) => (
                                        <text
                                            key={a.id}
                                            x={gutter - 8}
                                            y={Y(i) + CELL / 2 + 4}
                                            textAnchor="end"
                                            className="cursor-pointer text-micro"
                                            fill={colors.away}
                                            style={labelFade(focus?.r != null && focus.r !== i)}
                                            {...nameHover({ r: i, c: null })}
                                        >
                                            {label(a.id)}
                                        </text>
                                    ))}
                                    {rows.players.flatMap((a, i) =>
                                        cols.players.map((h, j) => {
                                            const c = grid.cells.get(a.id)?.get(h.id);
                                            return cell(i, j, c, scale.cell, c ? <MatchupTip away={playerHead(a, 'away')} home={playerHead(h, 'home')} c={c} note={lineNote(lineOf(rows, i), lineOf(cols, j))} /> : null);
                                        }),
                                    )}
                                    {rows.players.map((a, i) => {
                                        const c = grid.ice.get(a.id);
                                        return edge('row', i, c, scale.ice, c ? <OwnTip head={playerHead(a, 'away')} c={c} /> : null);
                                    })}
                                    {cols.players.map((h, j) => {
                                        const c = grid.ice.get(h.id);
                                        return edge('col', j, c, scale.ice, c ? <OwnTip head={playerHead(h, 'home')} c={c} /> : null);
                                    })}
                                </>
                            ) : (
                                <>
                                    {lines.home.map((g, j) => (
                                        <g key={g.tag} className="cursor-pointer" style={labelFade(focus?.c != null && focus.c !== j)} {...nameHover({ r: null, c: j })}>
                                            <text x={X(j) + CELL / 2} y={12} textAnchor="middle" className="fill-fg-1 text-micro font-bold">
                                                {g.tag}
                                            </text>
                                            {g.ids.map((id, k) => (
                                                <text
                                                    key={id}
                                                    x={X(j) + CELL / 2}
                                                    y={12 + 13 * (k + 1)}
                                                    textAnchor="middle"
                                                    className="text-micro"
                                                    fill={colors.home}
                                                    // A name wider than its column squeezes to fit rather than run into the next one.
                                                    {...(label(id).length * 5.8 > CELL - 6 ? { textLength: CELL - 6, lengthAdjust: 'spacingAndGlyphs' } : {})}
                                                >
                                                    {label(id)}
                                                </text>
                                            ))}
                                        </g>
                                    ))}
                                    {lines.away.map((g, i) => (
                                        <g key={g.tag} className="cursor-pointer" style={labelFade(focus?.r != null && focus.r !== i)} {...nameHover({ r: i, c: null })}>
                                            <text x={0} y={Y(i) + CELL / 2 + 4} className="fill-fg-1 text-micro font-bold">
                                                {g.tag}
                                            </text>
                                            {g.ids.map((id, k) => (
                                                <text key={id} x={gutter - 8} y={Y(i) + CELL / 2 + 4 + 13 * (k - (g.ids.length - 1) / 2)} textAnchor="end" className="text-micro" fill={colors.away}>
                                                    {label(id)}
                                                </text>
                                            ))}
                                        </g>
                                    ))}
                                    {lines.away.flatMap((ga, i) =>
                                        lines.home.map((gh, j) => {
                                            const c = blocks.cells[i][j];
                                            return cell(i, j, c, scale.block, <MatchupTip away={lineHead(ga, 'away')} home={lineHead(gh, 'home')} c={c} note={lineNote(i, j)} />);
                                        }),
                                    )}
                                    {lines.away.map((g, i) => edge('row', i, blocks.own.away[i], scale.own, <OwnTip head={lineHead(g, 'away')} c={blocks.own.away[i]} />))}
                                    {lines.home.map((g, j) => edge('col', j, blocks.own.home[j], scale.own, <OwnTip head={lineHead(g, 'home')} c={blocks.own.home[j]} />))}
                                </>
                            )}
                            {outlines}
                        </svg>
                        {tip}
                    </ScrollRegion>
                </div>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-card py-2 text-micro uppercase tracking-label text-fg-3">
                    <span>5v5</span>
                    <span>Size = time head to head</span>
                    <span className="flex items-center gap-1.5">
                        Split = xG share
                        <span className="h-2.5 w-2.5" style={{ background: colors.away }} />
                        {m.teams.away.tri}
                        <span className="h-2.5 w-2.5" style={{ background: colors.home }} />
                        {m.teams.home.tri}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-fg-1" />
                        Goal
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-3.5 rounded-[2px] border border-dashed border-brand" />
                        Hard match
                    </span>
                    <span>Edge bars = {players ? 'skater' : 'line'} 5v5 total</span>
                </p>
            </div>
        </GameSection>
    );
}
