import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { SEASON_ID } from '@/lib/season';
import { parseRow, parseRecent, parseTv, recordFromRecent, str, type RawRow } from '@/lib/matchup/parse';
import type { Prediction, TvBroadcast } from '@/types/prediction';

export type { Prediction } from '@/types/prediction';

/** DailyFaceoff news item (predictions side_news, player_news.json). */
export interface PlayerNewsItem {
    player: string;
    news: string;
    category: string;
    date: string;
    timestamp?: string;
}

/*
 * Every path is a literal: a path.join(process.cwd(), variable) makes
 * Turbopack trace whole directories into the function (the home function
 * has a 5MB trace budget).
 */
const READ = {
    predictions: () => fs.readFileSync(path.join(process.cwd(), 'data', 'predictions_detailed.csv'), 'utf8'),
    upcoming: () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'upcoming_games.json'), 'utf8'),
    projections: () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'season_projections.json'), 'utf8'),
    series: () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'playoff_series.json'), 'utf8'),
    implications: () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'game_implications.json'), 'utf8'),
} as const;

function readJson<T>(k: keyof typeof READ): T | null {
    try {
        return JSON.parse(READ[k]()) as T;
    } catch {
        return null;
    }
}

function readRows(): RawRow[] {
    try {
        return Papa.parse<RawRow>(READ.predictions(), { header: true, skipEmptyLines: true }).data;
    } catch {
        return [];
    }
}

function tvNetworks(): Map<string, TvBroadcast[]> {
    const m = new Map<string, TvBroadcast[]>();
    const games = readJson<{ id?: number; homeTeamAbbrev?: string; awayTeamAbbrev?: string; tvNetwork?: string; tvDisplay?: unknown }[]>('upcoming') ?? [];
    for (const g of games) {
        const tv = parseTv(g);
        if (!tv.length) continue;
        if (g.id) m.set(String(g.id), tv);
        m.set(`${g.homeTeamAbbrev}_${g.awayTeamAbbrev}`, tv);
    }
    return m;
}

/**
 * Current-season W-L-OTL from the NHL (Data Cache, 30 min). Null on any
 * failure or when the feed still returns last season (the /now endpoints lag
 * around opening night).
 */
async function nhlRecords(): Promise<Record<string, string> | null> {
    try {
        const res = await fetch('https://api-web.nhle.com/v1/standings/now', {
            next: { revalidate: 1800 },
            signal: AbortSignal.timeout(4000),
            headers: { 'User-Agent': 'pony-xg (home slate)' },
        });
        if (!res.ok) return null;
        const body = (await res.json()) as {
            standings?: { teamAbbrev?: { default?: string }; wins?: number; losses?: number; otLosses?: number; seasonId?: number }[];
        };
        const out: Record<string, string> = {};
        for (const t of body.standings ?? []) {
            const tri = t.teamAbbrev?.default;
            if (!tri || (t.seasonId && String(t.seasonId) !== SEASON_ID)) continue;
            out[tri] = `${t.wins ?? 0}-${t.losses ?? 0}-${t.otLosses ?? 0}`;
        }
        return Object.keys(out).length ? out : null;
    } catch {
        return null;
    }
}

/**
 * The slate: every row of predictions_detailed.csv (contract v2) as a
 * light, client-safe Prediction. Heavy per-game data (lineups, news, recent
 * games) is served separately by /api/matchup-details on first expand.
 */
export async function getPredictions(): Promise<Prediction[]> {
    const rows = readRows();
    const tv = tvNetworks();
    const preds: Prediction[] = [];
    const recentGp = new Map<string, { gp: number; rec: string | null }>();
    for (const row of rows) {
        const p = parseRow(row, tv.get(str(row.nhl_game_id) ?? '') ?? tv.get(`${row.home_abbrev}_${row.away_abbrev}`) ?? null);
        if (!p) continue;
        for (const s of ['home', 'away'] as const) {
            const rec = recordFromRecent(p[s].gp, parseRecent(row[`${s}_l7_games`]));
            const prev = recentGp.get(p[s].team.triCode);
            if (!prev || p[s].gp >= prev.gp) recentGp.set(p[s].team.triCode, { gp: p[s].gp, rec });
            p[s].record = rec;
        }
        preds.push(p);
    }
    const nhl = preds.length ? await nhlRecords() : null;
    if (nhl) for (const p of preds) for (const s of ['home', 'away'] as const) p[s].record = nhl[p[s].team.triCode] ?? p[s].record;
    return preds;
}

/** Playoff % per team from season_projections.json, only when it is this season's. */
export async function getPlayoffOdds(): Promise<Record<string, number>> {
    const d = readJson<{ season_id?: string; teams?: { team: string; make_playoffs_pct: number }[] }>('projections');
    if (!d || String(d.season_id) !== SEASON_ID) return {};
    return Object.fromEntries((d.teams ?? []).map(t => [t.team, t.make_playoffs_pct]));
}

export async function getImplications() {
    const d = readJson<import('./implications').GameImplicationsData & { season_id?: string }>('implications');
    if (!d || (d.season_id && String(d.season_id) !== SEASON_ID)) return null;
    return d;
}

/**
 * Active playoff series scores keyed "AWAY|HOME" for the playoff games on the
 * slate (empty outside the postseason, and the file is not read then).
 */
export async function getPlayoffSeries(preds: Prediction[]): Promise<Record<string, { away: number; home: number }>> {
    const po = preds.filter(p => p.gameType === '03');
    if (!po.length) return {};
    const series = readJson<{ status?: string; higherSeed?: { triCode?: string }; lowerSeed?: { triCode?: string }; seriesScore?: [number, number] }[]>('series') ?? [];
    const out: Record<string, { away: number; home: number }> = {};
    for (const s of series) {
        const hi = s.higherSeed?.triCode;
        const lo = s.lowerSeed?.triCode;
        if (!hi || !lo || !Array.isArray(s.seriesScore) || s.status === 'complete') continue;
        const [hw, lw] = s.seriesScore;
        out[`${lo}|${hi}`] = { away: lw, home: hw };
        out[`${hi}|${lo}`] = { away: hw, home: lw };
    }
    return Object.fromEntries(po.map(p => `${p.away.team.triCode}|${p.home.team.triCode}`).filter(k => out[k]).map(k => [k, out[k]]));
}
