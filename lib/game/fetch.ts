import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { getPredictions } from '@/utils/data';
import { buildGame, type RawFeeds } from './build';
import type { GameModel, Pregame } from './types';

/**
 * Server side of the game page: the four NHL game feeds (Data Cache, 30s
 * while a game can still change, a day once it is final), pony xG per shot
 * from public/data/game_xg/<season>.json, and the pregame pony xG call from
 * the graded history (or tonight's slate).
 */

const UA = { 'User-Agent': 'pony-xg (game page)' };

async function getJson(url: string, revalidate: number): Promise<unknown | null> {
    try {
        const res = await fetch(url, { next: { revalidate }, signal: AbortSignal.timeout(6000), headers: UA });
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}

/** NHL regular season / playoff game ids: 2026020037. */
export const validGameId = (id: string) => /^\d{4}0[23]\d{4}$/.test(id);

// Literal per-season paths keep the function trace small; the route's tracing include adds the folder.
function readSeasonXg(season: string): Record<string, [number, number][]> | null {
    try {
        const file = path.join(process.cwd(), 'public', 'data', 'game_xg', `${season}.json`);
        return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, [number, number][]>;
    } catch {
        return null;
    }
}

const xgCache = new Map<string, { at: number; data: Record<string, [number, number][]> | null }>();

function gameXg(season: string, id: number): Map<number, number> | null {
    const hit = xgCache.get(season);
    const fresh = hit && Date.now() - hit.at < 10 * 60_000;
    const data = fresh ? hit.data : readSeasonXg(season);
    if (!fresh) xgCache.set(season, { at: Date.now(), data });
    const rows = data?.[String(id)];
    return rows ? new Map(rows) : null;
}

interface HistoryRow {
    gameId?: number | string;
    homeWinProb?: number | null;
    homeXg?: number | null;
    awayXg?: number | null;
    marketHomeProb?: number | null;
    homeOdds?: number | null;
    awayOdds?: number | null;
    isLean?: boolean | null;
    isCorrect?: boolean | null;
}

function historyRow(id: number): HistoryRow | null {
    try {
        const rows = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'prediction_history.json'), 'utf8')) as HistoryRow[];
        return rows.find(r => Number(r.gameId) === id) ?? null;
    } catch {
        return null;
    }
}

const prob = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : v > 1 ? v / 100 : v);

async function pregameFor(id: number): Promise<Pregame | null> {
    const h = historyRow(id);
    const hp = prob(h?.homeWinProb);
    if (h && hp != null) {
        return {
            homeWin: hp,
            homeXg: h.homeXg ?? null,
            awayXg: h.awayXg ?? null,
            marketHome: prob(h.marketHomeProb),
            homeOdds: h.homeOdds ?? null,
            awayOdds: h.awayOdds ?? null,
            lean: !!h.isLean,
            correct: h.isCorrect ?? null,
        };
    }
    const p = (await getPredictions()).find(x => Number(x.id) === id);
    const win = prob(p?.home.winPct);
    if (!p || win == null) return null;
    return {
        homeWin: win,
        homeXg: p.home.xg,
        awayXg: p.away.xg,
        marketHome: prob(p.home.marketWinPct),
        homeOdds: p.home.marketOdds,
        awayOdds: p.away.marketOdds,
        lean: Math.abs(win - 0.5) < 0.02,
        correct: null,
    };
}

/** The game, or null when the NHL has no such game. */
export async function getGame(idStr: string): Promise<GameModel | null> {
    if (!validGameId(idStr)) return null;
    const id = Number(idStr);
    // Final games never change: a day's cache. Everything else: 30s.
    const pbp = (await getJson(`https://api-web.nhle.com/v1/gamecenter/${id}/play-by-play`, 30)) as RawFeeds['pbp'] | null;
    if (!pbp || !pbp.id) return null;
    const final = pbp.gameState === 'OFF' || pbp.gameState === 'FINAL';
    const ttl = final ? 86_400 : 30;
    const [landing, box, shifts, rightRail, pregame] = await Promise.all([
        getJson(`https://api-web.nhle.com/v1/gamecenter/${id}/landing`, ttl),
        getJson(`https://api-web.nhle.com/v1/gamecenter/${id}/boxscore`, ttl),
        getJson(`https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=${id}`, ttl),
        getJson(`https://api-web.nhle.com/v1/gamecenter/${id}/right-rail`, ttl),
        pregameFor(id),
    ]);
    return buildGame({ pbp, landing, box, shifts, rightRail }, gameXg(String(pbp.season), id), pregame);
}
