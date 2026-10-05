'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { clockOf, goalMarkers, goalieRows, lineup, pairKey, pairTimes, skaterRows, units, type MarkerKind } from '@/lib/game/analytics';
import { SIDES, type Side } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';
import { useWidth } from './Pulse';

/*
 * Player usage, per team (after hockeyviz's usage chart, in Neon Arcade):
 *   - forwards on four lines and defenders on three pairs (5v5 time decides
 *     who plays with whom); every box is the whole game, with markers at the
 *     moment of each goal he was on the ice for at even strength or with an
 *     empty net: his goal, his primary assist, another goal for, a goal
 *     against;
 *   - bars between linemates grow with even-strength time together; thin
 *     links join players on different lines who still shared the ice;
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

function Markers({ list, x, y, w, end }: { list: { t: number; kind: MarkerKind }[]; x: number; y: number; w: number; end: number }) {
    return (
        <>
            {list.map((mk, i) => {
                const mx = x + 4 + (Math.min(mk.t, end) / end) * (w - 8);
                const cy = y + BOX_H / 2;
                const fill = mk.kind === 'ga' ? 'var(--neg)' : 'var(--pos)';
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

function TeamUsage({ side }: { side: Side }) {
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
    const links: { a: Node; b: Node; t: number; inLine: boolean }[] = [];
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
            placed.push(row);
            y += ROW;
        });
        // Links: neighbours on a row, and (even strength only) across rows.
        placed.forEach(row => {
            for (let i = 0; i < row.length - 1; i++) links.push({ a: row[i], b: row[i + 1], t: data.pairs.get(pairKey(row[i].id, row[i + 1].id)) ?? 0, inLine: true });
        });
        if (ctx === 'es') {
            for (let r = 0; r < placed.length; r++) {
                for (let q = r + 1; q < placed.length; q++) {
                    for (const a of placed[r]) {
                        for (const b of placed[q]) {
                            const t = data.pairs.get(pairKey(a.id, b.id)) ?? 0;
                            if (t >= 60) links.push({ a, b, t, inLine: false });
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

    return (
        <div ref={ref} className="min-w-0">
            {width ? (
                <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${m.teams[side].name} player usage: lines, pairs, special-teams units and goalie`} className="block font-mono">
                    {titles.map(t => (
                        <text key={t.text} x={pad} y={t.y} className="fill-fg-3 text-micro uppercase" letterSpacing="0.08em">
                            {t.text}
                        </text>
                    ))}
                    {/* Cross-line links first, under the boxes. */}
                    {links
                        .filter(l => !l.inLine)
                        .map((l, i) => {
                            const up = l.a.y < l.b.y ? l.a : l.b;
                            const dn = up === l.a ? l.b : l.a;
                            const k = Math.min(1, l.t / maxPair);
                            return (
                                <line key={`x${i}`} x1={up.x + up.w / 2} y1={up.y + BOX_H} x2={dn.x + dn.w / 2} y2={dn.y - NAME_H + 2} className="stroke-fg-3" strokeOpacity={0.2 + 0.4 * k} strokeWidth={0.6 + 2.4 * k}>
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
                                <rect key={`l${i}`} x={l.a.x + l.a.w} y={l.a.y + BOX_H / 2 - h / 2} width={Math.max(0, l.b.x - (l.a.x + l.a.w))} height={h} className="fill-line-strong">
                                    <title>{`${label(l.a.id)} with ${label(l.b.id)}: ${clockOf(l.t)}`}</title>
                                </rect>
                            );
                        })}
                    {nodes.map(n => (
                        <g key={`${n.ctx}-${n.id}-${n.y}`}>
                            <text x={n.x + n.w / 2} y={n.y - 4} textAnchor="middle" className="fill-fg-1 text-micro">
                                {label(n.id)}
                            </text>
                            <rect x={n.x} y={n.y} width={n.w} height={BOX_H} rx={3} className="fill-surface-3" stroke={n.tint ?? 'var(--line-strong)'} strokeWidth={n.tint ? 1.4 : 1} />
                            {n.tint ? <rect x={n.x} y={n.y} width={n.w} height={BOX_H} rx={3} fill={n.tint} opacity={0.14} /> : null}
                            <Markers list={goalMarkers(m, n.id, side, n.ctx)} x={n.x} y={n.y} w={n.w} end={end} />
                        </g>
                    ))}
                    {data.goalie && goalieY >= 0 ? (
                        <g>
                            <text x={pad} y={goalieY - 4} className="fill-goalie text-micro">
                                {label(data.goalie.player.id)} · {Math.round((data.goalie.toi / end) * 100)}%
                            </text>
                            <rect x={pad} y={goalieY} width={W - pad * 2} height={BOX_H} rx={3} className="fill-track" />
                            <rect x={pad} y={goalieY} width={(W - pad * 2) * Math.min(1, data.goalie.toi / end)} height={BOX_H} rx={3} className="fill-surface-3" stroke="var(--goalie)" strokeOpacity={0.6} />
                            <Markers list={data.goalieGa.map(e => ({ t: e.t, kind: 'ga' as MarkerKind }))} x={pad} y={goalieY} w={W - pad * 2} end={end} />
                        </g>
                    ) : null}
                </svg>
            ) : (
                <div className="h-[640px]" aria-hidden="true" />
            )}
        </div>
    );
}

