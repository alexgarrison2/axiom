'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { legibleOn } from '@/components/ui/color';
import { cn } from '@/lib/utils';
import {
    clockOf,
    goalMarkers,
    goalieRows,
    leadStretches,
    lineup,
    onIce,
    pairKey,
    pairTimes,
    playerStretches,
    skaterRows,
    unitMatchups,
    units,
    type MarkerKind,
    type SkaterRow,
    type Unit,
} from '@/lib/game/analytics';
import { SIDES, type Side } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';
import { TipFace, TipRow, useHoverTip } from './HoverTip';
import { useWidth } from './Pulse';

/*
 * Player usage, per team (after hockeyviz's usage chart, in Neon Arcade):
 *   - forwards on four lines and defenders on three pairs (5v5 time decides
 *     who plays with whom); every box is the whole game: his shifts as
 *     strips coloured by strength, period seams, the stretches his team led,
 *     and markers at each goal he was on the ice for (his goal, his primary
 *     assist, another goal for, a goal against);
 *   - bars between linemates grow with even-strength time together; links
 *     to players on other lines appear when a player is focused;
 *   - each line, pair and unit's results to the right: xG share, goals,
 *     shot-attempt share and zone starts (cards on hover / focus list the
 *     opposing lines it faced);
 *   - the top two power-play and penalty-kill units, the goalie;
 *   - every skater's minutes, split even strength / power play / penalty kill.
 */

const BOX_H = 22;
const NAME_H = 15;
const ROW = BOX_H + NAME_H + 16;
const SECTION = 26;
/** Below this much time together a line's results are a thin sample. */
const THIN = 180;
const PANEL = '#0a0e15';

type Ctx = 'es' | 'pp' | 'sh';

interface Node {
    id: number;
    x: number;
    y: number;
    w: number;
}

const pctOf = (a: number, b: number) => (a + b > 0 ? Math.round((a / (a + b)) * 100) : null);

function Markers({ list, x, w, y, end }: { list: { t: number; kind: MarkerKind }[]; x: number; w: number; y: number; end: number }) {
    return (
        <>
            {list.map((mk, i) => {
                const mx = x + 3 + (Math.min(mk.t, end) / end) * (w - 6);
                const cy = y + BOX_H / 2;
                return (
                    <g key={i} pointerEvents="none">
                        {mk.kind === 'goal' ? <line x1={mx} x2={mx} y1={y - 3} y2={y + BOX_H + 3} className="stroke-fg-1" strokeWidth={1.5} /> : null}
                        {mk.kind === 'a1' ? <line x1={mx} x2={mx} y1={cy} y2={y + BOX_H + 3} className="stroke-fg-1" strokeWidth={1.5} /> : null}
                        {/* Goals for are filled green, goals against a red ring: shape as well as colour. */}
                        {mk.kind === 'ga' ? (
                            <circle cx={mx} cy={cy} r={3.4} fill="var(--surface-1)" stroke="var(--neg)" strokeWidth={1.8} />
                        ) : (
                            <circle cx={mx} cy={cy} r={mk.kind === 'goal' || mk.kind === 'a1' ? 4 : 3.4} fill="var(--pos)" stroke="var(--surface-1)" strokeWidth={1} />
                        )}
                    </g>
                );
            })}
        </>
    );
}

