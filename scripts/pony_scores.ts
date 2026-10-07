/**
 * Pony Score season data: every skater's and goalie's Pony Score for every
 * finished game, built with the game page's own code (lib/game build +
 * gameScores), so the player pages, the leaderboard and the slate tables show
 * exactly what the game page shows.
 *
 * Games are the ones pony xG has scored (public/data/game_xg/<season>.json);
 * games already in the output are skipped unless --force. Feeds come straight
 * from the NHL API (play-by-play, shift charts, boxscore).
 *
 * Writes
 *   public/data/pony/<season>.json        games, players, skater and goalie rows (columnar)
 *   public/data/pony/<season>_days.json   per date: the night's top / bottom skaters and best goalie
 *
 * Usage:  npx tsx scripts/pony_scores.ts [--season 20262027] [--force] [--limit 50]
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildGame, type RawFeeds } from '../lib/game/build';
import { gameScores, goalieRows, GS_PARTS, skaterRows, type PonyConstants } from '../lib/game/analytics';
import { parseRatings } from '../lib/game/ratings';
import type { GameModel, Side } from '../lib/game/types';
import { SEASON_ID } from '../lib/season';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
};
const SEASON = arg('--season') ?? SEASON_ID;
const FORCE = args.includes('--force');
const LIMIT = Number(arg('--limit') ?? Infinity);
const UA = { 'User-Agent': 'pony-xg (pony score build)' };

/*
 * Box-score columns appended after the Pony Score ones (the player page's game log).
 * Appending keeps a stored file's rows: a run only adds these to games that lack
 * them (re-reading the feeds), it never rescores a stored game.
 *   ppp / shp     power-play / shorthanded points (goal strength from the scorer's side; an extra attacker is not a power play)
 *   att           shot attempts (goals, shots, misses, blocked)
 *   gv / tk       giveaways / takeaways
 *   fow / fol     faceoffs won / lost
 *   shf           shifts
 *   cf5 ca5       5v5 on-ice shot attempts for / against
 *   xgf5 xga5     5v5 on-ice pony xG for / against
 * Goalies:
 *   hd_sa hd_ga   high-danger shots / goals against (xG >= HD_XG)
 *   ev_sa ev_ga   even strength;  pk_sa pk_ga  while his team is shorthanded
 *   dec           decision from the boxscore: W, L, O or ''
 */
const SKATER_EXTRA = ['ppp', 'shp', 'att', 'gv', 'tk', 'fow', 'fol', 'shf', 'cf5', 'ca5', 'xgf5', 'xga5'] as const;
const GOALIE_EXTRA = ['hd_sa', 'hd_ga', 'ev_sa', 'ev_ga', 'pk_sa', 'pk_ga', 'dec'] as const;

export const SKATER_COLS = [
    'game', 'player', 'team', 'opp', 'home', 'pos', 'toi', 'ps',
    ...GS_PARTS,
    'g', 'a1', 'a2', 'sog', 'ixg', 'hit', 'blk', 'pim', 'pm', 'toi_pp', 'toi_pk',
    ...SKATER_EXTRA,
] as const;
export const GOALIE_COLS = ['game', 'player', 'team', 'opp', 'home', 'toi', 'sa', 'ga', 'xga', 'ps', ...GOALIE_EXTRA] as const;

type Row = (string | number)[];
interface SeasonDoc {
    version: 1;
    season: string;
    built_at: string;
    games: Record<string, [string, string, string, number, number, string]>;
    players: Record<string, [string, string, string, number | null, string | null, string]>;
    skater_cols: readonly string[];
    skaters: Row[];
    goalie_cols: readonly string[];
    goalies: Row[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

async function getJson(url: string): Promise<unknown | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
            if (res.ok) return await res.json();
            if (res.status === 404) return null;
        } catch {
            /* retry */
        }
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
    return null;
}

function readJson<T>(file: string): T | null {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
        return null;
    }
}

/** Decisions by goalie id from the raw boxscore ('W', 'L', 'O'). */
function decisions(box: unknown): Map<number, string> {
    const out = new Map<number, string>();
    const stats = (box as { playerByGameStats?: Record<string, { goalies?: { playerId?: number; decision?: string }[] }> } | null)?.playerByGameStats;
    for (const t of Object.values(stats ?? {})) for (const g of t.goalies ?? []) if (g.playerId && g.decision) out.set(g.playerId, g.decision);
    return out;
}

