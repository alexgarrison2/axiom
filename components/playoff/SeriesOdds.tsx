'use client';

import React, { useMemo } from 'react';
import { teamColor, winProb, seriesBreak } from './PlayoffHub';
import type { PlayoffSeries, TeamInfo, TeamRatings } from '@/app/playoffs/page';

interface SeriesOddsProps {
  series: PlayoffSeries;
  teamsMap: Record<string, TeamInfo>;
  ratings: TeamRatings;
  triToCommon: Record<string, string>;
}

function oddsToImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function probToAmerican(p: number): string {
  if (p <= 0 || p >= 1) return '—';
  if (p >= 0.5) {
    const odds = Math.round(-100 * p / (1 - p));
    return String(odds);
  }
  const odds = Math.round(100 * (1 - p) / p);
  return '+' + odds;
}

export default function SeriesOdds({ series, teamsMap, ratings, triToCommon }: SeriesOddsProps) {
  const t1 = series.higherSeed.triCode;
  const t2 = series.lowerSeed.triCode;
  const c1 = teamColor(t1, teamsMap);
  const c2 = teamColor(t2, teamsMap);
  const name1 = triToCommon[t1] ?? t1;
  const name2 = triToCommon[t2] ?? t2;

  const r1 = ratings[name1];
  const r2 = ratings[name2];

  const modelBreak = useMemo(() => {
    if (!r1 || !r2) return null;
    const p = winProb(
      r1.xgf_5v5_rating, r1.xga_5v5_rating, r1.pp_rating / 100, r1.pk_rating / 100,
      r1.penalties_drawn_per_60, r1.penalties_taken_per_60, 0,
      r2.xgf_5v5_rating, r2.xga_5v5_rating, r2.pp_rating / 100, r2.pk_rating / 100,
      r2.penalties_drawn_per_60, r2.penalties_taken_per_60, 0,
    );
    return seriesBreak(p, series.seriesScore[0], series.seriesScore[1]);
  }, [r1, r2, series.seriesScore]);

  const vegasOdds1 = series.seriesOdds[t1];
  const vegasOdds2 = series.seriesOdds[t2];
  const vegasImplied1 = vegasOdds1 != null ? oddsToImplied(vegasOdds1) : null;
  const vegasImplied2 = vegasOdds2 != null ? oddsToImplied(vegasOdds2) : null;

  return (
    <div className="space-y-4">
      {/* Vegas Series Odds */}
      {vegasOdds1 != null && vegasOdds2 != null && (
        <div>
          <div className="text-sm font-semibold text-neutral-400 text-center mb-2">Vegas Series Price</div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 flex-1 justify-end">
              <img src={`/logos/${t1}.svg`} alt={t1} className="w-5 h-5" />
              <span className="text-base font-bold" style={{ color: c1 }}>{name1}</span>
            </div>
            <div className="flex gap-3 items-center">
              <div className="text-center">
                <div className="text-2xl font-black text-neutral-200 tabular-nums">
                  {vegasOdds1 > 0 ? '+' : ''}{vegasOdds1}
                </div>
                <div className="text-xs text-neutral-500">
                  {vegasImplied1 != null ? `${(vegasImplied1 * 100).toFixed(1)}%` : ''}
                </div>
              </div>
              <div className="text-xs text-neutral-600">vs</div>
              <div className="text-center">
                <div className="text-2xl font-black text-neutral-200 tabular-nums">
                  {vegasOdds2 > 0 ? '+' : ''}{vegasOdds2}
                </div>
                <div className="text-xs text-neutral-500">
                  {vegasImplied2 != null ? `${(vegasImplied2 * 100).toFixed(1)}%` : ''}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-base font-bold" style={{ color: c2 }}>{name2}</span>
              <img src={`/logos/${t2}.svg`} alt={t2} className="w-5 h-5" />
            </div>
          </div>
        </div>
      )}

      {/* xOdds & EV */}
      {modelBreak && vegasOdds1 != null && vegasOdds2 != null && (
        <div>
          <div className="text-sm font-semibold text-neutral-400 text-center mb-2">Model xOdds & Edge</div>
          <div className="flex items-center gap-3">
            <div className="flex-1 text-right">
              <div className="text-xl font-black text-blue-400 tabular-nums">
                {probToAmerican(modelBreak.hw / 100)}
              </div>
              {(() => {
                const ev1 = (modelBreak.hw / 100) - (vegasImplied1 ?? 0);
                return ev1 > 0 ? (
                  <div className="text-sm font-bold text-emerald-400">+{(ev1 * 100).toFixed(1)}% EV</div>
                ) : (
                  <div className="text-sm text-neutral-600">{(ev1 * 100).toFixed(1)}% EV</div>
                );
              })()}
            </div>
            <div className="text-xs text-neutral-600">xOdds</div>
            <div className="flex-1">
              <div className="text-xl font-black text-blue-400 tabular-nums">
                {probToAmerican(modelBreak.lw / 100)}
              </div>
              {(() => {
                const ev2 = (modelBreak.lw / 100) - (vegasImplied2 ?? 0);
                return ev2 > 0 ? (
                  <div className="text-sm font-bold text-emerald-400">+{(ev2 * 100).toFixed(1)}% EV</div>
                ) : (
                  <div className="text-sm text-neutral-600">{(ev2 * 100).toFixed(1)}% EV</div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Model Series Probabilities */}
      {modelBreak && (
        <div>
          <div className="text-sm font-semibold text-neutral-400 text-center mb-2">Model Series Win Probability</div>

          {/* Overall bar */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base font-black w-12 text-right tabular-nums" style={{ color: c1 }}>
              {modelBreak.hw.toFixed(1)}%
            </span>
            <div className="flex-1 h-5 rounded-full overflow-hidden bg-white/5 flex">
              <div
                className="h-full transition-all duration-500 rounded-l-full"
                style={{ width: `${modelBreak.hw}%`, backgroundColor: c1 }}
              />
              <div
                className="h-full transition-all duration-500 rounded-r-full"
                style={{ width: `${modelBreak.lw}%`, backgroundColor: c2 }}
              />
            </div>
            <span className="text-base font-black w-12 tabular-nums" style={{ color: c2 }}>
              {modelBreak.lw.toFixed(1)}%
            </span>
          </div>

          {/* Win in X games breakdown */}
          <div className="grid grid-cols-4 gap-2">
            {modelBreak.bars.map(bar => {
              const maxPct = Math.max(...modelBreak.bars.map(b => Math.max(b.h, b.l)));
              return (
                <div key={bar.g} className="text-center">
                  <div className="text-xs text-neutral-400 mb-1 font-medium">In {bar.g}</div>
                  <div className="h-12 flex flex-row justify-center items-end gap-0.5 relative">
                    <div
                      className="w-[45%] rounded-t transition-all duration-500"
                      style={{
                        height: bar.h > 0 ? `${bar.h / maxPct * 100}%` : '0%',
                        backgroundColor: c1,
                        opacity: 0.7,
                      }}
                    />
                    <div
                      className="w-[45%] rounded-t transition-all duration-500"
                      style={{
                        height: bar.l > 0 ? `${bar.l / maxPct * 100}%` : '0%',
                        backgroundColor: c2,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                  <div className="text-xs font-mono font-semibold mt-1">
                    <span style={{ color: c1 }}>{bar.h.toFixed(1)}%</span>
                    <span className="text-neutral-600"> / </span>
                    <span style={{ color: c2 }}>{bar.l.toFixed(1)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
