import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

export interface Team {
  name: string;
  commonName: string;
  logoUrl: string;
  color1: string;
  color2: string;
  triCode: string;
}

export interface RecentGame {
  date: string;
  gameNumber?: string;
  opponent: string;
  opponentLogo: string;
  isHome: boolean;
  score: string;
  result: 'W' | 'L' | 'O' | 'W-OT' | 'W-SO';
  opponentColor?: string;
  starter?: string;
}

export interface PlayerNewsItem {
  player: string;
  news: string;
  category: string;
  date: string;
  timestamp?: string;
}

export interface LineupPlayer {
  id: number;
  name: string;
  number: number | null;
  pos: string;
  ppUnit?: number; // 1 or 2
  movement?: 'up' | 'down' | 'new';
}

export interface TeamLineup {
  [key: string]: LineupPlayer[]; // f1, f2, f3, f4, d1, d2, d3
}

export interface GamePrediction {
  id: string;
  date: string;
  homeTeam: Team;
  awayTeam: Team;
  homeStarter: string;
  awayStarter: string;
  homeXg: number;
  awayXg: number;
  homeModelWinPct: number;
  awayModelWinPct: number;
  homeVegasWinPct: number;
  awayVegasWinPct: number;
  homeEv: number;
  awayEv: number;
  totalGoals: number;
  homeWager: string | null;
  awayWager: string | null;
  homeModelOdds: string;
  awayModelOdds: string;
  homeVegasOdds: string;
  awayVegasOdds: string;
  startTime: string;

  home_pp_rank?: number;
  home_pk_rank?: number;
  away_pp_rank?: number;
  away_pk_rank?: number;
  home_l7?: string;
  away_l7?: string;
  home_recent_games?: RecentGame[];
  away_recent_games?: RecentGame[];
  home_gas?: number;
  away_gas?: number;
  home_gas_breakdown?: string[];
  away_gas_breakdown?: string[];
  home_gsax?: number;        // GSAx per game for projected home starter
  away_gsax?: number;
  home_gsax_total?: number;
  home_gsax_pct?: number;
  away_gsax_total?: number;
  away_gsax_pct?: number;

  home_news?: PlayerNewsItem[];
  away_news?: PlayerNewsItem[];

  home_lineup?: TeamLineup;
  away_lineup?: TeamLineup;
  home_lineup_score?: number;    // quality ratio vs league avg (1.0 = avg, 1.05 = +5%)
  away_lineup_score?: number;
  home_lineup_vs_team?: number;  // quality ratio vs this team's own historical avg
  away_lineup_vs_team?: number;

  home_goalie_stats?: string;
  away_goalie_stats?: string;
  homeGoalieVsOpp?: string; // JSON string
  awayGoalieVsOpp?: string; // JSON string

  home_xg_explained?: string[]; // JSON Array from Python
  away_xg_explained?: string[]; // JSON Array from Python

  homeGoalieStatus?: string;
  homeGoalieConfirmed?: string;
  awayGoalieStatus?: string;
  awayGoalieConfirmed?: string;

  home_avg_speed?: number;
  away_avg_speed?: number;
  home_rr_rate?: number;
  away_rr_rate?: number;

  home_h2h_record?: string;
  away_h2h_record?: string;
  home_is_b2b?: boolean;
  away_is_b2b?: boolean;
  home_is_3in4?: boolean;
  away_is_3in4?: boolean;
  home_is_4in6?: boolean;
  away_is_4in6?: boolean;
  home_is_6in9?: boolean;
  away_is_6in9?: boolean;
  home_xg_sparkline?: number[];
  away_xg_sparkline?: number[];
}

export interface HistoryEntry {
  date: string;
  homeTeam: Team;
  awayTeam: Team;
  homeScore: number;
  awayScore: number;
  homeXg: number;
  awayXg: number;
  homeWinProb: number;
  predictedWinner: string;
  actualWinner: string;
  isCorrect: boolean;
  brierScore: number;
}

interface RawPrediction {
  game_date: string;
  game_id: string;
  home_team: string;
  home_starter: string;
  home_xg: string;
  home_win_pct: string;
  home_vegas_win_pct: string;
  home_ev: string;
  away_team: string;
  away_starter: string;
  away_xg: string;
  away_win_pct: string;
  away_vegas_win_pct: string;
  away_ev: string;
  wager_recommendation: string;
  home_model_odds: string;
  away_model_odds: string;
  home_vegas_odds: string;
  away_vegas_odds: string;
  game_start_time: string;

