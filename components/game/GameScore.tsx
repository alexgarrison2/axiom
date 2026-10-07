'use client';

import * as React from 'react';
import Link from 'next/link';
import { Crest } from '@/components/ui/crest';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { clockOf, gameScores, GS_PARTS, type GameScoreRow, type GoalieScoreRow, type GsPart } from '@/lib/game/analytics';
import type { Side } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';
import { TipFace } from './HoverTip';
import { JerseyNumber } from './Jersey';

/*
 * Pony Score breakdown (built on Luszczyszyn's Game Score weights): every skater's one-game score as a signed stack of
 * eight parts (offence in a cool family, defence in a warm one; the same
 * four ideas each side). Positive parts stack right of zero, negative parts
 * left, and an ink notch marks the net. Hover a row for its card; click (or
 * Enter) pins it.
 */

const PARTS: Record<GsPart, { label: string; color: string }> = {
    oProd: { label: 'Production', color: '#38c6e6' },
    oDrive: { label: 'Play driving', color: '#2b7ea6' },
    oSpecial: { label: 'Special teams', color: '#9fe3f2' },
    oUsage: { label: 'Usage', color: '#5d7289' },
    dProd: { label: 'Production', color: '#e2603f' },
    dDrive: { label: 'Play driving', color: '#f39143' },
    dSpecial: { label: 'Special teams', color: '#f4c552' },
    dUsage: { label: 'Usage', color: '#a08e7c' },
};
const IDEAS: [GsPart, GsPart][] = [
    ['oProd', 'dProd'],
    ['oDrive', 'dDrive'],
    ['oSpecial', 'dSpecial'],
    ['oUsage', 'dUsage'],
];

const VB = 1000;
const ROW_H = 30;
const BAR_H = 14;

const signed = (v: number, d = 2) => `${v > 0.004 ? '+' : v < -0.004 ? '−' : ''}${Math.abs(v).toFixed(d)}`;
const f1 = (v: number) => v.toFixed(1);
const pctTxt = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

/** The counts behind one part, in the card. */
function rawLine(r: GameScoreRow, k: GsPart): string {
    const x = r.raw;
    switch (k) {
        case 'oProd': {
            const bits = [`${x.g} G`, `${x.a1} A1`, `${x.a2} A2`, `${x.sog} SOG`];
            if (x.pd) bits.push(`${x.pd} drawn`);
            if (x.foW + x.foL) bits.push(`FO ${x.foW}–${x.foL}`);
            return bits.join(' · ');
        }
        case 'oDrive':
            return `5v5 CF ${x.cf} vs ${f1(x.cfExp)} · GF ${x.gf} vs ${x.gfExp.toFixed(2)}`;
        case 'oSpecial':
            return x.toiPp > 0 ? `PP ${clockOf(x.toiPp)} · GF ${x.gfPp} vs ${((6.6 / 3600) * x.toiPp).toFixed(2)}` : 'No PP time';
        case 'oUsage':
            return `Teammates ${pctTxt(x.qot)} of the game`;
        case 'dProd':
            return `${x.blk} blocks · ${x.pt} taken`;
        case 'dDrive':
            return `5v5 CA ${x.ca} vs ${f1(x.caExp)} · GA ${x.ga} vs ${x.gaExp.toFixed(2)}`;
        case 'dSpecial':
            return x.toiPk > 0 ? `PK ${clockOf(x.toiPk)} · GA ${x.gaPk} vs ${((6.6 / 3600) * x.toiPk).toFixed(2)}` : 'No PK time';
        case 'dUsage':
            return `Competition ${pctTxt(x.qoc)} of the game`;
    }
}

/** Signed stack geometry: positive parts right of zero, negative left, in the fixed part order. */
function stack(parts: Record<GsPart, number>, x: (v: number) => number) {
    const out: { k: GsPart; x: number; w: number }[] = [];
    let pos = 0;
    let neg = 0;
    for (const k of GS_PARTS) {
        const v = parts[k];
        if (Math.abs(v) < 0.0005) continue;
        if (v > 0) {
            out.push({ k, x: x(pos), w: x(pos + v) - x(pos) });
            pos += v;
        } else {
            out.push({ k, x: x(neg + v), w: x(neg) - x(neg + v) });
            neg += v;
        }
    }
    return out;
}

