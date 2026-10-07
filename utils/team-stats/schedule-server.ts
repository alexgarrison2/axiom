/**
 * Server-only builder for the team Schedule tab (read at build time by the
 * static /api/teams/[tri]/schedule/[season] route). Joins the pipeline's
 * season schedule with venues (pipeline/data/schedule_detail_<season>.json),
 * the scraped results, the model's win % (today's predictions, else the
 * season simulator's per-game table) and opponent strength, then runs the
 * pure metrics in lib/schedule/metrics.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SEASON_ID } from '../../lib/season';
import { buildLeagueSchedules, compareToLeague, type RawGame, type TeamResult, type TeamSchedule, type WinPct } from '../../lib/schedule/metrics';
import type { SchedulePayload } from '../../lib/schedule/payload';
import Papa from 'papaparse';
import { leagueStandings, loadSeasonGames, readPublicJson, teamToTri } from './server';
import { TEAM_TRICODES } from './teams';

const ROOT = process.cwd();

function readJson<T>(file: string): T | null {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
        return null;
    }
}

export function loadScheduleDetail(season: string): RawGame[] {
    const doc = readJson<{ games?: RawGame[] }>(path.join(ROOT, 'pipeline', 'data', `schedule_detail_${season}.json`));
    return Array.isArray(doc?.games) ? doc.games : [];
}

const zscores = (vals: Record<string, number>): Record<string, number> => {
    const xs = Object.values(vals);
    if (xs.length < 2) return {};
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1;
    return Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, (v - m) / sd]));
};

/**
 * Opponent strength (z-score). This season: the pipeline's team ratings
 * (xGF / xGA, regressed to the prior early on). A finished season: the mean
 * z of xG share and points %.
 */
export function strengthFor(season: string): { z: Record<string, number>; source: 'ratings' | 'season' } {
    if (season === SEASON_ID) {
        const ratings = readPublicJson<Record<string, { xgf_rating?: number; xga_rating?: number }>>('team_ratings.json') ?? {};
        const share: Record<string, number> = {};
        for (const [name, r] of Object.entries(ratings)) {
            const tri = teamToTri(name);
            if (tri && r.xgf_rating && r.xga_rating) share[tri] = r.xgf_rating / (r.xgf_rating + r.xga_rating);
        }
        if (Object.keys(share).length >= 30) return { z: zscores(share), source: 'ratings' };
    }
    const rows = leagueStandings(season).rows.filter(r => r.gp > 0);
    const xg = zscores(Object.fromEntries(rows.map(r => [r.tri, r.xgf_pct])));
    const pts = zscores(Object.fromEntries(rows.map(r => [r.tri, r.pt_pct])));
    return { z: Object.fromEntries(rows.map(r => [r.tri, ((xg[r.tri] ?? 0) + (pts[r.tri] ?? 0)) / 2])), source: 'season' };
}

function resultsFor(season: string): Map<string, TeamResult> {
    const out = new Map<string, TeamResult>();
    for (const g of loadSeasonGames(season)) {
        if (g.type !== 2) continue;
        const so = g.result === 'SOW' || g.result === 'SOL';
        const ot = g.result === 'OTW' || g.result === 'OTL' ? 'OT' : so ? 'SO' : null;
        const win = g.result === 'RW' || g.result === 'OTW' || g.result === 'SOW';
        // The game log leaves out the shootout-deciding goal; the final score counts it.
        const gf = g.gf + (g.result === 'SOW' ? 1 : 0);
        const ga = g.ga + (g.result === 'SOL' ? 1 : 0);
        out.set(`${g.id}|${g.tri}`, { gf, ga, code: win ? 'W' : ot ? 'OTL' : 'L', ot });
    }
    return out;
}

const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : null;
};
const clampPct = (x: number) => Math.min(100, Math.max(0, x));

/** The day's published predictions with the regulation / OT split (predictions_detailed.csv). */
function predictionRows(): { date: string; home: string; away: string; homeWin: number; awayWin: number; homeOtShare: number | null; tie: number | null }[] {
    let text = '';
    try {
        text = fs.readFileSync(path.join(ROOT, 'public', 'data', 'predictions_detailed.csv'), 'utf8');
    } catch {
        return [];
    }
    const rows = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true }).data;
    const out = [];
    for (const r of rows) {
        const homeWin = num(r.home_win_pct);
        const awayWin = num(r.away_win_pct);
        const home = teamToTri((r.home_team ?? '').trim()) ?? r.home_abbrev;
        const away = teamToTri((r.away_team ?? '').trim()) ?? r.away_abbrev;
        if (homeWin == null || awayWin == null || !home || !away) continue;
        const tie = num(r.reg_tie_pct);
        const reg = num(r.home_reg_pct);
        const model = num(r.home_model_win_pct);
        // The model's share of overtimes the home side wins.
        const homeOtShare = tie && reg != null && model != null ? Math.min(1, Math.max(0, (model - reg) / tie)) : null;
        out.push({ date: (r.game_date ?? '').slice(0, 10), home, away, homeWin, awayWin, homeOtShare, tie });
    }
    return out;
}

