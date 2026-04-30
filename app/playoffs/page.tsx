import React from 'react';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import PlayoffHub from '@/components/playoff/PlayoffHub';
import NavBar from '@/components/NavBar';
import { getPredictions } from '@/utils/data';
import type { GamePrediction, RecentGame, TeamLineup } from '@/utils/data';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Types for the data we load
export interface PlayoffSeriesGame {
  gameNumber: number;
  date: string;
  startTimeUTC: string;
  startTimeCT?: string;
  homeTriCode: string;
  awayTriCode: string;
  tvNetwork: string;
  score: [number, number] | null;
  status: 'scheduled' | 'live' | 'final';
}

export interface PlayoffSeries {
  seriesId: string;
  round: number;
  conference: string;
  higherSeed: { triCode: string; seed: string; commonName: string };
  lowerSeed: { triCode: string; seed: string; commonName: string };
  seriesScore: [number, number];
  games: PlayoffSeriesGame[];
  seriesOdds: Record<string, number>;
}

export interface TeamInfo {
  name: string;
  commonName: string;
  triCode: string;
  logoUrl: string;
  color1: string;
  color2: string;
}

export interface H2HGame {
  gameDate: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  homeGoalie: string;
  awayGoalie: string;
  result: string;
  homeSog: number;
  awaySog: number;
}

export interface PlayoffShotEvent {
  gameId: string;
  eventId: number;
  period: number;
  timeSeconds: number;
  elapsedSeconds?: number;
  gameNumber?: number;
  homeTriCode: string;
  awayTriCode: string;
  teamTriCode: string;
  playerId: string;
  playerName: string;
  shotType: string;
  x: number;
  y: number;
  distance: number;
  angle: number;
  strength: string;
  isGoal: boolean;
  eventType: string;
  xG: number;
}

export interface PlayoffPlayerGameStat {
  playerId: string;
  name: string;
  teamTriCode: string;
  position: string;
  number?: string;
  toiSeconds: number;
  goals: number;
  shots: number;
  attempts: number;
  ixG: number;
  xGFor: number;
  xGAgainst: number;
  goalsFor: number;
  goalsAgainst: number;
  // Enriched from NHL boxscore API
  assists?: number;
  pim?: number;
  hits?: number;
  blockedShots?: number;
  faceoffWins?: number;
  faceoffLosses?: number;
  ppToiSeconds?: number;
  pkToiSeconds?: number;
}

export interface PlayoffGoalieGameStat {
  name: string;
  teamTriCode: string;
  toiSeconds: number;
  shotsAgainst: number;
  fenwickAgainst: number;
  goalsAgainst: number;
  xGA: number;
  gsax: number;
  savePct: number;
  expectedSavePct: number;
  deltaSavePct: number;
}

export interface PlayoffGameTeamSummary {
  triCode: string;
  goals: number;
  shots: number;
  attempts: number;
  xG: number;
  xG5v5: number;
  ppGoals: number;
  ppOpps: number;
  hits: number;
}

export interface PlayoffGameAnalysis {
  gameId: string;
  gameNumber: number;
  date: string;
  homeTriCode: string;
  awayTriCode: string;
  homeScore: number;
  awayScore: number;
  homeSummary: PlayoffGameTeamSummary;
  awaySummary: PlayoffGameTeamSummary;
  shots: PlayoffShotEvent[];
  players: PlayoffPlayerGameStat[];
  goalies: PlayoffGoalieGameStat[];
  maxGameSeconds: number;
}

export interface TeamRatings {
  [teamName: string]: {
    xgf_rating: number;
    xga_rating: number;
    xgf_5v5_rating: number;
    xga_5v5_rating: number;
    pp_rating: number;
    pk_rating: number;
    pp_xgf_per_opp: number;
    pk_xga_per_opp: number;
    penalties_drawn_per_60: number;
    penalties_taken_per_60: number;
    games_played: number;
    xgf_rolling: number;
    xga_rolling: number;
  };
}

