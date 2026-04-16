'use client';

import React from 'react';
import type { H2HGame, TeamInfo } from '@/app/new/page';

interface H2HGameLogProps {
  games: H2HGame[];
  t1: string;
  t2: string;
  c1: string;
  c2: string;
  teamsMap: Record<string, TeamInfo>;
}

export default function H2HGameLog({ games, t1, t2, c1, c2, teamsMap }: H2HGameLogProps) {
  if (games.length === 0) {
    return <div className="text-xs text-neutral-600 text-center py-2">No regular season matchups</div>;
  }

  // Tally
  let t1Wins = 0, t2Wins = 0;
  games.forEach(g => {
    const homeWon = g.homeGoals > g.awayGoals;
    if ((homeWon && g.homeTeam === t1) || (!homeWon && g.awayTeam === t1)) t1Wins++;
    else t2Wins++;
  });

  return (
    <div>
      {/* Summary */}
      <div className="flex items-center justify-center gap-3 mb-2">
        <div className="flex items-center gap-1">
          <img src={`/logos/${t1}.svg`} alt={t1} className="w-4 h-4" />
          <span className="text-sm font-bold" style={{ color: c1 }}>{t1Wins}</span>
        </div>
        <span className="text-xs text-neutral-600">–</span>
        <div className="flex items-center gap-1">
          <span className="text-sm font-bold" style={{ color: c2 }}>{t2Wins}</span>
          <img src={`/logos/${t2}.svg`} alt={t2} className="w-4 h-4" />
        </div>
      </div>

      {/* Game rows */}
      <div className="space-y-1">
        {games.map((g, i) => {
          const homeWon = g.homeGoals > g.awayGoals;
          const isOT = g.result.includes('OT') || g.result.includes('SO');
          const homeColor = g.homeTeam === t1 ? c1 : c2;
          const awayColor = g.awayTeam === t1 ? c1 : c2;

          return (
            <div key={i} className="flex items-center gap-1.5 text-xs py-1 px-1.5 rounded bg-white/[0.02]">
              <span className="text-neutral-500 w-14 shrink-0">
                {new Date(g.gameDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              <div className="flex items-center gap-0.5 flex-1 justify-end">
                <img src={`/logos/${g.awayTeam}.svg`} alt={g.awayTeam} className="w-3.5 h-3.5" />
                <span className="text-neutral-400 w-6">{g.awayTeam}</span>
              </div>
              <div className="flex items-center gap-0.5 w-14 justify-center">
                <span className={`text-sm font-bold ${!homeWon ? 'text-white' : 'text-neutral-500'}`} style={!homeWon ? { color: awayColor } : {}}>
                  {g.awayGoals}
                </span>
                <span className="text-neutral-600">–</span>
                <span className={`text-sm font-bold ${homeWon ? 'text-white' : 'text-neutral-500'}`} style={homeWon ? { color: homeColor } : {}}>
                  {g.homeGoals}
                </span>
                {isOT && <span className="text-[10px] text-neutral-600">{g.result.includes('SO') ? 'SO' : 'OT'}</span>}
              </div>
              <div className="flex items-center gap-0.5 flex-1">
                <span className="text-neutral-400 w-6">{g.homeTeam}</span>
                <img src={`/logos/${g.homeTeam}.svg`} alt={g.homeTeam} className="w-3.5 h-3.5" />
              </div>
              <span className="text-neutral-500 text-[10px] w-20 text-right truncate">
                {g.awayGoalie?.split(' ').pop()} / {g.homeGoalie?.split(' ').pop()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
