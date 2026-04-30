'use client';

import React, { useMemo, useState } from 'react';
import { Activity, Map as MapIcon, Table2, UserRoundSearch } from 'lucide-react';
import type { PlayoffGameAnalysis, PlayoffShotEvent, PlayoffPlayerGameStat, TeamInfo } from '@/app/playoffs/page';
import HockeyRink, { type RinkShot } from '@/components/HockeyRink';

type View = 'rink' | 'flow' | 'share' | 'tables';
type EventFilter = 'all' | 'goals' | 'sog' | 'missed' | 'blocked';

const VIEW_OPTIONS: Array<{ id: View; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'rink', label: 'Shot Map', icon: MapIcon },
  { id: 'flow', label: 'xG Flow', icon: Activity },
  { id: 'share', label: 'Player Share', icon: UserRoundSearch },
  { id: 'tables', label: 'Tables', icon: Table2 },
];

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '-';
  return n.toFixed(digits);
}

function pct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '-';
  return `${(n * 100).toFixed(digits)}%`;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function gameClock(period: number, seconds: number): string {
  const label = period <= 3 ? `${period}${period === 1 ? 'st' : period === 2 ? 'nd' : 'rd'}` : `OT${period - 3}`;
  return `${label} ${clock(seconds)}`;
}

function shotClock(shot: PlayoffShotEvent, isSeries: boolean): string {
  const base = gameClock(shot.period, shot.timeSeconds);
  return isSeries && shot.gameNumber ? `G${shot.gameNumber} ${base}` : base;
}

function headshot(playerId: string): string {
  return `https://assets.nhle.com/mugs/nhl/latest/${playerId}.png`;
}

function shareValue(p: PlayoffPlayerGameStat): number {
  const total = p.xGFor + p.xGAgainst;
  return total > 0 ? p.xGFor / total : 0.5;
}

function filterShots(
  shots: PlayoffShotEvent[],
  strength: string,
  eventFilter: EventFilter,
  period: string,
  playerQuery: string,
): PlayoffShotEvent[] {
  const q = playerQuery.trim().toLowerCase();
  return shots.filter(s => {
    if (strength !== 'All' && s.strength !== strength) return false;
    if (period !== 'All' && String(s.period) !== period) return false;
    if (q && !s.playerName.toLowerCase().includes(q)) return false;
    if (eventFilter === 'goals') return s.isGoal;
    if (eventFilter === 'sog') return s.eventType === 'Shot on goal' || s.eventType === 'Goal';
    if (eventFilter === 'missed') return s.eventType === 'Missed shot';
    if (eventFilter === 'blocked') return s.eventType === 'Blocked shot';
    return true;
  });
}

function teamColor(tri: string, teamsMap: Record<string, TeamInfo>): string {
  return teamsMap[tri]?.color1 || '#22c55e';
}

/** Parse a hex color to [r, g, b] 0-255 */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Perceived color distance (0–1). Values below ~0.15 are near-identical. */
function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2) / 441.7;
}

/**
 * Pick colors for home and away so they are visually distinct.
 * Falls back to color2 for the away team if both color1s are too similar.
 */
function teamColors(
  homeTri: string,
  awayTri: string,
  teamsMap: Record<string, TeamInfo>,
): { homeColor: string; awayColor: string } {
  const homeC1 = teamsMap[homeTri]?.color1 || '#22c55e';
  const awayC1  = teamsMap[awayTri]?.color1  || '#3b82f6';
  const awayC2  = teamsMap[awayTri]?.color2  || awayC1;
  // If the two primary colors are too close, use the away team's secondary
  const awayColor = colorDistance(homeC1, awayC1) < 0.18 ? awayC2 : awayC1;
  return { homeColor: homeC1, awayColor };
}

function strengthLabel(strength: string): string {
  if (strength === 'EmptyNet') return 'Empty net';
  const match = strength.match(/^(\d)v(\d)$/);
  if (!match) return strength;
  const forSkaters = Number(match[1]);
  const againstSkaters = Number(match[2]);
  if (forSkaters > againstSkaters) return `${strength} PP`;
  if (forSkaters < againstSkaters) return `${strength} SH`;
  return strength;
}

function shotElapsed(shot: PlayoffShotEvent): number {
  return shot.elapsedSeconds ?? ((shot.period - 1) * 1200 + shot.timeSeconds);
}

function attackingX(shot: PlayoffShotEvent, fallbackGame: PlayoffGameAnalysis): number {
  const awayTri = shot.awayTriCode || fallbackGame.awayTriCode;
  return shot.teamTriCode === awayTri ? -Math.abs(shot.x) : Math.abs(shot.x);
}

