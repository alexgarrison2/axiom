import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

export interface Team {
  name: string;
  commonName: string;
  logoUrl: string;
  color1: string;
  color2: string;
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
}

interface RawTeam {
  'Team Name': string;
  'Common Name': string;
  'Team Logo URL': string;
  'Hex Color 1': string;
  'Hex Color 2': string;
}

export async function getPredictions(): Promise<GamePrediction[]> {
  const dataDir = path.join(process.cwd(), 'data');

  const teamsCsv = fs.readFileSync(path.join(dataDir, 'nhl_teams.csv'), 'utf8');
  const predictionsCsv = fs.readFileSync(path.join(dataDir, 'predictions_detailed.csv'), 'utf8');

  const teamsParsed = Papa.parse<RawTeam>(teamsCsv, { header: true, skipEmptyLines: true });
  const predictionsParsed = Papa.parse<RawPrediction>(predictionsCsv, { header: true, skipEmptyLines: true });

  const teamsMap = new Map<string, Team>();
  teamsParsed.data.forEach((row) => {
    teamsMap.set(row['Common Name'], {
      name: row['Team Name'],
      commonName: row['Common Name'],
      logoUrl: row['Team Logo URL'],
      color1: row['Hex Color 1'],
      color2: row['Hex Color 2'],
    });
  });

  const predictions: GamePrediction[] = predictionsParsed.data.map((row) => {
    const homeTeam = teamsMap.get(row.home_team);
    const awayTeam = teamsMap.get(row.away_team);

    if (!homeTeam || !awayTeam) {
      console.warn(`Team not found for game ${row.game_id}: ${row.home_team} vs ${row.away_team}`);
      return null;
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
    };
  }).filter((p): p is GamePrediction => p !== null);

  return predictions;
}

function parseWager(recommendation: string, side: 'Home' | 'Away'): string | null {
  if (!recommendation) return null;
  if (recommendation.includes(side) && recommendation.toLowerCase().includes('unit')) {
    const match = recommendation.match(/(\d+(\.\d+)?)\s*Unit/i);
    return match ? `${match[1]}u` : null;
  }
  return null;
}