// ─── Series probability math (server-side replica) ────────────────────────────
function fac(n: number): number { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function poisson(k: number, l: number) { return (l ** k * Math.exp(-l)) / fac(k); }

function computeWinProb(
  hXgf5: number, hXga5: number, hPp: number, hPk: number, hPenDrw: number, hPenTkn: number, hGoalie: number,
  aXgf5: number, aXga5: number, aPp: number, aPk: number, aPenDrw: number, aPenTkn: number, aGoalie: number,
): number {
  const AVG = 2.35, HI = 0.16, ST = 0.18;
  const h5 = (hXgf5 * aXga5) / AVG;
  const a5 = (aXgf5 * hXga5) / AVG;
  const hO = (hPenDrw + aPenTkn) / 2;
  const aO = (aPenDrw + hPenTkn) / 2;
  const hX = Math.max(0.1, h5 + HI + hO * ST * hPp * aPk - aGoalie * 0.5);
  const aX = Math.max(0.1, a5 + aO * ST * aPp * hPk - hGoalie * 0.5);
  let w = 0, l = 0, t = 0;
  for (let h = 0; h < 12; h++) for (let a = 0; a < 12; a++) {
    const p = poisson(h, hX) * poisson(a, aX);
    if (h > a) w += p; else if (a > h) l += p; else t += p;
  }
  const tot = w + l + t;
  return (w / tot) + (t / tot) * (hX / (hX + aX));
}

function probToAmerican(p: number): string {
  if (p <= 0 || p >= 1) return '';
  if (p >= 0.5) return String(Math.round(-100 * p / (1 - p)));
  return '+' + Math.round(100 * (1 - p) / p);
}

type CsvRow = Record<string, string | undefined>;

function toNum(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function loadPlayoffGameAnalyses(
  series: PlayoffSeries[],
  allRows: CsvRow[],
  commonToTri: Record<string, string>,
): Record<string, PlayoffGameAnalysis[]> {
  const publicGameRows = new Map<string, { home?: CsvRow; away?: CsvRow }>();
  allRows.forEach((row: CsvRow) => {
    const gameId = String(row.game_id ?? '');
    if (!gameId.startsWith('202503')) return;
    const teamName = row.team?.trim();
    const oppName = row.opponent?.trim();
    if (!teamName || !oppName) return;
    const teamTri = commonToTri[teamName];
    const oppTri = commonToTri[oppName];
    if (!teamTri || !oppTri) return;
    const key = `${gameId}`;
    const prev = publicGameRows.get(key) ?? { home: undefined, away: undefined };
    if (row.home_away === 'Home') prev.home = row;
    else prev.away = row;
    publicGameRows.set(key, prev);
  });

  const wantedGames = new Map<string, { seriesId: string; game: PlayoffSeriesGame; homeRow: CsvRow; awayRow: CsvRow }>();
  series.forEach(s => {
    s.games.filter(g => g.status === 'final').forEach(g => {
      const match = Array.from(publicGameRows.entries()).find(([, pair]) => {
        const homeName = pair.home?.team?.trim();
        const awayName = pair.away?.team?.trim();
        const homeTri = homeName ? commonToTri[homeName] : undefined;
        const awayTri = awayName ? commonToTri[awayName] : undefined;
        return pair.home?.game_date === g.date && homeTri === g.homeTriCode && awayTri === g.awayTriCode;
      });
      if (match?.[0] && match[1].home && match[1].away) {
        wantedGames.set(match[0], { seriesId: s.seriesId, game: g, homeRow: match[1].home, awayRow: match[1].away });
      }
    });
  });

  if (wantedGames.size === 0) return {};

  const pipelineDir = path.join(process.cwd(), 'pipeline');
  const playerMeta = new Map<string, { name: string; position: string; number?: string; team?: string }>();
  try {
    const biosCsv = fs.readFileSync(path.join(pipelineDir, 'moneypuck_bios.csv'), 'utf8');
    const bios = Papa.parse(biosCsv, { header: true, skipEmptyLines: true });
    (bios.data as Array<Record<string, string | undefined>>).forEach((r) => {
      playerMeta.set(String(r.playerId), {
        name: r.name ?? String(r.playerId),
        position: r.position || r.primaryPosition || '',
        number: r.primaryNumber ? String(Math.round(toNum(r.primaryNumber))) : undefined,
        team: r.team,
      });
    });
  } catch { /* optional */ }

  type Shift = { gameId: string; period: number; start: number; end: number; playerId: string; name: string; teamId: string; teamTriCode: string };
  const shiftsByGame = new Map<string, Shift[]>();
  const teamIdToTri = new Map<string, string>();
  try {
    const shiftsText = fs.readFileSync(path.join(pipelineDir, 'nhl_season_2025_2026_shifts.csv'), 'utf8');
    const lines = shiftsText.split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const c = parseCsvLine(line);
      const gameId = c[0];
      if (!wantedGames.has(gameId)) continue;
      const shift: Shift = {
        gameId,
        period: parseInt(c[1]) || 1,
        start: toNum(c[2]),
        end: toNum(c[3]),
        playerId: c[4],
        name: c[5],
        teamId: c[6],
        teamTriCode: c[7],
      };
      teamIdToTri.set(shift.teamId, shift.teamTriCode);
      if (!playerMeta.has(shift.playerId)) {
        playerMeta.set(shift.playerId, { name: shift.name, position: '', team: shift.teamTriCode });
      }
      if (!shiftsByGame.has(gameId)) shiftsByGame.set(gameId, []);
      shiftsByGame.get(gameId)!.push(shift);
    }
  } catch { /* optional */ }

  const shotsByGame = new Map<string, PlayoffShotEvent[]>();
  try {
    const shotsText = fs.readFileSync(path.join(pipelineDir, 'nhl_season_2025_2026_shots.csv'), 'utf8');
    const lines = shotsText.split(/\r?\n/);
    const header = parseCsvLine(lines[0] ?? '');
    const ix = Object.fromEntries(header.map((h, i) => [h, i]));
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const c = parseCsvLine(line);
      const gameId = c[ix.game_id];
      if (!wantedGames.has(gameId)) continue;
      const playerId = c[ix.player_id];
      const gameMeta = wantedGames.get(gameId);
      const meta = playerMeta.get(playerId);
      const teamTri = teamIdToTri.get(c[ix.team_id]) ?? meta?.team ?? '';
      const eventCode = c[ix.event_type];
      const eventName = eventCode === '505' ? 'Goal'
        : eventCode === '506' ? 'Shot on goal'
        : eventCode === '507' ? 'Missed shot'
        : eventCode === '508' ? 'Blocked shot'
        : 'Shot attempt';
      const shot: PlayoffShotEvent = {
        gameId,
        eventId: parseInt(c[ix.event_id]) || i,
        period: parseInt(c[ix.period]) || 1,
        timeSeconds: toNum(c[ix.time_seconds]),
        elapsedSeconds: ((parseInt(c[ix.period]) || 1) - 1) * 1200 + toNum(c[ix.time_seconds]),
        gameNumber: gameMeta?.game.gameNumber,
        homeTriCode: gameMeta?.game.homeTriCode ?? '',
        awayTriCode: gameMeta?.game.awayTriCode ?? '',
        teamTriCode: teamTri,
        playerId,
        playerName: meta?.name ?? playerId,
        shotType: c[ix.shot_type] || 'shot',
        x: toNum(c[ix.x]),
        y: toNum(c[ix.y]),
        distance: toNum(c[ix.distance]),
        angle: toNum(c[ix.angle]),
        strength: c[ix.strength_state] || 'All',
        isGoal: c[ix.is_goal] === '1',
        eventType: eventName,
        xG: toNum(c[ix.xG_flurry_adj] ?? c[ix.xG]),
      };
      if (!shotsByGame.has(gameId)) shotsByGame.set(gameId, []);
      shotsByGame.get(gameId)!.push(shot);
    }
  } catch { /* optional */ }

  const result: Record<string, PlayoffGameAnalysis[]> = {};
  wantedGames.forEach(({ seriesId, game, homeRow, awayRow }, gameId) => {
    const shots = (shotsByGame.get(gameId) ?? []).sort((a, b) => ((a.period - 1) * 1200 + a.timeSeconds) - ((b.period - 1) * 1200 + b.timeSeconds));
    const shifts = shiftsByGame.get(gameId) ?? [];
    const playerStats = new Map<string, PlayoffPlayerGameStat>();

    shifts.forEach(s => {
      const meta = playerMeta.get(s.playerId);
      const current = playerStats.get(s.playerId) ?? {
        playerId: s.playerId,
        name: meta?.name ?? s.name,
        teamTriCode: s.teamTriCode,
        position: meta?.position ?? '',
        number: meta?.number,
        toiSeconds: 0,
        goals: 0,
        shots: 0,
        attempts: 0,
        ixG: 0,
        xGFor: 0,
        xGAgainst: 0,
        goalsFor: 0,
        goalsAgainst: 0,
      };
      current.toiSeconds += Math.max(0, s.end - s.start);
      playerStats.set(s.playerId, current);
    });

    shots.forEach(shot => {
      const shooter = playerStats.get(shot.playerId);
      if (shooter) {
        shooter.attempts += 1;
        if (shot.eventType === 'Goal' || shot.eventType === 'Shot on goal') shooter.shots += 1;
        if (shot.isGoal) shooter.goals += 1;
        shooter.ixG += shot.xG;
      }
      const onIce = shifts.filter(s => s.period === shot.period && s.start <= shot.timeSeconds && s.end >= shot.timeSeconds);
      onIce.forEach(s => {
        const stat = playerStats.get(s.playerId);
        if (!stat) return;
        if (s.teamTriCode === shot.teamTriCode) {
          stat.xGFor += shot.xG;
          if (shot.isGoal) stat.goalsFor += 1;
        } else {
          stat.xGAgainst += shot.xG;
          if (shot.isGoal) stat.goalsAgainst += 1;
        }
      });
    });

    const makeSummary = (row: CsvRow, triCode: string): PlayoffGameTeamSummary => ({
      triCode,
      goals: toNum(row.goals_for),
      shots: toNum(row.sog_for),
      attempts: toNum(row.attempts_for),
      xG: toNum(row.xG_for),
      xG5v5: toNum(row.xG_for_5v5 ?? row.xg_for_5v5),
      ppGoals: toNum(row.pp_goals),
      ppOpps: toNum(row.pp_opportunities),
      hits: toNum(row.hits_for),
    });

    const makeGoalie = (row: CsvRow, triCode: string): PlayoffGoalieGameStat => {
      const name = row.starting_goalie || '';
      const goalieShift = shifts.find(s => s.name === name);
      const toi = shifts.filter(s => s.name === name).reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
      const emptyNetAgainst = toNum(row.emptynet_goalsagainst);
      const emptyNetAttemptsAgainst = toNum(row.en_attempts_against);
      const shotsAgainst = Math.max(0, toNum(row.sog_ag) - emptyNetAgainst);
      const xGA = toNum(row.xG_against);
      const goalsAgainst = Math.max(0, toNum(row.goals_ag) - emptyNetAgainst);
      const savePct = shotsAgainst > 0 ? (shotsAgainst - goalsAgainst) / shotsAgainst : 0;
      const expectedSavePct = shotsAgainst > 0 ? (shotsAgainst - xGA) / shotsAgainst : 0;
      return {
        name,
        teamTriCode: triCode,
        toiSeconds: toi || (goalieShift ? 3600 : 0),
        shotsAgainst,
        fenwickAgainst: Math.max(0, toNum(row.attempts_ag) - emptyNetAttemptsAgainst),
        goalsAgainst,
        xGA,
        gsax: xGA - goalsAgainst,
        savePct,
        expectedSavePct,
        deltaSavePct: savePct - expectedSavePct,
      };
    };

    const maxShotSecond = shots.reduce((m, s) => Math.max(m, (s.period - 1) * 1200 + s.timeSeconds), 3600);
    const analysis: PlayoffGameAnalysis = {
      gameId,
      gameNumber: game.gameNumber,
      date: game.date,
      homeTriCode: game.homeTriCode,
      awayTriCode: game.awayTriCode,
      homeScore: game.score?.[0] ?? toNum(homeRow.goals_for),
      awayScore: game.score?.[1] ?? toNum(awayRow.goals_for),
      homeSummary: makeSummary(homeRow, game.homeTriCode),
      awaySummary: makeSummary(awayRow, game.awayTriCode),
      shots,
      players: Array.from(playerStats.values())
        .filter(p => p.toiSeconds > 0 && p.position !== 'G')
        .sort((a, b) => b.toiSeconds - a.toiSeconds),
      goalies: [makeGoalie(homeRow, game.homeTriCode), makeGoalie(awayRow, game.awayTriCode)],
      maxGameSeconds: Math.max(3600, maxShotSecond),
    };
    if (!result[seriesId]) result[seriesId] = [];
    result[seriesId].push(analysis);
  });

  Object.values(result).forEach(games => games.sort((a, b) => a.gameNumber - b.gameNumber));
  return result;
}

