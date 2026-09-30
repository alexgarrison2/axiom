/**
 * Server-only builder for one team's page / API payload. See server.ts.
 */
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import Papa from 'papaparse';
import { SEASON_ID } from '../../lib/season';
import { leaguesSummary } from './league-summary';
import { leagueAverages } from './chart-metrics';
import { goalieKey } from './filter';
import { gsaxOf, packGames } from './game-row';
import { gameTypeOf, prevSeasonId, seasonLabel } from './season';
import { leagueStandings, loadPredictionRows, loadProjections, ratingsSeason, readPublicJson } from './server';
import { teamMeta } from './teams';
import type { GameRow } from './types';
import type {
    Boxscores, GoalieLine, GoalieSeason, NextGame, Pctl, SeasonLine, SkaterCardData, SkaterImpact, TeamHero, TeamPayload,
} from './team-types';

// ── roster ───────────────────────────────────────────────────────────────────

export interface RosterPlayer {
    id: string;
    name: string;
    pos: 'C' | 'L' | 'R' | 'D' | 'G';
    number: number | null;
}

/**
 * Plain HTTPS GET (not Next's patched fetch), so reading the roster at build
 * time does not turn the static team pages into ISR pages that would
 * re-render at runtime without the pipeline archive files.
 */
function getJson(url: string, timeoutMs: number): Promise<unknown | null> {
    return new Promise(resolve => {
        const req = https.get(url, { headers: { 'User-Agent': 'ponyxg-build/1.0', Accept: 'application/json' } }, res => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                resolve(getJson(new URL(res.headers.location, url).toString(), timeoutMs));
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                resolve(null);
                return;
            }
            const chunks: Buffer[] = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                } catch {
                    resolve(null);
                }
            });
        });
        req.setTimeout(timeoutMs, () => req.destroy());
        req.on('error', () => resolve(null));
    });
}

interface NhlRosterPlayer {
    id: number;
    firstName?: { default?: string };
    lastName?: { default?: string };
    sweaterNumber?: number;
    positionCode?: string;
}

const rosterCache = new Map<string, Promise<{ players: RosterPlayer[]; source: 'nhl' | 'fallback' }>>();

/**
 * Current roster from the NHL (api-web /v1/roster/{TRI}/{SEASON_ID}; the
 * explicit season avoids the stale `current` alias around opening night).
 * Fetched at build time; falls back to the pipeline's roster-mapped player
 * files if the API is unreachable.
 */
export function loadRoster(tri: string): Promise<{ players: RosterPlayer[]; source: 'nhl' | 'fallback' }> {
    const hit = rosterCache.get(tri);
    if (hit) return hit;
    const p = (async () => {
        try {
            const data = (await getJson(`https://api-web.nhle.com/v1/roster/${tri}/${SEASON_ID}`, 8000)) as Record<string, NhlRosterPlayer[]> | null;
            if (data) {
                const players: RosterPlayer[] = [];
                for (const group of ['forwards', 'defensemen', 'goalies']) {
                    for (const p of data[group] ?? []) {
                        const pos = (p.positionCode ?? '').toUpperCase();
                        players.push({
                            id: String(p.id),
                            name: `${p.firstName?.default ?? ''} ${p.lastName?.default ?? ''}`.trim(),
                            pos: (['C', 'L', 'R', 'D', 'G'].includes(pos) ? pos : group === 'goalies' ? 'G' : group === 'defensemen' ? 'D' : 'C') as RosterPlayer['pos'],
                            number: typeof p.sweaterNumber === 'number' ? p.sweaterNumber : null,
                        });
                    }
                }
                if (players.length >= 15) return { players, source: 'nhl' as const };
            }
        } catch {
            /* fall through */
        }
        return { players: fallbackRoster(tri), source: 'fallback' as const };
    })();
    rosterCache.set(tri, p);
    return p;
}

interface ImpactEntry {
    name?: string;
    team?: string;
    team_prev?: string;
    on_roster?: boolean;
    position?: string;
    is_forward?: boolean;
    games_played?: number;
    [k: string]: unknown;
}