/** A line / pair / unit's card: every on-ice number, and (5v5 groups) the opposing lines it faced. */
function UnitTip({ u, kind, side }: { u: Unit; kind: 'F' | 'D' | 'PP' | 'PK'; side: Side }) {
    const { m, label, colors } = useGame();
    const faced = kind === 'F' || kind === 'D' ? unitMatchups(m, side, u.ids).slice(0, 3) : [];
    const opp = side === 'away' ? 'home' : 'away';
    const xgp = pctOf(u.xgf, u.xga);
    const cfp = pctOf(u.cf, u.ca);
    return (
        <div className="flex w-64 flex-col gap-1.5">
            <p className="font-bold leading-tight text-fg-1">{u.ids.map(id => label(id)).join(' · ')}</p>
            <p className="text-micro uppercase tracking-label text-fg-3">
                {kind === 'F' ? 'Forward line · 5v5' : kind === 'D' ? 'Defence pair · 5v5' : kind === 'PP' ? 'Power-play unit' : 'Penalty-kill unit'}
                {u.toi < THIN && (kind === 'F' || kind === 'D') ? <span className="text-warn"> · thin sample</span> : null}
            </p>
            <TipRow k="Together">
                {clockOf(u.toi)} <span className="text-fg-3">· {u.stints} stints</span>
            </TipRow>
            <TipRow k="xG">
                <span className="text-model">
                    {u.xgf.toFixed(2)}–{u.xga.toFixed(2)}
                </span>
                {xgp != null ? <span className="text-fg-3"> · {xgp}%</span> : null}
            </TipRow>
            <TipRow k="Goals">
                {u.gf}–{u.ga}
            </TipRow>
            <TipRow k="Attempts">
                {u.cf}–{u.ca}
                {cfp != null ? <span className="text-fg-3"> · {cfp}%</span> : null}
            </TipRow>
            <TipRow k="Shots">
                {u.sf}–{u.sa}
            </TipRow>
            <TipRow k="Starts">
                <span className="text-fg-3">OZ</span> {u.oz} <span className="text-fg-3">NZ</span> {u.nz} <span className="text-fg-3">DZ</span> {u.dz}
            </TipRow>
            {faced.length ? (
                <div className="mt-1 flex flex-col gap-1 border-t border-line pt-1.5">
                    <p className="text-micro uppercase tracking-label text-fg-3">Faced</p>
                    {faced.map(f => (
                        <div key={f.ids.join('-')} className="flex items-baseline justify-between gap-3">
                            <span className="truncate" style={{ color: legibleOn(colors[opp], PANEL) }}>
                                {f.ids.map(id => label(id)).join(' · ')}
                            </span>
                            <span className="whitespace-nowrap tabular-nums text-fg-2">
                                {clockOf(f.toi)} <span className="text-model">{f.xgf.toFixed(2)}–{f.xga.toFixed(2)}</span>
                            </span>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

/** Minutes card: the ES / PP / PK split with shares, then shift count and length. */
function MinutesTip({ r, color, rank }: { r: SkaterRow; color: string; rank: string }) {
    const parts: [string, number, string][] = [
        ['Even', r.toiEv, 'rgb(var(--text-3-rgb) / 0.6)'],
        ['Power play', r.toiPp, 'var(--pp)'],
        ['Penalty kill', r.toiSh, 'var(--pk)'],
    ];
    return (
        <div className="flex w-56 flex-col gap-2">
            <div className="flex items-center gap-2">
                <TipFace p={r.player} color={color} />
                <span className="leading-tight">
                    <span className="block font-bold text-fg-1">
                        {r.player.first} {r.player.last}
                    </span>
                    <span className="text-micro text-fg-3">
                        #{r.player.num ?? '–'} · {r.player.pos} · {rank}
                    </span>
                </span>
                <span className="ml-auto font-display text-title font-bold text-fg-1">{clockOf(r.toi)}</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full" aria-hidden="true">
                {parts.map(([k, v, c]) => (
                    <span key={k} style={{ width: `${(v / Math.max(1, r.toi)) * 100}%`, background: c }} />
                ))}
            </div>
            {parts.map(([k, v, c]) => (
                <TipRow
                    key={k}
                    k={
                        <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-[2px]" style={{ background: c }} />
                            {k}
                        </span>
                    }
                >
                    {clockOf(v)} <span className="text-fg-3">· {Math.round((v / Math.max(1, r.toi)) * 100)}%</span>
                </TipRow>
            ))}
            <TipRow k="Shifts" className="border-t border-line pt-1.5">
                {r.shifts} <span className="text-fg-3">· avg {clockOf(r.toi / Math.max(1, r.shifts))}</span>
            </TipRow>
        </div>
    );
}

interface FocusProps {
    side: Side;
    focus: number | null;
    setFocus: (id: number | null) => void;
}

function TeamUsage({ side, focus, setFocus }: FocusProps) {
    const { m, label, colors, selected } = useGame();
    const [ref, width] = useWidth<HTMLDivElement>();
    const { bind, tip } = useHoverTip();
    const W = Math.max(width, 300);
    const end = Math.max(3600, m.end);
    const ink = legibleOn(colors[side], PANEL);
    // Results sit in their own column when there is room, else under each row.
    const resW = W >= 620 ? 168 : 0;
    const diagW = resW ? W - resW - 16 : W;
    const resLine = resW ? 0 : 30;

    const data = React.useMemo(() => {
        const goalie = goalieRows(m, side)[0] ?? null;
        const fUnits = new Map(units(m, side, 'F').map(u => [u.ids.join('-'), u]));
        const dUnits = new Map(units(m, side, 'D').map(u => [u.ids.join('-'), u]));
        const rows = new Map(skaterRows(m, side, 'all').map(r => [r.player.id, r]));
        const lu = lineup(m, side);
        const ids = new Set([...lu.forwards.flat(), ...lu.defense.flat(), ...(goalie ? [goalie.player.id] : [])]);
        const pp = units(m, side, 'PP').slice(0, 2);
        const pk = units(m, side, 'PK').slice(0, 2);
        for (const u of [...pp, ...pk]) u.ids.forEach(id => ids.add(id));
        const stretches = new Map([...ids].map(id => [id, playerStretches(m, id, side)]));
        return {
            lu,
            fUnits,
            dUnits,
            rows,
            stretches,
            lead: leadStretches(m, side),
            pairs: pairTimes(m, side),
            pp,
            pk,
            goalie,
            goalieGa: goalie ? m.events.filter(e => e.type === 'goal' && e.side !== side && (m.shifts[goalie.player.id] ?? []).some(([a, b]) => e.t > a && e.t <= b)) : [],
        };
    }, [m, side]);

    const sel = selected != null ? (m.events.find(e => e.id === selected) ?? null) : null;
    const selIce = sel ? onIce(m, sel) : null;

    // Layout: sections stacked, nodes on a three-column grid (five for special teams), left-aligned so timelines line up.
    type Placed = Node & { ctx: Ctx; tint: string | null };
    const nodes: Placed[] = [];
    const links: { a: Node; b: Node; t: number; inLine: boolean }[] = [];
    const titles: { y: number; text: string }[] = [];
    const results: { y: number; u: Unit | null; kind: 'F' | 'D' | 'PP' | 'PK' }[] = [];
    let y = 0;

    const placeRows = (rows: { ids: number[]; u: Unit | null }[], cols: number, ctx: Ctx, tint: string | null, title: string, kind: 'F' | 'D' | 'PP' | 'PK') => {
        if (!rows.length) return;
        titles.push({ y: y + 12, text: title });
        y += SECTION;
        const gap = cols >= 5 ? 8 : 16;
        const nodeW = (diagW - gap * (cols - 1)) / cols;
        const placed: Node[][] = [];
        rows.forEach(({ ids, u }) => {
            const row = ids.map((id, i) => ({ id, x: i * (nodeW + gap), y: y + NAME_H, w: nodeW }));
            row.forEach(n => nodes.push({ ...n, ctx, tint }));
            placed.push(row);
            results.push({ y, u, kind });
            y += ROW + resLine;
        });
        placed.forEach(row => {
            for (let i = 0; i < row.length - 1; i++) links.push({ a: row[i], b: row[i + 1], t: data.pairs.get(pairKey(row[i].id, row[i + 1].id)) ?? 0, inLine: true });
        });
        if (ctx === 'es') {
            for (let r = 0; r < placed.length; r++)
                for (let q = r + 1; q < placed.length; q++)
                    for (const a of placed[r])
                        for (const b of placed[q]) {
                            const t = data.pairs.get(pairKey(a.id, b.id)) ?? 0;
                            if (t >= 30) links.push({ a, b, t, inLine: false });
                        }
        }
        y += 6;
    };

    const key = (ids: number[]) => [...ids].sort((a, b) => a - b).join('-');
    placeRows(data.lu.forwards.map(ids => ({ ids, u: data.fUnits.get(key(ids)) ?? null })), 3, 'es', null, 'Forward lines', 'F');
    placeRows(data.lu.defense.map(ids => ({ ids, u: data.dUnits.get(key(ids)) ?? null })), 3, 'es', null, 'Defence pairs', 'D');
    placeRows(data.pp.map(u => ({ ids: u.ids, u })), 5, 'pp', 'var(--pp)', 'Power play', 'PP');
    placeRows(data.pk.map(u => ({ ids: u.ids, u })), 5, 'sh', 'var(--pk)', 'Penalty kill', 'PK');

    let goalieY = -1;
    if (data.goalie) {
        titles.push({ y: y + 12, text: 'Goalie' });
        y += SECTION;
        goalieY = y + NAME_H;
        y += ROW + resLine;
    }
    const H = y;
    const maxPair = Math.max(60, ...links.filter(l => l.inLine).map(l => l.t));
    const seams = [1200, 2400, ...(m.end > 3600 ? [3600] : [])];
    const tx = (n: Node, t: number) => n.x + 3 + (Math.min(t, end) / end) * (n.w - 6);
    const focusLinks = focus != null ? links.filter(l => !l.inLine && (l.a.id === focus || l.b.id === focus)) : [];
    const dim = (id: number) => focus != null && id !== focus && !focusLinks.some(l => l.a.id === id || l.b.id === id);

    const toiFor = (id: number, ctx: Ctx) => {
        const r = data.rows.get(id);
        if (!r) return '';
        if (ctx === 'pp') return clockOf(r.toiPp);
        if (ctx === 'sh') return clockOf(r.toiSh);
        return `${clockOf(r.toi)} · ${r.shifts}`;
    };

    // Name and time share the label row; narrow boxes keep only the (trimmed) name, the card has the rest.
    const showToi = (n: Node) => n.w >= 118;
    const fit = (text: string, room: number) => {
        const max = Math.max(3, Math.floor(room / 6.4));
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    };

    const ResultText = ({ u, kind, x, yy }: { u: Unit | null; kind: 'F' | 'D' | 'PP' | 'PK'; x: number; yy: number }) => {
        if (!u) {
            return (
                <text x={x} y={yy + 4} className="fill-fg-3 text-micro">
                    no shared 5v5 time
                </text>
            );
        }
        const thin = (kind === 'F' || kind === 'D') && u.toi < THIN;
        const xgp = pctOf(u.xgf, u.xga);
        const cfp = pctOf(u.cf, u.ca);
        if (kind === 'PP' || kind === 'PK') {
            const pp = kind === 'PP';
            return (
                <text x={x} y={yy} className="text-micro">
                    <tspan className="fill-fg-1">{clockOf(u.toi)}</tspan>
                    <tspan className="fill-fg-3"> · {pp ? 'GF' : 'GA'} </tspan>
                    <tspan className="fill-fg-1">{pp ? u.gf : u.ga}</tspan>
                    <tspan x={x} dy={14} className="fill-fg-3">
                        {pp ? 'xGF ' : 'xGA '}
                    </tspan>
                    <tspan className="fill-model">{(pp ? u.xgf : u.xga).toFixed(2)}</tspan>
                    <tspan className="fill-fg-3"> · {pp ? 'CF' : 'CA'} {pp ? u.cf : u.ca}</tspan>
                </text>
            );
        }
        return (
            <text x={x} y={yy} className="text-micro">
                <tspan className="fill-fg-3">xGF </tspan>
                <tspan className={thin ? 'fill-fg-3' : 'fill-model font-semibold'}>{xgp != null ? `${xgp}%` : '—'}</tspan>
                <tspan className="fill-fg-3"> · </tspan>
                <tspan className={u.gf || u.ga ? 'fill-fg-1' : 'fill-fg-3'}>
                    {u.gf}–{u.ga}
                </tspan>
                {thin ? <tspan className="fill-warn"> · thin</tspan> : null}
                <tspan x={x} dy={14} className="fill-fg-3">
                    CF {cfp != null ? `${cfp}%` : '—'} · OZ {u.oz} DZ {u.dz}
                </tspan>
            </text>
        );
    };

    return (
        <div ref={ref} className="min-w-0">
            {width ? (
                <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${m.teams[side].place} ${m.teams[side].name} player usage. A table of each line's results follows.`} className="block font-mono tabular-nums">
                    {titles.map(t => (
                        <text key={t.text} x={0} y={t.y} className="fill-fg-3 text-micro uppercase" letterSpacing="0.08em">
                            {t.text}
                        </text>
                    ))}
                    {resW ? (
                        <text x={diagW + 16} y={12} className="fill-fg-3 text-micro uppercase" letterSpacing="0.08em">
                            Results
                        </text>
                    ) : null}

                    {/* Links to players on other lines: only for the focused player. */}
                    {focusLinks.map((l, i) => {
                        const up = l.a.y < l.b.y ? l.a : l.b;
                        const dn = up === l.a ? l.b : l.a;
                        const k = Math.min(1, l.t / maxPair);
                        return (
                            <line key={`x${i}`} x1={up.x + up.w / 2} y1={up.y + BOX_H} x2={dn.x + dn.w / 2} y2={dn.y - NAME_H + 2} stroke={ink} strokeOpacity={0.45 + 0.4 * k} strokeWidth={1 + 2.5 * k} strokeDasharray="4 3">
                                <title>{`${label(l.a.id)} with ${label(l.b.id)}: ${clockOf(l.t)} at even strength`}</title>
                            </line>
                        );
                    })}

                    {/* Linemate bars: thickness = even-strength time together. */}
                    {links
                        .filter(l => l.inLine)
                        .map((l, i) => {
                            const h = 2 + 9 * Math.min(1, l.t / maxPair);
                            return (
                                <rect key={`l${i}`} x={l.a.x + l.a.w} y={l.a.y + BOX_H / 2 - h / 2} width={Math.max(0, l.b.x - (l.a.x + l.a.w))} height={h} fill={ink} opacity={dim(l.a.id) && dim(l.b.id) ? 0.2 : 0.6}>
                                    <title>{`${label(l.a.id)} with ${label(l.b.id)}: ${clockOf(l.t)}`}</title>
                                </rect>
                            );
                        })}

                    {nodes.map(n => {
                        const r = data.rows.get(n.id);
                        const strips = (data.stretches.get(n.id) ?? []).filter(s => (n.ctx === 'es' ? true : s.st === n.ctx));
                        const onNow = selIce ? selIce.skaters[side].includes(n.id) : false;
                        const card = r ? <MinutesTip r={r} color={colors[side]} rank={n.ctx === 'pp' ? 'power play' : n.ctx === 'sh' ? 'penalty kill' : r.player.pos === 'D' ? 'defence' : 'forward'} /> : null;
                        const b = card ? bind(card) : null;
                        const name = `${label(n.id)}, ${toiFor(n.id, n.ctx)}${n.ctx === 'pp' ? ' on the power play' : n.ctx === 'sh' ? ' on the penalty kill' : ' time on ice and shifts'}`;
                        return (
                            <g
                                key={`${n.ctx}-${n.id}-${n.y}`}
                                tabIndex={0}
                                role="button"
                                aria-label={name}
                                opacity={dim(n.id) ? 0.3 : 1}
                                className="cursor-default outline-none transition-opacity [&:focus-visible>rect.box]:stroke-brand"
                                onPointerEnter={e => {
                                    b?.onPointerEnter(e);
                                    setFocus(n.id);
                                }}
                                onPointerMove={b?.onPointerMove}
                                onPointerLeave={() => {
                                    b?.onPointerLeave();
                                    setFocus(null);
                                }}
                                onFocus={e => {
                                    b?.onFocus(e);
                                    setFocus(n.id);
                                }}
                                onBlur={() => {
                                    b?.onBlur();
                                    setFocus(null);
                                }}
                            >
                                <text x={n.x + 1} y={n.y - 4} className={cn('text-micro', focus === n.id ? 'fill-brand font-semibold' : 'fill-fg-1')}>
                                    {fit(label(n.id), showToi(n) ? n.w - toiFor(n.id, n.ctx).length * 6.2 - 8 : n.w)}
                                </text>
                                {showToi(n) ? (
                                    <text x={n.x + n.w - 1} y={n.y - 4} textAnchor="end" className="fill-fg-3 text-micro">
                                        {toiFor(n.id, n.ctx)}
                                    </text>
                                ) : null}
                                <rect className="box" x={n.x} y={n.y} width={n.w} height={BOX_H} rx={3} fill="var(--track)" stroke={onNow ? 'var(--brand)' : (n.tint ?? 'var(--line-strong)')} strokeWidth={onNow ? 2 : n.tint ? 1.4 : 1} />
                                {/* Stretches his team led (even-strength boxes). */}
                                {n.ctx === 'es'
                                    ? data.lead.map(([a, bb], i) => <rect key={`ld${i}`} x={tx(n, a)} y={n.y + 1} width={Math.max(0, tx(n, bb) - tx(n, a))} height={BOX_H - 2} fill={colors[side]} opacity={0.1} pointerEvents="none" />)
                                    : null}
                                {seams.map(t => (
                                    <line key={t} x1={tx(n, t)} x2={tx(n, t)} y1={n.y + 2} y2={n.y + BOX_H - 2} className="stroke-line-strong" strokeWidth={1} pointerEvents="none" />
                                ))}
                                {/* His shifts, coloured by strength. */}
                                {strips.map((s, i) => (
                                    <rect
                                        key={i}
                                        x={tx(n, s.a)}
                                        y={n.y + 5}
                                        width={Math.max(0.8, tx(n, s.b) - tx(n, s.a))}
                                        height={BOX_H - 10}
                                        fill={s.st === 'pp' ? 'var(--pp)' : s.st === 'sh' ? 'var(--pk)' : 'var(--text-3)'}
                                        opacity={s.st === 'ev' ? 0.5 : 0.85}
                                        pointerEvents="none"
                                    />
                                ))}
                                <Markers list={goalMarkers(m, n.id, side, n.ctx)} x={n.x} w={n.w} y={n.y} end={end} />
                                {sel ? <line x1={tx(n, sel.t)} x2={tx(n, sel.t)} y1={n.y - 2} y2={n.y + BOX_H + 2} className="stroke-brand" strokeWidth={1.5} pointerEvents="none" /> : null}
                            </g>
                        );
                    })}

                    {/* Results per row: hover or focus for the full card and who it faced. */}
                    {results.map((rr, i) => {
                        const x = resW ? diagW + 16 : 0;
                        const yy = resW ? rr.y + NAME_H + BOX_H / 2 - 3 : rr.y + NAME_H + BOX_H + 16;
                        const b = rr.u ? bind(<UnitTip u={rr.u} kind={rr.kind} side={side} />) : null;
                        return (
                            <g key={i} tabIndex={rr.u ? 0 : -1} className="cursor-default outline-none [&:focus-visible>rect]:stroke-brand" {...(b ?? {})}>
                                <rect x={x - 6} y={yy - 14} width={resW ? resW - 2 : diagW} height={32} rx={4} fill="transparent" stroke="transparent" />
                                <ResultText u={rr.u} kind={rr.kind} x={x} yy={yy} />
                            </g>
                        );
                    })}

                    {data.goalie && goalieY >= 0 ? (
                        <g>
                            <text x={1} y={goalieY - 4} className="fill-goalie text-micro">
                                {label(data.goalie.player.id)}
                            </text>
                            <text x={diagW - 1} y={goalieY - 4} textAnchor="end" className="fill-fg-3 text-micro">
                                {clockOf(data.goalie.toi)}
                            </text>
                            <rect x={0} y={goalieY} width={diagW} height={BOX_H} rx={3} fill="var(--track)" stroke="var(--line-strong)" />
                            {seams.map(t => (
                                <line key={t} x1={3 + (t / end) * (diagW - 6)} x2={3 + (t / end) * (diagW - 6)} y1={goalieY + 2} y2={goalieY + BOX_H - 2} className="stroke-line-strong" />
                            ))}
                            {/* In net; the gaps are the net left empty. */}
                            {(data.stretches.get(data.goalie.player.id) ?? []).map((s, i) => (
                                <rect key={i} x={3 + (s.a / end) * (diagW - 6)} y={goalieY + 5} width={Math.max(0.8, ((s.b - s.a) / end) * (diagW - 6))} height={BOX_H - 10} fill="var(--goalie)" opacity={0.45} />
                            ))}
                            <Markers list={data.goalieGa.map(e => ({ t: e.t, kind: 'ga' as MarkerKind }))} x={0} w={diagW} y={goalieY} end={end} />
                            <text x={resW ? diagW + 16 : 0} y={resW ? goalieY + BOX_H / 2 - 3 : goalieY + BOX_H + 18} className="text-micro">
                                <tspan className="fill-fg-3">SV </tspan>
                                <tspan className="fill-fg-1">{data.goalie.sa ? ((data.goalie.sa - data.goalie.ga) / data.goalie.sa).toFixed(3).replace(/^0/, '') : '—'}</tspan>
                                <tspan className="fill-fg-3"> · GSAx </tspan>
                                <tspan className={data.goalie.xga - data.goalie.ga >= 0 ? 'fill-pos' : 'fill-neg'}>
                                    {data.goalie.xga - data.goalie.ga >= 0 ? '+' : '−'}
                                    {Math.abs(data.goalie.xga - data.goalie.ga).toFixed(2)}
                                </tspan>
                                <tspan x={resW ? diagW + 16 : 0} dy={14} className="fill-fg-3">
                                    GA {data.goalie.ga} · xGA {data.goalie.xga.toFixed(2)}
                                </tspan>
                            </text>
                        </g>
                    ) : null}
                </svg>
            ) : (
                <div className="h-[760px]" aria-hidden="true" />
            )}
            {tip}
            <table className="sr-only">
                <caption>{m.teams[side].name} lines, pairs and units with their results</caption>
                <thead>
                    <tr>
                        <th scope="col">Group</th>
                        <th scope="col">Time together</th>
                        <th scope="col">xG for–against</th>
                        <th scope="col">Goals for–against</th>
                        <th scope="col">Attempts for–against</th>
                    </tr>
                </thead>
                <tbody>
                    {results
                        .filter(r => r.u)
                        .map((r, i) => (
                            <tr key={i}>
                                <th scope="row">
                                    {r.kind} {r.u!.ids.map(id => label(id)).join(', ')}
                                </th>
                                <td>{clockOf(r.u!.toi)}</td>
                                <td>
                                    {r.u!.xgf.toFixed(2)}–{r.u!.xga.toFixed(2)}
                                </td>
                                <td>
                                    {r.u!.gf}–{r.u!.ga}
                                </td>
                                <td>
                                    {r.u!.cf}–{r.u!.ca}
                                </td>
                            </tr>
                        ))}
                </tbody>
            </table>
        </div>
    );
}

/** Minutes per skater: total TOI (label at the bar end) split even strength / power play / penalty kill; defenders first. */
function Minutes({ side, focus, setFocus }: FocusProps) {
    const { m, label, colors } = useGame();
    const { bind, tip } = useHoverTip();
    const rows = skaterRows(m, side, 'all');
    const max = Math.max(1, ...rows.map(r => r.toi));
    const groups = [rows.filter(r => r.player.pos === 'D'), rows.filter(r => r.player.pos !== 'D')];
    return (
        <div className="flex flex-col gap-4">
            {groups.map((list, gi) => (
                <ol key={gi} className="flex flex-col gap-1" aria-label={gi === 0 ? 'Defence minutes' : 'Forward minutes'}>
                    {list.map((r, i) => {
                        const b = bind(<MinutesTip r={r} color={colors[side]} rank={`${i + 1}${['st', 'nd', 'rd'][i] ?? 'th'} ${gi === 0 ? 'D' : 'F'} in TOI`} />);
                        return (
                            <li
                                key={r.player.id}
                                tabIndex={0}
                                aria-label={`${label(r.player.id)}: ${clockOf(r.toi)}, ${clockOf(r.toiPp)} power play, ${clockOf(r.toiSh)} penalty kill`}
                                onPointerEnter={e => {
                                    b.onPointerEnter(e);
                                    setFocus(r.player.id);
                                }}
                                onPointerMove={b.onPointerMove}
                                onPointerLeave={() => {
                                    b.onPointerLeave();
                                    setFocus(null);
                                }}
                                onFocus={e => {
                                    b.onFocus(e);
                                    setFocus(r.player.id);
                                }}
                                onBlur={() => {
                                    b.onBlur();
                                    setFocus(null);
                                }}
                                className={cn(
                                    '-mx-1 grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-2 rounded-control px-1 py-0.5 text-caption tabular-nums outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand',
                                    focus === r.player.id && 'bg-surface-2',
                                )}
                            >
                                <span className="flex items-center gap-1.5">
                                    <span className="flex h-4 overflow-hidden rounded-[3px]" style={{ width: `calc((100% - 2.75rem) * ${r.toi / max})` }} aria-hidden="true">
                                        <span className="h-full" style={{ width: `${(r.toiEv / r.toi) * 100}%`, background: 'rgb(var(--text-3-rgb) / 0.55)' }} />
                                        <span className="h-full bg-[var(--pp)]" style={{ width: `${(r.toiPp / r.toi) * 100}%` }} />
                                        <span className="h-full bg-[var(--pk)]" style={{ width: `${(r.toiSh / r.toi) * 100}%` }} />
                                    </span>
                                    <span className="text-micro font-semibold text-fg-1">{clockOf(r.toi)}</span>
                                </span>
                                <span className={cn('truncate', focus === r.player.id ? 'font-semibold text-brand' : 'text-fg-1')}>{label(r.player.id)}</span>
                            </li>
                        );
                    })}
                </ol>
            ))}
            {tip}
        </div>
    );
}

function Swatch({ fill, op = 1, ring }: { fill: string; op?: number; ring?: boolean }) {
    return (
        <svg viewBox="0 0 14 10" className="h-2.5 w-3.5" aria-hidden="true">
            {ring ? <rect x={1} y={1} width={12} height={8} rx={2} fill="none" stroke={fill} strokeWidth={1.4} /> : <rect width={14} height={10} rx={2} fill={fill} opacity={op} />}
        </svg>
    );
}

function Legend({ color }: { color: string }) {
    const mark = (kind: 'goal' | 'a1' | 'gf' | 'ga') => (
        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
            <rect x={0} y={3} width={14} height={8} rx={2} fill="var(--track)" />
            {kind === 'goal' ? <line x1={7} x2={7} y1={0} y2={14} className="stroke-fg-1" strokeWidth={1.4} /> : null}
            {kind === 'a1' ? <line x1={7} x2={7} y1={7} y2={14} className="stroke-fg-1" strokeWidth={1.4} /> : null}
            {kind === 'ga' ? <circle cx={7} cy={7} r={3} fill="var(--surface-1)" stroke="var(--neg)" strokeWidth={1.6} /> : <circle cx={7} cy={7} r={3} fill="var(--pos)" />}
        </svg>
    );
    return (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-micro uppercase tracking-label text-fg-3">
            <span className="flex items-center gap-1.5">{mark('goal')} His goal</span>
            <span className="flex items-center gap-1.5">{mark('a1')} Primary assist</span>
            <span className="flex items-center gap-1.5">{mark('gf')} Goal for</span>
            <span className="flex items-center gap-1.5">{mark('ga')} Goal against</span>
            <span className="flex items-center gap-1.5">
                <Swatch fill="var(--text-3)" op={0.5} />
                <Swatch fill="var(--pp)" op={0.85} />
                <Swatch fill="var(--pk)" op={0.85} /> Shifts ES · PP · PK
            </span>
            <span className="flex items-center gap-1.5">
                <Swatch fill={color} op={0.25} /> Leading
            </span>
        </p>
    );
}

export function Lines() {
    const { m, colors } = useGame();
    const [side, setSide] = React.useState<Side>('away');
    const [focus, setFocus] = React.useState<number | null>(null);
    const ink = legibleOn(colors[side], PANEL);
    return (
        <GameSection
            id="lines"
            title="Lines"
            aside={
                <Segmented
                    label="Team"
                    size="sm"
                    value={side}
                    onChange={v => {
                        setSide(v);
                        setFocus(null);
                    }}
                    optionClassName="px-2.5"
                    options={SIDES.map(s => ({ value: s, label: m.teams[s].tri }))}
                />
            }
        >
            <div key={side} className="panel flex min-w-0 flex-col gap-4 p-card motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                    <p className="flex items-center gap-2 font-bold uppercase tracking-label" style={{ color: ink }}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- team logos are static SVGs */}
                        <img src={`/logos/${m.teams[side].tri}.svg`} alt="" width={28} height={28} className="h-7 w-7" />
                        {m.teams[side].place} {m.teams[side].name}
                    </p>
                    <Legend color={colors[side]} />
                </div>
                <div className="grid gap-8 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
                    <TeamUsage side={side} focus={focus} setFocus={setFocus} />
                    <div>
                        <p className="mb-2 flex items-center justify-between gap-2">
                            <span className="label">Minutes</span>
                            <span className="flex items-center gap-1.5 text-micro uppercase tracking-label text-fg-3">
                                <Swatch fill="rgb(var(--text-3-rgb) / 0.55)" /> ES
                                <Swatch fill="var(--pp)" /> PP
                                <Swatch fill="var(--pk)" /> PK
                            </span>
                        </p>
                        <Minutes side={side} focus={focus} setFocus={setFocus} />
                    </div>
                </div>
            </div>
        </GameSection>
    );
}
