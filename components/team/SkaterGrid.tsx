'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { PlayerBoxscoreRow, GameLog, TeamLineup } from '@/types';
import { TEAM_COLORS } from '@/utils/team-colors';

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

interface PlayerBio {
    age: number | null;
    height: string | null;  // e.g. "6'1\""
    weight: number | null;  // pounds
    shoots: string | null;  // "L" | "R"
}
type BioDict = Record<string, PlayerBio>;

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
    ixg_share_pct: number;   // player's EV iXG as % of team total EV iXG
    played_toi: Map<string, number>; // game_id → toi seconds (>0 means played)
    other_team_dates: Map<string, string>; // date → tricode (games played for another team)
    bio: PlayerBio | null;
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
    // Red (#BD0000) → Grey (#D2D2D2) → Blue (#1084FE)
    const t = Math.max(0, Math.min(100, p)) / 100;
    let r, g, b;
    if (t <= 0.5) {
        const s = t * 2;
        r = Math.round(189 + (210 - 189) * s);
        g = Math.round(0   + (210 - 0)   * s);
        b = Math.round(0   + (210 - 0)   * s);
    } else {
        const s = (t - 0.5) * 2;
        r = Math.round(210 + (16  - 210) * s);
        g = Math.round(210 + (132 - 210) * s);
        b = Math.round(210 + (254 - 210) * s);
    }
    return `rgb(${r},${g},${b})`;
}

/* ═══════════════════════════════════════════════════════
   Position accent colours
═══════════════════════════════════════════════════════ */

function posAccent(pos: string): { text: string; bg: string } {
    switch (pos.toUpperCase()) {
        case 'C': return { text: '#38bdf8', bg: 'rgba(56,189,248,0.13)' }; // sky
        case 'LW': return { text: '#34d399', bg: 'rgba(52,211,153,0.13)' }; // emerald
        case 'RW': return { text: '#fb923c', bg: 'rgba(251,146,60,0.13)' }; // orange
        case 'D': return { text: '#a78bfa', bg: 'rgba(167,139,250,0.13)' }; // violet
        default: return { text: '#94a3b8', bg: 'rgba(148,163,184,0.13)' };
    }
}

/* ═══════════════════════════════════════════════════════
   StatCell — clean top-border indicator style
═══════════════════════════════════════════════════════ */