function toiStrToSec(toi: string): number {
  const [m, s] = toi.split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
}

async function enrichGameAnalysesWithBoxscore(
  gameAnalyses: Record<string, PlayoffGameAnalysis[]>,
): Promise<void> {
  const gameIds = new Set<string>();
  Object.values(gameAnalyses).flat().forEach(g => gameIds.add(g.gameId));

  // ── Load raw shifts for situation-TOI computation ─────────────────────────
  type RawShift = { period: number; start: number; end: number; playerId: string; teamTriCode: string };
  const shiftsByGame = new Map<string, RawShift[]>();
  try {
    const shiftsText = fs.readFileSync(
      path.join(process.cwd(), 'pipeline', 'nhl_season_2025_2026_shifts.csv'), 'utf8');
    const lines = shiftsText.split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const c = parseCsvLine(lines[i]);
      const gameId = c[0];
      if (!gameIds.has(gameId)) continue;
      if (!shiftsByGame.has(gameId)) shiftsByGame.set(gameId, []);
      shiftsByGame.get(gameId)!.push({
        period: parseInt(c[1]) || 1,
        start: parseFloat(c[2]) || 0,
        end: parseFloat(c[3]) || 0,
        playerId: c[4],
        teamTriCode: c[7],
      });
    }
  } catch { /* optional */ }

  await Promise.allSettled(Array.from(gameIds).map(async (gameId) => {
    const gameInstances = Object.values(gameAnalyses).flat().filter(g => g.gameId === gameId);
    if (!gameInstances.length) return;
    const game = gameInstances[0];

    // ── Fetch boxscore + play-by-play in parallel ─────────────────────────
    const nhlHeaders = { 'User-Agent': 'Mozilla/5.0 (compatible; NHL-Stats/1.0)' };
    const [bsResult, pbpResult] = await Promise.allSettled([
      fetch(`https://api-web.nhle.com/v1/gamecenter/${gameId}/boxscore`, { headers: nhlHeaders, next: { revalidate: 300 } }),
      fetch(`https://api-web.nhle.com/v1/gamecenter/${gameId}/play-by-play`, { headers: nhlHeaders, next: { revalidate: 300 } }),
    ]);

    // ── Boxscore: assists, pim, hits, blockedShots, position ─────────────
    type BxPlayer = { playerId: number; position?: string; assists?: number; pim?: number; hits?: number; blockedShots?: number };
    const bxMap = new Map<string, BxPlayer>();
    if (bsResult.status === 'fulfilled' && bsResult.value.ok) {
      try {
        const data = await bsResult.value.json();
        const pgs = data?.playerByGameStats;
        const allBx: BxPlayer[] = [
          ...(pgs?.homeTeam?.forwards ?? []), ...(pgs?.homeTeam?.defense ?? []),
          ...(pgs?.awayTeam?.forwards ?? []), ...(pgs?.awayTeam?.defense ?? []),
        ];
        allBx.forEach(p => bxMap.set(String(p.playerId), p));
      } catch { /* skip */ }
    }

    // ── Play-by-play: situation timeline + faceoff W-L ───────────────────
    type SitInterval = { period: number; start: number; end: number; homeSk: number; awaySk: number; bothGoalies: boolean };
    const sitIntervals: SitInterval[] = [];
    const foWins = new Map<string, number>();
    const foLosses = new Map<string, number>();

    if (pbpResult.status === 'fulfilled' && pbpResult.value.ok) {
      try {
        const pbp = await pbpResult.value.json();
        const plays: Array<{ eventId: number; sortOrder: number; periodDescriptor?: { number?: number }; timeInPeriod: string; situationCode?: string; typeCode?: number; details?: { winningPlayerId?: number; losingPlayerId?: number } }> = pbp.plays ?? [];

        // Deduplicate by eventId and sort
        const seen = new Set<number>();
        const unique = plays.filter(p => { if (seen.has(p.eventId)) return false; seen.add(p.eventId); return true; });
        unique.sort((a, b) => a.sortOrder - b.sortOrder);

        // Group by period
        const byPeriod = new Map<number, typeof unique>();
        unique.forEach(p => {
          const pd = p.periodDescriptor?.number ?? 1;
          if (!byPeriod.has(pd)) byPeriod.set(pd, []);
          byPeriod.get(pd)!.push(p);
        });

        for (const [period, periodPlays] of byPeriod) {
          for (let i = 0; i < periodPlays.length; i++) {
            const play = periodPlays[i];
            const startSec = toiStrToSec(play.timeInPeriod);
            const endSec = i < periodPlays.length - 1 ? toiStrToSec(periodPlays[i + 1].timeInPeriod) : 1200;
            if (endSec <= startSec) continue;

            const sc = play.situationCode ?? '1551';
            // Only track non-empty-net situations for PP/PK (both goalies must be on)
            const bothGoalies = sc[0] === '1' && sc[3] === '1';
            sitIntervals.push({ period, start: startSec, end: endSec, homeSk: parseInt(sc[1]) || 5, awaySk: parseInt(sc[2]) || 5, bothGoalies });

            if (play.typeCode === 502) {
              const w = String(play.details?.winningPlayerId ?? '');
              const l = String(play.details?.losingPlayerId ?? '');
              if (w) foWins.set(w, (foWins.get(w) ?? 0) + 1);
              if (l) foLosses.set(l, (foLosses.get(l) ?? 0) + 1);
            }
          }
        }
      } catch { /* skip */ }
    }

    // ── Compute situation TOI per player via shift × interval overlap ─────
    const sitToi = new Map<string, { pp: number; pk: number }>();
    const rawShifts = shiftsByGame.get(gameId) ?? [];
    for (const shift of rawShifts) {
      if (!sitToi.has(shift.playerId)) sitToi.set(shift.playerId, { pp: 0, pk: 0 });
      const toi = sitToi.get(shift.playerId)!;
      const isHome = shift.teamTriCode === game.homeTriCode;

      for (const iv of sitIntervals) {
        if (iv.period !== shift.period) continue;
        const os = Math.max(shift.start, iv.start);
        const oe = Math.min(shift.end, iv.end);
        if (oe <= os) continue;
        const overlap = oe - os;
        const playerSk = isHome ? iv.homeSk : iv.awaySk;
        const oppSk    = isHome ? iv.awaySk : iv.homeSk;
        // Only credit PP/PK when both goalies are on (excludes pulled-goalie empty net situations)
        if (iv.bothGoalies && playerSk > oppSk) toi.pp += overlap;
        else if (iv.bothGoalies && playerSk < oppSk) toi.pk += overlap;
      }
    }

    // ── Apply all enriched stats to every game instance ───────────────────
    gameInstances.forEach(gi => {
      gi.players.forEach(p => {
        const bp = bxMap.get(p.playerId);
        if (bp) {
          if (!p.position && bp.position) p.position = bp.position;
          p.assists     = bp.assists      ?? 0;
          p.pim         = bp.pim          ?? 0;
          p.hits        = bp.hits         ?? 0;
          p.blockedShots = bp.blockedShots ?? 0;
        }
        const sit = sitToi.get(p.playerId);
        if (sit) {
          p.ppToiSeconds = Math.round(sit.pp);
          p.pkToiSeconds = Math.round(sit.pk);
        }
        const fw = foWins.get(p.playerId) ?? 0;
        const fl = foLosses.get(p.playerId) ?? 0;
        if (fw > 0 || fl > 0) { p.faceoffWins = fw; p.faceoffLosses = fl; }
      });
    });
  }));
}

