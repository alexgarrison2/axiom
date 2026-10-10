import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { getPredictions } from '@/utils/data';
import { buildGame, type RawFeeds } from './build';
import { goalieShiftRows, playCoverage, reportCode, reportShiftRows, shiftCoverage } from './toi-report';
import { loadArtifacts, publishedXg, type XgArtifacts } from './xg';
import { parseRatings, type EvRatings } from './ratings';
import type { GameModel, GameOdds, Pregame, SeasonOdds, Side } from './types';

/**
 * Server side of the game page: the four NHL game feeds (Data Cache, 30s
 * while a game can still change, a day once it is final), pony xG per shot
 * (the nightly public/data/game_xg/<season>.json, else scored live from the
 * play-by-play), and the pregame pony xG call from the graded history (or
 * tonight's slate).
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

async function getText(url: string, revalidate: number): Promise<string | null> {
    try {
        // nhl.com serves the HTML reports to browsers; a script UA is turned away.
        const res = await fetch(url, { next: { revalidate }, signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0 (pony-xg game page)' } });
        return res.ok ? await res.text() : null;
    } catch {
        return null;
    }
}

/**
 * Shift rows when the shift-chart API has none yet (it fills in well after a game): the home and
 * visitor time-on-ice reports, which update as the game is played, matched to player ids by
 * sweater number, plus each team's goalie in net from the play-by-play.
 */
