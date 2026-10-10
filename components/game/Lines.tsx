'use client';

import * as React from 'react';
import { clockOf, deployment, goalMarkers, goalieRows, lineup, pairKey, pairTimes, skaterRows, units, type MarkerKind, type SkaterRow } from '@/lib/game/analytics';
import type { Side } from '@/lib/game/types';
import { GameSection, sideTeams, useGame } from './GameContext';
import { TipFace, TipRow, useHoverTip } from './HoverTip';
import { useWidth } from './Pulse';
import { TeamToggle } from '@/components/ui/team-toggle';
import { fmtInt } from '@/components/views/format';
import { ScrollRegion } from '@/components/ui/scroll-region';

/*
 * Player usage, per team (after hockeyviz's usage chart, in Neon Arcade):
 *   - forwards on four lines and defenders on three pairs (5v5 time decides
 *     who plays with whom); every box is the whole game, with markers at the
 *     moment of each goal he was on the ice for at even strength or with an
 *     empty net: his goal, his primary assist, another goal for, a goal
 *     against;
 *   - bars between linemates grow with even-strength time together, the
 *     centre in the middle of his line; hovering a player (box or Minutes
 *     row) lights his boxes, everyone he shared a line, pair or unit with,
 *     and his links to partners on other lines (drawn muted at rest, 60s+
 *     together, thicker with more time), and fades everyone else;
 *   - the top two power-play and penalty-kill units, with their own markers;
 *   - the goalie's share of the game with each goal against;
 *   - every skater's minutes at even strength, on the power play and on the
 *     penalty kill.
 */

const BOX_H = 20;
const NAME_H = 15;
const ROW = BOX_H + NAME_H + 16;
const SECTION = 26;

interface Node {
    id: number;
    x: number;
    y: number;
    w: number;
}

function Markers({ list, x, y, w, end, narrow = false }: { list: { t: number; kind: MarkerKind }[]; x: number; y: number; w: number; end: number; narrow?: boolean }) {
    // A phone-width box with more goals than room (a season merged): small plain dots, no ticks, so it reads as a texture.
    const dense = narrow && list.length * 7 > w;
    return (
        <>
            {list.map((mk, i) => {
                const mx = x + 4 + (Math.min(mk.t, end) / end) * (w - 8);
                const cy = y + BOX_H / 2;
                const fill = mk.kind === 'ga' ? 'var(--neg)' : 'var(--pos)';
                if (dense) return <circle key={i} cx={mx} cy={cy} r={1.6} fill={fill} opacity={0.85} />;
                return (
                    <g key={i}>
                        {mk.kind === 'goal' ? <line x1={mx} x2={mx} y1={y - 3} y2={y + BOX_H + 3} className="stroke-fg-1" strokeWidth={1.4} /> : null}
                        {mk.kind === 'a1' ? <line x1={mx} x2={mx} y1={cy} y2={y + BOX_H + 3} className="stroke-fg-1" strokeWidth={1.4} /> : null}
                        <circle cx={mx} cy={cy} r={mk.kind === 'goal' || mk.kind === 'a1' ? 3.6 : 3} fill={fill} stroke="var(--surface-1)" strokeWidth={0.8} />
                    </g>
                );
            })}
        </>
    );
}

interface FocusProps {
    side: Side;
    focus: number | null;
    setFocus: (id: number | null) => void;
}