function fallbackRoster(tri: string): RosterPlayer[] {
    const impact = readPublicJson<Record<string, ImpactEntry>>('player_impact.json') ?? {};
    const lost = new Set(rosterChanges(tri)?.lost.map(p => String(p.id)) ?? []);
    const out: RosterPlayer[] = [];
    for (const [id, p] of Object.entries(impact)) {
        if (p.team !== tri || p.on_roster === false || lost.has(id)) continue;
        const pos = String(p.position ?? '').toUpperCase();
        out.push({ id, name: p.name ?? id, pos: (pos === 'G' ? 'G' : pos === 'D' ? 'D' : pos === 'L' ? 'L' : pos === 'R' ? 'R' : 'C'), number: null });
    }
    const goalies = readPublicJson<Record<string, string[]>>('team_goalies.json')?.[tri] ?? [];
    goalies.forEach((name, i) => out.push({ id: `g-${i}-${name}`, name, pos: 'G', number: null }));
    return out;
}

interface RosterChange {
    id: number;
    name: string;
    pos?: string;
    from?: string | null;
    to?: string | null;
}

function rosterChanges(tri: string): { added: RosterChange[]; lost: RosterChange[] } | null {
    const ratings = readPublicJson<Record<string, { roster_changes?: { season?: string; added?: RosterChange[]; lost?: RosterChange[] } }>>('team_ratings.json');
    const rc = ratings?.[teamMeta(tri).common]?.roster_changes;
    if (!rc || (rc.season && rc.season !== seasonLabel(SEASON_ID))) return null;
    return { added: rc.added ?? [], lost: rc.lost ?? [] };
}

// ── player boxscores ─────────────────────────────────────────────────────────

interface PlayerRow {
    game_id: string;
    date: string;
    team: string;
    player_id: string;
    name: string;
    number: string;
    position: string;
    goals: string;
    assists: string;
    points: string;
    plus_minus: string;
    toi: string;
    shots: string;
    hits: string;
    blocked_shots: string;
    pim: string;
    is_goalie: string;
    shots_against: string;
    saves: string;
    goals_against: string;
    decision: string;
}

const playerCache = new Map<string, PlayerRow[]>();

/** Regular-season + playoff player boxscore rows for a season ([] if the file does not exist yet). */
export function loadPlayerStats(season: string): PlayerRow[] {
    const hit = playerCache.get(season);
    if (hit) return hit;
    const y = season.slice(0, 4);
    const name = `nhl_season_${y}_${Number(y) + 1}_player_stats.csv`;
    const inPublic = path.join(process.cwd(), 'public', 'data', name);
    const inPipeline = path.join(process.cwd(), 'pipeline', name);
    const text = fs.existsSync(inPublic) ? fs.readFileSync(inPublic, 'utf8') : fs.existsSync(inPipeline) ? fs.readFileSync(inPipeline, 'utf8') : '';
    const rows = text
        ? Papa.parse<PlayerRow>(text, { header: true, skipEmptyLines: true }).data.filter(r => {
              const t = gameTypeOf(r.game_id);
              return (t === 2 || t === 3) && String(r.game_id).startsWith(y);
          })
        : [];
    playerCache.set(season, rows);
    return rows;
}

const n = (v: string | undefined) => {
    const x = parseFloat(v ?? '');
    return Number.isFinite(x) ? x : 0;
};
const toiSec = (s: string | undefined) => {
    if (!s) return 0;
    const [m = '0', ss = '0'] = s.split(':');
    return (parseInt(m, 10) || 0) * 60 + (parseInt(ss, 10) || 0);
};

