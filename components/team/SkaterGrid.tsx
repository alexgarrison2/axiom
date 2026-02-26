'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { PlayerBoxscoreRow, GameLog } from '@/types';

/* ═══════════════════════════════════════════════════════
   Types
═══════════════════════════════════════════════════════ */

interface PIPlayer {
    name: string;
    team: string;
    position: string;
    is_forward: boolean;
    games_played: number;
    ev_toi_per_game: number;
    pp_toi_per_game: number;
    pk_toi_per_game: number;
    relative_xgf_pct: number;
    onice_xgf_pct: number;
    ev_xgf_per60: number;
    ev_xga_per60: number;
    ev_net_per60: number;
    ind_xg_per60: number;
    pp_xgf_per60: number;
    pk_xga_per60: number;
    penalty_diff_per60: number;
    game_score: number;
    total_sog: number;
    total_shot_attempts: number;
}

type PIDict = Record<string, PIPlayer>;
type PoolDict = Record<string, number[]>;

// Metadata for one team game (passed to availability strip)
interface TeamGameSlot {
    gid: string;
    date: string;       // "2025-10-14"
    gameNum: number;    // 1 = season opener
    homeAway: string;   // "Home" | "Away"
    opponent: string;   // common name e.g. "Jets"
    result: string;     // "W", "W (OT)", "OTL", "L"
    gf: number;
    ga: number;
}

interface AggPlayer {
    id: string;
    pi: PIPlayer;
    jerseyNum: number;
    // Season totals (from boxscores for this team)
    g: number;
    a: number;
    pts: number;
    shots: number;
    gp: number;
    total_toi_sec: number;
    // Derived
    sh_pct: number;
    sog_pg: number;
    toi_pg_str: string;
    gs_pg: number;
    played_ids: Set<string>;
}

/* ═══════════════════════════════════════════════════════
   Pure helpers
═══════════════════════════════════════════════════════ */

function parseToi(s: string): number {
    if (!s) return 0;
    const [m = '0', ss = '0'] = s.split(':');
    return parseInt(m) * 60 + parseInt(ss);
}

