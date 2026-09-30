import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/player_news_opening.json';
import { buildCards, classify, groupByGames, matchesFilter, type RawNewsItem } from './model';
import { etLabel } from './feed';
import { contrastRatio } from '../ui/color';

const byTeam = fixture as Record<string, RawNewsItem[]>;

describe('news cards', () => {
    const cards = buildCards(byTeam);

    it('collapses duplicate Shesterkin and Knight items into single cards with a timeline', () => {
        const shesterkin = cards.filter(c => c.player === 'Igor Shesterkin');
        const knight = cards.filter(c => c.player === 'Spencer Knight');
        expect(shesterkin).toHaveLength(1);
        expect(knight).toHaveLength(1);
        expect(shesterkin[0].updates.length).toBe(2);
        expect(knight[0].updates.length).toBe(2);
        // newest first
        expect(shesterkin[0].updates[0].at > shesterkin[0].updates[1].at).toBe(true);
    });

    it("tags 'Demidov (foot) will play' as Returning, not Injury", () => {
        const demidov = cards.find(c => c.player === 'Ivan Demidov')!;
        expect(demidov.kind).toBe('returning');
        expect(matchesFilter('returning', 'injuries')).toBe(true);
        expect(classify('Injury', 'Andersen (undisclosed) is expected to be out until December.')).toBe('injury');
        expect(classify('Injury', "L'Heureux (lower-body) will miss Colorado's season opener")).toBe('injury');
        expect(classify('Goalie Start', 'Knight will start')).toBe('goalie');
        expect(classify('Line Change', 'Teravainen is expected to be a healthy scratch')).toBe('lineup');
    });

    it('groups under tonight’s matchups, then the rest of the league', () => {
        const groups = groupByGames(cards, [
            { id: 1, away: 'FLA', home: 'CAR', startUtc: '2026-09-29T23:00:00Z' },
            { id: 2, away: 'NYR', home: 'BOS', startUtc: '2026-09-29T23:30:00Z' },
        ]);
        expect(groups[0].title).toBe('FLA @ CAR');
        expect(groups[0].cards.map(c => c.team).every(t => t === 'FLA' || t === 'CAR')).toBe(true);
        expect(groups[1].cards.some(c => c.player === 'Igor Shesterkin')).toBe(true);
        expect(groups[groups.length - 1].title).toBe('Rest of league');
        const total = groups.reduce((a, g) => a + g.cards.length, 0);
        expect(total).toBe(cards.length);
    });

    it('formats times in Eastern with a zone', () => {
        expect(etLabel('2026-09-29T23:30:20.622Z')).toBe('Sep 29, 7:30 PM ET');
    });

    it('timestamps use --text-2, ≥4.5:1 on card surfaces', () => {
        for (const bg of ['#0b0f16', '#111723']) expect(contrastRatio('#a9b4c2', bg)).toBeGreaterThanOrEqual(4.5);
    });
});
