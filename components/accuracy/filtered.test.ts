import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseGradedGames } from './data';
import { inRange, matches, NO_FILTER, ofType, playedIndex } from './filters';
import { parseLedger, parseLedgerBets, summarizeBets } from './ledger-data';
import { blockFromGames, parseAccuracyReport } from './report';
import type { GradedGame } from './types';

vi.mock('server-only', () => ({}));

/*
 * Under a filter the page recomputes the report card and the ledger summaries in the browser.
 * With no filter those recomputations must land on the pipeline's own numbers, so a filtered
 * view is the same arithmetic on fewer games.
 */
const read = (...p: string[]) => JSON.parse(fs.readFileSync(path.join(process.cwd(), ...p), 'utf8'));

const game = (o: Partial<GradedGame>): GradedGame => ({
    id: 1,
    date: '2026-10-01',
    season: '2026-27',
    type: '02',
    home: 'EDM',
    away: 'VAN',
    homeScore: 3,
    awayScore: 2,
    decision: 'REG',
    homeProb: 60,
    marketProb: 55,
    homeXg: 3.1,
    awayXg: 2.4,
    brier: 0.16,
    logLoss: 0.51,
    retro: false,
    snapshotUtc: null,
    ...o,
});

describe('blockFromGames', () => {
    it('grades picks, coin flips, the market and the home rate on the given games only', () => {
        const b = blockFromGames(
            [
                game({ id: 1 }),
                game({ id: 2, date: '2026-10-02', homeProb: 70, homeScore: 1, awayScore: 4, marketProb: null }),
                game({ id: 3, date: '2026-10-03', homeProb: 50.4 }),
                game({ id: 4, date: '2026-10-04', retro: true }),
            ],
            () => 0.5,
        );
        expect([b.n, b.nPicks, b.nNoLean, b.correct, b.nRetro]).toEqual([3, 2, 1, 1, 1]);
        expect(b.accuracy).toBe(0.5);
        // Every game, the coin flip as half a pick: (1 + 0 + 0.5) / 3.
        expect(b.accuracyAll).toBeCloseTo(0.5);
        expect(b.logLoss).toBeCloseTo((-Math.log(0.6) - Math.log(0.3) - Math.log(0.504)) / 3);
        expect([b.firstDate, b.lastDate]).toEqual(['2026-10-01', '2026-10-03']);
        // Two priced games, the model scored on those same two.
        expect(b.market.n).toBe(2);
        expect(b.market.logLoss).toBeCloseTo(-Math.log(0.55));
        expect(b.market.modelLogLossSame).toBeCloseTo((-Math.log(0.6) - Math.log(0.504)) / 2);
        expect(b.homeRate.logLoss).toBeCloseTo(Math.LN2);
        expect(b.tiers.map(t => [t.tier, t.n, t.correct])).toEqual([
            ['50-55', 0, 0],
            ['55-60', 0, 0],
            ['60-65', 1, 1],
            ['65+', 1, 0],
        ]);
        expect(b.reliability.map(r => r.n)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 0, 0]);
        expect(b.bestCalls.map(c => c.gameId)).toEqual([1]);
        expect(b.worstMisses.map(c => [c.gameId, c.pick, c.confidence])).toEqual([[2, 'EDM', 70]]);
    });

    it('with no filter lands on the published report for the current season', () => {
        const report = parseAccuracyReport(read('public', 'data', 'model_report.json'));
        const season = report.currentSeason;
        const block = season ? report.seasons[season]?.all : null;
        if (!season || !block) return;
        const games = parseGradedGames(read('data', 'prediction_history.json')).filter(g => g.season === season);
        const mine = blockFromGames(games, () => block.homeRate.rate);
        // The nightly report may lag the graded list by a refresh; when it has caught up, it agrees.
        if (block.n !== mine.n) return;
        expect([mine.nPicks, mine.nNoLean, mine.correct, mine.nLegacy]).toEqual([block.nPicks, block.nNoLean, block.correct, block.nLegacy]);
        for (const k of ['accuracy', 'accuracyAll', 'brier', 'logLoss'] as const) expect(mine[k], k).toBeCloseTo(block[k] as number, 3);
        expect(mine.homeRate.logLoss).toBeCloseTo(block.homeRate.logLoss as number, 3);
        expect(mine.homeRate.accuracy).toBeCloseTo(block.homeRate.accuracy as number, 3);
        expect(mine.tiers.map(t => [t.tier, t.n, t.correct])).toEqual(block.tiers.map(t => [t.tier, t.n, t.correct]));
        expect(mine.reliability.map(r => r.n)).toEqual(block.reliability.map(r => r.n));
        expect(mine.bestCalls.map(c => c.confidence)).toEqual(block.bestCalls.map(c => c.confidence));
        expect(mine.worstMisses.map(c => c.confidence)).toEqual(block.worstMisses.map(c => c.confidence));
        expect(mine.byModel?.current.n).toBe(block.byModel?.current.n);
    });

    it('a team filter is the same card on the games of that team', () => {
        const games = [game({ id: 1 }), game({ id: 2, home: 'BOS', away: 'TOR', date: '2026-10-02' }), game({ id: 3, home: 'VAN', away: 'CGY', date: '2026-10-09' })];
        const played = playedIndex(games);
        const span = games.filter(g => ofType(g, 'regular') && inRange(g, ['2026-10-01', '2026-10-05']) && matches(g, { ...NO_FILTER, who: 'VAN' }, played));
        expect(span.map(g => g.id)).toEqual([1]);
        expect(blockFromGames(span).n).toBe(1);
    });
});