function aggregateSeries(games: PlayoffGameAnalysis[]): PlayoffGameAnalysis | null {
  if (games.length === 0) return null;
  const base = games[0];
  const teamOrder = [base.awayTriCode, base.homeTriCode];
  const summaries = new Map<string, PlayoffGameAnalysis['homeSummary']>();
  const players = new Map<string, PlayoffPlayerGameStat>();
  const goalies = new Map<string, PlayoffGameAnalysis['goalies'][number]>();
  const shots: PlayoffShotEvent[] = [];

  for (const tri of teamOrder) {
    summaries.set(tri, { triCode: tri, goals: 0, shots: 0, attempts: 0, xG: 0, xG5v5: 0, ppGoals: 0, ppOpps: 0, hits: 0 });
  }

  games.forEach((game, gameIndex) => {
    for (const summary of [game.awaySummary, game.homeSummary]) {
      const current = summaries.get(summary.triCode) ?? { triCode: summary.triCode, goals: 0, shots: 0, attempts: 0, xG: 0, xG5v5: 0, ppGoals: 0, ppOpps: 0, hits: 0 };
      current.goals += summary.goals;
      current.shots += summary.shots;
      current.attempts += summary.attempts;
      current.xG += summary.xG;
      current.xG5v5 += summary.xG5v5;
      current.ppGoals += summary.ppGoals;
      current.ppOpps += summary.ppOpps;
      current.hits += summary.hits;
      summaries.set(summary.triCode, current);
    }

    game.shots.forEach(shot => {
      shots.push({
        ...shot,
        elapsedSeconds: gameIndex * 3600 + ((shot.period - 1) * 1200 + shot.timeSeconds),
        gameNumber: shot.gameNumber ?? game.gameNumber,
      });
    });

    game.players.forEach(player => {
      const key = player.playerId;
      const current = players.get(key) ?? { ...player, toiSeconds: 0, goals: 0, shots: 0, attempts: 0, ixG: 0, xGFor: 0, xGAgainst: 0, goalsFor: 0, goalsAgainst: 0 };
      current.toiSeconds += player.toiSeconds;
      current.goals += player.goals;
      current.shots += player.shots;
      current.attempts += player.attempts;
      current.ixG += player.ixG;
      current.xGFor += player.xGFor;
      current.xGAgainst += player.xGAgainst;
      current.goalsFor += player.goalsFor;
      current.goalsAgainst += player.goalsAgainst;
      // Sum enriched boxscore fields
      if (player.assists != null)      current.assists      = (current.assists      ?? 0) + player.assists;
      if (player.pim != null)          current.pim          = (current.pim          ?? 0) + player.pim;
      if (player.hits != null)         current.hits         = (current.hits         ?? 0) + player.hits;
      if (player.blockedShots != null) current.blockedShots = (current.blockedShots ?? 0) + player.blockedShots;
      if (player.faceoffWins != null)  current.faceoffWins  = (current.faceoffWins  ?? 0) + player.faceoffWins;
      if (player.faceoffLosses != null) current.faceoffLosses = (current.faceoffLosses ?? 0) + player.faceoffLosses;
      if (player.ppToiSeconds != null) current.ppToiSeconds = (current.ppToiSeconds ?? 0) + player.ppToiSeconds;
      if (player.pkToiSeconds != null) current.pkToiSeconds = (current.pkToiSeconds ?? 0) + player.pkToiSeconds;
      players.set(key, current);
    });

    game.goalies.forEach(goalie => {
      const key = `${goalie.teamTriCode}-${goalie.name}`;
      const current = goalies.get(key) ?? { ...goalie, toiSeconds: 0, shotsAgainst: 0, fenwickAgainst: 0, goalsAgainst: 0, xGA: 0, gsax: 0, savePct: 0, expectedSavePct: 0, deltaSavePct: 0 };
      current.toiSeconds += goalie.toiSeconds;
      current.shotsAgainst += goalie.shotsAgainst;
      current.fenwickAgainst += goalie.fenwickAgainst;
      current.goalsAgainst += goalie.goalsAgainst;
      current.xGA += goalie.xGA;
      current.gsax += goalie.gsax;
      current.savePct = current.shotsAgainst > 0 ? (current.shotsAgainst - current.goalsAgainst) / current.shotsAgainst : 0;
      current.expectedSavePct = current.shotsAgainst > 0 ? (current.shotsAgainst - current.xGA) / current.shotsAgainst : 0;
      current.deltaSavePct = current.savePct - current.expectedSavePct;
      goalies.set(key, current);
    });
  });

  const awaySummary = summaries.get(base.awayTriCode) ?? base.awaySummary;
  const homeSummary = summaries.get(base.homeTriCode) ?? base.homeSummary;
  return {
    ...base,
    gameId: 'series',
    gameNumber: 0,
    date: `${games.length} games`,
    awayScore: awaySummary.goals,
    homeScore: homeSummary.goals,
    awaySummary,
    homeSummary,
    shots: shots.sort((a, b) => shotElapsed(a) - shotElapsed(b)),
    players: Array.from(players.values()).sort((a, b) => b.toiSeconds - a.toiSeconds),
    goalies: Array.from(goalies.values()).sort((a, b) => b.toiSeconds - a.toiSeconds),
    maxGameSeconds: games.length * 3600,
  };
}

