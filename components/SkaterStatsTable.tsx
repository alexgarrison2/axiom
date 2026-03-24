'use client';

import { useState, useEffect, useMemo } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface SkaterData {
    id: string;       // player ID (JSON key), injected on load
    name: string;
    team: string;
    position: string;
    is_forward: boolean;
    games_played: number;
    goals: number;
    assists: number;
    points: number;
    sog_per_game: number;
    toi_per_game_all: number;
    impact_ev_off: number;
    impact_ev_def: number;
    impact_pp: number;
    impact_pk: number;
    impact_score: number;
    // RAPM (Regularized Adjusted Plus-Minus)
    rapm_net: number;
    // Per-60 rates
    ind_xg_per60: number;
    ev_xgf_per60: number;
    // legacy fallback
    xgaa_per_game?: number;
}

type SortKey = keyof Pick<SkaterData,
    'games_played' | 'goals' | 'assists' | 'points' | 'sog_per_game' |
    'toi_per_game_all' | 'impact_ev_off' | 'impact_ev_def' |
    'impact_pp' | 'impact_pk' | 'impact_score' |
    'rapm_net' | 'ind_xg_per60' | 'ev_xgf_per60'>;

// ── Helpers ───────────────────────────────────────────────────────────────────
function impactColor(z: number): string {
    if (z >= 1.5)  return '#3b82f6';   // blue   – elite
    if (z >= 0.5)  return '#38bdf8';   // sky    – above avg
    if (z >= -0.5) return '#6b7280';   // gray   – average
    if (z >= -1.5) return '#f97316';   // orange – below avg
    return '#ef4444';                   // red    – bottom tier
}

function fmtZ(z: number | undefined): string {
    if (z === undefined || z === null) return '—';
    const sign = z >= 0 ? '+' : '';
    return `${sign}${z.toFixed(2)}`;
}

function fmtRate(v: number | undefined): string {
    if (v === undefined || v === null) return '—';
    return v.toFixed(2);
}

function rapmColor(v: number): string {
    if (v >= 0.3)   return '#3b82f6';   // blue   – elite
    if (v >= 0.1)   return '#38bdf8';   // sky    – above avg
    if (v >= -0.1)  return '#6b7280';   // gray   – average
    if (v >= -0.3)  return '#f97316';   // orange – below avg
    return '#ef4444';                    // red    – bottom tier
}

function per60Color(v: number, avg: number): string {
    const diff = v - avg;
    if (diff >= 0.5)  return '#3b82f6';
    if (diff >= 0.15) return '#38bdf8';
    if (diff >= -0.15) return '#6b7280';
    if (diff >= -0.5) return '#f97316';
    return '#ef4444';
}

