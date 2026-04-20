import React from 'react';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import PlayoffHub from '@/components/playoff/PlayoffHub';
import Header from '@/components/Header';
import type { GamePrediction, RecentGame, TeamLineup } from '@/utils/data';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Types for the data we load
export interface PlayoffSeriesGame {
  gameNumber: number;
  date: string;
  startTimeUTC: string;
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
  const allRows: any[] = gamestatsParsed.data as any[];

  // Per-team: sorted by date desc
  const teamRows: Record<string, any[]> = {};
  allRows.forEach((row: any) => {
    const tri = commonToTri[row.team?.trim()];
    if (!tri) return;
    if (!teamRows[tri]) teamRows[tri] = [];
    teamRows[tri].push(row);
  });
  Object.values(teamRows).forEach(rows => rows.sort((a, b) => b.game_date.localeCompare(a.game_date)));

  // Identify #1 goalie per team: most starts in last 20 games
  function getTopGoalie(tri: string): string {
    const rows = (teamRows[tri] ?? []).slice(0, 20);
    const counts: Record<string, number> = {};
    rows.forEach((r: any) => {
      const g = r.starting_goalie?.trim();
      if (g) counts[g] = (counts[g] ?? 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'TBD';
  }

  // L7 record per team
  function getL7(tri: string): string {
    const rows = (teamRows[tri] ?? []).slice(0, 7);
    let w = 0, otl = 0, l = 0;
    rows.forEach((r: any) => {
      const res = r.result?.trim();
      if (res === 'RW' || res === 'OTW' || res === 'SOW') w++;
      else if (res === 'OTL' || res === 'SOL') otl++;
      else l++;
    });
    return `${w}-${l}-${otl}`;
  }

  // Recent games (last 5) per team shaped as RecentGame[]
  function getRecentGames(tri: string): RecentGame[] {
    return (teamRows[tri] ?? []).slice(0, 5).map((r: any) => {
      const oppTri = commonToTri[r.opponent?.trim()];
      const res = r.result?.trim() ?? '';
      let result: RecentGame['result'] = 'L';
      if (res === 'RW') result = 'W';
      else if (res === 'OTW') result = 'W-OT';
      else if (res === 'SOW') result = 'W-SO';
      else if (res === 'OTL' || res === 'SOL') result = 'O';
      const [yr, mo, dy] = r.game_date.split('-');
      const fmtDate = yr && mo && dy ? `${parseInt(mo)}/${parseInt(dy)}` : r.game_date;
      return {
        date: fmtDate,
        opponent: oppTri ?? r.opponent,
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
      date: 'TBD',
      startTime: nextGameLabel,
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
    playoffHistory, teamStatsExtended, goalieRatings,
  };
}

export default async function NewPage() {
  const {
    series, teamsMap, ratings, triToCommon, h2hGames,
    lineups, playerNews, playoffPlayerNews, seriesPredictions, teamGoalies, goalieStatsMap,
    playoffHistory, teamStatsExtended, goalieRatings,
  } = loadData();

  return (
    <main className="min-h-screen bg-black text-white font-sans relative overflow-x-hidden selection:bg-emerald-500/30">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-blue-900/20 blur-[120px] rounded-full pointer-events-none z-0"></div>
      <div className="relative z-10 h-screen flex flex-col">
        <Header compact />
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
        />
        </div>
      </div>
    </main>
  );
}
