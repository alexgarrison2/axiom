'use client';

import { useState, useEffect, useMemo } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface SkaterData {
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
    // legacy fallback
    xgaa_per_game?: number;
}

type SortKey = keyof Pick<SkaterData,
    'games_played' | 'goals' | 'assists' | 'points' | 'sog_per_game' |
    'toi_per_game_all' | 'impact_ev_off' | 'impact_ev_def' |
    'impact_pp' | 'impact_pk' | 'impact_score'>;

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

function fmtToi(min: number | undefined): string {
    if (!min) return '—';
    const m = Math.floor(min);
    const s = Math.round((min - m) * 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

// ── NHL logo URL helper ───────────────────────────────────────────────────────
function logoUrl(tri: string): string {
    return `https://assets.nhle.com/logos/nhl/svg/${tri}_light.svg`;
}

// ── Column definition ─────────────────────────────────────────────────────────
const COLUMNS: { key: SortKey; label: string; title: string; align?: string }[] = [
    { key: 'games_played',     label: 'GP',      title: 'Games Played' },
    { key: 'goals',            label: 'G',       title: 'Goals' },
    { key: 'assists',          label: 'A',       title: 'Assists' },
    { key: 'points',           label: 'PTS',     title: 'Points' },
    { key: 'sog_per_game',     label: 'SOG/G',   title: 'Shots on Goal per Game' },
    { key: 'toi_per_game_all', label: 'TOI/GP',  title: 'Time on Ice per Game (all situations)' },
    { key: 'impact_ev_off',    label: 'EV OFF',  title: 'EV Offense z-score (relative xGF%, isolation metric)' },
    { key: 'impact_ev_def',    label: 'EV DEF',  title: 'EV Defense z-score (xGA suppression)' },
    { key: 'impact_pp',        label: 'PP',      title: 'Power Play impact z-score' },
    { key: 'impact_pk',        label: 'PK',      title: 'Penalty Kill impact z-score' },
    { key: 'impact_score',     label: 'IMPACT',  title: 'Composite position-weighted impact score (z-score)' },
];

const IMPACT_KEYS: SortKey[] = ['impact_ev_off', 'impact_ev_def', 'impact_pp', 'impact_pk', 'impact_score'];

// ── Component ─────────────────────────────────────────────────────────────────
export default function SkaterStatsTable() {
    const [data,    setData]    = useState<Record<string, SkaterData> | null>(null);
    const [loading, setLoading] = useState(true);
    const [posFilter, setPosFilter] = useState<'All' | 'F' | 'D'>('All');
    const [teamFilter, setTeamFilter] = useState<string>('All');
    const [sortKey, setSortKey] = useState<SortKey>('impact_score');
    const [sortAsc, setSortAsc] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        fetch('/data/player_impact.json')
            .then(r => r.json())
            .then((d: Record<string, SkaterData>) => { setData(d); setLoading(false); })
            .catch(() => setLoading(false));
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
                    <span className="text-neutral-500"> EV Off uses on/off isolation (relative xGF%).</span>
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
                                        ${IMPACT_KEYS.includes(col.key) ? 'text-cyan-600' : 'text-neutral-500'}
                                        ${col.key === sortKey ? 'text-white' : ''}
                                        ${col.key === 'impact_score' ? 'border-l border-cyan-400/30' : ''}`}
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
                                <tr key={`${player.team}-${player.name}`} className={`${rowBg} border-b border-white/5 hover:bg-white/5 transition-colors`}>
                                    {/* Rank */}
                                    <td className={`py-1.5 px-3 text-[9px] text-neutral-600 font-mono sticky left-0 z-10 ${rowBg || 'bg-[#050505]'}`}>
                                        {idx + 1}
                                    </td>
                                    {/* Player name + team logo */}
                                    <td className={`py-1.5 px-2 sticky left-6 z-10 ${rowBg || 'bg-[#050505]'}`}>
                                        <div className="flex items-center gap-2 min-w-0">
                                            <img
                                                src={logoUrl(player.team)}
                                                alt={player.team}
                                                className="w-5 h-5 object-contain shrink-0 opacity-80"
                                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                            <span className="font-semibold text-neutral-200 truncate text-[11px]">{player.name}</span>
                                        </div>
                                    </td>
                                    {/* Position */}
                                    <td className="py-1.5 px-2 text-center">
                                        <span className="text-[9px] font-mono text-neutral-500">{player.position}</span>
                                    </td>
                                    {/* GP */}
                                    <td className="py-1.5 px-2 text-center font-mono text-[11px] text-neutral-400">{player.games_played}</td>
                                    {/* G */}
                                    <td className="py-1.5 px-2 text-center font-mono text-[11px] text-neutral-300">{player.goals ?? '—'}</td>
                                    {/* A */}
                                    <td className="py-1.5 px-2 text-center font-mono text-[11px] text-neutral-300">{player.assists ?? '—'}</td>
                                    {/* PTS */}
                                    <td className="py-1.5 px-2 text-center font-mono text-[11px] font-bold text-white">{player.points ?? '—'}</td>
                                    {/* SOG/G */}
                                    <td className="py-1.5 px-2 text-center font-mono text-[11px] text-neutral-400">{player.sog_per_game?.toFixed(1) ?? '—'}</td>
                                    {/* TOI/GP */}
                                    <td className="py-1.5 px-2 text-center font-mono text-[11px] text-neutral-400">{fmtToi(player.toi_per_game_all)}</td>
                                    {/* Impact components */}
                                    {(['impact_ev_off', 'impact_ev_def', 'impact_pp', 'impact_pk'] as SortKey[]).map(k => {
                                        const v = player[k] as number;
                                        return (
                                            <td key={k} className="py-1.5 px-2 text-center font-mono text-[11px]"
                                                style={{ color: impactColor(v) }}>
                                                {fmtZ(v)}
                                            </td>
                                        );
                                    })}
                                    {/* Total IMPACT */}
                                    <td className="py-1.5 px-2 text-center border-l border-cyan-400/20">
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