function loadData() {
  const dataDir = path.join(process.cwd(), 'data');
  const publicDataDir = path.join(process.cwd(), 'public', 'data');

  // Load playoff series
  const seriesJson = fs.readFileSync(path.join(publicDataDir, 'playoff_series.json'), 'utf8');
  const series: PlayoffSeries[] = JSON.parse(seriesJson);

  // Load teams
  const teamsCsv = fs.readFileSync(path.join(dataDir, 'nhl_teams.csv'), 'utf8');
  const teamsParsed = Papa.parse(teamsCsv, { header: true, skipEmptyLines: true });
  const teamsMap: Record<string, TeamInfo> = {};
  const commonToTri: Record<string, string> = {};
  const triToCommon: Record<string, string> = {};
  const teamNameToTri: Record<string, string> = {};
  teamsParsed.data.forEach((row: any) => {
    teamsMap[row['Team Tricode']] = {
      name: row['Team Name'],
      commonName: row['Common Name'],
      triCode: row['Team Tricode'],
      logoUrl: row['Team Logo URL'],
      color1: row['Hex Color 1'],
      color2: row['Hex Color 2'],
    };
    commonToTri[row['Common Name']] = row['Team Tricode'];
    triToCommon[row['Team Tricode']] = row['Common Name'];
    teamNameToTri[row['Team Name']] = row['Team Tricode'];
  });

  // Load team ratings
  const ratingsJson = fs.readFileSync(path.join(publicDataDir, 'team_ratings.json'), 'utf8');
  const ratings: TeamRatings = JSON.parse(ratingsJson);

  // Load extended stats (splits by time/location/starter)
  let teamStatsExtended: Record<string, any> = {};
  try { teamStatsExtended = JSON.parse(fs.readFileSync(path.join(publicDataDir, 'team_stats_extended.json'), 'utf8')); } catch { /* ok */ }

  // Load goalie ratings + compute percentiles
  let goalieRatings: Record<string, { gsax_per_game: number; gsax_total: number; games_played: number }> = {};
  try {
    goalieRatings = JSON.parse(fs.readFileSync(path.join(publicDataDir, 'goalie_ratings.json'), 'utf8'));
  } catch { /* ok */ }
  const goalieSorted = Object.values(goalieRatings).sort((a, b) => a.gsax_per_game - b.gsax_per_game);
  function goalieGsaxPct(name: string): number {
    const idx = goalieSorted.findIndex(g => g === goalieRatings[name]);
    if (idx === -1) return 50;
    return Math.round((idx / Math.max(goalieSorted.length - 1, 1)) * 100);
  }

  // Load gamestats
  const gamestatsCsv = fs.readFileSync(path.join(dataDir, 'gamestats.csv'), 'utf8');
  const gamestatsParsed = Papa.parse(gamestatsCsv, { header: true, skipEmptyLines: true });
  const allRows = gamestatsParsed.data as CsvRow[];

  // Per-team: sorted by date desc
  const teamRows: Record<string, CsvRow[]> = {};
  allRows.forEach((row: CsvRow) => {
    const teamName = row.team?.trim();
    const tri = teamName ? commonToTri[teamName] : undefined;
    if (!tri) return;
    if (!teamRows[tri]) teamRows[tri] = [];
    teamRows[tri].push(row);
  });
  Object.values(teamRows).forEach(rows => rows.sort((a, b) => (b.game_date ?? '').localeCompare(a.game_date ?? '')));

  // Identify #1 goalie per team: most starts in last 20 games
  function getTopGoalie(tri: string): string {
    const rows = (teamRows[tri] ?? []).slice(0, 20);
    const counts: Record<string, number> = {};
    rows.forEach((r: CsvRow) => {
      const g = r.starting_goalie?.trim();
      if (g) counts[g] = (counts[g] ?? 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'TBD';
  }

  // L7 record per team
  function getL7(tri: string): string {
    const rows = (teamRows[tri] ?? []).slice(0, 7);
    let w = 0, otl = 0, l = 0;
    rows.forEach((r: CsvRow) => {
      const res = r.result?.trim();
      if (res === 'RW' || res === 'OTW' || res === 'SOW') w++;
      else if (res === 'OTL' || res === 'SOL') otl++;
      else l++;
    });
    return `${w}-${l}-${otl}`;
  }

  // Recent games (last 5) per team shaped as RecentGame[]
  function getRecentGames(tri: string): RecentGame[] {
    return (teamRows[tri] ?? []).slice(0, 5).map((r: CsvRow) => {
      const oppName = r.opponent?.trim();
      const oppTri = oppName ? commonToTri[oppName] : undefined;
      const res = r.result?.trim() ?? '';
      let result: RecentGame['result'] = 'L';
      if (res === 'RW') result = 'W';
      else if (res === 'OTW') result = 'W-OT';
      else if (res === 'SOW') result = 'W-SO';
      else if (res === 'OTL' || res === 'SOL') result = 'O';
      const [yr, mo, dy] = (r.game_date ?? '').split('-');
      const fmtDate = yr && mo && dy ? `${parseInt(mo)}/${parseInt(dy)}` : (r.game_date ?? '');
      return {
        date: fmtDate,
        opponent: oppTri ?? r.opponent ?? '',
        opponentLogo: oppTri ? `/logos/${oppTri}.svg` : '',
        isHome: r.home_away === 'Home',
        score: `${r.goals_for ?? 0}-${r.goals_ag ?? 0}`,
        result,
        opponentColor: teamsMap[oppTri ?? '']?.color1 ?? '#888',
        starter: r.starting_goalie?.trim() ?? '',
      };
    });
  }

  // PP/PK ranks (rank all 32 teams by pp_rating and pk_rating)
  const ratingEntries = Object.entries(ratings);
  const ppRanked = [...ratingEntries].sort((a, b) => b[1].pp_rating - a[1].pp_rating);
  const pkRanked = [...ratingEntries].sort((a, b) => b[1].pk_rating - a[1].pk_rating);
  const ppRank: Record<string, number> = {};
  const pkRank: Record<string, number> = {};
  ppRanked.forEach(([name], i) => { const tri = commonToTri[name]; if (tri) ppRank[tri] = i + 1; });
  pkRanked.forEach(([name], i) => { const tri = commonToTri[name]; if (tri) pkRank[tri] = i + 1; });

  // Load goalie season stats (W-L-OT | SV% | GAA strings)
  let goalieStatsMap: Record<string, string> = {};
  try {
    goalieStatsMap = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'pipeline', 'nhl_goalie_stats.json'), 'utf8'));
  } catch { /* ok */ }

  // Load lineups
  let lineups: Record<string, any> = {};
  try { lineups = JSON.parse(fs.readFileSync(path.join(publicDataDir, 'team_lineups.json'), 'utf8')); } catch { /* ok */ }

  // Load team goalies (sorted by GP, used to identify backups)
  let teamGoalies: Record<string, string[]> = {};
  try { teamGoalies = JSON.parse(fs.readFileSync(path.join(publicDataDir, 'team_goalies.json'), 'utf8')); } catch { /* ok */ }

  // Load career playoff goalie stats
  let goaliePlayoffCareerMap: Record<string, string> = {};
  try {
    const gpc: Record<string, { display: string }> = JSON.parse(fs.readFileSync(path.join(publicDataDir, 'goalie_playoff_career_stats.json'), 'utf8'));
    Object.entries(gpc).forEach(([name, stats]) => { goaliePlayoffCareerMap[name] = stats.display; });
  } catch { /* ok */ }

  // Load TV network lookup from upcoming_games.json
  const tvNetworkMap: Record<string, string> = {};
  try {
    const upcoming: Array<{ homeTeamAbbrev: string; awayTeamAbbrev: string; tvNetwork?: string }> = JSON.parse(fs.readFileSync(path.join(publicDataDir, 'upcoming_games.json'), 'utf8'));
    upcoming.forEach(g => { if (g.tvNetwork) tvNetworkMap[g.homeTeamAbbrev + '_' + g.awayTeamAbbrev] = g.tvNetwork; });
  } catch { /* ok */ }

  // Load player news
  let playerNews: Record<string, any[]> = {};
  try { playerNews = JSON.parse(fs.readFileSync(path.join(publicDataDir, 'player_news.json'), 'utf8')); } catch { /* ok */ }

  // Load accumulated playoff player news
  let playoffPlayerNews: Record<string, any[]> = {};
  try { playoffPlayerNews = JSON.parse(fs.readFileSync(path.join(publicDataDir, 'playoff_player_news.json'), 'utf8')); } catch { /* ok */ }

  // Load playoff history (historical series between each matchup pair)
  let playoffHistory: Record<string, any[]> = {};
  try { playoffHistory = JSON.parse(fs.readFileSync(path.join(publicDataDir, 'playoff_history.json'), 'utf8')); } catch { /* ok */ }

  // Build H2H game log
  const seriesTeamPairs = series.map(s => [s.higherSeed.triCode, s.lowerSeed.triCode]);
  const h2hGames: Record<string, H2HGame[]> = {};
  seriesTeamPairs.forEach(([t1, t2]) => { h2hGames[`${t1}_${t2}`] = []; });

  allRows.forEach((row: any) => {
    if (row.home_away !== 'Home') return;
    const teamTri = commonToTri[row.team?.trim()];
    const oppTri = commonToTri[row.opponent?.trim()];
    if (!teamTri || !oppTri) return;
    for (const [t1, t2] of seriesTeamPairs) {
      if ((teamTri === t1 && oppTri === t2) || (teamTri === t2 && oppTri === t1)) {
        h2hGames[`${t1}_${t2}`].push({
          gameDate: row.game_date,
          homeTeam: teamTri,
          awayTeam: oppTri,
          homeGoals: parseInt(row.goals_for) || 0,
          awayGoals: parseInt(row.goals_ag) || 0,
          homeGoalie: row.starting_goalie || '',
          awayGoalie: row.starting_goalie_opp || '',
          result: row.result || '',
          homeSog: parseInt(row.sog_for) || 0,
          awaySog: parseInt(row.sog_ag) || 0,
        });
        break;
      }
    }
  });
  Object.values(h2hGames).forEach(games => games.sort((a, b) => a.gameDate.localeCompare(b.gameDate)));

  const gameAnalyses = loadPlayoffGameAnalyses(series, allRows, commonToTri);

  // ─── Load pipeline predictions (predictions_detailed.csv) ───────────────────
  // Build lookup by triCode pair so we can match regardless of home/away order
  const pipelinePredMap: Record<string, any> = {};
  try {
    const predCsv = fs.readFileSync(path.join(dataDir, 'predictions_detailed.csv'), 'utf8');
    const predParsed = Papa.parse(predCsv, { header: true, skipEmptyLines: true });
    (predParsed.data as any[]).forEach((row: any) => {
      const ht = commonToTri[row.home_team?.trim()] ?? teamNameToTri[row.home_team?.trim()];
      const at = commonToTri[row.away_team?.trim()] ?? teamNameToTri[row.away_team?.trim()];
      if (ht && at) {
        pipelinePredMap[`${ht}_${at}`] = row;
        pipelinePredMap[`${at}_${ht}`] = row; // reverse lookup
      }
    });
  } catch { /* ok — fallback to computeWinProb */ }

  // ─── Build next-game predictions for each series ──────────────────────────
  const seriesPredictions: Record<string, GamePrediction> = {};

  for (const s of series) {
    // Determine next game from the schedule (first non-final game)
    const nextGame = s.games.find((g: PlayoffSeriesGame) => g.status === 'scheduled' || g.status === 'live');
    const nextGameNum = nextGame?.gameNumber ?? (s.seriesScore[0] + s.seriesScore[1] + 1);
    const nextGameLabel = `Game ${nextGameNum}`;

    // Home team for the next game comes from the schedule; fall back to higher seed
    const nextHomeTriCode = nextGame?.homeTriCode ?? s.higherSeed.triCode;
    const nextAwayTriCode = nextGame?.awayTriCode ?? s.lowerSeed.triCode;

    const homeTri = nextHomeTriCode;
    const awayTri = nextAwayTriCode;
    const homeCommon = triToCommon[homeTri];
    const awayCommon = triToCommon[awayTri];
    const homeRatings = ratings[homeCommon];
    const awayRatings = ratings[awayCommon];
    if (!homeRatings || !awayRatings) continue;

    const homeTeam = teamsMap[homeTri];
    const awayTeam = teamsMap[awayTri];
    if (!homeTeam || !awayTeam) continue;

    // Try pipeline prediction first (match by home_tri_away_tri or reverse)
    const pipRow = pipelinePredMap[`${homeTri}_${awayTri}`] ?? pipelinePredMap[`${awayTri}_${homeTri}`];
    const pipHomeIsHigher = pipRow ? (commonToTri[pipRow.home_team?.trim()] ?? teamNameToTri[pipRow.home_team?.trim()]) === homeTri : true;

    let homeWinPct: number;
    let awayWinPct: number;
    let homeXg: number;
    let awayXg: number;
    let homeGoalie: string;
    let awayGoalie: string;
    let homeGsax: number;
    let awayGsax: number;
    let homeGsaxPct: number;
    let awayGsaxPct: number;
    let homeGoalieStats: string | undefined;
    let awayGoalieStats: string | undefined;
    let homeGoalieVsOpp: string | undefined;
    let awayGoalieVsOpp: string | undefined;
    let homeVegasOdds = '';
    let awayVegasOdds = '';
    let homeVegasWinPct: number;
    let awayVegasWinPct: number;
    let homeEv = 0;
    let awayEv = 0;

    if (pipRow) {
      // Pipeline row may have home = higher seed or home = lower seed depending on actual schedule
      // pipHomeIsHigher = true means pipRow.home_team == higherSeed (our "home")
      const pipHomeWinPct = parseFloat(pipRow.home_win_pct) || 50;
      const pipAwayWinPct = parseFloat(pipRow.away_win_pct) || 50;
      const pipHomeXg = parseFloat(pipRow.home_xg) || 2.5;
      const pipAwayXg = parseFloat(pipRow.away_xg) || 2.5;
      const pipHomeStarter = pipRow.home_starter?.trim() || '';
      const pipAwayStarter = pipRow.away_starter?.trim() || '';
      const pipHomeGsax = parseFloat(pipRow.home_gsax) || 0;
      const pipAwayGsax = parseFloat(pipRow.away_gsax) || 0;
      const pipHomeGsaxPct = parseFloat(pipRow.home_gsax_pct) || 50;
      const pipAwayGsaxPct = parseFloat(pipRow.away_gsax_pct) || 50;
      const pipHomeVegasOdds = pipRow.home_vegas_odds?.trim() ?? '';
      const pipAwayVegasOdds = pipRow.away_vegas_odds?.trim() ?? '';
      const pipHomeVegasWinPct = parseFloat(pipRow.home_vegas_win_pct) || pipHomeWinPct;
      const pipAwayVegasWinPct = parseFloat(pipRow.away_vegas_win_pct) || pipAwayWinPct;
      const pipHomeEv = parseFloat(pipRow.home_ev) || 0;
      const pipAwayEv = parseFloat(pipRow.away_ev) || 0;

      if (pipHomeIsHigher) {
        homeWinPct = pipHomeWinPct; awayWinPct = pipAwayWinPct;
        homeXg = pipHomeXg; awayXg = pipAwayXg;
        homeGoalie = pipHomeStarter; awayGoalie = pipAwayStarter;
        homeGsax = pipHomeGsax; awayGsax = pipAwayGsax;
        homeGsaxPct = pipHomeGsaxPct; awayGsaxPct = pipAwayGsaxPct;
        homeGoalieStats = pipRow.home_goalie_stats?.trim();
        awayGoalieStats = pipRow.away_goalie_stats?.trim();
        homeGoalieVsOpp = pipRow.home_starter_vs_opp?.trim();
        awayGoalieVsOpp = pipRow.away_starter_vs_opp?.trim();
        homeVegasOdds = pipHomeVegasOdds; awayVegasOdds = pipAwayVegasOdds;
        homeVegasWinPct = pipHomeVegasWinPct; awayVegasWinPct = pipAwayVegasWinPct;
        homeEv = pipHomeEv; awayEv = pipAwayEv;
      } else {
        // Pipeline has lower seed as home — swap
        homeWinPct = pipAwayWinPct; awayWinPct = pipHomeWinPct;
        homeXg = pipAwayXg; awayXg = pipHomeXg;
        homeGoalie = pipAwayStarter; awayGoalie = pipHomeStarter;
        homeGsax = pipAwayGsax; awayGsax = pipHomeGsax;
        homeGsaxPct = pipAwayGsaxPct; awayGsaxPct = pipHomeGsaxPct;
        homeGoalieStats = pipRow.away_goalie_stats?.trim();
        awayGoalieStats = pipRow.home_goalie_stats?.trim();
        homeGoalieVsOpp = pipRow.away_starter_vs_opp?.trim();
        awayGoalieVsOpp = pipRow.home_starter_vs_opp?.trim();
        homeVegasOdds = pipAwayVegasOdds; awayVegasOdds = pipHomeVegasOdds;
        homeVegasWinPct = pipAwayVegasWinPct; awayVegasWinPct = pipHomeVegasWinPct;
        homeEv = pipAwayEv; awayEv = pipHomeEv;
      }
    } else {
      // Fallback: compute from ratings
      homeGoalie = getTopGoalie(homeTri);
      awayGoalie = getTopGoalie(awayTri);
      homeGsax = goalieRatings[homeGoalie]?.gsax_per_game ?? 0;
      awayGsax = goalieRatings[awayGoalie]?.gsax_per_game ?? 0;
      homeGsaxPct = goalieGsaxPct(homeGoalie);
      awayGsaxPct = goalieGsaxPct(awayGoalie);
      homeGoalieStats = goalieStatsMap[homeGoalie];
      awayGoalieStats = goalieStatsMap[awayGoalie];

      homeWinPct = computeWinProb(
        homeRatings.xgf_5v5_rating, homeRatings.xga_5v5_rating,
        homeRatings.pp_rating / 100, homeRatings.pk_rating / 100,
        homeRatings.penalties_drawn_per_60, homeRatings.penalties_taken_per_60, homeGsax,
        awayRatings.xgf_5v5_rating, awayRatings.xga_5v5_rating,
        awayRatings.pp_rating / 100, awayRatings.pk_rating / 100,
        awayRatings.penalties_drawn_per_60, awayRatings.penalties_taken_per_60, awayGsax,
      ) * 100;
      awayWinPct = 100 - homeWinPct;
      homeXg = homeRatings.xgf_rolling * (awayRatings.xga_5v5_rating / 2.35);
      awayXg = awayRatings.xgf_rolling * (homeRatings.xga_5v5_rating / 2.35);
      homeVegasWinPct = homeWinPct;
      awayVegasWinPct = awayWinPct;
    }

    seriesPredictions[s.seriesId] = {
      id: `playoff_${s.seriesId}_g${nextGameNum}`,
      date: nextGame?.date ?? 'TBD',
      startTime: nextGame?.startTimeCT ? `${nextGameLabel} · ${nextGame.startTimeCT} CT` : nextGameLabel,
      homeTeam: { ...homeTeam },
      awayTeam: { ...awayTeam },
      homeStarter: homeGoalie,
      awayStarter: awayGoalie,
      homeXg: parseFloat(homeXg.toFixed(2)),
      awayXg: parseFloat(awayXg.toFixed(2)),
      homeModelWinPct: parseFloat(homeWinPct.toFixed(1)),
      awayModelWinPct: parseFloat(awayWinPct.toFixed(1)),
      homeVegasWinPct: parseFloat(homeVegasWinPct.toFixed(1)),
      awayVegasWinPct: parseFloat(awayVegasWinPct.toFixed(1)),
      homeEv,
      awayEv,
      totalGoals: parseFloat((homeXg + awayXg).toFixed(2)),
      homeWager: (() => {
        if (!pipRow) return null;
        const rec = pipRow.wager_recommendation ?? '';
        if (rec.toLowerCase().includes('home') && rec.toLowerCase().includes('unit')) {
          const m = rec.match(/(\d+(\.\d+)?)\s*Unit/i);
          return m ? `${m[1]}u` : null;
        }
        return null;
      })(),
      awayWager: (() => {
        if (!pipRow) return null;
        const rec = pipRow.wager_recommendation ?? '';
        if (rec.toLowerCase().includes('away') && rec.toLowerCase().includes('unit')) {
          const m = rec.match(/(\d+(\.\d+)?)\s*Unit/i);
          return m ? `${m[1]}u` : null;
        }
        return null;
      })(),
      homeModelOdds: probToAmerican(homeWinPct / 100),
      awayModelOdds: probToAmerican(awayWinPct / 100),
      homeVegasOdds,
      awayVegasOdds,

      home_pp_rank: ppRank[homeTri],
      away_pp_rank: ppRank[awayTri],
      home_pk_rank: pkRank[homeTri],
      away_pk_rank: pkRank[awayTri],

      // H2H regular season record
      ...(() => {
        const games = h2hGames[`${homeTri}_${awayTri}`] ?? h2hGames[`${awayTri}_${homeTri}`] ?? [];
        let homeW = 0, homeL = 0, awayW = 0, awayL = 0;
        games.forEach(g => {
          const homeWon = g.homeGoals > g.awayGoals;
          if (g.homeTeam === homeTri) { homeWon ? homeW++ : homeL++; }
          else { homeWon ? awayW++ : awayL++; }
        });
        // From home team's perspective: wins when homeTeam = homeTri or when awayTeam won
        // Recount from each team's perspective
        let hW = 0, hL = 0;
        games.forEach(g => {
          const homeWon = g.homeGoals > g.awayGoals;
          if (g.homeTeam === homeTri) { homeWon ? hW++ : hL++; }
          else { homeWon ? hL++ : hW++; }
        });
        const aW = hL; const aL = hW;
        return {
          home_h2h_record: games.length > 0 ? `${hW}-${hL}` : undefined,
          away_h2h_record: games.length > 0 ? `${aW}-${aL}` : undefined,
        };
      })(),

      home_l7: getL7(homeTri),
      away_l7: getL7(awayTri),
      home_recent_games: getRecentGames(homeTri),
      away_recent_games: getRecentGames(awayTri),

      home_gsax: homeGsax,
      away_gsax: awayGsax,
      home_gsax_total: goalieRatings[homeGoalie]?.gsax_total,
      away_gsax_total: goalieRatings[awayGoalie]?.gsax_total,
      home_gsax_pct: homeGsaxPct,
      away_gsax_pct: awayGsaxPct,

      homeGoalieStatus: 'Likely',
      homeGoalieConfirmed: homeGoalie,
      awayGoalieStatus: 'Likely',
      awayGoalieConfirmed: awayGoalie,

      home_goalie_stats: homeGoalieStats,
      away_goalie_stats: awayGoalieStats,
      homeGoalieVsOpp: homeGoalieVsOpp || undefined,
      awayGoalieVsOpp: awayGoalieVsOpp || undefined,

      // TV network from schedule
      tvNetwork: tvNetworkMap[homeTri + '_' + awayTri] ?? tvNetworkMap[awayTri + '_' + homeTri] ?? '',

      // Backup goalies + career playoff stats
      ...(() => {
        const starter1 = homeGoalie.split(' (')[0]?.trim() || teamGoalies[homeTri]?.[0] || '';
        const starter2 = awayGoalie.split(' (')[0]?.trim() || teamGoalies[awayTri]?.[0] || '';
        const homeGoalies = teamGoalies[homeTri] ?? [];
        const awayGoalies = teamGoalies[awayTri] ?? [];
        const hBackup = homeGoalies.find((g: string) => g.toLowerCase() !== starter1.toLowerCase());
        const aBackup = awayGoalies.find((g: string) => g.toLowerCase() !== starter2.toLowerCase());
        const findPlayoff = (name: string) => goaliePlayoffCareerMap[name] ??
          Object.entries(goaliePlayoffCareerMap).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
        return {
          homeBackupGoalie: hBackup,
          homeBackupGoalieStats: hBackup ? goalieStatsMap[hBackup] : undefined,
          awayBackupGoalie: aBackup,
          awayBackupGoalieStats: aBackup ? goalieStatsMap[aBackup] : undefined,
          homeGoaliePlayoffStats: findPlayoff(starter1),
          awayGoaliePlayoffStats: findPlayoff(starter2),
        };
      })(),

      home_lineup: lineups[homeTri] as TeamLineup | undefined,
      away_lineup: lineups[awayTri] as TeamLineup | undefined,

      home_news: playerNews[homeTri] ?? [],
      away_news: playerNews[awayTri] ?? [],

      // Rich pipeline fields
      ...(pipRow ? {
        home_lineup_score: pipHomeIsHigher
          ? (parseFloat(pipRow.home_lineup_score) || undefined)
          : (parseFloat(pipRow.away_lineup_score) || undefined),
        away_lineup_score: pipHomeIsHigher
          ? (parseFloat(pipRow.away_lineup_score) || undefined)
          : (parseFloat(pipRow.home_lineup_score) || undefined),
        home_xg_explained: (() => {
          try { return JSON.parse(pipHomeIsHigher ? pipRow.home_xg_explained : pipRow.away_xg_explained); } catch { return undefined; }
        })(),
        away_xg_explained: (() => {
          try { return JSON.parse(pipHomeIsHigher ? pipRow.away_xg_explained : pipRow.home_xg_explained); } catch { return undefined; }
        })(),
      } : {}),
    };
  }

  return {
    series, teamsMap, ratings, triToCommon, h2hGames,
    lineups, playerNews, playoffPlayerNews, seriesPredictions, teamGoalies, goalieStatsMap,
    playoffHistory, teamStatsExtended, goalieRatings, gameAnalyses,
  };
}

