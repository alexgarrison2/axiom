import { describe as suite, expect, it } from 'vitest';
import {
    describe,
    filterMilestones,
    lastName,
    meter,
    needText,
    nextGameMilestones,
    notableRecent,
    ordinal,
    parseMilestones,
    sortMilestones,
    type Milestone,
    type MilestonesDoc,
} from './milestones';

const base = (o: Partial<Milestone>): Milestone => ({
    p: 1, kind: 'career', stat: 'g', have: 497, target: 500, need: 3, rate: 0.5, eta: [10, '2026-10-20', 'TOR', 1, 9], ...o,
});

const doc: MilestonesDoc = {
    season: '20262027',
    built_at: '',
    since_ixg: 2022,
    players: { '1': ['Alex', 'Ovechkin', 'L', 'WSH', null], '2': ['Sidney', 'Crosby', 'C', 'PIT', 'DTD'] },
    next: { WSH: [10, '2026-10-20', '2026-10-20T23:00:00Z', 'TOR', 1], PIT: [20, '2026-10-21', null, 'BOS', 0] },
    items: [],
    recent: [],
};

suite('copy', () => {
    it('ordinals and thousands', () => {
        expect(ordinal(1)).toBe('1st');
        expect(ordinal(12)).toBe('12th');
        expect(ordinal(23)).toBe('23rd');
        expect(ordinal(1101)).toBe('1,101st');
    });

    it('last names keep particles', () => {
        expect(lastName('Wayne Gretzky')).toBe('Gretzky');
        expect(lastName('James van Riemsdyk')).toBe('van Riemsdyk');
        expect(lastName('Martin St. Louis')).toBe('St. Louis');
    });

    it('describes each kind', () => {
        expect(describe(base({ club: 46 }), null)).toEqual({ title: '500 goals', context: '47th ever · has 497', hof: false });
        expect(describe(base({ club: 0, target: 950 }), null).context).toBe('First ever · has 497');
        expect(describe(base({ club: 222, nth: 224, tie: 1 }), null).context).toBe('T-224th ever · has 497');
        expect(describe(base({ kind: 'alltime', stat: 'p', rank: 21, who: [9, 'Doug Gilmour', 1414, 1, 0] }), null)).toEqual({
            title: 'Pass Gilmour', context: '21st all-time in points', hof: true,
        });
        expect(describe(base({ kind: 'franchise', stat: 'p', rank: 1, fr: 'TBL', who: [9, 'Steven Stamkos', 1137, 0, 1] }), null).title).toBe('Lightning record');
        expect(describe(base({ kind: 'streak', stat: 'pstreak', target: 8, best: [7, 5, 'Sebastian Aho'] }), null).context).toBe('Season best 7 · Aho');
        expect(describe(base({ kind: 'streak', stat: 'ironman', have: 497, target: 500, best: [612, 5, 'Brady Skjei'] }), null)).toEqual({
            title: '500 straight games', context: 'Longest active 612 · Skjei', hof: false,
        });
        expect(describe(base({ p: 5, kind: 'streak', stat: 'ironman', target: 700, best: [612, 5, 'Brady Skjei'] }), null).context).toBe('Longest active');
        expect(describe(base({ kind: 'streak', stat: 'ironman', target: 1000, best: [1012, 5, 'X Y'] }), null).title).toBe('1,000 straight games');
        expect(describe(base({ kind: 'season', race: 1, target: 10 }), null).title).toBe('First to 10');
        expect(describe(base({ kind: 'pony', stat: 'ixg', have: 99.74, target: 100, club: 48 }), '22-23').context).toBe('49th since 22-23 · has 99.7');
        expect(needText(base({ need: 1 }))).toBe('1 goal');
        expect(needText(base({ stat: 'ixg', need: 0.26 }))).toBe('0.26 ixG');
    });
});

suite('board', () => {
    it('meter: pips up to 10 to go, else a bar', () => {
        expect(meter(base({ need: 3 }))).toEqual({ pips: 10, hollow: 3 });
        expect(meter(base({ kind: 'streak', stat: 'pstreak', have: 7, target: 8, need: 1 }))).toEqual({ pips: 8, hollow: 1 });
        // An iron-man streak counts down like a round number, not one pip per game of it.
        expect(meter(base({ kind: 'streak', stat: 'ironman', have: 497, target: 500, need: 3 }))).toEqual({ pips: 10, hollow: 3 });
        expect(meter(base({ have: 450, target: 500, need: 50 }))).toEqual({ bar: 0.9 });
        expect(meter(base({ stat: 'ixg', have: 99.74, target: 100, need: 0.26 }))).toEqual({ bar: 0.9974 });
    });

    it('sorts soonest by date, rarest by club or rank', () => {
        const a = base({ eta: [1, '2026-10-22', 'X', 1, 9], club: 5 });
        const b = base({ p: 2, eta: [2, '2026-10-20', 'X', 1, 9], club: 900 });
        expect(sortMilestones([a, b], 'soon')[0]).toBe(b);
        expect(sortMilestones([a, b], 'rare')[0]).toBe(a);
    });

    it('filters by kind and by name or team', () => {
        const items = [base({}), base({ p: 2, kind: 'alltime' })];
        expect(filterMilestones(doc, items, 'alltime', '')).toHaveLength(1);
        expect(filterMilestones(doc, items, 'all', 'crosby')).toHaveLength(1);
        expect(filterMilestones(doc, items, 'all', 'wsh')).toHaveLength(1);
    });

    it('opening panel: one-game milestones in the next game, one per player, headline-worthy only', () => {
        const d = {
            ...doc,
            items: [
                base({ one: 1, need: 1, club: 46 }),
                base({ one: 1, need: 1, stat: 'a', club: 800 }),
                base({ p: 2, one: 1, need: 1, stat: 'gp', club: 2700, eta: [20, '2026-10-21', 'BOS', 0, 9] }),
                base({ p: 2, one: 1, need: 1, eta: [99, '2026-10-25', 'BOS', 0, 12] }),
            ],
        };
        const night = nextGameMilestones(d);
        expect(night.date).toBe('2026-10-20');
        expect(night.items.map(m => [m.p, m.stat])).toEqual([[1, 'g']]);
        expect(night.total).toBe(2);
    });

    it('recent strip keeps the rarest', () => {
        const r = (club: number, date: string) => ({ p: 1, stat: 'g' as const, target: 100, date, game: 1, opp: 'X', club });
        expect(notableRecent([r(900, '2026-10-14'), r(50, '2026-10-10')], 1)[0].club).toBe(50);
    });

    it('parse rejects malformed files', () => {
        expect(parseMilestones(null)).toBeNull();
        expect(parseMilestones({ items: 'x' })).toBeNull();
        expect(parseMilestones({ ...doc })?.since_ixg).toBe(2022);
    });
});