function seasonLine(pid: string, rows: PlayerRow[], teamGames: GameRow[], tri: string): SeasonLine | null {
    const mine = rows.filter(r => String(r.player_id) === pid && gameTypeOf(r.game_id) === 2 && toiSec(r.toi) > 0);
    if (mine.length === 0 && teamGames.length === 0) return null;
    let g = 0, a = 0, sog = 0, toi = 0;
    const withTeam = new Set<string>();
    const otherDates = new Set<string>();
    for (const r of mine) {
        g += n(r.goals);
        a += n(r.assists);
        sog += n(r.shots);
        toi += toiSec(r.toi);
        if (r.team === tri) withTeam.add(String(r.game_id));
        else otherDates.add(String(r.date).slice(0, 10));
    }
    const regular = teamGames.filter(x => x.type === 2).slice().reverse();
    const marks: string[] = regular.map(x => (withTeam.has(x.id) ? '1' : otherDates.has(x.date) ? 'o' : '0'));
    // Before a player's first game here he was not with the team (signing,
    // call-up, trade): mark those games '-' rather than "missed".
    const first = marks.indexOf('1');
    for (let i = 0; i < (first < 0 ? marks.length : first); i++) if (marks[i] === '0') marks[i] = '-';
    const avail = marks.join('');
    return { gp: mine.length, g, a, pts: g + a, sog, toi: mine.length ? Math.round(toi / mine.length) : 0, avail };
}

// ── impact + percentiles ─────────────────────────────────────────────────────

const pctile = (val: number, pool: number[], hiGood = true) => {
    if (!pool.length || !Number.isFinite(val)) return 50;
    const below = pool.filter(x => x < val).length;
    const raw = (below / pool.length) * 100;
    return Math.round(hiGood ? raw : 100 - raw);
};
const r2 = (v: number) => Math.round(v * 100) / 100;

function impactBuilder() {
    const impact = readPublicJson<Record<string, ImpactEntry>>('player_impact.json') ?? {};
    const label = seasonLabel(ratingsSeason());
    const all = Object.values(impact).filter(p => p.position !== 'G' && Number(p.games_played ?? 0) >= 5);
    const num = (p: ImpactEntry, k: string) => Number(p[k] ?? 0);
    const pools = (fwd: boolean) => {
        const arr = all.filter(p => !!p.is_forward === fwd);
        const col = (k: string) => arr.map(p => num(p, k));
        return {
            score: arr.map(p => Number(p.impact_score ?? p.xgaa_per_game ?? 0)),
            xgf60: col('ev_xgf_per60'), xga60: col('ev_xga_per60'), xgPct: col('onice_xgf_pct'), ixg60: col('ind_xg_per60'),
            rel: col('relative_xgf_pct'), pen: col('penalty_diff_per60'),
            pp: arr.filter(p => num(p, 'pp_toi_per_game') >= 60).map(p => num(p, 'pp_xgf_per60')),
            pk: arr.filter(p => num(p, 'pk_toi_per_game') >= 60).map(p => num(p, 'pk_xga_per60')),
        };
    };
    const F = pools(true);
    const D = pools(false);
    return (id: string): SkaterImpact | null => {
        const p = impact[id];
        if (!p || p.position === 'G' || Number(p.games_played ?? 0) < 5) return null;
        const pool = p.is_forward ? F : D;
        const pc = (k: string, poolArr: number[], hi = true): Pctl => ({ v: r2(num(p, k)), p: pctile(num(p, k), poolArr, hi) });
        const score = Number(p.impact_score ?? p.xgaa_per_game ?? 0);
        return {
            season: label,
            team: (p.team_prev as string) ?? p.team ?? null,
            gp: Number(p.games_played ?? 0),
            score: { v: r2(score), p: pctile(score, pool.score) },
            evOff: r2(num(p, 'impact_ev_off')),
            evDef: r2(num(p, 'impact_ev_def')),
            pp: r2(num(p, 'impact_pp')),
            pk: r2(num(p, 'impact_pk')),
            xgf60: pc('ev_xgf_per60', pool.xgf60),
            xga60: pc('ev_xga_per60', pool.xga60, false),
            xgPct: pc('onice_xgf_pct', pool.xgPct),
            ixg60: pc('ind_xg_per60', pool.ixg60),
            rel: pc('relative_xgf_pct', pool.rel),
            pen: pc('penalty_diff_per60', pool.pen),
            ppPct: num(p, 'pp_toi_per_game') >= 60 ? pctile(num(p, 'pp_xgf_per60'), pool.pp) : null,
            pkPct: num(p, 'pk_toi_per_game') >= 60 ? pctile(num(p, 'pk_xga_per60'), pool.pk, false) : null,
            evToi: Math.round(num(p, 'ev_toi_per_game')),
            ppToi: Math.round(num(p, 'pp_toi_per_game')),
            pkToi: Math.round(num(p, 'pk_toi_per_game')),
        };
    };
}

