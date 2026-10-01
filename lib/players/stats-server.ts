import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { SEASON_START_YEAR, seasonFile } from '../season';
import type { StatLine } from '../../components/players/model';

/*
 * Server-only (node:fs), build time only: the season player boxscores for
 * /players. Kept apart from ./server.ts because the file name is built from
 * the season, which makes Turbopack trace public/data into every function
 * that imports this module; only the static /players page and its JSON
 * route do.
 */

interface BoxRow {
    game_id: string;
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

/**
 * Regular-season counting lines per skater (NHL id) from a season's player
 * boxscores (public/data/nhl_season_YYYY_YYYY_player_stats.csv). Only used at
 * build time: /players and its JSON route are static.
 */
export function seasonLines(startYear: number): Map<string, StatLine> {
    const out = new Map<string, StatLine>();
    let text = '';
    try {
        text = fs.readFileSync(path.join(process.cwd(), 'public', 'data', seasonFile('player_stats', startYear)), 'utf8');
    } catch {
        return out;
    }
    const acc = new Map<string, { gp: number; g: number; a: number; sog: number; toi: number }>();
    const prefix = `${startYear}02`;
    for (const r of Papa.parse<BoxRow>(text, { header: true, skipEmptyLines: true }).data) {
        if (!String(r.game_id).startsWith(prefix) || String(r.is_goalie) === '1' || String(r.is_goalie).toLowerCase() === 'true') continue;
        const t = toiSec(r.toi);
        if (t <= 0) continue;
        const id = String(r.player_id);
        const s = acc.get(id) ?? { gp: 0, g: 0, a: 0, sog: 0, toi: 0 };
        s.gp += 1;
        s.g += Number(r.goals) || 0;
        s.a += Number(r.assists) || 0;
        s.sog += Number(r.shots) || 0;
        s.toi += t;
        acc.set(id, s);
    }
    for (const [id, s] of acc) out.set(id, { gp: s.gp, g: s.g, a: s.a, pts: s.g + s.a, sog: s.sog, toi: Math.round(s.toi / s.gp) });
    return out;
}

/** This season's and last season's counting lines. */
export function statLines() {
    return { cur: seasonLines(SEASON_START_YEAR), prev: seasonLines(SEASON_START_YEAR - 1) };
}