function TeamUsage({ side, focus, setFocus }: FocusProps) {
    const { m, label } = useGame();
    const [ref, width] = useWidth<HTMLDivElement>();
    const W = Math.max(width, 300);
    const end = Math.max(3600, m.end);
    const pad = 4;

    const data = React.useMemo(() => {
        const goalie = goalieRows(m, side)[0] ?? null;
        const shifts = goalie ? (m.shifts[goalie.player.id] ?? []) : [];
        return {
            lu: lineup(m, side),
            pairs: pairTimes(m, side),
            pp: units(m, side, 'PP').slice(0, 2),
            pk: units(m, side, 'PK').slice(0, 2),
            goalie,
            // Goals against while he was in net.
            goalieGa: goalie ? m.events.filter(e => e.type === 'goal' && e.side !== side && shifts.some(([a, b]) => e.t > a && e.t <= b)) : [],
        };
    }, [m, side]);

    // Layout: sections stacked, nodes on a three-column grid (five for special teams).
    const nodes: (Node & { ctx: 'es' | 'pp' | 'sh'; tint: string | null })[] = [];
    const links: { a: Node; b: Node; t: number; inLine: boolean; ctx: 'es' | 'pp' | 'sh' }[] = [];
    // Per section, everyone a player shared his line, pair or unit with (not just the boxes beside his).
    const mates = new Map<string, Set<number>>();
    const titles: { y: number; text: string }[] = [];
    let y = 0;

    const placeRows = (rows: number[][], cols: number, ctx: 'es' | 'pp' | 'sh', tint: string | null, title: string) => {
        if (!rows.length) return;
        titles.push({ y: y + 12, text: title });
        y += SECTION;
        const gap = cols >= 5 ? 8 : 18;
        const nodeW = (W - pad * 2 - gap * (cols - 1)) / cols;
        const placed: Node[][] = [];
        rows.forEach(ids => {
            const offset = ((cols - ids.length) * (nodeW + gap)) / 2;
            const row = ids.map((id, i) => ({ id, x: pad + offset + i * (nodeW + gap), y: y + NAME_H, w: nodeW }));
            row.forEach(n => nodes.push({ ...n, ctx, tint }));
            for (const id of ids) ids.forEach(o => o !== id && (mates.get(`${ctx}:${id}`) ?? mates.set(`${ctx}:${id}`, new Set()).get(`${ctx}:${id}`)!).add(o));
            placed.push(row);
            y += ROW;
        });
        // Links: neighbours on a row, and (even strength only) across rows.
        placed.forEach(row => {
            for (let i = 0; i < row.length - 1; i++) links.push({ a: row[i], b: row[i + 1], t: data.pairs.get(pairKey(row[i].id, row[i + 1].id)) ?? 0, inLine: true, ctx });
        });
        if (ctx === 'es') {
            for (let r = 0; r < placed.length; r++) {
                for (let q = r + 1; q < placed.length; q++) {
                    for (const a of placed[r]) {
                        for (const b of placed[q]) {
                            const t = data.pairs.get(pairKey(a.id, b.id)) ?? 0;
                            if (t >= 60) links.push({ a, b, t, inLine: false, ctx });
                        }
                    }
                }
            }
        }
        y += 6;
    };

    placeRows(data.lu.forwards, 3, 'es', null, 'Forwards · even strength & empty net');
    placeRows(data.lu.defense, 3, 'es', null, 'Defence · even strength & empty net');
    placeRows(data.pp.map(u => u.ids), 5, 'pp', 'var(--pp)', 'Power play · top 2 units');
    placeRows(data.pk.map(u => u.ids), 5, 'sh', 'var(--pk)', 'Penalty kill · top 2 units');

    let goalieY = -1;
    if (data.goalie) {
        titles.push({ y: y + 12, text: 'Goalie' });
        y += SECTION;
        goalieY = y + NAME_H;
        y += ROW;
    }
    const H = y;
    const maxPair = Math.max(60, ...links.filter(l => l.inLine).map(l => l.t));
    // Focus (a hovered box or Minutes row): in each section his boxes, his linemates or unit, and (at even strength) his partners on other lines stay lit; the rest fade.
    const partners = (ctx: 'es' | 'pp' | 'sh') =>
        new Set(focus == null ? [] : [...(mates.get(`${ctx}:${focus}`) ?? []), ...links.filter(l => !l.inLine && l.ctx === ctx && (l.a.id === focus || l.b.id === focus)).flatMap(l => [l.a.id, l.b.id])]);
    const lit = { es: partners('es'), pp: partners('pp'), sh: partners('sh') };
    const dim = (id: number, ctx: 'es' | 'pp' | 'sh') => focus != null && id !== focus && !lit[ctx].has(id);
    // Touch has no hover: a tap on a box lights him (again, or open ice, lets go).
    const lastType = React.useRef('mouse');
    // A link leaves one box's bottom edge and lands on the other's top edge, leaning toward each other (labels sit on a halo above it).
    const edgeX = (n: Node, toward: Node) => {
        const c = n.x + n.w / 2;
        return Math.min(n.x + n.w - 6, Math.max(n.x + 6, c + (toward.x + toward.w / 2 - c) * 0.3));
    };

    return (
        <div ref={ref} className="min-w-0">
            {width ? (
                <svg
                    viewBox={`0 0 ${W} ${H}`}
                    width="100%"
                    // Under 300px (320 phones) the layout scales down as a whole; the height follows so no bands open above and below.
                    height={width < W ? (H * width) / W : H}
                    role="img"
                    aria-label={`${m.teams[side].name} player usage: lines, pairs, special-teams units and goalie`}
                    className="block font-mono"
                    onPointerDown={e => {
                        lastType.current = e.pointerType;
                    }}
                    onClick={() => {
                        if (lastType.current !== 'mouse') setFocus(null);
                    }}
                >
                    {titles.map(t => (
                        <text key={t.text} x={pad} y={t.y} className="fill-fg-3 text-micro uppercase" letterSpacing="0.08em">
                            {t.text}
                        </text>
                    ))}
                    {/* Links to players on other lines (60s+ together), under the boxes: muted at rest, lit for the focused player. */}
                    {links
                        .filter(l => !l.inLine)
                        .map((l, i) => {
                            const up = l.a.y < l.b.y ? l.a : l.b;
                            const dn = up === l.a ? l.b : l.a;
                            const k = Math.min(1, l.t / maxPair);
                            const mine = focus != null && (l.a.id === focus || l.b.id === focus);
                            return (
                                <line
                                    key={`x${i}`}
                                    x1={edgeX(up, dn)}
                                    y1={up.y + BOX_H}
                                    x2={edgeX(dn, up)}
                                    y2={dn.y}
                                    className={`transition-opacity ${mine ? 'stroke-brand' : 'stroke-fg-3'}`}
                                    strokeOpacity={mine ? 0.75 : focus != null ? 0.08 : 0.3}
                                    strokeWidth={1 + 8 * k}
                                    strokeLinecap="round"
                                >
                                    <title>{`${label(l.a.id)} with ${label(l.b.id)}: ${clockOf(l.t)} at even strength`}</title>
                                </line>
                            );
                        })}
                    {/* Linemate bars: thickness = even-strength time together. */}
                    {links
                        .filter(l => l.inLine)
                        .map((l, i) => {
                            const h = 2 + 9 * Math.min(1, l.t / maxPair);
                            const faded = dim(l.a.id, l.ctx) || dim(l.b.id, l.ctx);
                            return (
                                <rect key={`l${i}`} x={l.a.x + l.a.w} y={l.a.y + BOX_H / 2 - h / 2} width={Math.max(0, l.b.x - (l.a.x + l.a.w))} height={h} className="fill-fg-3 transition-opacity" opacity={faded ? 0.12 : focus != null ? 0.75 : 0.55}>
                                    <title>{`${label(l.a.id)} with ${label(l.b.id)}: ${clockOf(l.t)}`}</title>
                                </rect>
                            );
                        })}
                    {nodes.map(n => (
                        <g
                            key={`${n.ctx}-${n.id}-${n.y}`}
                            opacity={dim(n.id, n.ctx) ? 0.3 : 1}
                            className="transition-opacity"
                            onPointerEnter={e => {
                                if (e.pointerType === 'mouse') setFocus(n.id);
                            }}
                            onPointerLeave={e => {
                                if (e.pointerType === 'mouse') setFocus(null);
                            }}
                            onClick={e => {
                                if (lastType.current === 'mouse') return;
                                e.stopPropagation();
                                setFocus(focus === n.id ? null : n.id);
                            }}
                        >
                            <text x={n.x + n.w / 2} y={n.y - 4} textAnchor="middle" stroke="var(--surface-1)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round" className={focus === n.id ? 'fill-brand text-micro font-semibold' : 'fill-fg-1 text-micro'}>
                                {label(n.id)}
                            </text>
                            <rect x={n.x} y={n.y} width={n.w} height={BOX_H} rx={3} className="fill-surface-3" stroke={focus === n.id ? 'var(--brand)' : (n.tint ?? 'var(--line-strong)')} strokeWidth={focus === n.id || n.tint ? 1.4 : 1} />
                            {n.tint ? <rect x={n.x} y={n.y} width={n.w} height={BOX_H} rx={3} fill={n.tint} opacity={0.14} /> : null}
                            <Markers list={goalMarkers(m, n.id, side, n.ctx)} x={n.x} y={n.y} w={n.w} end={end} narrow={width < 640} />
                        </g>
                    ))}
                    {data.goalie && goalieY >= 0 ? (
                        <g>
                            <text x={pad} y={goalieY - 4} className="fill-goalie text-micro">
                                {label(data.goalie.player.id)} · {Math.round((data.goalie.toi / end) * 100)}%
                            </text>
                            <rect x={pad} y={goalieY} width={W - pad * 2} height={BOX_H} rx={3} className="fill-track" />
                            <rect x={pad} y={goalieY} width={(W - pad * 2) * Math.min(1, data.goalie.toi / end)} height={BOX_H} rx={3} className="fill-surface-3" stroke="var(--goalie)" strokeOpacity={0.6} />
                            <Markers list={data.goalieGa.map(e => ({ t: e.t, kind: 'ga' as MarkerKind }))} x={pad} y={goalieY} w={W - pad * 2} end={end} narrow={width < 640} />
                        </g>
                    ) : null}
                </svg>
            ) : (
                <div className="h-[640px]" aria-hidden="true" />
            )}
        </div>
    );
}

