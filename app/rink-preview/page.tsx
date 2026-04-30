'use client';

import React, { useState } from 'react';
import HockeyRink, { type RinkShot } from '@/components/HockeyRink';

// Seed a realistic fake shot distribution for preview
function makeShots(): RinkShot[] {
  const rng = (seed: number) => {
    let s = seed;
    return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
  };
  const rand = rng(42);
  const shots: RinkShot[] = [];

  // DAL shots (right side attack, x > 0)
  for (let i = 0; i < 28; i++) {
    const x =  20 + rand() * 68;
    const y = (rand() - 0.5) * 70;
    const dist = Math.sqrt((89 - x) ** 2 + y ** 2);
    const xG = Math.max(0.01, Math.min(0.95, 0.45 - dist * 0.004 + rand() * 0.12));
    shots.push({
      eventId: `dal-${i}`, playerId: `8000${i}`, teamTriCode: 'DAL',
      x, y, xG, isGoal: rand() < 0.08, eventType: 'Shot on goal',
      playerName: ['J. Robertson', 'W. Johnston', 'M. Duchene', 'J. Pavelski'][i % 4],
      strength: '5v5', distance: dist, angle: Math.abs(Math.atan2(y, 89 - x) * 180 / Math.PI),
      period: Math.ceil(rand() * 3), timeSeconds: Math.floor(rand() * 1200),
    });
  }

  // MIN shots (left side attack, x < 0)
  for (let i = 0; i < 24; i++) {
    const x = -(20 + rand() * 68);
    const y = (rand() - 0.5) * 70;
    const dist = Math.sqrt((89 + x) ** 2 + y ** 2);
    const xG = Math.max(0.01, Math.min(0.95, 0.45 - dist * 0.004 + rand() * 0.12));
    shots.push({
      eventId: `min-${i}`, playerId: `9000${i}`, teamTriCode: 'MIN',
      x, y, xG, isGoal: rand() < 0.06, eventType: 'Shot on goal',
      playerName: ['K. Fiala', 'J. Eriksson Ek', 'M. Rossi', 'M. Zuccarello'][i % 4],
      strength: '5v5', distance: dist, angle: Math.abs(Math.atan2(y, 89 + x) * 180 / Math.PI),
      period: Math.ceil(rand() * 3), timeSeconds: Math.floor(rand() * 1200),
    });
  }

  return shots;
}

const SHOTS = makeShots();

export default function RinkPreview() {
  const [hovered, setHovered] = useState<RinkShot | null>(null);

  return (
    <div className="min-h-screen bg-[#0f1923] p-6 flex flex-col items-center gap-6">
      <h1 className="text-2xl font-black text-white tracking-widest uppercase">HockeyRink Preview</h1>

      {/* Full rink with shots */}
      <div className="w-full max-w-4xl rounded-2xl border border-blue-900/50 bg-[#0f2132] p-4 shadow-2xl">
        <div className="text-xs font-black uppercase tracking-widest text-blue-300/60 mb-3">Full Rink · Shot Map</div>
        <div className="relative">
          <HockeyRink
            shots={SHOTS}
            homeTriCode="DAL"
            awayTriCode="MIN"
            homeColor="#007B4B"
            awayColor="#154734"
            onShotHover={setHovered}
          />
          {hovered && (
            <div className="absolute left-1/2 bottom-4 -translate-x-1/2 rounded-xl bg-[#12283b]/95 border border-blue-700/80 shadow-2xl px-4 py-2.5 text-center pointer-events-none backdrop-blur-md min-w-[260px]">
              <div className="text-sm font-black text-white">{hovered.teamTriCode} · {hovered.isGoal ? '⚽ GOAL' : hovered.eventType}</div>
              <div className="text-xs text-neutral-300 mt-0.5">{hovered.playerName}</div>
              <div className="text-xs text-neutral-400 mt-0.5">
                xG {(hovered.xG * 100).toFixed(0)}% · {hovered.distance?.toFixed(0)} ft · {hovered.angle?.toFixed(0)}°
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs font-bold text-neutral-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#007B4B] inline-block" /> DAL (right attack)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#154734] inline-block" /> MIN (left attack)
          </span>
          <span className="ml-auto">Dot size = xG · Yellow ring = Goal · Hover for details</span>
        </div>
      </div>

      {/* Rink without shots — just the surface */}
      <div className="w-full max-w-4xl rounded-2xl border border-blue-900/50 bg-[#0f2132] p-4 shadow-2xl">
        <div className="text-xs font-black uppercase tracking-widest text-blue-300/60 mb-3">Rink Only · No Shots</div>
        <HockeyRink homeTriCode="MIN" awayTriCode="DAL" />
      </div>
    </div>
  );
}