/** The appended box-score values (SKATER_EXTRA / GOALIE_EXTRA order) by player id, for one side. */
function extrasFor(m: GameModel, side: Side, dec: Map<number, string>): { skaters: Map<number, Row>; goalies: Map<number, Row> } {
    const all = skaterRows(m, side, 'all');
    const five = new Map(skaterRows(m, side, '5v5').map(r => [r.player.id, r]));
    const pts = new Map<number, { pp: number; sh: number }>();
    for (const e of m.events) {
        if (e.type !== 'goal' || e.side !== side || (e.strength !== 'pp' && e.strength !== 'sh')) continue;
        for (const id of [e.player, ...e.assists]) {
            if (id == null) continue;
            const c = pts.get(id) ?? { pp: 0, sh: 0 };
            c[e.strength] += 1;
            pts.set(id, c);
        }
    }
    const skaters = new Map<number, Row>();
    for (const r of all) {
        const f = five.get(r.player.id);
        const p = pts.get(r.player.id);
        skaters.set(r.player.id, [p?.pp ?? 0, p?.sh ?? 0, r.iCF, r.giveaways, r.takeaways, r.foW, r.foL, r.shifts, f?.cf ?? 0, f?.ca ?? 0, r3(f?.xgf ?? 0), r3(f?.xga ?? 0)]);
    }
    const goalies = new Map<number, Row>();
    for (const g of goalieRows(m, side)) {
        // byStrength is from the goalie's side: 'sh' = his team shorthanded.
        goalies.set(g.player.id, [g.hdSa, g.hdGa, g.byStrength.ev.sa, g.byStrength.ev.ga, g.byStrength.sh.sa, g.byStrength.sh.ga, dec.get(g.player.id) ?? '']);
    }
    return { skaters, goalies };
}

function rowsFor(m: GameModel, C: PonyConstants, doc: SeasonDoc, dec: Map<number, string>) {
    const id = String(m.id);
    doc.games[id] = [m.date, m.teams.away.tri, m.teams.home.tri, m.teams.away.score, m.teams.home.score, m.outcome ?? 'REG'];
    for (const p of m.players) {
        doc.players[String(p.id)] = [p.first, p.last, p.pos, p.num, p.headshot, m.teams[p.side].tri];
    }
    for (const side of ['away', 'home'] as Side[]) {
        const opp = side === 'away' ? 'home' : 'away';
        const box = new Map(skaterRows(m, side, 'all').map(r => [r.player.id, r]));
        const extra = extrasFor(m, side, dec);
        const { skaters, goalies } = gameScores(m, side, C);
        for (const s of skaters) {
            const b = box.get(s.player.id);
            doc.skaters.push([
                m.id, s.player.id, m.teams[side].tri, m.teams[opp].tri, side === 'home' ? 1 : 0, s.player.pos === 'D' ? 'D' : 'F',
                Math.round(s.raw.toi), r3(s.total),
                ...GS_PARTS.map(k => r3(s.parts[k])),
                b?.g ?? 0, b?.a1 ?? 0, b?.a2 ?? 0, b?.sog ?? 0, r3(b?.ixg ?? 0), b?.hits ?? 0, b?.blocks ?? 0, b?.pim ?? 0, b?.plusMinus ?? 0,
                Math.round(s.raw.toiPp), Math.round(s.raw.toiPk),
                ...(extra.skaters.get(s.player.id) ?? SKATER_EXTRA.map(() => 0)),
            ]);
        }
        for (const g of goalies) {
            if (g.toi <= 0) continue;
            doc.goalies.push([
                m.id, g.player.id, m.teams[side].tri, m.teams[opp].tri, side === 'home' ? 1 : 0, Math.round(g.toi), g.sa, g.ga, r3(g.xga), r3(g.total),
                ...(extra.goalies.get(g.player.id) ?? [0, 0, 0, 0, 0, 0, '']),
            ]);
        }
    }
}

/** A stored game whose rows predate the appended columns: add them, leave every stored value as it is. */
function augment(m: GameModel, doc: SeasonDoc, dec: Map<number, string>, oldSkater: number, oldGoalie: number) {
    const ex = { away: extrasFor(m, 'away', dec), home: extrasFor(m, 'home', dec) };
    const pick = (k: 'skaters' | 'goalies', player: number) => ex.away[k].get(player) ?? ex.home[k].get(player) ?? null;
    for (const r of doc.skaters) {
        if (Number(r[0]) !== m.id || r.length !== oldSkater) continue;
        r.push(...(pick('skaters', Number(r[1])) ?? SKATER_EXTRA.map(() => 0)));
    }
    for (const r of doc.goalies) {
        if (Number(r[0]) !== m.id || r.length !== oldGoalie) continue;
        r.push(...(pick('goalies', Number(r[1])) ?? [0, 0, 0, 0, 0, 0, '']));
    }
}

