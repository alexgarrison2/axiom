import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { json, parseRecent, str, type RawRow } from './parse';
import { buildIndex, leagueContext, lineupView, type DfoLineup, type ImpactData } from './lineup-impact';
import { CUR_TAG, PREV_TAG, disambiguate, shortDate } from './format';
import type { GoalieView, InjuryView, MatchupDetails, MatchupDetailsPayload, SideDetails } from '../../types/prediction';

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

export function getMatchupDetails(): MatchupDetailsPayload {
    let rows: RawRow[] = [];
    try {
        rows = Papa.parse<RawRow>(READ.predictions(), { header: true, skipEmptyLines: true }).data;
    } catch {
        rows = [];
    }
    const teamGoalies = readJson<Record<string, string[]>>('teamGoalies') ?? {};
    const lines = readJson<{ goalies?: Record<string, { cur: GoalieLine | null; prev: GoalieLine | null }> }>('goalieLines')?.goalies ?? {};
    const ratings = readJson<Record<string, { gsax_per_game?: number | null; games_played?: number }>>('goalieRatings') ?? {};
    const injuries = readJson<Injury[]>('injuries') ?? [];
    const ctx = leagueContext(buildIndex(readJson<ImpactData>('impact') ?? {}), readJson<Record<string, DfoLineup>>('lineups') ?? {});

    const goalieView = (name: string, starter: boolean): GoalieView => {
        const l = lines[name];
        const r = ratings[name];
        const g = r?.gsax_per_game;
        const gsax = typeof g === 'number' && Number.isFinite(g) ? Math.round(g * 100) / 100 : null;
        const curGp = l?.cur?.gp ?? r?.games_played ?? 0;
        return { name, starter, cur: l?.cur ?? null, prev: l?.prev ?? null, gsaxPerGame: gsax, gsaxSeason: gsax == null ? null : curGp > 0 ? CUR_TAG : PREV_TAG };
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
        games[id] = { home: sideDetails('home'), away: sideDetails('away') };
    }
    return { generatedAt: new Date().toISOString(), games };
}
