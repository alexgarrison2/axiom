import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { loadArtifacts, publishedXg, scoreGame, shotFeatures } from '../xg';

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
// player_id per event from the pipeline's 2025-26 season shot file: the key of the shooting-talent map.
const shooters = JSON.parse(fs.readFileSync(path.join(fixtures, 'xg_shooters.json'), 'utf8')) as Record<string, Record<string, number>>;
const pbpOf = (game: string) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(fixtures, `pbp_${game}.json.gz`))).toString());

describe('xG v2 live scorer', () => {
    for (const [game, want] of Object.entries(expected)) {
        it(`matches the Python scorer shot by shot (${game})`, () => {
            const pbp = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(fixtures, `pbp_${game}.json.gz`))).toString());
            const got = scoreGame(pbp, art);
            expect([...got.keys()].sort((a, b) => a - b)).toEqual(Object.keys(want).map(Number).sort((a, b) => a - b));
            for (const [e, xg] of Object.entries(want)) expect(Math.abs(got.get(Number(e))! - xg)).toBeLessThan(1e-6);
        });
    }

    for (const [game, want] of Object.entries(shooters)) {
        it(`credits each shot to the pipeline's shooter (${game})`, () => {
            const got = new Map(shotFeatures(pbpOf(game), art).map(r => [r.eventId, r.shooterId]));
            for (const [e, pid] of Object.entries(want)) expect(got.get(Number(e))).toBe(pid);
        });
    }

    it('publishes xG like the nightly run: round4(round4(raw) x talent x league factor)', () => {
        const game = '2025020477';
        const pbp = pbpOf(game);
        const [hot, cold] = [...new Set(Object.values(shooters[game]))];
        const talent = new Map([[hot, 1.2345], [cold, 0.8123]]);
        const pub = publishedXg(pbp, art, talent, 1.0043);
        const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
        for (const [e, raw] of scoreGame(pbp, art)) {
            const mult = talent.get(shooters[game][String(e)]) ?? 1;
            expect(pub.get(e)).toBe(r4(r4(raw) * mult * 1.0043));
        }
        expect(pub.size).toBe(Object.keys(shooters[game]).length);
    });

    it('gives a game in progress the same values the final game gets', () => {
        const pbp = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(fixtures, 'pbp_2025020497.json.gz'))).toString());
        const full = scoreGame(pbp, art);
        const live = scoreGame({ ...pbp, gameState: 'LIVE', plays: pbp.plays.slice(0, 150) }, art);
        expect(live.size).toBeGreaterThan(20);
        for (const [e, v] of live) expect(v).toBe(full.get(e));
    });
});
