'use client';

import React, { useMemo, useState } from 'react';
import type { TeamRatings } from '@/app/new/page';

interface TornadoChartProps {
  t1: string;
  t2: string;
  c1: string;
  c2: string;
  name1: string;
  name2: string;
  ratings: TeamRatings;
  triToCommon: Record<string, string>;
}

interface StatDef {
  key: string;
  label: string;
  field: string;
  higherBetter: boolean;
  format: (v: number) => string;
}

const STATS: StatDef[] = [
  { key: 'xgf5v5', label: 'xGF/60 (5v5)', field: 'xgf_5v5_rating', higherBetter: true, format: v => v.toFixed(2) },
  { key: 'xga5v5', label: 'xGA/60 (5v5)', field: 'xga_5v5_rating', higherBetter: false, format: v => v.toFixed(2) },
  { key: 'pp', label: 'PP%', field: 'pp_rating', higherBetter: true, format: v => v.toFixed(1) + '%' },
  { key: 'pk', label: 'PK%', field: 'pk_rating', higherBetter: true, format: v => v.toFixed(1) + '%' },
  { key: 'pendrawn', label: 'Pen Drawn/60', field: 'penalties_drawn_per_60', higherBetter: true, format: v => v.toFixed(2) },
  { key: 'pentaken', label: 'Pen Taken/60', field: 'penalties_taken_per_60', higherBetter: false, format: v => v.toFixed(2) },
];

export default function TornadoChart({ t1, t2, c1, c2, name1, name2, ratings, triToCommon }: TornadoChartProps) {
  // Compute percentiles for all 32 teams on each stat
  const percentiles = useMemo(() => {
    const allTeams = Object.entries(ratings).map(([name, r]) => ({ name, ...r }));
    const result: Record<string, Record<string, number>> = {};

    STATS.forEach(stat => {
      const values = allTeams.map(t => ({ name: t.name, val: (t as any)[stat.field] as number }));
      // Sort: for higherBetter, higher rank = higher percentile; for lowerBetter, lower value = higher percentile
      values.sort((a, b) => stat.higherBetter ? a.val - b.val : b.val - a.val);
      values.forEach((v, i) => {
        if (!result[v.name]) result[v.name] = {};
        result[v.name][stat.key] = (i / (values.length - 1)) * 100;
      });
    });

    return result;
  }, [ratings]);

  const r1 = ratings[name1];
  const r2 = ratings[name2];

  if (!r1 || !r2) {
    return <div className="text-xs text-neutral-600 text-center py-2">Team ratings not available</div>;
  }

  return (
    <div>
      {/* Team headers */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1">
          <img src={`/logos/${t1}.svg`} alt={t1} className="w-4 h-4" />
          <span className="text-xs font-semibold" style={{ color: c1 }}>{name1}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-semibold" style={{ color: c2 }}>{name2}</span>
          <img src={`/logos/${t2}.svg`} alt={t2} className="w-4 h-4" />
        </div>
      </div>

      {/* Stat rows */}
      <div className="space-y-1.5">
        {STATS.map(stat => {
          const val1 = (r1 as any)[stat.field] as number;
          const val2 = (r2 as any)[stat.field] as number;
          const pct1 = percentiles[name1]?.[stat.key] ?? 50;
          const pct2 = percentiles[name2]?.[stat.key] ?? 50;
          const t1Better = pct1 > pct2;

          return (
            <div key={stat.key}>
              <div className="text-xs text-neutral-500 text-center mb-0.5">{stat.label}</div>
              <div className="flex items-center gap-1">
                {/* Left value */}
                <span className={`text-xs w-12 text-right font-mono ${t1Better ? 'text-white font-bold' : 'text-neutral-500'}`}>
                  {stat.format(val1)}
                </span>

                {/* Left bar (t1) */}
                <div className="flex-1 flex justify-end">
                  <div className="h-3 rounded-l relative overflow-hidden" style={{
                    width: `${Math.max(pct1, 3)}%`,
                    backgroundColor: t1Better ? c1 : `${c1}40`,
                  }}>
                    {t1Better && (
                      <div className="absolute inset-0 opacity-30" style={{
                        background: `linear-gradient(90deg, transparent, ${c1})`,
                      }} />
                    )}
                  </div>
                </div>

                {/* Divider */}
                <div className="w-px h-4 bg-white/10"></div>

                {/* Right bar (t2) */}
                <div className="flex-1">
                  <div className="h-3 rounded-r relative overflow-hidden" style={{
                    width: `${Math.max(pct2, 3)}%`,
                    backgroundColor: !t1Better ? c2 : `${c2}40`,
                  }}>
                    {!t1Better && (
                      <div className="absolute inset-0 opacity-30" style={{
                        background: `linear-gradient(-90deg, transparent, ${c2})`,
                      }} />
                    )}
                  </div>
                </div>

                {/* Right value */}
                <span className={`text-xs w-12 text-left font-mono ${!t1Better ? 'text-white font-bold' : 'text-neutral-500'}`}>
                  {stat.format(val2)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="text-[10px] text-neutral-600 text-center mt-2">
        Bar width = league percentile (0–100). Bold = advantage.
      </div>
    </div>
  );
}