/** Minutes per skater: even strength (number inside), power play, penalty kill; defenders first, like the lineup card. */
function Minutes({ side }: { side: Side }) {
    const { m, label } = useGame();
    const rows = skaterRows(m, side, 'all');
    const max = Math.max(1, ...rows.map(r => r.toi));
    const groups = [rows.filter(r => r.player.pos === 'D'), rows.filter(r => r.player.pos !== 'D')];
    return (
        <div className="flex flex-col gap-4">
            {groups.map((list, gi) => (
                <ol key={gi} className="flex flex-col gap-1.5" aria-label={gi === 0 ? 'Defence minutes' : 'Forward minutes'}>
                    {list.map(r => (
                        <li key={r.player.id} className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-2 text-caption tabular-nums">
                            <span
                                className="flex h-5 overflow-hidden rounded-[3px]"
                                style={{ width: `${(r.toi / max) * 100}%` }}
                                title={`ES ${clockOf(r.toiEv)} · PP ${clockOf(r.toiPp)} · PK ${clockOf(r.toiSh)} · total ${clockOf(r.toi)}`}
                            >
                                <span className="flex h-full items-center bg-surface-3 pl-1.5 text-micro font-bold text-fg-1" style={{ width: `${(r.toiEv / r.toi) * 100}%` }}>
                                    {Math.round(r.toiEv / 60)}
                                </span>
                                <span className="h-full bg-[var(--pp)]" style={{ width: `${(r.toiPp / r.toi) * 100}%` }} />
                                <span className="h-full bg-[var(--pk)]" style={{ width: `${(r.toiSh / r.toi) * 100}%` }} />
                            </span>
                            <span className="truncate text-fg-1">{label(r.player.id)}</span>
                        </li>
                    ))}
                </ol>
            ))}
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
                <span className="h-1.5 w-5 rounded-full bg-line-strong" /> Time together
            </span>
            <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[2px] bg-surface-3" /> ES
                <span className="ml-1 h-2.5 w-2.5 rounded-[2px] bg-[var(--pp)]" /> PP
                <span className="ml-1 h-2.5 w-2.5 rounded-[2px] bg-[var(--pk)]" /> PK minutes
            </span>
        </p>
    );
}

export function Lines() {
    const { m, colors } = useGame();
    const [side, setSide] = React.useState<Side>('away');
    return (
        <GameSection
            id="lines"
            title="Lines"
            aside={<Segmented label="Team" size="sm" value={side} onChange={setSide} optionClassName="px-2.5" options={SIDES.map(s => ({ value: s, label: m.teams[s].tri }))} />}
        >
            <Legend />
            <div className="panel flex min-w-0 flex-col gap-4 p-card">
                <p className="font-bold uppercase tracking-label" style={{ color: colors[side] }}>
                    {m.teams[side].place} {m.teams[side].name}
                </p>
                <div className="grid gap-8 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
                    <TeamUsage side={side} />
                    <div>
                        <p className="label mb-2">Minutes</p>
                        <Minutes side={side} />
                    </div>
                </div>
            </div>
        </GameSection>
    );
}
