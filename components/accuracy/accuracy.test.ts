import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { combineBlocks, parseAccuracyReport } from './report';
import { cumulativeUnits, parseLedger, parseLedgerBets, teamFirstScore } from './ledger-data';
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

    it('counts only this season’s graded live games (never last season’s), whatever the date', () => {
        const cur = report.currentSeason ? report.seasons[report.currentSeason]?.all : undefined;
        if (!cur || !report.currentSeason) return;
        const history = read('data', 'prediction_history.json') as { season?: string; retro?: boolean }[];
        const graded = history.filter(r => r.season === report.currentSeason && !r.retro).length;
        expect(cur.n).toBe(graded);
        if (cur.n === 0) expect(cur.logLoss).toBeNull();
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
