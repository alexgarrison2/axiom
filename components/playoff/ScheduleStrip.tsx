'use client';

import React from 'react';
import { teamColor } from './PlayoffHub';
import type { PlayoffSeries, TeamInfo } from '@/app/playoffs/page';

interface ScheduleStripProps {
  series: PlayoffSeries;
  teamsMap: Record<string, TeamInfo>;
}

function formatGameTime(startTimeUTC: string, startTimeCT?: string): string {
  if (startTimeCT) return startTimeCT;
  try {
    const d = new Date(startTimeUTC);
    // Convert to Central Time
    const ct = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
    return ct;
  } catch {
    return '';
  }
}

function formatDate(startTimeUTC: string): string {
  try {
    const d = new Date(startTimeUTC);
    return d.toLocaleDateString('en-US', {
      timeZone: 'America/Chicago',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

const NETWORK_COLORS: Record<string, string> = {
  ESPN: '#CC0000',
  ESPN2: '#CC0000',
  ABC: '#000000',
  TNT: '#ffffff',
  TBS: '#0057A8',
  MAX: '#002BE7',
  SN: '#E31837',
  TVAS: '#003DA5',
};

export default function ScheduleStrip({ series, teamsMap }: ScheduleStripProps) {
  const slots = Array.from({ length: 7 }, (_, i) => series.games[i] ?? null);
  const nextGameIdx = series.games.findIndex(g => g.status === 'scheduled');

  return (
    <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
      {slots.map((game, i) => {
        const isFinal = game?.status === 'final';
        const isNext = !isFinal && i === nextGameIdx;
        const network = game?.tvNetwork && game.tvNetwork !== 'TBD' ? game.tvNetwork : null;
        const networkColor = network ? (NETWORK_COLORS[network] ?? '#555') : null;

        return (
          <div
            key={i}
            className={`
              flex-1 min-w-[58px] rounded-lg px-1.5 py-1.5 text-center transition-all
              ${isNext
                ? 'bg-cyan-500/10 border border-cyan-400/30'
                : isFinal
                  ? 'bg-white/[0.04] border border-white/5'
                  : 'bg-white/[0.02] border border-white/[0.03]'
              }
            `}
          >
            <div className={`text-xs font-bold ${isNext ? 'text-cyan-400' : 'text-neutral-400'}`}>
              G{i + 1}
            </div>

            {game ? (
              <>
                <div className="text-[10px] text-neutral-500 mt-0.5">
                  {formatDate(game.startTimeUTC)}
                </div>
                <div className="text-[10px] text-neutral-600 mt-0.5">
                  @{game.homeTriCode}
                </div>
                {!isFinal && (
                  <div className={`text-[9px] mt-0.5 font-mono ${isNext ? 'text-cyan-500' : 'text-neutral-600'}`}>
                    {formatGameTime(game.startTimeUTC, (game as any).startTimeCT)}
                  </div>
                )}
                {isFinal && game.score && (
                  <div className="text-xs font-bold text-neutral-300 mt-0.5">
                    {game.score[0]}–{game.score[1]}
                  </div>
                )}
                {network && (
                  <div
                    className="text-[8px] font-bold mt-0.5 px-1 py-0.5 rounded inline-block"
                    style={{
                      backgroundColor: networkColor + '22',
                      color: networkColor === '#ffffff' ? '#ffffff' : networkColor!,
                      border: `1px solid ${networkColor}44`,
                    }}
                  >
                    {network}
                  </div>
                )}
              </>
            ) : (
              <div className="text-[10px] text-neutral-700 mt-1">TBD</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
