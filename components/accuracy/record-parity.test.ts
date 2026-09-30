import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildArchive, slateRecord, type HistoryRow } from '@/lib/matchup/archive';
import { parseGradedGames } from './data';
import { parseAccuracyReport, tallySeason } from './report';
import { isCorrect, isNoLean, isWrong } from './types';

vi.mock('server-only', () => ({}));

/**
 * One no-lean rule everywhere (lib/matchup/format.ts isCoinFlip): the slate's
 * "PICKS 1-1" chip, the /accuracy record built from the same history rows and
 * model_report.json must agree for any date.
 */
function tallies(history: HistoryRow[], date: string) {
    const slate = slateRecord(buildArchive(date, null, history).games);
    const games = parseGradedGames(history).filter(g => g.date === date);
    const season = games[0]?.season ?? '';
    const t = tallySeason(games, season);
    return { slate: `${slate.right}-${slate.graded - slate.right}`, accuracy: `${t.correct}-${t.picks - t.correct}`, t, games };
}

const OPENING_NIGHT: HistoryRow[] = [
    // NYR@BOS: BOS 50.3 and BOS won: a coin flip, not a right pick.
    { gameId: 2026020003, date: '2026-09-29', homeTeam: 'Bruins', awayTeam: 'Rangers', homeScore: 3, awayScore: 0, decision: 'REG', homeWinProb: 50.3, isCorrect: true, retro: false },
    { gameId: 2026020004, date: '2026-09-29', homeTeam: 'Oilers', awayTeam: 'Canucks', homeScore: 5, awayScore: 6, decision: 'OT', homeWinProb: 71.9, isCorrect: false, retro: false },
    { gameId: 2026020005, date: '2026-09-29', homeTeam: 'Golden Knights', awayTeam: 'Blackhawks', homeScore: 5, awayScore: 2, decision: 'REG', homeWinProb: 75.1, isCorrect: true, retro: false },
].map(r => ({ ...r, season: '2026-27', gameType: '02', brierScore: 0.2, logLoss: 0.6 }) as HistoryRow);

describe('slate chip and /accuracy share one no-lean rule', () => {
    it('opening night reads 1-1 on both, with NYR@BOS as no lean', () => {
        const { slate, accuracy, t, games } = tallies(OPENING_NIGHT, '2026-09-29');
        expect(slate).toBe('1-1');
        expect(accuracy).toBe(slate);
        expect(t.n).toBe(3); // Brier and log loss still grade all three
        const bos = games.find(g => g.id === 2026020003)!;
        expect(isNoLean(bos)).toBe(true);
        expect(isCorrect(bos)).toBe(false);
        expect(isWrong(bos)).toBe(false);
    });

    it('agrees on a coin flip either side of 50 and on the band edge', () => {
        const rows: HistoryRow[] = [
            { gameId: 2030020001, date: '2030-10-02', homeTeam: 'Bruins', awayTeam: 'Rangers', homeScore: 1, awayScore: 2, homeWinProb: 49.2, isCorrect: true },
            { gameId: 2030020002, date: '2030-10-02', homeTeam: 'Oilers', awayTeam: 'Canucks', homeScore: 4, awayScore: 2, homeWinProb: 51, isCorrect: true },
            { gameId: 2030020003, date: '2030-10-02', homeTeam: 'Flames', awayTeam: 'Jets', homeScore: 1, awayScore: 3, homeWinProb: 49, isCorrect: true },
            { gameId: 2030020004, date: '2030-10-02', homeTeam: 'Kings', awayTeam: 'Sharks', homeScore: 1, awayScore: 3, homeWinProb: 60, isCorrect: false },
        ].map(r => ({ ...r, season: '2030-31', gameType: '02', decision: 'REG', retro: false, brierScore: 0.2, logLoss: 0.6 }) as HistoryRow);
        const { slate, accuracy } = tallies(rows, '2030-10-02');
        expect(slate).toBe('2-1');
        expect(accuracy).toBe(slate);
    });

    it('matches the live history file and the published report for every current-season date', () => {
        const history = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'prediction_history.json'), 'utf8')) as HistoryRow[];
        const report = parseAccuracyReport(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'model_report.json'), 'utf8')));
        const season = report.currentSeason;
        if (!season) return;
        const live = history.filter(h => (h as { season?: string }).season === season && !h.retro && h.homeScore != null);
        const dates = [...new Set(live.map(h => h.date!))];
        let right = 0;
        let picks = 0;
        for (const d of dates) {
            const { slate, accuracy, t } = tallies(live, d);
            expect(accuracy, d).toBe(slate);
            right += t.correct;
            picks += t.picks;
        }
        const block = report.seasons[season]?.all;
        // The nightly report may lag the graded list by a refresh; when it has caught up, it agrees.
        if (block && block.n === live.length) {
            expect(block.correct).toBe(right);
            expect(block.nPicks).toBe(picks);
        }
        if (dates.includes('2026-09-29') && block?.n === 3) expect(block.accuracy).toBe(0.5);
    });
});
