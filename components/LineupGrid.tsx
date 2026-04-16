'use client';

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { TeamLineup } from '@/utils/data';
import { ArrowUp, ArrowDown, Plus } from 'lucide-react';

interface LineupGridProps {
    lineup?: TeamLineup;
    triCode: string;
    goalieStarter?: string;         // projected starter full name
    gsaxPerGame?: number;           // GSAx per game (positive = above avg)
    gsaxPct?: number;               // percentile rank among NHL starters (0–100)
    goalieStatLine?: string;        // pre-formatted stats string, e.g. "(31-12-3) | .914 | 2.30"
    backupGoalie?: string;          // backup goalie full name
    backupGoalieStatLine?: string;  // backup goalie stats string
}

// ── Player impact data types ───────────────────────────────────────────────────
interface PIPlayer {
    name: string;
    team: string;
    is_forward: boolean;
    games_played: number;
    xgaa_per_game: number;
    impact_score?: number;  // position-weighted composite z-score (new)
    // legacy fallback (some builds may not have xgaa yet)
    game_score?: number;
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

    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const left = Math.max(8, Math.min(x - TOOLTIP_W / 2, vw - TOOLTIP_W - 8));
    const top = y > 56 ? y - 46 : y + 22;

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
function goalieColor(gsax: number): string {
    if (gsax >= 0.2) return '#16a34a';
    if (gsax >= 0.05) return '#22c55e';
    if (gsax > -0.05) return '#6b7280';
    if (gsax > -0.15) return '#f97316';
    return '#ef4444';
}

function playerImpactColor(z: number): string {
    if (z >= 1.0) return '#3b82f6';
    if (z >= 0.3) return '#38bdf8';
    if (z >= -0.3) return '#6b7280';
    if (z >= -1.0) return '#f97316';
    return '#ef4444';
}

function lineImpactColor(pct: number): string {
    if (pct >= 80) return '#3b82f6';   // blue   – elite
    if (pct >= 60) return '#38bdf8';   // sky    – above avg
    if (pct >= 40) return '#6b7280';   // gray   – average
    if (pct >= 20) return '#f97316';   // orange – below avg
    return '#ef4444';                  // red    – bottom tier
}

function gradeColor(pct: number | null): string {
    if (pct === null) return '#6b7280';
    if (pct >= 80) return '#3b82f6';
    if (pct >= 60) return '#38bdf8';
    if (pct >= 40) return '#6b7280';
    if (pct >= 20) return '#f97316';
    return '#ef4444';
}

// ── Tooltip segment builders ──────────────────────────────────────────────────
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
    const sign = gsax >= 0 ? '+' : '';
    const color = goalieColor(gsax);
    const rank = Math.round(pct);
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
                onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setMouse(null)}
            >
                {children}
            </div>
            {mouse && <FixedTooltip x={mouse.x} y={mouse.y} segments={tooltipSegs} />}
        </>
    );
}

// ── Goalie chip ───────────────────────────────────────────────────────────────
// Strip status suffix like "(Confirmed)", "(Unconfirmed)" that comes from the CSV
function cleanGoalieName(raw: string): string {
    return raw.replace(/\s*\(.*?\)\s*$/, '').trim();
}

function GoalieChip({ name, gsax, pct }: { name: string; gsax: number; pct: number }) {
    const cleanName = cleanGoalieName(name);
    const lastName = cleanName.split(' ').pop() ?? cleanName;
    const sign = gsax >= 0 ? '+' : '';
    const color = goalieColor(gsax);
    return (
        <Chip tooltipSegs={goalieTooltipSegs(gsax, pct, cleanName)}>
            <span className="text-[9px] text-neutral-300 font-medium">{lastName}</span>
            <span className="text-[9px] font-bold tabular-nums" style={{ color }}>
                {sign}{gsax.toFixed(2)}
            </span>
        </Chip>
    );
}

