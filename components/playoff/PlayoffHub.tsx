'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SeriesCard from './SeriesCard';
import SeriesOverview from './SeriesOverview';
import MatchupCard from '@/components/MatchupCard';
import type { PlayoffSeries, TeamInfo, TeamRatings, H2HGame } from '@/app/new/page';
import type { GamePrediction } from '@/utils/data';

// ─── Vivid color overrides (same as PlayoffBracket) ──────────────────────────
const VIVID: Record<string, string> = {
  EDM:'#FF4C00', WPG:'#5b8ee8', TOR:'#5b8ee8', TBL:'#3278d4',
  VAN:'#00943D', LAK:'#A8AEB5', SEA:'#7de0de', STL:'#5b8ee8',
  BUF:'#0066CC', PIT:'#FCB514', CBJ:'#CE1126', WSH:'#C8102E',
  NJD:'#CE1126', DET:'#CE1126', MIN:'#3a8f5a', COL:'#9B4060',
  NYR:'#0083C6', PHI:'#F74902', CAR:'#CE1126', FLA:'#C8102E',
  OTT:'#e21219', BOS:'#FCB514', CGY:'#D2001C', VGK:'#B4975A',
  ANA:'#F47A38', SJS:'#007889', NSH:'#FFB81C', CHI:'#CF0A2C',
  DAL:'#006847', MTL:'#AF1E2D', UTA:'#71AFE5',
};
export function teamColor(tri: string, teamsMap: Record<string, TeamInfo>): string {
  return VIVID[tri] ?? teamsMap[tri]?.color1 ?? '#888';
}

// ─── Series probability math (from PlayoffBracket) ───────────────────────────
function fac(n: number): number { let r=1; for(let i=2;i<=n;i++) r*=i; return r; }
function choose(n: number, k: number) { return fac(n)/(fac(k)*fac(n-k)); }
function poisson(k: number, l: number) { return (l**k*Math.exp(-l))/fac(k); }

export function winProb(
  homeXgf5v5: number, homeXga5v5: number, homePpEff: number, homePkEff: number,
  homePenDrawn: number, homePenTaken: number, homeGoalie: number,
  awayXgf5v5: number, awayXga5v5: number, awayPpEff: number, awayPkEff: number,
  awayPenDrawn: number, awayPenTaken: number, awayGoalie: number,
): number {
  const AVG=2.35, HI=0.16, ST=0.18;
  const h5=(homeXgf5v5*awayXga5v5)/AVG;
  const a5=(awayXgf5v5*homeXga5v5)/AVG;
  const hO=(homePenDrawn+awayPenTaken)/2;
  const aO=(awayPenDrawn+homePenTaken)/2;
  const hX=Math.max(0.1,h5+HI+hO*ST*homePpEff*awayPkEff-awayGoalie*0.5);
  const aX=Math.max(0.1,a5+aO*ST*awayPpEff*homePkEff-homeGoalie*0.5);
  let w=0,l=0,t=0;
  for(let h=0;h<12;h++) for(let a=0;a<12;a++){
    const p=poisson(h,hX)*poisson(a,aX);
    if(h>a)w+=p; else if(a>h)l+=p; else t+=p;
  }
  const tot=w+l+t;
  return (w/tot)+(t/tot)*(hX/(hX+aX));
}

export interface SeriesBreakResult { hw: number; lw: number; bars:{g:number;h:number;l:number}[] }
export function seriesBreak(p: number): SeriesBreakResult {
  let hw=0, lw=0;
  const bars=[4,5,6,7].map(g=>{
    const ways=choose(g-1,3);
    const ph=ways*p**4*(1-p)**(g-4);
    const pl=ways*(1-p)**4*p**(g-4);
    hw+=ph; lw+=pl;
    return {g, h:ph*100, l:pl*100};
  });
  return {hw:hw*100, lw:lw*100, bars};
}

