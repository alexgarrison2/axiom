import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { SEASON_ID, SEASON_START_YEAR, seasonFile } from '../season';
import { loadPonySeason } from '../pony/data';
import { WINDOWS, type StatLine, type StatWindow } from '../../components/players/model';

/*
 * Server-only (node:fs), build time only: the season player boxscores for
 * /players. Kept apart from ./server.ts because the file name is built from
 * the season, which makes Turbopack trace public/data into every function
 * that imports this module; only the static /players page and its JSON
 * route do.
 */

interface BoxRow {
    game_id: string;
    date: string;
    player_id: string;
    goals: string;
    assists: string;
    shots: string;
    toi: string;
    is_goalie: string;
}

const toiSec = (s: string | undefined) => {
    const [m = '0', ss = '0'] = (s ?? '').split(':');
    return (parseInt(m, 10) || 0) * 60 + (parseInt(ss, 10) || 0);
};

interface Game {
    key: string;
    g: number;
    a: number;
    sog: number;
    toi: number;
}

/** Sum games into one counting line (TOI averaged per game). */
function lineOf(games: Game[]): StatLine {
    const s = games.reduce((t, x) => ({ g: t.g + x.g, a: t.a + x.a, sog: t.sog + x.sog, toi: t.toi + x.toi }), { g: 0, a: 0, sog: 0, toi: 0 });
    return { gp: games.length, g: s.g, a: s.a, pts: s.g + s.a, sog: s.sog, toi: Math.round(s.toi / games.length) };
}

/**
 * Each skater's (NHL id) regular-season games from a season's player
 * boxscores (public/data/nhl_season_YYYY_YYYY_player_stats.csv), oldest first.
 */
function seasonGames(startYear: number): Map<string, Game[]> {
    const out = new Map<string, Game[]>();
    let text = '';
    try {
        text = fs.readFileSync(path.join(process.cwd(), 'public', 'data', seasonFile('player_stats', startYear)), 'utf8');
    } catch {
        return out;
    }
    const prefix = `${startYear}02`;
    for (const r of Papa.parse<BoxRow>(text, { header: true, skipEmptyLines: true }).data) {
        if (!String(r.game_id).startsWith(prefix) || String(r.is_goalie) === '1' || String(r.is_goalie).toLowerCase() === 'true') continue;
        const t = toiSec(r.toi);
        if (t <= 0) continue;
        const id = String(r.player_id);
        const list = out.get(id) ?? [];
        list.push({ key: `${r.date}|${r.game_id}`, g: Number(r.goals) || 0, a: Number(r.assists) || 0, sog: Number(r.shots) || 0, toi: t });
        out.set(id, list);
    }
    for (const list of out.values()) list.sort((a, b) => a.key.localeCompare(b.key));
    return out;
}

/**
 * This season's and last season's counting lines, plus this season's last
 * 5 / 10 / 20 games each skater played (absent where that is his whole season). Only used at build time: /players
 * and its JSON route are static.
 */
export function statLines(): { cur: Map<string, StatLine>; prev: Map<string, StatLine> } & Record<StatWindow, Map<string, StatLine>> {
    const cur = seasonGames(SEASON_START_YEAR);
    const prev = seasonGames(SEASON_START_YEAR - 1);
    // A window only where it is shorter than his season (otherwise it is his season line).
    const lines = (games: Map<string, Game[]>, last?: number) =>
        new Map([...games].filter(([, list]) => !last || list.length > last).map(([id, list]) => [id, lineOf(last ? list.slice(-last) : list)]));
    return {
        cur: lines(cur),
        prev: lines(prev),
        ...(Object.fromEntries(WINDOWS.map(n => [`l${n}`, lines(cur, n)])) as Record<StatWindow, Map<string, StatLine>>),
    };
}

/**
 * Form: each skater's (NHL id) Pony Score per game over this season's last
 * 5 / 10 / 20 games he played (all of them when he has fewer), from the Pony
 * Score season file. Build time only, like the counting lines.
 */
export function ponyForm(): Map<string, Record<StatWindow, number>> {
    const out = new Map<string, Record<StatWindow, number>>();
    const data = loadPonySeason(SEASON_ID);
    if (!data) return out;
    const by = new Map<number, { key: string; ps: number }[]>();
    for (const r of data.skaters) by.set(r.player, [...(by.get(r.player) ?? []), { key: `${r.date}|${r.game}`, ps: r.ps }]);
    for (const [id, games] of by) {
        games.sort((a, b) => a.key.localeCompare(b.key));
        const avg = (n: number) => {
            const last = games.slice(-n);
            return Math.round((last.reduce((a, g) => a + g.ps, 0) / last.length) * 1000) / 1000;
        };
        out.set(String(id), Object.fromEntries(WINDOWS.map(n => [`l${n}`, avg(n)])) as Record<StatWindow, number>);
    }
    return out;
}
