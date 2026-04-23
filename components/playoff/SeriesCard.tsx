'use client';

import React from 'react';
import { teamColor, winProb, seriesBreak } from './PlayoffHub';
import type { PlayoffSeries, TeamInfo, TeamRatings } from '@/app/playoffs/page';

interface SeriesCardProps {
  series: PlayoffSeries;
  teamsMap: Record<string, TeamInfo>;
  isSelected: boolean;
  onClick: () => void;
  ratings: TeamRatings;
  triToCommon: Record<string, string>;
}

export default function SeriesCard({ series, teamsMap, isSelected, onClick, ratings, triToCommon }: SeriesCardProps) {
  const t1 = series.higherSeed.triCode;
  const t2 = series.lowerSeed.triCode;
  const c1 = teamColor(t1, teamsMap);
  const c2 = teamColor(t2, teamsMap);
  const leading = series.seriesScore[0] > series.seriesScore[1] ? 1 : series.seriesScore[1] > series.seriesScore[0] ? 2 : 0;

  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
  const hasGameToday = series.games.some(g => g.status === 'scheduled' && g.date === today);

  const probBar = React.useMemo(() => {
    const r1 = ratings[triToCommon[t1] ?? t1];
    const r2 = ratings[triToCommon[t2] ?? t2];
    if (!r1 || !r2) return null;
    const p = winProb(
      r1.xgf_5v5_rating, r1.xga_5v5_rating, r1.pp_rating / 100, r1.pk_rating / 100,
      r1.penalties_drawn_per_60, r1.penalties_taken_per_60, 0,
      r2.xgf_5v5_rating, r2.xga_5v5_rating, r2.pp_rating / 100, r2.pk_rating / 100,
      r2.penalties_drawn_per_60, r2.penalties_taken_per_60, 0,
    );
    const { hw, lw } = seriesBreak(p, series.seriesScore[0], series.seriesScore[1]);
    return { hw, lw };
  }, [ratings, triToCommon, t1, t2, series.seriesScore]);

  return (
    <button
      onClick={onClick}
      className={`
        relative w-full rounded-xl px-2 py-2.5 transition-all duration-200
        backdrop-blur-md border overflow-hidden
        ${isSelected
          ? 'bg-white/[0.08] border-cyan-400/40 shadow-[0_0_12px_rgba(0,243,255,0.15)]'
          : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05] hover:border-white/10'
        }
      `}
    >
      {hasGameToday && (
        <div className="absolute right-0 top-2 bottom-2 w-[3px] rounded-full bg-white/60 shadow-[0_0_8px_2px_rgba(255,255,255,0.3)]" />
      )}
      <div className="flex items-center justify-between">
        {/* Team 1 logo + seed */}
        <div className="flex flex-col items-center gap-0.5">
          <img src={`/logos/${t1}.svg`} alt={t1} className="w-9 h-9" />
          <span className="text-[8px] uppercase tracking-wider text-neutral-500 font-medium">{series.higherSeed.seed}</span>
        </div>

        {/* Series score */}
        <div className="flex items-center gap-1">
          <span className={`text-xl font-black tabular-nums ${leading === 1 ? 'text-white' : 'text-neutral-500'}`}>
            {series.seriesScore[0]}
          </span>
          <span className="text-sm text-neutral-600 font-light">–</span>
          <span className={`text-xl font-black tabular-nums ${leading === 2 ? 'text-white' : 'text-neutral-500'}`}>
            {series.seriesScore[1]}
          </span>
        </div>

        {/* Team 2 logo + seed */}
        <div className="flex flex-col items-center gap-0.5">
          <img src={`/logos/${t2}.svg`} alt={t2} className="w-9 h-9" />
          <span className="text-[8px] uppercase tracking-wider text-neutral-500 font-medium">{series.lowerSeed.seed}</span>
        </div>
      </div>

      {/* Probability bar */}
      {probBar && (
        <div className="mt-2 h-1 w-full rounded-full overflow-hidden flex">
          <div
            className="h-full rounded-l-full transition-all duration-500"
            style={{ width: `${probBar.hw}%`, backgroundColor: c1, opacity: 0.7 }}
          />
          <div
            className="h-full rounded-r-full transition-all duration-500"
            style={{ width: `${probBar.lw}%`, backgroundColor: c2, opacity: 0.7 }}
          />
        </div>
      )}
    </button>
  );
}