function StatCell({ val, label, pct, blank, color }: {
    val?: string; label?: string; pct?: number; blank?: boolean; color?: string;
}) {
    if (blank) return <div className="px-2 py-[5px]" />;
    const c = color ?? pctColor(pct ?? 50);
    return (
        <div className="grid grid-cols-2 items-baseline px-2 py-[5px]">
            <span className="text-right text-[13px] font-bold tabular-nums leading-none pr-1" style={{ color: c }}>
                {val}
            </span>
            <span className="text-left text-[9px] font-bold text-zinc-500 uppercase tracking-widest leading-none whitespace-nowrap">
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
    otherTeam: string | null; // tricode if played for another team that day
    x: number;
    y: number;
}

function AvailTooltip({ tt }: { tt: TooltipState }) {
    if (typeof document === 'undefined') return null;
    const W = 190;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const left = Math.max(8, Math.min(tt.x - W / 2, vw - W - 8));
    const top = tt.y > 70 ? tt.y - 58 : tt.y + 14;
    const loc = tt.slot.homeAway === 'Home' ? 'vs' : '@';
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
                <span style={{ color: tt.played ? '#4ade80' : tt.otherTeam ? '#a78bfa' : '#fb923c' }}>
                    {tt.played ? '✓ Played' : tt.otherTeam ? `⇄ ${tt.otherTeam}` : '✗ Missed'}
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

function AvailStrip({ teamGames, playedToi, otherTeamDates }: {
    teamGames: TeamGameSlot[];
    playedToi: Map<string, number>;
    otherTeamDates: Map<string, string>; // date → tricode
}) {
    const [tt, setTt] = useState<TooltipState | null>(null);

    // 82 total slots: played games + future placeholders
    const slots: (TeamGameSlot | null)[] = [
        ...teamGames,
        ...Array.from({ length: Math.max(0, 82 - teamGames.length) }, () => null),
    ];

    const half = Math.ceil(slots.length / 2);
    const rows = [slots.slice(0, half), slots.slice(half)];

    const barStyle = (slot: TeamGameSlot | null, played: boolean, otherTeam: string | null) => {
        if (!slot) return { bg: '#27272a', op: 0.5 };
        if (played) return { bg: '#d4d4d8', op: 0.88 };
        if (otherTeam) return { bg: '#a78bfa', op: 0.75 }; // purple = active, just on another team
        return { bg: '#fb923c', op: 0.70 };
    };

    return (
        <div className="flex flex-col gap-[2px] w-full">
            {rows.map((row, ri) => (
                <div key={ri} style={{ display: 'flex', width: '100%', gap: 1 }}>
                    {row.map((slot, ci) => {
                        const played = slot ? (playedToi.get(slot.gid) ?? 0) > 0 : false;
                        const otherTeam = (!played && slot) ? (otherTeamDates.get(slot.date) ?? null) : null;
                        const { bg, op } = barStyle(slot, played, otherTeam);
                        return (
                            <div
                                key={ci}
                                style={{ flex: 1, height: 6, borderRadius: 2, backgroundColor: bg, opacity: op }}
                                onMouseEnter={e => slot && setTt({ slot, played, otherTeam, x: e.clientX, y: e.clientY })}
                                onMouseMove={e => slot && setTt(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
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
   Ordinal suffix helper (1st, 2nd, 3rd, 4th…)
═══════════════════════════════════════════════════════ */

function ordinalSuffix(n: number): string {
    const abs = Math.abs(Math.round(n));
    const mod100 = abs % 100;
    if (mod100 >= 11 && mod100 <= 13) return 'th';
    switch (abs % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

/* ═══════════════════════════════════════════════════════
   iXG% colour helper (player share of team EV iXG)
   Thresholds loosely: top quarterbacks ~15%+, role players ~2-5%
═══════════════════════════════════════════════════ */

function ixgShareColor(pct: number): string {
    return pctColor(pct);
}

/* TOI ratio colour  (grey → yellow → bright blue):
   ratio = player_toi / team_total_toi (0.0 to ~0.45)
   e.g. 36% for a top-line 15-min EV player on a ~42-min team
   ~20% = average player, 35%+ = elite usage              */
function toiRatioColor(ratio: number): string {
    if (ratio >= 0.35) return '#38bdf8'; // sky-400  (elite usage, top line)
    if (ratio >= 0.25) return '#60a5fa'; // blue-400 (2nd-line calibre)
    if (ratio >= 0.15) return '#fbbf24'; // amber-400 (avg / 3rd line)
    if (ratio >= 0.08) return '#d97706'; // amber-600 (limited role)
    return '#52525b';                    // zinc-600  (rarely plays)
}

/* ═══════════════════════════════════════════════════════
   StubSkaterCard — shown for lineup players with no piData yet
═══════════════════════════════════════════════════════ */

// Map DailyFaceoff position codes → MoneyPuck-style display position
function dfoPosToPiPos(pos: string): string {
    const p = pos.toLowerCase();
    if (p === 'lw' || p === 'l') return 'L';
    if (p === 'rw' || p === 'r') return 'R';
    if (p === 'c') return 'C';
    return 'D'; // ld, rd, d
}

function StubSkaterCard({ name, pos, jerseyNum, team }: {
    name: string;
    pos: string;
    jerseyNum: number;
    team: string;
}) {
    const piPos  = dfoPosToPiPos(pos);
    const posC   = posAccent(piPos);
    const lastName = name.split(' ').at(-1) ?? name;
    void lastName;

    return (
        <div
            className="flex flex-col rounded-xl overflow-hidden border border-white/[0.04] opacity-50"
            style={{ background: '#111113' }}
        >
            {/* Top section */}
            <div
                className="relative flex flex-row items-stretch overflow-hidden shrink-0"
                style={{ background: '#0d0d0f', minHeight: 92 }}
            >
                {/* Dim top-edge line */}
                <div className="absolute inset-x-0 top-0 h-[2px] pointer-events-none z-20 bg-white/5" />

                {/* Identity */}
                <div className="flex flex-col justify-center gap-[5px] min-w-0 flex-1 z-10 pt-4 pb-2 px-3">
                    <span className="text-[20px] font-black text-zinc-400 leading-none tracking-tight truncate">
                        {name}
                    </span>
                    <div className="flex items-center gap-2">
                        <span
                            className="shrink-0 text-[8px] font-black px-[7px] py-[3px] rounded-md uppercase tracking-wider leading-none"
                            style={{ color: posC.text, background: posC.bg, opacity: 0.6 }}
                        >
                            {piPos}
                        </span>
                        {jerseyNum > 0 && (
                            <span className="text-[11px] font-mono text-zinc-600 leading-none">#{jerseyNum}</span>
                        )}
                    </div>
                </div>

                {/* Impact box — greyed out 0.00 */}
                <div className="flex flex-col items-end justify-start gap-[4px] pr-2.5 pl-1 shrink-0 z-10 pt-2 pb-1">
                    <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest leading-none">Impact</span>
                    <div
                        className="flex items-center justify-center rounded-md px-2 py-1"
                        style={{ background: '#27272a', minWidth: 52 }}
                    >
                        <span className="text-[19px] font-black tabular-nums leading-none text-zinc-600">0.00</span>
                    </div>
                    <span className="text-[10px] font-bold leading-none tabular-nums text-zinc-700">—</span>
                </div>
            </div>

            {/* Body */}
            <div className="px-3 pt-1.5 pb-3 flex flex-col gap-2">
                {/* Counting stats — all dashes */}
                <div className="grid grid-cols-6 gap-0.5 text-center">
                    {(['GP','G','A','Pts','SOG','TOI'] as string[]).map(l => (
                        <div key={l} className="flex flex-col items-center gap-[2px]">
                            <span className="text-[16px] font-bold text-zinc-700 tabular-nums leading-none">—</span>
                            <span className="text-[7.5px] text-zinc-700 uppercase tracking-wider leading-none">{l}</span>
                        </div>
                    ))}
                </div>

                <div className="h-px" style={{ background: 'rgba(255,255,255,0.03)' }} />

                {/* "No data" notice */}
                <div className="flex items-center justify-center py-2">
                    <span className="text-[9px] font-medium text-zinc-700 uppercase tracking-widest">
                        Awaiting MoneyPuck data
                    </span>
                </div>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════
   SkaterCard
═══════════════════════════════════════════════════════ */

interface TeamToiAvgs {
    ev: number; // seconds
    pp: number; // seconds (among PP-qualified players only)
    pk: number; // seconds (among PK-qualified players only)
}

interface SkaterCardProps {
    player: AggPlayer;
    teamGames: TeamGameSlot[];
    pool: PoolDict;
    teamToiAvgs: TeamToiAvgs;
}

function SkaterCard({ player, teamGames, pool, teamToiAvgs }: SkaterCardProps) {
    const { pi } = player;

    // Percentile helper
    const pr = (val: number, key: string, hi = true) =>
        pctile(val, pool[key] ?? [], hi);

    // Impact
    const gsPct = pr(player.gs_pg, 'gs_pg');
    const impC = pctColor(gsPct);
    const gsSign = player.gs_pg >= 0 ? '+' : '';
    const pRank = Math.round(gsPct);

    // Relative xGF
    const relVal = pi.relative_xgf_pct * 100;
    const relStr = (relVal >= 0 ? '+' : '') + relVal.toFixed(1);

    // Position accent
    const posC = posAccent(pi.position);

    // Headshot — season-specific transparent-bg PNG from NHL CDN
    const headshot = `https://assets.nhle.com/mugs/nhl/20252026/${pi.team}/${player.id}.png`;

    // Advanced stat grid — new column order
    // Col 1: xGF/60 | xGA/60 | xG%
    // Col 2: PP xGF% (if qualified) | PK xGA% (if qualified) | Pen±
    // Col 3: iXG/60 | Rel% | iXG%
    const ppQualified = pi.pp_toi_per_game >= 60; // >= 1 min avg PP TOI
    const pkQualified = pi.pk_toi_per_game >= 60; // >= 1 min avg PK TOI

    const ppPct = ppQualified ? Math.round(pr(pi.pp_xgf_per60, 'pp_xgf_per60_qual')) : 0;
    const pkPct = pkQualified ? Math.round(pr(pi.pk_xga_per60, 'pk_xga_per60_qual', false)) : 0;

    // iXG%: this player's share of their team's total EV individual xG
    // Percentile rank among all team skaters (higher = bigger contributor)
    const ixgShareTeamArr = [player.ixg_share_pct]; // placeholder — color by value threshold
    const ixgShareC = ixgShareColor(
        player.ixg_share_pct >= 14 ? 95 :
            player.ixg_share_pct >= 11 ? 85 :
                player.ixg_share_pct >= 8 ? 75 :
                    player.ixg_share_pct >= 5 ? 60 :
                        player.ixg_share_pct >= 3 ? 48 :
                            player.ixg_share_pct >= 1.5 ? 32 : 18
    );
    void ixgShareTeamArr; // suppress unused warning

    return (
        <div
            className="flex flex-col rounded-xl overflow-hidden border border-white/[0.07] hover:border-white/[0.13] transition-all duration-150 group"
            style={{ background: '#111113' }}
        >
            {/* ══════════════════════════════════════════════
                SECTION 1 — headshot + identity + Impact
            ══════════════════════════════════════════════ */}
            <div
                className="relative flex flex-row items-stretch overflow-hidden shrink-0"
                style={{ background: '#0d0d0f', minHeight: 92 }}
            >
                {/* Coloured top-edge line */}
                <div
                    className="absolute inset-x-0 top-0 h-[2px] pointer-events-none z-20"
                    style={{ background: `linear-gradient(90deg, ${TEAM_COLORS[pi.team] ?? impC}, transparent 70%)` }}
                />

                {/* ── LEFT: Headshot column ── */}
                <div className="relative shrink-0 z-0" style={{ width: 90 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={headshot}
                        alt=""
                        aria-hidden
                        loading="lazy"
                        className="absolute bottom-0 left-0 h-[135%] w-auto select-none pointer-events-none"
                        style={{ objectFit: 'contain', objectPosition: 'left bottom', opacity: 0.95 }}
                        onError={e => { (e.target as HTMLImageElement).style.opacity = '0'; }}
                    />
                    {/* Bottom fade */}
                    <div
                        className="absolute inset-x-0 bottom-0 h-6 pointer-events-none"
                        style={{ background: 'linear-gradient(to top, #0d0d0f 0%, transparent 100%)' }}
                    />
                </div>

                {/* ── MIDDLE: Identity block — overlaps headshot by 23px ── */}
                <div
                    className="flex flex-col justify-center gap-[5px] min-w-0 flex-1 z-10 pt-4 pb-2 pr-2"
                    style={{ marginLeft: -23 }}
                >
                    {/* Name */}
                    <span className="text-[20px] font-black text-white leading-none tracking-tight truncate drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
                        {pi.name}
                    </span>

                    {/* Position badge + Jersey # + Bio (same row) */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <span
                            className="shrink-0 text-[8px] font-black px-[7px] py-[3px] rounded-md uppercase tracking-wider leading-none"
                            style={{ color: posC.text, background: posC.bg }}
                        >
                            {pi.position}
                        </span>
                        <span className="text-[11px] font-mono text-zinc-400 leading-none">
                            {player.jerseyNum > 0 ? `#${player.jerseyNum}` : ''}
                        </span>
                        {player.bio?.age !== null && player.bio?.age !== undefined && (
                            <span className="text-[11px] font-medium leading-none tabular-nums" style={{ color: '#929292' }}>
                                {player.bio.age}yo
                            </span>
                        )}
                        {player.bio?.shoots && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                                src={`/stick-${player.bio.shoots.toLowerCase()}.png`}
                                alt={player.bio.shoots === 'L' ? 'Shoots Left' : 'Shoots Right'}
                                width={12}
                                height={12}
                                className="shrink-0 select-none"
                                style={{ opacity: 0.75 }}
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                        )}
                        {player.bio?.height && (
                            <span className="text-[11px] font-medium leading-none" style={{ color: '#929292' }}>
                                {player.bio.height}
                            </span>
                        )}
                        {player.bio?.weight !== null && player.bio?.weight !== undefined && (
                            <span className="text-[11px] font-medium leading-none tabular-nums" style={{ color: '#929292' }}>
                                {player.bio.weight}lb
                            </span>
                        )}
                    </div>
                </div>

                {/* ── RIGHT: Impact box ── */}
                <div className="flex flex-col items-end justify-start gap-[4px] pr-2.5 pl-1 shrink-0 z-10 pt-2 pb-1">
                    <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest leading-none">
                        Impact
                    </span>
                    <div
                        className="flex items-center justify-center rounded-md px-2 py-1"
                        style={{ background: impC, minWidth: 52 }}
                    >
                        <span className="text-[19px] font-black tabular-nums leading-none text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
                            {gsSign}{player.gs_pg.toFixed(2)}
                        </span>
                    </div>
                    <span className="text-[10px] font-bold leading-none tabular-nums" style={{ color: impC }}>
                        {pRank}{ordinalSuffix(pRank)}%
                    </span>
                </div>
            </div>

            {/* ══════════════════════════════════════════════
                BODY
            ══════════════════════════════════════════════ */}
            <div className="px-3 pt-1.5 pb-3 flex flex-col gap-2">

                {/* ── Standard counting stats ── */}
                <div className="grid grid-cols-6 gap-0.5 text-center">
                    {(
                        [
                            [player.gp, 'GP'],
                            [player.g, 'G'],
                            [player.a, 'A'],
                            [player.pts, 'Pts'],
                            [player.sog_pg.toFixed(1), 'SOG'],
                            [player.toi_pg_str, 'TOI'],
                        ] as [string | number, string][]
                    ).map(([v, l]) => (
                        <div key={l} className="flex flex-col items-center gap-[2px]">
                            <span className="text-[16px] font-bold text-white tabular-nums leading-none">{v}</span>
                            <span className="text-[7.5px] text-zinc-500 uppercase tracking-wider leading-none">{l}</span>
                        </div>
                    ))}
                </div>

                {/* ── Divider ── */}
                <div className="h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.05) 30%, rgba(255,255,255,0.05) 70%, transparent)' }} />

                {/* ── Advanced stat grid (3 rows × 3 cols) ── */}
                <div className="flex flex-col" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    {[
                        [
                            { val: pi.ev_xgf_per60.toFixed(2), label: 'xGF/60', pct: pr(pi.ev_xgf_per60, 'ev_xgf_per60') },
                            ppQualified ? { val: `${ppPct}%`, label: 'PP xGF', pct: ppPct } : null,
                            { val: pi.ind_xg_per60.toFixed(2), label: 'iXG/60', pct: pr(pi.ind_xg_per60, 'ind_xg_per60') },
                        ],
                        [
                            { val: pi.ev_xga_per60.toFixed(2), label: 'xGA/60', pct: pr(pi.ev_xga_per60, 'ev_xga_per60', false) },
                            pkQualified ? { val: `${pkPct}%`, label: 'PK xGA', pct: pkPct } : null,
                            { val: relStr, label: 'Rel%', pct: pr(pi.relative_xgf_pct, 'relative_xgf_pct') },
                        ],
                        [
                            { val: (pi.onice_xgf_pct * 100).toFixed(1) + '%', label: 'xG%', pct: pr(pi.onice_xgf_pct, 'onice_xgf_pct') },
                            { val: (pi.penalty_diff_per60 >= 0 ? '+' : '') + pi.penalty_diff_per60.toFixed(2), label: 'Pen±', pct: pr(pi.penalty_diff_per60, 'penalty_diff_per60') },
                            { val: player.ixg_share_pct.toFixed(1) + '%', label: 'iXG%', color: ixgShareC },
                        ],
                    ].map((row, ri) => (
                        <div key={ri} className="grid grid-cols-3" style={ri > 0 ? { borderTop: '1px solid rgba(255,255,255,0.05)' } : undefined}>
                            {row.map((cell, ci) => (
                                <div key={ci} style={ci > 0 ? { borderLeft: '1px solid rgba(255,255,255,0.05)' } : undefined}>
                                    {cell ? <StatCell val={cell.val} label={cell.label} pct={cell.pct} color={(cell as { color?: string }).color} /> : <StatCell blank />}
                                </div>
                            ))}
                        </div>
                    ))}
                </div>

                {/* ── TOI breakdown ── */}
                <div className="flex items-center justify-between px-1">
                    {[
                        { label: 'EV', toi: pi.ev_toi_per_game, avg: teamToiAvgs.ev },
                        { label: 'PP', toi: pi.pp_toi_per_game, avg: teamToiAvgs.pp },
                        { label: 'PK', toi: pi.pk_toi_per_game, avg: teamToiAvgs.pk },
                    ].map(({ label, toi, avg }) => {
                        const ratio = avg > 0 ? toi / avg : 0;
                        const pct = Math.round(ratio * 100);
                        return (
                            <div key={label} className="flex items-baseline gap-1">
                                <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest leading-none">{label}</span>
                                <span className="text-[12px] font-mono font-bold text-zinc-200 leading-none tabular-nums">{fmtToi(toi)}</span>
                                <span className="text-[9px] text-zinc-500 tabular-nums leading-none">{pct}%</span>
                            </div>
                        );
                    })}
                </div>

                {/* ── Availability strip ── */}
                <AvailStrip teamGames={teamGames} playedToi={player.played_toi} otherTeamDates={player.other_team_dates} />
            </div>
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
    lineup?: TeamLineup;
}

export default function SkaterGrid({ playerStats, games, teamAbbr, lineup }: SkaterGridProps) {
    const [piData, setPiData] = useState<PIDict | null>(null);
    const [bioData, setBioData] = useState<BioDict | null>(null);
    const [posFilter, setPosFilter] = useState<'all' | 'f' | 'd'>('all');
    const [sortBy, setSortBy] = useState<'impact' | 'pts' | 'toi' | 'lineup'>('lineup');

    // Load league-wide player impact data
    useEffect(() => {
        fetch('/data/player_impact.json')
            .then(r => r.json())
            .then(setPiData)
            .catch(console.error);
    }, []);

    // Load player bio data (age, height, weight, shoots)
    useEffect(() => {
        fetch('/data/player_bio.json')
            .then(r => r.json())
            .then(setBioData)
            .catch(console.error);
    }, []);

    // Chronologically ordered game slots (for the availability strip + tooltip)
    const teamGames = useMemo<TeamGameSlot[]>(
        () =>
            [...games]
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map(g => ({
                    gid: g.game_id,
                    date: g.date,
                    gameNum: g.game_number,
                    homeAway: g.home_away,
                    opponent: g.opponent,
                    result: g.result,
                    gf: g.gf,
                    ga: g.ga,
                })),
        [games]
    );

    // Aggregate per-player boxscore totals for this team
    const boxMap = useMemo(() => {
        const m = new Map<string, {
            g: number; a: number; pts: number; shots: number;
            toi_sec: number; gp: number; jerseyNum: number;
            played_toi: Map<string, number>; // game_id → toi seconds
            other_team_dates: Map<string, string>; // date → tricode
        }>();
        for (const row of playerStats) {
            if (Number(row.is_goalie)) continue;
            const id = String(row.player_id);
            if (!m.has(id)) {
                m.set(id, { g: 0, a: 0, pts: 0, shots: 0, toi_sec: 0, gp: 0, jerseyNum: 0, played_toi: new Map(), other_team_dates: new Map() });
            }
            const acc = m.get(id)!;
            const toiSec = parseToi(row.toi);
            const rowTeam = String(row.team ?? '').toUpperCase();

            if (rowTeam === teamAbbr.toUpperCase()) {
                // This team's game — count toward totals
                acc.g += Number(row.goals) || 0;
                acc.a += Number(row.assists) || 0;
                acc.pts += Number(row.points) || 0;
                acc.shots += Number(row.shots) || 0;
                acc.toi_sec += toiSec;
                acc.gp++;
                acc.jerseyNum = Number(row.number) || acc.jerseyNum;
                // Only count as "played" if TOI > 0
                const gid = String(row.game_id);
                acc.played_toi.set(gid, (acc.played_toi.get(gid) ?? 0) + toiSec);
            } else if (toiSec > 0) {
                // Different team — record date so availability strip can show it
                acc.other_team_dates.set(String(row.date), rowTeam);
            }
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
            ev_xgf_per60: nums(arr, 'ev_xgf_per60'),
            ev_xga_per60: nums(arr, 'ev_xga_per60'),
            onice_xgf_pct: nums(arr, 'onice_xgf_pct'),
            ind_xg_per60: nums(arr, 'ind_xg_per60'),
            pp_xgf_per60: nums(arr, 'pp_xgf_per60'),
            pk_xga_per60: nums(arr, 'pk_xga_per60'),
            penalty_diff_per60: nums(arr, 'penalty_diff_per60'),
            ev_net_per60: nums(arr, 'ev_net_per60'),
            relative_xgf_pct: nums(arr, 'relative_xgf_pct'),
            ev_toi_per_game: nums(arr, 'ev_toi_per_game'),
            gs_pg: arr.map(p => p.games_played > 0 ? p.game_score / p.games_played : 0),
            // PP/PK percentiles among qualified players only (>= 60s avg TOI)
            pp_xgf_per60_qual: arr.filter(p => p.pp_toi_per_game >= 60).map(p => p.pp_xgf_per60),
            pk_xga_per60_qual: arr.filter(p => p.pk_toi_per_game >= 60).map(p => p.pk_xga_per60),
        });

        return { fwd: build(fwds), def: build(defs) };
    }, [piData]);

    // Enrich: join player_impact with boxscore aggregates
    const allPlayers = useMemo<AggPlayer[]>(() => {
        if (!piData) return [];
        // bioData may still be loading — fall back to null gracefully

        // First pass: compute team total EV iXG for the iXG% metric
        const teamTotalIxg = Object.entries(piData)
            .filter(([, pi]) => pi.team === teamAbbr && pi.position !== 'G' && pi.games_played >= 5)
            .reduce((sum, [, pi]) => {
                const playerIxg = pi.ind_xg_per60 * (pi.ev_toi_per_game / 3600) * pi.games_played;
                return sum + playerIxg;
            }, 0);

        const result: AggPlayer[] = [];
        for (const [id, pi] of Object.entries(piData)) {
            if (pi.team !== teamAbbr) continue;
            if (pi.position === 'G') continue;
            if (pi.games_played < 5) continue;

            const bs = boxMap.get(id);
            const gp = bs?.gp ?? pi.games_played;
            const g = bs?.g ?? 0;
            const a = bs?.a ?? 0;
            const pts = bs?.pts ?? 0;
            const shots = bs?.shots ?? 0; // kept for sh_pct; note: CSV shots column is unreliable
            // Total TOI seconds (for sort-by-TOI); fallback to player_impact sum
            const total_toi_sec = bs
                ? bs.toi_sec
                : (pi.ev_toi_per_game + pi.pp_toi_per_game + pi.pk_toi_per_game) * pi.games_played;

            // Use MoneyPuck season totals for SOG (player_stats CSV shots field is always 0)
            const sog_season = pi.total_sog ?? 0;
            const sog_pg = pi.games_played > 0 ? sog_season / pi.games_played : 0;

            const sh_pct = sog_season > 0 ? (g / sog_season) * 100 : 0;
            const toi_pg_str = gp > 0
                ? fmtToi(total_toi_sec / gp)
                : fmtToi(pi.ev_toi_per_game + pi.pp_toi_per_game + pi.pk_toi_per_game);
            const gs_pg = pi.games_played > 0 ? pi.game_score / pi.games_played : 0;

            // iXG%: this player's share of team total EV individual expected goals
            const playerIxg = pi.ind_xg_per60 * (pi.ev_toi_per_game / 3600) * pi.games_played;
            const ixg_share_pct = teamTotalIxg > 0 ? (playerIxg / teamTotalIxg) * 100 : 0;

            result.push({
                id, pi,
                jerseyNum: bs?.jerseyNum ?? 0,
                g, a, pts, shots, gp,
                total_toi_sec, sh_pct, sog_pg,
                toi_pg_str, gs_pg, ixg_share_pct,
                played_toi: bs?.played_toi ?? new Map(),
                other_team_dates: bs?.other_team_dates ?? new Map(),
                bio: bioData?.[id] ?? null,
            });
        }
        return result;
    }, [piData, boxMap, teamAbbr, bioData]);

    // Apply filter + sort (cheap op — separate from heavy enrichment)
    // In 'lineup' mode the flat grid is not shown, but we still compute for the fallback.
    const players = useMemo(() => {
        const filtered = allPlayers.filter(p => {
            if (sortBy === 'lineup') return true; // no pos filter in lineup mode
            if (posFilter === 'f') return p.pi.is_forward;
            if (posFilter === 'd') return !p.pi.is_forward;
            return true;
        });
        return filtered.sort((a, b) => {
            if (sortBy === 'pts') return b.pts - a.pts;
            if (sortBy === 'toi') return b.total_toi_sec - a.total_toi_sec;
            return b.gs_pg - a.gs_pg; // 'impact' default (and 'lineup' fallback)
        });
    }, [allPlayers, posFilter, sortBy]);

    // Team TOI totals per game — denominator for the player's TOI share pills.
    // Formula: sum(player_toi × gp) / (teamGP × skaters_on_ice)
    //   EV & PP: 5 skaters on ice  →  divide by 5
    //   PK:      4 skaters on ice  →  divide by 4
    // Result is the team's total per-game 5v5/PP/PK minutes (~42 min EV).
    const teamToiAvgs = useMemo<TeamToiAvgs>(() => {
        if (!piData) return { ev: 0, pp: 0, pk: 0 };
        const team = Object.values(piData).filter(
            p => p.team === teamAbbr && p.position !== 'G' && p.games_played >= 5
        );
        const teamGP = Math.max(...team.map(p => p.games_played), 1);
        const wsum = (k: keyof PIPlayer) =>
            team.reduce((s, p) => s + Number(p[k]) * p.games_played, 0);
        return {
            ev: wsum('ev_toi_per_game') / (teamGP * 5),
            pp: wsum('pp_toi_per_game') / (teamGP * 5),
            pk: wsum('pk_toi_per_game') / (teamGP * 4),
        };
    }, [piData, teamAbbr]);

    // Build player lookup maps for lineup mode.
    // Two-pass matching: normalized full name first, then last name fallback.
    // Normalization strips diacritics + lowercases to bridge gaps like
    // "Bäck"→"Back" and "Alexander"→"Alex" (dailyfaceoff name shortening).
    const playerNameMaps = useMemo(() => {
        const norm = (s: string) =>
            s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const byFull = new Map<string, AggPlayer>();
        const byLast = new Map<string, AggPlayer>();
        for (const p of allPlayers) {
            const full = norm(p.pi.name);
            byFull.set(full, p);
            const last = full.split(' ').at(-1) ?? full;
            if (!byLast.has(last)) byLast.set(last, p); // first player wins on last-name collision
        }
        return { byFull, byLast, norm };
    }, [allPlayers]);

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

    // Effective sort mode: fall back to 'impact' if lineup requested but data missing
    const effectiveSortBy = sortBy === 'lineup' && !lineup ? 'impact' : sortBy;

    return (
        <div className="flex flex-col gap-4">

            {/* ── Controls + Legend ── */}
            <div className="flex flex-wrap items-center gap-2">

                {/* Position filter — hidden in lineup mode */}
                {effectiveSortBy !== 'lineup' && (
                    <div className="flex items-center bg-zinc-900/80 border border-white/[0.08] rounded-lg p-0.5">
                        {(['all', 'f', 'd'] as const).map(pos => (
                            <button
                                key={pos}
                                onClick={() => setPosFilter(pos)}
                                className={`px-3 py-1 rounded-md text-[10.5px] font-bold uppercase tracking-wider transition-colors ${posFilter === pos
                                    ? 'bg-white/15 text-white'
                                    : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                            >
                                {pos === 'all' ? 'All' : pos === 'f' ? 'Fwd' : 'Def'}
                            </button>
                        ))}
                    </div>
                )}

                {/* Sort order */}
                <div className="flex items-center bg-zinc-900/80 border border-white/[0.08] rounded-lg p-0.5">
                    {([
                        ['impact', 'Impact'],
                        ['pts', 'Points'],
                        ['toi', 'TOI'],
                        ...(lineup ? [['lineup', 'Lineup']] : []),
                    ] as [string, string][]).map(([val, label]) => (
                        <button
                            key={val}
                            onClick={() => setSortBy(val as typeof sortBy)}
                            className={`px-3 py-1 rounded-md text-[10.5px] font-bold uppercase tracking-wider transition-colors ${sortBy === val
                                ? 'bg-white/15 text-white'
                                : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

            </div>

            {/* Availability strip legend (shown once, above grid) */}
            <div className="flex items-center gap-4 text-[8px] text-zinc-500">
                <span className="uppercase tracking-wider text-zinc-600 font-medium">Availability:</span>
                {[
                    { bg: '#d4d4d8', op: 0.88, label: 'Played' },
                    { bg: '#fb923c', op: 0.7, label: 'Missed' },
                    { bg: '#a78bfa', op: 0.75, label: 'Other team' },
                    { bg: '#27272a', op: 0.5, label: 'Future game' },
                ].map(({ bg, op, label }) => (
                    <div key={label} className="flex items-center gap-1.5">
                        <div
                            className="rounded-sm"
                            style={{ width: 14, height: 6, backgroundColor: bg, opacity: op }}
                        />
                        <span>{label}</span>
                    </div>
                ))}
            </div>

            {/* ── LINEUP VIEW ── */}
            {effectiveSortBy === 'lineup' && lineup ? (() => {
                const { byFull, byLast, norm } = playerNameMaps;

                // Two-pass fuzzy lookup: normalized full name → last name fallback
                const findPlayer = (lpName: string): AggPlayer | undefined => {
                    const n = norm(lpName);
                    return byFull.get(n) ?? byLast.get(n.split(' ').at(-1) ?? n);
                };

                // Track matched player IDs (by piData id) for Others exclusion
                const matchedIds = new Set(
                    ['f1', 'f2', 'f3', 'f4', 'd1', 'd2', 'd3'].flatMap(k =>
                        (lineup[k] || []).map(lp => findPlayer(lp.name)?.id).filter(Boolean)
                    )
                );

                // Section label + cards row
                const LineSection = ({ label, lineKey }: { label: string; lineKey: string }) => {
                    const lineupPlayers = lineup![lineKey] || [];
                    if (lineupPlayers.length === 0) return null;
                    return (
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600 shrink-0">
                                    {label}
                                </span>
                                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                {lineupPlayers.map(lp => {
                                    const p = findPlayer(lp.name);
                                    if (p) {
                                        return (
                                            <SkaterCard
                                                key={p.id}
                                                player={p}
                                                teamGames={teamGames}
                                                pool={p.pi.is_forward ? pools.fwd : pools.def}
                                                teamToiAvgs={teamToiAvgs}
                                            />
                                        );
                                    }
                                    // Player not yet in piData — show greyed-out stub
                                    return (
                                        <StubSkaterCard
                                            key={lp.name}
                                            name={lp.name}
                                            pos={lp.pos}
                                            jerseyNum={lp.number ?? 0}
                                            team={teamAbbr}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    );
                };

                const others = allPlayers.filter(p => !matchedIds.has(p.id));

                return (
                    <div className="flex flex-col gap-6">
                        {/* Forward lines */}
                        {['f1', 'f2', 'f3', 'f4'].map((key, i) => (
                            <LineSection key={key} label={`F${i + 1}`} lineKey={key} />
                        ))}
                        {/* Defence pairs */}
                        {['d1', 'd2', 'd3'].map((key, i) => (
                            <LineSection key={key} label={`D${i + 1}`} lineKey={key} />
                        ))}
                        {/* Others: qualified players not in any lineup group */}
                        {others.length > 0 && (
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600 shrink-0">
                                        Others
                                    </span>
                                    <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                    {others.map(p => (
                                        <SkaterCard
                                            key={p.id}
                                            player={p}
                                            teamGames={teamGames}
                                            pool={p.pi.is_forward ? pools.fwd : pools.def}
                                            teamToiAvgs={teamToiAvgs}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })() : (
                /* ── FLAT GRID (Impact / Points / TOI sort) ── */
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {players.map(p => (
                            <SkaterCard
                                key={p.id}
                                player={p}
                                teamGames={teamGames}
                                pool={p.pi.is_forward ? pools.fwd : pools.def}
                                teamToiAvgs={teamToiAvgs}
                            />
                        ))}
                    </div>
                    {players.length === 0 && (
                        <div className="text-center text-zinc-500 font-mono text-sm py-16">
                            No qualifying skaters found.
                        </div>
                    )}
                </>
            )}

        </div>
    );
}