interface PlayoffHubProps {
  series: PlayoffSeries[];
  teamsMap: Record<string, TeamInfo>;
  ratings: TeamRatings;
  triToCommon: Record<string, string>;
  h2hGames: Record<string, H2HGame[]>;
  lineups: Record<string, any>;
  playerNews: Record<string, any[]>;
  playoffPlayerNews: Record<string, any[]>;
  seriesPredictions: Record<string, GamePrediction>;
}

export default function PlayoffHub({ series, teamsMap, ratings, triToCommon, h2hGames, lineups, playerNews, playoffPlayerNews, seriesPredictions }: PlayoffHubProps) {
  const [selectedId, setSelectedId] = useState<string>(series[0]?.seriesId ?? '');

  const selected = useMemo(() => series.find(s => s.seriesId === selectedId) ?? series[0], [series, selectedId]);

  // East order: A1-WC1, A2-A3, M1-WC2, M2-M3
  const EAST_ORDER = ['ATL1', 'ATL2', 'MET1', 'MET2'];
  const seriesGroup = (s: PlayoffSeries): string => {
    const seed = s.higherSeed.seed;
    if (seed.startsWith('A')) return seed[1] === '1' ? 'ATL1' : 'ATL2';
    if (seed.startsWith('M')) return seed[1] === '1' ? 'MET1' : 'MET2';
    if (seed.startsWith('C')) return seed[1] === '1' ? 'CEN1' : 'CEN2';
    if (seed.startsWith('P')) return seed[1] === '1' ? 'PAC1' : 'PAC2';
    return 'Z';
  };
  const eastSeries = series.filter(s => s.conference === 'East').sort((a, b) => EAST_ORDER.indexOf(seriesGroup(a)) - EAST_ORDER.indexOf(seriesGroup(b)));
  const westSeries = series.filter(s => s.conference === 'West');

  const h2hKey = selected ? `${selected.higherSeed.triCode}_${selected.lowerSeed.triCode}` : '';
  const prediction = selected ? seriesPredictions[selected.seriesId] : undefined;

  return (
    <div className="h-full flex">
      {/* ─── Left Sidebar ─── */}
      <div className="w-[180px] min-w-[180px] border-r border-white/5 flex flex-col py-3 px-2 gap-1 overflow-y-auto scrollbar-hide">
        <div className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold px-1 mb-1">Eastern</div>
        {eastSeries.map((s, i) => (
          <motion.div key={s.seriesId} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}>
            <SeriesCard
              series={s}
              teamsMap={teamsMap}
              isSelected={s.seriesId === selectedId}
              onClick={() => setSelectedId(s.seriesId)}
            />
          </motion.div>
        ))}
        <div className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold px-1 mt-3 mb-1">Western</div>
        {westSeries.map((s, i) => (
          <motion.div key={s.seriesId} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: (eastSeries.length + i) * 0.05 }}>
            <SeriesCard
              series={s}
              teamsMap={teamsMap}
              isSelected={s.seriesId === selectedId}
              onClick={() => setSelectedId(s.seriesId)}
            />
          </motion.div>
        ))}
      </div>

      {/* ─── Main Content ─── */}
      <div className="flex-1 flex gap-3 p-3 overflow-hidden">
        <AnimatePresence mode="wait">
          {selected && (
            <motion.div
              key={selected.seriesId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex gap-3 min-w-0"
            >
              {/* Center: Game 1 Matchup Card */}
              <div className="flex-1 min-w-0 overflow-y-auto scrollbar-hide">
                {prediction ? (
                  <MatchupCard prediction={prediction} defaultExpanded={true} />
                ) : (
                  <div className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-8 text-center text-neutral-600 text-sm">
                    Prediction not available
                  </div>
                )}
              </div>

              {/* Right: Series Overview */}
              <div className="w-[540px] min-w-[540px] overflow-y-auto scrollbar-hide">
                <SeriesOverview
                  series={selected}
                  teamsMap={teamsMap}
                  ratings={ratings}
                  triToCommon={triToCommon}
                  h2hGames={h2hGames[h2hKey] ?? []}
                  lineups={lineups}
                  playerNews={playerNews}
                  playoffPlayerNews={playoffPlayerNews}
                  prediction={prediction}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