/** Minutes card: the ES / PP / PK split with shares, then shift count and length. */
function MinutesTip({ r, color, rank }: { r: SkaterRow; color: string; rank: string }) {
    const parts: [string, number, string][] = [
        ['Even', r.toiEv, 'rgb(var(--text-3-rgb) / 0.55)'],
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
                {fmtInt(r.shifts)} <span className="text-fg-3">· avg {clockOf(r.toi / Math.max(1, r.shifts))}</span>
            </TipRow>
        </div>
    );
}

function Minutes({ side, focus, setFocus, wide = false }: FocusProps & { wide?: boolean }) {
    const { m, label, colors } = useGame();
    const { bind, tip } = useHoverTip();
    const rows = skaterRows(m, side, 'all');
    const max = Math.max(1, ...rows.map(r => r.toi));
    const groups = [rows.filter(r => r.player.pos === 'D'), rows.filter(r => r.player.pos !== 'D')];
    return (
        <div className={wide ? 'grid gap-x-8 gap-y-4 md:grid-cols-2' : 'flex flex-col gap-4'}>
            {groups.map((list, gi) => (
                <ol key={gi} className="flex flex-col gap-1.5" aria-label={gi === 0 ? 'Defence minutes' : 'Forward minutes'}>
                    {list.map((r, i) => {
                        const b = bind(<MinutesTip r={r} color={colors[side]} rank={`${i + 1}${['st', 'nd', 'rd'][i] ?? 'th'} ${gi === 0 ? 'D' : 'F'} in TOI`} />, {
                            enter: () => setFocus(r.player.id),
                            leave: () => setFocus(null),
                        });
                        return (
                            <li
                                key={r.player.id}
                                {...b}
                                className={`-mx-1 grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-2 rounded-control px-1 text-caption tabular-nums hover:bg-surface-2 ${focus === r.player.id ? 'bg-surface-2' : ''}`}
                            >
                                <span className="flex items-center gap-1.5">
                                    <span className="flex h-5 overflow-hidden rounded-[3px]" style={{ width: `calc((100% - 2.75rem) * ${r.toi / max})` }}>
                                        <span className="h-full" style={{ width: `${(r.toiEv / r.toi) * 100}%`, background: 'rgb(var(--text-3-rgb) / 0.55)' }} />
                                        <span className="h-full bg-[var(--pp)]" style={{ width: `${(r.toiPp / r.toi) * 100}%` }} />
                                        <span className="h-full bg-[var(--pk)]" style={{ width: `${(r.toiSh / r.toi) * 100}%` }} />
                                    </span>
                                    <span className="text-micro font-semibold text-fg-1">{clockOf(r.toi)}</span>
                                </span>
                                <span className={`truncate ${focus === r.player.id ? 'font-semibold text-brand' : 'text-fg-1'}`}>{label(r.player.id)}</span>
                            </li>
                        );
                    })}
                </ol>
            ))}
            {tip}
        </div>
    );
}

