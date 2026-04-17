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
  home_since_olympics: StatSplit | null;
  away_since_olympics: StatSplit | null;
  by_goalie: Record<string, StatSplit>;
  by_goalie_since_olympics: Record<string, StatSplit>;
}

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
  extKey: keyof StatSplit | null;
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
  // Filter state: time period (radio) + independent modifiers (toggles)
  const [sinceOlympics, setSinceOlympics] = useState(false);
  const [withStarter, setWithStarter] = useState(false);
  const [locationMode, setLocationMode] = useState(false);

  const t1IsHome = nextGameHomeTriCode === t1;

  // Pick the right split key based on active filters
  function getSplit(teamName: string, triCode: string, goalie?: string): StatSplit | null {
    const ext = extendedStats?.[teamName];
    if (!ext) return null;
    const isHome = triCode === t1 ? t1IsHome : !t1IsHome;

    // Priority: location > with_starter > time_period
    if (locationMode && withStarter) {
      // Location takes precedence when both are on
      const key = sinceOlympics
        ? (isHome ? 'home_since_olympics' : 'away_since_olympics')
        : (isHome ? 'home' : 'away');
      return (ext as any)[key] ?? ext.all;
    }
    if (locationMode) {
      const key = sinceOlympics
        ? (isHome ? 'home_since_olympics' : 'away_since_olympics')
        : (isHome ? 'home' : 'away');
      return (ext as any)[key] ?? ext.all;
    }
    if (withStarter && goalie) {
      const byGoalie = sinceOlympics ? ext.by_goalie_since_olympics : ext.by_goalie;
      return byGoalie[goalie] ?? (sinceOlympics ? ext.since_olympics : ext.all) ?? ext.all;
    }
    return sinceOlympics ? (ext.since_olympics ?? ext.all) : ext.all;
  }

  const hasStarters = !!(t1Goalie && t2Goalie);
  const hasLocation = !!nextGameHomeTriCode;

  // Compute stat rows with correct percentile rankings
  const statRows = useMemo(() => {
    if (!extendedStats) return [];
    const allTeamNames = Object.keys(extendedStats);
    const n = allTeamNames.length;

    return STATS.map(stat => {
      // ── GSAx: special goalie-based stat ──────────────────────────────────
      if (stat.extKey === null) {
        const allGsax = Object.entries(goalieRatings ?? {});
        // Sort ascending so we can find idx and compute rank correctly
        const sorted = [...allGsax].sort((a, b) => a[1].gsax_per_game - b[1].gsax_per_game);
        const n2 = sorted.length;
        const getInfo = (goalie?: string) => {
          if (!goalie || !goalieRatings?.[goalie]) return { val: 0, pct: 50, rank: null as number | null };
          const val = goalieRatings[goalie].gsax_per_game;
          const idx = sorted.findIndex(([g]) => g === goalie);
          // idx=0 is worst (lowest), idx=n2-1 is best (highest) for higherBetter
          const pct = idx === -1 ? 50 : (idx / Math.max(n2 - 1, 1)) * 100;
          const rank = idx === -1 ? null : n2 - idx; // rank 1 = best
          return { val, pct, rank };
        };
        const i1 = getInfo(t1Goalie); const i2 = getInfo(t2Goalie);
        return { stat, val1: i1.val, val2: i2.val, pct1: i1.pct, pct2: i2.pct, rank1: i1.rank, rank2: i2.rank, totalN: n2 };
      }

      // ── Regular stats ──────────────────────────────────────────────────────
      // Compute league-wide ranking using the same contextual split
      const teamVals: { name: string; val: number }[] = [];
      for (const teamName of allTeamNames) {
        const ext = extendedStats[teamName];
        if (!ext) continue;
        // For ranking, use the same split type but we don't know each team's home/away role
        // → rank using the base time-period split (all or since_olympics), not location-specific
        const rankSplit = sinceOlympics ? (ext.since_olympics ?? ext.all) : ext.all;
        if (!rankSplit) continue;
        const val = rankSplit[stat.extKey] as number;
        if (val == null || isNaN(val)) continue;
        teamVals.push({ name: teamName, val });
      }

      // Sort: best → worst. After sorting, idx=0 is always best.
      teamVals.sort((a, b) => stat.higherBetter ? b.val - a.val : a.val - b.val);

      // Percentile: idx=0 (best) → 100%, idx=n-1 (worst) → 0%
      const getPct = (nm: string) => {
        const idx = teamVals.findIndex(t => t.name === nm);
        if (idx === -1 || teamVals.length <= 1) return 50;
        return ((teamVals.length - 1 - idx) / (teamVals.length - 1)) * 100;
      };
      const getRank = (nm: string) => {
        const idx = teamVals.findIndex(t => t.name === nm);
        return idx === -1 ? null : idx + 1;
      };

      // Get actual split-specific value for t1/t2
      const s1 = getSplit(name1, t1, t1Goalie);
      const s2 = getSplit(name2, t2, t2Goalie);
      const val1 = s1 ? (s1[stat.extKey] as number ?? 0) : 0;
      const val2 = s2 ? (s2[stat.extKey] as number ?? 0) : 0;

      // For percentile display: recompute if using location/starter splits
      let pct1: number, pct2: number, rank1: number | null, rank2: number | null;
      if (locationMode) {
        // Rank in the appropriate home/away distribution
        const makeLocVals = (splitKey: string) =>
          allTeamNames
            .map(nm => {
              const ext = extendedStats[nm];
              const sp = sinceOlympics
                ? ((ext as any)[splitKey + '_since_olympics'] ?? ext?.since_olympics ?? ext?.all)
                : ((ext as any)[splitKey] ?? ext?.all);
              const val = sp?.[stat.extKey!] as number ?? NaN;
              return { name: nm, val };
            })
            .filter(x => !isNaN(x.val))
            .sort((a, b) => stat.higherBetter ? b.val - a.val : a.val - b.val);

        const hVals = makeLocVals('home');
        const aVals = makeLocVals('away');

        const locPct = (vals: typeof hVals, nm: string) => {
          const idx = vals.findIndex(t => t.name === nm);
          if (idx === -1 || vals.length <= 1) return 50;
          return ((vals.length - 1 - idx) / (vals.length - 1)) * 100;
        };
        const locRank = (vals: typeof hVals, nm: string) => {
          const idx = vals.findIndex(t => t.name === nm);
          return idx === -1 ? null : idx + 1;
        };

        pct1 = locPct(t1IsHome ? hVals : aVals, name1);
        rank1 = locRank(t1IsHome ? hVals : aVals, name1);
        pct2 = locPct(!t1IsHome ? hVals : aVals, name2);
        rank2 = locRank(!t1IsHome ? hVals : aVals, name2);
      } else {
        pct1 = getPct(name1); rank1 = getRank(name1);
        pct2 = getPct(name2); rank2 = getRank(name2);
      }

      return { stat, val1, val2, pct1, pct2, rank1, rank2, totalN: n };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extendedStats, sinceOlympics, withStarter, locationMode, name1, name2, t1, t2, t1Goalie, t2Goalie, t1IsHome, goalieRatings]);

  if (!extendedStats) {
    return <div className="text-xs text-neutral-600 text-center py-2">Extended stats loading…</div>;
  }

  const locationLabel = nextGameHomeTriCode
    ? `${triToCommon[nextGameHomeTriCode] ?? nextGameHomeTriCode} home`
    : '';

  return (
    <div>
      {/* Team headers with large logos */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <img src={`/logos/${t1}.svg`} alt={t1} className="w-11 h-11" />
          <div>
            <span className="text-sm font-bold" style={{ color: c1 }}>{name1}</span>
            {locationMode && (
              <div className="text-[9px] text-neutral-500">{t1IsHome ? 'Home' : 'Away'}</div>
            )}
            {withStarter && !locationMode && t1Goalie && (
              <div className="text-[9px] text-neutral-500">{t1Goalie.split(' ').slice(-1)[0]}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <span className="text-sm font-bold" style={{ color: c2 }}>{name2}</span>
            {locationMode && (
              <div className="text-[9px] text-neutral-500 text-right">{!t1IsHome ? 'Home' : 'Away'}</div>
            )}
            {withStarter && !locationMode && t2Goalie && (
              <div className="text-[9px] text-neutral-500 text-right">{t2Goalie.split(' ').slice(-1)[0]}</div>
            )}
          </div>
          <img src={`/logos/${t2}.svg`} alt={t2} className="w-11 h-11" />
        </div>
      </div>

      {/* Filter controls */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 mb-3 items-center">
        {/* Time period — radio */}
        <div className="flex gap-1">
          {[
            { key: false, label: 'Full Season' },
            { key: true, label: 'Since Olympics' },
          ].map(opt => (
            <button
              key={String(opt.key)}
              onClick={() => setSinceOlympics(opt.key)}
              className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-all ${
                sinceOlympics === opt.key
                  ? 'bg-white/15 text-white'
                  : 'text-neutral-500 hover:text-neutral-300 hover:bg-white/5'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="w-px h-3 bg-white/10" />

        {/* Modifier toggles */}
        <button
          onClick={() => hasStarters && setWithStarter(v => !v)}
          disabled={!hasStarters}
          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-all ${
            withStarter
              ? 'bg-white/15 text-white ring-1 ring-white/20'
              : hasStarters
                ? 'text-neutral-500 hover:text-neutral-300 hover:bg-white/5'
                : 'text-neutral-700 cursor-not-allowed'
          }`}
        >
          With Starter
        </button>
        <button
          onClick={() => hasLocation && setLocationMode(v => !v)}
          disabled={!hasLocation}
          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-all ${
            locationMode
              ? 'bg-white/15 text-white ring-1 ring-white/20'
              : hasLocation
                ? 'text-neutral-500 hover:text-neutral-300 hover:bg-white/5'
                : 'text-neutral-700 cursor-not-allowed'
          }`}
        >
          Location
        </button>
        {locationMode && locationLabel && (
          <span className="text-[9px] text-neutral-600">{locationLabel}</span>
        )}
      </div>

      {/* Stat rows */}
      <div className="space-y-2">
        {statRows.map(row => {
          if (!row) return null;
          const { stat, val1, val2, pct1, pct2, rank1, rank2, totalN } = row;
          // t1Better: whichever team has HIGHER percentile (percentile = 100 means best, regardless of direction)
          const t1Better = pct1 >= pct2;

          return (
            <div key={stat.key}>
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

      <div className="text-[10px] text-neutral-600 text-center mt-3">
        Bar width = league percentile (0–100). Bold = advantage.
      </div>
    </div>
  );
}
