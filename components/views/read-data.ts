import 'server-only';
import fs from 'node:fs';
import path from 'node:path';

/*
 * Server-side readers for public/data files used by the secondary views.
 * Every path is a literal: path.join(process.cwd(), 'public', 'data', name)
 * with a variable name makes Turbopack trace all of public/data (~12MB) into
 * each function.
 */
const READERS = {
    'player_bio.json': () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'player_bio.json'), 'utf8'),
    'manifest.json': () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'manifest.json'), 'utf8'),
    'player_news.json': () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'player_news.json'), 'utf8'),
    'upcoming_games.json': () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'upcoming_games.json'), 'utf8'),
    'season_projections.json': () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'season_projections.json'), 'utf8'),
    'season_projections_history.json': () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'season_projections_history.json'), 'utf8'),
    'team_ratings.json': () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'team_ratings.json'), 'utf8'),
    'props.json': () => fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'props.json'), 'utf8'),
} as const;

export type PublicDataFile = keyof typeof READERS;

/** Parsed JSON from public/data, or null when missing or invalid. */
export function readPublicJson(name: PublicDataFile): unknown {
    try {
        return JSON.parse(READERS[name]());
    } catch {
        return null;
    }
}
