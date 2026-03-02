'use client';

import { useState, useEffect, useMemo } from 'react';
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

// ── Player impact data types ───────────────────────────────────────────────────
interface PIPlayer {
    name: string;
    team: string;
    is_forward: boolean;
    games_played: number;
    game_score: number;
}
type PiData = Record<string, PIPlayer>;

// ── Team lineups (all teams' current lineup data) ─────────────────────────────
interface LineupPlayerSlim { name: string; }
interface TeamLineupSlim { [key: string]: LineupPlayerSlim[]; } // f1,f2,f3,f4,d1,d2,d3
type AllLineups = Record<string, TeamLineupSlim>; // triCode → lineup

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

function lineImpactColor(pct: number): string {
    if (pct >= 80) return '#3b82f6';   // blue   – elite
    if (pct >= 60) return '#38bdf8';   // sky    – above avg
    if (pct >= 40) return '#6b7280';   // gray   – average
    if (pct >= 20) return '#f97316';   // orange – below avg
    return '#ef4444';                  // red    – bottom tier
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
                {sign}{gsax.toFixed(2)}
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

// ── Line/pairing impact badge ─────────────────────────────────────────────────
function ImpactBadge({ lineKey, impact }: {
    lineKey: string;
    impact: { total: number; pct: number } | null | undefined;
}) {
    const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);

    if (!impact) {
        return (
            <div className="flex items-center justify-center border-l border-white/5 min-w-[3.5rem]">
                <span className="text-[9px] text-neutral-700">—</span>
            </div>
        );
    }

    const color     = lineImpactColor(impact.pct);
    const sign      = impact.total >= 0 ? '+' : '';
    const rank      = Math.round(impact.pct);
    const lineLabel = lineKey.toUpperCase();

    const tooltipSegs: Seg[] = [
        { text: `${lineLabel} line: ` },
        { text: `${sign}${impact.total.toFixed(2)} gs/gm`, color },
        { text: ' · ' },
        { text: `${rank}${ordinalSuffix(rank)} %ile`, color },
        { text: ` vs. current NHL ${lineLabel} lines` },
    ];

    return (
        <>
            <div
                className="flex flex-col items-center justify-center border-l border-white/5 min-w-[3.5rem] cursor-default select-none"
                onMouseEnter={(e) => setMouse({ x: e.clientX, y: e.clientY })}
                onMouseMove={(e)  => setMouse({ x: e.clientX, y: e.clientY })}
                onMouseLeave={()  => setMouse(null)}
            >
                <span className="text-[10px] font-bold tabular-nums leading-none" style={{ color }}>
                    {sign}{impact.total.toFixed(2)}
                </span>
                <span className="text-[8px] tabular-nums leading-none mt-0.5" style={{ color }}>
                    {rank}{ordinalSuffix(rank)}%
                </span>
            </div>
            {mouse && <FixedTooltip x={mouse.x} y={mouse.y} segments={tooltipSegs} />}
        </>
    );
}

