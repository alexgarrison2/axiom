import { describe, expect, it } from 'vitest';
import { awardYear, GENERIC_ART, groupAwards, seasonYears, seasonsText, trophyFor } from './awards';

describe('trophyFor', () => {
    it('maps every award name current players carry to its artwork', () => {
        // Names exactly as api-web.nhle.com/v1/player/{id}/landing spells them.
        const cases: [string, string][] = [
            ['Stanley Cup', 'stanley-cup'],
            ['Hart Memorial Trophy', 'hart'],
            ['Ted Lindsay Award', 'ted-lindsay'],
            ['Lester B. Pearson Award', 'ted-lindsay'],
            ['Conn Smythe Trophy', 'conn-smythe'],
            ['Art Ross Trophy', 'art-ross'],
            ['Maurice “Rocket” Richard Trophy', 'rocket-richard'],
            ['Maurice "Rocket" Richard Trophy', 'rocket-richard'],
            ['Vezina Trophy', 'vezina'],
            ['James Norris Memorial Trophy', 'norris'],
            ['Calder Memorial Trophy', 'calder'],
            ['Frank J. Selke Trophy', 'selke'],
            ['William M. Jennings Trophy', 'jennings'],
            ['Lady Byng Memorial Trophy', 'lady-byng'],
            ['Mark Messier NHL Leadership Award', 'messier'],
            ['King Clancy Memorial Trophy', 'king-clancy'],
            ['Bill Masterton Memorial Trophy', 'masterton'],
        ];
        for (const [name, art] of cases) expect(trophyFor(name).art, name).toBe(art);
    });

    it('falls back to the generic trophy with a trimmed label', () => {
        expect(trophyFor('E.J. McGuire Award of Excellence')).toMatchObject({ art: GENERIC_ART, label: 'E.J. McGuire' });
        expect(trophyFor('NHL Foundation Player Award')).toMatchObject({ art: GENERIC_ART, label: 'Foundation Player' });
        // The AHL's Calder Cup is not the Calder Trophy.
        expect(trophyFor('Calder Cup').art).toBe(GENERIC_ART);
    });

    it('gives short labels', () => {
        expect(trophyFor('Maurice “Rocket” Richard Trophy').label).toBe('Rocket Richard');
        expect(trophyFor('James Norris Memorial Trophy').label).toBe('Norris');
    });
});

describe('groupAwards', () => {
    it('orders by prestige and sorts each trophy’s seasons oldest first', () => {
        const g = groupAwards([
            { name: 'Lady Byng Memorial Trophy', seasons: [20192020] },
            { name: 'Ted Lindsay Award', seasons: [20232024] },
            { name: 'Art Ross Trophy', seasons: [20252026, 20162017, 20212022] },
            { name: 'Calder Memorial Trophy', seasons: [20132014] },
            { name: 'Stanley Cup', seasons: [20212022] },
            { name: 'Hart Memorial Trophy', seasons: [20232024] },
            { name: 'Conn Smythe Trophy', seasons: [20232024] },
        ]);
        expect(g.map(a => a.art)).toEqual(['stanley-cup', 'hart', 'ted-lindsay', 'conn-smythe', 'art-ross', 'calder', 'lady-byng']);
        expect(g.find(a => a.art === 'art-ross')?.seasons).toEqual([20162017, 20212022, 20252026]);
    });

    it('folds the same trophy under two names together and drops repeated seasons', () => {
        const g = groupAwards([
            { name: 'Lester B. Pearson Award', seasons: [20072008, 20082009] },
            { name: 'Ted Lindsay Award', seasons: [20092010, 20082009] },
        ]);
        expect(g).toHaveLength(1);
        expect(g[0]).toMatchObject({ art: 'ted-lindsay', label: 'Ted Lindsay', name: 'Lester B. Pearson Award' });
        expect(g[0].seasons).toEqual([20072008, 20082009, 20092010]);
    });

    it('keeps distinct unknown awards apart, after the known ones', () => {
        const g = groupAwards([
            { name: 'NHL Foundation Player Award', seasons: [20152016] },
            { name: 'E.J. McGuire Award of Excellence', seasons: [20232024] },
            { name: 'Vezina Trophy', seasons: [20242025] },
            { name: '', seasons: [20242025] },
        ]);
        expect(g.map(a => a.label)).toEqual(['Vezina', 'E.J. McGuire', 'Foundation Player']);
    });

    it('returns nothing for no awards', () => {
        expect(groupAwards([])).toEqual([]);
    });
});

describe('season text', () => {
    it('cites award years and folds runs of three or more', () => {
        expect(awardYear(20232024)).toBe(2024);
        expect(seasonsText([20232024])).toBe('2024');
        // Barkov's Cups: a pair stays apart so it cannot read as one season
        expect(seasonYears([20242025, 20232024])).toEqual(['2024', '2025']);
        // Ovechkin's Richards
        expect(seasonsText([20072008, 20082009, 20122013, 20132014, 20142015, 20152016, 20172018, 20182019, 20192020])).toBe(
            '2008 · 2009 · 2013–16 · 2018–20',
        );
        expect(seasonYears([20162017, 20172018, 20202021, 20212022, 20222023, 20252026])).toEqual(['2017', '2018', '2021–23', '2026']);
        expect(seasonYears([])).toEqual([]);
    });
});
