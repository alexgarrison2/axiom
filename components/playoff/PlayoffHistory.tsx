'use client';

import React from 'react';

interface GameResult {
  winner: string; // triCode
  ot: number;     // 0=reg, 1=OT, 2=2OT, etc.
}

interface HistoricalSeries {
  year: number;
  round: number;
  teams: string[];
  games: GameResult[];
}

interface PlayoffHistoryProps {
  t1: string;
  t2: string;
  teamsMap: Record<string, { logoUrl: string; color1: string; name: string }>;
  history: HistoricalSeries[];
}

const ROUND_LABELS: Record<number, string> = {
  1: 'R1',
  2: 'R2',
  3: 'CF',
  4: 'SCF',
};

function otLabel(ot: number): string {
  if (!ot) return '';
  if (ot === 1) return 'OT';
  return `${ot}OT`;
}

export default function PlayoffHistory({ t1, t2, teamsMap, history }: PlayoffHistoryProps) {
  if (!history || history.length === 0) {
    return (
      <div className="text-sm text-neutral-500 text-center py-3 italic">
        These teams have never met in the playoffs.
      </div>
    );
  }

  const logo1 = teamsMap[t1]?.logoUrl ?? `/logos/${t1}.svg`;
  const logo2 = teamsMap[t2]?.logoUrl ?? `/logos/${t2}.svg`;

  return (
    <div className="space-y-2">
      {history.map((s) => {
        const roundLabel = ROUND_LABELS[s.round] ?? `R${s.round}`;
        return (
          <div
            key={`${s.year}-${s.round}`}
            className="flex items-center gap-4 bg-white/[0.03] rounded-xl px-3 py-2.5"
          >
            {/* Year + Round label */}
            <div className="text-center shrink-0 w-14">
              <div className="text-[15px] font-black text-neutral-200 leading-none">{s.year}</div>
              <div className="text-[11px] font-bold text-neutral-500 mt-0.5">{roundLabel}</div>
            </div>

            {/* Game logos strip */}
            <div className="flex items-center gap-1 flex-wrap">
              {s.games.map((game, idx) => {
                const isT1 = game.winner === t1;
                const logoSrc = isT1 ? logo1 : logo2;
                const ot = otLabel(game.ot);
                return (
                  <div key={idx} className="flex flex-col items-center">
                    <img
                      src={logoSrc}
                      alt={game.winner}
                      className="w-9 h-9 object-contain drop-shadow-md"
                    />
                    {ot && (
                      <span className="text-[9px] font-bold text-neutral-500 -mt-0.5 leading-none">
                        {ot}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