// ── goalies ──────────────────────────────────────────────────────────────────

/** A goalie's regular-season line; starts (GSAx, last five) count for any club, so a newcomer's season is complete. */
function goalieSeason(pid: string, name: string, rows: PlayerRow[], leagueGames: GameRow[]): GoalieSeason | null {
    const mine = rows.filter(r => String(r.player_id) === pid && gameTypeOf(r.game_id) === 2 && toiSec(r.toi) > 0);
    const key = goalieKey(name);
    const starts = leagueGames.filter(g => g.type === 2 && g.starter && goalieKey(g.starter) === key);
    if (mine.length === 0 && starts.length === 0) return null;
    const s: GoalieSeason = { gp: mine.length, gs: starts.length, w: 0, l: 0, ot: 0, sa: 0, sv: 0, ga: 0, toi: 0, gsax: null, last5: [] };
    for (const r of mine) {
        if (r.decision === 'W') s.w++;
        else if (r.decision === 'L') s.l++;
        else if (r.decision === 'O') s.ot++;
        s.sa += n(r.shots_against);
        s.sv += n(r.saves);
        s.ga += n(r.goals_against);
        s.toi += toiSec(r.toi);
    }
    if (starts.length) s.gsax = r2(starts.reduce((acc, g) => acc + gsaxOf(g), 0));
    s.last5 = starts.slice(0, 5).map(g => ({ date: g.date, opp: g.opp, home: g.home, result: g.result, ga: g.ga, sa: g.sa }));
    return s;
}

// ── hero ─────────────────────────────────────────────────────────────────────

interface Upcoming {
    id?: number;
    gameDate?: string;
    startTimeUTC?: string;
    gameState?: string;
    homeTeamAbbrev?: string;
    awayTeamAbbrev?: string;
    homeGoalieConfirmed?: string | null;
    homeGoalieStatus?: string | null;
    awayGoalieConfirmed?: string | null;
    awayGoalieStatus?: string | null;
    tvNetwork?: string | null;
}

interface Injury {
    playerId?: number | null;
    name?: string;
    team?: string;
    position?: string;
    status?: string;
    type?: string | null;
    returnDate?: string | null;
}

function loadInjuries(tri: string): Injury[] {
    return (readPublicJson<Injury[]>('injuries.json') ?? []).filter(i => i.team === tri);
}

interface SeasonScheduleGame {
    start_utc?: string;
    game_type?: number;
    home_abbrev?: string;
    away_abbrev?: string;
    state?: string;
}

/**
 * The upcoming feed only covers today and tomorrow; fall back to the full
 * season schedule the pipeline keeps (pipeline/data/nhl_schedule_<season>.json).
 */
function nextFromSeasonSchedule(tri: string, cutoff: number): Upcoming | undefined {
    try {
        const file = path.join(process.cwd(), 'pipeline', 'data', `nhl_schedule_${SEASON_ID}.json`);
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { games?: Record<string, SeasonScheduleGame> | SeasonScheduleGame[] };
        const games = Array.isArray(raw.games) ? raw.games : Object.values(raw.games ?? {});
        const g = games
            .filter(x => (x.home_abbrev === tri || x.away_abbrev === tri) && x.start_utc && x.state !== 'OFF' && x.state !== 'FINAL')
            .filter(x => (x.game_type ?? 2) >= 2 && Date.parse(x.start_utc!) >= cutoff)
            .sort((a, b) => a.start_utc!.localeCompare(b.start_utc!))[0];
        if (!g) return undefined;
        // gameDate is the Eastern calendar date, as in upcoming_games.json.
        const gameDate = new Date(g.start_utc!).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        return { gameDate, startTimeUTC: g.start_utc, homeTeamAbbrev: g.home_abbrev, awayTeamAbbrev: g.away_abbrev } as Upcoming;
    } catch {
        return undefined;
    }
}

