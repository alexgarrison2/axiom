import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { getPredictions } from '@/utils/data';
import { buildGame, type RawFeeds } from './build';
import type { GameModel, GameOdds, Pregame, SeasonOdds, Side } from './types';

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

const num = (v: unknown): number | null => {
    const n = typeof v === 'string' ? Number(v.replace('+', '')) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) ? n : null;
};

/** Closing lines for the game from public/data/odds_closing.json (keyed by game id; per-side fields by team name). */
function closingOdds(id: number): GameOdds | null {
    try {
        const all = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'odds_closing.json'), 'utf8')) as Record<string, Record<string, unknown>>;
        const e = all[String(id)];
        if (!e) return null;
        const name: Record<Side, string> = { away: String(e.away_team ?? ''), home: String(e.home_team ?? '') };
        const per = (suffix: string) => ({ away: num(e[`${name.away}${suffix}`]), home: num(e[`${name.home}${suffix}`]) });
        const ml = { away: num(e.away_ml) ?? num(e[name.away]), home: num(e.home_ml) ?? num(e[name.home]) };
        const pl = (side: Side) => {
            const spread = num(e[`${name[side]}_puckline_spread`]);
            return spread == null ? null : { spread, price: num(e[`${name[side]}_puckline`]) };
        };
        const line = num(e.total_line);
        const tw = per('_three_way');
        const tw1 = per('_1p_three_way');
        return {
            source: e.source ? String(e.source) : null,
            ml,
            puckline: { away: pl('away'), home: pl('home') },
            total: line == null ? null : { line, over: num(e.total_over), under: num(e.total_under) },
            firstPeriod: per('_1p_ml'),
            threeWay: tw.away == null && tw.home == null ? null : { ...tw, tie: num(e.three_way_tie) },
            firstPeriodThreeWay: tw1.away == null && tw1.home == null ? null : { ...tw1, tie: num(e['1p_three_way_tie']) },
        };
    } catch {
        return null;
    }
}

interface ProjectionSnapshot {
    date: string;
    generated_at: string;
    teams: Record<string, { make_playoffs_pct?: number; won_cup_pct?: number }>;
}

/**
 * Playoff and Cup chances from the daily season simulation: "before" is the
 * last run before puck drop, "after" the first run once the next morning's full
 * refresh has scraped the result (12:00 UTC the day after the game).
 */
function seasonOutlook(m: { startUtc: string; date: string; teams: Record<Side, { tri: string }> }): SeasonOdds | null {
    try {
        const doc = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'season_projections_history.json'), 'utf8')) as { snapshots?: ProjectionSnapshot[] };
        const snaps = [...(doc.snapshots ?? [])].sort((a, b) => a.generated_at.localeCompare(b.generated_at));
        const start = m.startUtc;
        const next = new Date(Date.parse(`${m.date}T12:00:00Z`) + 86_400_000).toISOString();
        const before = [...snaps].reverse().find(s => s.generated_at < start) ?? null;
        const after = snaps.find(s => s.generated_at >= next) ?? null;
        if (!before && !after) return null;
        const pick = (s: ProjectionSnapshot | null, side: Side) => {
            const t = s?.teams[m.teams[side].tri];
            return t && t.make_playoffs_pct != null ? { playoffs: t.make_playoffs_pct / 100, cup: (t.won_cup_pct ?? 0) / 100 } : null;
        };
        return {
            before: { away: pick(before, 'away'), home: pick(before, 'home') },
            after: { away: pick(after, 'away'), home: pick(after, 'home') },
            beforeAt: before?.generated_at ?? null,
            afterAt: after?.generated_at ?? null,
        };
    } catch {
        return null;
    }
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
    const odds = closingOdds(id);
    const outlook = seasonOutlook({
        startUtc: pbp.startTimeUTC,
        date: pbp.gameDate,
        teams: { away: { tri: pbp.awayTeam?.abbrev }, home: { tri: pbp.homeTeam?.abbrev } },
    });
    return buildGame({ pbp, landing, box, shifts, rightRail }, gameXg(String(pbp.season), id), pregame, { odds, outlook });
}