describe('summarizeBets', () => {
    it.each(['suggested_ledger.json', 'pick_ledger.json'])('with no filter lands on the season summaries in %s', file => {
        const raw = read('public', 'data', file);
        const published = parseLedger(raw).seasons;
        const bets = parseLedgerBets(raw);
        for (const [season, want] of Object.entries(published)) {
            const got = summarizeBets(bets.filter(b => b.season === season));
            expect([got.nBets, got.nGraded, got.nPending, got.record, got.clvN], season).toEqual([want.nBets, want.nGraded, want.nPending, want.record, want.clvN]);
            expect(got.unitsStaked).toBeCloseTo(want.unitsStaked, 1);
            expect(got.unitsProfit).toBeCloseTo(want.unitsProfit, 1);
            if (want.roi != null) expect(got.roi).toBeCloseTo(want.roi, 3);
            if (want.clvMean != null) expect(got.clvMean).toBeCloseTo(want.clvMean, 3);
            for (const k of ['byEv', 'byStake'] as const) {
                expect(got[k].filter(b => b.n).map(b => [b.bucket, b.n, b.record]), `${season} ${k}`).toEqual(want[k].filter(b => b.n).map(b => [b.bucket, b.n, b.record]));
            }
        }
    });

    it('sums only the bets it is given and leaves the ROI interval to the pipeline', () => {
        const bet = (o: Partial<ReturnType<typeof parseLedgerBets>[number]>) => ({ ...parseLedgerBets({ seasons: { '2026-27': { bets: [{ gameId: 1 }] } } })[0], ...o });
        const s = summarizeBets([
            bet({ result: 'win', stake: 1, profit: 0.9, evBucket: '0-5%', stakeBucket: '0.6-1u', clv: 0.02 }),
            bet({ result: 'loss', stake: 2, profit: -2, evBucket: '5-10%', stakeBucket: '1.1-2u' }),
            bet({ result: 'pending', stake: 1 }),
        ]);
        expect([s.nBets, s.nGraded, s.nPending, s.record]).toEqual([3, 2, 1, '1-1']);
        expect(s.unitsStaked).toBe(3);
        expect(s.roi).toBeCloseTo(-1.1 / 3);
        expect(s.roiCi).toBeNull();
        expect([s.clvMean, s.clvN]).toEqual([0.02, 1]);
        expect(s.byEv.filter(b => b.n).map(b => [b.bucket, b.record])).toEqual([
            ['0-5%', '1-0'],
            ['5-10%', '0-1'],
        ]);
    });
});