export function nextGameFor(tri: string, now = new Date()): NextGame | null {
    const up = readPublicJson<Upcoming[]>('upcoming_games.json') ?? [];
    const cutoff = now.getTime() - 3 * 3600 * 1000;
    const g = up
        .filter(x => (x.homeTeamAbbrev === tri || x.awayTeamAbbrev === tri) && x.gameState !== 'OFF' && x.gameState !== 'FINAL')
        .filter(x => !x.startTimeUTC || Date.parse(x.startTimeUTC) >= cutoff)
        .sort((a, b) => (a.startTimeUTC ?? a.gameDate ?? '').localeCompare(b.startTimeUTC ?? b.gameDate ?? ''))[0] ?? nextFromSeasonSchedule(tri, cutoff);
    if (!g || !g.gameDate) return null;
    const home = g.homeTeamAbbrev === tri;
    const opp = (home ? g.awayTeamAbbrev : g.homeTeamAbbrev) ?? '';
    const pred = loadPredictionRows().find(p => p.date === g.gameDate && p.home === g.homeTeamAbbrev && p.away === g.awayTeamAbbrev);
    const pct = pred ? (home ? pred.homeWinPct : pred.awayWinPct) : undefined;
    const goalie = (name?: string | null, status?: string | null) => (name ? { name, status: status || 'Unconfirmed' } : null);
    const away = home ? opp : tri;
    const homeTri = home ? tri : opp;
    return {
        date: g.gameDate,
        startTimeUTC: g.startTimeUTC ?? null,
        opp,
        home,
        modelWinPct: typeof pct === 'number' ? pct : null,
        goalie: home ? goalie(g.homeGoalieConfirmed, g.homeGoalieStatus) : goalie(g.awayGoalieConfirmed, g.awayGoalieStatus),
        oppGoalie: home ? goalie(g.awayGoalieConfirmed, g.awayGoalieStatus) : goalie(g.homeGoalieConfirmed, g.homeGoalieStatus),
        href: `/?date=${g.gameDate}#${away.toLowerCase()}-${homeTri.toLowerCase()}`,
        tv: g.tvNetwork || null,
    };
}

export function buildTeamHero(tri: string): TeamHero {
    const proj = loadProjections()?.[tri];
    const rc = rosterChanges(tri);
    return {
        nextGame: nextGameFor(tri),
        playoffOdds: proj
            ? {
                  pct: proj.make_playoffs_pct,
                  division: proj.won_division_pct ?? null,
                  cup: proj.won_cup_pct ?? null,
                  avgPoints: proj.avg_points ?? null,
                  sims: proj.simulations ?? null,
              }
            : null,
        injuries: loadInjuries(tri).map(i => ({
            name: i.name ?? '',
            pos: i.position ?? '',
            status: i.status ?? '',
            type: i.type ?? null,
            returnDate: i.returnDate ?? null,
        })),
        rosterChanges: rc
            ? {
                  added: rc.added.map(p => ({ name: p.name, from: p.from ?? null })),
                  lost: rc.lost.map(p => ({ name: p.name, to: p.to ?? null })),
              }
            : null,
    };
}

// ── lineup (DailyFaceoff) → roster ids ───────────────────────────────────────

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim();

