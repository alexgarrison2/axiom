import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALL_MIN_CONF, combineBlocks, deriveExcluded, parseAccuracyReport, reportLags, tallyByType, tallySeason } from './report';
import { cumulativeUnits, gradePending, parseLedger, parseLedgerBets, reconcileLedger, teamFirstScore, tidyReason } from './ledger-data';
import { isCorrect, pickOf, pickProb, type GradedGame } from './types';
import { teamTriFromName } from './names';
import { blockVerdict, compareLogLoss, deltaText, modelLabelOf, SIGNAL_N } from './verdict';

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

    it('flags a report that lags the graded list, and only then', () => {
        const t = tallySeason(games, '2030-31');
        expect(reportLags(0, t)).toBe(true); // stale report (n=0) vs 3 graded rows → show "Through 3 games: 2-1"
        expect(reportLags(undefined, t)).toBe(true); // no report block at all
        expect(reportLags(3, t)).toBe(false); // report caught up → full report card
        expect(reportLags(0, tallySeason([], '2030-31'))).toBe(false); // 0 games → honest empty state
        expect(reportLags(0, null)).toBe(false);
    });

    it('tallies per game type so playoff rows never make the regular-season report look stale', () => {
        const po = mk(30, 60, 4, 1, { type: '03' });
        const by = tallyByType([...games, po], '2030-31');
        expect(by.all.n).toBe(4);
        expect(by.regular.n).toBe(3);
        expect(by.playoffs.n).toBe(1);
        expect(reportLags(3, by.regular)).toBe(false);
    });

    it('derives excluded finals from explicit records and from ungraded finals', () => {
        const tri = (n: string) => ({ Hurricanes: 'CAR', Panthers: 'FLA', 'Maple Leafs': 'TOR', Canadiens: 'MTL', Bruins: 'BOS', Rangers: 'NYR' })[n] ?? null;
        const history = [
            { gameId: 2030020001, date: '2030-10-01', homeTeam: 'Hurricanes', awayTeam: 'Panthers', excluded: 'snapshot_after_start' },
            { gameId: 2029020001, date: '2029-10-01', homeTeam: 'Hurricanes', awayTeam: 'Panthers', excluded: 'snapshot_after_start' }, // other season
        ];
        const csv = [
            'game_id,game_date,team,opponent,home_away',
            '2030020002,2030-10-01,Maple Leafs,Canadiens,Home',
            '2030020002,2030-10-01,Canadiens,Maple Leafs,Away',
            '2030020003,2030-10-01,Bruins,Rangers,Home', // graded → not excluded
            '2030010009,2030-09-20,Bruins,Rangers,Home', // preseason → ignored
        ].join('\n');
        const graded = [mk(2030020003, 60, 3, 0)];
        const ex = deriveExcluded(history, csv, '2030-31', graded, tri);
        expect(ex.map(e => `${e.away}@${e.home}`).sort()).toEqual(['FLA@CAR', 'MTL@TOR']);
        expect(ex.every(e => /pregame snapshot/.test(e.reason))).toBe(true);
        expect(deriveExcluded(null, '', '2030-31', graded, tri)).toEqual([]); // missing files
    });

    it('explains the gate count without calling legacy picks missing', () => {
        expect(tidyReason('Only 0 live games with odds this season; need 200 to compare with the market.')).toBe(
            'No games with odds from the current model yet this season; need 200 to compare with the market.',
        );
        expect(tidyReason('Only 1 live games with odds this season; need 200')).toBe('Only 1 game with odds from the current model this season; need 200');
        expect(tidyReason('Only 12 live games with odds this season; need 200')).toBe('Only 12 games with odds from the current model this season; need 200');
        expect(tidyReason('Only 1 live games with odds')).toBe('Only 1 live game with odds');
    });
});

describe('fix round 3: verdicts, legacy labels, small samples', () => {
    const report = parseAccuracyReport(read('public', 'data', 'model_report.json'));

    it('gives 2025-26 a terse verdict: worse than the market, better than home rate', () => {
        const v = blockVerdict(report.seasons['2025-26']!.all);
        expect(v.tooEarly).toBe(false);
        expect(v.vsMarket?.word).toBe('WORSE');
        expect(v.vsHome?.word).toBe('BETTER');
    });

    it('calls a tiny sample too early', () => {
        const b = report.seasons['2026-27']?.all;
        if (b && b.n < SIGNAL_N) expect(blockVerdict(b)).toMatchObject({ tooEarly: true, vsMarket: null, vsHome: null });
        expect(blockVerdict(null).tooEarly).toBe(true);
    });

    it('labels picks by the model that made them', () => {
        const b = report.seasons['2026-27']?.all;
        if (b && b.n > 0 && b.nLegacy === b.n) expect(modelLabelOf(b, 'Pony xG')).toBe('Prev. model');
        const base = report.seasons['2025-26']!.all!;
        const current = { n: 5, correct: 3, accuracy: 0.6, brier: 0.2, logLoss: 0.6 };
        const none = { n: 0, correct: 0, accuracy: null, brier: null, logLoss: null };
        expect(modelLabelOf({ ...base, n: 5, nLegacy: 0, byModel: { current, legacy: none } }, 'x')).toBe('Pony xG');
        expect(modelLabelOf({ ...base, n: 7, nLegacy: 2, byModel: { current, legacy: { ...current, n: 2 } } }, 'x')).toBeNull();
    });

    it('never lists a coin flip under best calls or worst misses', () => {
        for (const s of Object.values(report.seasons))
            for (const b of Object.values(s)) for (const c of [...b!.bestCalls, ...b!.worstMisses]) expect(c.confidence).toBeGreaterThanOrEqual(CALL_MIN_CONF);
        expect(report.seasons['2026-27']?.all?.bestCalls.map(c => c.gameId) ?? []).not.toContain(2026020003);
    });

    it('fills the model Brier on the market games', () => {
        expect(report.seasons['2025-26']!.all!.market.modelBrierSame).not.toBeNull();
    });

    it('reads a delta that rounds to zero as same', () => {
        expect(deltaText(0.00004, 1, ' pts', 100)).toEqual({ text: 'same', same: true });
        expect(deltaText(-0.0078, 4).text).toBe('−0.0078');
        expect(deltaText(0.333, 1, ' pts', 100).text).toBe('+33.3 pts');
        expect(compareLogLoss(0.68221, 0.68219)).toBe('SAME');
    });

    it('tags ledger bets without a model version as legacy', () => {
        const bets = parseLedgerBets(read('public', 'data', 'bet_ledger.json'));
        const vgk = bets.find(b => b.gameId === 2026020005);
        if (vgk) expect(vgk.legacy).toBe(true);
    });
});
