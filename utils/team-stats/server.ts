/**
 * Server-only loaders for /teams and /teams/[abbr] (reads files with fs).
 *
 * Pages and API routes that use this are statically generated at build time
 * (every pipeline run redeploys), so the CSV parsing here never runs per
 * request. Never import this module from a client component.
 */
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { SEASON_ID } from '../../lib/season';
import { nameIndex, parseRatings } from '../../lib/players/ratings';
import { readRatingsDoc } from '../../lib/players/server';
import { calculateTeamStats, emptyTeamStat } from './calculate';
import { goalieKey, groupByTeam } from './filter';
import { finalizeRows, parseGameRow } from './game-row';
import { seasonGames, seasonLabel, prevSeasonId } from './season';
import { computeStandings, withStandings } from './standings';
import { ALL_TEAMS, TEAM_TRICODES } from './teams';
import type { GameRow, LeaguePayload, Matchup, TeamRatingEntry, TeamStat } from './types';

const ROOT = process.cwd();
const PUBLIC_DATA = path.join(ROOT, 'public', 'data');

/** Legacy / renamed clubs that still appear in older gamestats rows. */
const NAME_ALIASES: Record<string, string> = { 'Utah Hockey Club': 'UTA', Mammoth: 'UTA' };

// ── file helpers ─────────────────────────────────────────────────────────────

export function readPublicJson<T = unknown>(name: string): T | null {
    try {
        return JSON.parse(fs.readFileSync(path.join(PUBLIC_DATA, name), 'utf8')) as T;
    } catch {
        return null;
    }
}

function readCsv(file: string): Record<string, string>[] {
    try {
        const text = fs.readFileSync(file, 'utf8');
        return Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() }).data;
    } catch {
        return [];
    }
}

let nameMap: Map<string, string> | null = null;
export function teamToTri(name: string): string | undefined {
    if (!nameMap) {
        nameMap = new Map(Object.entries(NAME_ALIASES));
        for (const row of readCsv(path.join(PUBLIC_DATA, 'nhl_teams.csv'))) {
            const common = (row['Common Name'] ?? '').trim();
            const tri = (row['Team Tricode'] ?? '').trim();
            if (common && tri) nameMap.set(common, tri);
            const full = (row['Team Name'] ?? '').trim();
            if (full && tri) nameMap.set(full, tri);
        }
        for (const t of ALL_TEAMS) {
            if (!nameMap.has(t.common)) nameMap.set(t.common, t.tri);
            if (!nameMap.has(t.name)) nameMap.set(t.name, t.tri);
        }
    }
    const tri = nameMap.get(name);
    return tri && TEAM_TRICODES.includes(tri) ? tri : undefined;
}

// ── games ────────────────────────────────────────────────────────────────────

const gamesCache = new Map<string, GameRow[]>();

/**
 * Every regular-season and playoff team-game row of a season, newest first.
 * The current season lives in public/data/gamestats.csv; finished seasons
 * are archived in pipeline/nhl_historical_gamestats.csv. Rows are matched by
 * the season encoded in the game id, so a stale copy of last season's file
 * in gamestats.csv never leaks into this season's standings.
 */