function MiniStack({ parts, d }: { parts: Record<GsPart, number>; d: number }) {
    const x = (v: number) => VB / 2 + (v / d) * (VB / 2 - 10);
    return (
        <svg viewBox={`0 0 ${VB} 10`} preserveAspectRatio="none" className="block h-2.5 w-full" aria-hidden="true">
            <rect x={0} y={0} width={VB} height={10} fill="var(--track)" />
            {stack(parts, x).map(s => (
                <rect key={s.k} x={s.x} y={0} width={Math.max(0, s.w - 1)} height={10} fill={PARTS[s.k].color} />
            ))}
            <line x1={VB / 2} x2={VB / 2} y1={0} y2={10} className="stroke-fg-1" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

function SkaterCard({ r, d, rank }: { r: GameScoreRow; d: number; rank: string }) {
    const { m, colors } = useGame();
    const col = (keys: GsPart[], title: string) => (
        <div className="flex flex-col gap-1">
            <p className="text-micro uppercase tracking-label text-fg-3">{title}</p>
            {keys.map(k => (
                <div key={k} className="grid grid-cols-[0.625rem_minmax(0,1fr)_auto] items-baseline gap-x-2">
                    <span className="h-2.5 w-2.5 translate-y-px rounded-[2px]" style={{ background: PARTS[k].color }} />
                    <span className="min-w-0">
                        <span className="block text-fg-1">{PARTS[k].label}</span>
                        <span className="block truncate text-micro text-fg-3">{rawLine(r, k)}</span>
                    </span>
                    <span className={cn('tabular-nums', Math.abs(r.parts[k]) < 0.005 ? 'text-fg-3' : 'text-fg-1')}>{signed(r.parts[k])}</span>
                </div>
            ))}
        </div>
    );
    return (
        <div className="flex w-[21rem] max-w-full flex-col gap-3">
            <div className="flex items-center gap-2.5">
                <TipFace p={r.player} color={colors[r.player.side]} size={40} />
                <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-bold text-fg-1">
                        {r.player.first} {r.player.last}
                    </span>
                    <span className="text-micro text-fg-3">
                        #{r.player.num ?? '–'} · {r.player.pos} · {m.teams[r.player.side].tri} · {clockOf(r.raw.toi)} · {rank}
                    </span>
                </span>
                <span className="text-right leading-none">
                    <span className={cn('block font-display text-title font-bold tabular-nums', r.total < 0 ? 'text-fg-2' : 'text-fg-1')}>{signed(r.total)}</span>
                    <span className="text-micro uppercase tracking-label text-fg-3">Pony score</span>
                </span>
            </div>
            <MiniStack parts={r.parts} d={d} />
            {col(['oProd', 'oDrive', 'oSpecial', 'oUsage'], 'Offence')}
            {col(['dProd', 'dDrive', 'dSpecial', 'dUsage'], 'Defence')}
        </div>
    );
}

function GoalieCard({ g }: { g: GoalieScoreRow }) {
    const { m } = useGame();
    const sv = g.sa ? ((g.sa - g.ga) / g.sa).toFixed(3).replace(/^0/, '') : '—';
    return (
        <div className="flex w-64 max-w-full flex-col gap-3">
            <div className="flex items-center gap-2.5">
                <TipFace p={g.player} color="var(--goalie)" size={40} />
                <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-bold text-fg-1">
                        {g.player.first} {g.player.last}
                    </span>
                    <span className="text-micro text-fg-3">
                        #{g.player.num ?? '–'} · G · {m.teams[g.player.side].tri} · {clockOf(g.toi)}
                    </span>
                </span>
                <span className="text-right leading-none">
                    <span className={cn('block font-display text-title font-bold tabular-nums', g.total < 0 ? 'text-fg-2' : 'text-fg-1')}>{signed(g.total)}</span>
                    <span className="text-micro uppercase tracking-label text-fg-3">GSAx</span>
                </span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center tabular-nums">
                {[
                    ['SA', String(g.sa), 'text-fg-1'],
                    ['GA', String(g.ga), 'text-fg-1'],
                    ['SV%', sv, 'text-fg-1'],
                    ['xGA', g.xga.toFixed(2), 'text-model'],
                ].map(([k, v, c]) => (
                    <span key={k}>
                        <span className="block text-micro uppercase tracking-label text-fg-3">{k}</span>
                        <span className={c}>{v}</span>
                    </span>
                ))}
            </div>
            <p className="text-micro text-fg-3">Goalies score goals saved above expected: pony xG against minus goals allowed.</p>
        </div>
    );
}

type Tip = { key: string; x: number; y: number; pinned: boolean; node: React.ReactNode };

export function GameScore() {
    const { m } = useGame();
    const [side, setSide] = React.useState<Side>('away');
    const [tip, setTip] = React.useState<Tip | null>(null);
    const boxRef = React.useRef<HTMLDivElement>(null);
    const cardRef = React.useRef<HTMLDivElement>(null);
    const [cardSize, setCardSize] = React.useState({ w: 336, h: 320 });

    const data = React.useMemo(() => gameScores(m, side), [m, side]);
    const forwards = data.skaters.filter(r => r.player.pos !== 'D');
    const defence = data.skaters.filter(r => r.player.pos === 'D');
    const goalies = data.goalies.filter(g => g.toi > 0);

    // One symmetric scale for the team: the widest side of any stack, rounded up to a half point.
    let reach = 0.5;
    for (const r of data.skaters) {
        let pos = 0;
        let neg = 0;
        for (const k of GS_PARTS) {
            if (r.parts[k] > 0) pos += r.parts[k];
            else neg -= r.parts[k];
        }
        reach = Math.max(reach, pos, neg);
    }
    for (const g of goalies) reach = Math.max(reach, Math.abs(g.total));
    const d = Math.ceil(reach * 2) / 2;
    const x = (v: number) => VB / 2 + (v / d) * (VB / 2 - 6);
    const ticks: number[] = [];
    const step = d > 2 ? 1 : 0.5;
    for (let v = -d; v <= d + 1e-9; v += step) ticks.push(Math.round(v * 2) / 2);

    React.useLayoutEffect(() => {
        const r = cardRef.current?.getBoundingClientRect();
        if (r) setCardSize(s => (Math.abs(r.width - s.w) > 1 || Math.abs(r.height - s.h) > 1 ? { w: r.width, h: r.height } : s));
    }, [tip]);

    // Clicking anywhere else, or Escape, lets go of a pinned card.
    React.useEffect(() => {
        if (!tip?.pinned) return;
        const off = (e: PointerEvent) => {
            if (!boxRef.current?.contains(e.target as Node)) setTip(null);
        };
        const esc = (e: KeyboardEvent) => e.key === 'Escape' && setTip(null);
        window.addEventListener('pointerdown', off);
        window.addEventListener('keydown', esc);
        return () => {
            window.removeEventListener('pointerdown', off);
            window.removeEventListener('keydown', esc);
        };
    }, [tip?.pinned]);

    const local = (clientX: number, clientY: number) => {
        const b = boxRef.current?.getBoundingClientRect();
        return b ? { x: clientX - b.left, y: clientY - b.top } : { x: 0, y: 0 };
    };
    const handlers = (key: string, node: React.ReactNode) => ({
        onPointerEnter: (e: React.PointerEvent) => {
            if (tip?.pinned || e.pointerType !== 'mouse') return;
            setTip({ key, ...local(e.clientX, e.clientY), pinned: false, node });
        },
        onPointerMove: (e: React.PointerEvent) => {
            if (tip?.pinned || e.pointerType !== 'mouse') return;
            setTip({ key, ...local(e.clientX, e.clientY), pinned: false, node });
        },
        onPointerLeave: () => {
            if (!tip?.pinned) setTip(null);
        },
        onClick: (e: React.MouseEvent) => {
            if (tip?.pinned && tip.key === key) setTip(null);
            else setTip({ key, ...local(e.clientX, e.clientY), pinned: true, node });
        },
        onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            if (tip?.pinned && tip.key === key) setTip(null);
            else setTip({ key, ...local(r.left + r.width * 0.6, r.top + r.height / 2), pinned: true, node });
        },
        onFocus: (e: React.FocusEvent<HTMLElement>) => {
            if (tip?.pinned) return;
            const r = e.currentTarget.getBoundingClientRect();
            setTip({ key, ...local(r.left + r.width * 0.6, r.top + r.height / 2), pinned: false, node });
        },
        onBlur: () => {
            if (!tip?.pinned) setTip(null);
        },
    });

    const boxW = boxRef.current?.clientWidth ?? 1000;
    const boxH = boxRef.current?.clientHeight ?? 800;
    // Beside the pointer, flipped near the right edge, and never wider or further right than the chart.
    const cardLeft = tip ? Math.min(Math.max(0, boxW - cardSize.w), tip.x + 18 + cardSize.w > boxW ? Math.max(0, tip.x - 18 - cardSize.w) : tip.x + 18) : 0;
    const cardTop = tip ? Math.max(0, Math.min(tip.y - 40, boxH - cardSize.h)) : 0;

    let rowIndex = 0;
    // A plain render function (not a component) so rows keep their identity across hovers and the grow plays once.
    const row = ({ rowKey, children, name, total, bar, card, label }: { rowKey: string; children?: React.ReactNode; name: React.ReactNode; total: number; bar: React.ReactNode; card: React.ReactNode; label: string }) => {
        const i = rowIndex++;
        const active = tip?.key === rowKey;
        const faded = tip != null && !active;
        return (
            <div
                key={rowKey}
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-expanded={tip?.pinned && active ? true : undefined}
                {...handlers(rowKey, card)}
                className={cn(
                    'grid cursor-pointer grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-x-3 rounded-control outline-none transition-opacity duration-200 focus-visible:outline-2 focus-visible:outline-brand md:grid-cols-[12.5rem_minmax(0,1fr)]',
                    faded && 'opacity-35',
                    active && tip?.pinned && 'bg-surface-2',
                )}
                style={{ height: ROW_H }}
            >
                <span className="flex min-w-0 items-center gap-2 pl-1">
                    {name}
                    <span className={cn('ml-auto w-11 text-right text-caption font-semibold tabular-nums', total < 0 ? 'text-fg-2' : 'text-fg-1')}>{signed(total)}</span>
                </span>
                <svg viewBox={`0 0 ${VB} ${ROW_H}`} preserveAspectRatio="none" className="block h-full w-full overflow-visible" aria-hidden="true">
                    {ticks.map(t => (
                        <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={ROW_H} className={t === 0 ? 'stroke-fg-3' : 'stroke-line'} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    ))}
                    <g className="gs-grow" style={{ transformOrigin: `${x(0)}px 50%`, animationDelay: `${Math.min(i, 24) * 22}ms` }}>
                        {bar}
                    </g>
                    {children}
                </svg>
            </div>
        );
    };

    const skaterRow = (r: GameScoreRow, i: number, list: GameScoreRow[], group: string) => {
        const rank = `${i + 1} of ${list.length} ${group}`;
        const segs = stack(r.parts, x);
        const y0 = (ROW_H - BAR_H) / 2;
        return row({
            rowKey: `s${r.player.id}`,
            label: `${r.player.first} ${r.player.last}, Pony Score ${signed(r.total)}. Press Enter for the breakdown.`,
            total: r.total,
            card: <SkaterCard r={r} d={d} rank={rank} />,
            name: (
                <>
                    <JerseyNumber tri={m.teams[side].tri} num={r.player.num} ring="var(--line-strong)" size={22} />
                    <span className="min-w-0 truncate text-caption text-fg-1">{r.player.last}</span>
                </>
            ),
            bar: (
                <>
                    {segs.map(s => (
                        <rect key={s.k} x={s.x} y={y0} width={Math.max(0, s.w - 1.5)} height={BAR_H} fill={PARTS[s.k].color} />
                    ))}
                </>
            ),
            // The net: an ink notch where the parts add up to.
            children: <line x1={x(r.total)} x2={x(r.total)} y1={y0 - 4} y2={y0 + BAR_H + 4} className="stroke-fg-1" strokeWidth={2} vectorEffect="non-scaling-stroke" />,
        });
    };

    const group = (title: string, children: React.ReactNode) => (
        <div>
            <p className="label mb-1 pl-1">{title}</p>
            <div role="group" aria-label={title} className="flex flex-col">
                {children}
            </div>
        </div>
    );

    return (
        <GameSection
            id="ponyscore"
            title="Pony score"
            aside={
                <Segmented
                    label="Team"
                    size="sm"
                    value={side}
                    onChange={v => {
                        setSide(v);
                        setTip(null);
                    }}
                    optionClassName="gap-1.5 px-2.5"
                    options={(['away', 'home'] as Side[]).map(s => ({
                        value: s,
                        label: (
                            <span className="flex items-center gap-1.5">
                                <Crest tri={m.teams[s].tri} size={18} className="h-[18px] w-[18px]" />
                                {m.teams[s].tri}
                            </span>
                        ),
                        ariaLabel: m.teams[s].name,
                    }))}
                />
            }
        >
            <div className="panel p-card">
                {/* Legend: the four ideas, each with its offence and defence colour. */}
                <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-micro uppercase tracking-label text-fg-3">
                    <span className="flex items-center gap-1.5 text-fg-2">
                        Cool = offence · warm = defence
                    </span>
                    {IDEAS.map(([o, dd]) => (
                        <span key={o} className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: PARTS[o].color }} />
                            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: PARTS[dd].color }} />
                            {PARTS[o].label}
                        </span>
                    ))}
                    <Link href="/methodology#pony-score" className="ml-auto underline-offset-4 hover:text-fg-1 hover:underline">
                        Method
                    </Link>
                </div>

                <div key={side} ref={boxRef} className="relative flex flex-col gap-4">
                    <style>{`
                        @keyframes gs-grow { from { transform: scaleX(0); } }
                        .gs-grow { animation: gs-grow 520ms cubic-bezier(0.16, 1, 0.3, 1) both; }
                        @media (prefers-reduced-motion: reduce) { .gs-grow { animation: none; } }
                    `}</style>
                    {forwards.length ? group('Forwards', forwards.map((r, i) => skaterRow(r, i, forwards, 'F'))) : null}
                    {defence.length ? group('Defence', defence.map((r, i) => skaterRow(r, i, defence, 'D'))) : null}
                    {goalies.length
                        ? group(
                              'Goalie',
                              goalies.map(g => {
                                  const y0 = (ROW_H - BAR_H) / 2;
                                  const a = Math.min(x(0), x(g.total));
                                  return row({
                                      rowKey: `g${g.player.id}`,
                                      label: `${g.player.first} ${g.player.last}, goals saved above expected ${signed(g.total)}. Press Enter for the breakdown.`,
                                      total: g.total,
                                      card: <GoalieCard g={g} />,
                                      name: (
                                          <>
                                              <JerseyNumber tri={m.teams[side].tri} num={g.player.num} ring="var(--goalie)" size={22} />
                                              <span className="min-w-0 truncate text-caption text-goalie">{g.player.last}</span>
                                          </>
                                      ),
                                      bar: <rect x={a} y={y0} width={Math.abs(x(g.total) - x(0))} height={BAR_H} fill="var(--goalie)" opacity={0.75} />,
                                  });
                              }),
                          )
                        : null}

                    {/* Scale. */}
                    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 md:grid-cols-[12.5rem_minmax(0,1fr)]" aria-hidden="true">
                        <span />
                        <span className="relative h-4 text-micro tabular-nums text-fg-3">
                            {ticks.map(t => (
                                <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(x(t) / VB) * 100}%` }}>
                                    {t > 0 ? `+${t}` : t < 0 ? `−${Math.abs(t)}` : '0'}
                                </span>
                            ))}
                        </span>
                    </div>

                    {tip ? (
                        <div
                            ref={cardRef}
                            role={tip.pinned ? 'dialog' : 'tooltip'}
                            aria-label={tip.pinned ? 'Pony Score breakdown' : undefined}
                            className={cn(
                                'absolute z-30 rounded-card border bg-surface-1/95 p-3.5 text-caption shadow-[0_16px_40px_rgb(0_0_0/0.6)] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95',
                                tip.pinned ? 'pointer-events-auto border-brand/60' : 'pointer-events-none border-line-strong',
                            )}
                            style={{ left: cardLeft, top: cardTop, maxWidth: boxW }}
                        >
                            {tip.node}
                            {tip.pinned ? <p className="mt-3 border-t border-line pt-2 text-micro uppercase tracking-label text-fg-3">Pinned · click again or Esc to close</p> : null}
                        </div>
                    ) : null}
                </div>
            </div>
        </GameSection>
    );
}
