'use client';

import React, { useMemo, useState } from 'react';
import type { TeamRatings } from '@/app/playoffs/page';

// ─── Types ────────────────────────────────────────────────────────────────────
interface StatSplit {
  gf_per_game: number; ga_per_game: number;
  sf_per_game: number; sa_per_game: number;
  pts_pct: number; sv_pct: number;
  xg_delta: number; xg_pct: number;
  control: number;
  xgf_5v5: number; xga_5v5: number;
  pp: number; pk: number;
  pen_drawn: number; pen_taken: number;
}
interface TeamExtended {
  all: StatSplit;
  since_olympics: StatSplit | null;
  home: StatSplit | null;
  away: StatSplit | null;
  by_goalie: Record<string, StatSplit>;
}

type FilterMode = 'all' | 'since_olympics' | 'with_starter' | 'location';

interface TornadoChartProps {
  t1: string; t2: string;
  c1: string; c2: string;
  name1: string; name2: string;
  ratings: TeamRatings;
  triToCommon: Record<string, string>;
  extendedStats?: Record<string, TeamExtended>;
  goalieRatings?: Record<string, { gsax_per_game: number; games_played: number }>;
  t1Goalie?: string;
  t2Goalie?: string;
  nextGameHomeTriCode?: string;
}

// ─── Stat Definitions ─────────────────────────────────────────────────────────
interface StatDef {
  key: string;
  label: string;
  extKey: keyof StatSplit | null; // null = special-cased
  higherBetter: boolean;
  format: (v: number) => string;
}

const STATS: StatDef[] = [
  { key: 'gf',        label: 'GF/gm',         extKey: 'gf_per_game',  higherBetter: true,  format: v => v.toFixed(2) },
  { key: 'ga',        label: 'GA/gm',          extKey: 'ga_per_game',  higherBetter: false, format: v => v.toFixed(2) },
  { key: 'sf',        label: 'SF/gm',          extKey: 'sf_per_game',  higherBetter: true,  format: v => v.toFixed(1) },
  { key: 'sa',        label: 'SA/gm',          extKey: 'sa_per_game',  higherBetter: false, format: v => v.toFixed(1) },
  { key: 'xgf5v5',   label: 'xGF (5v5)',      extKey: 'xgf_5v5',     higherBetter: true,  format: v => v.toFixed(2) },
  { key: 'xga5v5',   label: 'xGA (5v5)',      extKey: 'xga_5v5',     higherBetter: false, format: v => v.toFixed(2) },
  { key: 'xgpct',    label: 'xG%',            extKey: 'xg_pct',      higherBetter: true,  format: v => (v * 100).toFixed(1) + '%' },
  { key: 'xgdelta',  label: 'xGΔ',            extKey: 'xg_delta',    higherBetter: true,  format: v => (v >= 0 ? '+' : '') + v.toFixed(2) },
  { key: 'ptspct',   label: 'Pts%',           extKey: 'pts_pct',     higherBetter: true,  format: v => (v * 100).toFixed(1) + '%' },
  { key: 'svpct',    label: 'SV%',            extKey: 'sv_pct',      higherBetter: true,  format: v => v.toFixed(3).replace('0.', '.') },
  { key: 'gsax',     label: 'GSAx/gm',        extKey: null,          higherBetter: true,  format: v => (v >= 0 ? '+' : '') + v.toFixed(2) },
  { key: 'control',  label: 'Control',        extKey: 'control',     higherBetter: true,  format: v => v.toFixed(3) },
  { key: 'pp',       label: 'PP%',            extKey: 'pp',          higherBetter: true,  format: v => v.toFixed(1) + '%' },
  { key: 'pk',       label: 'PK%',            extKey: 'pk',          higherBetter: true,  format: v => v.toFixed(1) + '%' },
  { key: 'pendrawn', label: 'Pen Drawn/gm',   extKey: 'pen_drawn',   higherBetter: true,  format: v => v.toFixed(2) },
  { key: 'pentaken', label: 'Pen Taken/gm ↓', extKey: 'pen_taken',   higherBetter: false, format: v => v.toFixed(2) },
];

