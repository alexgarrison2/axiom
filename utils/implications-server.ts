/**
 * utils/implications-server.ts
 * ----------------------------
 * Server-only loader for game_implications.json.
 * Import this ONLY from Next.js Server Components (app/page.tsx, etc.).
 * Never import from client components.
 */

import fs   from 'fs';
import path from 'path';
import type { GameImplicationsData } from './implications';

export type { GameImplicationsData, GameImplication, ScenarioResult } from './implications';

/**
 * Reads public/data/game_implications.json from the filesystem.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export async function getGameImplications(): Promise<GameImplicationsData | null> {
    try {
        const filePath = path.join(process.cwd(), 'public', 'data', 'game_implications.json');
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as GameImplicationsData;
    } catch {
        return null;
    }
}