async function reportShifts(pbp: RawFeeds['pbp'], final: boolean, ttl: number): Promise<{ data: unknown[] } | null> {
    const code = reportCode(Number(pbp.id));
    const [home, away] = await Promise.all([
        getText(`https://www.nhl.com/scores/htmlreports/${pbp.season}/TH${code}.HTM`, ttl),
        getText(`https://www.nhl.com/scores/htmlreports/${pbp.season}/TV${code}.HTM`, ttl),
    ]);
    if (!home && !away) return null;
    const roster = (teamId: number) =>
        new Map<number, number>(
            ((pbp.rosterSpots ?? []) as { teamId: number; playerId: number; sweaterNumber: number }[]).filter(r => r.teamId === teamId).map(r => [r.sweaterNumber, r.playerId]),
        );
    const rows = [
        ...(home ? reportShiftRows(home, roster(pbp.homeTeam.id)) : []),
        ...(away ? reportShiftRows(away, roster(pbp.awayTeam.id)) : []),
        ...goalieShiftRows(pbp.plays ?? [], { away: pbp.awayTeam.id, home: pbp.homeTeam.id }, { otLength: Number(pbp.gameType) === 3 ? 1200 : 300, final }),
    ];
    return rows.length ? { data: rows } : null;
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

function nightlyXg(season: string, id: number): Map<number, number> | null {
    const hit = xgCache.get(season);
    const fresh = hit && Date.now() - hit.at < 10 * 60_000;
    const data = fresh ? hit.data : readSeasonXg(season);
    if (!fresh) xgCache.set(season, { at: Date.now(), data });
    const rows = data?.[String(id)];
    return rows ? new Map(rows) : null;
}

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** IMPACT EV ratings by player id (public/data/player_ratings.json), an hour's cache; empty if unreadable. */
let ratingsCache: { at: number; map: EvRatings } | null = null;
export function playerRatings(): EvRatings {
    if (ratingsCache && Date.now() - ratingsCache.at < 3_600_000) return ratingsCache.map;
    let map: EvRatings = new Map();
    try {
        map = parseRatings(readJson(path.join(process.cwd(), 'public', 'data', 'player_ratings.json')));
    } catch {
        /* no ratings: the usage term is zero */
    }
    ratingsCache = { at: Date.now(), map };
    return map;
}

// The committed xG v2 artifacts, parsed once per instance (null when unreadable: the page then waits for the nightly file).
let artifacts: XgArtifacts | null | undefined;
function xgArtifacts(): XgArtifacts | null {
    if (artifacts !== undefined) return artifacts;
    try {
        artifacts = loadArtifacts(
            readJson(path.join(process.cwd(), 'pipeline', 'models', 'xg2_booster.json')),
            readJson(path.join(process.cwd(), 'pipeline', 'models', 'xg2_calibrators.json')),
            readJson(path.join(process.cwd(), 'pipeline', 'bu', 'xg', 'models', 'handedness.json')),
        );
    } catch (e) {
        console.error('[game] xG v2 artifacts unavailable; live xG off', e);
        artifacts = null;
    }
    return artifacts;
}

/** The league normalisation the nightly run applied to this season's xG (manifest), else 1. */
function leagueFactor(season: string): number {
    try {
        const src = readJson(path.join(process.cwd(), 'public', 'data', 'manifest.json'))?.sources?.xg_model;
        const f = Number(src?.league_factor);
        return String(src?.league_factor_season) === season && Number.isFinite(f) && f > 0 ? f : 1;
    } catch {
        return 1;
    }
}

/** The shooting-talent multipliers the nightly run applied to this season's xG (pipeline/shooting_talent.json), else none. */
function shootingTalent(season: string): Map<number, number> {
    try {
        const m = readJson(path.join(process.cwd(), 'pipeline', 'shooting_talent.json'))?.by_season?.[season.slice(0, 4)] ?? {};
        return new Map(Object.entries(m).map(([pid, v]) => [Number(pid), Number(v)]));
    } catch {
        return new Map();
    }
}

/**
 * Per-shot xG keyed by NHL event id. The nightly run's values once it has
 * scored the game; until then (a game in progress, or final but not yet
 * scraped) the same model scored here from the play-by-play, with the
 * pipeline's shooting talent and league normalisation.
 */
function gameXg(pbp: RawFeeds['pbp']): Map<number, number> | null {
    const season = String(pbp.season);
    const nightly = nightlyXg(season, Number(pbp.id));
    if (nightly) return nightly;
    const art = xgArtifacts();
    if (!art) return null;
    try {
        const live = publishedXg(pbp, art, shootingTalent(season), leagueFactor(season));
        return live.size ? live : null;
    } catch (e) {
        console.error(`[game] live xG failed for ${pbp.id}`, e);
        return null;
    }
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
    const [landing, box, chart, rightRail, pregame] = await Promise.all([
        getJson(`https://api-web.nhle.com/v1/gamecenter/${id}/landing`, ttl),
        getJson(`https://api-web.nhle.com/v1/gamecenter/${id}/boxscore`, ttl),
        getJson(`https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=${id}`, ttl),
        getJson(`https://api-web.nhle.com/v1/gamecenter/${id}/right-rail`, ttl),
        pregameFor(id),
    ]);
    // The shift chart fills in late and in pieces (empty during a game, then partway). When it falls
    // behind the play-by-play, read the time-on-ice reports too and keep whichever reaches further.
    const started = pbp.gameState !== 'FUT' && pbp.gameState !== 'PRE';
    const ot = Number(pbp.gameType) === 3 ? 1200 : 300;
    type Rows = { data?: { typeCode?: number; period?: number; endTime?: string }[] } | null;
    const chartEnd = shiftCoverage((chart as Rows)?.data, ot);
    let shifts = chart;
    if (started && chartEnd < playCoverage(pbp.plays ?? [], ot) - 90) {
        const report = (await reportShifts(pbp, final, final ? 600 : 30)) as Rows;
        if (report && shiftCoverage(report.data, ot) > chartEnd) shifts = report;
    }
    const odds = closingOdds(id);
    const outlook = seasonOutlook({
        startUtc: pbp.startTimeUTC,
        date: pbp.gameDate,
        teams: { away: { tri: pbp.awayTeam?.abbrev }, home: { tri: pbp.homeTeam?.abbrev } },
    });
    return buildGame({ pbp, landing, box, shifts, rightRail }, gameXg(pbp), pregame, { odds, outlook, ratings: playerRatings() });
}
