import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { json, parseRecent, str, type RawRow } from './parse';
import { buildIndex, leagueContext, lineupView, type DfoLineup, type ImpactData } from './lineup-impact';
import { disambiguate, gsaxWindow, isCoinFlip, shortDate } from './format';
import type { GoalieView, InjuryView, MatchupDetails, MatchupDetailsPayload, PickSummaries, SideDetails } from '../../types/prediction';
import { SEASON_ID, SEASON_START_DATE } from '../season';
import { TEAM_CODES, TEAM_NAMES } from '../../components/ui/team-color';
import { loadSeasonGames, ratingsSeason } from '../../utils/team-stats/server';
import { goalieStartsGsax } from '../../utils/team-stats/game-row';

/*
 * Server loader for /api/matchup-details: lineups with impact values,
 * goalie tandems, injuries, recent games and news for every game on the
 * slate. Kept out of utils/data.ts so the home function never traces
 * player_impact.json (1.1MB) or team_lineups.json. Literal paths only.
 */
const READ = {
    predictions: () => fs.readFileSync(path.join(process.cwd(), 'data', 'predictions_detailed.csv'), 'utf8'),
    teamGoalies: () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'team_goalies.json'), 'utf8'),
    goalieLines: () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'goalie_season_lines.json'), 'utf8'),
    goalieRatings: () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'goalie_ratings.json'), 'utf8'),
    injuries: () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'injuries.json'), 'utf8'),
    impact: () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'player_impact.json'), 'utf8'),
    lineups: () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'team_lineups.json'), 'utf8'),
    history: () => fs.readFileSync(path.join(process.cwd(), 'data', 'prediction_history.json'), 'utf8'),
} as const;

function readJson<T>(k: keyof typeof READ): T | null {
    try {
        return JSON.parse(READ[k]()) as T;
    } catch {
        return null;
    }
}

interface GoalieLine {
    w: number;
    l: number;
    ot: number;
    svpct: number;
    gaa: number;
    gp: number;
}

interface Injury {
    name: string;
    team: string;
    position?: string;
    status?: string;
    type?: string | null;
    returnDate?: string | null;
}

function typeShort(t: string | null | undefined): string | null {
    if (!t || /undisclosed|not specified/i.test(t)) return null;
    if (/lower body/i.test(t)) return 'LB';
    if (/upper body/i.test(t)) return 'UB';
    return t.length > 12 ? t.slice(0, 12) : t;
}

const OUT_STATUSES = /injured reserve|long.?term|\bout\b|suspen|day-to-day/i;

function statusShort(s: string): string {
    if (/long.?term/i.test(s)) return 'LTIR';
    if (/injured reserve/i.test(s)) return 'IR';
    if (/day-to-day/i.test(s)) return 'DTD';
    if (/suspen/i.test(s)) return 'SUSP';
    return 'OUT';
}

export function injuriesFor(all: Injury[], team: string, lineupNames: Set<string>): InjuryView[] {
    const items = all.filter(i => i && i.team === team && i.status && OUT_STATUSES.test(i.status) && !lineupNames.has(i.name.toLowerCase()));
    const display = disambiguate(items.map(i => i.name));
    return items
        .map(i => ({
            name: i.name,
            display: display.get(i.name) ?? i.name,
            pos: (i.position ?? '').toUpperCase(),
            status: statusShort(i.status ?? ''),
            detail: typeShort(i.type),
            returnLabel: i.returnDate && /^\d{4}-\d{2}-\d{2}/.test(i.returnDate) ? shortDate(i.returnDate.slice(0, 10)) : null,
        }))
        .sort((a, b) => Number(a.status === 'DTD') - Number(b.status === 'DTD'))
        .slice(0, 8);
}

interface RawHistory {
    date: string;
    season?: string;
    /** null on picks made before the versioned model (legacy). */
    modelVersion?: string | null;
    homeTeam: string;
    awayTeam: string;
    homeWinProb?: number | null;
    predictedWinner: string;
    isCorrect: boolean;
    retro?: boolean;
}

const TRI_BY_SHORT = new Map(TEAM_CODES.map(t => [TEAM_NAMES[t].short, t]));

/**
 * Pick form per team: this season's graded picks, newest last, the last 10
 * where the model picked the team to win and to lose. Replaces shipping the
 * whole prediction history (460KB) to the browser. Legacy picks (no model
 * version) and coin flips (within 1 pt of 50) are not the model's calls.
 */
export function pickSummaries(hist: RawHistory[], teams?: string[]): PickSummaries {
    const want = teams ? new Set(teams) : null;
    const out: PickSummaries = {};
    const rows = hist
        .filter(h => h && h.date >= SEASON_START_DATE && !h.retro && !!h.modelVersion && !isCoinFlip(h.homeWinProb))
        .sort((a, b) => a.date.localeCompare(b.date));
    for (const h of rows) {
        for (const name of [h.homeTeam, h.awayTeam]) {
            const tri = TRI_BY_SHORT.get(name);
            if (!tri || (want && !want.has(tri))) continue;
            const s = (out[tri] ??= { pickedWin: [], pickedLose: [] });
            (h.predictedWinner === name ? s.pickedWin : s.pickedLose).push(!!h.isCorrect);
        }
    }
    for (const s of Object.values(out)) {
        s.pickedWin = s.pickedWin.slice(-10);
        s.pickedLose = s.pickedLose.slice(-10);
    }
    return out;
}


