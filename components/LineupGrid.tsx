'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { TeamLineup } from '@/utils/data';
import { ArrowUp, ArrowDown, Plus } from 'lucide-react';

interface LineupGridProps {
    lineup?: TeamLineup;
    triCode: string;
    lineupScore?: number;    // quality ratio vs league avg (1.0 = avg)
    lineupVsTeam?: number;   // quality ratio vs this team's own historical avg
}

// ── Fixed-position portal tooltip ─────────────────────────────────────────────
// Renders into document.body so it is never clipped by any parent's
// overflow:hidden or overflow:scroll container.
// Positions above the cursor by default; flips below if cursor is near the top.
// Clamps horizontally so it never bleeds off screen edges.
const TOOLTIP_W = 264;

function FixedTooltip({ x, y, text }: { x: number; y: number; text: string }) {
    if (typeof document === 'undefined') return null;

    const vw   = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const left = Math.max(8, Math.min(x - TOOLTIP_W / 2, vw - TOOLTIP_W - 8));
    const top  = y > 56 ? y - 46 : y + 22;   // above cursor; flip below if near top edge

    return createPortal(
        <div
            style={{ position: 'fixed', left, top, width: TOOLTIP_W, zIndex: 9999, pointerEvents: 'none' }}
            className="bg-zinc-950 border border-white/15 rounded-lg px-3 py-2 shadow-xl backdrop-blur-md text-[11px] text-zinc-200 leading-snug"
        >
            {text}
        </div>,
        document.body
    );
}

// ── Color scale ───────────────────────────────────────────────────────────────
function scoreColor(pct: number): string {
    if (pct <= -5)  return '#ef4444';
    if (pct <= -2)  return '#f97316';
    if (pct <   2)  return '#6b7280';
    if (pct <   5)  return '#22c55e';
    return '#16a34a';
}

// ── Tooltip text builder ──────────────────────────────────────────────────────
function buildTooltipText(isLg: boolean, pct: number, triCode?: string): string {
    const abs = Math.abs(pct).toFixed(1);
    const dir = pct >= 0 ? 'stronger' : 'weaker';
    const sign = pct >= 0 ? `+${abs}%` : `${abs}%`;
    if (isLg) {
        return `Implies this lineup is ${sign} ${dir} than league avg`;
    }
    return `Implies this lineup is ${sign} ${dir} than ${triCode ?? 'team'}'s season avg`;
}

// ── Individual chip with hover tooltip ───────────────────────────────────────
function LineupScoreChip({
    label, ratio, isLg, triCode,
}: {
    label: string;
    ratio: number;
    isLg: boolean;
    triCode?: string;
}) {
    const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);

    const pct   = (ratio - 1.0) * 100;
    const sign  = pct >= 0 ? '+' : '';
    const color = scoreColor(pct);
    const text  = buildTooltipText(isLg, pct, triCode);

    return (
        <>
            <div
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 cursor-default select-none"
                onMouseEnter={(e) => setMouse({ x: e.clientX, y: e.clientY })}
                onMouseMove={(e)  => setMouse({ x: e.clientX, y: e.clientY })}
                onMouseLeave={()  => setMouse(null)}
            >
                <span className="text-[9px] text-neutral-500 font-medium">{label}</span>
                <span className="text-[9px] font-bold tabular-nums" style={{ color }}>
                    {sign}{pct.toFixed(1)}%
                </span>
            </div>
            {mouse && <FixedTooltip x={mouse.x} y={mouse.y} text={text} />}
        </>
    );
}

// ── Row of chips shown in the lineup header ───────────────────────────────────
function LineupScoreLabels({ lineupScore, lineupVsTeam, triCode }: {
    lineupScore?: number;
    lineupVsTeam?: number;
    triCode?: string;
}) {
    if (lineupScore === undefined && lineupVsTeam === undefined) return null;
    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            {lineupScore  !== undefined && (
                <LineupScoreChip label="vs. Lg:" ratio={lineupScore}  isLg={true}  triCode={triCode} />
            )}
            {lineupVsTeam !== undefined && (
                <LineupScoreChip label="vs. Tm:" ratio={lineupVsTeam} isLg={false} triCode={triCode} />
            )}
        </div>
    );
}