function matchLineup(tri: string, skaters: SkaterCardData[]): Record<string, string[]> | null {
    const lineups = readPublicJson<Record<string, Record<string, { name?: string; pos?: string }[]>>>('team_lineups.json');
    const lu = lineups?.[tri];
    if (!lu) return null;
    const byFull = new Map<string, SkaterCardData[]>();
    const byLast = new Map<string, SkaterCardData[]>();
    for (const s of skaters) {
        const f = norm(s.name);
        byFull.set(f, [...(byFull.get(f) ?? []), s]);
        const l = f.split(' ').at(-1) ?? f;
        byLast.set(l, [...(byLast.get(l) ?? []), s]);
    }
    const used = new Set<string>();
    const pick = (name: string, pos: string) => {
        const f = norm(name);
        const isD = ['ld', 'rd', 'd'].includes(pos.toLowerCase());
        const cands = byFull.get(f) ?? byLast.get(f.split(' ').at(-1) ?? f) ?? [];
        const hit = cands.find(c => !used.has(c.id) && (c.pos === 'D') === isD) ?? cands.find(c => !used.has(c.id));
        if (hit) used.add(hit.id);
        return hit?.id;
    };
    const out: Record<string, string[]> = {};
    let matched = 0;
    for (const slot of ['f1', 'f2', 'f3', 'f4', 'd1', 'd2', 'd3']) {
        out[slot] = (lu[slot] ?? []).map(p => pick(p.name ?? '', p.pos ?? '')).filter((x): x is string => !!x);
        matched += out[slot].length;
    }
    return matched >= 10 ? out : null;
}

// ── payload ──────────────────────────────────────────────────────────────────

interface Bio {
    age?: number | null;
    height?: string | null;
    weight?: number | null;
    shoots?: string | null;
}
interface Contract {
    cap_hit?: number;
    capHit?: number;
    status?: string;
    year?: number | null;
    expiry_year?: number | null;
}