/** Per date: the night's five best and five worst skaters (10+ minutes) and best goalie. */
function days(doc: SeasonDoc) {
    const col = (k: string) => doc.skater_cols.indexOf(k);
    const [iG, iP, iT, iO, iTo, iPs] = ['game', 'player', 'team', 'opp', 'toi', 'ps'].map(col);
    const gc = (k: string) => doc.goalie_cols.indexOf(k);
    const byDate = new Map<string, { s: Row[]; g: Row[] }>();
    for (const r of doc.skaters) {
        const d = doc.games[String(r[iG])]?.[0];
        if (!d || Number(r[iTo]) < 600) continue;
        const b = byDate.get(d) ?? { s: [], g: [] };
        b.s.push(r);
        byDate.set(d, b);
    }
    for (const r of doc.goalies) {
        const d = doc.games[String(r[gc('game')])]?.[0];
        if (!d || Number(r[gc('toi')]) < 1800) continue;
        const b = byDate.get(d) ?? { s: [], g: [] };
        b.g.push(r);
        byDate.set(d, b);
    }
    const pick = (r: Row) => [r[iG], r[iP], r[iT], r[iO], r[iPs], ...GS_PARTS.map(k => r[col(k)])];
    const out: Record<string, { top: unknown[]; bottom: unknown[]; goalie: unknown[] | null }> = {};
    for (const [d, b] of byDate) {
        const sorted = [...b.s].sort((a, c) => Number(c[iPs]) - Number(a[iPs]));
        const g = [...b.g].sort((a, c) => Number(c[gc('ps')]) - Number(a[gc('ps')]))[0];
        out[d] = {
            top: sorted.slice(0, 5).map(pick),
            bottom: sorted.slice(-5).reverse().map(pick),
            goalie: g ? [g[gc('game')], g[gc('player')], g[gc('team')], g[gc('opp')], g[gc('ps')], g[gc('sa')], g[gc('ga')]] : null,
        };
    }
    return out;
}

/**
 * Lowest per-team, per-regulation-period on-ice share of a shift chart (six players x
 * 20:00 = 1). The feed can answer while a finished game's chart is still filling in;
 * such a capture is skipped and the game is built on a later run (same bar as
 * pipeline/fetch_shifts.py: real games sit at 0.91 or more).
 */
const MIN_SHIFT_COVERAGE = 0.85;
function shiftCoverage(rows: unknown[]): number {
    const sec = new Map<string, number>();
    const teams = new Set<number>();
    const mmss = (t: unknown) => {
        const [m, s] = String(t ?? '0:00').split(':').map(Number);
        return (m || 0) * 60 + (s || 0);
    };
    for (const r of rows as { typeCode?: number; teamId?: number; period?: number; startTime?: string; endTime?: string }[]) {
        if ((r.typeCode ?? 517) !== 517 || r.teamId == null || !r.period || r.period > 3) continue;
        teams.add(r.teamId);
        const d = Math.max(0, Math.min(1200, mmss(r.endTime)) - Math.max(0, mmss(r.startTime)));
        const k = `${r.teamId}|${r.period}`;
        sec.set(k, (sec.get(k) ?? 0) + d);
    }
    if (teams.size !== 2) return 0;
    return Math.min(...[...teams].flatMap(t => [1, 2, 3].map(p => (sec.get(`${t}|${p}`) ?? 0) / 7200)));
}