// ── Name normalizer (strips diacritics, lowercases) ──────────────────────────
// Mirrors SkaterGrid's norm() so name-based player lookup is consistent.
function normName(s: string): string {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// ── Main grid ─────────────────────────────────────────────────────────────────
export default function LineupGrid({
    lineup, triCode, lineupScore, lineupVsTeam, goalieStarter, gsaxPerGame, gsaxPct,
}: LineupGridProps) {
    // ── Hooks (must precede any early returns per Rules of Hooks) ─────────────
    const [piData,      setPiData]      = useState<PiData | null>(null);
    const [allLineups,  setAllLineups]  = useState<AllLineups | null>(null);

    useEffect(() => {
        fetch('/data/player_impact.json')
            .then(r => r.json())
            .then((d: PiData) => setPiData(d))
            .catch(() => {});
        fetch('/data/team_lineups.json')
            .then(r => r.json())
            .then((d: AllLineups) => setAllLineups(d))
            .catch(() => {});
    }, []);

    // name → gs_pg (game_score / games_played)
    // Keyed by normalised full name AND normalised last name for two-pass fallback
    const gsMap = useMemo((): Map<string, number> => {
        if (!piData) return new Map();
        const m = new Map<string, number>();
        for (const [, p] of Object.entries(piData)) {
            if (p.games_played <= 0) continue;
            const gspg = p.game_score / p.games_played;
            const full = normName(p.name);
            m.set(full, gspg);
            const last = full.split(' ').at(-1) ?? full;
            if (!m.has(last)) m.set(last, gspg); // last-name fallback (don't overwrite)
        }
        return m;
    }, [piData]);

    // League-wide distributions built from ACTUAL current lineup pairings/lines.
    // Each team's real f1/f2/f3/f4/d1/d2/d3 contributes one entry per slot.
    // Falls back to virtual (top-N by gs_pg) if team_lineups.json is unavailable.
    const lineDistributions = useMemo((): Record<string, number[]> => {
        if (!gsMap.size) return {};

        const dist: Record<string, number[]> = { f1: [], f2: [], f3: [], f4: [], d1: [], d2: [], d3: [] };
        const lookupGsPg = (name: string): number | undefined => {
            const full = normName(name);
            return gsMap.get(full) ?? gsMap.get(full.split(' ').at(-1) ?? full);
        };

        if (allLineups) {
            // ── Real lineup distribution ────────────────────────────────────
            for (const teamLineup of Object.values(allLineups)) {
                for (const [key, required] of [['f1',3],['f2',3],['f3',3],['f4',3],['d1',2],['d2',2],['d3',2]] as [string,number][]) {
                    const players = teamLineup[key] || [];
                    if (players.length < required) continue;
                    const scores = players.slice(0, required).map(p => lookupGsPg(p.name));
                    if (scores.some(s => s === undefined)) continue;
                    dist[key].push((scores as number[]).reduce((a, b) => a + b, 0));
                }
            }
        } else {
            // ── Fallback: virtual top-N distribution from piData ────────────
            const teamFwds = new Map<string, number[]>();
            const teamDefs  = new Map<string, number[]>();
            for (const [, p] of Object.entries(piData ?? {})) {
                if (p.games_played <= 0) continue;
                const gspg   = p.game_score / p.games_played;
                const bucket = p.is_forward ? teamFwds : teamDefs;
                if (!bucket.has(p.team)) bucket.set(p.team, []);
                bucket.get(p.team)!.push(gspg);
            }
            for (const fwds of teamFwds.values()) {
                const s = [...fwds].sort((a, b) => b - a);
                for (let li = 0; li < 4; li++) {
                    const sl = s.slice(li * 3, li * 3 + 3);
                    if (sl.length === 3) dist[`f${li + 1}`].push(sl[0] + sl[1] + sl[2]);
                }
            }
            for (const defs of teamDefs.values()) {
                const s = [...defs].sort((a, b) => b - a);
                for (let di = 0; di < 3; di++) {
                    const sl = s.slice(di * 2, di * 2 + 2);
                    if (sl.length === 2) dist[`d${di + 1}`].push(sl[0] + sl[1]);
                }
            }
        }

        for (const key of Object.keys(dist)) dist[key].sort((a, b) => a - b);
        return dist;
    }, [gsMap, allLineups, piData]);

    // Actual lineup line totals + percentile vs league distributions.
    // Returns null for incomplete lines (missing players / no impact data).
    const lineImpacts = useMemo((): Record<string, { total: number; pct: number } | null> => {
        if (!lineup || !gsMap.size || !Object.keys(lineDistributions).length) return {};
        const result: Record<string, { total: number; pct: number } | null> = {};
        const lookupGsPg = (name: string): number | undefined => {
            const full = normName(name);
            if (gsMap.has(full)) return gsMap.get(full);
            const last = full.split(' ').at(-1) ?? full;
            return gsMap.get(last);
        };
        const compute = (key: string, required: number) => {
            const players = lineup[key] || [];
            if (players.length < required) { result[key] = null; return; }
            const scores = players.slice(0, required).map(p => lookupGsPg(p.name));
            if (scores.some(s => s === undefined)) { result[key] = null; return; }
            const total = (scores as number[]).reduce((a, b) => a + b, 0);
            const dist  = lineDistributions[key] || [];
            if (!dist.length) { result[key] = null; return; }
            result[key] = { total, pct: (dist.filter(v => v < total).length / dist.length) * 100 };
        };
        ['f1', 'f2', 'f3', 'f4'].forEach(k => compute(k, 3));
        ['d1', 'd2', 'd3'].forEach(k => compute(k, 2));
        return result;
    }, [lineup, gsMap, lineDistributions]);

    // ── Early return (after hooks) ────────────────────────────────────────────
    if (!lineup) return (
        <div className="flex flex-col items-center justify-center p-4 text-neutral-500 text-xs">
            No lineup data available.
        </div>
    );

    const getPlayers = (keys: string[]) => keys.map(k => lineup[k] || []);
    const forwards = getPlayers(['f1', 'f2', 'f3', 'f4']);
    const defense  = getPlayers(['d1', 'd2', 'd3']);

    // Show the IMP column once player data has loaded
    const showImp = piData !== null;

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
                    <div className={`grid ${showImp ? 'grid-cols-[1fr_1fr_1fr_3.5rem]' : 'grid-cols-3'} bg-white/5 border-b border-white/10`}>
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase">LW</div>
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase border-x border-white/5">C</div>
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase">RW</div>
                        {showImp && <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase border-l border-white/5">IMP</div>}
                    </div>
                    {forwards.map((line, i) => (
                        <div key={i} className={`grid ${showImp ? 'grid-cols-[1fr_1fr_1fr_3.5rem]' : 'grid-cols-3'} ${i !== forwards.length - 1 ? 'border-b border-white/5' : ''}`}>
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
                            {showImp && (
                                <ImpactBadge lineKey={`f${i + 1}`} impact={lineImpacts[`f${i + 1}`]} />
                            )}
                        </div>
                    ))}
                </div>

                {/* Defense Table */}
                <div className={`border border-white/10 rounded-lg overflow-hidden ${showImp ? '' : 'w-2/3'}`}>
                    <div className={`grid ${showImp ? 'grid-cols-[1fr_1fr_3.5rem]' : 'grid-cols-2'} bg-white/5 border-b border-white/10`}>
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase">LD</div>
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase border-l border-white/5">RD</div>
                        {showImp && <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase border-l border-white/5">IMP</div>}
                    </div>
                    {defense.map((pair, i) => (
                        <div key={i} className={`grid ${showImp ? 'grid-cols-[1fr_1fr_3.5rem]' : 'grid-cols-2'} ${i !== defense.length - 1 ? 'border-b border-white/5' : ''}`}>
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
                            {showImp && (
                                <ImpactBadge lineKey={`d${i + 1}`} impact={lineImpacts[`d${i + 1}`]} />
                            )}
                        </div>
                    ))}
                </div>

                {/* Out / IR Section */}
                {(() => {
                    const irPlayers = (lineup['ir'] || []).slice(0, 6);
                    if (!irPlayers.length) return null;
                    // Split into two columns: [0,2,4] left, [1,3,5] right
                    const left  = irPlayers.filter((_: unknown, i: number) => i % 2 === 0);
                    const right = irPlayers.filter((_: unknown, i: number) => i % 2 === 1);
                    const rows  = Math.max(left.length, right.length);
                    return (
                        <div className="border border-white/10 rounded-lg overflow-hidden">
                            <div className="grid grid-cols-2 bg-white/5 border-b border-white/10">
                                <div className="py-1 col-span-2 text-center text-[9px] font-bold text-neutral-500 uppercase">Out / IR</div>
                            </div>
                            {Array.from({ length: rows }).map((_, row) => {
                                const lp = left[row];
                                const rp = right[row];
                                return (
                                    <div key={row} className={`grid grid-cols-2 ${row !== rows - 1 ? 'border-b border-white/5' : ''}`}>
                                        {[lp, rp].map((player, col) => (
                                            <div key={col} className={`py-1.5 px-2 flex items-center justify-center ${col === 1 ? 'border-l border-white/5' : ''}`}>
                                                {player ? (
                                                    <span className="text-[10px] leading-tight select-none text-red-500 font-medium">
                                                        {formatName(player.name)}
                                                    </span>
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
}

function formatName(fullName: string) {
    if (!fullName) return '';
    const parts = fullName.split(' ');
    return parts.length > 1 ? parts[parts.length - 1] : fullName;
}