// ── Main grid component ───────────────────────────────────────────────────────
export default function LineupGrid({ lineup, triCode, lineupScore, lineupVsTeam }: LineupGridProps) {
    if (!lineup) return (
        <div className="flex flex-col items-center justify-center p-4 text-neutral-500 text-xs">
            No lineup data available.
        </div>
    );

    const getPlayers = (keys: string[]) => keys.map(k => lineup[k] || []);

    const forwards = getPlayers(['f1', 'f2', 'f3', 'f4']);
    const defense  = getPlayers(['d1', 'd2', 'd3']);

    return (
        <div className="flex flex-col w-full text-left">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest shrink-0">
                    Starting Lineup
                </span>
                <LineupScoreLabels lineupScore={lineupScore} lineupVsTeam={lineupVsTeam} triCode={triCode} />
            </div>

            <div className="flex flex-col gap-4">

                {/* Forwards Table */}
                <div className="border border-white/10 rounded-lg overflow-hidden">
                    <div className="grid grid-cols-3 bg-white/5 border-b border-white/10">
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase">LW</div>
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase border-x border-white/5">C</div>
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase">RW</div>
                    </div>
                    {forwards.map((line, i) => (
                        <div key={i} className={`grid grid-cols-3 ${i !== forwards.length - 1 ? 'border-b border-white/5' : ''}`}>
                            {[0, 1, 2].map(colIndex => {
                                const player = line[colIndex];
                                return (
                                    <div key={colIndex} className={`py-1.5 px-1 flex items-center justify-center text-center gap-1 ${colIndex === 1 ? 'border-x border-white/5' : ''}`}>
                                        <div className="flex items-center gap-1">
                                            {player?.movement === 'up'   && <ArrowUp   className="w-3 h-3 text-green-500"  strokeWidth={3} />}
                                            {player?.movement === 'down' && <ArrowDown  className="w-3 h-3 text-red-500"    strokeWidth={3} />}
                                            {player?.movement === 'new'  && <Plus       className="w-3 h-3 text-orange-500" strokeWidth={3} />}
                                            <span
                                                className="text-[10px] leading-tight select-none"
                                                style={{
                                                    color: player?.ppUnit === 1 ? '#5382BD' :
                                                           player?.ppUnit === 2 ? '#FFFFFF'  : '#697281',
                                                    fontWeight: player?.ppUnit === 1 ? 700 : 500,
                                                }}
                                            >
                                                {player ? formatName(player.name) : '-'}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>

                {/* Defense Table */}
                <div className="border border-white/10 rounded-lg overflow-hidden w-2/3">
                    <div className="grid grid-cols-2 bg-white/5 border-b border-white/10">
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase">LD</div>
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase border-l border-white/5">RD</div>
                    </div>
                    {defense.map((pair, i) => (
                        <div key={i} className={`grid grid-cols-2 ${i !== defense.length - 1 ? 'border-b border-white/5' : ''}`}>
                            {[0, 1].map(colIndex => {
                                const player = pair[colIndex];
                                return (
                                    <div key={colIndex} className={`py-1.5 px-1 flex items-center justify-center text-center gap-1 ${colIndex === 1 ? 'border-l border-white/5' : ''}`}>
                                        <div className="flex items-center gap-1">
                                            {player?.movement === 'up'   && <ArrowUp   className="w-3 h-3 text-green-500"  strokeWidth={3} />}
                                            {player?.movement === 'down' && <ArrowDown  className="w-3 h-3 text-red-500"    strokeWidth={3} />}
                                            {player?.movement === 'new'  && <Plus       className="w-3 h-3 text-orange-500" strokeWidth={3} />}
                                            <span
                                                className="text-[10px] leading-tight select-none"
                                                style={{
                                                    color: player?.ppUnit === 1 ? '#5382BD' :
                                                           player?.ppUnit === 2 ? '#FFFFFF'  : '#697281',
                                                    fontWeight: player?.ppUnit === 1 ? 700 : 500,
                                                }}
                                            >
                                                {player ? formatName(player.name) : '-'}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>

            </div>
        </div>
    );
}

function formatName(fullName: string) {
    if (!fullName) return '';
    const parts = fullName.split(' ');
    return parts.length > 1 ? parts[parts.length - 1] : fullName;
}