export function loadSeasonGames(season: string): GameRow[] {
    const hit = gamesCache.get(season);
    if (hit) return hit;
    const prefix = season.slice(0, 4);
    const fromFile = (file: string) =>
        readCsv(file)
            .filter(r => String(r.game_id ?? '').startsWith(prefix))
            .map(r => parseGameRow(r, teamToTri))
            .filter((r): r is GameRow => r !== null);

    let rows = fromFile(path.join(PUBLIC_DATA, 'gamestats.csv'));
    if (rows.length === 0) {
        const seasonFile = path.join(ROOT, 'pipeline', `nhl_season_${prefix}_${Number(prefix) + 1}_gamestats.csv`);
        if (fs.existsSync(seasonFile)) rows = fromFile(seasonFile);
    }
    if (rows.length === 0 && season !== SEASON_ID) rows = fromFile(path.join(ROOT, 'pipeline', 'nhl_historical_gamestats.csv'));
    // de-duplicate (team, game)
    const seen = new Set<string>();
    rows = rows.filter(r => {
        const k = `${r.id}|${r.tri}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    const out = finalizeRows(rows);
    gamesCache.set(season, out);
    return out;
}

/** Regular-season table rows for all 32 teams, with standings info attached. */
export function leagueStandings(season: string): { rows: TeamStat[]; games: GameRow[] } {
    const games = loadSeasonGames(season);
    const regular = games.filter(g => g.type === 2);
    const byTeam = groupByTeam(regular);
    const rows = TEAM_TRICODES.map(tri => calculateTeamStats(tri, byTeam.get(tri) ?? []));
    const { info } = computeStandings(rows, regular, seasonGames(season));
    return { rows: withStandings(rows, info), games };
}

// ── season-scoped side files ─────────────────────────────────────────────────

/**
 * Clinch indicators, only when the file says it belongs to `season`.
 * Accepts {season_id, teams:{TRI: 'x'}} or {season_id, TRI: 'x', ...}. A
 * file without a season id is last season's leftovers and is ignored.
 */
export function loadClinch(season: string): Record<string, string> | null {
    const raw = readPublicJson<Record<string, unknown>>('clinch_status.json');
    if (!raw) return null;
    const sid = String(raw.season_id ?? raw.seasonId ?? raw.season ?? '');
    if (sid !== season) return null;
    const src = (raw.teams && typeof raw.teams === 'object' ? raw.teams : raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(src)) if (TEAM_TRICODES.includes(k) && typeof v === 'string' && v) out[k] = v.toLowerCase();
    return out;
}

export interface Projection {
    make_playoffs_pct: number;
    won_division_pct?: number;
    won_cup_pct?: number;
    avg_points?: number;
    simulations?: number;
}

/** Season simulation output for the current season, or null if stale. */
export function loadProjections(): Record<string, Projection> | null {
    const raw = readPublicJson<{ season_id?: string; seasonId?: string; total_simulations?: number; teams?: ({ team: string } & Projection)[] }>(
        'season_projections.json',
    );
    if (!raw || String(raw.season_id ?? raw.seasonId ?? '') !== SEASON_ID || !Array.isArray(raw.teams)) return null;
    const out: Record<string, Projection> = {};
    for (const t of raw.teams) out[t.team] = { ...t, simulations: raw.total_simulations };
    return out;
}

interface Manifest {
    season_id?: string;
    games_played_current_season?: number;
    phase?: { games_played?: number };
}

const PLAYER_MODEL_MIN_GAMES = 240; // mirrors pipeline/season.py

/**
 * Which season the player/goalie ratings describe. The pipeline keeps last
 * season's player models until PLAYER_MODEL_MIN_GAMES games are in.
 */
export function ratingsSeason(): string {
    const m = readPublicJson<Manifest>('manifest.json');
    const fromManifest = m?.games_played_current_season ?? m?.phase?.games_played;
    const n =
        typeof fromManifest === 'number' && String(m?.season_id ?? SEASON_ID) === SEASON_ID
            ? fromManifest
            : new Set(loadSeasonGames(SEASON_ID).filter(g => g.type === 2).map(g => g.id)).size;
    return n >= PLAYER_MODEL_MIN_GAMES ? SEASON_ID : prevSeasonId(SEASON_ID);
}

// ── predictions (today / tomorrow matchups) ──────────────────────────────────

const cleanName = (s: string | undefined) => (s ?? '').replace(/\s*\(.*?\)\s*/g, '').trim();
const statusOf = (s: string | undefined) => (s ?? '').match(/\((.*?)\)\s*$/)?.[1] ?? 'Unconfirmed';
const numOrUndef = (s: string | undefined) => {
    const n = parseFloat(s ?? '');
    return Number.isFinite(n) ? n : undefined;
};

export function loadMatchups(): Matchup[] {
    const rows = readCsv(path.join(PUBLIC_DATA, 'predictions_detailed.csv'));
    const out: Matchup[] = [];
    for (const r of rows) {
        const home = teamToTri((r.home_team ?? '').trim());
        const away = teamToTri((r.away_team ?? '').trim());
        if (!home || !away || !r.game_date) continue;
        out.push({
            date: r.game_date.slice(0, 10),
            home,
            away,
            homeStarter: cleanName(r.home_starter) || undefined,
            homeStarterStatus: statusOf(r.home_starter),
            awayStarter: cleanName(r.away_starter) || undefined,
            awayStarterStatus: statusOf(r.away_starter),
            homeVegasOdds: numOrUndef(r.home_vegas_odds),
            awayVegasOdds: numOrUndef(r.away_vegas_odds),
            // Fair line of the published (blended) %, like the matchup card's
            // "Fair"; home/away_model_odds is the model-only line since fix1-G1.
            homeModelOdds: r.home_blend_odds?.trim() || r.home_model_odds?.trim() || undefined,
            awayModelOdds: r.away_blend_odds?.trim() || r.away_model_odds?.trim() || undefined,
            homeEV: numOrUndef(r.home_ev),
            awayEV: numOrUndef(r.away_ev),
            homeXg: numOrUndef(r.home_xg),
            awayXg: numOrUndef(r.away_xg),
            recommendation: r.wager_recommendation?.trim().replace(/^'|'$/g, '') || undefined,
        });
    }
    return out;
}

export interface PredictionRow {
    date: string;
    home: string;
    away: string;
    homeWinPct?: number;
    awayWinPct?: number;
    homeXg?: number;
    awayXg?: number;
}

export function loadPredictionRows(): PredictionRow[] {
    return readCsv(path.join(PUBLIC_DATA, 'predictions_detailed.csv'))
        .map(r => ({
            date: (r.game_date ?? '').slice(0, 10),
            home: teamToTri((r.home_team ?? '').trim()) ?? '',
            away: teamToTri((r.away_team ?? '').trim()) ?? '',
            homeWinPct: numOrUndef(r.home_win_pct),
            awayWinPct: numOrUndef(r.away_win_pct),
            homeXg: numOrUndef(r.home_xg),
            awayXg: numOrUndef(r.away_xg),
        }))
        .filter(r => r.home && r.away && r.date);
}

// ── ratings view (current ratings, server-computed) ──────────────────────────

interface LineupPlayer {
    id?: number | string;
    name?: string;
}

export function loadRatingsView(): Record<string, TeamRatingEntry> | null {
    const ratings = readPublicJson<Record<string, Record<string, number>>>('team_ratings.json');
    if (!ratings) return null;
    const lineups = readPublicJson<Record<string, Record<string, LineupPlayer[]>>>('team_lineups.json') ?? {};
    const players = parseRatings(readRatingsDoc());
    const goalies = readPublicJson<Record<string, { gsax_per_game?: number }>>('goalie_ratings.json') ?? {};
    const teamGoalies = readPublicJson<Record<string, string[]>>('team_goalies.json') ?? {};

    // DailyFaceoff ids are not NHL ids: resolve by name within the team.
    const find = nameIndex(players);
    const lookup = (p: LineupPlayer, team: string) => (p.name ? find(p.name, team) : null);
    // Lines: sum of the skaters' RAPM NET (EV xG/60 above average).
    const sumNet = (list: LineupPlayer[] | undefined, team: string) => (list ?? []).reduce((s, p) => s + (lookup(p, team)?.net ?? 0), 0);
    // Forwards / defence: EV-TOI-weighted NET, scaled by the group size.
    const toiNet = (list: LineupPlayer[], team: string) => {
        const e = list.map(p => {
            const r = lookup(p, team);
            return { net: r?.net ?? 0, toi: r && r.gp > 0 ? r.toi / r.gp : 0 };
        });
        const tot = e.reduce((s, x) => s + x.toi, 0);
        return tot > 0 ? e.reduce((s, x) => s + x.net * (x.toi / tot), 0) * e.length : 0;
    };
    const goalieByKey = new Map(Object.entries(goalies).map(([k, v]) => [goalieKey(k), v]));

    const out: Record<string, TeamRatingEntry> = {};
    for (const t of ALL_TEAMS) {
        const r = ratings[t.common] ?? null;
        const lu = lineups[t.tri] ?? {};
        const f = ['f1', 'f2', 'f3', 'f4'].flatMap(k => lu[k] ?? []);
        const d = ['d1', 'd2', 'd3'].flatMap(k => lu[k] ?? []);
        const g = (teamGoalies[t.tri] ?? []).slice(0, 2);
        const val = (k: string) => (r && typeof r[k] === 'number' ? Math.round(r[k] * 1000) / 1000 : null);
        out[t.tri] = {
            xgf_rating: val('xgf_rating'),
            xga_rating: val('xga_rating'),
            xgf_rolling: val('xgf_rolling'),
            xga_rolling: val('xga_rolling'),
            xgf_5v5: val('xgf_5v5_rating'),
            xga_5v5: val('xga_5v5_rating'),
            lines: {
                f1: sumNet(lu.f1, t.tri), f2: sumNet(lu.f2, t.tri), f3: sumNet(lu.f3, t.tri), f4: sumNet(lu.f4, t.tri),
                d1: sumNet(lu.d1, t.tri), d2: sumNet(lu.d2, t.tri), d3: sumNet(lu.d3, t.tri),
            },
            rapm: { f: toiNet(f, t.tri), d: toiNet(d, t.tri) },
            goalie: g.reduce((s, name) => s + (goalieByKey.get(goalieKey(name))?.gsax_per_game ?? 0), 0),
        };
    }
    return out;
}

// ── /teams payload ───────────────────────────────────────────────────────────

const round3 = (v: number) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);
function roundStat(s: TeamStat): TeamStat {
    const o = { ...s } as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) if (typeof v === 'number') o[k] = round3(v);
    return o as unknown as TeamStat;
}

interface UpcomingGame {
    gameDate?: string;
    gameType?: number;
}

export function buildLeaguePayload(season: string): LeaguePayload {
    const isCurrent = season === SEASON_ID;
    const { rows, games } = leagueStandings(season);
    const clinch = loadClinch(season);
    const gps = rows.map(r => r.gp);
    const maxGp = Math.max(0, ...gps);
    let seasonStartsOn: string | null = null;
    if (isCurrent && maxGp === 0) {
        const up = readPublicJson<UpcomingGame[]>('upcoming_games.json') ?? [];
        const dates = up.filter(g => (g.gameType ?? 2) === 2 && g.gameDate).map(g => g.gameDate!).sort();
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
        seasonStartsOn = dates[0] && dates[0] > today ? dates[0] : null;
    }
    const rs = isCurrent ? ratingsSeason() : null;
    return {
        season,
        seasonLabel: seasonLabel(season),
        isCurrent,
        teams: ALL_TEAMS,
        standings: rows.map(r => roundStat({ ...r, clinch: clinch?.[r.tri] ?? null })),
        maxGp,
        minGp: Math.min(...gps),
        hasPlayoffGames: games.some(g => g.type === 3),
        clinch,
        ratings: isCurrent ? loadRatingsView() : null,
        ratingsSeasonLabel: rs ? seasonLabel(rs) : null,
        matchups: isCurrent ? loadMatchups() : [],
        seasonStartsOn,
        generatedAt: new Date().toISOString(),
    };
}

export { emptyTeamStat };