export default function GameAnalysis({ games, teamsMap }: { games: PlayoffGameAnalysis[]; teamsMap: Record<string, TeamInfo> }) {
  const [gameId, setGameId] = useState(games[0]?.gameId ?? '');
  const [view, setView] = useState<View>('rink');
  const [strength, setStrength] = useState('All');
  const [eventFilter, setEventFilter] = useState<EventFilter>('all');
  const [period, setPeriod] = useState('All');
  const [playerQuery, setPlayerQuery] = useState('');

  const seriesGame = useMemo(() => aggregateSeries(games), [games]);
  const game = useMemo(() => gameId === 'series' ? seriesGame : (games.find(g => g.gameId === gameId) ?? games[0]), [games, gameId, seriesGame]);
  const isSeries = game?.gameId === 'series';
  const strengthOptions = useMemo(() => {
    const vals = new Set<string>();
    game?.shots.forEach(s => vals.add(s.strength));
    return ['All', ...Array.from(vals).sort()];
  }, [game]);
  const periodOptions = useMemo(() => {
    const vals = new Set<string>();
    if (isSeries) return ['All'];
    game?.shots.forEach(s => vals.add(String(s.period)));
    return ['All', ...Array.from(vals).sort((a, b) => Number(a) - Number(b))];
  }, [game, isSeries]);

  const filteredShots = useMemo(() => {
    if (!game) return [];
    return filterShots(game.shots, strength, eventFilter, isSeries ? 'All' : period, playerQuery);
  }, [game, strength, eventFilter, period, playerQuery, isSeries]);

  if (!game) {
    return (
      <section className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-6 text-center">
        <div className="text-sm font-black text-neutral-300">Played Game Analysis</div>
        <div className="text-xs text-neutral-500 mt-1">No completed games with shot data are available yet.</div>
      </section>
    );
  }

  const { homeColor, awayColor } = teamColors(game.homeTriCode, game.awayTriCode, teamsMap);

  return (
    <section className="backdrop-blur-xl bg-[#0f2132]/90 border border-blue-900/60 rounded-2xl p-3 sm:p-4 shadow-[0_0_40px_rgba(37,99,235,0.08)]">
      <div className="flex flex-col min-[1500px]:flex-row min-[1500px]:items-center min-[1500px]:justify-between gap-3 mb-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-blue-300/70 font-semibold">Played Game Analysis</div>
          <div className="flex items-center gap-2 mt-1">
            <img src={`/logos/${game.awayTriCode}.svg`} alt={game.awayTriCode} className="w-7 h-7" />
            <span className="text-xl font-black text-neutral-100 tabular-nums">{game.awayScore}</span>
            <span className="text-neutral-600 font-black">-</span>
            <span className="text-xl font-black text-neutral-100 tabular-nums">{game.homeScore}</span>
            <img src={`/logos/${game.homeTriCode}.svg`} alt={game.homeTriCode} className="w-7 h-7" />
            <span className="text-xs text-neutral-500 ml-1">{isSeries ? 'Series' : `Game ${game.gameNumber}`} · {game.date}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 min-[1500px]:grid-cols-4 gap-2 min-w-0">
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-400 font-bold">Game</span>
            <select value={game.gameId} onChange={e => setGameId(e.target.value)} className="w-full bg-black/25 border border-blue-900/70 rounded-lg px-3 py-2 text-sm font-bold text-neutral-200 outline-none focus:border-blue-500">
              {seriesGame && <option value="series">Series: {seriesGame.awayTriCode} {seriesGame.awayScore}, {seriesGame.homeTriCode} {seriesGame.homeScore}</option>}
              {games.map(g => (
                <option key={g.gameId} value={g.gameId}>Game {g.gameNumber}: {g.awayTriCode} {g.awayScore}, {g.homeTriCode} {g.homeScore}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-400 font-bold">Strength</span>
            <select value={strength} onChange={e => setStrength(e.target.value)} className="w-full bg-black/25 border border-blue-900/70 rounded-lg px-3 py-2 text-sm font-bold text-neutral-200 outline-none focus:border-blue-500">
              {strengthOptions.map(s => <option key={s} value={s}>{s === 'All' ? 'All' : strengthLabel(s)}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-400 font-bold">Events</span>
            <select value={eventFilter} onChange={e => setEventFilter(e.target.value as EventFilter)} className="w-full bg-black/25 border border-blue-900/70 rounded-lg px-3 py-2 text-sm font-bold text-neutral-200 outline-none focus:border-blue-500">
              <option value="all">All attempts</option>
              <option value="sog">Shots on goal</option>
              <option value="goals">Goals</option>
              <option value="missed">Missed shots</option>
              <option value="blocked">Blocked shots</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-neutral-400 font-bold">Period</span>
            <select value={period} onChange={e => setPeriod(e.target.value)} className="w-full bg-black/25 border border-blue-900/70 rounded-lg px-3 py-2 text-sm font-bold text-neutral-200 outline-none focus:border-blue-500">
              {periodOptions.map(p => <option key={p}>{p}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-2 mb-4">
        <div className="inline-flex rounded-lg border border-blue-900/60 bg-black/20 p-1">
          {VIEW_OPTIONS.map(opt => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                onClick={() => setView(opt.id)}
                className={`h-9 px-3 rounded-md text-xs font-black transition inline-flex items-center gap-2 ${view === opt.id ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-neutral-100 hover:bg-white/5'}`}
              >
                <Icon className="w-4 h-4" />
                {opt.label}
              </button>
            );
          })}
        </div>
        <input
          value={playerQuery}
          onChange={e => setPlayerQuery(e.target.value)}
          placeholder="Search players..."
          className="flex-1 min-w-[180px] bg-black/25 border border-blue-900/70 rounded-lg px-3 py-2 text-sm font-bold text-neutral-200 placeholder:text-neutral-600 outline-none focus:border-blue-500"
        />
      </div>

      <GameSummary game={game} teamsMap={teamsMap} awayColor={awayColor} homeColor={homeColor} filteredShots={filteredShots} />

      <div className="mt-4">
        {view === 'rink' && <ShotRink game={game} shots={filteredShots} awayColor={awayColor} homeColor={homeColor} isSeries={isSeries} />}
        {view === 'flow' && <XgFlow game={game} shots={filteredShots} awayColor={awayColor} homeColor={homeColor} isSeries={isSeries} />}
        {view === 'share' && <PlayerShare game={game} teamsMap={teamsMap} awayColor={awayColor} homeColor={homeColor} playerQuery={playerQuery} />}
        {view === 'tables' && <GameTables game={game} teamsMap={teamsMap} />}
      </div>
    </section>
  );
}

function GameSummary({ game, teamsMap, awayColor, homeColor, filteredShots }: {
  game: PlayoffGameAnalysis;
  teamsMap: Record<string, TeamInfo>;
  awayColor: string;
  homeColor: string;
  filteredShots: PlayoffShotEvent[];
}) {
  const filteredXg = filteredShots.reduce((acc, s) => {
    acc[s.teamTriCode] = (acc[s.teamTriCode] ?? 0) + s.xG;
    return acc;
  }, {} as Record<string, number>);
  return (
    <div className="grid grid-cols-2 min-[1500px]:grid-cols-4 gap-2">
      {[game.awaySummary, game.homeSummary].map((team, idx) => {
        const color = idx === 0 ? awayColor : homeColor;
        return (
          <div key={team.triCode} className="rounded-lg border border-blue-900/50 bg-black/20 px-3 py-2">
            <div className="flex items-center gap-2">
              <img src={`/logos/${team.triCode}.svg`} alt={team.triCode} className="w-6 h-6" />
              <div className="text-sm font-black" style={{ color }}>{teamsMap[team.triCode]?.commonName ?? team.triCode}</div>
            </div>
            <div className="grid grid-cols-4 gap-1 mt-2 text-center">
              <MiniStat label="G" value={String(team.goals)} />
              <MiniStat label="SOG" value={String(team.shots)} />
              <MiniStat label="xG" value={fmt(team.xG)} />
              <MiniStat label="Flt xG" value={fmt(filteredXg[team.triCode] ?? 0)} />
            </div>
          </div>
        );
      })}
      <MiniPanel label="Attempts" value={`${game.awaySummary.attempts} - ${game.homeSummary.attempts}`} />
      <MiniPanel label="Power Play" value={`${game.awaySummary.ppGoals}/${game.awaySummary.ppOpps} - ${game.homeSummary.ppGoals}/${game.homeSummary.ppOpps}`} />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-neutral-500 font-bold">{label}</div>
      <div className="text-sm text-neutral-200 font-black tabular-nums">{value}</div>
    </div>
  );
}

function MiniPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-blue-900/50 bg-black/20 px-3 py-2 flex flex-col justify-center">
      <div className="text-[10px] text-neutral-500 font-bold">{label}</div>
      <div className="text-lg text-neutral-200 font-black tabular-nums">{value}</div>
    </div>
  );
}

function ShotRink({ game, shots, awayColor, homeColor, isSeries }: {
  game: PlayoffGameAnalysis;
  shots: PlayoffShotEvent[];
  awayColor: string;
  homeColor: string;
  isSeries: boolean;
}) {
  const [hovered, setHovered] = useState<PlayoffShotEvent | null>(null);

  // Map PlayoffShotEvent → RinkShot, resolving attacking direction so all
  // shots are stored with their visual x (positive = right net attack).
  const rinkShots: RinkShot[] = useMemo(() => shots.map(s => ({
    eventId: s.eventId,
    playerId: s.playerId,
    teamTriCode: s.teamTriCode,
    x: attackingX(s, game),
    y: s.y,
    xG: s.xG,
    isGoal: s.isGoal,
    eventType: s.eventType,
    playerName: s.playerName,
    strength: s.strength,
    distance: s.distance,
    angle: s.angle,
    period: s.period,
    timeSeconds: s.timeSeconds,
  })), [shots, game]);

  // Keep a map from eventId+playerId back to the original event for the tooltip
  const shotMap = useMemo(() => {
    const m = new Map<string, PlayoffShotEvent>();
    shots.forEach(s => m.set(`${s.eventId}-${s.playerId}`, s));
    return m;
  }, [shots]);

  const handleHover = (rs: RinkShot | null) => {
    setHovered(rs ? (shotMap.get(`${rs.eventId}-${rs.playerId}`) ?? null) : null);
  };

  return (
    <div className="relative rounded-xl border border-blue-900/50 bg-[#102335] p-3 overflow-hidden">
      <div className="relative">
        <HockeyRink
          shots={rinkShots}
          homeTriCode={game.homeTriCode}
          awayTriCode={game.awayTriCode}
          homeColor={homeColor}
          awayColor={awayColor}
          id={game.gameId}
          onShotHover={handleHover}
          className="aspect-[2.35/1] min-h-[260px]"
        />
        {hovered && (
          <div className="absolute left-1/2 bottom-6 -translate-x-1/2 w-[340px] max-w-[calc(100%-24px)] rounded-lg bg-[#12283b]/95 border border-blue-700/80 shadow-2xl p-3 text-center pointer-events-none backdrop-blur-md">
            <div className="flex items-center justify-center gap-2 text-sm font-black text-neutral-100">
              <img src={`/logos/${hovered.teamTriCode}.svg`} alt="" className="w-5 h-5" />
              {hovered.teamTriCode} {hovered.isGoal ? 'Goal' : hovered.eventType}
            </div>
            <div className="text-xs text-neutral-300 mt-1">{hovered.playerName}, {shotClock(hovered, isSeries)}</div>
            <div className="text-xs text-neutral-400 mt-1">{strengthLabel(hovered.strength)} · xG {pct(hovered.xG, 0)} · Distance {fmt(hovered.distance, 0)} ft · Angle {fmt(hovered.angle, 0)} deg</div>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-500 font-black uppercase tracking-widest">
        <span>{shots.length} displayed attempts</span>
        <span>Goal markers use yellow rings</span>
      </div>
    </div>
  );
}

function XgFlow({ game, shots, awayColor, homeColor, isSeries }: {
  game: PlayoffGameAnalysis;
  shots: PlayoffShotEvent[];
  awayColor: string;
  homeColor: string;
  isSeries: boolean;
}) {
  const [hovered, setHovered] = useState<{ shot: PlayoffShotEvent; cumulative: number } | null>(null);
  const w = 1000;
  const h = 460;
  const pad = { left: 44, right: 22, top: 54, bottom: 38 };
  const maxTime = Math.max(3600, game.maxGameSeconds);
  const orderedShots = useMemo(() => [...shots].sort((a, b) => shotElapsed(a) - shotElapsed(b)), [shots]);
  const totals = shots.reduce((acc, s) => {
    acc[s.teamTriCode] = (acc[s.teamTriCode] ?? 0) + s.xG;
    return acc;
  }, {} as Record<string, number>);
  const yMax = Math.max(1, Math.ceil(Math.max(totals[game.awayTriCode] ?? 0, totals[game.homeTriCode] ?? 0) + 0.5));
  const x = (t: number) => pad.left + (t / maxTime) * (w - pad.left - pad.right);
  const y = (v: number) => h - pad.bottom - (v / yMax) * (h - pad.top - pad.bottom);

  const makePath = (tri: string) => {
    let total = 0;
    let d = `M ${x(0)} ${y(0)}`;
    orderedShots.forEach(s => {
      const t = shotElapsed(s);
      if (s.teamTriCode === tri) {
        d += ` H ${x(t)} V ${y(total + s.xG)}`;
        total += s.xG;
      }
    });
    d += ` H ${x(maxTime)}`;
    return d;
  };

  const shotKey = (s: PlayoffShotEvent) => `${s.gameId}-${s.eventId}-${s.playerId}-${shotElapsed(s)}`;
  const cumulativeByShot = new Map<string, number>();
  const running: Record<string, number> = {};
  orderedShots.forEach(s => {
    running[s.teamTriCode] = (running[s.teamTriCode] ?? 0) + s.xG;
    cumulativeByShot.set(shotKey(s), running[s.teamTriCode]);
  });

  const goalShots = orderedShots.filter(s => s.isGoal);
  const periodTicks = isSeries
    ? Array.from({ length: Math.max(1, Math.ceil(maxTime / 3600)) }, (_, i) => (i + 1) * 3600).filter(t => t <= maxTime)
    : [1200, 2400, 3600].filter(t => t <= maxTime);
  const axisTicks = isSeries
    ? Array.from({ length: Math.max(2, Math.ceil(maxTime / 3600) + 1) }, (_, i) => i * 3600).filter(t => t <= maxTime)
    : [0, 1200, 2400, 3600].filter(t => t <= maxTime);

  return (
    <div className="relative rounded-xl border border-blue-900/50 bg-[#102335] p-3">
      <div className="flex items-center justify-center gap-4 mb-2">
        <img src={`/logos/${game.awayTriCode}.svg`} alt={game.awayTriCode} className="w-8 h-8" />
        <span className="text-2xl font-black tabular-nums" style={{ color: awayColor }}>{fmt(totals[game.awayTriCode] ?? 0)}</span>
        <span className="text-neutral-600 font-black">-</span>
        <span className="text-2xl font-black tabular-nums" style={{ color: homeColor }}>{fmt(totals[game.homeTriCode] ?? 0)}</span>
        <img src={`/logos/${game.homeTriCode}.svg`} alt={game.homeTriCode} className="w-8 h-8" />
      </div>
      <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="min-w-[780px] w-full" role="img" aria-label="Cumulative expected goals">
        {[...Array(yMax + 1)].map((_, i) => (
          <g key={i}>
            <line x1={pad.left} x2={w - pad.right} y1={y(i)} y2={y(i)} stroke="#526276" strokeDasharray="4 6" opacity=".45" />
            <text x={pad.left - 10} y={y(i) + 5} textAnchor="end" fill="#9ca3af" fontSize="12" fontWeight="800">{i}</text>
          </g>
        ))}
        {periodTicks.map((t, i) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={pad.top} y2={h - pad.bottom} stroke="#7b8798" strokeDasharray="6 8" opacity=".55" />
            <text x={x(t)} y={pad.top - 12} textAnchor="middle" fill="#9ca3af" fontSize="12" fontWeight="800">
              {isSeries ? `G${i + 1}` : `${i + 1}${i === 0 ? 'st' : i === 1 ? 'nd' : 'rd'}`}
            </text>
          </g>
        ))}
        <line x1={pad.left} x2={w - pad.right} y1={h - pad.bottom} y2={h - pad.bottom} stroke="#8290a4" opacity=".6" />
        <path d={makePath(game.awayTriCode)} fill="none" stroke={awayColor} strokeWidth="4" opacity=".9" />
        <path d={makePath(game.homeTriCode)} fill="none" stroke={homeColor} strokeWidth="4" opacity=".9" />
        {orderedShots.map(s => {
          const t = shotElapsed(s);
          const cumulative = cumulativeByShot.get(shotKey(s)) ?? s.xG;
          return (
            <circle
              key={`${s.eventId}-${s.playerId}`}
              cx={x(t)}
              cy={y(cumulative)}
              r={s.isGoal ? 5 : 3}
              fill={s.teamTriCode === game.awayTriCode ? awayColor : homeColor}
              opacity={s.isGoal ? 1 : .7}
              className="cursor-crosshair"
              onMouseEnter={() => setHovered({ shot: s, cumulative })}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}
        {goalShots.map(s => {
          const t = shotElapsed(s);
          const val = cumulativeByShot.get(shotKey(s)) ?? s.xG;
          return (
            <g
              key={`goal-${s.eventId}`}
              className="cursor-crosshair"
              onMouseEnter={() => setHovered({ shot: s, cumulative: val })}
              onMouseLeave={() => setHovered(null)}
            >
              <circle cx={x(t)} cy={y(val)} r="23" fill={s.teamTriCode === game.awayTriCode ? awayColor : homeColor} opacity=".95" />
              <clipPath id={`clip-${game.gameId}-${s.eventId}`}><circle cx={x(t)} cy={y(val)} r="19" /></clipPath>
              <image href={headshot(s.playerId)} x={x(t) - 19} y={y(val) - 19} width="38" height="38" clipPath={`url(#clip-${game.gameId}-${s.eventId})`} />
            </g>
          );
        })}
        {axisTicks.map((t, i) => (
          <text key={t} x={x(t)} y={h - 10} textAnchor="middle" fill="#9ca3af" fontSize="12" fontWeight="800">
            {isSeries ? (i === 0 ? 'Start' : `G${i}`) : clock(t)}
          </text>
        ))}
      </svg>
      </div>
      {hovered && (
        <div className="absolute right-5 top-20 z-50 w-[310px] max-w-[calc(100%-40px)] rounded-lg bg-[#17283d]/95 border border-blue-500/80 shadow-2xl p-3 pointer-events-none backdrop-blur-md">
          <div className="flex items-center gap-2">
            <img src={`/logos/${hovered.shot.teamTriCode}.svg`} alt="" className="w-7 h-7" />
            <div>
              <div className="text-sm font-black text-blue-200">{hovered.shot.playerName}</div>
              <div className="text-[11px] font-bold text-neutral-400">{hovered.shot.teamTriCode} {hovered.shot.isGoal ? 'Goal' : hovered.shot.eventType}</div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="text-neutral-500 font-bold">Time</div>
            <div className="text-right text-neutral-200 font-black">{shotClock(hovered.shot, isSeries)}</div>
            <div className="text-neutral-500 font-bold">Strength</div>
            <div className="text-right text-neutral-200 font-black">{strengthLabel(hovered.shot.strength)}</div>
            <div className="text-neutral-500 font-bold">Shot xG</div>
            <div className="text-right text-neutral-200 font-black">{fmt(hovered.shot.xG)}</div>
            <div className="text-neutral-500 font-bold">Team xG</div>
            <div className="text-right text-neutral-200 font-black">{fmt(hovered.cumulative)}</div>
            <div className="text-neutral-500 font-bold">Location</div>
            <div className="text-right text-neutral-200 font-black">{fmt(hovered.shot.distance, 0)} ft · {fmt(hovered.shot.angle, 0)} deg</div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerShare({ game, teamsMap, awayColor, homeColor, playerQuery }: {
  game: PlayoffGameAnalysis;
  teamsMap: Record<string, TeamInfo>;
  awayColor: string;
  homeColor: string;
  playerQuery: string;
}) {
  const [hovered, setHovered] = useState<{ player: PlayoffPlayerGameStat; left: number; top: number } | null>(null);
  const players = game.players
    .filter(p => p.toiSeconds >= 180 && p.xGFor + p.xGAgainst > 0.05)
    .sort((a, b) => shareValue(b) - shareValue(a));
  const q = playerQuery.trim().toLowerCase();
  const leftPlayers = players.filter(p => p.teamTriCode === game.awayTriCode);
  const rightPlayers = players.filter(p => p.teamTriCode === game.homeTriCode);
  const colX = (p: PlayoffPlayerGameStat, i: number) => {
    const group = p.teamTriCode === game.awayTriCode ? leftPlayers : rightPlayers;
    const base = p.teamTriCode === game.awayTriCode ? 29 : 71;
    return base + ((i % 4) - 1.5) * 6 + (group.length > 16 ? 0 : 2);
  };
  const y = (p: PlayoffPlayerGameStat) => 92 - shareValue(p) * 74;

  return (
    <div className="rounded-xl border border-blue-900/50 bg-[#102335] p-3 overflow-hidden">
      <div className="relative h-[560px] rounded-lg bg-[#101e2c] overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-1/4 opacity-40" style={{ background: `linear-gradient(90deg, ${awayColor}, transparent)` }} />
        <div className="absolute inset-y-0 right-0 w-1/4 opacity-40" style={{ background: `linear-gradient(270deg, ${homeColor}, transparent)` }} />
        <div className="absolute top-5 left-6 flex items-center gap-2">
          <img src={`/logos/${game.awayTriCode}.svg`} alt={game.awayTriCode} className="w-12 h-12" />
          <span className="text-sm font-black text-neutral-300">{teamsMap[game.awayTriCode]?.commonName ?? game.awayTriCode}</span>
        </div>
        <div className="absolute top-5 right-6 flex items-center gap-2">
          <span className="text-sm font-black text-neutral-300">{teamsMap[game.homeTriCode]?.commonName ?? game.homeTriCode}</span>
          <img src={`/logos/${game.homeTriCode}.svg`} alt={game.homeTriCode} className="w-12 h-12" />
        </div>
        <div className="absolute top-8 left-1/2 -translate-x-1/2 text-3xl font-black text-neutral-100">xGoal Share</div>
        {[30, 40, 50, 60, 70, 80, 90, 100].map(v => (
          <div key={v} className="absolute left-[7%] right-[7%] border-t border-dashed border-slate-500/35" style={{ top: `${92 - v * 0.74}%` }}>
            <span className="absolute left-1/2 -translate-x-1/2 -top-3 bg-[#101e2c] px-2 text-xs text-neutral-400 font-bold">{v}%</span>
          </div>
        ))}
        <div className="absolute left-[7%] right-[7%] border-t border-slate-400/20" style={{ top: '55%' }} />
        {players.map((p, i) => {
          const groupIndex = p.teamTriCode === game.awayTriCode ? leftPlayers.indexOf(p) : rightPlayers.indexOf(p);
          const active = !q || p.name.toLowerCase().includes(q);
          const color = p.teamTriCode === game.awayTriCode ? awayColor : homeColor;
          const left = colX(p, groupIndex);
          const top = y(p);
          const isHovered = hovered?.player.playerId === p.playerId;
          return (
            <div
              key={p.playerId}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${left}%`, top: `${top}%`, opacity: active ? 1 : 0.25, zIndex: isHovered ? 60 : active ? 5 : 2 }}
              onMouseEnter={() => setHovered({ player: p, left, top })}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="w-14 h-14 rounded-full border-4 shadow-lg overflow-hidden bg-slate-900" style={{ borderColor: color }}>
                <img src={headshot(p.playerId)} alt={p.name} className="w-full h-full object-cover" />
              </div>
            </div>
          );
        })}
        {hovered && (
          <div
            className="absolute z-[100] w-[260px] rounded-lg bg-[#17283d]/95 border border-blue-500/80 shadow-2xl p-3 pointer-events-none backdrop-blur-md"
            style={{
              left: `${Math.min(76, Math.max(24, hovered.left))}%`,
              top: `${Math.min(78, Math.max(18, hovered.top - 6))}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div className="flex items-center gap-3">
              <img src={`/logos/${hovered.player.teamTriCode}.svg`} alt="" className="w-8 h-8" />
              <div>
                <div className="text-base font-black text-blue-200 leading-tight">{hovered.player.name}</div>
                <div className="text-[11px] text-neutral-400 font-bold">{hovered.player.position || 'Skater'} · {teamsMap[hovered.player.teamTriCode]?.commonName ?? hovered.player.teamTriCode}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="text-neutral-500 font-bold">xGF</div>
              <div className="text-right text-neutral-200 font-black">{fmt(hovered.player.xGFor)}</div>
              <div className="text-neutral-500 font-bold">xGA</div>
              <div className="text-right text-neutral-200 font-black">{fmt(hovered.player.xGAgainst)}</div>
              <div className="text-neutral-500 font-bold">xGoal Share</div>
              <div className="text-right text-neutral-200 font-black">{pct(shareValue(hovered.player), 1)}</div>
              <div className="text-neutral-500 font-bold">TOI</div>
              <div className="text-right text-neutral-200 font-black">{clock(hovered.player.toiSeconds)}</div>
              <div className="text-neutral-500 font-bold">Shots</div>
              <div className="text-right text-neutral-200 font-black">{hovered.player.shots} SOG · {hovered.player.attempts} Att</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type SortCol = 'toi' | 'g' | 'a' | 'pts' | 'sog' | 'att' | 'ixg' | 'xgf' | 'pm' | 'pim' | 'hits' | 'blk' | 'fow' | 'pptoi' | 'pktoi' | 'evtoi';

function GameTables({ game, teamsMap }: { game: PlayoffGameAnalysis; teamsMap: Record<string, TeamInfo> }) {
  const [sortCol, setSortCol] = useState<SortCol>('toi');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [teamFilter, setTeamFilter] = useState<'both' | string>('both');

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  const players = useMemo(() => {
    let list = [...game.players];
    if (teamFilter !== 'both') list = list.filter(p => p.teamTriCode === teamFilter);
    list.sort((a, b) => {
      let av = 0, bv = 0;
      switch (sortCol) {
        case 'toi':   av = a.toiSeconds; bv = b.toiSeconds; break;
        case 'g':     av = a.goals; bv = b.goals; break;
        case 'a':     av = a.assists ?? 0; bv = b.assists ?? 0; break;
        case 'pts':   av = a.goals + (a.assists ?? 0); bv = b.goals + (b.assists ?? 0); break;
        case 'sog':   av = a.shots; bv = b.shots; break;
        case 'att':   av = a.attempts; bv = b.attempts; break;
        case 'ixg':   av = a.ixG; bv = b.ixG; break;
        case 'xgf':   av = shareValue(a); bv = shareValue(b); break;
        case 'pm':    av = a.goalsFor - a.goalsAgainst; bv = b.goalsFor - b.goalsAgainst; break;
        case 'pim':   av = a.pim ?? 0; bv = b.pim ?? 0; break;
        case 'hits':  av = a.hits ?? 0; bv = b.hits ?? 0; break;
        case 'blk':   av = a.blockedShots ?? 0; bv = b.blockedShots ?? 0; break;
        case 'fow':   av = a.faceoffWins ?? 0; bv = b.faceoffWins ?? 0; break;
        case 'pptoi': av = a.ppToiSeconds ?? 0; bv = b.ppToiSeconds ?? 0; break;
        case 'pktoi': av = a.pkToiSeconds ?? 0; bv = b.pkToiSeconds ?? 0; break;
        case 'evtoi': av = Math.max(0, a.toiSeconds - (a.ppToiSeconds ?? 0) - (a.pkToiSeconds ?? 0));
                      bv = Math.max(0, b.toiSeconds - (b.ppToiSeconds ?? 0) - (b.pkToiSeconds ?? 0)); break;
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return list;
  }, [game.players, sortCol, sortDir, teamFilter]);

  function Th({ col, label, title }: { col: SortCol; label: string; title?: string }) {
    const active = sortCol === col;
    return (
      <th
        onClick={() => toggleSort(col)}
        title={title}
        className={`px-2 py-3 text-left font-black cursor-pointer select-none whitespace-nowrap transition-colors ${
          active ? 'text-sky-300' : 'text-neutral-400 hover:text-white'
        }`}
      >
        <span className="flex items-center gap-0.5">
          {label}
          <span className="text-[10px] opacity-60">{active ? (sortDir === 'desc' ? '▼' : '▲') : ''}</span>
        </span>
      </th>
    );
  }

  const homeColor = teamsMap[game.homeTriCode]?.color1 ?? '#22c55e';
  const awayColor = teamsMap[game.awayTriCode]?.color1 ?? '#3b82f6';

  return (
    <div className="space-y-4">
      {/* ── Goalies ── */}
      <div className="overflow-x-auto rounded-xl border border-blue-900/50">
        <table className="w-full text-sm">
          <thead className="bg-blue-950/45 text-neutral-300">
            <tr>
              {['#', 'Goalie', 'TOI', 'SA', 'FA', 'GA', 'xGA', 'GSAx', 'Sv%', 'xSv%', 'dSv%'].map(h => (
                <th key={h} className="px-3 py-3 text-left font-black text-neutral-400">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {game.goalies.map((g, i) => (
              <tr key={g.name} className="odd:bg-black/25 even:bg-white/[0.03] border-t border-blue-950/60">
                <td className="px-3 py-3 text-neutral-500 font-black">{i + 1}</td>
                <td className="px-3 py-3 font-black text-neutral-100 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <img src={`/logos/${g.teamTriCode}.svg`} alt="" className="w-6 h-6" />
                    {g.name}
                  </div>
                </td>
                <td className="px-3 py-3 tabular-nums font-bold">{clock(g.toiSeconds)}</td>
                <td className="px-3 py-3 tabular-nums font-bold">{g.shotsAgainst}</td>
                <td className="px-3 py-3 tabular-nums font-bold">{g.fenwickAgainst}</td>
                <td className="px-3 py-3 tabular-nums font-bold">{g.goalsAgainst}</td>
                <td className="px-3 py-3 tabular-nums font-bold">{fmt(g.xGA)}</td>
                <td className={`px-3 py-3 tabular-nums font-black ${g.gsax > 0 ? 'text-emerald-400' : g.gsax < 0 ? 'text-red-400' : 'text-neutral-300'}`}>{fmt(g.gsax)}</td>
                <td className="px-3 py-3 tabular-nums font-bold">{g.savePct.toFixed(3).replace(/^0/, '')}</td>
                <td className="px-3 py-3 tabular-nums font-bold">{g.expectedSavePct.toFixed(3).replace(/^0/, '')}</td>
                <td className={`px-3 py-3 tabular-nums font-bold ${g.deltaSavePct > 0 ? 'text-emerald-400' : g.deltaSavePct < 0 ? 'text-red-400' : ''}`}>
                  {g.deltaSavePct > 0 ? '+' : ''}{g.deltaSavePct.toFixed(3).replace(/^0/, '')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Skaters: team toggle + sortable table ── */}
      <div>
        {/* Team filter toggle */}
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setTeamFilter('both')}
            className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all border ${
              teamFilter === 'both'
                ? 'bg-blue-900/60 border-blue-600 text-white'
                : 'border-blue-900/40 text-neutral-500 hover:text-neutral-300 hover:border-blue-700/50'
            }`}
          >
            Both
          </button>
          {([game.awayTriCode, game.homeTriCode] as const).map(tri => (
            <button
              key={tri}
              onClick={() => setTeamFilter(tri)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all border ${
                teamFilter === tri
                  ? 'border-blue-600 text-white'
                  : 'border-blue-900/40 text-neutral-500 hover:text-neutral-300 hover:border-blue-700/50'
              }`}
              style={teamFilter === tri ? { backgroundColor: `${tri === game.homeTriCode ? homeColor : awayColor}33`, borderColor: tri === game.homeTriCode ? homeColor : awayColor } : {}}
            >
              <img src={`/logos/${tri}.svg`} alt={tri} className="w-4 h-4" />
              {tri}
            </button>
          ))}
          <span className="ml-auto text-xs text-neutral-600">Click column headers to sort</span>
        </div>

        <div className="overflow-x-auto max-h-[520px] rounded-xl border border-blue-900/50">
          <table className="w-full text-xs">
            <thead className="bg-[#0a1929] sticky top-0 z-10 border-b border-blue-900/60">
              <tr>
                <th className="px-2 py-3 text-left font-black text-neutral-500 w-8">#</th>
                <th className="px-3 py-3 text-left font-black text-neutral-400 min-w-[180px]">Player</th>
                <Th col="toi"   label="TOI"    title="Total time on ice" />
                <Th col="evtoi" label="5v5"    title="Even-strength TOI" />
                <Th col="pptoi" label="PP"     title="Power play TOI" />
                <Th col="pktoi" label="PK"     title="Penalty kill TOI" />
                <Th col="g"     label="G"      title="Goals" />
                <Th col="a"     label="A"      title="Assists" />
                <Th col="pts"   label="Pts"    title="Points" />
                <Th col="sog"   label="SOG"    title="Shots on goal" />
                <Th col="att"   label="Att"    title="Shot attempts (Corsi)" />
                <Th col="ixg"   label="ixG"    title="Individual expected goals" />
                <Th col="xgf"   label="xGF%"   title="On-ice xG share while on ice" />
                <Th col="pm"    label="+/-"    title="On-ice goals for minus against" />
                <Th col="hits"  label="Hits"   title="Hits delivered" />
                <Th col="blk"   label="Blk"    title="Shots blocked" />
                <Th col="fow"   label="FO"     title="Faceoff wins-losses" />
                <Th col="pim"   label="PIM"    title="Penalty minutes" />
              </tr>
            </thead>
            <tbody>
              {players.map((p, i) => {
                const pts = p.goals + (p.assists ?? 0);
                const pm = p.goalsFor - p.goalsAgainst;
                const evToi = Math.max(0, p.toiSeconds - (p.ppToiSeconds ?? 0) - (p.pkToiSeconds ?? 0));
                const hasBoxscore = p.assists != null;
                const fo = p.faceoffWins != null
                  ? `${p.faceoffWins}-${p.faceoffLosses}`
                  : '—';
                return (
                  <tr key={p.playerId} className="odd:bg-black/20 even:bg-white/[0.025] border-t border-blue-950/50 hover:bg-blue-950/30 transition-colors">
                    <td className="px-2 py-2.5 text-neutral-600 font-black">{i + 1}</td>
                    <td className="px-3 py-2.5 min-w-[180px]">
                      <div className="flex items-center gap-1.5">
                        <img src={`/logos/${p.teamTriCode}.svg`} alt="" className="w-4 h-4 flex-shrink-0" />
                        <img src={headshot(p.playerId)} alt="" className="w-6 h-6 rounded-full bg-slate-900 flex-shrink-0" />
                        <div className="min-w-0">
                          <span className="font-black text-neutral-100 truncate block leading-tight">{p.name}</span>
                          <span className="text-neutral-500 text-[10px] leading-none">{p.position || '?'}{p.number ? ` · #${p.number}` : ''}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 tabular-nums font-bold text-neutral-300">{clock(p.toiSeconds)}</td>
                    <td className="px-2 py-2.5 tabular-nums font-bold text-neutral-400">{hasBoxscore ? clock(evToi) : '—'}</td>
                    <td className="px-2 py-2.5 tabular-nums font-bold text-neutral-400">{p.ppToiSeconds != null ? clock(p.ppToiSeconds) : '—'}</td>
                    <td className="px-2 py-2.5 tabular-nums font-bold text-neutral-400">{p.pkToiSeconds != null ? clock(p.pkToiSeconds) : '—'}</td>
                    <td className="px-2 py-2.5 tabular-nums font-black text-white">{p.goals > 0 ? <span className="text-yellow-300">{p.goals}</span> : 0}</td>
                    <td className="px-2 py-2.5 tabular-nums font-bold">{hasBoxscore ? p.assists : '—'}</td>
                    <td className="px-2 py-2.5 tabular-nums font-black">{hasBoxscore ? (pts > 0 ? <span className="text-sky-300">{pts}</span> : 0) : '—'}</td>
                    <td className="px-2 py-2.5 tabular-nums font-bold">{p.shots}</td>
                    <td className="px-2 py-2.5 tabular-nums font-bold">{p.attempts}</td>
                    <td className="px-2 py-2.5 tabular-nums font-bold text-blue-300">{fmt(p.ixG)}</td>
                    <td className="px-2 py-2.5 tabular-nums font-bold">{pct(shareValue(p), 1)}</td>
                    <td className={`px-2 py-2.5 tabular-nums font-black ${pm > 0 ? 'text-emerald-400' : pm < 0 ? 'text-red-400' : 'text-neutral-500'}`}>
                      {pm > 0 ? '+' : ''}{pm}
                    </td>
                    <td className="px-2 py-2.5 tabular-nums font-bold">{hasBoxscore ? (p.hits ?? 0) : '—'}</td>
                    <td className="px-2 py-2.5 tabular-nums font-bold">{hasBoxscore ? (p.blockedShots ?? 0) : '—'}</td>
                    <td className="px-2 py-2.5 tabular-nums font-bold text-neutral-400">{fo}</td>
                    <td className="px-2 py-2.5 tabular-nums font-bold">{hasBoxscore ? (p.pim ?? 0) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
