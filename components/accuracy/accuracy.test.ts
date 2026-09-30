import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { combineBlocks, parseAccuracyReport, tallySeason } from './report';
import { cumulativeUnits, gradePending, parseLedger, parseLedgerBets, reconcileLedger, teamFirstScore, tidyReason } from './ledger-data';
import { isCorrect, pickOf, pickProb, type GradedGame } from './types';
import { teamTriFromName } from './names';

const read = (...p: string[]) => JSON.parse(fs.readFileSync(path.join(process.cwd(), ...p), 'utf8'));

describe('model_report.json → report card', () => {
    const report = parseAccuracyReport(read('public', 'data', 'model_report.json'));

    it('shows live-only numbers with market and home-rate baselines for 2025-26', () => {
        const b = report.seasons['2025-26']?.all;
        expect(b).toBeTruthy();
        expect(b!.n).toBeGreaterThan(0);
        expect(b!.nRetro).toBeGreaterThan(0); // back-filled rows are counted, not mixed in
        expect(b!.market.logLoss).not.toBeNull();
        expect(b!.market.logLoss!).toBeGreaterThan(0.66);
        expect(b!.market.logLoss!).toBeLessThan(0.69);
        expect(b!.homeRate.logLoss).not.toBeNull();
        expect(b!.reliability).toHaveLength(10);
    });


    it('combines seasons n-weighted', () => {
        const a = report.seasons['2025-26']!.all!;
        const both = combineBlocks([a, { ...a }])!;
        expect(both.n).toBe(a.n * 2);
        expect(both.accuracy).toBeCloseTo(a.correct / a.n, 6);
        expect(both.logLoss).toBeCloseTo(a.logLoss!, 6);
    });

    it('reads the gate with reasons', () => {
        expect(report.gate).toBeTruthy();
        if (report.gate && !report.gate.open) expect(report.gate.reasons.length).toBeGreaterThan(0);
    });
});

describe('bet_ledger.json', () => {
    const raw = read('public', 'data', 'bet_ledger.json');
    const ledger = parseLedger(raw);
    const bets = parseLedgerBets(raw);

    it('keeps the summary totals exactly as published', () => {
        const s = ledger.seasons['2025-26'];
        expect(s.record).toBe(raw.seasons['2025-26'].summary.record);
        expect(s.unitsProfit).toBe(raw.seasons['2025-26'].summary.units_profit);
        expect(s.nGraded).toBeGreaterThanOrEqual(250);
    });

    it('cumulative units end at the summary profit', () => {
        const season = bets.filter(b => b.season === '2025-26');
        const curve = cumulativeUnits(season);
        expect(curve[curve.length - 1].units).toBeCloseTo(ledger.seasons['2025-26'].unitsProfit, 2);
    });

    it('shows scores from the bet side', () => {
        expect(teamFirstScore('3-0', 'home')).toBe('0-3');
        expect(teamFirstScore('2-4', 'away')).toBe('2-4');
    });
});

describe('graded game helpers', () => {
    const g: GradedGame = {
        id: 1, date: '2026-10-01', season: '2026-27', type: '02', home: 'EDM', away: 'CGY', homeScore: 2, awayScore: 3, decision: 'OT',
        homeProb: 61, marketProb: 58, homeXg: 3.1, awayXg: 2.6, brier: 0.37, logLoss: 0.94, retro: false, snapshotUtc: null,
    };
    it('grades picks', () => {
        expect(pickOf(g)).toBe('EDM');
        expect(pickProb(g)).toBe(61);
        expect(isCorrect(g)).toBe(false);
    });
    it('maps names to tricodes and drops non-NHL teams', () => {
        expect(teamTriFromName('Golden Knights')).toBe('VGK');
        expect(teamTriFromName('Utah Hockey Club')).toBe('UTA');
        expect(teamTriFromName('Switzerland')).toBeNull();
    });
});

describe('stale report vs graded list', () => {
    const mk = (id: number, homeProb: number, hs: number, as: number, extra: Partial<GradedGame> = {}): GradedGame => ({
        id, date: '2030-10-01', season: '2030-31', type: '02', home: 'BOS', away: 'NYR', homeScore: hs, awayScore: as, decision: 'REG',
        homeProb, marketProb: 55, homeXg: null, awayXg: null, brier: 0.2, logLoss: 0.6, retro: false, snapshotUtc: null, legacy: true, ...extra,
    });
    const games = [mk(3, 50.3, 3, 0, { marketProb: null, placeholderOdds: true }), mk(4, 71.9, 5, 6), mk(5, 75.1, 5, 2)];
    const excluded = [{ id: 1, date: '2030-10-01', home: 'CAR', away: 'FLA', reason: 'No pregame snapshot before puck drop' }];

    it('tallies the record straight from graded rows, so a report with n=0 can be overridden', () => {
        const t = tallySeason(games, '2030-31', excluded);
        const staleReportN = 0;
        expect(t.n).toBeGreaterThan(staleReportN);
        expect(`${t.correct}-${t.n - t.correct}`).toBe('2-1');
        expect(t.excluded).toHaveLength(1);
        expect(t.legacyN).toBe(3);
    });

    it('keeps placeholder −110/−110 lines out of the market baseline', () => {
        const t = tallySeason(games, '2030-31');
        expect(t.placeholderN).toBe(1);
        expect(t.marketN).toBe(2);
    });

    it('ignores back-filled rows and other seasons', () => {
        const t = tallySeason([...games, mk(9, 60, 1, 0, { retro: true }), mk(10, 60, 1, 0, { season: '2029-30' })], '2030-31');
        expect(t.n).toBe(3);
    });

    it('grades a pending ledger bet against the final and updates the summary', () => {
        const raw = {
            seasons: {
                '2030-31': {
                    summary: { n_bets: 1, n_graded: 0, n_pending: 1, record: '0-0', units_staked: 0, units_profit: 0, roi: null, by_ev_bucket: [], by_stake: [] },
                    bets: [{ gameId: 5, season: '2030-31', date: '2030-10-01', team: 'Golden Knights', opponent: 'Blackhawks', side: 'home', stake_units: 0.4, price: -275, result: 'pending', profit_units: 0 }],
                },
            },
        };
        const finals = { 5: { homeScore: 5, awayScore: 2, decision: 'REG' } };
        const bet = gradePending(parseLedgerBets(raw)[0], finals[5]);
        expect(bet.result).toBe('win');
        expect(bet.profit).toBeCloseTo(0.4 * (100 / 275), 3);
        expect(bet.final).toBe('2-5'); // away-home, like the ledger file
        const led = reconcileLedger(parseLedger(raw), raw, finals);
        expect(led.seasons['2030-31'].record).toBe('1-0');
        expect(led.seasons['2030-31'].nPending).toBe(0);
    });

    it('pluralises the gate copy', () => {
        expect(tidyReason('Only 0 live games with odds this season (need 200)')).toBe('No live games with odds this season (need 200)');
        expect(tidyReason('Only 1 live games with odds')).toBe('Only 1 live game with odds');
    });
});