export function getMatchupDetails(): MatchupDetailsPayload {
    let rows: RawRow[] = [];
    try {
        rows = Papa.parse<RawRow>(READ.predictions(), { header: true, skipEmptyLines: true }).data;
    } catch {
        rows = [];
    }
    const teamGoalies = readJson<Record<string, string[]>>('teamGoalies') ?? {};
    const fold = (n: string) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
    const byFold = <T,>(o: Record<string, T>) => new Map(Object.entries(o).map(([k, v]) => [fold(k), v]));
    const lines = byFold(readJson<{ goalies?: Record<string, { cur: GoalieLine | null; prev: GoalieLine | null }> }>('goalieLines')?.goalies ?? {});
    const ratings = byFold(
        readJson<Record<string, { gsax_per_game?: number | null; games_played?: number; gsax_total?: number | null; games_by_season?: Record<string, number> }>>('goalieRatings') ?? {},
    );
    const injuries = readJson<Injury[]>('injuries') ?? [];
    const goalieInjuries = new Map(injuries.filter(i => i && (i.position ?? '').toUpperCase() === 'G' && i.status && OUT_STATUSES.test(i.status)).map(i => [fold(i.name), i]));
    const ctx = leagueContext(buildIndex(readJson<ImpactData>('impact') ?? {}), readJson<Record<string, DfoLineup>>('lineups') ?? {});
    // player_impact.json describes last season until enough games are in (the team pages use the same rule).
    const impactSeason = ratingsSeason();
    // This season's starts per goalie, from the same rows and function as the team page's goalie lines.
    let seasonGames: ReturnType<typeof loadSeasonGames> = [];
    try {
        seasonGames = loadSeasonGames(SEASON_ID);
    } catch {
        seasonGames = [];
    }

    const goalieView = (name: string, starter: boolean): GoalieView => {
        const key = fold(name);
        const l = lines.get(key);
        const r = ratings.get(key);
        const g = r?.gsax_per_game;
        const gsax = typeof g === 'number' && Number.isFinite(g) ? Math.round(g * 100) / 100 : null;
        const ratedGp = typeof r?.games_played === 'number' && r.games_played > 0 ? r.games_played : 0;
        const cur = goalieStartsGsax(seasonGames, name);
        const inj = goalieInjuries.get(key);
        return {
            name,
            starter,
            cur: l?.cur ?? null,
            prev: l?.prev ?? null,
            gsaxPerGame: gsax,
            gsaxSeason: gsax == null ? null : gsaxWindow(Object.keys(r?.games_by_season ?? {}), ratedGp > 0),
            // Per start, as the team page's GSAx/GS column shows it.
            gsaxCur: cur.gsax != null && cur.gs > 0 ? Number((cur.gsax / cur.gs).toFixed(2)) : null,
            gsaxCurGp: cur.gs,
            injury: inj
                ? {
                      status: statusShort(inj.status ?? ''),
                      returnLabel: inj.returnDate && /^\d{4}-\d{2}-\d{2}/.test(inj.returnDate) ? shortDate(inj.returnDate.slice(0, 10)) : null,
                  }
                : null,
        };
    };

    const games: Record<string, MatchupDetails> = {};
    for (const row of rows) {
        const id = str(row.nhl_game_id);
        if (!id) continue;
        const sideDetails = (s: 'home' | 'away'): SideDetails => {
            const tri = str(row[`${s}_abbrev`]) ?? '';
            const lu = json<Record<string, unknown> | null>(row[`${s}_lineup`], null);
            const view = lineupView(ctx, lu as DfoLineup | null, tri);
            const lineupNames = new Set(Object.values(view?.lines ?? {}).flat().map(p => p.name.toLowerCase()));
            const starter = str(row[`${s}_goalie_confirmed`]) ?? str(row[`${s}_starter`])?.replace(/\s*\(.*\)\s*$/, '') ?? null;
            // Tandem from the fresh team_goalies.json; the projected starter leads.
            const tandem = [...new Set([...(starter ? [starter] : []), ...(teamGoalies[tri] ?? [])])].slice(0, 3);
            const news = json<SideDetails['news']>(row[`${s}_news`], []);
            const meta = (k: string) => (lu && typeof lu[k] === 'string' ? (lu[k] as string) : null);
            return {
                lines: view?.lines ?? {},
                lineImpacts: view?.lineImpacts ?? {},
                grade: view?.grade ?? null,
                lineupSource: meta('lineup_source'),
                lineupUpdatedAt: meta('updated_at') ?? meta('fetched_at'),
                injuries: injuriesFor(injuries, tri, lineupNames),
                goalies: tandem.map(n => goalieView(n, n === starter)),
                recent: parseRecent(row[`${s}_l7_games`]),
                news: Array.isArray(news) ? news.filter(n => n && typeof n.news === 'string') : [],
            };
        };
        games[id] = { home: sideDetails('home'), away: sideDetails('away'), impactSeason };
    }
    const teams = [...new Set(rows.flatMap(r => [str(r.home_abbrev), str(r.away_abbrev)]).filter((t): t is string => !!t))];
    return { generatedAt: new Date().toISOString(), games, picks: pickSummaries(readJson<RawHistory[]>('history') ?? [], teams) };
}