function fmtToi(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function pctile(val: number, pool: number[], hiGood = true): number {
    if (!pool.length) return 50;
    const below = pool.filter(x => x < val).length;
    const raw = (below / pool.length) * 100;
    return hiGood ? raw : 100 - raw;
}

function pctColor(p: number): string {
    if (p >= 90) return '#38bdf8'; // sky-400
    if (p >= 80) return '#3b82f6'; // blue-500
    if (p >= 70) return '#14b8a6'; // teal-500
    if (p >= 55) return '#22c55e'; // green-500
    if (p >= 45) return '#71717a'; // zinc-500
    if (p >= 30) return '#f59e0b'; // amber-500
    if (p >= 20) return '#f97316'; // orange-500
    if (p >= 10) return '#ef4444'; // red-500
    return '#991b1b';               // red-800
}

/* ═══════════════════════════════════════════════════════
   StatCell
═══════════════════════════════════════════════════════ */

function StatCell({ val, label, pct }: { val: string; label: string; pct: number }) {
    const c = pctColor(pct);
    return (
        <div
            className="flex flex-col items-center justify-center rounded-md px-1 py-[5px] gap-[3px] text-center"
            style={{ background: `${c}20`, border: `1px solid ${c}40` }}
        >
            <span
                className="text-[10.5px] font-bold tabular-nums leading-none"
                style={{ color: c }}
            >
                {val}
            </span>
            <span className="text-[7px] font-medium text-zinc-500 uppercase tracking-wide leading-none whitespace-nowrap">
                {label}
            </span>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════
   AvailStrip — 82-game season availability indicator
   • white  = player played
   • orange = team played, player did not
   • dark   = future game
   Hover each bar for date / game# / opponent tooltip
═══════════════════════════════════════════════════════ */

function fmtShortDate(s: string): string {
    // "2025-10-14" → "Oct 14"
    const d = new Date(s + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface TooltipState {
    slot: TeamGameSlot;
    played: boolean;
    x: number;
    y: number;
}

function AvailTooltip({ tt }: { tt: TooltipState }) {
    if (typeof document === 'undefined') return null;
    const W = 190;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const left = Math.max(8, Math.min(tt.x - W / 2, vw - W - 8));
    const top  = tt.y > 70 ? tt.y - 58 : tt.y + 14;
    const loc  = tt.slot.homeAway === 'Home' ? 'vs' : '@';
    const resultColor = tt.slot.result.startsWith('W') ? '#4ade80'
                      : tt.slot.result === 'OTL' || tt.slot.result === 'SOL' ? '#fb923c'
                      : '#f87171';

    return createPortal(
        <div
            style={{ position: 'fixed', left, top, width: W, zIndex: 9999, pointerEvents: 'none' }}
            className="bg-zinc-950 border border-white/15 rounded-lg px-2.5 py-2 shadow-xl text-[11px] leading-snug"
        >
            <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-zinc-400 font-mono font-medium">Game {tt.slot.gameNum}</span>
                <span className="text-zinc-500">{fmtShortDate(tt.slot.date)}</span>
            </div>
            <div className="text-white font-semibold mb-1">
                <span className="text-zinc-500 mr-1">{loc}</span>
                {tt.slot.opponent}
            </div>
            <div className="flex items-center gap-1.5">
                <span style={{ color: tt.played ? '#4ade80' : '#fb923c' }}>
                    {tt.played ? '✓ Played' : '✗ Missed'}
                </span>
                {tt.slot.result && (
                    <>
                        <span className="text-zinc-600">·</span>
                        <span style={{ color: resultColor }}>{tt.slot.result}</span>
                        <span className="text-zinc-400">{tt.slot.gf}–{tt.slot.ga}</span>
                    </>
                )}
            </div>
        </div>,
        document.body
    );
}

function AvailStrip({ teamGames, playedIds }: { teamGames: TeamGameSlot[]; playedIds: Set<string> }) {
    const [tt, setTt] = useState<TooltipState | null>(null);

    // 82 total slots: played games + future placeholders
    const slots: (TeamGameSlot | null)[] = [
        ...teamGames,
        ...Array.from({ length: Math.max(0, 82 - teamGames.length) }, () => null),
    ];

    const half = Math.ceil(slots.length / 2);
    const rows = [slots.slice(0, half), slots.slice(half)];

    const barStyle = (slot: TeamGameSlot | null, played: boolean) => {
        if (!slot)   return { bg: '#27272a', op: 0.5 };
        if (played)  return { bg: '#d4d4d8', op: 0.88 };
        return             { bg: '#fb923c', op: 0.70 };
    };

    return (
        <div className="flex flex-col gap-[2px] w-full">
            {rows.map((row, ri) => (
                <div key={ri} style={{ display: 'flex', width: '100%', gap: 1 }}>
                    {row.map((slot, ci) => {
                        const played = slot ? playedIds.has(slot.gid) : false;
                        const { bg, op } = barStyle(slot, played);
                        return (
                            <div
                                key={ci}
                                style={{ flex: 1, height: 5, borderRadius: 1, backgroundColor: bg, opacity: op }}
                                onMouseEnter={e => slot && setTt({ slot, played, x: e.clientX, y: e.clientY })}
                                onMouseMove={e  => slot && setTt(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                                onMouseLeave={() => setTt(null)}
                            />
                        );
                    })}
                </div>
            ))}
            {tt && <AvailTooltip tt={tt} />}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════
   SkaterCard
═══════════════════════════════════════════════════════ */

interface SkaterCardProps {
    player: AggPlayer;
    teamGames: TeamGameSlot[];
    pool: PoolDict;
}

function SkaterCard({ player, teamGames, pool }: SkaterCardProps) {
    const { pi } = player;

    // Percentile helper for this player's position group
    const pr = (val: number, key: string, hi = true) =>
        pctile(val, pool[key] ?? [], hi);

    // Impact badge
    const gsPct = pr(player.gs_pg, 'gs_pg');
    const impC = pctColor(gsPct);
    const gsSign = player.gs_pg >= 0 ? '+' : '';

    // relative_xgf_pct — convert to percentage points for display
    const relVal = pi.relative_xgf_pct * 100;
    const relStr = (relVal >= 0 ? '+' : '') + relVal.toFixed(1);

    // Stat grid definition
    const stats: Array<{ val: string; label: string; pct: number }> = [
        {
            val: pi.ev_xgf_per60.toFixed(2),
            label: 'xGF/60',
            pct: pr(pi.ev_xgf_per60, 'ev_xgf_per60'),
        },
        {
            val: pi.ev_xga_per60.toFixed(2),
            label: 'xGA/60',
            pct: pr(pi.ev_xga_per60, 'ev_xga_per60', false), // lower is better
        },
        {
            val: (pi.onice_xgf_pct * 100).toFixed(1) + '%',
            label: 'xG%',
            pct: pr(pi.onice_xgf_pct, 'onice_xgf_pct'),
        },
        {
            val: pi.ind_xg_per60.toFixed(2),
            label: 'iXG/60',
            pct: pr(pi.ind_xg_per60, 'ind_xg_per60'),
        },
        {
            val: pi.pp_xgf_per60.toFixed(2),
            label: 'PP xGF',
            pct: pr(pi.pp_xgf_per60, 'pp_xgf_per60'),
        },
        {
            val: (pi.penalty_diff_per60 >= 0 ? '+' : '') + pi.penalty_diff_per60.toFixed(2),
            label: 'Pen±',
            pct: pr(pi.penalty_diff_per60, 'penalty_diff_per60'),
        },
        {
            val: pi.ev_net_per60.toFixed(2),
            label: 'Net/60',
            pct: pr(pi.ev_net_per60, 'ev_net_per60'),
        },
        {
            val: relStr,
            label: 'Rel%',
            pct: pr(pi.relative_xgf_pct, 'relative_xgf_pct'),
        },
        {
            val: pi.pk_xga_per60.toFixed(2),
            label: 'PK xGA',
            pct: pr(pi.pk_xga_per60, 'pk_xga_per60', false), // lower is better
        },
    ];

    return (
        <div className="bg-zinc-900/70 border border-white/[0.07] rounded-xl p-3 flex flex-col gap-2.5 hover:border-white/[0.14] hover:bg-zinc-900 transition-all duration-150">

            {/* ── Header: name + impact badge ── */}
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="shrink-0 text-[8px] font-bold px-1.5 py-[3px] rounded bg-white/[0.08] text-zinc-400 uppercase tracking-wide">
                            {pi.position}
                        </span>
                        <span className="text-[13px] font-bold text-white leading-tight truncate">
                            {pi.name}
                        </span>
                    </div>
                    {player.jerseyNum > 0 && (
                        <span className="text-[9px] text-zinc-600">#{player.jerseyNum}</span>
                    )}
                </div>

                {/* GS/G impact badge */}
                <div
                    className="shrink-0 flex flex-col items-center rounded-lg px-2.5 py-1.5"
                    style={{ background: `${impC}22`, border: `1px solid ${impC}44` }}
                >
                    <span
                        className="text-[14px] font-black tabular-nums leading-none"
                        style={{ color: impC }}
                    >
                        {gsSign}{player.gs_pg.toFixed(2)}
                    </span>
                    <span className="text-[6.5px] text-zinc-500 uppercase tracking-widest mt-[2px]">GS/G</span>
                </div>
            </div>

            {/* ── Standard stats row (raw numbers, no color) ── */}
            <div className="grid grid-cols-6 gap-0.5 text-center">
                {(
                    [
                        [player.gp,               'GP'],
                        [player.g,                'G'],
                        [player.a,                'A'],
                        [player.pts,              'Pts'],
                        [player.sog_pg.toFixed(1),'SOG'],
                        [player.toi_pg_str,       'TOI'],
                    ] as [string | number, string][]
                ).map(([v, l]) => (
                    <div key={l} className="flex flex-col items-center gap-[2px]">
                        <span className="text-[12px] font-bold text-white tabular-nums leading-none">{v}</span>
                        <span className="text-[7px] text-zinc-500 uppercase tracking-wider leading-none">{l}</span>
                    </div>
                ))}
            </div>

            {/* ── Advanced stat grid (3 × 3, percentile-colored) ── */}
            <div className="grid grid-cols-3 gap-[5px]">
                {stats.map(s => (
                    <StatCell key={s.label} val={s.val} label={s.label} pct={s.pct} />
                ))}
            </div>

            {/* ── TOI breakdown ── */}
            <div className="flex items-center justify-between text-[8.5px] text-zinc-500 px-0.5">
                <span>
                    EV&nbsp;
                    <span className="text-zinc-300 font-mono font-medium">{fmtToi(pi.ev_toi_per_game)}</span>
                </span>
                <span className="text-zinc-700">·</span>
                <span>
                    PP&nbsp;
                    <span className="text-zinc-300 font-mono font-medium">{fmtToi(pi.pp_toi_per_game)}</span>
                </span>
                <span className="text-zinc-700">·</span>
                <span>
                    PK&nbsp;
                    <span className="text-zinc-300 font-mono font-medium">{fmtToi(pi.pk_toi_per_game)}</span>
                </span>
            </div>

            {/* ── Availability strip ── */}
            <AvailStrip teamGames={teamGames} playedIds={player.played_ids} />
        </div>
    );
}

/* ═══════════════════════════════════════════════════════
   SkaterGrid — main exported component
═══════════════════════════════════════════════════════ */

interface SkaterGridProps {
    playerStats: PlayerBoxscoreRow[];
    games: GameLog[];
    teamAbbr: string;
}

export default function SkaterGrid({ playerStats, games, teamAbbr }: SkaterGridProps) {
    const [piData, setPiData] = useState<PIDict | null>(null);
    const [posFilter, setPosFilter] = useState<'all' | 'f' | 'd'>('all');
    const [sortBy, setSortBy] = useState<'impact' | 'pts' | 'toi'>('impact');

    // Load league-wide player impact data
    useEffect(() => {
        fetch('/data/player_impact.json')
            .then(r => r.json())
            .then(setPiData)
            .catch(console.error);
    }, []);

    // Chronologically ordered game slots (for the availability strip + tooltip)
    const teamGames = useMemo<TeamGameSlot[]>(
        () =>
            [...games]
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map(g => ({
                    gid:      g.game_id,
                    date:     g.date,
                    gameNum:  g.game_number,
                    homeAway: g.home_away,
                    opponent: g.opponent,
                    result:   g.result,
                    gf:       g.gf,
                    ga:       g.ga,
                })),
        [games]
    );

    // Aggregate per-player boxscore totals for this team
    const boxMap = useMemo(() => {
        const m = new Map<string, {
            g: number; a: number; pts: number; shots: number;
            toi_sec: number; gp: number; jerseyNum: number;
            played_ids: Set<string>;
        }>();
        for (const row of playerStats) {
            if (Number(row.is_goalie)) continue;
            const id = String(row.player_id);
            if (!m.has(id)) {
                m.set(id, { g: 0, a: 0, pts: 0, shots: 0, toi_sec: 0, gp: 0, jerseyNum: 0, played_ids: new Set() });
            }
            const acc = m.get(id)!;
            acc.g      += Number(row.goals)   || 0;
            acc.a      += Number(row.assists)  || 0;
            acc.pts    += Number(row.points)   || 0;
            acc.shots  += Number(row.shots)    || 0;
            acc.toi_sec += parseToi(row.toi);
            acc.gp++;
            acc.jerseyNum = Number(row.number) || acc.jerseyNum;
            acc.played_ids.add(String(row.game_id));
        }
        return m;
    }, [playerStats]);

    // Build league-wide percentile pools, split by position group
    const pools = useMemo(() => {
        if (!piData) return null;

        const fwds = Object.values(piData).filter(p => p.is_forward && p.games_played >= 5);
        const defs = Object.values(piData).filter(p => !p.is_forward && p.position !== 'G' && p.games_played >= 5);

        const nums = (arr: PIPlayer[], k: keyof PIPlayer) => arr.map(p => Number(p[k]));

        const build = (arr: PIPlayer[]): PoolDict => ({
            ev_xgf_per60:       nums(arr, 'ev_xgf_per60'),
            ev_xga_per60:       nums(arr, 'ev_xga_per60'),
            onice_xgf_pct:      nums(arr, 'onice_xgf_pct'),
            ind_xg_per60:       nums(arr, 'ind_xg_per60'),
            pp_xgf_per60:       nums(arr, 'pp_xgf_per60'),
            pk_xga_per60:       nums(arr, 'pk_xga_per60'),
            penalty_diff_per60: nums(arr, 'penalty_diff_per60'),
            ev_net_per60:       nums(arr, 'ev_net_per60'),
            relative_xgf_pct:   nums(arr, 'relative_xgf_pct'),
            ev_toi_per_game:    nums(arr, 'ev_toi_per_game'),
            gs_pg: arr.map(p => p.games_played > 0 ? p.game_score / p.games_played : 0),
        });

        return { fwd: build(fwds), def: build(defs) };
    }, [piData]);

    // Enrich: join player_impact with boxscore aggregates
    const allPlayers = useMemo<AggPlayer[]>(() => {
        if (!piData) return [];

        const result: AggPlayer[] = [];
        for (const [id, pi] of Object.entries(piData)) {
            if (pi.team !== teamAbbr) continue;
            if (pi.position === 'G') continue;
            if (pi.games_played < 5) continue;

            const bs = boxMap.get(id);
            const gp     = bs?.gp ?? pi.games_played;
            const g      = bs?.g  ?? 0;
            const a      = bs?.a  ?? 0;
            const pts    = bs?.pts ?? 0;
            const shots  = bs?.shots ?? 0; // kept for sh_pct; note: CSV shots column is unreliable
            // Total TOI seconds (for sort-by-TOI); fallback to player_impact sum
            const total_toi_sec = bs
                ? bs.toi_sec
                : (pi.ev_toi_per_game + pi.pp_toi_per_game + pi.pk_toi_per_game) * pi.games_played;

            // Use MoneyPuck season totals for SOG (player_stats CSV shots field is always 0)
            const sog_season = pi.total_sog ?? 0;
            const sog_pg     = pi.games_played > 0 ? sog_season / pi.games_played : 0;

            const sh_pct    = sog_season > 0 ? (g / sog_season) * 100 : 0;
            const toi_pg_str = gp > 0
                ? fmtToi(total_toi_sec / gp)
                : fmtToi(pi.ev_toi_per_game + pi.pp_toi_per_game + pi.pk_toi_per_game);
            const gs_pg = pi.games_played > 0 ? pi.game_score / pi.games_played : 0;

            result.push({
                id, pi,
                jerseyNum: bs?.jerseyNum ?? 0,
                g, a, pts, shots, gp,
                total_toi_sec, sh_pct, sog_pg,
                toi_pg_str, gs_pg,
                played_ids: bs?.played_ids ?? new Set(),
            });
        }
        return result;
    }, [piData, boxMap, teamAbbr]);

    // Apply filter + sort (cheap op — separate from heavy enrichment)
    const players = useMemo(() => {
        const filtered = allPlayers.filter(p => {
            if (posFilter === 'f') return p.pi.is_forward;
            if (posFilter === 'd') return !p.pi.is_forward;
            return true;
        });
        return filtered.sort((a, b) => {
            if (sortBy === 'pts') return b.pts - a.pts;
            if (sortBy === 'toi') return b.total_toi_sec - a.total_toi_sec;
            return b.gs_pg - a.gs_pg; // 'impact' default
        });
    }, [allPlayers, posFilter, sortBy]);

    /* ── Render ─────────────────────────────────────── */

    if (!piData || !pools) {
        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-72 rounded-xl bg-zinc-900/50 animate-pulse" />
                ))}
            </div>
        );
    }

    const LEGEND: [string, string][] = [
        ['≤10',   '#991b1b'],
        ['10-20', '#ef4444'],
        ['20-30', '#f97316'],
        ['30-45', '#f59e0b'],
        ['45-55', '#71717a'],
        ['55-70', '#22c55e'],
        ['70-80', '#14b8a6'],
        ['80-90', '#3b82f6'],
        ['>90',   '#38bdf8'],
    ];

    return (
        <div className="flex flex-col gap-4">

            {/* ── Controls + Legend ── */}
            <div className="flex flex-wrap items-center gap-2">

                {/* Position filter */}
                <div className="flex items-center bg-zinc-900/80 border border-white/[0.08] rounded-lg p-0.5">
                    {(['all', 'f', 'd'] as const).map(pos => (
                        <button
                            key={pos}
                            onClick={() => setPosFilter(pos)}
                            className={`px-3 py-1 rounded-md text-[10.5px] font-bold uppercase tracking-wider transition-colors ${
                                posFilter === pos
                                    ? 'bg-white/15 text-white'
                                    : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                        >
                            {pos === 'all' ? 'All' : pos === 'f' ? 'Fwd' : 'Def'}
                        </button>
                    ))}
                </div>

                {/* Sort order */}
                <div className="flex items-center bg-zinc-900/80 border border-white/[0.08] rounded-lg p-0.5">
                    {([['impact', 'Impact'], ['pts', 'Points'], ['toi', 'TOI']] as const).map(([val, label]) => (
                        <button
                            key={val}
                            onClick={() => setSortBy(val)}
                            className={`px-3 py-1 rounded-md text-[10.5px] font-bold uppercase tracking-wider transition-colors ${
                                sortBy === val
                                    ? 'bg-white/15 text-white'
                                    : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* Percentile legend */}
                <div className="flex items-center gap-[3px] ml-auto flex-wrap">
                    {LEGEND.map(([label, color]) => (
                        <div
                            key={label}
                            className="text-[7.5px] font-bold px-1.5 py-[3px] rounded leading-none"
                            style={{
                                backgroundColor: `${color}30`,
                                color,
                                border: `1px solid ${color}50`,
                            }}
                        >
                            {label}
                        </div>
                    ))}
                </div>
            </div>

            {/* Availability strip legend (shown once, above grid) */}
            <div className="flex items-center gap-4 text-[8px] text-zinc-500">
                <span className="uppercase tracking-wider text-zinc-600 font-medium">Availability:</span>
                {[
                    { bg: '#d4d4d8', op: 0.88, label: 'Played' },
                    { bg: '#fb923c', op: 0.7,  label: 'Missed' },
                    { bg: '#27272a', op: 0.5,  label: 'Future game' },
                ].map(({ bg, op, label }) => (
                    <div key={label} className="flex items-center gap-1.5">
                        <div
                            className="rounded-[1px]"
                            style={{ width: 14, height: 5, backgroundColor: bg, opacity: op }}
                        />
                        <span>{label}</span>
                    </div>
                ))}
            </div>

            {/* ── Player card grid ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {players.map(p => (
                    <SkaterCard
                        key={p.id}
                        player={p}
                        teamGames={teamGames}
                        pool={p.pi.is_forward ? pools.fwd : pools.def}
                    />
                ))}
            </div>

            {players.length === 0 && (
                <div className="text-center text-zinc-500 font-mono text-sm py-16">
                    No qualifying skaters found.
                </div>
            )}

        </div>
    );
}