export default async function NewPage() {
  const {
    series, teamsMap, ratings, triToCommon, h2hGames,
    lineups, playerNews, playoffPlayerNews, seriesPredictions, teamGoalies, goalieStatsMap,
    playoffHistory, teamStatsExtended, goalieRatings, gameAnalyses,
  } = loadData();

  await enrichGameAnalysesWithBoxscore(gameAnalyses);

  const predictions = await getPredictions();
  const navDates = Array.from(new Set(predictions.map(p => p.date))).sort().slice(-2);

  return (
    <main className="min-h-screen bg-black text-white font-sans relative overflow-x-hidden selection:bg-emerald-500/30">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-blue-900/20 blur-[120px] rounded-full pointer-events-none z-0"></div>
      <div className="relative z-10 h-screen flex flex-col">
        <NavBar activePage="playoffs" dates={navDates} />
        <div className="flex-1 min-h-0">
        <PlayoffHub
          series={series}
          teamsMap={teamsMap}
          ratings={ratings}
          triToCommon={triToCommon}
          h2hGames={h2hGames}
          lineups={lineups}
          playerNews={playerNews}
          playoffPlayerNews={playoffPlayerNews}
          seriesPredictions={seriesPredictions}
          teamGoalies={teamGoalies}
          goalieStatsMap={goalieStatsMap}
          playoffHistory={playoffHistory}
          teamStatsExtended={teamStatsExtended}
          goalieRatings={goalieRatings}
          gameAnalyses={gameAnalyses}
        />
        </div>
      </div>
    </main>
  );
}
