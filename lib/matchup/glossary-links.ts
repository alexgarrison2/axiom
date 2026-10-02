/**
 * Where each mark on the matchup card is explained: /methodology section and
 * glossary anchors. The card links chips, tiles and the legend here instead
 * of carrying explanatory copy (a tap works on touch, where titles do not).
 * app/methodology must render every anchor listed in CARD_ANCHORS.
 */

/** Section explaining the whole card (bar, tick, diamond, goalie colours). */
export const READING_A_CARD = 'reading';

/** Glossary term per context chip key (lib/matchup/pills), Why-tab tile or Odds-tab market label. */
export const CARD_TERMS: Record<string, string> = {
    opener: 'term-opener',
    form: 'term-last-n',
    loc: 'term-last-n',
    pp: 'term-pp-pk',
    pk: 'term-pp-pk',
    // The Rest / B2B entry covers back-to-backs and 3-in-4s.
    b2b: 'term-rest',
    '3in4': 'term-rest',
    trip: 'term-rest',
    h2h: 'term-h2h',
    'h2h-prior': 'term-h2h',
    rest: 'term-rest',
    'proj-g': 'term-projected-goals',
    conf: 'term-confidence',
    wt: 'term-wt',
    lean: 'term-lean',
    // Odds tab: the simulator's markets (MarketsTable labels and footer).
    simulator: 'term-simulator',
    'reg-3way': 'term-reg-3way',
    // 1P 3-WAY shares the regulation 3-way entry, which defines both.
    'p1-3way': 'term-reg-3way',
    'p1-2way': 'term-p1-2way',
    push: 'term-push',
    'fair-price': 'term-fair-price',
    'sim-edge': 'term-sim-edge',
};

/**
 * Anchors that lib/glossary.ts gains in fix3-G3 (G3-6). Until that lands they
 * fall back to the top of /methodology; every other anchor resolves today.
 */
export const PENDING_ANCHORS: readonly string[] = [];

/** Every /methodology anchor the card links to. */
export const CARD_ANCHORS: string[] = [READING_A_CARD, ...new Set(Object.values(CARD_TERMS))];

/** "/methodology#term-rest" for a chip / tile key, or null when the key has no entry. */
export function termHref(key: string): string | null {
    const a = CARD_TERMS[key];
    return a ? `/methodology#${a}` : null;
}

export const READING_HREF = `/methodology#${READING_A_CARD}`;