function winPctFor(season: string, raw: RawGame[]): Map<string, WinPct> {
    const out = new Map<string, WinPct>();
    if (season !== SEASON_ID) return out;
    // {"<id>|<home rest>|<away rest>": [reg_home, reg_tie, reg_away, p_home]}
    const sim = readJson<{ games?: Record<string, number[]> }>(path.join(ROOT, 'pipeline', 'data', 'season_sim_games.json'));
    const byId = new Map(raw.map(g => [g.id, g]));
    for (const [key, v] of Object.entries(sim?.games ?? {})) {
        const id = Number(key.split('|')[0]);
        const g = byId.get(id);
        const [regHome, tie, regAway, p] = v ?? [];
        if (!g || typeof p !== 'number') continue;
        const ok = typeof regHome === 'number' && typeof tie === 'number' && typeof regAway === 'number';
        // A side's OT loss is the other side's OT win: P(win) minus its regulation win.
        out.set(`${id}|${g.home}`, { pct: 100 * p, otl: ok ? clampPct(100 * (1 - p - regAway)) : undefined, src: 'sim' });
        out.set(`${id}|${g.away}`, { pct: 100 * (1 - p), otl: ok ? clampPct(100 * (p - regHome)) : undefined, src: 'sim' });
    }
    // Today's published predictions win over the simulator's table.
    for (const p of predictionRows()) {
        const g = raw.find(x => x.type === 2 && x.date === p.date && x.home === p.home && x.away === p.away);
        if (!g) continue;
        const split = p.tie != null && p.homeOtShare != null;
        out.set(`${g.id}|${g.home}`, { pct: p.homeWin, otl: split ? clampPct(p.tie! * (1 - p.homeOtShare!)) : undefined, src: 'pred' });
        out.set(`${g.id}|${g.away}`, { pct: p.awayWin, otl: split ? clampPct(p.tie! * p.homeOtShare!) : undefined, src: 'pred' });
    }
    return out;
}

/** 10th / 90th percentile of the season simulator's final points for a team (current season only). */
function simPointsRange(tri: string, season: string): [number, number] | null {
    if (season !== SEASON_ID) return null;
    const doc = readPublicJson<{ season_id?: string; teams?: { team: string; point_dist?: Record<string, number> }[] }>('season_projections.json');
    if (!doc || String(doc.season_id) !== season) return null;
    const dist = doc.teams?.find(t => t.team === tri)?.point_dist;
    if (!dist) return null;
    const pts = Object.entries(dist)
        .map(([k, n]) => [Number(k), n] as const)
        .filter(([k, n]) => Number.isFinite(k) && n > 0)
        .sort((a, b) => a[0] - b[0]);
    const total = pts.reduce((s, [, n]) => s + n, 0);
    if (!total) return null;
    const q = (p: number) => {
        let c = 0;
        for (const [k, n] of pts) {
            c += n;
            if (c >= p * total) return k;
        }
        return pts[pts.length - 1][0];
    };
    return [q(0.1), q(0.9)];
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Trim floats so the JSON stays small. */
function compact(s: TeamSchedule): TeamSchedule {
    const ll = (p: { lat: number; lon: number }) => ({ lat: Math.round(p.lat * 1e4) / 1e4, lon: Math.round(p.lon * 1e4) / 1e4 });
    return {
        ...s,
        games: s.games.map(g => ({ ...g, mi: Math.round(g.mi), diff: r1(g.diff), ribbon: r1(g.ribbon), bodyHour: Math.round(g.bodyHour * 100) / 100, winPct: g.winPct ? { ...g.winPct, pct: r1(g.winPct.pct), otl: g.winPct.otl != null ? r1(g.winPct.otl) : undefined } : null })),
        legs: s.legs.map(l => ({ ...l, mi: Math.round(l.mi), from: { ...l.from, ...ll(l.from) }, to: { ...l.to, ...ll(l.to) } })),
        trips: s.trips.map(t => ({ ...t, mi: Math.round(t.mi) })),
        summary: {
            ...s.summary,
            mi: Math.round(s.summary.mi),
            sos: r1(s.summary.sos),
            longestTrip: s.summary.longestTrip ? { ...s.summary.longestTrip, mi: Math.round(s.summary.longestTrip.mi) } : null,
            peakWeek: s.summary.peakWeek ? { ...s.summary.peakWeek, mi: Math.round(s.summary.peakWeek.mi) } : null,
            toughest: s.summary.toughest ? { ...s.summary.toughest, diff: r1(s.summary.toughest.diff) } : null,
            softest: s.summary.softest ? { ...s.summary.softest, diff: r1(s.summary.softest.diff) } : null,
        },
    };
}

const leagueCache = new Map<string, { all: ReturnType<typeof buildLeagueSchedules>; source: 'ratings' | 'season' }>();

export function buildSchedulePayload(tri: string, season: string, now = new Date()): SchedulePayload | null {
    let hit = leagueCache.get(season);
    if (!hit) {
        const raw = loadScheduleDetail(season);
        if (!raw.length) return null;
        const { z, source } = strengthFor(season);
        hit = { all: buildLeagueSchedules(raw, { strength: z, results: resultsFor(season), winPct: winPctFor(season, raw) }), source };
        leagueCache.set(season, hit);
    }
    const own = hit.all.get(tri);
    if (!own || !TEAM_TRICODES.includes(tri)) return null;
    const league = compareToLeague(hit.all, tri);
    for (const k of Object.keys(league) as (keyof typeof league)[]) league[k] = { ...league[k], value: r1(league[k].value), avg: r1(league[k].avg) };
    return {
        season,
        tri,
        today: now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
        complete: own.games.every(g => g.state === 'final'),
        strength: hit.source,
        schedule: compact(own),
        league,
        seasonRange: simPointsRange(tri, season),
    };
}
