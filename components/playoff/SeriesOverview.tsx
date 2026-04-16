'use client';

import React from 'react';
import ScheduleStrip from './ScheduleStrip';
import H2HGameLog from './H2HGameLog';
import TornadoChart from './TornadoChart';
import SeriesOdds from './SeriesOdds';
import LineupGrid from '@/components/LineupGrid';
import { teamColor } from './PlayoffHub';
import type { PlayoffSeries, TeamInfo, TeamRatings, H2HGame } from '@/app/new/page';

interface SeriesOverviewProps {
  series: PlayoffSeries;
  teamsMap: Record<string, TeamInfo>;
  ratings: TeamRatings;
  triToCommon: Record<string, string>;
  h2hGames: H2HGame[];
  lineups: Record<string, any>;
  playerNews: Record<string, any[]>;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold mb-2">
      {children}
    </div>
  );
}

export default function SeriesOverview({ series, teamsMap, ratings, triToCommon, h2hGames, lineups, playerNews }: SeriesOverviewProps) {
  const t1 = series.higherSeed.triCode;
  const t2 = series.lowerSeed.triCode;
  const c1 = teamColor(t1, teamsMap);
  const c2 = teamColor(t2, teamsMap);
  const name1 = triToCommon[t1] ?? t1;
  const name2 = triToCommon[t2] ?? t2;

  return (
    <div className="space-y-3">
      {/* Series Title */}
      <div className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-3">
        <div className="flex items-center justify-center gap-3">
          <img src={`/logos/${t1}.svg`} alt={t1} className="w-8 h-8" />
          <div className="text-center">
            <div className="text-xs font-bold text-neutral-300">Series Preview</div>
            <div className="text-[10px] text-neutral-500">
              ({series.higherSeed.seed}) {name1} vs ({series.lowerSeed.seed}) {name2}
            </div>
          </div>
          <img src={`/logos/${t2}.svg`} alt={t2} className="w-8 h-8" />
        </div>
      </div>

      {/* Schedule Strip */}
      <div className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-3">
        <SectionHeader>Series Schedule</SectionHeader>
        <ScheduleStrip series={series} teamsMap={teamsMap} />
      </div>

      {/* Series Odds & Probabilities — moved up */}
      <div className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-3">
        <SectionHeader>Series Odds & Model Probabilities</SectionHeader>
        <SeriesOdds
          series={series}
          teamsMap={teamsMap}
          ratings={ratings}
          triToCommon={triToCommon}
        />
      </div>

      {/* H2H Game Log */}
      {h2hGames.length > 0 && (
        <div className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-3">
          <SectionHeader>Regular Season Matchups</SectionHeader>
          <H2HGameLog games={h2hGames} t1={t1} t2={t2} c1={c1} c2={c2} teamsMap={teamsMap} />
        </div>
      )}

      {/* Tornado Chart */}
      <div className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-3">
        <SectionHeader>Team Stats Comparison</SectionHeader>
        <TornadoChart
          t1={t1} t2={t2} c1={c1} c2={c2}
          name1={name1} name2={name2}
          ratings={ratings}
          triToCommon={triToCommon}
        />
      </div>

      {/* Lineups — using real LineupGrid component */}
      <div className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-3">
        <SectionHeader>Projected Lineups</SectionHeader>
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <img src={`/logos/${t1}.svg`} alt={t1} className="w-4 h-4" />
              <span className="text-[10px] font-semibold" style={{ color: c1 }}>{name1}</span>
            </div>
            <LineupGrid lineup={lineups[t1]} triCode={t1} />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <img src={`/logos/${t2}.svg`} alt={t2} className="w-4 h-4" />
              <span className="text-[10px] font-semibold" style={{ color: c2 }}>{name2}</span>
            </div>
            <LineupGrid lineup={lineups[t2]} triCode={t2} />
          </div>
        </div>
      </div>

      {/* Team News */}
      <div className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-3">
        <SectionHeader>Team News</SectionHeader>
        <TeamNewsSection t1={t1} t2={t2} c1={c1} c2={c2} playerNews={playerNews} teamsMap={teamsMap} />
      </div>
    </div>
  );
}

// ─── Team News ───────────────────────────────────────────────────────────────
function TeamNewsSection({ t1, t2, c1, c2, playerNews, teamsMap }: {
  t1: string; t2: string; c1: string; c2: string;
  playerNews: Record<string, any[]>; teamsMap: Record<string, TeamInfo>;
}) {
  const news1 = playerNews[t1] ?? [];
  const news2 = playerNews[t2] ?? [];

  if (news1.length === 0 && news2.length === 0) {
    return <div className="text-xs text-neutral-600 text-center py-2">No recent news</div>;
  }

  return (
    <div className="space-y-2">
      {[{ tri: t1, color: c1, news: news1 }, { tri: t2, color: c2, news: news2 }].map(({ tri, color, news }) =>
        news.length > 0 && (
          <div key={tri}>
            <div className="flex items-center gap-1 mb-1">
              <img src={`/logos/${tri}.svg`} alt={tri} className="w-3.5 h-3.5" />
              <span className="text-[10px] font-semibold" style={{ color }}>{teamsMap[tri]?.commonName ?? tri}</span>
            </div>
            {news.slice(0, 3).map((item: any, i: number) => (
              <div key={i} className="text-[9px] text-neutral-400 ml-5 mb-0.5">
                <span className="text-neutral-300">{item.player}</span> — {item.news}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