async function main() {
    const C = readJson<PonyConstants>(path.join(ROOT, 'public', 'data', 'pony_score.json'));
    if (!C) throw new Error('public/data/pony_score.json missing: run pipeline/tools/pony_score_calibrate.py');
    const ratings = parseRatings(readJson(path.join(ROOT, 'public', 'data', 'player_ratings.json')));
    const xgDoc = readJson<Record<string, [number, number][]>>(path.join(ROOT, 'public', 'data', 'game_xg', `${SEASON}.json`)) ?? {};
    const outDir = path.join(ROOT, 'public', 'data', 'pony');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${SEASON}.json`);
    const prior = FORCE ? null : readJson<SeasonDoc>(outFile);
    // A file written before the appended columns keeps its rows; those games get the new columns added.
    const prefix = (a: readonly string[] | undefined, b: readonly string[]) => !!a && a.length <= b.length && a.every((c, i) => c === b[i]);
    const keep = prior && prefix(prior.skater_cols, SKATER_COLS) && prefix(prior.goalie_cols, GOALIE_COLS);
    const oldSkater = keep ? prior.skater_cols.length : SKATER_COLS.length;
    const oldGoalie = keep ? prior.goalie_cols.length : GOALIE_COLS.length;
    const doc: SeasonDoc = keep
        ? { ...prior, built_at: new Date().toISOString(), skater_cols: SKATER_COLS, goalie_cols: GOALIE_COLS }
        : { version: 1, season: SEASON, built_at: new Date().toISOString(), games: {}, players: {}, skater_cols: SKATER_COLS, skaters: [], goalie_cols: GOALIE_COLS, goalies: [] };
    const stale = new Set<string>();
    for (const r of doc.skaters) if (r.length < SKATER_COLS.length) stale.add(String(r[0]));
    for (const r of doc.goalies) if (r.length < GOALIE_COLS.length) stale.add(String(r[0]));

    const todo = Object.keys(xgDoc)
        .filter(id => /^\d{4}02\d{4}$/.test(id) && (!doc.games[id] || stale.has(id)))
        .sort()
        .slice(0, LIMIT);
    console.log(`${SEASON}: ${Object.keys(doc.games).length} games stored (${stale.size} missing box columns), ${todo.length} to build`);

    let done = 0;
    let skipped = 0;
    const queue = [...todo];
    const worker = async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
            const [pbp, shifts, box] = await Promise.all([
                getJson(`https://api-web.nhle.com/v1/gamecenter/${id}/play-by-play`),
                getJson(`https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=${id}`),
                getJson(`https://api-web.nhle.com/v1/gamecenter/${id}/boxscore`),
            ]);
            const p = pbp as RawFeeds['pbp'] | null;
            const shiftRows = (shifts as { data?: unknown[] } | null)?.data;
            if (!p?.id || (p.gameState !== 'OFF' && p.gameState !== 'FINAL') || !shiftRows?.length || shiftCoverage(shiftRows) < MIN_SHIFT_COVERAGE) {
                skipped++;
                continue;
            }
            const xg = new Map(xgDoc[id]);
            const m = buildGame({ pbp: p, shifts: shifts as RawFeeds['shifts'], box: box as RawFeeds['box'] }, xg, null, { ratings });
            if (doc.games[id]) augment(m, doc, decisions(box), oldSkater, oldGoalie);
            else rowsFor(m, C, doc, decisions(box));
            done++;
            if (done % 50 === 0) console.log(`  ${done} / ${todo.length}`);
        }
    };
    await Promise.all(Array.from({ length: 4 }, worker));

    // Stable order: by game, then team, then score.
    doc.skaters.sort((a, b) => Number(a[0]) - Number(b[0]) || String(a[2]).localeCompare(String(b[2])) || Number(b[7]) - Number(a[7]));
    doc.goalies.sort((a, b) => Number(a[0]) - Number(b[0]));
    fs.writeFileSync(outFile, JSON.stringify(doc));
    const d = days(doc);
    // Names and faces of everyone the nightly tables show.
    const ids = new Set<string>();
    for (const v of Object.values(d)) {
        for (const r of [...v.top, ...v.bottom]) ids.add(String((r as unknown[])[1]));
        if (v.goalie) ids.add(String(v.goalie[1]));
    }
    const players = Object.fromEntries([...ids].filter(id => doc.players[id]).map(id => [id, doc.players[id]]));
    fs.writeFileSync(
        path.join(outDir, `${SEASON}_days.json`),
        JSON.stringify({ season: SEASON, skater_cols: ['game', 'player', 'team', 'opp', 'ps', ...GS_PARTS], goalie_cols: ['game', 'player', 'team', 'opp', 'ps', 'sa', 'ga'], players, days: d }),
    );
    console.log(`built ${done}, skipped ${skipped} (not final or shift chart incomplete); ${Object.keys(doc.games).length} games, ${doc.skaters.length} skater rows -> ${path.relative(ROOT, outFile)}`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
