/**
 * NHL award names (as the landing API spells them) to trophy artwork in
 * /public/trophies, grouped for the player page: one entry per trophy,
 * repeat wins folded together, ordered by prestige.
 */

export interface AwardIn {
    name: string;
    seasons: number[];
}

export interface AwardGroup {
    /** Artwork id: /trophies/{art}.svg */
    art: string;
    /** The award's full name, as the API gives it. */
    name: string;
    /** Short display label. */
    label: string;
    /** Seasons won, oldest first, de-duplicated (e.g. 20232024). */
    seasons: number[];
}

// Prestige order. `match` runs on the normalised name (lower case, quotes dropped).
const TROPHIES: { art: string; label: string; match: RegExp }[] = [
    { art: 'stanley-cup', label: 'Stanley Cup', match: /\bstanley cup\b/ },
    { art: 'hart', label: 'Hart', match: /\bhart (memorial )?trophy\b/ },
    { art: 'ted-lindsay', label: 'Ted Lindsay', match: /\bted lindsay\b|\blester b\.? pearson\b/ },
    { art: 'conn-smythe', label: 'Conn Smythe', match: /\bconn smythe\b/ },
    { art: 'art-ross', label: 'Art Ross', match: /\bart ross\b/ },
    { art: 'rocket-richard', label: 'Rocket Richard', match: /\brichard trophy\b/ },
    { art: 'vezina', label: 'Vezina', match: /\bvezina\b/ },
    { art: 'norris', label: 'Norris', match: /\bnorris\b/ },
    { art: 'calder', label: 'Calder', match: /\bcalder (memorial )?trophy\b/ },
    { art: 'selke', label: 'Selke', match: /\bselke\b/ },
    { art: 'jennings', label: 'Jennings', match: /\bjennings\b/ },
    { art: 'lady-byng', label: 'Lady Byng', match: /\blady byng\b/ },
    { art: 'messier', label: 'Messier', match: /\bmessier\b/ },
    { art: 'king-clancy', label: 'King Clancy', match: /\bking clancy\b/ },
    { art: 'masterton', label: 'Masterton', match: /\bmasterton\b/ },
];

export const GENERIC_ART = 'generic';

const normalise = (name: string) =>
    name
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[“”"‘’']/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

/** A short label for an award we have no artwork for: drop the boilerplate words. */
function shortLabel(name: string): string {
    const s = name
        .replace(/\bNHL\b/g, '')
        .replace(/\bAward of Excellence\b/gi, '')
        .replace(/\b(Memorial|Trophy|Award)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    return s || name.trim();
}

/** The artwork and short label for one award name. */
export function trophyFor(name: string): { art: string; label: string; rank: number } {
    const n = normalise(name);
    const i = TROPHIES.findIndex(t => t.match.test(n));
    return i >= 0 ? { art: TROPHIES[i].art, label: TROPHIES[i].label, rank: i } : { art: GENERIC_ART, label: shortLabel(name), rank: TROPHIES.length };
}

/** One entry per trophy, repeat wins folded together, by prestige then name. */
export function groupAwards(awards: AwardIn[]): AwardGroup[] {
    const by = new Map<string, AwardGroup & { rank: number }>();
    for (const a of awards) {
        if (!a.name?.trim()) continue;
        const t = trophyFor(a.name);
        const key = t.art === GENERIC_ART ? `${GENERIC_ART}:${normalise(a.name)}` : t.art;
        const g = by.get(key) ?? { art: t.art, name: a.name.trim(), label: t.label, seasons: [], rank: t.rank };
        g.seasons.push(...a.seasons.filter(s => Number.isFinite(s) && s > 0));
        by.set(key, g);
    }
    return [...by.values()]
        .sort((x, y) => x.rank - y.rank || x.label.localeCompare(y.label))
        .map(g => ({ art: g.art, name: g.name, label: g.label, seasons: [...new Set(g.seasons)].sort((x, y) => x - y) }));
}

/** The year a season's awards are handed out: 20232024 -> 2024. */
export const awardYear = (s: number) => Number(String(s).slice(4, 8));

/**
 * Seasons as award years, the way trophies are cited ("2024 Hart"): runs of
 * three or more straight years collapse to "2013–16"; pairs stay apart so
 * "2024 · 2025" never reads like the 2024-25 season.
 */
export function seasonYears(seasons: number[]): string[] {
    const ys = [...new Set(seasons.map(awardYear))].filter(Number.isFinite).sort((a, b) => a - b);
    const out: string[] = [];
    for (let i = 0; i < ys.length; ) {
        let j = i;
        while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1) j++;
        if (j - i >= 2) {
            out.push(`${ys[i]}–${String(ys[j]).slice(2)}`);
        } else {
            for (let k = i; k <= j; k++) out.push(String(ys[k]));
        }
        i = j + 1;
    }
    return out;
}

/** The line under a trophy. */
export const seasonsText = (seasons: number[]) => seasonYears(seasons).join(' · ');
