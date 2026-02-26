'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { TeamLineup } from '@/utils/data';
import { ArrowUp, ArrowDown, Plus } from 'lucide-react';

interface LineupGridProps {
    lineup?: TeamLineup;
    triCode: string;
    lineupScore?: number;     // quality ratio vs league avg (1.0 = avg)
    lineupVsTeam?: number;    // quality ratio vs this team's own historical avg
    goalieStarter?: string;   // projected starter full name
    gsaxPerGame?: number;     // GSAx per game (positive = above avg)
    gsaxPct?: number;         // percentile rank among NHL starters (0–100)
}

// ── Tooltip segment type ───────────────────────────────────────────────────────
// Allows individual words/values to be colored independently.
type Seg = { text: string; color?: string };

// ── Fixed-position portal tooltip (immune to overflow:hidden clipping) ────────
const TOOLTIP_W = 280;

function FixedTooltip({ x, y, segments }: { x: number; y: number; segments: Seg[] }) {
    if (typeof document === 'undefined') return null;

    const vw   = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const left = Math.max(8, Math.min(x - TOOLTIP_W / 2, vw - TOOLTIP_W - 8));
    const top  = y > 56 ? y - 46 : y + 22;

    return createPortal(
        <div
            style={{ position: 'fixed', left, top, width: TOOLTIP_W, zIndex: 9999, pointerEvents: 'none' }}
            className="bg-zinc-950 border border-white/15 rounded-lg px-3 py-2 shadow-xl backdrop-blur-md text-[11px] leading-snug"
        >
            {segments.map((seg, i) => (
                <span key={i} style={{ color: seg.color ?? '#d4d4d8' }}>{seg.text}</span>
            ))}
        </div>,
        document.body
    );
}

// ── Color helpers ─────────────────────────────────────────────────────────────
function skaterColor(pct: number): string {
    if (pct <= -5)  return '#ef4444';
    if (pct <= -2)  return '#f97316';
    if (pct <   2)  return '#6b7280';
    if (pct <   5)  return '#22c55e';
    return '#16a34a';
}

function goalieColor(gsax: number): string {
    if (gsax >= 0.2)  return '#16a34a';
    if (gsax >= 0.05) return '#22c55e';
    if (gsax > -0.05) return '#6b7280';
    if (gsax > -0.15) return '#f97316';
    return '#ef4444';
}

// ── Tooltip segment builders ──────────────────────────────────────────────────
function skaterTooltipSegs(isLg: boolean, pct: number, triCode?: string): Seg[] {
    const abs   = Math.abs(pct).toFixed(1);
    const pos   = pct >= 0;
    const color = skaterColor(pct);
    const valText = pos ? `+${abs}%` : `${abs}%`;
    const dirText = pos ? 'stronger' : 'weaker';
    const suffix  = isLg ? ' than league avg' : ` than ${triCode ?? 'team'}'s season avg`;
    return [
        { text: 'Implies this lineup is ' },
        { text: valText,  color },
        { text: ' '  },
        { text: dirText, color },
        { text: suffix },
    ];
}