function ordinal(n: number): string {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function TornadoChart({
  t1, t2, c1, c2, name1, name2,
  ratings, triToCommon,
  extendedStats, goalieRatings,
  t1Goalie, t2Goalie, nextGameHomeTriCode,
}: TornadoChartProps) {
  const [filter, setFilter] = useState<FilterMode>('all');

  // Determine location roles
  const t1IsHome = nextGameHomeTriCode === t1;

  // Get the correct split for a team given the active filter
  function getSplit(teamName: string, triCode: string, goalie?: string): StatSplit | null {
    const ext = extendedStats?.[teamName];
    if (!ext) return null;
    if (filter === 'since_olympics') return ext.since_olympics;
    if (filter === 'with_starter' && goalie) {
      return ext.by_goalie[goalie] ?? ext.all;
    }
    if (filter === 'location') {
      const isHome = triCode === t1 ? t1IsHome : !t1IsHome;
      return isHome ? ext.home : ext.away;
    }
    return ext.all;
  }

  // GSAx from goalie ratings (not split-dependent)
  function getGsax(goalie?: string): number | null {
    if (!goalie || !goalieRatings?.[goalie]) return null;
    return goalieRatings[goalie].gsax_per_game;
  }

  // Build per-stat values and percentile rankings
  const { statRows, totalTeams } = useMemo(() => {
    if (!extendedStats) return { statRows: [], totalTeams: 32 };

    const allTeamNames = Object.keys(extendedStats);
    const n = allTeamNames.length;

    const rows = STATS.map(stat => {
      // Collect all team values for ranking
      const teamVals: { name: string; tri: string; val: number }[] = [];

      if (stat.extKey === null) {
        // GSAx — rank across all known goalies' gsax_per_game
        // Use league-wide goalie rankings
        const allGsax = Object.entries(goalieRatings ?? {});
        const sortedGsax = [...allGsax].sort((a, b) => a[1].gsax_per_game - b[1].gsax_per_game);
        const n2 = sortedGsax.length;

        const getGsaxPct = (name?: string) => {
          if (!name || !goalieRatings?.[name]) return 50;
          const idx = sortedGsax.findIndex(([g]) => g === name);
          return idx === -1 ? 50 : (idx / Math.max(n2 - 1, 1)) * 100;
        };
        const getGsaxRank = (name?: string) => {
          if (!name || !goalieRatings?.[name]) return null;
          const idx = sortedGsax.findIndex(([g]) => g === name);
          return idx === -1 ? null : n2 - idx; // rank 1 = best
        };

        const v1 = getGsax(t1Goalie);
        const v2 = getGsax(t2Goalie);
        const p1 = getGsaxPct(t1Goalie);
        const p2 = getGsaxPct(t2Goalie);
        const r1 = getGsaxRank(t1Goalie);
        const r2 = getGsaxRank(t2Goalie);

        return { stat, val1: v1 ?? 0, val2: v2 ?? 0, pct1: p1, pct2: p2, rank1: r1, rank2: r2, totalN: n2 };
      }

      for (const teamName of allTeamNames) {
        const tri = triToCommon
          ? Object.entries(triToCommon).find(([, nm]) => nm === teamName)?.[0] ?? ''
          : '';

        let split: StatSplit | null = null;
        if (filter === 'since_olympics') split = extendedStats[teamName]?.since_olympics ?? null;
        else if (filter === 'location') {
          // For location filter, rank home-role teams in home split and away-role teams in away split
          // For simplicity: rank all teams in 'all' split for cross-team comparison
          split = extendedStats[teamName]?.all ?? null;
        }
        else if (filter === 'with_starter') split = extendedStats[teamName]?.all ?? null; // fallback
        else split = extendedStats[teamName]?.all ?? null;

        if (!split) continue;
        const val = split[stat.extKey!] as number;
        if (val == null || isNaN(val)) continue;
        teamVals.push({ name: teamName, tri, val });
      }

      // Sort best → worst
      teamVals.sort((a, b) => stat.higherBetter ? b.val - a.val : a.val - b.val);

      const getRank = (nm: string) => teamVals.findIndex(t => t.name === nm) + 1;
      const getPct = (nm: string) => {
        const idx = teamVals.findIndex(t => t.name === nm);
        if (idx === -1) return 50;
        return stat.higherBetter
          ? ((n - 1 - idx) / (n - 1)) * 100
          : (idx / (n - 1)) * 100;
      };

      // Get the actual split-specific value for t1/t2
      const s1 = getSplit(name1, t1, t1Goalie);
      const s2 = getSplit(name2, t2, t2Goalie);
      const val1 = s1 ? (s1[stat.extKey!] as number) : 0;
      const val2 = s2 ? (s2[stat.extKey!] as number) : 0;

      // For percentile: for location mode, use the actual split value to compute rank
      let pct1: number, pct2: number, rank1: number | null, rank2: number | null;
      if (filter === 'location') {
        // Recompute against actual split
        const makeVals = (splitKey: 'home' | 'away') => {
          return allTeamNames
            .map(nm => ({ name: nm, val: (extendedStats[nm]?.[splitKey] as StatSplit | null)?.[stat.extKey!] as number ?? NaN }))
            .filter(x => !isNaN(x.val))
            .sort((a, b) => stat.higherBetter ? b.val - a.val : a.val - b.val);
        };
        const homeVals = makeVals('home');
        const awayVals = makeVals('away');
        const hLen = homeVals.length;
        const aLen = awayVals.length;

        const getLocPct = (vals: typeof homeVals, nm: string, len: number) => {
          const idx = vals.findIndex(t => t.name === nm);
          if (idx === -1) return 50;
          return stat.higherBetter ? ((len - 1 - idx) / (len - 1)) * 100 : (idx / (len - 1)) * 100;
        };
        const getLocRank = (vals: typeof homeVals, nm: string) => {
          const idx = vals.findIndex(t => t.name === nm); return idx === -1 ? null : idx + 1;
        };

        if (t1IsHome) {
          pct1 = getLocPct(homeVals, name1, hLen); rank1 = getLocRank(homeVals, name1);
          pct2 = getLocPct(awayVals, name2, aLen); rank2 = getLocRank(awayVals, name2);
        } else {
          pct1 = getLocPct(awayVals, name1, aLen); rank1 = getLocRank(awayVals, name1);
          pct2 = getLocPct(homeVals, name2, hLen); rank2 = getLocRank(homeVals, name2);
        }
      } else {
        pct1 = getPct(name1); rank1 = getRank(name1) || null;
        pct2 = getPct(name2); rank2 = getRank(name2) || null;
      }

      return { stat, val1, val2, pct1, pct2, rank1, rank2, totalN: n };
    });

    return { statRows: rows, totalTeams: n };
  }, [extendedStats, filter, name1, name2, t1, t2, t1Goalie, t2Goalie, t1IsHome, goalieRatings]);

  const filterButtons: { key: FilterMode; label: string; available: boolean }[] = [
    { key: 'all', label: 'Full Season', available: true },
    { key: 'since_olympics', label: 'Since Olympics', available: !!extendedStats?.[name1]?.since_olympics },
    { key: 'with_starter', label: 'With Starter', available: !!(t1Goalie && t2Goalie && extendedStats) },
    { key: 'location', label: 'Location', available: !!nextGameHomeTriCode },
  ];

  // Fallback if no extendedStats — use original ratings-based rendering
  if (!extendedStats) {
    return <FallbackTornado t1={t1} t2={t2} c1={c1} c2={c2} name1={name1} name2={name2} ratings={ratings} />;
  }

  const locationLabel = nextGameHomeTriCode
    ? `${triToCommon[nextGameHomeTriCode] ?? nextGameHomeTriCode} hosts`
    : '';

  return (
    <div>
      {/* Team headers */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1.5">
          <img src={`/logos/${t1}.svg`} alt={t1} className="w-4 h-4" />
          <span className="text-xs font-semibold" style={{ color: c1 }}>{name1}</span>
          {filter === 'location' && (
            <span className="text-[9px] text-neutral-600">{t1IsHome ? '(H)' : '(A)'}</span>
          )}
          {filter === 'with_starter' && t1Goalie && (
            <span className="text-[9px] text-neutral-600 truncate max-w-[70px]">{t1Goalie.split(' ').at(-1)}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {filter === 'with_starter' && t2Goalie && (
            <span className="text-[9px] text-neutral-600 truncate max-w-[70px]">{t2Goalie.split(' ').at(-1)}</span>
          )}
          {filter === 'location' && (
            <span className="text-[9px] text-neutral-600">{!t1IsHome ? '(H)' : '(A)'}</span>
          )}
          <span className="text-xs font-semibold" style={{ color: c2 }}>{name2}</span>
          <img src={`/logos/${t2}.svg`} alt={t2} className="w-4 h-4" />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {filterButtons.map(btn => (
          <button
            key={btn.key}
            onClick={() => btn.available && setFilter(btn.key)}
            disabled={!btn.available}
            className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-all ${
              filter === btn.key
                ? 'bg-white/15 text-white'
                : btn.available
                  ? 'text-neutral-500 hover:text-neutral-300 hover:bg-white/5'
                  : 'text-neutral-700 cursor-not-allowed'
            }`}
          >
            {btn.label}
          </button>
        ))}
        {filter === 'location' && locationLabel && (
          <span className="text-[9px] text-neutral-600 self-center ml-1">{locationLabel}</span>
        )}
      </div>

      {/* Stat rows */}
      <div className="space-y-2">
        {statRows.map(row => {
          if (!row) return null;
          const { stat, val1, val2, pct1, pct2, rank1, rank2, totalN } = row;
          const t1Better = pct1 > pct2;

          return (
            <div key={stat.key}>
              {/* Label — tighter spacing */}
              <div className="text-[11px] text-neutral-400 text-center mb-0.5 leading-none">{stat.label}</div>
              <div className="flex items-center gap-1">
                {/* Left value + rank */}
                <div className="w-14 text-right shrink-0">
                  <span className={`text-xs font-mono ${t1Better ? 'text-white font-bold' : 'text-neutral-500'}`}>
                    {stat.format(val1)}
                  </span>
                  {rank1 != null && (
                    <div className="text-[9px] text-neutral-600 tabular-nums leading-none mt-0.5">
                      {ordinal(rank1)}/{totalN}
                    </div>
                  )}
                </div>

                {/* Left bar (t1) */}
                <div className="flex-1 flex justify-end">
                  <div
                    className="h-3 rounded-l relative overflow-hidden"
                    style={{
                      width: `${Math.max(pct1, 3)}%`,
                      backgroundColor: t1Better ? c1 : `${c1}40`,
                    }}
                  >
                    {t1Better && (
                      <div className="absolute inset-0 opacity-25"
                        style={{ background: `linear-gradient(90deg, transparent, ${c1})` }} />
                    )}
                  </div>
                </div>

                {/* Center divider */}
                <div className="w-px h-4 bg-white/10 shrink-0" />

                {/* Right bar (t2) */}
                <div className="flex-1">
                  <div
                    className="h-3 rounded-r relative overflow-hidden"
                    style={{
                      width: `${Math.max(pct2, 3)}%`,
                      backgroundColor: !t1Better ? c2 : `${c2}40`,
                    }}
                  >
                    {!t1Better && (
                      <div className="absolute inset-0 opacity-25"
                        style={{ background: `linear-gradient(-90deg, transparent, ${c2})` }} />
                    )}
                  </div>
                </div>

                {/* Right value + rank */}
                <div className="w-14 shrink-0">
                  <span className={`text-xs font-mono ${!t1Better ? 'text-white font-bold' : 'text-neutral-500'}`}>
                    {stat.format(val2)}
                  </span>
                  {rank2 != null && (
                    <div className="text-[9px] text-neutral-600 tabular-nums leading-none mt-0.5">
                      {ordinal(rank2)}/{totalN}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="text-[10px] text-neutral-600 text-center mt-3">
        Bar width = league percentile (0–100). Bold = advantage.
      </div>
    </div>
  );
}

// ─── Fallback if no extended stats ────────────────────────────────────────────
function FallbackTornado({ t1, t2, c1, c2, name1, name2, ratings }: {
  t1: string; t2: string; c1: string; c2: string;
  name1: string; name2: string; ratings: TeamRatings;
}) {
  const r1 = ratings[name1];
  const r2 = ratings[name2];
  if (!r1 || !r2) return <div className="text-xs text-neutral-600 text-center py-2">Team ratings not available</div>;
  return <div className="text-xs text-neutral-600 text-center py-2">Extended stats loading…</div>;
}
