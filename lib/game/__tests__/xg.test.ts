import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { loadArtifacts, scoreGame } from '../xg';

/*
 * Parity with the Python xG v2 scorer (pipeline/bu/xg/live.py score_games) on
 * two 2025-26 games that between them hold every strength class (5v5, PP, SH,
 * 4v4, 3v3, extra attacker, empty net, penalty shot). Expected values were
 * written by the Python scorer from the committed artifacts; when the model is
 * retrained, regenerate them (the same check over ~450 lake games matched every
 * feature and every xG to 1e-6).
 */
const root = process.cwd();
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const art = loadArtifacts(read('pipeline/models/xg2_booster.json'), read('pipeline/models/xg2_calibrators.json'), read('pipeline/bu/xg/models/handedness.json'));
const fixtures = path.join(__dirname, 'fixtures');
const expected = JSON.parse(fs.readFileSync(path.join(fixtures, 'xg_v2_expected.json'), 'utf8')) as Record<string, Record<string, number>>;

describe('xG v2 live scorer', () => {
    for (const [game, want] of Object.entries(expected)) {
        it(`matches the Python scorer shot by shot (${game})`, () => {
            const pbp = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(fixtures, `pbp_${game}.json.gz`))).toString());
            const got = scoreGame(pbp, art);
            expect([...got.keys()].sort((a, b) => a - b)).toEqual(Object.keys(want).map(Number).sort((a, b) => a - b));
            for (const [e, xg] of Object.entries(want)) expect(Math.abs(got.get(Number(e))! - xg)).toBeLessThan(1e-6);
        });
    }

    it('gives a game in progress the same values the final game gets', () => {
        const pbp = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(fixtures, 'pbp_2025020497.json.gz'))).toString());
        const full = scoreGame(pbp, art);
        const live = scoreGame({ ...pbp, gameState: 'LIVE', plays: pbp.plays.slice(0, 150) }, art);
        expect(live.size).toBeGreaterThan(20);
        for (const [e, v] of live) expect(v).toBe(full.get(e));
    });
});
