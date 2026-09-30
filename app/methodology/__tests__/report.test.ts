import { describe, expect, it } from 'vitest';
import { normSeason, parseReport } from '../report';

describe('model_report.json reader', () => {
    it('normalises season ids', () => {
        expect(normSeason('20252026')).toBe('2025-26');
        expect(normSeason('2025-26')).toBe('2025-26');
        expect(normSeason('2025-2026')).toBe('2025-26');
        expect(normSeason(2025)).toBe('2025-26');
        expect(normSeason('regular')).toBeUndefined();
    });

    it('reads a season → game-type → metrics shape with baselines', () => {
        const { seasons, model } = parseReport({
            generated_at: '2026-09-30T12:00:00Z',
            model: { name: 'logit+elo', training_seasons: ['20222023', '20232024'] },
            gate: { open: false, reason: 'Model has not beaten the market.' },
            seasons: {
                '2025-26': {
                    regular: {
                        n: 410,
                        accuracy: { value: 0.546, ci: [0.5, 0.59] },
                        brier: 0.2447,
                        log_loss: 0.6823,
                        baselines: { market: { brier: 0.2408, log_loss: 0.6742 }, home_rate: { brier: 0.2499, log_loss: 0.6929 } },
                    },
                },
                '2026-27': { regular: { n: 0 } },
            },
        });
        expect(model.trainingSeasons).toEqual(['2022-23', '2023-24']);
        expect(model.gate?.open).toBe(false);
        expect(seasons).toHaveLength(1);
        const s = seasons[0];
        expect(s.season).toBe('2025-26');
        expect(s.rows[0]).toMatchObject({ isModel: true, n: 410, accuracy: 0.546, logLoss: 0.6823 });
        expect(s.rows.find(r => r.label.startsWith('Betting market'))?.logLoss).toBe(0.6742);
    });

    it('reads a flat list of season blocks', () => {
        const { seasons } = parseReport({
            seasons: [
                { season: '20252026', game_type: 'regular', n: 1200, brier: 0.245, logloss: 0.683 },
                { season: '20252026', game_type: 'playoffs', n: 80, brier: 0.25, logloss: 0.69 },
            ],
        });
        expect(seasons).toHaveLength(1);
        expect(seasons[0].rows[0].logLoss).toBe(0.683);
    });

    it('survives missing or junk input', () => {
        expect(parseReport(null).seasons).toEqual([]);
        expect(parseReport({ foo: 1 }).seasons).toEqual([]);
    });
});

describe('model_report.json v1 (pipeline/model_report.py)', () => {
    const v1 = {
        schema_version: 1,
        generated_at: '2026-09-30T01:27:08+00:00',
        current_season: '2026-27',
        notes: 'Headline numbers use live pregame snapshots only.',
        seasons: {
            '2025-26': {
                all: { n: 421, accuracy: 0.5463, brier: 0.2447, log_loss: 0.6822, baselines: {} },
                regular: {
                    n: 339,
                    accuracy: 0.5398,
                    brier: 0.2451,
                    log_loss: 0.6831,
                    baselines: {
                        home_rate: { n: 339, log_loss: 0.695, brier: 0.2509, accuracy: 0.5103 },
                        market: { n: 328, log_loss: 0.6763, brier: 0.2418, accuracy: 0.5488 },
                    },
                },
            },
            '2026-27': { all: { n: 0, accuracy: null, brier: null, log_loss: null }, regular: { n: 0, accuracy: null, brier: null, log_loss: null } },
        },
        gate: { open: false, status: 'closed', summary: 'Bet sizes are hidden.', reasons: ['Only 0 live games with odds this season.'] },
        model: {
            version: 'logit-elo-v5',
            type: 'logistic_regression_l2',
            trained_at: '2026-09-30T01:18:21+00:00',
            walk_forward: [
                { test_season: 2024, n: 1206, log_loss: 0.6654, brier: 0.2366, accuracy: 0.5813, home_rate_log_loss: 0.6867, legacy_xgb_log_loss: 0.6703 },
                { test_season: 2025, n: 1394, log_loss: 0.6793, brier: 0.2433, accuracy: 0.5402, home_rate_log_loss: 0.6935, legacy_xgb_log_loss: 0.6849 },
            ],
            early_season_log_loss: 0.6798,
        },
    };

    it('reads the regular-season block with market and home-rate baselines, skipping empty seasons', () => {
        const { seasons } = parseReport(v1);
        expect(seasons.map(s => s.season)).toEqual(['2025-26']);
        const s = seasons[0];
        expect(s.gameType).toBe('regular');
        expect(s.rows[0]).toMatchObject({ isModel: true, n: 339, logLoss: 0.6831 });
        expect(s.rows.find(r => r.label.startsWith('Betting market'))).toMatchObject({ n: 328, logLoss: 0.6763 });
        expect(s.rows.find(r => r.label.startsWith('Always home'))?.brier).toBe(0.2509);
    });

    it('reads model version, gate summary/reasons and walk-forward seasons', () => {
        const { model } = parseReport(v1);
        expect(model.name).toBe('logit-elo-v5');
        expect(model.description).toBe('logistic regression l2');
        expect(model.gate).toMatchObject({ open: false, reason: 'Bet sizes are hidden.', reasons: ['Only 0 live games with odds this season.'] });
        expect(model.walkForward?.map(w => w.season)).toEqual(['2024-25', '2025-26']);
        expect(model.walkForward?.[1]).toMatchObject({ logLoss: 0.6793, legacyLogLoss: 0.6849, homeRateLogLoss: 0.6935 });
        expect(model.earlySeasonLogLoss).toBe(0.6798);
        expect(model.notes).toMatch(/live pregame/);
    });
});
