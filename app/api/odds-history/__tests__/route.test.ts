import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { OddsEntry } from '../route';

/*
 * /api/odds-history over a SiteHistory fixture shaped like 2026-09-30.csv after
 * the snapshot writer added the total columns: two runs from before the upgrade
 * (blank totals), then points with a total of 6.0 and a move to 5.5.
 */
const HEADER =
    'date,gameid,timestamp,run,awayteam,away_starter,away_xG,away_win%,away_xGOdds,away_Odds,away_EV,away_bet,hometeam,home_starter,home_xG,home_win%,home_xGOdds,home_Odds,home_EV,home_bet,timestamp_utc,model_version,home_model%,home_market%,nhl_game_id,total_line,total_over,total_under';

function row(run: number, stamp: string, away: string, home: string, total: [string, string, string] | null, gid = '2026020008') {
    const [line, over, under] = total ?? ['', '', ''];
    const key = gid === '2026020008' ? '2026-09-30-Islanders-Maple Leafs' : '2026-09-30-Kings-Avalanche';
    const [a, h] = gid === '2026020008' ? ['Islanders', 'Maple Leafs'] : ['Kings', 'Avalanche'];
    return `9/30/26,${key},00:00,${run},${a},,3.0,48.6%,+106,${away},,,${h},,3.1,51.4%,-106,${home},,,${stamp},logit-elo-test,38.9%,54.5%,${gid},${line},${over},${under}`;
}

const CSV = [
    HEADER,
    row(1, '2026-09-30T12:42:49Z', '+110', '-130', null),
    row(2, '2026-09-30T14:39:17Z', '+112', '-133', null),
    row(3, '2026-09-30T20:00:00Z', '+112', '-133', ['6', '-110', '-110']), // moneyline flat, total appears
    row(4, '2026-09-30T21:00:00Z', '+115', '-136', ['5.5', '-135', '+115']), // total comes down
    row(3, '2026-09-30T20:00:00Z', '+170', '-205', null, '2026020007'), // another game, no totals at all
    row(4, '2026-09-30T21:00:00Z', '+168', '-202', null, '2026020007'),
].join('\n');

let tmp: string;
let GET: typeof import('../route').GET;

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'odds-history-'));
    fs.mkdirSync(path.join(tmp, 'public', 'data', 'SiteHistory'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'public', 'data', 'SiteHistory', '2026-09-30.csv'), CSV);
    // The route resolves SiteHistory from process.cwd() when the module loads.
    vi.spyOn(process, 'cwd').mockReturnValue(tmp);
    vi.resetModules();
    ({ GET } = await import('../route'));
});

afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

async function entries(gameId: string): Promise<OddsEntry[]> {
    const res = await GET(new NextRequest(`http://localhost/api/odds-history?gameId=${gameId}&date=2026-09-30`));
    expect(res.status).toBe(200);
    return (await res.json()).entries;
}

describe('odds-history game totals (fix3-G5)', () => {
    it('returns the total for points captured after the upgrade and null before it', async () => {
        const e = await entries('2026020008');
        expect(e.map(x => x.timestamp)).toEqual(['2026-09-30T12:42:49Z', '2026-09-30T14:39:17Z', '2026-09-30T20:00:00Z', '2026-09-30T21:00:00Z']);
        expect(e.map(x => x.total?.line ?? null)).toEqual([null, null, '6.0', '5.5']);
        expect(e[2].total).toEqual({ line: '6.0', over: '-110', under: '-110' });
        expect(e[3].total).toEqual({ line: '5.5', over: '-135', under: '+115' });
    });

    it('keeps a point where only the total changed and marks the direction of the line', async () => {
        const e = await entries('2026020008');
        // Run 3 has the same moneyline as run 2 but is kept, because the total appeared.
        expect(e[2].awayOdds).toBe(e[1].awayOdds);
        expect(e.map(x => x.totalDir)).toEqual([null, null, null, 'down']);
        expect(e[0].isOpen).toBe(true);
        expect(e[3].isLatest).toBe(true);
    });

    it('marks an upward total move as up', async () => {
        const up = CSV.replace(",5.5,-135,+115", ",6.5,+105,-125");
        fs.writeFileSync(path.join(tmp, 'public', 'data', 'SiteHistory', '2026-09-30.csv'), up);
        try {
            const e = await entries('2026020008');
            expect(e[3].total?.line).toBe('6.5');
            expect(e[3].totalDir).toBe('up');
        } finally {
            fs.writeFileSync(path.join(tmp, 'public', 'data', 'SiteHistory', '2026-09-30.csv'), CSV);
        }
    });

    it('returns null totals for a game that never had one', async () => {
        const e = await entries('2026020007');
        expect(e).toHaveLength(2);
        expect(e.every(x => x.total === null && x.totalDir === null)).toBe(true);
    });
});