// ── Lineup grade chip ─────────────────────────────────────────────────────────
function LineupGradeChip({ grade, leaguePct, leagueRank, leagueTotal, teamCeiling }: {
    grade: number;
    leaguePct: number | null;
    leagueRank: number | null;
    leagueTotal: number;
    teamCeiling: number | null;
}) {
    const sign = grade >= 0 ? '+' : '';
    const color = gradeColor(leaguePct);

    const tooltipSegs: Seg[] = [
        { text: 'Lineup grade: ' },
        { text: `${sign}${grade.toFixed(2)} IMPACT`, color },
        { text: ' (sum of skater impact z-scores)' },
        ...(leagueRank !== null && leagueTotal > 1 ? [
            { text: ' · ' },
            { text: `${leagueRank}${ordinalSuffix(leagueRank)} of ${leagueTotal}`, color },
            { text: ' teams tonight' },
        ] : []),
        ...(teamCeiling !== null ? [
            { text: ' · Ceiling: ' },
            { text: `${teamCeiling >= 0 ? '+' : ''}${teamCeiling.toFixed(1)}`, color: '#94a3b8' },
            { text: ' (full roster top-18)' },
        ] : []),
    ];

    return (
        <Chip tooltipSegs={tooltipSegs}>
            <span className="text-[9px] text-neutral-400 font-medium uppercase tracking-wider">Grade</span>
            <span className="text-[10px] font-bold tabular-nums font-mono" style={{ color }}>
                {sign}{grade.toFixed(1)}
            </span>
            {leagueRank !== null && leagueTotal > 1 && (
                <span className="text-[8px] tabular-nums" style={{ color }}>
                    #{leagueRank}/{leagueTotal}
                </span>
            )}
        </Chip>
    );
}

// ── Header chip row ───────────────────────────────────────────────────────────
function LineupHeader({ goalieStarter, gsaxPerGame, gsaxPct }: {
    goalieStarter?: string;
    gsaxPerGame?: number;
    gsaxPct?: number;
}) {
    if (!goalieStarter || gsaxPerGame === undefined || gsaxPct === undefined) return null;
    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            <GoalieChip name={goalieStarter} gsax={gsaxPerGame} pct={gsaxPct} />
        </div>
    );
}