function Legend() {
    const mark = (fill: string, tick?: 'full' | 'half') => (
        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
            <rect x={0} y={3} width={14} height={8} rx={2} className="fill-surface-3" />
            {tick === 'full' ? <line x1={7} x2={7} y1={0} y2={14} className="stroke-fg-1" strokeWidth={1.4} /> : null}
            {tick === 'half' ? <line x1={7} x2={7} y1={7} y2={14} className="stroke-fg-1" strokeWidth={1.4} /> : null}
            <circle cx={7} cy={7} r={3} fill={fill} />
        </svg>
    );
    return (
        <p className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-micro uppercase tracking-label text-fg-3">
            <span className="flex items-center gap-1.5">{mark('var(--pos)', 'full')} His goal</span>
            <span className="flex items-center gap-1.5">{mark('var(--pos)', 'half')} Primary assist</span>
            <span className="flex items-center gap-1.5">{mark('var(--pos)')} Goal for</span>
            <span className="flex items-center gap-1.5">{mark('var(--neg)')} Goal against</span>
            <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-5 rounded-full bg-fg-3/55" /> Time together
            </span>
            <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: 'rgb(var(--text-3-rgb) / 0.55)' }} /> ES
                <span className="ml-1 h-2.5 w-2.5 rounded-[2px] bg-[var(--pp)]" /> PP
                <span className="ml-1 h-2.5 w-2.5 rounded-[2px] bg-[var(--pk)]" /> PK minutes
            </span>
        </p>
    );
}