function ordinalSuffix(n: number): string {
    const abs = Math.abs(n);
    const mod100 = abs % 100;
    if (mod100 >= 11 && mod100 <= 13) return 'th';
    switch (abs % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

function goalieTooltipSegs(gsax: number, pct: number, name: string): Seg[] {
    const sign  = gsax >= 0 ? '+' : '';
    const color = goalieColor(gsax);
    const rank  = Math.round(pct);
    return [
        { text: `${name} — ` },
        { text: `${sign}${gsax.toFixed(2)} GSAx/gm`, color },
        { text: ' · ' },
        { text: `${rank}${ordinalSuffix(rank)} %ile`, color },
        { text: ' among NHL starters' },
    ];
}

// ── Generic chip with hover tooltip ──────────────────────────────────────────
function Chip({
    children, tooltipSegs,
}: {
    children: React.ReactNode;
    tooltipSegs: Seg[];
}) {
    const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
    return (
        <>
            <div
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 cursor-default select-none"
                onMouseEnter={(e) => setMouse({ x: e.clientX, y: e.clientY })}
                onMouseMove={(e)  => setMouse({ x: e.clientX, y: e.clientY })}
                onMouseLeave={()  => setMouse(null)}
            >
                {children}
            </div>
            {mouse && <FixedTooltip x={mouse.x} y={mouse.y} segments={tooltipSegs} />}
        </>
    );
}

// ── vs. League / vs. Team chips ───────────────────────────────────────────────
function LineupScoreChip({ label, ratio, isLg, triCode }: {
    label: string; ratio: number; isLg: boolean; triCode?: string;
}) {
    const pct   = (ratio - 1.0) * 100;
    const sign  = pct >= 0 ? '+' : '';
    const color = skaterColor(pct);
    return (
        <Chip tooltipSegs={skaterTooltipSegs(isLg, pct, triCode)}>
            <span className="text-[9px] text-neutral-500 font-medium">{label}</span>
            <span className="text-[9px] font-bold tabular-nums" style={{ color }}>
                {sign}{pct.toFixed(1)}%
            </span>
        </Chip>
    );
}

// ── Goalie chip ───────────────────────────────────────────────────────────────
// Strip status suffix like "(Confirmed)", "(Unconfirmed)" that comes from the CSV
function cleanGoalieName(raw: string): string {
    return raw.replace(/\s*\(.*?\)\s*$/, '').trim();
}

function GoalieChip({ name, gsax, pct }: { name: string; gsax: number; pct: number }) {
    const cleanName = cleanGoalieName(name);
    const lastName  = cleanName.split(' ').pop() ?? cleanName;
    const sign      = gsax >= 0 ? '+' : '';
    const color     = goalieColor(gsax);
    return (
        <Chip tooltipSegs={goalieTooltipSegs(gsax, pct, cleanName)}>
            <span className="text-[9px] text-neutral-300 font-medium">{lastName}</span>
            <span className="text-[9px] font-bold tabular-nums" style={{ color }}>
                ({sign}{gsax.toFixed(2)})
            </span>
        </Chip>
    );
}

// ── Header chip row ───────────────────────────────────────────────────────────
function LineupHeader({ lineupScore, lineupVsTeam, triCode, goalieStarter, gsaxPerGame, gsaxPct }: {
    lineupScore?: number;
    lineupVsTeam?: number;
    triCode?: string;
    goalieStarter?: string;
    gsaxPerGame?: number;
    gsaxPct?: number;
}) {
    const hasSkaterScores = lineupScore !== undefined || lineupVsTeam !== undefined;
    const hasGoalie = goalieStarter !== undefined && gsaxPerGame !== undefined && gsaxPct !== undefined;
    if (!hasSkaterScores && !hasGoalie) return null;

    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            {lineupScore !== undefined && (
                <LineupScoreChip label="vs. Lg:" ratio={lineupScore}  isLg={true}  triCode={triCode} />
            )}
            {lineupVsTeam !== undefined && (
                <LineupScoreChip label="vs. Tm:" ratio={lineupVsTeam} isLg={false} triCode={triCode} />
            )}
            {hasGoalie && (
                <GoalieChip name={goalieStarter!} gsax={gsaxPerGame!} pct={gsaxPct!} />
            )}
        </div>
    );
}

// ── Main grid ─────────────────────────────────────────────────────────────────
export default function LineupGrid({
    lineup, triCode, lineupScore, lineupVsTeam, goalieStarter, gsaxPerGame, gsaxPct,
}: LineupGridProps) {
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
                <LineupHeader
                    lineupScore={lineupScore}
                    lineupVsTeam={lineupVsTeam}
                    triCode={triCode}
                    goalieStarter={goalieStarter}
                    gsaxPerGame={gsaxPerGame}
                    gsaxPct={gsaxPct}
                />
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