  home_pp_rank?: string;
  home_pk_rank?: string;
  away_pp_rank?: string;
  away_pk_rank?: string;
  home_l7?: string;
  away_l7?: string;
  home_l7_games?: string;
  away_l7_games?: string;
  home_gas?: string;
  away_gas?: string;
  home_gas_breakdown?: string;
  away_gas_breakdown?: string;
  home_gsax?: string;
  away_gsax?: string;
  home_gsax_total?: string;
  home_gsax_pct?: string;
  away_gsax_total?: string;
  away_gsax_pct?: string;
  home_news?: string;
  away_news?: string;
  home_lineup?: string;
  away_lineup?: string;
  home_lineup_score?: string;
  away_lineup_score?: string;
  home_lineup_vs_team?: string;
  away_lineup_vs_team?: string;
  home_goalie_stats?: string;
  away_goalie_stats?: string;
  home_starter_vs_opp?: string;
  away_starter_vs_opp?: string;
  home_xg_explained?: string;
  away_xg_explained?: string;

  home_goalie_status?: string;
  home_goalie_confirmed?: string;
  away_goalie_status?: string;
  away_goalie_confirmed?: string;

  home_avg_speed?: string;
  away_avg_speed?: string;
  home_rr_rate?: string;
  away_rr_rate?: string;

  home_h2h_record?: string;
  away_h2h_record?: string;
  home_is_b2b?: string;
  away_is_b2b?: string;
  home_is_3in4?: string;
  away_is_3in4?: string;
  home_is_4in6?: string;
  away_is_4in6?: string;
  home_is_6in9?: string;
  away_is_6in9?: string;
  home_xg_sparkline?: string;
  away_xg_sparkline?: string;
}

interface RawTeam {
  'Team Name': string;
  'Common Name': string;
  'Team Logo URL': string;
  'Hex Color 1': string;
  'Hex Color 2': string;
  'Team Tricode': string;
}

