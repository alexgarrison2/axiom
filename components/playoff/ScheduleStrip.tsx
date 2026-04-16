'use client';

import React from 'react';
import { teamColor } from './PlayoffHub';
import type { PlayoffSeries, TeamInfo } from '@/app/new/page';

interface ScheduleStripProps {
  series: PlayoffSeries;
  teamsMap: Record<string, TeamInfo>;
}

export default function ScheduleStrip({ series, teamsMap }: ScheduleStripProps) {
  // Show all scheduled/played games, pad to 7 slots
  const slots = Array.from({ length: 7 }, (_, i) => series.games[i] ?? null);

  return (
    <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
      {slots.map((game, i) => {
        const isFinal = game?.status === 'final';
        const isNext = !isFinal && game?.status === 'scheduled' && i === series.games.findIndex(g => g.status === 'scheduled');

        return (
          <div
            key={i}
            className={`
              flex-1 min-w-[48px] rounded-lg px-1.5 py-1.5 text-center transition-all
              ${isNext
                ? 'bg-cyan-500/10 border border-cyan-400/30'
                : isFinal
                  ? 'bg-white/[0.04] border border-white/5'
                  : 'bg-white/[0.02] border border-white/[0.03]'
              }
            `}
          >
            <div className={`text-[9px] font-bold ${isNext ? 'text-cyan-400' : 'text-neutral-400'}`}>
              G{i + 1}
            </div>

            {game ? (
              <>
                <div className="text-[8px] text-neutral-500 mt-0.5">
                  {new Date(game.startTimeUTC).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
                <div className="text-[7px] text-neutral-600 mt-0.5">
                  @{game.homeTriCode}
                </div>
                {isFinal && game.score && (
                  <div className="text-[9px] font-bold text-neutral-300 mt-0.5">
                    {game.score[0]}–{game.score[1]}
                  </div>
                )}
                {game.tvNetwork !== 'TBD' && (
                  <div className="text-[7px] text-neutral-600 mt-0.5">{game.tvNetwork}</div>
                )}
              </>
            ) : (
              <div className="text-[8px] text-neutral-700 mt-1">TBD</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