function fmtToi(min: number | undefined): string {
    if (!min) return '—';
    const m = Math.floor(min);
    const s = Math.round((min - m) * 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

// ── NHL logo URL helper ───────────────────────────────────────────────────────
function logoUrl(tri: string): string {
    return `/logos/${tri}.svg`;
}

// ── Column definition ─────────────────────────────────────────────────────────
const COLUMNS: { key: SortKey; label: string; title: string; group?: string }[] = [
    { key: 'games_played',     label: 'GP',      title: 'Games Played' },
    { key: 'goals',            label: 'G',       title: 'Goals' },
    { key: 'assists',          label: 'A',       title: 'Assists' },
    { key: 'points',           label: 'PTS',     title: 'Points' },
    { key: 'sog_per_game',     label: 'SOG/G',   title: 'Shots on Goal per Game' },
    { key: 'toi_per_game_all', label: 'TOI/GP',  title: 'Time on Ice per Game (all situations)' },
    { key: 'ind_xg_per60',     label: 'ixG/60',  title: 'Individual Expected Goals per 60 minutes — personal scoring threat rate', group: 'rate' },
    { key: 'ev_xgf_per60',     label: 'oixGF/60', title: 'On-Ice xG For per 60 min — team xGF rate when this player is on ice at 5v5', group: 'rate' },
    { key: 'rapm_net',         label: 'RAPM',    title: 'RAPM: isolated net player value per 60 min via ridge regression on shift data. Controls for linemates and opponents. Bayesian-regressed by sample size.', group: 'rapm' },
    { key: 'impact_ev_off',    label: 'EV OFF',  title: 'EV Offense z-score: blend of individual xG/60 + on-ice xGF impact above avg × TOI.', group: 'impact' },
    { key: 'impact_ev_def',    label: 'EV DEF',  title: 'EV Defense z-score: xGA saved above position-avg × EV TOI per game. Positive = suppresses more goals than average.', group: 'impact' },
    { key: 'impact_pp',        label: 'PP',      title: 'Power Play impact z-score', group: 'impact' },
    { key: 'impact_pk',        label: 'PK',      title: 'Penalty Kill impact z-score', group: 'impact' },
    { key: 'impact_score',     label: 'IMPACT',  title: 'Composite position-weighted impact score (z-score)', group: 'impact' },
];

const IMPACT_KEYS: SortKey[] = ['impact_ev_off', 'impact_ev_def', 'impact_pp', 'impact_pk', 'impact_score'];
const RAPM_KEYS: SortKey[] = ['rapm_net'];
const RATE_KEYS: SortKey[] = ['ind_xg_per60', 'ev_xgf_per60'];

// ── Component ─────────────────────────────────────────────────────────────────
export default function SkaterStatsTable() {
    const [data,    setData]    = useState<Record<string, SkaterData> | null>(null);
    const [bioData, setBioData] = useState<Record<string, { isRookie?: boolean }>>({});
    const [loading, setLoading] = useState(true);
    const [posFilter, setPosFilter] = useState<'All' | 'F' | 'D'>('All');
    const [teamFilter, setTeamFilter] = useState<string>('All');
    const [sortKey, setSortKey] = useState<SortKey>('impact_score');
    const [sortAsc, setSortAsc] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        Promise.all([
            fetch('/data/player_impact.json').then(r => r.json()),
            fetch('/data/player_bio.json').then(r => r.json()).catch(() => ({})),
        ]).then(([impactData, bio]) => {
            Object.entries(impactData as Record<string, SkaterData>).forEach(([id, p]) => { p.id = id; });
            setData(impactData);
            setBioData(bio || {});
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    const allTeams = useMemo(() => {
        if (!data) return [];
        const teams = [...new Set(Object.values(data).map(p => p.team))].sort();
        return teams;
    }, [data]);

    const sorted = useMemo(() => {
        if (!data) return [];
        let rows = Object.values(data);

        // Position filter
        if (posFilter === 'F') rows = rows.filter(p => p.is_forward);
        if (posFilter === 'D') rows = rows.filter(p => !p.is_forward);

        // Team filter
        if (teamFilter !== 'All') rows = rows.filter(p => p.team === teamFilter);

        // Search
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            rows = rows.filter(p => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q));
        }

        // Sort
        rows.sort((a, b) => {
            const av = (a[sortKey] as number) ?? -999;
            const bv = (b[sortKey] as number) ?? -999;
            return sortAsc ? av - bv : bv - av;
        });

        return rows;
    }, [data, posFilter, teamFilter, sortKey, sortAsc, searchQuery]);

    const handleSort = (key: SortKey) => {
        if (key === sortKey) {
            setSortAsc(prev => !prev);
        } else {
            setSortKey(key);
            setSortAsc(false);
        }
    };

    const SortIcon = ({ col }: { col: SortKey }) => {
        if (col !== sortKey) return <span className="opacity-20">↕</span>;
        return <span className="text-cyan-400">{sortAsc ? '↑' : '↓'}</span>;
    };

    if (loading) return (
        <div className="flex justify-center items-center py-24">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-cyan-400" />
        </div>
    );

    if (!data) return (
        <div className="text-center text-neutral-500 py-16 text-sm">
            Player impact data unavailable. Run <code className="text-cyan-400">player_impact.py</code> to generate it.
        </div>
    );

    return (
        <div className="w-full max-w-[1800px] mx-auto px-2 md:px-4 pb-24">
            {/* Header */}
            <div className="mb-4 text-center">
                <h2 className="text-xl md:text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400 mb-1">
                    Skater Impact Rankings
                </h2>
                <p className="text-neutral-400 text-xs md:text-sm">
                    Position-weighted z-scores. Fwd: 50% EV Off · 20% EV Def · 20% PP · 10% PK.
                    Def: 25% EV Off · 40% EV Def · 15% PP · 20% PK.
                    <span className="text-neutral-500"> EV Off = individual xG/60 + on-ice xGF impact (inspired by O Rating).
                    RAPM = isolated player value via ridge regression on shift data (controls for linemates/opponents).</span>
                </p>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 mb-4 justify-center">
                {/* Position filter */}
                <div className="flex gap-1 bg-white/5 p-1 rounded-xl border border-white/8">
                    {(['All', 'F', 'D'] as const).map(p => (
                        <button
                            key={p}
                            onClick={() => setPosFilter(p)}
                            className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                                posFilter === p ? 'bg-white/15 text-white' : 'text-neutral-500 hover:text-neutral-300'
                            }`}
                        >
                            {p === 'All' ? 'All Pos' : p === 'F' ? 'Forwards' : 'Defense'}
                        </button>
                    ))}
                </div>

                {/* Team filter */}
                <select
                    value={teamFilter}
                    onChange={e => setTeamFilter(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-300 focus:outline-none focus:border-cyan-400/50"
                >
                    <option value="All">All Teams</option>
                    {allTeams.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                {/* Search */}
                <input
                    type="text"
                    placeholder="Search player…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-neutral-300 placeholder-neutral-600 focus:outline-none focus:border-cyan-400/50 w-36"
                />

                <span className="text-neutral-600 text-[10px] font-mono ml-auto">{sorted.length} players</span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full text-xs border-collapse">
                    <thead>
                        <tr className="bg-white/5 border-b border-white/10">
                            <th className="text-left py-2 px-3 text-[9px] font-bold text-neutral-500 uppercase tracking-widest whitespace-nowrap sticky left-0 bg-[#0a0a0a] z-10">#</th>
                            <th className="text-left py-2 px-2 text-[9px] font-bold text-neutral-500 uppercase tracking-widest whitespace-nowrap sticky left-6 bg-[#0a0a0a] z-10 min-w-[8rem]">Player</th>
                            <th className="text-center py-2 px-2 text-[9px] font-bold text-neutral-500 uppercase tracking-widest">Pos</th>
                            {COLUMNS.map(col => (
                                <th
                                    key={col.key}
                                    title={col.title}
                                    onClick={() => handleSort(col.key)}
                                    className={`text-center py-2 px-2 text-[9px] font-bold uppercase tracking-widest whitespace-nowrap cursor-pointer select-none transition-colors hover:text-white
                                        ${IMPACT_KEYS.includes(col.key) ? 'text-cyan-600' : ''}
                                        ${RAPM_KEYS.includes(col.key) ? 'text-purple-500' : ''}
                                        ${RATE_KEYS.includes(col.key) ? 'text-emerald-600' : ''}
                                        ${!col.group ? 'text-neutral-500' : ''}
                                        ${col.key === sortKey ? 'text-white' : ''}
                                        ${col.key === 'impact_score' ? 'border-l border-cyan-400/30' : ''}
                                        ${col.key === 'rapm_net' ? 'border-l border-purple-400/30' : ''}
                                        ${col.key === 'ind_xg_per60' ? 'border-l border-emerald-400/30' : ''}`}
                                >
                                    {col.label} <SortIcon col={col.key} />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map((player, idx) => {
                            const imp = player.impact_score;
                            const rowBg = idx % 2 === 0 ? 'bg-white/[0.02]' : '';
                            return (
                                <tr key={player.id} className={`${rowBg} border-b border-white/5 hover:bg-white/5 transition-colors`}>
                                    {/* Rank */}
                                    <td className={`py-0 px-3 text-[9px] text-neutral-600 font-mono sticky left-0 z-10 ${rowBg || 'bg-[#050505]'}`}>
                                        {idx + 1}
                                    </td>
                                    {/* Player name + team logo */}
                                    <td className={`py-0 px-2 sticky left-6 z-10 ${rowBg || 'bg-[#050505]'}`}>
                                        <div className="flex items-center gap-2 min-w-0">
                                            <img
                                                src={logoUrl(player.team)}
                                                alt={player.team}
                                                className="w-8 h-8 object-contain shrink-0 opacity-80"
                                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                            <span className={`font-semibold truncate text-[11px] ${bioData[player.id]?.isRookie ? 'text-[#D9FF82]' : 'text-neutral-200'}`}>{player.name}</span>
                                        </div>
                                    </td>
                                    {/* Position */}
                                    <td className="py-0 px-2 text-center">
                                        <span className="text-[9px] font-mono text-neutral-500">{player.position}</span>
                                    </td>
                                    {/* GP */}
                                    <td className="py-0 px-2 text-center font-mono text-[11px] text-neutral-400">{player.games_played}</td>
                                    {/* G */}
                                    <td className="py-0 px-2 text-center font-mono text-[11px] text-neutral-300">{player.goals ?? '—'}</td>
                                    {/* A */}
                                    <td className="py-0 px-2 text-center font-mono text-[11px] text-neutral-300">{player.assists ?? '—'}</td>
                                    {/* PTS */}
                                    <td className="py-0 px-2 text-center font-mono text-[11px] font-bold text-white">{player.points ?? '—'}</td>
                                    {/* SOG/G */}
                                    <td className="py-0 px-2 text-center font-mono text-[11px] text-neutral-400">{player.sog_per_game?.toFixed(1) ?? '—'}</td>
                                    {/* TOI/GP */}
                                    <td className="py-0 px-2 text-center font-mono text-[11px] text-neutral-400">{fmtToi(player.toi_per_game_all)}</td>
                                    {/* Per-60 rates */}
                                    <td className="py-0 px-2 text-center font-mono text-[11px] border-l border-emerald-400/15"
                                        style={{ color: per60Color(player.ind_xg_per60 ?? 0, player.is_forward ? 0.75 : 0.25) }}>
                                        {fmtRate(player.ind_xg_per60)}
                                    </td>
                                    <td className="py-0 px-2 text-center font-mono text-[11px]"
                                        style={{ color: per60Color(player.ev_xgf_per60 ?? 0, 2.5) }}>
                                        {fmtRate(player.ev_xgf_per60)}
                                    </td>
                                    {/* RAPM */}
                                    <td className="py-0 px-2 text-center font-mono text-[11px] font-bold border-l border-purple-400/15"
                                        style={{ color: rapmColor(player.rapm_net) }}>
                                        {fmtZ(player.rapm_net)}
                                    </td>
                                    {/* Impact components */}
                                    {(['impact_ev_off', 'impact_ev_def', 'impact_pp', 'impact_pk'] as SortKey[]).map(k => {
                                        const v = player[k] as number;
                                        return (
                                            <td key={k} className="py-0 px-2 text-center font-mono text-[11px]"
                                                style={{ color: impactColor(v) }}>
                                                {fmtZ(v)}
                                            </td>
                                        );
                                    })}
                                    {/* Total IMPACT */}
                                    <td className="py-0 px-2 text-center border-l border-cyan-400/20">
                                        <span
                                            className="font-black text-[12px] font-mono tabular-nums"
                                            style={{ color: impactColor(imp) }}
                                        >
                                            {fmtZ(imp)}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
