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
import { gameScores, GS_PARTS, skaterRows, type PonyConstants } from '../lib/game/analytics';
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

export const SKATER_COLS = [
    'game', 'player', 'team', 'opp', 'home', 'pos', 'toi', 'ps',
    ...GS_PARTS,
    'g', 'a1', 'a2', 'sog', 'ixg', 'hit', 'blk', 'pim', 'pm', 'toi_pp', 'toi_pk',
] as const;
export const GOALIE_COLS = ['game', 'player', 'team', 'opp', 'home', 'toi', 'sa', 'ga', 'xga', 'ps'] as const;

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

function rowsFor(m: GameModel, C: PonyConstants, doc: SeasonDoc) {
    const id = String(m.id);
    doc.games[id] = [m.date, m.teams.away.tri, m.teams.home.tri, m.teams.away.score, m.teams.home.score, m.outcome ?? 'REG'];
    for (const p of m.players) {
        doc.players[String(p.id)] = [p.first, p.last, p.pos, p.num, p.headshot, m.teams[p.side].tri];
    }
    for (const side of ['away', 'home'] as Side[]) {
        const opp = side === 'away' ? 'home' : 'away';
        const box = new Map(skaterRows(m, side, 'all').map(r => [r.player.id, r]));
        const { skaters, goalies } = gameScores(m, side, C);
        for (const s of skaters) {
            const b = box.get(s.player.id);
            doc.skaters.push([
                m.id, s.player.id, m.teams[side].tri, m.teams[opp].tri, side === 'home' ? 1 : 0, s.player.pos === 'D' ? 'D' : 'F',
                Math.round(s.raw.toi), r3(s.total),
                ...GS_PARTS.map(k => r3(s.parts[k])),
                b?.g ?? 0, b?.a1 ?? 0, b?.a2 ?? 0, b?.sog ?? 0, r3(b?.ixg ?? 0), b?.hits ?? 0, b?.blocks ?? 0, b?.pim ?? 0, b?.plusMinus ?? 0,
                Math.round(s.raw.toiPp), Math.round(s.raw.toiPk),
            ]);
        }
        for (const g of goalies) {
            if (g.toi <= 0) continue;
            doc.goalies.push([m.id, g.player.id, m.teams[side].tri, m.teams[opp].tri, side === 'home' ? 1 : 0, Math.round(g.toi), g.sa, g.ga, r3(g.xga), r3(g.total)]);
        }
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

async function main() {
    const C = readJson<PonyConstants>(path.join(ROOT, 'public', 'data', 'pony_score.json'));
    if (!C) throw new Error('public/data/pony_score.json missing: run pipeline/tools/pony_score_calibrate.py');
    const ratings = parseRatings(readJson(path.join(ROOT, 'public', 'data', 'player_ratings.json')));
    const xgDoc = readJson<Record<string, [number, number][]>>(path.join(ROOT, 'public', 'data', 'game_xg', `${SEASON}.json`)) ?? {};
    const outDir = path.join(ROOT, 'public', 'data', 'pony');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${SEASON}.json`);
    const prior = FORCE ? null : readJson<SeasonDoc>(outFile);
    const doc: SeasonDoc = prior && prior.skater_cols?.join() === SKATER_COLS.join()
        ? { ...prior, built_at: new Date().toISOString() }
        : { version: 1, season: SEASON, built_at: new Date().toISOString(), games: {}, players: {}, skater_cols: SKATER_COLS, skaters: [], goalie_cols: GOALIE_COLS, goalies: [] };

    const todo = Object.keys(xgDoc)
        .filter(id => /^\d{4}02\d{4}$/.test(id) && !doc.games[id])
        .sort()
        .slice(0, LIMIT);
    console.log(`${SEASON}: ${Object.keys(doc.games).length} games stored, ${todo.length} to build`);

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
            if (!p?.id || (p.gameState !== 'OFF' && p.gameState !== 'FINAL') || !shiftRows?.length) {
                skipped++;
                continue;
            }
            const xg = new Map(xgDoc[id]);
            const m = buildGame({ pbp: p, shifts: shifts as RawFeeds['shifts'], box: box as RawFeeds['box'] }, xg, null, { ratings });
            rowsFor(m, C, doc);
            done++;
            if (done % 50 === 0) console.log(`  ${done} / ${todo.length}`);
        }
    };
    await Promise.all(Array.from({ length: 4 }, worker));

    // Stable order: by game, then team, then score.
    doc.skaters.sort((a, b) => Number(a[0]) - Number(b[0]) || String(a[2]).localeCompare(String(b[2])) || Number(b[7]) - Number(a[7]));
    doc.goalies.sort((a, b) => Number(a[0]) - Number(b[0]));
    fs.writeFileSync(outFile, JSON.stringify(doc));
    fs.writeFileSync(path.join(outDir, `${SEASON}_days.json`), JSON.stringify({ season: SEASON, skater_cols: ['game', 'player', 'team', 'opp', 'ps', ...GS_PARTS], days: days(doc) }));
    console.log(`built ${done}, skipped ${skipped} (not final or no shifts); ${Object.keys(doc.games).length} games, ${doc.skaters.length} skater rows -> ${path.relative(ROOT, outFile)}`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
