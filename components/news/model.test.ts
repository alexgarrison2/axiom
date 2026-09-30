import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/player_news_opening.json';
import { buildCards, classify, dropSpent, groupByGames, matchesFilter, type GameRef, type RawNewsItem } from './model';
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
        expect(etLabel('2026-09-29T23:30:20.622Z')).toBe('Sep 29, 7:30 PM EDT');
    });

    it('timestamps use --text-2, ≥4.5:1 on card surfaces', () => {
        for (const bg of ['#0b0f16', '#111723']) expect(contrastRatio('#a9b4c2', bg)).toBeGreaterThanOrEqual(4.5);
    });
});

describe('groupByGames skips stale game-specific items', () => {
    it('files a goalie note from before the previous game under the rest of the league', () => {
        const cards = buildCards({
            TOR: [
                { player: 'Sergei Bobrovsky', news: "Bobrovsky is scheduled to start Toronto's season opener vs. Montreal on Tuesday.", category: 'Goalie', timestamp: '2026-09-29T15:00:00Z' },
                { player: 'Anthony Stolarz', news: 'Stolarz is projected to start against the Islanders.', category: 'Goalie', timestamp: '2026-09-30T14:00:00Z' },
            ],
        });
        const game: GameRef = {
            id: 1,
            home: 'TOR',
            away: 'NYI',
            startUtc: '2026-09-30T23:00:00Z',
            prevEndUtc: { TOR: '2026-09-30T01:30:00Z', NYI: null },
            names: { NYI: 'Islanders', TOR: 'Maple Leafs' },
        };
        const groups = groupByGames(cards, [game]);
        const tonight = groups.find(g => g.game)!;
        expect(tonight.cards.map(c => c.player)).toEqual(['Anthony Stolarz']);
        expect(groups.find(g => !g.game)!.cards.map(c => c.player)).toContain('Sergei Bobrovsky');
    });
});

describe('dropSpent drops starter/lineup notes about games already final', () => {
    // Sep 30, 2026: the Sep 29 openers are final.
    const lastEnd = {
        VAN: '2026-09-30T04:30:00Z',
        NYR: '2026-09-30T02:30:00Z',
        TOR: '2026-09-30T01:30:00Z',
        FLA: '2026-09-29T23:30:00Z',
        MTL: '2026-09-30T01:30:00Z',
        NSH: null,
    };
    const cards = buildCards({
        VAN: [{ player: 'Kevin Lankinen', news: "Lankinen led the Canucks onto the ice for warmups; he'll start Tuesday in Edmonton.", category: 'Goalie Start', timestamp: '2026-09-30T01:29:51Z' }],
        NYR: [{ player: 'Igor Shesterkin', news: "Shesterkin led the Rangers onto the ice for warmups; he'll start Tuesday in Boston.", category: 'Goalie Start', timestamp: '2026-09-29T23:30:20Z' }],
        TOR: [
            { player: 'Sergei Bobrovsky', news: "Bobrovsky is scheduled to start Toronto's season opener vs. Montreal on Tuesday.", category: 'Goalie Start', timestamp: '2026-09-29T19:15:20Z' },
            { player: 'Nikolai Marchenko', news: "Marchenko will make his Maple Leafs' debut on Tuesday vs. Montreal.", category: 'Line Change', timestamp: '2026-09-29T19:01:54Z' },
            { player: 'Anthony Stolarz', news: 'Stolarz is projected to start against the Islanders.', category: 'Goalie Start', timestamp: '2026-09-30T14:00:00Z' },
        ],
        FLA: [{ player: 'Jacob Markstrom', news: 'Markstrom will start Tuesday in Carolina.', category: 'Goalie Start', timestamp: '2026-09-29T20:36:29Z' }],
        MTL: [{ player: 'Ivan Demidov', news: "Demidov (foot) will play in Montreal's season opener.", category: 'Injury', timestamp: '2026-09-29T22:49:38Z' }],
        NSH: [{ player: 'Tyson Jost', news: 'Tyson Jost was sent down to Milwaukee (AHL).', category: 'Send Down', timestamp: '2026-09-29T20:31:19Z' }],
    });

    it('keeps only notes still about an upcoming game, plus injury/return/roster items', () => {
        const kept = dropSpent(cards, lastEnd).map(c => c.player).sort();
        expect(kept).toEqual(['Anthony Stolarz', 'Ivan Demidov', 'Tyson Jost']);
    });

    it('keeps roster moves even after the team has played', () => {
        const kept = dropSpent(cards, { ...lastEnd, NSH: '2026-09-30T03:00:00Z' }).map(c => c.player);
        expect(kept).toContain('Tyson Jost');
    });

    it('leaves no spent opener notes anywhere in the grouped feed', () => {
        const groups = groupByGames(dropSpent(cards, lastEnd), [{ id: 8, away: 'NYI', home: 'TOR', startUtc: '2026-09-30T23:00:00Z', prevEndUtc: lastEnd }]);
        expect(groups.find(g => g.game)!.cards.map(c => c.player)).toEqual(['Anthony Stolarz']);
        const all = groups.flatMap(g => g.cards.map(c => c.player));
        expect(all.some(p => /Bobrovsky|Lankinen|Shesterkin|Markstrom|Marchenko/.test(p))).toBe(false);
    });
});
