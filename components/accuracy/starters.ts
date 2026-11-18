import 'server-only';
import fs from 'node:fs';
import path from 'node:path';

export interface Starters {
    home?: string;
    away?: string;
}

/** Starting goalies per game id from gamestats CSV text (one row per team per game). */
export function parseStarters(csv: string): Map<number, Starters> {
    const out = new Map<number, Starters>();
    const lines = csv.split(/\r?\n/);
    const head = (lines[0] ?? '').split(',');
    const [iId, iSide, iGoalie] = ['game_id', 'home_away', 'starting_goalie'].map(c => head.indexOf(c));
    if (iId < 0 || iSide < 0 || iGoalie < 0) return out;
    for (const line of lines.slice(1)) {
        const c = line.split(',');
        const id = Number(c[iId]);
        const name = c[iGoalie]?.trim();
        if (!id || !name) continue;
        const s = out.get(id) ?? {};
        if (c[iSide] === 'Home') s.home = name;
        else s.away = name;
        out.set(id, s);
    }
    return out;
}

/**
 * Who started in goal in each game of a season ("2025-26"), from the pipeline's season gamestats.
 * Only the prerendered /accuracy/games/[season] route calls this (at build): pipeline CSVs are not in any function bundle.
 */
export function loadStarters(season: string): Map<number, Starters> {
    const y = Number(season.slice(0, 4));
    if (!/^\d{4}-\d{2}$/.test(season)) return new Map();
    try {
        return parseStarters(fs.readFileSync(path.join(process.cwd(), 'pipeline', `nhl_season_${y}_${y + 1}_gamestats.csv`), 'utf8'));
    } catch {
        return new Map();
    }
}