/** Shade of the team colour per line: the top line full, lower lines fainter. */
const TIER: Record<string, number> = { L1: 1, L2: 0.68, L3: 0.44, L4: 0.26, D1: 1, D2: 0.6, D3: 0.32 };
const RANK = ['L1', 'L2', 'L3', 'L4', 'D1', 'D2', 'D3', 'X'];

/**
 * A season's deployment calendar: one row per skater, one column per game,
 * each cell shaded by the line or pair he played on that night (an outline
 * when he dressed but was on none of the top four lines or three pairs,
 * empty when he did not play). Rows run forwards then defence, each by his
 * usual line. Hover a cell for the game and his linemates.
 */
function DeploymentCalendar() {
    const { m, colors, label } = useGame();
    const dep = React.useMemo(() => deployment(m, 'away'), [m]);
    const [boxRef, boxW] = useWidth<HTMLDivElement>();
    const [hover, setHover] = React.useState<{ r: number; g: number } | null>(null);
    const color = colors.away;

    // Each skater's usual tag (most games), then rows: forwards, then defence, by usual line and games played.
    const rows = React.useMemo(() => {
        const out = [...dep.tags.entries()].map(([id, t]) => {
            const count = new Map<string, number>();
            for (const x of t) if (x) count.set(x, (count.get(x) ?? 0) + 1);
            const usual = [...count.entries()].filter(([k]) => k !== 'X').sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'X';
            const gp = t.filter(Boolean).length;
            const p = m.players.find(q => q.id === id);
            return { id, t, usual, gp, d: p?.pos === 'D' };
        });
        const rank = (x: string) => RANK.indexOf(x);
        return out.filter(r => r.gp).sort((a, b) => Number(a.d) - Number(b.d) || rank(a.usual) - rank(b.usual) || b.gp - a.gp);
    }, [dep, m.players]);

    const n = dep.n;
    const nameW = 112;
    const tailW = 72;
    const cw = Math.max(5, Math.min(14, Math.floor(((boxW || 900) - nameW - tailW) / Math.max(1, n))));
    const gap = cw >= 8 ? 1.5 : 1;
    const ch = 13;
    const rowH = ch + 3;
    const top = 18;
    const split = rows.findIndex(r => r.d);
    const sep = split > 0 ? 10 : 0;
    const Y = (i: number) => top + i * rowH + (split > 0 && i >= split ? sep : 0);
    const W = nameW + n * cw + tailW;
    const H = Y(rows.length) + 4;

    // Month labels where the month turns.
    const months: { g: number; text: string }[] = [];
    (m.games ?? []).forEach((g, i) => {
        const mo = g.date.slice(0, 7);
        if (i === 0 || mo !== m.games![i - 1].date.slice(0, 7)) months.push({ g: i, text: new Date(`${g.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) });
    });

    const at = (e: React.MouseEvent<SVGSVGElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * W;
        const y = ((e.clientY - r.top) / r.height) * H;
        const g = Math.floor((x - nameW) / cw);
        const ri = rows.findIndex((_, i) => y >= Y(i) && y < Y(i) + rowH);
        return g >= 0 && g < n && ri >= 0 ? { r: ri, g } : null;
    };

    const tipFor = (h: { r: number; g: number }) => {
        const row = rows[h.r];
        const tag = row.t[h.g];
        const g = m.games?.[h.g];
        const group = dep.games[h.g].find(x => x.tag === tag);
        const mates = group ? group.ids.filter(id => id !== row.id).map(id => label(id)) : [];
        const res = g ? (g.gf > g.ga ? 'W' : g.outcome === 'OT' || g.outcome === 'SO' ? 'OTL' : 'L') : '';
        return (
            <>
                <span className="font-bold text-fg-1">{label(row.id)}</span>
                {g ? (
                    <span className="text-micro uppercase tracking-label text-fg-3">
                        G{h.g + 1} · {g.date.slice(5).replace('-', '/')} {g.home ? 'vs' : '@'} {g.opp} · {res} {g.gf}–{g.ga}
                    </span>
                ) : null}
                <span className="text-fg-2">
                    {tag == null ? 'Did not play' : tag === 'X' ? 'Dressed, off the top lines' : `${tag}${mates.length ? ` with ${mates.join(', ')}` : ''}`}
                </span>
            </>
        );
    };

    return (
        <div ref={boxRef} className="flex min-w-0 flex-col gap-2">
            {/* The hovered game, on a line of its own so it never covers the grid. */}
            <p className="flex min-h-6 flex-wrap items-baseline gap-x-3 text-caption" aria-live="polite">
                {hover ? tipFor(hover) : <span className="text-micro uppercase tracking-label text-fg-3">Hover a game for his line and linemates that night</span>}
            </p>
            <ScrollRegion label="Line deployment by game">
                <svg
                    viewBox={`0 0 ${W} ${H}`}
                    width={W}
                    height={H}
                    role="img"
                    aria-label={`${m.teams.away.name} line and pair deployment over ${n} games`}
                    className="block font-mono"
                    onPointerMove={e => setHover(at(e))}
                    onPointerLeave={() => setHover(null)}
                    onClick={e => setHover(at(e))}
                >
                    {months.map(mo => (
                        <text key={mo.g} x={nameW + mo.g * cw} y={11} className="fill-fg-3 text-micro uppercase">
                            {mo.text}
                        </text>
                    ))}
                    {months.map(mo => (mo.g ? <line key={`l${mo.g}`} x1={nameW + mo.g * cw - gap / 2} x2={nameW + mo.g * cw - gap / 2} y1={top - 3} y2={H - 4} className="stroke-line" /> : null))}
                    {split > 0 ? <line x1={0} x2={W} y1={Y(split) - sep / 2 - 1} y2={Y(split) - sep / 2 - 1} className="stroke-line-strong" /> : null}
                    {rows.map((row, i) => {
                        const y = Y(i);
                        const lit = hover?.r === i;
                        return (
                            <g key={row.id} style={{ opacity: hover && !lit ? 0.55 : 1, transition: 'opacity 120ms' }}>
                                <text x={nameW - 8} y={y + ch - 3} textAnchor="end" className={lit ? 'fill-fg-1 text-micro font-semibold' : 'fill-fg-2 text-micro'}>
                                    {label(row.id)}
                                </text>
                                {row.t.map((tag, g) => {
                                    const x = nameW + g * cw;
                                    if (tag == null) return <rect key={g} x={x} y={y} width={cw - gap} height={ch} rx={1.5} className="fill-surface-2" opacity={0.6} />;
                                    if (tag === 'X') return <rect key={g} x={x + 0.5} y={y + 0.5} width={cw - gap - 1} height={ch - 1} rx={1.5} fill="none" className="stroke-line-strong" />;
                                    return <rect key={g} x={x} y={y} width={cw - gap} height={ch} rx={1.5} fill={color} opacity={TIER[tag] ?? 0.2} />;
                                })}
                                {hover?.r === i ? <rect x={nameW + hover.g * cw - 1} y={y - 1} width={cw - gap + 2} height={ch + 2} rx={2} fill="none" className="stroke-brand" strokeWidth={1.2} /> : null}
                                <text x={nameW + n * cw + 8} y={y + ch - 3} className="fill-fg-3 text-micro tabular-nums">
                                    {row.usual === 'X' ? '—' : row.usual} · {fmtInt(row.gp)}
                                </text>
                            </g>
                        );
                    })}
                </svg>
            </ScrollRegion>
        </div>
    );
}

function CalendarLegend({ color }: { color: string }) {
    return (
        <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-micro uppercase tracking-label text-fg-3">
            {(['L1', 'L2', 'L3', 'L4'] as const).map(t => (
                <span key={t} className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-[2px]" style={{ background: color, opacity: TIER[t] }} />
                    {t}
                </span>
            ))}
            <span className="text-fg-3">· D1–D3 the same way</span>
            <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-[2px] border border-line-strong" /> Dressed, off the top lines
            </span>
            <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-[2px] bg-surface-2" /> Did not play
            </span>
            <span>Right: usual line · games</span>
        </p>
    );
}

export function Lines() {
    const { m, colors } = useGame();
    const [side, setSide] = React.useState<Side>('away');
    const [focus, setFocus] = React.useState<number | null>(null);
    // Several games (a team's Breakdown): a per-game timeline would smear 82 games into one box, so the
    // section becomes the deployment calendar; the pooled opponents have no lines to show.
    if (m.starts?.length)
        return (
            <GameSection id="lines" title="Lines">
                <CalendarLegend color={colors.away} />
                <div className="panel flex min-w-0 flex-col gap-6 p-card">
                    <DeploymentCalendar />
                    <div>
                        <p className="label mb-2">Minutes</p>
                        <Minutes side="away" focus={focus} setFocus={setFocus} wide />
                    </div>
                </div>
            </GameSection>
        );
    return (
        <GameSection
            id="lines"
            title="Lines"
            aside={
                <TeamToggle
                    value={side}
                    onChange={v => {
                        setSide(v);
                        setFocus(null);
                    }}
                    teams={sideTeams(m)}
                />
            }
        >
            <Legend />
            <div className="panel flex min-w-0 flex-col gap-4 p-card">
                <p className="font-bold uppercase tracking-label" style={{ color: colors[side] }}>
                    {m.teams[side].place} {m.teams[side].name}
                </p>
                <div className="grid gap-8 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
                    <TeamUsage side={side} focus={focus} setFocus={setFocus} />
                    <div>
                        <p className="label mb-2">Minutes</p>
                        <Minutes side={side} focus={focus} setFocus={setFocus} />
                    </div>
                </div>
            </div>
        </GameSection>
    );
}