export async function buildTeamPayload(tri: string, season: string, opts: { boxscores?: boolean } = {}): Promise<TeamPayload> {
    const meta = teamMeta(tri);
    const isCurrent = season === SEASON_ID;
    const { rows: standings, games: leagueGames } = leagueStandings(season);
    const teamGames = leagueGames.filter(g => g.tri === tri);
    const standing = standings.find(s => s.tri === tri) ?? null;
    const regular = leagueGames.filter(g => g.type === 2);
    const summary = leaguesSummary(standings);

    const { players: roster, source } = await loadRoster(tri);
    const rc = rosterChanges(tri);
    const addedIds = new Set((rc?.added ?? []).map(p => String(p.id)));
    const addedFrom = new Map((rc?.added ?? []).map(p => [String(p.id), p.from ?? null]));

    // Season lines always pair this season with the previous one.
    const curSeason = SEASON_ID;
    const lastSeason = prevSeasonId(SEASON_ID);
    const curRows = loadPlayerStats(curSeason);
    const lastRows = loadPlayerStats(lastSeason);
    const curLeagueGames = season === curSeason ? leagueGames : leagueStandings(curSeason).games;
    const lastLeagueGames = season === lastSeason ? leagueGames : leagueStandings(lastSeason).games;
    const curTeamGames = curLeagueGames.filter(g => g.tri === tri);
    const lastTeamGames = lastLeagueGames.filter(g => g.tri === tri);
    const lastSeasonTeamIds = new Set(lastRows.filter(r => r.team === tri).map(r => String(r.player_id)));

    const bios = readPublicJson<Record<string, Bio>>('player_bio.json') ?? {};
    const contracts = readPublicJson<Record<string, Contract>>('contracts.json') ?? {};
    const injuries = loadInjuries(tri);
    const injuryFor = (id: string, name: string) => {
        const i = injuries.find(x => (x.playerId != null && String(x.playerId) === id) || norm(x.name ?? '') === norm(name));
        return i ? { status: i.status ?? 'Injured', returnDate: i.returnDate ?? null } : null;
    };
    const impactOf = impactBuilder();

    const skaters: SkaterCardData[] = roster
        .filter(p => p.pos !== 'G')
        .map(p => {
            const isNew = addedIds.has(p.id) || (rc === null && lastRows.length > 0 && !lastSeasonTeamIds.has(p.id));
            const bio = bios[p.id] ?? {};
            const c = contracts[p.id];
            const imp = impactOf(p.id);
            return {
                id: p.id,
                name: p.name,
                pos: p.pos as SkaterCardData['pos'],
                number: p.number,
                isNew,
                from: addedFrom.get(p.id) ?? (isNew ? (imp?.team ?? null) : null),
                age: bio.age ?? null,
                height: bio.height ?? null,
                weight: bio.weight ?? null,
                shoots: bio.shoots ?? null,
                capHit: c ? (c.cap_hit ?? c.capHit ?? null) : null,
                expiry: c ? [c.status, c.year ?? c.expiry_year].filter(Boolean).join(' ') || null : null,
                injury: injuryFor(p.id, p.name),
                impact: imp,
                current: seasonLine(p.id, curRows, curTeamGames, tri),
                last: seasonLine(p.id, lastRows, lastTeamGames, tri),
            };
        });

    const goalieRatings = readPublicJson<Record<string, { gsax_per_game?: number; games_played?: number; games_by_season?: Record<string, number> }>>('goalie_ratings.json') ?? {};
    const ratingByKey = new Map(Object.entries(goalieRatings).map(([k, v]) => [goalieKey(k), v]));
    const next = isCurrent ? nextGameFor(tri) : null;
    const goalies: GoalieLine[] = roster
        .filter(p => p.pos === 'G')
        .map(p => {
            const r = ratingByKey.get(goalieKey(p.name));
            // The rating blends every tracked season (plus this one once he has played).
            const seasons = Object.keys(r?.games_by_season ?? {});
            if (r && (r.games_played ?? 0) > 0) seasons.push(seasonLabel(SEASON_ID));
            const span = [...new Set(seasons)].sort();
            const label = span.length > 1 ? `${span[0]} to ${span[span.length - 1]}` : span[0] ?? 'prior seasons';
            const nextStatus = next?.goalie && goalieKey(next.goalie.name) === goalieKey(p.name) ? { date: next.date, status: next.goalie.status, opp: next.opp } : null;
            return {
                id: p.id,
                name: p.name,
                number: p.number,
                isNew: addedIds.has(p.id),
                injury: injuryFor(p.id, p.name),
                current: goalieSeason(p.id, p.name, curRows, curLeagueGames),
                last: goalieSeason(p.id, p.name, lastRows, lastLeagueGames),
                rating: r && typeof r.gsax_per_game === 'number' ? { gsaxPerGame: r2(r.gsax_per_game), label } : null,
                next: nextStatus,
            };
        });

    let boxscores: Boxscores | undefined;
    if (opts.boxscores) {
        boxscores = { players: {}, games: {} };
        const rows = season === curSeason ? curRows : season === lastSeason ? lastRows : loadPlayerStats(season);
        for (const r of rows) {
            if (r.team !== tri) continue;
            const pid = String(r.player_id);
            boxscores.players[pid] ??= [r.name, n(r.number), r.position];
            const goalie = n(r.is_goalie) ? 1 : 0;
            if (goalie && toiSec(r.toi) === 0) continue;
            (boxscores.games[String(r.game_id)] ??= []).push([
                pid, n(r.goals), n(r.assists), n(r.points), n(r.plus_minus), r.toi, n(r.shots), goalie, n(r.shots_against), n(r.saves),
            ]);
        }
    }

    const kpis = standing && standing.gp > 0 ? summary.kpis(tri) : null;
    return {
        season,
        seasonLabel: seasonLabel(season),
        isCurrent,
        team: meta,
        games: packGames(teamGames),
        standing,
        kpis,
        leagueAverages: leagueAverages(regular),
        skaters,
        lineup: isCurrent ? matchLineup(tri, skaters) : null,
        goalies,
        rosterSource: source,
        ratingsSeasonLabel: seasonLabel(ratingsSeason()),
        boxscores,
        generatedAt: new Date().toISOString(),
    };
}