// ── Line/pairing impact badge ─────────────────────────────────────────────────
function ImpactBadge({ lineKey, impact }: {
    lineKey: string;
    impact: { total: number; pct: number; rank: number; outOf: number } | null | undefined;
}) {
    const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);

    if (!impact) {
        return (
            <div className="flex items-center justify-center border-l border-white/5 min-w-[3.5rem]">
                <span className="text-[9px] text-neutral-700">—</span>
            </div>
        );
    }

    const color = lineImpactColor(impact.pct);
    const sign = impact.total >= 0 ? '+' : '';
    const lineLabel = lineKey.toUpperCase();

    const tooltipSegs: Seg[] = [
        { text: `${lineLabel} line: ` },
        { text: `${sign}${impact.total.toFixed(2)} IMPACT`, color },
        { text: ' · ' },
        { text: `${impact.rank}${ordinalSuffix(impact.rank)} of ${impact.outOf}`, color },
        { text: ` current NHL ${lineLabel} lines` },
    ];

    return (
        <>
            <div
                className="flex flex-col items-center justify-center border-l border-white/5 min-w-[3.5rem] cursor-default select-none"
                onMouseEnter={(e) => setMouse({ x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setMouse(null)}
            >
                <span className="text-[10px] font-bold tabular-nums leading-none" style={{ color }}>
                    {sign}{impact.total.toFixed(2)}
                </span>
                <span className="text-[8px] tabular-nums leading-none mt-0.5" style={{ color }}>
                    {impact.rank}{ordinalSuffix(impact.rank)}/{impact.outOf}
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

// ── Fuzzy-tolerant map lookup ─────────────────────────────────────────────────
// Tries (1) exact full-name key, (2) exact last-name key, (3) prefix match on
// last name (≥ 7 chars, ≤ 2 length difference) to handle 1-2 char misspellings
// in external data sources such as MoneyPuck "Lafrenire" vs "Lafreniere".
function lookupInMap(m: Map<string, number>, name: string): number | undefined {
    const full = normName(name);
    if (m.has(full)) return m.get(full);
    const last = full.split(' ').at(-1) ?? full;
    if (m.has(last)) return m.get(last);
    // Fuzzy: prefix match on last-name keys only (no spaces) when ≥ 7 chars
    if (last.length >= 7) {
        const prefix = last.slice(0, 7);
        for (const [key, val] of m) {
            if (!key.includes(' ') && key.startsWith(prefix) && Math.abs(key.length - last.length) <= 2) {
                return val;
            }
        }
    }
    return undefined;
}

// ── Main grid ─────────────────────────────────────────────────────────────────
export default function LineupGrid({
    lineup, triCode, goalieStarter, gsaxPerGame, gsaxPct, goalieStatLine,
    backupGoalie, backupGoalieStatLine,
}: LineupGridProps) {
    // ── Hooks (must precede any early returns per Rules of Hooks) ─────────────
    const [piData, setPiData] = useState<PiData | null>(null);
    const [allLineups, setAllLineups] = useState<AllLineups | null>(null);

    useEffect(() => {
        fetch('/data/player_impact.json')
            .then(r => r.json())
            .then((d: PiData) => setPiData(d))
            .catch(() => { });
        fetch('/data/team_lineups.json')
            .then(r => r.json())
            .then((d: AllLineups) => setAllLineups(d))
            .catch(() => { });
    }, []);

    // name → impact_score (z-score)
    // Keyed by normalised full name AND normalised last name for two-pass fallback
    const gsMap = useMemo((): Map<string, number> => {
        if (!piData) return new Map();
        const m = new Map<string, number>();
        for (const [, p] of Object.entries(piData)) {
            if (p.games_played <= 0) continue;
            // Use new impact_score z-score; fall back to xgaa_per_game for safety
            const gspg = p.impact_score ?? p.xgaa_per_game ?? ((p.game_score ?? 0) / p.games_played);
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
        const lookupGsPg = (name: string) => lookupInMap(gsMap, name);

        if (allLineups) {
            // ── Real lineup distribution ────────────────────────────────────
            for (const teamLineup of Object.values(allLineups)) {
                for (const [key, required] of [['f1', 3], ['f2', 3], ['f3', 3], ['f4', 3], ['d1', 2], ['d2', 2], ['d3', 2]] as [string, number][]) {
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
            const teamDefs = new Map<string, number[]>();
            for (const [, p] of Object.entries(piData ?? {})) {
                if (p.games_played <= 0) continue;
                const gspg = p.impact_score ?? p.xgaa_per_game ?? ((p.game_score ?? 0) / p.games_played);
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

    // name → impact_score (position-weighted composite z-score, added in new pipeline)
    const impactScoreMap = useMemo((): Map<string, number> => {
        if (!piData) return new Map();
        const m = new Map<string, number>();
        for (const [, p] of Object.entries(piData)) {
            if (p.games_played <= 0 || p.impact_score === undefined) continue;
            const full = normName(p.name);
            m.set(full, p.impact_score);
            const last = full.split(' ').at(-1) ?? full;
            if (!m.has(last)) m.set(last, p.impact_score);
        }
        return m;
    }, [piData]);

    // Actual lineup line totals + rank vs league distributions.
    // Returns null for incomplete lines (missing players / no impact data).
    const lineImpacts = useMemo((): Record<string, { total: number; pct: number; rank: number; outOf: number } | null> => {
        if (!lineup || !gsMap.size || !Object.keys(lineDistributions).length) return {};
        const result: Record<string, { total: number; pct: number; rank: number; outOf: number } | null> = {};
        const lookupGsPg = (name: string) => lookupInMap(gsMap, name);

        // Pre-compute this team's score from allLineups (same source as distribution)
        // so we can replace it in the distribution with our lineup-prop-derived score.
        const teamDistScores: Record<string, number | null> = {};
        if (allLineups) {
            const teamLineup = allLineups[triCode];
            if (teamLineup) {
                for (const [key, required] of [['f1', 3], ['f2', 3], ['f3', 3], ['f4', 3], ['d1', 2], ['d2', 2], ['d3', 2]] as [string, number][]) {
                    const players = teamLineup[key] || [];
                    if (players.length < required) { teamDistScores[key] = null; continue; }
                    const scores = players.slice(0, required).map((p: { name: string }) => lookupGsPg(p.name));
                    if (scores.some(s => s === undefined)) { teamDistScores[key] = null; continue; }
                    teamDistScores[key] = (scores as number[]).reduce((a, b) => a + b, 0);
                }
            }
        }

        const compute = (key: string, required: number) => {
            const players = lineup[key] || [];
            if (players.length < required) { result[key] = null; return; }
            const scores = players.slice(0, required).map(p => lookupGsPg(p.name));
            if (scores.some(s => s === undefined)) { result[key] = null; return; }
            const total = (scores as number[]).reduce((a, b) => a + b, 0);
            let dist = lineDistributions[key] || [];
            if (!dist.length) { result[key] = null; return; }

            // Replace this team's distribution entry (from allLineups) with the
            // score from the lineup prop so rankings are consistent.
            const teamOldScore = teamDistScores[key];
            if (teamOldScore !== null && teamOldScore !== undefined) {
                // Swap the closest match to our old score with the new score
                const idx = dist.indexOf(teamOldScore);
                if (idx !== -1) {
                    dist = [...dist];
                    dist[idx] = total;
                    dist.sort((a, b) => a - b);
                }
            } else {
                // This team wasn't in the distribution — add it
                dist = [...dist, total].sort((a, b) => a - b);
            }

            const outOf = dist.length;
            const rank = dist.filter(v => v > total).length + 1; // 1 = best
            const pct = (dist.filter(v => v < total).length / outOf) * 100; // for color
            result[key] = { total, pct, rank, outOf };
        };
        ['f1', 'f2', 'f3', 'f4'].forEach(k => compute(k, 3));
        ['d1', 'd2', 'd3'].forEach(k => compute(k, 2));
        return result;
    }, [lineup, triCode, gsMap, lineDistributions, allLineups]);

    // Total lineup grade: sum of impact_score for all 18 skaters.
    // Compared against all 32 teams' current projected lineups (tonight's context).
    // Also computes team "ceiling" = top-12F + top-6D from full roster in piData.
    const lineupGradeData = useMemo(() => {
        if (!impactScoreMap.size || !lineup) return null;

        const lookupScore = (name: string) => lookupInMap(impactScoreMap, name);

        // Sum impact_score for this lineup's 18 skaters (f1-f4 + d1-d3)
        let thisGrade = 0;
        let found = 0;
        for (const lineKey of ['f1', 'f2', 'f3', 'f4', 'd1', 'd2', 'd3']) {
            for (const player of (lineup[lineKey] || [])) {
                const s = lookupScore(player.name);
                if (s !== undefined) { thisGrade += s; found++; }
            }
        }
        if (found < 10) return null; // too few matches — don't show

        // League distribution: compute grade for every team with a current lineup
        const leagueGrades: number[] = [];
        if (allLineups) {
            for (const [, teamLineup] of Object.entries(allLineups)) {
                let grade = 0, teamFound = 0;
                for (const lineKey of ['f1', 'f2', 'f3', 'f4', 'd1', 'd2', 'd3']) {
                    for (const player of (teamLineup[lineKey] || [])) {
                        const s = lookupScore(player.name);
                        if (s !== undefined) { grade += s; teamFound++; }
                    }
                }
                if (teamFound >= 10) leagueGrades.push(grade);
            }
        }
        leagueGrades.sort((a, b) => a - b);

        const leaguePct = leagueGrades.length > 1
            ? Math.round((leagueGrades.filter(g => g < thisGrade).length / leagueGrades.length) * 100)
            : null;
        const leagueRank = leagueGrades.length > 1
            ? leagueGrades.filter(g => g > thisGrade).length + 1
            : null;

        // Team ceiling: top-12 forwards + top-6 defensemen from this team's roster
        const teamFwdScores: number[] = [];
        const teamDefScores: number[] = [];
        if (piData) {
            for (const [, p] of Object.entries(piData)) {
                if (p.team !== triCode || p.impact_score === undefined || p.games_played <= 0) continue;
                if (p.is_forward) teamFwdScores.push(p.impact_score);
                else teamDefScores.push(p.impact_score);
            }
        }
        teamFwdScores.sort((a, b) => b - a);
        teamDefScores.sort((a, b) => b - a);
        const teamCeiling = (teamFwdScores.length >= 12 && teamDefScores.length >= 6)
            ? teamFwdScores.slice(0, 12).reduce((a, b) => a + b, 0) +
            teamDefScores.slice(0, 6).reduce((a, b) => a + b, 0)
            : null;

        return { grade: thisGrade, found, leaguePct, leagueRank, leagueTotal: leagueGrades.length, teamCeiling };
    }, [lineup, triCode, piData, impactScoreMap, allLineups]);

    // ── Early return (after hooks) ────────────────────────────────────────────
    if (!lineup) return (
        <div className="flex flex-col items-center justify-center p-4 text-neutral-500 text-xs">
            No lineup data available.
        </div>
    );

    const getPlayers = (keys: string[]) => keys.map(k => lineup[k] || []);
    const forwards = getPlayers(['f1', 'f2', 'f3', 'f4']);
    const defense = getPlayers(['d1', 'd2', 'd3']);

    // Show the IMP column once player data has loaded.
    // On mobile (<md) we hide it to keep the lineup readable.
    const showImp = piData !== null;

    // Build a set of normalised names currently in the lineup so we can
    // remove duplicates from the Out / IR section.
    const lineupNameSet = useMemo((): Set<string> => {
        if (!lineup) return new Set();
        const names = new Set<string>();
        for (const key of ['f1', 'f2', 'f3', 'f4', 'd1', 'd2', 'd3']) {
            for (const p of (lineup[key] || [])) {
                if (p?.name) names.add(normName(p.name));
            }
        }
        return names;
    }, [lineup]);

    return (
        <div className="flex flex-col w-full text-left">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest shrink-0">
                    Starting Lineup
                </span>
                <LineupHeader
                    goalieStarter={goalieStarter}
                    gsaxPerGame={gsaxPerGame}
                    gsaxPct={gsaxPct}
                />
                {lineupGradeData && (
                    <LineupGradeChip
                        grade={lineupGradeData.grade}
                        leaguePct={lineupGradeData.leaguePct}
                        leagueRank={lineupGradeData.leagueRank}
                        leagueTotal={lineupGradeData.leagueTotal}
                        teamCeiling={lineupGradeData.teamCeiling}
                    />
                )}
            </div>

            <div className="flex flex-col gap-4">
                {/* Forwards Table — IMP column hidden on mobile */}
                <div className="border border-white/10 rounded-lg overflow-hidden">
                    <div className={`grid grid-cols-3 ${showImp ? 'md:grid-cols-[1fr_1fr_1fr_3.5rem]' : ''} bg-white/5 border-b border-white/10`}>
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase">LW</div>
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase border-x border-white/5">C</div>
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase">RW</div>
                        {showImp && <div className="hidden md:block py-1 text-center text-[9px] font-bold text-neutral-500 uppercase border-l border-white/5">IMP</div>}
                    </div>
                    {forwards.map((line, i) => (
                        <div key={i} className={`grid grid-cols-3 ${showImp ? 'md:grid-cols-[1fr_1fr_1fr_3.5rem]' : ''} ${i !== forwards.length - 1 ? 'border-b border-white/5' : ''}`}>
                            {[0, 1, 2].map(colIndex => {
                                const player = line[colIndex];
                                const playerScore = player ? lookupInMap(impactScoreMap, player.name) : undefined;
                                return (
                                    <div key={colIndex} className={`py-1.5 px-1 flex items-center justify-center text-center gap-1 ${colIndex === 1 ? 'border-x border-white/5' : ''}`}>
                                        <div className="flex flex-col items-center gap-0">
                                            <div className="flex items-center gap-1">
                                                {player?.movement === 'up' && <ArrowUp className="w-3 h-3 text-green-500" strokeWidth={3} />}
                                                {player?.movement === 'down' && <ArrowDown className="w-3 h-3 text-red-500" strokeWidth={3} />}
                                                {player?.movement === 'new' && <Plus className="w-3 h-3 text-orange-500" strokeWidth={3} />}
                                                <span
                                                    className="text-[10px] leading-tight select-none"
                                                    style={{
                                                        color: player?.ppUnit === 1 ? '#5382BD' :
                                                            player?.ppUnit === 2 ? '#FFFFFF' : '#697281',
                                                        fontWeight: player?.ppUnit === 1 ? 700 : 500,
                                                    }}
                                                >
                                                    {player ? formatName(player.name) : '-'}
                                                </span>
                                            </div>
                                            {playerScore !== undefined && (
                                                <span className="text-[8px] tabular-nums leading-none" style={{ color: playerImpactColor(playerScore) }}>
                                                    {playerScore >= 0 ? '+' : ''}{playerScore.toFixed(2)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            {showImp && (
                                <div className="hidden md:flex">
                                    <ImpactBadge lineKey={`f${i + 1}`} impact={lineImpacts[`f${i + 1}`]} />
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* Defense Table — IMP column hidden on mobile */}
                <div className={`border border-white/10 rounded-lg overflow-hidden ${showImp ? '' : 'w-2/3'}`}>
                    <div className={`grid grid-cols-2 ${showImp ? 'md:grid-cols-[1fr_1fr_3.5rem]' : ''} bg-white/5 border-b border-white/10`}>
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase">LD</div>
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase border-l border-white/5">RD</div>
                        {showImp && <div className="hidden md:block py-1 text-center text-[9px] font-bold text-neutral-500 uppercase border-l border-white/5">IMP</div>}
                    </div>
                    {defense.map((pair, i) => (
                        <div key={i} className={`grid grid-cols-2 ${showImp ? 'md:grid-cols-[1fr_1fr_3.5rem]' : ''} ${i !== defense.length - 1 ? 'border-b border-white/5' : ''}`}>
                            {[0, 1].map(colIndex => {
                                const player = pair[colIndex];
                                const playerScore = player ? lookupInMap(impactScoreMap, player.name) : undefined;
                                return (
                                    <div key={colIndex} className={`py-1.5 px-1 flex items-center justify-center text-center gap-1 ${colIndex === 1 ? 'border-l border-white/5' : ''}`}>
                                        <div className="flex flex-col items-center gap-0">
                                            <div className="flex items-center gap-1">
                                                {player?.movement === 'up' && <ArrowUp className="w-3 h-3 text-green-500" strokeWidth={3} />}
                                                {player?.movement === 'down' && <ArrowDown className="w-3 h-3 text-red-500" strokeWidth={3} />}
                                                {player?.movement === 'new' && <Plus className="w-3 h-3 text-orange-500" strokeWidth={3} />}
                                                <span
                                                    className="text-[10px] leading-tight select-none"
                                                    style={{
                                                        color: player?.ppUnit === 1 ? '#5382BD' :
                                                            player?.ppUnit === 2 ? '#FFFFFF' : '#697281',
                                                        fontWeight: player?.ppUnit === 1 ? 700 : 500,
                                                    }}
                                                >
                                                    {player ? formatName(player.name) : '-'}
                                                </span>
                                            </div>
                                            {playerScore !== undefined && (
                                                <span className="text-[8px] tabular-nums leading-none" style={{ color: playerImpactColor(playerScore) }}>
                                                    {playerScore >= 0 ? '+' : ''}{playerScore.toFixed(2)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            {showImp && (
                                <div className="hidden md:flex">
                                    <ImpactBadge lineKey={`d${i + 1}`} impact={lineImpacts[`d${i + 1}`]} />
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* Goalies Section */}
                {goalieStarter && (() => {
                    const renderGoalie = (name: string, statLine?: string, gsax?: number) => {
                        const clean = cleanGoalieName(name);
                        const last = clean.split(' ').pop() ?? clean;
                        const parts = statLine?.split(' | ') ?? [];
                        const svPct = parts.length === 3 ? parts[1] : undefined;
                        const gaa  = parts.length === 3 ? parts[2] : undefined;
                        const gsaxColor = gsax !== undefined ? goalieColor(gsax) : '#6b7280';
                        const gsaxSign  = (gsax ?? 0) >= 0 ? '+' : '';
                        return (
                            <div className="py-2 px-2 flex flex-col items-center gap-0.5">
                                <span className="text-[10px] text-neutral-300 font-medium leading-tight">{last}</span>
                                <div className="flex items-center gap-1 text-[8px] tabular-nums text-neutral-500 leading-none flex-wrap justify-center">
                                    {gsax !== undefined && (
                                        <span style={{ color: gsaxColor }}>{gsaxSign}{gsax.toFixed(2)} GSAx</span>
                                    )}
                                    {svPct && <><span className="text-neutral-700">|</span><span>{svPct} SV%</span></>}
                                    {gaa && <><span className="text-neutral-700">|</span><span>{gaa} GAA</span></>}
                                </div>
                            </div>
                        );
                    };
                    return (
                        <div className="border border-white/10 rounded-lg overflow-hidden">
                            <div className="grid grid-cols-2 bg-white/5 border-b border-white/10">
                                <div className="py-1 col-span-2 text-center text-[9px] font-bold text-neutral-500 uppercase">Goalies</div>
                            </div>
                            <div className="grid grid-cols-2">
                                {renderGoalie(goalieStarter, goalieStatLine, gsaxPerGame)}
                                <div className="border-l border-white/5">
                                    {backupGoalie
                                        ? renderGoalie(backupGoalie, backupGoalieStatLine)
                                        : <div className="py-2 px-2 flex items-center justify-center"><span className="text-[9px] text-neutral-700">—</span></div>
                                    }
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* Out / IR Section — excludes anyone already placed in a lineup slot */}
                {(() => {
                    const irPlayers = (lineup['ir'] || [])
                        .filter((p: { name: string }) => !lineupNameSet.has(normName(p.name)))
                        .slice(0, 6);
                    if (!irPlayers.length) return null;
                    // Split into two columns: [0,2,4] left, [1,3,5] right
                    const left = irPlayers.filter((_: unknown, i: number) => i % 2 === 0);
                    const right = irPlayers.filter((_: unknown, i: number) => i % 2 === 1);
                    const rows = Math.max(left.length, right.length);
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