export async function getPredictions(): Promise<GamePrediction[]> {
  const dataDir = path.join(process.cwd(), 'data');
  const predictionsCsv = fs.readFileSync(path.join(dataDir, 'predictions_detailed.csv'), 'utf8');
  const teamsCsv = fs.readFileSync(path.join(dataDir, 'nhl_teams.csv'), 'utf8');
  // const lastUpdate = fs.readFileSync(path.join(dataDir, 'last_update.txt'), 'utf8');

  const predictionsParsed = Papa.parse<RawPrediction>(predictionsCsv, { header: true, skipEmptyLines: true });
  const teamsParsed = Papa.parse<RawTeam>(teamsCsv, { header: true, skipEmptyLines: true });

  const teamsMap = new Map<string, Team>();
  teamsParsed.data.forEach((row) => {
    teamsMap.set(row['Common Name'], {
      name: row['Team Name'],
      commonName: row['Common Name'],
      logoUrl: row['Team Logo URL'],
      color1: row['Hex Color 1'],
      color2: row['Hex Color 2'],
      triCode: row['Team Tricode'],
    });
  });

  // Create TriCode maps for recent games parsing
  const triCodeToLogoMap = new Map<string, string>();
  const triCodeToColorMap = new Map<string, string>();
  teamsParsed.data.forEach((row) => {
    triCodeToLogoMap.set(row['Team Tricode'], row['Team Logo URL']);
    triCodeToColorMap.set(row['Team Tricode'], row['Hex Color 1']);
  });

  const predictions = predictionsParsed.data.map((row): GamePrediction | null => {
    const homeTeam = teamsMap.get(row.home_team);
    const awayTeam = teamsMap.get(row.away_team);

    // Parse Recent Games with Logo Mapping
    const parseRecent = (jsonStr?: string): RecentGame[] => {
      if (!jsonStr) return [];
      try {
        const games = JSON.parse(jsonStr) as Omit<RecentGame, 'opponentLogo'>[];
        return games.map(g => ({
          ...g,
          opponentLogo: triCodeToLogoMap.get(g.opponent) || '',
          opponentColor: triCodeToColorMap.get(g.opponent) || ''
        }));
      } catch (e) {
        console.error("Error parsing recent games", e);
        return [];
      }
    };

    // Parse News
    const parseNews = (jsonStr?: string): PlayerNewsItem[] => {
      if (!jsonStr) return [];
      try {
        return JSON.parse(jsonStr) as PlayerNewsItem[];
      } catch (e) {
        console.error("Error parsing news", e);
        return [];
      }
    };

    // Parse Lineups
    const parseLineup = (jsonStr?: string): TeamLineup | undefined => {
      if (!jsonStr || jsonStr === '{}') return undefined; // Empty or null
      try {
        return JSON.parse(jsonStr) as TeamLineup;
      } catch (e) {
        console.error("Error parsing lineup", e);
        return undefined;
      }
    };

    // Parse Explanation
    const parseExplanation = (jsonStr?: string): string[] => {
      if (!jsonStr) return [];
      try {
        return JSON.parse(jsonStr) as string[];
      } catch {
        return [];
      }
    };

    // Parse Sparkline
    // Python's json.dumps writes literal 'NaN' for float NaN, which is invalid JSON.
    // Replace 'NaN' with 'null' before parsing, then filter out nulls/non-finite values.
    const parseSparkline = (jsonStr?: string): number[] => {
      if (!jsonStr || jsonStr === '[]') return [];
      try {
        const fixed = jsonStr.replace(/\bNaN\b/g, 'null');
        const arr = JSON.parse(fixed) as (number | null)[];
        return arr.filter((v): v is number => v !== null && isFinite(v));
      } catch {
        return [];
      }
    };

    if (!homeTeam || !awayTeam) {
      // console.warn(`Team not found for game ${row.game_id}: ${row.home_team} vs ${row.away_team}`);
      return null; // Skip invalid teams
    }

    const homeXg = parseFloat(row.home_xg);
    const awayXg = parseFloat(row.away_xg);
    const totalGoals = homeXg + awayXg;

    return {
      id: row.game_id,
      date: row.game_date,
      homeTeam,
      awayTeam,
      homeStarter: row.home_starter,
      awayStarter: row.away_starter,
      homeXg,
      awayXg,
      homeModelWinPct: parseFloat(row.home_win_pct),
      awayModelWinPct: parseFloat(row.away_win_pct),
      homeVegasWinPct: parseFloat(row.home_vegas_win_pct),
      awayVegasWinPct: parseFloat(row.away_vegas_win_pct),
      homeEv: row.home_ev ? parseFloat(row.home_ev) : 0,
      awayEv: row.away_ev ? parseFloat(row.away_ev) : 0,
      totalGoals,
      homeWager: parseWager(row.wager_recommendation, 'Home'),
      awayWager: parseWager(row.wager_recommendation, 'Away'),
      homeModelOdds: row.home_model_odds || '',
      awayModelOdds: row.away_model_odds || '',
      homeVegasOdds: row.home_vegas_odds || '',
      awayVegasOdds: row.away_vegas_odds || '',
      startTime: row.game_start_time || '',

      home_pp_rank: row.home_pp_rank ? parseInt(row.home_pp_rank) : undefined,
      home_pk_rank: row.home_pk_rank ? parseInt(row.home_pk_rank) : undefined,
      away_pp_rank: row.away_pp_rank ? parseInt(row.away_pp_rank) : undefined,
      away_pk_rank: row.away_pk_rank ? parseInt(row.away_pk_rank) : undefined,
      home_l7: row.home_l7 || undefined,
      away_l7: row.away_l7 || undefined,
      home_recent_games: parseRecent(row.home_l7_games),
      away_recent_games: parseRecent(row.away_l7_games),
      home_gas: row.home_gas ? parseInt(row.home_gas) : undefined,
      away_gas: row.away_gas ? parseInt(row.away_gas) : undefined,
      home_gas_breakdown: row.home_gas_breakdown ? row.home_gas_breakdown.split('|') : [],
      away_gas_breakdown: row.away_gas_breakdown ? row.away_gas_breakdown.split('|') : [],
      home_gsax: row.home_gsax ? parseFloat(row.home_gsax) : undefined,
      away_gsax: row.away_gsax ? parseFloat(row.away_gsax) : undefined,
      home_gsax_total: row.home_gsax_total ? parseFloat(row.home_gsax_total) : undefined,
      home_gsax_pct: row.home_gsax_pct ? parseFloat(row.home_gsax_pct) : undefined,
      away_gsax_total: row.away_gsax_total ? parseFloat(row.away_gsax_total) : undefined,
      away_gsax_pct: row.away_gsax_pct ? parseFloat(row.away_gsax_pct) : undefined,

      home_news: parseNews(row.home_news),
      away_news: parseNews(row.away_news),
      home_lineup: parseLineup(row.home_lineup),
      away_lineup: parseLineup(row.away_lineup),
      home_lineup_score: row.home_lineup_score ? parseFloat(row.home_lineup_score) : undefined,
      away_lineup_score: row.away_lineup_score ? parseFloat(row.away_lineup_score) : undefined,
      home_lineup_vs_team: row.home_lineup_vs_team ? parseFloat(row.home_lineup_vs_team) : undefined,
      away_lineup_vs_team: row.away_lineup_vs_team ? parseFloat(row.away_lineup_vs_team) : undefined,

      home_goalie_stats: row.home_goalie_stats || undefined,
      away_goalie_stats: row.away_goalie_stats || undefined,

      homeGoalieVsOpp: row.home_starter_vs_opp || undefined,
      awayGoalieVsOpp: row.away_starter_vs_opp || undefined,

      home_xg_explained: parseExplanation(row.home_xg_explained),
      away_xg_explained: parseExplanation(row.away_xg_explained),

      homeGoalieStatus: row.home_goalie_status,
      homeGoalieConfirmed: row.home_goalie_confirmed,
      awayGoalieStatus: row.away_goalie_status,
      awayGoalieConfirmed: row.away_goalie_confirmed,

      home_avg_speed: row.home_avg_speed ? parseFloat(row.home_avg_speed) : undefined,
      away_avg_speed: row.away_avg_speed ? parseFloat(row.away_avg_speed) : undefined,
      home_rr_rate: row.home_rr_rate ? parseFloat(row.home_rr_rate) : undefined,
      away_rr_rate: row.away_rr_rate ? parseFloat(row.away_rr_rate) : undefined,

      home_h2h_record: row.home_h2h_record || undefined,
      away_h2h_record: row.away_h2h_record || undefined,
      home_is_b2b: row.home_is_b2b?.toLowerCase() === 'true',
      away_is_b2b: row.away_is_b2b?.toLowerCase() === 'true',
      home_is_3in4: row.home_is_3in4?.toLowerCase() === 'true',
      away_is_3in4: row.away_is_3in4?.toLowerCase() === 'true',
      home_is_4in6: row.home_is_4in6?.toLowerCase() === 'true',
      away_is_4in6: row.away_is_4in6?.toLowerCase() === 'true',
      home_is_6in9: row.home_is_6in9?.toLowerCase() === 'true',
      away_is_6in9: row.away_is_6in9?.toLowerCase() === 'true',
      home_xg_sparkline: parseSparkline(row.home_xg_sparkline),
      away_xg_sparkline: parseSparkline(row.away_xg_sparkline),
    };
  }).filter((p): p is GamePrediction => p !== null);

  return predictions;
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const dataDir = path.join(process.cwd(), 'data');
  const teamsCsv = fs.readFileSync(path.join(dataDir, 'nhl_teams.csv'), 'utf8');
  const historyJson = fs.readFileSync(path.join(dataDir, 'prediction_history.json'), 'utf8');

  const teamsParsed = Papa.parse<RawTeam>(teamsCsv, { header: true, skipEmptyLines: true });
  const rawHistory = JSON.parse(historyJson);

  const teamsMap = new Map<string, Team>();
  teamsParsed.data.forEach((row) => {
    teamsMap.set(row['Common Name'], {
      name: row['Team Name'],
      commonName: row['Common Name'],
      logoUrl: row['Team Logo URL'],
      color1: row['Hex Color 1'],
      color2: row['Hex Color 2'],
      triCode: row['Team Tricode'],
    });
  });

  interface RawHistoryEntry {
    date: string;
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    homeXg: number;
    awayXg: number;
    homeWinProb: number;
    predictedWinner: string;
    actualWinner: string;
    isCorrect: boolean;
    brierScore: number;
  }

  // Sort Descending by Date
  // rawHistory is list of objects.
  const history: HistoryEntry[] = rawHistory.map((row: RawHistoryEntry) => {
    const homeTeam = teamsMap.get(row.homeTeam);
    const awayTeam = teamsMap.get(row.awayTeam);

    if (!homeTeam || !awayTeam) return null;

    return {
      date: row.date,
      homeTeam,
      awayTeam,
      homeScore: row.homeScore,
      awayScore: row.awayScore,
      homeXg: row.homeXg,
      awayXg: row.awayXg,
      homeWinProb: row.homeWinProb,
      predictedWinner: row.predictedWinner,
      actualWinner: row.actualWinner,
      isCorrect: row.isCorrect,
      brierScore: row.brierScore
    };
  }).filter((h: HistoryEntry | null): h is HistoryEntry => h !== null);

  return history.reverse(); // Newest first (assuming generation was chronological)
}

function parseWager(recommendation: string, side: 'Home' | 'Away'): string | null {
  if (!recommendation) return null;
  if (recommendation.includes(side) && recommendation.toLowerCase().includes('unit')) {
    const match = recommendation.match(/(\d+(\.\d+)?)\s*Unit/i);
    return match ? `${match[1]}u` : null;
  }
  return null;
}

export async function getLastRefresh(): Promise<string> {
  const filePath = path.join(process.cwd(), 'data/last_updated.json');
  try {
    const fileContents = await fs.promises.readFile(filePath, 'utf8');
    const data = JSON.parse(fileContents);
    return data.last_refresh || "Unknown";
  } catch (error) {
    console.error("Error reading last_updated.json:", error);
    return "Unknown";
  }
}
