import fs from 'node:fs';
import path from 'node:path';
import { parseMilestones, type MilestonesDoc } from './milestones';

/* Server-only (node:fs). Read by a literal path so Turbopack traces one file. */
export function readMilestones(): MilestonesDoc | null {
    try {
        return parseMilestones(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'milestones.json'), 'utf8')));
    } catch {
        return null;
    }
}
