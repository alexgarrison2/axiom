import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { SEASON_ID } from '../season';
import { loadSeasonGames, teamToTri } from '../../utils/team-stats/server';
import { packGames } from '../../utils/team-stats/game-row';
import { groupByTeam } from '../../utils/team-stats/filter';
import { TEAM_TRICODES } from '../../utils/team-stats/teams';
import type { GameRow } from '../../utils/team-stats/types';
import { buildReference, restBuckets, type LeagueReference, type MatchupGame, type TeamGamesPayload } from './matchup-stats';

/*
 * Server loader for app/api/matchup-stats/*. Both routes are force-static,
 * so this runs at build time only (every pipeline run redeploys); nothing
 * here reads files per request.
 *
 * Game rows come from the /teams loader (loadSeasonGames). The 5v5 xG and
 * 5v5 TOI columns are not in those rows, so they are read from the same
 * gamestats CSVs here: this season from public/data/gamestats.csv, last
 * season from its pipeline file (pipeline/nhl_season_<y>_<y+1>_gamestats.csv).
 */

/** This season only: the matchup numbers never reach back into last season. Never hardcoded: rolls with lib/season.ts. */
export const WINDOW = [SEASON_ID] as const;

const READ = {
    current: () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'gamestats.csv'), 'utf8'),
    season: (seasonId: string) =>
        fs.readFileSync(path.join(process.cwd(), 'pipeline', `nhl_season_${seasonId.slice(0, 4)}_${seasonId.slice(4)}_gamestats.csv`), 'utf8'),
};

interface Extra {
    xgf5: number;
    xga5: number;
    toi5: number;
}

const num = (v: unknown) => {
    const n = parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : 0;
};

let extrasCache: Map<string, Extra> | null = null;

/** game_id|TRI → 5v5 xG for/against and 5v5 seconds, over the window. */
function extras(): Map<string, Extra> {
    if (extrasCache) return extrasCache;
    const out = new Map<string, Extra>();
    const add = (text: string) => {
        const rows = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() }).data;
        for (const r of rows) {
            const tri = teamToTri(String(r.team ?? '').trim());
            const id = String(r.game_id ?? '').trim();
            if (!tri || !id || out.has(`${id}|${tri}`)) continue;
            out.set(`${id}|${tri}`, { xgf5: num(r.xG_for_5v5), xga5: num(r.xG_against_5v5), toi5: num(r.time_5v5) });
        }
    };
    const tryAdd = (read: () => string) => {
        try {
            add(read());
        } catch {
            /* missing file: those rows get zeros (no 5v5 xG rates) */
        }
    };
    tryAdd(READ.current);
    for (const s of WINDOW) tryAdd(() => READ.season(s));
    extrasCache = out;
    return out;
}

let gamesCache: Map<string, MatchupGame[]> | null = null;

/** Every team's window games (newest first) with 5v5 extras and rest buckets. */
export function windowGames(): Map<string, MatchupGame[]> {
    if (gamesCache) return gamesCache;
    const rows: GameRow[] = WINDOW.flatMap(s => {
        try {
            return loadSeasonGames(s);
        } catch {
            return [];
        }
    });
    const ex = extras();
    const out = new Map<string, MatchupGame[]>();
    for (const [tri, list] of groupByTeam(rows)) {
        const sorted = [...list].sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)));
        const rest = restBuckets(sorted.map(r => r.date));
        out.set(
            tri,
            sorted.map((row, i) => {
                const e = ex.get(`${row.id}|${tri}`);
                return { row, xgf5: e?.xgf5 ?? 0, xga5: e?.xga5 ?? 0, toi5: e?.toi5 ?? 0, rest: rest[i] };
            }),
        );
    }
    gamesCache = out;
    return out;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function teamGamesPayload(tri: string): TeamGamesPayload | null {
    if (!TEAM_TRICODES.includes(tri)) return null;
    const games = windowGames().get(tri) ?? [];
    return {
        tri,
        seasons: [...WINDOW],
        games: packGames(games.map(g => g.row), { periods: false }),
        xgf5: games.map(g => r3(g.xgf5)),
        xga5: games.map(g => r3(g.xga5)),
        toi5: games.map(g => Math.round(g.toi5)),
        rest: games.map(g => g.rest),
    };
}

export function leagueReference(): LeagueReference {
    return { seasons: [...WINDOW], ref: buildReference(windowGames()) };
}
